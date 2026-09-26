import type { ActivityEvent, Risk, StepAction } from '@workflowos/core';

const IRREVERSIBLE_NAME =
  /^(send|submit|delete|remove|place order|pay|confirm|publish|post|archive|close account|cancel|complete|refund|reply|reply all)$/i;
const IRREVERSIBLE_SUBSTRING = /\b(delete|remove|send|submit|pay|publish|refund|cancel|close account|revoke)\b/i;
const WRITE_NAME = /^(save|update|add|create|edit|assign|upload|import|attach|log|note|comment|follow up|mark)\b/i;

const ACTION_MAP: Record<string, StepAction> = {
  navigate: 'navigate',
  focus: 'navigate',
  launch: 'navigate',
  click: 'click',
  type: 'type',
  select: 'select',
  download: 'download',
  copy: 'api-call',
  submit: 'submit',
  keypress: 'navigate',
  idle: 'wait',
};

/**
 * Risk is the basis for the human-in-the-loop gate, so it is derived from
 * observable properties of the step — action type, control name, target app —
 * rather than from what the LLM believes the step means.
 */
export function classifyRisk(
  action: StepAction,
  elementName: string | undefined,
  _appId: string,
): Risk {
  const name = (elementName ?? '').trim();

  if (action === 'submit' || action === 'send') return 'irreversible';
  if (action === 'navigate' || action === 'wait') return 'read';
  if (action === 'type' || action === 'select' || action === 'download' || action === 'api-call') {
    return 'write';
  }
  if (action === 'click') {
    if (IRREVERSIBLE_NAME.test(name) || IRREVERSIBLE_SUBSTRING.test(name)) return 'irreversible';
    if (WRITE_NAME.test(name)) return 'write';
    return 'read';
  }
  return 'read';
}

export function toStepAction(action: ActivityEvent['action']['type']): StepAction {
  return ACTION_MAP[action] ?? 'click';
}

/** Name fragments that suggest a step is a lookup whose result other steps need. */
const LOOKUP_NAME = /^(search|find|open record|view|select customer|lookup|open|go to|filter)$/i;

export function isLookupStep(action: StepAction, elementName: string | undefined): boolean {
  if (action !== 'click') return false;
  return LOOKUP_NAME.test((elementName ?? '').trim());
}

/** Name fragments that suggest a step is a data-entry field. */
export function isDataEntryStep(action: StepAction, elementName: string | undefined): boolean {
  if (action !== 'type') return false;
  const name = (elementName ?? '').trim();
  return !/^(search|query|filter)$/i.test(name);
}
