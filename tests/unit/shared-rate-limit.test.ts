// =============================================================================
// Tests: a limit two machines agree on
//
// Every rate limit here was a Map in one Node process, and `fly.toml` runs
// `min_machines_running = 2` behind a load balancer. So each published limit
// was really twice its stated number, and more if the web group were scaled up
// — invisibly, because the numbers in the source read as absolute.
//
// For flood control that is tolerable. For the limits whose job is to stop a
// bill — the AI limit and the per-key model limit on the public API — it is
// not, because those are the front stop to real money and a ceiling multiplied
// by the machine count is not a ceiling.
//
// THE VEHICLE HERE USED TO BE `auditRateLimit`, six an hour on
// POST /onboarding/run-audit. That route went with the commercial onboarding
// wizard and the limiter went with the route, so these cases are driven
// through `aiRateLimit` instead — thirty an hour per founder, the same shared
// counter, and mounted on the two paths that actually call a model from a
// user's request: POST /foundry/ask and POST /talk/message. A test that keeps
// a limiter alive so it has something to measure is measuring itself.
//
// A second process is simulated with `vi.resetModules()` and a fresh import,
// which gives a genuinely separate module-level store — the same thing a second
// machine has.
// =============================================================================

// A FILE database, not `:memory:`. `vi.resetModules()` gives each simulated
// machine its own db client, and two in-memory clients are two different
// databases — which would make this file prove that two processes cannot see
// each other's writes, rather than that they now can.
process.env.TURSO_DATABASE_URL =
  `file:${process.env.TMPDIR ?? '/tmp'}/foundry-shared-rl-${process.pid}.db`;
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { executeRaw, query } from '../../src/db/client.js';

beforeAll(async () => {
  await executeRaw(readFileSync(
    resolve(__dirname, '../../src/db/migrations/143_rate_limit_counters.sql'), 'utf-8'));
});

/** A middleware instance with its own module-level store — i.e. a machine. */
async function machine(): Promise<typeof import('../../src/middleware/rate-limit.js')> {
  vi.resetModules();
  return import('../../src/middleware/rate-limit.js');
}

function app(mw: Parameters<Hono['use']>[1], founderId: string) {
  const a = new Hono();
  a.use('*', async (c, next) => {
    c.set('founder' as never, { id: founderId } as never);
    await next();
  });
  a.use('*', mw);
  a.get('/x', (c) => c.json({ ok: true }));
  return a;
}

describe('the AI limit is thirty per hour in total, not thirty per machine', () => {
  it('counts requests made against a different process', async () => {
    const founder = `f-${Math.random().toString(36).slice(2)}`;
    const m1 = await machine();
    const m2 = await machine();

    const a1 = app(m1.aiRateLimit, founder);
    const a2 = app(m2.aiRateLimit, founder);

    // Thirty questions, spread across both machines. All allowed.
    for (let i = 0; i < 15; i++) expect((await a1.request('/x')).status).toBe(200);
    for (let i = 0; i < 15; i++) expect((await a2.request('/x')).status).toBe(200);

    // The thirty-first is refused wherever it lands. Before this it was the
    // sixty-first, because each machine was counting to thirty on its own.
    expect((await a1.request('/x')).status, 'machine 1 must know about machine 2').toBe(429);
    expect((await a2.request('/x')).status).toBe(429);
  });

  it('keeps separate founders separate', async () => {
    const m = await machine();
    const one = `f-${Math.random().toString(36).slice(2)}`;
    const two = `f-${Math.random().toString(36).slice(2)}`;
    for (let i = 0; i < 31; i++) await app(m.aiRateLimit, one).request('/x');
    expect((await app(m.aiRateLimit, two).request('/x')).status).toBe(200);
  });

  it('reports the shared remaining count, not a single machine view', async () => {
    const founder = `f-${Math.random().toString(36).slice(2)}`;
    const m1 = await machine();
    const m2 = await machine();
    await app(m1.aiRateLimit, founder).request('/x');
    const res = await app(m2.aiRateLimit, founder).request('/x');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('28');
  });
});

describe('the counter is incremented atomically', () => {
  it('does not lose increments when requests overlap', async () => {
    // Two machines incrementing at once must not both read 3 and both write 4.
    const founder = `f-${Math.random().toString(36).slice(2)}`;
    const m1 = await machine();
    const m2 = await machine();
    await Promise.all([
      ...Array.from({ length: 5 }, () => app(m1.aiRateLimit, founder).request('/x')),
      ...Array.from({ length: 5 }, () => app(m2.aiRateLimit, founder).request('/x')),
    ]);
    const rows = await query(
      `SELECT count FROM rate_limit_counters WHERE key = ?`, [`ai:founder:${founder}`]);
    expect(Number((rows.rows[0] as Record<string, unknown>).count)).toBe(10);
  });
});

describe('a counter outage degrades rather than breaks', () => {
  it('falls back to the per-machine limiter, not to refusing everyone', async () => {
    // A bookkeeping table being unavailable must not become an outage. The
    // caller is still limited — just per machine, which is what this replaced.
    const m = await machine();
    const founder = `f-${Math.random().toString(36).slice(2)}`;
    await executeRaw('ALTER TABLE rate_limit_counters RENAME TO rate_limit_counters_hidden');
    try {
      const a = app(m.aiRateLimit, founder);
      expect((await a.request('/x')).status, 'still served').toBe(200);
      for (let i = 0; i < 30; i++) await a.request('/x');
      expect((await a.request('/x')).status, 'still limited').toBe(429);
    } finally {
      await executeRaw('ALTER TABLE rate_limit_counters_hidden RENAME TO rate_limit_counters');
    }
  });
});

describe('closed windows are cleaned up', () => {
  it('deletes only windows that have ended', async () => {
    const m = await machine();
    const now = Date.now();
    await query(
      `INSERT INTO rate_limit_counters (key, window_start, window_ms, count)
       VALUES ('old', ?, 1000, 5), ('current', ?, 3600000, 5)`,
      [now - 10_000, Math.floor(now / 3_600_000) * 3_600_000]);
    await m.sweepRateLimitCounters(now);
    const remaining = await query(
      `SELECT key FROM rate_limit_counters WHERE key IN ('old','current')`);
    expect(remaining.rows.map((r) => (r as Record<string, string>).key)).toEqual(['current']);
  });
});
