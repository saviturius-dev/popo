import { useCallback, useState } from 'react';
import {
  api,
  useEventStream,
  useLiveData,
  type CandidateWorkflow,
  type PipelineProgress,
  type RunRecord,
  type WorkflowIR,
} from './api.js';
import { WorkflowView } from './WorkflowView.js';
import { ReviewQueue } from './ReviewQueue.js';
import { RunView } from './RunView.js';
import { DiscoverControl } from './DiscoverControl.js';

/**
 * Three panes, one question each.
 *
 * Left: what did the engine think it saw. Middle: what it wants to automate and
 * whether that is acceptable. Right: what it needs from a human right now. The
 * ordering is deliberate — nothing in this UI is a run control that is not also
 * a review control, because in this system those are the same decision.
 */
export function App() {
  const [selectedId, setSelectedId] = useState<string>();

  // Any engine event invalidates the views, so the panes re-read from the API.
  const bump = useCallback(() => {
    refreshAll();
  }, []);

  const health = useLiveData(() => api.health(), []);
  const progress = useLiveData(() => api.progress(), []);
  const candidates = useLiveData(() => api.candidates(), []);
  const workflows = useLiveData(() => api.workflows(), []);
  const runs = useLiveData(() => api.runs(), []);
  const reviews = useLiveData(() => api.reviews(true), []);

  const connection = useEventStream(bump);

  function refreshAll() {
    health.reload();
    progress.reload();
    candidates.reload();
    workflows.reload();
    runs.reload();
    reviews.reload();
  }

  const activeRun = runs.data?.find((r) => r.id === health.data?.activeRunId) ?? runs.data?.[0];
  const list = workflows.data ?? [];
  const selected = list.find((w) => w.id === selectedId) ?? list[0];

  return (
    <div className="app">
      <header className="topbar">
        <h1>WorkFlowOS</h1>
        <div className="status">
          <span className={`dot ${connection}`} title={`event stream: ${connection}`} />
          <span>{connection === 'live' ? 'live' : connection}</span>
          {health.data?.busy && <span className="pill warn">run in progress</span>}
          {health.data && (
            <span className="pill">
              tiers: {health.data.tiers.join(' → ')}
            </span>
          )}
        </div>
      </header>

      {health.error && <div className="banner error">Engine unreachable: {health.error}</div>}

      <main className="grid">
        <section className="pane">
          <h2>Observed</h2>
          <DiscoverControl onDiscovered={refreshAll} />
          <PipelineSummary progress={progress.data ?? []} />
          <CandidateList
            candidates={candidates.data ?? []}
            workflows={list}
            onOpen={(id) => setSelectedId(id)}
          />
        </section>

        <section className="pane wide">
          {selected ? (
            <WorkflowView
              key={selected.id}
              workflow={selected}
              runs={runs.data ?? []}
              onChanged={refreshAll}
            />
          ) : (
            <p className="empty">
              No workflows yet. Press Discover in the left pane to observe a recorded trace.
            </p>
          )}
        </section>

        <section className="pane">
          <h2>Needs you</h2>
          <ReviewQueue reviews={reviews.data ?? []} onAnswered={refreshAll} />
          {activeRun ? <RunView run={activeRun} onChanged={refreshAll} /> : null}
        </section>
      </main>
    </div>
  );
}

function PipelineSummary({ progress }: { progress: PipelineProgress[] }) {
  if (progress.length === 0) return <p className="empty">No trace ingested yet.</p>;
  return (
    <ul className="progress">
      {progress.slice(0, 3).map((p) => (
        <li key={p.traceId}>
          <span className={`stage ${p.stage}`}>{p.stage}</span>
          <span className="muted">
            {p.eventsIngested} events · {p.candidates} candidate(s)
          </span>
          {p.error ? <span className="muted error">{p.error}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function CandidateList({
  candidates,
  workflows,
  onOpen,
}: {
  candidates: CandidateWorkflow[];
  workflows: WorkflowIR[];
  onOpen(id: string): void;
}) {
  if (candidates.length === 0) return <p className="empty">No repeated pattern detected.</p>;
  return (
    <ul className="candidates">
      {candidates.map((candidate) => {
        const workflow = workflows.find((w) => w.candidateId === candidate.id);
        return (
          <li key={candidate.id}>
            <button
              type="button"
              className="link"
              disabled={!workflow}
              onClick={() => workflow && onOpen(workflow.id)}
            >
              {candidate.appChain.join(' → ')}
            </button>
            <div className="muted">
              {candidate.occurrences.length}× · score {candidate.score.total.toFixed(2)} ·{' '}
              {candidate.score.crossAppTransitions} app transition(s)
            </div>
            <details>
              <summary>token sequence</summary>
              <ol className="tokens">
                {candidate.tokenSequence.map((token) => (
                  <li key={token}>{token}</li>
                ))}
              </ol>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

export type { RunRecord };
