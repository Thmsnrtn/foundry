// =============================================================================
// FOUNDRY — Marketplace Intelligence
// Liquidity scoring, disintermediation risk, trust infrastructure assessment.
// =============================================================================

import { query } from '../../db/client.js';
import { callSonnet, parseJSONResponse } from '../ai/client.js';
import { nanoid } from 'nanoid';
import type { StressorReportItem } from '../../types/index.js';

/**
 * A MARKETPLACE THAT REPORTED NOTHING WAS TOLD IT WAS COLLAPSING.
 *
 * Every input here fell back to 0, and three of the stressor thresholds fire
 * BELOW a number — so a company that had never posted marketplace metrics or
 * run a trust audit came back with `liquidity_collapse`, `trust_deficit` and
 * `supply_imbalance`, and an overall health near zero.
 *
 * The same file's `assessDisintermediationRisk` fell back to 0 too, which there
 * means NO RISK — the flattering direction. One absence, two opposite readings,
 * in one file, which is the same shape the Value Delivery Index had.
 *
 * Nulls now, everywhere, and a stressor fires only on a measured value.
 */
export interface MarketplaceHealth {
  liquidity_score: number | null;
  trust_score: number | null;
  /** Null when no take rate has been reported. */
  unit_economics_healthy: boolean | null;
  /** Supply/demand balance 0-100. Null when no ratio has been reported. */
  balance_score: number | null;
  /** Weighted over the components that were measured. Null when none were. */
  overall_health: number | null;
  /** Share of the full weighting that was measured, 0-1. Null when none was. */
  coverage: number | null;
  stressors: string[];
  /** Named so a caller can say what it could not look at. */
  not_measured: string[];
}

/**
 * Compute liquidity score: composite of match rate, time-to-match, supply/demand ratio.
 */
export async function computeLiquidityScore(productId: string): Promise<number | null> {
  const result = await query(
    'SELECT * FROM marketplace_metrics WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1',
    [productId]
  );
  const m = result.rows[0] as Record<string, unknown> | undefined;
  if (!m) return null;

  // Each band is scored only if its input was reported, and the total is
  // renormalised over the bands that were. `timeToMatch ?? 999` used to land in
  // the slowest branch and still award five points for a measurement nobody had
  // taken.
  let earned = 0;
  let possible = 0;

  const matchRate = m.match_rate == null ? null : Number(m.match_rate);
  if (matchRate !== null) {
    possible += 40;
    earned += Math.min(40, matchRate * 0.4);
  }

  const timeToMatch = m.time_to_match_hours == null ? null : Number(m.time_to_match_hours);
  if (timeToMatch !== null) {
    possible += 30;
    if (timeToMatch <= 1) earned += 30;
    else if (timeToMatch <= 4) earned += 25;
    else if (timeToMatch <= 12) earned += 20;
    else if (timeToMatch <= 24) earned += 15;
    else if (timeToMatch <= 72) earned += 10;
    else earned += 5;
  }

  const sdRatio = m.supply_demand_ratio == null ? null : Number(m.supply_demand_ratio);
  if (sdRatio !== null && sdRatio > 0) {
    possible += 30;
    const balance = 1 - Math.abs(1 - sdRatio) / Math.max(1, sdRatio);
    earned += Math.max(0, balance * 30);
  }

  if (possible === 0) return null;
  return Math.round(Math.min(100, (earned / possible) * 100));
}

/**
 * Assess disintermediation risk based on transaction patterns.
 */
export async function assessDisintermediationRisk(productId: string): Promise<number | null> {
  const result = await query(
    'SELECT * FROM marketplace_metrics WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1',
    [productId]
  );
  const m = result.rows[0] as Record<string, unknown> | undefined;
  // Zero here means NO RISK, which is the opposite direction from the zeros
  // above and the more dangerous of the two to invent.
  if (!m || m.disintermediation_risk == null) return null;

  return Number(m.disintermediation_risk);
}

/**
 * Model critical mass: minimum supply per geography/category for viable matching.
 */
export async function modelCriticalMass(productId: string): Promise<{
  current_density: number | null;
  estimated_critical_mass: number | null;
  at_critical_mass: boolean | null;
}> {
  const result = await query(
    'SELECT * FROM marketplace_metrics WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1',
    [productId]
  );
  const m = result.rows[0] as Record<string, unknown> | undefined;
  // A density of 0 and a critical mass of 50 were both invented for a company
  // that had reported neither, and `at_critical_mass: false` is a verdict.
  if (!m) return { current_density: null, estimated_critical_mass: null, at_critical_mass: null };

  const supplyCount = m.supply_count == null ? null : Number(m.supply_count);
  const matchRate = m.match_rate == null ? null : Number(m.match_rate);

  // Critical mass is estimated from the current supply-to-match relationship,
  // so it needs both, and a match rate above zero to divide by.
  const estimatedCriticalMass = supplyCount !== null && matchRate !== null && matchRate > 0
    ? Math.ceil(supplyCount * (50 / matchRate))
    : null;

  return {
    current_density: supplyCount,
    estimated_critical_mass: estimatedCriticalMass,
    at_critical_mass: matchRate === null ? null : matchRate >= 50,
  };
}

/**
 * Compute overall marketplace health.
 */
export async function computeMarketplaceHealth(productId: string): Promise<MarketplaceHealth> {
  const liquidity = await computeLiquidityScore(productId);
  const disintermediation = await assessDisintermediationRisk(productId);

  // Trust score
  const trustResult = await query(
    'SELECT trust_score FROM marketplace_trust_audit WHERE product_id = ? ORDER BY audited_at DESC LIMIT 1',
    [productId]
  );
  const trustRow = trustResult.rows[0] as Record<string, number> | undefined;
  // A company that never ran a trust audit used to score 0 here, which is below
  // the `trust_deficit` threshold: it was told it had one.
  const trustScore = trustRow?.trust_score == null ? null : Number(trustRow.trust_score);

  // Supply/demand balance
  const metricsResult = await query(
    'SELECT supply_demand_ratio, take_rate, gmv, net_revenue FROM marketplace_metrics WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1',
    [productId]
  );
  const metrics = metricsResult.rows[0] as Record<string, number> | undefined;
  const sdRatio = metrics?.supply_demand_ratio == null ? null : Number(metrics.supply_demand_ratio);
  const balance = sdRatio === null || sdRatio <= 0
    ? null
    : Math.max(0, (1 - Math.abs(1 - sdRatio)) * 100);

  // Unit economics
  const takeRate = metrics?.take_rate == null ? null : Number(metrics.take_rate);
  const unitEconomicsHealthy = takeRate === null ? null : takeRate > 0.05;

  // A stressor is a finding. It fires only on a measured value — every one of
  // these thresholds is a "below", so an unmeasured zero used to trip it.
  const stressors: string[] = [];
  if (liquidity !== null && liquidity < 30) stressors.push('liquidity_collapse');
  if (disintermediation !== null && disintermediation > 50) stressors.push('disintermediation_spike');
  if (trustScore !== null && trustScore < 40) stressors.push('trust_deficit');
  if (balance !== null && balance < 30) stressors.push('supply_imbalance');

  const weighted: Array<[number | null, number]> = [
    [liquidity, 0.35], [trustScore, 0.25], [balance, 0.25],
    [unitEconomicsHealthy === null ? null : (unitEconomicsHealthy ? 100 : 0), 0.15],
  ];
  let sum = 0;
  let weightUsed = 0;
  for (const [value, weight] of weighted) {
    if (value === null) continue;
    sum += value * weight;
    weightUsed += weight;
  }
  const overall = weightUsed === 0 ? null : Math.round((sum / weightUsed) * 100) / 100;

  const notMeasured = [
    liquidity === null ? 'liquidity' : null,
    trustScore === null ? 'trust' : null,
    balance === null ? 'supply/demand balance' : null,
    unitEconomicsHealthy === null ? 'unit economics' : null,
  ].filter((x): x is string => x !== null);

  return {
    liquidity_score: liquidity,
    trust_score: trustScore,
    unit_economics_healthy: unitEconomicsHealthy,
    balance_score: balance === null ? null : Math.round(balance),
    overall_health: overall,
    coverage: weightUsed === 0 ? null : weightUsed,
    stressors,
    not_measured: notMeasured,
  };
}

/**
 * Identify marketplace-specific stressors.
 */
export async function identifyMarketplaceStressors(productId: string): Promise<StressorReportItem[]> {
  const health = await computeMarketplaceHealth(productId);
  const items: StressorReportItem[] = [];

  // Every threshold here is a "below", so an unmeasured zero raised the
  // stressor. A company that had reported nothing was told it had liquidity
  // collapse, a trust deficit and a supply imbalance at once.
  if (health.liquidity_score !== null && health.liquidity_score < 30) {
    items.push({
      name: 'Marketplace liquidity collapse',
      signal: `Liquidity score at ${health.liquidity_score}/100 — matches are not happening`,
      timeframe_days: 30,
      neutralizing_action: 'Focus on supply acquisition in highest-demand segments. Consider manual matching to bootstrap.',
      severity: 'critical',
      competitive_correlation: null,
    });
  }

  const disRisk = await assessDisintermediationRisk(productId);
  if (disRisk !== null && disRisk > 50) {
    items.push({
      name: 'Disintermediation risk elevated',
      signal: `${disRisk}% disintermediation risk — participants are transacting off-platform`,
      timeframe_days: 60,
      neutralizing_action: 'Add platform-exclusive value (escrow, insurance, reviews). Make off-platform transactions riskier.',
      severity: disRisk > 70 ? 'critical' : 'elevated',
      competitive_correlation: null,
    });
  }

  if (health.trust_score !== null && health.trust_score < 40) {
    items.push({
      name: 'Marketplace trust deficit',
      signal: `Trust infrastructure score ${health.trust_score}/100`,
      timeframe_days: 45,
      neutralizing_action: 'Implement ratings, identity verification, or dispute resolution.',
      severity: 'elevated',
      competitive_correlation: null,
    });
  }

  if (health.balance_score !== null && health.balance_score < 30) {
    items.push({
      name: 'Supply/demand imbalance',
      signal: `Balance score ${health.balance_score}/100 — one side significantly outweighs the other`,
      timeframe_days: 45,
      neutralizing_action: 'Identify which side is deficient and run targeted acquisition for that side.',
      severity: 'elevated',
      competitive_correlation: null,
    });
  }

  return items;
}

/**
 * Audit trust infrastructure for a marketplace product.
 */
export async function auditTrustInfrastructure(
  productId: string,
  ownerId: string,
  trustData: {
    has_ratings: boolean;
    has_identity_verification: boolean;
    has_dispute_resolution: boolean;
    has_payment_escrow: boolean;
    has_quality_standards: boolean;
    has_insurance_guarantee: boolean;
  }
): Promise<{ trust_score: number; findings: string[] }> {
  const components = [
    { name: 'ratings', present: trustData.has_ratings, weight: 25 },
    { name: 'identity_verification', present: trustData.has_identity_verification, weight: 20 },
    { name: 'dispute_resolution', present: trustData.has_dispute_resolution, weight: 20 },
    { name: 'payment_escrow', present: trustData.has_payment_escrow, weight: 15 },
    { name: 'quality_standards', present: trustData.has_quality_standards, weight: 10 },
    { name: 'insurance_guarantee', present: trustData.has_insurance_guarantee, weight: 10 },
  ];

  const trustScore = components.reduce((sum, c) => sum + (c.present ? c.weight : 0), 0);
  const findings = components
    .filter((c) => !c.present)
    .map((c) => `Missing ${c.name.replace(/_/g, ' ')} — adds ${c.weight} points to trust score`);

  // Persist
  await query(
    `INSERT INTO marketplace_trust_audit (id, product_id, owner_id, has_ratings, has_identity_verification, has_dispute_resolution, has_payment_escrow, has_quality_standards, has_insurance_guarantee, trust_score, findings)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(), productId, ownerId,
      trustData.has_ratings ? 1 : 0,
      trustData.has_identity_verification ? 1 : 0,
      trustData.has_dispute_resolution ? 1 : 0,
      trustData.has_payment_escrow ? 1 : 0,
      trustData.has_quality_standards ? 1 : 0,
      trustData.has_insurance_guarantee ? 1 : 0,
      trustScore,
      JSON.stringify(findings),
    ]
  );

  return { trust_score: trustScore, findings };
}
