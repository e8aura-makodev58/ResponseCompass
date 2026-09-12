/**
 * FROZEN CONTRACT v1 (schemaVersion 1).
 *
 * See the decision log in handover.md (2026-09-12, Claude Opus 5). Adding an
 * optional field is compatible. Renaming, removing, or repurposing a field
 * requires a decision entry and a SCHEMA_VERSION bump.
 *
 * Hidden simulation truth (`ResponderSkill`, SOW s4.2) is deliberately absent
 * from every type in this file and must never be added to one. It lives in a
 * separate private store; see `src/domain/private.ts`.
 */

export const SCHEMA_VERSION = 1 as const;

export type RoomId = string;
export type ClockState = 'RUNNING' | 'PAUSED';
export type RoomMode = 'LIVE' | 'OFFLINE';
export type RoomHealth = 'READY' | 'FAILED';

/** Domain-neutral synthetic issue classes (SOW s1: synthetic demo data only). */
export const ISSUE_CLASSES = [
  'MECHANICAL',
  'ELECTRICAL',
  'CALIBRATION',
  'MATERIAL_FEED',
  'SOFTWARE',
] as const;
export type IssueClass = (typeof ISSUE_CLASSES)[number];

export type StationStatus = 'NORMAL' | 'ISSUE_ACTIVE';

export interface FloorPoint {
  floorId: string;
  x: number;
  y: number;
}

export interface Station {
  id: string;
  displayName: string;
  floorId: string;
  x: number;
  y: number;
  status: StationStatus;
}

/**
 * Public responder record. `EngrNNN` / `TechNNN` / `OptrNNN` naming per SOW
 * s5.1 -- internal crew metadata must never become part of a person name.
 */
export type ResponderRole = 'ENGINEER' | 'TECHNICIAN' | 'OPERATOR';
export type DutyStatus = 'AVAILABLE' | 'OFFERED' | 'ASSIGNED' | 'OFF_SHIFT';

export interface Responder {
  id: string;
  displayName: string;
  role: ResponderRole;
  dutyStatus: DutyStatus;
  /** Canonical location; changes once per move event (SOW s4.1). */
  publicLocation: FloorPoint;
  /** Duty station a released responder returns to. */
  dutyStationId: string;
  assignmentId?: string;
}

export type IssueStatus =
  | 'PENDING'
  | 'OFFER_PENDING'
  | 'ASSIGNED'
  | 'RESOLVED'
  | 'REOPENED';

export type PriorityBand = 'CRITICAL' | 'HIGH' | 'STANDARD';

export interface Priority {
  band: PriorityBand;
  score: number;
}

export interface Issue {
  id: string;
  stationId: string;
  class: IssueClass;
  raisedAt: string;
  status: IssueStatus;
  priority: Priority;
  /** Deterministic synthetic operational facts that feed priority (SOW s5.3). */
  riskImpact: number;
  complexity: number;
  resolvedAt?: string;
}

export type OfferStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN';

export interface Offer {
  id: string;
  issueId: string;
  responderId: string;
  status: OfferStatus;
  createdAt: string;
  /** Deterministic ranking the offer sequence walks (SOW s6). */
  rankedCandidateIds: string[];
}

export type AssignmentRole = 'PRIMARY' | 'SUPPORT';
export type AssignmentStatus = 'ACTIVE' | 'RELEASED';

export interface Assignment {
  id: string;
  issueId: string;
  responderId: string;
  role: AssignmentRole;
  status: AssignmentStatus;
  createdAt: string;
  releasedAt?: string;
}

/**
 * Public event. `publicPayload` carries only approved public fields (SOW s8);
 * arbitrary payload data must not be placed here.
 */
export interface RoomEvent {
  id: string;
  type: string;
  occurredAt: string;
  publicPayload: Record<string, string | number | boolean>;
}

export interface AuditRecord {
  id: string;
  occurredAt: string;
  /** 'OPERATOR' | 'SYSTEM' | 'SCHEDULER' -- never a credential or real person. */
  actor: string;
  action: string;
  issueId?: string;
  /** Narrative built from approved public fields only. */
  summary: string;
}

export interface RoomState {
  schemaVersion: typeof SCHEMA_VERSION;
  roomId: RoomId;
  displayName: string;
  /** Increments on every accepted mutation; drives optimistic concurrency. */
  revision: number;
  simulatedAt: string;
  mode: RoomMode;
  clockState: ClockState;
  speedMultiplier?: 1 | 60;
  stations: Station[];
  responders: Responder[];
  issues: Issue[];
  offers: Offer[];
  assignments: Assignment[];
  events: RoomEvent[];
  audits: AuditRecord[];
}

/** Registry-level summary shown by the room picker and management view. */
export interface RoomSummary {
  roomId: RoomId;
  displayName: string;
  health: RoomHealth;
  /** Absent for a FAILED room: a failed room has no clock state (SOW s3.1). */
  clockState?: ClockState;
  mode?: RoomMode;
  revision?: number;
}
