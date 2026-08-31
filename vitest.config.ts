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
    // The setting stays as-is because an unexplained intermittent failure is on
    // record (see IMPLEMENTATION_STATE), and changing test execution semantics
    // while that is open would confound the next investigation — not because
    // concurrency is known to break anything. Whoever closes that item can flip
    // this with evidence.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
