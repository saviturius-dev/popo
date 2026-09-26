import type {
  ActivityEvent,
  CandidateWorkflow,
  NormalizedEvent,
  Occurrence,
  Placeholder,
  Session,
} from '@workflowos/core';
import { hashId } from '@workflowos/core';
import { mergePlaceholders, normalizeEvent } from './normalizer.js';

export interface SessionTokens {
  session: Session;
  events: ActivityEvent[];
  normalized: NormalizedEvent[];
  tokens: string[];
}

export function tokenizeSessions(
  sessions: readonly Session[],
  eventsById: ReadonlyMap<string, ActivityEvent>,
): SessionTokens[] {
  return sessions.map((session) => {
    const events = session.eventIds
      .map((id) => eventsById.get(id))
      .filter((e): e is ActivityEvent => e !== undefined)
      .sort((a, b) => a.ts - b.ts || a.seq - b.seq);
    const normalized = events.map((e) => normalizeEvent(e));
    return {
      session,
      events,
      normalized,
      tokens: normalized.map((n) => n.token),
    };
  });
}

export interface MineOptions {
  traceId: string;
  /** Minimum number of distinct sessions an n-gram must appear in. */
  minSupport?: number;
  minLen?: number;
  maxLen?: number;
  /** Minimum window similarity for a noisy occurrence to be accepted. */
  minSimilarity?: number;
  /** How much longer/shorter an aligned window may be than the seed. */
  windowSlack?: number;
}

export const DEFAULTS = {
  minSupport: 3,
  minLen: 2,
  maxLen: 24,
  minSimilarity: 0.6,
  windowSlack: 4,
} as const;

interface NGramStat {
  gram: string[];
  sessions: Set<string>;
}

/**
 * Finds workflows that repeat across sessions.
 *
 * Two phases, both deterministic:
 *   1. exact n-gram mining with a support threshold, keeping only *maximal*
 *      n-grams (an n-gram that always occurs as the prefix of a longer one is
 *      just a truncated view of that longer workflow);
 *   2. approximate alignment, so a real session with an extra click or a
 *      skipped optional step still counts as an occurrence of the same
 *      workflow instead of silently lowering its support.
 */
export function mineCandidates(
  streams: readonly SessionTokens[],
  options: MineOptions,
): CandidateWorkflow[] {
  const minSupport = options.minSupport ?? DEFAULTS.minSupport;
  const minLen = options.minLen ?? DEFAULTS.minLen;
  const maxLen = options.maxLen ?? DEFAULTS.maxLen;
  const minSimilarity = options.minSimilarity ?? DEFAULTS.minSimilarity;
  const slack = options.windowSlack ?? DEFAULTS.windowSlack;

  if (streams.length < minSupport) return [];

  const stats = countNGrams(streams, minLen, maxLen, minSupport);
  const maximal = [...stats.values()].filter((s) => isMaximal(s, stats));
  maximal.sort(
    (a, b) => b.gram.length - a.gram.length || encode(a.gram).localeCompare(encode(b.gram)),
  );

  const candidates: CandidateWorkflow[] = [];
  for (const stat of maximal) {
    const occurrences = alignOccurrences(stat.gram, streams, minSimilarity, slack);
    if (process.env.WORKFLOWOS_DEBUG_MINER) {
      process.stderr.write(
        `[miner] seed len=${stat.gram.length} support=${stat.sessions.size} occurrences=${occurrences.length} sims=${occurrences.map((o) => o.similarity.toFixed(2)).join(',')}\n`,
      );
    }
    if (occurrences.length < minSupport) continue;
    const consensus = consensusSequence(stat.gram, occurrences, streams);
    candidates.push({
      id: hashId('cand', options.traceId, encode(consensus)),
      traceIds: [options.traceId],
      tokenSequence: consensus,
      occurrences,
      appChain: appChainOf(consensus),
      score: { support: 0, duration: 0, crossAppTransitions: 0, consistency: 0, noisePenalty: 0, total: 0 },
    });
  }

  return candidates.sort((a, b) => a.id.localeCompare(b.id));
}

function countNGrams(
  streams: readonly SessionTokens[],
  minLen: number,
  maxLen: number,
  minSupport: number,
): Map<string, NGramStat> {
  const stats = new Map<string, NGramStat>();
  for (const stream of streams) {
    const seen = new Set<string>();
    const { tokens } = stream;
    for (let n = minLen; n <= Math.min(maxLen, tokens.length); n++) {
      for (let i = 0; i + n <= tokens.length; i++) {
        // Tokens contain '>' (placeholders are written `<email>`), so the key
        // has to be an unambiguous encoding rather than a joined string.
        seen.add(encode(tokens.slice(i, i + n)));
      }
    }
    for (const key of seen) {
      const gram = decode(key);
      const existing = stats.get(key);
      if (existing) existing.sessions.add(stream.session.id);
      else stats.set(key, { gram, sessions: new Set([stream.session.id]) });
    }
  }

  for (const [key, stat] of stats) {
    if (stat.sessions.size < minSupport) stats.delete(key);
  }
  return stats;
}

const encode = (tokens: readonly string[]): string => JSON.stringify(tokens);
const decode = (key: string): string[] => JSON.parse(key) as string[];

/**
 * The applications the workflow moves through, in order.
 *
 * Read from the consensus sequence itself rather than from one occurrence, so
 * an occurrence that started in a different place cannot mislabel the chain.
 */
function appChainOf(consensus: readonly string[]): string[] {
  const chain: string[] = [];
  for (const token of consensus) {
    const app = token.split(':')[0];
    if (app && chain[chain.length - 1] !== app) chain.push(app);
  }
  return chain;
}

/**
 * Drops any n-gram that is just a truncated view of a longer repeating pattern.
 *
 * Two rules, both needed in practice:
 *  - same support: if every occurrence of a pattern is the prefix or suffix of a
 *    longer pattern, it is that longer pattern, seen from one side;
 *  - proportional support: a shorter pattern often survives noise that breaks
 *    the longer one (an extra click in the middle), so it can score a *higher*
 *    support than the workflow it belongs to. If a longer containing pattern
 *    still repeats in at least half as many sessions, the shorter one is a
 *    fragment, not a separate workflow.
 */
function isMaximal(stat: NGramStat, stats: Map<string, NGramStat>): boolean {
  const support = stat.sessions.size;
  const key = stat.gram;

  for (const other of stats.values()) {
    if (other.gram.length <= stat.gram.length) continue;
    if (!contains(other.gram, key)) continue;

    if (other.sessions.size === support) return false;
    if (other.sessions.size >= support * CONTAINMENT_SUPPORT_RATIO) return false;
  }
  return true;
}

const CONTAINMENT_SUPPORT_RATIO = 0.5;

function contains(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length >= haystack.length) return false;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

function alignOccurrences(
  seed: string[],
  streams: readonly SessionTokens[],
  minSimilarity: number,
  slack: number,
): Occurrence[] {
  const occurrences: Occurrence[] = [];

  for (const stream of streams) {
    const { tokens, events, normalized, session } = stream;
    const windowSize = seed.length;
    const minWindow = Math.max(1, windowSize - slack);
    const maxWindow = windowSize + slack;

    const proposals: { start: number; length: number; similarity: number }[] = [];
    for (let start = 0; start < tokens.length; start++) {
      for (let length = minWindow; length <= maxWindow && start + length <= tokens.length; length++) {
        const window = tokens.slice(start, start + length);
        const similarity = similarityRatio(seed, window);
        if (similarity >= minSimilarity) proposals.push({ start, length, similarity });
      }
    }
    proposals.sort((a, b) => b.similarity - a.similarity || a.start - b.start || a.length - b.length);

    const used: [number, number][] = [];
    for (const proposal of proposals) {
      const overlaps = used.some(
        ([s, l]) => proposal.start < s + l && s < proposal.start + proposal.length,
      );
      if (overlaps) continue;
      used.push([proposal.start, proposal.length]);
      const slice = normalized.slice(proposal.start, proposal.start + proposal.length);
      occurrences.push({
        sessionId: session.id,
        startIndex: proposal.start,
        endIndex: proposal.start + proposal.length,
        eventIds: events
          .slice(proposal.start, proposal.start + proposal.length)
          .map((e) => e.id),
        startTs: events[proposal.start]?.ts ?? session.startTs,
        endTs: events[proposal.start + proposal.length - 1]?.ts ?? session.endTs,
        placeholders: mergePlaceholders(slice.map((n) => n.placeholders)),
        similarity: proposal.similarity,
      });
    }
  }

  return occurrences.sort(
    (a, b) => a.startTs - b.startTs || a.sessionId.localeCompare(b.sessionId),
  );
}

/** Longest-common-subsequence ratio, the similarity measure used throughout. */
export function similarityRatio(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const lcs = lcsLength(a, b);
  return (2 * lcs) / (a.length + b.length);
}

/**
 * How much of the shorter sequence the longer one contains, ignoring order.
 *
 * Two candidate sequences that are the same activity with a shifted boundary
 * have a low symmetric ratio but a high overlap, and it is the overlap that
 * decides whether they are one workflow or two.
 */
export function overlapRatio(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  return lcsLength(a, b) / Math.min(a.length, b.length);
}

function lcsLength(a: readonly string[], b: readonly string[]): number {
  const prev = new Array<number>(b.length + 1).fill(0);
  const curr = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = 0;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/** Position-wise majority vote across aligned occurrences. */
function consensusSequence(
  seed: string[],
  occurrences: readonly Occurrence[],
  streams: readonly SessionTokens[],
): string[] {
  const votes: string[][] = seed.map(() => []);
  for (const occurrence of occurrences) {
    const stream = streams.find((s) => s.session.id === occurrence.sessionId);
    if (!stream) continue;
    const window = stream.tokens.slice(occurrence.startIndex, occurrence.endIndex);
    for (const [pos, token] of alignToSeed(window, seed)) votes[pos].push(token);
  }
  return seed.map((token, pos) => {
    const tally = new Map<string, number>();
    for (const t of votes[pos]) tally.set(t, (tally.get(t) ?? 0) + 1);
    let best = token;
    let bestCount = 0;
    for (const [t, count] of tally) {
      if (count > bestCount || (count === bestCount && t === token)) {
        best = t;
        bestCount = count;
      }
    }
    return best;
  });
}

/** Maps each token of `window` to the seed position it matched, via LCS. */
export function alignToSeed(
  window: readonly string[],
  seed: readonly string[],
): [number, string][] {
  return alignToSeedIndices(window, seed).map(([pos, , token]) => [pos, token]);
}

/**
 * Same LCS alignment, but keeps the index inside `window` as well, so callers
 * can map a canonical step position back to a concrete observed event.
 */
export function alignToSeedIndices(
  window: readonly string[],
  seed: readonly string[],
): [seedPos: number, windowIndex: number, token: string][] {
  const m = window.length;
  const n = seed.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = window[i] === seed[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: [number, number, string][] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (window[i] === seed[j]) {
      out.push([j, i, window[i]]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return out;
}

export function placeholdersOf(occurrences: readonly Occurrence[]): Placeholder[] {
  return mergePlaceholders(occurrences.map((o) => o.placeholders));
}
