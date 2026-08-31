process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { issueApiKey } from '../../src/services/api/api-key-issuance.js';

// =============================================================================
// A DOCUMENTED ENDPOINT THAT NEVER WORKED, AND TWO THAT ANSWERED ANYTHING.
//
// GET /v1/customers selected `ci.name`, `ci.company` and `ci.lifecycle_stage`
// from a table whose columns are `account_name` and `stage`, and which has no
// company at all. Every request threw and returned the generic 500 in the catch
// below it, with the SQLite error discarded — so an endpoint that had never
// once succeeded looked exactly like an endpoint nobody calls. The POST handler
// seventy lines down carries a comment naming that exact mapping: the write was
// fixed and the read was left.
//
// GET /v1/metrics/health computed `is_stale` from `latestSnapshot == null`
// while the comment beside it said `snapshot_date` was the whole answer. A
// daily job writes an EMPTY placeholder snapshot for every active product, so a
// row exists from a company's first day and `is_stale` was structurally false
// for everyone, forever.
//
// GET /v1/agents/:agentName/briefings had no agent predicate at all. It
// returned the company-wide briefing rows and stamped `meta.agent` with
// whatever was in the path — so every agent name got the same ten rows, and so
// did every name that is not an agent.
// =============================================================================

const P = 'p_v1';
const OWNER = 'f_v1';
let app: Hono;
let key: string;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
    [OWNER, 'c_v1', 'v1@example.com']);
  await query('INSERT INTO products (id,name,owner_id,status) VALUES (?,?,?,?)',
    [P, 'Acme', OWNER, 'active']);

  key = (await issueApiKey({
    productId: P, founderId: OWNER, label: 'k',
    scopes: ['customers:read', 'customers:manage', 'agents:read'],
  }) as { key: string }).key;

  const { apiV1 } = await import('../../src/api/v1/index.js');
  app = new Hono();
  app.route('/api/v1', apiV1 as unknown as Hono);
});

const get = (path: string) =>
  app.request(`/api/v1${path}`, { headers: { Authorization: `Bearer ${key}` } });

describe('GET /v1/customers', () => {
  beforeEach(async () => {
    await query('DELETE FROM customer_intelligence');
    await query(
      `INSERT INTO customer_intelligence (id, product_id, external_customer_id, account_name, email, stage, mrr_cents, health_score)
       VALUES ('ci_1', ?, 'cus_1', 'Northwind', 'ops@northwind.test', 'paying', 250000, 82)`,
      [P]);
  });

  it('answers at all', async () => {
    const res = await get('/customers');
    expect(res.status, await res.text()).toBe(200);
  });

  it('returns the customer under the field names the API documents', async () => {
    const body = await (await get('/customers')).json() as
      { data: Array<Record<string, unknown>>; meta: { total: number } };

    expect(body.meta.total).toBe(1);
    expect(body.data[0].name).toBe('Northwind');
    expect(body.data[0].lifecycle_stage).toBe('paying');
    expect(body.data[0].mrr_cents).toBe(250000);
  });

  it('filters by stage against the column that exists', async () => {
    const paying = await (await get('/customers?stage=paying')).json() as { meta: { total: number } };
    const churned = await (await get('/customers?stage=churned')).json() as { meta: { total: number } };
    expect(paying.meta.total).toBe(1);
    expect(churned.meta.total).toBe(0);
  });

  it('does not offer a company field nothing can fill', async () => {
    const body = await (await get('/customers')).json() as { data: Array<Record<string, unknown>> };
    // A field that can only ever be null is worse than an absent one: an
    // integrator builds against it and concludes their customers have no
    // company recorded.
    expect(Object.keys(body.data[0])).not.toContain('company');
  });
});

describe('GET /v1/metrics/health', () => {
  beforeEach(async () => { await query('DELETE FROM metric_snapshots'); });

  it('is not "fresh" because an empty placeholder row exists', async () => {
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date)
       VALUES ('ms_ph', ?, date('now'))`, [P]);

    const body = await (await get('/metrics/health')).json() as
      { data: { is_stale: boolean | null; has_measurements: boolean } };
    expect(body.data.is_stale).toBe(false);
    expect(body.data.has_measurements, 'the placeholder measures nothing').toBe(false);
  });

  it('says stale when the newest snapshot is old', async () => {
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, mrr_cents)
       VALUES ('ms_old', ?, date('now','-9 days'), 100)`, [P]);

    const body = await (await get('/metrics/health')).json() as
      { data: { is_stale: boolean | null; snapshot_age_days: number } };
    expect(body.data.is_stale).toBe(true);
    expect(body.data.snapshot_age_days).toBe(9);
  });

  it('says nothing rather than "fresh" when there is no snapshot at all', async () => {
    const body = await (await get('/metrics/health')).json() as
      { data: { is_stale: boolean | null; snapshot_age_days: number | null } };
    // Absent data is not current data.
    expect(body.data.is_stale).toBeNull();
    expect(body.data.snapshot_age_days).toBeNull();
  });

  it('reports a measured snapshot as measured', async () => {
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, mrr_cents)
       VALUES ('ms_real', ?, date('now'), 8000000)`, [P]);

    const body = await (await get('/metrics/health')).json() as
      { data: { is_stale: boolean | null; has_measurements: boolean } };
    expect(body.data.is_stale).toBe(false);
    expect(body.data.has_measurements).toBe(true);
  });
});

describe('GET /v1/agents/:agentName/briefings', () => {
  beforeEach(async () => {
    await query('DELETE FROM scp_briefings');
    await query('DELETE FROM agent_instances');
    await query(
      `INSERT INTO agent_instances (id, product_id, agent_name, display_name, status)
       VALUES ('ai_1', ?, 'harbor', 'Harbor', 'active')`, [P]);
    await query(
      `INSERT INTO scp_briefings (id, product_id, briefing_date, headline, full_briefing, agent_contributions)
       VALUES ('b_1', ?, '2026-08-01', 'day one', 'x', ?)`,
      [P, JSON.stringify({ harbor: { contribution: 'two churn risks', priority: 'high' } })]);
    await query(
      `INSERT INTO scp_briefings (id, product_id, briefing_date, headline, full_briefing, agent_contributions)
       VALUES ('b_2', ?, '2026-08-02', 'day two', 'x', ?)`,
      [P, JSON.stringify({ atlas: { contribution: 'runway steady', priority: 'low' } })]);
  });

  it('returns only the briefings this agent contributed to', async () => {
    const body = await (await get('/agents/harbor/briefings')).json() as
      { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].briefing_date).toBe('2026-08-01');
  });

  it('returns what the agent said, not the company-wide row', async () => {
    const body = await (await get('/agents/harbor/briefings')).json() as
      { data: Array<{ contribution: string }> };
    expect(String(body.data[0].contribution)).toContain('two churn risks');
  });

  it('does not answer for a name that is not an agent', async () => {
    const res = await get('/agents/nobody/briefings');
    expect(res.status).toBe(404);
  });
});
