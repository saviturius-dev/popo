# WorkFlowOS

An AI agent that watches how you work, proposes the workflow it thinks you keep
performing, and runs it for you once you approve it.

v1 targets Windows 11 and drives local web applications. It learns from
**simulated activity traces** — committed, replayable recordings of user
activity — rather than live OS hooks, so every behaviour in this repository is
reproducible in a test.

```
observe ──▶ understand ──▶ detect repetition ──▶ generate workflow ──▶ approval ──▶ execute ──▶ learn
```

## Quick start

```bash
pnpm install
npx playwright install chromium   # one-off, for browser automation
pnpm dev                         # mock apps + engine API + dashboard
```

Then open <http://127.0.0.1:5173>, press **Discover** in the left pane, approve the
workflow, fill in its variables, and press **Run now**.

| Command | What it does |
| --- | --- |
| `pnpm dev` | Mock apps, engine API (`:4310`) and dashboard (`:5173`) together |
| `pnpm test` | Unit, contract and golden suites |
| `pnpm test:e2e` | Full pipeline against the mock apps in a real browser |
| `pnpm typecheck` | `tsc --noEmit` across the monorepo |
| `pnpm lint` | ESLint |
| `pnpm replay <trace.jsonl>` | Discovery only, prints candidates and scores |
| `pnpm mock` / `pnpm api` | Run either half on its own |
| `npx tsx scripts/write-manifests.ts` | Regenerate golden manifests (review the diff) |

## How it works

### 1. Observe

`ActivitySource` is the only way activity enters the system. `ReplaySource`
replays a JSONL trace; `CaptureSource` exists and deliberately throws, because
live Windows capture is out of scope for v1. A malformed line is skipped with a
warning rather than aborting the trace, unless the damage exceeds
`maxBadLineRatio`, at which point the trace is not trustworthy and ingestion
fails loudly.

Events are redacted on the way in. Redaction removes the value but keeps its
**category**: a typed email becomes `[REDACTED_EMAIL]`, which the normaliser
still compiles to an `email` variable. Control names are only destroyed when the
control itself is secret, because a field called "Search customers" is not a
secret and blinding the engine to it would be worse than useless.

### 2. Understand

`normalizeEvent` turns each event into a canonical token:

```
gmail:click:role=button:name=download attachment
crm:type:role=textbox:name=search customers:value=<email>
```

Volatile substrings — emails, ids, numbers, dates, paths — become placeholders.
`subscribe`/`sessionize` then splits a trace into sessions on idle gaps.

### 3. Detect repetition

The miner finds repeated n-grams across sessions, aligns the occurrences, and
the scorer ranks candidates on support, duration, cross-application transitions,
consistency and noise. Rejections the user has recorded feed back into the score,
so a pattern someone said no to stops competing.

### 4. Generate a workflow

The compiler splits responsibility sharply:

- **The model supplies only the human-facing half**: name, intent, trigger, and
  a label per step.
- **Everything mechanical is computed from the observation**: bindings,
  variables, risk classification, guards and tier preferences.

A model that hallucinates cannot invent a selector, an input variable, or a risk
level. If no model is reachable, heuristics produce the result and the workflow
is marked `degraded: true`, which the dashboard badges.

### 5. Approval

The pipeline never auto-approves. It creates review requests and the engine will
only run a workflow a human has accepted. Rejecting one feeds the scorer.

### 6. Execute

Each step picks the most reliable mechanism available, in this order:

| Tier | Mechanism |
| --- | --- |
| `api` | Direct API call against a trusted integration |
| `app-integration` | Application-specific integration |
| `web-semantic` | Playwright accessibility queries (`getByRole`) |
| `desktop-uia` | Windows UI Automation (sidecar, off by default) |
| `browser-automation` | Playwright browser automation |
| `cv-fallback` | Coordinate / vision fallback |

For a web target, "accessibility" and "browser automation" are the same
mechanism, so they collapse into one tier rather than pretending to a
distinction the code does not make. The run journal records which rung was
actually used, per step.

Gating is risk-based: read steps run, `write` steps pause, and anything
`irreversible` always pauses. A binding that cannot be resolved uniquely gets one
bounded healing attempt from the live accessibility tree, and then **escalates**.
It never takes the first match, because clicking the wrong record is worse than
asking.

### 7. Learn

Each run updates tier reliability, selector weights, scorer feedback and
selector candidates. There is no model training.

## Layout

```
packages/core           domain contracts, errors, ports, redaction, IR
packages/store          repositories over node:sqlite, plain SQL migrations
packages/llm            LlmPort: anthropic | fixture | ollama | resilient
packages/ingest         trace schemas, JSONL replay, seeded generator
packages/discovery      normalization, sessionization, mining, scoring
packages/compiler       IR generation, bindings, variables, risk, tiers
packages/execution      tier registry, adapters, binding, runner
packages/orchestrator   pipeline, review broker, learning, REST + SSE API
apps/mock-apps          Gmail/CRM/Slack mock web apps
apps/dashboard          Vite + React approval UI
fixtures/               committed traces, personas, golden manifests
tests/                  unit, contract, golden, e2e
```

`node:sqlite` is used through a thin compatibility wrapper rather than
`better-sqlite3`: a desktop agent that will run on a user's machine should not
need a C++ toolchain to install.

## Design decisions worth knowing

- **A gate that nobody answers declines.** A timeout must never be read as
  consent to send a message.
- **The compiler cannot invent a binding.** Selectors come from observed events
  or from healing, and every one of them carries its evidence.
- **Redaction preserves type, not content.** See above; losing the category
  would silently degrade every compiled workflow.
- **Runs are serialised.** Two automations driving one browser profile produce
  results nobody can interpret, so the second request is queued, not raced.
- **A run is a journal.** Steps, tiers, attempts, healed selectors, partial
  effects and the log are all persisted, so a failed run is diagnosable after the
  fact.

## Not in v1

Live Windows capture, real credentials or OAuth, a real computer-vision
fallback, multi-user or cloud operation, model training, and installer/autostart
behaviour.

## Validation

- **Golden manifests** pin the discovered workflow count, token sequences,
  variables, actions and tier preferences for four committed traces. Regenerating
  one to make a test pass would turn the test into a tautology, so they are
  regenerated deliberately.
- **The end-to-end suite** runs the real pipeline against the mock apps in a
  real browser and asserts the world changed: the CRM record updated, the
  attachment fetched through the mail integration, the message posted through the
  messaging API. It also pins the three ways a run must *not* proceed: declining
  a gate, and escalating a target it cannot resolve uniquely.
