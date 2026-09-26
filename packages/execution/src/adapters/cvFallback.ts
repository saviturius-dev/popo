import type {
  AdapterAvailability,
  AutomationAdapter,
  ExecutionEnvironment,
  Step,
  StepExecutionResult,
} from '@workflowos/core';
import { errors } from '@workflowos/core';

/**
 * Tier 5 — computer-vision / coordinate fallback.
 *
 * Declared so the tier ladder is complete and so the resolver can report it as
 * "the only remaining option" when a step fails everywhere else. It is not
 * implemented: a coordinate-clicking fallback that guesses pixels is a worse
 * outcome than escalating to the user, so it reports itself unavailable.
 */
export class CvFallbackAdapter implements AutomationAdapter {
  readonly tier = 'cv-fallback' as const;
  readonly appKinds = ['web', 'desktop'] as const;

  async isAvailable(_step: Step, _env: ExecutionEnvironment): Promise<AdapterAvailability> {
    return {
      available: false,
      reason: 'computer-vision fallback is not implemented; the run escalates to the user instead',
    };
  }

  async execute(step: Step): Promise<StepExecutionResult> {
    throw errors.execution(
      'cv_fallback_unavailable',
      `No reliable mechanism for "${step.label}"; a human needs to complete this step`,
      { stepId: step.id },
    );
  }
}
