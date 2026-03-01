// =============================================================================
// FOUNDRY — Scenario Modeling Engine
// Generates best/base/stress scenarios for Gate 3 decisions.
// Uses product history + cross-product decision patterns.
// =============================================================================

import { callOpus, parseJSONResponse } from '../ai/client.js';
import { query, getRelevantPatterns } from '../../db/client.js';
import { buildWisdomContext } from '../wisdom/dna.js';
import { nanoid } from 'nanoid';
import type { Decision, DecisionPattern, ScenarioModel, RiskStateValue } from '../../types/index.js';

interface ScenarioInput {
  decision: Decision;
  productId: string;
  productName: string;
  lifecycleStage: string;
  riskState: RiskStateValue;
  marketCategory: string | null;
  historicalMetrics: string;
  cohortData: string;
  stressorHistory: string;
}

interface ScenarioOutput {
  option_label: string;
  best_case: { narrative: string; metrics_30d: Record<string, number>; metrics_60d: Record<string, number>; metrics_90d: Record<string, number>; probability: number };
  base_case: { narrative: string; metrics_30d: Record<string, number>; metrics_60d: Record<string, number>; metrics_90d: Record<string, number>; probability: number };
  stress_case: { narrative: string; metrics_30d: Record<string, number>; metrics_60d: Record<string, number>; metrics_90d: Record<string, number>; probability: number; what_breaks: string; time_to_impact: string; recovery_requirements: string };
}

export async function generateScenarios(input: ScenarioInput): Promise<ScenarioModel[]> {
  const options: Array<{ label: string; description: string }> = input.decision.options
    ? (input.decision.options as Array<{ label: string; description: string }>)
    : [];

  if (options.length === 0) return [];

  // Find relevant cross-product patterns (3 of 5 dimension match)
  const patternResult = await getRelevantPatterns(
    input.decision.category ?? '',
    input.lifecycleStage,
    input.riskState,
    input.marketCategory
  );

  const candidatePatterns = patternResult.rows as unknown as DecisionPattern[];
  const relevantPatterns = filterByDimensionMatch(candidatePatterns, {
    decisionType: input.decision.category ?? '',
    lifecycleStage: input.lifecycleStage,
    riskState: input.riskState,
    marketCategory: input.marketCategory,
  });

  const patternContext = relevantPatterns.length > 0
    ? `The following anonymized outcomes from similar decisions on similar products are provided as additional context. Weight them alongside this product's own history.\n${JSON.stringify(relevantPatterns.slice(0, 5))}`
    : 'Limited cross-product data available. Scenarios based primarily on individual history.';

  // Inject wisdom context
  const wisdomCtx = await buildWisdomContext(input.productId, input.decision.category ?? undefined);
  const wisdomBlock = wisdomCtx.dna_context;

  const systemPrompt = `You are a scenario modeling engine. For each decision option, generate three forward scenarios: best case, base case, and stress case.

Each scenario must include:
- Narrative description
- Projected key metrics at 30, 60, and 90 days
- Probability estimate

Stress case must additionally include: what breaks, time to impact, recovery requirements.

Scenarios MUST use the product's own historical data. Cross-product patterns supplement but never replace individual data.
When Product Wisdom includes judgment patterns, weight options aligning with those patterns more heavily in the base case and note the alignment explicitly. When a proposed option conflicts with a documented failure, flag this in the stress case.

Current risk state: ${input.riskState}

${patternContext}

${wisdomBlock}

Respond in JSON: array of objects with option_label, best_case, base_case, stress_case.`;

  const userPrompt = `Decision: ${input.decision.what}
Why now: ${input.decision.why_now}
Options: ${JSON.stringify(options)}
Product: ${input.productName}
Historical metrics: ${input.historicalMetrics}
Cohort data: ${input.cohortData}
Stressor history: ${input.stressorHistory}`;

  const response = await callOpus(systemPrompt, userPrompt, 8192);
  const scenarios = parseJSONResponse<ScenarioOutput[]>(response.content);

  const models: ScenarioModel[] = [];
  for (const scenario of scenarios) {
    const id = nanoid();
    await query(
      `INSERT INTO scenario_models (id, decision_id, product_id, option_label, best_case, base_case, stress_case, data_inputs_used, patterns_referenced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, input.decision.id, input.productId, scenario.option_label,
        JSON.stringify(scenario.best_case), JSON.stringify(scenario.base_case), JSON.stringify(scenario.stress_case),
        JSON.stringify(['historical_metrics', 'cohort_data', 'stressor_history']),
        JSON.stringify(relevantPatterns.map((p) => p.id)),
      ]
    );

    models.push({
      id, decision_id: input.decision.id, product_id: input.productId,
      option_label: scenario.option_label,
      best_case: scenario.best_case as ScenarioModel['best_case'],
      base_case: scenario.base_case as ScenarioModel['base_case'],
      stress_case: scenario.stress_case as ScenarioModel['stress_case'],
      data_inputs_used: ['historical_metrics', 'cohort_data', 'stressor_history'],
      patterns_referenced: relevantPatterns.map((p) => p.id),
      created_at: new Date().toISOString(),
      outcome_accuracy: null,
    });
  }

  return models;
}

function filterByDimensionMatch(
  candidates: DecisionPattern[],
  criteria: { decisionType: string; lifecycleStage: string; riskState: string; marketCategory: string | null }
): DecisionPattern[] {
  return candidates.filter((p) => {
    let matches = 0;
    if (p.decision_type === criteria.decisionType) matches++;
    if (p.product_lifecycle_stage === criteria.lifecycleStage) matches++;
    if (p.risk_state_at_decision === criteria.riskState) matches++;
    if (criteria.marketCategory && p.market_category === criteria.marketCategory) matches++;
    // 5th dimension: metric context range — simplified to count 4 max
    return matches >= 3;
  });
}
