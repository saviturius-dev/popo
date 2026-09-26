import type { Page } from 'playwright';
import type {
  AdapterAvailability,
  AutomationAdapter,
  ExecutionEnvironment,
  Step,
  StepExecutionResult,
} from '@workflowos/core';
import { errors } from '@workflowos/core';
import type { BrowserPool } from '../browserPool.js';
import { healSelector, locatorFor, resolveBinding } from '../binding.js';
import { extractOutputs } from '../outputs.js';

export interface PlaywrightSemanticOptions {
  pool: BrowserPool;
  /** Extra settle time after a click, in ms. */
  settleMs?: number;
}

/**
 * Tiers 3+4 — accessibility/semantic queries in a real browser.
 *
 * The spec lists "accessibility/semantic UI" and "browser automation" as
 * separate rungs. For web targets they are the same mechanism: Playwright's
 * `getByRole` is an accessibility query, and driving pixels instead of roles
 * would be strictly worse. This adapter is therefore registered under both
 * tier names, and the run journal records it as `web-semantic` so the dashboard
 * never claims a distinction the mechanism does not make.
 */
export class PlaywrightSemanticAdapter implements AutomationAdapter {
  readonly tier = 'web-semantic' as const;
  readonly appKinds = ['web'] as const;
  private readonly pool: BrowserPool;
  private readonly settleMs: number;

  constructor(options: PlaywrightSemanticOptions) {
    this.pool = options.pool;
    this.settleMs = options.settleMs ?? 250;
  }

  async isAvailable(step: Step, env: ExecutionEnvironment): Promise<AdapterAvailability> {
    if (step.target.appKind !== 'web') {
      return { available: false, reason: 'target is not a web application' };
    }
    if (!env.resolveEndpoint(step.target.appId)) {
      return { available: false, reason: `no endpoint registered for "${step.target.appId}"` };
    }
    return { available: true };
  }

  async execute(
    step: Step,
    inputs: Record<string, string>,
    env: ExecutionEnvironment,
  ): Promise<StepExecutionResult> {
    const page = await this.pool.pageFor(env.runId);
    page.setDefaultTimeout(step.timeoutMs);

    switch (step.action) {
      case 'navigate':
        return this.navigate(page, step, inputs, env);
      case 'type':
        return this.fill(page, step, inputs, env);
      case 'click':
      case 'send':
      case 'submit':
        return this.click(page, step, env);
      case 'download':
        return this.download(page, step, env);
      case 'select':
        return this.select(page, step, inputs, env);
      case 'wait':
        return { outputs: {}, detail: 'no-op' };
      default:
        throw errors.execution(
          'unsupported_action',
          `Playwright adapter cannot perform "${step.action}"`,
          { stepId: step.id },
        );
    }
  }

  private async navigate(
    page: Page,
    step: Step,
    inputs: Record<string, string>,
    env: ExecutionEnvironment,
  ): Promise<StepExecutionResult> {
    const base = env.resolveEndpoint(step.target.appId);
    const destination = inputs.destination ?? step.target.urlPattern;
    const url = toUrl(base, destination);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    const outputs = extractOutputs(step, { url: page.url() });
    return {
      outputs,
      detail: `GET ${url} (${response?.status() ?? 'no response'})`,
    };
  }

  private async fill(
    page: Page,
    step: Step,
    inputs: Record<string, string>,
    env: ExecutionEnvironment,
  ): Promise<StepExecutionResult> {
    const value = inputs.field ?? inputs.value ?? inputs.payload ?? '';
    const locator = await this.requireUnique(page, step, env);
    await locator.fill(value, { timeout: step.timeoutMs });
    return { outputs: {}, detail: `filled "${value}"` };
  }

  private async select(
    page: Page,
    step: Step,
    inputs: Record<string, string>,
    env: ExecutionEnvironment,
  ): Promise<StepExecutionResult> {
    const locator = await this.requireUnique(page, step, env);
    await locator.selectOption(inputs.field ?? inputs.value ?? '', { timeout: step.timeoutMs });
    return { outputs: {}, detail: 'selected option' };
  }

  private async click(
    page: Page,
    step: Step,
    env: ExecutionEnvironment,
  ): Promise<StepExecutionResult> {
    const locator = await this.requireUnique(page, step, env);
    await locator.click({ timeout: step.timeoutMs });
    await page.waitForLoadState('domcontentloaded', { timeout: this.settleMs + 2_000 }).catch(() => undefined);
    const outputs = extractOutputs(step, { url: page.url() });
    for (const [key, value] of Object.entries(outputs)) env.setOutput(step.id, key, value);
    return { outputs, detail: `clicked, now at ${page.url()}` };
  }

  private async download(
    page: Page,
    step: Step,
    env: ExecutionEnvironment,
  ): Promise<StepExecutionResult> {
    const locator = await this.requireUnique(page, step, env);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: step.timeoutMs }).catch(() => null),
      locator.click({ timeout: step.timeoutMs }),
    ]);
    if (!download) {
      throw errors.execution('no_download', 'Clicking the control did not start a download', {
        stepId: step.id,
      });
    }
    const path = await download.path();
    const name = download.suggestedFilename();
    if (path) env.setOutput(step.id, 'attachmentPath', path);
    return { outputs: { attachmentPath: path ?? '', attachmentName: name }, detail: `downloaded ${name}` };
  }

  /**
   * Resolves the target, heals once if needed, and escalates on ambiguity.
   *
   * Escalation is deliberately not an error path: the run pauses and asks.
   */
  private async requireUnique(
    page: Page,
    step: Step,
    env: ExecutionEnvironment,
  ): Promise<import('playwright').Locator> {
    const { resolved, attempts } = await resolveBinding(page, step);
    if (resolved?.locator) return resolved.locator;

    const healed = await healSelector(page, step);
    if (healed.selector) {
      env.log('warn', `Binding for "${step.label}" healed to ${healed.selector.role} "${healed.selector.name}"`);
      return locatorFor(page, healed.selector);
    }

    throw errors.binding(
      'ambiguous_or_missing',
      `Could not uniquely resolve "${step.label}"`,
      {
        stepId: step.id,
        attempts: attempts.map((a) => ({ selector: a.selector, matches: a.matches, error: a.error })),
        candidates: healed.ambiguous,
        needsConfirmation: true,
      },
    );
  }
}

/** Rewrites a recorded URL (which points at a mock host) onto the live endpoint. */
export function toUrl(base: string | undefined, destination: string | undefined): string {
  if (!destination) return base ?? 'about:blank';
  if (/^https?:\/\//.test(destination)) {
    try {
      const parsed = new URL(destination);
      const origin = base ? new URL(base).origin : parsed.origin;
      return `${origin}${parsed.pathname}${parsed.search}`.replace(/:([A-Za-z_]+)/g, '');
    } catch {
      return destination;
    }
  }
  const path = destination.startsWith('/') ? destination : `/${destination}`;
  return `${base ?? ''}${path}`;
}
