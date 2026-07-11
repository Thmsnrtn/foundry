// =============================================================================
// Tests: Ascent Phase 5 — Network radar (B4), Trust ledger (B6), The Letter (B7)
// All three against the real migrated schema; all three honor their abstention
// rules (thin peer cells, thin trust samples, quiet days).
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

import { describe, it, expect, beforeAll } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { scanForWarnings } from '../../src/services/network/radar.js';
import { getTrustLedger, TRUST_MIN_SAMPLE } from '../../src/services/trust/ledger.js';
import { composeLetter } from '../../src/services/letter/composer.js';

let seq = 0;
const id = (): string => `p5_${++seq}`;

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  for (const p of ['p_radar', 'p_thincell', 'p_trust', 'p_quiet']) {
    await query(`INSERT INTO products (id, name, owner_id) VALUES ('${p}','Co','o1')`, []);
    await query(`INSERT INTO lifecycle_state (product_id, current_prompt) VALUES ('${p}','prompt_2')`, []);
  }
  // Radar: product churns at 9% (mrr $1k → bracket 0-5k); peers median 4%.
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, churn_rate, mrr_cents)
     VALUES ('p5_snap1', 'p_radar', '2026-03-01', 0.09, 100000)`, [],
  );
  await query(
    `INSERT INTO network_benchmarks (id, metric, market_category, lifecycle_stage, mrr_bracket, p25, p50, p75, sample_count)
     VALUES ('nb_p5', 'churn_rate', 'all', 'prompt_2', '0-5k', 0.02, 0.04, 0.06, 9)`, [],
  );
  // Thin cell: its own stage (prompt_3) so it can't match p_radar's cell;
  // terrible NPS but only 3 peers → must abstain.
  await query("UPDATE lifecycle_state SET current_prompt = 'prompt_3' WHERE product_id = 'p_thincell'", []);
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, nps_score, mrr_cents)
     VALUES ('p5_snap2', 'p_thincell', '2026-03-01', 5, 100000)`, [],
  );
  await query(
    `INSERT INTO network_benchmarks (id, metric, market_category, lifecycle_stage, mrr_bracket, p25, p50, p75, sample_count)
     VALUES ('nb_thin', 'nps_score', 'all', 'prompt_3', '0-5k', 20, 40, 60, 3)`, [],
  );
  // Trust: 9 approved marketing decisions with positive outcomes, 1 negative;
  // plus a thin category (3 decisions).
  for (let i = 0; i < 10; i++) {
    await query(
      `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status, decided_by, decided_at, outcome_valence)
       VALUES (?, 'p_trust', 'marketing', 1, 'x', 'y', 'approved', 'founder', datetime('now','-3 days'), ?)`,
      [id(), i < 9 ? 'positive' : 'negative'],
    );
  }
  for (let i = 0; i < 3; i++) {
    await query(
      `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status, decided_by, decided_at, outcome_valence)
       VALUES (?, 'p_trust', 'product', 2, 'x', 'y', 'approved', 'founder', datetime('now','-3 days'), 'positive')`,
      [id()],
    );
  }
  // Letter fodder for p_trust: an executed action + one pending gate-3 decision.
  await query(
    `INSERT INTO action_executions (id, product_id, action_type, integration, status, executed_at)
     VALUES ('p5_ae1', 'p_trust', 'send_email', 'resend', 'completed', datetime('now','-2 hours'))`, [],
  );
  await query(
    `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status)
     VALUES ('p5_pending', 'p_trust', 'strategic', 3, 'Enter enterprise', 'Pull from pipeline', 'pending')`, [],
  );
});

describe('Network radar (B4)', () => {
  it('warns when a vital is in the danger tail of a thick peer cell, with evidence', async () => {
    const w = await scanForWarnings('p_radar');
    expect(w.length).toBe(1);
    expect(w[0].metric).toBe('churn_rate');
    expect(w[0].message).toContain('9 peers');
    expect(w[0].message).toContain('4%'); // peer median shown, humanized
  });
  it('abstains on thin cells (<5 peers)', async () => {
    expect(await scanForWarnings('p_thincell')).toEqual([]);
  });
});

describe('Trust ledger (B6)', () => {
  it('marks a category earned at ≥80% positive on a real sample, and proposes graduation', async () => {
    const ledger = await getTrustLedger('p_trust');
    const marketing = ledger.categories.find((c) => c.category === 'marketing')!;
    expect(marketing.decided).toBe(10);
    expect(marketing.positiveRate).toBeCloseTo(0.9);
    expect(marketing.earned).toBe(true);
    expect(ledger.proposals.some((p) => p.includes('marketing') && p.includes('9/10'))).toBe(true);
  });
  it('never proposes on thin samples, whatever the rate', async () => {
    const ledger = await getTrustLedger('p_trust');
    const product = ledger.categories.find((c) => c.category === 'product')!;
    expect(product.decided).toBeLessThan(TRUST_MIN_SAMPLE);
    expect(product.earned).toBe(false);
    expect(ledger.proposals.some((p) => p.startsWith('product:'))).toBe(false);
  });
});

describe('The Letter (B7)', () => {
  it('composes handled / needs-you / trust from the ledgers, deterministically', async () => {
    const letter = await composeLetter('p_trust');
    expect(letter.quiet).toBe(false);
    expect(letter.handled.some((h) => h.includes('send_email'))).toBe(true);
    expect(letter.needsYou).toContain('Gate-3');
    expect(letter.needsYou).toContain('Enter enterprise');
    expect(letter.trust.some((t) => t.includes('marketing'))).toBe(true);
  });
  it('a company with nothing going on gets a quiet letter (Attention Law)', async () => {
    const letter = await composeLetter('p_quiet');
    expect(letter.quiet).toBe(true);
  });
});
