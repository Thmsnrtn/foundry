// =============================================================================
// FOUNDRY — Conversation Context Builder
// Assembles the richest possible business context for Ask Foundry.
// Includes Signal, stressors, decisions, metrics, wisdom DNA, history,
// playbooks, team, and recent temporal events — everything the AI needs
// to answer as a true co-founder with deep product knowledge.
// =============================================================================

import {
  query,
  getActiveStressors,
  getLatestMetrics,
  getPendingDecisions,
  getLifecycleState,
} from '../../db/client.js';
import { getMRRDecomposition } from '../intelligence/revenue.js';
import { buildWisdomContext } from '../wisdom/dna.js';
import { computeSignal } from '../signal.js';
import { getSignalHistory } from '../signal.js';

export interface FullConversationContext {
  // Core state
  signal: number;
  riskState: string;
  currentPrompt: string;
  productName: string;
  marketCategory: string | null;

  // Intelligence
  stressors: Array<{ name: string; severity: string; signal: string; neutralizing_action: string }>;
  pendingDecisions: Array<{ what: string; category: string; gate: number; created_at: string }>;

  // Metrics
  mrr: { total: number; new: number; churned: number; expansion: number; contraction: number } | null;
  metrics: {
    activationRate: number | null;
    day30Retention: number | null;
    churnRate: number | null;
    nps: number | null;
    signups7d: number | null;
    activeUsers: number | null;
    healthRatio: number | null;
    supportVolume: number | null;
  };

  // Signal history summary
  signalTrend: string;  // "improving", "declining", "stable"
  signalDelta7d: number | null;

  // Wisdom
  wisdomContext: string;
  wisdomActive: boolean;
  dnaCompletionPct: number;

  // Recent resolved decisions (last 90 days)
  recentDecisions: Array<{ what: string; chosen_option: string | null; outcome: string | null; decided_at: string | null }>;

  // Integrations connected
  connectedIntegrations: string[];
}

/**
 * Build the full context package for a conversation request.
 * Parallelized for speed — typically resolves in <300ms.
 */
export async function buildConversationContext(
  productId: string,
  productName: string,
  marketCategory: string | null,
): Promise<FullConversationContext> {
  const [
    stressorResult,
    metricsResult,
    decisionsResult,
    lifecycleResult,
    mrrResult,
    wisdomCtx,
    signal,
    historyResult,
    resolvedDecisions,
    integrationsResult,
  ] = await Promise.all([
    getActiveStressors(productId),
    getLatestMetrics(productId),
    getPendingDecisions(productId),
    getLifecycleState(productId),
    getMRRDecomposition(productId).catch(() => null),
    buildWisdomContext(productId).catch(() => null),
    computeSignal(productId),
    getSignalHistory(productId, 7),
    query(
      `SELECT what, chosen_option, outcome, decided_at FROM decisions
       WHERE product_id = ? AND status IN ('approved','executed','rejected')
         AND decided_at > date('now', '-90 days')
       ORDER BY decided_at DESC LIMIT 10`,
      [productId],
    ),
    query(
      `SELECT type FROM integrations WHERE product_id = ? AND status = 'active'`,
      [productId],
    ),
  ]);

  const metrics = (metricsResult.rows[0] ?? {}) as Record<string, unknown>;
  const lifecycle = (lifecycleResult.rows[0] ?? {}) as Record<string, unknown>;

  // Signal trend from 7-day history
  let signalTrend = 'stable';
  let signalDelta7d: number | null = null;
  if (historyResult.length >= 2) {
    const first = historyResult[0].score;
    const last = historyResult[historyResult.length - 1].score;
    signalDelta7d = last - first;
    if (signalDelta7d > 3) signalTrend = 'improving';
    else if (signalDelta7d < -3) signalTrend = 'declining';
  }

  return {
    signal: signal.score,
    riskState: signal.riskState,
    currentPrompt: (lifecycle.current_prompt as string) ?? 'prompt_1',
    productName,
    marketCategory,

    stressors: stressorResult.rows.map((r) => {
      const row = r as Record<string, string>;
      return { name: row.stressor_name, severity: row.severity, signal: row.signal, neutralizing_action: row.neutralizing_action };
    }),

    pendingDecisions: decisionsResult.rows.map((r) => {
      const row = r as Record<string, unknown>;
      return { what: row.what as string, category: row.category as string, gate: row.gate as number, created_at: row.created_at as string };
    }),

    mrr: mrrResult ? {
      total: Math.round(mrrResult.total_cents / 100),
      new: Math.round(mrrResult.new_mrr_cents / 100),
      churned: Math.round(mrrResult.churned_mrr_cents / 100),
      expansion: Math.round(mrrResult.expansion_mrr_cents / 100),
      contraction: Math.round(mrrResult.contraction_mrr_cents / 100),
    } : null,

    metrics: {
      activationRate: metrics.activation_rate as number | null,
      day30Retention: metrics.day_30_retention as number | null,
      churnRate: metrics.churn_rate as number | null,
      nps: metrics.nps_score as number | null,
      signups7d: metrics.signups_7d as number | null,
      activeUsers: metrics.active_users as number | null,
      healthRatio: metrics.mrr_health_ratio as number | null,
      supportVolume: metrics.support_volume_7d as number | null,
    },

    signalTrend,
    signalDelta7d,

    wisdomContext: wisdomCtx?.dna_context ?? '',
    wisdomActive: wisdomCtx?.wisdom_active ?? false,
    dnaCompletionPct: wisdomCtx?.dna_completion_pct ?? 0,

    recentDecisions: resolvedDecisions.rows.map((r) => r as unknown as {
      what: string; chosen_option: string | null; outcome: string | null; decided_at: string | null
    }),

    connectedIntegrations: integrationsResult.rows.map((r) => (r as Record<string, string>).type),
  };
}

/**
 * Format the context into a system prompt string for injection into Claude.
 */
export function formatContextForPrompt(ctx: FullConversationContext): string {
  const lines: string[] = [
    `=== BUSINESS CONTEXT ===`,
    `Product: ${ctx.productName}${ctx.marketCategory ? ` (${ctx.marketCategory})` : ''}`,
    `Signal: ${ctx.signal}/100 (${ctx.riskState.toUpperCase()}) — ${ctx.signalTrend}${ctx.signalDelta7d !== null ? `, ${ctx.signalDelta7d > 0 ? '+' : ''}${ctx.signalDelta7d} pts in 7d` : ''}`,
    `Stage: ${ctx.currentPrompt.replace('_', ' ')} of 9`,
    '',
  ];

  if (ctx.mrr) {
    lines.push(
      'REVENUE:',
      `  Total MRR: $${ctx.mrr.total.toLocaleString()}`,
      `  New: $${ctx.mrr.new.toLocaleString()} | Churned: $${ctx.mrr.churned.toLocaleString()} | Expansion: $${ctx.mrr.expansion.toLocaleString()}`,
    );
    if (ctx.metrics.healthRatio !== null) {
      lines.push(`  Health Ratio: ${ctx.metrics.healthRatio.toFixed(2)} (${ctx.metrics.healthRatio > 1 ? 'churning faster than growing' : 'growing faster than churning'})`);
    }
    lines.push('');
  }

  const metricLines: string[] = [];
  if (ctx.metrics.activationRate !== null) metricLines.push(`Activation: ${(ctx.metrics.activationRate * 100).toFixed(1)}%`);
  if (ctx.metrics.day30Retention !== null) metricLines.push(`Day 30 retention: ${(ctx.metrics.day30Retention * 100).toFixed(1)}%`);
  if (ctx.metrics.churnRate !== null) metricLines.push(`Churn rate: ${(ctx.metrics.churnRate * 100).toFixed(1)}%`);
  if (ctx.metrics.nps !== null) metricLines.push(`NPS: ${ctx.metrics.nps}`);
  if (ctx.metrics.signups7d !== null) metricLines.push(`Signups 7d: ${ctx.metrics.signups7d}`);
  if (ctx.metrics.activeUsers !== null) metricLines.push(`Active users: ${ctx.metrics.activeUsers}`);
  if (ctx.metrics.supportVolume !== null) metricLines.push(`Support volume 7d: ${ctx.metrics.supportVolume}`);

  if (metricLines.length > 0) {
    lines.push('METRICS:', ...metricLines.map((m) => `  ${m}`), '');
  }

  if (ctx.stressors.length > 0) {
    lines.push('ACTIVE STRESSORS:');
    for (const s of ctx.stressors) {
      lines.push(`  [${s.severity.toUpperCase()}] ${s.name}: ${s.signal}`);
      lines.push(`  → ${s.neutralizing_action}`);
    }
    lines.push('');
  }

  if (ctx.pendingDecisions.length > 0) {
    lines.push(`PENDING DECISIONS (${ctx.pendingDecisions.length}):`);
    for (const d of ctx.pendingDecisions.slice(0, 5)) {
      const age = Math.round((Date.now() - new Date(d.created_at).getTime()) / (1000 * 60 * 60 * 24));
      lines.push(`  [Gate ${d.gate}] ${d.what} — ${d.category}, ${age}d old`);
    }
    lines.push('');
  }

  if (ctx.recentDecisions.length > 0) {
    lines.push('RECENT DECISIONS (last 90 days):');
    for (const d of ctx.recentDecisions.slice(0, 5)) {
      lines.push(`  "${d.what}"${d.chosen_option ? ` → chose: ${d.chosen_option}` : ''}${d.outcome ? ` | outcome: ${d.outcome}` : ''}`);
    }
    lines.push('');
  }

  if (ctx.connectedIntegrations.length > 0) {
    lines.push(`CONNECTED INTEGRATIONS: ${ctx.connectedIntegrations.join(', ')}`, '');
  }

  if (ctx.wisdomContext) {
    lines.push(ctx.wisdomContext);
  }

  lines.push('=== END BUSINESS CONTEXT ===');
  return lines.join('\n');
}
