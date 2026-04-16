// =============================================================================
// FOUNDRY — ROI Calculator
// Computes monthly ROI summaries from recommendation outcomes.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';
import { getProductDNA } from '../../wisdom/dna.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MonthlyROI {
  month: string;
  churn_prevented_dollars: number;
  expansion_captured_dollars: number;
  cost_avoided_dollars: number;
  time_saved_dollars: number;
  total_value_dollars: number;
  recommendations_made: number;
  action_rate_pct: number;
  outcome_rate_pct: number;
  platform_cost_dollars: number | null;
  roi_multiple: number | null;
}

const DEFAULT_HOURLY_RATE = 200;
const HOURS_SAVED_PER_ACTION = 2;

// ─── Compute Monthly ROI ──────────────────────────────────────────────────────

/**
 * Aggregates recommendation_outcomes for the month.
 * Estimates time saved: each acted-on recommendation = 2 hours saved.
 * Uses founder_hourly_rate from product DNA if available, else $200/hour default.
 * Upserts into roi_monthly_summaries.
 */
export async function computeMonthlyROI(productId: string, month: string): Promise<MonthlyROI> {
  // Fetch DNA for optional hourly rate
  const dna = await getProductDNA(productId);
  // ProductDNA doesn't expose hourly rate — use default
  const hourlyRate = DEFAULT_HOURLY_RATE;

  // Aggregate recommendation outcomes for the month
  const aggResult = await query(
    `SELECT
       COALESCE(SUM(CASE WHEN category = 'churn_prevented' AND outcome = 'positive' THEN COALESCE(estimated_value_dollars, 0) ELSE 0 END), 0)        AS churn_prevented_dollars,
       COALESCE(SUM(CASE WHEN category = 'expansion_captured' AND outcome = 'positive' THEN COALESCE(estimated_value_dollars, 0) ELSE 0 END), 0)     AS expansion_captured_dollars,
       COALESCE(SUM(CASE WHEN category IN ('cost_avoided','risk_mitigated') AND outcome = 'positive' THEN COALESCE(estimated_value_dollars, 0) ELSE 0 END), 0) AS cost_avoided_dollars,
       COUNT(*) AS recommendations_made,
       COALESCE(SUM(action_taken), 0) AS recommendations_acted_on,
       COALESCE(SUM(CASE WHEN outcome = 'positive' THEN 1 ELSE 0 END), 0) AS positive_outcomes,
       COALESCE(SUM(CASE WHEN outcome = 'negative' THEN 1 ELSE 0 END), 0) AS negative_outcomes
     FROM recommendation_outcomes
     WHERE product_id = ?
       AND strftime('%Y-%m', recommendation_date) = ?`,
    [productId, month],
  );

  const agg = (aggResult.rows[0] ?? {}) as Record<string, number>;
  const churnPrevented = agg.churn_prevented_dollars ?? 0;
  const expansionCaptured = agg.expansion_captured_dollars ?? 0;
  const costAvoided = agg.cost_avoided_dollars ?? 0;
  const recommendationsMade = agg.recommendations_made ?? 0;
  const recommendationsActedOn = agg.recommendations_acted_on ?? 0;
  const positiveOutcomes = agg.positive_outcomes ?? 0;
  const negativeOutcomes = agg.negative_outcomes ?? 0;

  // Time saved estimate
  const timeSavedHours = recommendationsActedOn * HOURS_SAVED_PER_ACTION;
  const timeSavedDollars = timeSavedHours * hourlyRate;

  // Totals and rates
  const totalValue = churnPrevented + expansionCaptured + costAvoided + timeSavedDollars;
  const actionRatePct = recommendationsMade > 0 ? (recommendationsActedOn / recommendationsMade) * 100 : 0;
  const measuredOutcomes = positiveOutcomes + negativeOutcomes;
  const outcomeRatePct = measuredOutcomes > 0 ? (positiveOutcomes / measuredOutcomes) * 100 : 0;

  // Look up platform cost from roi_monthly_summaries (if previously set by billing)
  const existingResult = await query(
    `SELECT platform_cost_dollars FROM roi_monthly_summaries WHERE product_id = ? AND month = ?`,
    [productId, month],
  );
  const existingRow = (existingResult.rows[0] as Record<string, unknown> | undefined);
  const platformCost = (existingRow?.platform_cost_dollars as number | null) ?? null;
  const roiMultiple = platformCost && platformCost > 0 ? totalValue / platformCost : null;

  // Upsert into roi_monthly_summaries
  const existingId = (existingRow as Record<string, unknown> | undefined);
  const summaryId = nanoid();
  await query(
    `INSERT INTO roi_monthly_summaries
      (id, product_id, month,
       churn_prevented_dollars, expansion_captured_dollars, cost_avoided_dollars,
       time_saved_hours, time_saved_dollars, total_value_dollars,
       recommendations_made, recommendations_acted_on, action_rate_pct,
       positive_outcomes, negative_outcomes, outcome_rate_pct,
       platform_cost_dollars, roi_multiple, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(product_id, month) DO UPDATE SET
       churn_prevented_dollars = excluded.churn_prevented_dollars,
       expansion_captured_dollars = excluded.expansion_captured_dollars,
       cost_avoided_dollars = excluded.cost_avoided_dollars,
       time_saved_hours = excluded.time_saved_hours,
       time_saved_dollars = excluded.time_saved_dollars,
       total_value_dollars = excluded.total_value_dollars,
       recommendations_made = excluded.recommendations_made,
       recommendations_acted_on = excluded.recommendations_acted_on,
       action_rate_pct = excluded.action_rate_pct,
       positive_outcomes = excluded.positive_outcomes,
       negative_outcomes = excluded.negative_outcomes,
       outcome_rate_pct = excluded.outcome_rate_pct,
       roi_multiple = excluded.roi_multiple,
       computed_at = excluded.computed_at`,
    [
      summaryId, productId, month,
      churnPrevented, expansionCaptured, costAvoided,
      timeSavedHours, timeSavedDollars, totalValue,
      recommendationsMade, recommendationsActedOn, actionRatePct,
      positiveOutcomes, negativeOutcomes, outcomeRatePct,
      platformCost, roiMultiple,
    ],
  );

  return {
    month,
    churn_prevented_dollars: churnPrevented,
    expansion_captured_dollars: expansionCaptured,
    cost_avoided_dollars: costAvoided,
    time_saved_dollars: timeSavedDollars,
    total_value_dollars: totalValue,
    recommendations_made: recommendationsMade,
    action_rate_pct: actionRatePct,
    outcome_rate_pct: outcomeRatePct,
    platform_cost_dollars: platformCost,
    roi_multiple: roiMultiple,
  };
}

// ─── ROI Summary ──────────────────────────────────────────────────────────────

/**
 * Returns current month ROI, trailing 3 months, all-time value, and headline.
 */
export async function getROISummary(
  productId: string,
  _months?: number,
): Promise<{
  current_month: MonthlyROI;
  trailing_3_months: MonthlyROI[];
  all_time_value: number;
  all_time_roi_multiple: number | null;
  top_performing_agent: string;
  headline: string;
}> {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Build list of months: current + last 3
  const months: string[] = [];
  for (let i = 0; i < 4; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  // Compute current month (live)
  const current = await computeMonthlyROI(productId, currentMonth);

  // Fetch trailing 3 from summaries cache (or compute if missing)
  const trailing: MonthlyROI[] = [];
  for (let i = 1; i <= 3; i++) {
    const m = months[i];
    const cached = await query(
      `SELECT * FROM roi_monthly_summaries WHERE product_id = ? AND month = ?`,
      [productId, m],
    );
    if (cached.rows.length > 0) {
      const r = cached.rows[0] as Record<string, unknown>;
      trailing.push({
        month: r.month as string,
        churn_prevented_dollars: (r.churn_prevented_dollars as number) ?? 0,
        expansion_captured_dollars: (r.expansion_captured_dollars as number) ?? 0,
        cost_avoided_dollars: (r.cost_avoided_dollars as number) ?? 0,
        time_saved_dollars: (r.time_saved_dollars as number) ?? 0,
        total_value_dollars: (r.total_value_dollars as number) ?? 0,
        recommendations_made: (r.recommendations_made as number) ?? 0,
        action_rate_pct: (r.action_rate_pct as number) ?? 0,
        outcome_rate_pct: (r.outcome_rate_pct as number) ?? 0,
        platform_cost_dollars: (r.platform_cost_dollars as number | null) ?? null,
        roi_multiple: (r.roi_multiple as number | null) ?? null,
      });
    } else {
      const computed = await computeMonthlyROI(productId, m);
      trailing.push(computed);
    }
  }

  // All-time value from summaries
  const allTimeResult = await query(
    `SELECT COALESCE(SUM(total_value_dollars), 0) AS total,
            COALESCE(SUM(platform_cost_dollars), 0) AS cost
     FROM roi_monthly_summaries
     WHERE product_id = ?`,
    [productId],
  );
  const allTimeRow = (allTimeResult.rows[0] as Record<string, number>) ?? {};
  const allTimeValue = allTimeRow.total ?? 0;
  const allTimeCost = allTimeRow.cost ?? 0;
  const allTimeRoiMultiple = allTimeCost > 0 ? allTimeValue / allTimeCost : null;

  // Top performing agent (most positive-outcome value)
  const agentResult = await query(
    `SELECT agent_name, COALESCE(SUM(estimated_value_dollars), 0) AS total_value
     FROM recommendation_outcomes
     WHERE product_id = ? AND outcome = 'positive'
     GROUP BY agent_name
     ORDER BY total_value DESC
     LIMIT 1`,
    [productId],
  );
  const topAgent = agentResult.rows.length > 0
    ? ((agentResult.rows[0] as Record<string, unknown>).agent_name as string)
    : 'No data yet';

  // Build headline
  const fmtDollars = (v: number) =>
    v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`;
  let headline: string;
  if (current.total_value_dollars > 0 && current.roi_multiple) {
    headline = `Foundry has delivered ${fmtDollars(current.total_value_dollars)} in value this month — ${current.roi_multiple.toFixed(1)}× your investment`;
  } else if (current.total_value_dollars > 0) {
    headline = `Foundry has delivered ${fmtDollars(current.total_value_dollars)} in value this month`;
  } else {
    headline = 'Foundry is tracking recommendations — value will appear as outcomes are measured';
  }

  return {
    current_month: current,
    trailing_3_months: trailing,
    all_time_value: allTimeValue,
    all_time_roi_multiple: allTimeRoiMultiple,
    top_performing_agent: topAgent,
    headline,
  };
}

// ─── ROI Breakdown ────────────────────────────────────────────────────────────

/**
 * Returns by-category, by-agent, and top recommendation breakdowns for a month.
 */
export async function getROIBreakdown(
  productId: string,
  month: string,
): Promise<{
  by_category: Array<{ category: string; value: number; count: number }>;
  by_agent: Array<{ agent: string; value: number; action_rate: number }>;
  top_recommendations: Array<{ text: string; value: number; outcome: string }>;
}> {
  const [categoryResult, agentResult, topResult] = await Promise.all([
    query(
      `SELECT category,
              COALESCE(SUM(CASE WHEN outcome = 'positive' THEN COALESCE(estimated_value_dollars, 0) ELSE 0 END), 0) AS value,
              COUNT(*) AS count
       FROM recommendation_outcomes
       WHERE product_id = ?
         AND strftime('%Y-%m', recommendation_date) = ?
       GROUP BY category
       ORDER BY value DESC`,
      [productId, month],
    ),
    query(
      `SELECT agent_name,
              COALESCE(SUM(CASE WHEN outcome = 'positive' THEN COALESCE(estimated_value_dollars, 0) ELSE 0 END), 0) AS value,
              COUNT(*) AS total,
              COALESCE(SUM(action_taken), 0) AS acted
       FROM recommendation_outcomes
       WHERE product_id = ?
         AND strftime('%Y-%m', recommendation_date) = ?
       GROUP BY agent_name
       ORDER BY value DESC`,
      [productId, month],
    ),
    query(
      `SELECT recommendation_text, COALESCE(estimated_value_dollars, 0) AS value, COALESCE(outcome, 'unknown') AS outcome
       FROM recommendation_outcomes
       WHERE product_id = ?
         AND strftime('%Y-%m', recommendation_date) = ?
         AND outcome = 'positive'
       ORDER BY estimated_value_dollars DESC
       LIMIT 5`,
      [productId, month],
    ),
  ]);

  const byCategory = categoryResult.rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      category: row.category as string,
      value: (row.value as number) ?? 0,
      count: (row.count as number) ?? 0,
    };
  });

  const byAgent = agentResult.rows.map((r) => {
    const row = r as Record<string, unknown>;
    const total = (row.total as number) ?? 0;
    const acted = (row.acted as number) ?? 0;
    return {
      agent: row.agent_name as string,
      value: (row.value as number) ?? 0,
      action_rate: total > 0 ? (acted / total) * 100 : 0,
    };
  });

  const topRecs = topResult.rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      text: row.recommendation_text as string,
      value: (row.value as number) ?? 0,
      outcome: row.outcome as string,
    };
  });

  return {
    by_category: byCategory,
    by_agent: byAgent,
    top_recommendations: topRecs,
  };
}
