import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';

import { projectOffer, projectRoomState } from '../domain/projection.js';
import {
  acceptOffer,
  createNextOffer,
  DispatchConflictError,
  DispatchValidationError,
  overrideOffer,
  rejectOffer,
} from '../domain/dispatch.js';
import { pauseClock, resumeClock, triggerNextEvent } from '../domain/clock.js';
import { resolveAssignment } from '../domain/lifecycle.js';
import type { AppConfig } from '../config.js';
import type { RoomEntry, RoomRegistry } from '../store/registry.js';
import { StaleRevisionError } from '../store/roomStore.js';
import { ApiError } from './errors.js';
import { readExpectedRevision, readJsonBody, readString, sendJson } from './json.js';

export interface ServerDeps {
  config: AppConfig;
  registry: RoomRegistry;
  /** Structured request logging; never receives a body or a credential. */
  log?: (line: Record<string, string | number>) => void;
}

export function createApp({ config, registry, log = defaultLog }: ServerDeps): Server {
  return createServer((req, res) => {
    const startedAt = Date.now();
    handle(req, res, config, registry)
      .catch((error: unknown) => {
        const apiError = toApiError(error);
        if (apiError.status >= 500) {
          log({ level: 'error', message: apiError.message });
        }
        if (!res.headersSent) sendJson(res, apiError.status, apiError.toBody());
        else res.end();
      })
      .finally(() => {
        log({
          method: req.method ?? '-',
          // Path only: a query string could carry operator-entered text.
          path: new URL(req.url ?? '/', 'http://localhost').pathname,
          status: res.statusCode,
          durationMs: Date.now() - startedAt,
        });
      });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  config: AppConfig,
  registry: RoomRegistry,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  const method = req.method ?? 'GET';

  if (method === 'GET' && (url.pathname === '/' || url.pathname === '/app.js' || url.pathname === '/app.css')) {
    return serveStatic(res, url.pathname);
  }

  if (segments[0] === 'health' && segments.length === 1) {
    return handleHealth(req, res, config, registry);
  }

  if (segments[0] !== 'api' || segments[1] !== 'rooms') {
    throw new ApiError('NOT_FOUND', 'Unknown endpoint.');
  }

  // GET /api/rooms
  if (segments.length === 2) {
    requireMethod(method, ['GET']);
    return sendJson(res, 200, { rooms: await registry.summaries() });
  }

  const roomId = segments[2] as string;

  // GET /api/rooms/:roomId
  if (segments.length === 3) {
    requireMethod(method, ['GET']);
    const entry = requireReadyRoom(registry, roomId);
    return sendJson(res, 200, {
      room: projectRoomState(await entry.store.read()),
      recommendationSource: config.providersEnabled ? 'Provider' : 'Deterministic fallback',
    });
  }

  // POST /api/rooms/:roomId/rename
  if (segments.length === 4 && segments[3] === 'rename') {
    requireMethod(method, ['POST']);
    const entry = requireReadyRoom(registry, roomId);
    const body = await readJsonBody(req);
    const expectedRevision = readExpectedRevision(body);
    const displayName = readString(body, 'displayName', { maxLength: 80 });

    const updated = await entry.store.mutate(expectedRevision, (draft) => {
      // Rename is non-destructive: the stable identifier never changes.
      draft.displayName = displayName;
      draft.audits.push({
        id: `${draft.roomId}-aud-${String(draft.audits.length + 1).padStart(3, '0')}`,
        occurredAt: draft.simulatedAt,
        actor: 'OPERATOR',
        action: 'ROOM_RENAMED',
        summary: `Room display name changed to ${displayName}.`,
      });
    });
    return sendJson(res, 200, { room: projectRoomState(updated) });
  }

  // POST /api/rooms/:roomId/offers -- claim the next issue and offer it once.
  if (segments.length === 4 && segments[3] === 'offers') {
    requireMethod(method, ['POST']);
    const entry = requireReadyRoom(registry, roomId);
    const body = await readJsonBody(req);
    const expectedRevision = readExpectedRevision(body);
    let result: ReturnType<typeof createNextOffer> | undefined;
    const updated = await entry.store.mutate(expectedRevision, (draft) => {
      result = createNextOffer(draft);
    });
    return sendJson(res, 201, {
      room: projectRoomState(updated),
      offer: projectOffer(result!.offer),
      recommendation: result!.recommendation,
    });
  }

  // POST /api/rooms/:roomId/offers/:offerId/accept|reject|override
  if (segments.length === 6 && segments[3] === 'offers') {
    requireMethod(method, ['POST']);
    const offerId = segments[4] as string;
    const operation = segments[5] as string;
    const entry = requireReadyRoom(registry, roomId);
    const body = await readJsonBody(req);
    const expectedRevision = readExpectedRevision(body);

    if (operation === 'accept') {
      let offer;
      const updated = await entry.store.mutate(expectedRevision, (draft) => {
        offer = acceptOffer(draft, offerId);
      });
      return sendJson(res, 200, { room: projectRoomState(updated), offer: projectOffer(offer!) });
    }
    if (operation === 'reject') {
      let result: ReturnType<typeof rejectOffer> | undefined;
      const updated = await entry.store.mutate(expectedRevision, (draft) => {
        result = rejectOffer(draft, offerId);
      });
      return sendJson(res, 200, {
        room: projectRoomState(updated),
        offer: projectOffer(result!.offer),
        nextOffer: result!.nextOffer === null ? null : projectOffer(result!.nextOffer),
      });
    }
    if (operation === 'override') {
      const responderId = readString(body, 'responderId', { maxLength: 100 });
      let result: ReturnType<typeof overrideOffer> | undefined;
      const updated = await entry.store.mutate(expectedRevision, (draft) => {
        result = overrideOffer(draft, offerId, responderId);
      });
      return sendJson(res, 200, {
        room: projectRoomState(updated),
        offer: projectOffer(result!.offer),
        recommendation: result!.recommendation,
      });
    }
    throw new ApiError('NOT_FOUND', 'Unknown offer action.');
  }

  // POST /api/rooms/:roomId/pause
  if (segments.length === 4 && segments[3] === 'pause') {
    requireMethod(method, ['POST']);
    const entry = requireReadyRoom(registry, roomId);
    const body = await readJsonBody(req);
    const expectedRevision = readExpectedRevision(body);
    const updated = await entry.store.mutate(expectedRevision, (draft) => { pauseClock(draft); });
    return sendJson(res, 200, { room: projectRoomState(updated) });
  }

  // POST /api/rooms/:roomId/resume
  if (segments.length === 4 && segments[3] === 'resume') {
    requireMethod(method, ['POST']);
    const entry = requireReadyRoom(registry, roomId);
    const body = await readJsonBody(req);
    const expectedRevision = readExpectedRevision(body);
    const updated = await entry.store.mutate(expectedRevision, (draft) => { resumeClock(draft); });
    return sendJson(res, 200, { room: projectRoomState(updated) });
  }

  // POST /api/rooms/:roomId/trigger
  if (segments.length === 4 && segments[3] === 'trigger') {
    requireMethod(method, ['POST']);
    const entry = requireReadyRoom(registry, roomId);
    const body = await readJsonBody(req);
    const expectedRevision = readExpectedRevision(body);
    const updated = await entry.store.mutateWithHidden(expectedRevision, (draft, hiddenDraft) => {
      triggerNextEvent(draft, hiddenDraft);
    });
    return sendJson(res, 200, { room: projectRoomState(updated) });
  }

  // POST /api/rooms/:roomId/assignments/:assignmentId/resolve
  if (segments.length === 6 && segments[3] === 'assignments' && segments[5] === 'resolve') {
    requireMethod(method, ['POST']);
    const assignmentId = segments[4] as string;
    const entry = requireReadyRoom(registry, roomId);
    const body = await readJsonBody(req);
    const expectedRevision = readExpectedRevision(body);
    let assignment;
    const updated = await entry.store.mutate(expectedRevision, (draft) => {
      assignment = resolveAssignment(draft, assignmentId);
    });
    return sendJson(res, 200, { room: projectRoomState(updated), assignment });
  }

  throw new ApiError('NOT_FOUND', 'Unknown endpoint.');
}

/** The operator UI is bundled with this process; no CDN or provider call is needed. */
async function serveStatic(res: ServerResponse, pathname: '/' | '/app.js' | '/app.css'): Promise<void> {
  const filename = pathname === '/' ? 'index.html' : pathname.slice(1);
  const contentType = filename.endsWith('.js')
    ? 'text/javascript; charset=utf-8'
    : filename.endsWith('.css')
      ? 'text/css; charset=utf-8'
      : 'text/html; charset=utf-8';
  try {
    const content = await readFile(join(process.cwd(), 'static', filename));
    res.writeHead(200, {
      'content-type': contentType,
      'content-length': content.length,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(content);
  } catch {
    throw new ApiError('NOT_FOUND', 'Operator interface is unavailable.');
  }
}

/**
 * Health succeeds only when the process can serve the room registry. Individual
 * FAILED rooms are reported but do not make the deployment unhealthy, because a
 * failed room must not take other rooms down with it (SOW s3.1).
 */
async function handleHealth(
  req: IncomingMessage,
  res: ServerResponse,
  config: AppConfig,
  registry: RoomRegistry,
): Promise<void> {
  requireMethod(req.method ?? 'GET', ['GET']);
  let rooms;
  try {
    rooms = await registry.summaries();
  } catch {
    return sendJson(res, 503, { status: 'unhealthy', reason: 'room registry unavailable' });
  }

  if (rooms.length === 0) {
    return sendJson(res, 503, { status: 'unhealthy', reason: 'no rooms registered' });
  }

  return sendJson(res, 200, {
    status: 'ok',
    providersEnabled: config.providersEnabled,
    rooms: rooms.map((room) => ({
      roomId: room.roomId,
      health: room.health,
      ...(room.clockState === undefined ? {} : { clockState: room.clockState }),
    })),
  });
}

function requireMethod(method: string, allowed: string[]): void {
  if (!allowed.includes(method)) {
    throw new ApiError('METHOD_NOT_ALLOWED', `Allowed methods: ${allowed.join(', ')}.`);
  }
}

/** Unknown room is 404; a known but failed room is a distinct 503 (SOW s8). */
function requireReadyRoom(registry: RoomRegistry, roomId: string): RoomEntry {
  const entry = registry.get(roomId);
  if (entry === undefined) {
    throw new ApiError('ROOM_NOT_FOUND', `Unknown room: ${roomId}.`);
  }
  if (entry.health === 'FAILED') {
    throw new ApiError('ROOM_UNAVAILABLE', `Room ${roomId} is unavailable.`);
  }
  return entry;
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof StaleRevisionError) {
    return new ApiError(
      'STALE_REVISION',
      'The room changed since this action was prepared. Reload and retry.',
      { expectedRevision: error.expected, currentRevision: error.actual },
    );
  }
  if (error instanceof DispatchConflictError) {
    return new ApiError('CONFLICT', error.message);
  }
  if (error instanceof DispatchValidationError) {
    return new ApiError('VALIDATION_FAILED', error.message);
  }
  // Internal details stay in the log, not in the response body.
  return new ApiError('INTERNAL_ERROR', 'Internal error.');
}

function defaultLog(line: Record<string, string | number>): void {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...line })}\n`);
}
