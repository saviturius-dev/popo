import { describe, expect, it } from 'vitest';
import type { ActivityEvent } from '@workflowos/core';
import { sessionize } from '@workflowos/discovery';

const base = 1_767_225_600_000;

function event(index: number, offsetMs: number, app = 'crm'): ActivityEvent {
  return {
    id: `e${index}`,
    seq: index,
    ts: base + offsetMs,
    app: { id: app, name: app, kind: 'web' },
    action: { type: 'click' },
    source: 'replay',
  };
}

describe('sessionize', () => {
  it('keeps a burst of activity in one session', () => {
    const sessions = sessionize([event(0, 0), event(1, 5_000), event(2, 12_000)], {
      traceId: 't',
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].eventIds).toEqual(['e0', 'e1', 'e2']);
  });

  it('splits when the user pauses longer than the idle threshold', () => {
    const sessions = sessionize([event(0, 0), event(1, 200_000)], { traceId: 't' });
    expect(sessions).toHaveLength(2);
  });

  it('treats an idle event as a boundary rather than a step', () => {
    const idle: ActivityEvent = { ...event(1, 10_000), action: { type: 'idle' } };
    const sessions = sessionize([event(0, 0), idle, event(2, 11_000)], { traceId: 't' });
    expect(sessions).toHaveLength(2);
    expect(sessions[0].eventIds).toEqual(['e0']);
  });

  it('records the application chain in order, including revisits', () => {
    const sessions = sessionize(
      [event(0, 0, 'gmail'), event(1, 1_000, 'crm'), event(2, 2_000, 'gmail'), event(3, 3_000, 'slack')],
      { traceId: 't' },
    );
    expect(sessions[0].appChain).toEqual(['gmail', 'crm', 'gmail', 'slack']);
  });

  it('orders by timestamp rather than trusting the sequence field', () => {
    const outOfOrder = [event(0, 20_000), event(1, 10_000)];
    const sessions = sessionize(outOfOrder, { traceId: 't' });
    expect(sessions[0].eventIds).toEqual(['e1', 'e0']);
  });
});
