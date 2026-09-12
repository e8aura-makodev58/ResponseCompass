/**
 * Adapter for the pre-built Plant 1 simulator snapshot (schema 2.1).
 *
 * The source snapshot is an input, never a browser payload and never a bundled
 * runtime artifact. Its `responderSkills` array is written only to hidden.json;
 * all remaining mappings are explicit public operational projections.
 */

import { readFile } from 'node:fs/promises';

import { computePriority } from '../domain/priority.js';
import type { HiddenRoomTruth } from '../domain/private.js';
import type {
  Assignment,
  Issue,
  IssueClass,
  Offer,
  Responder,
  ResponderRole,
  RoomEvent,
  RoomState,
  Station,
} from '../domain/types.js';
import { SCHEMA_VERSION } from '../domain/types.js';
import type { SeededRoom } from './seed.js';

const CLASS_MAP: Record<string, IssueClass> = {
  A: 'MECHANICAL',
  B: 'ELECTRICAL',
  C: 'CALIBRATION',
};

type SourceRecord = Record<string, unknown>;

export async function loadPlant1Seed(filePath: string): Promise<SeededRoom> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    throw new Error('Plant 1 simulation seed could not be read as JSON.');
  }
  return importPlant1Seed(parsed);
}

export function importPlant1Seed(source: unknown): SeededRoom {
  const root = record(source, 'Plant 1 simulation seed');
  if (root['schemaVersion'] !== '2.1') {
    throw new Error('Plant 1 simulation seed must use schemaVersion 2.1.');
  }
  const simulation = record(root['simulationState'], 'simulationState');
  const simulatedAt = string(simulation['simulationTime'], 'simulationState.simulationTime');
  if (Number.isNaN(Date.parse(simulatedAt))) throw new Error('simulationState.simulationTime must be an ISO timestamp.');

  const equipment = array(root['equipment'], 'equipment');
  const respondersSource = array(root['responders'], 'responders');
  const issuesSource = array(root['issues'], 'issues');
  const assignmentsSource = array(root['assignments'], 'assignments');
  const offersSource = array(root['dispatchOffers'], 'dispatchOffers');
  const recommendationsSource = array(root['recommendations'], 'recommendations');
  const eventsSource = array(root['operationalEvents'], 'operationalEvents');
  const skillsSource = array(root['responderSkills'], 'responderSkills');

  const stations = equipment.map((item) => stationFromSource(record(item, 'equipment entry')));
  const stationIds = new Set(stations.map((station) => station.id));
  const issues = issuesSource
    .map((item) => issueFromSource(record(item, 'issue entry'), simulatedAt, stationIds))
    .sort((left, right) => left.raisedAt.localeCompare(right.raisedAt) || left.id.localeCompare(right.id));
  const activeAssignments = assignmentsSource
    .map((item) => assignmentFromSource(record(item, 'assignment entry'), simulatedAt))
    .filter((assignment): assignment is Assignment => assignment !== null);
  const activeAssignmentByResponder = new Map(
    activeAssignments.filter((assignment) => assignment.status === 'ACTIVE').map((assignment) => [assignment.responderId, assignment.id]),
  );
  const responders = respondersSource.map((item) => responderFromSource(record(item, 'responder entry'), activeAssignmentByResponder, stations));
  const responderIds = new Set(responders.map((responder) => responder.id));
  const offers = activeOffers(offersSource, recommendationsSource, simulatedAt, responderIds, issues);
  const events = eventsSource
    .map((item) => eventFromSource(record(item, 'operational event entry'), simulatedAt))
    .filter((event): event is RoomEvent => event !== null);

  const state: RoomState = {
    schemaVersion: SCHEMA_VERSION,
    roomId: 'plant-1',
    displayName: 'Plant #1',
    // Imported source revisions are not compatible with this app's mutation
    // envelope. Begin a new canonical revision sequence at one.
    revision: 1,
    simulatedAt,
    mode: 'LIVE',
    clockState: simulation['status'] === 'RUNNING' ? 'RUNNING' : 'PAUSED',
    stations,
    responders,
    issues,
    offers,
    assignments: activeAssignments,
    events,
    audits: events.map((event, index) => ({
      id: `plant-1-import-aud-${String(index + 1).padStart(5, '0')}`,
      occurredAt: event.occurredAt,
      actor: 'SYSTEM',
      action: event.type,
      ...(typeof event.publicPayload['issueId'] === 'string' ? { issueId: event.publicPayload['issueId'] } : {}),
      summary: `Imported simulator event: ${event.type}.`,
    })),
  };

  return {
    state,
    hidden: hiddenFromSource(skillsSource, simulation),
  };
}

function stationFromSource(source: SourceRecord): Station {
  const floor = number(source['floor'], 'equipment.floor');
  return {
    id: string(source['id'], 'equipment.id'),
    displayName: string(source['name'], 'equipment.name'),
    floorId: `floor-${floor}`,
    x: number(source['x'], 'equipment.x'),
    y: number(source['y'], 'equipment.y'),
    status: source['status'] === 'ISSUE_ACTIVE' ? 'ISSUE_ACTIVE' : 'NORMAL',
  };
}

function issueFromSource(source: SourceRecord, simulatedAt: string, stationIds: Set<string>): Issue {
  const stationId = string(source['equipmentId'], 'issue.equipmentId');
  if (!stationIds.has(stationId)) throw new Error(`Issue references unknown equipment ${stationId}.`);
  const raisedAt = string(source['raisedAt'], 'issue.raisedAt');
  const mappedClass = CLASS_MAP[string(source['issueClass'], 'issue.issueClass')];
  if (mappedClass === undefined) throw new Error('Plant 1 issue class is not supported.');
  const sourcePriority = source['priorityBand'] ?? source['existingPriority'];
  const riskImpact = sourcePriority === 'CRITICAL' ? 9 : sourcePriority === 'HIGH' ? 6 : 3;
  const complexity = source['complexity'] === 'COMPLEX' ? 5 : 3;
  const status = source['status'];
  if (!['PENDING', 'OFFER_PENDING', 'ASSIGNED', 'RESOLVED', 'REOPENED'].includes(String(status))) {
    throw new Error('Plant 1 issue has an unsupported lifecycle status.');
  }
  return {
    id: string(source['id'], 'issue.id'),
    stationId,
    class: mappedClass,
    raisedAt,
    status: status as Issue['status'],
    priority: computePriority({ riskImpact, complexity, raisedAt }, simulatedAt),
    riskImpact,
    complexity,
    ...(typeof source['resolvedAt'] === 'string' ? { resolvedAt: source['resolvedAt'] } : {}),
  };
}

function responderFromSource(source: SourceRecord, assignments: Map<string, string>, stations: Station[]): Responder {
  const name = string(source['name'], 'responder.name');
  const floor = number(source['floor'], 'responder.floor');
  const dutyStation = record(source['dutyStation'], 'responder.dutyStation');
  const availability = source['availability'];
  const dutyStatus = availability === 'ASSIGNED' ? 'ASSIGNED'
    : availability === 'OFFERED' ? 'OFFERED'
      : availability === 'AVAILABLE' ? 'AVAILABLE' : 'OFF_SHIFT';
  const id = string(source['id'], 'responder.id');
  const assignmentId = assignments.get(id);
  return {
    id,
    displayName: name,
    role: roleFromName(name),
    dutyStatus,
    publicLocation: { floorId: `floor-${floor}`, x: number(source['x'], 'responder.x'), y: number(source['y'], 'responder.y') },
    dutyStationId: closestStationId(stations, number(dutyStation['floor'], 'responder.dutyStation.floor'), number(dutyStation['x'], 'responder.dutyStation.x'), number(dutyStation['y'], 'responder.dutyStation.y')),
    ...(assignmentId === undefined ? {} : { assignmentId }),
  };
}

function closestStationId(stations: Station[], floor: number, x: number, y: number): string {
  const floorId = `floor-${floor}`;
  const station = stations
    .filter((candidate) => candidate.floorId === floorId)
    .sort((left, right) => {
      const leftDistance = Math.hypot(left.x - x, left.y - y);
      const rightDistance = Math.hypot(right.x - x, right.y - y);
      return leftDistance - rightDistance || left.id.localeCompare(right.id);
    })[0];
  if (station === undefined) throw new Error(`Responder duty station has no equipment on floor ${floor}.`);
  return station.id;
}

function roleFromName(name: string): ResponderRole {
  if (name.startsWith('Engr')) return 'ENGINEER';
  if (name.startsWith('Tech')) return 'TECHNICIAN';
  return 'OPERATOR';
}

function assignmentFromSource(source: SourceRecord, simulatedAt: string): Assignment | null {
  const sourceStatus = source['status'];
  if (sourceStatus !== 'ACTIVE') return null;
  const role = source['role'] === 'SUPPORT' ? 'SUPPORT' : 'PRIMARY';
  return {
    id: string(source['id'], 'assignment.id'),
    issueId: string(source['issueId'], 'assignment.issueId'),
    responderId: string(source['responderId'], 'assignment.responderId'),
    role,
    status: 'ACTIVE',
    createdAt: typeof source['createdAt'] === 'string' ? source['createdAt'] : simulatedAt,
  };
}

function activeOffers(
  offers: unknown[],
  recommendations: unknown[],
  simulatedAt: string,
  responderIds: Set<string>,
  issues: Issue[],
): Offer[] {
  const recommendationById = new Map(
    recommendations.map((item) => record(item, 'recommendation entry')).map((item) => [item['id'], item]),
  );
  const issueIds = new Set(issues.map((issue) => issue.id));
  return offers
    .map((item) => record(item, 'dispatch offer entry'))
    .filter((offer) => offer['status'] === 'PENDING' && offer['purpose'] !== 'ASSISTANCE')
    .map((offer) => {
      const issueId = string(offer['issueId'], 'offer.issueId');
      const responderId = string(offer['responderId'], 'offer.responderId');
      if (!issueIds.has(issueId) || !responderIds.has(responderId)) throw new Error('Pending offer references an unknown issue or responder.');
      const recommendation = recommendationById.get(offer['recommendationId']);
      const candidates = recommendation === undefined ? [] : array(recommendation['candidateEvidenceSnapshot'], 'recommendation.candidateEvidenceSnapshot')
        .map((candidate) => string(record(candidate, 'candidate')['responderId'], 'candidate.responderId'))
        .filter((candidateId) => responderIds.has(candidateId));
      return {
        id: string(offer['id'], 'offer.id'),
        issueId,
        responderId,
        status: 'PENDING' as const,
        createdAt: typeof offer['createdAt'] === 'string' ? offer['createdAt'] : simulatedAt,
        rankedCandidateIds: candidates.length > 0 ? candidates : [responderId],
      };
    });
}

function eventFromSource(source: SourceRecord, simulatedAt: string): RoomEvent | null {
  const type = source['eventType'];
  if (typeof type !== 'string') return null;
  const payload: RoomEvent['publicPayload'] = {};
  for (const key of ['issueId', 'equipmentId', 'responderId'] as const) {
    if (typeof source[key] === 'string') payload[key] = source[key];
  }
  return {
    id: string(source['id'], 'event.id'),
    type,
    occurredAt: typeof source['simulationTimestamp'] === 'string' ? source['simulationTimestamp'] : simulatedAt,
    publicPayload: payload,
  };
}

function hiddenFromSource(skills: unknown[], simulation: SourceRecord): HiddenRoomTruth {
  const imported: HiddenRoomTruth['skills'] = {};
  for (const item of skills) {
    const skill = record(item, 'responder skill entry');
    const responderId = string(skill['responderId'], 'responderSkill.responderId');
    const issueClass = CLASS_MAP[string(skill['issueClass'], 'responderSkill.issueClass')];
    if (issueClass === undefined) throw new Error('Plant 1 responder skill class is not supported.');
    const perResponder = imported[responderId] ?? {};
    perResponder[issueClass] = {
      trueMedianMinutes: number(skill['trueMedianMinutes'], 'responderSkill.trueMedianMinutes'),
      trueSuccessProbability: number(skill['trueSuccessProbability'], 'responderSkill.trueSuccessProbability'),
    };
    imported[responderId] = perResponder;
  }
  return {
    schemaVersion: 1,
    roomId: 'plant-1',
    skills: imported,
    randomStream: {
      seed: `plant-1:imported:${String(simulation['rngVersion'] ?? 'unknown')}`,
      cursor: 0,
    },
  };
}

function record(value: unknown, label: string): SourceRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as SourceRecord;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function number(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return value;
}
