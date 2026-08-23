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
 * AND THE COLUMNS CAN SAY IT NOW. Migration 202 made the four movements
 * nullable, so a row that reported a genuine zero and a row nobody wrote a
 * movement into are finally different values, and this returns null for the
 * second. One caveat that cannot be fixed: rows written BEFORE that migration
 * keep whatever they stored, and their zeros stay ambiguous — the information
 * that would tell 0 from unknown was never recorded. New rows are honest;
 * history is what it is.
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
  /** The stored value, or null for a movement nobody reported. */
  const reported = (key: string): number | null => {
    const v = row[key];
    return v === null || v === undefined ? null : Number(v);
  };
  const newMrr = reported('new_mrr_cents');
  const expansion = reported('expansion_mrr_cents');
  const contraction = reported('contraction_mrr_cents');
  const churned = reported('churned_mrr_cents');
  // A SUM MISSING A TERM IS NOT A SMALLER SUM. Net new is the four movements
  // together; with any one unreported the answer is that it is not known.
  const netNew = [newMrr, expansion, contraction, churned].every((v) => v !== null)
    ? (newMrr as number) + (expansion as number) - (contraction as number) - (churned as number)
    : null;
  // The ratio needs both terms measured. `new === 0` stays null — dividing by
  // it is undefined, which is a different unknown with the same answer.
  const healthRatio = newMrr !== null && churned !== null && newMrr > 0
    ? churned / newMrr
    : null;

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
