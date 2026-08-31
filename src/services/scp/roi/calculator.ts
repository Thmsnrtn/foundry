// =============================================================================
// FOUNDRY — ROI Calculator
// Computes monthly ROI summaries from recommendation outcomes.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';
import { getProductDNA } from '../../wisdom/dna.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * WHAT FOUNDRY IS WORTH TO A COMPANY, AND WHETHER ANYBODY MEASURED IT.
 *
 * `/roi` is a mounted, authenticated page headlined "Value Delivered This
 * Month". It reported **$0** and an action rate of **0%** for every company,
 * always, because `recommendation_outcomes` has no writer:
 * `recordRecommendation` and `markActedOn` are exported from
 * `roi/outcome-tracker.ts` and called from nowhere.
 *
 * A founder reading that concludes Foundry delivered nothing. That is a claim
 * about Foundry's own performance drawn from an absent measurement path, and it
 * is the commercially sharpest version of this defect in the repository — a
 * product telling its customer it was worthless, on no evidence.
 *
 * NOT HALF-WIRED. The obvious move is to call `recordRecommendation` from every
 * agent run, and it would be worse than doing nothing: recommendations would
 * accumulate while `markActedOn` still had no caller, turning an UNMEASURED
 * action rate into a MEASURED 0%. A loop that records its denominator and never
 * its numerator produces a confident wrong answer, which is harder to notice
 * than an honest blank. Wiring the other half needs a real answer to "what
 * counts as acting on a recommendation", and that is recorded as the next step
 * rather than guessed at here.
 */
export interface MonthlyROI {
  month: string;
  churn_prevented_dollars: number;
  expansion_captured_dollars: number;
  cost_avoided_dollars: number;
  /** SEPARATE FROM MEASURED DOLLARS, and never added to them. This is
   *  `acted_on x 2 hours x $200` — two invented coefficients — and it used to
   *  be summed into `total_value_dollars` beside real outcome values, so an
   *  assumption and a measurement arrived as one number. */
  time_saved_dollars: number;
  /** Measured value only: churn prevented + expansion captured + cost avoided.
   *  NULL when no recommendation has ever been recorded — nothing was valued,
   *  which is not the same as nothing being worth anything. */
  total_value_dollars: number | null;
  recommendations_made: number;
  /** NULL until a recommendation exists to act on. */
  action_rate_pct: number | null;
  /** NULL until an outcome has been measured either way. */
  outcome_rate_pct: number | null;
  platform_cost_dollars: number | null;
  roi_multiple: number | null;
  /** Why the numbers above are missing, when they are. */
  measurement: 'measured' | 'no_recommendations_recorded';
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

  // MEASURED VALUE ONLY. `timeSavedDollars` is an assumption and is reported
  // beside this rather than inside it.
  const anyRecorded = recommendationsMade > 0;
  const totalValue = anyRecorded ? churnPrevented + expansionCaptured + costAvoided : null;
  const actionRatePct = anyRecorded ? (recommendationsActedOn / recommendationsMade) * 100 : null;
  const measuredOutcomes = positiveOutcomes + negativeOutcomes;
  const outcomeRatePct = measuredOutcomes > 0 ? (positiveOutcomes / measuredOutcomes) * 100 : null;

  // Look up platform cost from roi_monthly_summaries (if previously set by billing)
  const existingResult = await query(
    `SELECT platform_cost_dollars FROM roi_monthly_summaries WHERE product_id = ? AND month = ?`,
    [productId, month],
  );
  const existingRow = (existingResult.rows[0] as Record<string, unknown> | undefined);
  const platformCost = (existingRow?.platform_cost_dollars as number | null) ?? null;
  const roiMultiple = platformCost && platformCost > 0 && totalValue !== null
    ? totalValue / platformCost : null;

  // Upsert into roi_monthly_summaries.
  //
  // THE CACHE STORES ZEROS; THE READER DECIDES WHAT THEY MEAN. Those columns
  // are NOT NULL DEFAULT 0 and the table already carries
  // `recommendations_made`, which is exactly the discriminator between "we
  // measured nothing" and "we measured nothing worth anything". So the null is
  // not persisted — it is re-derived on read, in one place, by both the live
  // path and the cached path. Changing the schema to hold the null would put
  // the same distinction in two places and let them disagree.
  const zero = (v: number | null) => v ?? 0;
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
      timeSavedHours, timeSavedDollars, zero(totalValue),
      recommendationsMade, recommendationsActedOn, zero(actionRatePct),
      positiveOutcomes, negativeOutcomes, zero(outcomeRatePct),
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
    measurement: anyRecorded ? 'measured' : 'no_recommendations_recorded',
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
  /** NULL when no month recorded a recommendation. */
  all_time_value: number | null;
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
        // A cached month with no recommendations is the same blank as a live
        // one: the row exists because the summary was computed, not because
        // anything was measured.
        total_value_dollars: ((r.recommendations_made as number) ?? 0) > 0
          ? ((r.total_value_dollars as number) ?? 0) : null,
        recommendations_made: (r.recommendations_made as number) ?? 0,
        action_rate_pct: ((r.recommendations_made as number) ?? 0) > 0
          ? ((r.action_rate_pct as number) ?? 0) : null,
        outcome_rate_pct: (r.outcome_rate_pct as number | null) ?? null,
        measurement: ((r.recommendations_made as number) ?? 0) > 0
          ? 'measured' : 'no_recommendations_recorded',
        platform_cost_dollars: (r.platform_cost_dollars as number | null) ?? null,
        roi_multiple: (r.roi_multiple as number | null) ?? null,
      });
    } else {
      const computed = await computeMonthlyROI(productId, m);
      trailing.push(computed);
    }
  }

  // All-time value from summaries — over the months that actually recorded a
  // recommendation. Summing every month gives 0 across a row of blanks and
  // prints it as an all-time figure.
  const allTimeResult = await query(
    `SELECT COALESCE(SUM(total_value_dollars), 0) AS total,
            COALESCE(SUM(platform_cost_dollars), 0) AS cost,
            COALESCE(SUM(recommendations_made), 0) AS recs
     FROM roi_monthly_summaries
     WHERE product_id = ?`,
    [productId],
  );
  const allTimeRow = (allTimeResult.rows[0] as Record<string, number>) ?? {};
  const allTimeValue = (allTimeRow.recs ?? 0) > 0 ? (allTimeRow.total ?? 0) : null;
  const allTimeCost = allTimeRow.cost ?? 0;
  const allTimeRoiMultiple = allTimeCost > 0 && allTimeValue !== null
    ? allTimeValue / allTimeCost : null;

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
  const value = current.total_value_dollars;
  if (value !== null && value > 0 && current.roi_multiple) {
    headline = `Foundry has delivered ${fmtDollars(value)} in value this month — ${current.roi_multiple.toFixed(1)}× your investment`;
  } else if (value !== null && value > 0) {
    headline = `Foundry has delivered ${fmtDollars(value)} in value this month`;
  } else if (value !== null) {
    headline = 'No recommendation has produced a measured outcome this month';
  } else {
    // "Foundry is tracking recommendations" was not true: nothing writes
    // `recommendation_outcomes`, so nothing is being tracked and the sentence
    // promised a measurement that was not coming.
    headline = 'Outcome capture is not wired up, so there is nothing to value yet';
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
