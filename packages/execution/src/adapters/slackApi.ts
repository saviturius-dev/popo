import type {
  AdapterAvailability,
  AutomationAdapter,
  ExecutionEnvironment,
  StepExecutionResult,
  Step,
} from '@workflowos/core';
import { errors } from '@workflowos/core';

export interface SlackApiOptions {
  appId?: string;
  /** Where downloaded artefacts are written; defaults to a temp directory. */
  defaultChannel?: string;
}

/**
 * Tier 1 — direct API.
 *
 * Registered for the messaging integration only. This is the whole point of the
 * priority ladder: a step the user performs by clicking "Send" runs as one HTTP
 * call when a trusted integration exists, and by driving the UI when one does
 * not.
 */
export class SlackApiAdapter implements AutomationAdapter {
  readonly tier = 'api' as const;
  readonly appKinds = ['web'] as const;
  private readonly appId: string;
  private readonly defaultChannel: string;

  constructor(options: SlackApiOptions = {}) {
    this.appId = options.appId ?? 'slack';
    this.defaultChannel = options.defaultChannel ?? 'support';
  }

  handlesApp(appId: string): boolean {
    return appId === this.appId;
  }

  async isAvailable(step: Step, env: ExecutionEnvironment): Promise<AdapterAvailability> {
    if (step.target.appId !== this.appId) {
      return { available: false, reason: `no API integration for "${step.target.appId}"` };
    }
    if (step.action !== 'send' && step.action !== 'submit') {
      return { available: false, reason: `API integration handles sends, not "${step.action}"` };
    }
    if (!env.resolveEndpoint(this.appId)) {
      return { available: false, reason: `no endpoint registered for "${this.appId}"` };
    }
    return { available: true };
  }

  async execute(
    step: Step,
    inputs: Record<string, string>,
    env: ExecutionEnvironment,
  ): Promise<StepExecutionResult> {
    const base = env.resolveEndpoint(this.appId);
    if (!base) {
      throw errors.execution('no_endpoint', `No endpoint registered for ${this.appId}`);
    }

    const text = inputs.payload ?? inputs.text ?? '';
    if (!text) {
      throw errors.execution('empty_payload', `Step "${step.label}" has no message payload`, {
        stepId: step.id,
      });
    }

    const channel = channelFrom(step) ?? this.defaultChannel ?? 'general';
    const response = await fetch(`${base}/api/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel, text }),
      signal: env.signal,
    });

    if (!response.ok) {
      throw errors.execution('api_error', `Slack API returned ${response.status}`, {
        stepId: step.id,
        status: response.status,
        body: await response.text().catch(() => ''),
      });
    }

    const body = (await response.json()) as { id?: string; ts?: number };
    return {
      outputs: body.id ? { messageId: String(body.id) } : {},
      detail: `POST ${base}/api/messages (channel #${channel})`,
    };
  }
}

function channelFrom(step: Step): string | undefined {
  const pattern = step.target.urlPattern ?? step.inputs.destination;
  if (!pattern) return undefined;
  const match = /\/channel\/([^/?#]+)/.exec(pattern);
  return match?.[1];
}
