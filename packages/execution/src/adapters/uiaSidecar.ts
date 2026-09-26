import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  AdapterAvailability,
  AutomationAdapter,
  ExecutionEnvironment,
  Step,
  StepExecutionResult,
} from '@workflowos/core';
import { errors } from '@workflowos/core';

const exec = promisify(execFile);

export interface UiaSidecarOptions {
  /** Off by default: it shells out to PowerShell and needs a real desktop app. */
  enabled?: boolean;
  powershell?: string;
  timeoutMs?: number;
}

/**
 * Tier 3 for native Windows applications — UI Automation via PowerShell.
 *
 * Registered but disabled in v1 because there is no desktop target in scope to
 * drive. It is here to pin the seam: a Windows capture source and a native app
 * in the trace set would light this tier up without any other change.
 */
export class UiaSidecarAdapter implements AutomationAdapter {
  readonly tier = 'desktop-uia' as const;
  readonly appKinds = ['desktop'] as const;
  private readonly enabled: boolean;
  private readonly shell: string;
  private readonly timeoutMs: number;

  constructor(options: UiaSidecarOptions = {}) {
    this.enabled = options.enabled ?? process.env.WORKFLOWOS_ENABLE_UIA === '1';
    this.shell = options.powershell ?? 'powershell.exe';
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async isAvailable(step: Step, _env: ExecutionEnvironment): Promise<AdapterAvailability> {
    if (!this.enabled) {
      return { available: false, reason: 'UIA sidecar disabled (set WORKFLOWOS_ENABLE_UIA=1 to enable)' };
    }
    if (step.target.appKind !== 'desktop') {
      return { available: false, reason: 'target is not a native desktop application' };
    }
    const control = step.target.selectorCandidates[0];
    if (!control?.name) {
      return { available: false, reason: 'no UI Automation control name recorded for this step' };
    }
    return { available: true };
  }

  async execute(
    step: Step,
    _inputs: Record<string, string>,
    env: ExecutionEnvironment,
  ): Promise<StepExecutionResult> {
    const control = step.target.selectorCandidates[0];
    if (!control?.name) {
      throw errors.execution('no_control', 'No UI Automation control recorded for this step', {
        stepId: step.id,
      });
    }
    const script = [
      'Add-Type -AssemblyName UIAutomationClient',
      '$root = [System.Windows.Automation.AutomationElement]::RootElement',
      `$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, '${control.name.replace(/'/g, "''")}')`,
      '$el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)',
      'if ($el -eq $null) { Write-Output "NOT_FOUND"; exit 2 }',
      'Write-Output "FOUND"',
    ].join('; ');

    try {
      const { stdout } = await exec(this.shell, ['-NoProfile', '-Command', script], {
        timeout: this.timeoutMs,
      });
      if (!stdout.includes('FOUND')) {
        throw errors.binding('not_found', `UIA could not find "${control.name}"`, {
          stepId: step.id,
        });
      }
      return { outputs: {}, detail: `UIA found "${control.name}" in ${step.target.appId}` };
    } catch (cause) {
      if (cause instanceof Error && 'stdout' in cause) {
        throw errors.binding('not_found', `UIA could not find "${control.name}"`, {
          stepId: step.id,
          stdout: String((cause as { stdout?: string }).stdout ?? ''),
        });
      }
      throw errors.execution('uia_failed', `UIA sidecar failed: ${String(cause)}`, {
        stepId: step.id,
      });
    } finally {
      env.log('info', `UIA sidecar probed ${step.target.appId}`);
    }
  }
}
