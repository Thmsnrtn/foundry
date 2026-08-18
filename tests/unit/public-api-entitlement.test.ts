// =============================================================================
// Tests: the public API never asked whether Foundry may act for the company
//
// It authenticated the credential, checked its scopes and limited its rate, and
// then never asked the question every other surface asks. The owner's decision
// is that an unpaid account is READ-ONLY — no spend, no outward effects — and
// the deepest layers did hold that: the AI client refuses to reserve spend for
// a company that is not operating, and the outbound gateway refuses to
// dispatch. So an agent run through the API failed somewhere in the middle
// rather than succeeding.
//
// But writes are not spend and not outward effects. POST /v1/customers,
// PUT /v1/customers/:id/health, POST /v1/metrics/snapshots and
// POST /v1/experiments all write company state, and every one worked for a
// company whose subscription had lapsed or whose founder had paused it.
// Read-only was true of two layers and false at the surface.
//
// The method decides, deliberately: a GET is the read the decision permits and
// anything else changes the company. A route list would be a list a new
// endpoint can be added beside without joining.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { requireOperatingForWrites } from '../../src/api/middleware/entitlement.js';

const F = 'pae_f';
const P = 'pae_p';

/** The API surface as it is composed: a resolved credential, then this. */
function api() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('productId' as never, P as never);
    c.set('userId' as never, F as never);
    await next();
  });
  app.use('*', requireOperatingForWrites);
  app.get('/thing', (c) => c.json({ read: true }));
  app.post('/thing', (c) => c.json({ wrote: true }));
  app.put('/thing', (c) => c.json({ wrote: true }));
  app.delete('/thing', (c) => c.json({ wrote: true }));
  return app;
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [F, 'clerk_pae', 'pae@test.local']);
  await query(
    `INSERT INTO products (id, name, owner_id, status, scp_status)
     VALUES (?,'API Co',?, 'active','active')`, [P, F]);
});

beforeEach(async () => {
  await query(
    `UPDATE products SET status='active', scp_status='active', entitlement_paused_at=NULL
      WHERE id=?`, [P]);
});

describe('a company Foundry is operating', () => {
  it('may read and may write', async () => {
    const app = api();
    expect((await app.request('/thing')).status).toBe(200);
    expect((await app.request('/thing', { method: 'POST' })).status).toBe(200);
  });
});

describe('a company whose subscription has lapsed', () => {
  beforeEach(async () => {
    await query(`UPDATE products SET entitlement_paused_at=datetime('now') WHERE id=?`, [P]);
  });

  it('may still read its own data', async () => {
    // Refusing reads would turn a billing lapse into a data lockout, which is
    // not what read-only means and not what was asked for.
    const res = await api().request('/thing');
    expect(res.status).toBe(200);
  });

  it('may not write', async () => {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const res = await api().request('/thing', { method });
      expect(res.status, `${method} changes the company`).toBe(403);
      expect((await res.json() as Record<string, unknown>).error).toBe('read_only');
    }
  });

  it('is told which of the three reasons it is', async () => {
    const body = await (await api().request('/thing', { method: 'POST' })).json() as
      Record<string, string>;
    expect(body.message).toMatch(/subscription/);
  });
});

describe('a company the founder paused', () => {
  beforeEach(async () => {
    await query(`UPDATE products SET scp_status='paused' WHERE id=?`, [P]);
  });

  it('may read and not write, and is told why', async () => {
    expect((await api().request('/thing')).status).toBe(200);
    const res = await api().request('/thing', { method: 'POST' });
    expect(res.status).toBe(403);
    expect((await res.json() as Record<string, string>).message).toMatch(/paused/);
  });
});

describe('a company that has been erased', () => {
  beforeEach(async () => {
    await query(`UPDATE products SET status='archived', scp_status='archived' WHERE id=?`, [P]);
  });

  it('may not write', async () => {
    // Its keys are deleted with the erasure — api_keys carries a product_id —
    // so this case is closed by deletion too. The check still names it,
    // because depending on a key being gone is depending on something two
    // files away.
    const res = await api().request('/thing', { method: 'POST' });
    expect(res.status).toBe(403);
    expect((await res.json() as Record<string, string>).message).toMatch(/archived/);
  });
});

describe('the check does not answer questions that are not its own', () => {
  it('passes through when no company is on the request', async () => {
    // Auth has already decided about that, and two answers to one question is
    // how a caller gets a misleading one.
    const app = new Hono();
    app.use('*', requireOperatingForWrites);
    app.post('/thing', (c) => c.json({ wrote: true }));
    expect((await app.request('/thing', { method: 'POST' })).status).toBe(200);
  });

  it('passes through when the id names no company', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('productId' as never, 'pae_nonexistent' as never);
      await next();
    });
    app.use('*', requireOperatingForWrites);
    app.post('/thing', (c) => c.json({ wrote: true }));
    expect((await app.request('/thing', { method: 'POST' })).status,
      'the key resolved it; inventing a refusal here would hide that').toBe(200);
  });
});

describe('it is wired into the API, not merely written', () => {
  it('runs for every v1 route', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const index = readFileSync(
      resolve(__dirname, '../../src/api/v1/index.ts'), 'utf8');
    expect(index).toMatch(/apiV1\.use\('\*',\s*requireOperatingForWrites\)/);
    // After auth, because that is where the company is known. Compared on the
    // `use` lines, not the first mention — the import necessarily comes first.
    expect(index.indexOf("apiV1.use('*', requireOperatingForWrites)"),
      'the check has to run after the credential has resolved the company')
      .toBeGreaterThan(index.indexOf("apiV1.use('*', apiKeyAuth)"));
  });
});
