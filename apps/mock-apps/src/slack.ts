import express from 'express';
import { escapeHtml, layout } from './html.js';
import { seedState, type MockState } from './state.js';

export const SLACK_HOST = 'slack.mock';
export const DEFAULT_CHANNEL = 'support';

export function createSlackApp(state: MockState): express.Express {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  app.get('/', (_req, res) => res.redirect(`/channel/${DEFAULT_CHANNEL}`));

  app.get('/channel/:channel', (req, res) => {
    const channel = req.params.channel;
    const messages = state.messages.filter((m) => m.channel === channel);
    res.send(
      layout({
        title: `#${channel}`,
        app: 'Slack (mock)',
        body: `
          <h1>#${escapeHtml(channel)}</h1>
          <div data-testid="messages">
            ${
              messages.length === 0
                ? `<p class="muted">No messages yet.</p>`
                : messages
                    .map(
                      (m) =>
                        `<div class="message" data-testid="message-${escapeHtml(m.id)}">${escapeHtml(m.text)}</div>`,
                    )
                    .join('\n')
            }
          </div>
          <form method="post" action="/channel/${escapeHtml(channel)}">
            <label for="message">Message</label>
            <textarea id="message" name="message" rows="3"></textarea>
            <p><button type="submit" data-testid="send">Send</button></p>
          </form>`,
      }),
    );
  });

  app.post('/channel/:channel', (req, res) => {
    const body = req.body as Record<string, string>;
    appendMessage(state, req.params.channel, body.message ?? '');
    res.redirect(`/channel/${req.params.channel}`);
  });

  app.post('/api/messages', (req, res) => {
    const body = req.body as { channel?: string; text?: string };
    const message = appendMessage(state, body.channel ?? DEFAULT_CHANNEL, body.text ?? '');
    res.status(201).json(message);
  });

  app.get('/api/state', (_req, res) => {
    res.json({
      app: 'slack',
      messages: state.messages.map((m) => ({ id: m.id, channel: m.channel, text: m.text, ts: m.ts })),
    });
  });

  app.post('/api/reset', (_req, res) => {
    Object.assign(state, seedState());
    res.json({ ok: true });
  });

  return app;
}

function appendMessage(state: MockState, channel: string, text: string) {
  const message = {
    id: `msg-${state.nextMessageId++}`,
    channel,
    text,
    ts: Date.now(),
  };
  state.messages.push(message);
  return message;
}
