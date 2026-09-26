import type { ActivityEvent, CandidateWorkflow, Session } from '@workflowos/core';
import { hashId } from '@workflowos/core';
import { sessionize, type SessionizeOptions } from './sessionizer.js';
import { mineCandidates, tokenizeSessions, type MineOptions, type SessionTokens } from './miner.js';
import { scoreCandidates, rejectionWeightFor, type ScorerWeights } from './scorer.js';
import { dedupeCandidates, type DedupeOptions } from './grouper.js';

export interface DiscoverOptions extends MineOptions, SessionizeOptions, DedupeOptions {
  weights?: ScorerWeights;
  /** How many times the user has rejected candidates for this trace. */
  rejections?: number;
}

export interface DiscoveryResult {
  traceId: string;
  sessions: Session[];
  streams: SessionTokens[];
  candidates: CandidateWorkflow[];
  stats: {
    events: number;
    sessions: number;
    rawCandidates: number;
    candidates: number;
  };
}

/**
 * The full Observe -> Detect Repetition half of the loop.
 *
 * Pure with respect to its inputs: the same events, thresholds, and rejection
 * count always produce the same ranked candidates with the same ids.
 */
export function discover(
  events: readonly ActivityEvent[],
  options: DiscoverOptions,
): DiscoveryResult {
  const sessions = sessionize(events, options);
  const eventsById = new Map(events.map((e) => [e.id, e]));
  const streams = tokenizeSessions(sessions, eventsById);
  const raw = mineCandidates(streams, options);
  const scored = scoreCandidates(
    raw,
    options.weights,
    rejectionWeightFor(options.rejections ?? 0),
  );
  const candidates = dedupeCandidates(scored, options);

  return {
    traceId: options.traceId,
    sessions,
    streams,
    candidates,
    stats: {
      events: events.length,
      sessions: sessions.length,
      rawCandidates: raw.length,
      candidates: candidates.length,
    },
  };
}

export function candidateIdFor(traceId: string, tokenSequence: readonly string[]): string {
  return hashId('cand', traceId, JSON.stringify(tokenSequence));
}
