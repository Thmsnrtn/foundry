process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  getMRRIntelligence, getPulse, getForecast,
} from '../../src/services/founder/intelligence.js';

// =============================================================================
// REVENUE COUNTED BEFORE ANYONE PAID — AND TWO BUSINESSES' MONEY UNDER ONE NAME.
//
// The Stripe webhook sets `founders.tier` on `customer.subscription.created`
// including while the subscription's status is `trialing` — that is the very
// branch that records `trial_ends_at`. So a founder three days into the
// fourteen-day card-upfront trial, who has paid nothing and may never, counted
// at full list price in `current_mrr`, in `arr`, in `by_tier`, and in every
// forecast compounded from them.
//
// Beside it, the same object held two different companies' money under one
// word. `PulseData.mrr` summed `metric_snapshots` across all products: the
// reported MRR MOVEMENT of the customer companies Foundry operates. It went
// out of /api/founder/executive-dashboard next to `mrr.current_mrr`, which is
// Foundry's own subscription revenue, and an alert read "MRR declined 14% this
// month" about whichever one the reader assumed. `mrr_history` was the same
// portfolio series again, plotted as Foundry's own history.
//
// And two constants at the ends of the range. `runway_months: 999` — eighty-
// three years, asserted by the comment `// SaaS with low burn`, when nothing
// records burn at all. `last_audit_run: null` — the mirror image, a fact that
// exists in `audit_scores` and was thrown away rather than looked up.
// =============================================================================

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => {
  await query('DELETE FROM audit_scores');
  await query('DELETE FROM metric_snapshots');
  await query('DELETE FROM lifecycle_state');
  await query('DELETE FROM products');
  await query('DELETE FROM founders');
});

async function addFounder(opts: {
  tier: string; trialEndsAt?: string | null; createdDaysAgo?: number;
}): Promise<string> {
  const id = `f_${nanoid(8)}`;
  await query(
    `INSERT INTO founders (id, clerk_user_id, email, tier, trial_ends_at, created_at)
     VALUES (?,?,?,?,?, datetime('now', ?))`,
    [id, `clerk_${id}`, `${id}@example.com`, opts.tier, opts.trialEndsAt ?? null,
      `-${opts.createdDaysAgo ?? 60} days`]);
  return id;
}

describe('a founder inside a trial window', () => {
  it('is not revenue', async () => {
    await addFounder({ tier: 'growth', trialEndsAt: '2099-01-01' });
    const mrr = await getMRRIntelligence();
    expect(mrr.current_mrr, 'nothing has been charged').toBe(0);
    expect(mrr.arr).toBe(0);
  });

  it('is counted, and said to be a trial', async () => {
    await addFounder({ tier: 'growth', trialEndsAt: '2099-01-01' });
    await addFounder({ tier: 'investor_ready', trialEndsAt: '2099-01-01' });
    const mrr = await getMRRIntelligence();
    expect(mrr.trialing.count).toBe(2);
    expect(mrr.trialing.list_price_mrr, '199 + 399 if both convert').toBe(598);
    expect(mrr.current_mrr).toBe(0);
  });

  it('does not appear in the tier breakdown as a paying customer', async () => {
    await addFounder({ tier: 'growth', trialEndsAt: '2099-01-01' });
    await addFounder({ tier: 'growth' });
    const mrr = await getMRRIntelligence();
    expect(mrr.by_tier.growth).toEqual({ count: 1, mrr: 199 });
    expect(mrr.current_mrr).toBe(199);
  });

  it('becomes revenue once the trial has ended', async () => {
    await addFounder({ tier: 'solo', trialEndsAt: '2020-01-01' });
    const mrr = await getMRRIntelligence();
    expect(mrr.current_mrr, 'the window closed, so they are being billed').toBe(79);
    expect(mrr.trialing.count).toBe(0);
  });

  it('is excluded from revenue, and there is no prior window to be excluded from', async () => {
    // This used to assert that a trialist was left out of `mrr_30d_ago` as well
    // as out of `current_mrr`. The prior window was itself unsound: it was
    // today's roster filtered by signup date, a strict SUBSET of today's
    // payers, so the growth rate could not be negative for anyone. Nothing
    // records what Foundry's MRR was thirty days ago, so it says so.
    await addFounder({ tier: 'growth' });
    await addFounder({ tier: 'growth', trialEndsAt: '2099-01-01', createdDaysAgo: 60 });
    const mrr = await getMRRIntelligence();
    expect(mrr.current_mrr, 'the trialist is not revenue').toBe(199);
    expect(mrr.mrr_30d_ago).toBeNull();
    expect(mrr.growth_rate_pct).toBeNull();
  });

  it('leaves no list-price total that includes trials', () => {
    const src = stripComments(
      readFileSync('src/services/founder/intelligence.ts', 'utf8'), { lineComments: true });
    const fn = src.slice(src.indexOf('export async function getMRRIntelligence'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 3);
    expect(body, 'the tier query must split paying from trialing')
      .toMatch(/trial_ends_at/);
    expect(body, 'a plain COUNT(*) over every tiered founder is the old shape')
      .not.toMatch(/SELECT tier, COUNT\(\*\) as c FROM founders WHERE tier IS NOT NULL/);
  });
});

describe('two businesses, two names', () => {
  it('does not call the operated companies’ movement Foundry’s MRR', async () => {
    const src = stripComments(
      readFileSync('src/services/founder/intelligence.ts', 'utf8'), { lineComments: true });
    expect(src, 'the portfolio series was plotted as Foundry’s history')
      .not.toMatch(/mrr_history/);
    expect(src).not.toMatch(/mrr_delta_pct/);
    expect(src).toMatch(/portfolio_mrr_movement_30d/);
    expect(src).toMatch(/portfolio_mrr_movement_history/);
  });

  it('reports portfolio movement from the snapshots, not from founders', async () => {
    const ownerId = await addFounder({ tier: 'growth' });
    await query(
      `INSERT INTO products (id, name, owner_id, status) VALUES ('p1','C',?,'active')`,
      [ownerId]);
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, new_mrr_cents, churned_mrr_cents)
       VALUES (?, 'p1', date('now','-3 days'), 500000, 100000)`, [nanoid()]);

    const pulse = await getPulse();
    expect(pulse.portfolio_mrr_movement_30d, '(500000 - 100000) cents').toBe(4000);

    const mrr = await getMRRIntelligence();
    expect(mrr.current_mrr, 'Foundry’s own revenue is a different number').toBe(199);
  });

  it('says unknown rather than zero when there is no prior window', async () => {
    const pulse = await getPulse();
    expect(pulse.portfolio_mrr_movement_delta_pct).toBeNull();
  });

  it('names whose money the alert is about', () => {
    const src = readFileSync('src/services/founder/intelligence.ts', 'utf8');
    expect(src).toMatch(/Reported MRR movement across operated companies is down/);
    expect(stripComments(src, { lineComments: true }), 'the old alert said only "MRR declined"')
      .not.toMatch(/MRR declined \$\{/);
  });
});

describe('signups that never converted are not churn', () => {
  it('counts them under a name that is true', async () => {
    const id = `f_${nanoid(8)}`;
    await query(
      `INSERT INTO founders (id, clerk_user_id, email, created_at)
       VALUES (?,?,?, datetime('now','-30 days'))`,
      [id, `clerk_${id}`, `${id}@example.com`]);

    const pulse = await getPulse();
    expect(pulse.signups_never_converted).toBe(1);
    expect(pulse, 'they never paid, so they cannot have left')
      .not.toHaveProperty('churn_this_month');
  });
});

describe('the two ends of the range', () => {
  it('does not claim eighty-three years of runway', async () => {
    const forecast = await getForecast();
    expect(forecast.runway_months, 'nothing records burn').toBeNull();

    const src = stripComments(
      readFileSync('src/services/founder/intelligence.ts', 'utf8'), { lineComments: true });
    expect(src).not.toMatch(/runway_months:\s*999/);
  });

  it('projects nothing when the growth rate is not measured', async () => {
    await addFounder({ tier: 'growth', createdDaysAgo: 2 });
    const forecast = await getForecast();
    expect(forecast.projections, 'no 30-day-ago revenue to compare against').toEqual([]);
    expect(forecast.projected_from.measured).toBe(false);
  });

  it('projects nothing even when there are older founders to compare against', async () => {
    // The branch this used to exercise was reached by comparing today's payers
    // against today's payers-who-signed-up-earlier — a subset, so "growth" was
    // whatever the newer cohort added and never less. Two founders, one 60 days
    // old, produced "+100% a month" and a twelve-month curve built on it.
    await addFounder({ tier: 'growth', createdDaysAgo: 60 });
    await addFounder({ tier: 'growth', createdDaysAgo: 2 });
    const forecast = await getForecast();
    expect(forecast.projected_from.measured).toBe(false);
    expect(forecast.projected_from.monthly_growth_pct).toBeNull();
    expect(forecast.projections).toEqual([]);
  });

  it('carries no invented damping coefficient', () => {
    const src = stripComments(
      readFileSync('src/services/founder/intelligence.ts', 'utf8'), { lineComments: true });
    expect(src, 'runningCustomers * (1 + monthlyGrowth * 0.8)').not.toMatch(/monthlyGrowth \* 0\.8/);
  });

  it('looks up the last audit rather than reporting none', async () => {
    expect((await getPulse()).last_audit_run, 'nothing recorded yet').toBeNull();

    const ownerId = await addFounder({ tier: 'growth' });
    await query(
      `INSERT INTO products (id, name, owner_id, status) VALUES ('p2','C2',?,'active')`,
      [ownerId]);
    await query(
      `INSERT INTO audit_scores (id, product_id, run_type, composite, created_at)
       VALUES (?, 'p2', 'initial', 70, '2026-05-05 09:00:00')`, [nanoid()]);

    expect((await getPulse()).last_audit_run,
      'the fact existed and was being thrown away').toBe('2026-05-05 09:00:00');
  });
});
