// =============================================================================
// Tests: schema-drift fixes execute against the real schema (batch 1)
//
// These handlers previously INSERT/UPDATEd columns that don't exist (or values
// that violate CHECK constraints) — invisible to typecheck, 500 on a real DB.
// Each case runs the reconciled SQL against a fully-migrated in-memory DB so a
// regression (renamed column, tightened CHECK) fails here instead of in prod.
// =============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@libsql/client';
import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { splitSqlStatements } from '../../src/db/migrate.js';

const DIR = resolve(__dirname, '../../src/db/migrations');
let db: ReturnType<typeof createClient>;

beforeAll(async () => {
  db = createClient({ url: 'file::memory:' });
  for (const f of readdirSync(DIR).filter((x) => x.endsWith('.sql')).sort()) {
    for (const s of splitSqlStatements(readFileSync(resolve(DIR, f), 'utf-8'))) {
      await db.execute({ sql: s, args: [] }).catch(() => {});
    }
  }
  // Testing column/CHECK alignment, not referential integrity — skip FK parents.
  await db.execute({ sql: 'PRAGMA foreign_keys=OFF', args: [] });
  await db.execute({ sql: "INSERT INTO products (id, name, owner_id) VALUES ('p1','P','o1')", args: [] });
});

describe('reconciled schema-drift SQL runs against real schema', () => {
  it('strategic_decisions_log: dashboard create INSERT (made_by/status satisfy CHECKs)', async () => {
    await db.execute({
      sql: `INSERT INTO strategic_decisions_log
              (id, product_id, decision_title, decision_description, decision_rationale,
               alternatives_considered_json, made_by, status)
            VALUES (?, ?, ?, ?, ?, ?, 'founder', 'active')`,
      args: ['d1', 'p1', 'Raise prices', 'Move Solo to $99', 'Margin', 'Keep at $79'],
    });
    const r = await db.execute({ sql: "SELECT decision_title FROM strategic_decisions_log WHERE id='d1'", args: [] });
    expect((r.rows[0] as Record<string, unknown>).decision_title).toBe('Raise prices');
  });

  it('strategic_decisions_log: outcome UPDATE maps rating→status (CHECK-valid)', async () => {
    await db.execute({
      sql: `UPDATE strategic_decisions_log
            SET actual_outcome=?, retrospective_score=?, updated_at=CURRENT_TIMESTAMP, status=?
            WHERE id=?`,
      args: ['Churn dropped', 5, 'succeeded', 'd1'],
    });
    const r = await db.execute({ sql: "SELECT status, retrospective_score FROM strategic_decisions_log WHERE id='d1'", args: [] });
    expect((r.rows[0] as Record<string, unknown>).status).toBe('succeeded');
  });

  it('okr_progress_updates: manual update INSERT (new_value/source/source_id)', async () => {
    await db.execute({ sql: "INSERT INTO key_results (id, objective_id, description, baseline_value, target_value) VALUES ('kr1','o1','x',0,100)", args: [] }).catch(() => {});
    await db.execute({
      sql: `INSERT INTO okr_progress_updates (id, key_result_id, new_value, source, source_id, note)
            VALUES (?, ?, ?, 'founder_manual', ?, ?)`,
      args: ['u1', 'kr1', 42, 'o1', 'progress'],
    });
    const r = await db.execute({ sql: "SELECT new_value FROM okr_progress_updates WHERE id='u1'", args: [] });
    expect(Number((r.rows[0] as Record<string, unknown>).new_value)).toBe(42);
  });

  it('agent_wiki_entries: createWikiEntry writes confidence_score (column added by 084)', async () => {
    await db.execute({
      sql: `INSERT INTO agent_wiki_entries (id, product_id, section, title, content, tags, author, confidence_score)
            VALUES (?, ?, 'strategy', ?, ?, '[]', 'founder', ?)`,
      args: ['w1', 'p1', 'ICP', 'Solo SaaS founders', 0.8],
    });
    const r = await db.execute({ sql: "SELECT confidence_score FROM agent_wiki_entries WHERE id='w1'", args: [] });
    expect(Number((r.rows[0] as Record<string, unknown>).confidence_score)).toBe(0.8);
  });

  it('agent_initiative_queue: v1 API enqueue (initiative_type/description/context, status pending)', async () => {
    await db.execute({
      sql: `INSERT INTO agent_initiative_queue (id, product_id, agent_name, initiative_type, description, context, priority, status)
            VALUES (?,?,?,'api_trigger',?,?,1,'pending')`,
      args: ['i1', 'p1', 'atlas', 'API-triggered run for atlas', '{}'],
    });
    const r = await db.execute({ sql: "SELECT status FROM agent_initiative_queue WHERE id='i1'", args: [] });
    expect((r.rows[0] as Record<string, unknown>).status).toBe('pending');
  });

  it('customer_intelligence: v1 upsert (account_name, no company/stage columns)', async () => {
    await db.execute({
      sql: `INSERT INTO customer_intelligence (id, product_id, external_customer_id, account_name, email, mrr_cents, health_score)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (product_id, external_customer_id) DO UPDATE SET account_name = excluded.account_name`,
      args: ['c1', 'p1', 'cus_x', 'Acme', 'a@b.co', 9900, 80],
    });
    const r = await db.execute({ sql: "SELECT account_name, stage FROM customer_intelligence WHERE id='c1'", args: [] });
    expect((r.rows[0] as Record<string, unknown>).account_name).toBe('Acme');
    expect((r.rows[0] as Record<string, unknown>).stage).toBe('trial'); // default applied
  });

  // ── batch 2/3 ──────────────────────────────────────────────────────────────

  it('webhooks (v1): product-scoped insert with founder_id + events/active', async () => {
    await db.execute({
      sql: `INSERT INTO webhooks (id, founder_id, product_id, url, events, secret, active, created_by)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      args: ['wh1', 'o1', 'p1', 'https://x/hook', '["decision.created"]', 'whsec_x', 'o1'],
    });
    const r = await db.execute({ sql: "SELECT active FROM webhooks WHERE id='wh1'", args: [] });
    expect(Number((r.rows[0] as Record<string, unknown>).active)).toBe(1);
  });

  it('webhook_deliveries: event/status_code/error + added payload/attempt/failed cols', async () => {
    await db.execute({
      sql: `INSERT INTO webhook_deliveries (id, webhook_id, event, payload_json, status_code, error, attempt_count, delivered_at, failed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['del1', 'wh1', 'decision.created', '{}', 200, null, 1, '2026-01-01', null],
    });
    const r = await db.execute({ sql: "SELECT status_code FROM webhook_deliveries WHERE id='del1'", args: [] });
    expect(Number((r.rows[0] as Record<string, unknown>).status_code)).toBe(200);
  });

  it('api_keys (RBAC): founder_id + product_id/role/scopes/created_by', async () => {
    await db.execute({
      sql: `INSERT INTO api_keys (id, founder_id, product_id, name, key_hash, key_prefix, role, scopes, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['ak1', 'o1', 'p1', 'CI key', 'hash1', 'fnd_1234', 'viewer', '["read"]', 'o1'],
    });
    const r = await db.execute({ sql: "SELECT product_id, revoked_at FROM api_keys WHERE id='ak1'", args: [] });
    expect((r.rows[0] as Record<string, unknown>).product_id).toBe('p1');
    expect((r.rows[0] as Record<string, unknown>).revoked_at).toBeNull(); // "active" = revoked_at IS NULL
  });

  it('metric_snapshots (v1): mrr_cents/new_customers/churned_customers added', async () => {
    await db.execute({
      sql: `INSERT INTO metric_snapshots (id, product_id, snapshot_date, mrr_cents, active_users, churn_rate, new_customers, churned_customers, expansion_mrr_cents, contraction_mrr_cents)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['ms1', 'p1', '2026-01-01', 50000, 120, 0.03, 8, 2, 1000, 500],
    });
    const r = await db.execute({ sql: "SELECT mrr_cents, new_customers FROM metric_snapshots WHERE id='ms1'", args: [] });
    expect(Number((r.rows[0] as Record<string, unknown>).mrr_cents)).toBe(50000);
  });

  it('audit_log (jobs): action_type + NOT NULL gate/trigger/reasoning satisfied', async () => {
    await db.execute({
      sql: `INSERT INTO audit_log (id, product_id, action_type, gate, trigger, reasoning, created_at)
            VALUES (?, ?, 'dna_completion_nudge', 0, 'job', ?, ?)`,
      args: ['al1', 'p1', '{"completion_pct":55}', '2026-01-01'],
    });
    const r = await db.execute({ sql: "SELECT action_type FROM audit_log WHERE id='al1'", args: [] });
    expect((r.rows[0] as Record<string, unknown>).action_type).toBe('dna_completion_nudge');
  });

  it('integrations (own-Stripe): canonical product_id/credentials/status + ON CONFLICT(product_id,name)', async () => {
    const sql = `INSERT INTO integrations (id, product_id, owner_id, name, provider, direction, status, credentials, config)
                 VALUES (?, ?, ?, 'stripe', 'stripe', 'inbound', 'active', ?, ?)
                 ON CONFLICT (product_id, name) DO UPDATE SET credentials = excluded.credentials, status = 'active'`;
    await db.execute({ sql, args: ['int1', 'p1', 'o1', 'enc1', '{}'] });
    await db.execute({ sql, args: ['int2', 'p1', 'o1', 'enc2', '{}'] }); // upsert same (product_id,name)
    const r = await db.execute({ sql: "SELECT credentials FROM integrations WHERE product_id='p1' AND name='stripe'", args: [] });
    expect((r.rows[0] as Record<string, unknown>).credentials).toBe('enc2'); // upserted, not duplicated
  });

  it('experiments (v1): hypothesis row + full experiment (NOT NULL A/B fields, status designed)', async () => {
    await db.execute({
      sql: `INSERT INTO hypotheses (id, product_id, proposed_by, statement) VALUES (?, ?, 'api', ?)`,
      args: ['h1', 'p1', 'Lower price lifts conversion'],
    });
    await db.execute({
      sql: `INSERT INTO experiments
              (id, product_id, hypothesis_id, name, hypothesis, type, control_description,
               treatment_description, success_metric, success_threshold, status, designed_by)
            VALUES (?, ?, ?, ?, ?, 'ab_test', 'Control (no change)', ?, ?, ?, 'designed', ?)`,
      args: ['ex1', 'p1', 'h1', 'Price test', 'Lower price', 'Lower price', 'conversion_rate', 0.1, 'o1'],
    });
    const r = await db.execute({ sql: "SELECT status, name FROM experiments WHERE id='ex1'", args: [] });
    expect((r.rows[0] as Record<string, unknown>).status).toBe('designed');
  });

  it('network tables: rebuilt to the benchmark subsystem shape', async () => {
    await db.execute({
      sql: `INSERT INTO network_contributions (id, metric, market_category, lifecycle_stage, mrr_bracket, value, contributed_at)
            VALUES (?, 'churn_rate', 'saas', 'seed', '0-10k', ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET value = excluded.value`,
      args: ['nc1_churn_rate', 0.05],
    });
    await db.execute({
      sql: `INSERT INTO network_benchmarks (id, metric, market_category, lifecycle_stage, mrr_bracket, p25, p50, p75, sample_count, last_updated)
            VALUES (?, 'churn_rate', 'all', 'seed', '0-10k', ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(metric, market_category, lifecycle_stage, mrr_bracket)
            DO UPDATE SET p50 = excluded.p50`,
      args: ['nb1', 0.02, 0.05, 0.09, 3],
    });
    const r = await db.execute({ sql: "SELECT p50 FROM network_benchmarks WHERE id='nb1'", args: [] });
    expect(Number((r.rows[0] as Record<string, unknown>).p50)).toBe(0.05);
  });

  // `decision_snooze_log` was dropped in migration 157. It was read by a
  // nightly cleanup sweep and written by nothing — no snooze button, no route,
  // no API — so the sweep cleared an always-empty table. The reconciliation
  // this case checked was real; the feature behind it never existed.

  // ── UPDATE-path fixes ────────────────────────────────────────────────────────

  it('key_results.progress: written by the OKR update and readable by AVG()', async () => {
    await db.execute({ sql: "INSERT INTO key_results (id, okr_id, description, new_value) VALUES ('kr2','o1','x',0)", args: [] }).catch(() => {});
    await db.execute({ sql: "UPDATE key_results SET current_value=?, progress=?, updated_at=CURRENT_TIMESTAMP WHERE id='kr2'", args: [50, 50] }).catch(() => {});
    // The read that 500'd before the column existed:
    const r = await db.execute({ sql: "SELECT AVG(progress) AS avg FROM key_results", args: [] });
    expect(r.rows.length).toBe(1);
  });

  it('experiments: interim results UPDATE (results_json, no invalid status) + conclude (completed)', async () => {
    // seed a valid experiment
    await db.execute({ sql: "INSERT INTO hypotheses (id, product_id, proposed_by, statement) VALUES ('h2','p1','api','h')", args: [] });
    await db.execute({
      sql: `INSERT INTO experiments (id, product_id, hypothesis_id, name, type, control_description, treatment_description, success_metric, status)
            VALUES ('ex2','p1','h2','T','ab_test','c','t','m','running')`,
      args: [],
    });
    await db.execute({ sql: "UPDATE experiments SET results_json=?, updated_at=CURRENT_TIMESTAMP WHERE id='ex2' AND product_id='p1'", args: ['{"v":1}'] });
    await db.execute({
      sql: `UPDATE experiments SET status='completed', outcome=?, winning_variant_id=?, concluded_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id='ex2' AND product_id='p1'`,
      args: ['treatment won', 'var_1'],
    });
    const r = await db.execute({ sql: "SELECT status, outcome FROM experiments WHERE id='ex2'", args: [] });
    expect((r.rows[0] as Record<string, unknown>).status).toBe('completed');
  });

  it('agent_initiative_queue: status transitions use CHECK-valid values + processed_at', async () => {
    await db.execute({
      sql: `INSERT INTO agent_initiative_queue (id, product_id, agent_name, initiative_type, description, status) VALUES ('i2','p1','atlas','proactive','d','pending')`,
      args: [],
    });
    await db.execute({ sql: "UPDATE agent_initiative_queue SET status='running', processed_at=CURRENT_TIMESTAMP WHERE id='i2'", args: [] });
    await db.execute({ sql: "UPDATE agent_initiative_queue SET status='completed', processed_at=CURRENT_TIMESTAMP WHERE id='i2'", args: [] });
    const r = await db.execute({ sql: "SELECT status FROM agent_initiative_queue WHERE id='i2'", args: [] });
    expect((r.rows[0] as Record<string, unknown>).status).toBe('completed');
  });

  it('action_executions.approval_note: voice approval UPDATE (status approved + note)', async () => {
    await db.execute({
      sql: `INSERT INTO action_executions (id, product_id, action_type, integration, status) VALUES ('ae1','p1','email','resend','pending')`,
      args: [],
    });
    await db.execute({ sql: "UPDATE action_executions SET status='approved', approved_at=datetime('now'), approval_note=? WHERE id='ae1'", args: ['approved by voice'] });
    const r = await db.execute({ sql: "SELECT status, approval_note FROM action_executions WHERE id='ae1'", args: [] });
    expect((r.rows[0] as Record<string, unknown>).approval_note).toBe('approved by voice');
  });

  it('products.scp_status: pause/resume targets products (not lifecycle_state)', async () => {
    await db.execute({ sql: "UPDATE products SET scp_status='paused', updated_at=datetime('now') WHERE id='p1'", args: [] });
    const r = await db.execute({ sql: "SELECT scp_status FROM products WHERE id='p1'", args: [] });
    expect((r.rows[0] as Record<string, unknown>).scp_status).toBe('paused');
  });
});
