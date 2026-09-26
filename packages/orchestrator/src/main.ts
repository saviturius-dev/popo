import { existsSync, readFileSync } from 'node:fs';
import { Orchestrator } from './orchestrator.js';
import { createApiServer } from './api.js';

const port = Number(process.env.PORT ?? 4310);
const dbFile = process.env.WORKFLOWOS_DB ?? 'data/workflowos.sqlite';
const endpointsFile = process.env.WORKFLOWOS_ENDPOINTS_FILE ?? 'data/mock-endpoints.json';

const orchestrator = Orchestrator.create({
  dbFile,
  headless: process.env.WORKFLOWOS_HEADFUL !== '1',
  enableUia: process.env.WORKFLOWOS_ENABLE_UIA === '1',
});

/**
 * Registers the endpoints of any app that published them at boot.
 *
 * Without this the engine can still drive every target through the browser, but
 * it will not know that a trusted integration exists, and it would climb the
 * tier ladder past a one-request API call to do the same work with pixels.
 */
let registered = '';
function loadEndpoints(): void {
  if (!existsSync(endpointsFile)) return;
  try {
    const endpoints = JSON.parse(readFileSync(endpointsFile, 'utf8')) as Record<string, string>;
    const next = JSON.stringify(endpoints);
    if (Object.keys(endpoints).length === 0 || next === registered) return;
    registered = next;
    orchestrator.registerEndpoints(endpoints);
    process.stdout.write(`Registered endpoints: ${Object.keys(endpoints).join(', ')}\n`);
  } catch (cause) {
    process.stderr.write(`Could not read ${endpointsFile}: ${String(cause)}\n`);
  }
}

loadEndpoints();
const watcher = setInterval(loadEndpoints, 5_000);
watcher.unref();

const server = createApiServer(orchestrator).listen(port, () => {
  process.stdout.write(`WorkFlowOS API listening on http://127.0.0.1:${port}\n`);
  process.stdout.write(`Dashboard: http://127.0.0.1:5173 (pnpm dev)\n`);
  process.stdout.write(`Database: ${dbFile}\n`);
});

const shutdown = () => {
  clearInterval(watcher);
  server.close();
  void orchestrator.close().finally(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
