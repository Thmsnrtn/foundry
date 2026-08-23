// =============================================================================
// FOUNDRY — Predictive Intelligence Engine
//
// Pre-stressor detection and probability forecasts, from this company's own
// trajectory and from the cross-company pattern signal.
//
// THIS HEADER SAID "LEADING INDICATORS" AND NOTHING HERE HAS ONE. Migration 023
// created a `leading_indicators` table beside `predictions` — sector, indicator,
// what it predicts, lead time, confidence, sample size — and nothing ever wrote
// a row or read one. Those columns describe an empirical body of knowledge, and
// Foundry has never had a way to establish any of the numbers in them; filling
// them would have meant writing them down. Migration 205 removed the table, and
// this header no longer claims it.
//
// The honest version of that idea is live under another name:
// `network/failure-library.ts` holds named shapes with match criteria the
// engine evaluates against a company's real metrics, and a lead time it labels
// as a rule of thumb rather than a measurement.
// =============================================================================

import { query } from '../../db/client.js';
import { callOpus, parseJSONResponse } from '../ai/client.js';
import { nanoid } from 'nanoid';
import type { GrowthStage, RiskStateValue } from '../../types/index.js';
import { PEER_SIGNAL_MIN_SAMPLE } from '../decisions/patterns.js';

export interface Prediction {
  id: string;
  prediction_type: string;
  description: string;
  probability: number;
  time_horizon_days: number;
  evidence: string[];
  recommended_action: string;
}

/**
 * Run the predictive engine for a product.
 * Analyzes current trajectory against cross-product patterns to identify
 * problems BEFORE they manifest as stressors.
 */
export async function generatePredictions(productId: string, ownerId: string): Promise<Prediction[]> {
  const predictions: Prediction[] = [];

  // 1. Churn prediction from metric trajectory
  const churnPrediction = await predictChurnSpike(productId);
  if (churnPrediction) predictions.push(churnPrediction);

  // 2. Revenue plateau prediction
  const revenuePrediction = await predictRevenuePlateau(productId);
  if (revenuePrediction) predictions.push(revenuePrediction);

  // 3. Pattern-based prediction from cross-product data
  const patternPredictions = await predictFromPatterns(productId);
  predictions.push(...patternPredictions);

  // 4. Founder burnout prediction
  const burnoutPrediction = await predictFounderBurnout(ownerId);
  if (burnoutPrediction) predictions.push(burnoutPrediction);

  // Persist predictions
  for (const p of predictions) {
    p.id = nanoid();
    await query(
      `INSERT INTO predictions (id, product_id, owner_id, prediction_type, description, probability, time_horizon_days, evidence, recommended_action, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [p.id, productId, ownerId, p.prediction_type, p.description, p.probability, p.time_horizon_days, JSON.stringify(p.evidence), p.recommended_action]
    );
  }

  return predictions;
}

/**
 * Predict churn spike from metric trajectory.
 */
async function predictChurnSpike(productId: string): Promise<Prediction | null> {
  const metrics = await query(
    'SELECT churn_rate, day_30_retention, activation_rate, snapshot_date FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 8',
    [productId]
  );
  if (metrics.rows.length < 4) return null;

  const rows = metrics.rows as unknown as Array<Record<string, number>>;
  const churnRates = rows.map((r) => r.churn_rate ?? 0).filter((r) => r > 0);
  if (churnRates.length < 3) return null;

  // Detect acceleration: is the rate of change of churn increasing?
  const deltas = [];
  for (let i = 0; i < churnRates.length - 1; i++) {
    deltas.push(churnRates[i]! - churnRates[i + 1]!);
  }

  const recentDelta = deltas.slice(0, 2).reduce((a, b) => a + b, 0) / 2;
  const olderDelta = deltas.slice(2).reduce((a, b) => a + b, 0) / Math.max(1, deltas.length - 2);

  // Accelerating churn = recent delta significantly > older delta
  if (recentDelta > olderDelta + 0.5 && recentDelta > 0) {
    const probability = Math.min(0.85, 0.5 + (recentDelta - olderDelta) * 0.1);
    return {
      id: '',
      prediction_type: 'churn_spike',
      description: `Churn is accelerating. Current trajectory suggests a ${(probability * 100).toFixed(0)}% chance of a significant churn spike within 30-60 days.`,
      probability,
      time_horizon_days: 45,
      evidence: [
        `Recent churn acceleration: +${recentDelta.toFixed(2)}%/period`,
        `Historical baseline: +${olderDelta.toFixed(2)}%/period`,
        `Latest churn rate: ${churnRates[0]!.toFixed(1)}%`,
      ],
      recommended_action: 'Investigate the root cause immediately. Check recent cohort quality, onboarding changes, or competitive moves. Act before the spike materializes.',
    };
  }

  return null;
}

/**
 * Predict revenue plateau from growth deceleration.
 */
async function predictRevenuePlateau(productId: string): Promise<Prediction | null> {
  const metrics = await query(
    'SELECT new_mrr_cents, expansion_mrr_cents, snapshot_date FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 12',
    [productId]
  );
  if (metrics.rows.length < 6) return null;

  const rows = metrics.rows as unknown as Array<Record<string, number>>;
  const revenues = rows.map((r) => (r.new_mrr_cents ?? 0) + (r.expansion_mrr_cents ?? 0));

  // Calculate growth rates
  const growthRates = [];
  for (let i = 0; i < revenues.length - 1; i++) {
    const prev = revenues[i + 1]!;
    if (prev > 0) growthRates.push((revenues[i]! - prev) / prev);
  }

  if (growthRates.length < 4) return null;

  // Consistent deceleration = each recent period slower than the last
  const recent = growthRates.slice(0, 3);
  const isDecelerating = recent.every((r, i) => i === 0 || r <= recent[i - 1]!);
  const avgRecentGrowth = recent.reduce((a, b) => a + b, 0) / recent.length;

  if (isDecelerating && avgRecentGrowth < 0.05 && avgRecentGrowth > -0.02) {
    return {
      id: '',
      prediction_type: 'revenue_plateau',
      description: `Growth is consistently decelerating toward zero. At current trajectory, MRR will plateau within 60-90 days.`,
      probability: 0.65,
      time_horizon_days: 75,
      evidence: [
        `Recent growth rates: ${recent.map((r) => (r * 100).toFixed(1) + '%').join(' → ')}`,
        `Average recent growth: ${(avgRecentGrowth * 100).toFixed(1)}%/period`,
      ],
      recommended_action: 'This is the inflection point. Either expand TAM (new segments, geographies) or deepen (upsell, pricing increase, new value-adds). Status quo leads to plateau.',
    };
  }

  return null;
}

/**
 * Use cross-product patterns to predict outcomes.
 */
async function predictFromPatterns(productId: string): Promise<Prediction[]> {
  const product = await query('SELECT sector_profile, growth_stage FROM products WHERE id = ?', [productId]);
  const p = product.rows[0] as Record<string, string> | undefined;
  if (!p) return [];

  // Find patterns from similar products that had negative outcomes
  // "${cnt} similar products saw negative outcomes" is a claim about a
  // POPULATION, and cnt was a row count: three rows from one company said three
  // products. Counted by distinct contributor now, and floored at the same
  // number as every other peer reader rather than a third one invented here.
  const patterns = await query(
    `SELECT decision_type, option_chosen_category, outcome_direction, outcome_timeframe_days,
            COUNT(DISTINCT contributor_hash) as cnt
     FROM decision_patterns
     WHERE market_category = ? AND product_lifecycle_stage = ? AND outcome_direction = 'negative'
       AND contributor_hash IS NOT NULL
     GROUP BY decision_type, option_chosen_category
     HAVING cnt >= ?
     LIMIT 5`,
    [p.sector_profile ?? 'b2b_saas', p.growth_stage ?? 'growth', PEER_SIGNAL_MIN_SAMPLE]
  );

  if (patterns.rows.length === 0) return [];

  // Check if current product has pending/recent decisions matching these patterns
  const predictions: Prediction[] = [];
  for (const pattern of patterns.rows as unknown as Array<Record<string, unknown>>) {
    const matching = await query(
      `SELECT id, what FROM decisions WHERE product_id = ? AND category = ? AND status = 'pending'`,
      [productId, pattern.decision_type]
    );

    if (matching.rows.length > 0) {
      const cnt = pattern.cnt as number;
      const prob = Math.min(0.75, 0.3 + cnt * 0.05);
      predictions.push({
        id: '',
        prediction_type: 'pattern_warning',
        description: `Products similar to yours that chose "${pattern.option_chosen_category}" for ${pattern.decision_type} decisions had negative outcomes ${cnt} times. Proceed with caution.`,
        probability: prob,
        time_horizon_days: (pattern.outcome_timeframe_days as number) ?? 60,
        evidence: [`${cnt} similar products saw negative outcomes`, `Pattern: ${pattern.decision_type} → ${pattern.option_chosen_category}`],
        recommended_action: 'Consider the alternative options for this decision. The pattern data suggests the default choice may not work at your stage.',
      });
    }
  }

  return predictions;
}

/**
 * Predict founder burnout from engagement trajectory.
 */
async function predictFounderBurnout(founderId: string): Promise<Prediction | null> {
  const snapshots = await query(
    'SELECT motivation_score, engagement_trend FROM founder_health_snapshots WHERE founder_id = ? ORDER BY snapshot_date DESC LIMIT 7',
    [founderId]
  );
  if (snapshots.rows.length < 3) return null;

  // Same substitution as `founder-health.ts` carried: a snapshot with no
  // motivation score counted as 50 in a prediction about a person.
  const scores = (snapshots.rows as unknown as Array<Record<string, unknown>>)
    .map((s) => s.motivation_score)
    .filter((v): v is number => v !== null && v !== undefined)
    .map(Number);

  // A burnout prediction about a person needs snapshots of that person. Three
  // rows of which two had no score used to become three scores of 50.
  if (scores.length < 3) return null;

  const isConsistentDecline = scores.every((s, i) => i === 0 || s <= scores[i - 1]!);
  const latest = scores[0]!;
  const oldest = scores[scores.length - 1]!;
  const totalDrop = oldest - latest;

  if (isConsistentDecline && totalDrop > 15 && latest < 50) {
    const probability = Math.min(0.80, 0.4 + totalDrop * 0.01);
    return {
      id: '',
      prediction_type: 'founder_burnout',
      description: `Your engagement has been declining consistently. At this trajectory, burnout risk becomes critical within 2-4 weeks.`,
      probability,
      time_horizon_days: 21,
      evidence: [
        `Motivation score: ${oldest} → ${latest} (${totalDrop} point drop)`,
        `Consistent decline across ${scores.length} measurement periods`,
      ],
      recommended_action: 'This is not a product problem — it\'s a founder sustainability problem. Consider: reducing scope, taking a break, finding a co-founder or advisor, or adjusting your timeline expectations.',
    };
  }

  return null;
}

/**
 * Get active predictions for a product.
 */
export async function getActivePredictions(productId: string): Promise<Prediction[]> {
  const result = await query(
    `SELECT * FROM predictions WHERE product_id = ? AND status = 'active' ORDER BY probability DESC`,
    [productId]
  );
  return (result.rows as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    prediction_type: row.prediction_type as string,
    description: row.description as string,
    probability: row.probability as number,
    time_horizon_days: row.time_horizon_days as number,
    evidence: JSON.parse(row.evidence as string),
    recommended_action: row.recommended_action as string,
  }));
}

/**
 * Record an outcome for a prediction (for accuracy tracking).
 */
export async function recordPredictionOutcome(
  predictionId: string,
  outcome: 'correct' | 'incorrect' | 'partially_correct',
  ownerId: string
): Promise<void> {
  const accuracy = outcome === 'correct' ? 1.0 : outcome === 'partially_correct' ? 0.5 : 0.0;
  await query(
    `UPDATE predictions SET status = 'resolved', outcome = ?, outcome_recorded_at = datetime('now'), accuracy_score = ?
     WHERE id = ? AND product_id IN (SELECT id FROM products WHERE owner_id = ?)`,
    [outcome, accuracy, predictionId, ownerId]
  );
}
