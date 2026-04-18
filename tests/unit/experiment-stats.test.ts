// =============================================================================
// Tests: Experiment Statistical Significance
// Tests the z-test logic used in experiment analysis.
// =============================================================================

import { describe, it, expect } from 'vitest';

// Extract the significance logic for direct testing
function computeSignificance(
  pA: number, nA: number,
  pB: number, nB: number
): { confidence: number; significant: boolean; winner: 'a' | 'b' | null } {
  if (nA < 30 || nB < 30) return { confidence: 0, significant: false, winner: null };

  const pPool = (pA * nA + pB * nB) / (nA + nB);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / nA + 1 / nB));

  if (se === 0) return { confidence: 0, significant: false, winner: null };

  const zScore = Math.abs(pA - pB) / se;
  const confidence = zScore >= 2.58 ? 0.99 : zScore >= 1.96 ? 0.95 : zScore >= 1.65 ? 0.90 : zScore / 1.96 * 0.95;
  const significant = confidence >= 0.95;
  const winner = pA > pB ? 'a' : pB > pA ? 'b' : null;

  return { confidence, significant, winner };
}

describe('experiment significance calculation', () => {
  it('returns not significant with small sample sizes', () => {
    const result = computeSignificance(0.10, 20, 0.15, 20);
    expect(result.significant).toBe(false);
    expect(result.confidence).toBe(0);
  });

  it('detects significant difference with large effect and sample', () => {
    // 10% vs 20% conversion with 500 users each = very significant
    const result = computeSignificance(0.10, 500, 0.20, 500);
    expect(result.significant).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
    expect(result.winner).toBe('b');
  });

  it('returns not significant for small differences', () => {
    // 10% vs 11% conversion with 100 users each = not significant
    const result = computeSignificance(0.10, 100, 0.11, 100);
    expect(result.significant).toBe(false);
  });

  it('handles equal conversion rates', () => {
    const result = computeSignificance(0.15, 200, 0.15, 200);
    expect(result.winner).toBe(null);
    expect(result.significant).toBe(false);
  });

  it('handles zero conversion rate', () => {
    const result = computeSignificance(0, 100, 0.05, 100);
    expect(result.winner).toBe('b');
  });

  it('confidence increases with sample size', () => {
    const small = computeSignificance(0.10, 50, 0.15, 50);
    const large = computeSignificance(0.10, 500, 0.15, 500);
    expect(large.confidence).toBeGreaterThan(small.confidence);
  });
});
