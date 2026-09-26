import { describe, expect, it } from 'vitest';
import type { Condition, Step } from '@workflowos/core';
import { extractOutputs, evaluateConditions, renderInputs, renderTemplate } from '@workflowos/execution';

const condition: Condition = {
  id: 'c1',
  description: 'record must exist',
  when: { variable: 'v_record_id' },
  operator: 'not_empty',
  stepId: 'step_next',
  onFail: 'escalate',
};

describe('renderTemplate', () => {
  it('substitutes known variables and leaves unknown ones visible', () => {
    expect(renderTemplate('{{a}}/{{b}}', { a: '1' })).toBe('1/{{b}}');
  });

  it('treats an empty value as unbound so the gap stays obvious', () => {
    expect(renderTemplate('{{a}}', { a: '' })).toBe('{{a}}');
  });

  it('renders every step input at once', () => {
    expect(renderInputs({ field: '{{v}}', keep: 'static' }, { v: 'typed' })).toEqual({
      field: 'typed',
      keep: 'static',
    });
  });
});

describe('evaluateConditions', () => {
  it('passes when the guarded value is present', () => {
    expect(evaluateConditions([condition], 'step_next', { v_record_id: 'cus-1' })).toEqual([
      { action: 'pass' },
    ]);
  });

  it('fails and escalates when a lookup produced nothing', () => {
    const outcomes = evaluateConditions([condition], 'step_next', {});
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].action).toBe('fail');
    expect(outcomes[0].action === 'fail' && outcomes[0].condition.onFail).toBe('escalate');
  });

  it('ignores conditions that guard a different step', () => {
    expect(evaluateConditions([condition], 'step_other', {})).toEqual([]);
  });
});

describe('extractOutputs', () => {
  const step: Step = {
    id: 's1',
    action: 'click',
    label: 'Open record',
    target: { appId: 'crm', appKind: 'web', selectorCandidates: [] },
    inputs: {},
    outputs: { recordId: 'v_record_id' },
    risk: 'read',
    resolveTier: ['web-semantic'],
    confidence: 1,
    evidence: [],
    timeoutMs: 1_000,
    retries: 0,
    sourceTokenIndex: 0,
  };

  it('reads the record id back out of the url the step navigated to', () => {
    expect(extractOutputs(step, { url: 'http://127.0.0.1:1/customers/cus-1001' })).toEqual({
      recordId: 'cus-1001',
    });
  });

  it('produces nothing when the step landed somewhere that is not a record', () => {
    expect(extractOutputs(step, { url: 'http://127.0.0.1:1/customers?q=zzz' })).toEqual({});
  });

  it('produces nothing for a step that declared no outputs', () => {
    expect(extractOutputs({ ...step, outputs: undefined }, { url: '/customers/cus-1' })).toEqual({});
  });
});
