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

export function App() {
  const [selectedId, setSelectedId] = useState<string>();
  const [leftPaneOpen, setLeftPaneOpen] = useState(true);
  const [rightPaneOpen, setRightPaneOpen] = useState(true);
  const [searchFilter, setSearchFilter] = useState('');

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

  const filteredCandidates = (candidates.data ?? []).filter((c) => {
    if (!searchFilter.trim()) return true;
    const term = searchFilter.toLowerCase();
    return (
      c.appChain.some((app) => app.toLowerCase().includes(term)) ||
      c.tokenSequence.some((tok) => tok.toLowerCase().includes(term))
    );
  });

  const gridClass = [
    'grid',
    !leftPaneOpen ? 'hide-left' : '',
    !rightPaneOpen ? 'hide-right' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="app">
      {/* Friendly Top Bar */}
      <header className="topbar">
        <div className="topbar-left">
          <div className="terminal-title">
            <span className="schematic-box">WORKFLOW.OS</span>
            <h1>AI Work Assistant</h1>
          </div>
          <span className="spec-stamp">Smart Automator</span>
        </div>

        <div className="status">
          <div className="terminal-badge" style={{ borderColor: 'var(--term-cyan)', color: 'var(--term-cyan)' }}>
            <span>MODEL:</span>
            <strong>NVIDIA (KIMI-K3)</strong>
          </div>

          <div className={`terminal-badge ${connection === 'live' ? '' : 'offline'}`}>
            <span>STATUS:</span>
            <strong>{connection === 'live' ? 'READY & ACTIVE' : 'CONNECTING...'}</strong>
          </div>

          {health.data?.busy && (
            <div className="terminal-badge" style={{ borderColor: 'var(--term-amber)', color: 'var(--term-amber)' }}>
              <span>TASK:</span>
              <strong>RUNNING</strong>
            </div>
          )}

          {/* Pane Toggles */}
          <div style={{ display: 'flex', gap: '5px' }}>
            <button
              type="button"
              className="btn-brutal secondary"
              style={{ padding: '4px 8px', fontSize: '11px' }}
              onClick={() => setLeftPaneOpen((v) => !v)}
            >
              {leftPaneOpen ? 'Hide Learned Routines' : 'Show Learned Routines'}
            </button>
            <button
              type="button"
              className="btn-brutal secondary"
              style={{ padding: '4px 8px', fontSize: '11px' }}
              onClick={() => setRightPaneOpen((v) => !v)}
            >
              {rightPaneOpen ? 'Hide Decisions' : 'Show Decisions'} {reviews.data && reviews.data.length > 0 ? `(${reviews.data.length})` : ''}
            </button>
          </div>
        </div>
      </header>

      {health.error && (
        <div className="banner error" style={{ margin: '8px 16px 0' }}>
          Connection notice: {health.error}
        </div>
      )}

      <main className={gridClass}>
        {/* PANEL 1: OBSERVED ROUTINES */}
        <section className={`pane ${!leftPaneOpen ? 'hidden-pane' : ''}`}>
          <div className="pane-header-terminal">
            <h2>Learned Work Routines</h2>
            <span className="fig-label">Observed Tasks</span>
          </div>

          <DiscoverControl onDiscovered={refreshAll} />

          <PipelineSummary progress={progress.data ?? []} />

          <div style={{ marginTop: '14px', marginBottom: '8px' }}>
            <input
              type="text"
              className="input-brutal"
              placeholder="Search apps (e.g. Gmail, Salesforce, Slack)..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
            />
          </div>

          <div className="pane-header-terminal" style={{ margin: '14px 0 10px' }}>
            <h2 style={{ fontSize: '15px' }}>Detected Repetitive Patterns</h2>
            <span className="fig-label">{filteredCandidates.length} found</span>
          </div>

          <CandidateList
            candidates={filteredCandidates}
            workflows={list}
            selectedWorkflowId={selected?.id}
            onOpen={(id) => setSelectedId(id)}
          />
        </section>

        {/* PANEL 2: WORKFLOW CANVASS */}
        <section className="pane wide">
          <div className="pane-header-terminal">
            <h2>Proposed Automation Plan</h2>
            <span className="fig-label">Review & Run</span>
          </div>

          {selected ? (
            <WorkflowView
              key={selected.id}
              workflow={selected}
              runs={runs.data ?? []}
              onChanged={refreshAll}
            />
          ) : (
            <div className="blueprint-card" style={{ padding: '36px 20px', textAlign: 'center', marginTop: '20px' }}>
              <h3 style={{ margin: '0 0 8px', color: '#fff', fontSize: '16px' }}>
                No Automation Selected Yet
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '0 auto 16px', maxWidth: '420px', lineHeight: 1.5 }}>
                Choose an example from the left column (such as <strong>Customer Request & Support Reply</strong>) and click <em>Watch & Learn This Routine</em> to see how WorkFlowOS turns it into an automatic workflow.
              </p>
            </div>
          )}
        </section>

        {/* PANEL 3: HUMAN IN THE LOOP DECISIONS */}
        <section className={`pane ${!rightPaneOpen ? 'hidden-pane' : ''}`}>
          <div className="pane-header-terminal">
            <h2>Needs Your Permission</h2>
            <span className="fig-label">Safety Gate</span>
          </div>

          <ReviewQueue reviews={reviews.data ?? []} onAnswered={refreshAll} />

          {activeRun && (
            <div style={{ marginTop: '20px' }}>
              <div className="pane-header-terminal">
                <h2 style={{ fontSize: '15px' }}>Live Progress</h2>
                <span className="fig-label">Automation Activity</span>
              </div>
              <RunView run={activeRun} onChanged={refreshAll} />
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function PipelineSummary({ progress }: { progress: PipelineProgress[] }) {
  if (progress.length === 0) return null;
  return (
    <div style={{ marginBottom: '14px' }}>
      {progress.slice(0, 3).map((p) => (
        <div key={p.traceId} className="blueprint-card" style={{ padding: '8px 10px', marginBottom: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
            <span style={{ color: 'var(--term-cyan)' }}>Learning status: {p.stage === 'done' ? 'Completed' : 'In Progress'}</span>
            <span style={{ color: 'var(--text-muted)' }}>{p.eventsIngested} actions analyzed</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function CandidateList({
  candidates,
  workflows,
  selectedWorkflowId,
  onOpen,
}: {
  candidates: CandidateWorkflow[];
  workflows: WorkflowIR[];
  selectedWorkflowId?: string;
  onOpen(id: string): void;
}) {
  if (candidates.length === 0) {
    return (
      <div className="blueprint-card" style={{ padding: '16px', textAlign: 'center' }}>
        <span style={{ color: 'var(--text-dim)', fontSize: '12px' }}>
          No repetitive routines found matching this filter.
        </span>
      </div>
    );
  }

  return (
    <div>
      {candidates.map((candidate) => {
        const workflow = workflows.find((w) => w.candidateId === candidate.id);
        const isSelected = workflow && workflow.id === selectedWorkflowId;

        return (
          <div
            key={candidate.id}
            className={`candidate-schematic-card ${isSelected ? 'selected' : ''}`}
            onClick={() => workflow && onOpen(workflow.id)}
          >
            <div className="chain-blocks">
              {candidate.appChain.map((app, idx) => (
                <span key={`${app}-${idx}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <span className={`schematic-app-block ${getAppTag(app)}`}>
                    {getFriendlyAppName(app)}
                  </span>
                  {idx < candidate.appChain.length - 1 && (
                    <span className="connector-arrow">➔</span>
                  )}
                </span>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '8px', fontSize: '11.5px', color: 'var(--text-muted)' }}>
              <span>Observed <strong>{candidate.occurrences.length} times</strong></span>
              <span>·</span>
              <span>Confidence: <strong style={{ color: 'var(--term-cyan)' }}>{(candidate.score.total * 100).toFixed(0)}%</strong></span>
            </div>
            
            <div style={{ fontSize: '10.5px', color: 'var(--term-cyan)', marginTop: '6px' }}>
              Click to inspect & approve this automation →
            </div>
          </div>
        );
      })}
    </div>
  );
}

function getFriendlyAppName(app: string): string {
  const l = app.toLowerCase();
  if (l.includes('gmail') || l.includes('mail')) return 'Gmail';
  if (l.includes('crm') || l.includes('deal') || l.includes('customer')) return 'CRM';
  if (l.includes('salesforce')) return 'Salesforce';
  if (l.includes('slack') || l.includes('chat')) return 'Slack';
  if (l.includes('jira')) return 'Jira';
  if (l.includes('github')) return 'GitHub';
  if (l.includes('pagerduty')) return 'PagerDuty';
  return app;
}

function getAppTag(app: string): string {
  const l = app.toLowerCase();
  if (l.includes('gmail') || l.includes('mail')) return 'gmail';
  if (l.includes('crm') || l.includes('deal') || l.includes('customer') || l.includes('salesforce')) return 'crm';
  if (l.includes('slack') || l.includes('chat')) return 'slack';
  return 'generic';
}

export type { RunRecord };
