// =============================================================================
// FOUNDRY — Anonymous Benchmarks
// Compares a product's metrics against anonymized peer data.
// =============================================================================

import { query, getLatestMetrics } from '../../db/client.js';
import type { RiskStateValue } from '../../types/index.js';

export interface BenchmarkComparison {
  metric: string;
  your_value: number | null;
  peer_median: number | null;
  peer_p25: number | null;
  peer_p75: number | null;
  percentile: number | null;
  label: string;
}

/**
 * Compare a product's metrics against anonymized aggregates of all products.
 * No individual product data is exposed — only statistical aggregates.
 */
export async function getBenchmarks(productId: string, marketCategory: string | null): Promise<BenchmarkComparison[]> {
  const yours = await getLatestMetrics(productId);
  const yourRow = yours.rows[0] as Record<string, number> | undefined;

  // Build aggregate query — filter by market category if available
  const categoryFilter = marketCategory ? "AND p.market_category = ?" : "";
  const categoryArgs = marketCategory ? [marketCategory] : [];

  const aggregates = await query(
    `SELECT
       AVG(m.activation_rate) as avg_activation,
       AVG(m.day_30_retention) as avg_retention,
       AVG(m.churn_rate) as avg_churn,
       AVG(m.nps_score) as avg_nps,
       AVG(CAST(m.churned_mrr_cents AS REAL) / NULLIF(m.new_mrr_cents, 0)) as avg_health_ratio
     FROM metric_snapshots m
     JOIN products p ON m.product_id = p.id
     WHERE m.product_id != ?
       AND m.activation_rate IS NOT NULL
       ${categoryFilter}
     GROUP BY 1
     HAVING COUNT(*) >= 3`,
    [productId, ...categoryArgs]
  );

  const peer = aggregates.rows[0] as Record<string, number> | undefined;

  const benchmarks: BenchmarkComparison[] = [];

  const addBenchmark = (metric: string, label: string, yourValue: number | null, peerMedian: number | null, higherIsBetter: boolean = true) => {
    let percentile: number | null = null;
    if (yourValue != null && peerMedian != null && peerMedian > 0) {
      const ratio = yourValue / peerMedian;
      percentile = higherIsBetter
        ? Math.min(99, Math.round(ratio * 50))
        : Math.min(99, Math.round((1 / ratio) * 50));
    }
    benchmarks.push({ metric, your_value: yourValue, peer_median: peerMedian, peer_p25: null, peer_p75: null, percentile, label });
  };

  addBenchmark('activation_rate', 'Activation Rate', yourRow?.activation_rate ?? null, peer?.avg_activation ?? null);
  addBenchmark('day_30_retention', 'Day 30 Retention', yourRow?.day_30_retention ?? null, peer?.avg_retention ?? null);
  addBenchmark('churn_rate', 'Churn Rate', yourRow?.churn_rate ?? null, peer?.avg_churn ?? null, false);
  addBenchmark('nps_score', 'NPS Score', yourRow?.nps_score ?? null, peer?.avg_nps ?? null);
  addBenchmark('mrr_health_ratio', 'MRR Health Ratio', yourRow?.mrr_health_ratio ?? null, peer?.avg_health_ratio ?? null, false);

  return benchmarks;
}
