/**
 * Deterministic issue priority.
 *
 * LANE B OWNS THIS FORMULA. The exported `Priority` *shape* is frozen; this
 * body is a deterministic placeholder and may be replaced without a contract
 * change or schemaVersion bump.
 *
 * Invariant that may not be relaxed (SOW s2, s5.3): priority uses only
 * deterministic issue facts. It must never read responder identity, observed
 * responder outcomes, or hidden skill. Aging promotes lower work so queued
 * work cannot starve; CRITICAL never demotes below lower-impact work.
 */

import type { Issue, Priority } from './types.js';

const AGE_POINTS_PER_HOUR = 2;
const MAX_AGE_POINTS = 24;

export function computePriority(
  facts: Pick<Issue, 'riskImpact' | 'complexity' | 'raisedAt'>,
  simulatedAt: string,
): Priority {
  const ageHours = Math.max(
    0,
    (Date.parse(simulatedAt) - Date.parse(facts.raisedAt)) / 3_600_000,
  );
  const agePoints = Math.min(MAX_AGE_POINTS, ageHours * AGE_POINTS_PER_HOUR);
  const score =
    Math.round((facts.riskImpact * 10 + facts.complexity * 3 + agePoints) * 100) / 100;

  // Impact alone sets the CRITICAL floor, so aging can promote into a band but
  // never demotes serious work out of one.
  const band =
    facts.riskImpact >= 8 || score >= 90
      ? 'CRITICAL'
      : facts.riskImpact >= 5 || score >= 55
        ? 'HIGH'
        : 'STANDARD';

  return { band, score };
}
