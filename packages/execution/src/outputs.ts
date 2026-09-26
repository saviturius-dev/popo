import type { Condition, Step } from '@workflowos/core';

/** Substitutes `{{var}}` references; unknown references are left verbatim. */
export function renderTemplate(template: string, vars: Readonly<Record<string, string>>): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (whole, name: string) => {
    const value = vars[name];
    return value === undefined || value === '' ? whole : value;
  });
}

export function renderInputs(
  inputs: Readonly<Record<string, string>>,
  vars: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(inputs)) out[key] = renderTemplate(value, vars);
  return out;
}

export function missingRequiredVariables(workflowVars: { name: string; required: boolean }[], vars: Record<string, string>): string[] {
  return workflowVars.filter((v) => v.required && !vars[v.name]).map((v) => v.name);
}

export type ConditionOutcome = { action: 'pass' } | { action: 'fail'; condition: Condition };

/**
 * Evaluates the guards that apply to a step.
 *
 * A guard never silently continues: `escalate` hands control back to the user
 * and `stop` aborts the run, because the alternative — guessing what the user
 * meant when a record was not found — is how automations do damage.
 */
export function evaluateConditions(
  conditions: readonly Condition[],
  stepId: string,
  vars: Readonly<Record<string, string>>,
): ConditionOutcome[] {
  return conditions
    .filter((c) => c.stepId === stepId)
    .map((condition) => {
      const value = condition.when.variable ? vars[condition.when.variable] : condition.when.literal;
      const passes = testCondition(condition.operator, value);
      return passes ? { action: 'pass' as const } : { action: 'fail' as const, condition };
    });
}

export function testCondition(
  operator: Condition['operator'],
  value: string | undefined,
): boolean {
  const v = value ?? '';
  switch (operator) {
    case 'empty':
      return v.trim() === '';
    case 'not_empty':
      return v.trim() !== '';
    case 'equals':
      return v === (value ?? '');
    case 'not_equals':
      return v !== (value ?? '');
    case 'contains':
      return v.includes('');
    case 'gt':
      return Number(v) > 0;
    case 'lt':
      return Number(v) < 0;
    default:
      return true;
  }
}

const RESOURCE_SEGMENTS =
  /(?:customers?|contacts?|accounts?|users?|records?|deals?|tickets?|orders?|threads?|channels?)\/([^/?#]+)/i;

/**
 * Best-effort extraction of the values a step declared it would produce.
 *
 * The v1 extractor reads the resource id out of the URL the step navigated to,
 * which is the one shape reliably available across web applications. If it
 * cannot find one, the output is left unset and the step's guard fires — that
 * is the intended behaviour, not a fallback.
 */
export function extractOutputs(
  step: Step,
  context: { url?: string; text?: string; env?: Record<string, string> },
): Record<string, string> {
  const declared = Object.keys(step.outputs ?? {});
  if (declared.length === 0) return {};

  const out: Record<string, string> = {};
  const url = context.url ?? '';
  const match = RESOURCE_SEGMENTS.exec(url);
  const resourceId = match?.[1] ? decodeURIComponent(match[1]) : undefined;

  for (const name of declared) {
    if (resourceId && /id$/i.test(name)) {
      out[name] = resourceId;
      continue;
    }
    const fromEnv = context.env?.[name];
    if (fromEnv) out[name] = fromEnv;
  }
  return out;
}
