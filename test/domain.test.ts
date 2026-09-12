import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { computePriority } from '../src/domain/priority.js';
import { draw, RandomStream } from '../src/seed/rng.js';
import { DEFAULT_ROOM_SPECS, seedRoom } from '../src/seed/seed.js';

describe('deterministic random stream', () => {
  it('returns the same draw for the same seed and cursor', () => {
    assert.equal(draw('plant-1:seed', 7), draw('plant-1:seed', 7));
    assert.notEqual(draw('plant-1:seed', 7), draw('plant-2:seed', 7));
  });

  it('advances a persistable cursor rather than hiding generator state', () => {
    const stream = new RandomStream('room:outcomes');
    stream.next();
    stream.next();
    assert.equal(stream.position, 2);
    assert.equal(new RandomStream('room:outcomes', 2).next(), stream.next());
  });
});

describe('priority', () => {
  it('uses only deterministic issue facts', () => {
    const facts = { riskImpact: 6, complexity: 3, raisedAt: '2026-09-12T07:00:00.000Z' };
    const a = computePriority(facts, '2026-09-12T08:00:00.000Z');
    const b = computePriority(facts, '2026-09-12T08:00:00.000Z');
    assert.deepEqual(a, b);
  });

  it('ages queued work upward so it cannot starve', () => {
    const facts = { riskImpact: 4, complexity: 2, raisedAt: '2026-09-12T00:00:00.000Z' };
    const fresh = computePriority(facts, '2026-09-12T00:00:00.000Z');
    const aged = computePriority(facts, '2026-09-12T09:00:00.000Z');
    assert.ok(aged.score > fresh.score);
  });

  it('never demotes critical-impact work below lower-impact work', () => {
    const critical = computePriority(
      { riskImpact: 9, complexity: 1, raisedAt: '2026-09-12T08:00:00.000Z' },
      '2026-09-12T08:00:00.000Z',
    );
    const agedStandard = computePriority(
      { riskImpact: 2, complexity: 5, raisedAt: '2026-09-10T08:00:00.000Z' },
      '2026-09-12T08:00:00.000Z',
    );
    assert.equal(critical.band, 'CRITICAL');
    assert.notEqual(agedStandard.band, 'CRITICAL');
  });
});

describe('seed shape', () => {
  it('seeds four six-person crews with the documented naming convention', () => {
    for (const spec of DEFAULT_ROOM_SPECS) {
      const { state } = seedRoom(spec);
      assert.equal(state.responders.length, 24);
      assert.equal(
        state.responders.filter((r) => r.dutyStatus === 'AVAILABLE').length,
        6,
        'exactly one six-person crew is on duty',
      );
      for (const responder of state.responders) {
        assert.match(responder.displayName, /^(Engr|Tech|Optr)\d{3}$/);
      }
    }
  });

  it('marks a station with an open issue as ISSUE_ACTIVE', () => {
    const { state } = seedRoom(DEFAULT_ROOM_SPECS[0]!);
    for (const issue of state.issues) {
      const station = state.stations.find((s) => s.id === issue.stationId);
      assert.equal(station?.status, 'ISSUE_ACTIVE');
    }
    assert.equal(
      state.stations.filter((s) => s.status === 'ISSUE_ACTIVE').length,
      state.issues.length,
      'no station is marked active without an issue',
    );
  });

  it('provisions hidden skill for every responder and issue class', () => {
    const { state, hidden } = seedRoom(DEFAULT_ROOM_SPECS[0]!);
    assert.equal(Object.keys(hidden.skills).length, state.responders.length);
    for (const responder of state.responders) {
      const perClass = hidden.skills[responder.id];
      assert.ok(perClass);
      assert.equal(Object.keys(perClass).length, 5);
    }
  });
});
