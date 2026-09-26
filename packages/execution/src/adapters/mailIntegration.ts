import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AdapterAvailability,
  AutomationAdapter,
  ExecutionEnvironment,
  Step,
  StepExecutionResult,
} from '@workflowos/core';
import { errors } from '@workflowos/core';

export interface MailIntegrationOptions {
  appId?: string;
  downloadDir?: string;
}

interface AttachmentResponse {
  filename?: string;
  content?: string;
  path?: string;
}

/**
 * Tier 2 — application integration.
 *
 * The mail app exposes an integration that fetches the attachment for the
 * message currently in view. It beats driving the browser because it is
 * unaffected by DOM changes, and it loses to nothing because it is a real
 * integration rather than a UI simulation.
 */
export class MailAttachmentIntegration implements AutomationAdapter {
  readonly tier = 'app-integration' as const;
  readonly appKinds = ['web'] as const;
  private readonly appId: string;
  private readonly downloadDir: string;

  constructor(options: MailIntegrationOptions = {}) {
    this.appId = options.appId ?? 'gmail';
    this.downloadDir = options.downloadDir ?? join(process.cwd(), 'data', 'downloads');
  }

  handlesApp(appId: string): boolean {
    return appId === this.appId;
  }

  async isAvailable(step: Step, env: ExecutionEnvironment): Promise<AdapterAvailability> {
    if (step.target.appId !== this.appId) {
      return { available: false, reason: `no mail integration for "${step.target.appId}"` };
    }
    if (step.action !== 'download') {
      return { available: false, reason: 'mail integration only handles attachment downloads' };
    }
    if (!env.resolveEndpoint(this.appId)) {
      return { available: false, reason: `no endpoint registered for "${this.appId}"` };
    }
    return { available: true };
  }

  async execute(
    step: Step,
    _inputs: Record<string, string>,
    env: ExecutionEnvironment,
  ): Promise<StepExecutionResult> {
    const base = env.resolveEndpoint(this.appId);
    if (!base) {
      throw errors.execution('no_endpoint', `No endpoint registered for ${this.appId}`);
    }

    const response = await fetch(`${base}/api/attachments/next`, { signal: env.signal });
    if (!response.ok) {
      throw errors.execution('api_error', `Mail integration returned ${response.status}`, {
        stepId: step.id,
        status: response.status,
      });
    }

    const body = (await response.json()) as AttachmentResponse;
    const filename = body.filename ?? 'attachment.bin';
    await mkdir(this.downloadDir, { recursive: true });
    const path = join(this.downloadDir, filename);
    await writeFile(path, body.content ?? `attachment for ${filename}`, 'utf8');

    env.setOutput(step.id, 'attachmentPath', path);
    return {
      outputs: { attachmentPath: path, attachmentName: filename },
      detail: `GET ${base}/api/attachments/next -> ${path}`,
    };
  }
}
