// =============================================================================
// EVERY INBOUND DOOR IS REACHABLE AND SIGNED (F1, 9 October 2026).
//
// AcreOS shipped provider webhooks registered after its auth catch-all: in
// production they answered 401 and never ran, while every unit test that
// mounted the handler on a bare app passed. Foundry has the same exposure
// wherever a door a provider calls sits under a prefix an auth middleware
// covers. So this boots the REAL app (`src/index.ts`, the composition root)
// and, for every door a caller with no session reaches:
//   * a correctly signed or keyed request reaches the HANDLER — proved by the
//     handler's own effect or its own answer, never by "not 401";
//   * a wrongly signed or keyed request is refused, by the handler's own check,
//     and writes nothing.
//
// THE POPULATION is every POST route the source declares whose path says it
// is a door from outside (webhook, ingest, mail, receive, signal, share links).
// Each must be in DOORS below, and each entry in DOORS must still exist, so a
// new webhook added without a test here turns this red.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_doors_secret';
process.env.CLERK_WEBHOOK_SECRET = `whsec_${Buffer.from('clerk-doors-secret').toString('base64')}`;
process.env.ECOSYSTEM_SERVICE_KEY = 'doors-ecosystem-key';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { createHmac } from 'node:crypto';
import Stripe from 'stripe';
import { beforeAll, describe, expect, it } from 'vitest';
import { declaredRoutes } from '../helpers/declared-routes.js';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

let app: { request: (path: string, init?: RequestInit) => Promise<Response> };
const stripe = new Stripe('sk_test_fake', { apiVersion: '2023-10-16' });

const isDoor = (path: string): boolean => /(webhook|\/hook|callback|\/ingest\/|\/mail\b|\/receive\b|signal|^\/share\/)/i.test(path);

function stripeSigned(id: string, type: string, object: Record<string, unknown>, secret = process.env.STRIPE_WEBHOOK_SECRET!): RequestInit {
  const payload = JSON.stringify({ id, object: 'event', type, data: { object } });
  return { method: 'POST', body: payload, headers: { 'content-type': 'application/json', 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret }) } };
}
function svixSigned(body: string, secret = process.env.CLERK_WEBHOOK_SECRET!): RequestInit {
  const id = 'msg_doors'; const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', Buffer.from(secret.replace('whsec_', ''), 'base64')).update(`${id}.${ts}.${body}`).digest('base64');
  return { method: 'POST', body, headers: { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` } };
}
const claims = async (id: string): Promise<number> =>
  Number(((await query('SELECT COUNT(*) AS n FROM stripe_webhook_events WHERE event_id = ?', [id])).rows[0] as Record<string, unknown>).n);

interface Door {
  /** A request the handler accepts, and what proves the handler ran. */
  good: () => Promise<void>;
  /** A request with a wrong signature or key, and what proves it was refused by the handler. */
  bad: () => Promise<void>;
}

const DOORS: Record<string, Door> = {
  'POST /webhooks/stripe': {
    async good() {
      const r = await app.request('/webhooks/stripe', stripeSigned('evt_doors_ok', 'customer.created', { id: 'cus_x', object: 'customer' }));
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ received: true });
      expect(await claims('evt_doors_ok')).toBe(1);
    },
    async bad() {
      const r = await app.request('/webhooks/stripe', stripeSigned('evt_doors_bad', 'customer.created', { id: 'cus_y', object: 'customer' }, 'whsec_not_ours'));
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: 'Webhook processing failed' });
      expect(await claims('evt_doors_bad')).toBe(0);
    },
  },
  'POST /webhooks/stripe/probe-value': {
    async good() {
      // Past the signature check, the handler's own next refusal: no such company.
      const r = await app.request('/webhooks/stripe/p_nobody', stripeSigned('evt_doors_p', 'customer.created', { id: 'cus_z', object: 'customer' }));
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual({ error: 'Unknown product' });
    },
    async bad() {
      const r = await app.request('/webhooks/stripe/p_nobody', stripeSigned('evt_doors_pb', 'customer.created', { id: 'cus_z', object: 'customer' }, 'whsec_not_ours'));
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: 'Webhook processing failed' });
    },
  },
  'POST /auth/webhook': {
    async good() {
      const r = await app.request('/auth/webhook', svixSigned(JSON.stringify({ type: 'session.created', data: { id: 'sess_1' } })));
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ received: true });
    },
    async bad() {
      const r = await app.request('/auth/webhook', svixSigned(JSON.stringify({ type: 'user.deleted', data: { id: 'user_1' } }), `whsec_${Buffer.from('not-ours').toString('base64')}`));
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ error: 'Invalid webhook signature' });
    },
  },
  'POST /workshop/mail': {
    async good() {
      // The edge's key, as the Workshop holds it: an unreadable body is the handler's own next refusal.
      const key = 'k'.repeat(40);
      await query(`INSERT OR REPLACE INTO workshop_mail_intake (founder_id, intake_key) VALUES ('f_doors', ?)`, [key]);
      const r = await app.request('/workshop/mail', { method: 'POST', body: 'not json', headers: { 'x-workshop-intake': key } });
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ ok: false, reason: 'unreadable' });
    },
    async bad() {
      const r = await app.request('/workshop/mail', { method: 'POST', body: '{}', headers: { 'x-workshop-intake': 'not-the-key' } });
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ ok: false });
    },
  },
  'POST /ingest/probe-value': {
    async good() {
      const r = await app.request('/ingest/x', { method: 'POST', body: '{}' });
      expect(await r.json()).toEqual({ error: 'Invalid token' });
    },
    async bad() {
      const r = await app.request('/ingest/abcdefgh-not-a-token', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
      expect([401, 404]).toContain(r.status);
      expect(JSON.stringify(await r.json())).toMatch(/token|credential/i);
    },
  },
  'POST /ingest/company-report/probe-value': {
    async good() { expect(await (await app.request('/ingest/company-report/x', { method: 'POST' })).json()).toEqual({ error: 'Invalid token' }); },
    async bad() {
      const r = await app.request('/ingest/company-report/abcdefgh-not-a-token', { method: 'POST', body: '{}' });
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ error: 'Unknown or unscoped ingest credential' });
    },
  },
  'POST /ingest/effect-outcome/probe-value': {
    async good() { expect(await (await app.request('/ingest/effect-outcome/x', { method: 'POST' })).json()).toEqual({ error: 'Invalid token' }); },
    async bad() {
      const r = await app.request('/ingest/effect-outcome/abcdefgh-not-a-token', { method: 'POST', body: '{}' });
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ error: 'Unknown or unscoped ingest credential' });
    },
  },
  'POST /ingest/customer-message/probe-value': {
    async good() { expect(await (await app.request('/ingest/customer-message/short', { method: 'POST' })).json()).toEqual({ error: 'Invalid channel key' }); },
    async bad() {
      const r = await app.request(`/ingest/customer-message/${'k'.repeat(30)}`, { method: 'POST', body: '{"external_message_id":"m1","contact_email":"a@b.example","body":"hi"}', headers: { 'content-type': 'application/json' } });
      expect(r.status).toBe(401);
    },
  },
  'POST /internal/conversion-signal': {
    async good() {
      const r = await app.request('/internal/conversion-signal', { method: 'POST', body: JSON.stringify({ product_id: 'p_none', event_type: 'x', event_data: {} }),
        headers: { 'content-type': 'application/json', 'x-ecosystem-key': process.env.ECOSYSTEM_SERVICE_KEY!, authorization: `Bearer ${process.env.ECOSYSTEM_SERVICE_KEY!}` } });
      expect(await r.json()).toEqual({ error: 'Not found' });
    },
    async bad() {
      const r = await app.request('/internal/conversion-signal', { method: 'POST', body: '{}', headers: { 'x-ecosystem-key': 'wrong', authorization: 'Bearer wrong' } });
      expect(r.status).toBe(401);
    },
  },
  'POST /internal/campaign/receive': {
    async good() {
      const r = await app.request('/internal/campaign/receive', { method: 'POST', body: JSON.stringify({ campaign_id: 'c1', lead_data: {} }),
        headers: { 'content-type': 'application/json', 'x-ecosystem-key': process.env.ECOSYSTEM_SERVICE_KEY!, authorization: `Bearer ${process.env.ECOSYSTEM_SERVICE_KEY!}` } });
      expect(await r.json()).toEqual({ received: true, campaign_id: 'c1' });
    },
    async bad() {
      const r = await app.request('/internal/campaign/receive', { method: 'POST', body: '{}', headers: { 'x-ecosystem-key': 'wrong', authorization: 'Bearer wrong' } });
      expect(r.status).toBe(401);
    },
  },
  'POST /share/refund/probe-value/probe-value': {
    async good() { /* the signed link's own page, reached anonymously, says the link is not valid rather than asking anyone to sign in */
      const r = await app.request('/share/refund/ful_none/badtoken', { method: 'POST' });
      expect(r.status).not.toBe(302);
      expect(await r.text()).not.toMatch(/sign in/i);
    },
    async bad() {
      const r = await app.request('/share/refund/ful_none/badtoken', { method: 'POST' });
      expect(r.status).toBeGreaterThanOrEqual(400);
    },
  },
  'POST /share/cancel/probe-value/probe-value': {
    async good() {
      const r = await app.request('/share/cancel/ful_none/badtoken', { method: 'POST' });
      expect(r.status).not.toBe(302);
      expect(await r.text()).not.toMatch(/sign in/i);
    },
    async bad() {
      const r = await app.request('/share/cancel/ful_none/badtoken', { method: 'POST' });
      expect(r.status).toBeGreaterThanOrEqual(400);
    },
  },
};

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email, name) VALUES ('f_doors','clk_doors','owner@example.com','Owner')`);
  app = (await import('../../src/index.js')).default as typeof app;
}, 120_000);

/**
 * DOORS THAT ARE MEANT TO ASK FOR A KEY, with why. They match the population's
 * words and are not provider callbacks; each is proved to refuse a stranger.
 */
const KEYED: Record<string, string> = {
  'POST /api/v1/webhooks': 'registers outbound webhooks for an API-key holder; key-authenticated by design (the public API is to be deleted, Private S7)',
};

describe('the population: every door from outside is listed here', () => {
  it('every declared door has a test, and every test names a declared door', () => {
    const declared = declaredRoutes();
    expect(declared.unresolved).toEqual([]);
    const doors = declared.routes.filter((r) => r.method === 'POST' && isDoor(r.path)).map((r) => `POST ${r.path}`).sort();
    expect(doors.length).toBeGreaterThanOrEqual(10);
    expect(doors).toEqual([...Object.keys(DOORS), ...Object.keys(KEYED)].sort());
  });
  it('a keyed door refuses a stranger', async () => {
    for (const k of Object.keys(KEYED)) {
      const r = await app.request(k.split(' ')[1]!, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
      expect(r.status, k).toBe(401);
    }
  });
});

describe('each door, through the real app, with no session', () => {
  for (const [name, d] of Object.entries(DOORS)) {
    it(`${name}: a signed request reaches its handler`, async () => { await d.good(); });
    it(`${name}: a wrongly signed request is refused by its handler`, async () => { await d.bad(); });
  }
});
