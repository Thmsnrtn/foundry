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
  const mrrCents = ((m.new_mrr_cents as number) ?? 0) +
    ((m.expansion_mrr_cents as number) ?? 0) -
    ((m.contraction_mrr_cents as number) ?? 0) -
    ((m.churned_mrr_cents as number) ?? 0);
  const mrrDollars = mrrCents / 100;

  // Check for mature: 12+ months of <10% monthly growth AND MRR > $10K
  if (mrrDollars > 10000) {
    const yearAgo = await query(
      `SELECT * FROM metric_snapshots WHERE product_id = ? AND snapshot_date > date('now', '-12 months') ORDER BY snapshot_date ASC`,
      [productId]
    );
    if (yearAgo.rows.length >= 12) {
      const growthRates = computeMonthlyGrowthRates(yearAgo.rows as unknown as Array<Record<string, number>>);
      const allBelow10 = growthRates.every((r) => r < 0.10);
      if (allBelow10) return 'mature';
    }
  }

  // Scale: 500+ customers OR $50K+ MRR
  if (activeUsers >= 500 || mrrDollars >= 50000) return 'scale';

  // Growth: 50-500 customers OR $5K-$50K MRR
  if ((activeUsers >= 50 && activeUsers < 500) || (mrrDollars >= 5000 && mrrDollars < 50000)) return 'growth';

  // Early traction: 1-50 customers AND < $5K MRR
  if (activeUsers >= 1 && activeUsers <= 50 && mrrDollars < 5000) return 'early_traction';

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

function computeMonthlyGrowthRates(snapshots: Array<Record<string, number>>): number[] {
  const rates: number[] = [];
  for (let i = 1; i < snapshots.length; i++) {
    const prev = (snapshots[i - 1]!.new_mrr_cents ?? 0) + (snapshots[i - 1]!.expansion_mrr_cents ?? 0);
    const curr = (snapshots[i]!.new_mrr_cents ?? 0) + (snapshots[i]!.expansion_mrr_cents ?? 0);
    if (prev > 0) {
      rates.push((curr - prev) / prev);
    } else {
      rates.push(0);
    }
  }
  return rates;
}
