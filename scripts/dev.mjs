import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * One command to see the whole system.
 *
 * The mock applications, the engine API and the dashboard are three processes
 * with one dependency each: the engine needs endpoints for its integrations, and
 * the dashboard needs the engine. Starting them in one place with a shared
 * database keeps a developer's environment from drifting into a state where the
 * UI is talking to an engine that cannot reach the apps it is automating.
 */
const isWindows = process.platform === 'win32';
const bin = (name) => (isWindows ? `${name}.cmd` : name);

const apiPort = Number(process.env.PORT ?? 4310);
const children = [];
let shuttingDown = false;

function start(name, command, args, env = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: isWindows,
  });
  child.on('exit', (code) => {
    if (shuttingDown) return;
    process.stderr.write(`\n[dev] ${name} exited with code ${code}; stopping the rest.\n`);
    shutdown(code ?? 1);
  });
  children.push({ name, child });
  return child;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// The mock apps must be listening before the engine reads their endpoints, so
// the engine waits for the file they publish rather than for a guessed delay.
const dbFile =
  process.env.WORKFLOWOS_DB ?? join(mkdtempSync(join(tmpdir(), 'workflowos-')), 'workflowos.sqlite');
const endpointsFile = join('data', 'mock-endpoints.json');

process.stdout.write(`[dev] database ${dbFile}\n`);
start('mock-apps', bin('npx'), ['tsx', 'apps/mock-apps/src/main.ts']);

function startRest() {
  start('api', bin('npx'), ['tsx', 'packages/orchestrator/src/main.ts'], {
    PORT: String(apiPort),
    WORKFLOWOS_DB: dbFile,
    WORKFLOWOS_ENDPOINTS_FILE: endpointsFile,
  });
  start('dashboard', bin('npx'), ['vite', '--config', 'apps/dashboard/vite.config.ts'], {
    WORKFLOWOS_API: `http://127.0.0.1:${apiPort}`,
  });
}

const deadline = Date.now() + 30_000;
const poll = setInterval(() => {
  if (existsSync(endpointsFile)) {
    clearInterval(poll);
    process.stdout.write(`[dev] mock endpoints ready at ${endpointsFile}\n`);
    startRest();
  } else if (Date.now() > deadline) {
    clearInterval(poll);
    process.stderr.write('[dev] mock apps never published their endpoints; starting anyway.\n');
    startRest();
  }
}, 200);
