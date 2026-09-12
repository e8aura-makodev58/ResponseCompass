/**
 * Deterministic synthetic seed (SOW s1: synthetic, domain-neutral data only).
 *
 * The seed is a pure function of the room id: the same room id always produces
 * byte-identical state, which is what makes reproducibility testable (SOW s11).
 * All data here is invented -- no real people, facilities, equipment facts, or
 * maintenance history.
 */

import { computePriority } from '../domain/priority.js';
import type { HiddenRoomTruth, ResponderSkill } from '../domain/private.js';
import type {
  Issue,
  IssueClass,
  Responder,
  ResponderRole,
  RoomState,
  Station,
} from '../domain/types.js';
import { ISSUE_CLASSES, SCHEMA_VERSION } from '../domain/types.js';
import { RandomStream } from './rng.js';

/** Fixed anchor: a seeded room starts paused at a known simulated time. */
const SEED_SIMULATED_AT = '2026-09-12T08:00:00.000Z';

const FLOORS = ['floor-1', 'floor-2'] as const;
const STATIONS_PER_FLOOR = 6;

/** Six-person crew shape; Lane F adds the 2-2-3 rotation over these roles. */
const CREW_ROLES: ResponderRole[] = [
  'ENGINEER',
  'TECHNICIAN',
  'TECHNICIAN',
  'OPERATOR',
  'OPERATOR',
  'OPERATOR',
];
const CREW_COUNT = 4;

const ROLE_PREFIX: Record<ResponderRole, string> = {
  ENGINEER: 'Engr',
  TECHNICIAN: 'Tech',
  OPERATOR: 'Optr',
};

export interface SeededRoom {
  state: RoomState;
  hidden: HiddenRoomTruth;
}

export interface RoomSeedSpec {
  roomId: string;
  displayName: string;
  /** Station indices (0-based) that start with an open issue. */
  openIssueStations: number[];
}

/** The two rooms the first deployment ships with (DEVELOPMENT_PLAN, gate: tenancy). */
export const DEFAULT_ROOM_SPECS: RoomSeedSpec[] = [
  { roomId: 'plant-1', displayName: 'Plant #1', openIssueStations: [1, 4] },
  { roomId: 'plant-2', displayName: 'Plant #2', openIssueStations: [7] },
];

function buildStations(roomId: string): Station[] {
  const stations: Station[] = [];
  for (const [floorIndex, floorId] of FLOORS.entries()) {
    for (let i = 0; i < STATIONS_PER_FLOOR; i += 1) {
      const ordinal = floorIndex * STATIONS_PER_FLOOR + i + 1;
      stations.push({
        id: `${roomId}-stn-${String(ordinal).padStart(3, '0')}`,
        displayName: `Station ${String(ordinal).padStart(2, '0')}`,
        floorId,
        // A plain grid: public coordinates, no real facility layout.
        x: 120 + (i % 3) * 220,
        y: 140 + Math.floor(i / 3) * 200,
        status: 'NORMAL',
      });
    }
  }
  return stations;
}

function buildResponders(roomId: string, stations: Station[]): Responder[] {
  const responders: Responder[] = [];
  const perRoleCount: Record<ResponderRole, number> = {
    ENGINEER: 0,
    TECHNICIAN: 0,
    OPERATOR: 0,
  };

  for (let crew = 0; crew < CREW_COUNT; crew += 1) {
    for (const [slot, role] of CREW_ROLES.entries()) {
      perRoleCount[role] += 1;
      const number = 100 + perRoleCount[role];
      const index = crew * CREW_ROLES.length + slot;
      const dutyStation = stations[index % stations.length] as Station;

      responders.push({
        id: `${roomId}-rsp-${String(index + 1).padStart(3, '0')}`,
        // Role convention only: crew membership never appears in a person name.
        displayName: `${ROLE_PREFIX[role]}${number}`,
        role,
        // Lane A seeds exactly one crew on duty; Lane F replaces this with the
        // persisted 2-2-3 rotation measured from a room-seed anchor.
        dutyStatus: crew === 0 ? 'AVAILABLE' : 'OFF_SHIFT',
        publicLocation: {
          floorId: dutyStation.floorId,
          x: dutyStation.x,
          y: dutyStation.y,
        },
        dutyStationId: dutyStation.id,
      });
    }
  }
  return responders;
}

function buildIssues(
  roomId: string,
  stations: Station[],
  openIssueStations: number[],
  rng: RandomStream,
): Issue[] {
  const issues: Issue[] = [];
  for (const [n, stationIndex] of openIssueStations.entries()) {
    const station = stations[stationIndex];
    if (station === undefined) throw new Error(`Seed references missing station ${stationIndex}`);

    const raisedAt = new Date(
      Date.parse(SEED_SIMULATED_AT) - (n + 1) * 37 * 60_000,
    ).toISOString();
    const issueClass = rng.pick(ISSUE_CLASSES) as IssueClass;
    const riskImpact = rng.int(2, 9);
    const complexity = rng.int(1, 5);

    station.status = 'ISSUE_ACTIVE';
    issues.push({
      id: `${roomId}-iss-${String(n + 1).padStart(3, '0')}`,
      stationId: station.id,
      class: issueClass,
      raisedAt,
      status: 'PENDING',
      priority: computePriority({ riskImpact, complexity, raisedAt }, SEED_SIMULATED_AT),
      riskImpact,
      complexity,
    });
  }
  return issues;
}

/**
 * Hidden truth per responder per issue class (SOW s4.2). Persisted separately
 * from room state and immutable once provisioned.
 */
function buildHiddenTruth(
  roomId: string,
  responders: Responder[],
  rng: RandomStream,
): HiddenRoomTruth {
  const skills: HiddenRoomTruth['skills'] = {};
  for (const responder of responders) {
    const perClass: Partial<Record<IssueClass, ResponderSkill>> = {};
    for (const issueClass of ISSUE_CLASSES) {
      perClass[issueClass] = {
        trueMedianMinutes: Math.round(rng.float(18, 95)),
        trueSuccessProbability: Math.round(rng.float(0.55, 0.97) * 1000) / 1000,
      };
    }
    skills[responder.id] = perClass;
  }

  return {
    schemaVersion: 1,
    roomId,
    skills,
    randomStream: { seed: `${roomId}:outcomes`, cursor: 0 },
  };
}

export function seedRoom(spec: RoomSeedSpec): SeededRoom {
  const rng = new RandomStream(`${spec.roomId}:seed`);
  const stations = buildStations(spec.roomId);
  const responders = buildResponders(spec.roomId, stations);
  const issues = buildIssues(spec.roomId, stations, spec.openIssueStations, rng);

  const state: RoomState = {
    schemaVersion: SCHEMA_VERSION,
    roomId: spec.roomId,
    displayName: spec.displayName,
    revision: 1,
    simulatedAt: SEED_SIMULATED_AT,
    mode: 'LIVE',
    // Seeded rooms start paused so a tester decides when work begins.
    clockState: 'PAUSED',
    stations,
    responders,
    issues,
    offers: [],
    assignments: [],
    events: [
      {
        id: `${spec.roomId}-evt-001`,
        type: 'ROOM_SEEDED',
        occurredAt: SEED_SIMULATED_AT,
        publicPayload: {
          roomId: spec.roomId,
          stationCount: stations.length,
          responderCount: responders.length,
          openIssueCount: issues.length,
        },
      },
    ],
    audits: [
      {
        id: `${spec.roomId}-aud-001`,
        occurredAt: SEED_SIMULATED_AT,
        actor: 'SYSTEM',
        action: 'ROOM_SEEDED',
        summary: `Seeded ${spec.displayName} with ${stations.length} stations and ${responders.length} responders, paused.`,
      },
    ],
  };

  return { state, hidden: buildHiddenTruth(spec.roomId, responders, rng) };
}
