// =============================================================================
// A BUYER ON ETSY IS HEARD, AND ANSWERED BY A PERSON.
//
//   Etsy's message emails, forwarded to the Workshop's address, reach Foundry
//   → they never enter the Workshop's own correspondence, which answers mail
//   by email and would be answering Etsy's notifier → Foundry keeps when a
//   buyer wrote and which saved reply fits, never their name or their words,
//   because the shop's privacy policy says so → the same email twice is one
//   buyer → an Etsy account email is not a buyer → the owner sees a buyer
//   waiting, cannot put it off, and says when it is answered → every saved
//   reply says only what the listing or its how-to already says.
//
// Nobody real is written to. Every provider is stubbed at the network edge.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '7'.repeat(64);
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.RESEND_API_KEY = 're_test_key';
process.env.CLOUDFLARE_API_TOKEN = 'cfat_test_token';
process.env.CLOUDFLARE_ACCOUNT_ID = 'acct_test';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'thomas@example.com';
process.env.APP_URL = 'http://localhost:8080';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import '../../src/services/integration/cloudflare-gateway.js';
import { providerStubs } from '../helpers/provider-stubs.js';
import { establishPublicWorkshop } from '../../src/services/public-workshop/settings.js';
import { standUpWorkshop } from '../../src/services/public-workshop/infrastructure.js';
import { openTheEars } from '../../src/services/public-workshop/mail.js';
import { mountWorkshopMail } from '../../src/routes/workshop-mail.js';
import { SAVED_REPLIES, readEtsyMail, isEtsyMail, buyersWaiting } from '../../src/services/venture/etsy-messages.js';
import { HOW_TO_MD, LISTING_MD, OWNER_ACTS_MD } from '../../src/services/venture/proof-2-content.js';
import { needsYou, snooze, SnoozeRefused } from '../../src/services/needs-you/queue.js';

vi.setConfig({ testTimeout: 180_000 });
const OWNER = 'eb_owner'; const FOUNDRY = 'eb_foundry';
const { fetch: fetchStub } = providerStubs();
let app: Hono; let INTAKE = '';
const rowsOf = async (sql: string, p: unknown[] = []) => (await query(sql, p)).rows as unknown as Array<Record<string, unknown>>;

// What Etsy's notification is taken to look like. The real template has not
// been seen by this environment; the first real one is the proof (recorded as
// debt). The footer line is the one that must not be read as a buyer's words.
const etsyRaw = (id: string, words: string, over: { from?: string; subject?: string; extra?: string } = {}) => [
  `From: ${over.from ?? 'Etsy <conversations@mail.etsy.com>'}`, 'To: thomas@apexmicro.ai',
  `Subject: ${over.subject ?? 'Etsy Conversations: New message from Margaret Quill'}`,
  `Message-ID: <${id}@mail.etsy.com>`, 'Content-Type: text/plain; charset=utf-8', '',
  'Margaret Quill sent you a message', '', words, '', over.extra ?? '',
  'Reply on Etsy', 'Download the Etsy app to reply on the go.', 'Etsy, Inc., Brooklyn, NY. Unsubscribe from these notifications.',
].join('\r\n');

const deliver = async (raw: string, headers: Record<string, string>) => app.request('/workshop/mail', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-workshop-intake': INTAKE },
  body: JSON.stringify({ to: 'thomas@apexmicro.ai', from: 'bounce@mail.etsy.com',
    headers: { ...headers }, raw_base64: Buffer.from(raw).toString('base64'), size: raw.length }),
});
const headersOf = (raw: string): Record<string, string> => {
  const h: Record<string, string> = {};
  for (const line of raw.split('\r\n\r\n')[0]!.split('\r\n')) {
    const i = line.indexOf(':'); h[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
  }
  return h;
};
const send = async (raw: string) => deliver(raw, headersOf(raw));

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchStub);
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)`, [OWNER, 'eb_clk', 'thomas@example.com', 'Thomas Norton']);
  await query(`INSERT INTO products (id,name,owner_id,status,operating_budget_monthly_usd) VALUES (?,'Foundry',?,'active',50)`, [FOUNDRY, OWNER]);
  await query(`INSERT INTO system_identities (identity_key,product_id,established_reason) VALUES ('foundry',?,'hearing')`, [FOUNDRY]);
  await establishPublicWorkshop({ founderId: OWNER });
  await standUpWorkshop(OWNER);
  INTAKE = (await openTheEars(OWNER)).intakeKey;
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never, { id: OWNER, email: 'thomas@example.com', preferences: {} } as never);
    c.set('csrfToken' as never, 't' as never); await next();
  });
  mountWorkshopMail(app);
  app.route('/', letterRoutes);
});
afterAll(() => { vi.unstubAllGlobals(); });

describe('what reaches Foundry from Etsy', () => {
  it('is kept as a buyer waiting, apart from the Workshop\'s own mail, with nothing of what they wrote', async () => {
    const mailBefore = (await rowsOf('SELECT COUNT(*) AS n FROM workshop_mail')).at(0)!.n;
    const r = await send(etsyRaw('convo-1', 'Hi, the file is no use for my business. Could I get a refund please?'));
    expect(r.status).toBe(200);

    // NOT THE WORKSHOP'S MAIL. Its correspondence answers by email, and the
    // address it would answer is Etsy's notifier.
    expect((await rowsOf('SELECT COUNT(*) AS n FROM workshop_mail')).at(0)!.n).toBe(mailBefore);
    expect((await rowsOf('SELECT COUNT(*) AS n FROM workshop_replies')).at(0)!.n).toBe(0);

    const kept = await rowsOf('SELECT * FROM etsy_mail_heard WHERE founder_id = ?', [OWNER]);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.kind).toBe('buyer_message');
    expect(kept[0]!.suggested_reply).toBe('refund');
    // THE PRIVACY POLICY: "never your name or email". Nothing a buyer wrote,
    // and not their name, is anywhere in the row.
    const everything = JSON.stringify(kept[0]).toLowerCase();
    for (const theirs of ['margaret', 'quill', 'no use for my business', 'could i get']) {
      expect(everything).not.toContain(theirs);
    }
  });

  it('hears the same email twice as one buyer', async () => {
    await send(etsyRaw('convo-1', 'Hi, the file is no use for my business. Could I get a refund please?'));
    expect(await rowsOf('SELECT id FROM etsy_mail_heard WHERE founder_id = ?', [OWNER])).toHaveLength(1);
  });

  it('recognises an email the owner forwarded by hand', async () => {
    const raw = [
      'From: Thomas Norton <thomas@example.com>', 'To: thomas@apexmicro.ai',
      'Subject: Fwd: Etsy Conversations: New message from Margaret Quill',
      'Message-ID: <fwd-1@example.com>', 'Content-Type: text/plain; charset=utf-8', '',
      '---------- Forwarded message ---------', 'From: Etsy <conversations@mail.etsy.com>',
      'Subject: Etsy Conversations: New message from Margaret Quill', '',
      'Margaret Quill sent you a message', '', 'Does it work in Google Sheets?',
    ].join('\r\n');
    expect(isEtsyMail('thomas@example.com', raw)).toBe(true);
    await send(raw);
    const row = (await rowsOf(`SELECT * FROM etsy_mail_heard WHERE suggested_reply = 'google_sheets'`))[0];
    expect(row?.kind).toBe('buyer_message');
  });

  it('leaves everybody else to the Workshop', async () => {
    expect(isEtsyMail('office@example.com', 'Do you cover Worcester county?')).toBe(false);
    // A display name or a word is not a sender: only an etsy.com address is.
    expect(isEtsyMail('etsy@example.com', 'Etsy sent you a message')).toBe(false);
    expect(isEtsyMail('someone@notetsy.com', 'hello')).toBe(false);
    const raw = ['From: "A Shop" <office@example.com>', 'To: thomas@apexmicro.ai', 'Subject: Coverage',
      'Message-ID: <plain-1@example.com>', 'Content-Type: text/plain', '', 'Do you cover Worcester county?'].join('\r\n');
    await send(raw);
    expect(await rowsOf(`SELECT id FROM workshop_mail WHERE rfc_message_id = '<plain-1@example.com>'`)).toHaveLength(1);
  });

  it('does not take an Etsy account email for a buyer, and keeps none of it', async () => {
    await send(etsyRaw('code-1', 'Your Etsy sign in code is 482913', { subject: 'Your Etsy security code' }));
    const row = (await rowsOf(`SELECT * FROM etsy_mail_heard WHERE kind = 'not_a_buyer'`))[0];
    expect(row).toBeDefined();
    expect(row!.suggested_reply).toBeNull();
    expect(JSON.stringify(row)).not.toContain('482913');
  });
});

describe('reading, by rules, and only a suggestion', () => {
  it('does not read Etsy\'s own footer as the buyer asking for a download', () => {
    const r = readEtsyMail('Etsy Conversations: New message from Margaret Quill',
      'Margaret Quill sent you a message\n\nI just wanted to say hello.\n\nReply on Etsy\nDownload the Etsy app to reply on the go.');
    expect(r.kind).toBe('buyer_message');
    expect(r.suggested).toBeNull();
  });

  it('names its grounds in its own words, never the buyer\'s', () => {
    const r = readEtsyMail('New message', 'Margaret sent you a message\n\nI can\'t find the file after buying it');
    expect(r.suggested).toBe('download');
    expect(r.because).toMatch(/^they wrote “[^”]+”$/);
    expect(r.because).not.toContain('Margaret');
  });

  it('reads quoted-printable mail as words', () => {
    const r = readEtsyMail('New message', 'Margaret sent you a message\n\nCould I have a re=\nfund =E2=80=94 thanks');
    expect(r.suggested).toBe('refund');
  });
});

describe('what the owner sees', () => {
  it('a buyer waiting is urgent and cannot be put off', async () => {
    const { items } = await needsYou(OWNER);
    const etsy = items.filter((i) => i.key.startsWith('etsy:'));
    expect(etsy.length).toBe(2);
    for (const i of etsy) {
      expect(i.level).toBe('urgent');
      expect(i.snoozable).toBe(false);
      expect(i.href).toBe('/foundry/etsy-messages');
    }
    await expect(snooze(OWNER, etsy[0]!.key)).rejects.toBeInstanceOf(SnoozeRefused);
  });

  it('shows each buyer with the reply that fits, ready to copy, and every saved reply', async () => {
    const r = await app.request('/foundry/etsy-messages');
    expect(r.status).toBe(200);
    const page = await r.text();
    const refund = SAVED_REPLIES.find((s) => s.key === 'refund')!;
    expect(page).toContain(refund.title);
    expect(page).toContain('data-copy="reply-refund');
    for (const s of SAVED_REPLIES) expect(page).toContain(`id="saved-${s.key}"`);
    // Where to forward, read from the Workshop rather than typed.
    expect(page).toContain('thomas@apexmicro.ai');
    expect(page).not.toContain('Margaret');
  });

  it('the owner says when it is answered, and it leaves the queue', async () => {
    const waiting = await buyersWaiting(OWNER);
    expect(waiting).toHaveLength(2);
    const r = await app.request(`/foundry/etsy-messages/${waiting[0]!.id}/answered`, { method: 'POST' });
    expect(r.status).toBe(302);
    expect(await buyersWaiting(OWNER)).toHaveLength(1);
    // A stranger's id answers nothing.
    const again = await app.request('/foundry/etsy-messages/not-a-real-id/answered', { method: 'POST' });
    expect(again.status).toBe(302);
    expect(await buyersWaiting(OWNER)).toHaveLength(1);
  });
});

describe('every saved reply says only what is already promised', () => {
  const SOURCES: Record<string, string> = { listing: LISTING_MD, how_to: HOW_TO_MD, owner_acts: OWNER_ACTS_MD };
  it('quotes its source, exactly, and is signed by a person', () => {
    expect(SAVED_REPLIES.length).toBeGreaterThanOrEqual(6);
    for (const s of SAVED_REPLIES) {
      expect(SOURCES[s.source.doc], s.key).toBeDefined();
      expect(SOURCES[s.source.doc], s.key).toContain(s.source.quote);
      expect(s.text.endsWith('— Thomas, Apex Micro'), s.key).toBe(true);
      expect(s.text.length, s.key).toBeLessThanOrEqual(600);
    }
    expect(new Set(SAVED_REPLIES.map((s) => s.key)).size).toBe(SAVED_REPLIES.length);
  });

  it('a refund reply is sent only after the refund is made, and says so to the owner', () => {
    const refund = SAVED_REPLIES.find((s) => s.key === 'refund')!;
    expect(refund.beforeSending).toMatch(/Refund the order in Etsy first/);
  });
});
