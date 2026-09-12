import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';

import { projectRoomState } from '../src/domain/projection.js';
import { seedRoom, DEFAULT_ROOM_SPECS } from '../src/seed/seed.js';
import { DataPaths } from '../src/store/paths.js';
import { getJson, makeDataRoot, removeDataRoot, startApp, type TestApp } from './helpers.js';

/**
 * Hidden-skill redaction is asserted for every room and public endpoint
 * (SOW s11). These tests search the serialized payload for the *values* as
 * well as the field names, so a rename of the hidden field cannot slip past.
 */
describe('public projection redacts hidden truth', () => {
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

  it('never emits hidden skill field names on any room endpoint', async () => {
    const forbidden = [
      'ResponderSkill',
      'trueMedianMinutes',
      'trueSuccessProbability',
      'randomStream',
      'riskImpact',
      'complexity',
      'rankedCandidateIds',
      'dutyStationId',
    ];

    for (const spec of DEFAULT_ROOM_SPECS) {
      const { status, body } = await getJson(`${app.baseUrl}/api/rooms/${spec.roomId}`);
      assert.equal(status, 200);
      const serialized = JSON.stringify(body);
      for (const field of forbidden) {
        assert.ok(
          !serialized.includes(field),
          `${spec.roomId} response leaked field "${field}"`,
        );
      }
    }
  });

  it('never emits a hidden skill value, even coincidentally', async () => {
    const paths = new DataPaths(dataRoot);
    for (const spec of DEFAULT_ROOM_SPECS) {
      const hidden = JSON.parse(
        await readFile(paths.roomHiddenFile(spec.roomId), 'utf8'),
      ) as { skills: Record<string, Record<string, { trueSuccessProbability: number }>> };

      const { body } = await getJson(`${app.baseUrl}/api/rooms/${spec.roomId}`);
      const serialized = JSON.stringify(body);

      for (const perClass of Object.values(hidden.skills)) {
        for (const skill of Object.values(perClass)) {
          // Probabilities are three-decimal values; a bare integer median could
          // collide with an unrelated number, so assert on the distinctive one.
          assert.ok(
            !serialized.includes(String(skill.trueSuccessProbability)),
            `${spec.roomId} response contained a hidden success probability`,
          );
        }
      }
    }
  });

  it('drops non-scalar event payload values rather than serializing them', () => {
    const { state } = seedRoom({
      roomId: 'plant-1',
      displayName: 'Plant #1',
      openIssueStations: [1],
    });
    state.events.push({
      id: 'evt-x',
      type: 'TEST',
      occurredAt: state.simulatedAt,
      publicPayload: {
        keep: 'visible',
        // An internal object smuggled onto a payload must not reach a browser.
        leak: { secret: 'nested' } as unknown as string,
      },
    });

    const projected = projectRoomState(state);
    const event = projected.events.find((candidate) => candidate.id === 'evt-x');
    assert.ok(event);
    assert.equal(event.publicPayload['keep'], 'visible');
    assert.equal(event.publicPayload['leak'], undefined);
  });

  it('keeps hidden truth out of the room state file itself', async () => {
    const paths = new DataPaths(dataRoot);
    for (const spec of DEFAULT_ROOM_SPECS) {
      const stateFile = await readFile(paths.roomStateFile(spec.roomId), 'utf8');
      assert.ok(!stateFile.includes('trueSuccessProbability'));
      assert.ok(!stateFile.includes('trueMedianMinutes'));
    }
  });
});
