import { readFile, rm } from 'node:fs/promises';

import type { RoomState } from '../domain/types.js';
import { SCHEMA_VERSION } from '../domain/types.js';
import type { HiddenRoomTruth } from '../domain/private.js';
import { writeJsonAtomic } from './atomic.js';
import type { DataPaths } from './paths.js';

export class StaleRevisionError extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`Stale revision: expected ${expected}, room is at ${actual}`);
    this.name = 'StaleRevisionError';
  }
}

interface RoomTransaction {
  schemaVersion: 1;
  roomId: string;
  phase: 'PREPARED' | 'COMMITTED';
  before: { state: RoomState; hidden: HiddenRoomTruth };
  after: { state: RoomState; hidden: HiddenRoomTruth };
}

/**
 * Serialized read-modify-write access to one room's persisted state (SOW s3.2).
 *
 * Every mutation runs through `queue`, so two concurrent HTTP requests for the
 * same room cannot interleave a read and a write and lose one of the updates.
 * Rooms hold independent stores, so a slow write in one room does not block
 * another.
 */
export class RoomStore {
  private queue: Promise<unknown> = Promise.resolve();
  private cached: RoomState | undefined;

  constructor(
    private readonly paths: DataPaths,
    readonly roomId: string,
  ) {}

  /** Load and validate from disk, populating the in-process cache. */
  async load(): Promise<RoomState> {
    await this.recoverTransaction();
    const raw = await readFile(this.paths.roomStateFile(this.roomId), 'utf8');
    const parsed = JSON.parse(raw) as RoomState;
    assertLoadable(parsed, this.roomId);
    this.cached = parsed;
    return parsed;
  }

  async read(): Promise<RoomState> {
    return this.cached ?? (await this.load());
  }

  /**
   * Apply a mutation under the room lock.
   *
   * `expectedRevision` is checked *inside* the lock: checking it in the request
   * handler would let a second request pass the check and then queue behind the
   * first, overwriting it (SOW s3.1).
   */
  async mutate(
    expectedRevision: number | undefined,
    apply: (draft: RoomState) => void | Promise<void>,
  ): Promise<RoomState> {
    return this.enqueue(async () => {
      const current = await this.read();
      if (expectedRevision !== undefined && expectedRevision !== current.revision) {
        throw new StaleRevisionError(expectedRevision, current.revision);
      }

      // Mutate a copy: if `apply` throws partway through, the cached state is
      // untouched and the caller's failed action changes nothing.
      const draft = structuredClone(current);
      await apply(draft);
      draft.revision = current.revision + 1;

      await writeJsonAtomic(this.paths.roomStateFile(this.roomId), draft);
      this.cached = draft;
      return draft;
    });
  }

  /**
   * Coordinate a public-state and hidden-truth mutation through a durable
   * transaction journal. A PREPARED journal rolls back after interruption; a
   * COMMITTED journal rolls forward. This keeps both canonical files at the
   * same logical revision even though a filesystem cannot rename two files as
   * one operation.
   */
  async mutateWithHidden(
    expectedRevision: number | undefined,
    apply: (draft: RoomState, hiddenDraft: HiddenRoomTruth) => void | Promise<void>,
  ): Promise<RoomState> {
    return this.enqueue(async () => {
      const current = await this.read();
      if (expectedRevision !== undefined && expectedRevision !== current.revision) {
        throw new StaleRevisionError(expectedRevision, current.revision);
      }
      const hidden = await this.readHiddenTruth();

      const draft = structuredClone(current);
      const hiddenDraft = structuredClone(hidden);
      await apply(draft, hiddenDraft);
      draft.revision = current.revision + 1;

      const transaction: RoomTransaction = {
        schemaVersion: 1,
        roomId: this.roomId,
        phase: 'PREPARED',
        before: { state: current, hidden },
        after: { state: draft, hidden: hiddenDraft },
      };
      const transactionFile = this.paths.roomTransactionFile(this.roomId);
      await writeJsonAtomic(transactionFile, transaction);
      try {
        await writeJsonAtomic(this.paths.roomHiddenFile(this.roomId), hiddenDraft);
        await writeJsonAtomic(this.paths.roomStateFile(this.roomId), draft);
        await writeJsonAtomic(transactionFile, { ...transaction, phase: 'COMMITTED' });
      } catch (error) {
        this.cached = undefined;
        try {
          await this.recoverTransaction();
        } catch (recoveryError) {
          throw new AggregateError([error, recoveryError], 'Room transaction failed and could not be recovered.');
        }
        throw error;
      }

      this.cached = draft;
      // A committed journal is safe to replay. Cleanup failure is therefore
      // non-fatal and the next startup will remove it after rolling forward.
      await rm(transactionFile, { force: true }).catch(() => undefined);
      return draft;
    });
  }

  /** Server-only. Callers must not place this on a public payload. */
  async readHiddenTruth(): Promise<HiddenRoomTruth> {
    const raw = await readFile(this.paths.roomHiddenFile(this.roomId), 'utf8');
    return JSON.parse(raw) as HiddenRoomTruth;
  }

  private async recoverTransaction(): Promise<void> {
    const transactionFile = this.paths.roomTransactionFile(this.roomId);
    let transaction: RoomTransaction;
    try {
      transaction = JSON.parse(await readFile(transactionFile, 'utf8')) as RoomTransaction;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new Error(`Room ${this.roomId}: unreadable transaction journal.`, { cause: error });
    }
    assertTransaction(transaction, this.roomId);
    const snapshot = transaction.phase === 'COMMITTED' ? transaction.after : transaction.before;
    await writeJsonAtomic(this.paths.roomHiddenFile(this.roomId), snapshot.hidden);
    await writeJsonAtomic(this.paths.roomStateFile(this.roomId), snapshot.state);
    this.cached = snapshot.state;
    await rm(transactionFile, { force: true });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    // Keep the chain alive after a rejection so one failed mutation does not
    // wedge every later mutation for this room.
    this.queue = run.catch(() => undefined);
    return run;
  }
}

function assertTransaction(transaction: RoomTransaction, roomId: string): void {
  if (
    transaction?.schemaVersion !== 1 ||
    transaction.roomId !== roomId ||
    !['PREPARED', 'COMMITTED'].includes(transaction.phase) ||
    transaction.before?.state?.roomId !== roomId ||
    transaction.after?.state?.roomId !== roomId ||
    transaction.before?.hidden?.roomId !== roomId ||
    transaction.after?.hidden?.roomId !== roomId
  ) {
    throw new Error(`Room ${roomId}: invalid transaction journal.`);
  }
}

function assertLoadable(state: RoomState, roomId: string): void {
  if (state === null || typeof state !== 'object') {
    throw new Error(`Room ${roomId}: state is not an object`);
  }
  if (state.schemaVersion !== SCHEMA_VERSION) {
    // Startup reconciliation must not guess at unknown state (SOW s3.2); the
    // registry isolates this room as FAILED instead.
    throw new Error(
      `Room ${roomId}: unsupported schemaVersion ${String(state.schemaVersion)}, expected ${SCHEMA_VERSION}`,
    );
  }
  if (state.roomId !== roomId) {
    throw new Error(
      `Room ${roomId}: state declares roomId ${String(state.roomId)}; provenance is ambiguous`,
    );
  }
  if (typeof state.revision !== 'number' || !Number.isInteger(state.revision)) {
    throw new Error(`Room ${roomId}: revision is not an integer`);
  }
  for (const key of ['stations', 'responders', 'issues', 'offers', 'assignments', 'events', 'audits'] as const) {
    if (!Array.isArray(state[key])) {
      throw new Error(`Room ${roomId}: ${key} is not an array`);
    }
  }
}
