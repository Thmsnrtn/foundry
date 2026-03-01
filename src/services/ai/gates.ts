// =============================================================================
// FOUNDRY — Safety Gate Logic
// Implements confidence thresholds with risk-state-aware adjustments.
// =============================================================================

import type { Gate, RiskStateValue, AIDecision, DEFAULT_THRESHOLDS } from '../../types/index.js';

interface GateThresholds {
  gate_0: number;
  gate_1: number;
  gate_2: number;
}

const THRESHOLDS: Record<RiskStateValue, GateThresholds> = {
  green: { gate_0: 0.85, gate_1: 0.75, gate_2: 0.60 },
  yellow: { gate_0: 0.85, gate_1: 0.85, gate_2: 0.60 },
  red: { gate_0: 0.85, gate_1: 0.85, gate_2: 0.60 },
};

/**
 * Determine whether an AI decision should proceed at its assigned gate
 * or be escalated based on confidence and risk state.
 *
 * Returns the effective gate the decision should operate at.
 */
export function evaluateGate(
  decision: AIDecision,
  riskState: RiskStateValue,
  coldStartActive: boolean = false
): { effectiveGate: Gate; escalated: boolean; reason: string } {
  const { gate, confidence } = decision;
  const thresholds = THRESHOLDS[riskState];

  // Gate 3 and 4: always require human, no threshold check
  if (gate >= 3) {
    return { effectiveGate: gate, escalated: false, reason: 'Human decision required' };
  }

  // Red state: suspend Gate 0 and Gate 1 except behavioral triggers and critical support
  if (riskState === 'red' && gate <= 1) {
    const allowedInRed = [
      'behavioral_trigger_email',
      'critical_support_routing',
    ];
    const isAllowed = allowedInRed.includes(decision.action);

    if (!isAllowed) {
      return {
        effectiveGate: 2,
        escalated: true,
        reason: 'Red state: non-essential Gate 0/1 actions suspended, escalated to Gate 2',
      };
    }
  }

  // Cold Start Mode: narrow Gate 0 to only behavioral triggers and support routing
  if (coldStartActive && gate === 0) {
    const coldStartAllowed = [
      'behavioral_trigger_email',
      'support_ticket_routing',
    ];
    const isAllowed = coldStartAllowed.includes(decision.action);

    if (!isAllowed) {
      return {
        effectiveGate: 1,
        escalated: true,
        reason: 'Cold Start Mode: non-essential Gate 0 actions escalated to Gate 1',
      };
    }
  }

  // Check confidence against threshold
  if (gate === 0) {
    if (confidence >= thresholds.gate_0) {
      return { effectiveGate: 0, escalated: false, reason: 'Confidence meets Gate 0 threshold' };
    }
    return {
      effectiveGate: 1,
      escalated: true,
      reason: `Confidence ${confidence.toFixed(2)} below Gate 0 threshold ${thresholds.gate_0}`,
    };
  }

  if (gate === 1) {
    if (confidence >= thresholds.gate_1) {
      return { effectiveGate: 1, escalated: false, reason: 'Confidence meets Gate 1 threshold' };
    }
    return {
      effectiveGate: 2,
      escalated: true,
      reason: `Confidence ${confidence.toFixed(2)} below Gate 1 threshold ${thresholds.gate_1}`,
    };
  }

  if (gate === 2) {
    if (confidence >= thresholds.gate_2) {
      return { effectiveGate: 2, escalated: false, reason: 'Confidence meets Gate 2 threshold' };
    }
    return {
      effectiveGate: 3,
      escalated: true,
      reason: `Confidence ${confidence.toFixed(2)} below Gate 2 threshold ${thresholds.gate_2}`,
    };
  }

  return { effectiveGate: gate, escalated: false, reason: 'Default pass-through' };
}

/**
 * Get the confidence threshold for a specific gate at a given risk state.
 */
export function getThreshold(gate: Gate, riskState: RiskStateValue): number | null {
  const thresholds = THRESHOLDS[riskState];
  if (gate === 0) return thresholds.gate_0;
  if (gate === 1) return thresholds.gate_1;
  if (gate === 2) return thresholds.gate_2;
  return null; // Gate 3 and 4 don't have confidence thresholds
}

/**
 * Check if a gate is currently suspended due to risk state.
 */
export function isGateSuspended(
  gate: Gate,
  actionType: string,
  riskState: RiskStateValue
): boolean {
  if (riskState !== 'red') return false;
  if (gate > 1) return false;

  const allowedInRed = [
    'behavioral_trigger_email',
    'critical_support_routing',
  ];

  return !allowedInRed.includes(actionType);
}

/**
 * Describe the gate for audit log purposes.
 */
export function describeGate(gate: Gate): string {
  switch (gate) {
    case 0: return 'FULLY AUTONOMOUS — acts immediately, no notification';
    case 1: return 'NOTIFY AND PROCEED — acts immediately, notifies afterward';
    case 2: return 'RECOMMEND AND WAIT — generates recommendation, waits';
    case 3: return 'HUMAN DECISION REQUIRED — cannot act until approved';
    case 4: return 'HUMAN ONLY — system never acts regardless of confidence';
  }
}
