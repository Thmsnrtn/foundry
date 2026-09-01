process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { syncStripeMetrics } from '../../src/services/integrations/stripe.js';

// =============================================================================
// THE LEVEL WAS COMPUTED, AND THROWN AWAY.
//
// `metric_snapshots.mrr_cents` is a company's MRR LEVEL. Every investor-facing
// surface reads it: the board deck, the portfolio overview, the investor
// packet, fundraising readiness. `new_mrr_cents` is the new business won this
// period, and this campaign has already had to separate the two twice.
//
// The level had exactly TWO writers in the whole system, and both of them are
// the company REPORTING its own numbers — the v1 metrics API and the ingest
// route. NOT ONE INTEGRATION WROTE IT.
//
// `stripe.ts` computed it. Line 118: `const totalMrr = activeSubs.reduce(...)`,
// and then the column list it built did not include `mrr_cents`. So a company
// that connected Stripe — the most obvious way a SaaS company expects Foundry
// to learn its revenue — left the level permanently null while Foundry synced
// its subscriptions every hour and computed the answer on the way past.
//
// IT WAS INVISIBLE FOR AS LONG AS THE READERS SUBSTITUTED A FALLBACK, and that
// is the argument for removing them. The board deck used to render `?? 0`; the
// portfolio overview summed `new_mrr_cents + expansion_mrr_cents` and called it
// MRR. Both looked populated. Removing the substitutions this cycle is what
// made the missing writer show: a zero looks like an answer, and a null asks a
// question.
//
// The dormant second Stripe path, `stripe-sync.ts`, had the same defect —
// `currentMrr` computed and discarded. Nothing can reach it today, so fixing it
// is not a live change; it is the defect removed before somebody wires that
// module up and inherits it.
// =============================================================================

const P = 'p_stripe';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_s','c_s','s@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_s','active')", [P]);
  await query(
    `INSERT INTO integrations (id, product_id, provider, direction, status) VALUES ('int_s', ?, 'stripe', 'inbound', 'active')`, [P]);
});
beforeEach(async () => { await query('DELETE FROM metric_snapshots'); });
afterEach(() => { vi.unstubAllGlobals(); });

/** Two live subscriptions at $500/mo and $250/mo; one of them started today. */
function stripeIsReachable(): void {
  const nowSec = Math.floor(Date.now() / 1000);
  // AN HOUR AGO IS NOT ALWAYS THIS MONTH. `sub_new` stood for "started this
  // month" and was dated `nowSec - 3600`, which lands in the PREVIOUS month for
  // the first hour of every one — and this file duly failed at 00:54 UTC on the
  // 1st, asserting 25000 against a `new_mrr_cents` of 0. Nothing was wrong with
  // the code under test, and a suite that goes red for an hour a month is how a
  // real failure gets waved through as "that flaky one".
  //
  // Anchored to the start of the current UTC month instead, still in the past
  // and still unambiguously inside the window the assertion is about.
  const startOfMonth = Date.UTC(
    new Date().getUTCFullYear(), new Date().getUTCMonth(), 1) / 1000;
  const newSubCreated = Math.max(nowSec - 3600, startOfMonth + 60);
  const page = (data: unknown[]) => ({
    ok: true, status: 200,
    json: async () => ({ data, has_more: false }),
    text: async () => JSON.stringify({ data, has_more: false }),
  });
  vi.stubGlobal('fetch', async (url: string) => {
    if (String(url).includes('/subscriptions') && String(url).includes('status=active')) {
      return page([
        { id: 'sub_old', status: 'active', created: nowSec - 90 * 86400, canceled_at: null,
          items: { data: [{ price: { unit_amount: 50000, recurring: { interval: 'month' } } }] } },
        { id: 'sub_new', status: 'active', created: newSubCreated, canceled_at: null,
          items: { data: [{ price: { unit_amount: 25000, recurring: { interval: 'month' } } }] } },
      ]);
    }
    return page([]);
  });
}

describe('a company that connected Stripe', () => {
  it('has its MRR level recorded, not only its movement', async () => {
    stripeIsReachable();
    await syncStripeMetrics(P, 'int_s', { access_token: 'sk_test' }, null);

    const row = (await query('SELECT * FROM metric_snapshots WHERE product_id = ?', [P]))
      .rows[0] as Record<string, unknown>;
    expect(row, 'the sync must have written a snapshot at all').toBeTruthy();
    expect(Number(row.mrr_cents), '$750/mo across two live subscriptions').toBe(75000);
  });

  it('and the level is not the same number as the new business', async () => {
    stripeIsReachable();
    await syncStripeMetrics(P, 'int_s', { access_token: 'sk_test' }, null);

    const row = (await query('SELECT * FROM metric_snapshots WHERE product_id = ?', [P]))
      .rows[0] as Record<string, unknown>;
    expect(Number(row.new_mrr_cents), 'only the subscription started this month').toBe(25000);
    expect(Number(row.mrr_cents)).not.toBe(Number(row.new_mrr_cents));
  });

  it('records the level as a level even when nothing is new', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    vi.stubGlobal('fetch', async (url: string) => ({
      ok: true, status: 200,
      json: async () => ({
        data: String(url).includes('status=active')
          ? [{ id: 'sub_old', status: 'active', created: nowSec - 400 * 86400, canceled_at: null,
              items: { data: [{ price: { unit_amount: 500000, recurring: { interval: 'month' } } }] } }]
          : [],
        has_more: false,
      }),
      text: async () => '{}',
    }));

    await syncStripeMetrics(P, 'int_s', { access_token: 'sk_test' }, null);
    const row = (await query('SELECT * FROM metric_snapshots WHERE product_id = ?', [P]))
      .rows[0] as Record<string, unknown>;
    expect(Number(row.mrr_cents), 'a flat month at $5,000/mo is still $5,000/mo').toBe(500000);
    expect(Number(row.new_mrr_cents ?? 0)).toBe(0);
  });
});

describe('the level has a writer that is not the company reporting it', () => {
  it('stripe.ts names the column', () => {
    const code = stripComments(
      readFileSync('src/services/integrations/stripe.ts', 'utf8'), { lineComments: true });
    expect(code).toMatch(/const columns = \[\s*'mrr_cents',/);
    expect(code).toMatch(/const values = \[totalMrr,/);
  });

  it('and the dormant path no longer discards it either', () => {
    const code = stripComments(
      readFileSync('src/services/integrations/stripe-sync.ts', 'utf8'), { lineComments: true });
    expect(code).toMatch(/mrr_cents = excluded\.mrr_cents/);
    expect(code).toMatch(/today, currentMrr, newMrr, churnedMrr/);
  });
});
