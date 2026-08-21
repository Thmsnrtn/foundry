// =============================================================================
// FOUNDRY — Autonomous Market Expansion Advisor
// TAM estimation, saturation projection, expansion opportunity analysis.
// =============================================================================

import { query } from '../../db/client.js';
import { callOpus, parseJSONResponse } from '../ai/client.js';

// `ExpansionAnalysis` was here. It was the shape of the `expansion_analysis`
// row, nothing referenced it, and one of its fields — `tam_penetration_rate` —
// only ever held the literal 0 that the INSERT typed into it. Retired with the
// table in migration 189.

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

  // ARPU IS REVENUE PER USER, AND THIS WAS NEITHER.
  //
  //   new_mrr_cents   the NEW BUSINESS won this period, not the MRR level. A
  //                   company at $50k MRR with a flat month had an ARPU of $0.
  //   Math.max(1, …)  a company with no reported active users got a denominator
  //                   of ONE, so its ARPU became its entire monthly revenue —
  //                   one user's worth of revenue equal to the whole company's.
  //   the ?? 0 / : 0  no metrics at all produced "Current ARPU: $0/mo", stated
  //                   to a model that was then asked to size the market from it.
  //
  // Null when either input is missing or the user count is zero. A TAM estimate
  // made from a fabricated ARPU is worse than one made from an acknowledged gap:
  // the model can say what it cannot know, and could not before.
  const mrrLevel = m?.mrr_cents == null ? null : Number(m.mrr_cents);
  const activeUsers = m?.active_users == null ? null : Number(m.active_users);
  const arpu = mrrLevel !== null && activeUsers !== null && activeUsers > 0
    ? (mrrLevel / activeUsers) / 100
    : null;

  const prompt = `Estimate the Total Addressable Market (TAM) for this product.

Product: ${p.name}
Sector: ${p.sector_profile ?? 'b2b_saas'}
Market: ${p.market_category ?? 'general'}
Current ARPU: ${arpu === null ? 'not known — no MRR level or no active-user count has been reported' : `$${arpu.toFixed(0)}/mo`}
Geography: ${p.country_code ?? 'US'}

Return JSON: {"tam_estimate_usd": number (annual), "methodology": "brief explanation"}`;

  const response = await callOpus(
    'You are a market sizing analyst. Provide defensible TAM estimates.',
    prompt,
    1024, productId
  );

  const result = parseJSONResponse<{ tam_estimate_usd: number }>(response.content);
  return result.tam_estimate_usd;
}

/**
 * Project when the product hits TAM saturation milestones.
 */
export async function projectTAMSaturation(productId: string): Promise<{
  /** Years to reach 20/50/80% of TAM. Null when there is nothing to project from. */
  pct_20: number | null;
  pct_50: number | null;
  pct_80: number | null;
}> {
  const tam = await estimateTAMCeiling(productId);
  // Zero years to saturation for a company whose TAM could not be estimated —
  // "you are already there" — was the most flattering answer available.
  if (tam <= 0) return { pct_20: null, pct_50: null, pct_80: null };

  const metrics = await query(
    'SELECT * FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 12',
    [productId]
  );

  // 99 years was the answer for a company with fewer than two snapshots — a
  // number, in a field a founder reads as a projection, for a company nobody
  // has measured twice. Null says the same thing without pretending.
  if (metrics.rows.length < 2) return { pct_20: null, pct_50: null, pct_80: null };

  const rows = metrics.rows as unknown as Array<Record<string, number | null>>;

  // The LEVEL. This summed new + expansion MRR and called it the company's
  // revenue — the same wrong sum the portfolio overview made, and the same
  // consequence: a company at $50k MRR with a flat month looked like a company
  // with no revenue, and its years-to-saturation was computed from that.
  const level = (r: Record<string, number | null> | undefined): number | null =>
    r?.mrr_cents == null ? null : Number(r.mrr_cents) / 100;

  const latestMRR = level(rows[0]);
  const earliestMRR = level(rows[rows.length - 1]);
  if (latestMRR === null || earliestMRR === null || earliestMRR <= 0) {
    return { pct_20: null, pct_50: null, pct_80: null };
  }

  const annualRevenue = latestMRR * 12;
  const months = rows.length;
  // No `?? 0.05` fallback: the branch that needed it cannot be reached now,
  // and a 5% monthly growth rate assumed for a company is a forecast about
  // somebody's business that nobody made.
  const monthlyGrowth = Math.pow(latestMRR / earliestMRR, 1 / months) - 1;

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
    4096, productId
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
Current MRR: ${m?.mrr_cents == null ? 'not reported' : `$${(Number(m.mrr_cents) / 100).toFixed(0)}`}
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
    2048, productId
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
    1024, productId
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
export async function generateExpansionBrief(productId: string): Promise<string> {
  const tam = await estimateTAMCeiling(productId);
  const saturation = await projectTAMSaturation(productId);
  const opportunities = await identifyExpansionOpportunities(productId);
  const dvb = await modelDepthVsBreadth(productId);
  const readiness = await assessExpansionReadiness(productId);

  // The row that used to be written here went into `expansion_analysis`, which
  // nothing has ever read — this function returns the brief to its caller.
  //
  // Its `tam_penetration_rate` column was filled with the literal 0. Not
  // computed, not defaulted: a zero typed into the INSERT, saying this company
  // has captured none of its addressable market. Nobody saw it, which is the
  // only reason it never misled anyone.
  //
  // Retired in migration 189 rather than given an invented reader, on the owner
  // decision recorded at migration 157.

  const product = await query('SELECT name FROM products WHERE id = ?', [productId]);
  const name = (product.rows[0] as Record<string, string>)?.name ?? 'your product';

  return `# Expansion Brief for ${name}

## TAM Analysis
- Estimated TAM: $${(tam / 1000000).toFixed(1)}M/year
- Years to 20% penetration: ${saturation.pct_20 ?? 'not projectable — fewer than two MRR snapshots, or no reported MRR level'}
- Years to 50% penetration: ${saturation.pct_50 ?? 'not projectable — fewer than two MRR snapshots, or no reported MRR level'}

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
