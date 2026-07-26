// =============================================================================
// FOUNDRY — Experimentation Engine
// Hypothesis lifecycle, experiment design, execution, and statistical tracking.
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface HypothesisRecord {
  id: string;
  product_id: string;
  proposed_by: string;
  validated_by: string | null;
  statement: string;
  null_hypothesis: string | null;
  predicted_effect_size: number | null;
  minimum_detectable_effect: number | null;
  required_sample_size: number | null;
  estimated_duration_days: number | null;
  confidence_level: number;
  risk_assessment: string | null;
  revenue_impact_estimate: string | null;
  estimated_cost_usd: number | null;
  predicted_roi: number | null;
  status: string;
  created_at: string;
}

export interface ExperimentRecord {
  id: string;
  product_id: string;
  hypothesis_id: string;
  name: string;
  designed_by: string;
  type: string;
  control_description: string;
  treatment_description: string;
  success_metric: string;
  guardrail_metrics: string[];
  sample_allocation: number;
  started_at: string | null;
  planned_end_at: string | null;
  actual_end_at: string | null;
  status: string;
  early_stop_reason: string | null;
  results: {
    control_mean?: number;
    treatment_mean?: number;
    p_value?: number;
    ci_lower?: number;
    ci_upper?: number;
    effect_size?: number;
    significant?: boolean;
  } | null;
  winner: string | null;
  actual_cost_usd: number;
  actual_revenue_impact_usd: number | null;
  notes: string | null;
  created_at: string;
}

// ─── Hypothesis Lifecycle ─────────────────────────────────────────────────────

/**
 * Propose a new hypothesis (any agent can call this).
 * Returns the hypothesis ID.
 */
export async function proposeHypothesis(
  productId: string,
  params: {
    proposedBy: string;
    statement: string;
    predictedEffectSize?: number;
    estimatedDurationDays?: number;
    riskAssessment?: string;
    revenueImpactEstimate?: string;
    estimatedCostUsd?: number;
  },
): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO hypotheses
       (id, product_id, proposed_by, statement, predicted_effect_size,
        estimated_duration_days, risk_assessment, revenue_impact_estimate,
        estimated_cost_usd, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed')`,
    [
      id,
      productId,
      params.proposedBy,
      params.statement,
      params.predictedEffectSize ?? null,
      params.estimatedDurationDays ?? null,
      params.riskAssessment ?? null,
      params.revenueImpactEstimate ?? null,
      params.estimatedCostUsd ?? null,
    ],
  );
  return id;
}

/**
 * Oracle validates and adds statistical details to a hypothesis.
 */
export async function validateHypothesis(
  hypothesisId: string,
  params: {
    validatedBy: string;
    nullHypothesis: string;
    minimumDetectableEffect: number;
    requiredSampleSize: number;
    estimatedDurationDays: number;
    predictedRoi?: number;
  },
): Promise<void> {
  await query(
    `UPDATE hypotheses SET
       validated_by = ?,
       null_hypothesis = ?,
       minimum_detectable_effect = ?,
       required_sample_size = ?,
       estimated_duration_days = ?,
       predicted_roi = ?,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      params.validatedBy,
      params.nullHypothesis,
      params.minimumDetectableEffect,
      params.requiredSampleSize,
      params.estimatedDurationDays,
      params.predictedRoi ?? null,
      hypothesisId,
    ],
  );
}

/**
 * Approve a hypothesis (CEO action) and create an experiment.
 * Returns the experiment ID.
 */
export async function approveAndCreateExperiment(
  hypothesisId: string,
  params: {
    name: string;
    type: 'ab_test' | 'before_after' | 'cohort_comparison';
    controlDescription: string;
    treatmentDescription: string;
    successMetric: string;
    guardrailMetrics?: string[];
    plannedDurationDays?: number;
  },
  scopeProductId: string,
): Promise<string> {
  // The hypothesis must belong to the product the caller already verified
  // ownership of — a foreign hypothesis id is indistinguishable from missing.
  const hypResult = await query(
    'SELECT product_id FROM hypotheses WHERE id = ? AND product_id = ?',
    [hypothesisId, scopeProductId],
  );
  if (hypResult.rows.length === 0) {
    throw new Error(`Hypothesis ${hypothesisId} not found`);
  }
  const productId = (hypResult.rows[0] as Record<string, unknown>).product_id as string;

  // Mark hypothesis as approved
  await query(
    `UPDATE hypotheses SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [hypothesisId],
  );

  // Create experiment
  const experimentId = nanoid();
  const plannedEndAt = params.plannedDurationDays
    ? new Date(Date.now() + params.plannedDurationDays * 86400 * 1000).toISOString()
    : null;

  await query(
    `INSERT INTO experiments
       (id, product_id, hypothesis_id, name, type, control_description,
        treatment_description, success_metric, guardrail_metrics, planned_end_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'designed')`,
    [
      experimentId,
      productId,
      hypothesisId,
      params.name,
      params.type,
      params.controlDescription,
      params.treatmentDescription,
      params.successMetric,
      JSON.stringify(params.guardrailMetrics ?? []),
      plannedEndAt,
    ],
  );

  return experimentId;
}

// ─── Experiment Execution ─────────────────────────────────────────────────────

/**
 * Start an approved experiment.
 */
export async function startExperiment(experimentId: string, scopeProductId: string): Promise<void> {
  await query(
    `UPDATE experiments SET
       status = 'running',
       started_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND product_id = ? AND status = 'designed'`,
    [experimentId, scopeProductId],
  );

  // Mark hypothesis as active
  const expResult = await query(
    'SELECT hypothesis_id FROM experiments WHERE id = ? AND product_id = ?',
    [experimentId, scopeProductId],
  );
  if (expResult.rows.length > 0) {
    const hypothesisId = (expResult.rows[0] as Record<string, unknown>).hypothesis_id as string;
    await query(
      `UPDATE hypotheses SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [hypothesisId],
    );
  }
}

/**
 * Update experiment results (called by Oracle during analysis).
 */
export async function updateResults(
  experimentId: string,
  results: {
    control_mean: number;
    treatment_mean: number;
    p_value: number;
    effect_size: number;
    significant: boolean;
    winner?: 'control' | 'treatment' | 'inconclusive';
  },
): Promise<void> {
  const winner = results.winner ?? (results.significant
    ? (results.treatment_mean > results.control_mean ? 'treatment' : 'control')
    : 'inconclusive');

  await query(
    `UPDATE experiments SET
       results_json = ?,
       winner = ?,
       status = 'completed',
       actual_end_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [JSON.stringify(results), winner, experimentId],
  );

  // Update hypothesis status based on results
  const expResult = await query(
    'SELECT hypothesis_id FROM experiments WHERE id = ?',
    [experimentId],
  );
  if (expResult.rows.length > 0) {
    const hypothesisId = (expResult.rows[0] as Record<string, unknown>).hypothesis_id as string;
    const newStatus = results.significant ? 'completed' : 'disproven';
    await query(
      `UPDATE hypotheses SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [newStatus, hypothesisId],
    );
  }
}

/**
 * Stop an experiment early with reason.
 */
export async function stopEarlyExperiment(
  experimentId: string,
  reason: string,
  scopeProductId: string,
  winner?: string,
): Promise<void> {
  await query(
    `UPDATE experiments SET
       status = 'stopped_early',
       early_stop_reason = ?,
       winner = ?,
       actual_end_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND product_id = ?`,
    [reason, winner ?? null, experimentId, scopeProductId],
  );
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Get all hypotheses for a product.
 */
export async function getHypotheses(productId: string): Promise<HypothesisRecord[]> {
  const result = await query(
    `SELECT * FROM hypotheses WHERE product_id = ? ORDER BY created_at DESC`,
    [productId],
  );
  return result.rows.map(deserializeHypothesis);
}

/**
 * Get all experiments for a product.
 */
export async function getExperiments(productId: string): Promise<ExperimentRecord[]> {
  const result = await query(
    `SELECT * FROM experiments WHERE product_id = ? ORDER BY created_at DESC`,
    [productId],
  );
  return result.rows.map(deserializeExperiment);
}

/**
 * Get active experiment count (for portfolio management — max 3 concurrent).
 */
export async function getActiveExperimentCount(productId: string): Promise<number> {
  const result = await query(
    `SELECT COUNT(*) as cnt FROM experiments WHERE product_id = ? AND status = 'running'`,
    [productId],
  );
  return ((result.rows[0] as Record<string, unknown>)?.cnt as number) ?? 0;
}

/**
 * Get experiment summary for CEO briefing.
 */
export async function getExperimentSummary(productId: string): Promise<{
  total_hypotheses: number;
  pending_approval: number;
  running: number;
  completed: number;
  avg_roi_completed: number;
  recent_win?: { name: string; effect_size: number; metric: string };
}> {
  const hypResult = await query(
    `SELECT COUNT(*) as total,
            SUM(CASE WHEN status = 'proposed' THEN 1 ELSE 0 END) as pending
     FROM hypotheses WHERE product_id = ?`,
    [productId],
  );
  const hypRow = (hypResult.rows[0] as Record<string, unknown>) ?? {};

  const expResult = await query(
    `SELECT COUNT(*) as total,
            SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
     FROM experiments WHERE product_id = ?`,
    [productId],
  );
  const expRow = (expResult.rows[0] as Record<string, unknown>) ?? {};

  // Average ROI for completed experiments
  const roiResult = await query(
    `SELECT AVG(roi_vs_predicted) as avg_roi
     FROM experiments WHERE product_id = ? AND status = 'completed' AND roi_vs_predicted IS NOT NULL`,
    [productId],
  );
  const avgRoi = ((roiResult.rows[0] as Record<string, unknown>)?.avg_roi as number) ?? 0;

  // Most recent win
  const winResult = await query(
    `SELECT e.name, e.success_metric, e.results_json
     FROM experiments e
     WHERE e.product_id = ? AND e.winner = 'treatment' AND e.status = 'completed'
     ORDER BY e.actual_end_at DESC LIMIT 1`,
    [productId],
  );

  let recentWin: { name: string; effect_size: number; metric: string } | undefined;
  if (winResult.rows.length > 0) {
    const w = winResult.rows[0] as Record<string, unknown>;
    const results = w.results_json ? JSON.parse(w.results_json as string) : {};
    recentWin = {
      name: w.name as string,
      effect_size: (results.effect_size as number) ?? 0,
      metric: w.success_metric as string,
    };
  }

  return {
    total_hypotheses: (hypRow.total as number) ?? 0,
    pending_approval: (hypRow.pending as number) ?? 0,
    running: (expRow.running as number) ?? 0,
    completed: (expRow.completed as number) ?? 0,
    avg_roi_completed: avgRoi,
    recent_win: recentWin,
  };
}

// ─── Internal Deserializers ───────────────────────────────────────────────────

function deserializeHypothesis(row: unknown): HypothesisRecord {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as string,
    product_id: r.product_id as string,
    proposed_by: r.proposed_by as string,
    validated_by: (r.validated_by as string | null) ?? null,
    statement: r.statement as string,
    null_hypothesis: (r.null_hypothesis as string | null) ?? null,
    predicted_effect_size: (r.predicted_effect_size as number | null) ?? null,
    minimum_detectable_effect: (r.minimum_detectable_effect as number | null) ?? null,
    required_sample_size: (r.required_sample_size as number | null) ?? null,
    estimated_duration_days: (r.estimated_duration_days as number | null) ?? null,
    confidence_level: (r.confidence_level as number) ?? 0.95,
    risk_assessment: (r.risk_assessment as string | null) ?? null,
    revenue_impact_estimate: (r.revenue_impact_estimate as string | null) ?? null,
    estimated_cost_usd: (r.estimated_cost_usd as number | null) ?? null,
    predicted_roi: (r.predicted_roi as number | null) ?? null,
    status: r.status as string,
    created_at: r.created_at as string,
  };
}

function deserializeExperiment(row: unknown): ExperimentRecord {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as string,
    product_id: r.product_id as string,
    hypothesis_id: r.hypothesis_id as string,
    name: r.name as string,
    designed_by: (r.designed_by as string) ?? 'oracle',
    type: r.type as string,
    control_description: r.control_description as string,
    treatment_description: r.treatment_description as string,
    success_metric: r.success_metric as string,
    guardrail_metrics: r.guardrail_metrics ? JSON.parse(r.guardrail_metrics as string) : [],
    sample_allocation: (r.sample_allocation as number) ?? 0.5,
    started_at: (r.started_at as string | null) ?? null,
    planned_end_at: (r.planned_end_at as string | null) ?? null,
    actual_end_at: (r.actual_end_at as string | null) ?? null,
    status: r.status as string,
    early_stop_reason: (r.early_stop_reason as string | null) ?? null,
    results: r.results_json ? JSON.parse(r.results_json as string) : null,
    winner: (r.winner as string | null) ?? null,
    actual_cost_usd: (r.actual_cost_usd as number) ?? 0,
    actual_revenue_impact_usd: (r.actual_revenue_impact_usd as number | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    created_at: r.created_at as string,
  };
}
