import type { ActivityEvent, Selector, TargetBinding } from '@workflowos/core';
import { selectorKey } from '@workflowos/discovery';

/**
 * Folds every observation of a step into one target binding.
 *
 * A candidate selector's weight is the fraction of occurrences in which it was
 * observed, which is also the step's confidence: a target that was identical
 * every time is one we expect to resolve again on the next run.
 */
export function buildBinding(events: readonly ActivityEvent[]): {
  binding: TargetBinding;
  confidence: number;
  evidence: string[];
} {
  if (events.length === 0) {
    throw new Error('buildBinding requires at least one observed event');
  }
  const representative = pickRepresentative(events);

  const counts = new Map<string, { selector: Selector; count: number }>();
  for (const event of events) {
    for (const selector of event.element?.selectorCandidates ?? []) {
      const key = selectorKey(selector);
      const entry = counts.get(key);
      if (entry) entry.count++;
      else counts.set(key, { selector, count: 1 });
    }
  }

  const candidates = [...counts.values()]
    .map(({ selector, count }) => ({
      ...selector,
      name: selector.name ? normalizeLabel(selector.name) : undefined,
      textPattern: selector.textPattern ? normalizeLabel(selector.textPattern) : undefined,
      weight: count / events.length,
      evidence: `observed in ${count}/${events.length} occurrences`,
    }))
    .sort((a, b) => b.weight - a.weight || selectorKey(a).localeCompare(selectorKey(b)));

  const evidence = [
    `${events.length} observed occurrence(s) of this step`,
    ...(representative.target?.url ? [`url: ${representative.target.url}`] : []),
    ...(representative.element?.name ? [`control: ${representative.element.name}`] : []),
  ];

  return {
    binding: {
      appId: representative.app.id,
      appKind: representative.app.kind,
      urlPattern: representative.target?.url ? urlToPattern(representative.target.url) : undefined,
      windowTitlePattern: representative.target?.windowTitle
        ? normalizeLabel(representative.target.windowTitle)
        : undefined,
      selectorCandidates: candidates,
      resourceHint: resourceHintFor(representative),
    },
    confidence: candidates[0]?.weight ?? (representative.target?.url ? 1 : 0.5),
    evidence,
  };
}

function pickRepresentative(events: readonly ActivityEvent[]): ActivityEvent {
  // The most complete observation wins: an event that carried a selector is more
  // useful than one that did not.
  return [...events].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0];
}

function score(event: ActivityEvent): number {
  return (
    (event.element?.selectorCandidates?.length ?? 0) * 2 +
    (event.element?.name ? 1 : 0) +
    (event.element?.role ? 1 : 0) +
    (event.target?.url ? 1 : 0) +
    (event.value?.text ? 1 : 0)
  );
}

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

function urlToPattern(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname
      .split('/')
      .map((segment) => {
        if (/^\d+$/.test(segment)) return ':id';
        if (/^[0-9a-f-]{16,}$/i.test(segment)) return ':token';
        return segment;
      })
      .join('/');
    return `${parsed.origin}${path}`.replace(/\/+$/, '');
  } catch {
    return url;
  }
}

const RESOURCE_PATH =
  /\/(customers?|contacts?|accounts?|users?|records?|deals?|tickets?|orders?)\/([^/?#]+)/i;

function resourceHintFor(event: ActivityEvent): string | undefined {
  const url = event.target?.url;
  if (!url) return undefined;
  const match = RESOURCE_PATH.exec(url);
  if (!match) return undefined;
  return `${match[1].toLowerCase()}:${match[2]}`;
}
