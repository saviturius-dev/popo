import express from 'express';
import { escapeHtml, layout } from './html.js';
import { nextEmail, seedState, type EmailMessage, type MockState } from './state.js';

export const GMAIL_HOST = 'gmail.mock';

export function createGmailApp(state: MockState): express.Express {
  const app = express();
  app.use(express.json());

  app.get('/', (_req, res) => {
    res.redirect('/inbox');
  });

  app.get('/inbox', (_req, res) => {
    const pending = state.emails.filter((e) => !e.downloaded);
    const focus = pending[0] ?? state.emails[0];
    res.send(
      layout({
        title: 'Inbox',
        app: 'Gmail (mock)',
        body: `
        <h1>Inbox</h1>
        <p class="muted">${state.emails.length} message(s), ${pending.length} awaiting attachment download.</p>
        <ul>
          ${focus
            ? `<li>
                 <a href="/mail/${escapeHtml(focus.id)}" data-testid="next-request">Next request</a>
                 <span class="muted">${escapeHtml(focus.subject)}</span>
               </li>`
            : `<li class="muted">Inbox is empty.</li>`}
        </ul>`,
      }),
    );
  });

  app.get('/mail/:id', (req, res) => {
    const email = state.emails.find((e) => e.id === req.params.id);
    if (!email) {
      res.status(404).send(layout({ title: 'Not found', app: 'Gmail (mock)', body: '<h1>Message not found</h1>' }));
      return;
    }
    res.send(renderMessage(email));
  });

  app.get('/api/attachments/next', (_req, res) => {
    const email = nextEmail(state);
    if (!email) {
      res.status(404).json({ error: 'no messages' });
      return;
    }
    res.json({ id: email.id, filename: email.attachmentName, content: email.attachmentContent });
  });

  app.get('/api/attachments/:id', (req, res) => {
    const email = state.emails.find((e) => e.id === req.params.id);
    if (!email) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    email.downloaded = true;
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="${email.attachmentName}"`);
    res.send(email.attachmentContent);
  });

  app.get('/api/state', (_req, res) => {
    res.json({
      app: 'gmail',
      emails: state.emails.map((e) => ({
        id: e.id,
        subject: e.subject,
        from: e.from,
        attachmentName: e.attachmentName,
        downloaded: e.downloaded,
        downloadedPath: e.downloadedPath ?? null,
      })),
    });
  });

  app.post('/api/reset', (_req, res) => {
    Object.assign(state, seedState());
    res.json({ ok: true });
  });

  return app;
}

function renderMessage(email: EmailMessage): string {
  return layout({
    title: email.subject,
    app: 'Gmail (mock)',
    body: `
      <h1>${escapeHtml(email.subject)}</h1>
      <dl>
        <dt>From</dt><dd data-testid="from">${escapeHtml(email.from)}</dd>
        <dt>To</dt><dd>${escapeHtml(email.to)}</dd>
        <dt>Message id</dt><dd><code>${escapeHtml(email.id)}</code></dd>
      </dl>
      <p>${escapeHtml(email.body)}</p>
      <p><button data-testid="download-attachment">Download attachment</button></p>
      <p class="muted">Attachment: <code>${escapeHtml(email.attachmentName)}</code></p>`,
  });
}
