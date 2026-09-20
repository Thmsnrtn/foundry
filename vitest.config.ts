import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 10000,
    setupFiles: ['./src/test/setup.ts'],
    // SERIAL, AND NOW FOR A MEASURED REASON RATHER THAN AN INHERITED ONE.
    //
    // The comment here used to say this file's fixtures were 69% of the
    // suite's wall time — 255s of 370s — and that isolating them would give
    // most of the runtime back. Both halves were stale. The suite has grown
    // from 1313 tests to 4700, a serial run is 1889s, and
    // `gates-fail-when-they-should` is 250s of it: 13%, not 69%.
    //
    // The isolation was still worth doing and is done — that file now plants
    // its fixtures into a sandbox copy of the tree, so nothing it writes is
    // visible to any other test, and the correctness argument for serial
    // execution is gone. But turning parallelism on was MEASURED and is
    // roughly twice as slow here: this box has 4 CPUs, and the dominant cost
    // is not contention between files, it is that each of the 543 files
    // replays all 297 migrations into its own in-memory database before doing
    // anything. Oversubscribing four cores with that makes it worse.
    //
    // THE REAL FIX WAS THEREFORE A DIFFERENT ONE, AND IT IS DONE (21 Sep 2026):
    // the first file to migrate dumps a template keyed to the migration files
    // and every later file restores it in one call (`src/test/template-db.ts`,
    // proven equal to the migrated schema by `the-template-is-the-schema`).
    // Measured on one file: 7.8s with the replay, 4.3s with the template; the
    // full run before the template was 583 files in 2634s with 450 of them
    // replaying 361 migrations (`scripts/measure-suite-cost.mjs`). Flipping
    // this flag is worth measuring again now that the per-file cost is mostly
    // the tests themselves; it stays off until a measured run says otherwise.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
