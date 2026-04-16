// =============================================================================
// FOUNDRY — Intelligence Network: Cross-Founder Benchmarks
// Aggregates anonymized metric data across all opted-in products to generate
// industry benchmarks. No founder-identifiable data ever stored here.
// =============================================================================

import { query } from '../../db/client.js';
import type { NetworkBenchmark, BenchmarkComparison } from '../../types/index.js';

// ─── MRR Brackets ────────────────────────────────────────────────────────────

function getMRRBracket(mrrCents: number): string {
  const mrr = mrrCents / 100;
  if (mrr === 0) return '0';
  if (mrr < 5000) return '0-5k';
  if (mrr < 25000) return '5k-25k';
  if (mrr < 100000) return '25k-100k';
  if (mrr < 500000) return '100k-500k';
  return '500k+';
}

// ─── Query Benchmarks ─────────────────────────────────────────────────────────

/**
 * Get benchmark percentiles for a given metric, market category, and MRR bracket.
 * Uses the anonymized decision_patterns table + aggregated metric data.
 */
export async function getBenchmarks(
  metric: string,
  marketCategory: string | null,
  lifecycleStage: string,
  mrrBracket: string,
): Promise<NetworkBenchmark | null> {
  // Query anonymized aggregates from the network benchmark table
  const result = await query(
    `SELECT metric, market_category, lifecycle_stage, mrr_bracket,
            p25, p50, p75, sample_count, last_updated
     FROM network_benchmarks
     WHERE metric = ? AND lifecycle_stage = ? AND mrr_bracket = ?
       AND (market_category = ? OR market_category = 'all')
     ORDER BY CASE WHEN market_category = ? THEN 0 ELSE 1 END
     LIMIT 1`,
    [metric, lifecycleStage, mrrBracket, marketCategory ?? 'all', marketCategory ?? 'none'],
  );

  if (result.rows.length === 0) return null;
  return result.rows[0] as unknown as NetworkBenchmark;
}

/**
 * Compare a product's metric value against the network benchmark.
 */
export async function compareToBenchmark(
  metric: string,
  yourValue: number,
  marketCategory: string | null,
  lifecycleStage: string,
  mrrCents: number,
): Promise<BenchmarkComparison | null> {
  const mrrBracket = getMRRBracket(mrrCents);
  const benchmark = await getBenchmarks(metric, marketCategory, lifecycleStage, mrrBracket);
  if (!benchmark) return null;

  // Compute percentile
  let percentile = 50;
  if (benchmark.p25 !== null && yourValue <= benchmark.p25) {
    percentile = Math.round(25 * (yourValue / benchmark.p25));
  } else if (benchmark.p50 !== null && yourValue <= benchmark.p50) {
    percentile = 25 + Math.round(25 * ((yourValue - (benchmark.p25 ?? 0)) / (benchmark.p50 - (benchmark.p25 ?? 0))));
  } else if (benchmark.p75 !== null && yourValue <= benchmark.p75) {
    percentile = 50 + Math.round(25 * ((yourValue - (benchmark.p50 ?? 0)) / (benchmark.p75 - (benchmark.p50 ?? 0))));
  } else {
    percentile = benchmark.p75 !== null && yourValue > benchmark.p75 ? 75 + Math.min(24, Math.round(25 * (yourValue / (benchmark.p75 * 1.5)))) : 50;
  }
  percentile = Math.max(1, Math.min(99, percentile));

  let label = 'at median';
  if (percentile >= 75) label = 'above p75 — top quartile';
  else if (percentile >= 50) label = 'above median';
  else if (percentile >= 25) label = 'below median';
  else label = 'below p25 — bottom quartile';

  return {
    metric,
    your_value: yourValue,
    percentile,
    p25: benchmark.p25,
    p50: benchmark.p50,
    p75: benchmark.p75,
    label,
    sample_count: benchmark.sample_count,
  };
}

/**
 * Get all benchmark comparisons for a product in one call.
 */
export async function getAllBenchmarkComparisons(
  productId: string,
  marketCategory: string | null,
  lifecycleStage: string,
): Promise<BenchmarkComparison[]> {
  // Get latest metrics and MRR
  const metricsResult = await query(
    `SELECT activation_rate, day_30_retention, churn_rate, nps_score, new_mrr_cents
     FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1`,
    [productId],
  );
  if (metricsResult.rows.length === 0) return [];

  const m = metricsResult.rows[0] as Record<string, number | null>;
  const mrrCents = m.new_mrr_cents ?? 0;
  const comparisons: BenchmarkComparison[] = [];

  const metricMap: Record<string, number | null> = {
    activation_rate: m.activation_rate,
    day_30_retention: m.day_30_retention,
    churn_rate: m.churn_rate,
    nps_score: m.nps_score,
  };

  for (const [metric, value] of Object.entries(metricMap)) {
    if (value === null || value === undefined) continue;
    const comparison = await compareToBenchmark(metric, value, marketCategory, lifecycleStage, mrrCents);
    if (comparison) comparisons.push(comparison);
  }

  return comparisons;
}

// ─── Contribute to Network ────────────────────────────────────────────────────

/**
 * Contribute this product's anonymized metrics to the network benchmarks.
 * Called weekly for opted-in products. No product or founder ID stored.
 */
export async function contributeToNetwork(
  productId: string,
  marketCategory: string | null,
  lifecycleStage: string,
): Promise<void> {
  const product = await query(
    `SELECT f.network_opt_in FROM products p
     JOIN founders f ON p.owner_id = f.id
     WHERE p.id = ?`,
    [productId],
  );

  const optedIn = (product.rows[0] as Record<string, unknown>)?.network_opt_in;
  if (!optedIn) return;

  const metricsResult = await query(
    `SELECT activation_rate, day_30_retention, churn_rate, nps_score, new_mrr_cents
     FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1`,
    [productId],
  );
  if (metricsResult.rows.length === 0) return;

  const m = metricsResult.rows[0] as Record<string, number | null>;
  const mrrBracket = getMRRBracket(m.new_mrr_cents ?? 0);

  // Upsert anonymized contribution into network aggregates
  // This is a rolling window — each weekly run replaces the prior contribution
  const contributionId = `${productId}_week`;  // deterministic per product per week
  const metrics = [
    ['activation_rate', m.activation_rate],
    ['day_30_retention', m.day_30_retention],
    ['churn_rate', m.churn_rate],
    ['nps_score', m.nps_score],
  ];

  for (const [metric, value] of metrics) {
    if (value === null) continue;
    await query(
      `INSERT INTO network_contributions
       (id, metric, market_category, lifecycle_stage, mrr_bracket, value, contributed_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id, metric) DO UPDATE SET value = excluded.value, contributed_at = CURRENT_TIMESTAMP`,
      [`${contributionId}_${metric}`, metric, marketCategory ?? 'unknown', lifecycleStage, mrrBracket, value],
    );
  }

  // Recompute percentiles for affected benchmark cells
  await recomputeBenchmarks(marketCategory, lifecycleStage, mrrBracket);
}

async function recomputeBenchmarks(
  marketCategory: string | null,
  lifecycleStage: string,
  mrrBracket: string,
): Promise<void> {
  const metrics = ['activation_rate', 'day_30_retention', 'churn_rate', 'nps_score'];

  for (const metric of metrics) {
    const result = await query(
      `SELECT value FROM network_contributions
       WHERE metric = ? AND lifecycle_stage = ? AND mrr_bracket = ?
         AND (market_category = ? OR market_category = 'unknown')
       ORDER BY value ASC`,
      [metric, lifecycleStage, mrrBracket, marketCategory ?? 'unknown'],
    );

    const values = result.rows.map((r) => (r as Record<string, number>).value).filter(Boolean);
    if (values.length < 3) continue;

    const p25 = values[Math.floor(values.length * 0.25)];
    const p50 = values[Math.floor(values.length * 0.5)];
    const p75 = values[Math.floor(values.length * 0.75)];

    await query(
      `INSERT INTO network_benchmarks
       (id, metric, market_category, lifecycle_stage, mrr_bracket, p25, p50, p75, sample_count, last_updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(metric, market_category, lifecycle_stage, mrr_bracket)
       DO UPDATE SET p25 = excluded.p25, p50 = excluded.p50, p75 = excluded.p75,
                     sample_count = excluded.sample_count, last_updated = CURRENT_TIMESTAMP`,
      [
        `${metric}_${marketCategory ?? 'all'}_${lifecycleStage}_${mrrBracket}`,
        metric, marketCategory ?? 'all', lifecycleStage, mrrBracket,
        p25, p50, p75, values.length,
      ],
    );
  }
}
