process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';

// =============================================================================
// AN INVESTOR UPDATE WITH TWO PHANTOM COLUMNS.
//
// `investor-update.ts` read `metric_snapshots.mrr_growth_pct` and
// `metric_snapshots.customer_count`. Neither has ever been a column — the same
// pair the fundraising assessment was found reading earlier in this campaign.
// Off a `SELECT *` row they are `undefined` forever, so every monthly investor
// update ever generated reported growth and customer count as "N/A", and the
// prior snapshot fetched two queries above to compute growth was never used.
//
// The email digest had the milder version: it labelled the change between the
// two most recent snapshots "WoW" — week over week — when for a daily reporter
// it is yesterday against the day before.
// =============================================================================

const seen: { prompt: string } = { prompt: '' };

vi.mock('../../src/services/ai/client.js', async (orig) => {
  const actual = await orig<typeof import('../../src/services/ai/client.js')>();
  return {
    ...actual,
    callSonnet: async (_system: string, user: string) => {
      seen.prompt = user;
      return { content: 'An update.', input_tokens: 1, output_tokens: 1 };
    },
  };
});

const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');
const { generateInvestorUpdate } = await import('../../src/services/scp/investor/investor-update.js');

const P = 'p_inv';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_inv','c_inv','i@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_inv','active')", [P]);
});

beforeEach(async () => {
  await query('DELETE FROM metric_snapshots');
  await query('DELETE FROM customers');
  // The generator is idempotent per month and returns the stored id without
  // calling the model, so each case starts with no update on file.
  await query('DELETE FROM investor_updates');
  seen.prompt = '';
});

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
// The second argument is a MONTH ('2026-03'), which bounds the metrics query.
const thisMonth = new Date().toISOString().slice(0, 7);

describe('the monthly investor update', () => {
  it('reports growth derived from the two snapshots', async () => {
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, mrr_cents)
       VALUES ('ms_a', ?, ?, 10000000), ('ms_b', ?, ?, 11500000)`,
      [P, daysAgo(30), P, daysAgo(0)]);

    await generateInvestorUpdate(P, thisMonth);
    expect(seen.prompt, 'growth was N/A for every company, forever')
      .toMatch(/MRR: \$115,000 \(\+1[4-6]\.\d% MoM\)/);
  });

  it('counts the customers where they actually live', async () => {
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, mrr_cents)
       VALUES ('ms_a', ?, ?, 10000000)`, [P, daysAgo(0)]);
    await query(
      `INSERT INTO customers (id, product_id, owner_id, external_id, mrr_cents)
       VALUES ('c_1', ?, 'f_inv', 'x1', 5000), ('c_2', ?, 'f_inv', 'x2', 7000)`, [P, P]);

    await generateInvestorUpdate(P, thisMonth);
    expect(seen.prompt).toMatch(/Customers: 2/);
  });

  it('says nothing about growth when there is only one snapshot', async () => {
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, mrr_cents)
       VALUES ('ms_a', ?, ?, 10000000)`, [P, daysAgo(0)]);
    await generateInvestorUpdate(P, thisMonth);
    expect(seen.prompt).toContain('- MRR: $100,000\n');
  });
});

describe('the email digest', () => {
  it('no longer calls an arbitrary interval week over week', () => {
    const src = stripComments(readFileSync('src/services/scp/briefing/email-digest.ts', 'utf8'));
    expect(src).not.toContain('WoW');
    expect(src).toContain('over 1 day');
  });
});
