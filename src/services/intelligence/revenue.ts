// =============================================================================
// FOUNDRY — Revenue Intelligence: MRR Decomposition
// =============================================================================

import { query, getLatestMetrics } from '../../db/client.js';
import type { MRRDecomposition, MRRHealthRatio } from '../../types/index.js';

/**
 * Get MRR decomposition from the latest metric snapshot.
 */
export async function getMRRDecomposition(productId: string): Promise<MRRDecomposition | null> {
  const result = await getLatestMetrics(productId);
  if (result.rows.length === 0) return null;

  const row = result.rows[0] as Record<string, unknown>;
  const newMrr = (row.new_mrr_cents as number) ?? 0;
  const expansion = (row.expansion_mrr_cents as number) ?? 0;
  const contraction = (row.contraction_mrr_cents as number) ?? 0;
  const churned = (row.churned_mrr_cents as number) ?? 0;
  const netNew = newMrr + expansion - contraction - churned;
  const healthRatio = newMrr > 0 ? churned / newMrr : null;

  return {
    new_cents: newMrr,
    expansion_cents: expansion,
    contraction_cents: contraction,
    churned_cents: churned,
    net_new_cents: netNew,
    level_cents: row.mrr_cents == null ? null : Number(row.mrr_cents),
    health_ratio: healthRatio,
  };
}

/**
 * Compute MRR Health Ratio with color indicator.
 */
export function computeHealthRatio(decomposition: MRRDecomposition): MRRHealthRatio {
  // `?? 0` fell straight through to the first branch: a company with no new MRR
  // to divide by got a ratio of 0 and an indicator of GREEN — the most
  // reassuring answer available, for the absence of the measurement. It also
  // reached `health-score.ts`, where `(1 - value) * 100` made it a revenue
  // score of 100 out of 100.
  const value = decomposition.health_ratio;
  if (value === null) return { value: null, indicator: 'unknown' };

  let indicator: 'green' | 'yellow' | 'red';
  if (value < 0.5) indicator = 'green';
  else if (value < 0.8) indicator = 'yellow';
  else indicator = 'red';
  return { value, indicator };
}

/**
 * The company's MRR level, or null if nobody has supplied one.
 *
 * This summed the MOVEMENTS of the last two snapshots and returned that as the
 * total, under a comment admitting it: "simplified — production would track
 * running total". `metric_snapshots.mrr_cents` is that running total, and since
 * this cycle the integrations write it, so there is nothing left to approximate.
 */
export async function computeTotalMRR(productId: string): Promise<number | null> {
  const result = await query(
    `SELECT mrr_cents FROM metric_snapshots
      WHERE product_id = ? AND mrr_cents IS NOT NULL
      ORDER BY snapshot_date DESC LIMIT 1`,
    [productId]
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row?.mrr_cents == null ? null : Number(row.mrr_cents);
}
