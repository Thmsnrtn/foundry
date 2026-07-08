import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 10000,
    setupFiles: ['./src/test/setup.ts'],
    // Many suites share one in-process `file::memory:` DB (created/cleaned in
    // their own hooks). Running files concurrently lets them clobber each
    // other's tables — a real intermittent CI flake. Serialize file execution
    // for determinism; the whole suite still runs in ~15s.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
