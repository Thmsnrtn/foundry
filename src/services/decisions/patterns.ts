// =============================================================================
// FOUNDRY — Decision Patterns (Cross-Product Learning Loop)
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
import type { DecisionPattern, OutcomeDirection, OutcomeMagnitude, RiskStateValue } from '../../types/index.js';

export async function generatePatternFromOutcome(input: {
  decisionType: string;
  lifecycleStage: string;
  riskState: RiskStateValue;
  metricsContext: Record<string, unknown>;
  optionChosen: string;
  outcomeDirection: OutcomeDirection;
  outcomeMagnitude: OutcomeMagnitude;
  outcomeTimeframeDays: number;
  marketCategory: string | null;
  contributingFactors: Record<string, unknown> | null;
  scenarioAccuracyScore: number | null;
}): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO decision_patterns (id, decision_type, product_lifecycle_stage, risk_state_at_decision, key_metrics_context, option_chosen_category, outcome_direction, outcome_magnitude, outcome_timeframe_days, market_category, contributing_factors, scenario_accuracy_score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.decisionType, input.lifecycleStage, input.riskState, JSON.stringify(input.metricsContext),
     input.optionChosen, input.outcomeDirection, input.outcomeMagnitude, input.outcomeTimeframeDays,
     input.marketCategory, input.contributingFactors ? JSON.stringify(input.contributingFactors) : null,
     input.scenarioAccuracyScore]
  );
  return id;
}

export async function getPatternStats(): Promise<{
  total: number;
  byType: Record<string, number>;
  avgAccuracy: number | null;
}> {
  const totalResult = await query('SELECT COUNT(*) as count FROM decision_patterns', []);
  const total = (totalResult.rows[0] as Record<string, number>)?.count ?? 0;

  const typeResult = await query(
    'SELECT decision_type, COUNT(*) as count FROM decision_patterns GROUP BY decision_type', []
  );
  const byType: Record<string, number> = {};
  for (const row of typeResult.rows) {
    const r = row as Record<string, unknown>;
    byType[r.decision_type as string] = r.count as number;
  }

  const accResult = await query(
    'SELECT AVG(scenario_accuracy_score) as avg FROM decision_patterns WHERE scenario_accuracy_score IS NOT NULL', []
  );
  const avgAccuracy = (accResult.rows[0] as Record<string, number | null>)?.avg ?? null;

  return { total, byType, avgAccuracy };
}
