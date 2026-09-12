/**
 * Deterministic, application-owned dispatch (SOW s2, s5.3, s6).
 *
 * This module intentionally does not import private truth or a provider. All
 * ranking inputs are public operational facts held in RoomState. A provider
 * can later rank the bounded `Recommendation` packet, but may never mutate
 * state or supply candidates.
 */

import type {
  Issue,
  Offer,
  Responder,
  RoomState,
  Station,
} from './types.js';

const MAX_CANDIDATES = 12;
const TRAVEL_UNITS_PER_MINUTE = 80;

export class DispatchConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DispatchConflictError';
  }
}

export class DispatchValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DispatchValidationError';
  }
}

export interface CandidatePacket {
  responderId: string;
  displayName: string;
  distance: number;
  travelMinutes: number;
  sameClassObservedCount: number;
  observedMedianMinutes: null;
  successRate: null;
  reopenRate: null;
  evidenceStrength: 'NONE';
}

export interface Recommendation {
  source: 'DETERMINISTIC_FALLBACK';
  issueId: string;
  candidates: CandidatePacket[];
  winnerId: string;
  meaningfulAlternativeId: string | null;
  nearestAvailableWinnerId: string;
  naiveWeightedWinnerId: string;
}

const BAND_RANK = { CRITICAL: 0, HIGH: 1, STANDARD: 2 } as const;

/** Select one actionable issue deterministically; reopened work re-enters the same queue. */
export function selectNextIssue(state: RoomState): Issue | undefined {
  return state.issues
    .filter((issue) => issue.status === 'PENDING' || issue.status === 'REOPENED')
    .sort((left, right) => {
      const band = BAND_RANK[left.priority.band] - BAND_RANK[right.priority.band];
      if (band !== 0) return band;
      const score = right.priority.score - left.priority.score;
      if (score !== 0) return score;
      const raised = Date.parse(left.raisedAt) - Date.parse(right.raisedAt);
      if (raised !== 0) return raised;
      return left.id.localeCompare(right.id);
    })[0];
}

/**
 * Builds the bounded candidate packet from currently available responders.
 * Outcome fields are intentionally `null`/zero until the outcome lane records
 * observed cases; no hidden truth is substituted for missing history.
 */
export function buildRecommendation(state: RoomState, issue: Issue): Recommendation {
  const station = requireStation(state, issue.stationId);
  const candidates = state.responders
    .filter(isEligible)
    .map((responder) => candidatePacket(responder, station))
    .sort(compareNearest)
    .slice(0, MAX_CANDIDATES);

  if (candidates.length === 0) {
    throw new DispatchConflictError('No eligible responder is currently available.');
  }

  // The first slice has no observed outcomes. The documented naive comparator
  // therefore uses travel only, with neutral values for unavailable metrics.
  const naive = [...candidates].sort(compareNaiveWeighted);
  const winner = candidates[0] as CandidatePacket;
  return {
    source: 'DETERMINISTIC_FALLBACK',
    issueId: issue.id,
    candidates,
    winnerId: winner.responderId,
    meaningfulAlternativeId: (candidates[1] ?? null)?.responderId ?? null,
    nearestAvailableWinnerId: winner.responderId,
    naiveWeightedWinnerId: (naive[0] as CandidatePacket).responderId,
  };
}

export function createNextOffer(state: RoomState): { offer: Offer; recommendation: Recommendation } {
  const issue = selectNextIssue(state);
  if (issue === undefined) {
    throw new DispatchConflictError('No pending actionable issue is available for dispatch.');
  }
  const recommendation = buildRecommendation(state, issue);
  const offer = createOffer(state, issue, recommendation.winnerId, recommendation.candidates.map((candidate) => candidate.responderId));
  appendDispatchRecord(state, 'OFFER_CREATED', issue, offer, {
    decisionSource: recommendation.source,
    baselineWinnerId: recommendation.naiveWeightedWinnerId,
    alternativeResponderId: recommendation.meaningfulAlternativeId ?? 'NONE',
  });
  return { offer, recommendation };
}

export function acceptOffer(state: RoomState, offerId: string): Offer {
  const { offer, issue, responder } = requirePendingOffer(state, offerId);
  if (!isEligibleForPendingOffer(state, responder, offer)) {
    throw new DispatchConflictError('The offered responder is no longer eligible.');
  }
  if (state.assignments.some((assignment) => assignment.issueId === issue.id && assignment.status === 'ACTIVE')) {
    throw new DispatchConflictError('This issue already has an active assignment.');
  }

  offer.status = 'ACCEPTED';
  const assignmentId = `${state.roomId}-asn-${String(state.assignments.length + 1).padStart(3, '0')}`;
  state.assignments.push({
    id: assignmentId,
    issueId: issue.id,
    responderId: responder.id,
    role: 'PRIMARY',
    status: 'ACTIVE',
    createdAt: state.simulatedAt,
  });
  responder.dutyStatus = 'ASSIGNED';
  responder.assignmentId = assignmentId;
  const station = requireStation(state, issue.stationId);
  responder.publicLocation = { floorId: station.floorId, x: station.x, y: station.y };
  issue.status = 'ASSIGNED';

  appendDispatchRecord(state, 'OFFER_ACCEPTED', issue, offer, { assignmentId });
  appendEvent(state, 'RESPONDER_MOVED', {
    responderId: responder.id,
    stationId: station.id,
    reason: 'ASSIGNMENT',
  });
  return offer;
}

/** Rejecting an offer advances once through its persisted sequence, or returns work to pending. */
export function rejectOffer(state: RoomState, offerId: string): { offer: Offer; nextOffer: Offer | null } {
  const { offer, issue, responder } = requirePendingOffer(state, offerId);
  offer.status = 'REJECTED';
  responder.dutyStatus = 'AVAILABLE';
  appendDispatchRecord(state, 'OFFER_REJECTED', issue, offer, {});

  // A rejection advances through this issue's sequence exactly once. A
  // responder becomes AVAILABLE again but must not be silently re-offered for
  // the same issue when a later candidate rejects.
  const attemptedResponderIds = new Set(
    state.offers
      .filter((candidate) => candidate.issueId === issue.id && candidate.status === 'REJECTED')
      .map((candidate) => candidate.responderId),
  );
  const nextResponderId = offer.rankedCandidateIds.find((candidateId) =>
    !attemptedResponderIds.has(candidateId) && isResponderEligible(state, candidateId),
  );
  if (nextResponderId === undefined) {
    issue.status = 'PENDING';
    appendEvent(state, 'DISPATCH_EXHAUSTED', { issueId: issue.id });
    state.audits.push(audit(state, 'SYSTEM', 'DISPATCH_EXHAUSTED', issue.id, `No eligible responder remained for issue ${issue.id}; it returned to the pending queue.`));
    return { offer, nextOffer: null };
  }

  const nextOffer = createOffer(state, issue, nextResponderId, offer.rankedCandidateIds);
  appendDispatchRecord(state, 'OFFER_CREATED', issue, nextOffer, {
    decisionSource: 'DETERMINISTIC_FALLBACK',
    previousOfferId: offer.id,
  });
  return { offer, nextOffer };
}

/** Replace a pending offer only with another responder who is eligible now. */
export function overrideOffer(
  state: RoomState,
  offerId: string,
  responderId: string,
): { withdrawnOffer: Offer; offer: Offer; recommendation: Recommendation } {
  const { offer: withdrawnOffer, issue, responder: offeredResponder } = requirePendingOffer(state, offerId);
  if (responderId === offeredResponder.id) {
    throw new DispatchValidationError('Override responder must differ from the currently offered responder.');
  }
  if (!isResponderEligible(state, responderId)) {
    throw new DispatchConflictError('Override responder is not currently eligible.');
  }

  withdrawnOffer.status = 'WITHDRAWN';
  offeredResponder.dutyStatus = 'AVAILABLE';
  appendDispatchRecord(state, 'OFFER_WITHDRAWN', issue, withdrawnOffer, { reason: 'OPERATOR_OVERRIDE' });

  const recommendation = buildRecommendation(state, issue);
  // `responderId` has been eligibility-checked above and stays first; the
  // rest of the packet is retained for an auditable bounded sequence.
  const ranking = [
    responderId,
    ...recommendation.candidates.map((candidate) => candidate.responderId).filter((id) => id !== responderId),
  ];
  const offer = createOffer(state, issue, responderId, ranking);
  appendDispatchRecord(state, 'OFFER_CREATED', issue, offer, {
    decisionSource: 'OPERATOR_OVERRIDE',
    replacedOfferId: withdrawnOffer.id,
    baselineWinnerId: recommendation.naiveWeightedWinnerId,
  });
  return { withdrawnOffer, offer, recommendation };
}

function createOffer(state: RoomState, issue: Issue, responderId: string, rankedCandidateIds: string[]): Offer {
  const responder = requireResponder(state, responderId);
  if (!isEligible(responder)) {
    throw new DispatchConflictError('Selected responder is not currently available.');
  }
  const offer: Offer = {
    id: `${state.roomId}-ofr-${String(state.offers.length + 1).padStart(3, '0')}`,
    issueId: issue.id,
    responderId,
    status: 'PENDING',
    createdAt: state.simulatedAt,
    rankedCandidateIds: [...rankedCandidateIds],
  };
  state.offers.push(offer);
  issue.status = 'OFFER_PENDING';
  responder.dutyStatus = 'OFFERED';
  return offer;
}

function requirePendingOffer(state: RoomState, offerId: string): { offer: Offer; issue: Issue; responder: Responder } {
  const offer = state.offers.find((candidate) => candidate.id === offerId);
  if (offer === undefined) throw new DispatchValidationError('Unknown offer.');
  if (offer.status !== 'PENDING') throw new DispatchConflictError('Offer is no longer pending.');
  const issue = state.issues.find((candidate) => candidate.id === offer.issueId);
  if (issue === undefined || issue.status !== 'OFFER_PENDING') {
    throw new DispatchConflictError('Offer no longer has actionable pending work.');
  }
  return { offer, issue, responder: requireResponder(state, offer.responderId) };
}

function requireResponder(state: RoomState, responderId: string): Responder {
  const responder = state.responders.find((candidate) => candidate.id === responderId);
  if (responder === undefined) throw new DispatchValidationError('Unknown responder.');
  return responder;
}

function requireStation(state: RoomState, stationId: string): Station {
  const station = state.stations.find((candidate) => candidate.id === stationId);
  if (station === undefined) throw new DispatchValidationError('Issue references an unknown station.');
  return station;
}

function isEligible(responder: Responder): boolean {
  return responder.dutyStatus === 'AVAILABLE' && responder.assignmentId === undefined;
}

function isResponderEligible(state: RoomState, responderId: string): boolean {
  const responder = state.responders.find((candidate) => candidate.id === responderId);
  return responder !== undefined && isEligible(responder);
}

function isEligibleForPendingOffer(state: RoomState, responder: Responder, offer: Offer): boolean {
  return responder.dutyStatus === 'OFFERED'
    && responder.assignmentId === undefined
    && !state.assignments.some((assignment) => assignment.responderId === responder.id && assignment.status === 'ACTIVE')
    && offer.responderId === responder.id;
}

function candidatePacket(responder: Responder, station: Station): CandidatePacket {
  const distance = Math.round(Math.hypot(responder.publicLocation.x - station.x, responder.publicLocation.y - station.y) * 100) / 100;
  return {
    responderId: responder.id,
    displayName: responder.displayName,
    distance,
    travelMinutes: Math.max(1, Math.ceil(distance / TRAVEL_UNITS_PER_MINUTE)),
    sameClassObservedCount: 0,
    observedMedianMinutes: null,
    successRate: null,
    reopenRate: null,
    evidenceStrength: 'NONE',
  };
}

function compareNearest(left: CandidatePacket, right: CandidatePacket): number {
  return left.travelMinutes - right.travelMinutes || left.distance - right.distance || left.responderId.localeCompare(right.responderId);
}

function compareNaiveWeighted(left: CandidatePacket, right: CandidatePacket): number {
  // Documented baseline: 1× travel + neutral 0 contributions for unavailable
  // observed median/success data. It becomes richer only when observed data is
  // added; it must never draw on hidden skill.
  const score = (candidate: CandidatePacket) => candidate.travelMinutes;
  return score(left) - score(right) || left.responderId.localeCompare(right.responderId);
}

function appendDispatchRecord(
  state: RoomState,
  type: string,
  issue: Issue,
  offer: Offer,
  extra: Record<string, string | number | boolean>,
): void {
  appendEvent(state, type, { issueId: issue.id, offerId: offer.id, responderId: offer.responderId, ...extra });
  state.audits.push(audit(state, 'OPERATOR', type, issue.id, `${type} for issue ${issue.id} and responder ${offer.responderId}.`));
}

function appendEvent(state: RoomState, type: string, payload: Record<string, string | number | boolean>): void {
  state.events.push({
    id: `${state.roomId}-evt-${String(state.events.length + 1).padStart(3, '0')}`,
    type,
    occurredAt: state.simulatedAt,
    publicPayload: payload,
  });
}

function audit(state: RoomState, actor: string, action: string, issueId: string, summary: string) {
  return {
    id: `${state.roomId}-aud-${String(state.audits.length + 1).padStart(3, '0')}`,
    occurredAt: state.simulatedAt,
    actor,
    action,
    issueId,
    summary,
  };
}
