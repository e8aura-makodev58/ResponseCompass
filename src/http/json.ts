import type { IncomingMessage, ServerResponse } from 'node:http';

import { ApiError } from './errors.js';

/** Requests are small control-plane mutations; anything larger is rejected. */
const MAX_BODY_BYTES = 64 * 1024;

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

/**
 * Read and validate a JSON request body: content type, declared and actual
 * size, and parseability (SOW s8). A body that fails any check is rejected
 * before any domain code sees it.
 */
export async function readJsonBody(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new ApiError(
      'UNSUPPORTED_MEDIA_TYPE',
      'Request body must be application/json.',
    );
  }

  const declared = req.headers['content-length'];
  if (declared !== undefined && Number(declared) > MAX_BODY_BYTES) {
    throw new ApiError('PAYLOAD_TOO_LARGE', 'Request body is too large.');
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    // Check the real length too: content-length can be absent or dishonest.
    if (total > MAX_BODY_BYTES) {
      throw new ApiError('PAYLOAD_TOO_LARGE', 'Request body is too large.');
    }
    chunks.push(buffer);
  }

  if (total === 0) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError('VALIDATION_FAILED', 'Request body is not valid JSON.');
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError('VALIDATION_FAILED', 'Request body must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

/**
 * The shared mutation envelope (frozen contract v1). Every room mutation
 * carries `expectedRevision`; the store compares it under the room lock.
 */
export function readExpectedRevision(body: Record<string, unknown>): number {
  const value = body['expectedRevision'];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ApiError(
      'VALIDATION_FAILED',
      'expectedRevision must be a non-negative integer.',
    );
  }
  return value;
}

export function readString(
  body: Record<string, unknown>,
  field: string,
  { maxLength = 120 }: { maxLength?: number } = {},
): string {
  const value = body[field];
  if (typeof value !== 'string') {
    throw new ApiError('VALIDATION_FAILED', `${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > maxLength) {
    throw new ApiError(
      'VALIDATION_FAILED',
      `${field} must be between 1 and ${maxLength} characters.`,
    );
  }
  return trimmed;
}
