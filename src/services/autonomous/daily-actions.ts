// =============================================================================
// FOUNDRY — Daily Action Engine
// Every day, Foundry does one high-value thing for your business.
// Actions are calibrated by the Wisdom Layer and gated by risk state.
// =============================================================================

import { query, getLatestAudit, getLatestMetrics, getActiveStressors, getPendingDecisions, getLifecycleState } from '../../db/client.js';
import { getMRRDecomposition, computeHealthRatio } from '../intelligence/revenue.js';
import { assessChurnRisk } from '../intelligence/predictions.js';
import { buildWisdomContext } from '../wisdom/dna.js';
import { callSonnet } from '../ai/client.js';
import { dispatchWebhook } from '../../lib/webhooks.js';
import { log } from '../../lib/logger.js';
import { nanoid } from 'nanoid';
import { getEffectiveActionLimit } from './autonomy-engine.js';
import { getAutopilotPreferences, applyFocusWeights } from './preferences.js';
import type { RiskStateValue } from '../../types/index.js';

// ─── Action Types ───────────────────────────────────────────────────────────

export interface DailyAction {
  id: string;
  product_id: string;
  founder_id: string;
  action_type: string;
  gate: number;
  title: string;
  summary: string;
  detail: string;
  /** If the action produced a draft (email, content, PR description), it goes here */
  draft_content: string | null;
  /** If the action requires founder approval before execution */
  requires_approval: boolean;
  /** If approved, what URL to visit or what to do */
  action_url: string | null;
  status: 'completed' | 'pending_approval' | 'approved' | 'dismissed';
  created_at: string;
}

// ─── Action Candidates ──────────────────────────────────────────────────────
// Each candidate evaluator returns a priority score (0-100) and an action.
// The highest-priority action wins and gets executed.

interface ActionCandidate {
  priority: number; // 0-100, higher = more important
  action: Omit<DailyAction, 'id' | 'created_at' | 'status'>;
}

/**
 * Plan and execute today's daily action for a product.
 * Called once per day per product by the daily_action job.
 */
export async function planDailyAction(productId: string, founderId: string, tier: string | null = null): Promise<DailyAction[]> {
  // Get trust-based action limits
  const limits = await getEffectiveActionLimit(productId, founderId, tier);

  // Check how many actions we've already taken today
  const today = new Date().toISOString().split('T')[0];
  const existing = await query(
    "SELECT COUNT(*) as count FROM daily_actions WHERE product_id = ? AND created_at >= ?",
    [productId, today]
  );
  const todayCount = (existing.rows[0] as Record<string, number>)?.count ?? 0;
  const remainingSlots = limits.actionsPerDay - todayCount;
  if (remainingSlots <= 0) return []; // Already at limit today

  // Gather context
  const [audit, metrics, stressors, decisions, lsResult, mrr, churnRisk, wisdom] = await Promise.all([
    getLatestAudit(productId),
    getLatestMetrics(productId),
    getActiveStressors(productId),
    getPendingDecisions(productId),
    getLifecycleState(productId),
    getMRRDecomposition(productId),
    assessChurnRisk(productId),
    buildWisdomContext(productId),
  ]);

  const ls = lsResult.rows[0] as Record<string, unknown> | undefined;
  const riskState = (ls?.risk_state as RiskStateValue) ?? 'green';
  const auditRow = audit.rows[0] as Record<string, unknown> | undefined;
  const metricsRow = metrics.rows[0] as Record<string, unknown> | undefined;
  const mrrHealth = mrr ? computeHealthRatio(mrr) : null;

  // Evaluate all action candidates
  const candidates: ActionCandidate[] = [];

  // ─── 1. Churn Intervention (highest priority when churn is high) ────────
  if (churnRisk.overall_risk === 'critical' || churnRisk.overall_risk === 'high') {
    const churnRate = (metricsRow?.churn_rate as number) ?? 0;
    const mrrHealthVal = mrrHealth?.value ?? 0;

    let draft: string | null = null;
    if (wisdom.wisdom_active) {
      try {
        const response = await callSonnet(
          `You are a SaaS retention strategist. The founder's product DNA says: ${wisdom.dna_context?.slice(0, 500) ?? 'Not available'}`,
          `This product has ${(churnRate * 100).toFixed(1)}% monthly churn and MRR health ratio of ${mrrHealthVal.toFixed(2)}.
           Active stressors: ${stressors.rows.map((s) => (s as Record<string, string>).stressor_name).join(', ') || 'None'}.
           Draft a 3-email re-engagement sequence for at-risk customers. Each email should be under 100 words, specific to this product's ICP, and address the primary objection from the DNA.
           Format: Email 1: [subject] [body]\nEmail 2: [subject] [body]\nEmail 3: [subject] [body]`,
          1024,
        );
        draft = response.content;
      } catch { /* AI failure — still create the action without draft */ }
    }

    candidates.push({
      priority: churnRisk.risk_score,
      action: {
        product_id: productId,
        founder_id: founderId,
        action_type: 'churn_intervention',
        gate: 2,
        title: 'Churn intervention drafted',
        summary: `Your churn risk is ${churnRisk.overall_risk} (score: ${churnRisk.risk_score}/100). ${churnRisk.recommended_actions[0] ?? ''}`,
        detail: `Signals: ${churnRisk.signals.map((s) => s.signal).join('; ')}`,
        draft_content: draft,
        requires_approval: true,
        action_url: `/products/${productId}/insights`,
      },
    });
  }

  // ─── 2. Competitive Response (when high-significance signal detected) ───
  const recentSignals = await query(
    `SELECT * FROM competitive_signals WHERE product_id = ? AND significance = 'high' AND detected_at > datetime('now', '-3 days') LIMIT 1`,
    [productId]
  );
  if (recentSignals.rows.length > 0) {
    const signal = recentSignals.rows[0] as Record<string, string>;
    let draft: string | null = null;
    if (wisdom.wisdom_active) {
      try {
        const response = await callSonnet(
          'You are a competitive strategist. Draft a specific response plan.',
          `Competitor "${signal.competitor_name}" just made this move: ${signal.signal_summary}.
           Our product positioning: ${wisdom.dna_context?.slice(0, 300) ?? 'Unknown'}.
           Draft a 3-step response plan with timeline. Be specific about what to do this week.`,
          512,
        );
        draft = response.content;
      } catch { /* continue without draft */ }
    }
    candidates.push({
      priority: 70,
      action: {
        product_id: productId,
        founder_id: founderId,
        action_type: 'competitive_response',
        gate: 2,
        title: `Competitive alert: ${signal.competitor_name}`,
        summary: signal.signal_summary,
        detail: `Signal type: ${signal.signal_type}. Significance: high.`,
        draft_content: draft,
        requires_approval: true,
        action_url: `/products/${productId}/competitive`,
      },
    });
  }

  // ─── 3. Stale Decision Nudge (decisions pending >7 days) ────────────────
  const staleDecisions = await query(
    `SELECT id, what, category, created_at FROM decisions WHERE product_id = ? AND status = 'pending' AND created_at < datetime('now', '-7 days') ORDER BY created_at ASC LIMIT 1`,
    [productId]
  );
  if (staleDecisions.rows.length > 0) {
    const d = staleDecisions.rows[0] as Record<string, string>;
    const daysPending = Math.floor((Date.now() - new Date(d.created_at).getTime()) / 86400000);
    candidates.push({
      priority: Math.min(60, 30 + daysPending * 2),
      action: {
        product_id: productId,
        founder_id: founderId,
        action_type: 'decision_nudge',
        gate: 0,
        title: `Decision pending ${daysPending} days: ${d.what}`,
        summary: `This ${d.category} decision has been waiting for ${daysPending} days. Unresolved decisions delay your lifecycle progression.`,
        detail: `Decision ID: ${d.id}`,
        draft_content: null,
        requires_approval: false,
        action_url: `/decisions/${d.id}`,
      },
    });
  }

  // ─── 4. Metrics Freshness Check ────────────────────────────────────────
  const lastMetricDate = metricsRow?.snapshot_date as string | undefined;
  const metricAgeDays = lastMetricDate ? Math.floor((Date.now() - new Date(lastMetricDate).getTime()) / 86400000) : 999;
  if (metricAgeDays > 7) {
    candidates.push({
      priority: 40,
      action: {
        product_id: productId,
        founder_id: founderId,
        action_type: 'metrics_reminder',
        gate: 0,
        title: metricAgeDays >= 999 ? 'No metrics recorded yet' : `Metrics are ${metricAgeDays} days old`,
        summary: 'Fresh metrics power stressor detection, revenue forecasting, and your weekly digest. Update them to keep intelligence accurate.',
        detail: `Last metric snapshot: ${lastMetricDate ?? 'Never'}`,
        draft_content: null,
        requires_approval: false,
        action_url: `/products/${productId}/revenue`,
      },
    });
  }

  // ─── 5. DNA Completion Push (if wisdom not active) ─────────────────────
  const dnaCompletion = (ls?.dna_completion_pct as number) ?? 0;
  if (dnaCompletion < 60 && dnaCompletion > 0) {
    candidates.push({
      priority: 35,
      action: {
        product_id: productId,
        founder_id: founderId,
        action_type: 'dna_push',
        gate: 0,
        title: `Product DNA is ${dnaCompletion}% complete — ${60 - dnaCompletion}% to Wisdom`,
        summary: 'At 60%, Foundry uses your ICP, positioning, and voice to calibrate every audit, every recommendation, and every automated fix to your specific product.',
        detail: `${Math.ceil((60 - dnaCompletion) / 10)} fields remaining.`,
        draft_content: null,
        requires_approval: false,
        action_url: `/products/${productId}/dna`,
      },
    });
  }

  // ─── 6. Audit Staleness (>30 days since last audit) ────────────────────
  const auditDate = auditRow?.created_at as string | undefined;
  const auditAgeDays = auditDate ? Math.floor((Date.now() - new Date(auditDate).getTime()) / 86400000) : 999;
  if (auditAgeDays > 30 && auditRow) {
    candidates.push({
      priority: 45,
      action: {
        product_id: productId,
        founder_id: founderId,
        action_type: 'audit_stale',
        gate: 0,
        title: `Audit is ${auditAgeDays} days old — time for a re-audit`,
        summary: 'Your codebase has likely changed since the last audit. A fresh audit updates your Health Score and identifies new blocking issues.',
        detail: `Last audit composite: ${(auditRow.composite as number)?.toFixed(1) ?? '?'}/10`,
        draft_content: null,
        requires_approval: false,
        action_url: `/products/${productId}/audit`,
      },
    });
  }

  // ─── 7. All Clear — Positive Reinforcement ────────────────────────────
  if (candidates.length === 0) {
    candidates.push({
      priority: 10,
      action: {
        product_id: productId,
        founder_id: founderId,
        action_type: 'all_clear',
        gate: 0,
        title: 'All systems healthy',
        summary: riskState === 'green'
          ? 'No urgent actions today. Your product is operating normally. Keep building.'
          : 'Elevated monitoring active. No new issues since last check.',
        detail: `Risk state: ${riskState}. Active stressors: ${stressors.rows.length}. Pending decisions: ${decisions.rows.length}.`,
        draft_content: null,
        requires_approval: false,
        action_url: '/dashboard',
      },
    });
  }

  // Pick top N actions based on trust-derived limit
  // Apply founder's focus preferences to reweight priorities
  const prefs = await getAutopilotPreferences(productId);
  applyFocusWeights(candidates, prefs.focus);

  // Sort by reweighted priority and select top N
  candidates.sort((a, b) => b.priority - a.priority);
  const selected = candidates.slice(0, remainingSlots);

  // Enforce AI draft budget: only the top N actions with drafts keep their drafts
  let draftsRemaining = limits.aiDraftsPerDay;
  for (const c of selected) {
    if (c.action.draft_content !== null) {
      if (draftsRemaining <= 0) {
        c.action.draft_content = null; // Over budget — strip the draft, keep the action
      } else {
        draftsRemaining--;
      }
    }
  }

  const results: DailyAction[] = [];
  const now = new Date().toISOString();

  for (const candidate of selected) {
    // Determine effective gate based on trust and risk state
    let effectiveGate = candidate.action.gate;

    // Founder explicit preference: always approve (override trust)
    if (prefs.always_approve.includes(candidate.action.action_type)) {
      effectiveGate = 2;
      candidate.action.requires_approval = true;
    }
    // Founder explicit preference: always auto (override trust)
    else if (prefs.always_auto.includes(candidate.action.action_type)) {
      effectiveGate = 0;
      candidate.action.requires_approval = false;
    }
    // Auto-approve categories that have earned Gate 0 through repeated approval
    else if (limits.trustScore.autoApprovedCategories.includes(candidate.action.action_type)) {
      effectiveGate = 0;
      candidate.action.requires_approval = false;
    }
    // If trust level has a lower default gate than the action's gate, use it
    else if (limits.trustScore.defaultGate < effectiveGate && !candidate.action.requires_approval) {
      effectiveGate = limits.trustScore.defaultGate;
    }

    // In Red state, escalate Gate 0/1 to Gate 2 (safety override)
    if (riskState === 'red' && effectiveGate < 2 && candidate.action.action_type !== 'all_clear') {
      effectiveGate = 2;
      candidate.action.requires_approval = true;
    }

    // Store the action
    const actionId = nanoid();
    await query(
      `INSERT INTO daily_actions (id, product_id, founder_id, action_type, gate, title, summary, detail, draft_content, requires_approval, action_url, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [actionId, productId, founderId, candidate.action.action_type, effectiveGate,
       candidate.action.title, candidate.action.summary, candidate.action.detail,
       candidate.action.draft_content, candidate.action.requires_approval ? 1 : 0,
       candidate.action.action_url, candidate.action.requires_approval ? 'pending_approval' : 'completed', now]
    );

    // Create notification
    await query(
      `INSERT INTO notifications (id, founder_id, product_id, type, title, body, action_url, created_at)
       VALUES (?, ?, ?, 'daily_action', ?, ?, ?, ?)`,
      [nanoid(), founderId, productId, candidate.action.title, candidate.action.summary, candidate.action.action_url, now]
    );

    // Log to audit trail
    await query(
      `INSERT INTO audit_log (id, product_id, action_type, gate, trigger, reasoning, created_at)
       VALUES (?, ?, ?, ?, 'daily_action_engine', ?, ?)`,
      [nanoid(), productId, `daily_action_${candidate.action.action_type}`, effectiveGate, candidate.action.summary, now]
    );

    // Dispatch webhook
    await dispatchWebhook(productId, founderId, 'decision.created', {
      type: 'daily_action',
      action_type: candidate.action.action_type,
      title: candidate.action.title,
      summary: candidate.action.summary,
      requires_approval: candidate.action.requires_approval,
    }).catch((err) => log.error('Daily action webhook receipt failed', err, { founderId, productId }));

    const action: DailyAction = {
      id: actionId,
      ...candidate.action,
      gate: effectiveGate,
      status: candidate.action.requires_approval ? 'pending_approval' : 'completed',
      created_at: now,
    };

    results.push(action);
  }

  log.info('Daily actions planned', {
    productId, founderId,
    actionsPlanned: results.length,
    trustLevel: limits.trustScore.level,
    trustScore: limits.trustScore.score,
    maxAllowed: limits.actionsPerDay,
    candidateCount: candidates.length,
    upgradePrompt: limits.upgradePrompt,
  });

  return results;
}

/**
 * Get recent daily actions for a product.
 */
export async function getRecentActions(productId: string, limit: number = 14): Promise<DailyAction[]> {
  const result = await query(
    'SELECT * FROM daily_actions WHERE product_id = ? ORDER BY created_at DESC LIMIT ?',
    [productId, limit]
  );
  return result.rows as unknown as DailyAction[];
}

/**
 * Approve a pending daily action.
 */
export async function approveAction(actionId: string, founderId: string): Promise<boolean> {
  const result = await query(
    "UPDATE daily_actions SET status = 'approved' WHERE id = ? AND founder_id = ? AND status = 'pending_approval'",
    [actionId, founderId]
  );
  return result.rowsAffected > 0;
}

/**
 * Dismiss a pending daily action.
 */
export async function dismissAction(actionId: string, founderId: string): Promise<boolean> {
  const result = await query(
    "UPDATE daily_actions SET status = 'dismissed' WHERE id = ? AND founder_id = ? AND status = 'pending_approval'",
    [actionId, founderId]
  );
  return result.rowsAffected > 0;
}
