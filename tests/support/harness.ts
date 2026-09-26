import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ActivityEvent, LlmPort, WorkflowIR } from '@workflowos/core';
import { ReplaySource } from '@workflowos/ingest';
import { Orchestrator } from '@workflowos/orchestrator';
import { StaticLlm } from './stubLlm.js';

export const repoRoot = join(import.meta.dirname, '..', '..');
export const tracesDir = join(repoRoot, 'fixtures', 'traces');
export const manifestsDir = join(repoRoot, 'fixtures', 'manifests');

/**
 * The model every golden and end-to-end test uses.
 *
 * It supplies the human-facing interpretation and nothing else. Step labels are
 * left empty on purpose so the compiler falls back to its deterministic
 * heuristic labels, which means the manifest pins real behaviour rather than
 * the stub's own output.
 */
export function goldenLlm(): LlmPort {
  return new StaticLlm({
    name: 'Process Customer Request',
    intent: 'Repeatedly handle an inbound customer request end to end.',
    trigger: {
      type: 'event',
      description: 'A new message appears in the mailbox',
      eventMatch: { appId: 'gmail', action: 'navigate' },
    },
    stepLabels: [],
  });
}

export async function loadTrace(traceId: string, file: string): Promise<ActivityEvent[]> {
  const events: ActivityEvent[] = [];
  await new ReplaySource({ traceId, path: join(tracesDir, file) }).start((event) => {
    events.push(event);
  });
  return events;
}

export function traceFile(name: string): string {
  return join(tracesDir, `${name}.jsonl`);
}

export function createHarness(llm: LlmPort = goldenLlm()): Orchestrator {
  return Orchestrator.create({ llm, reviewTimeoutMs: 5_000 });
}

/** Reduced, comparable view of a workflow for a golden manifest. */
export function summariseWorkflow(workflow: WorkflowIR) {
  return {
    name: workflow.name,
    risk: workflow.risk,
    status: workflow.status,
    degraded: workflow.degraded,
    trigger: { type: workflow.trigger.type, description: workflow.trigger.description },
    variables: workflow.variables.map((v) => ({ name: v.name, type: v.type, required: v.required })),
    steps: workflow.steps.map((step) => ({
      action: step.action,
      label: step.label,
      app: step.target.appId,
      risk: step.risk,
      resolveTier: step.resolveTier,
      confidence: round(step.confidence),
      inputs: step.inputs,
      outputs: step.outputs ?? {},
      selector: step.target.selectorCandidates[0]
        ? `${step.target.selectorCandidates[0].strategy}:${step.target.selectorCandidates[0].role ?? ''}:${step.target.selectorCandidates[0].name ?? ''}`
        : null,
    })),
    conditions: workflow.conditions.map((c) => ({
      operator: c.operator,
      onFail: c.onFail,
      when: c.when,
    })),
  };
}

export function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function readManifest(name: string): unknown {
  return JSON.parse(readFileSync(join(manifestsDir, `${name}.json`), 'utf8'));
}
