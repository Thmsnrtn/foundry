// =============================================================================
// FOUNDRY — Risk State Engine
// Green/Yellow/Red calculation, transition rules, behavioral adaptation.
// =============================================================================

import { query, insertAuditLog } from '../../db/client.js';
import { nanoid } from 'nanoid';
import type { RiskStateValue, StressorSeverity } from '../../types/index.js';

interface RiskAssessmentInput {
  productId: string;
  activeStressors: Array<{ severity: StressorSeverity; name: string }>;
  mrrHealthRatio: number | null;
  pendingGate3AgeDays: number;
  currentState: RiskStateValue;
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
