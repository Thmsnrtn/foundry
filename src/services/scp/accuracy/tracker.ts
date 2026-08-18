// =============================================================================
// FOUNDRY — Agent Prediction Accuracy Tracker
// Records predictions, measures outcomes, computes rolling accuracy scores.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';

export interface PredictionInput {
  productId: string;
  agentName: string;
  sessionId: string;
  predictionType: 'churn_risk' | 'expansion_opportunity' | 'metric_target' | 'experiment_outcome' | 'risk_escalation';
  predictionText: string;
  predictedValue?: number; // probability or numeric value
  confidence: number; // 0-1
  measureByDays: number; // how many days until we check
  outcomeCriteria: string; // what to look up when measuring
}

// ─── Record a new prediction ──────────────────────────────────────────────────

export async function recordPrediction(input: PredictionInput): Promise<string> {
  const id = nanoid();
  const measureByDate = new Date(Date.now() + input.measureByDays * 86400 * 1000)
    .toISOString()
    .slice(0, 10);

  await query(
    `INSERT INTO agent_predictions
       (id, product_id, agent_name, session_id, prediction_type, prediction_text,
        predicted_value, confidence, measure_by_date, outcome_criteria, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      id,
      input.productId,
      input.agentName,
      input.sessionId,
      input.predictionType,
      input.predictionText,
      input.predictedValue ?? null,
      input.confidence,
      measureByDate,
      input.outcomeCriteria,
    ]
  );

  return id;
}

// ─── Measure pending predictions ─────────────────────────────────────────────

export async function measurePendingPredictions(
  productId: string
): Promise<{ measured: number; correct: number }> {
  const today = new Date().toISOString().slice(0, 10);

  const pending = await query(
    `SELECT * FROM agent_predictions
     WHERE product_id = ? AND measure_by_date <= ? AND outcome IS NULL`,
    [productId, today]
  );

  let measured = 0;
  let correct = 0;

  for (const rawRow of pending.rows) {
    const row = rawRow as Record<string, unknown>;
    const predictionId = row.id as string;
    const predictionType = row.prediction_type as string;
    const criteria = row.outcome_criteria as string;
    const predictedValue = row.predicted_value as number | null;

    let outcome: 'correct' | 'incorrect' | 'partial' | 'unmeasurable' = 'unmeasurable';
    let notes = '';

    try {
      if (predictionType === 'churn_risk') {
        // criteria: "customer_id=X"
        const match = criteria.match(/customer_id=([^\s&]+)/);
        if (match) {
          const customerId = match[1];
          const result = await query(
            `SELECT stage FROM customer_intelligence
             WHERE product_id = ? AND (id = ? OR external_customer_id = ?)
             LIMIT 1`,
            [productId, customerId, customerId]
          );
          if (result.rows.length > 0) {
            const stage = (result.rows[0] as Record<string, unknown>).stage as string;
            if (stage === 'churned') {
              outcome = 'correct';
            } else if (stage === 'at_risk') {
              outcome = 'partial';
            } else {
              outcome = 'incorrect';
            }
            notes = `Customer stage: ${stage}`;
          }
        }
      } else if (predictionType === 'expansion_opportunity') {
        // criteria: "customer_id=X" or "action_type=expansion"
        const match = criteria.match(/customer_id=([^\s&]+)/);
        if (match) {
          const customerId = match[1];
          const result = await query(
            // 'completed' is not in `outbound_actions.status`; the value
            // for an action that ran is 'executed'. This matched nothing, so
            // every prediction of this kind scored as unfulfilled.
            `SELECT COUNT(*) as cnt FROM outbound_actions
             WHERE product_id = ? AND status = 'executed'
               AND (parameters_json LIKE ? OR parameters_json LIKE ?)
             LIMIT 1`,
            [productId, `%${customerId}%`, '%expansion%']
          );
          const cnt = (result.rows[0] as Record<string, unknown>)?.cnt as number ?? 0;
          outcome = cnt > 0 ? 'correct' : 'incorrect';
          notes = `Completed expansion actions: ${cnt}`;
        }
      } else if (predictionType === 'metric_target') {
        // criteria: "metric=X target=Y"
        const metricMatch = criteria.match(/metric=([^\s]+)/);
        const targetMatch = criteria.match(/target=([^\s]+)/);
        if (metricMatch && targetMatch && predictedValue !== null) {
          const metricName = metricMatch[1];
          const targetVal = parseFloat(targetMatch[1]);
          const result = await query(
            `SELECT * FROM metric_snapshots
             WHERE product_id = ?
             ORDER BY snapshot_date DESC LIMIT 1`,
            [productId]
          );
          if (result.rows.length > 0) {
            const row2 = result.rows[0] as Record<string, unknown>;
            const currentVal = row2[metricName] as number | null;
            if (currentVal !== null && currentVal !== undefined) {
              const tolerance = Math.abs(targetVal) * 0.1; // 10% tolerance
              if (Math.abs(currentVal - targetVal) <= tolerance) {
                outcome = 'correct';
              } else if (Math.abs(currentVal - targetVal) <= tolerance * 2) {
                outcome = 'partial';
              } else {
                outcome = 'incorrect';
              }
              notes = `Metric ${metricName}: predicted ${targetVal}, actual ${currentVal}`;
            }
          }
        }
      } else if (predictionType === 'experiment_outcome') {
        // criteria: "experiment_id=X winner=variant_a"
        const expMatch = criteria.match(/experiment_id=([^\s]+)/);
        const winnerMatch = criteria.match(/winner=([^\s]+)/);
        if (expMatch) {
          const experimentId = expMatch[1];
          const expectedWinner = winnerMatch ? winnerMatch[1] : null;
          // `hypotheses` has neither `winner_variant` nor `title`. Both live
          // where the winner is decided — on `experiments`, which is also what
          // `experiment_id=` in the criteria names. Querying the hypothesis for
          // the experiment's result raised on every prediction of this kind, so
          // none of them was ever scored.
          const result = await query(
            `SELECT status, winner FROM experiments
             WHERE product_id = ? AND (id = ? OR name LIKE ?)
             LIMIT 1`,
            [productId, experimentId, `%${experimentId}%`]
          );
          if (result.rows.length > 0) {
            const expRow = result.rows[0] as Record<string, unknown>;
            const status = expRow.status as string;
            const winner = expRow.winner as string | null;
            if (status === 'concluded' || status === 'completed') {
              if (expectedWinner && winner) {
                outcome = winner === expectedWinner ? 'correct' : 'incorrect';
                notes = `Experiment concluded. Expected winner: ${expectedWinner}, actual: ${winner}`;
              } else {
                outcome = 'partial';
                notes = `Experiment concluded but winner not determinable`;
              }
            }
          }
        }
      }
    } catch {
      outcome = 'unmeasurable';
      notes = 'Measurement query failed';
    }

    await recordOutcome(predictionId, outcome, notes || undefined);
    measured++;
    if (outcome === 'correct') correct++;
  }

  if (measured > 0) {
    // Gather unique agent names that had predictions measured
    const agentNames = [...new Set(
      pending.rows.map((r) => (r as Record<string, unknown>).agent_name as string)
    )];
    for (const agentName of agentNames) {
      await updateAccuracyScores(productId, agentName);
    }
  }

  return { measured, correct };
}

// ─── Record outcome for a specific prediction ──────────────────────────────────

export async function recordOutcome(
  predictionId: string,
  outcome: 'correct' | 'incorrect' | 'partial' | 'unmeasurable',
  notes?: string
): Promise<void> {
  const accuracyScore =
    outcome === 'correct' ? 1.0
    : outcome === 'partial' ? 0.5
    : outcome === 'incorrect' ? 0.0
    : null; // unmeasurable → no score

  await query(
    `UPDATE agent_predictions
     SET outcome = ?,
         outcome_measured_at = datetime('now'),
         outcome_notes = ?,
         accuracy_score = ?
     WHERE id = ?`,
    [outcome, notes ?? null, accuracyScore, predictionId]
  );

  // Fetch the prediction to update accuracy scores for that agent
  const pred = await query(
    `SELECT product_id, agent_name FROM agent_predictions WHERE id = ?`,
    [predictionId]
  );
  if (pred.rows.length > 0) {
    const r = pred.rows[0] as Record<string, unknown>;
    await updateAccuracyScores(r.product_id as string, r.agent_name as string);
  }
}

// ─── Recompute rolling 30-day accuracy scores ──────────────────────────────────

export async function updateAccuracyScores(productId: string, agentName: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const periodStart = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);

  // Get distinct prediction_types this agent has made
  const typesResult = await query(
    `SELECT DISTINCT prediction_type FROM agent_predictions
     WHERE product_id = ? AND agent_name = ?`,
    [productId, agentName]
  );

  for (const typeRow of typesResult.rows) {
    const predictionType = (typeRow as Record<string, unknown>).prediction_type as string;

    // Aggregate stats for the rolling 30-day window
    const statsResult = await query(
      `SELECT
         COUNT(*) as total_predictions,
         COUNT(CASE WHEN outcome IS NOT NULL AND outcome != 'unmeasurable' THEN 1 END) as measured_predictions,
         COUNT(CASE WHEN outcome = 'correct' THEN 1 END) as correct_predictions,
         AVG(confidence) as avg_confidence,
         AVG(CASE WHEN accuracy_score IS NOT NULL THEN ABS(confidence - accuracy_score) END) as avg_calibration_error
       FROM agent_predictions
       WHERE product_id = ?
         AND agent_name = ?
         AND prediction_type = ?
         AND created_at >= ?`,
      [productId, agentName, predictionType, periodStart]
    );

    if (statsResult.rows.length === 0) continue;

    const stats = statsResult.rows[0] as Record<string, unknown>;
    const total = (stats.total_predictions as number) ?? 0;
    const measured = (stats.measured_predictions as number) ?? 0;
    const correct = (stats.correct_predictions as number) ?? 0;
    const avgConf = (stats.avg_confidence as number | null) ?? null;
    const calibrationError = (stats.avg_calibration_error as number | null) ?? null;

    const accuracyRate = measured > 0 ? correct / measured : null;
    // calibration_score: lower = better (0 = perfect, 1 = maximally miscalibrated)
    const calibrationScore = calibrationError;

    const scoreId = nanoid();

    await query(
      `INSERT INTO agent_accuracy_scores
         (id, product_id, agent_name, prediction_type, period_start,
          total_predictions, measured_predictions, correct_predictions,
          accuracy_rate, avg_confidence, calibration_score, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(product_id, agent_name, prediction_type, period_start)
       DO UPDATE SET
         total_predictions = excluded.total_predictions,
         measured_predictions = excluded.measured_predictions,
         correct_predictions = excluded.correct_predictions,
         accuracy_rate = excluded.accuracy_rate,
         avg_confidence = excluded.avg_confidence,
         calibration_score = excluded.calibration_score,
         updated_at = datetime('now')`,
      [
        scoreId,
        productId,
        agentName,
        predictionType,
        periodStart,
        total,
        measured,
        correct,
        accuracyRate,
        avgConf,
        calibrationScore,
      ]
    );
  }

  // Suppress unused variable warning for today
  void today;
}

// ─── Get agent accuracy report ────────────────────────────────────────────────

export async function getAgentAccuracyReport(
  productId: string,
  agentName: string
): Promise<{
  overall_accuracy: number | null;
  by_type: Array<{
    prediction_type: string;
    accuracy_rate: number;
    calibration_score: number;
    total: number;
    measured: number;
  }>;
  recent_predictions: Array<{
    text: string;
    confidence: number;
    outcome: string | null;
    measure_by_date: string;
  }>;
  trend: 'improving' | 'stable' | 'degrading';
}> {
  const now = Date.now();
  const last30Start = new Date(now - 30 * 86400 * 1000).toISOString().slice(0, 10);
  const last60Start = new Date(now - 60 * 86400 * 1000).toISOString().slice(0, 10);

  // Overall accuracy (last 30 days, all types)
  const overallResult = await query(
    `SELECT
       AVG(CASE WHEN outcome = 'correct' THEN 1.0 WHEN outcome IN ('incorrect','partial') THEN accuracy_score END) as overall_accuracy
     FROM agent_predictions
     WHERE product_id = ? AND agent_name = ?
       AND outcome IS NOT NULL AND outcome != 'unmeasurable'
       AND created_at >= ?`,
    [productId, agentName, last30Start]
  );
  const overall = (overallResult.rows[0] as Record<string, unknown>)?.overall_accuracy as number | null;

  // By-type breakdown from accuracy_scores table
  const byTypeResult = await query(
    `SELECT prediction_type, accuracy_rate, calibration_score,
            total_predictions, measured_predictions
     FROM agent_accuracy_scores
     WHERE product_id = ? AND agent_name = ?
     ORDER BY total_predictions DESC`,
    [productId, agentName]
  );

  const byType = byTypeResult.rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      prediction_type: row.prediction_type as string,
      accuracy_rate: (row.accuracy_rate as number) ?? 0,
      calibration_score: (row.calibration_score as number) ?? 0,
      total: (row.total_predictions as number) ?? 0,
      measured: (row.measured_predictions as number) ?? 0,
    };
  });

  // Recent predictions
  const recentResult = await query(
    `SELECT prediction_text, confidence, outcome, measure_by_date
     FROM agent_predictions
     WHERE product_id = ? AND agent_name = ?
     ORDER BY created_at DESC LIMIT 10`,
    [productId, agentName]
  );

  const recentPredictions = recentResult.rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      text: row.prediction_text as string,
      confidence: row.confidence as number,
      outcome: row.outcome as string | null,
      measure_by_date: row.measure_by_date as string,
    };
  });

  // Trend: compare last 30 days accuracy vs prior 30 days
  const last30AccResult = await query(
    `SELECT AVG(accuracy_score) as avg_acc
     FROM agent_predictions
     WHERE product_id = ? AND agent_name = ?
       AND outcome IS NOT NULL AND outcome != 'unmeasurable'
       AND created_at >= ?`,
    [productId, agentName, last30Start]
  );

  const prior30AccResult = await query(
    `SELECT AVG(accuracy_score) as avg_acc
     FROM agent_predictions
     WHERE product_id = ? AND agent_name = ?
       AND outcome IS NOT NULL AND outcome != 'unmeasurable'
       AND created_at >= ? AND created_at < ?`,
    [productId, agentName, last60Start, last30Start]
  );

  const last30Acc = (last30AccResult.rows[0] as Record<string, unknown>)?.avg_acc as number | null;
  const prior30Acc = (prior30AccResult.rows[0] as Record<string, unknown>)?.avg_acc as number | null;

  let trend: 'improving' | 'stable' | 'degrading' = 'stable';
  if (last30Acc !== null && prior30Acc !== null) {
    const delta = last30Acc - prior30Acc;
    if (delta >= 0.05) trend = 'improving';
    else if (delta <= -0.05) trend = 'degrading';
  }

  return {
    overall_accuracy: overall,
    by_type: byType,
    recent_predictions: recentPredictions,
    trend,
  };
}

// ─── Get calibration context string for prompt injection ──────────────────────

export async function getCalibrationContext(productId: string, agentName: string): Promise<string> {
  const last30Start = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);

  const scoresResult = await query(
    `SELECT prediction_type, accuracy_rate, avg_confidence, calibration_score,
            measured_predictions
     FROM agent_accuracy_scores
     WHERE product_id = ? AND agent_name = ?
       AND measured_predictions > 0`,
    [productId, agentName]
  );

  if (scoresResult.rows.length === 0) {
    return 'No prediction accuracy data yet — you are building your track record.';
  }

  const parts: string[] = [];
  let totalMeasured = 0;
  let totalCorrect = 0;
  let totalConf = 0;
  let totalAcc = 0;
  let n = 0;

  for (const r of scoresResult.rows) {
    const row = r as Record<string, unknown>;
    const pType = row.prediction_type as string;
    const accRate = (row.accuracy_rate as number | null) ?? 0;
    const measured = (row.measured_predictions as number) ?? 0;
    const label = pType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    parts.push(`${label}: ${Math.round(accRate * 100)}% (${measured} predictions)`);

    totalMeasured += measured;
    totalCorrect += Math.round(accRate * measured);
    totalAcc += accRate;
    totalConf += (row.avg_confidence as number | null) ?? 0;
    n++;
  }

  const overallAcc = n > 0 ? totalAcc / n : 0;
  const overallConf = n > 0 ? totalConf / n : 0;

  let calibrationNote = '';
  if (overallConf > 0 && Math.abs(overallConf - overallAcc) > 0.1) {
    if (overallConf > overallAcc) {
      const gap = Math.round((overallConf - overallAcc) * 100);
      calibrationNote = ` You tend to be overconfident — when you say ${Math.round(overallConf * 100)}% confidence, you're right ${Math.round(overallAcc * 100)}% of the time (${gap}pp gap). Calibrate accordingly.`;
    } else {
      const gap = Math.round((overallAcc - overallConf) * 100);
      calibrationNote = ` You tend to be underconfident — your ${Math.round(overallConf * 100)}% confidence predictions come true ${Math.round(overallAcc * 100)}% of the time. You can express higher confidence.`;
    }
  }

  const summary = `Your recent prediction accuracy: ${parts.join(', ')}.${calibrationNote}`;

  // Suppress unused variable warnings
  void last30Start;
  void totalMeasured;
  void totalCorrect;

  return summary;
}
