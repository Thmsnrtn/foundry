#!/usr/bin/env node
// =============================================================================
// FOUNDRY — code that nothing can reach
//
// A reachability gate already existed and it was good: import-graph walking
// including dynamic imports, an exact both-directions DARK list, and a test
// that the DARK reasons are not "for later". It scanned
// `src/services/institution` — 38 of 437 TypeScript files.
//
// So it proved a great deal about one directory and nothing about the system,
// and the cost showed up as false institutional truth: two modules carrying
// E2 claims in IMPLEMENTATION_STATE had ZERO importers anywhere in `src/`.
// E2 means "local runtime through production-facing services". There was no
// production-facing service. Neither module lived under the gate's directory,
// so nothing contradicted the claim for as long as it stood.
//
// This walks the same graph from the real entry points across all of `src/`.
// It is a RATCHET, not a wall: a large amount of code is currently
// unreachable, some of it deliberately (frozen benchmarks are exercised by
// their own tests by design). The number may fall and never rise, and each
// module that leaves the list does so because somebody deleted it or wired it
// up — not because the list was edited.
//
// WHAT COUNTS AS REACHED: any module the entry points import, statically or
// dynamically, transitively. Dynamic matters — several subsystems here are
// reached only through `await import(...)`, and a static-only graph would
// report them dead and be believed.
//
// WHAT IS NOT SCANNED: `src/types` and `src/db/migrations` are declarations
// and data rather than executable paths, and a type file is "unreachable" in
// this sense whenever the compiler erases it — which says nothing.
//
// A FINDING THIS GATE MADE VISIBLE AND DOES NOT ITSELF COVER. Three modules
// on the baseline — `scp/okr.ts`, `scp/wiki.ts`, `quality/metrics.ts` — are
// the WRITE half of tables whose READ half is live and mounted. Deleting them
// turned `check-writerless-tables` red, which is how it surfaced: those
// readers have been reading tables nothing reachable could ever fill.
// `/agents/okr` renders from `company_okrs`; `src/api/v1/metrics.ts` reads
// `data_quality_alerts` on the PUBLIC API. Whether to delete a mounted page
// or wire its writer is a product decision and is recorded in the live
// frontier, not made as a side effect of a deletion sweep.
//
// Run: node scripts/check-reachability.mjs [--write]
// =============================================================================
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { stripComments } from './lib/strip-comments.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');
const BASELINE = join(ROOT, 'docs/db/unreachable-modules-baseline.txt');

const ENTRY_POINTS = ['src/index.ts', 'src/jobs/index.ts', 'src/cli/index.ts'];
const NOT_EXECUTABLE = ['src/types/', 'src/db/migrations/'];

/**
 * REACHED BY A MECHANISM THIS GRAPH CANNOT SEE, and how.
 *
 * An import-graph walker follows literal specifiers. Several modules here are
 * reached through a COMPUTED one — `await import(\`../agents/${name}.js\`)` —
 * and a naive run therefore reports live, dynamically-loaded code as dead. The
 * existing institution gate carries the same warning for the same reason: a
 * previous run named ~160KB of running agents as unreachable and would have
 * been believed.
 *
 * So these are declared REACHED, each with the mechanism that reaches them.
 * That is a different statement from "unreachable but allowed": the baseline
 * below means nobody can run this, and these entries mean somebody can, by a
 * route the walker cannot follow. Conflating the two is how a gate starts
 * lying in the reassuring direction.
 */
const REACHED_BY = {
  'src/services/scp/agents/': 'computed dynamic import — dispatcher.ts:162 and agents.ts:478 build the specifier from a name narrowed to a closed vocabulary',
  'src/test/setup.ts': 'loaded by the test runner, not by the application',
};

const rel = (f) => relative(ROOT, f).split('\\').join('/');

function tsFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? tsFiles(path)
      : path.endsWith('.ts') && !path.endsWith('.d.ts') ? [path] : [];
  });
}

/**
 * Static `from '...'` and dynamic `import('...')` alike.
 *
 * COMMENTS ARE STRIPPED FIRST. An import commented out while debugging and left
 * that way would otherwise still count as an edge, and the module it names
 * would go on looking reachable while nothing imports it — a false NEGATIVE, in
 * the direction this gate exists to catch. Measured at zero across `src/` when
 * this was added; the point is that it stays zero without anybody checking.
 */
function importsOf(file) {
  let source;
  try { source = readFileSync(file, 'utf8'); } catch { return []; }
  source = stripComments(source, { lineComments: false })
    .split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l)).join('\n');
  const out = [];
  const re = /(?:from\s*|import\s*\(\s*)['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const base = resolve(dirname(file), m[1].replace(/\.js$/, ''));
    // A specifier may name a file or a directory index.
    for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) {
      try { if (statSync(candidate).isFile()) { out.push(candidate); break; } } catch { /* next */ }
    }
  }
  return out;
}

// A module reached by a declared mechanism is an ENTRY POINT TOO. Declaring
// one reached without walking from it is how `scratchpad.ts` — imported by
// `agents/base.ts`, which the dispatcher loads by computed name — was reported
// dead and very nearly deleted while live code imported it. A gate that stops
// the walk at the declared module tells the truth about that module and lies
// about everything beneath it.
const declaredRoots = tsFiles(SRC)
  .filter((f) => Object.keys(REACHED_BY).some((k) => rel(f).startsWith(k)));

const seen = new Set();
const queue = [...ENTRY_POINTS.map((e) => resolve(ROOT, e)), ...declaredRoots];
while (queue.length) {
  const file = queue.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  for (const next of importsOf(file)) if (!seen.has(next)) queue.push(next);
}

const unreachable = tsFiles(SRC)
  .filter((f) => !seen.has(f))
  .map(rel)
  .filter((f) => !NOT_EXECUTABLE.some((d) => f.startsWith(d)))
  .filter((f) => !Object.keys(REACHED_BY).some((k) => f.startsWith(k)))
  .sort();

if (process.argv.includes('--write')) {
  writeFileSync(BASELINE, unreachable.join('\n') + '\n');
  console.log(`wrote ${unreachable.length} unreachable modules`);
  process.exit(0);
}

let baseline = [];
try {
  baseline = readFileSync(BASELINE, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
} catch {
  console.error(`Missing baseline ${BASELINE}. Run with --write to create it.`);
  process.exit(1);
}

const added = unreachable.filter((f) => !baseline.includes(f));
if (added.length > 0) {
  console.error(
    '\nNew modules nothing can reach:\n\n'
    + added.map((f) => `  ${f}`).join('\n')
    + '\n\nEither wire it to an entry point or delete it. A module that only its\n'
    + 'own test reaches is not covered by that test in any sense the evidence\n'
    + 'ladder recognises — E2 means runtime through a production-facing service.\n');
  process.exit(1);
}

const resolved = baseline.filter((f) => !unreachable.includes(f));
if (resolved.length > 0) {
  console.error(
    `\n${resolved.length} module(s) became reachable or were deleted. Remove them\n`
    + 'from the baseline with --write so they cannot come back:\n\n'
    + resolved.map((f) => `  ${f}`).join('\n') + '\n');
  process.exit(1);
}

console.log(
  `✓ unreachable modules: ${unreachable.length} (baseline ${baseline.length}), `
  + `${seen.size} reached from ${ENTRY_POINTS.length} entry points, `
  + `${Object.keys(REACHED_BY).length} reached by a declared mechanism`);
