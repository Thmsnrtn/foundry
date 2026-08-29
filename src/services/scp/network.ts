// =============================================================================
// FOUNDRY — SCP Intelligence Network
// Anonymized cross-product benchmarking and peer comparison.
// =============================================================================

import { nanoid } from 'nanoid';
import { operatingProduct, query } from '../../db/client.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)] ?? 0;
}

function percentileLabel(pct: number): string {
  if (pct > 90) return 'Top 10%';
  if (pct > 75) return 'Top quartile';
  if (pct > 50) return 'Above median';
  if (pct > 25) return 'Below median';
  return 'Bottom quartile';
}

function computePercentileRank(value: number, sorted: number[]): number {
  if (sorted.length === 0) return 50;
  const below = sorted.filter((v) => v < value).length;
  return Math.round((below / sorted.length) * 100);
}

// ─── computeAndStoreBenchmarks ────────────────────────────────────────────────

export async function computeAndStoreBenchmarks(): Promise<void> {
  // Query all active SCP products
  const productsResult = await query(
    `SELECT
       p.id,
       p.health_score,
       COALESCE(ai.total_decisions_approved, 0) as total_approved,
       COALESCE(ai.total_decisions_proposed, 0) as total_proposed
     FROM products p
     LEFT JOIN (
       SELECT
         product_id,
         SUM(total_decisions_approved) as total_decisions_approved,
         SUM(total_decisions_proposed) as total_decisions_proposed
       FROM agent_instances
       GROUP BY product_id
     ) ai ON ai.product_id = p.id
     WHERE ${operatingProduct('p')}`,
    []
  );

  if (productsResult.rows.length === 0) return;

  type ProductRow = {
    id: string;
    health_score: number | null;
    golden_suite_size: number | null;
    total_evolution_cycles: number | null;
    total_approved: number;
    total_proposed: number;
  };

  const rows = productsResult.rows as unknown as ProductRow[];

  // Collect metric values
  const healthScores = rows
    .map((r) => r.health_score ?? 0)
    .filter((v) => v >= 0)
    .sort((a, b) => a - b);

  const approvalRates = rows
    .map((r) => {
      const proposed = r.total_proposed ?? 0;
      if (proposed === 0) return 0;
      return (r.total_approved ?? 0) / proposed;
    })
    .sort((a, b) => a - b);

  const cohortSize = rows.length;

  type MetricSet = {
    name: string;
    values: number[];
  };

  // TWO COLUMNS BENCHMARKED HERE WERE ALWAYS ZERO.
  //
  // `golden_suite_size`: `addGoldenLesson` is the only thing that writes it and
  // nothing calls it. `total_evolution_cycles`: created `DEFAULT 0` by migration
  // 017 on both `products` and `agent_instances`, and never incremented by any
  // TypeScript or any SQL in the repository.
  //
  // `addGoldenLesson` is the only thing that writes `golden_suite` or increments
  // this counter, and nothing calls it — so every company scores 0, and the
  // p25/p50/p75/p90 computed across them were four zeroes published as a peer
  // comparison. A benchmark over a constant is not a weak signal; it is the
  // shape of a signal with nothing in it, and a founder reading their percentile
  // against it learns something false about where they stand.
  //
  // So p25/p50/p75/p90 across every company were four zeroes, published as a
  // comparison a founder could read their standing from. A benchmark over a
  // constant is not a weak signal; it is the shape of a signal with nothing in
  // it, and a percentile against it is false precision.
  //
  // Removed rather than fixed, for the same reason the pricing claim was: the
  // remedy for reporting something that is not there is to stop reporting it.
  // If a writer is ever wired, these belong back — with the rows recomputed
  // rather than inherited, since the stored ones describe a world of zeroes.
  const metrics: MetricSet[] = [
    { name: 'health_score', values: healthScores },
    { name: 'agent_approval_rate', values: approvalRates },
  ];

  for (const metric of metrics) {
    const sorted = metric.values;
    if (sorted.length === 0) continue;

    const p25 = percentile(sorted, 25);
    const p50 = percentile(sorted, 50);
    const p75 = percentile(sorted, 75);
    const p90 = percentile(sorted, 90);

    // Check if a row exists for this metric+cohort
    const existing = await query(
      `SELECT id FROM intelligence_benchmarks WHERE metric_name = ? AND cohort = 'all'`,
      [metric.name]
    );

    if (existing.rows.length > 0) {
      const existingId = (existing.rows[0] as Record<string, string>).id;
      await query(
        `UPDATE intelligence_benchmarks
         SET p25 = ?, p50 = ?, p75 = ?, p90 = ?, cohort_size = ?, computed_at = datetime('now')
         WHERE id = ?`,
        [p25, p50, p75, p90, cohortSize, existingId]
      );
    } else {
      await query(
        `INSERT INTO intelligence_benchmarks
           (id, metric_name, cohort, p25, p50, p75, p90, cohort_size, computed_at)
         VALUES (?, ?, 'all', ?, ?, ?, ?, ?, datetime('now'))`,
        [nanoid(), metric.name, p25, p50, p75, p90, cohortSize]
      );
    }
  }
}

// ─── getProductBenchmarkPosition ──────────────────────────────────────────────

export async function getProductBenchmarkPosition(productId: string): Promise<{
  health_score: { value: number; percentile: number; label: string };
  approval_rate: { value: number; percentile: number; label: string };
} | null> {
  // Get this product's values
  const productResult = await query(
    `SELECT
       p.health_score,
       p.golden_suite_size,
       p.total_evolution_cycles,
       COALESCE(ai.total_decisions_approved, 0) as total_approved,
       COALESCE(ai.total_decisions_proposed, 0) as total_proposed
     FROM products p
     LEFT JOIN (
       SELECT
         product_id,
         SUM(total_decisions_approved) as total_decisions_approved,
         SUM(total_decisions_proposed) as total_decisions_proposed
       FROM agent_instances
       GROUP BY product_id
     ) ai ON ai.product_id = p.id
     WHERE p.id = ?`,
    [productId]
  );

  if (productResult.rows.length === 0) return null;

  const p = productResult.rows[0] as Record<string, number | null>;
  const healthScore = p.health_score ?? 0;
  const totalProposed = p.total_proposed ?? 0;
  const approvalRate = totalProposed > 0 ? (p.total_approved ?? 0) / totalProposed : 0;

  // Get stored benchmarks
  const benchmarksResult = await query(
    `SELECT metric_name, p25, p50, p75, p90
     FROM intelligence_benchmarks
     WHERE cohort = 'all'
       AND metric_name IN ('health_score', 'agent_approval_rate')`,
    []
  );

  type BenchmarkRow = {
    metric_name: string;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
  };

  const benchmarks: Record<string, BenchmarkRow> = {};
  for (const row of benchmarksResult.rows as unknown as BenchmarkRow[]) {
    benchmarks[row.metric_name] = row;
  }

  function positionFromBenchmark(value: number, metricName: string): { value: number; percentile: number; label: string } {
    const b = benchmarks[metricName];
    if (!b) {
      // ABSENCE REPORTED AS EXACTLY MEDIAN. The label says there is no data and
      // the number says the company is at the 50th percentile, so a caller
      // reading `percentile` without reading `label` shows a founder a
      // fabricated standing. Left as it is because this function has no caller
      // anywhere — and written down because the first caller is the moment it
      // starts lying. `null` is the honest value here.
      return { value, percentile: 50, label: 'No benchmark data' };
    }

    // Estimate percentile rank from the stored quartile values
    let pct: number;
    if (value >= b.p90) pct = 92;
    else if (value >= b.p75) pct = 82;
    else if (value >= b.p50) pct = 62;
    else if (value >= b.p25) pct = 37;
    else pct = 12;

    return {
      value,
      percentile: pct,
      label: percentileLabel(pct),
    };
  }

  return {
    health_score: positionFromBenchmark(healthScore, 'health_score'),
    approval_rate: positionFromBenchmark(approvalRate, 'agent_approval_rate'),
  };
}
