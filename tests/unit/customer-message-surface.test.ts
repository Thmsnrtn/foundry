process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  ingestCustomerMessage, registerSupportChannel,
} from '../../src/services/institution/customer-message-intake.js';
import { getMessagesAwaitingReply, proposeSupportReply } from '../../src/services/institution/support-reply.js';

// =============================================================================
// The support vertical had three write routes and no way in.
//
//   POST /letter/messages/:messageId/reply
//   POST /letter/replies/:proposalId/plan
//   POST /letter/replies/:actionId/send
//
// All three existed. Nothing rendered a message, so a founder could never
// obtain a `messageId` to post to — `getMessagesForResponsibility` and
// `getSupportReplyState` had no caller outside their own module. The chain was
// reachable only from a test.
//
// Found by reading the rendering layer: hunting for an escaping defect in
// customer content and discovering the customer content never reached a page
// at all. The escaping promise the intake makes — "the surface escapes it" —
// was a claim about a surface that did not exist.
// =============================================================================

const OWNER = 'cms_owner';
const P = 'cms_co';
const OTHER = 'cms_other';
const HOSTILE = '<script>fetch("/admin")</script> please refund me';

let app: Hono;
let intakeKey: string;

async function responsibility(
  id: string, productId: string, state: string,
): Promise<void> {
  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
     VALUES (?,?,'support','support_spike','high','{}','seed')`, [`${id}_sig`, productId]);
  await query(
    `INSERT INTO institutional_responsibilities (id,product_id,title,capability,state,discovery_evidence_ref)
     VALUES (?,?,'Answer people waiting on a quote','customer_support',?,?)`,
    [id, productId, state, `signal_event:${id}_sig`]);
}

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query(
    `INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?),(?,?,?)`,
    [OWNER, 'cms_c1', 'o@example.com', 'cms_owner2', 'cms_c2', 'x@example.com']);
  await query('INSERT INTO products (id,name,owner_id,status) VALUES (?,?,?,?),(?,?,?,?)',
    [P, 'Barrowfield Groundworks', OWNER, 'active', OTHER, 'Other Co', 'cms_owner2', 'active']);

  await responsibility('cms_resp', P, 'shadowing');
  await responsibility('cms_unknown', P, 'visible');
  await responsibility('cms_foreign', OTHER, 'shadowing');

  const channel = await registerSupportChannel({
    productId: P, responsibilityId: 'cms_resp', founderId: OWNER, label: 'quotes@ inbox' });
  intakeKey = channel!.intakeKey;
  await ingestCustomerMessage({
    intakeKey, externalMessageId: 'evt-1', contactEmail: 'jo@fieldstone.example',
    subject: 'Drive and drainage quote', body: HOSTILE });

  // Another company's message, on its own channel.
  const foreign = await registerSupportChannel({
    productId: OTHER, responsibilityId: 'cms_foreign', founderId: 'cms_owner2', label: 'their inbox' });
  await ingestCustomerMessage({
    intakeKey: foreign!.intakeKey, externalMessageId: 'evt-x',
    contactEmail: 'someone@other.example', body: 'A message belonging to another tenant' });

  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never, { id: OWNER, email: 'o@example.com', preferences: {} } as never);
    c.set('csrfToken' as never, 't' as never);
    await next();
  });
  app.route('/', letterRoutes);
});

describe('a customer message reaches the founder', () => {
  it('is offered for reply, which nothing did before', async () => {
    const waiting = await getMessagesAwaitingReply(P);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({
      contactEmail: 'jo@fieldstone.example', state: 'message_only', canSend: false,
    });
    // Sending is offered only at Assisting. Shadowing means watched, not helped.
    expect(waiting[0].responsibilityTitle).toContain('quote');
  });

  it('is not offered for work Foundry has not yet understood', async () => {
    // A message about something still Visible is not something Foundry can
    // offer to help with, and showing it would imply otherwise.
    const channel = await registerSupportChannel({
      productId: P, responsibilityId: 'cms_unknown', founderId: OWNER, label: 'early inbox' });
    await ingestCustomerMessage({
      intakeKey: channel!.intakeKey, externalMessageId: 'evt-early',
      contactEmail: 'early@example.com', body: 'about something not yet understood' });

    const waiting = await getMessagesAwaitingReply(P);
    expect(waiting.map((m) => m.contactEmail)).not.toContain('early@example.com');
  });

  it('renders the customer\'s words escaped, on the page', async () => {
    // The surface half of the intake's promise, which until now was a claim
    // about a page that did not render messages at all.
    const page = await (await app.request('/letter')).text();
    expect(page).toContain('Someone wrote in');
    expect(page).toContain('jo@fieldstone.example');
    expect(page, 'the customer body must appear').toContain('please refund me');
    expect(page, 'and must never appear as live markup').not.toContain('<script>fetch');
    expect(page).toContain('&lt;script&gt;');
  });

  it('never shows another company\'s message', async () => {
    const page = await (await app.request('/letter')).text();
    expect(page).not.toContain('someone@other.example');
    expect(page).not.toContain('belonging to another tenant');

    const waiting = await getMessagesAwaitingReply(P);
    expect(waiting.map((m) => m.contactEmail)).not.toContain('someone@other.example');
  });

  it('shows a saved reply as saved, and does not offer to send it without permission', async () => {
    const waiting = await getMessagesAwaitingReply(P);
    const messageId = waiting[0].messageId;
    await proposeSupportReply({
      productId: P, founderId: OWNER, messageId,
      body: 'Sorry for the wait — Dave is on site Thursday.',
    });

    const after = await getMessagesAwaitingReply(P);
    const item = after.find((m) => m.messageId === messageId)!;
    expect(item.state).toBe('proposed');
    expect(item.proposal).toContain('Dave is on site Thursday');

    const page = await (await app.request('/letter')).text();
    expect(page).toContain('Saved, not sent');
    expect(page).toContain('you have not given me permission');
    // No send control exists for a responsibility that is only being watched.
    expect(page).not.toMatch(/action="\/letter\/replies\/[^"]+\/send"/);
  });

  it('is read by production, not only by this test', () => {
    // The defect being closed was precisely a function nothing called. A
    // surface that exists and is never composed would be the same defect.
    const letter = readFileSync(
      resolve(__dirname, '../../src/routes/dashboard/letter.ts'), 'utf8');
    expect(letter).toContain('getMessagesAwaitingReply');
    expect(letter).toContain('customerMessageSection(customerMessages)');
  });
});

describe('the channel a customer message arrives on', () => {
  it('can be created from the letter, which nothing offered before', async () => {
    // The registration route existed with no form pointing at it, so the whole
    // vertical was unreachable in production: no channel, no message, nothing
    // to reply to. `getSupportChannels` had no route caller at all.
    await responsibility('cms_nochannel', P, 'understood');

    const page = await (await app.request('/letter')).text();
    expect(page).toContain('How customers reach you');
    expect(page).toMatch(/action="\/letter\/responsibilities\/cms_nochannel\/channel"/);
  });

  it('is not offered twice for the same responsibility', async () => {
    // A second channel for one responsibility is a real thing to want, and it
    // is not what the form should suggest by default.
    const res = await app.request('/letter/responsibilities/cms_nochannel/channel', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'label=the+second+inbox',
    });
    expect(res.status).toBe(302);

    const page = await (await app.request('/letter')).text();
    expect(page).toContain('the second inbox');
    expect(page).not.toMatch(/action="\/letter\/responsibilities\/cms_nochannel\/channel"/);
  });

  it('shows the URL the helpdesk actually needs', async () => {
    // The route discarded the intake key on redirect. A credential the founder
    // cannot read is a credential they cannot use.
    const page = await (await app.request('/letter')).text();
    expect(page).toContain('/ingest/customer-message/');
    const { getSupportChannels } = await import(
      '../../src/services/institution/customer-message-intake.js');
    const channels = await getSupportChannels(P);
    expect(channels.length).toBeGreaterThan(0);
    expect(page, 'the live key must be on the page').toContain(channels[0].intakeKey);
  });

  it('never shows another company\'s channel key', async () => {
    const { getSupportChannels } = await import(
      '../../src/services/institution/customer-message-intake.js');
    const theirs = await getSupportChannels(OTHER);
    expect(theirs.length).toBeGreaterThan(0);
    const page = await (await app.request('/letter')).text();
    for (const channel of theirs) expect(page).not.toContain(channel.intakeKey);
  });

  it('stops accepting messages once withdrawn, and says nothing about why', async () => {
    const { getSupportChannels, ingestCustomerMessage: ingest } = await import(
      '../../src/services/institution/customer-message-intake.js');
    const before = (await getSupportChannels(P)).filter((c) => !c.revoked);
    const target = before.find((c) => c.label === 'quotes@ inbox')!;

    const res = await app.request(`/letter/channels/${target.id}/revoke`, { method: 'POST' });
    expect(res.status).toBe(302);

    const refused = await ingest({
      intakeKey: target.intakeKey, externalMessageId: 'evt-after-revoke',
      contactEmail: 'jo@fieldstone.example', body: 'anything',
    });
    // Identical to an unknown key: the caller learns nothing about which
    // channels exist or once existed.
    expect(refused).toEqual({ refused: 'unknown_channel' });
    expect(await ingest({
      intakeKey: 'a-key-that-never-existed-at-all', externalMessageId: 'e',
      contactEmail: 'x@example.com', body: 'y',
    })).toEqual({ refused: 'unknown_channel' });
  });
});
