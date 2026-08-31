process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { computeMonthlyROI, getROISummary } from '../../src/services/scp/roi/calculator.js';

// =============================================================================
// A PRODUCT TELLING ITS CUSTOMER IT DELIVERED NOTHING.
//
// `/roi` is a mounted, authenticated page headlined "Value Delivered This
// Month". It reported **$0**, an action rate of **0%** and positive outcomes of
// **0%** for every company, always — because `recommendation_outcomes` has no
// writer. `recordRecommendation` and `markActedOn` are exported from
// `roi/outcome-tracker.ts` and called from nowhere.
//
// A founder reading that concludes Foundry delivered nothing. It is a claim
// about Foundry's own performance drawn from an absent measurement path, and
// commercially it is the sharpest version of this defect in the repository.
//
// The headline underneath said "Foundry is tracking recommendations — value
// will appear as outcomes are measured". Nothing was tracking anything, and the
// sentence promised a measurement that was not coming.
//
// NOT HALF-WIRED, DELIBERATELY. The obvious move is to call
// `recordRecommendation` from every agent run. That would be worse than doing
// nothing: recommendations would accumulate while `markActedOn` still had no
// caller, turning an UNMEASURED action rate into a MEASURED 0%. A loop that
// records its denominator and never its numerator produces a confident wrong
// answer, which is harder to notice than an honest blank.
//
// And the time-saved figure — acted-on x 2 hours x $200, two invented
// coefficients — was summed into "Value Delivered" beside real outcome
// dollars, so an assumption and a measurement arrived as one number.
// =============================================================================

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => {
  await query('DELETE FROM roi_monthly_summaries');
  await query('DELETE FROM recommendation_outcomes');
  await query('DELETE FROM products');
  await query('DELETE FROM founders');
});

const thisMonth = () => new Date().toISOString().slice(0, 7);

async function addCompany(): Promise<string> {
  const owner = `f_${nanoid(8)}`;
  await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)',
    [owner, `c_${owner}`, `${owner}@example.com`]);
  const pid = `p_${nanoid(8)}`;
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,?,?,'active')",
    [pid, 'C', owner]);
  return pid;
}

async function recommend(productId: string, opts: {
  category: string; outcome?: string; value?: number; actedOn?: boolean;
}) {
  await query(
    `INSERT INTO recommendation_outcomes
       (id, product_id, agent_name, recommendation_text, category,
        estimated_value_dollars, outcome, action_taken)
     VALUES (?,?, 'harbor', 'do the thing', ?, ?, ?, ?)`,
    [nanoid(), productId, opts.category, opts.value ?? null,
      opts.outcome ?? null, opts.actedOn ? 1 : 0]);
}

describe('a company nobody recorded a recommendation for', () => {
  it('is told nothing was measured, not that nothing was delivered', async () => {
    const roi = await computeMonthlyROI(await addCompany(), thisMonth());
    expect(roi.measurement).toBe('no_recommendations_recorded');
    expect(roi.total_value_dollars, '"Value Delivered This Month: $0"').toBeNull();
    expect(roi.action_rate_pct).toBeNull();
    expect(roi.outcome_rate_pct).toBeNull();
    expect(roi.roi_multiple).toBeNull();
  });

  it('gets a headline that does not promise a measurement that is not coming', async () => {
    const summary = await getROISummary(await addCompany());
    expect(summary.headline).toMatch(/not wired up/);
    expect(summary.headline, 'nothing was tracking anything')
      .not.toMatch(/Foundry is tracking recommendations/);
    expect(summary.all_time_value).toBeNull();
  });
});

describe('a company that has recorded some', () => {
  it('reports the measured value', async () => {
    const pid = await addCompany();
    await recommend(pid, { category: 'churn_prevented', outcome: 'positive', value: 1200, actedOn: true });
    await recommend(pid, { category: 'expansion_captured', outcome: 'positive', value: 800, actedOn: true });

    const roi = await computeMonthlyROI(pid, thisMonth());
    expect(roi.measurement).toBe('measured');
    expect(roi.total_value_dollars).toBe(2000);
    expect(roi.action_rate_pct).toBe(100);
  });

  it('does not add the time-saved assumption to the measured figure', async () => {
    const pid = await addCompany();
    await recommend(pid, { category: 'churn_prevented', outcome: 'positive', value: 1000, actedOn: true });

    const roi = await computeMonthlyROI(pid, thisMonth());
    // 1 acted-on x 2 hours x $200 = $400, reported separately.
    expect(roi.time_saved_dollars).toBe(400);
    expect(roi.total_value_dollars, 'an assumption is not a measurement').toBe(1000);
  });

  it('reports a real zero as a zero once something was recorded', async () => {
    const pid = await addCompany();
    await recommend(pid, { category: 'churn_prevented', outcome: 'negative', value: 0 });

    const roi = await computeMonthlyROI(pid, thisMonth());
    expect(roi.measurement, 'a recommendation exists, so this is measured').toBe('measured');
    expect(roi.total_value_dollars).toBe(0);
    expect(roi.action_rate_pct, 'recorded and not acted on').toBe(0);
    expect(roi.outcome_rate_pct, 'one negative outcome, no positives').toBe(0);
  });

  it('leaves the outcome rate unknown while no outcome has been measured', async () => {
    const pid = await addCompany();
    await recommend(pid, { category: 'churn_prevented', actedOn: true });
    const roi = await computeMonthlyROI(pid, thisMonth());
    expect(roi.action_rate_pct).toBe(100);
    expect(roi.outcome_rate_pct, 'acted on, outcome not yet known').toBeNull();
  });
});

describe('a cached month is the same blank as a live one', () => {
  it('does not read a summary row with no recommendations as measured zero', async () => {
    const pid = await addCompany();
    const prior = new Date();
    prior.setMonth(prior.getMonth() - 1);
    const priorMonth = prior.toISOString().slice(0, 7);
    await query(
      `INSERT INTO roi_monthly_summaries (id, product_id, month, recommendations_made)
       VALUES (?,?,?, 0)`, [nanoid(), pid, priorMonth]);

    const summary = await getROISummary(pid);
    const cached = summary.trailing_3_months.find((m) => m.month === priorMonth);
    expect(cached, 'the cached month should be loaded').toBeDefined();
    expect(cached!.total_value_dollars,
      'the row exists because a summary was computed, not because anything was measured')
      .toBeNull();
    expect(cached!.measurement).toBe('no_recommendations_recorded');
  });
});

describe('why it is blank rather than half-wired', () => {
  it('has no caller for the two writers, and that is the reason', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk('src');
    const tracker = 'src/services/scp/roi/outcome-tracker.ts';
    for (const fn of ['recordRecommendation', 'markActedOn']) {
      const callers = files.filter((f) => f !== tracker
        && new RegExp(`\\b${fn}\\b`).test(
          stripComments(readFileSync(f, 'utf8'), { lineComments: true })));
      // If a caller ever appears for recordRecommendation WITHOUT one for
      // markActedOn, the action rate becomes a measured 0% rather than an
      // unmeasured blank — which is the failure this test guards against.
      expect(callers, `${fn} is still uncalled`).toEqual([]);
    }
  });

  it('says so on the page rather than showing a zero', () => {
    const src = readFileSync('src/routes/dashboard/roi.ts', 'utf8');
    expect(src).toMatch(/this is a\s*\n?\s*blank, not a zero/);
    expect(src).toMatch(/as an assumption rather than a measurement/);
    expect(stripComments(src, { lineComments: true }),
      'null must not format as $0').toMatch(/if \(v === null\) return 'not measured'/);
  });
});
