import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { acceptOffer, createNextOffer } from '../src/domain/dispatch.js';
import { resolveAssignment } from '../src/domain/lifecycle.js';
import { seedRoom } from '../src/seed/seed.js';
import { getJson, makeDataRoot, postJson, removeDataRoot, startApp, type TestApp } from './helpers.js';

describe('simulation clock and issue lifecycle', () => {
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

  async function room(roomId = 'plant-1') {
    return getJson(`${app.baseUrl}/api/rooms/${roomId}`);
  }

  // ── Clock: pause / resume ──────────────────────────────────────────────────

  it('resumes a paused room and emits a CLOCK_RESUMED event', async () => {
    const before = await room();
    assert.equal(before.body.room.clockState, 'PAUSED', 'seed starts PAUSED');

    const resumed = await postJson(`${app.baseUrl}/api/rooms/plant-1/resume`, {
      expectedRevision: before.body.room.revision,
    });
    assert.equal(resumed.status, 200);
    assert.equal(resumed.body.room.clockState, 'RUNNING');
    assert.ok(resumed.body.room.events.some((e: any) => e.type === 'CLOCK_RESUMED'));
    assert.ok(resumed.body.room.audits.some((a: any) => a.action === 'CLOCK_RESUMED'));
  });

  it('rejects resume on an already-running room with 409', async () => {
    const current = await room();
    assert.equal(current.body.room.clockState, 'RUNNING');

    const second = await postJson(`${app.baseUrl}/api/rooms/plant-1/resume`, {
      expectedRevision: current.body.room.revision,
    });
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'CONFLICT');
  });

  it('pauses a running room and emits a CLOCK_PAUSED event', async () => {
    const current = await room();
    assert.equal(current.body.room.clockState, 'RUNNING');

    const paused = await postJson(`${app.baseUrl}/api/rooms/plant-1/pause`, {
      expectedRevision: current.body.room.revision,
    });
    assert.equal(paused.status, 200);
    assert.equal(paused.body.room.clockState, 'PAUSED');
    assert.ok(paused.body.room.events.some((e: any) => e.type === 'CLOCK_PAUSED'));
    assert.ok(paused.body.room.audits.some((a: any) => a.action === 'CLOCK_PAUSED'));
  });

  it('rejects pause on an already-paused room with 409', async () => {
    const current = await room();
    assert.equal(current.body.room.clockState, 'PAUSED');

    const second = await postJson(`${app.baseUrl}/api/rooms/plant-1/pause`, {
      expectedRevision: current.body.room.revision,
    });
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'CONFLICT');
  });

  it('rejects stale revision on pause and resume', async () => {
    const current = await room();
    const staleRevision = current.body.room.revision - 1;

    const stale1 = await postJson(`${app.baseUrl}/api/rooms/plant-1/pause`, { expectedRevision: staleRevision });
    assert.equal(stale1.status, 409);
    assert.equal(stale1.body.error.code, 'STALE_REVISION');

    const stale2 = await postJson(`${app.baseUrl}/api/rooms/plant-1/resume`, { expectedRevision: staleRevision });
    assert.equal(stale2.status, 409);
    assert.equal(stale2.body.error.code, 'STALE_REVISION');
  });

  // ── Trigger next event ─────────────────────────────────────────────────────

  it('trigger advances simulatedAt and emits TICK_ADVANCED', async () => {
    const before = await room('plant-2');
    const prevTime = before.body.room.simulatedAt;

    const triggered = await postJson(`${app.baseUrl}/api/rooms/plant-2/trigger`, {
      expectedRevision: before.body.room.revision,
    });
    assert.equal(triggered.status, 200);
    assert.ok(
      Date.parse(triggered.body.room.simulatedAt) > Date.parse(prevTime),
      'simulatedAt must advance',
    );
    assert.ok(triggered.body.room.events.some((e: any) => e.type === 'TICK_ADVANCED'));
  });

  it('trigger generates a new PENDING issue on a free station', async () => {
    const before = await room('plant-2');
    const issueBefore = before.body.room.issues.length;

    const triggered = await postJson(`${app.baseUrl}/api/rooms/plant-2/trigger`, {
      expectedRevision: before.body.room.revision,
    });
    assert.equal(triggered.status, 200);
    assert.ok(triggered.body.room.issues.length >= issueBefore, 'issue count must not decrease');
    assert.ok(triggered.body.room.events.some((e: any) => e.type === 'ISSUE_TRIGGERED'));
    const newIssue = triggered.body.room.issues.find((i: any) => i.status === 'PENDING' && i.raisedAt === triggered.body.room.simulatedAt);
    assert.ok(newIssue, 'a PENDING issue should exist at the new simulatedAt');
    const newStation = triggered.body.room.stations.find((s: any) => s.id === newIssue?.stationId);
    assert.equal(newStation?.status, 'ISSUE_ACTIVE');
  });

  it('trigger with stale revision returns 409 and does not advance time', async () => {
    const current = await room('plant-1');
    const timeBefore = current.body.room.simulatedAt;

    const stale = await postJson(`${app.baseUrl}/api/rooms/plant-1/trigger`, {
      expectedRevision: current.body.room.revision - 1,
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'STALE_REVISION');

    const after = await room('plant-1');
    assert.equal(after.body.room.simulatedAt, timeBefore, 'simulatedAt must not change on a stale trigger');
  });

  it('simulated time and RNG cursor survive a server restart', async () => {
    const triggered = await postJson(`${app.baseUrl}/api/rooms/plant-1/trigger`, {
      expectedRevision: (await room('plant-1')).body.room.revision,
    });
    const timeAfterTrigger = triggered.body.room.simulatedAt;

    await app.close();
    app = await startApp(dataRoot);

    const reloaded = await room('plant-1');
    assert.equal(reloaded.body.room.simulatedAt, timeAfterTrigger, 'simulatedAt must persist across restart');
  });

  it('two rooms are isolated: trigger on plant-1 does not change plant-2', async () => {
    const p2before = await room('plant-2');

    await postJson(`${app.baseUrl}/api/rooms/plant-1/trigger`, {
      expectedRevision: (await room('plant-1')).body.room.revision,
    });

    const p2after = await room('plant-2');
    assert.equal(p2after.body.room.simulatedAt, p2before.body.room.simulatedAt);
    assert.equal(p2after.body.room.revision, p2before.body.room.revision);
  });

  // ── Assignment resolution ──────────────────────────────────────────────────

  it('forces one deterministic outcome through the normal resolution engine', async () => {
    // Set up: create an offer and accept it to get an active assignment.
    const r0 = await room('plant-1');
    const offered = await postJson(`${app.baseUrl}/api/rooms/plant-1/offers`, {
      expectedRevision: r0.body.room.revision,
    });
    assert.equal(offered.status, 201);

    const accepted = await postJson(
      `${app.baseUrl}/api/rooms/plant-1/offers/${offered.body.offer.id}/accept`,
      { expectedRevision: offered.body.room.revision },
    );
    assert.equal(accepted.status, 200);
    const assignmentId = accepted.body.room.assignments.find((a: any) => a.status === 'ACTIVE')?.id;
    assert.ok(assignmentId, 'an active assignment must exist after accept');

    const resolved = await postJson(
      `${app.baseUrl}/api/rooms/plant-1/assignments/${assignmentId}/resolve`,
      { expectedRevision: accepted.body.room.revision },
    );
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.assignment.status, 'RELEASED');
    assert.ok(resolved.body.assignment.releasedAt);
    assert.ok(['RESOLVED', 'REOPENED'].includes(resolved.body.outcome.status));
    assert.equal(resolved.body.outcome.assignmentId, assignmentId);
    assert.ok(resolved.body.outcome.durationMinutes > 0);
    assert.doesNotMatch(
      JSON.stringify(resolved.body),
      /trueMedianMinutes|trueSuccessProbability|randomStream|skills/,
    );

    const resolvedIssue = resolved.body.room.issues.find((i: any) => i.id === accepted.body.offer.issueId);
    assert.equal(resolvedIssue?.status, resolved.body.outcome.status);
    if (resolved.body.outcome.success) assert.ok(resolvedIssue?.resolvedAt);
    else assert.equal(resolvedIssue?.resolvedAt, null);

    const responderAfter = resolved.body.room.responders.find((r: any) => r.id === accepted.body.offer.responderId);
    assert.equal(responderAfter?.dutyStatus, 'AVAILABLE');
    assert.equal(responderAfter?.assignmentId, null);

    const stationAfter = resolved.body.room.stations.find((s: any) => s.id === resolvedIssue?.stationId);
    // Station is NORMAL if no other active issues remain.
    assert.ok(['NORMAL', 'ISSUE_ACTIVE'].includes(stationAfter?.status));

    assert.ok(resolved.body.room.events.some((e: any) => e.type === 'RESOLUTION_ATTEMPT_COMPLETED'));
    assert.ok(resolved.body.room.events.some((e: any) => e.type === `ISSUE_${resolved.body.outcome.status}`));
    assert.ok(resolved.body.room.audits.some((a: any) => a.action === `ISSUE_${resolved.body.outcome.status}`));
  });

  it('resolving an already-released assignment returns 409', async () => {
    const current = await room('plant-1');
    const released = current.body.room.assignments.find((a: any) => a.status === 'RELEASED');
    assert.ok(released, 'the preceding resolution must leave a released assignment');

    const r = await postJson(
      `${app.baseUrl}/api/rooms/plant-1/assignments/${released.id}/resolve`,
      { expectedRevision: current.body.room.revision },
    );
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'CONFLICT');
  });

  it('resolving an unknown assignment id returns 400', async () => {
    const current = await room('plant-1');
    const r = await postJson(
      `${app.baseUrl}/api/rooms/plant-1/assignments/plant-1-asn-999/resolve`,
      { expectedRevision: current.body.room.revision },
    );
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'VALIDATION_FAILED');
  });

  it('resolve with stale revision returns 409 and leaves state unchanged', async () => {
    const beforeOffer = await room('plant-1');
    const offered = await postJson(`${app.baseUrl}/api/rooms/plant-1/offers`, {
      expectedRevision: beforeOffer.body.room.revision,
    });
    assert.equal(offered.status, 201);
    const current = await postJson(
      `${app.baseUrl}/api/rooms/plant-1/offers/${offered.body.offer.id}/accept`,
      { expectedRevision: offered.body.room.revision },
    );
    assert.equal(current.status, 200);
    const active = current.body.room.assignments.find((a: any) => a.status === 'ACTIVE');
    assert.ok(active, 'test setup must create an active assignment');

    const r = await postJson(
      `${app.baseUrl}/api/rooms/plant-1/assignments/${active.id}/resolve`,
      { expectedRevision: current.body.room.revision - 1 },
    );
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'STALE_REVISION');

    const after = await room('plant-1');
    assert.equal(after.body.room.revision, current.body.room.revision, 'revision must not advance on stale resolve');
  });
});

describe('deterministic resolution outcomes', () => {
  function assignedRoom(roomId: string, successProbability: number) {
    const seeded = seedRoom({
      roomId,
      displayName: roomId,
      openIssueStations: [0],
    });
    const created = createNextOffer(seeded.state);
    acceptOffer(seeded.state, created.offer.id);
    const assignment = seeded.state.assignments.find((candidate) => candidate.status === 'ACTIVE');
    assert.ok(assignment);
    const issue = seeded.state.issues.find((candidate) => candidate.id === assignment.issueId);
    assert.ok(issue);
    const skill = seeded.hidden.skills[assignment.responderId]?.[issue.class];
    assert.ok(skill);
    skill.trueSuccessProbability = successProbability;
    return { ...seeded, assignment, issue, originalRaisedAt: issue.raisedAt };
  }

  it('records a successful observed outcome without exposing hidden probability', () => {
    const seeded = assignedRoom('outcome-success', 1);
    const cursorBefore = seeded.hidden.randomStream.cursor;
    const result = resolveAssignment(seeded.state, seeded.hidden, seeded.assignment.id);

    assert.equal(result.outcome.status, 'RESOLVED');
    assert.equal(result.outcome.success, true);
    assert.equal(seeded.issue.status, 'RESOLVED');
    assert.equal(seeded.hidden.randomStream.cursor, cursorBefore + 2);
    assert.ok(!JSON.stringify(result.outcome).includes('trueSuccessProbability'));
  });

  it('reopens a failed attempt with original downtime and returns it to dispatch', () => {
    const seeded = assignedRoom('outcome-failure', 0);
    const result = resolveAssignment(seeded.state, seeded.hidden, seeded.assignment.id);

    assert.equal(result.outcome.status, 'REOPENED');
    assert.equal(result.outcome.success, false);
    assert.equal(seeded.issue.status, 'REOPENED');
    assert.equal(seeded.issue.raisedAt, seeded.originalRaisedAt);
    assert.equal(seeded.issue.resolvedAt, undefined);
    assert.equal(
      seeded.state.stations.find((station) => station.id === seeded.issue.stationId)?.status,
      'ISSUE_ACTIVE',
    );

    const retry = createNextOffer(seeded.state);
    assert.equal(retry.offer.issueId, seeded.issue.id);
    assert.equal(seeded.issue.status, 'OFFER_PENDING');
  });
});
