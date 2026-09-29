// =============================================================================
// Tests: Ascent Phase 5 — Trust ledger (B6), The Letter (B7)
// Both against the real migrated schema; both honor their abstention rules
// (thin trust samples, quiet days). The network radar (B4) and its cases were
// deleted in Private S7: one owner has no peer cell.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

import { describe, it, expect, beforeAll } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getTrustLedger, TRUST_MIN_SAMPLE } from '../../src/services/trust/ledger.js';
import { composeLetter } from '../../src/services/letter/composer.js';

let seq = 0;
const id = (): string => `p5_${++seq}`;

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  for (const p of ['p_trust', 'p_quiet']) {
    await query(`INSERT INTO products (id, name, owner_id) VALUES ('${p}','Co','o1')`, []);
    await query(`INSERT INTO lifecycle_state (product_id, current_prompt) VALUES ('${p}','prompt_2')`, []);
  }
  // Trust: 9 approved marketing decisions with positive outcomes, 1 negative;
  // plus a thin category (3 decisions).
  for (let i = 0; i < 10; i++) {
    await query(
      // FOUNDRY PROPOSED IT AND THE FOUNDER TOOK IT. The ledger prices
      // autonomy on Foundry's own record, and `decided_by = 'founder'` says who
      // RESOLVED the row, not who proposed it — a founder's own good calls used
      // to earn Foundry the gate. These fixtures now carry the recommendation
      // and the matching choice, which is what a proposal Foundry made and the
      // founder accepted actually looks like in this table.
      `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status, decided_by, decided_at, outcome_valence, recommendation, chosen_option)
       VALUES (?, 'p_trust', 'marketing', 1, 'x', 'y', 'approved', 'founder', datetime('now','-3 days'), ?, 'Run it', 'run it')`,
      [id(), i < 9 ? 1 : -1],
    );
  }
  for (let i = 0; i < 3; i++) {
    await query(
      `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status, decided_by, decided_at, outcome_valence, recommendation, chosen_option)
       VALUES (?, 'p_trust', 'product', 2, 'x', 'y', 'approved', 'founder', datetime('now','-3 days'), 1, 'Ship it', 'ship it')`,
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
