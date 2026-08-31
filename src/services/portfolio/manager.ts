// =============================================================================
// FOUNDRY — Portfolio Mode (White-Label)
// Multi-org portfolios, benchmarking, investor dashboards, white-label config.
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
import type { RiskStateValue } from '../../types/index.js';

/**
 * AN ALL-GREEN PORTFOLIO OF COMPANIES NOBODY MEASURED.
 *
 * Every number in this shape used to be a placeholder or the wrong quantity,
 * and the whole of it is served to an investor through the portfolio API.
 *
 *   `risk_state ?? 'green'`  — a company with no lifecycle state at all was
 *                              counted GREEN. A portfolio of companies Foundry
 *                              knows nothing about rendered as a healthy one.
 *   `total_mrr`              — summed `new_mrr_cents + expansion_mrr_cents`,
 *                              which is one period's MOVEMENT, not the level. A
 *                              company at $50k MRR with a flat month
 *                              contributed nothing.
 *   `growth: 0`              — beside the comment "Would compute from
 *                              historical data". Every company grew 0%.
 *   `avg_growth_rate: 0`     — the same, at portfolio level.
 *
 * Unknown is now unknown: nulls where nothing was reported, and companies
 * without a risk state counted separately instead of folded into green.
 */
export interface PortfolioOverview {
  total_companies: number;
  /** Only companies that actually have a lifecycle state. */
  by_risk_state: Record<RiskStateValue, number>;
  /** Companies with no lifecycle state. These used to be counted as green. */
  risk_state_unknown: number;
  /** Sum of reported MRR levels, in whole currency units. Null when none reported. */
  total_mrr: number | null;
  /** Companies that reported an MRR level at all. */
  companies_reporting_mrr: number;
  /** Null: Foundry does not compute a portfolio growth rate. It never did. */
  avg_growth_rate: number | null;
  /** Median reported MRR level. Null when no company reported one. */
  median_mrr: number | null;
  top_performers: Array<{ name: string; mrr: number; growth: number | null }>;
  concerns: Array<{ name: string; issue: string }>;
}

/**
 * Create a new portfolio.
 */
export async function createPortfolio(
  name: string,
  orgType: 'vc' | 'accelerator' | 'incubator' | 'angel_group',
  ownerEmail: string,
  branding?: { logo_url?: string; primary_color?: string; name?: string }
): Promise<{ id: string }> {
  // NO `pfk_` KEY IS MINTED, BECAUSE NOTHING ACCEPTS ONE.
  //
  // RT02-10 raised this as plaintext storage: the key went into
  // `portfolios.api_key` in the clear and `authenticatePortfolioKey` compared
  // it in the clear, while the main API keys are SHA-256 hashed. Reading it
  // again found something the ticket did not: `authenticatePortfolioKey` had no
  // caller. It was imported by the routes file and never invoked.
  //
  // So this minted a credential, stored it as a plaintext secret, and RETURNED
  // it to the portfolio owner — who was handed an API key that opens nothing.
  // Hashing it would have reduced the blast radius of a database leak while
  // leaving the claim intact, and the claim is the worse half: an API key given
  // to a customer says a door exists.
  //
  // If portfolio-key authentication is wanted, it comes back whole — minted,
  // hashed, accepted by a documented route, and revocable — rather than as a
  // string that has been sitting in a UNIQUE column being called a key.
  const id = nanoid();

  await query(
    `INSERT INTO portfolios (id, name, organization_type, owner_email, branding)
     VALUES (?, ?, ?, ?, ?)`,
    [id, name, orgType, ownerEmail, branding ? JSON.stringify(branding) : null]
  );

  return { id };
}

/**
 * Add a company to a portfolio — if somebody at that company agreed.
 *
 * THE COMPANY WAS NEVER ASKED. The route checked that the caller owns the
 * PORTFOLIO and then took `product_id` straight from the request body. Anyone
 * with a portfolio could absorb any company by id, and portfolio membership is
 * not decorative: it puts that company's name, MRR, risk state, churn and
 * activation on somebody else's dashboard, and its metrics into a percentile
 * comparison against its peers.
 *
 * Owner authority is not sovereignty over a company that did not choose you.
 *
 * WHAT IS ALLOWED, and it covers the owner's own portfolio exactly: a portfolio
 * may hold a company whose owner is the same person as the portfolio's owner.
 * A portfolio of your own companies needs no permission from anybody but you.
 * Anything else needs the company's owner to have agreed, and there is no way
 * to record that agreement yet — so it is refused rather than assumed, and the
 * refusal says which of the two it was.
 */
export type PortfolioAddRefusal = 'company_unknown' | 'company_not_yours';

export async function addToPortfolio(
  portfolioId: string,
  productId: string,
  founderId: string,
  investmentData?: { fund_vintage?: string; investment_date?: string; investment_amount?: number; board_seat?: boolean }
): Promise<{ refused: PortfolioAddRefusal } | null> {
  const owned = (await query(
    `SELECT p.owner_id, f.email AS owner_email
       FROM products p JOIN founders f ON f.id = p.owner_id
      WHERE p.id = ?`, [productId],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!owned) return { refused: 'company_unknown' };

  const portfolio = (await query(
    'SELECT owner_email FROM portfolios WHERE id = ?', [portfolioId],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!portfolio) return { refused: 'company_unknown' };

  const sameOwner = String(owned.owner_email).toLowerCase()
    === String(portfolio.owner_email).toLowerCase();
  if (!sameOwner) return { refused: 'company_not_yours' };

  await query(
    `INSERT INTO portfolio_memberships (id, portfolio_id, product_id, founder_id, fund_vintage, investment_date, investment_amount, board_seat)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (portfolio_id, product_id) DO UPDATE SET
       fund_vintage = excluded.fund_vintage, investment_amount = excluded.investment_amount,
       board_seat = excluded.board_seat, status = 'active'`,
    [
      nanoid(), portfolioId, productId, founderId,
      investmentData?.fund_vintage ?? null,
      investmentData?.investment_date ?? null,
      investmentData?.investment_amount ?? null,
      investmentData?.board_seat ? 1 : 0,
    ]
  );
  return null;
}

/**
 * Remove a product from a portfolio.
 */
export async function removeFromPortfolio(portfolioId: string, productId: string): Promise<void> {
  await query(
    `UPDATE portfolio_memberships SET status = 'removed' WHERE portfolio_id = ? AND product_id = ?`,
    [portfolioId, productId]
  );
}

/**
 * Get portfolio overview with aggregated metrics.
 */
export async function getPortfolioOverview(portfolioId: string): Promise<PortfolioOverview> {
  const members = await query(
    `SELECT p.id, p.name, p.growth_stage, ls.risk_state,
            ms.mrr_cents, ms.active_users, ms.churn_rate
     FROM portfolio_memberships pm
     JOIN products p ON pm.product_id = p.id
     LEFT JOIN lifecycle_state ls ON p.id = ls.product_id
     LEFT JOIN (
       SELECT product_id, mrr_cents, active_users, churn_rate
       FROM metric_snapshots ms1
       WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM metric_snapshots ms2 WHERE ms2.product_id = ms1.product_id)
     ) ms ON p.id = ms.product_id
     WHERE pm.portfolio_id = ? AND pm.status = 'active'`,
    [portfolioId]
  );

  const riskCounts: Record<RiskStateValue, number> = { green: 0, yellow: 0, red: 0 };
  let riskUnknown = 0;
  const companies: Array<{
    name: string; mrr: number | null; risk: RiskStateValue | null; issue?: string;
  }> = [];

  for (const row of members.rows as unknown as Array<Record<string, unknown>>) {
    // No lifecycle state is not green. It is no state.
    const risk = row.risk_state == null ? null : row.risk_state as RiskStateValue;
    if (risk === null) riskUnknown++; else riskCounts[risk]++;

    // `mrr_cents` is the LEVEL. This used to add new MRR to expansion MRR —
    // both of which are one period's movement — and call the sum MRR.
    const mrr = row.mrr_cents == null ? null : Number(row.mrr_cents) / 100;

    companies.push({
      name: row.name as string,
      mrr,
      risk,
      issue: risk === null
        ? 'No lifecycle state recorded'
        : risk !== 'green' ? `Risk state: ${risk}` : undefined,
    });
  }

  const reported = companies
    .map((c) => c.mrr)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);

  const medianMrr = reported.length === 0
    ? null
    : reported.length % 2 === 1
      ? reported[(reported.length - 1) / 2]!
      : (reported[reported.length / 2 - 1]! + reported[reported.length / 2]!) / 2;

  const topPerformers = companies
    .filter((c): c is typeof c & { mrr: number } => c.mrr !== null)
    .sort((a, b) => b.mrr - a.mrr)
    .slice(0, 5)
    // Growth was the literal 0 for every company. Foundry does not compute a
    // per-company growth rate here, and null says so.
    .map((c) => ({ name: c.name, mrr: c.mrr, growth: null }));

  // A company with no state is a concern in its own right: an investor reading
  // this list needs to know which companies are quiet, not just which are red.
  const concerns = companies
    .filter((c) => c.risk !== 'green')
    .map((c) => ({ name: c.name, issue: c.issue ?? 'Unknown' }));

  return {
    total_companies: members.rows.length,
    by_risk_state: riskCounts,
    risk_state_unknown: riskUnknown,
    total_mrr: reported.length === 0 ? null : Math.round(reported.reduce((a, v) => a + v, 0)),
    companies_reporting_mrr: reported.length,
    avg_growth_rate: null,
    median_mrr: medianMrr,
    top_performers: topPerformers,
    concerns,
  };
}

/**
 * Generate cross-portfolio benchmarks.
 */
/**
 * THE LOWEST CHURN IN THE PORTFOLIO WAS TOLD TO PRIORITISE RETENTION.
 *
 * `product_percentile` was the share of peers with a LOWER VALUE, and the
 * recommendations read a low percentile as poor performance. For every metric
 * where higher is better that is right. For `churn_rate` it is exactly
 * backwards: the company with the least churn in the portfolio scored 0 and was
 * told to prioritise retention.
 *
 * The percentile is now a PERFORMANCE percentile — the share of peers this
 * company is doing better than — so "bottom quartile" means the same thing for
 * every metric. Each metric declares which direction is better, in one place,
 * instead of the direction living implicitly in whoever reads the number.
 *
 * And a metric the company has not reported is no longer scored. It used to be
 * read as 0, which for churn is the best possible value and for NPS among the
 * worst: the same silence scored as excellent or dreadful depending on the
 * column. Unscored metrics are named in `not_comparable` so a caller cannot
 * mistake an absent key for an average one.
 */
const BENCHMARK_METRICS: Array<{ key: string; higherIsBetter: boolean }> = [
  { key: 'active_users', higherIsBetter: true },
  { key: 'churn_rate', higherIsBetter: false },
  { key: 'activation_rate', higherIsBetter: true },
  { key: 'nps_score', higherIsBetter: true },
];

export async function benchmarkProduct(
  portfolioId: string,
  productId: string
): Promise<{
  /** Share of peers this company is doing BETTER than, 0-100. Direction-aware. */
  performance_percentile: Record<string, number>;
  portfolio_median: Record<string, number>;
  /** Metrics that could not be compared, and why. */
  not_comparable: Array<{ metric: string; reason: string }>;
  recommendations: string[];
} | null> {
  // RT02-05: THE PEER SET WAS SCOPED TO THE PORTFOLIO AND THE SUBJECT WAS NOT.
  //
  // `allMetrics` below joins `portfolio_memberships`, so the companies compared
  // AGAINST are always the portfolio's own. The company being compared was read
  // straight out of `metric_snapshots` by the id in the URL, and the route
  // checks only that the caller owns the PORTFOLIO. So any authenticated
  // founder could mint a portfolio — `POST /api/portfolios` is unrestricted —
  // and benchmark any product id in the system against it.
  //
  // The response does not echo the subject's raw numbers, which is why this
  // survived a reading: what it returns is a percentile. But the caller
  // controls both sides. Seed the portfolio with one product of your own, set
  // that product's metrics through `POST /api/products/:id/metrics` (an upsert
  // on (product_id, snapshot_date), so it can be rewritten all day), and the
  // percentile becomes a strict inequality against a threshold you choose —
  // a comparison oracle that recovers another company's exact `active_users`,
  // `churn_rate`, `activation_rate` and `nps_score` by bisection.
  //
  // RT02-06's fix does not close this: the attacker never needed the victim IN
  // the portfolio, only their own product as the yardstick.
  //
  // Scoped here rather than at the route, for the same reason `addToPortfolio`
  // was: a service that cannot be asked the unscoped question is safer than a
  // route that has to remember to ask the scoped one. NULL rather than the
  // "never reported a metric snapshot" branch below, because a company that is
  // not in this portfolio and a company that has reported nothing are different
  // facts, and that branch is a statement about the company.
  const member = await query(
    `SELECT 1 AS present FROM portfolio_memberships
      WHERE portfolio_id = ? AND product_id = ? AND status = 'active'`,
    [portfolioId, productId],
  );
  if (member.rows.length === 0) return null;

  const allMetrics = await query(
    `SELECT ms.* FROM metric_snapshots ms
     JOIN portfolio_memberships pm ON ms.product_id = pm.product_id
     WHERE pm.portfolio_id = ? AND pm.status = 'active'
     AND ms.snapshot_date = (SELECT MAX(snapshot_date) FROM metric_snapshots WHERE product_id = ms.product_id)`,
    [portfolioId]
  );

  const productMetrics = await query(
    'SELECT * FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1',
    [productId]
  );

  const pm = productMetrics.rows[0] as Record<string, number> | undefined;
  const notComparable: Array<{ metric: string; reason: string }> = [];
  if (!pm) {
    return {
      performance_percentile: {}, portfolio_median: {}, recommendations: [],
      not_comparable: BENCHMARK_METRICS.map((m) => ({
        metric: m.key, reason: 'this company has never reported a metric snapshot',
      })),
    };
  }

  const performancePercentile: Record<string, number> = {};
  const portfolioMedian: Record<string, number> = {};

  for (const { key, higherIsBetter } of BENCHMARK_METRICS) {
    const allValues = (allMetrics.rows as unknown as Array<Record<string, number>>)
      .map((r) => r[key])
      .filter((v): v is number => v !== null && v !== undefined)
      .sort((a, b) => a - b);

    if (allValues.length === 0) {
      notComparable.push({ metric: key, reason: 'no company in the portfolio has reported it' });
      continue;
    }

    portfolioMedian[key] = allValues[Math.floor(allValues.length / 2)]!;

    const productValue = pm[key];
    if (productValue === null || productValue === undefined) {
      notComparable.push({ metric: key, reason: 'this company has not reported it' });
      continue;
    }

    const beaten = higherIsBetter
      ? allValues.filter((v) => v < productValue).length
      : allValues.filter((v) => v > productValue).length;
    performancePercentile[key] = Math.round((beaten / allValues.length) * 100);
  }

  // Only recommend from a percentile that exists. A missing metric produces no
  // recommendation, which is different from a reassuring one.
  const recommendations: string[] = [];
  const churn = performancePercentile['churn_rate'];
  if (churn !== undefined && churn < 25) {
    recommendations.push('Churn rate is in the bottom quartile of the portfolio. Prioritize retention.');
  }
  const activation = performancePercentile['activation_rate'];
  if (activation !== undefined && activation < 25) {
    recommendations.push('Activation rate below portfolio peers. Review onboarding.');
  }

  return {
    performance_percentile: performancePercentile,
    portfolio_median: portfolioMedian,
    not_comparable: notComparable,
    recommendations,
  };
}

export interface PortfolioSnapshotRow {
  snapshot_date: string;
  total_companies: number;
  avg_mrr: number | null;
  median_mrr: number | null;
  companies_green: number;
  companies_yellow: number;
  companies_red: number;
  total_portfolio_mrr: number | null;
}

/**
 * The snapshots this portfolio has accumulated, newest first.
 *
 * A WEEKLY JOB HAD BEEN WRITING THESE SINCE THE TABLE EXISTED AND NOTHING READ
 * ONE. `POST /api/portfolios/:id/snapshot` generates a row and answers
 * `{"status":"generated"}`; there was no way to read one back, so the record
 * accumulated where only the erasure export could reach it. This is the read
 * half of a write that already exists — not a new capability — and it is
 * bounded: half a year of weekly rows, newest first, ordered by the date they
 * describe with `rowid` breaking a same-day tie.
 */
export async function getPortfolioSnapshots(
  portfolioId: string,
  limit = 26,
): Promise<PortfolioSnapshotRow[]> {
  const result = await query(
    `SELECT snapshot_date, total_companies, avg_mrr, median_mrr,
            companies_green, companies_yellow, companies_red, total_portfolio_mrr
       FROM portfolio_snapshots
      WHERE portfolio_id = ?
      ORDER BY snapshot_date DESC, rowid DESC
      LIMIT ?`,
    [portfolioId, Math.min(Math.max(1, limit), 104)],
  );
  return (result.rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    snapshot_date: String(r.snapshot_date),
    total_companies: Number(r.total_companies ?? 0),
    avg_mrr: r.avg_mrr == null ? null : Number(r.avg_mrr),
    median_mrr: r.median_mrr == null ? null : Number(r.median_mrr),
    companies_green: Number(r.companies_green ?? 0),
    companies_yellow: Number(r.companies_yellow ?? 0),
    companies_red: Number(r.companies_red ?? 0),
    total_portfolio_mrr: r.total_portfolio_mrr == null ? null : Number(r.total_portfolio_mrr),
  }));
}

/**
 * Generate a portfolio snapshot (for weekly portfolio reports).
 */
export async function generatePortfolioSnapshot(portfolioId: string): Promise<void> {
  const overview = await getPortfolioOverview(portfolioId);
  const today = new Date().toISOString().split('T')[0]!;

  // `median_mrr` was the literal 0, with the comment "Would compute median"
  // beside it — so every weekly snapshot recorded a portfolio whose median
  // company billed nothing. `getPortfolioOverview` computes it now, and returns
  // null rather than 0 when no company has reported an MRR level to take a
  // median of.
  //
  // `avg_mrr` divided by `total_companies` — every member, including the ones
  // that have never reported anything. An average of the reported figures over
  // a count that includes the silent ones is not an average of anything. It
  // divides by the companies that actually reported.
  await query(
    `INSERT INTO portfolio_snapshots (id, portfolio_id, snapshot_date, total_companies, avg_mrr, median_mrr, companies_green, companies_yellow, companies_red, total_portfolio_mrr, highlights, concerns)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(), portfolioId, today,
      overview.total_companies,
      overview.total_mrr !== null && overview.companies_reporting_mrr > 0
        ? overview.total_mrr / overview.companies_reporting_mrr
        : null,
      overview.median_mrr,
      overview.by_risk_state.green,
      overview.by_risk_state.yellow,
      overview.by_risk_state.red,
      overview.total_mrr,
      JSON.stringify(overview.top_performers.map((p) => p.name)),
      JSON.stringify(overview.concerns.map((c) => `${c.name}: ${c.issue}`)),
    ]
  );
}

// `createPortfolioAlert` was here. It inserted into `portfolio_alerts` —
// portfolio id, product id, alert type, severity, message, and an
// `acknowledged` flag.
//
// Nothing called it. No route, no job, no agent. And nothing read the table,
// or ever set or read `acknowledged`. Both halves of the feature were absent:
// no alert was ever raised, and there was nowhere for one to appear.
//
// Retired with the table in migration 189, on the owner decision recorded at
// migration 157 — anything genuinely wanted comes back as a whole feature,
// against a ledger that is actually populated. An investor alerting path also
// crosses portfolio isolation, which is an owner decision and not one to take
// by leaving a writer lying around.

// `authenticatePortfolioKey` is gone with the key it read. It compared a raw
// `pfk_` string against a plaintext column and had no caller anywhere — a guard
// on a value nothing writes, standing next to a credential nothing accepts.
