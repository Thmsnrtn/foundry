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
  /** Null when nothing has scored the company. Not 0, which is the worst score. */
  health_score: number | null;
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

  // Top 3 agents by domain_health_score.
  //
  // `IS NOT NULL` because this renders in an investor packet under the heading
  // "Top Performing Agents", and an agent nothing has scored is not a top
  // performer — it is unmeasured. The old query took whatever three rows came
  // back and `?? 0` turned an unscored one into "Health: 0" in red, which is a
  // worse claim than leaving it out: it says the agent was measured and found
  // to be failing. If fewer than three have been scored, fewer than three are
  // shown, and if none have been the section does not render at all.
  const agentsResult = await query(
    `SELECT display_name, agent_name, domain_health_score, version
     FROM agent_instances
     WHERE product_id = ? AND status = 'active' AND domain_health_score IS NOT NULL
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
      health: Math.round(Number(r.domain_health_score)),
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
    health_score: prod.health_score == null ? null : Math.round(Number(prod.health_score)),
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

/**
 * A FUNDING READINESS VERDICT, AND WHAT IT KNEW WHEN IT GAVE ONE.
 *
 * Each component scores 50 when its input is null — a defensible neutral, and
 * better than the extremes found elsewhere. The defect was downstream. The gap
 * list tested those scores against thresholds of 60, so 50 tripped every one of
 * them, and a company that had reported NOTHING was told, in a document it
 * would fundraise on:
 *
 *   "Churn rate above acceptable threshold for this stage"
 *   "Activation rate below benchmarks for fundraising"
 *   "MRR health ratio indicates churn exceeds new revenue"
 *   "Technical audit score below threshold — product readiness concerns"
 *
 * Four specific negative findings about a company nobody had measured. Note the
 * direction: the agent prompts fabricated favourable numbers, this fabricated
 * damning ones. Both come from answering "unknown" with a digit; which way it
 * lands is an accident of where the threshold sits.
 *
 * A missing input is now its own gap, in its own words, and the narrative model
 * is told which components are unmeasured rather than being handed "50/100" and
 * asked what is strongest. `measured_components` says how much of the score is
 * real, because a reader cannot tell 62-out-of-seven-measured from
 * 62-out-of-two.
 */
export async function computeFundingReadiness(productId: string): Promise<{
  score: number;
  verdict: 'raise_ready' | 'almost_ready' | 'not_ready';
  key_gaps: string[];
  /** What is not known, kept apart from what is known and poor. */
  unmeasured: string[];
  /** How many of the seven components had a real input behind them. */
  measured_components: { measured: number; total: number };
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
      `SELECT AVG(outcome_valence) as avg_valence,
              COUNT(outcome_valence) as measured_outcomes,
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

  // `?? null`, BECAUSE `rows[0] ?? {}` YIELDS UNDEFINED, NOT NULL. Every check
  // below is written `=== null`, and for a company with no snapshot row at all
  // the value was `undefined` — so the neutral branch never ran and every
  // numeric comparison fell through to the final `: 10` / `: 20`. A company
  // that had reported nothing scored 10, 20 and 20 on its three revenue
  // components: not a neutral placeholder, very nearly the worst score
  // available, in a fundraising document.
  const asNullable = (v: unknown): number | null =>
    v === null || v === undefined ? null : Number(v);

  // Score each component 0-100
  const healthRatio = asNullable(metrics.mrr_health_ratio);
  const mrrScore = healthRatio === null ? 50 :
    healthRatio < 0.3 ? 100 :
    healthRatio < 0.5 ? 85 :
    healthRatio < 0.7 ? 70 :
    healthRatio < 1.0 ? 55 :
    healthRatio < 1.5 ? 30 : 10;

  const churn = asNullable(metrics.churn_rate);
  const churnScore = churn === null ? 50 :
    churn < 0.02 ? 100 :
    churn < 0.05 ? 80 :
    churn < 0.08 ? 60 :
    churn < 0.12 ? 40 : 20;

  const activation = asNullable(metrics.activation_rate);
  const activationScore = activation === null ? 50 :
    activation > 0.6 ? 100 :
    activation > 0.4 ? 80 :
    activation > 0.25 ? 60 :
    activation > 0.15 ? 40 : 20;

  const auditComposite = asNullable(audit.composite);
  const auditScore = auditComposite === null ? 50 : Math.round(auditComposite);

  // COUNTED, NOT AVERAGED WITH ZEROS. The query said
  // `AVG(CASE WHEN outcome_valence IS NOT NULL THEN outcome_valence ELSE 0 END)`
  // — AVG already skips nulls, so that CASE existed only to fold unmeasured
  // outcomes in as neutral ones. A company with two good outcomes and ninety-
  // eight unmeasured ones scored the same as one that had gone nowhere.
  const measuredDecisions = Number(decisions.measured_outcomes ?? 0);
  const avgValence = measuredDecisions > 0 ? Number(decisions.avg_valence ?? 0) : null;
  const decisionScore = avgValence === null ? 50 : Math.round(((avgValence + 1) / 2) * 100);

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

  // A GAP IS SOMETHING WE MEASURED AND FOUND WANTING. Not knowing is its own
  // line, in its own words — a founder can act on "nobody has measured this",
  // and cannot act on a finding about a number that does not exist.
  const key_gaps: string[] = [];
  const unmeasured: string[] = [];
  if (criticalStressors > 0) key_gaps.push(`${criticalStressors} critical stressor(s) unresolved`);

  if (healthRatio === null) unmeasured.push('MRR health ratio — no revenue snapshot reported');
  else if (mrrScore < 60) key_gaps.push('MRR health ratio indicates churn exceeds new revenue');

  if (churn === null) unmeasured.push('Churn rate — no churn figure reported');
  else if (churnScore < 60) key_gaps.push('Churn rate above acceptable threshold for this stage');

  if (activation === null) unmeasured.push('Activation rate — no activation figure reported');
  else if (activationScore < 60) key_gaps.push('Activation rate below benchmarks for fundraising');

  if (auditComposite === null) unmeasured.push('Technical audit — no audit has been run');
  else if (auditScore < 60) key_gaps.push('Technical audit score below threshold — product readiness concerns');

  if (avgValence === null) unmeasured.push('Decision track record — no decision outcome has been measured');

  // Team size and DNA completion are counts, not measurements: zero of either
  // is a real answer about the company, so they stay gaps.
  if (teamScore < 70) key_gaps.push('Solo founder risk — co-founder or key hire recommended');
  if (marketScore < 60) key_gaps.push('Product DNA incomplete — market story not fully articulated');

  const measuredComponents = [healthRatio, churn, activation, auditComposite, avgValence]
    .filter((v) => v !== null).length + 2;

  // AN UNMEASURED COMPANY IS NOT A READY ONE. `key_gaps` no longer collects the
  // fabricated findings, so without this a company that reported nothing would
  // reach `raise_ready` on an empty gap list — the old bug's mirror image, and
  // the more dangerous of the two in a fundraising document.
  const verdict: 'raise_ready' | 'almost_ready' | 'not_ready' =
    score >= 75 && key_gaps.length === 0 && unmeasured.length === 0 ? 'raise_ready' :
    score >= 60 && key_gaps.length <= 2 && unmeasured.length <= 1 ? 'almost_ready' : 'not_ready';

  // Generate narrative
  const systemPrompt = `You write concise funding readiness assessments for SaaS founders. Be direct and honest.`;
  // The model is told which components are unmeasured. Handed "Churn: 50/100"
  // with no such note, a model asked what is strongest reads it as a middling
  // measurement, and says so to a founder about to raise money.
  const scoreLine = (label: string, value: number, known: boolean) =>
    known ? `${label}: ${value}/100` : `${label}: not measured`;
  const userPrompt = `Score: ${score}/100, from ${measuredComponents} of 7 components with real inputs behind them. Verdict: ${verdict.replace('_', ' ')}.
Key gaps (measured and found wanting): ${key_gaps.length > 0 ? key_gaps.join('; ') : 'None'}.
Not measured at all: ${unmeasured.length > 0 ? unmeasured.join('; ') : 'None'}.
${scoreLine('MRR health', mrrScore, healthRatio !== null)}. ${scoreLine('Churn', churnScore, churn !== null)}. ${scoreLine('Activation', activationScore, activation !== null)}.
Write exactly 3 sentences: what the score means, what's strongest, what's most critical to fix before raising. Do not describe an unmeasured component as good or bad — say it is unmeasured.`;

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
    unmeasured,
    measured_components: { measured: measuredComponents, total: 7 },
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
