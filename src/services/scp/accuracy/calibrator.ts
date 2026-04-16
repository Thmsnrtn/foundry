// =============================================================================
// FOUNDRY — Agent Accuracy Calibrator
// Feeds prediction accuracy back into BaseAgent context via prompt injection.
// =============================================================================

import { getCalibrationContext, recordPrediction } from './tracker.js';
import { query } from '../../../db/client.js';

// ─── Get accuracy prompt addendum ─────────────────────────────────────────────

/**
 * Returns a calibration context string to inject into agent prompts, if there
 * is enough data (>= 5 measured predictions). Returns null otherwise.
 */
export async function getAccuracyPromptAddendum(
  productId: string,
  agentName: string
): Promise<string | null> {
  // Check if we have at least 5 measured predictions
  const countResult = await query(
    `SELECT COUNT(*) as cnt FROM agent_predictions
     WHERE product_id = ? AND agent_name = ?
       AND outcome IS NOT NULL AND outcome != 'unmeasurable'`,
    [productId, agentName]
  );

  const count = (countResult.rows[0] as Record<string, unknown>)?.cnt as number ?? 0;
  if (count < 5) return null;

  const context = await getCalibrationContext(productId, agentName);
  return context;
}

// ─── Extract predictions from analysis output ──────────────────────────────────

/**
 * Auto-extracts structured predictions from an agent's analysis output and
 * records them in agent_predictions for future measurement.
 */
export async function extractPredictionsFromAnalysis(
  productId: string,
  agentName: string,
  sessionId: string,
  analysis: {
    customerSignals?: Array<{ external_id: string; note?: string }>;
    outboundActions?: Array<{ action_type: string; description: string; estimated_value_usd?: number }>;
    hypotheses?: Array<{ title: string; description: string; success_threshold: number; test_duration_days: number }>;
  }
): Promise<void> {
  const promises: Promise<string>[] = [];

  // Customer signals with 'churn' in note → 'churn_risk' prediction
  if (analysis.customerSignals) {
    for (const signal of analysis.customerSignals) {
      if (signal.note && signal.note.toLowerCase().includes('churn')) {
        promises.push(
          recordPrediction({
            productId,
            agentName,
            sessionId,
            predictionType: 'churn_risk',
            predictionText: `Customer ${signal.external_id} will churn — ${signal.note.slice(0, 150)}`,
            confidence: 0.7,
            measureByDays: 30,
            outcomeCriteria: `customer_id=${signal.external_id}`,
          })
        );
      }
    }
  }

  // Outbound actions with action_type containing 'expansion' → 'expansion_opportunity'
  if (analysis.outboundActions) {
    for (const action of analysis.outboundActions) {
      if (action.action_type.toLowerCase().includes('expansion')) {
        promises.push(
          recordPrediction({
            productId,
            agentName,
            sessionId,
            predictionType: 'expansion_opportunity',
            predictionText: `Expansion opportunity: ${action.description.slice(0, 200)}`,
            predictedValue: action.estimated_value_usd
              ? action.estimated_value_usd / 10000 // normalize to rough probability
              : undefined,
            confidence: 0.65,
            measureByDays: 45,
            outcomeCriteria: `action_type=expansion`,
          })
        );
      }
    }
  }

  // Hypotheses → 'experiment_outcome' predictions
  if (analysis.hypotheses) {
    for (const hyp of analysis.hypotheses) {
      promises.push(
        recordPrediction({
          productId,
          agentName,
          sessionId,
          predictionType: 'experiment_outcome',
          predictionText: `Experiment "${hyp.title}" will achieve ${Math.round(hyp.success_threshold * 100)}% improvement — ${hyp.description.slice(0, 150)}`,
          predictedValue: hyp.success_threshold,
          confidence: hyp.success_threshold,
          measureByDays: hyp.test_duration_days,
          outcomeCriteria: `experiment_id=${hyp.title.toLowerCase().replace(/\s+/g, '_').slice(0, 50)}`,
        })
      );
    }
  }

  // Fire all prediction records concurrently, non-fatal
  await Promise.allSettled(promises);
}
