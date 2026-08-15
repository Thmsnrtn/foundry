import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { executeRaw, query } from '../../src/db/client.js';
import { dispatchWebhook } from '../../src/lib/webhooks.js';
import { encrypt } from '../../src/services/encryption.js';
import { isEncrypted } from '../../src/services/encryption.js';
import { Hono } from 'hono';
import { webhooksApi } from '../../src/api/v1/webhooks.js';
import type { ApiAuthEnv } from '../../src/api/middleware/auth.js';

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = '1'.repeat(64);
  await executeRaw(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY, founder_id TEXT NOT NULL, product_id TEXT, created_by TEXT, url TEXT NOT NULL,
      events TEXT NOT NULL, secret TEXT NOT NULL, active INTEGER DEFAULT 1,
      failure_count INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_delivery_at TEXT
    );
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY, webhook_id TEXT NOT NULL, event TEXT NOT NULL,
      status_code INTEGER, delivered_at TEXT, error TEXT,
      effect_certainty TEXT, provider_acknowledged_at TEXT, reconcile_after TEXT
    );
  `);
});

beforeEach(async () => {
  await executeRaw('DELETE FROM webhook_deliveries;\nDELETE FROM webhooks;');
  vi.unstubAllGlobals();
});


const webhookApiApp = new Hono<ApiAuthEnv>();
webhookApiApp.use('*', async (c, next) => {
  c.set('productId', 'p_api'); c.set('userId', 'f_api');
  c.set('scopes', [c.req.header('x-test-scope') ?? 'agents:read']);
  await next();
});
webhookApiApp.route('/', webhooksApi);

describe('live customer webhook integrity', () => {
  it('encrypts the signing secret and rejects private registration targets', async () => {
    await query(`INSERT INTO webhooks (id, founder_id, product_id, url, events, secret) VALUES ('w1','f1','p1','https://example.com/hooks','[\"metric.recorded\"]',?)`, [encrypt('whsec_visible')]);
    const stored = await query('SELECT secret FROM webhooks');
    expect(isEncrypted(String((stored.rows[0] as Record<string, unknown>).secret))).toBe(true);
  });

  it('awaits one provider attempt, signs with the founder-visible secret, and records acknowledgment only', async () => {
    await query(`INSERT INTO webhooks (id, founder_id, product_id, url, events, secret) VALUES ('w1','f1','p1','https://example.com/hooks','[\"metric.recorded\"]',?)`, [encrypt('whsec_visible')]);
    const fetchSpy = vi.fn(async () => new Response('', { status: 202 }));
    vi.stubGlobal('fetch', fetchSpy);
    const receipts = await dispatchWebhook('p1', 'f1', 'metric.recorded', { value: 7 });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(receipts).toMatchObject([{ certainty: 'provider_acknowledged', statusCode: 202 }]);
    const [, init] = fetchSpy.mock.calls[0];
    const body = String(init?.body);
    const expected = `sha256=${createHmac('sha256', 'whsec_visible').update(body).digest('hex')}`;
    expect((init?.headers as Record<string, string>)['X-Foundry-Signature']).toBe(expected);
    const row = (await query('SELECT effect_certainty, provider_acknowledged_at FROM webhook_deliveries')).rows[0];
    expect(row).toMatchObject({ effect_certainty: 'provider_acknowledged' });
    expect((row as Record<string, unknown>).provider_acknowledged_at).toBeTruthy();
  });

  it('does not retry an ambiguous transport failure and creates reconciliation work', async () => {
    await query(`INSERT INTO webhooks (id, founder_id, product_id, url, events, secret) VALUES ('w1','f1','p1','https://example.com/hooks','[\"decision.created\"]',?)`, [encrypt('whsec_visible')]);
    const fetchSpy = vi.fn(async () => { throw new Error('socket closed after write'); });
    vi.stubGlobal('fetch', fetchSpy);
    const receipts = await dispatchWebhook('p1', 'f1', 'decision.created', { id: 'd1' });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(receipts).toMatchObject([{ certainty: 'ambiguous', statusCode: null }]);
    const row = (await query('SELECT effect_certainty, reconcile_after FROM webhook_deliveries')).rows[0];
    expect(row).toMatchObject({ effect_certainty: 'ambiguous' });
    expect((row as Record<string, unknown>).reconcile_after).toBeTruthy();
  });

  it('never sends one product event to another product endpoint owned by the same founder', async () => {
    await query(`INSERT INTO webhooks (id, founder_id, product_id, url, events, secret) VALUES ('w1','f1','p1','https://example.com/p1','["metric.recorded"]',?)`, [encrypt('one')]);
    await query(`INSERT INTO webhooks (id, founder_id, product_id, url, events, secret) VALUES ('w2','f1','p2','https://example.com/p2','["metric.recorded"]',?)`, [encrypt('two')]);
    const fetchSpy = vi.fn(async () => new Response('', { status: 202 }));
    vi.stubGlobal('fetch', fetchSpy);
    await dispatchWebhook('p1', 'f1', 'metric.recorded', { value: 7 });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0][0]).toBe('https://example.com/p1');
  });
});

describe('webhook API authority and receipt projection', () => {
  it('refuses mutation to a read-scoped machine identity', async () => {
    const create = await webhookApiApp.request('/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://example.com/hook', events: ['metric.recorded'] }) });
    expect(create.status).toBe(403);
    await query(`INSERT INTO webhooks (id,founder_id,product_id,url,events,secret) VALUES ('w_receipt','f_api','p_api','https://example.com','[]','x')`);
    expect((await webhookApiApp.request('/w1', { method: 'DELETE' })).status).toBe(403);
  });

  it('lets a write-scoped identity create only a product-owned encrypted endpoint', async () => {
    const response = await webhookApiApp.request('/', { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-scope': 'agents:write' }, body: JSON.stringify({ url: 'https://example.com/hook', events: ['metric.recorded'] }) });
    expect(response.status).toBe(201);
    const row = (await query('SELECT product_id, secret FROM webhooks')).rows[0] as Record<string, unknown>;
    expect(row.product_id).toBe('p_api');
    expect(isEncrypted(String(row.secret))).toBe(true);
  });

  it('projects durable certainty rather than obsolete success columns', async () => {
    await query(`INSERT INTO webhooks (id,founder_id,product_id,url,events,secret) VALUES ('w1','f_api','p_api','https://example.com','[]','x')`);
    await query(`INSERT INTO webhook_deliveries (id,webhook_id,event,status_code,effect_certainty,reconcile_after) VALUES ('d1','w1','metric.recorded',0,'ambiguous','2099-01-01')`);
    const response = await webhookApiApp.request('/w1/deliveries');
    expect(response.status).toBe(200);
    const body = await response.json() as { data: Array<Record<string, unknown>> };
    expect(body.data[0]).toMatchObject({ event_type: 'metric.recorded', effect_certainty: 'ambiguous', reconcile_after: '2099-01-01' });
  });
});
