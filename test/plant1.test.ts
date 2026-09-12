import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { describe, it } from 'node:test';

import { loadConfig } from '../src/config.js';
import { projectRoomState } from '../src/domain/projection.js';
import { importPlant1Seed } from '../src/seed/plant1.js';
import { DEFAULT_ROOM_SPECS } from '../src/seed/seed.js';
import { DataPaths } from '../src/store/paths.js';
import { RoomRegistry } from '../src/store/registry.js';
import { makeDataRoot, removeDataRoot } from './helpers.js';

function fixture(): unknown {
  return {
    schemaVersion: '2.1',
    revision: 91,
    simulationState: {
      simulationTime: '2026-09-10T05:20:26.623Z',
      status: 'PAUSED',
      rngVersion: 'lcg32-v1',
    },
    equipment: [
      { id: 'EQ-01', name: 'Station 1', x: 10, y: 10, status: 'ISSUE_ACTIVE', floor: 1 },
      { id: 'EQ-02', name: 'Station 2', x: 140, y: 65, status: 'NORMAL', floor: 1 },
    ],
    responders: [
      { id: 'R-A', name: 'Engr101', x: 20, y: 20, floor: 1, availability: 'ASSIGNED', dutyStation: { x: 10, y: 10, floor: 1 } },
      { id: 'R-B', name: 'Tech102', x: 30, y: 20, floor: 1, availability: 'OFFERED', dutyStation: { x: 10, y: 10, floor: 1 } },
      { id: 'R-C', name: 'Optr103', x: 40, y: 20, floor: 1, availability: 'AVAILABLE', dutyStation: { x: 10, y: 10, floor: 1 } },
      { id: 'R-D', name: 'Optr104', x: 50, y: 20, floor: 1, availability: 'UNAVAILABLE', dutyStation: { x: 10, y: 10, floor: 1 } },
    ],
    responderSkills: [
      { responderId: 'R-A', issueClass: 'A', trueMedianMinutes: 12, trueSuccessProbability: 0.84 },
      { responderId: 'R-B', issueClass: 'B', trueMedianMinutes: 18, trueSuccessProbability: 0.75 },
    ],
    issues: [
      { id: 'ISS-1', equipmentId: 'EQ-01', issueClass: 'A', priorityBand: 'HIGH', complexity: 'COMPLEX', status: 'ASSIGNED', raisedAt: '2026-09-10T05:10:00.000Z' },
      { id: 'ISS-2', equipmentId: 'EQ-02', issueClass: 'B', priorityBand: 'STANDARD', complexity: 'STANDARD', status: 'OFFER_PENDING', raisedAt: '2026-09-10T05:20:00.000Z' },
      { id: 'ISS-0', equipmentId: 'EQ-01', issueClass: 'C', priorityBand: 'STANDARD', complexity: 'STANDARD', status: 'RESOLVED', raisedAt: '2026-09-09T05:20:00.000Z', resolvedAt: '2026-09-09T05:30:00.000Z' },
    ],
    assignments: [
      { id: 'assignment-1', issueId: 'ISS-1', responderId: 'R-A', role: 'PRIMARY', status: 'ACTIVE', createdAt: '2026-09-10T05:10:00.000Z' },
      { id: 'assignment-old', issueId: 'ISS-0', responderId: 'R-A', role: 'PRIMARY', status: 'COMPLETED', createdAt: '2026-09-09T05:20:00.000Z' },
    ],
    recommendations: [
      { id: 'rec-2', candidateEvidenceSnapshot: [{ responderId: 'R-B' }, { responderId: 'R-C' }] },
    ],
    dispatchOffers: [
      { id: 'offer-2', recommendationId: 'rec-2', issueId: 'ISS-2', responderId: 'R-B', purpose: 'INITIAL_ASSIGNMENT', status: 'PENDING', createdAt: '2026-09-10T05:20:26.623Z' },
      { id: 'offer-old', issueId: 'ISS-0', responderId: 'R-A', purpose: 'INITIAL_ASSIGNMENT', status: 'ACCEPTED', createdAt: '2026-09-09T05:20:00.000Z' },
    ],
    operationalEvents: [
      { id: 'event-1', simulationTimestamp: '2026-09-10T05:20:26.623Z', eventType: 'ISSUE_RAISED', issueId: 'ISS-2', payload: { private: 'do-not-copy' } },
    ],
  };
}

describe('Plant 1 simulation seed adapter', () => {
  it('uses the tracked Plant 1 snapshot as the default empty-root seed', async () => {
    const seedPath = loadConfig({}).plant1SimulationSeedPath;
    await access(seedPath);
    const dataRoot = await makeDataRoot();
    try {
      const paths = new DataPaths(dataRoot);
      assert.equal(
        await RoomRegistry.seedIfEmpty(paths, DEFAULT_ROOM_SPECS, seedPath),
        true,
      );
      const registry = await RoomRegistry.open(paths);
      const plant1 = await registry.get('plant-1')!.store.read();
      assert.equal(plant1.stations.length, 72);
      assert.equal(plant1.responders.length, 24);
      assert.equal(plant1.simulatedAt, '2026-09-10T05:20:26.623Z');
      assert.equal(
        await RoomRegistry.seedIfEmpty(paths, DEFAULT_ROOM_SPECS, seedPath),
        false,
        'a nonempty data root must never be overwritten by the bundled seed',
      );
    } finally {
      await removeDataRoot(dataRoot);
    }
  });

  it('maps the active public operational snapshot into canonical room state', () => {
    const { state } = importPlant1Seed(fixture());
    assert.equal(state.roomId, 'plant-1');
    assert.equal(state.simulatedAt, '2026-09-10T05:20:26.623Z');
    assert.equal(state.clockState, 'PAUSED');
    assert.equal(state.stations.length, 2);
    assert.equal(state.stations[0]!.floorId, 'floor-1');
    assert.equal(state.issues.find((issue) => issue.id === 'ISS-1')!.class, 'MECHANICAL');
    assert.equal(state.issues.find((issue) => issue.id === 'ISS-2')!.class, 'ELECTRICAL');
    assert.equal(state.assignments.length, 1, 'only currently active assignments are imported');
    assert.equal(state.responders.find((responder) => responder.id === 'R-A')!.assignmentId, 'assignment-1');
    assert.deepEqual(state.offers[0]!.rankedCandidateIds, ['R-B', 'R-C']);
  });

  it('keeps source hidden skills out of public room state and payloads', () => {
    const { state, hidden } = importPlant1Seed(fixture());
    const projected = JSON.stringify(projectRoomState(state));
    assert.equal(hidden.skills['R-A']!.MECHANICAL!.trueMedianMinutes, 12);
    assert.equal(projected.includes('trueMedianMinutes'), false);
    assert.equal(projected.includes('trueSuccessProbability'), false);
    assert.equal(projected.includes('do-not-copy'), false, 'arbitrary source event payloads are not imported');
    assert.equal(projected.includes('rankedCandidateIds'), false, 'persisted queue remains server-only');
  });

  it('rejects an incompatible source schema before any state is produced', () => {
    assert.throws(() => importPlant1Seed({ ...fixture() as object, schemaVersion: '1.0' }), /schemaVersion 2.1/);
  });
});
