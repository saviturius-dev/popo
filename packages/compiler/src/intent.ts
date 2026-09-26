import { z } from 'zod';
import type { ActivityEvent, LlmPort } from '@workflowos/core';
import type { AlignedStep } from './steps.js';

export const interpretationSchema = z.object({
  name: z
    .string()
    .min(3)
    .max(60)
    .describe('Short gerund name for the workflow, e.g. "Process Customer Request".'),
  intent: z
    .string()
    .min(10)
    .max(400)
    .describe('One or two sentences describing what the user is trying to accomplish.'),
  trigger: z.object({
    type: z.enum(['event', 'manual']),
    description: z.string().min(3).max(200),
    eventMatch: z
      .object({
        appId: z.string().optional(),
        action: z.string().optional(),
        urlPattern: z.string().optional(),
        subjectContains: z.string().optional(),
      })
      .optional(),
  }),
  stepLabels: z
    .array(z.string().min(2).max(80))
    .describe('A short imperative label per observed step, in order.'),
});

export type Interpretation = z.infer<typeof interpretationSchema>;

const SYSTEM_PROMPT = `You interpret observed desktop activity as business workflow intent.

You are given a repeated sequence of user actions across applications, already normalised so that
volatile values appear as placeholders such as <email>, <num>, <id> or <text>.

Rules:
- Name the workflow after the user's goal, not the applications. "Process Customer Request" is good;
  "Gmail then Salesforce" is not.
- The trigger must be the earliest observable event in the sequence if that event can be detected
  externally (for example a new email arriving); otherwise use "manual".
- Labels must be imperative and concrete, one per step, in the same order as the steps.
- Never invent steps, applications, or values that are not in the input.`;

export interface InterpretInput {
  steps: readonly AlignedStep[];
  appChain: readonly string[];
  occurrenceCount: number;
  tokens: readonly string[];
}

export function buildInterpretPrompt(input: InterpretInput): string {
  const lines = input.steps.map((step, i) => {
    const e = step.representative;
    const control = e.element?.name ? `${e.element.role ?? 'element'} "${e.element.name}"` : 'no control';
    const value = e.value?.text ? ` value=${e.value.text}` : '';
    const url = e.target?.url ? ` url=${e.target.url}` : '';
    return `${i + 1}. [${e.app.name}] ${e.action.type} -> ${control}${value}${url}`;
  });

  return [
    `Observed ${input.occurrenceCount} time(s) across applications: ${input.appChain.join(' -> ')}.`,
    '',
    'Steps in order:',
    ...lines,
    '',
    'Normalised token sequence:',
    input.tokens.join('\n'),
  ].join('\n');
}

export interface InterpretResult extends Interpretation {
  degraded: boolean;
  fallbackReason?: string;
}

/**
 * Asks the model for the human-facing half of the workflow: its name, its
 * intent, its trigger, and a label per step. Everything mechanical (bindings,
 * variables, risk, tiers) is computed deterministically elsewhere.
 */
export async function interpret(
  llm: LlmPort,
  input: InterpretInput,
  fixtureKey: string,
): Promise<InterpretResult> {
  try {
    const response = await llm.complete({
      system: SYSTEM_PROMPT,
      prompt: buildInterpretPrompt(input),
      schema: interpretationSchema,
      fixtureKey,
      maxTokens: 1500,
    });
    return { ...(response.value as Interpretation), degraded: response.degraded };
  } catch (cause) {
    return {
      ...heuristicInterpretation(input),
      degraded: true,
      fallbackReason: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/**
 * The deterministic interpretation used when no model is available. It is
 * intentionally literal: it describes what was observed and makes no claim
 * about the business meaning.
 */
export function heuristicInterpretation(input: InterpretInput): Interpretation {
  const labels = input.steps.map((step) => heuristicLabel(step.representative));
  const primary = input.steps.find(
    (s) => s.representative.action.type === 'submit' || s.representative.action.type === 'keypress',
  );
  const anchor = primary ?? input.steps[input.steps.length - 1];
  const apps = [...new Set(input.steps.map((s) => s.representative.app.name))];

  return {
    name: anchor ? titleCase(stripQuotes(anchor.representative.element?.name ?? anchor.representative.app.name)) : 'Observed Workflow',
    intent: `Repeated ${input.occurrenceCount} time(s): ${labels.join(', ')}. Involves ${apps.join(', ')}. Compiled from observed activity without model interpretation.`,
    trigger: heuristicTrigger(input.steps),
    stepLabels: labels,
  };
}

export function heuristicTrigger(steps: readonly AlignedStep[]): Interpretation['trigger'] {
  const first = steps[0]?.representative;
  if (first && looksLikeInbox(first)) {
    return {
      type: 'event',
      description: `A new item appears in ${first.app.name}`,
      eventMatch: {
        appId: first.app.id,
        action: first.action.type,
        urlPattern: first.target?.url ? new URL(first.target.url).pathname : undefined,
      },
    };
  }
  return {
    type: 'manual',
    description: 'Run on demand from the WorkFlowOS dashboard',
  };
}

const MAIL_HINT = /mail|gmail|outlook|inbox|message/i;

function looksLikeInbox(event: ActivityEvent): boolean {
  const haystack = `${event.app.id} ${event.app.name} ${event.target?.url ?? ''}`;
  return MAIL_HINT.test(haystack);
}

const ACTION_VERB: Record<string, string> = {
  navigate: 'Open',
  click: 'Click',
  type: 'Type into',
  select: 'Select in',
  download: 'Download from',
  submit: 'Submit',
  keypress: 'Press',
  launch: 'Launch',
  focus: 'Switch to',
  copy: 'Copy from',
  idle: 'Wait',
};

export function heuristicLabel(event: ActivityEvent): string {
  const verb = ACTION_VERB[event.action.type] ?? 'Interact with';
  const control = event.element?.name ?? event.target?.windowTitle ?? event.target?.url;
  if (!control) return verb;
  return `${verb} "${control}"`;
}

function stripQuotes(text: string): string {
  return text.replace(/^["']|["']$/g, '');
}

function titleCase(text: string): string {
  return text.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
