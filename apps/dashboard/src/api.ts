import { useEffect, useRef, useState } from 'react';
import type {
  CandidateWorkflow,
  PipelineProgress,
  ReviewRequest,
  RunRecord,
  Selector,
  Step,
  WorkflowIR,
} from '@workflowos/core';

/**
 * The dashboard's entire relationship with the engine.
 *
 * It talks to the REST API for state and to the event stream for liveness, and
 * it treats the stream as a hint to refetch rather than as a source of truth:
 * a dropped frame must never leave the operator looking at a workflow that
 * already changed.
 */
export interface Health {
  ok: boolean;
  busy: boolean;
  activeRunId?: string;
  endpoints: Record<string, string>;
  tiers: string[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error((body as { message?: string }).message ?? `request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export const api = {
  health: () => request<Health>('/health'),
  ingest: (traceId: string, path: string) =>
    request<{ candidates: unknown[]; workflows: { id: string; name: string }[] }>('/ingest', {
      method: 'POST',
      body: JSON.stringify({ traceId, path }),
    }),
  progress: () => request<PipelineProgress[]>('/progress'),
  candidates: () => request<CandidateWorkflow[]>('/candidates'),
  workflows: (status?: string) =>
    request<WorkflowIR[]>(status ? `/workflows?status=${status}` : '/workflows'),
  workflow: (id: string) =>
    request<{ workflow: WorkflowIR; runs: RunRecord[] }>(`/workflows/${id}`),
  approve: (id: string) => request<WorkflowIR>(`/workflows/${id}/approve`, { method: 'POST' }),
  reject: (id: string, note?: string) =>
    request<WorkflowIR>(`/workflows/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify(note ? { note } : {}),
    }),
  patchWorkflow: (id: string, patch: unknown) =>
    request<WorkflowIR>(`/workflows/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  run: (id: string, variables?: Record<string, string>) =>
    request<{ run: RunRecord }>(`/workflows/${id}/run`, {
      method: 'POST',
      body: JSON.stringify(variables ? { variables } : {}),
    }),
  runs: () => request<RunRecord[]>('/runs'),
  registerEndpoints: (endpoints: Record<string, string>) =>
    request<Record<string, string>>('/endpoints', { method: 'POST', body: JSON.stringify(endpoints) }),
  abort: (runId: string) => request<{ aborted: boolean }>(`/runs/${runId}/abort`, { method: 'POST' }),
  reviews: (pending = false) => request<ReviewRequest[]>(`/reviews?pending=${pending}`),
  respond: (reviewId: string, resolution: string, selector?: Selector) =>
    request<{ answered: boolean }>(`/reviews/${reviewId}/respond`, {
      method: 'POST',
      body: JSON.stringify({ resolution, selector }),
    }),
};

type Listener = (event: { type: string; [key: string]: unknown }) => void;

/** Subscribes to the engine's SSE stream, reconnecting with a fixed backoff. */
export function useEventStream(onEvent: Listener): 'connecting' | 'live' | 'offline' {
  const [state, setState] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const source = new EventSource('/api/stream');
    source.onopen = () => setState('live');
    source.onerror = () => setState('offline');
    source.onmessage = (message) => {
      setState('live');
      try {
        handler.current(JSON.parse(message.data) as { type: string });
      } catch {
        // A malformed frame is not worth tearing the stream down for.
      }
    };
    return () => source.close();
  }, []);

  return state;
}

/** Reloads the given resources whenever the engine reports something. */
export function useLiveData<T>(load: () => Promise<T>, deps: unknown[] = []): {
  data?: T;
  error?: string;
  reload: () => void;
} {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [nonce, setNonce] = useState(0);
  const loader = useRef(load);
  loader.current = load;

  useEffect(() => {
    let live = true;
    loader
      .current()
      .then((value) => live && (setData(value), setError(undefined)))
      .catch((cause: unknown) => live && setError(cause instanceof Error ? cause.message : String(cause)));
    return () => {
      live = false;
    };
  }, [nonce, ...deps]);

  return { data, error, reload: () => setNonce((n) => n + 1) };
}

export type {
  CandidateWorkflow,
  PipelineProgress,
  ReviewRequest,
  RunRecord,
  Selector,
  Step,
  WorkflowIR,
};
