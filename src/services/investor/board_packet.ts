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

// ─── Generate Board Packet ────────────────────────────────────────────────────

/**
 * Generate a quarterly board packet for a product.
 * Assembles all relevant data and calls Claude Opus for narrative sections.
 */
export async function generateBoardPacket(
  productId: string,
  quarter: string,  // e.g. "2026-Q1"
): Promise<BoardPacket> {
  // Determine period dates from quarter string
  const [year, q] = quarter.split('-Q');
  const qNum = parseInt(q);
  const periodStart = new Date(parseInt(year), (qNum - 1) * 3, 1).toISOString().slice(0, 10);
  const periodEnd = new Date(parseInt(year), qNum * 3, 0).toISOString().slice(0, 10);

  // ── Load data in parallel ─────────────────────────────────────────────────
  const [
    signalHistory,
    resolvedDecisions,
    activeStressors,
    resolvedStressors,
    milestones,
    cohortResult,
    mrrResult,
    competitiveSignals,
    auditResult,
  ] = await Promise.all([
    getSignalHistory(productId, 90),
    query(
      `SELECT what, chosen_option, outcome, outcome_valence, decided_at, category
       FROM decisions WHERE product_id = ? AND status IN ('approved','executed','rejected')
         AND decided_at BETWEEN ? AND ? ORDER BY decided_at DESC`,
      [productId, periodStart, periodEnd],
    ),
    getActiveStressors(productId),
    query(
      `SELECT stressor_name, severity, resolved_at, resolution_notes
       FROM stressor_history WHERE product_id = ? AND status = 'resolved'
         AND resolved_at BETWEEN ? AND ? ORDER BY resolved_at DESC`,
      [productId, periodStart, periodEnd],
    ),
    query(
      `SELECT title, artifact_type, created_at FROM founding_story_artifacts
       WHERE product_id = ? AND created_at BETWEEN ? AND ? ORDER BY created_at ASC`,
      [productId, periodStart, periodEnd],
    ),
    query(
      `SELECT acquisition_period, founder_count, activated_count, retained_day_30,
              converted_to_paid, mrr_contribution_cents
       FROM cohorts WHERE product_id = ? AND acquisition_period BETWEEN ? AND ?
       ORDER BY acquisition_period DESC LIMIT 3`,
      [productId, periodStart, periodEnd],
    ),
    getMRRDecomposition(productId).catch(() => null),
    query(
      `SELECT signal_summary, significance, competitor_name, signal_type
       FROM competitive_signals WHERE product_id = ? AND detected_at BETWEEN ? AND ?
         AND significance != 'low' ORDER BY detected_at DESC LIMIT 5`,
      [productId, periodStart, periodEnd],
    ),
    query(
      `SELECT composite, verdict, created_at FROM audit_scores
       WHERE product_id = ? ORDER BY created_at DESC LIMIT 2`,
      [productId],
    ),
  ]);

  // ── Compute Signal trajectory ─────────────────────────────────────────────
  const signalAtStart = signalHistory[0]?.score ?? null;
  const signalAtEnd = signalHistory[signalHistory.length - 1]?.score ?? null;
  const signalDelta = (signalAtStart !== null && signalAtEnd !== null) ? signalAtEnd - signalAtStart : null;

  // ── Build context for AI ───────────────────────────────────────────────────
  const contextParts: string[] = [
    `Quarter: ${quarter}`,
    `Signal: ${signalAtStart ?? 'N/A'} → ${signalAtEnd ?? 'N/A'}${signalDelta !== null ? ` (${signalDelta >= 0 ? '+' : ''}${signalDelta})` : ''}`,
  ];

  if (mrrResult) {
    contextParts.push(`MRR: $${Math.round(mrrResult.total_cents / 100).toLocaleString()} total`);
    contextParts.push(`  New: $${Math.round(mrrResult.new_mrr_cents / 100).toLocaleString()} | Churned: $${Math.round(mrrResult.churned_mrr_cents / 100).toLocaleString()}`);
  }

  const resolvedDecs = resolvedDecisions.rows as Array<Record<string, unknown>>;
  if (resolvedDecs.length > 0) {
    contextParts.push(`\nKey decisions (${resolvedDecs.length}):`);
    for (const d of resolvedDecs.slice(0, 5)) {
      const valence = d.outcome_valence === 1 ? '✓' : d.outcome_valence === -1 ? '✗' : '?';
      contextParts.push(`  [${valence}] ${d.what} → ${d.chosen_option ?? 'undecided'}`);
      if (d.outcome) contextParts.push(`    Outcome: ${d.outcome}`);
    }
  }

  const resolvedRows = resolvedStressors.rows as Array<Record<string, string>>;
  if (resolvedRows.length > 0) {
    contextParts.push(`\nStressors resolved (${resolvedRows.length}):`);
    for (const s of resolvedRows.slice(0, 3)) {
      contextParts.push(`  ${s.stressor_name} [${s.severity}]`);
      if (s.resolution_notes) contextParts.push(`    ${s.resolution_notes}`);
    }
  }

  const activeRows = activeStressors.rows as Array<Record<string, string>>;
  if (activeRows.length > 0) {
    contextParts.push(`\nActive stressors (${activeRows.length}):`);
    for (const s of activeRows.slice(0, 3)) {
      contextParts.push(`  [${s.severity}] ${s.stressor_name}: ${s.signal}`);
    }
  }

  const milestoneRows = milestones.rows as Array<Record<string, string>>;
  if (milestoneRows.length > 0) {
    contextParts.push(`\nMilestones: ${milestoneRows.map((m) => m.title).join('; ')}`);
  }

  const compRows = competitiveSignals.rows as Array<Record<string, string>>;
  if (compRows.length > 0) {
    contextParts.push(`\nCompetitive signals: ${compRows.map((s) => `${s.competitor_name}: ${s.signal_summary}`).join('; ')}`);
  }

  const context = contextParts.join('\n');

  // ── Generate narrative sections ───────────────────────────────────────────
  const systemPrompt = `You are writing board packet sections for a SaaS company's quarterly investor update.
Be direct, precise, and honest. Use specific numbers. No hedging. Write as an informed CFO/CEO would.
Each section should be 3-5 sentences. Professional but not corporate.`;

  const [
    execSummary,
    signalNarrative,
    mrrNarrative,
    cohortNarrative,
    competitiveNarrative,
    nextQuarterFocus,
  ] = await Promise.all([
    generateNarrativeSection(systemPrompt, context, 'executive_summary',
      'Write a 3-4 sentence executive summary of the quarter. Lead with the most important truth.'),
    generateNarrativeSection(systemPrompt, context, 'signal_narrative',
      'Write 3 sentences describing the Signal trajectory this quarter and what drove the change.'),
    generateNarrativeSection(systemPrompt, context, 'mrr_narrative',
      'Write 3-4 sentences about revenue: trajectory, health ratio, notable changes, and what it means.'),
    generateNarrativeSection(systemPrompt, context, 'cohort_narrative',
      'Write 3 sentences about cohort performance: activation, retention trends, and implications.'),
    generateNarrativeSection(systemPrompt, context, 'competitive_narrative',
      'Write 2-3 sentences about the competitive landscape this quarter. Only include if there were notable signals.'),
    generateNarrativeSection(systemPrompt, context, 'next_quarter_focus',
      'Write 3 clear sentences about the top 2-3 priorities for the coming quarter based on current Signal and stressors.'),
  ]);

  // ── Persist ───────────────────────────────────────────────────────────────
  const packetId = nanoid();

  await query(
    `INSERT INTO board_packets
     (id, product_id, quarter, period_start, period_end,
      executive_summary, signal_narrative, mrr_narrative,
      cohort_narrative, competitive_narrative, next_quarter_focus,
      key_decisions_made, stressors_resolved, stressors_active, milestones_crossed,
      signal_start, signal_end, signal_delta, generated_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'draft')
     ON CONFLICT(product_id, quarter) DO UPDATE SET
       executive_summary = excluded.executive_summary,
       signal_narrative = excluded.signal_narrative,
       mrr_narrative = excluded.mrr_narrative,
       cohort_narrative = excluded.cohort_narrative,
       competitive_narrative = excluded.competitive_narrative,
       next_quarter_focus = excluded.next_quarter_focus,
       key_decisions_made = excluded.key_decisions_made,
       stressors_resolved = excluded.stressors_resolved,
       stressors_active = excluded.stressors_active,
       milestones_crossed = excluded.milestones_crossed,
       signal_start = excluded.signal_start,
       signal_end = excluded.signal_end,
       signal_delta = excluded.signal_delta,
       generated_at = excluded.generated_at`,
    [
      packetId, productId, quarter, periodStart, periodEnd,
      execSummary, signalNarrative, mrrNarrative, cohortNarrative, competitiveNarrative, nextQuarterFocus,
      JSON.stringify(resolvedDecs.slice(0, 10)),
      JSON.stringify(resolvedRows.slice(0, 5)),
      JSON.stringify(activeRows.slice(0, 5)),
      JSON.stringify(milestoneRows),
      signalAtStart, signalAtEnd, signalDelta,
    ],
  );

  return {
    id: packetId,
    product_id: productId,
    quarter,
    period_start: periodStart,
    period_end: periodEnd,
    executive_summary: execSummary,
    signal_narrative: signalNarrative,
    key_decisions_made: resolvedDecs.slice(0, 10) as any,
    milestones_crossed: milestoneRows as any,
    stressors_resolved: resolvedRows.slice(0, 5) as any,
    stressors_active: activeRows as any,
    mrr_narrative: mrrNarrative,
    cohort_narrative: cohortNarrative,
    competitive_narrative: competitiveNarrative,
    next_quarter_focus: nextQuarterFocus,
    signal_start: signalAtStart,
    signal_end: signalAtEnd,
    signal_delta: signalDelta,
    generated_at: new Date().toISOString(),
    finalized_at: null,
    shared_with: null,
    status: 'draft' as BoardPacketStatus,
  };
}

// ─── Funding Readiness Score ──────────────────────────────────────────────────

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
    const r = await callOpus(systemPrompt, userPrompt, 256);
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
): Promise<string> {
  try {
    const r = await callOpus(systemPrompt, `Business data:\n${context}\n\nInstruction: ${instruction}`, 512);
    return r.content.trim();
  } catch {
    return '';
  }
}
