// =============================================================================
// FOUNDRY — Founder Decision Quality & Behavioral State Detection
// Detects degraded decision states BEFORE consequential decisions are made.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BehavioralSignal {
  signal_type: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  context: Record<string, unknown>;
}

export interface FounderState {
  state: 'optimal' | 'watchful' | 'stressed' | 'degraded';
  confidence: number;
  contributing_signals: string[];
  recommendation: string;
  recommended_deferral_hours: number | null;
  should_warn_before_decision: boolean;
}

// ─── Signal Detection ─────────────────────────────────────────────────────────

/**
 * Queries recent activity to detect behavioral signals indicating degraded decision state.
 */
export async function detectBehavioralSignals(productId: string): Promise<BehavioralSignal[]> {
  const signals: BehavioralSignal[] = [];

  // 1. Rapid override sequence: >2 agent recommendations overridden/cancelled in last 24h without logging reasons
  const overrideResult = await query(
    `SELECT COUNT(*) as cnt FROM action_executions
     WHERE product_id = ?
       AND status IN ('cancelled', 'rejected')
       AND created_at >= datetime('now', '-24 hours')`,
    [productId]
  );
  const recentOverrides = (overrideResult.rows[0] as Record<string, unknown>)?.cnt as number ?? 0;
  if (recentOverrides > 2) {
    signals.push({
      signal_type: 'rapid_override_sequence',
      description: `${recentOverrides} agent recommendations overridden or cancelled in the last 24 hours`,
      severity: recentOverrides > 5 ? 'high' : 'medium',
      context: { override_count_24h: recentOverrides },
    });
  }

  // 2. Late night activity: significant platform activity between 11pm-5am (UTC proxy)
  const lateNightResult = await query(
    `SELECT COUNT(*) as cnt FROM action_executions
     WHERE product_id = ?
       AND (CAST(strftime('%H', created_at) AS INTEGER) >= 23
            OR CAST(strftime('%H', created_at) AS INTEGER) < 5)
       AND created_at >= datetime('now', '-48 hours')`,
    [productId]
  );
  const lateNightActions = (lateNightResult.rows[0] as Record<string, unknown>)?.cnt as number ?? 0;
  if (lateNightActions >= 3) {
    signals.push({
      signal_type: 'late_night_activity',
      description: `${lateNightActions} platform actions recorded between 11pm–5am UTC in the last 48 hours`,
      severity: lateNightActions >= 8 ? 'high' : 'medium',
      context: { late_night_action_count: lateNightActions },
    });
  }

  // 3. Approval without reading: action_executions approved < 10 seconds after created
  const fastApprovalResult = await query(
    `SELECT COUNT(*) as cnt FROM action_executions
     WHERE product_id = ?
       AND status = 'approved'
       AND approved_at IS NOT NULL
       AND (julianday(approved_at) - julianday(created_at)) * 86400 < 10
       AND created_at >= datetime('now', '-72 hours')`,
    [productId]
  );
  const fastApprovals = (fastApprovalResult.rows[0] as Record<string, unknown>)?.cnt as number ?? 0;
  if (fastApprovals >= 2) {
    signals.push({
      signal_type: 'approval_without_reading',
      description: `${fastApprovals} actions approved in under 10 seconds (likely without reading) in the last 72 hours`,
      severity: fastApprovals >= 5 ? 'high' : fastApprovals >= 3 ? 'medium' : 'low',
      context: { fast_approval_count: fastApprovals },
    });
  }

  // 4. Extended inactivity followed by sudden burst
  const burstResult = await query(
    `SELECT
       COUNT(CASE WHEN created_at >= datetime('now', '-24 hours') THEN 1 END) as last_24h,
       COUNT(CASE WHEN created_at >= datetime('now', '-5 days') AND created_at < datetime('now', '-24 hours') THEN 1 END) as prior_4d
     FROM action_executions
     WHERE product_id = ?
       AND created_at >= datetime('now', '-5 days')`,
    [productId]
  );
  const burstRow = burstResult.rows[0] as Record<string, unknown> | undefined;
  const last24h = (burstRow?.last_24h as number) ?? 0;
  const prior4d = (burstRow?.prior_4d as number) ?? 0;
  if (prior4d === 0 && last24h >= 5) {
    signals.push({
      signal_type: 'extended_inactivity',
      description: `No activity for 4+ days followed by ${last24h} actions in the last 24 hours — possible re-engagement burst`,
      severity: 'medium',
      context: { last_24h_actions: last24h, prior_4d_actions: prior4d },
    });
  }

  // 5. Override rate spike: this week's override/cancel rate > 2x last month's average
  const rateResult = await query(
    `SELECT
       COUNT(CASE WHEN created_at >= datetime('now', '-7 days') THEN 1 END) as week_total,
       COUNT(CASE WHEN created_at >= datetime('now', '-7 days') AND status IN ('cancelled', 'rejected') THEN 1 END) as week_overrides,
       COUNT(CASE WHEN created_at >= datetime('now', '-37 days') AND created_at < datetime('now', '-7 days') THEN 1 END) as month_total,
       COUNT(CASE WHEN created_at >= datetime('now', '-37 days') AND created_at < datetime('now', '-7 days') AND status IN ('cancelled', 'rejected') THEN 1 END) as month_overrides
     FROM action_executions
     WHERE product_id = ?`,
    [productId]
  );
  const rateRow = rateResult.rows[0] as Record<string, unknown> | undefined;
  const weekTotal = (rateRow?.week_total as number) ?? 0;
  const weekOverrides = (rateRow?.week_overrides as number) ?? 0;
  const monthTotal = (rateRow?.month_total as number) ?? 0;
  const monthOverrides = (rateRow?.month_overrides as number) ?? 0;
  if (weekTotal >= 5 && monthTotal >= 5) {
    const weekRate = weekOverrides / weekTotal;
    const monthRate = monthOverrides / monthTotal;
    if (monthRate > 0 && weekRate > monthRate * 2) {
      signals.push({
        signal_type: 'unusual_velocity',
        description: `Override rate this week (${Math.round(weekRate * 100)}%) is more than 2x the monthly average (${Math.round(monthRate * 100)}%)`,
        severity: weekRate > 0.6 ? 'high' : 'medium',
        context: { week_rate: weekRate, month_rate: monthRate, week_overrides: weekOverrides, week_total: weekTotal },
      });
    }
  }

  // 6. Decision contradiction: two strategic decisions within 48h that appear to contradict
  const contradictionResult = await query(
    // `strategic_decisions` does not exist. The table is
    // `strategic_decisions_log`, its category column is `decision_category`,
    // and its clock is `made_at` — so this query threw on every call and the
    // contradiction signal has never once fired.
    //
    // There is no `direction` column anywhere in that schema, so "two decisions
    // with OPPOSING directions" is a question this data cannot answer. What it
    // can answer is that two decisions in the same category were made within 48
    // hours of each other, which is the volatility the signal was reaching for.
    // The description says that instead of claiming a contradiction nothing
    // here can see.
    `SELECT d1.id as id1, d1.decision_category as type1, d1.decision_title as dir1,
            d2.id as id2, d2.decision_category as type2, d2.decision_title as dir2
     FROM strategic_decisions_log d1
     JOIN strategic_decisions_log d2
       ON d1.product_id = d2.product_id
       AND d1.id != d2.id
       AND d1.decision_category = d2.decision_category
       AND d2.made_at > d1.made_at
       AND (julianday(d2.made_at) - julianday(d1.made_at)) * 24 < 48
     WHERE d1.product_id = ?
       AND d1.made_at >= datetime('now', '-7 days')
     LIMIT 1`,
    [productId]
  );
  if (contradictionResult.rows.length > 0) {
    const c = contradictionResult.rows[0] as Record<string, unknown>;
    signals.push({
      signal_type: 'contradiction',
      description: `Two ${c.type1} decisions made within 48 hours ("${c.dir1}" and "${c.dir2}")`,
      severity: 'high',
      context: { decision_id_1: c.id1, decision_id_2: c.id2, decision_type: c.type1 },
    });
  }

  return signals;
}

// ─── State Assessment ─────────────────────────────────────────────────────────

/**
 * Runs detectBehavioralSignals, computes a FounderState, saves to DB, and returns it.
 */
export async function assessFounderState(productId: string): Promise<FounderState> {
  const signals = await detectBehavioralSignals(productId);

  // Save detected signals to DB
  for (const sig of signals) {
    await query(
      `INSERT INTO founder_behavioral_signals (id, product_id, signal_type, signal_description, severity, context_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [nanoid(), productId, sig.signal_type, sig.description, sig.severity, JSON.stringify(sig.context)]
    );
  }

  // Compute state from signals
  const highCount = signals.filter((s) => s.severity === 'high').length;
  const medCount = signals.filter((s) => s.severity === 'medium').length;
  const lowCount = signals.filter((s) => s.severity === 'low').length;

  let state: FounderState['state'];
  let confidence: number;
  let recommendation: string;
  let recommended_deferral_hours: number | null = null;

  if (highCount >= 2 || (highCount >= 1 && medCount >= 2)) {
    state = 'degraded';
    confidence = 0.8 + Math.min(highCount * 0.05, 0.15);
    recommendation =
      'Multiple high-severity behavioral signals detected. Consider deferring major decisions for 24 hours, sleeping, and returning with fresh perspective.';
    recommended_deferral_hours = 24;
  } else if (highCount === 1 || medCount >= 2) {
    state = 'stressed';
    confidence = 0.65 + medCount * 0.05;
    recommendation =
      'Elevated stress signals detected. Take extra time on consequential decisions, consider getting a second opinion, and review recent overrides.';
    recommended_deferral_hours = 8;
  } else if (medCount === 1 || lowCount >= 2) {
    state = 'watchful';
    confidence = 0.55;
    recommendation =
      'Minor behavioral anomalies detected. Proceed normally but be mindful — slow down before irreversible decisions.';
  } else {
    state = 'optimal';
    confidence = 0.75;
    recommendation = 'No significant behavioral signals. Decision-making appears healthy.';
  }

  const contributing_signals = signals.map((s) => s.description);
  const should_warn_before_decision = state === 'stressed' || state === 'degraded';

  // Save assessment to DB
  await query(
    `INSERT INTO founder_state_assessments
       (id, product_id, state, confidence, contributing_signals_json, recommendation, recommended_deferral_hours)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(),
      productId,
      state,
      confidence,
      JSON.stringify(contributing_signals),
      recommendation,
      recommended_deferral_hours,
    ]
  );

  return {
    state,
    confidence,
    contributing_signals,
    recommendation,
    recommended_deferral_hours,
    should_warn_before_decision,
  };
}

// ─── Latest State ─────────────────────────────────────────────────────────────

/**
 * Returns the most recent assessment from DB, or null if none or >24h old.
 */
export async function getLatestFounderState(productId: string): Promise<FounderState | null> {
  const result = await query(
    `SELECT state, confidence, contributing_signals_json, recommendation, recommended_deferral_hours
     FROM founder_state_assessments
     WHERE product_id = ?
       AND assessed_at >= datetime('now', '-24 hours')
     ORDER BY assessed_at DESC
     LIMIT 1`,
    [productId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0] as Record<string, unknown>;
  const state = row.state as FounderState['state'];
  const contributing_signals: string[] = JSON.parse((row.contributing_signals_json as string) ?? '[]');

  return {
    state,
    confidence: row.confidence as number,
    contributing_signals,
    recommendation: (row.recommendation as string) ?? '',
    recommended_deferral_hours: (row.recommended_deferral_hours as number | null) ?? null,
    should_warn_before_decision: state === 'stressed' || state === 'degraded',
  };
}

// ─── Pre-Decision Warning ─────────────────────────────────────────────────────

/**
 * Called before major decisions. Returns warning details if current state warrants it.
 */
export async function shouldWarnBeforeDecision(productId: string): Promise<{
  should_warn: boolean;
  warning_message: string | null;
  deferral_recommendation: string | null;
}> {
  const founderState = await getLatestFounderState(productId);

  if (!founderState || !founderState.should_warn_before_decision) {
    return { should_warn: false, warning_message: null, deferral_recommendation: null };
  }

  const stateLabel = founderState.state === 'degraded' ? 'Degraded' : 'Stressed';
  const warning_message =
    `Founder state: ${stateLabel}. ` +
    `${founderState.contributing_signals.length} behavioral signal(s) detected. ` +
    founderState.recommendation;

  const deferral_recommendation =
    founderState.recommended_deferral_hours !== null
      ? `Consider deferring this decision for ${founderState.recommended_deferral_hours} hour(s).`
      : null;

  return { should_warn: true, warning_message, deferral_recommendation };
}
