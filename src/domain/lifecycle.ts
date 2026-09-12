/**
 * Deterministic issue-resolution lifecycle.
 *
 * Force Resolve bypasses waiting only. It still consumes the room's persisted
 * hidden random stream and responder/issue-class skill to determine the same
 * bounded duration and success/failure outcome as a scheduled resolution.
 */
import { DispatchConflictError, DispatchValidationError } from './dispatch.js';
import type { HiddenRoomTruth } from './private.js';
import type { Assignment, Issue, RoomState } from './types.js';
import { RandomStream } from '../seed/rng.js';

const MIN_DURATION_FACTOR = 0.75;
const MAX_DURATION_FACTOR = 1.25;

export interface ResolutionOutcome {
  issueId: string;
  assignmentId: string;
  responderId: string;
  status: 'RESOLVED' | 'REOPENED';
  success: boolean;
  durationMinutes: number;
  attemptNumber: number;
}

export function resolveAssignment(
  state: RoomState,
  hidden: HiddenRoomTruth,
  assignmentId: string,
): { assignment: Assignment; outcome: ResolutionOutcome } {
  const assignment = state.assignments.find((candidate) => candidate.id === assignmentId);
  if (assignment === undefined) throw new DispatchValidationError('Unknown assignment.');
  if (assignment.status !== 'ACTIVE') throw new DispatchConflictError('Assignment is not active.');

  const issue = state.issues.find((candidate) => candidate.id === assignment.issueId);
  if (issue === undefined || issue.status !== 'ASSIGNED') {
    throw new DispatchConflictError('Assignment does not reference an ASSIGNED issue.');
  }

  const responder = state.responders.find((candidate) => candidate.id === assignment.responderId);
  if (responder === undefined) throw new DispatchValidationError('Assignment references an unknown responder.');
  const skill = hidden.skills[responder.id]?.[issue.class];
  if (skill === undefined) {
    throw new DispatchValidationError('Assignment has no outcome model for this responder and issue class.');
  }

  const rng = new RandomStream(hidden.randomStream.seed, hidden.randomStream.cursor);
  const durationFactor = rng.float(MIN_DURATION_FACTOR, MAX_DURATION_FACTOR);
  const durationMinutes = Math.max(1, Math.round(skill.trueMedianMinutes * durationFactor));
  const success = rng.next() < skill.trueSuccessProbability;
  hidden.randomStream.cursor = rng.position;

  assignment.status = 'RELEASED';
  assignment.releasedAt = state.simulatedAt;
  releaseResponder(state, responder.id);

  const attemptNumber = state.events.filter(
    (event) =>
      event.type === 'RESOLUTION_ATTEMPT_COMPLETED' &&
      event.publicPayload['issueId'] === issue.id,
  ).length + 1;
  const outcome: ResolutionOutcome = {
    issueId: issue.id,
    assignmentId,
    responderId: responder.id,
    status: success ? 'RESOLVED' : 'REOPENED',
    success,
    durationMinutes,
    attemptNumber,
  };

  appendEvent(state, 'RESOLUTION_ATTEMPT_COMPLETED', {
    issueId: issue.id,
    stationId: issue.stationId,
    assignmentId,
    responderId: responder.id,
    success,
    durationMinutes,
    attemptNumber,
  });

  if (success) completeIssue(state, issue, outcome);
  else reopenIssue(state, issue, outcome);

  appendEvent(state, 'RESPONDER_MOVED', {
    responderId: responder.id,
    stationId: responder.dutyStationId,
    reason: success ? 'RESOLVED' : 'REOPENED',
  });
  return { assignment, outcome };
}

function completeIssue(state: RoomState, issue: Issue, outcome: ResolutionOutcome): void {
  issue.status = 'RESOLVED';
  issue.resolvedAt = state.simulatedAt;
  const stationStillActive = state.issues.some(
    (candidate) =>
      candidate.id !== issue.id &&
      candidate.stationId === issue.stationId &&
      ['PENDING', 'OFFER_PENDING', 'ASSIGNED', 'REOPENED'].includes(candidate.status),
  );
  if (!stationStillActive) {
    const station = state.stations.find((candidate) => candidate.id === issue.stationId);
    if (station !== undefined) station.status = 'NORMAL';
  }
  appendEvent(state, 'ISSUE_RESOLVED', {
    issueId: issue.id,
    stationId: issue.stationId,
    assignmentId: outcome.assignmentId,
    durationMinutes: outcome.durationMinutes,
    attemptNumber: outcome.attemptNumber,
  });
  appendAudit(
    state,
    issue,
    'ISSUE_RESOLVED',
    `Issue ${issue.id} resolved on attempt ${outcome.attemptNumber} after an observed ${outcome.durationMinutes}-minute duration.`,
  );
}

function reopenIssue(state: RoomState, issue: Issue, outcome: ResolutionOutcome): void {
  issue.status = 'REOPENED';
  delete issue.resolvedAt;
  const station = state.stations.find((candidate) => candidate.id === issue.stationId);
  if (station !== undefined) station.status = 'ISSUE_ACTIVE';
  appendEvent(state, 'ISSUE_REOPENED', {
    issueId: issue.id,
    stationId: issue.stationId,
    assignmentId: outcome.assignmentId,
    durationMinutes: outcome.durationMinutes,
    attemptNumber: outcome.attemptNumber,
  });
  appendAudit(
    state,
    issue,
    'ISSUE_REOPENED',
    `Issue ${issue.id} failed resolution attempt ${outcome.attemptNumber} after an observed ${outcome.durationMinutes}-minute duration and returned to dispatch.`,
  );
}

function releaseResponder(state: RoomState, responderId: string): void {
  const responder = state.responders.find((candidate) => candidate.id === responderId);
  if (responder === undefined) return;
  const dutyStation = state.stations.find((candidate) => candidate.id === responder.dutyStationId);
  responder.dutyStatus = 'AVAILABLE';
  delete responder.assignmentId;
  if (dutyStation !== undefined) {
    responder.publicLocation = {
      floorId: dutyStation.floorId,
      x: dutyStation.x,
      y: dutyStation.y,
    };
  }
}

function appendEvent(
  state: RoomState,
  type: string,
  publicPayload: Record<string, string | number | boolean>,
): void {
  state.events.push({
    id: `${state.roomId}-evt-${String(state.events.length + 1).padStart(3, '0')}`,
    type,
    occurredAt: state.simulatedAt,
    publicPayload,
  });
}

function appendAudit(
  state: RoomState,
  issue: Issue,
  action: 'ISSUE_RESOLVED' | 'ISSUE_REOPENED',
  summary: string,
): void {
  state.audits.push({
    id: `${state.roomId}-aud-${String(state.audits.length + 1).padStart(3, '0')}`,
    occurredAt: state.simulatedAt,
    actor: 'SYSTEM',
    action,
    issueId: issue.id,
    summary,
  });
}
