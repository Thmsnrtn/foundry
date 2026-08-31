import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import {
  directionFromDelta, formatLatencyMs, formatPctPoints,
  formatUsdFromCents, formatUsdFromDollars, renderMetric,
} from '../../src/views/numbers.js';

// =============================================================================
// A CONTRACT THAT ENCODED THE AMBIGUITY IT WAS MEANT TO SETTLE.
//
// `views/numbers.ts` calls itself the contract for how every number on the
// dashboard is rendered. Nothing imports it — it is on the unreachable-modules
// baseline — so the contract is proposed, not in force, and the header now says
// so. That much is a wording fix.
//
// The part worth a test is what the contract SAID, because a contract that
// encodes a unit ambiguity hands that ambiguity to everyone who later adopts it:
//
//   `formatPct(n)` took "a number" and appended '%'. Every rate in this system
//   is a 0–1 FRACTION, so the first caller passing `churn_rate` straight in
//   would have rendered 5% churn as "0.05%" — the exact defect found in
//   `business-model.ts` this cycle, waiting here for its first adopter.
//
//   `formatUsdK(amount)` took "an amount". Every money column is `_cents`, so a
//   caller passing `mrr_cents` would have rendered $50,000 as "$5000K".
//
//   `renderMetric` had no way to say a number is not known, while the rest of
//   the system had just been taught to say exactly that.
//
// Fixed BEFORE it has a caller. The names now carry the unit, which is the only
// thing that survives a copy-paste.
// =============================================================================

describe('the unit is in the name', () => {
  it('dollars format as dollars', () => {
    expect(formatUsdFromDollars(50_000)).toBe('$50K');
    expect(formatUsdFromDollars(1_500_000)).toBe('$1.5M');
    expect(formatUsdFromDollars(42)).toBe('$42');
  });

  it('cents format as the dollars they are', () => {
    expect(formatUsdFromCents(5_000_000), '$50,000, not $5000K').toBe('$50K');
  });

  it('percentage points format as points', () => {
    expect(formatPctPoints(12.5, 1)).toBe('12.5%');
    expect(formatPctPoints(5)).toBe('5%');
  });

  it('and there is no un-united helper left to reach for', () => {
    const code = stripComments(readFileSync('src/views/numbers.ts', 'utf8'), { lineComments: true });
    expect(code, '"amount" is an invitation to pass cents').not.toMatch(/export function formatUsdK/);
    expect(code, '"n" is an invitation to pass a fraction').not.toMatch(/export function formatPct\(/);
  });
});

describe('not measured is renderable', () => {
  it('by every formatter', () => {
    expect(formatUsdFromDollars(null)).toBe('not measured');
    expect(formatUsdFromCents(null)).toBe('not measured');
    expect(formatPctPoints(null)).toBe('not measured');
    expect(formatLatencyMs(null), 'this one was already honest').toBe('N/A');
  });

  it('and by the metric itself', () => {
    const rendered = String(renderMetric({ value: null, label: 'MRR' }));
    expect(rendered).toContain('not measured');
    expect(rendered).toContain('MRR');
  });

  it('while a real value still renders', () => {
    const rendered = String(renderMetric({ value: '$50K', label: 'MRR' }));
    expect(rendered).toContain('$50K');
    expect(rendered).not.toContain('not measured');
  });
});

describe('the direction helper', () => {
  it('has no direction for an absent delta', () => {
    expect(directionFromDelta(null)).toBeNull();
    expect(directionFromDelta(NaN)).toBeNull();
  });

  it('and a real one otherwise', () => {
    expect(directionFromDelta(1)).toBe('up');
    expect(directionFromDelta(-1)).toBe('down');
    expect(directionFromDelta(0)).toBe('flat');
  });
});

describe('the header says what is true', () => {
  it('calls itself proposed rather than in force', () => {
    const header = readFileSync('src/views/numbers.ts', 'utf8').slice(0, 2000);
    expect(header).toMatch(/A PROPOSED CONTRACT, NOT ONE IN FORCE/);
    // Asserted against the exact old sentence, not the phrase: the corrected
    // header QUOTES the old claim while explaining it, and a looser assertion
    // matches the explanation. Fourth time this cycle that prose quoting code
    // has been read as code — twice by the repository's scanners, once by mine,
    // and now by my own test.
    expect(header).not.toMatch(/was the finding; this is the contract\./);
  });
});
