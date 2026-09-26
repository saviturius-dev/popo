import type { ActivityEvent, NormalizedEvent } from '@workflowos/core';
import { alignToSeedIndices, normalizeEvent, type SessionTokens } from '@workflowos/discovery';

/**
 * One canonical workflow step, materialised from every observation that aligned
 * to the same position in the candidate's token sequence.
 */
export interface AlignedStep {
  /** Position in the candidate's consensus token sequence. */
  index: number;
  events: ActivityEvent[];
  representative: ActivityEvent;
  /** How many occurrences contributed an event at this position. */
  votes: number;
  token: string;
  placeholdersFor(event: ActivityEvent): PlaceholderSummary[];
}

export interface PlaceholderSummary {
  name: string;
  kind: NormalizedEvent['placeholders'][number]['kind'];
  example: string;
  confidence: number;
}

const PLACEHOLDER_CACHE = new WeakMap<ActivityEvent, NormalizedEvent>();

function normalizedFor(event: ActivityEvent): NormalizedEvent {
  const cached = PLACEHOLDER_CACHE.get(event);
  if (cached) return cached;
  const normalized = normalizeEvent(event);
  PLACEHOLDER_CACHE.set(event, normalized);
  return normalized;
}

/**
 * Projects the candidate's occurrences back onto the consensus sequence.
 *
 * Alignment is LCS-based, so an occurrence that had an extra click still
 * contributes to the positions it does match, and a position nobody ever
 * produced simply gets zero votes and is dropped.
 */
export function alignCandidate(
  consensus: readonly string[],
  streams: readonly SessionTokens[],
  occurrences: readonly {
    sessionId: string;
    startIndex: number;
    endIndex: number;
  }[],
): AlignedStep[] {
  const streamsById = new Map(streams.map((s) => [s.session.id, s]));
  const buckets = new Map<number, ActivityEvent[]>();

  for (const occurrence of occurrences) {
    const stream = streamsById.get(occurrence.sessionId);
    if (!stream) continue;
    const window = stream.tokens.slice(occurrence.startIndex, occurrence.endIndex);
    for (const [seedPos, windowIndex] of alignToSeedIndices(window, consensus)) {
      const event = stream.events[occurrence.startIndex + windowIndex];
      if (!event) continue;
      const list = buckets.get(seedPos) ?? [];
      list.push(event);
      buckets.set(seedPos, list);
    }
  }

  const steps: AlignedStep[] = [];
  for (const [index, events] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    if (events.length === 0) continue;
    const representative = [...events].sort(
      (a, b) => scoreEvent(b) - scoreEvent(a) || a.id.localeCompare(b.id),
    )[0];
    steps.push({
      index,
      events,
      representative,
      votes: events.length,
      token: consensus[index],
      placeholdersFor: (event) => {
        const normalized = normalizedFor(event);
        // Only the primary variable drives the workflow's inputs: a typed value
        // with several structured spans is still one thing the user entered.
        if (!normalized.primary) return [];
        return [
          {
            name: normalized.primary.name,
            kind: normalized.primary.kind,
            example: normalized.primary.example,
            confidence: normalized.primary.confidence,
          },
        ];
      },
    });
  }

  return steps;
}

function scoreEvent(event: ActivityEvent): number {
  return (
    (event.element?.selectorCandidates?.length ?? 0) * 2 +
    (event.element?.name ? 1 : 0) +
    (event.element?.role ? 1 : 0) +
    (event.target?.url ? 1 : 0) +
    (event.value?.text ? 1 : 0)
  );
}
