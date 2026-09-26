import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunRecord, Step, StepRun, WorkflowIR } from '@workflowos/core';
import { ReplaySource } from '@workflowos/ingest';
import { Orchestrator } from '@workflowos/orchestrator';
import { startMockApps, type MockApps } from '@workflowos/mock-apps';
import { goldenLlm, traceFile } from '../support/harness.js';

const TRACE = 'a-customer-request-clean';
const EMAIL = 'priya.nair@northwind.example';
const NOTES = 'Refund approved for order 10001';
const ATTACHMENT = 'invoice-dispute-10001.pdf';
const SLACK_TEXT = 'Handled request from priya.nair@northwind.example';

const VARIABLES = {
  v_email_1: EMAIL,
  v_text_1: NOTES,
  v_text_2: ATTACHMENT,
  v_text_3: SLACK_TEXT,
};

interface SlackState {
  messages: { id: string; channel: string; text: string }[];
}
interface CrmState {
  customers: { id: string; notes: string; attachment: string; updatedAt: number | null }[];
}

let mock: MockApps;
let downloadDir: string;
let orchestrator: Orchestrator;

/**
 * Stands in for the dashboard.
 *
 * Answering gates is the whole point of the human-in-the-loop design, so these
 * tests drive the same entry point the UI does rather than reaching past it.
 */
function answerGates(
  decide: (event: { kind: string }) => 'confirmed' | 'cancelled' = () => 'confirmed',
): () => void {
  return orchestrator.bus.subscribe((event) => {
    if (event.type !== 'review.created') return;
    // Workflow approval is driven explicitly by the test, never auto-answered.
    if (event.kind === 'workflow-approval') return;
    orchestrator.respondToReview(event.requestId, { resolution: decide(event) });
  });
}

async function approvedWorkflow(): Promise<WorkflowIR> {
  const result = await orchestrator.ingest(
    new ReplaySource({ traceId: TRACE, path: traceFile(TRACE) }),
    { minSupport: 3 },
  );
  expect(result.candidates).toHaveLength(1);
  const workflow = result.workflows[0];
  orchestrator.approveWorkflow(workflow.id);
  return orchestrator.store.workflows.get(workflow.id)!;
}

async function crmState(): Promise<CrmState> {
  return (await (await fetch(`${mock.crm.url}/api/state`)).json()) as CrmState;
}

async function slackState(): Promise<SlackState> {
  return (await (await fetch(`${mock.slack.url}/api/state`)).json()) as SlackState;
}

function findStep(workflow: WorkflowIR, appId: string, label: string): Step {
  const step = workflow.steps.find((s) => s.target.appId === appId && s.label.includes(label));
  if (!step) throw new Error(`no step for ${appId} / ${label}`);
  return step;
}

function stepRunFor(run: RunRecord, step: Step): StepRun {
  const stepRun = run.steps.find((s) => s.stepId === step.id);
  if (!stepRun) throw new Error(`no run record for ${step.label}`);
  return stepRun;
}

/** Turns a run into a readable failure message instead of a bare status mismatch. */
function describeRun(run: RunRecord, workflow: WorkflowIR): string {
  const lines = run.log.map((entry) => `  [${entry.level}] ${entry.message}`);
  const steps = run.steps
    .filter((s) => s.status !== 'succeeded')
    .map((s) => {
      const label = workflow.steps.find((w) => w.id === s.stepId)?.label ?? s.stepId;
      return `  ${label}: ${s.status}${s.error ? ` (${s.error})` : ''}`;
    });
  return `run ${run.status}${run.error ? ` (${run.error})` : ''}\n${[...steps, ...lines].join('\n')}`;
}

beforeAll(async () => {
  mock = await startMockApps();
  downloadDir = await mkdtemp(join(tmpdir(), 'workflowos-e2e-'));
  orchestrator = Orchestrator.create({
    llm: goldenLlm(),
    headless: true,
    downloadDir,
    reviewTimeoutMs: 30_000,
  });
  orchestrator.registerEndpoints(mock.endpoints);
});

afterEach(async () => {
  await mock.reset();
});

afterAll(async () => {
  await orchestrator?.close();
  await mock?.close();
});

describe('observe to automation', () => {
  it('discovers the repeated workflow from a replayed trace and stops for approval', async () => {
    const stages: string[] = [];
    orchestrator.bus.subscribe((event) => {
      if (event.type === 'progress') stages.push((event.payload as { stage: string }).stage);
    });

    const result = await orchestrator.ingest(
      new ReplaySource({ traceId: TRACE, path: traceFile(TRACE) }),
      { minSupport: 3 },
    );

    expect(result.progress.stage).toBe('done');
    expect(result.progress.eventsIngested).toBe(65);
    expect(stages).toEqual(['ingest', 'sessionize', 'compile', 'done']);

    const candidate = result.candidates[0];
    expect(candidate.appChain).toEqual(['gmail', 'crm', 'slack']);
    expect(candidate.occurrences).toHaveLength(5);
    expect(candidate.score.total).toBeGreaterThan(0.9);

    const workflow = result.workflows[0];
    expect(workflow.status).toBe('candidate');
    expect(workflow.steps).toHaveLength(13);

    // The pipeline surfaces work; it does not authorise it.
    expect(orchestrator.store.reviews.listPending().map((r) => r.kind)).toContain('workflow-approval');
    await expect(orchestrator.startRun({ workflowId: workflow.id })).rejects.toThrow(/approve/i);
  });

  it('runs an approved workflow end to end against the mock applications', async () => {
    const workflow = await approvedWorkflow();
    expect(workflow.status).toBe('approved');

    const gates = answerGates();
    let run: RunRecord;
    try {
      const outcome = await orchestrator.startRun({ workflowId: workflow.id, variables: VARIABLES });
      run = outcome.run;

      expect(run.status, describeRun(run, workflow)).toBe('succeeded');
      expect(run.steps.every((step) => step.status === 'succeeded')).toBe(true);
      expect(run.log.filter((entry) => entry.level === 'error')).toEqual([]);
      expect(run.steps.every((step) => step.attempts === 1)).toBe(true);

      // The tier ladder ran, and the journal says which rung each step used.
      expect(stepRunFor(run, findStep(workflow, 'gmail', 'Download attachment')).tier).toBe(
        'app-integration',
      );
      expect(stepRunFor(run, findStep(workflow, 'slack', 'Send')).tier).toBe('api');
      expect(stepRunFor(run, findStep(workflow, 'crm', 'Update record')).tier).toBe('web-semantic');

      expect(run.partialEffects).toEqual(
        expect.arrayContaining([expect.stringContaining('Update record')]),
      );
      expect(orchestrator.store.runs.get(run.id)?.status).toBe('succeeded');
      expect(orchestrator.store.feedback.list(10).length).toBeGreaterThan(0);
    } finally {
      gates();
    }

    // The CRM record was updated by driving the browser, not by a shortcut.
    const customer = (await crmState()).customers.find((c) => c.id === 'cus-1001');
    expect(customer?.notes).toBe(NOTES);
    expect(customer?.attachment).toBe(ATTACHMENT);
    expect(customer?.updatedAt).toBeTypeOf('number');
    expect((await crmState()).customers.find((c) => c.id === 'cus-1002')?.notes).toBe('');

    // The attachment came through the mail integration, not a browser download.
    const downloaded = join(downloadDir, ATTACHMENT);
    expect((await stat(downloaded)).isFile()).toBe(true);
    expect(await readFile(downloaded, 'utf8')).toContain('mock invoice dispute attachment');

    // The notification went out through the messaging API.
    const slack = await slackState();
    expect(slack.messages).toHaveLength(1);
    expect(slack.messages[0]).toMatchObject({ channel: 'support', text: SLACK_TEXT });
  });

  it('stops at the first gate the user declines, leaving the world unchanged', async () => {
    const workflow = await approvedWorkflow();
    await mock.reset();

    let declined = false;
    const gates = orchestrator.bus.subscribe((event) => {
      if (declined || event.type !== 'review.created' || event.kind === 'workflow-approval') return;
      declined = true;
      orchestrator.respondToReview(event.requestId, { resolution: 'cancelled' });
    });

    try {
      const { run } = await orchestrator.startRun({ workflowId: workflow.id, variables: VARIABLES });

      expect(run.status, describeRun(run, workflow)).toBe('aborted');
      expect(run.abortReason).toMatch(/declined/);
      // The read-only navigation before the gate still happened.
      expect(run.steps.filter((s) => s.status === 'succeeded').length).toBeGreaterThan(0);
      expect(run.steps.filter((s) => s.status === 'skipped').length).toBeGreaterThan(0);
      expect(run.steps.every((s) => s.status !== 'failed')).toBe(true);
    } finally {
      gates();
    }

    expect((await crmState()).customers.every((c) => c.notes === '')).toBe(true);
    expect((await slackState()).messages).toHaveLength(0);
  });

  it('escalates an unresolvable target instead of guessing one', async () => {
    const workflow = await approvedWorkflow();
    await mock.reset();

    // Point a write step at a control that does not exist. The user still
    // approves the step; the run must then stop and ask rather than act on
    // whatever happens to be on the screen.
    const patched = orchestrator.updateWorkflow(workflow.id, {
      steps: workflow.steps.map((step) =>
        step.label.includes('Update record')
          ? {
              ...step,
              target: {
                ...step.target,
                selectorCandidates: [
                  { strategy: 'role-name' as const, role: 'button', name: 'Delete everything', weight: 1 },
                ],
              },
            }
          : step,
      ),
    });

    // Approve the write step, decline to pick a target when asked.
    const gates = answerGates((event) =>
      event.kind === 'binding-confirmation' ? 'cancelled' : 'confirmed',
    );
    try {
      const { run } = await orchestrator.startRun({ workflowId: patched.id, variables: VARIABLES });

      expect(run.status, describeRun(run, patched)).toBe('failed');
      const failed = stepRunFor(run, findStep(patched, 'crm', 'Update record'));
      expect(failed.status).toBe('failed');
      expect(failed.attempts).toBe(2);
      expect(failed.error).toMatch(/ambiguous_or_missing|Could not uniquely resolve/);
      expect(stepRunFor(run, findStep(patched, 'slack', 'Send')).status).toBe('skipped');
    } finally {
      gates();
    }

    // Nothing was written to the record and no message went out.
    const crm = await crmState();
    expect(crm.customers.every((c) => c.notes === '' && c.attachment === '')).toBe(true);
    expect((await slackState()).messages).toHaveLength(0);
  });
});
