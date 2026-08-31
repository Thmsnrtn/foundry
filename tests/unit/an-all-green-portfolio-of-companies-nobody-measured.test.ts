process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  benchmarkProduct, getPortfolioOverview, generatePortfolioSnapshot,
} from '../../src/services/portfolio/manager.js';

// =============================================================================
// AN ALL-GREEN PORTFOLIO OF COMPANIES NOBODY MEASURED.
//
// Every number in the portfolio overview was a placeholder or the wrong
// quantity, and the whole of it is served to an investor through the portfolio
// API.
//
//   `risk_state ?? 'green'`  a company with no lifecycle state at all was
//                            counted GREEN. A portfolio of companies Foundry
//                            knows nothing about rendered as a healthy one.
//   `total_mrr`              summed `new_mrr_cents + expansion_mrr_cents` — one
//                            period's MOVEMENT, not the level. A company at
//                            $50k MRR with a flat month contributed nothing.
//   `growth: 0`              beside the comment "Would compute from historical
//                            data". Every company grew 0%.
//   `avg_growth_rate: 0`     the same, at portfolio level.
//   `median_mrr: 0`          in the weekly snapshot, beside "Would compute
//                            median".
//   `avg_mrr`                divided by every member, including the ones that
//                            have never reported anything.
//
// AND THE LOWEST CHURN IN THE PORTFOLIO WAS TOLD TO PRIORITISE RETENTION.
// `product_percentile` was the share of peers with a LOWER VALUE, and the
// recommendations read a low percentile as poor performance. For every metric
// where higher is better that is right. For `churn_rate` it is exactly
// backwards: the company with the least churn scored 0 and was told its churn
// was in the bottom quartile.
//
// A metric the company had not reported was read as 0 — for churn the best
// possible value, for NPS among the worst. The same silence scored as excellent
// or dreadful depending on the column.
// =============================================================================

const SRC = stripComments(
  readFileSync('src/services/portfolio/manager.ts', 'utf8'), { lineComments: true });

const PORTFOLIO = 'pf_1';

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => {
  await query('DELETE FROM portfolio_snapshots');
  await query('DELETE FROM portfolio_memberships');
  await query('DELETE FROM metric_snapshots');
  await query('DELETE FROM lifecycle_state');
  await query('DELETE FROM products');
  await query('DELETE FROM founders');
  await query('DELETE FROM portfolios');
  await query(
    `INSERT INTO portfolios (id, name, organization_type, owner_email, api_key) VALUES (?, 'Fund', 'vc', 'gp@example.com', 'k_test')`,
    [PORTFOLIO]);
});

async function member(o: {
  name: string; risk?: 'green' | 'yellow' | 'red' | null; mrrCents?: number | null;
  churn?: number | null; nps?: number | null;
}): Promise<string> {
  const founderId = `f_${nanoid(6)}`;
  const productId = `p_${nanoid(6)}`;
  await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)',
    [founderId, `c_${founderId}`, `${founderId}@example.com`]);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,?,?,'active')",
    [productId, o.name, founderId]);
  await query(
    `INSERT INTO portfolio_memberships (id, portfolio_id, product_id, founder_id, status)
     VALUES (?,?,?,?,'active')`, [nanoid(), PORTFOLIO, productId, founderId]);
  if (o.risk != null) {
    await query('INSERT INTO lifecycle_state (product_id, risk_state) VALUES (?,?)',
      [productId, o.risk]);
  }
  if (o.mrrCents !== undefined || o.churn !== undefined || o.nps !== undefined) {
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, mrr_cents, churn_rate, nps_score)
       VALUES (?, ?, date('now'), ?, ?, ?)`,
      [nanoid(), productId, o.mrrCents ?? null, o.churn ?? null, o.nps ?? null]);
  }
  return productId;
}

describe('a company with no state is not a green company', () => {
  it('counts the unmeasured separately', async () => {
    await member({ name: 'Known Good', risk: 'green' });
    await member({ name: 'Silent One' });
    await member({ name: 'Silent Two' });

    const o = await getPortfolioOverview(PORTFOLIO);
    expect(o.by_risk_state.green, 'two of these were counted green').toBe(1);
    expect(o.risk_state_unknown).toBe(2);
    expect(o.total_companies).toBe(3);
  });

  it('names them as concerns, since quiet is a thing an investor must see', async () => {
    await member({ name: 'Silent One' });
    const o = await getPortfolioOverview(PORTFOLIO);
    expect(o.concerns.map((c) => c.issue)).toContain('No lifecycle state recorded');
  });
});

describe('MRR is the level, not one period of movement', () => {
  it('reads mrr_cents', async () => {
    await member({ name: 'Flat but large', mrrCents: 5_000_000 });
    const o = await getPortfolioOverview(PORTFOLIO);
    expect(o.total_mrr, 'a flat month used to contribute nothing').toBe(50_000);
    expect(o.companies_reporting_mrr).toBe(1);
  });

  it('never adds new MRR to expansion MRR', () => {
    expect(SRC).not.toMatch(/new_mrr_cents/);
    expect(SRC).not.toMatch(/expansion_mrr_cents/);
  });

  it('reports null when nobody reported, not zero', async () => {
    await member({ name: 'Silent' });
    const o = await getPortfolioOverview(PORTFOLIO);
    expect(o.total_mrr).toBeNull();
    expect(o.median_mrr).toBeNull();
    expect(o.companies_reporting_mrr).toBe(0);
  });

  it('takes a real median', async () => {
    await member({ name: 'A', mrrCents: 100_00 });
    await member({ name: 'B', mrrCents: 300_00 });
    await member({ name: 'C', mrrCents: 900_00 });
    const o = await getPortfolioOverview(PORTFOLIO);
    expect(o.median_mrr).toBe(300);
  });
});

describe('growth is not zero, it is unknown', () => {
  it('says so', async () => {
    await member({ name: 'A', mrrCents: 100_00, risk: 'green' });
    const o = await getPortfolioOverview(PORTFOLIO);
    expect(o.avg_growth_rate).toBeNull();
    expect(o.top_performers[0]!.growth,
      'every company used to have grown exactly 0%').toBeNull();
  });
});

describe('the snapshot records what it computed', () => {
  it('a real median and an average over the companies that reported', async () => {
    await member({ name: 'A', mrrCents: 100_00 });
    await member({ name: 'B', mrrCents: 300_00 });
    await member({ name: 'Silent' });

    await generatePortfolioSnapshot(PORTFOLIO);
    const row = (await query('SELECT * FROM portfolio_snapshots')).rows[0] as Record<string, unknown>;
    expect(Number(row.median_mrr), 'this was the literal 0').toBe(200);
    expect(Number(row.avg_mrr),
      'the average used to divide by the silent companies too').toBe(200);
    expect(Number(row.total_companies)).toBe(3);
  });
});

describe('the lowest churn is not the worst churn', () => {
  it('does not tell the best performer to prioritise retention', async () => {
    const best = await member({ name: 'Best', churn: 0.01 });
    await member({ name: 'Middle', churn: 0.05 });
    await member({ name: 'Worst', churn: 0.20 });

    const r = await benchmarkProduct(PORTFOLIO, best);
    expect(r.performance_percentile['churn_rate'],
      'least churn in the portfolio, so it beats everyone').toBeGreaterThan(50);
    expect(r.recommendations.join(' ')).not.toMatch(/Prioritize retention/);
  });

  it('does tell the worst performer', async () => {
    await member({ name: 'Best', churn: 0.01 });
    await member({ name: 'Middle', churn: 0.05 });
    const worst = await member({ name: 'Worst', churn: 0.20 });

    const r = await benchmarkProduct(PORTFOLIO, worst);
    expect(r.performance_percentile['churn_rate']).toBeLessThan(25);
    expect(r.recommendations.join(' ')).toMatch(/Prioritize retention/);
  });

  it('keeps higher-is-better metrics the right way up', async () => {
    const top = await member({ name: 'Top', nps: 70 });
    await member({ name: 'Mid', nps: 30 });
    await member({ name: 'Low', nps: 5 });

    const r = await benchmarkProduct(PORTFOLIO, top);
    expect(r.performance_percentile['nps_score']).toBeGreaterThan(50);
  });
});

describe('a metric nobody reported is not scored', () => {
  it('names it as not comparable rather than reading it as zero', async () => {
    const p = await member({ name: 'Partial', churn: 0.05 });
    await member({ name: 'Peer', churn: 0.10, nps: 40 });

    const r = await benchmarkProduct(PORTFOLIO, p);
    expect(r.performance_percentile['nps_score'],
      'zero NPS is among the worst scores there is').toBeUndefined();
    expect(r.not_comparable.map((n) => n.metric)).toContain('nps_score');
  });

  it('and recommends nothing from a percentile that does not exist', async () => {
    const p = await member({ name: 'Partial', nps: 40 });
    await member({ name: 'Peer', nps: 50 });
    const r = await benchmarkProduct(PORTFOLIO, p);
    expect(r.recommendations).toEqual([]);
    expect(r.not_comparable.map((n) => n.metric)).toContain('churn_rate');
  });
});

describe('the halves with nothing at the other end are gone', () => {
  it('portfolio_alerts', async () => {
    expect((await query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='portfolio_alerts'")).rows.length).toBe(0);
    expect(SRC).not.toMatch(/createPortfolioAlert/);
  });

  it('expansion_analysis, and the zero that was typed into it', async () => {
    expect((await query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='expansion_analysis'")).rows.length).toBe(0);
    const exp = stripComments(
      readFileSync('src/services/intelligence/expansion.ts', 'utf8'), { lineComments: true });
    expect(exp).not.toMatch(/INSERT INTO expansion_analysis/);
    expect(exp).not.toMatch(/tam_penetration_rate/);
  });
});
