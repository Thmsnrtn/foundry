process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  getSupportChannels, registerSupportChannel,
} from '../../src/services/institution/customer-message-intake.js';

// =============================================================================
// A PERSON WHO WROTE ONCE AND GOT NO ANSWER DOES NOT WRITE AGAIN.
//
// A customer wrote to a company and Foundry threw the message away — a wrong
// field, an oversized body, a malformed timestamp — and nothing recorded that
// it had happened. The founder saw a quiet inbox and concluded nobody had
// written.
//
// The twin of the credential case, on the intake that matters most: a metric
// can be resent, a customer generally cannot.
//
// ONLY THE SHAPE IS KEPT. What was refused is the customer's own words and
// their address; none of it reaches the record, and the reason comes from a
// closed set the database enforces.
// =============================================================================

const P = 'dm_product';
const OWNER = 'dm_owner';
const RESP = 'dm_resp';

let app: Hono;
let letters: Hono;
let intakeKey: string;

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES (?,'dm_c','o@example.com')`, [OWNER]);
  await query(`INSERT INTO products (id,name,owner_id,status) VALUES (?,'Barrowfield Groundworks',?,'active')`, [P, OWNER]);
  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
     VALUES ('dm_sig',?,'company_observation_baseline','company_observation_baseline:observed','low','{}','seed')`, [P]);
  await query(
    `INSERT INTO institutional_responsibilities (id,product_id,title,capability,state,discovery_evidence_ref)
     VALUES (?,?,'Answer people waiting on a quote','customer_support','shadowing','signal_event:dm_sig')`,
    [RESP, P]);

  const channel = await registerSupportChannel({
    productId: P, responsibilityId: RESP, founderId: OWNER, label: 'quotes@ inbox' });
  intakeKey = channel!.intakeKey;

  const { ingestRoutes } = await import('../../src/routes/ingest/index.js');
  app = new Hono();
  app.route('/', ingestRoutes);

  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  letters = new Hono();
  letters.use('*', async (c, next) => {
    c.set('founder' as never, { id: OWNER, email: 'o@example.com', preferences: {} } as never);
    c.set('csrfToken' as never, 't' as never);
    await next();
  });
  letters.route('/', letterRoutes);
});

const send = (body: string): Promise<Response> => app.request(
  `/ingest/customer-message/${intakeKey}`,
  { method: 'POST', headers: { 'content-type': 'application/json' }, body });

describe('a support channel turning customers away', () => {
  it('is counted, said plainly on the letter, and cleared when one gets through', async () => {
    expect((await getSupportChannels(P))[0]).toMatchObject({ refusalCount: 0 });
    expect(await (await letters.request('/letter')).text()).not.toContain('I have turned away');

    // A helpdesk sending the wrong field name. Three customers, three drops.
    for (let i = 0; i < 3; i += 1) {
      const res = await send(JSON.stringify({
        message_id: `evt-${i}`, from: 'jo@fieldstone.example', text: 'Can you quote the drive?' }));
      expect(res.status).toBe(422);
    }
    const failing = (await getSupportChannels(P))[0];
    expect(failing.refusalCount).toBe(3);
    expect(failing.lastRefusalReason).toBe('fields_invalid');

    const page = await (await letters.request('/letter')).text();
    expect(page).toContain('I have turned away 3 messages');
    expect(page).toContain('Somebody wrote and I did not keep it');

    // Fixed at the other end.
    const ok = await send(JSON.stringify({
      external_message_id: 'evt-ok', contact_email: 'jo@fieldstone.example',
      body: 'Can you quote the drive?' }));
    expect(ok.status).toBe(200);
    expect((await getSupportChannels(P))[0]).toMatchObject({ refusalCount: 0, lastRefusalReason: null });
  });

  it('keeps none of what it refused', async () => {
    await send('{ not json at all, from sam@fieldstone.example');
    expect((await getSupportChannels(P))[0].lastRefusalReason).toBe('body_unreadable');
    const raw = JSON.stringify((await query('SELECT * FROM support_channels WHERE product_id=?', [P])).rows);
    expect(raw).not.toContain('fieldstone');
  });

  it('leaves no trail on anybody channel for a stranger probing keys', async () => {
    const before = (await getSupportChannels(P))[0].refusalCount;
    const res = await app.request(
      '/ingest/customer-message/not-a-real-key-but-long-enough-to-pass-the-shape-check',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect([401, 422]).toContain(res.status);
    expect((await getSupportChannels(P))[0].refusalCount).toBe(before);
  });

  it('refuses a reason the vocabulary does not contain, in the database', async () => {
    await expect(query(
      "UPDATE support_channels SET last_refusal_reason='upstream timeout' WHERE product_id=?", [P]))
      .rejects.toThrow();
  });
});
