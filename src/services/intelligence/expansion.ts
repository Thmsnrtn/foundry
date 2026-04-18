// =============================================================================
// FOUNDRY — Autonomous Market Expansion Advisor
// TAM estimation, saturation projection, expansion opportunity analysis.
// =============================================================================

import { query } from '../../db/client.js';
import { callOpus, parseJSONResponse } from '../ai/client.js';
import { nanoid } from 'nanoid';

export interface ExpansionAnalysis {
  current_tam_estimate: number;
  tam_penetration_rate: number;
  years_to_saturation: number;
  expansion_opportunities: ExpansionOpportunity[];
  depth_vs_breadth_recommendation: string;
}

interface ExpansionOpportunity {
  market: string;
  tam_delta: number;
  feature_requirements: string[];
  competitive_landscape: string;
  risk_level: string;
  time_to_revenue: string;
}

/**
 * Estimate total addressable market from sector, geography, pricing.
 */
export async function estimateTAMCeiling(productId: string): Promise<number> {
  const product = await query(
    'SELECT p.*, f.country_code FROM products p JOIN founders f ON p.owner_id = f.id WHERE p.id = ?',
    [productId]
  );
  const p = product.rows[0] as Record<string, string> | undefined;
  if (!p) return 0;

  const metrics = await query(
    'SELECT * FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1',
    [productId]
  );
  const m = metrics.rows[0] as Record<string, unknown> | undefined;
  const arpu = m ? (((m.new_mrr_cents as number) ?? 0) / Math.max(1, (m.active_users as number) ?? 1)) / 100 : 0;

  const prompt = `Estimate the Total Addressable Market (TAM) for this product.

Product: ${p.name}
Sector: ${p.sector_profile ?? 'b2b_saas'}
Market: ${p.market_category ?? 'general'}
Current ARPU: $${arpu.toFixed(0)}/mo
Geography: ${p.country_code ?? 'US'}

Return JSON: {"tam_estimate_usd": number (annual), "methodology": "brief explanation"}`;

  const response = await callOpus(
    'You are a market sizing analyst. Provide defensible TAM estimates.',
    prompt,
    1024
  );

  const result = parseJSONResponse<{ tam_estimate_usd: number }>(response.content);
  return result.tam_estimate_usd;
}

/**
 * Project when the product hits TAM saturation milestones.
 */
export async function projectTAMSaturation(productId: string): Promise<{
  pct_20: number;
  pct_50: number;
  pct_80: number;
}> {
  const tam = await estimateTAMCeiling(productId);
  if (tam <= 0) return { pct_20: 0, pct_50: 0, pct_80: 0 };

  const metrics = await query(
    'SELECT * FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 12',
    [productId]
  );

  if (metrics.rows.length < 2) return { pct_20: 99, pct_50: 99, pct_80: 99 };

  const rows = metrics.rows as unknown as Array<Record<string, number>>;
  const latestMRR = ((rows[0]?.new_mrr_cents ?? 0) + (rows[0]?.expansion_mrr_cents ?? 0)) / 100;
  const annualRevenue = latestMRR * 12;

  // Compute average monthly growth rate
  const earliestMRR = ((rows[rows.length - 1]?.new_mrr_cents ?? 0) + (rows[rows.length - 1]?.expansion_mrr_cents ?? 0)) / 100;
  const months = rows.length;
  const monthlyGrowth = earliestMRR > 0 ? Math.pow(latestMRR / earliestMRR, 1 / months) - 1 : 0.05;

  function monthsToTarget(target: number): number {
    if (monthlyGrowth <= 0 || annualRevenue >= target) return 0;
    return Math.ceil(Math.log(target / Math.max(1, annualRevenue)) / Math.log(1 + monthlyGrowth));
  }

  return {
    pct_20: Math.round(monthsToTarget(tam * 0.20) / 12 * 10) / 10,
    pct_50: Math.round(monthsToTarget(tam * 0.50) / 12 * 10) / 10,
    pct_80: Math.round(monthsToTarget(tam * 0.80) / 12 * 10) / 10,
  };
}

/**
 * Identify expansion opportunities using Product DNA + competitive landscape.
 */
export async function identifyExpansionOpportunities(productId: string): Promise<ExpansionOpportunity[]> {
  const product = await query('SELECT name, sector_profile, market_category FROM products WHERE id = ?', [productId]);
  const p = product.rows[0] as Record<string, string> | undefined;
  if (!p) return [];

  const prompt = `Identify 3-5 adjacent market expansion opportunities for this product.

Product: ${p.name}
Sector: ${p.sector_profile ?? 'b2b_saas'}
Market: ${p.market_category ?? 'general'}

For each opportunity, provide:
- market: target market/vertical
- tam_delta: estimated additional TAM (annual USD)
- feature_requirements: what needs to be built
- competitive_landscape: who's already there
- risk_level: low/medium/high
- time_to_revenue: estimated time to first revenue

Return JSON array of opportunities, ordered by tam_delta descending.`;

  const response = await callOpus(
    'You are a market expansion strategist. Identify actionable adjacent market opportunities.',
    prompt,
    4096
  );

  return parseJSONResponse<ExpansionOpportunity[]>(response.content);
}

/**
 * Model depth-vs-breadth strategic fork.
 */
export async function modelDepthVsBreadth(productId: string): Promise<{
  depth_scenario: { description: string; projected_revenue_12m: number; risk: string };
  breadth_scenario: { description: string; projected_revenue_12m: number; risk: string };
  recommendation: string;
}> {
  const product = await query('SELECT name, sector_profile, market_category FROM products WHERE id = ?', [productId]);
  const p = product.rows[0] as Record<string, string> | undefined;
  if (!p) return {
    depth_scenario: { description: '', projected_revenue_12m: 0, risk: '' },
    breadth_scenario: { description: '', projected_revenue_12m: 0, risk: '' },
    recommendation: '',
  };

  const metrics = await query(
    'SELECT * FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1',
    [productId]
  );
  const m = metrics.rows[0] as Record<string, unknown> | undefined;

  const prompt = `Model two strategic scenarios for this SaaS product.

Product: ${p.name} (${p.sector_profile})
Current MRR: $${m ? (((m.new_mrr_cents as number) ?? 0) / 100).toFixed(0) : '0'}
Active users: ${(m?.active_users as number) ?? 0}

Scenario A (Depth): Go deeper in current market. More features, higher ARPU, stronger lock-in.
Scenario B (Breadth): Expand to adjacent markets. More customers, broader positioning, lower ARPU.

Return JSON:
{
  "depth_scenario": {"description": "...", "projected_revenue_12m": number, "risk": "..."},
  "breadth_scenario": {"description": "...", "projected_revenue_12m": number, "risk": "..."},
  "recommendation": "which path and why"
}`;

  const response = await callOpus(
    'You are a SaaS strategy advisor. Model realistic scenarios with specific numbers.',
    prompt,
    2048
  );

  return parseJSONResponse<{
    depth_scenario: { description: string; projected_revenue_12m: number; risk: string };
    breadth_scenario: { description: string; projected_revenue_12m: number; risk: string };
    recommendation: string;
  }>(response.content);
}

/**
 * Assess how much of the product is transferable to adjacent markets.
 */
export async function assessExpansionReadiness(productId: string): Promise<{
  transferable_pct: number;
  vertical_specific_components: string[];
  generic_components: string[];
  readiness_score: number;
}> {
  const product = await query('SELECT name, stack_description, sector_profile FROM products WHERE id = ?', [productId]);
  const p = product.rows[0] as Record<string, string> | undefined;
  if (!p) return { transferable_pct: 0, vertical_specific_components: [], generic_components: [], readiness_score: 0 };

  const prompt = `Assess this product's readiness for market expansion.

Product: ${p.name}
Sector: ${p.sector_profile ?? 'b2b_saas'}
Stack: ${p.stack_description ?? 'unknown'}

Estimate what percentage is transferable vs vertical-specific.

Return JSON:
{"transferable_pct": 0-100, "vertical_specific_components": ["..."], "generic_components": ["..."], "readiness_score": 0-100}`;

  const response = await callOpus(
    'You are a product architecture analyst evaluating expansion readiness.',
    prompt,
    1024
  );

  return parseJSONResponse<{
    transferable_pct: number;
    vertical_specific_components: string[];
    generic_components: string[];
    readiness_score: number;
  }>(response.content);
}

/**
 * Generate a comprehensive expansion brief.
 */
export async function generateExpansionBrief(productId: string, ownerId: string): Promise<string> {
  const tam = await estimateTAMCeiling(productId);
  const saturation = await projectTAMSaturation(productId);
  const opportunities = await identifyExpansionOpportunities(productId);
  const dvb = await modelDepthVsBreadth(productId);
  const readiness = await assessExpansionReadiness(productId);

  // Persist analysis
  await query(
    `INSERT INTO expansion_analysis (id, product_id, owner_id, current_tam_estimate, tam_penetration_rate, years_to_saturation, expansion_opportunities, depth_vs_breadth_recommendation, strategic_fork_scenarios)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(), productId, ownerId,
      tam, 0, saturation.pct_50,
      JSON.stringify(opportunities),
      dvb.recommendation,
      JSON.stringify({ depth: dvb.depth_scenario, breadth: dvb.breadth_scenario }),
    ]
  );

  const product = await query('SELECT name FROM products WHERE id = ?', [productId]);
  const name = (product.rows[0] as Record<string, string>)?.name ?? 'your product';

  return `# Expansion Brief for ${name}

## TAM Analysis
- Estimated TAM: $${(tam / 1000000).toFixed(1)}M/year
- Years to 20% penetration: ${saturation.pct_20}
- Years to 50% penetration: ${saturation.pct_50}

## Expansion Readiness
- ${readiness.transferable_pct}% of product is transferable
- Readiness score: ${readiness.readiness_score}/100

## Depth vs Breadth
${dvb.recommendation}

## Top Expansion Opportunities
${opportunities.slice(0, 3).map((o, i) =>
  `${i + 1}. **${o.market}** — $${(o.tam_delta / 1000000).toFixed(1)}M TAM, ${o.risk_level} risk, ${o.time_to_revenue} to revenue`
).join('\n')}`;
}
