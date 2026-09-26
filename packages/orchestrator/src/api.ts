import cors from 'cors';
import express from 'express';
import { z } from 'zod';
import { WorkflowOsError, errors } from '@workflowos/core';
import { ReplaySource } from '@workflowos/ingest';
import type { Orchestrator } from './orchestrator.js';

const runSchema = z.object({
  variables: z.record(z.string()).optional(),
  endpoints: z.record(z.string()).optional(),
});

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  intent: z.string().min(1).max(600).optional(),
  steps: z
    .array(
      z.object({
        id: z.string(),
        enabled: z.boolean().optional(),
        risk: z.enum(['read', 'write', 'irreversible']).optional(),
        label: z.string().min(1).max(120).optional(),
      }),
    )
    .optional(),
});

const ingestSchema = z.object({
  traceId: z.string().min(1),
  path: z.string().min(1),
  minSupport: z.number().int().min(2).max(50).optional(),
  minScore: z.number().min(0).max(1).optional(),
});

const reviewSchema = z.object({
  resolution: z.enum(['approved', 'rejected', 'confirmed', 'cancelled']),
  selector: z
    .object({
      strategy: z.enum(['role-name', 'css', 'text', 'uia', 'testid', 'api']),
      role: z.string().optional(),
      name: z.string().optional(),
      textPattern: z.string().optional(),
      testId: z.string().optional(),
      value: z.string().optional(),
      weight: z.number().min(0).max(1).default(0.9),
    })
    .optional(),
  note: z.string().optional(),
});

/**
 * The approval and control surface.
 *
 * Everything the pipeline needs a human for is reachable over HTTP: approving a
 * discovered workflow, answering a gate mid-run, aborting, and inspecting the
 * run journal. The dashboard is a client of this API and nothing else.
 */
export function createApiServer(orchestrator: Orchestrator): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  const wrap =
    (handler: (req: express.Request, res: express.Response) => unknown | Promise<unknown>) =>
    (req: express.Request, res: express.Response) => {
      Promise.resolve(handler(req, res)).catch((cause) => {
        const status = cause instanceof WorkflowOsError && cause.code === 'workflow_not_found' ? 404 : 400;
        const body =
          cause instanceof WorkflowOsError
            ? cause.toJSON()
            : { name: 'Error', message: String(cause) };
        res.status(status).json(body);
      });
    };

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      busy: orchestrator.isBusy(),
      activeRunId: orchestrator.activeRun(),
      endpoints: orchestrator.getEndpoints(),
      tiers: orchestrator.engine.registry.tiers(),
    });
  });

  app.get('/api/candidates', wrap((_req, res) => {
    res.json(orchestrator.store.discovery.listCandidates());
  }));

  /**
   * Runs discovery over a recorded trace.
   *
   * This is the observe half of the system, and it is an explicit action rather
   * than a background watcher on purpose: ingesting is cheap, but compiling a
   * workflow is a decision the operator should be present for.
   */
  app.post('/api/ingest', wrap(async (req, res) => {
    const body = ingestSchema.parse(req.body ?? {});
    const source = new ReplaySource({ traceId: body.traceId, path: body.path });
    const result = await orchestrator.ingest(source, {
      minSupport: body.minSupport,
      minScore: body.minScore,
    });
    res.json({
      progress: result.progress,
      redactedCount: result.redactedCount,
      candidates: result.candidates,
      workflows: result.workflows.map((w) => ({ id: w.id, name: w.name, status: w.status })),
    });
  }));

  app.get('/api/progress', wrap((_req, res) => {
    res.json(orchestrator.store.discovery.listProgress());
  }));

  /**
   * Registers live app endpoints at runtime.
   *
   * The engine needs to know an integration exists before it can prefer it, and
   * ports are not known at build time. This is how the dashboard tells the
   * engine where the applications it is meant to automate actually are.
   */
  const endpointsSchema = z.record(z.string().url());

  app.post('/api/endpoints', wrap((req, res) => {
    const endpoints = endpointsSchema.parse(req.body ?? {});
    orchestrator.registerEndpoints(endpoints);
    res.json(orchestrator.getEndpoints());
  }));

  app.get('/api/workflows', wrap((req, res) => {
    const status = typeof req.query.status === 'string' ? (req.query.status as never) : undefined;
    res.json(orchestrator.store.workflows.list(status));
  }));

  app.get('/api/workflows/:id', wrap((req, res) => {
    const workflow = orchestrator.store.workflows.get(req.params.id);
    if (!workflow) throw errors.api('workflow_not_found', `No workflow with id ${req.params.id}`);
    res.json({
      workflow,
      versions: orchestrator.store.workflows.versions(workflow.id),
      runs: orchestrator.store.runs.list(200).filter((r) => r.workflowId === workflow.id),
    });
  }));

  app.post('/api/workflows/:id/approve', wrap((req, res) => {
    res.json(orchestrator.approveWorkflow(req.params.id));
  }));

  app.post('/api/workflows/:id/reject', wrap((req, res) => {
    const note = typeof req.body?.note === 'string' ? req.body.note : undefined;
    res.json(orchestrator.rejectWorkflow(req.params.id, note));
  }));

  app.patch('/api/workflows/:id', wrap((req, res) => {
    const { steps: stepEdits, ...rest } = patchSchema.parse(req.body ?? {});
    if (!stepEdits) {
      res.json(orchestrator.updateWorkflow(req.params.id, rest));
      return;
    }
    const current = orchestrator.store.workflows.get(req.params.id);
    if (!current) throw errors.api('workflow_not_found', `No workflow with id ${req.params.id}`);
    const byId = new Map(stepEdits.map((s) => [s.id, s]));
    const steps = current.steps
      .map((step) => {
        const edit = byId.get(step.id);
        if (!edit) return step;
        return { ...step, ...(edit.risk ? { risk: edit.risk } : {}), ...(edit.label ? { label: edit.label } : {}) };
      })
      .filter((step) => byId.get(step.id)?.enabled !== false);
    res.json(orchestrator.updateWorkflow(req.params.id, { ...rest, steps }));
  }));

  app.post('/api/workflows/:id/run', wrap(async (req, res) => {
    const body = runSchema.parse(req.body ?? {});
    if (body.endpoints) orchestrator.registerEndpoints(body.endpoints);
    const result = await orchestrator.startRun({
      workflowId: req.params.id,
      variables: body.variables,
      endpoints: body.endpoints,
    });
    res.json(result);
  }));

  app.get('/api/runs', wrap((req, res) => {
    const limit = Number(req.query.limit ?? 50);
    res.json(orchestrator.store.runs.list(Number.isFinite(limit) ? limit : 50));
  }));

  app.get('/api/runs/:id', wrap((req, res) => {
    const run = orchestrator.store.runs.get(req.params.id);
    if (!run) throw errors.api('run_not_found', `No run with id ${req.params.id}`);
    res.json(run);
  }));

  app.post('/api/runs/:id/abort', wrap((req, res) => {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    res.json({ aborted: orchestrator.abortRun(req.params.id, reason) });
  }));

  app.get('/api/reviews', wrap((req, res) => {
    const pending = req.query.pending === 'true';
    res.json(pending ? orchestrator.store.reviews.listPending() : orchestrator.store.reviews.list());
  }));

  app.post('/api/reviews/:id/respond', wrap((req, res) => {
    const body = reviewSchema.parse(req.body ?? {});
    const answered = orchestrator.respondToReview(req.params.id, {
      resolution: body.resolution,
      selector: body.selector as never,
    });
    res.json({ answered });
  }));

  app.get('/api/feedback', wrap((_req, res) => {
    res.json(orchestrator.store.feedback.list());
  }));

  app.get('/api/stream', (req, res) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write(': connected\n\n');

    const unsubscribe = orchestrator.bus.subscribe((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 15_000);

    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
      res.end();
    });
  });

  return app;
}
