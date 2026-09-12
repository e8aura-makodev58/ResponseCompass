/**
 * SERVER-ONLY. Hidden simulation truth (SOW s4.2).
 *
 * Nothing in this file may be imported by `src/domain/projection.ts`, by any
 * HTTP response builder, by a model packet builder, or by a browser-visible
 * test fixture. It is persisted to its own file so that hidden truth is never
 * part of the `RoomState` object graph that public projection walks.
 */

import type { IssueClass } from './types.js';

export interface ResponderSkill {
  /** True median resolution duration in simulated minutes. */
  trueMedianMinutes: number;
  /** True probability of a successful resolution, 0..1. */
  trueSuccessProbability: number;
}

export interface HiddenRoomTruth {
  schemaVersion: 1;
  roomId: string;
  /** responderId -> issue class -> hidden skill. Immutable once provisioned. */
  skills: Record<string, Partial<Record<IssueClass, ResponderSkill>>>;
  /** Persisted deterministic random-stream cursor (SOW s3.2). */
  randomStream: { seed: string; cursor: number };
}
