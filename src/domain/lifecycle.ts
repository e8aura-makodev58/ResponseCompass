/**
 * Issue lifecycle — assignment resolution (shared operational core).
 *
 * resolveAssignment closes an active assignment: the issue moves to RESOLVED,
 * the station returns to NORMAL when no other active issues remain for it, and
 * the responder returns to AVAILABLE at their duty station.  No hidden truth is
 * read or written; resolution is deterministic from public state alone.
 */
import { DispatchConflictError, DispatchValidationError } from './dispatch.js';
import type { Assignment, RoomState } from './types.js';

export function resolveAssignment(state: RoomState, assignmentId: string): Assignment {
  const assignment = state.assignments.find((a) => a.id === assignmentId);
  if (assignment === undefined) throw new DispatchValidationError('Unknown assignment.');
  if (assignment.status !== 'ACTIVE') throw new DispatchConflictError('Assignment is not active.');

  const issue = state.issues.find((i) => i.id === assignment.issueId);
  if (issue === undefined || issue.status !== 'ASSIGNED') {
    throw new DispatchConflictError('Assignment does not reference an ASSIGNED issue.');
  }

  const responder = state.responders.find((r) => r.id === assignment.responderId);
  if (responder === undefined) throw new DispatchValidationError('Assignment references an unknown responder.');

  assignment.status = 'RELEASED';
  assignment.releasedAt = state.simulatedAt;
  issue.status = 'RESOLVED';
  issue.resolvedAt = state.simulatedAt;

  // Station reverts to NORMAL only when no other active issues remain for it.
  const stationStillActive = state.issues.some(
    (i) =>
      i.id !== issue.id &&
      i.stationId === issue.stationId &&
      (i.status === 'PENDING' || i.status === 'OFFER_PENDING' || i.status === 'ASSIGNED'),
  );
  if (!stationStillActive) {
    const station = state.stations.find((s) => s.id === issue.stationId);
    if (station !== undefined) station.status = 'NORMAL';
  }

  const dutyStation = state.stations.find((s) => s.id === responder.dutyStationId);
  responder.dutyStatus = 'AVAILABLE';
  delete responder.assignmentId;
  if (dutyStation !== undefined) {
    responder.publicLocation = { floorId: dutyStation.floorId, x: dutyStation.x, y: dutyStation.y };
  }

  appendEvent(state, 'ISSUE_RESOLVED', { issueId: issue.id, stationId: issue.stationId, assignmentId });
  appendEvent(state, 'RESPONDER_MOVED', { responderId: responder.id, stationId: responder.dutyStationId, reason: 'RESOLVED' });
  state.audits.push({
    id: `${state.roomId}-aud-${String(state.audits.length + 1).padStart(3, '0')}`,
    occurredAt: state.simulatedAt,
    actor: 'OPERATOR',
    action: 'ISSUE_RESOLVED',
    issueId: issue.id,
    summary: `Issue ${issue.id} resolved; responder ${responder.id} released and returned to duty station.`,
  });

  return assignment;
}

function appendEvent(state: RoomState, type: string, payload: Record<string, string | number | boolean>): void {
  state.events.push({
    id: `${state.roomId}-evt-${String(state.events.length + 1).padStart(3, '0')}`,
    type,
    occurredAt: state.simulatedAt,
    publicPayload: payload,
  });
}
