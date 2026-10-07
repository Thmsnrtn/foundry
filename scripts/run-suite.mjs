#!/usr/bin/env node
// =============================================================================
// THE SUITE, IN THE TIME IT ACTUALLY NEEDS.
//
// `npm run check` took about twenty minutes, and one file was 42% of the test
// time: `gates-fail-when-they-should` (365s of 868s on 27 September 2026),
// which runs the real gate scripts over planted defects. Since 21 September
// it plants into a throwaway copy of the tree, so it no longer touches what
// any other file reads — the reason it had to share one serial queue with
// everything else is gone.
//
// So the suite runs as three phases, and fails if any of them fails:
//
//   1. IN PARALLEL: the gates file in one process, and every other file
//      except the planters split across FOUNDRY_SUITE_SHARDS more (default
//      2). Each process is still serial inside (see `vitest.config.ts` for
//      why): this uses three of the box's four cores instead of one.
//   2. THEN, ALONE: the files that still write into the REAL tree for a
//      moment. The gates file copies the tree when it starts and sweeps
//      `_gate_fixture_*.ts` out of the real `src`; running beside a planter
//      could copy its fixture into the sandbox, or delete it mid-test.
//
// A NEW TEST THAT WRITES INTO THE REAL `src`, `docs`, `tests` OR `scripts`
// BELONGS IN `PLANTERS` (`suite-plan.mjs`), and
// `the-suite-runs-in-parallel-safely` fails until it is there. Better still,
// it plants into a copy.
// =============================================================================
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

// Vitest itself, with no shell between: a shell that expands braces would
// split the exclusion glob below into several arguments.
const VITEST = resolve('node_modules/vitest/vitest.mjs');

import { GATES, PLANTERS } from './suite-plan.mjs';

function run(label, args) {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn(process.execPath, [VITEST, 'run', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = (stream, sink) => {
      let buffered = '';
      stream.on('data', (chunk) => {
        buffered += chunk.toString();
        const lines = buffered.split('\n');
        buffered = lines.pop() ?? '';
        for (const line of lines) sink.write(`[${label}] ${line}\n`);
      });
      stream.on('end', () => { if (buffered) sink.write(`[${label}] ${buffered}\n`); });
    };
    out(child.stdout, process.stdout);
    out(child.stderr, process.stderr);
    child.on('close', (code) => {
      process.stdout.write(`[${label}] exited ${String(code)} after ${((Date.now() - started) / 1000).toFixed(0)}s\n`);
      done(code ?? 1);
    });
  });
}

const t0 = Date.now();
// One --exclude value, a brace glob of every file run on its own (Vitest 1.6
// took only one; 4 accepts several, and the one glob still reads as one list).
const EXCLUDE = `tests/unit/{${[GATES, ...PLANTERS].map((p) => p.replace(/^tests\/unit\/|\.test\.ts$/g, '')).join(',')}}.test.ts`;
const SHARDS = Number(process.env.FOUNDRY_SUITE_SHARDS ?? 2);
// ONE FILE, THROUGH THE SAME VERDICT. `gates-fail-when-they-should` uses this
// to prove the runner exits 1 when a test fails, without running the suite.
const ONLY = process.env.FOUNDRY_SUITE_ONLY;
const phase1 = await Promise.all(ONLY
  ? [run('only', [ONLY]).then((c) => ['only', c])]
  : [
    run('gates', [GATES]).then((c) => ['gates', c]),
    ...Array.from({ length: SHARDS }, (_, i) =>
      run(`suite ${String(i + 1)}/${String(SHARDS)}`, ['--exclude', EXCLUDE, `--shard=${String(i + 1)}/${String(SHARDS)}`])
        .then((c) => [`suite ${String(i + 1)}/${String(SHARDS)}`, c])),
  ]);
const planters = ONLY ? 0 : await run('planters', PLANTERS);
const failed = [...phase1, ['planters', planters]].filter(([, c]) => c !== 0);
process.stdout.write(`\nsuite: ${failed.length === 0 ? 'every phase passed' : `FAILED in ${failed.map(([l]) => l).join(', ')}`}`
  + ` in ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
process.exit(failed.length === 0 ? 0 : 1);
