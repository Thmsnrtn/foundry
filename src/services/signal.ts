// =============================================================================
// FOUNDRY — Signal Score Engine
// Computes the single 0-100 Signal from all available product data.
// Also generates and caches the three-sentence AI prose summary.
// =============================================================================

import {
  query,
  getActiveStressors,
  getLatestMetrics,
  getPendingDecisions,
  getLifecycleState,
} from '../db/client.js';
import { callSonnet } from './ai/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SignalTier = 'high' | 'mid' | 'low';

export interface SignalComponents {
  riskStatePenalty: number;
  stressorPenalty: number;
  mrrPenalty: number;
  backlogPenalty: number;
  lifecycleBonus: number;
}

export interface SignalResult {
  score: number;
  tier: SignalTier;
  prose: string;
  components: SignalComponents;
  riskState: 'green' | 'yellow' | 'red';
}

// ─── Prose Cache ──────────────────────────────────────────────────────────────

interface CacheEntry {
  prose: string;
  score: number;
  expires: number;
}

const proseCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const SCORE_DRIFT_THRESHOLD = 5; // regenerate if score moves this much

// ─── Lifecycle Stage → Index ──────────────────────────────────────────────────

const PROMPT_INDEX: Record<string, number> = {
  prompt_1: 0, prompt_2: 1, prompt_2_5: 2,
  prompt_3: 3, prompt_4: 4, prompt_5: 5,
  prompt_6: 6, prompt_7: 7, prompt_8: 8, prompt_9: 9,
};

// ─── Core Computation ─────────────────────────────────────────────────────────

export async function computeSignal(productId: string): Promise<SignalResult> {
  const [stressorResult, metricsResult, decisionsResult, lifecycleResult] = await Promise.all([
    getActiveStressors(productId),
    getLatestMetrics(productId),
    getPendingDecisions(productId),
    getLifecycleState(productId),
  ]);

  const stressors = stressorResult.rows as Array<Record<string, string>>;
  const metrics = (metricsResult.rows[0] ?? {}) as Record<string, unknown>;
  const decisions = decisionsResult.rows as Array<Record<string, string>>;
  const lifecycle = (lifecycleResult.rows[0] ?? {}) as Record<string, unknown>;

  const riskState = (lifecycle.risk_state as 'green' | 'yellow' | 'red') ?? 'green';
  const currentPrompt = (lifecycle.current_prompt as string) ?? 'prompt_1';

  // ── Risk state ceiling (applied after scoring) ──
  const riskCeiling = riskState === 'red' ? 40 : riskState === 'yellow' ? 72 : 100;

  // ── Stressor penalty ──
  const critical = stressors.filter((s) => s.severity === 'critical').length;
  const elevated = stressors.filter((s) => s.severity === 'elevated').length;
  const watch = stressors.filter((s) => s.severity === 'watch').length;
  const stressorPenalty = Math.min(critical * 20 + elevated * 8 + watch * 3, 40);

  // ── MRR health penalty ──
  const healthRatio = metrics.mrr_health_ratio as number | null;
  let mrrPenalty = 5; // default: unknown data
  if (healthRatio !== null && healthRatio !== undefined) {
    if (healthRatio > 1.5) mrrPenalty = 25;
    else if (healthRatio > 1.0) mrrPenalty = Math.round((healthRatio - 1.0) * 50);
    else if (healthRatio > 0.7) mrrPenalty = Math.round((healthRatio - 0.7) * 16);
    else mrrPenalty = 0;
  }

  // ── Decision backlog penalty ──
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const overdueDecisions = decisions.filter(
    (d) => d.created_at && d.created_at < sevenDaysAgo
  ).length;
  const backlogPenalty = Math.min(overdueDecisions * 3, 15);

  // ── Lifecycle bonus ──
  const promptIdx = PROMPT_INDEX[currentPrompt] ?? 0;
  const lifecycleBonus = Math.round((promptIdx / 9) * 10);

  // ── Risk state penalty for scoring (separate from ceiling) ──
  const riskStatePenalty = riskState === 'red' ? 0 : riskState === 'yellow' ? 0 : 0;
  // (ceiling handles risk state impact — no double-counting)

  // ── Raw score ──
  const BASE = 85;
  const raw = BASE - stressorPenalty - mrrPenalty - backlogPenalty + lifecycleBonus;
  const capped = Math.min(raw, riskCeiling);
  const score = Math.max(0, Math.min(100, Math.round(capped)));

  const tier: SignalTier = score >= 70 ? 'high' : score >= 40 ? 'mid' : 'low';

  // ── Prose generation with cache ──
  const prose = await getOrGenerateProse(productId, score, {
    riskState,
    currentPrompt,
    stressors,
    metrics,
    decisions,
    critical,
    elevated,
    watch,
  });

  return {
    score,
    tier,
    prose,
    components: { riskStatePenalty, stressorPenalty, mrrPenalty, backlogPenalty, lifecycleBonus },
    riskState,
  };
}

// ─── Prose Generation ─────────────────────────────────────────────────────────

interface ProseContext {
  riskState: string;
  currentPrompt: string;
  stressors: Array<Record<string, string>>;
  metrics: Record<string, unknown>;
  decisions: Array<Record<string, string>>;
  critical: number;
  elevated: number;
  watch: number;
}

async function getOrGenerateProse(
  productId: string,
  score: number,
  ctx: ProseContext
): Promise<string> {
  const now = Date.now();
  const cached = proseCache.get(productId);

  if (cached && cached.expires > now && Math.abs(cached.score - score) < SCORE_DRIFT_THRESHOLD) {
    return cached.prose;
  }

  const prose = await generateProse(score, ctx);

  proseCache.set(productId, { prose, score, expires: now + CACHE_TTL_MS });

  return prose;
}

async function generateProse(score: number, ctx: ProseContext): Promise<string> {
  const { riskState, currentPrompt, stressors, metrics, decisions, critical, elevated, watch } = ctx;

  const healthRatio = metrics.mrr_health_ratio as number | null;
  const newMrr = metrics.new_mrr_cents as number | null;
  const churnedMrr = metrics.churned_mrr_cents as number | null;

  const mrrSummary = healthRatio !== null
    ? `Health ratio ${healthRatio.toFixed(2)} (${healthRatio > 1 ? 'churning faster than growing' : 'growing faster than churning'})`
    : newMrr !== null
      ? `New MRR $${Math.round(newMrr / 100)}, Churned MRR $${Math.round((churnedMrr ?? 0) / 100)}`
      : 'No MRR data available';

  const stressorSummary = stressors.length === 0
    ? 'none'
    : `${critical} critical, ${elevated} elevated, ${watch} watch-level`;

  const oldestDecision = decisions.length > 0
    ? Math.round((Date.now() - new Date(decisions[decisions.length - 1].created_at).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  const systemPrompt = `You are the intelligence layer for Foundry, a business analytics platform for SaaS founders. You write honest, direct briefings. No hedging. No "you might want to" language. No soft qualifiers. State what the data means. Your tone is clear and confident — like a CFO who has seen a thousand companies.`;

  const userPrompt = `Write exactly 3 sentences that tell the most important truth about this business right now. Each sentence must be standalone. Be direct. Do not use bullet points, numbers, or headings. Do not start sentences with "I" or "You". State facts and their significance.

Signal Score: ${score}/100
Risk State: ${riskState.toUpperCase()}
Stage: ${currentPrompt.replace('_', ' ')} of 9
Active Stressors: ${stressorSummary}
MRR: ${mrrSummary}
Pending Decisions: ${decisions.length}${decisions.length > 0 ? `, oldest is ${oldestDecision} days old` : ''}

3 sentences only. No formatting. No line breaks between sentences.`;

  try {
    const response = await callSonnet(systemPrompt, userPrompt, 256);
    const text = response.content.trim();
    // Ensure we have something sensible
    if (text.length < 20) return buildFallbackProse(score, ctx);
    return text;
  } catch {
    return buildFallbackProse(score, ctx);
  }
}

function buildFallbackProse(score: number, ctx: ProseContext): string {
  const { riskState, stressors, decisions } = ctx;
  const lines: string[] = [];

  if (riskState === 'red') {
    lines.push('This business is in recovery mode and requires immediate attention.');
  } else if (riskState === 'yellow') {
    lines.push(`Signal is at ${score} — heightened monitoring is active.`);
  } else {
    lines.push(`Signal is at ${score} — operations are stable.`);
  }

  if (stressors.length > 0) {
    const critical = stressors.filter((s) => s.severity === 'critical');
    lines.push(
      critical.length > 0
        ? `${critical.length} critical stressor${critical.length > 1 ? 's' : ''} need resolution: ${critical[0].stressor_name}.`
        : `${stressors.length} active stressor${stressors.length > 1 ? 's' : ''} identified.`
    );
  } else {
    lines.push('No active stressors detected this cycle.');
  }

  if (decisions.length > 0) {
    lines.push(`${decisions.length} decision${decisions.length > 1 ? 's' : ''} waiting in queue.`);
  } else {
    lines.push('Decision queue is clear.');
  }

  return lines.join(' ');
}

// ─── Invalidate Cache ─────────────────────────────────────────────────────────

/**
 * Force-expire the prose cache for a product.
 * Call this when significant state changes occur.
 */
export function invalidateSignalCache(productId: string): void {
  proseCache.delete(productId);
}
