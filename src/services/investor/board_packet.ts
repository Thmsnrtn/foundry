// =============================================================================
// FOUNDRY — Investor Layer: Board Packet Generator
// Auto-drafts quarterly board packets from 90 days of Signal history,
// key decisions, stressors, MRR trajectory, and cohort performance.
// =============================================================================

import { query, getActiveStressors, getLatestMetrics } from '../../db/client.js';
import { callOpus } from '../ai/client.js';
import { getSignalHistory } from '../signal.js';
import { getMRRDecomposition } from '../intelligence/revenue.js';
import { nanoid } from 'nanoid';
import type { BoardPacket, BoardPacketStatus } from '../../types/index.js';

// ─── SCP Board Section ────────────────────────────────────────────────────────

export interface SCPBoardSection {
  health_score: number;
  lifecycle_state: string;
  total_evolution_cycles: number;
  golden_suite_size: number;
  ai_cost_30d_usd: number;
  attributed_revenue_30d_usd: number;
  roi: number | null;
  top_agents: Array<{ name: string; role: string; health: number; version: number }>;
  latest_briefing_headline: string | null;
}

export async function getSCPBoardSection(productId: string): Promise<SCPBoardSection> {
  // Query product SCP fields
  const productResult = await query(
    `SELECT health_score, company_lifecycle_state,
            total_evolution_cycles, golden_suite_size,
            ai_cost_trailing_30d_usd, attributed_revenue_trailing_30d_usd
     FROM products WHERE id = ?`,
    [productId]
  );

  const prod = (productResult.rows[0] ?? {}) as Record<string, unknown>;
  const aiCost = (prod.ai_cost_trailing_30d_usd as number) ?? 0;
  const attributedRevenue = (prod.attributed_revenue_trailing_30d_usd as number) ?? 0;
  const roi = aiCost > 0 ? attributedRevenue / aiCost : null;

  // Top 3 agents by domain_health_score
  const agentsResult = await query(
    `SELECT display_name, agent_name, domain_health_score, version
     FROM agent_instances
     WHERE product_id = ? AND status = 'active'
     ORDER BY domain_health_score DESC LIMIT 3`,
    [productId]
  );

  // Import agent roles
  const { AGENT_ROLES } = await import('../scp/types.js');

  const top_agents = agentsResult.rows.map((row) => {
    const r = row as Record<string, unknown>;
    const agentName = r.agent_name as string;
    return {
      name: (r.display_name as string) ?? agentName,
      role: AGENT_ROLES[agentName as keyof typeof AGENT_ROLES] ?? agentName,
      health: Math.round((r.domain_health_score as number) ?? 0),
      version: (r.version as number) ?? 1,
    };
  });

  // Latest briefing headline
  let latest_briefing_headline: string | null = null;
  try {
    const briefingResult = await query(
      `SELECT headline FROM scp_briefings
       WHERE product_id = ? ORDER BY briefing_date DESC LIMIT 1`,
      [productId]
    );
    if (briefingResult.rows.length > 0) {
      latest_briefing_headline = ((briefingResult.rows[0] as Record<string, unknown>).headline as string) ?? null;
    }
  } catch {
    // scp_briefings may not have data yet
  }

  return {
    health_score: Math.round((prod.health_score as number) ?? 0),
    lifecycle_state: (prod.company_lifecycle_state as string) ?? 'setup',
    total_evolution_cycles: (prod.total_evolution_cycles as number) ?? 0,
    golden_suite_size: (prod.golden_suite_size as number) ?? 0,
    ai_cost_30d_usd: aiCost,
    attributed_revenue_30d_usd: attributedRevenue,
    roi,
    top_agents,
    latest_briefing_headline,
  };
}

// ─── Generate Board Packet ────────────────────────────────────────────────────

// `generateBoardPacket` was here, and it was the second writer into
// `board_packets`. It filled `executive_summary`, `signal_narrative`,
// `mrr_narrative`, `cohort_narrative` and `competitive_narrative`; the
// canonical generator in services/scp/investor/ fills `narrative_json`. Both
// routes were mounted and both listed the same table, so a packet generated on
// one surface rendered on the other as a document with a title, a quarter, and
// every section empty.
//
// The navigation points at `/board` — "Investor Board" in the sidebar,
// "Investor Hub" in the tab bar — and at `/investors` from nowhere. So the SCP
// generator is the product and this was the projection left behind. Retired in
// migration 164, which also carries the rows it wrote into the canonical shape.

export async function computeFundingReadiness(productId: string): Promise<{
  score: number;
  verdict: 'raise_ready' | 'almost_ready' | 'not_ready';
  key_gaps: string[];
  narrative: string;
  component_scores: Record<string, number | null>;
}> {
  const [
    metricsResult,
    decisionResult,
    auditResult,
    teamResult,
    dnaResult,
    stressorsResult,
  ] = await Promise.all([
    query(
      `SELECT mrr_health_ratio, churn_rate, activation_rate
       FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1`,
      [productId],
    ),
    query(
      `SELECT AVG(CASE WHEN outcome_valence IS NOT NULL THEN outcome_valence ELSE 0 END) as avg_valence,
              COUNT(*) as total
       FROM decisions WHERE product_id = ? AND status IN ('approved','executed')`,
      [productId],
    ),
    query(
      `SELECT composite FROM audit_scores WHERE product_id = ? ORDER BY created_at DESC LIMIT 1`,
      [productId],
    ),
    query(
      `SELECT COUNT(*) as count FROM team_members WHERE product_id = ? AND status = 'active'`,
      [productId],
    ),
    query(
      `SELECT completion_pct FROM product_dna WHERE product_id = ?`,
      [productId],
    ),
    query(
      `SELECT COUNT(*) as count FROM stressor_history
       WHERE product_id = ? AND status = 'active' AND severity = 'critical'`,
      [productId],
    ),
  ]);

  const metrics = (metricsResult.rows[0] ?? {}) as Record<string, number | null>;
  const decisions = (decisionResult.rows[0] ?? {}) as Record<string, number>;
  const audit = (auditResult.rows[0] ?? {}) as Record<string, number | null>;
  const team = (teamResult.rows[0] ?? {}) as Record<string, number>;
  const dna = (dnaResult.rows[0] ?? {}) as Record<string, number | null>;
  const criticalStressors = ((stressorsResult.rows[0] ?? {}) as Record<string, number>).count ?? 0;

  // Score each component 0-100
  const healthRatio = metrics.mrr_health_ratio;
  const mrrScore = healthRatio === null ? 50 :
    healthRatio < 0.3 ? 100 :
    healthRatio < 0.5 ? 85 :
    healthRatio < 0.7 ? 70 :
    healthRatio < 1.0 ? 55 :
    healthRatio < 1.5 ? 30 : 10;

  const churn = metrics.churn_rate;
  const churnScore = churn === null ? 50 :
    churn < 0.02 ? 100 :
    churn < 0.05 ? 80 :
    churn < 0.08 ? 60 :
    churn < 0.12 ? 40 : 20;

  const activation = metrics.activation_rate;
  const activationScore = activation === null ? 50 :
    activation > 0.6 ? 100 :
    activation > 0.4 ? 80 :
    activation > 0.25 ? 60 :
    activation > 0.15 ? 40 : 20;

  const auditComposite = audit.composite;
  const auditScore = auditComposite === null ? 50 : Math.round(auditComposite);

  const avgValence = decisions.avg_valence ?? 0;
  const decisionScore = Math.round(((avgValence + 1) / 2) * 100);

  const teamCount = team.count ?? 0;
  const teamScore = teamCount >= 2 ? 100 : teamCount === 1 ? 65 : 40;

  const dnaCompletion = dna.completion_pct ?? 0;
  const marketScore = Math.round(dnaCompletion);

  // Weighted composite
  const score = Math.round(
    mrrScore * 0.25 +
    churnScore * 0.20 +
    activationScore * 0.20 +
    auditScore * 0.15 +
    decisionScore * 0.10 +
    teamScore * 0.05 +
    marketScore * 0.05
  );

  // Identify gaps
  const key_gaps: string[] = [];
  if (criticalStressors > 0) key_gaps.push(`${criticalStressors} critical stressor(s) unresolved`);
  if (mrrScore < 60) key_gaps.push('MRR health ratio indicates churn exceeds new revenue');
  if (churnScore < 60) key_gaps.push('Churn rate above acceptable threshold for this stage');
  if (activationScore < 60) key_gaps.push('Activation rate below benchmarks for fundraising');
  if (auditScore < 60) key_gaps.push('Technical audit score below threshold — product readiness concerns');
  if (teamScore < 70) key_gaps.push('Solo founder risk — co-founder or key hire recommended');
  if (marketScore < 60) key_gaps.push('Product DNA incomplete — market story not fully articulated');

  const verdict: 'raise_ready' | 'almost_ready' | 'not_ready' =
    score >= 75 && key_gaps.length === 0 ? 'raise_ready' :
    score >= 60 && key_gaps.length <= 2 ? 'almost_ready' : 'not_ready';

  // Generate narrative
  const systemPrompt = `You write concise funding readiness assessments for SaaS founders. Be direct and honest.`;
  const userPrompt = `Score: ${score}/100. Verdict: ${verdict.replace('_', ' ')}.
Key gaps: ${key_gaps.length > 0 ? key_gaps.join('; ') : 'None'}.
MRR health: ${mrrScore}/100. Churn: ${churnScore}/100. Activation: ${activationScore}/100.
Write exactly 3 sentences: what the score means, what's strongest, what's most critical to fix before raising.`;

  let narrative = '';
  try {
    const r = await callOpus(systemPrompt, userPrompt, 256, productId);
    narrative = r.content.trim();
  } catch {
    narrative = `Funding readiness score of ${score} reflects ${verdict === 'raise_ready' ? 'strong fundamentals' : verdict === 'almost_ready' ? 'solid progress with key gaps to address' : 'significant gaps that should be resolved before fundraising'}.`;
  }

  return {
    score,
    verdict,
    key_gaps,
    narrative,
    component_scores: {
      mrr_trajectory_score: mrrScore,
      churn_score: churnScore,
      activation_score: activationScore,
      technical_debt_score: auditScore,
      decision_track_record_score: decisionScore,
      team_completeness_score: teamScore,
      market_clarity_score: marketScore,
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function generateNarrativeSection(
  systemPrompt: string,
  context: string,
  _section: string,
  instruction: string,
  productId: string,
): Promise<string> {
  try {
    const r = await callOpus(systemPrompt, `Business data:\n${context}\n\nInstruction: ${instruction}`, 512, productId);
    return r.content.trim();
  } catch {
    return '';
  }
}
