// =============================================================================
// Tests: SLO spend check (Phase 3.3)
// =============================================================================

import { describe, it, expect } from 'vitest';
import { evaluateSpendCheck } from '../../src/services/slo.js';

describe('evaluateSpendCheck', () => {
  it('is ok below the warning threshold', () => {
    const c = evaluateSpendCheck({ spentCents: 3000, capCents: 50000, pctOfCap: 0.06 }, 0.8);
    expect(c.ok).toBe(true);
    expect(c.name).toBe('ai_daily_spend');
    expect(c.detail).toContain('$30.00');
  });

  it('breaches at or above the warning threshold', () => {
    const c = evaluateSpendCheck({ spentCents: 42000, capCents: 50000, pctOfCap: 0.84 }, 0.8);
    expect(c.ok).toBe(false);
    expect(c.detail).toContain('warning threshold');
    expect(c.detail).toContain('84%');
  });

  it('treats exactly-at-threshold as a breach', () => {
    const c = evaluateSpendCheck({ spentCents: 40000, capCents: 50000, pctOfCap: 0.8 }, 0.8);
    expect(c.ok).toBe(false);
  });
});
