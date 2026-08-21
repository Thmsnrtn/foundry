process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { runSync } from '../../src/services/integrations/framework.js';

// =============================================================================
// THREE QUANTITIES, THREE WRONG COLUMNS.
//
// The framework path's Stripe adapter — reachable through
// `POST /api/supercharge` — wrote three numbers into three columns that mean
// something else:
//
//   totalMRRCents   the sum over every ACTIVE subscription, i.e. the MRR LEVEL,
//                   written into `new_mrr_cents`. A company at $50k MRR with a
//                   flat month was recorded as having WON $50k of new business,
//                   on every sync.
//   refundedCents   refunded charges over thirty days, written into
//                   `churned_mrr_cents`. A refund is money returned; churned
//                   MRR is recurring revenue lost. One refunded annual invoice
//                   became that much recurring revenue gone. The comment above
//                   it read "for churn calculation" — naming a thing it did not
//                   compute.
//   customerCount   a count of SUBSCRIPTIONS, written into `active_users`,
//                   which means people using the product. One subscription can
//                   cover a team of two hundred.
//
// The adapter knows one thing for certain and now writes one thing. The
// subscription count is not stored at all rather than stored somewhere close:
// `metric_snapshots` has no column for a paying-customer LEVEL, only the
// movements `new_customers` and `churned_customers`.
//
// This is the same file whose `runAllDueSyncs` is imported by nothing — but
// `runSync` is not dead: the supercharge route calls it. A dormant module and a
// reachable function can live in one file, and the reachability baseline is per
// module, so it will not tell you which.
// =============================================================================

const P = 'p_fw';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_fw','c_fw','fw@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_fw','active')", [P]);
});
beforeEach(async () => {
  await query('DELETE FROM metric_snapshots');
  await query('DELETE FROM integration_sync_log');
  await query('DELETE FROM integrations');
  await query(
    `INSERT INTO integrations (id, product_id, provider, type, status, credentials, error_count)
     VALUES ('int_fw', ?, 'stripe', 'stripe', 'active', ?, 0)`,
    [P, JSON.stringify({ api_key: 'sk_test' })]);
});
afterEach(() => { vi.unstubAllGlobals(); });

/** One live subscription at $50,000/mo, and a refunded charge. */
function stripeSays(): void {
  vi.stubGlobal('fetch', async (url: string) => ({
    ok: true, status: 200,
    json: async () => (String(url).includes('/subscriptions')
      ? { data: [{ items: { data: [{ price: { unit_amount: 5_000_000, recurring: { interval: 'month' } } }] } }] }
      : { data: [{ refunded: true, amount: 120_000 }] }),
    text: async () => '{}',
  }));
}

describe('the framework Stripe adapter', () => {
  it('records the level as the level', async () => {
    stripeSays();
    await runSync('int_fw');

    const row = (await query('SELECT * FROM metric_snapshots WHERE product_id = ?', [P]))
      .rows[0] as Record<string, unknown>;
    expect(Number(row.mrr_cents)).toBe(5_000_000);
  });

  it('does not report the level as new business', async () => {
    stripeSays();
    await runSync('int_fw');

    const row = (await query('SELECT * FROM metric_snapshots WHERE product_id = ?', [P]))
      .rows[0] as Record<string, unknown>;
    expect(row.new_mrr_cents == null ? 0 : Number(row.new_mrr_cents),
      'a flat month at $50k MRR won nothing new').toBe(0);
  });

  it('does not report a refund as churned recurring revenue', async () => {
    stripeSays();
    await runSync('int_fw');

    const row = (await query('SELECT * FROM metric_snapshots WHERE product_id = ?', [P]))
      .rows[0] as Record<string, unknown>;
    expect(row.churned_mrr_cents == null ? 0 : Number(row.churned_mrr_cents),
      'a refund is money returned, not recurring revenue lost').toBe(0);
  });

  it('does not report a subscription count as active users', async () => {
    stripeSays();
    await runSync('int_fw');

    const row = (await query('SELECT * FROM metric_snapshots WHERE product_id = ?', [P]))
      .rows[0] as Record<string, unknown>;
    expect(row.active_users, 'one subscription can cover a team of two hundred').toBeNull();
  });

  it('reports which metric it actually updated', async () => {
    stripeSays();
    const result = await runSync('int_fw');
    expect(result.metrics_updated).toEqual(['mrr_cents']);
  });
});

describe('the wrong columns are gone from the source', () => {
  it('the adapter names only the one it knows', () => {
    const code = stripComments(
      readFileSync('src/services/integrations/framework.ts', 'utf8'), { lineComments: true });
    const adapter = code.slice(code.indexOf('const stripeAdapter'));
    expect(adapter).toMatch(/INSERT INTO metric_snapshots \(id, product_id, snapshot_date, mrr_cents\)/);
    expect(adapter, 'the level was written here')
      .not.toMatch(/new_mrr_cents = excluded\.new_mrr_cents/);
    expect(adapter, 'refunds were written here')
      .not.toMatch(/churned_mrr_cents = excluded\.churned_mrr_cents/);
    expect(adapter, 'and it no longer fetches charges it cannot use')
      .not.toMatch(/refundedCents/);
  });
});
