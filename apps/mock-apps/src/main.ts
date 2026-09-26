import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { startMockApps } from './index.js';

const apps = await startMockApps({ port: Number(process.env.MOCK_PORT ?? 0) });

/**
 * The engine learns where the apps are by reading this file.
 *
 * The ports are ephemeral, so a fixed configuration would be wrong the moment a
 * second copy of the apps started. Writing the real endpoints down once, at
 * boot, keeps discovery of them an ordinary file read instead of a port
 * convention both processes would have to agree on.
 */
const endpointsFile = process.env.MOCK_ENDPOINTS_FILE ?? 'data/mock-endpoints.json';
mkdirSync(dirname(endpointsFile), { recursive: true });
writeFileSync(endpointsFile, `${JSON.stringify(apps.endpoints, null, 2)}\n`, 'utf8');

process.stdout.write(
  [
    'Mock applications running:',
    `  gmail  ${apps.gmail.url}`,
    `  crm    ${apps.crm.url}`,
    `  slack  ${apps.slack.url}`,
    '',
    `Endpoints written to ${endpointsFile}`,
    'Press Ctrl+C to stop.',
    '',
  ].join('\n'),
);

const shutdown = async () => {
  await apps.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
