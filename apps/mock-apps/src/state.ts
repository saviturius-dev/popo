/**
 * Shared, in-memory state for the three mock applications.
 *
 * Deterministic ids and seed data matter: the end-to-end test asserts exact
 * records, and a workflow run that "worked" against random data would prove
 * nothing.
 */

export interface Customer {
  id: string;
  name: string;
  email: string;
  company: string;
  notes: string;
  attachment: string;
  updatedAt: number | null;
}

export interface EmailMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  customerId: string;
  attachmentName: string;
  attachmentContent: string;
  downloaded: boolean;
  downloadedPath?: string;
}

export interface SlackMessage {
  id: string;
  channel: string;
  text: string;
  ts: number;
}

export interface MockState {
  customers: Customer[];
  emails: EmailMessage[];
  messages: SlackMessage[];
  nextMessageId: number;
}

export function seedState(): MockState {
  return {
    nextMessageId: 1,
    customers: [
      {
        id: 'cus-1001',
        name: 'Priya Nair',
        email: 'priya.nair@northwind.example',
        company: 'Northwind',
        notes: '',
        attachment: '',
        updatedAt: null,
      },
      {
        id: 'cus-1002',
        name: 'Marcus Delgado',
        email: 'marcus.delgado@contoso.example',
        company: 'Contoso',
        notes: '',
        attachment: '',
        updatedAt: null,
      },
      {
        id: 'cus-1003',
        name: 'Elena Okafor',
        email: 'elena.okafor@globex.example',
        company: 'Globex',
        notes: '',
        attachment: '',
        updatedAt: null,
      },
    ],
    emails: [
      {
        id: 'req-5001',
        from: 'priya.nair@northwind.example',
        to: 'support@workflowos.example',
        subject: 'Invoice dispute on order 10001',
        body: 'Customer reports a billing error and requests a refund review.',
        customerId: 'cus-1001',
        attachmentName: 'invoice-dispute-10001.pdf',
        attachmentContent: '%PDF-1.4 mock invoice dispute attachment',
        downloaded: false,
      },
      {
        id: 'req-5002',
        from: 'marcus.delgado@contoso.example',
        to: 'support@workflowos.example',
        subject: 'Shipping delay for order 10002',
        body: 'Customer escalated a shipping delay; needs a delivery date commitment.',
        customerId: 'cus-1002',
        attachmentName: 'shipping-delay-10002.pdf',
        attachmentContent: '%PDF-1.4 mock shipping delay attachment',
        downloaded: false,
      },
    ],
    messages: [],
  };
}

export function findCustomer(state: MockState, id: string): Customer | undefined {
  return state.customers.find((c) => c.id === id);
}

export function searchCustomers(state: MockState, query: string): Customer[] {
  const q = query.trim().toLowerCase();
  if (q === '') return state.customers;
  return state.customers.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      c.company.toLowerCase().includes(q),
  );
}

/** The message the mail integration would hand to the user next. */
export function nextEmail(state: MockState): EmailMessage | undefined {
  return state.emails.find((e) => !e.downloaded) ?? state.emails[state.emails.length - 1];
}
