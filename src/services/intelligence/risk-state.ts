// =============================================================================
// FOUNDRY — Risk State Engine
// Green/Yellow/Red calculation, transition rules, behavioral adaptation.
// =============================================================================

import { query, insertAuditLog } from '../../db/client.js';
import { nanoid } from 'nanoid';
import type { RiskStateValue, StressorSeverity, GrowthStage } from '../../types/index.js';
import type { FounderPreferences } from '../../types/index.js';

interface RiskAssessmentInput {
  productId: string;
  activeStressors: Array<{ severity: StressorSeverity; name: string }>;
  mrrHealthRatio: number | null;
  pendingGate3AgeDays: number;
  currentState: RiskStateValue;
  growthStage?: GrowthStage;
  founderMotivationScore?: number | null;
}

interface RiskAssessmentResult {
  recommendedState: RiskStateValue;
  reason: string;
  transitionWarranted: boolean;
  triggeringSignals: string[];
}

export function assessRiskState(input: RiskAssessmentInput): RiskAssessmentResult {
  const signals: string[] = [];
  let severity = 0;

  // Critical stressors
  const criticals = input.activeStressors.filter((s) => s.severity === 'critical');
  if (criticals.length >= 2) {
    severity += 3;
    signals.push(`${criticals.length} critical stressors active`);
  } else if (criticals.length === 1) {
    severity += 2;
    signals.push(`Critical stressor: ${criticals[0]?.name}`);
  }

  // Elevated stressors
  const elevated = input.activeStressors.filter((s) => s.severity === 'elevated');
  if (elevated.length >= 3) {
    severity += 2;
    signals.push(`${elevated.length} elevated stressors`);
  } else if (elevated.length >= 1) {
    severity += 1;
    signals.push(`${elevated.length} elevated stressor(s)`);
  }

  // MRR Health Ratio
  if (input.mrrHealthRatio !== null && input.mrrHealthRatio >= 1.0) {
    severity += 2;
    signals.push(`MRR Health Ratio ${input.mrrHealthRatio.toFixed(2)} — churn exceeds new revenue`);
  }

  // Stale Gate 3 decisions
  if (input.pendingGate3AgeDays >= 7) {
    severity += 1;
    signals.push(`Gate 3 decision pending for ${input.pendingGate3AgeDays} days`);
  }

  // Founder health: sustained low motivation adds to severity
  if (input.founderMotivationScore !== undefined && input.founderMotivationScore !== null && input.founderMotivationScore < 30) {
    severity += 1;
    signals.push(`Founder motivation score critically low (${input.founderMotivationScore})`);
  }

  // Stage-aware risk: pre-launch products can't go Red from metric absence alone
  const stage = input.growthStage ?? 'growth';
  if (stage === 'pre_launch' && signals.every((s) => s.includes('MRR') || s.includes('cohort') || s.includes('churn'))) {
    // All signals are metric-based, which is expected for pre-launch — cap at Yellow
    severity = Math.min(severity, 2);
  }

  let recommended: RiskStateValue;
  if (severity >= 4) {
    recommended = 'red';
  } else if (severity >= 2) {
    recommended = 'yellow';
  } else {
    recommended = 'green';
  }

  const reason = signals.length > 0
    ? signals.join('. ')
    : 'No significant risk signals detected.';

  return {
    recommendedState: recommended,
    reason,
    transitionWarranted: recommended !== input.currentState,
    triggeringSignals: signals,
  };
}

/**
 * Transition risk state and log the change.
 */
export async function transitionRiskState(
  productId: string,
  fromState: RiskStateValue,
  toState: RiskStateValue,
  reason: string,
  triggeringSignals: string[]
): Promise<void> {
  const now = new Date().toISOString();

  await query(
    `UPDATE lifecycle_state SET risk_state = ?, risk_state_changed_at = ?, risk_state_reason = ?, updated_at = ? WHERE product_id = ?`,
    [toState, now, reason, now, productId]
  );

  await insertAuditLog({
    id: nanoid(),
    product_id: productId,
    action_type: 'risk_state_transition',
    gate: 2,
    trigger: 'weekly_synthesis',
    reasoning: `${fromState} → ${toState}: ${reason}`,
    input_context: JSON.stringify({ triggering_signals: triggeringSignals }),
    risk_state_at_action: fromState,
  });

  // Dispatch webhook for risk state change
  const ownerResult = await query('SELECT owner_id, name FROM products WHERE id = ?', [productId]);
  const ownerRow = ownerResult.rows[0] as Record<string, string> | undefined;
  const ownerId = ownerRow?.owner_id;
  if (ownerId) {
    const { dispatchWebhook } = await import('../../lib/webhooks.js');
    dispatchWebhook(productId, ownerId, 'risk_state.changed', {
      product_id: productId, from_state: fromState, to_state: toState, reason, triggering_signals: triggeringSignals,
    }).catch(() => {});

    // V3.1 outbound webhooks (Linear/Slack/Notion) via the gateway.
    const { dispatchEvent } = await import('../distribution/outbound-webhooks.js');
    dispatchEvent(productId, {
      event_type: 'signal_tier_shift',
      product_id: productId,
      product_name: ownerRow?.name ?? 'product',
      headline: `Risk state ${fromState} → ${toState.toUpperCase()} for ${ownerRow?.name ?? 'product'}`,
      detail: reason,
      url: `${process.env.APP_URL ?? ''}/dashboard`,
    }).catch(() => {});

    // And the founder's phone. Device registration and per-type preferences
    // have been live since the mobile API shipped; nothing ever sent to them,
    // so a founder could switch on 'risk state change' and never hear from it
    // again. This is the caller that makes the promise true.
    //
    // Governed like every other outward effect: it goes through the gateway, so
    // a paused company sends nothing, a re-run cannot double-notify, and the
    // send is in audit_log either way. Failure is swallowed on purpose — the
    // transition is the fact, and a notification is not worth losing it over.
    // THE FOUNDER'S CEILING APPLIES TO THIS PUSH TOO.
    //
    // `ux/interruption.ts` opens by saying "this module alone decides HOW
    // LOUDLY to deliver", and this call was the counter-example: it reached the
    // founder's phone without ever consulting `preferences.max_channel`, the
    // setting where they say how loudly Foundry may EVER interrupt them. A
    // founder who set `letter` — meaning do not interrupt my life — got a push
    // on every risk-state change.
    //
    // The gateway governs whether an outward effect may LEAVE. The ceiling
    // governs how loudly Foundry may interrupt THIS PERSON. Passing the first
    // says nothing about the second, and the comment below used to treat them
    // as one thing.
    //
    // The notification type stays `risk_state_change` rather than routing
    // through `deliver()`, because that is a real preference column the founder
    // subscribed to and the front door flattens it to `daily_briefing`.
    const prefsRow = (await query('SELECT preferences FROM founders WHERE id = ?', [ownerId]))
      .rows[0] as Record<string, unknown> | undefined;
    let prefs: FounderPreferences | null = null;
    try {
      prefs = prefsRow?.preferences ? JSON.parse(String(prefsRow.preferences)) as FounderPreferences : null;
    } catch { /* unset or unreadable preferences are no ceiling */ }

    const { mayPush } = await import('../ux/interruption.js');
    // A company entering RED is the kill-switch-worthy end of this; anything
    // else is a change worth acting on but not worth a phone buzzing.
    const importance = toState === 'red' ? 'critical' as const : 'action_needed' as const;
    if (!await mayPush(ownerId, productId, importance, prefs)) return;

    const { notifyFounder } = await import('../notifications/push.js');
    notifyFounder({
      productId, founderId: ownerId, notificationType: 'risk_state_change',
      payload: {
        title: `${ownerRow?.name ?? 'Your company'} is now ${toState.toUpperCase()}`,
        body: reason,
        tag: `risk:${productId}:${toState}`,
        data: { product_id: productId, from_state: fromState, to_state: toState },
      },
    }).catch(() => {});
  }
}

/**
 * Get the number of days the oldest pending Gate 3 decision has been waiting.
 */
export async function getOldestPendingGate3Age(productId: string): Promise<number> {
  const result = await query(
    `SELECT MIN(created_at) as oldest FROM decisions WHERE product_id = ? AND gate = 3 AND status = 'pending'`,
    [productId]
  );
  const oldest = (result.rows[0] as Record<string, unknown>)?.oldest as string | null;
  if (!oldest) return 0;
  return Math.floor((Date.now() - new Date(oldest).getTime()) / (1000 * 60 * 60 * 24));
}
