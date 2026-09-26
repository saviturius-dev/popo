import { z } from 'zod';
import type { ActionType, AppKind, SelectorStrategy } from '@workflowos/core';

export const appRefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['web', 'desktop', 'system']),
});

export const selectorSchema = z.object({
  strategy: z.enum(['role-name', 'css', 'text', 'uia', 'testid', 'api']),
  role: z.string().optional(),
  name: z.string().optional(),
  textPattern: z.string().optional(),
  value: z.string().optional(),
  testId: z.string().optional(),
  weight: z.number().min(0).max(1),
  evidence: z.string().optional(),
});

export const activityEventSchema = z.object({
  id: z.string().min(1),
  seq: z.number().int().nonnegative(),
  ts: z.number().int().nonnegative(),
  app: appRefSchema,
  target: z.object({ url: z.string().optional(), windowTitle: z.string().optional(), framePath: z.string().optional() }).optional(),
  action: z.object({ type: z.enum(['launch', 'focus', 'navigate', 'click', 'type', 'select', 'download', 'copy', 'submit', 'keypress', 'idle']) }),
  element: z
    .object({
      role: z.string().optional(),
      name: z.string().optional(),
      text: z.string().optional(),
      selectorCandidates: z.array(selectorSchema).optional(),
    })
    .optional(),
  value: z.object({ text: z.string().optional(), sensitive: z.boolean().optional() }).optional(),
  source: z.enum(['replay', 'generator', 'capture']),
  scenario: z.string().optional(),
  sensitive: z.boolean().optional(),
});

/** Permissive form accepted in fixtures: `seq`/`source` are filled in by the reader. */
export const traceLineSchema = activityEventSchema.partial({
  id: true,
  seq: true,
  source: true,
});

export type TraceLine = z.infer<typeof traceLineSchema>;

export function parseTraceLine(line: string): TraceLine | null {
  try {
    const parsed = traceLineSchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const ACTION_TYPES: readonly ActionType[] = [
  'launch',
  'focus',
  'navigate',
  'click',
  'type',
  'select',
  'download',
  'copy',
  'submit',
  'keypress',
  'idle',
];

export const APP_KINDS: readonly AppKind[] = ['web', 'desktop', 'system'];
export const SELECTOR_STRATEGIES: readonly SelectorStrategy[] = [
  'role-name',
  'css',
  'text',
  'uia',
  'testid',
  'api',
];
