import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';

import { DEFAULT_ROOM_SPECS, seedRoom } from '../src/seed/seed.js';
import { DataPaths } from '../src/store/paths.js';
import { RoomRegistry } from '../src/store/registry.js';
import { getJson, makeDataRoot, postJson, removeDataRoot, startApp } from './helpers.js';

describe('persistence and seeding', () => {
  let dataRoot: string;

  before(async () => {
    dataRoot = await makeDataRoot();
  });

  after(async () => {
    await removeDataRoot(dataRoot);
  });

  it('seeds two rooms once and survives a restart', async () => {
    const first = await startApp(dataRoot);
    const renamed = await postJson(`${first.baseUrl}/api/rooms/plant-1/rename`, {
      expectedRevision: 1,
      displayName: 'Renamed Plant',
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.room.revision, 2);
    await first.close();

    // Restart against the same data root: a new process must not reseed.
    const second = await startApp(dataRoot);
    const rooms = await getJson(`${second.baseUrl}/api/rooms`);
    assert.equal(rooms.status, 200);
    assert.deepEqual(
      rooms.body.rooms.map((room: { roomId: string }) => room.roomId),
      ['plant-1', 'plant-2'],
    );

    const reloaded = await getJson(`${second.baseUrl}/api/rooms/plant-1`);
    assert.equal(reloaded.body.room.displayName, 'Renamed Plant');
    assert.equal(reloaded.body.room.revision, 2);
    assert.equal(reloaded.body.room.clockState, 'PAUSED');
    await second.close();
  });

  it('never reseeds a nonempty data root', async () => {
    const paths = new DataPaths(dataRoot);
    const seededAgain = await RoomRegistry.seedIfEmpty(paths, DEFAULT_ROOM_SPECS);
    assert.equal(seededAgain, false);

    const state = JSON.parse(await readFile(paths.roomStateFile('plant-1'), 'utf8'));
    assert.equal(state.displayName, 'Renamed Plant', 'existing state was overwritten');
  });

  it('produces byte-identical state for the same room id', () => {
    const spec = DEFAULT_ROOM_SPECS[0]!;
    assert.equal(
      JSON.stringify(seedRoom(spec).state),
      JSON.stringify(seedRoom(spec).state),
    );
  });

  it('isolates an unreadable room as FAILED while other rooms serve', async () => {
    const isolatedRoot = await makeDataRoot();
    try {
      const app = await startApp(isolatedRoot);
      await app.close();

      const paths = new DataPaths(isolatedRoot);
      await writeFile(paths.roomStateFile('plant-2'), '{ not valid json', 'utf8');

      const restarted = await startApp(isolatedRoot);
      const health = await getJson(`${restarted.baseUrl}/health`);
      assert.equal(health.status, 200, 'one failed room must not fail the deployment');
      assert.deepEqual(
        health.body.rooms,
        [
          { roomId: 'plant-1', health: 'READY', clockState: 'PAUSED' },
          { roomId: 'plant-2', health: 'FAILED' },
        ],
      );

      const healthy = await getJson(`${restarted.baseUrl}/api/rooms/plant-1`);
      assert.equal(healthy.status, 200);

      const failed = await getJson(`${restarted.baseUrl}/api/rooms/plant-2`);
      assert.equal(failed.status, 503);
      assert.equal(failed.body.error.code, 'ROOM_UNAVAILABLE');

      await restarted.close();
    } finally {
      await removeDataRoot(isolatedRoot);
    }
  });
});
