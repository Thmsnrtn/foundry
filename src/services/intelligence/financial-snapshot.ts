// =============================================================================
// FOUNDRY — Financial Snapshot (Wave 3, action 25)
// One-card financial picture for the dashboard: MRR, ARR, AI cost, operating
// margin. Council 15 (CFO) finding: a finance picture that ties the founder's
// AI spend to their MRR is the most-missed surface for an operator.
// =============================================================================

import { query } from '../../db/client.js';

export interface FinancialSnapshot {
  product_id: string;
  mrr_cents: number | null;
  mrr_delta_30d_cents: number | null;       // current MRR - MRR 30 days ago
  arr_cents: number | null;                  // 12 × MRR (caveat in §15 reading)
  ai_cost_30d_usd: number;                   // from ai_cost_log
  operating_margin_30d_usd: number | null;   // (MRR/100 × 30/30) - ai_cost_30d_usd
  margin_pct_30d: number | null;             // operating_margin / (MRR/100)
  net_mrr_growth_rate_30d: number | null;    // delta / prior MRR
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function computeFinancialSnapshot(
  productId: string
): Promise<FinancialSnapshot> {
  // Latest MRR snapshot
  const latest = await query(
    `SELECT new_mrr_cents, expansion_mrr_cents, contraction_mrr_cents, churned_mrr_cents
       FROM metric_snapshots
      WHERE product_id = ?
      ORDER BY snapshot_date DESC
      LIMIT 1`,
    [productId]
  );
  const latestRow = latest.rows[0] as Record<string, number | null> | undefined;
  const currentMrrCents = latestRow ? netMrrCents(latestRow) : null;

  // 30 days ago MRR snapshot
  const prior = await query(
    `SELECT new_mrr_cents, expansion_mrr_cents, contraction_mrr_cents, churned_mrr_cents
       FROM metric_snapshots
      WHERE product_id = ?
        AND date(snapshot_date) <= date('now', '-30 days')
      ORDER BY snapshot_date DESC
      LIMIT 1`,
    [productId]
  );
  const priorRow = prior.rows[0] as Record<string, number | null> | undefined;
  const priorMrrCents = priorRow ? netMrrCents(priorRow) : null;

  const mrrDeltaCents =
    currentMrrCents != null && priorMrrCents != null
      ? currentMrrCents - priorMrrCents
      : null;

  const netMrrGrowthRate30d =
    mrrDeltaCents != null && priorMrrCents && priorMrrCents > 0
      ? mrrDeltaCents / priorMrrCents
      : null;

  // AI cost over trailing 30 days
  const ai = await query(
    `SELECT COALESCE(SUM(cost_usd), 0) AS total
       FROM ai_cost_log
      WHERE product_id = ?
        AND datetime(timestamp) > datetime('now', '-30 days')`,
    [productId]
  );
  const aiCost30dUsd = Number((ai.rows[0] as Record<string, number>).total ?? 0);

  // Operating margin: monthly MRR (in dollars) - AI cost over the same window.
  // This is "Foundry's view" of margin — narrowly the AI infrastructure cost
  // vs the revenue. Doesn't include the founder's own hosting / Stripe fees /
  // payroll. Caveat noted in the dashboard rendering.
  const mrrUsd = currentMrrCents != null ? currentMrrCents / 100 : null;
  const operatingMargin =
    mrrUsd != null ? mrrUsd - aiCost30dUsd : null;
  const marginPct =
    operatingMargin != null && mrrUsd != null && mrrUsd > 0
      ? operatingMargin / mrrUsd
      : null;

  return {
    product_id: productId,
    mrr_cents: currentMrrCents,
    mrr_delta_30d_cents: mrrDeltaCents,
    arr_cents: currentMrrCents != null ? currentMrrCents * 12 : null,
    ai_cost_30d_usd: aiCost30dUsd,
    operating_margin_30d_usd: operatingMargin,
    margin_pct_30d: marginPct,
    net_mrr_growth_rate_30d: netMrrGrowthRate30d,
  };
}

// ─── Internals ────────────────────────────────────────────────────────────────

function netMrrCents(row: Record<string, number | null>): number {
  const newMrr = Number(row.new_mrr_cents ?? 0);
  const expansion = Number(row.expansion_mrr_cents ?? 0);
  const contraction = Number(row.contraction_mrr_cents ?? 0);
  const churned = Number(row.churned_mrr_cents ?? 0);
  // Net MRR = new + expansion - contraction - churned
  return newMrr + expansion - contraction - churned;
}
