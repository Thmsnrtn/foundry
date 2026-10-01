process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, expect, it } from 'vitest';
import {
  pctOfFraction, measured, money, rate, UNKNOWN,
} from '../../src/services/ai/measured.js';

// =============================================================================
// TELLING A MODEL ZERO WHEN NOBODY REPORTED.
//
// Four agents read a company's `metric_snapshots` and put the numbers into a
// prompt. When the company had reported nothing, all four wrote the same line:
//
//     const churnRate = metrics ? (Number(metrics.churn_rate) || 0) * 100 : 0;
//
// and the prompt read `Churn rate: 0.0%. NPS: 0.0.` — not an absence of data,
// a claim of excellent retention and a mediocre NPS. Harbor's system prompt
// then says, in these words, "You do not hedge when customer data is clear",
// and asks for named accounts and specific dollar amounts.
//
// So this was never only about a reader misreading a zero. A model was handed
// fabricated facts under an instruction to be confident, and its output reaches
// a founder as advice about their own company.
//
// It also crossed a threshold. `if (activationRate < 30)` fired a founder-
// facing "Low activation rate (0.0%) — acquisition quality concern" message at
// companies that had reported no metrics at all.
//
// THE RULE ALREADY EXISTED. `jobs/index.ts` writes
// `m.activation_rate != null ? … : 'unknown'` for the same columns, from the
// same table, for the same reader. One rule, two implementations, and the
// wrong one was in four files. `ai/measured.ts` states it once.
// =============================================================================

describe('the one place the rule is stated', () => {
  it('says unknown for a fraction nobody reported', () => {
    expect(pctOfFraction(null)).toBe(UNKNOWN);
    expect(pctOfFraction(undefined)).toBe(UNKNOWN);
    expect(pctOfFraction('')).toBe(UNKNOWN);
  });

  it('says zero for a fraction somebody reported as zero', () => {
    expect(pctOfFraction(0), 'a recorded zero is a finding').toBe('0.0%');
    expect(pctOfFraction(0.125)).toBe('12.5%');
    expect(pctOfFraction(0.125, 0)).toBe('13%');
  });

  it('distinguishes an unrecorded score from a bad one', () => {
    expect(measured(null), 'never audited').toBe(UNKNOWN);
    expect(measured(0), 'audited, scored zero').toBe('0');
    expect(measured(-42), 'NPS runs to -100; zero is not its floor').toBe('-42');
    expect(measured(0.5, 2)).toBe('0.50');
  });

  it('distinguishes no amount from no money', () => {
    expect(money(null)).toBe(UNKNOWN);
    expect(money(0)).toBe('$0.00');
    expect(money(12345)).toBe('$123.45');
  });

  it('refuses a rate over an empty denominator rather than picking a digit', () => {
    expect(rate(0, 0), 'every inline version of this chose 0 or 100').toBe(UNKNOWN);
    expect(rate(5, -1)).toBe(UNKNOWN);
    expect(rate(3, 4)).toBe('75.0%');
  });

  it('does not mistake a non-numeric value for zero', () => {
    expect(pctOfFraction('not a number')).toBe(UNKNOWN);
    expect(measured(NaN)).toBe(UNKNOWN);
  });
});

// The source scans of `scp/agents/*.ts` went with the agents in Roadmap 2027 R9.
// The helper above is the statement of the rule, and it is still live.
