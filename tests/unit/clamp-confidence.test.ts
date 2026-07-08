// =============================================================================
// Tests: Confidence validation for gate escalation (Phase 2.6 groundwork)
// =============================================================================

import { describe, it, expect } from 'vitest';
import { clampConfidence } from '../../src/services/scp/agents/base.js';

describe('clampConfidence', () => {
  it('returns a valid in-range agent value unchanged', () => {
    expect(clampConfidence(0.42, 0.8)).toBe(0.42);
    expect(clampConfidence(0, 0.8)).toBe(0);
    expect(clampConfidence(1, 0.8)).toBe(1);
  });

  it('clamps out-of-range values into [0, 1]', () => {
    expect(clampConfidence(1.5, 0.8)).toBe(1);
    expect(clampConfidence(-0.3, 0.8)).toBe(0);
  });

  it('falls back when the value is missing or non-finite', () => {
    expect(clampConfidence(undefined, 0.8)).toBe(0.8);
    expect(clampConfidence(null, 0.8)).toBe(0.8);
    expect(clampConfidence(NaN, 0.8)).toBe(0.8);
    expect(clampConfidence('0.9', 0.8)).toBe(0.8); // non-numeric
  });
});
