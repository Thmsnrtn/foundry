// =============================================================================
// FOUNDRY — Prediction accuracy: how well Foundry's own forecasts held up.
//
// This module used to also hold Signal replay and temporal event recording.
// Both were removed in migration 194: their table had never held a row, their
// two functions had never had a caller, and the header claimed in the present
// tense that events were recorded "throughout the system". The live event
// stream is `signal_events`.
//
// What remains is the one thing here that runs: after a decision's outcome is
// recorded, compare it to what the scenario model predicted.
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';

// ─── Prediction Accuracy Tracking ────────────────────────────────────────────

/**
 * After a decision outcome is recorded, compare it to the scenario model prediction.
 * Computes direction accuracy, magnitude accuracy, and composite score.
 */
export async function recordPredictionAccuracy(
  productId: string,
  decisionId: string,
  actualOutcomeDirection: 'positive' | 'neutral' | 'negative',
  actualMrrDeltaPct: number | null,
  actualTimeframeDays: number | null,
): Promise<void> {
  // Get the scenario model for this decision
  const scenarioResult = await query(
    `SELECT id, option_label, base_case FROM scenario_models
     WHERE decision_id = ? LIMIT 1`,
    [decisionId],
  );
  if (scenarioResult.rows.length === 0) return;

  const scenario = scenarioResult.rows[0] as Record<string, string>;
  let baseCase: Record<string, unknown> = {};
  try {
    baseCase = JSON.parse(scenario.base_case) as Record<string, unknown>;
  } catch { return; }

  const predictedDirection = baseCase.outcome_direction as string | undefined;
  const predictedMrrDelta = baseCase.mrr_delta_pct as number | undefined;
  const predictedTimeframe = baseCase.timeframe_days as number | undefined;

  // Null when no direction was predicted. `undefined === 'positive'` is false,
  // so a scenario that made no directional prediction was recorded as having
  // predicted it WRONG — and that false then contributed zero at the heaviest
  // weight in the composite below.
  const directionCorrect = predictedDirection === undefined
    ? null
    : predictedDirection === actualOutcomeDirection;

  let magnitudeAccuracy: number | null = null;
  if (predictedMrrDelta !== undefined && actualMrrDeltaPct !== null) {
    const diff = Math.abs(predictedMrrDelta - actualMrrDeltaPct);
    magnitudeAccuracy = Math.max(0, 1 - diff / Math.max(Math.abs(predictedMrrDelta), 0.01));
  }

  let timeframeAccuracy: number | null = null;
  if (predictedTimeframe !== undefined && actualTimeframeDays !== null) {
    const diff = Math.abs(predictedTimeframe - actualTimeframeDays);
    timeframeAccuracy = Math.max(0, 1 - diff / Math.max(predictedTimeframe, 1));
  }

  // A COMPOSITE THAT SCORED WHAT IT COULD NOT MEASURE AS ZERO.
  //
  // This summed `magnitudeAccuracy * 0.3` and `timeframeAccuracy * 0.2` when
  // those were known and added NOTHING when they were not — so a forecast that
  // got the direction exactly right, with no magnitude or timeframe to score
  // against, recorded 0.5. Indistinguishable from a forecast that got the
  // direction right AND was completely wrong on both of the others, which also
  // records 0.5.
  //
  // The row is otherwise honest: `magnitude_accuracy` and `timeframe_accuracy`
  // are stored NULL when unmeasured. Only the aggregate over them lied — the
  // same shape as the value-delivery row that told the truth in five columns
  // and a lie in the sixth.
  //
  // This is Foundry scoring ITS OWN forecasts, which is the one place the
  // institution is its own subject, so an inflated-or-deflated self-score is
  // worse here than anywhere else.
  //
  // The direction is the same case and the worst one: `undefined === 'positive'`
  // is false, so a scenario that predicted no direction at all was recorded as
  // having predicted it WRONG, and that false was worth zero at the heaviest
  // weight of the three.
  //
  // Weighted over the components that were actually scored, renormalised, and
  // null when none were.
  const scored: Array<[number, number]> = [
    ...(directionCorrect !== null ? [[directionCorrect ? 1 : 0, 0.5] as [number, number]] : []),
    ...(magnitudeAccuracy !== null ? [[magnitudeAccuracy, 0.3] as [number, number]] : []),
    ...(timeframeAccuracy !== null ? [[timeframeAccuracy, 0.2] as [number, number]] : []),
  ];
  const weightUsed = scored.reduce((sum, [, w]) => sum + w, 0);
  const compositeAccuracy = weightUsed === 0
    ? null
    : scored.reduce((sum, [v, w]) => sum + v * w, 0) / weightUsed;

  await query(
    `INSERT INTO prediction_accuracy
     (id, product_id, scenario_model_id, decision_id, option_chosen,
      predicted_outcome_direction, predicted_mrr_delta_pct, predicted_timeframe_days,
      actual_outcome_direction, actual_mrr_delta_pct, actual_timeframe_days,
      direction_correct, magnitude_accuracy, timeframe_accuracy, composite_accuracy,
      measured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      nanoid(), productId, scenario.id, decisionId, scenario.option_label,
      predictedDirection ?? null, predictedMrrDelta ?? null, predictedTimeframe ?? null,
      actualOutcomeDirection, actualMrrDeltaPct, actualTimeframeDays,
      directionCorrect === null ? null : (directionCorrect ? 1 : 0),
      magnitudeAccuracy, timeframeAccuracy, compositeAccuracy,
    ],
  );

  // Also update the scenario model's outcome_accuracy field
  await query(
    `UPDATE scenario_models SET outcome_accuracy = ? WHERE id = ?`,
    [JSON.stringify({ direction_correct: directionCorrect, composite_accuracy: compositeAccuracy }), scenario.id],
  );
}

/**
 * How well Foundry's own forecasts have held up. Feeds the "how accurate is
 * Foundry" dashboard.
 *
 * The rates are nullable: `AVG` over no rows is NULL, and `?? 0` turned that
 * into "0% direction accuracy" — Foundry reporting that it has never once been
 * right, for a company whose forecasts have never been scored. Null says the
 * difference.
 */
export async function getPredictionAccuracySummary(productId: string): Promise<{
  total_predictions: number;
  /** Null when no prediction has been scored. Zero means scored and never right. */
  direction_accuracy: number | null;
  avg_composite_accuracy: number | null;
  by_category: Array<{ direction: string; count: number; accuracy: number | null }>;
}> {
  const result = await query(
    `SELECT
       COUNT(*) as total,
       -- A NULL direction_correct means no direction was predicted, and AVG
       -- skips NULLs. Without the first branch, CASE WHEN NULL falls to ELSE
       -- and an unscored prediction counts as a wrong one.
       AVG(CASE WHEN direction_correct IS NULL THEN NULL
                WHEN direction_correct THEN 1.0 ELSE 0.0 END) as dir_accuracy,
       AVG(composite_accuracy) as avg_composite
     FROM prediction_accuracy WHERE product_id = ?`,
    [productId],
  );

  const row = (result.rows[0] ?? {}) as Record<string, number | null>;

  const byCategoryResult = await query(
    `SELECT actual_outcome_direction as direction,
            COUNT(*) as count,
            AVG(CASE WHEN direction_correct IS NULL THEN NULL
                     WHEN direction_correct THEN 1.0 ELSE 0.0 END) as accuracy
     FROM prediction_accuracy WHERE product_id = ?
     GROUP BY actual_outcome_direction`,
    [productId],
  );

  return {
    total_predictions: row.total ?? 0,
    direction_accuracy: row.dir_accuracy ?? null,
    avg_composite_accuracy: row.avg_composite ?? null,
    by_category: byCategoryResult.rows as unknown as Array<{ direction: string; count: number; accuracy: number | null }>,
  };
}
