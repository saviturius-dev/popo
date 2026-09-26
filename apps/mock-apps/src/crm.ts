import express from 'express';
import { escapeHtml, layout } from './html.js';
import { findCustomer, searchCustomers, seedState, type Customer, type MockState } from './state.js';

export const CRM_HOST = 'crm.mock';

export function createCrmApp(state: MockState): express.Express {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  app.get('/', (_req, res) => res.redirect('/customers'));

  app.get('/customers', (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    const results = searchCustomers(state, query);
    res.send(renderList(query, results));
  });

  app.get('/customers/:id', (req, res) => {
    const customer = findCustomer(state, req.params.id);
    if (!customer) {
      res
        .status(404)
        .send(layout({ title: 'Not found', app: 'CRM (mock)', body: '<h1>Customer not found</h1>' }));
      return;
    }
    res.send(renderDetail(customer));
  });

  app.post('/customers/:id', (req, res) => {
    const customer = findCustomer(state, req.params.id);
    if (!customer) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    applyUpdate(customer, req.body as Record<string, string>);
    res.redirect(`/customers/${customer.id}?updated=1`);
  });

  app.get('/api/customers', (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    res.json({ customers: searchCustomers(state, query) });
  });

  app.get('/api/customers/:id', (req, res) => {
    const customer = findCustomer(state, req.params.id);
    if (!customer) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(customer);
  });

  app.post('/api/customers/:id', (req, res) => {
    const customer = findCustomer(state, req.params.id);
    if (!customer) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    applyUpdate(customer, req.body as Record<string, string>);
    res.json(customer);
  });

  app.get('/api/state', (_req, res) => {
    res.json({
      app: 'crm',
      customers: state.customers.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        notes: c.notes,
        attachment: c.attachment,
        updatedAt: c.updatedAt ?? null,
      })),
    });
  });

  app.post('/api/reset', (_req, res) => {
    Object.assign(state, seedState());
    res.json({ ok: true });
  });

  return app;
}

function applyUpdate(customer: Customer, body: Record<string, string>): void {
  if (typeof body.notes === 'string') customer.notes = body.notes;
  if (typeof body.attachment === 'string') customer.attachment = body.attachment;
  customer.updatedAt = Date.now();
}

function renderList(query: string, results: Customer[]): string {
  const body =
    results.length === 0
      ? `<p class="muted" data-testid="no-results">No matching customer</p>
         <ul></ul>`
      : `<ul>
          ${results
            .map(
              (c) => `<li data-testid="result-${c.id}">
                        <span>${escapeHtml(c.name)} <span class="muted">&lt;${escapeHtml(c.email)}&gt;</span></span>
                        <a href="/customers/${escapeHtml(c.id)}" data-testid="open-record">Open record</a>
                      </li>`,
            )
            .join('\n')}
        </ul>`;

  return layout({
    title: 'Customers',
    app: 'CRM (mock)',
    body: `
      <h1>Customers</h1>
      <form class="inline" method="get" action="/customers">
        <div>
          <label for="q">Search customers</label>
          <input id="q" name="q" type="text" value="${escapeHtml(query)}" placeholder="name, email or company" />
        </div>
        <button type="submit" data-testid="run-search">Run search</button>
      </form>
      <p class="muted" data-testid="result-count">${results.length} result(s)</p>
      ${body}`,
  });
}

function renderDetail(customer: Customer): string {
  return layout({
    title: customer.name,
    app: 'CRM (mock)',
    body: `
      <h1>${escapeHtml(customer.name)}</h1>
      <dl>
        <dt>Customer id</dt><dd><code data-testid="customer-id">${escapeHtml(customer.id)}</code></dd>
        <dt>Email</dt><dd>${escapeHtml(customer.email)}</dd>
        <dt>Company</dt><dd>${escapeHtml(customer.company)}</dd>
        <dt>Last updated</dt><dd data-testid="updated-at">${customer.updatedAt ? new Date(customer.updatedAt).toISOString() : 'never'}</dd>
      </dl>
      <form method="post" action="/customers/${escapeHtml(customer.id)}">
        <label for="notes">Request notes</label>
        <textarea id="notes" name="notes" rows="4">${escapeHtml(customer.notes)}</textarea>
        <label for="attachment">Attachment</label>
        <input id="attachment" name="attachment" type="text" value="${escapeHtml(customer.attachment)}" />
        <p><button type="submit" data-testid="update-record">Update record</button></p>
      </form>`,
  });
}
