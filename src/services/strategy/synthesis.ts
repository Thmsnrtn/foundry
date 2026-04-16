// =============================================================================
// FOUNDRY — Strategic Intelligence: Monthly Synthesis
// Cross-agent strategic synthesis, competitor profiles, and rolling plans.
// =============================================================================

import { query } from '../../db/client.js';
import { callSonnet, parseJSONResponse } from '../ai/client.js';
import { nanoid } from 'nanoid';
import { getExperimentSummary } from '../scp/experiments.js';
import { getROISummary } from '../financial/economics.js';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface StrategicSynthesisRecord {
  id: string;
  product_id: string;
  generated_at: string;
  period_start: string;
  period_end: string;
  top_opportunities: Array<{
    opportunity: string;
    agent: string;
    impact: string;
    priority: 'high' | 'medium' | 'low';
  }>;
  recommended_priorities: Array<{
    priority: string;
    description: string;
    owners: string[];
    expected_impact: string;
  }>;
  ceo_decision_needed: string | null;
  full_synthesis: string;
}

interface SynthesisAIOutput {
  market_position: string;
  customer_intelligence: string;
  product_direction: string;
  risks: string;
  top_opportunities: Array<{
    opportunity: string;
    agent: string;
    impact: string;
    priority: 'high' | 'medium' | 'low';
  }>;
  recommended_priorities: Array<{
    priority: string;
    description: string;
    owners: string[];
    expected_impact: string;
  }>;
  ceo_decision_needed: string | null;
  full_synthesis: string;
}

// ─── Generate Synthesis ───────────────────────────────────────────────────────

/**
 * Generate monthly strategic synthesis by analyzing all agent data,
 * then using Sonnet to synthesize into actionable priorities.
 * Returns synthesis ID.
 */
export async function generateStrategicSynthesis(productId: string): Promise<string> {
  const periodEnd = new Date().toISOString();
  const periodStart = new Date(Date.now() - 30 * 86400 * 1000).toISOString();

  // Gather context in parallel
  const [
    recentSessionsResult,
    experimentSummary,
    roiSummary,
    competitorProfiles,
    decisionsResult,
    stressorsResult,
    lifecycleResult,
  ] = await Promise.all([
    query(
      `SELECT action_type, reasoning, created_at FROM audit_log
       WHERE product_id = ? AND created_at >= ?
       ORDER BY created_at DESC LIMIT 50`,
      [productId, periodStart],
    ),
    getExperimentSummary(productId),
    getROISummary(productId),
    getCompetitorProfiles(productId),
    query(
      `SELECT category, what, status, outcome FROM decisions
       WHERE product_id = ? AND created_at >= ?
       ORDER BY created_at DESC LIMIT 20`,
      [productId, periodStart],
    ),
    query(
      `SELECT stressor_name, severity, status FROM stressor_history
       WHERE product_id = ? AND status = 'active'`,
      [productId],
    ),
    query(
      'SELECT risk_state, current_prompt FROM lifecycle_state WHERE product_id = ?',
      [productId],
    ),
  ]);

  const ls = (lifecycleResult.rows[0] as Record<string, unknown>) ?? {};
  const recentSessions = recentSessionsResult.rows.slice(0, 20).map((r) => {
    const row = r as Record<string, unknown>;
    return { type: row.action_type, reasoning: (row.reasoning as string)?.slice(0, 200) };
  });

  const contextBlock = JSON.stringify({
    lifecycle: {
      risk_state: ls.risk_state,
      current_prompt: ls.current_prompt,
    },
    active_stressors: stressorsResult.rows.map((r) => {
      const row = r as Record<string, unknown>;
      return { name: row.stressor_name, severity: row.severity };
    }),
    recent_agent_actions: recentSessions,
    experiments: experimentSummary,
    roi: roiSummary,
    competitor_profiles: competitorProfiles.map((c) => ({
      name: c.name,
      threat_level: c.threat_level,
      our_advantages: c.our_advantages.slice(0, 3),
      their_advantages: c.their_advantages.slice(0, 3),
    })),
    recent_decisions: decisionsResult.rows.slice(0, 10).map((r) => {
      const row = r as Record<string, unknown>;
      return { category: row.category, what: row.what, status: row.status };
    }),
  }, null, 2);

  const systemPrompt = `You are a strategic intelligence synthesizer for an autonomous AI-run SaaS company.
Analyze the last 30 days of agent activity and generate a strategic synthesis.

Return a JSON object with this exact shape:
{
  "market_position": "2-3 sentence analysis from market/competitive angle",
  "customer_intelligence": "2-3 sentence analysis of customer signals",
  "product_direction": "2-3 sentence analysis of product momentum",
  "risks": "2-3 sentence risk summary",
  "top_opportunities": [
    {"opportunity": "string", "agent": "agent_name", "impact": "string", "priority": "high|medium|low"}
  ],
  "recommended_priorities": [
    {"priority": "string", "description": "string", "owners": ["agent1"], "expected_impact": "string"}
  ],
  "ceo_decision_needed": "string or null — what requires human CEO decision",
  "full_synthesis": "Complete markdown synthesis (500-800 words)"
}

Rules:
- top_opportunities: max 5, ordered by priority
- recommended_priorities: max 5 actionable items for next 30 days
- full_synthesis: structured markdown with ## headers for each section
- Be specific and actionable, not generic`;

  const userPrompt = `Product ID: ${productId}\nPeriod: ${periodStart} to ${periodEnd}\n\nContext:\n${contextBlock}`;

  const response = await callSonnet(systemPrompt, userPrompt, 4096);
  const parsed = parseJSONResponse<SynthesisAIOutput>(response.content);

  const tokensUsed = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);
  // Approximate Sonnet cost: $3/M input, $15/M output
  const costUsd = ((response.usage?.input_tokens ?? 0) * 3 + (response.usage?.output_tokens ?? 0) * 15) / 1_000_000;

  const synthesisId = nanoid();
  await query(
    `INSERT INTO strategic_syntheses
       (id, product_id, period_start, period_end, market_position, customer_intelligence,
        product_direction, risks, top_opportunities, recommended_priorities,
        ceo_decision_needed, full_synthesis, tokens_used, cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      synthesisId,
      productId,
      periodStart,
      periodEnd,
      parsed.market_position,
      parsed.customer_intelligence,
      parsed.product_direction,
      parsed.risks,
      JSON.stringify(parsed.top_opportunities),
      JSON.stringify(parsed.recommended_priorities),
      parsed.ceo_decision_needed ?? null,
      parsed.full_synthesis,
      tokensUsed,
      costUsd,
    ],
  );

  return synthesisId;
}

// ─── Synthesis Queries ────────────────────────────────────────────────────────

/**
 * Get the latest strategic synthesis for a product.
 */
export async function getLatestSynthesis(productId: string): Promise<StrategicSynthesisRecord | null> {
  const result = await query(
    `SELECT * FROM strategic_syntheses WHERE product_id = ? ORDER BY generated_at DESC LIMIT 1`,
    [productId],
  );
  if (result.rows.length === 0) return null;
  return deserializeSynthesis(result.rows[0]);
}

/**
 * Get synthesis history for a product.
 */
export async function getSynthesisHistory(productId: string): Promise<StrategicSynthesisRecord[]> {
  const result = await query(
    `SELECT * FROM strategic_syntheses WHERE product_id = ? ORDER BY generated_at DESC`,
    [productId],
  );
  return result.rows.map(deserializeSynthesis);
}

// ─── Competitor Profiles ──────────────────────────────────────────────────────

/**
 * Upsert a competitor profile with latest scan info.
 */
export async function upsertCompetitorProfile(
  productId: string,
  params: {
    name: string;
    url?: string;
    known_features?: string[];
    pricing_summary?: string;
    threat_level?: 'low' | 'medium' | 'high';
    our_advantages?: string[];
    their_advantages?: string[];
    recommended_response?: string;
  },
): Promise<void> {
  // Check if exists
  const existing = await query(
    'SELECT id FROM competitor_profiles WHERE product_id = ? AND name = ?',
    [productId, params.name],
  );

  if (existing.rows.length > 0) {
    const existingId = (existing.rows[0] as Record<string, unknown>).id as string;
    await query(
      `UPDATE competitor_profiles SET
         url = COALESCE(?, url),
         known_features = COALESCE(?, known_features),
         pricing_summary = COALESCE(?, pricing_summary),
         threat_level = COALESCE(?, threat_level),
         our_advantages = COALESCE(?, our_advantages),
         their_advantages = COALESCE(?, their_advantages),
         recommended_response = COALESCE(?, recommended_response),
         last_scanned_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        params.url ?? null,
        params.known_features ? JSON.stringify(params.known_features) : null,
        params.pricing_summary ?? null,
        params.threat_level ?? null,
        params.our_advantages ? JSON.stringify(params.our_advantages) : null,
        params.their_advantages ? JSON.stringify(params.their_advantages) : null,
        params.recommended_response ?? null,
        existingId,
      ],
    );
  } else {
    await query(
      `INSERT INTO competitor_profiles
         (id, product_id, name, url, known_features, pricing_summary, threat_level,
          our_advantages, their_advantages, recommended_response, last_scanned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        nanoid(),
        productId,
        params.name,
        params.url ?? null,
        JSON.stringify(params.known_features ?? []),
        params.pricing_summary ?? null,
        params.threat_level ?? 'low',
        JSON.stringify(params.our_advantages ?? []),
        JSON.stringify(params.their_advantages ?? []),
        params.recommended_response ?? null,
      ],
    );
  }
}

/**
 * Get competitor profiles for a product.
 */
export async function getCompetitorProfiles(productId: string): Promise<Array<{
  id: string;
  name: string;
  url: string | null;
  threat_level: string;
  our_advantages: string[];
  their_advantages: string[];
  recommended_response: string | null;
  last_scanned_at: string | null;
}>> {
  const result = await query(
    'SELECT * FROM competitor_profiles WHERE product_id = ? ORDER BY threat_level DESC, name ASC',
    [productId],
  );

  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      name: r.name as string,
      url: (r.url as string | null) ?? null,
      threat_level: (r.threat_level as string) ?? 'low',
      our_advantages: r.our_advantages ? JSON.parse(r.our_advantages as string) : [],
      their_advantages: r.their_advantages ? JSON.parse(r.their_advantages as string) : [],
      recommended_response: (r.recommended_response as string | null) ?? null,
      last_scanned_at: (r.last_scanned_at as string | null) ?? null,
    };
  });
}

// ─── Internal Deserializers ───────────────────────────────────────────────────

function deserializeSynthesis(row: unknown): StrategicSynthesisRecord {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as string,
    product_id: r.product_id as string,
    generated_at: r.generated_at as string,
    period_start: r.period_start as string,
    period_end: r.period_end as string,
    top_opportunities: r.top_opportunities ? JSON.parse(r.top_opportunities as string) : [],
    recommended_priorities: r.recommended_priorities ? JSON.parse(r.recommended_priorities as string) : [],
    ceo_decision_needed: (r.ceo_decision_needed as string | null) ?? null,
    full_synthesis: r.full_synthesis as string,
  };
}
