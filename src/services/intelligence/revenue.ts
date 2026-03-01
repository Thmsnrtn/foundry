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
  const total = newMrr + expansion - contraction - churned;
  const healthRatio = newMrr > 0 ? churned / newMrr : null;

  return {
    new_cents: newMrr,
    expansion_cents: expansion,
    contraction_cents: contraction,
    churned_cents: churned,
    total_cents: total,
    health_ratio: healthRatio,
  };
}

/**
 * Compute MRR Health Ratio with color indicator.
 */
export function computeHealthRatio(decomposition: MRRDecomposition): MRRHealthRatio {
  const value = decomposition.health_ratio ?? 0;
  let indicator: 'green' | 'yellow' | 'red';
  if (value < 0.5) indicator = 'green';
  else if (value < 0.8) indicator = 'yellow';
  else indicator = 'red';
  return { value, indicator };
}

/**
 * Compute total MRR from prior period plus current decomposition.
 */
export async function computeTotalMRR(productId: string): Promise<number> {
  const result = await query(
    `SELECT new_mrr_cents, expansion_mrr_cents, contraction_mrr_cents, churned_mrr_cents
     FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 2`,
    [productId]
  );

  if (result.rows.length === 0) return 0;

  // Sum all periods (simplified — production would track running total)
  let total = 0;
  for (const row of result.rows) {
    const r = row as Record<string, number>;
    total += (r.new_mrr_cents ?? 0) + (r.expansion_mrr_cents ?? 0)
           - (r.contraction_mrr_cents ?? 0) - (r.churned_mrr_cents ?? 0);
  }
  return total;
}
