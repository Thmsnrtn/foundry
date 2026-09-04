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
    // THE REAL FIX IS THEREFORE A DIFFERENT ONE: migrate once into a template
    // database and have each file copy it, rather than replaying the schema
    // 543 times. That is where the twenty-five minutes actually is. Flipping
    // this flag is safe to try again on a bigger machine, or after that
    // change, and the number to beat is 1889s.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
