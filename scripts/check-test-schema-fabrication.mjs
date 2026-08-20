#!/usr/bin/env node
// =============================================================================
// FOUNDRY — tests that build their own version of a real table
//
// `tests/unit/team-health.test.ts` created eight tables by hand, described as
// "just enough of those tables to test the computation path". Two of the eight
// were wrong: it gave `agent_messages` a `message_type` column (the real one
// is `type`) and `agent_predictions` a `measured_at` (the real one is
// `outcome_measured_at`). The service read exactly those names. The test
// agreed with it. Both were wrong about the product, and fourteen assertions
// passed green against a database that exists nowhere.
//
// A test that constructs its own schema does not test the product. It tests
// the code against the test's own beliefs, and the one thing it can never
// catch is the two of them being wrong together — which is the commonest way
// this fails, because the person writing the fixture reads the query to decide
// what columns to create.
//
// So: a test may create whatever throwaway tables it likes. It may not create
// a table the migrations also create. `runMigrations()` is right there.
//
// Baseline: docs/db/test-schema-fabrication-baseline.txt — may only shrink.
//
// Run: node scripts/check-test-schema-fabrication.mjs
// =============================================================================
import { execSync } from 'child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, relative, resolve } from 'path';
import { stripComments } from './lib/strip-comments.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const BASELINE = join(ROOT, 'docs/db/test-schema-fabrication-baseline.txt');
const DB = '/tmp/_testschema.db';

execSync(`rm -f ${DB}`);
for (const f of readdirSync(join(ROOT, 'src/db/migrations')).filter((f) => f.endsWith('.sql')).sort()) {
  try { execSync(`sqlite3 ${DB} < ${join(ROOT, 'src/db/migrations', f)} 2>/dev/null`); } catch { /* partial files expected */ }
}
const real = new Set(
  execSync(`sqlite3 ${DB} "SELECT name FROM sqlite_master WHERE type='table'"`)
    .toString().trim().split('\n').filter(Boolean));

function tsFiles(dir) {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const found = [];
for (const file of tsFiles(join(ROOT, 'tests'))) {
  // A header explaining that a migration wrote `CREATE TABLE IF NOT EXISTS
  // board_packets` is prose about the defect, not the defect. Blanked rather
  // than removed so reported line numbers still point at the real line.
  const src = stripComments(readFileSync(file, 'utf8'), { lineComments: false })
    .split('\n').map((l) => l.replace(/^(\s*)\/\/.*$/, '$1')).join('\n');
  for (const m of src.matchAll(/CREATE\s+TABLE\s+(?:IF NOT EXISTS\s+)?["'`]?(\w+)/gi)) {
    if (!real.has(m[1])) continue;                    // a throwaway table is fine
    const line = src.slice(0, m.index).split('\n').length;
    found.push(`${relative(ROOT, file)}:${line} → ${m[1]}`);
  }
}
found.sort();

const baseline = new Set(
  readFileSync(BASELINE, 'utf8').split('\n').map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#')));

// Anything the baseline file explains about itself is preserved across a
// --write, so the reason an entry is still there does not have to live in a
// commit message nobody will find.
const header = readFileSync(BASELINE, 'utf8').split('\n')
  .filter((l) => l.trim().startsWith('#')).join('\n');

// Line numbers move when a file is edited, so match on file+table rather than
// on the exact line — otherwise every unrelated edit looks like new debt.
const key = (s) => s.replace(/:\d+ /, ' ');
const baselineKeys = new Set([...baseline].map(key));
const newDebt = found.filter((f) => !baselineKeys.has(key(f)));
const foundKeys = new Set(found.map(key));
const paid = [...baseline].filter((b) => !foundKeys.has(key(b)));

if (process.argv.includes('--write')) {
  writeFileSync(BASELINE,
    (header ? header + '\n' : '') + found.join('\n') + (found.length ? '\n' : ''));
  console.log(`wrote ${found.length} baseline entries`);
  process.exit(0);
}

let failed = false;
if (newDebt.length) {
  console.error('A test is building its own version of a table the migrations already create.');
  console.error('Use runMigrations(). A fixture that disagrees with the schema proves nothing:\n');
  for (const f of newDebt) console.error('  ' + f);
  failed = true;
}
if (paid.length) {
  console.error('\nThese were paid down — remove them from the baseline so they cannot come back:\n');
  for (const p of paid) console.error('  ' + p);
  failed = true;
}
if (failed) process.exit(1);
console.log(`✓ no new fabricated test schemas (${found.length} known, paid down over time)`);
