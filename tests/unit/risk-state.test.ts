// =============================================================================
// Tests: Risk State Engine
// =============================================================================

import { describe, it, expect } from 'vitest';
import { assessRiskState } from '../../src/services/intelligence/risk-state.js';

describe('assessRiskState', () => {
  const baseInput = {
    productId: 'test-product',
    activeStressors: [],
    mrrHealthRatio: null,
    pendingGate3AgeDays: 0,
    currentState: 'green' as const,
  };

  it('returns green when no risk signals', () => {
    const result = assessRiskState(baseInput);
    expect(result.recommendedState).toBe('green');
    expect(result.transitionWarranted).toBe(false);
  });

  it('returns yellow with 1 critical stressor', () => {
    const result = assessRiskState({
      ...baseInput,
      activeStressors: [{ severity: 'critical', name: 'Revenue drain' }],
    });
    expect(result.recommendedState).toBe('yellow');
    expect(result.triggeringSignals).toContain('Critical stressor: Revenue drain');
  });

  it('returns yellow with 2 critical stressors (severity 3, need 4 for red)', () => {
    const result = assessRiskState({
      ...baseInput,
      activeStressors: [
        { severity: 'critical', name: 'Revenue drain' },
        { severity: 'critical', name: 'Churn spike' },
      ],
    });
    // 2 criticals = severity 3, yellow threshold is 2+, red is 4+
    expect(result.recommendedState).toBe('yellow');
  });

  it('returns red with 2 critical stressors + MRR health crisis', () => {
    const result = assessRiskState({
      ...baseInput,
      activeStressors: [
        { severity: 'critical', name: 'Revenue drain' },
        { severity: 'critical', name: 'Churn spike' },
      ],
      mrrHealthRatio: 1.5,
    });
    // severity: 3 (criticals) + 2 (MRR) = 5 → red
    expect(result.recommendedState).toBe('red');
  });

  it('returns yellow with 3+ elevated stressors', () => {
    const result = assessRiskState({
      ...baseInput,
      activeStressors: [
        { severity: 'elevated', name: 'A' },
        { severity: 'elevated', name: 'B' },
        { severity: 'elevated', name: 'C' },
      ],
    });
    expect(result.recommendedState).toBe('yellow');
  });

  it('adds severity for MRR health ratio >= 1.0', () => {
    const result = assessRiskState({
      ...baseInput,
      mrrHealthRatio: 1.2,
    });
    expect(result.recommendedState).toBe('yellow');
    expect(result.triggeringSignals.some(s => s.includes('MRR Health Ratio'))).toBe(true);
  });

  it('adds severity for stale Gate 3 decisions', () => {
    const result = assessRiskState({
      ...baseInput,
      pendingGate3AgeDays: 10,
    });
    expect(result.triggeringSignals.some(s => s.includes('Gate 3'))).toBe(true);
  });

  it('caps pre-launch products at yellow when ALL signals are MRR/cohort/churn', () => {
    // The pre-launch cap only works when every signal string contains MRR/cohort/churn
    const result = assessRiskState({
      ...baseInput,
      mrrHealthRatio: 1.5,
      // No stressors — only the MRR health ratio signal exists
      activeStressors: [],
      growthStage: 'pre_launch',
    });
    // MRR ratio alone = severity 2, and pre-launch caps it since signal says "MRR"
    expect(result.recommendedState).toBe('yellow');
  });

  it('does not cap pre-launch when non-metric signals present', () => {
    const result = assessRiskState({
      ...baseInput,
      mrrHealthRatio: 1.5,
      activeStressors: [
        { severity: 'critical', name: 'Competitive threat: BigCorp' },
        { severity: 'critical', name: 'Platform dependency' },
      ],
      growthStage: 'pre_launch',
    });
    // "critical stressors active" signal doesn't match MRR/cohort/churn, so no cap
    expect(result.recommendedState).toBe('red');
  });

  it('adds severity for low founder motivation', () => {
    const result = assessRiskState({
      ...baseInput,
      founderMotivationScore: 20,
    });
    expect(result.triggeringSignals.some(s => s.includes('motivation'))).toBe(true);
  });

  it('reports transition warranted when state changes', () => {
    const result = assessRiskState({
      ...baseInput,
      currentState: 'green',
      activeStressors: [{ severity: 'critical', name: 'test' }],
    });
    expect(result.transitionWarranted).toBe(true);
  });

  it('reports no transition when state matches', () => {
    const result = assessRiskState({
      ...baseInput,
      currentState: 'yellow',
      activeStressors: [{ severity: 'critical', name: 'test' }],
    });
    expect(result.transitionWarranted).toBe(false);
  });
});
