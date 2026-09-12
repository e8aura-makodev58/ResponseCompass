import type { RoomState } from './types.js';
import type { HiddenRoomTruth } from './private.js';
import { RandomStream } from '../seed/rng.js';
import { acceptOffer, rejectOffer } from './dispatch.js';
import { resolveAssignment } from './lifecycle.js';
import { triggerNextEvent } from './clock.js';

/** Simulator responses are persisted random draws, independent of Compass ranking. */
export function advanceAutomation(state: RoomState, hidden: HiddenRoomTruth, elapsedMs: number): void {
  if (state.clockState !== 'RUNNING' || state.mode !== 'LIVE') return;
  state.simulatedAt = new Date(Date.parse(state.simulatedAt) + Math.max(0, elapsedMs) * (state.speedMultiplier ?? 60)).toISOString();
  const now = Date.parse(state.simulatedAt);
  const random = () => {
    const rng = new RandomStream(hidden.randomStream.seed, hidden.randomStream.cursor);
    const value = rng.next();
    hidden.randomStream.cursor = rng.position;
    return value;
  };
  const schedule = hidden.automation ??= { nextEventAt: now + (3 + random() * 12) * 60_000, offers: {}, assignments: {} };
  if (now >= schedule.nextEventAt) {
    if (state.issues.filter(issue => issue.status !== 'RESOLVED').length < 10) triggerNextEvent(state, hidden, undefined, false);
    schedule.nextEventAt = now + (3 + random() * 12) * 60_000;
  }
  for (const offer of state.offers.filter(row => row.status === 'PENDING')) {
    const due = schedule.offers[offer.id] ??= now + (0.1 + random() * 0.4) * 60_000;
    if (now < due) continue;
    if (random() < 0.85) acceptOffer(state, offer.id);
    else rejectOffer(state, offer.id);
    delete schedule.offers[offer.id];
  }
  for (const assignment of state.assignments.filter(row => row.status === 'ACTIVE')) {
    const issue = state.issues.find(row => row.id === assignment.issueId)!;
    const median = hidden.skills[assignment.responderId]?.[issue.class]?.trueMedianMinutes ?? 15;
    const due = schedule.assignments[assignment.id] ??= now + Math.max(1, median * (0.75 + random() * 0.5)) * 60_000;
    if (now < due) continue;
    resolveAssignment(state, hidden, assignment.id, Math.max(0, (now - Date.parse(assignment.createdAt)) / 60_000));
    delete schedule.assignments[assignment.id];
  }
  for (const id of Object.keys(schedule.offers)) if (!state.offers.some(row => row.id === id && row.status === 'PENDING')) delete schedule.offers[id];
  for (const id of Object.keys(schedule.assignments)) if (!state.assignments.some(row => row.id === id && row.status === 'ACTIVE')) delete schedule.assignments[id];
}
