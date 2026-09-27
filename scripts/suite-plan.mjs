// Which test files cannot share the parallel phase, and why. Read by
// `run-suite.mjs` and checked by `the-suite-runs-in-parallel-safely`.

/** Runs in its own process: it plants defects into a throwaway copy of the tree. */
export const GATES = 'tests/unit/gates-fail-when-they-should.test.ts';

/**
 * WRITE INTO THE REAL TREE FOR A MOMENT, so they run after the parallel phase.
 * The gates file copies the tree when it starts and sweeps `_gate_fixture_*.ts`
 * out of the real `src`: beside one of these it could copy a fixture into its
 * sandbox, or delete one mid-test.
 */
export const PLANTERS = [
  'tests/unit/three-things-called-foundry.test.ts',
  'tests/unit/a-company-is-not-everyones-to-read.test.ts',
  'tests/unit/an-expensive-model-needs-an-argument.test.ts',
  'tests/unit/a-column-that-was-never-there.test.ts',
];
