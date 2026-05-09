// =============================================================================
// Eval: shouldEvolveThisSession (SCP adaptive cadence)
// Pins down the deterministic decision tree that gates the evolution
// engine. A silent change to the boundaries (early window size, moderate
// window upper bound, conservative-window requirements) is exactly the
// kind of regression that drifts before anyone notices.
// =============================================================================

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';

import { defineEval, type EvalCase } from './_framework.js';
import { shouldEvolveThisSession } from '../../src/services/scp/evolution.js';

interface CaseInput {
  totalSessions: number;
  observationsFound: boolean;
  isCorrection: boolean;
  hasMajorEvent: boolean;
}

const cases: EvalCase<CaseInput, boolean>[] = JSON.parse(
  readFileSync(resolve(__dirname, 'cases/should-evolve.json'), 'utf-8')
);

defineEval<CaseInput, boolean>({
  title: 'shouldEvolveThisSession decision tree',
  cases,
  run: (input) =>
    shouldEvolveThisSession(
      input.totalSessions,
      input.observationsFound,
      input.isCorrection,
      input.hasMajorEvent
    ),
});

describe('should-evolve eval suite shape', () => {
  it('loaded all 10 cases from the JSON file', () => {
    expect(cases.length).toBe(10);
  });
});
