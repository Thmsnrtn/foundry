// =============================================================================
// FOUNDRY — Decision Patterns (Cross-Product Learning Loop)
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
import { hasConsent } from '../privacy/consent.js';
import type { DecisionPattern, OutcomeDirection, OutcomeMagnitude, RiskStateValue } from '../../types/index.js';

export async function generatePatternFromOutcome(input: {
  productId: string;
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
}): Promise<string | null> {
  // DEFECT-0044: Cross-company decision patterns must not be written without consent
  if (!(await hasConsent(input.productId, 'cross_company_patterns'))) return null;

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

// ─── Cross-product peer signal reader (Phase 4.1) ────────────────────────────

export interface PeerSignal {
  sampleSize: number;
  decisionType: string;
  lifecycleStage: string;
  /** Most-chosen option category among peers. */
  dominantOption: string;
  dominantOptionCount: number;
  /** Fraction (0–1) of the dominant option's outcomes that were positive. */
  positiveRate: number;
  /** Human-readable one-liner for the briefing / decision queue. */
  summary: string;
}

/** Below this many matching peer outcomes, we abstain rather than mislead. */
export const PEER_SIGNAL_MIN_SAMPLE = 5;

/**
 * "Founders at your stage who chose X saw Y." Reads anonymized cross-product
 * outcomes for a decision type + lifecycle stage (optionally scoped to a
 * market), and returns the dominant peer choice with its positive-outcome rate.
 * Returns null when there aren't enough peers (n < PEER_SIGNAL_MIN_SAMPLE) — an
 * honest abstention beats a confident number built on 2 data points.
 */
export async function getPeerSignal(input: {
  decisionType: string;
  lifecycleStage: string;
  marketCategory?: string | null;
  minSampleSize?: number;
}): Promise<PeerSignal | null> {
  const minSample = input.minSampleSize ?? PEER_SIGNAL_MIN_SAMPLE;

  const clauses = ['decision_type = ?', 'product_lifecycle_stage = ?'];
  const args: unknown[] = [input.decisionType, input.lifecycleStage];
  if (input.marketCategory) {
    clauses.push('market_category = ?');
    args.push(input.marketCategory);
  }

  const result = await query(
    `SELECT option_chosen_category, outcome_direction
       FROM decision_patterns
      WHERE ${clauses.join(' AND ')}`,
    args,
  );

  const rows = result.rows as Array<Record<string, unknown>>;
  if (rows.length < minSample) return null; // abstain

  // Tally outcomes per chosen option.
  const byOption = new Map<string, { total: number; positive: number }>();
  for (const r of rows) {
    const option = String(r.option_chosen_category);
    const entry = byOption.get(option) ?? { total: 0, positive: 0 };
    entry.total++;
    if (r.outcome_direction === 'positive') entry.positive++;
    byOption.set(option, entry);
  }

  // Dominant = most-chosen option (ties broken by higher positive count).
  let dominantOption = '';
  let best = { total: 0, positive: 0 };
  for (const [option, entry] of byOption) {
    if (entry.total > best.total || (entry.total === best.total && entry.positive > best.positive)) {
      dominantOption = option;
      best = entry;
    }
  }

  const positiveRate = best.total > 0 ? best.positive / best.total : 0;
  const pct = Math.round(positiveRate * 100);
  const stage = input.lifecycleStage.replace(/_/g, ' ');
  const summary =
    `${best.total} founder${best.total === 1 ? '' : 's'} at your stage (${stage}) who chose ` +
    `"${dominantOption.replace(/_/g, ' ')}" saw a positive outcome ${pct}% of the time.`;

  return {
    sampleSize: rows.length,
    decisionType: input.decisionType,
    lifecycleStage: input.lifecycleStage,
    dominantOption,
    dominantOptionCount: best.total,
    positiveRate,
    summary,
  };
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
