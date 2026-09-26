import type { Feedback, RunRecord, WorkflowIR } from '@workflowos/core';
import { createIdFactory } from '@workflowos/core';
import { demoteTier, promoteSelector } from '@workflowos/compiler';
import type { RunOutcome } from '@workflowos/execution';
import type { Store } from '@workflowos/store';

export interface LearningReport {
  reliability: number;
  promotedSelectors: string[];
  demotedTiers: string[];
  feedback: Feedback;
  notes: string[];
}

/**
 * Closes the loop.
 *
 * Learning here is not model training — it is the workflow's own record being
 * used to change its next run: selector weights move toward whatever resolved,
 * a mechanism that keeps failing is pushed down the ladder, and the workflow's
 * reliability becomes an empirical number the user can see and distrust.
 */
export function learnFromRun(
  store: Store,
  workflow: WorkflowIR,
  outcome: RunOutcome,
  now = Date.now(),
): LearningReport {
  const notes: string[] = [];
  const promotedSelectors: string[] = [];
  const demotedTiers: string[] = [];
  const effects: string[] = [];

  let steps = workflow.steps;

  for (const healed of outcome.healedSelectors) {
    const index = steps.findIndex((s) => s.id === healed.stepId);
    if (index < 0) continue;
    steps = steps.map((s, i) => (i === index ? promoteSelector(s, healed.selector) : s));
    promotedSelectors.push(healed.stepId);
    effects.push(`boosted healed selector on ${healed.stepId}`);
    notes.push(`Binding for step ${healed.stepId} was healed; its selector weight is now higher.`);
  }

  for (const failure of outcome.failedTiers) {
    const index = steps.findIndex((s) => s.id === failure.stepId);
    if (index < 0) continue;
    steps = steps.map((s, i) => (i === index ? demoteTier(s, failure.tier) : s));
    demotedTiers.push(`${failure.stepId}:${failure.tier}`);
    effects.push(`demoted ${failure.tier} on ${failure.stepId}`);
    notes.push(`${failure.tier} failed on step ${failure.stepId}; it is now tried later.`);
  }

  const reliabilities = steps.map((step) => stepReliability(store, step.id));
  const reliability =
    reliabilities.length === 0
      ? 0
      : reliabilities.reduce((a, b) => a + b, 0) / reliabilities.length;

  const nextWorkflow: WorkflowIR = { ...workflow, steps, updatedAt: now };
  store.workflows.saveSteps(nextWorkflow, now);
  store.workflows.setReliability(workflow.id, reliability, now);

  const feedback: Feedback = {
    id: createIdFactory('fb', now)(),
    kind: promotedSelectors.length > 0 ? 'binding-heal' : 'correction',
    workflowId: workflow.id,
    runId: outcome.run.id,
    createdAt: now,
    note: summarize(outcome.run),
    appliedEffects: effects,
  };
  store.feedback.insert(feedback);

  return { reliability, promotedSelectors, demotedTiers, feedback, notes };
}

/** Empirical success rate for a step, straight from the run journal. */
export function stepReliability(store: Store, stepId: string): number {
  const stats = store.runs.stepStats(stepId);
  const decided = stats.successes + stats.failures;
  return decided === 0 ? 0 : stats.successes / decided;
}

function summarize(run: RunRecord): string {
  const succeeded = run.steps.filter((s) => s.status === 'succeeded').length;
  const failed = run.steps.filter((s) => s.status === 'failed').length;
  return `run ${run.id} ${run.status}: ${succeeded} succeeded, ${failed} failed`;
}
