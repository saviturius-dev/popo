import type { ActivityEvent, Session } from '@workflowos/core';
import { hashId } from '@workflowos/core';

export interface SessionizeOptions {
  traceId: string;
  /** A gap longer than this ends the current session. */
  idleGapMs?: number;
  /** A gap longer than this is a hard break even inside an active session. */
  sessionBreakMs?: number;
}

export const DEFAULT_IDLE_GAP_MS = 90_000;
export const DEFAULT_SESSION_BREAK_MS = 30 * 60_000;

/**
 * Splits a raw event stream into candidate tasks.
 *
 * Two thresholds rather than one: a long pause means the user stopped working,
 * but a very long pause (lunch, overnight) must not silently merge two
 * unrelated work stretches into a single "session".
 */
export function sessionize(
  events: readonly ActivityEvent[],
  options: SessionizeOptions,
): Session[] {
  const idleGap = options.idleGapMs ?? DEFAULT_IDLE_GAP_MS;
  const sessionBreak = options.sessionBreakMs ?? DEFAULT_SESSION_BREAK_MS;

  const ordered = [...events].sort((a, b) => a.ts - b.ts || a.seq - b.seq);
  const sessions: Session[] = [];
  let current: ActivityEvent[] = [];

  const flush = () => {
    if (current.length === 0) return;
    sessions.push(buildSession(current, options.traceId, sessions.length));
    current = [];
  };

  for (const event of ordered) {
    if (event.action.type === 'idle') {
      // Idle events are boundaries, not steps.
      flush();
      continue;
    }
    const previous = current[current.length - 1];
    if (previous) {
      const gap = event.ts - previous.ts;
      if (gap > idleGap || gap > sessionBreak) flush();
    }
    current.push(event);
  }
  flush();

  return sessions;
}

function buildSession(events: ActivityEvent[], traceId: string, index: number): Session {
  const appChain: string[] = [];
  for (const e of events) {
    if (appChain[appChain.length - 1] !== e.app.id) appChain.push(e.app.id);
  }
  return {
    id: hashId('sess', traceId, index, events[0]?.id ?? ''),
    traceId,
    startTs: events[0].ts,
    endTs: events[events.length - 1].ts,
    eventIds: events.map((e) => e.id),
    appChain,
  };
}
