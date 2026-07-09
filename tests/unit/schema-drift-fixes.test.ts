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
});
