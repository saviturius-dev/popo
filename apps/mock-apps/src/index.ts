import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { createCrmApp, CRM_HOST } from './crm.js';
import { createGmailApp, GMAIL_HOST } from './gmail.js';
import { createSlackApp, SLACK_HOST } from './slack.js';
import { seedState, type MockState } from './state.js';

export interface MockAppHandle {
  appId: string;
  host: string;
  url: string;
  port: number;
  server: Server;
}

export interface MockApps {
  state: MockState;
  gmail: MockAppHandle;
  crm: MockAppHandle;
  slack: MockAppHandle;
  endpoints: Record<string, string>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

function listen(app: express.Express, port: number): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(port, '127.0.0.1', () => resolve(server));
  });
}

/**
 * Boots the three mock applications on ephemeral loopback ports.
 *
 * Ephemeral ports keep concurrent test runs from colliding, which is why the
 * recorded trace URLs use symbolic hosts (`http://gmail.mock/...`): the engine
 * rewrites the origin at run time from the endpoint registry, so a fixture stays
 * valid no matter which port the apps land on.
 */
export async function startMockApps(options: { port?: number } = {}): Promise<MockApps> {
  const state = seedState();
  const port = options.port ?? 0;

  const [gmailServer, crmServer, slackServer] = await Promise.all([
    listen(createGmailApp(state), port),
    listen(createCrmApp(state), port),
    listen(createSlackApp(state), port),
  ]);

  const handle = (appId: string, host: string, server: Server): MockAppHandle => ({
    appId,
    host,
    port: (server.address() as AddressInfo).port,
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    server,
  });

  const gmail = handle('gmail', GMAIL_HOST, gmailServer);
  const crm = handle('crm', CRM_HOST, crmServer);
  const slack = handle('slack', SLACK_HOST, slackServer);

  return {
    state,
    gmail,
    crm,
    slack,
    endpoints: { gmail: gmail.url, crm: crm.url, slack: slack.url },
    async reset() {
      await Promise.all([
        fetch(`${gmail.url}/api/reset`, { method: 'POST' }),
        fetch(`${crm.url}/api/reset`, { method: 'POST' }),
        fetch(`${slack.url}/api/reset`, { method: 'POST' }),
      ]);
    },
    async close() {
      await Promise.all(
        [gmailServer, crmServer, slackServer].map(
          (server) => new Promise<void>((resolve) => server.close(() => resolve())),
        ),
      );
    },
  };
}

export * from './state.js';
export * from './html.js';
export { createGmailApp, GMAIL_HOST } from './gmail.js';
export { createCrmApp, CRM_HOST } from './crm.js';
export { createSlackApp, SLACK_HOST, DEFAULT_CHANNEL } from './slack.js';
