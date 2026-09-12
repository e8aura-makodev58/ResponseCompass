import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seedRoom, DEFAULT_ROOM_SPECS } from '../src/seed/seed.js';
import { advanceAutomation } from '../src/domain/automation.js';
import { createNextOffer } from '../src/domain/dispatch.js';
import { makeDataRoot, removeDataRoot, startApp } from './helpers.js';

test('server scheduler creates offers automatically and stops work when paused', async () => {
  const root = await makeDataRoot();
  const app = await startApp(root, undefined, () => {}, { automaticSimulation: true });
  try {
    const store = app.registry.get('plant-1')!.store;
    await store.mutate(undefined, state => { state.clockState = 'RUNNING'; });
    await new Promise(resolve => setTimeout(resolve, 3200));
    assert.ok((await store.read()).offers.length > 0);
    await store.mutate(undefined, state => { state.clockState = 'PAUSED'; });
    const time = (await store.read()).simulatedAt;
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert.equal((await store.read()).simulatedAt, time);
  } finally {
    await app.close();
    await removeDataRoot(root);
  }
});

test('automatic clock respects pause and 1x/60x without exposing schedules', () => {
  const { state, hidden } = seedRoom(DEFAULT_ROOM_SPECS[0]!);
  const before = JSON.stringify({ state, hidden });
  advanceAutomation(state, hidden, 1000);
  assert.equal(JSON.stringify({ state, hidden }), before);
  state.clockState = 'RUNNING';
  const start = Date.parse(state.simulatedAt);
  advanceAutomation(state, hidden, 1000);
  assert.equal(Date.parse(state.simulatedAt) - start, 60000);
  state.speedMultiplier = 1;
  advanceAutomation(state, hidden, 1000);
  assert.equal(Date.parse(state.simulatedAt) - start, 61000);
});

test('automatic simulator progresses offers and resolutions, varies arrivals and caps demand', () => {
  const { state, hidden } = seedRoom(DEFAULT_ROOM_SPECS[0]!);
  state.clockState = 'RUNNING';
  createNextOffer(state);
  for (let tick = 0; tick < 600; tick++) advanceAutomation(state, hidden, 1000);
  assert.ok(state.offers.some(row => row.status !== 'PENDING'));
  assert.ok(state.events.some(row => row.type === 'RESOLUTION_ATTEMPT_COMPLETED'));
  assert.ok(state.issues.filter(row => row.status !== 'RESOLVED').length <= 10);
  const arrivals = state.events.filter(row => row.type === 'ISSUE_TRIGGERED').map(row => Date.parse(row.occurredAt));
  assert.ok(new Set(arrivals.slice(1).map((at, index) => at - arrivals[index]!)).size > 1);
  const snapshot = JSON.stringify({ state, hidden });
  state.clockState = 'PAUSED';
  const paused = JSON.stringify({ state, hidden });
  advanceAutomation(state, hidden, 100000);
  assert.equal(JSON.stringify({ state, hidden }), paused);
  assert.notEqual(snapshot, paused);
});
