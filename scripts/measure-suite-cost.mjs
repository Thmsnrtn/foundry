#!/usr/bin/env node
// =============================================================================
// WHERE THE SUITE'S TIME GOES, FROM A RUN THAT ALREADY HAPPENED.
//
// Reads a vitest log (the output of `npm run test:ci` or `npm run check`)
// and reports: files, tests, wall time by file, how many files replayed the
// whole schema, and the share of wall time the slowest files hold. Nothing
// here runs the suite: the figure comes from a run that was going to happen
// anyway, which is the only honest measurement of a forty-minute thing.
//
//   node scripts/measure-suite-cost.mjs <path-to-log> [--top N]
// =============================================================================
import { readFileSync } from 'node:fs';

const [, , logPath, ...rest] = process.argv;
if (!logPath) { console.error('usage: measure-suite-cost.mjs <vitest-log> [--top N]'); process.exit(2); }
const top = Number(rest[rest.indexOf('--top') + 1] || 15);
const text = readFileSync(logPath, 'utf8');

const files = [];
for (const m of text.matchAll(/^\s*[✓❯×]\s+(tests\/\S+\.test\.ts)\s+\((\d+) tests?(?:\s*\|[^)]*)?\)\s*(\d+)ms/gm)) {
  files.push({ file: m[1], tests: Number(m[2]), ms: Number(m[3]) });
}
const migrated = (text.match(/\[MIGRATE\] Applied \d+ migration\(s\)\./g) ?? []).length;
const restored = (text.match(/\[MIGRATE\] Restored the schema from the template/g) ?? []).length;
const total = files.reduce((n, f) => n + f.ms, 0);
const tests = files.reduce((n, f) => n + f.tests, 0);
files.sort((a, b) => b.ms - a.ms);
const slowest = files.slice(0, top);
const slowestMs = slowest.reduce((n, f) => n + f.ms, 0);
const duration = /Duration\s+([\d.]+)s/.exec(text)?.[1] ?? null;

console.log(`files ${files.length} · tests ${tests} · summed file time ${(total / 1000).toFixed(0)}s${duration ? ` · reported duration ${duration}s` : ''}`);
console.log(`schema replayed by migration in ${migrated} file(s); restored from the template in ${restored} file(s)`);
console.log(`slowest ${slowest.length} files hold ${(100 * slowestMs / Math.max(1, total)).toFixed(0)}% of summed file time:`);
for (const f of slowest) console.log(`  ${String(f.ms).padStart(7)}ms  ${String(f.tests).padStart(4)} tests  ${f.file}`);
const median = files.length ? files.map((f) => f.ms).sort((a, b) => a - b)[Math.floor(files.length / 2)] : 0;
console.log(`median file ${median}ms; files under 8s: ${files.filter((f) => f.ms < 8000).length}`);
