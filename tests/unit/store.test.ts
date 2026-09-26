import { describe, expect, it } from 'vitest';
import type { ActivityEvent, WorkflowIR } from '@workflowos/core';
import { WORKFLOW_IR_VERSION } from '@workflowos/core';
import { migrate, openDb, Store } from '@workflowos/store';

function event(id: string, seq: number): ActivityEvent {
  return {
    id,
    seq,
    ts: 1_767_225_600_000 + seq * 1_000,
    app: { id: 'crm', name: 'CRM', kind: 'web' },
    action: { type: 'click' },
    source: 'replay',
  };
}

function workflow(): WorkflowIR {
  return {
    version: WORKFLOW_IR_VERSION,
    id: 'wf_1',
    name: 'Process Customer Request',
    intent: 'test',
    traceIds: ['t'],
    trigger: { type: 'manual', description: 'manual' },
    variables: [{ name: 'v_email_1', description: '', inferredFrom: '', type: 'email', required: true, examples: [], confidence: 1 }],
    steps: [],
    conditions: [],
    risk: 'write',
    status: 'candidate',
    candidateId: 'cand_1',
    degraded: false,
    createdAt: 1,
    updatedAt: 1,
    reliability: 0,
    revision: 1,
  };
}

describe('Store', () => {
  it('migrates an empty database and reports the applied migrations', () => {
    const db = openDb({});
    // Counted against the migration list rather than a literal, so adding a
    // migration is not a test failure.
    expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()).toEqual({
      n: migrate(db).length,
    });
    expect(migrate(db).length).toBeGreaterThan(0);
    db.close();
  });

  it('round-trips an event with its nested structure intact', () => {
    const store = new Store(openDb({}));
    const original: ActivityEvent = {
      ...event('e1', 0),
      target: { url: 'http://crm.mock/customers' },
      element: { role: 'button', name: 'Update record' },
      value: { text: 'hello' },
    };
    store.events.insertMany([original], 'trace');

    const [restored] = store.events.listByTrace('trace');
    expect(restored).toEqual(original);
    expect(store.events.traceIds()).toEqual(['trace']);
    store.close();
  });

  it('keeps every workflow revision for audit', () => {
    const store = new Store(openDb({}));
    store.workflows.upsert(workflow(), 'compiler');
    const approved = store.workflows.setStatus('wf_1', 'approved', 2);

    expect(approved.revision).toBe(2);
    expect(store.workflows.versions('wf_1').map((v) => v.revision)).toEqual([1, 2]);
    expect(store.workflows.versions('wf_1')[1].changedBy).toBe('status:approved');
    store.close();
  });

  it('accumulates rejection weight so a declined pattern stops resurfacing', () => {
    const store = new Store(openDb({}));
    expect(store.feedback.getWeight()).toBe(0);
    store.feedback.addWeight(0.15);
    store.feedback.addWeight(0.15);
    expect(store.feedback.getWeight()).toBeCloseTo(0.3);
    store.close();
  });

  it('rolls a failed transaction back instead of leaving it half applied', () => {
    const db = openDb({});
    const store = new Store(db);
    const apply = db.transaction(() => {
      store.events.insertMany([event('e1', 0)], 'trace');
      throw new Error('boom');
    });
    expect(apply).toThrow('boom');
    expect(store.events.countByTrace('trace')).toBe(0);
    store.close();
  });
});
