// =============================================================================
// FOUNDRY — Shippability Score (Wave 2, action 13)
// For pre-launch products, the Signal score is meaningless — it's anchored
// to "business health" with no business yet. This module computes a
// stage-appropriate replacement: a checklist-based "Shippability" score
// that measures readiness milestones rather than business outcomes.
//
// Council 23 (pre-launch founders) recommendation: replace Signal with
// something stage-relevant.
// =============================================================================

import { query } from '../../db/client.js';

export interface ShippabilityCriterion {
  key: string;
  label: string;
  satisfied: boolean;
  weight: number;
}

export interface ShippabilityResult {
  score: number;                    // 0-100
  criteria: ShippabilityCriterion[];
  ready_to_launch: boolean;        // true when score >= 80
  next_action: string | null;       // top unsatisfied criterion's label
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute Shippability for a product. Pure read; no mutations.
 * Returns null if the product isn't in pre_launch stage.
 */
export async function computeShippability(productId: string): Promise<ShippabilityResult | null> {
  const product = await query(
    `SELECT growth_stage, github_repo_url, market_category, sector_profile
       FROM products WHERE id = ?`,
    [productId]
  );
  if (product.rows.length === 0) return null;
  const p = product.rows[0] as Record<string, unknown>;
  if (p.growth_stage !== 'pre_launch') return null;

  // Gather signals from existing tables.
  const dna = await query(
    `SELECT icp_description, positioning_statement, primary_objection
       FROM product_dna WHERE product_id = ?`,
    [productId]
  );
  const dnaRow = (dna.rows[0] as Record<string, unknown> | undefined) ?? {};

  const audit = await query(
    `SELECT composite, verdict FROM audit_scores
      WHERE product_id = ? ORDER BY created_at DESC LIMIT 1`,
    [productId]
  );
  const auditRow = (audit.rows[0] as Record<string, unknown> | undefined) ?? {};

  const integrations = await query(
    `SELECT COUNT(*) AS n FROM integrations
      WHERE product_id = ? AND status = 'active'`,
    [productId]
  );
  const integrationCount = Number(
    (integrations.rows[0] as Record<string, unknown> | undefined)?.n ?? 0
  );

  const competitors = await query(
    `SELECT COUNT(*) AS n FROM competitors WHERE product_id = ?`,
    [productId]
  );
  const competitorCount = Number(
    (competitors.rows[0] as Record<string, unknown> | undefined)?.n ?? 0
  );

  const criteria: ShippabilityCriterion[] = [
    {
      key: 'repo_connected',
      label: 'GitHub repository connected',
      satisfied: !!p.github_repo_url,
      weight: 15,
    },
    {
      key: 'audit_completed',
      label: 'Initial audit completed',
      satisfied: auditRow.composite != null,
      weight: 15,
    },
    {
      key: 'icp_defined',
      label: 'ICP described',
      satisfied: typeof dnaRow.icp_description === 'string' && dnaRow.icp_description.length >= 50,
      weight: 15,
    },
    {
      key: 'positioning_drafted',
      label: 'Positioning statement drafted',
      satisfied: typeof dnaRow.positioning_statement === 'string' && dnaRow.positioning_statement.length >= 30,
      weight: 10,
    },
    {
      key: 'objection_anticipated',
      label: 'Primary objection anticipated',
      satisfied: typeof dnaRow.primary_objection === 'string' && dnaRow.primary_objection.length >= 20,
      weight: 10,
    },
    {
      key: 'competitors_named',
      label: 'At least 2 competitors documented',
      satisfied: competitorCount >= 2,
      weight: 10,
    },
    {
      key: 'audit_passing',
      label: 'Audit verdict is READY or READY_WITH_CONDITIONS',
      satisfied:
        auditRow.verdict === 'READY' || auditRow.verdict === 'READY_WITH_CONDITIONS',
      weight: 15,
    },
    {
      key: 'metrics_pipeline',
      label: 'Metrics ingestion configured',
      satisfied: integrationCount >= 1,
      weight: 10,
    },
  ];

  const totalWeight = criteria.reduce((acc, c) => acc + c.weight, 0);
  const earned = criteria
    .filter((c) => c.satisfied)
    .reduce((acc, c) => acc + c.weight, 0);
  const score = Math.round((earned / totalWeight) * 100);

  const firstUnsat = criteria.find((c) => !c.satisfied);
  return {
    score,
    criteria,
    ready_to_launch: score >= 80,
    next_action: firstUnsat ? firstUnsat.label : null,
  };
}
