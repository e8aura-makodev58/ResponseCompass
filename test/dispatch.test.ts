import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { getJson, makeDataRoot, postJson, removeDataRoot, startApp, type TestApp } from './helpers.js';

describe('deterministic dispatch offers', () => {
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

  async function room() {
    return getJson(`${app.baseUrl}/api/rooms/plant-1`);
  }

  it('creates one deterministic, bounded public-safe offer for the next issue', async () => {
    const before = await room();
    const created = await postJson(`${app.baseUrl}/api/rooms/plant-1/offers`, {
      expectedRevision: before.body.room.revision,
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.recommendation.source, 'DETERMINISTIC_FALLBACK');
    assert.ok(created.body.recommendation.candidates.length > 0);
    assert.ok(created.body.recommendation.candidates.length <= 12);
    assert.equal(created.body.offer.responderId, created.body.recommendation.winnerId);
    assert.equal('rankedCandidateIds' in created.body.offer, false, 'persisted offer queue stays server-side');
    assert.equal(created.body.room.issues.find((issue: any) => issue.id === created.body.offer.issueId).status, 'OFFER_PENDING');
    assert.equal(created.body.room.responders.find((responder: any) => responder.id === created.body.offer.responderId).dutyStatus, 'OFFERED');
    assert.equal(JSON.stringify(created.body.recommendation).includes('trueMedian'), false);
    assert.equal(JSON.stringify(created.body.recommendation).includes('publicLocation'), false);
    assert.equal(JSON.stringify(created.body.recommendation).includes('assignmentId'), false);
  });

  it('accepts an offer atomically and records assignment and movement', async () => {
    const current = await room();
    const pending = current.body.room.offers.find((offer: any) => offer.status === 'PENDING');
    const accepted = await postJson(`${app.baseUrl}/api/rooms/plant-1/offers/${pending.id}/accept`, {
      expectedRevision: current.body.room.revision,
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.offer.status, 'ACCEPTED');
    assert.equal(accepted.body.room.issues.find((issue: any) => issue.id === pending.issueId).status, 'ASSIGNED');
    assert.equal(accepted.body.room.assignments.filter((assignment: any) => assignment.issueId === pending.issueId && assignment.status === 'ACTIVE').length, 1);
    assert.ok(accepted.body.room.events.some((event: any) => event.type === 'RESPONDER_MOVED'));
  });

  it('rejects an offer and advances to the next eligible ranked responder', async () => {
    const before = await room();
    const created = await postJson(`${app.baseUrl}/api/rooms/plant-1/offers`, { expectedRevision: before.body.room.revision });
    assert.equal(created.status, 201);
    const rejected = await postJson(`${app.baseUrl}/api/rooms/plant-1/offers/${created.body.offer.id}/reject`, {
      expectedRevision: created.body.room.revision,
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.offer.status, 'REJECTED');
    assert.ok(rejected.body.nextOffer, 'an available next candidate should receive an offer');
    assert.notEqual(rejected.body.nextOffer.responderId, created.body.offer.responderId);

    const rejectedAgain = await postJson(`${app.baseUrl}/api/rooms/plant-1/offers/${rejected.body.nextOffer.id}/reject`, {
      expectedRevision: rejected.body.room.revision,
    });
    assert.equal(rejectedAgain.status, 200);
    assert.notEqual(rejectedAgain.body.nextOffer.responderId, created.body.offer.responderId, 'a rejection must not cycle back to an earlier candidate');
  });

  it('permits an operator override only for another currently eligible responder', async () => {
    const current = await room();
    const pending = current.body.room.offers.find((offer: any) => offer.status === 'PENDING');
    const replacement = current.body.room.responders.find((responder: any) => responder.dutyStatus === 'AVAILABLE');
    const overridden = await postJson(`${app.baseUrl}/api/rooms/plant-1/offers/${pending.id}/override`, {
      expectedRevision: current.body.room.revision,
      responderId: replacement.id,
    });
    assert.equal(overridden.status, 200);
    assert.equal(overridden.body.offer.responderId, replacement.id);
    assert.equal(overridden.body.room.offers.find((offer: any) => offer.id === pending.id).status, 'WITHDRAWN');

    const stale = await postJson(`${app.baseUrl}/api/rooms/plant-1/offers/${overridden.body.offer.id}/accept`, {
      expectedRevision: current.body.room.revision,
    });
    assert.equal(stale.status, 409);
  });
});
