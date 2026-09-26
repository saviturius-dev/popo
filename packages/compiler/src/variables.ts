import type {
  ActivityEvent,
  Condition,
  PlaceholderKind,
  Step,
  TargetBinding,
  Variable,
} from '@workflowos/core';
import type { AlignedStep } from './steps.js';

const KIND_TO_TYPE: Record<PlaceholderKind, Variable['type']> = {
  email: 'email',
  num: 'number',
  date: 'date',
  id: 'string',
  path: 'string',
  url: 'url',
  text: 'string',
};

export interface VariableExtraction {
  variables: Variable[];
  /** Consensus position of a step -> the variable name that step captures. */
  byStepIndex: Map<number, string>;
  /** Template value for a step's primary input, e.g. `{{v_email_1}}`. */
  inputTemplateByStepIndex: Map<number, string>;
}

/**
 * Turns observed placeholder spans into named workflow variables.
 *
 * Names are derived from the placeholder kind and a per-kind counter, so the
 * same trace always yields the same variable names — which is what lets a
 * generated workflow be compared against a golden manifest.
 */
export function extractVariables(aligned: readonly AlignedStep[]): VariableExtraction {
  const variables: Variable[] = [];
  const byStepIndex = new Map<number, string>();
  const inputTemplateByStepIndex = new Map<number, string>();
  const counters = new Map<PlaceholderKind, number>();

  for (const step of aligned) {
    if (step.events.length === 0) continue;
    const observations = step.events
      .map((event) => ({ event, placeholders: step.placeholdersFor(event) }))
      .filter((o) => o.placeholders.length > 0);
    if (observations.length === 0) continue;

    const kind = observations[0].placeholders[0].kind;
    const next = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, next);
    const name = `v_${kind}_${next}`;

    const examples: string[] = [];
    for (const observation of observations) {
      const value = observation.placeholders[0].example;
      if (value && !examples.includes(value)) examples.push(value);
    }

    variables.push({
      name,
      description: describe(kind, step.representative),
      inferredFrom: `step:${step.index}:${step.representative.app.id}`,
      type: KIND_TO_TYPE[kind],
      required: observations.length === step.events.length,
      examples: examples.slice(0, 3),
      confidence: observations.length / Math.max(1, step.events.length),
    });

    byStepIndex.set(step.index, name);
    inputTemplateByStepIndex.set(step.index, `{{${name}}}`);
  }

  return { variables, byStepIndex, inputTemplateByStepIndex };
}

function describe(kind: PlaceholderKind, event: ActivityEvent): string {
  const where = event.element?.name ? `the "${event.element.name}" field` : 'the observed field';
  switch (kind) {
    case 'email':
      return `Email address typed into ${where}`;
    case 'num':
      return `Reference number typed into ${where}`;
    case 'date':
      return `Date value typed into ${where}`;
    case 'path':
      return `File path observed in ${where}`;
    case 'id':
      return `Identifier observed in ${where}`;
    default:
      return `Free text observed in ${where}`;
  }
}

export function lookupVariableName(binding: TargetBinding): string {
  const resource = binding.resourceHint?.split(':')[0] ?? 'record';
  const singular = resource.endsWith('s') ? resource.slice(0, -1) : resource;
  return `v_${singular}_id`;
}

export function buildLookupVariable(binding: TargetBinding, stepId: string): Variable {
  const name = lookupVariableName(binding);
  return {
    name,
    description: `Identifier of the ${binding.resourceHint?.split(':')[0] ?? 'record'} found by the lookup step`,
    inferredFrom: `step:${stepId}`,
    type: 'string',
    required: false,
    examples: binding.resourceHint ? [binding.resourceHint.split(':')[1] ?? ''] : [],
    confidence: 0.6,
  };
}

export function buildOutputVariable(step: Step, outputName: string): Variable {
  return {
    name: outputName,
    description: `Value produced by "${step.label}"`,
    inferredFrom: `step:${step.id}`,
    type: 'string',
    required: false,
    examples: [],
    confidence: 0.5,
  };
}

/**
 * Emits the guards the generated workflow needs to stay safe.
 *
 * Today that is the canonical "record not found" case from the spec: a lookup
 * step produces an id, and if it comes back empty the next step must not run.
 * A guard escalates to the user rather than failing silently, because the
 * correct recovery is a human decision.
 */
export function buildConditions(steps: readonly Step[]): Condition[] {
  const conditions: Condition[] = [];
  for (let i = 0; i < steps.length - 1; i++) {
    const step = steps[i];
    const next = steps[i + 1];
    for (const [outputKey, variableName] of Object.entries(step.outputs ?? {})) {
      // Only identifier-shaped outputs gate the rest of the workflow. A
      // missing attachment path is a recoverable step failure, not a reason to
      // stop and ask a human.
      if (!/id$/i.test(outputKey)) continue;
      conditions.push({
        id: `${step.id}__${outputKey}__guard`,
        description: `Continue only when the lookup in "${step.label}" produced a ${outputKey}`,
        when: { variable: variableName },
        operator: 'not_empty',
        stepId: next.id,
        onFail: 'escalate',
        message: `"${step.label}" did not find a matching record. Resolve it manually, then re-run.`,
      });
    }
  }
  return conditions;
}
