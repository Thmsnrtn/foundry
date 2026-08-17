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

  const goldSuiteSizes = rows
    .map((r) => r.golden_suite_size ?? 0)
    .filter((v) => v >= 0)
    .sort((a, b) => a - b);

  const evolutionCycles = rows
    .map((r) => r.total_evolution_cycles ?? 0)
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

  const metrics: MetricSet[] = [
    { name: 'health_score', values: healthScores },
    { name: 'golden_suite_size', values: goldSuiteSizes },
    { name: 'total_evolution_cycles', values: evolutionCycles },
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
  evolution_cycles: { value: number; percentile: number; label: string };
  golden_suite_size: { value: number; percentile: number; label: string };
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
  const goldSuiteSize = p.golden_suite_size ?? 0;
  const evolutionCycles = p.total_evolution_cycles ?? 0;
  const totalProposed = p.total_proposed ?? 0;
  const approvalRate = totalProposed > 0 ? (p.total_approved ?? 0) / totalProposed : 0;

  // Get stored benchmarks
  const benchmarksResult = await query(
    `SELECT metric_name, p25, p50, p75, p90
     FROM intelligence_benchmarks
     WHERE cohort = 'all'
       AND metric_name IN ('health_score', 'golden_suite_size', 'total_evolution_cycles', 'agent_approval_rate')`,
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
    evolution_cycles: positionFromBenchmark(evolutionCycles, 'total_evolution_cycles'),
    golden_suite_size: positionFromBenchmark(goldSuiteSize, 'golden_suite_size'),
  };
}
