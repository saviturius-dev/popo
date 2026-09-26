import { useState, useRef } from 'react';
import { api } from './api.js';

export interface TraceOption {
  traceId: string;
  name: string;
  badge: string;
  summary: string;
}

export const TRACES: TraceOption[] = [
  {
    traceId: 'a_customer_request',
    name: 'Customer Request & Support Reply',
    badge: 'Popular',
    summary: 'Reads incoming customer emails in Gmail, finds the client in CRM, and posts a summary in Slack.',
  },
  {
    traceId: 'e_lead_qualification',
    name: 'New Sales Lead Intake',
    badge: 'Sales Ops',
    summary: 'Creates new lead profiles in Salesforce, tags annual revenue, and alerts the sales team on Slack.',
  },
  {
    traceId: 'f_incident_triage',
    name: 'Critical Alert & Urgent Page',
    badge: 'IT & DevOps',
    summary: 'Catches urgent system alerts, files a tracking ticket, and pages the engineer on duty.',
  },
  {
    traceId: 'b_customer_request',
    name: 'Customer Request (With Everyday Distractions)',
    badge: 'Noisy',
    summary: 'Shows how the AI ignores accidental tab clicks and still discovers the core task automatically.',
  },
  {
    traceId: 'c_two_workflows',
    name: 'Busy Morning (Two Tasks in One)',
    badge: 'Multi-Task',
    summary: 'Two distinct workflows performed back-to-back; the AI separates them cleanly.',
  },
  {
    traceId: 'd_one_off',
    name: 'Casual Browsing (Nothing to Automate)',
    badge: 'Test Case',
    summary: 'Shows the AI smartly declining to create automations for random, one-time browsing.',
  },
];

export function DiscoverControl({ onDiscovered }: { onDiscovered(): void }) {
  const [mode, setMode] = useState<'presets' | 'upload' | 'paste'>('presets');
  const [selected, setSelected] = useState(TRACES[0].traceId);
  const [customText, setCustomText] = useState('');
  const [fileName, setFileName] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>();
  const [error, setError] = useState<string>();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeTrace = TRACES.find((t) => t.traceId === selected) || TRACES[0];

  async function discoverPreset(traceIdToRun = selected) {
    setBusy(true);
    setResult(undefined);
    setError(undefined);
    const traceItem = TRACES.find((t) => t.traceId === traceIdToRun) || activeTrace;
    try {
      const response = await api.ingest(traceItem.traceId, pathFor(traceItem));
      handleIngestSuccess(response);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function discoverCustom(content: string, label: string) {
    if (!content.trim()) {
      setError('Please provide trace activity content to analyze.');
      return;
    }
    setBusy(true);
    setResult(undefined);
    setError(undefined);
    try {
      const customId = `custom_${Date.now()}`;
      const response = await api.ingest(customId, undefined, content);
      handleIngestSuccess(response, label);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  function handleIngestSuccess(
    response: { workflows: { id: string; name: string }[]; candidates: unknown[] },
    customLabel?: string,
  ) {
    if (response.workflows.length > 0) {
      setResult(
        `Success! ${customLabel ? `From ${customLabel}, ` : ''}WorkFlowOS learned ${
          response.workflows.length
        } workflow automation${response.workflows.length > 1 ? 's' : ''}. Review the steps below!`,
      );
    } else {
      setResult('Analysis complete: No repetitive patterns detected in this trace. (Needs repeated steps to automate).');
    }
    onDiscovered();
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      discoverCustom(content, file.name);
    };
    reader.readAsText(file);
  }

  return (
    <div className="blueprint-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <span style={{ fontFamily: 'var(--font-code)', fontSize: '11px', color: 'var(--term-cyan)', fontWeight: 700 }}>
          1. CHOOSE WORK ACTIVITY SOURCE
        </span>
      </div>

      {/* Mode Switcher Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
        <button
          type="button"
          className="btn-brutal secondary"
          style={{
            flex: 1,
            fontSize: '10.5px',
            padding: '5px',
            borderBottom: mode === 'presets' ? '2px solid var(--term-cyan)' : '1px solid var(--border-raw)',
            color: mode === 'presets' ? 'var(--term-cyan)' : 'var(--text-muted)',
            background: mode === 'presets' ? '#1f271a' : 'transparent',
          }}
          onClick={() => { setMode('presets'); setError(undefined); setResult(undefined); }}
        >
          Preset Examples
        </button>
        <button
          type="button"
          className="btn-brutal secondary"
          style={{
            flex: 1,
            fontSize: '10.5px',
            padding: '5px',
            borderBottom: mode === 'upload' ? '2px solid var(--term-cyan)' : '1px solid var(--border-raw)',
            color: mode === 'upload' ? 'var(--term-cyan)' : 'var(--text-muted)',
            background: mode === 'upload' ? '#1f271a' : 'transparent',
          }}
          onClick={() => { setMode('upload'); setError(undefined); setResult(undefined); }}
        >
          Upload Real File
        </button>
        <button
          type="button"
          className="btn-brutal secondary"
          style={{
            flex: 1,
            fontSize: '10.5px',
            padding: '5px',
            borderBottom: mode === 'paste' ? '2px solid var(--term-cyan)' : '1px solid var(--border-raw)',
            color: mode === 'paste' ? 'var(--term-cyan)' : 'var(--text-muted)',
            background: mode === 'paste' ? '#1f271a' : 'transparent',
          }}
          onClick={() => { setMode('paste'); setError(undefined); setResult(undefined); }}
        >
          Paste Raw Trace
        </button>
      </div>

      {/* MODE A: PRESET EXAMPLES */}
      {mode === 'presets' && (
        <div>
          <p style={{ margin: '0 0 10px', fontSize: '12px', color: 'var(--text-muted)' }}>
            {activeTrace.summary}
          </p>

          <button
            type="button"
            className="btn-brutal"
            style={{ width: '100%', marginBottom: '12px' }}
            disabled={busy}
            onClick={() => discoverPreset()}
          >
            {busy ? 'Learning repetitive steps...' : '▶ Watch & Learn This Routine'}
          </button>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <div style={{ fontSize: '10.5px', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '2px' }}>
              Choose a scenario:
            </div>
            {TRACES.map((t) => (
              <button
                key={t.traceId}
                type="button"
                className="btn-brutal secondary"
                style={{
                  justifyContent: 'space-between',
                  fontSize: '11px',
                  padding: '6px 10px',
                  border: selected === t.traceId ? '1px solid var(--term-cyan)' : '1px solid var(--border-raw)',
                  background: selected === t.traceId ? '#1f271a' : 'transparent',
                  color: selected === t.traceId ? 'var(--term-cyan)' : 'var(--text-muted)',
                  textAlign: 'left',
                }}
                onClick={() => setSelected(t.traceId)}
              >
                <span>{t.name}</span>
                <span className="spec-stamp">{t.badge}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* MODE B: UPLOAD REAL FILE (Option 4) */}
      {mode === 'upload' && (
        <div>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 10px', lineHeight: 1.4 }}>
            Upload any real user activity file (<strong>.jsonl</strong>, <strong>.json</strong>, or recorded session log) from your computer:
          </p>

          <input
            type="file"
            ref={fileInputRef}
            accept=".jsonl,.json,.txt"
            style={{ display: 'none' }}
            onChange={handleFileUpload}
          />

          <div
            style={{
              border: '2px dashed var(--border-bright)',
              padding: '20px 14px',
              textAlign: 'center',
              cursor: 'pointer',
              background: '#192014',
              marginBottom: '10px',
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <div style={{ fontSize: '20px', marginBottom: '4px' }}>📂</div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#f7fee7' }}>
              {fileName ? fileName : 'Click here to choose a file'}
            </div>
            <div style={{ fontSize: '10.5px', color: 'var(--text-dim)', marginTop: '2px' }}>
              Accepts .jsonl, .json, or exported browser logs
            </div>
          </div>

          {fileName && (
            <button
              type="button"
              className="btn-brutal"
              style={{ width: '100%', marginBottom: '10px' }}
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              Choose a Different File
            </button>
          )}
        </div>
      )}

      {/* MODE C: PASTE RAW JSONL / EVENT TRACE (Option 4) */}
      {mode === 'paste' && (
        <div>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 8px', lineHeight: 1.4 }}>
            Paste real recorded activity lines (one JSON object per line) directly:
          </p>

          <textarea
            className="input-brutal"
            rows={5}
            placeholder={`{"app":{"id":"hubspot","name":"HubSpot"},"action":{"type":"click"},"element":{"role":"button","name":"Create Deal"}}\n{"app":{"id":"slack","name":"Slack"},"action":{"type":"type"},"value":{"text":"New deal created"}}`}
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            style={{ resize: 'vertical', fontSize: '11px', fontFamily: 'var(--font-code)', marginBottom: '8px' }}
          />

          <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
            <button
              type="button"
              className="btn-brutal"
              style={{ flex: 1 }}
              disabled={busy || !customText.trim()}
              onClick={() => discoverCustom(customText, 'Pasted Trace')}
            >
              {busy ? 'Analyzing...' : '▶ Analyze Pasted Trace'}
            </button>
            <button
              type="button"
              className="btn-brutal secondary"
              style={{ fontSize: '11px', padding: '0 8px' }}
              onClick={() => setCustomText('')}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {result && <div className="banner success" style={{ marginTop: '10px' }}>{result}</div>}
      {error && <div className="banner error" style={{ marginTop: '10px' }}>{error}</div>}
    </div>
  );
}

function pathFor(trace: { traceId: string }): string {
  const file: Record<string, string> = {
    a_customer_request: 'a-customer-request-clean.jsonl',
    b_customer_request: 'b-customer-request-noisy.jsonl',
    c_two_workflows: 'c-two-workflows.jsonl',
    d_one_off: 'd-one-off-only.jsonl',
    e_lead_qualification: 'e-lead-qualification.jsonl',
    f_incident_triage: 'f-incident-triage.jsonl',
  };
  return `fixtures/traces/${file[trace.traceId] ?? 'a-customer-request-clean.jsonl'}`;
}
