/**
 * Simulation clock control and deterministic event trigger (shared operational core).
 *
 * pauseClock / resumeClock flip clockState and persist a public audit event.
 * triggerNextEvent advances simulatedAt by one tick, recomputes priorities on
 * PENDING issues, and generates one new synthetic issue on a free station using
 * the persisted RNG cursor in HiddenRoomTruth.  Hidden truth is never placed on
 * public state; only the derived public issue lands in RoomState.
 */
import { DispatchConflictError } from './dispatch.js';
import type { HiddenRoomTruth } from './private.js';
import { computePriority } from './priority.js';
import type { Issue, IssueClass, RoomState } from './types.js';
import { ISSUE_CLASSES } from './types.js';
import { RandomStream } from '../seed/rng.js';

const TICK_MINUTES = 15;
const TICK_MS = TICK_MINUTES * 60_000;

export function pauseClock(state: RoomState): void {
  if (state.clockState === 'PAUSED') {
    throw new DispatchConflictError('Room clock is already paused.');
  }
  state.clockState = 'PAUSED';
  appendEvent(state, 'CLOCK_PAUSED', { simulatedAt: state.simulatedAt });
  state.audits.push(makeAudit(state, 'OPERATOR', 'CLOCK_PAUSED', `Simulation clock paused at ${state.simulatedAt}.`));
}

export function resumeClock(state: RoomState): void {
  if (state.clockState === 'RUNNING') {
    throw new DispatchConflictError('Room clock is already running.');
  }
  state.clockState = 'RUNNING';
  appendEvent(state, 'CLOCK_RESUMED', { simulatedAt: state.simulatedAt });
  state.audits.push(makeAudit(state, 'OPERATOR', 'CLOCK_RESUMED', `Simulation clock resumed from ${state.simulatedAt}.`));
}

/**
 * Advance the simulation by one tick.  Advances simulatedAt, recomputes
 * priorities on PENDING issues, and generates one deterministic synthetic issue
 * on a free station using the persisted random stream in hidden truth.
 *
 * CALLER MUST PERSIST the mutated `hidden` argument after this function returns
 * (e.g. via RoomStore.mutateWithHidden) so the RNG cursor survives restart.
 */
export function triggerNextEvent(state: RoomState, hidden: HiddenRoomTruth): void {
  const nextAt = new Date(Date.parse(state.simulatedAt) + TICK_MS).toISOString();
  state.simulatedAt = nextAt;

  for (const issue of state.issues) {
    if (issue.status === 'PENDING') {
      issue.priority = computePriority(issue, nextAt);
    }
  }

  const freeStations = state.stations.filter((s) => s.status === 'NORMAL');
  if (freeStations.length === 0) {
    appendEvent(state, 'TICK_ADVANCED', { simulatedAt: nextAt });
    state.audits.push(makeAudit(state, 'SCHEDULER', 'TICK_ADVANCED', `Simulated time advanced to ${nextAt}; no free station for a new issue.`));
    return;
  }

  const rng = new RandomStream(hidden.randomStream.seed, hidden.randomStream.cursor);
  const station = freeStations[rng.int(0, freeStations.length - 1)]!;
  const issueClass = rng.pick(ISSUE_CLASSES) as IssueClass;
  const riskImpact = rng.int(2, 9);
  const complexity = rng.int(1, 5);
  hidden.randomStream.cursor = rng.position;

  const issue: Issue = {
    id: `${state.roomId}-iss-${String(state.issues.length + 1).padStart(3, '0')}`,
    stationId: station.id,
    class: issueClass,
    raisedAt: nextAt,
    status: 'PENDING',
    priority: computePriority({ riskImpact, complexity, raisedAt: nextAt }, nextAt),
    riskImpact,
    complexity,
  };
  state.issues.push(issue);
  station.status = 'ISSUE_ACTIVE';

  appendEvent(state, 'ISSUE_TRIGGERED', {
    issueId: issue.id,
    stationId: station.id,
    issueClass,
    riskImpact,
    complexity,
  });
  appendEvent(state, 'TICK_ADVANCED', { simulatedAt: nextAt, issueId: issue.id });
  state.audits.push(makeAudit(state, 'SCHEDULER', 'ISSUE_TRIGGERED', `New ${issueClass} issue ${issue.id} triggered at station ${station.id}.`));
}

function appendEvent(state: RoomState, type: string, payload: Record<string, string | number | boolean>): void {
  state.events.push({
    id: `${state.roomId}-evt-${String(state.events.length + 1).padStart(3, '0')}`,
    type,
    occurredAt: state.simulatedAt,
    publicPayload: payload,
  });
}

function makeAudit(state: RoomState, actor: string, action: string, summary: string) {
  return {
    id: `${state.roomId}-aud-${String(state.audits.length + 1).padStart(3, '0')}`,
    occurredAt: state.simulatedAt,
    actor,
    action,
    summary,
  };
}
