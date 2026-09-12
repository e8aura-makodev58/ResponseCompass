/**
 * Public projection allowlist (SOW s8).
 *
 * Every public field is copied out explicitly. This is deliberately verbose:
 * a field added to an internal type in future must be added here on purpose
 * before it can reach a browser, so growth of internal state cannot silently
 * widen the public surface.
 *
 * This module must never import from `src/domain/private.ts`.
 */

import type {
  Assignment,
  AuditRecord,
  Issue,
  Offer,
  Responder,
  RoomEvent,
  RoomState,
  Station,
} from './types.js';

export interface PublicRoomState {
  schemaVersion: number;
  roomId: string;
  displayName: string;
  revision: number;
  simulatedAt: string;
  mode: string;
  clockState: string;
  speedMultiplier: number;
  stations: PublicStation[];
  responders: PublicResponder[];
  issues: PublicIssue[];
  offers: PublicOffer[];
  assignments: PublicAssignment[];
  events: PublicEvent[];
  audits: PublicAudit[];
}

export interface PublicStation {
  id: string;
  displayName: string;
  floorId: string;
  x: number;
  y: number;
  status: string;
}

export interface PublicResponder {
  id: string;
  displayName: string;
  role: string;
  dutyStatus: string;
  publicLocation: { floorId: string; x: number; y: number };
  assignmentId: string | null;
}

export interface PublicIssue {
  id: string;
  stationId: string;
  class: string;
  raisedAt: string;
  status: string;
  priority: { band: string; score: number };
  resolvedAt: string | null;
}

export interface PublicOffer {
  id: string;
  issueId: string;
  responderId: string;
  status: string;
  createdAt: string;
}

export interface PublicAssignment {
  id: string;
  issueId: string;
  responderId: string;
  role: string;
  status: string;
  createdAt: string;
  releasedAt: string | null;
}

export interface PublicEvent {
  id: string;
  type: string;
  occurredAt: string;
  publicPayload: Record<string, string | number | boolean>;
}

export interface PublicAudit {
  id: string;
  occurredAt: string;
  actor: string;
  action: string;
  issueId: string | null;
  summary: string;
}

/**
 * Event payloads are scalar-only. An object or array here would be an escape
 * hatch for arbitrary internal data, so nested values are dropped rather than
 * serialized.
 */
function projectPayload(
  payload: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      safe[key] = value;
    }
  }
  return safe;
}

export function projectStation(station: Station): PublicStation {
  return {
    id: station.id,
    displayName: station.displayName,
    floorId: station.floorId,
    x: station.x,
    y: station.y,
    status: station.status,
  };
}

export function projectResponder(responder: Responder): PublicResponder {
  return {
    id: responder.id,
    displayName: responder.displayName,
    role: responder.role,
    dutyStatus: responder.dutyStatus,
    publicLocation: {
      floorId: responder.publicLocation.floorId,
      x: responder.publicLocation.x,
      y: responder.publicLocation.y,
    },
    assignmentId: responder.assignmentId ?? null,
  };
}

/**
 * `riskImpact` and `complexity` are the deterministic inputs to the priority
 * formula. The resulting band and score are public; the raw weighting inputs
 * are internal resolution mechanics and stay server-side.
 */
export function projectIssue(issue: Issue): PublicIssue {
  return {
    id: issue.id,
    stationId: issue.stationId,
    class: issue.class,
    raisedAt: issue.raisedAt,
    status: issue.status,
    priority: { band: issue.priority.band, score: issue.priority.score },
    resolvedAt: issue.resolvedAt ?? null,
  };
}

/**
 * `rankedCandidateIds` is withheld: publishing the full ranked queue would
 * reveal the pending offer sequence before each responder is asked.
 */
export function projectOffer(offer: Offer): PublicOffer {
  return {
    id: offer.id,
    issueId: offer.issueId,
    responderId: offer.responderId,
    status: offer.status,
    createdAt: offer.createdAt,
  };
}

export function projectAssignment(assignment: Assignment): PublicAssignment {
  return {
    id: assignment.id,
    issueId: assignment.issueId,
    responderId: assignment.responderId,
    role: assignment.role,
    status: assignment.status,
    createdAt: assignment.createdAt,
    releasedAt: assignment.releasedAt ?? null,
  };
}

export function projectEvent(event: RoomEvent): PublicEvent {
  return {
    id: event.id,
    type: event.type,
    occurredAt: event.occurredAt,
    publicPayload: projectPayload(event.publicPayload),
  };
}

export function projectAudit(audit: AuditRecord): PublicAudit {
  return {
    id: audit.id,
    occurredAt: audit.occurredAt,
    actor: audit.actor,
    action: audit.action,
    issueId: audit.issueId ?? null,
    summary: audit.summary,
  };
}

export function projectRoomState(state: RoomState): PublicRoomState {
  return {
    schemaVersion: state.schemaVersion,
    roomId: state.roomId,
    displayName: state.displayName,
    revision: state.revision,
    simulatedAt: state.simulatedAt,
    mode: state.mode,
    clockState: state.clockState,
    speedMultiplier: state.speedMultiplier ?? 60,
    stations: state.stations.map(projectStation),
    responders: state.responders.map(projectResponder),
    issues: state.issues.map(projectIssue),
    offers: state.offers.map(projectOffer),
    assignments: state.assignments.map(projectAssignment),
    events: state.events.map(projectEvent),
    audits: state.audits.map(projectAudit),
  };
}
