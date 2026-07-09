// =============================================================================
// Tests: Memory Kernel (Ascent B1) — belief ledger lifecycle
//
// Drives the real service against a fully-migrated in-memory DB: record a
// premise, check it against live telemetry, watch a falsified belief surface as
// an "expired belief," acknowledge it, and read the digest. Also asserts the
// schema-as-code kernel (buildInsert/buildUpdate) produces correct SQL.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, it, expect, beforeAll } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  recordPremise, checkPremises, getExpiredBeliefs, markRevisited, getMemoryDigest,
} from '../../src/services/memory/kernel.js';
import { buildInsert, buildUpdate } from '../../src/db/schema/kernel.js';

async function seedDecision(id: string, title: string): Promise<void> {
  await query(
    `INSERT INTO strategic_decisions_log (id, product_id, decision_title, decision_description, made_by, status)
     VALUES (?, 'p_mem', ?, 'desc', 'founder', 'active')`,
    [id, title],
  );
}
async function seedSnapshot(churn: number): Promise<void> {
  await query('DELETE FROM metric_snapshots WHERE product_id = ?', ['p_mem']);
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, churn_rate) VALUES (?, 'p_mem', ?, ?)`,
    ['ms_' + churn, '2026-01-01', churn],
  );
}

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query("INSERT INTO products (id, name, owner_id) VALUES ('p_mem','MemCo','o1')", []);
});

describe('schema-as-code kernel', () => {
  it('buildInsert derives columns from the typed row (drops undefined)', () => {
    const { sql, args } = buildInsert('t', { id: 'a', name: 'x', maybe: undefined });
    expect(sql).toBe('INSERT INTO t (id, name) VALUES (?, ?)');
    expect(args).toEqual(['a', 'x']);
  });
  it('buildUpdate builds SET + WHERE with correct arg order', () => {
    const { sql, args } = buildUpdate('t', { status: 'x' }, { id: '1' });
    expect(sql).toBe('UPDATE t SET status = ? WHERE id = ?');
    expect(args).toEqual(['x', '1']);
  });
});

describe('Memory Kernel', () => {
  it('a holding metric premise stays holding while telemetry agrees', async () => {
    await seedDecision('d1', 'Stay self-serve');
    await recordPremise({
      productId: 'p_mem', decisionId: 'd1', premise: 'churn stays under 5%',
      metricKey: 'churn_rate', comparator: '<', threshold: 0.05,
    });
    await seedSnapshot(0.03); // 3% — premise holds
    const res = await checkPremises('p_mem');
    expect(res.checked).toBe(1);
    expect(res.falsified).toBe(0);
  });

  it('falsifies a premise + surfaces it as an expired belief when telemetry disagrees', async () => {
    await seedDecision('d2', 'Skip enterprise — churn is fine');
    await recordPremise({
      productId: 'p_mem', decisionId: 'd2', premise: 'churn stays under 5%',
      metricKey: 'churn_rate', comparator: '<', threshold: 0.05,
    });
    await seedSnapshot(0.09); // 9% — premise violated for BOTH d1 and d2 premises
    const res = await checkPremises('p_mem');
    expect(res.falsified).toBeGreaterThanOrEqual(1);

    const expired = await getExpiredBeliefs('p_mem');
    expect(expired.length).toBeGreaterThanOrEqual(1);
    const d2 = expired.find((e) => e.decision_title === 'Skip enterprise — churn is fine');
    expect(d2).toBeTruthy();
    expect(d2!.premise.status).toBe('falsified');
    expect(d2!.premise.evidence).toContain('churn_rate = 0.09');
  });

  it('marks an expired belief as revisited (leaves the accountability queue)', async () => {
    const before = await getExpiredBeliefs('p_mem');
    expect(before.length).toBeGreaterThan(0);
    await markRevisited(before[0].premise.id, 'p_mem');
    const after = await getExpiredBeliefs('p_mem');
    expect(after.length).toBe(before.length - 1);
  });

  it('leaves a metric premise unverifiable when the metric has no data', async () => {
    await seedDecision('d3', 'Bet on NPS');
    await recordPremise({
      productId: 'p_mem', decisionId: 'd3', premise: 'NPS above 40',
      metricKey: 'nps_score', comparator: '>', threshold: 40,
    });
    await checkPremises('p_mem'); // latest snapshot has no nps_score column value
    const r = await query("SELECT status FROM decision_premises WHERE decision_id='d3'", []);
    expect((r.rows[0] as Record<string, unknown>).status).toBe('unverifiable');
  });

  it('never auto-checks a qualitative premise', async () => {
    await seedDecision('d4', 'Positioning bet');
    const id = await recordPremise({
      productId: 'p_mem', decisionId: 'd4', premise: 'devtools buyers value speed over price',
    });
    await checkPremises('p_mem');
    const r = await query('SELECT status, premise_type FROM decision_premises WHERE id=?', [id]);
    expect((r.rows[0] as Record<string, unknown>).premise_type).toBe('qualitative');
    expect((r.rows[0] as Record<string, unknown>).status).toBe('holding');
  });

  it('digest counts premises by status', async () => {
    const d = await getMemoryDigest('p_mem');
    expect(d.total).toBeGreaterThan(0);
    expect(d.holding + d.falsified + d.unverifiable + d.revisited).toBe(d.total);
  });
});
