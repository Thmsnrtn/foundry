// =============================================================================
// FOUNDRY — Marketplace Intelligence
// Liquidity scoring, disintermediation risk, trust infrastructure assessment.
// =============================================================================

import { query } from '../../db/client.js';
import { callSonnet, parseJSONResponse } from '../ai/client.js';
import { nanoid } from 'nanoid';
import type { StressorReportItem } from '../../types/index.js';

export interface MarketplaceHealth {
  liquidity_score: number;
  trust_score: number;
  unit_economics_healthy: boolean;
  balance_score: number; // supply/demand balance 0-100
  overall_health: number;
  stressors: string[];
}

/**
 * Compute liquidity score: composite of match rate, time-to-match, supply/demand ratio.
 */
export async function computeLiquidityScore(productId: string): Promise<number> {
  const result = await query(
    'SELECT * FROM marketplace_metrics WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1',
    [productId]
  );
  const m = result.rows[0] as Record<string, unknown> | undefined;
  if (!m) return 0;

  let score = 0;
  const matchRate = (m.match_rate as number) ?? 0;
  const timeToMatch = (m.time_to_match_hours as number) ?? 999;
  const sdRatio = (m.supply_demand_ratio as number) ?? 0;

  // Match rate: 0-40 points
  score += Math.min(40, matchRate * 0.4);

  // Time to match: 0-30 points (faster = better)
  if (timeToMatch <= 1) score += 30;
  else if (timeToMatch <= 4) score += 25;
  else if (timeToMatch <= 12) score += 20;
  else if (timeToMatch <= 24) score += 15;
  else if (timeToMatch <= 72) score += 10;
  else score += 5;

  // Supply/demand balance: 0-30 points (closer to 1.0 = better)
  if (sdRatio > 0) {
    const balance = 1 - Math.abs(1 - sdRatio) / Math.max(1, sdRatio);
    score += Math.max(0, balance * 30);
  }

  return Math.round(Math.min(100, score));
}

/**
 * Assess disintermediation risk based on transaction patterns.
 */
export async function assessDisintermediationRisk(productId: string): Promise<number> {
  const result = await query(
    'SELECT * FROM marketplace_metrics WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1',
    [productId]
  );
  const m = result.rows[0] as Record<string, unknown> | undefined;
  if (!m) return 0;

  return (m.disintermediation_risk as number) ?? 0;
}

/**
 * Model critical mass: minimum supply per geography/category for viable matching.
 */
export async function modelCriticalMass(productId: string): Promise<{
  current_density: number;
  estimated_critical_mass: number;
  at_critical_mass: boolean;
}> {
  const result = await query(
    'SELECT * FROM marketplace_metrics WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1',
    [productId]
  );
  const m = result.rows[0] as Record<string, unknown> | undefined;
  if (!m) return { current_density: 0, estimated_critical_mass: 50, at_critical_mass: false };

  const supplyCount = (m.supply_count as number) ?? 0;
  const matchRate = (m.match_rate as number) ?? 0;

  // Simple heuristic: critical mass is when match rate exceeds 50%
  // Estimate using current supply-to-match relationship
  const estimatedCriticalMass = matchRate > 0
    ? Math.ceil(supplyCount * (50 / matchRate))
    : 50;

  return {
    current_density: supplyCount,
    estimated_critical_mass: estimatedCriticalMass,
    at_critical_mass: matchRate >= 50,
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
  const trustScore = (trustResult.rows[0] as Record<string, number> | undefined)?.trust_score ?? 0;

  // Supply/demand balance
  const metricsResult = await query(
    'SELECT supply_demand_ratio, take_rate, gmv, net_revenue FROM marketplace_metrics WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1',
    [productId]
  );
  const metrics = metricsResult.rows[0] as Record<string, number> | undefined;
  const sdRatio = metrics?.supply_demand_ratio ?? 0;
  const balance = sdRatio > 0 ? Math.max(0, (1 - Math.abs(1 - sdRatio)) * 100) : 0;

  // Unit economics
  const takeRate = metrics?.take_rate ?? 0;
  const unitEconomicsHealthy = takeRate > 0.05; // Take rate above 5%

  // Identify stressors
  const stressors: string[] = [];
  if (liquidity < 30) stressors.push('liquidity_collapse');
  if (disintermediation > 50) stressors.push('disintermediation_spike');
  if (trustScore < 40) stressors.push('trust_deficit');
  if (balance < 30) stressors.push('supply_imbalance');

  const overall = Math.round((liquidity * 0.35 + trustScore * 0.25 + balance * 0.25 + (unitEconomicsHealthy ? 15 : 0)) * 100) / 100;

  return {
    liquidity_score: liquidity,
    trust_score: trustScore,
    unit_economics_healthy: unitEconomicsHealthy,
    balance_score: Math.round(balance),
    overall_health: overall,
    stressors,
  };
}

/**
 * Identify marketplace-specific stressors.
 */
export async function identifyMarketplaceStressors(productId: string): Promise<StressorReportItem[]> {
  const health = await computeMarketplaceHealth(productId);
  const items: StressorReportItem[] = [];

  if (health.liquidity_score < 30) {
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
  if (disRisk > 50) {
    items.push({
      name: 'Disintermediation risk elevated',
      signal: `${disRisk}% disintermediation risk — participants are transacting off-platform`,
      timeframe_days: 60,
      neutralizing_action: 'Add platform-exclusive value (escrow, insurance, reviews). Make off-platform transactions riskier.',
      severity: disRisk > 70 ? 'critical' : 'elevated',
      competitive_correlation: null,
    });
  }

  if (health.trust_score < 40) {
    items.push({
      name: 'Marketplace trust deficit',
      signal: `Trust infrastructure score ${health.trust_score}/100`,
      timeframe_days: 45,
      neutralizing_action: 'Implement ratings, identity verification, or dispute resolution.',
      severity: 'elevated',
      competitive_correlation: null,
    });
  }

  if (health.balance_score < 30) {
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
