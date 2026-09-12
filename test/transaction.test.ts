import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import type { HiddenRoomTruth } from '../src/domain/private.js';
import type { RoomState } from '../src/domain/types.js';
import { DEFAULT_ROOM_SPECS } from '../src/seed/seed.js';
import { DataPaths } from '../src/store/paths.js';
import { RoomRegistry } from '../src/store/registry.js';
import { makeDataRoot, removeDataRoot } from './helpers.js';

interface TransactionFixture {
  schemaVersion: 1;
  roomId: string;
  phase: 'PREPARED' | 'COMMITTED';
  before: { state: RoomState; hidden: HiddenRoomTruth };
  after: { state: RoomState; hidden: HiddenRoomTruth };
}

describe('room state and hidden-truth transaction recovery', () => {
  async function fixture(phase: TransactionFixture['phase']) {
    const dataRoot = await makeDataRoot();
    const paths = new DataPaths(dataRoot);
    await RoomRegistry.seedIfEmpty(paths, DEFAULT_ROOM_SPECS);
    const before = {
      state: JSON.parse(await readFile(paths.roomStateFile('plant-1'), 'utf8')) as RoomState,
      hidden: JSON.parse(await readFile(paths.roomHiddenFile('plant-1'), 'utf8')) as HiddenRoomTruth,
    };
    const after = structuredClone(before);
    after.state.revision += 1;
    after.state.displayName = 'Transaction applied';
    after.hidden.randomStream.cursor += 7;
    const transaction: TransactionFixture = {
      schemaVersion: 1,
      roomId: 'plant-1',
      phase,
      before,
      after,
    };
    await writeFile(paths.roomTransactionFile('plant-1'), JSON.stringify(transaction), 'utf8');
    return { dataRoot, paths, before, after };
  }

  async function assertJournalRemoved(paths: DataPaths) {
    await assert.rejects(
      readFile(paths.roomTransactionFile('plant-1'), 'utf8'),
      (error: NodeJS.ErrnoException) => error.code === 'ENOENT',
    );
  }

  it('rolls a partially written PREPARED transaction back on startup', async () => {
    const test = await fixture('PREPARED');
    try {
      // Model interruption after the public file changed but before commit.
      await writeFile(test.paths.roomStateFile('plant-1'), JSON.stringify(test.after.state), 'utf8');
      const registry = await RoomRegistry.open(test.paths);
      const store = registry.get('plant-1')?.store;
      assert.ok(store);
      assert.deepEqual(await store.read(), test.before.state);
      assert.deepEqual(await store.readHiddenTruth(), test.before.hidden);
      await assertJournalRemoved(test.paths);
    } finally {
      await removeDataRoot(test.dataRoot);
    }
  });

  it('rolls a COMMITTED transaction forward on startup', async () => {
    const test = await fixture('COMMITTED');
    try {
      // Model interruption after hidden truth changed but before cleanup.
      await writeFile(test.paths.roomHiddenFile('plant-1'), JSON.stringify(test.after.hidden), 'utf8');
      const registry = await RoomRegistry.open(test.paths);
      const store = registry.get('plant-1')?.store;
      assert.ok(store);
      assert.deepEqual(await store.read(), test.after.state);
      assert.deepEqual(await store.readHiddenTruth(), test.after.hidden);
      await assertJournalRemoved(test.paths);
    } finally {
      await removeDataRoot(test.dataRoot);
    }
  });
});
