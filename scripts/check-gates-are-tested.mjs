#!/usr/bin/env node
// =============================================================================
// FOUNDRY — a gate nobody has proved can fail
//
// `tests/unit/the-gates-actually-run.test.ts` opens with this sentence:
//
//   "This repository has built a large number of CI gates, and each one has a
//    planted-defect test proving it FAILS when it should."
//
// IT WAS NOT TRUE, AND NOTHING WAS CHECKING IT. Six of the thirty gates chained
// into `npm run check` are executed by no test anywhere: nobody has ever seen
// them go red. Four of those six guard exactly what this institution says it
// cares about — votes cast by principals not entitled to cast them, model calls
// charged to no company, governed state written around its own ledger, and the
// NULL-safety of the RAISE predicates that make guards fail closed.
//
// A gate that has never failed is indistinguishable from a gate that cannot.
// `check-star-select-columns` found three real phantom reads on its first run
// BECAUSE somebody planted a defect and watched it go red first. A green gate
// with no such test is a green light of unknown provenance, and this campaign's
// standing law is that the system may not claim a control its execution path
// cannot support. A gate IS a control, and the claim is the green tick.
//
// WHAT COUNTS AS PROVED: some file under `tests/` executes the script — it
// names the script in CODE and calls `execFileSync`. Not "mentions it", not
// "asserts the file exists": `tenancy-isolation.test.ts` checks that
// `check-tenant-scope.mjs` is present on disk, which is worth doing and is not
// this. The only evidence that a gate fails when it should is somebody having
// made it fail.
//
// COMMENTS ARE STRIPPED FIRST, and this gate needed that on its own first run.
// The moment it was chained it stopped reporting ITSELF as untested — because
// the planted-defect suite carries a comment explaining that this gate exists,
// and a comment naming a script in a file that runs other scripts looked
// exactly like coverage. An instrument that counts a sentence about a gate as
// proof the gate works is the defect it was written to find, so it is stripped
// like every other scanner here.
//
// The baseline may only SHRINK. Removing a gate from it means a test now plants
// a defect and watches it go red, not that the gate was forgiven.
// =============================================================================
import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from './lib/strip-comments.mjs';

const BASELINE = 'docs/db/untested-gates-baseline.txt';

function walk(dir) {
  let out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (entry.endsWith('.ts')) out.push(p);
  }
  return out;
}

const pkg = readFileSync('package.json', 'utf8');
const chained = [...new Set(
  // `[\\w-]` rather than `[a-z0-9-]`: the narrower class silently skipped any
  // script with an underscore in its name, which is most of this repository's
  // own test fixtures and would be a real gate the day somebody named one that
  // way. A scanner that cannot see a name cannot report it missing.
  [...pkg.matchAll(/node scripts\/([\w-]+\.mjs)/g)].map((m) => m[1]),
)].sort();

const testSources = walk('tests')
  .map((f) => stripComments(readFileSync(f, 'utf8'), { lineComments: true }));
const executed = new Set();
for (const src of testSources) {
  if (!src.includes('execFileSync')) continue;
  for (const gate of chained) if (src.includes(gate)) executed.add(gate);
}

const findings = chained.filter((g) => !executed.has(g));

let baseline = [];
try {
  baseline = readFileSync(BASELINE, 'utf8').trim().split('\n').filter(Boolean);
} catch { /* first run */ }

if (process.argv.includes('--write')) {
  writeFileSync(BASELINE, `${findings.join('\n')}\n`);
  console.log(`untested gates baseline written: ${findings.length}`);
  process.exit(0);
}

const known = new Set(baseline);
const appeared = findings.filter((g) => !known.has(g));
const fixed = baseline.filter((g) => !findings.includes(g));

if (appeared.length) {
  console.error('✗ gates chained into the check that no test has ever made fail:\n');
  for (const g of appeared) console.error(`  ${g}`);
  console.error('\nPlant a defect it should catch, run it, and assert it exits 1.');
  console.error('A gate that has never failed is indistinguishable from one that cannot.');
  process.exit(1);
}
if (fixed.length) {
  console.error(`✓ ${fixed.length} gate(s) now have a planted-defect test: ${fixed.join(', ')}`);
  console.error(`Remove them from ${BASELINE} with --write so they cannot come back.`);
  process.exit(1);
}
console.log(`✓ gates without a planted-defect test: ${findings.length} `
  + `(baseline ${baseline.length}), ${chained.length} chained gates checked`);
