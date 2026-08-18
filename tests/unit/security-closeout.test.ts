// =============================================================================
// Tests: Security close-out (Finish-Line Directive step 3, 2026-07-13)
// P1: transcript webhook auth actually authenticates (hash lookup, not raw).
// P2: investor tokens hashed at rest; dead share links gone.
// External surface: ingest refuses poison (Infinity, out-of-range, oversize);
// transcript/audio payloads bounded (the AI-cost vector).
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { createApiKey } from '../../src/services/rbac/permissions.js';

let app: Hono;
let rawApiKey: string;

const json = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('sc_f','clk_sc','sc@t.co')", []);
  await query(
    "INSERT INTO products (id, name, owner_id, status, ingest_token) VALUES ('sc_p','SecCo','sc_f','active','ingtok_secco_12345')", [],
  );
  ({ key: rawApiKey } = await createApiKey('sc_p', 'sc_f', 'test', ['transcripts']));

  const { transcriptWebhooks } = await import('../../src/routes/api/webhooks/transcripts.js');
  const { voiceReplyWebhook } = await import('../../src/routes/api/webhooks/voice-reply.js');
  const { ingestRoutes } = await import('../../src/routes/ingest/index.js');
  app = new Hono();
  app.route('/', transcriptWebhooks);
  app.route('/', voiceReplyWebhook);
  app.route('/', ingestRoutes);
});

describe('P1: transcript webhook authenticates for real', () => {
  it('a legitimate RAW key now works (the old code compared raw vs stored hash → always 401)', async () => {
    const res = await json('/webhooks/transcripts/fathom',
      { transcript: 'Customer said the onboarding was confusing.', date: '2026-07-13' },
      { 'x-api-key': rawApiKey });
    expect(res.status).toBe(200);
    const saved = await query("SELECT product_id FROM call_transcripts WHERE product_id='sc_p'", []);
    expect(saved.rows.length).toBe(1);
  });

  it('a wrong key (including the stored hash itself) is refused', async () => {
    const hashRow = (await query("SELECT key_hash FROM api_keys WHERE product_id='sc_p'", []))
      .rows[0] as Record<string, string>;
    for (const bad of ['fnd_totally_wrong_key', hashRow.key_hash, '']) {
      const res = await json('/webhooks/transcripts/fireflies', { transcript_text: 'x' }, { 'x-api-key': bad });
      expect(res.status).toBe(401);
    }
  });

  it('oversize transcripts are refused, not billed', async () => {
    const res = await json('/webhooks/transcripts/fathom',
      { transcript: 'x'.repeat(200_001) }, { 'x-api-key': rawApiKey });
    expect(res.status).toBe(413);
  });
});

describe('voice-reply: bounded audio', () => {
  it('oversize audio → 413; non-audio mime refused', async () => {
    const over = await json('/webhooks/voice-reply', {
      api_key: 'k', product_id: 'sc_p', context: 'briefing', briefing_date: '2026-07-13',
      audio_base64: 'a'.repeat(10_000_001), mime_type: 'audio/mp4',
    });
    expect(over.status).toBe(413);
    const badMime = await json('/webhooks/voice-reply', {
      api_key: 'k', product_id: 'sc_p', context: 'briefing', briefing_date: '2026-07-13',
      audio_base64: 'aaaa', mime_type: 'application/x-sh',
    });
    expect(badMime.status).toBe(400);
  });
});

describe('public ingest refuses poison', () => {
  const T = '/ingest/ingtok_secco_12345';

  it('accepts a sane payload', async () => {
    const res = await json(T, { mrr: 1200, churn_rate: 0.04, signups_7d: 12, nps: 40 });
    expect(res.status).toBe(200);
    const snap = (await query("SELECT churn_rate, new_mrr_cents FROM metric_snapshots WHERE product_id='sc_p'", []))
      .rows[0] as Record<string, number>;
    expect(Number(snap.churn_rate)).toBe(0.04);
    expect(Number(snap.new_mrr_cents)).toBe(120000);
  });

  it('refuses Infinity, out-of-range rates, negative counts, absurd NPS', async () => {
    for (const bad of [
      { mrr: '1e999' },          // parseFloat → Infinity; used to be stored
      { churn_rate: 5 },         // 500% churn
      { signups_7d: -3 },        // negative count
      { nps: 900 },              // NPS is [-100, 100]
    ]) {
      const res = await json(T, bad);
      expect(res.status).toBe(422);
    }
    // Nothing poisonous landed:
    const snap = (await query("SELECT churn_rate FROM metric_snapshots WHERE product_id='sc_p'", []))
      .rows[0] as Record<string, number>;
    expect(Number(snap.churn_rate)).toBe(0.04); // still the sane value
  });

  it('bounds the custom-metrics junk drawer', async () => {
    const res = await json(T, { custom: { blob: 'x'.repeat(9000) } });
    expect(res.status).toBe(422);
  });
});

describe('P2: investor tokens hashed at rest, dead links removed', () => {
  it('stores a 64-hex SHA-256, never the raw token; no /share/investor links rendered', async () => {
    const { investorRoutes } = await import('../../src/routes/dashboard/investors.js');
    const dash = new Hono();
    dash.use('*', async (c, next) => {
      c.set('founder' as never, { id: 'sc_f', email: 'sc@t.co', tier: 'investor_ready' } as never);
      c.set('csrfToken' as never, 't' as never);
      // Investor material is financial, so the router asks
      // `can_view_financials` — which needs to know WHICH company. sc_f owns
      // sc_p, and an owner holds every company capability.
      c.set('product' as never, { id: 'sc_p' } as never);
      await next();
    });
    dash.route('/', investorRoutes);

    await dash.request('/investors/add', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ name: 'Ada Angel', relationship: 'angel' }).toString(),
    });
    const inv = (await query("SELECT access_token FROM investors WHERE product_id='sc_p'", []))
      .rows[0] as Record<string, string>;
    expect(inv.access_token).toMatch(/^[0-9a-f]{64}$/); // hash, not nanoid

    const page = await (await dash.request('/investors')).text();
    expect(page).toContain('Ada Angel');
    expect(page).not.toContain('/share/investor/'); // the 404-ing links are gone
  });
});
