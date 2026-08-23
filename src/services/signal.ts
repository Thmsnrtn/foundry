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
import { nanoid } from 'nanoid';
import { logger } from './logger.js';

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
  /** False for a brand-new product with no metrics yet: the score is a default,
   *  not a measurement. First-run surfaces must say "not enough data yet"
   *  rather than present a falsely-confident number (Honesty Law). */
  hasData: boolean;
}

/**
 * HOW A SIGNAL IS SPOKEN, WRITTEN OR PUT INTO A PROMPT.
 *
 * `hasData` is declared above with the Honesty Law and the sentence "First-run
 * surfaces must say 'not enough data yet' rather than present a
 * falsely-confident number". It was honoured by ONE of the ten places that
 * compute a Signal. The other nine printed the default — a company Foundry had
 * never measured appearing as a confident 85 out of 100 — on a public share
 * link, in a spoken briefing, in two model prompts, in the fleet ranking, over
 * the API, and as the baseline for a drop alert.
 *
 * The rule was written down. What was missing was one way to obey it, so this
 * is that way, and a test requires every consumer to use it or say why not.
 */
export function signalText(signal: Pick<SignalResult, 'score' | 'tier' | 'hasData'>): string {
  return signal.hasData ? `${signal.score}/100 (${signal.tier} tier)` : 'not enough data yet';
}

/** For a number beside a label, where the label already says "Signal". */
export function signalNumber(signal: Pick<SignalResult, 'score' | 'hasData'>): string {
  return signal.hasData ? String(signal.score) : '—';
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

/** Parse a DB timestamp that may be SQLite space-format (UTC) or ISO. */
function parseDbDate(s: string): number {
  return Date.parse(/[zZ+]|T.*[+-]\d\d/.test(s) ? s : s.replace(' ', 'T') + 'Z');
}

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

  // A product with no metric snapshot yet has no measured Signal — the score
  // below is a default, and first-run surfaces must not present it as truth.
  const hasData = metricsResult.rows.length > 0;

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
    // Monotone in the ratio: crossing 1.0 (net churn) must never score BETTER
    // than sitting just below it. 0.7→1.0 ramps 0→5; 1.0→1.5 ramps 5→25.
    if (healthRatio > 1.5) mrrPenalty = 25;
    else if (healthRatio > 1.0) mrrPenalty = Math.round(5 + (healthRatio - 1.0) * 40);
    else if (healthRatio > 0.7) mrrPenalty = Math.round((healthRatio - 0.7) * 16);
    else mrrPenalty = 0;
  }

  // ── Decision backlog penalty ──
  // created_at may be SQLite space-format or ISO — parse rather than compare
  // strings (a lexical compare across the two formats skews by up to a day).
  const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const overdueDecisions = decisions.filter(
    (d) => d.created_at && parseDbDate(d.created_at) < sevenDaysAgoMs
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

  // Record history snapshot (UPSERT: one per product per day).
  //
  // A DEFAULT IS NOT A MEASUREMENT AND DOES NOT ENTER THE RECORD. This wrote a
  // row whatever `hasData` said, so a company with no metrics accumulated a
  // history of defaults that later read as its past. Three things consumed
  // that: the share page's 90-day sparkline drew a flat line nobody had
  // measured; `conversation/context.ts` computed a 7-day trend from it; and
  // `signalAlertCheck` compared today's first real score against yesterday's
  // default and told the founder their Signal had fallen thirty points from a
  // number their company was never at.
  //
  // Not writing is better than writing a flag, because every reader of
  // `signal_history` then gets the guarantee for free rather than having to
  // remember it. A gap in the history means nothing was known that day, which
  // is what a gap should mean.
  if (hasData) {
    void recordSignalSnapshot(productId, score, tier, riskState, stressors.length, {
      riskStatePenalty, stressorPenalty, mrrPenalty, backlogPenalty, lifecycleBonus,
    });
  }

  return {
    score,
    tier,
    prose,
    components: { riskStatePenalty, stressorPenalty, mrrPenalty, backlogPenalty, lifecycleBonus },
    riskState,
    hasData,
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

  const prose = await generateProse(score, ctx, productId);

  proseCache.set(productId, { prose, score, expires: now + CACHE_TTL_MS });

  return prose;
}

async function generateProse(score: number, ctx: ProseContext, productId: string): Promise<string> {
  const { riskState, currentPrompt, stressors, metrics, decisions, critical, elevated, watch } = ctx;

  // Use loose != null so BOTH null and undefined are treated as "no data".
  // A brand-new founder has no metrics row, so these keys are undefined — a
  // strict !== null guard let undefined through and crashed .toFixed() on the
  // core dashboard for every new user.
  const healthRatio = (metrics.mrr_health_ratio ?? null) as number | null;
  const newMrr = (metrics.new_mrr_cents ?? null) as number | null;
  const churnedMrr = (metrics.churned_mrr_cents ?? null) as number | null;

  const mrrSummary = healthRatio != null
    ? `Health ratio ${healthRatio.toFixed(2)} (${healthRatio > 1 ? 'churning faster than growing' : 'growing faster than churning'})`
    : newMrr != null
      ? `New MRR $${Math.round(newMrr / 100)}, Churned MRR $${Math.round((churnedMrr ?? 0) / 100)}`
      : 'No MRR data available';

  const stressorSummary = stressors.length === 0
    ? 'none'
    : `${critical} critical, ${elevated} elevated, ${watch} watch-level`;

  // getPendingDecisions orders by category rank first, so the last row is NOT
  // the oldest — take the true minimum created_at across all pending rows.
  const oldestDecision = decisions.length > 0
    ? Math.round((Date.now() - Math.min(...decisions.map((d) => parseDbDate(d.created_at)))) / (1000 * 60 * 60 * 24))
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
    const response = await callSonnet(systemPrompt, userPrompt, 256, productId);
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

// ─── History Recording ────────────────────────────────────────────────────────

/**
 * UPSERT one Signal snapshot per product per day.
 * Called at end of computeSignal() — safe to call on every page load.
 */
async function recordSignalSnapshot(
  productId: string,
  score: number,
  tier: SignalTier,
  riskState: string,
  stressorCount: number,
  components: SignalComponents,
): Promise<void> {
  try {
    await query(
      `INSERT INTO signal_history (id, product_id, score, tier, risk_state, stressor_count, snapshot_date, components_json)
       VALUES (?, ?, ?, ?, ?, ?, date('now'), ?)
       ON CONFLICT(product_id, snapshot_date) DO UPDATE SET
         score = excluded.score,
         tier  = excluded.tier,
         risk_state = excluded.risk_state,
         stressor_count = excluded.stressor_count,
         components_json = excluded.components_json,
         recorded_at = CURRENT_TIMESTAMP`,
      [nanoid(), productId, score, tier, riskState, stressorCount, JSON.stringify(components)],
    );
  } catch (err) {
    // NON-CRITICAL IS NOT THE SAME AS UNSAID. Not letting history recording
    // break the Signal read is the right call and it stays. But this catch was
    // bare, so a write that failed every day left `signal_history` full of
    // holes in silence — and that table is not a log, it is what the timeline,
    // the seven-day delta, the board packet and the portfolio page all read.
    // A shorter series makes those quietly wrong rather than visibly absent.
    logger.error(
      `signal history not recorded for ${productId}: ${err instanceof Error ? err.message : String(err)}`,
      { productId });
  }
}

/**
 * Fetch Signal history for a product, newest-first.
 */
export async function getSignalHistory(
  productId: string,
  days = 60,
): Promise<Array<{ score: number; tier: string; risk_state: string; snapshot_date: string }>> {
  const result = await query(
    `SELECT score, tier, risk_state, snapshot_date
     FROM signal_history
     WHERE product_id = ?
       AND snapshot_date >= date('now', ?)
     ORDER BY snapshot_date ASC`,
    [productId, `-${days} days`],
  );
  return result.rows as unknown as Array<{ score: number; tier: string; risk_state: string; snapshot_date: string }>;
}

/**
 * Get yesterday's Signal score for delta computation.
 */
export async function getPreviousSignalScore(productId: string): Promise<number | null> {
  const result = await query(
    `SELECT score FROM signal_history
     WHERE product_id = ? AND snapshot_date < date('now')
     ORDER BY snapshot_date DESC LIMIT 1`,
    [productId],
  );
  if (result.rows.length === 0) return null;
  return (result.rows[0] as Record<string, number>).score;
}

/**
 * Get today's daily insight for a product, if it exists.
 */
export async function getDailyInsight(
  productId: string,
): Promise<{ headline: string; context: string; action: string | null } | null> {
  const result = await query(
    `SELECT headline, context, action FROM daily_insights
     WHERE product_id = ? AND insight_date = date('now')`,
    [productId],
  );
  if (result.rows.length === 0) return null;
  return result.rows[0] as unknown as { headline: string; context: string; action: string | null };
}

// ─── Invalidate Cache ─────────────────────────────────────────────────────────

/**
 * Force-expire the prose cache for a product.
 * Call this when significant state changes occur.
 */
export function invalidateSignalCache(productId: string): void {
  proseCache.delete(productId);
}
