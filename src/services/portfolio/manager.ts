// =============================================================================
// FOUNDRY — Portfolio Mode (White-Label)
// Multi-org portfolios, benchmarking, investor dashboards, white-label config.
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
import type { RiskStateValue } from '../../types/index.js';

export interface PortfolioOverview {
  total_companies: number;
  by_risk_state: Record<RiskStateValue, number>;
  total_mrr: number;
  avg_growth_rate: number;
  top_performers: Array<{ name: string; mrr: number; growth: number }>;
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
): Promise<{ id: string; api_key: string }> {
  const id = nanoid();
  const apiKey = `pfk_${nanoid(32)}`;

  await query(
    `INSERT INTO portfolios (id, name, organization_type, owner_email, branding, api_key)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, name, orgType, ownerEmail, branding ? JSON.stringify(branding) : null, apiKey]
  );

  return { id, api_key: apiKey };
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
            ms.new_mrr_cents, ms.expansion_mrr_cents, ms.active_users, ms.churn_rate
     FROM portfolio_memberships pm
     JOIN products p ON pm.product_id = p.id
     LEFT JOIN lifecycle_state ls ON p.id = ls.product_id
     LEFT JOIN (
       SELECT product_id, new_mrr_cents, expansion_mrr_cents, active_users, churn_rate
       FROM metric_snapshots ms1
       WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM metric_snapshots ms2 WHERE ms2.product_id = ms1.product_id)
     ) ms ON p.id = ms.product_id
     WHERE pm.portfolio_id = ? AND pm.status = 'active'`,
    [portfolioId]
  );

  const riskCounts: Record<RiskStateValue, number> = { green: 0, yellow: 0, red: 0 };
  let totalMRR = 0;
  const companies: Array<{ name: string; mrr: number; growth: number; risk: string; issue?: string }> = [];

  for (const row of members.rows as unknown as Array<Record<string, unknown>>) {
    const risk = (row.risk_state as RiskStateValue) ?? 'green';
    riskCounts[risk]++;

    const mrr = (((row.new_mrr_cents as number) ?? 0) + ((row.expansion_mrr_cents as number) ?? 0)) / 100;
    totalMRR += mrr;

    companies.push({
      name: row.name as string,
      mrr,
      growth: 0, // Would compute from historical data
      risk,
      issue: risk !== 'green' ? `Risk state: ${risk}` : undefined,
    });
  }

  const topPerformers = companies
    .sort((a, b) => b.mrr - a.mrr)
    .slice(0, 5)
    .map((c) => ({ name: c.name, mrr: c.mrr, growth: c.growth }));

  const concerns = companies
    .filter((c) => c.risk !== 'green')
    .map((c) => ({ name: c.name, issue: c.issue ?? 'Unknown' }));

  return {
    total_companies: members.rows.length,
    by_risk_state: riskCounts,
    total_mrr: Math.round(totalMRR),
    avg_growth_rate: 0,
    top_performers: topPerformers,
    concerns,
  };
}

/**
 * Generate cross-portfolio benchmarks.
 */
export async function benchmarkProduct(
  portfolioId: string,
  productId: string
): Promise<{
  product_percentile: Record<string, number>;
  portfolio_median: Record<string, number>;
  recommendations: string[];
}> {
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
  if (!pm) return { product_percentile: {}, portfolio_median: {}, recommendations: [] };

  const metricKeys = ['active_users', 'churn_rate', 'activation_rate', 'nps_score'];
  const productPercentile: Record<string, number> = {};
  const portfolioMedian: Record<string, number> = {};

  for (const key of metricKeys) {
    const allValues = (allMetrics.rows as unknown as Array<Record<string, number>>)
      .map((r) => r[key])
      .filter((v) => v !== null && v !== undefined)
      .sort((a, b) => a - b);

    if (allValues.length === 0) continue;

    const median = allValues[Math.floor(allValues.length / 2)]!;
    portfolioMedian[key] = median;

    const productValue = pm[key] ?? 0;
    const below = allValues.filter((v) => v < productValue).length;
    productPercentile[key] = Math.round((below / allValues.length) * 100);
  }

  const recommendations: string[] = [];
  if ((productPercentile['churn_rate'] ?? 50) < 25) {
    recommendations.push('Churn rate is in the bottom quartile of the portfolio. Prioritize retention.');
  }
  if ((productPercentile['activation_rate'] ?? 50) < 25) {
    recommendations.push('Activation rate below portfolio peers. Review onboarding.');
  }

  return { product_percentile: productPercentile, portfolio_median: portfolioMedian, recommendations };
}

/**
 * Generate a portfolio snapshot (for weekly portfolio reports).
 */
export async function generatePortfolioSnapshot(portfolioId: string): Promise<void> {
  const overview = await getPortfolioOverview(portfolioId);
  const today = new Date().toISOString().split('T')[0]!;

  await query(
    `INSERT INTO portfolio_snapshots (id, portfolio_id, snapshot_date, total_companies, avg_mrr, median_mrr, companies_green, companies_yellow, companies_red, total_portfolio_mrr, highlights, concerns)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(), portfolioId, today,
      overview.total_companies,
      overview.total_companies > 0 ? overview.total_mrr / overview.total_companies : 0,
      0, // Would compute median
      overview.by_risk_state.green,
      overview.by_risk_state.yellow,
      overview.by_risk_state.red,
      overview.total_mrr,
      JSON.stringify(overview.top_performers.map((p) => p.name)),
      JSON.stringify(overview.concerns.map((c) => `${c.name}: ${c.issue}`)),
    ]
  );
}

/**
 * Create an investor alert for a portfolio.
 */
export async function createPortfolioAlert(
  portfolioId: string,
  productId: string,
  alertType: string,
  severity: 'info' | 'warning' | 'critical',
  message: string
): Promise<void> {
  await query(
    `INSERT INTO portfolio_alerts (id, portfolio_id, product_id, alert_type, severity, message)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [nanoid(), portfolioId, productId, alertType, severity, message]
  );
}

/**
 * Authenticate a portfolio API request.
 */
export async function authenticatePortfolioKey(apiKey: string): Promise<string | null> {
  const result = await query('SELECT id FROM portfolios WHERE api_key = ?', [apiKey]);
  return (result.rows[0] as Record<string, string> | undefined)?.id ?? null;
}
