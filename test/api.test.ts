import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { getJson, makeDataRoot, postJson, removeDataRoot, startApp, type TestApp } from './helpers.js';

describe('room API contract', () => {
  let dataRoot: string;
  let app: TestApp;

  before(async () => {
    dataRoot = await makeDataRoot();
    app = await startApp(dataRoot);
  });

  after(async () => {
    await app.close();
    await removeDataRoot(dataRoot);
  });

  it('reports deterministic fallback while providers are disabled', async () => {
    const { body } = await getJson(`${app.baseUrl}/api/rooms/plant-1`);
    assert.equal(body.recommendationSource, 'Deterministic fallback');
  });

  it('serves the bundled operator interface without an external dependency', async () => {
    const response = await fetch(`${app.baseUrl}/`);
    assert.equal(response.status, 200);
    const page = await response.text();
    assert.match(page, /Response Compass/);
    assert.match(page, /id="nav-production-floor"/);
    assert.match(page, /id="nav-analytics"/);
    assert.match(page, /id="nav-settings"/);
    assert.match(page, /id="analytics-content"/);
    assert.match(page, /id="settings-api"/);
    assert.match(page, /id="openai-api-key"/);
    assert.match(page, /id="openrouter-api-key"/);
    assert.match(page, /data-provider-action="save"/);
    assert.match(page, /id="pause-simulation"/);
    assert.match(page, /id="resume-simulation"/);
    assert.match(page, /id="trigger-event"/);
    assert.match(page, /id="force-resolve"/);
    assert.match(page, /id="floor-picker"/);
    assert.match(page, /id="tab-personnel"/);
    assert.match(page, /id="reset-focus"/);
  });

  it('returns 404 for an unknown room and 404 for an unknown endpoint', async () => {
    const room = await getJson(`${app.baseUrl}/api/rooms/plant-9`);
    assert.equal(room.status, 404);
    assert.equal(room.body.error.code, 'ROOM_NOT_FOUND');

    const endpoint = await getJson(`${app.baseUrl}/api/rooms/plant-1/nowhere`);
    assert.equal(endpoint.status, 404);
  });

  it('rejects a path that tries to escape the data root', async () => {
    const escaped = await getJson(`${app.baseUrl}/api/rooms/..%2F..%2Fetc`);
    assert.equal(escaped.status, 404);
    assert.equal(escaped.body.error.code, 'ROOM_NOT_FOUND');
  });

  it('rejects a stale revision without changing state', async () => {
    const before = await getJson(`${app.baseUrl}/api/rooms/plant-1`);
    const revision = before.body.room.revision;

    const stale = await postJson(`${app.baseUrl}/api/rooms/plant-1/rename`, {
      expectedRevision: revision - 1,
      displayName: 'Should Not Apply',
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'STALE_REVISION');

    const after = await getJson(`${app.baseUrl}/api/rooms/plant-1`);
    assert.equal(after.body.room.revision, revision);
    assert.notEqual(after.body.room.displayName, 'Should Not Apply');
  });

  it('rejects a replayed mutation at the same revision', async () => {
    const start = await getJson(`${app.baseUrl}/api/rooms/plant-2`);
    const revision = start.body.room.revision;
    const payload = { expectedRevision: revision, displayName: 'Plant Two' };

    const first = await postJson(`${app.baseUrl}/api/rooms/plant-2/rename`, payload);
    assert.equal(first.status, 200);

    const replay = await postJson(`${app.baseUrl}/api/rooms/plant-2/rename`, payload);
    assert.equal(replay.status, 409, 'a replayed action must not apply twice');
  });

  it('serializes concurrent mutations so none is silently lost', async () => {
    const start = await getJson(`${app.baseUrl}/api/rooms/plant-1`);
    const revision = start.body.room.revision;

    // Both requests pass the revision check before either has written.
    const [a, b] = await Promise.all([
      postJson(`${app.baseUrl}/api/rooms/plant-1/rename`, {
        expectedRevision: revision,
        displayName: 'Writer A',
      }),
      postJson(`${app.baseUrl}/api/rooms/plant-1/rename`, {
        expectedRevision: revision,
        displayName: 'Writer B',
      }),
    ]);

    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 409], 'exactly one writer may win');

    const end = await getJson(`${app.baseUrl}/api/rooms/plant-1`);
    assert.equal(end.body.room.revision, revision + 1);
  });

  it('validates method, content type, and body shape', async () => {
    const wrongMethod = await fetch(`${app.baseUrl}/api/rooms/plant-1/rename`);
    assert.equal(wrongMethod.status, 405);

    const wrongType = await fetch(`${app.baseUrl}/api/rooms/plant-1/rename`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'displayName=x',
    });
    assert.equal(wrongType.status, 415);

    const missingRevision = await postJson(`${app.baseUrl}/api/rooms/plant-1/rename`, {
      displayName: 'No Revision',
    });
    assert.equal(missingRevision.status, 400);
    assert.equal(missingRevision.body.error.code, 'VALIDATION_FAILED');

    const emptyName = await postJson(`${app.baseUrl}/api/rooms/plant-1/rename`, {
      expectedRevision: 1,
      displayName: '   ',
    });
    assert.equal(emptyName.status, 400);
  });

  it('rejects an oversized body', async () => {
    const response = await fetch(`${app.baseUrl}/api/rooms/plant-1/rename`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1, padding: 'x'.repeat(70 * 1024) }),
    });
    assert.equal(response.status, 413);
  });
});

describe('room isolation', () => {
  let dataRoot: string;
  let app: TestApp;

  before(async () => {
    dataRoot = await makeDataRoot();
    app = await startApp(dataRoot);
  });

  after(async () => {
    await app.close();
    await removeDataRoot(dataRoot);
  });

  it('does not let a mutation in one room change another', async () => {
    const before2 = await getJson(`${app.baseUrl}/api/rooms/plant-2`);

    await postJson(`${app.baseUrl}/api/rooms/plant-1/rename`, {
      expectedRevision: 1,
      displayName: 'Only Plant One',
    });

    const after2 = await getJson(`${app.baseUrl}/api/rooms/plant-2`);
    assert.deepEqual(after2.body.room, before2.body.room);
  });

  it('gives each room its own entities and its own hidden stream', async () => {
    const one = await getJson(`${app.baseUrl}/api/rooms/plant-1`);
    const two = await getJson(`${app.baseUrl}/api/rooms/plant-2`);

    const oneIds = new Set(one.body.room.stations.map((s: { id: string }) => s.id));
    for (const station of two.body.room.stations) {
      assert.ok(!oneIds.has(station.id), 'rooms must not share station identity');
    }
    assert.notDeepEqual(
      one.body.room.issues.map((i: { class: string }) => i.class),
      two.body.room.issues.map((i: { class: string }) => i.class),
    );
  });
});
