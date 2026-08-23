// =============================================================================
// FOUNDRY — Revenue Intelligence: MRR Decomposition
// =============================================================================

import { query } from '../../db/client.js';
import type { MRRDecomposition, MRRHealthRatio } from '../../types/index.js';

/**
 * Get MRR decomposition from the latest snapshot THAT REPORTED ANY REVENUE.
 *
 * IT USED TO READ THE LATEST SNAPSHOT, FULL STOP — and the daily job writes a
 * placeholder row carrying nothing but `(id, product_id, snapshot_date)`. That
 * row is the latest one on every ordinary day, its four movement columns are
 * `INTEGER DEFAULT 0`, and so this returned a confident decomposition of zeros
 * for essentially every company, every day.
 *
 * Ten modules import from here. The founder's chat context listed new $0,
 * churned $0, expansion $0, contraction $0 as measured facts; the digest email
 * printed a net-new figure; the COO prompt was told "net new this period: $0";
 * and the voice briefing SAID OUT LOUD "Net new MRR this period: flat" —
 * which is a statement about the month, from a row that recorded nothing.
 *
 * WHAT THIS DOES NOT FIX, because a query cannot. The four movement columns are
 * `INTEGER DEFAULT 0`, so a company that reported a genuine zero and a company
 * that reported no movement at all store the same value. Selecting a row that
 * reported SOMETHING removes the systematic daily fabrication; it does not make
 * the movements on that row distinguishable from unreported. The end state is
 * those four columns nullable with the ingest doors writing NULL for what was
 * not supplied — a table rebuild plus every reader that adds them up, and one
 * honest caveat: rows already written cannot be repaired, because the
 * information that would tell 0 from unknown was never stored. Recorded on the
 * frontier with that trigger rather than half-done here.
 */
export async function getMRRDecomposition(productId: string): Promise<MRRDecomposition | null> {
  const result = await query(
    `SELECT * FROM metric_snapshots
      WHERE product_id = ?
        AND (mrr_cents IS NOT NULL
             OR COALESCE(new_mrr_cents, 0) != 0
             OR COALESCE(expansion_mrr_cents, 0) != 0
             OR COALESCE(contraction_mrr_cents, 0) != 0
             OR COALESCE(churned_mrr_cents, 0) != 0)
      ORDER BY snapshot_date DESC
      LIMIT 1`,
    [productId],
  );
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
