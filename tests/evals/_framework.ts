// =============================================================================
// FOUNDRY — Eval Framework
// Lightweight golden-case runner for AI-adjacent code paths whose behavior
// would otherwise drift silently when prompts, models, or thresholds change.
//
// Pattern (per Karpathy's recommendation in the elite persona review):
//   - For each AI-driven module that produces a classifiable output, write
//     5-10 cases that pin down expected behavior.
//   - Cases run in CI alongside unit tests.
//   - When a case fails, you have a written-down expectation to compare
//     against the new behavior — not "I think it used to do X."
// =============================================================================

import { describe, it, expect } from 'vitest';

export interface EvalCase<I, O> {
  /** Short identifier — included in test output. */
  name: string;
  /** Input to the unit under eval. */
  input: I;
  /** Expected output (or partial expected; use a custom matcher for fuzzy). */
  expected: O;
  /**
   * Optional notes — what behavior this case pins down, why it matters,
   * or what previously broke it. Surfaces in failure output.
   */
  notes?: string;
}

export interface EvalSuite<I, O> {
  /** Title shown in test output. */
  title: string;
  /** The unit under eval. Sync or async. */
  run: (input: I) => O | Promise<O>;
  /** A custom matcher; defaults to deep equality. */
  matcher?: (actual: O, expected: O, ctx: EvalCase<I, O>) => void;
  /** The cases to evaluate. */
  cases: EvalCase<I, O>[];
}

/**
 * Define an eval suite. Call from a *.eval.test.ts file. Each case becomes
 * its own `it(...)` so a single failure surfaces the case name + notes.
 */
export function defineEval<I, O>(suite: EvalSuite<I, O>): void {
  const matcher = suite.matcher ?? defaultMatcher;
  describe(`eval: ${suite.title}`, () => {
    for (const c of suite.cases) {
      it(c.name + (c.notes ? ` — ${c.notes}` : ''), async () => {
        const actual = await suite.run(c.input);
        matcher(actual, c.expected, c);
      });
    }
  });
}

function defaultMatcher<O>(actual: O, expected: O): void {
  expect(actual).toEqual(expected);
}
