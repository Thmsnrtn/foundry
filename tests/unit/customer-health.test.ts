// =============================================================================
// Tests: Customer Health Scoring & Revenue Concentration
// =============================================================================

import { describe, it, expect } from 'vitest';

// Extract the concentration logic for direct testing
function computeConcentration(mrrCents: number[]): {
  topPct: number;
  top3Pct: number;
  hhi: number;
  concentrated: boolean;
} {
  const sorted = [...mrrCents].sort((a, b) => b - a);
  const total = sorted.reduce((s, v) => s + v, 0);
  if (total === 0) return { topPct: 0, top3Pct: 0, hhi: 0, concentrated: false };

  const topPct = (sorted[0]! / total) * 100;
  const top3Pct = (sorted.slice(0, 3).reduce((s, v) => s + v, 0) / total) * 100;
  const hhi = sorted.reduce((sum, v) => {
    const share = v / total;
    return sum + share * share;
  }, 0) * 10000;

  return {
    topPct: Math.round(topPct),
    top3Pct: Math.round(top3Pct),
    hhi: Math.round(hhi),
    concentrated: topPct > 30 || top3Pct > 60,
  };
}

// Extract health score logic for direct testing
function computeHealthScore(
  usage: number, support: number, payment: number, engagement: number
): number {
  return Math.round(usage * 0.30 + support * 0.15 + payment * 0.20 + engagement * 0.35);
}

describe('customer health score', () => {
  it('computes weighted score correctly', () => {
    const score = computeHealthScore(100, 100, 100, 100);
    expect(score).toBe(100);
  });

  it('weighs engagement heaviest', () => {
    const highEngagement = computeHealthScore(50, 50, 50, 100);
    const highUsage = computeHealthScore(100, 50, 50, 50);
    expect(highEngagement).toBeGreaterThan(highUsage);
  });

  it('handles zeros', () => {
    const score = computeHealthScore(0, 0, 0, 0);
    expect(score).toBe(0);
  });

  it('computes realistic mid-range score', () => {
    const score = computeHealthScore(70, 80, 100, 50);
    // 70*0.30 + 80*0.15 + 100*0.20 + 50*0.35 = 21 + 12 + 20 + 17.5 = 70.5
    expect(score).toBe(71);
  });
});

describe('revenue concentration', () => {
  it('detects concentrated revenue (one dominant customer)', () => {
    const result = computeConcentration([50000, 5000, 5000, 5000, 5000]);
    expect(result.concentrated).toBe(true);
    expect(result.topPct).toBeGreaterThan(30);
  });

  it('detects healthy distribution', () => {
    const result = computeConcentration([10000, 10000, 10000, 10000, 10000]);
    expect(result.concentrated).toBe(false);
    expect(result.topPct).toBe(20);
    expect(result.hhi).toBe(2000); // 5 equal customers → HHI = 2000
  });

  it('handles single customer', () => {
    const result = computeConcentration([10000]);
    expect(result.concentrated).toBe(true);
    expect(result.topPct).toBe(100);
    expect(result.hhi).toBe(10000);
  });

  it('handles empty array', () => {
    const result = computeConcentration([]);
    expect(result.concentrated).toBe(false);
  });

  it('HHI increases with concentration', () => {
    const even = computeConcentration([100, 100, 100, 100]);
    const uneven = computeConcentration([300, 50, 25, 25]);
    expect(uneven.hhi).toBeGreaterThan(even.hhi);
  });

  it('flags top 3 concentration', () => {
    // Top 3 = 90% of revenue
    const result = computeConcentration([30000, 30000, 30000, 5000, 5000]);
    expect(result.top3Pct).toBe(90);
    expect(result.concentrated).toBe(true);
  });
});
