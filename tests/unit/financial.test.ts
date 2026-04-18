// =============================================================================
// Tests: Financial Calculations (Runway, Break-Even, Growth Rate)
// =============================================================================

import { describe, it, expect } from 'vitest';

// Extract runway calculation logic for direct testing
function computeRunway(monthlyRevenue: number, monthlyBurn: number, cashOnHand: number): number {
  const netCashFlow = monthlyRevenue - monthlyBurn;
  if (netCashFlow >= 0) return 999; // Profitable
  return cashOnHand / Math.abs(netCashFlow);
}

function computeBreakEvenMonths(currentRevenue: number, targetRevenue: number, monthlyGrowthRate: number): number | null {
  if (monthlyGrowthRate <= 0) return null;
  if (currentRevenue >= targetRevenue) return 0;
  if (currentRevenue <= 0) return null;
  return Math.ceil(Math.log(targetRevenue / currentRevenue) / Math.log(1 + monthlyGrowthRate));
}

function computeRunwayGap(personalRunwayMonths: number | null, monthsToBreakEven: number): {
  gap: number;
  severity: 'safe' | 'tight' | 'critical';
} {
  if (personalRunwayMonths === null) return { gap: 0, severity: 'safe' };
  const gap = monthsToBreakEven - personalRunwayMonths;
  if (gap <= 0) return { gap, severity: 'safe' };
  if (gap > 6) return { gap, severity: 'critical' };
  if (gap > 3) return { gap, severity: 'tight' };
  return { gap, severity: 'safe' };
}

function estimateGrowthRate(revenues: number[]): number {
  if (revenues.length < 2) return 0.05;
  const first = revenues[revenues.length - 1]!;
  const last = revenues[0]!;
  if (first <= 0) return 0.05;
  return Math.pow(last / first, 1 / (revenues.length - 1)) - 1;
}

describe('runway calculation', () => {
  it('returns infinite runway when profitable', () => {
    expect(computeRunway(5000, 3000, 10000)).toBe(999);
  });

  it('computes runway correctly when burning cash', () => {
    const runway = computeRunway(2000, 5000, 15000);
    expect(runway).toBe(5); // 15000 / 3000 = 5 months
  });

  it('handles zero revenue', () => {
    const runway = computeRunway(0, 5000, 20000);
    expect(runway).toBe(4); // 20000 / 5000 = 4 months
  });
});

describe('break-even calculation', () => {
  it('returns 0 when already at break-even', () => {
    expect(computeBreakEvenMonths(5000, 3000, 0.1)).toBe(0);
  });

  it('returns null with zero growth rate', () => {
    expect(computeBreakEvenMonths(1000, 5000, 0)).toBe(null);
  });

  it('returns null with zero revenue', () => {
    expect(computeBreakEvenMonths(0, 5000, 0.1)).toBe(null);
  });

  it('computes months to break-even with growth', () => {
    // $1000/mo, need $5000/mo, growing 10%/mo
    // 1000 * 1.1^n = 5000 → n = log(5)/log(1.1) ≈ 16.9
    const months = computeBreakEvenMonths(1000, 5000, 0.10);
    expect(months).toBe(17);
  });

  it('faster growth means fewer months', () => {
    const slow = computeBreakEvenMonths(1000, 5000, 0.05)!;
    const fast = computeBreakEvenMonths(1000, 5000, 0.15)!;
    expect(fast).toBeLessThan(slow);
  });
});

describe('runway gap analysis', () => {
  it('returns safe when no personal runway set', () => {
    const result = computeRunwayGap(null, 12);
    expect(result.severity).toBe('safe');
  });

  it('returns safe when personal runway exceeds break-even', () => {
    const result = computeRunwayGap(18, 12);
    expect(result.severity).toBe('safe');
    expect(result.gap).toBeLessThanOrEqual(0);
  });

  it('returns tight when gap is 3-6 months', () => {
    const result = computeRunwayGap(8, 12);
    expect(result.severity).toBe('tight');
    expect(result.gap).toBe(4);
  });

  it('returns critical when gap > 6 months', () => {
    const result = computeRunwayGap(5, 18);
    expect(result.severity).toBe('critical');
    expect(result.gap).toBe(13);
  });
});

describe('growth rate estimation', () => {
  it('returns default for insufficient data', () => {
    expect(estimateGrowthRate([1000])).toBe(0.05);
    expect(estimateGrowthRate([])).toBe(0.05);
  });

  it('computes growth from revenue series', () => {
    // 1000, 1100, 1210 → ~10% monthly growth (newest first)
    const rate = estimateGrowthRate([1210, 1100, 1000]);
    expect(rate).toBeCloseTo(0.10, 1);
  });

  it('detects decline', () => {
    const rate = estimateGrowthRate([800, 900, 1000]);
    expect(rate).toBeLessThan(0);
  });

  it('handles flat revenue', () => {
    const rate = estimateGrowthRate([1000, 1000, 1000]);
    expect(rate).toBeCloseTo(0, 2);
  });
});
