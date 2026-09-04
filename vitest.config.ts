import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 10000,
    setupFiles: ['./src/test/setup.ts'],
    // Kept serial deliberately — but NOT for the reason this comment used to
    // give. It claimed suites share one in-process `file::memory:` DB and
    // clobber each other. That was measured and is not true today: a probe
    // where one file creates a table and another looks for it shows the table
    // is invisible, because each test file gets its own module registry and
    // therefore its own in-memory database. Enabling `fileParallelism` and
    // running the full suite twice also passed, 1313/1313 both times.
    //
    // AND THE REAL CONSTRAINT HAS A NAME NOW. It is not only the open
    // intermittent failure: `tests/unit/gates-fail-when-they-should.test.ts`
    // proves each gate can fail by writing fixture files into the live `src/`
    // tree and running the real gate scripts over it. Any test file that scans
    // `src/` while those fixtures exist would see them. That file is also 69%
    // of the suite's wall time — 255s of 370s — because it shells out to a
    // gate script fifty-nine times.
    //
    // So flipping this needs the planting isolated first, not just evidence
    // about the intermittent failure. Whoever does that gets most of the
    // suite's runtime back.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
