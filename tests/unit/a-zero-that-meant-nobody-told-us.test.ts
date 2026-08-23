process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getMRRDecomposition, computeHealthRatio } from '../../src/services/intelligence/revenue.js';

// =============================================================================
// A ZERO THAT MEANT "NOBODY TOLD US".
//
// `new_mrr_cents`, `expansion_mrr_cents`, `contraction_mrr_cents` and
// `churned_mrr_cents` were `INTEGER DEFAULT 0`, so a company that reported a
// genuine zero and a company that reported no movement at all stored the same
// value. Every reader that added them up inherited the ambiguity, and ten
// importers stated it as fact: the founder's chat context listed the zeros, the
// COO prompt said "net new this period: $0", and the voice briefing said "Net
// new MRR this period: flat" out loud — a statement about the month, from a row
// nobody had written a number into.
//
// Migration 202 rebuilt the table without the defaults. The distinction exists
// now, and this file holds the two halves that make it real: the reader returns
// null rather than zero, and the webhook's `col = col + ?` increments do not
// vanish against a NULL (`NULL + 5` is NULL in SQL).
//
// One caveat this cannot fix: rows written BEFORE the migration keep their
// stored zeros, and those stay ambiguous forever.
// =============================================================================

const P = 'p_null';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_n','c_n','n@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_n','active')", [P]);
});
beforeEach(async () => { await query('DELETE FROM metric_snapshots'); });

describe('the column', () => {
  it('stores NULL when an insert does not mention it', async () => {
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, mrr_cents)
       VALUES ('ms_1', ?, date('now'), 8000000)`, [P]);

    const row = (await query(
      'SELECT new_mrr_cents, churned_mrr_cents FROM metric_snapshots WHERE id = ?', ['ms_1']))
      .rows[0] as unknown as { new_mrr_cents: number | null; churned_mrr_cents: number | null };
    expect(row.new_mrr_cents).toBeNull();
    expect(row.churned_mrr_cents).toBeNull();
  });

  it('stores a reported zero as a zero', async () => {
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, mrr_cents, new_mrr_cents)
       VALUES ('ms_2', ?, date('now'), 8000000, 0)`, [P]);

    const row = (await query('SELECT new_mrr_cents FROM metric_snapshots WHERE id = ?', ['ms_2']))
      .rows[0] as unknown as { new_mrr_cents: number | null };
    expect(row.new_mrr_cents).toBe(0);
  });
});

describe('the decomposition', () => {
  it('says nothing about a movement nobody reported', async () => {
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, mrr_cents)
       VALUES ('ms_3', ?, date('now'), 8000000)`, [P]);

    const mrr = await getMRRDecomposition(P);
    expect(mrr?.level_cents).toBe(8000000);
    expect(mrr?.new_cents, 'a company at $80k MRR did not win $0 of new business').toBeNull();
    expect(mrr?.churned_cents).toBeNull();
    expect(mrr?.net_new_cents, 'a sum missing a term is not a smaller sum').toBeNull();
    expect(mrr?.health_ratio).toBeNull();
  });

  it('reports a flat month as flat when the company said so', async () => {
    await query(
      `INSERT INTO metric_snapshots
         (id, product_id, snapshot_date, mrr_cents, new_mrr_cents, expansion_mrr_cents,
          contraction_mrr_cents, churned_mrr_cents)
       VALUES ('ms_4', ?, date('now'), 8000000, 0, 0, 0, 0)`, [P]);

    const mrr = await getMRRDecomposition(P);
    expect(mrr?.new_cents).toBe(0);
    expect(mrr?.net_new_cents).toBe(0);
  });

  it('adds up what it was told', async () => {
    await query(
      `INSERT INTO metric_snapshots
         (id, product_id, snapshot_date, mrr_cents, new_mrr_cents, expansion_mrr_cents,
          contraction_mrr_cents, churned_mrr_cents)
       VALUES ('ms_5', ?, date('now'), 8000000, 500000, 100000, 20000, 80000)`, [P]);

    const mrr = await getMRRDecomposition(P);
    expect(mrr?.net_new_cents).toBe(500000 + 100000 - 20000 - 80000);
    expect(mrr?.health_ratio).toBeCloseTo(80000 / 500000, 6);
  });

  it('is unknown, not green, when the ratio has no denominator', async () => {
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, mrr_cents, churned_mrr_cents)
       VALUES ('ms_6', ?, date('now'), 8000000, 80000)`, [P]);

    const mrr = await getMRRDecomposition(P);
    expect(mrr?.health_ratio).toBeNull();
    expect(computeHealthRatio(mrr!).indicator).toBe('unknown');
  });
});

describe('an increment against a column nobody has written', () => {
  it('does not vanish', async () => {
    // `NULL + 5` is NULL. The Stripe webhook accumulates in place, so without
    // COALESCE the first event of a period would have been discarded — the
    // event arrived, the row was touched, and the number stayed unknown.
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date) VALUES ('ms_7', ?, date('now'))`,
      [P]);
    await query(
      `UPDATE metric_snapshots SET new_mrr_cents = COALESCE(new_mrr_cents, 0) + ?
        WHERE id = 'ms_7'`, [4900]);

    const row = (await query("SELECT new_mrr_cents FROM metric_snapshots WHERE id = 'ms_7'"))
      .rows[0] as unknown as { new_mrr_cents: number };
    expect(Number(row.new_mrr_cents)).toBe(4900);
  });

  it('is how the webhook is written', async () => {
    const { readFileSync } = await import('node:fs');
    const { stripComments } = await import('../../scripts/lib/strip-comments.mjs');
    const src = stripComments(
      readFileSync('src/services/integrations/stripe-webhook.ts', 'utf8'), { lineComments: true });
    // Comments stripped: the paragraph explaining this quotes the bare form.
    expect(src).not.toMatch(/SET new_mrr_cents = new_mrr_cents \+/);
    expect(src).not.toMatch(/SET churned_mrr_cents = churned_mrr_cents \+/);
    expect(src).not.toMatch(/SET expansion_mrr_cents = expansion_mrr_cents \+/);
    expect(src).not.toMatch(/SET contraction_mrr_cents = contraction_mrr_cents \+/);
  });
});

describe('a sum across companies', () => {
  it('does not drop a company that reported only some of the four', async () => {
    // `a + b - c - d` is NULL when any one of them is, and SUM skips NULLs —
    // so a row-wise sum silently dropped every snapshot that did not report all
    // four movements, and the number that came out was not smaller for a reason
    // anyone could see. Each term is summed over the rows that reported it.
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, new_mrr_cents, churned_mrr_cents)
       VALUES ('ms_sum', ?, date('now','-3 days'), 500000, 100000)`, [P]);

    const row = (await query(
      `SELECT COALESCE(SUM(new_mrr_cents), 0) + COALESCE(SUM(expansion_mrr_cents), 0)
            - COALESCE(SUM(contraction_mrr_cents), 0) - COALESCE(SUM(churned_mrr_cents), 0) AS total,
              COUNT(new_mrr_cents) + COUNT(expansion_mrr_cents)
            + COUNT(contraction_mrr_cents) + COUNT(churned_mrr_cents) AS reported
         FROM metric_snapshots WHERE product_id = ?`, [P]))
      .rows[0] as unknown as { total: number; reported: number };

    expect(Number(row.total)).toBe(400000);
    expect(Number(row.reported), 'two of the four terms were reported').toBe(2);
  });

  it('counts nothing reported as nothing reported', async () => {
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, mrr_cents)
       VALUES ('ms_sum2', ?, date('now','-3 days'), 8000000)`, [P]);

    const row = (await query(
      `SELECT COUNT(new_mrr_cents) + COUNT(expansion_mrr_cents)
            + COUNT(contraction_mrr_cents) + COUNT(churned_mrr_cents) AS reported
         FROM metric_snapshots WHERE product_id = ?`, [P]))
      .rows[0] as unknown as { reported: number };

    // A portfolio that reported nothing did not move by zero.
    expect(Number(row.reported)).toBe(0);
  });
});
