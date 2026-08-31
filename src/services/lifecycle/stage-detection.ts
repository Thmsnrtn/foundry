// =============================================================================
// FOUNDRY — Growth Stage Detection
// Auto-classifies products into lifecycle stages based on metrics.
// =============================================================================

import { query } from '../../db/client.js';
import type { GrowthStage, GrowthStageConfig } from '../../types/index.js';

/**
 * Auto-detect the growth stage for a product based on its metrics.
 */
export async function detectGrowthStage(productId: string): Promise<GrowthStage> {
  // Check if overridden by founder
  const product = await query('SELECT growth_stage_overridden, growth_stage FROM products WHERE id = ?', [productId]);
  const row = product.rows[0] as Record<string, unknown> | undefined;
  if (!row) return 'pre_launch';
  if ((row.growth_stage_overridden as number) === 1) return row.growth_stage as GrowthStage;

  // Get latest metrics
  const metrics = await query(
    'SELECT * FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1',
    [productId]
  );
  const m = metrics.rows[0] as Record<string, unknown> | undefined;
  if (!m) return 'pre_launch';

  const activeUsers = (m.active_users as number) ?? 0;

  // THE LEVEL, NOT THE MOVEMENT. This added the four MRR MOVEMENT columns —
  // new + expansion − contraction − churned — and called the result the
  // company's MRR. That is the change over the latest period, so a company at
  // $60,000/month with a flat month was classified from about $0 and came out
  // `pre_launch` or `early_traction`: stressors suppressed, thresholds relaxed
  // by 1.5–2×, and the digest told to say "no MRR analysis until you have
  // customers". `mrr_cents` is the level and is what the rest of this system
  // reads. Migration 202 made these columns nullable so absent means absent —
  // and an unreported level is not a level of zero, so a company that has not
  // told us its MRR is classified on the customer count alone.
  const mrrDollars = m.mrr_cents == null ? null : Number(m.mrr_cents) / 100;

  // Check for mature: a year of <10% monthly growth AND MRR > $10K
  if (mrrDollars !== null && mrrDollars > 10000) {
    const yearAgo = await query(
      `SELECT snapshot_date, mrr_cents FROM metric_snapshots
        WHERE product_id = ? AND snapshot_date > date('now', '-12 months')
          AND mrr_cents IS NOT NULL
        ORDER BY snapshot_date ASC`,
      [productId]
    );
    const rows = yearAgo.rows as unknown as Array<Record<string, string | number>>;
    // TWELVE ROWS IS NOT TWELVE MONTHS. `metric_snapshots` is keyed by DATE and
    // most companies report daily, so `rows.length >= 12` was satisfied by a
    // fortnight — and the rates it fed on were month-over-month growth of the
    // MOVEMENT columns, not of MRR. Both are corrected: the span must actually
    // be most of a year, and the rates are monthly-equivalent changes in the
    // LEVEL.
    const spanDays = rows.length < 2 ? 0
      : (Date.parse(`${String(rows[rows.length - 1].snapshot_date)}T00:00:00Z`)
        - Date.parse(`${String(rows[0].snapshot_date)}T00:00:00Z`)) / 86_400_000;
    if (rows.length >= 12 && spanDays >= 330) {
      const growthRates = computeMonthlyGrowthRates(rows);
      if (growthRates.length > 0 && growthRates.every((r) => r < 0.10)) return 'mature';
    }
  }

  // Scale: 500+ customers OR $50K+ MRR
  if (activeUsers >= 500 || (mrrDollars !== null && mrrDollars >= 50000)) return 'scale';

  // Growth: 50-500 customers OR $5K-$50K MRR
  if ((activeUsers >= 50 && activeUsers < 500)
    || (mrrDollars !== null && mrrDollars >= 5000 && mrrDollars < 50000)) return 'growth';

  // Early traction: 1-50 customers AND under $5K MRR — or no MRR reported at
  // all, which is a company we have customers for and no revenue figure from.
  if (activeUsers >= 1 && activeUsers <= 50 && (mrrDollars === null || mrrDollars < 5000)) {
    return 'early_traction';
  }

  // Pre-launch: 0 customers or no metrics
  return 'pre_launch';
}

/**
 * Get stage-specific behavior config.
 */
export function getStageConfig(stage: GrowthStage): GrowthStageConfig {
  const configs: Record<GrowthStage, GrowthStageConfig> = {
    pre_launch: {
      stage: 'pre_launch',
      suppressedStressors: ['mrr_health_ratio', 'churn_rate', 'cohort_retention'],
      focusDimensions: ['d1', 'd2', 'd3', 'd4', 'd9', 'd10'],
      digestFocus: 'Ship velocity and audit progress. No MRR analysis until you have customers.',
      stressorThresholdMultiplier: 2.0, // Much more relaxed
    },
    early_traction: {
      stage: 'early_traction',
      suppressedStressors: [],
      focusDimensions: ['d1', 'd2', 'd3', 'd4', 'd6', 'd10'],
      digestFocus: 'Hypothesis validation, churn diagnosis, ICP refinement.',
      stressorThresholdMultiplier: 1.5, // Somewhat relaxed
    },
    growth: {
      stage: 'growth',
      suppressedStressors: [],
      focusDimensions: ['d1', 'd3', 'd5', 'd6', 'd8'],
      digestFocus: 'Unit economics, scaling constraints, operational readiness.',
      stressorThresholdMultiplier: 1.0, // Standard
    },
    scale: {
      stage: 'scale',
      suppressedStressors: [],
      focusDimensions: ['d5', 'd6', 'd7', 'd8'],
      digestFocus: 'Team dynamics, market positioning, category creation.',
      stressorThresholdMultiplier: 0.8, // Tighter thresholds
    },
    mature: {
      stage: 'mature',
      suppressedStressors: ['slow_growth', 'flat_mrr'],
      focusDimensions: ['d5', 'd6', 'd7'],
      digestFocus: 'Efficiency, adjacent markets, profitability optimization.',
      stressorThresholdMultiplier: 0.9,
    },
  };
  return configs[stage];
}

/**
 * Get stage-adjusted stressor thresholds.
 */
export function getStageStressorThresholds(stage: GrowthStage): {
  mrrHealthRatioCritical: number;
  mrrHealthRatioElevated: number;
  cohortRetentionDeviation: number;
  activationRateDrop: number;
} {
  const config = getStageConfig(stage);
  const m = config.stressorThresholdMultiplier;
  return {
    mrrHealthRatioCritical: 1.0 * m,
    mrrHealthRatioElevated: 0.8 * m,
    cohortRetentionDeviation: 25 * m,
    activationRateDrop: 10 * m,
  };
}

/**
 * Update a product's growth stage in the database.
 */
export async function updateGrowthStage(productId: string, stage: GrowthStage): Promise<void> {
  await query(
    `UPDATE products SET growth_stage = ?, growth_stage_updated_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND growth_stage_overridden = 0`,
    [stage, productId]
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Monthly-equivalent growth in the MRR LEVEL between consecutive snapshots.
 *
 *  This compared `new + expansion` between rows — the growth of one period's
 *  ACQUISITION, not of the company's revenue — and called the result a monthly
 *  growth rate whatever the gap between the two dates was. A pair whose level
 *  is unknown or zero contributes nothing rather than a zero: "we were not
 *  told" is not "it did not grow". */
function computeMonthlyGrowthRates(snapshots: Array<Record<string, string | number>>): number[] {
  const DAYS_PER_MONTH = 30.44;
  const rates: number[] = [];
  for (let i = 1; i < snapshots.length; i++) {
    const prev = Number(snapshots[i - 1]!.mrr_cents ?? 0);
    const curr = Number(snapshots[i]!.mrr_cents ?? 0);
    if (!(prev > 0) || !(curr > 0)) continue;
    const gapDays = (Date.parse(`${String(snapshots[i]!.snapshot_date)}T00:00:00Z`)
      - Date.parse(`${String(snapshots[i - 1]!.snapshot_date)}T00:00:00Z`)) / 86_400_000;
    if (!Number.isFinite(gapDays) || gapDays <= 0) continue;
    rates.push((curr / prev) ** (DAYS_PER_MONTH / gapDays) - 1);
  }
  return rates;
}
