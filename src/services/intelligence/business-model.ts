// =============================================================================
// FOUNDRY — Business Model Intelligence
// Unit economics, revenue model classification, services disguise detection.
// =============================================================================

import { query } from '../../db/client.js';
import { callOpus, callSonnet, parseJSONResponse } from '../ai/client.js';
import { nanoid } from 'nanoid';
import type { StressorReportItem } from '../../types/index.js';

export interface UnitEconomics {
  arpu: number;
  cogs_per_customer: number;
  contribution_margin: number;
  cac: number;
  cac_payback_months: number;
  ltv: number;
  ltv_cac_ratio: number;
  gross_margin: number;
}

export interface BusinessModelProfile {
  revenue_model: string;
  unit_economics: UnitEconomics | null;
  is_seasonal: boolean;
  services_revenue_percentage: number;
  pricing_to_value_ratio: number | null;
}

const VALID_REVENUE_MODELS = [
  'subscription', 'transaction', 'usage_based', 'marketplace_commission',
  'freemium', 'open_core', 'grant_funded', 'hybrid',
];

/**
 * Auto-detect revenue model from metrics patterns.
 */
export async function classifyRevenueModel(productId: string): Promise<string> {
  const existing = await query('SELECT revenue_model FROM business_model_profile WHERE product_id = ?', [productId]);
  if (existing.rows.length > 0) {
    return (existing.rows[0] as Record<string, string>).revenue_model;
  }

  const metrics = await query(
    'SELECT * FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 6',
    [productId]
  );

  if (metrics.rows.length === 0) return 'subscription'; // Default

  const rows = metrics.rows as unknown as Array<Record<string, number>>;
  const hasExpansion = rows.some((r) => (r.expansion_mrr_cents ?? 0) > 0);
  const hasMRR = rows.some((r) => (r.new_mrr_cents ?? 0) > 0);

  // Simple heuristic classification
  if (hasExpansion && hasMRR) return 'subscription';
  if (hasMRR && !hasExpansion) return 'subscription';
  return 'subscription';
}

/**
 * Compute all unit economics metrics for a product.
 */
export async function computeUnitEconomics(productId: string): Promise<UnitEconomics | null> {
  const profile = await query('SELECT * FROM business_model_profile WHERE product_id = ?', [productId]);
  const p = profile.rows[0] as Record<string, unknown> | undefined;

  const metrics = await query(
    'SELECT * FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1',
    [productId]
  );
  const m = metrics.rows[0] as Record<string, unknown> | undefined;
  if (!m) return null;

  const activeUsers = (m.active_users as number) ?? 0;
  if (activeUsers === 0) return null;

  // `totalMRR` was new + expansion - contraction - churned, which is NET NEW
  // MRR — a movement — and it was divided by active users to give ARPU, from
  // which LTV, CAC payback, the LTV:CAC ratio and the gross margin all follow.
  // A company with a flat month had an ARPU of zero and a company with a bad
  // month had a NEGATIVE lifetime value. `mrr_cents` is the level.
  const mrrLevel = m.mrr_cents == null ? null : Number(m.mrr_cents);
  if (mrrLevel === null) return null;
  const arpu = mrrLevel / activeUsers / 100; // Convert cents to dollars

  const cogsPerCustomer = (p?.avg_cogs_per_customer as number) ?? 0;
  const contributionMargin = arpu > 0 ? (arpu - cogsPerCustomer) / arpu : 0;
  const cac = (p?.avg_cac as number) ?? 0;

  // A HUNDREDFOLD, AND ONLY FOR COMPANIES THAT REPORTED THEIR CHURN.
  //
  // `metric_snapshots.churn_rate` is stored as a 0–1 FRACTION — the ingest
  // validates that range and IMPLEMENTATION_STATE states it. Dividing it by 100
  // turned 5% monthly churn into 0.0005, an average customer lifetime of 2,000
  // months, and an LTV inflated a hundredfold.
  //
  // The `?? 5` default was written in PERCENT, so the fallback path divided
  // correctly and the real-data path did not: a company that reported its churn
  // got a worse answer than one that reported nothing. That is the tell for a
  // units bug — when the fallback and the measurement disagree about the
  // arithmetic that follows them, one of them is in the wrong unit.
  //
  // And the default itself is gone. Five percent monthly churn assumed for a
  // company that never reported any, then compounded into LTV, CAC payback and
  // the LTV:CAC ratio, is an invented unit-economics model presented as this
  // company's.
  const monthlyChurn = m.churn_rate == null ? null : Number(m.churn_rate);
  if (monthlyChurn === null) return null;
  const avgLifetimeMonths = monthlyChurn > 0 ? 1 / monthlyChurn : null;
  if (avgLifetimeMonths === null) return null;

  const ltv = arpu * contributionMargin * avgLifetimeMonths;
  const cacPaybackMonths = cac > 0 && (arpu * contributionMargin) > 0
    ? cac / (arpu * contributionMargin)
    : 0;
  const ltvCacRatio = cac > 0 ? ltv / cac : 0;
  const grossMargin = contributionMargin; // Simplified

  const economics: UnitEconomics = {
    arpu: Math.round(arpu * 100) / 100,
    cogs_per_customer: cogsPerCustomer,
    contribution_margin: Math.round(contributionMargin * 1000) / 1000,
    cac,
    cac_payback_months: Math.round(cacPaybackMonths * 10) / 10,
    ltv: Math.round(ltv * 100) / 100,
    ltv_cac_ratio: Math.round(ltvCacRatio * 100) / 100,
    gross_margin: Math.round(grossMargin * 1000) / 1000,
  };

  // Snapshot
  const today = new Date().toISOString().split('T')[0]!;
  const owner = await query('SELECT owner_id FROM products WHERE id = ?', [productId]);
  const ownerId = (owner.rows[0] as Record<string, string>)?.owner_id ?? '';

  await query(
    `INSERT INTO unit_economics_snapshots (id, product_id, owner_id, snapshot_date, arpu, cogs_per_customer, contribution_margin, cac, cac_payback_months, ltv, ltv_cac_ratio, gross_margin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [nanoid(), productId, ownerId, today, economics.arpu, economics.cogs_per_customer, economics.contribution_margin, economics.cac, economics.cac_payback_months, economics.ltv, economics.ltv_cac_ratio, economics.gross_margin]
  );

  return economics;
}

/**
 * Detect when a product is really a services company disguised as SaaS.
 */
export async function detectServicesDisguise(productId: string): Promise<{
  detected: boolean;
  services_pct: number;
  warning: string | null;
}> {
  const profile = await query('SELECT services_revenue_percentage FROM business_model_profile WHERE product_id = ?', [productId]);
  const p = profile.rows[0] as Record<string, unknown> | undefined;
  const servicesPct = (p?.services_revenue_percentage as number) ?? 0;

  if (servicesPct > 50) {
    return {
      detected: true,
      services_pct: servicesPct,
      warning: `${servicesPct}% of revenue is services — this is a services company with a SaaS wrapper. Consider productizing the most common customization patterns.`,
    };
  }
  if (servicesPct > 30) {
    return {
      detected: false,
      services_pct: servicesPct,
      warning: `${servicesPct}% services revenue is elevated. Watch for linear scaling traps.`,
    };
  }
  return { detected: false, services_pct: servicesPct, warning: null };
}

/**
 * Normalize metrics for seasonal products.
 */
export function seasonalNormalize(
  value: number,
  currentMonth: number,
  peakMonths: number[],
  baselineFactor: number
): number {
  const isPeak = peakMonths.includes(currentMonth);
  if (isPeak) return value; // Peak months are the baseline
  return value / baselineFactor; // Off-peak values scaled up to peak-equivalent
}

/**
 * Generate Claude Opus analysis of business model health.
 */
export async function generateBusinessModelInsights(productId: string): Promise<string> {
  const economics = await computeUnitEconomics(productId);
  const servicesCheck = await detectServicesDisguise(productId);
  const product = await query('SELECT name, market_category FROM products WHERE id = ?', [productId]);
  const p = product.rows[0] as Record<string, string> | undefined;

  const prompt = `Analyze this SaaS business model and provide strategic recommendations.

Product: ${p?.name ?? 'Unknown'}
Market: ${p?.market_category ?? 'General'}
Unit Economics: ${economics ? JSON.stringify(economics) : 'Not yet computed'}
Services Revenue: ${servicesCheck.services_pct}%
Services Warning: ${servicesCheck.warning ?? 'None'}

Provide 3-5 specific, actionable insights about the business model health. Focus on sustainability, pricing power, and growth capacity.`;

  const response = await callOpus(
    'You are a SaaS business model analyst. Be specific and actionable.',
    prompt,
    2048, productId
  );
  return response.content;
}

/**
 * Identify business model stressors.
 */
export async function identifyBusinessModelStressors(productId: string): Promise<StressorReportItem[]> {
  const items: StressorReportItem[] = [];
  const economics = await computeUnitEconomics(productId);

  if (economics) {
    if (economics.contribution_margin < 0) {
      items.push({
        name: 'Negative unit economics',
        signal: `Contribution margin is ${(economics.contribution_margin * 100).toFixed(1)}% — losing money on every customer`,
        timeframe_days: 30,
        neutralizing_action: 'Raise prices, reduce COGS, or both. Cannot sustain negative unit economics.',
        severity: 'critical',
        competitive_correlation: null,
      });
    }

    if (economics.cac_payback_months > 18) {
      items.push({
        name: 'CAC payback excessive',
        signal: `${economics.cac_payback_months.toFixed(0)} months to recover customer acquisition cost`,
        timeframe_days: 60,
        neutralizing_action: 'Reduce CAC (optimize acquisition channels) or increase ARPU (upsell, pricing increase).',
        severity: economics.cac_payback_months > 24 ? 'critical' : 'elevated',
        competitive_correlation: null,
      });
    }

    if (economics.ltv_cac_ratio > 0 && economics.ltv_cac_ratio < 3) {
      items.push({
        name: 'LTV:CAC ratio below threshold',
        signal: `LTV:CAC ratio is ${economics.ltv_cac_ratio.toFixed(1)}x (healthy is 3x+)`,
        timeframe_days: 90,
        neutralizing_action: 'Improve retention (increase LTV) or reduce acquisition costs (reduce CAC).',
        severity: economics.ltv_cac_ratio < 1.5 ? 'critical' : 'elevated',
        competitive_correlation: null,
      });
    }
  }

  const services = await detectServicesDisguise(productId);
  if (services.detected) {
    items.push({
      name: 'Services masquerading as SaaS',
      signal: `${services.services_pct}% of revenue is services`,
      timeframe_days: 90,
      neutralizing_action: 'Productize the most common customizations. Each service engagement should produce a feature.',
      severity: 'elevated',
      competitive_correlation: null,
    });
  }

  return items;
}
