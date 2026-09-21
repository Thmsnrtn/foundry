#!/usr/bin/env node
// =============================================================================
// FOUNDRY — the review instrument is the institution, not a copy of it
//
// `tests/helpers/world.ts` assembles the owner surface a reviewer walks. It
// used to list the routers by hand, and it had drifted: three addresses the
// product links to from the footer of every page — the letter, settings, and
// the privacy page where taking a copy of the data and deleting it live —
// answered 404 in the laboratory and nowhere else. Two independent reviewers
// reported the owner's own exit doors as broken. They were not broken. The
// laboratory was smaller than the institution it was reviewing.
//
// THAT IS THIS CAMPAIGN'S SUBJECT WEARING A DIFFERENT COAT: a process that
// executes correctly against its own internal state while the thing it is
// supposed to observe is not there. A review instrument missing parts of what
// it reviews produces findings that are false and hides findings that are
// true, and nothing in the run says so.
//
// So: every router `src/index.ts` mounts is either mounted by the laboratory
// or named in `NOT_MOUNTED_IN_THE_LABORATORY` with a reason. A reason is a
// claim about the product that a person can check — never "it is hard to
// mount". The gate does not judge the reason; it makes its absence impossible.
// =============================================================================

import { readFileSync } from 'node:fs';

// The two files, overridable so the gate can be pointed at a planted pair and
// shown to bite. A gate nobody has watched fail is a gate nobody has tested.
const INDEX = process.argv[2] ?? 'src/index.ts';
const WORLD = process.argv[3] ?? 'tests/helpers/world.ts';

const index = readFileSync(INDEX, 'utf-8');
const world = readFileSync(WORLD, 'utf-8');

// What production mounts: `app.route('<path>', <identifier>)`.
const mountedInProduction = [...index.matchAll(/app\.route\(\s*'[^']*'\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g)]
  .map((m) => m[1]);

// What the laboratory mounts, by the module member it imports:
//   app.route('/', (await import('…')).letterRoutes as never)
const mountedInTheLaboratory = new Set(
  [...world.matchAll(/app\.route\([^)]*\)\)\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
);

// The stated absences, read from the object literal itself so the reason lives
// beside the code rather than in a list somebody has to remember to update.
const stated = new Map();
const block = /NOT_MOUNTED_IN_THE_LABORATORY[^{]*\{([\s\S]*?)\n\}\)/.exec(world);
if (block) {
  // Join the string concatenations first, so one entry is one line whatever
  // the wrapping looks like, then read each `name: 'reason'` pair.
  const flat = block[1].replace(/'\s*\n?\s*\+\s*\n?\s*'/g, '');
  for (const m of flat.matchAll(/([A-Za-z_$][\w$]*):\s*'((?:[^'\\]|\\.)*)'/g)) {
    stated.set(m[1], m[2].trim());
  }
}

const missing = [];
const unreasoned = [];
for (const name of new Set(mountedInProduction)) {
  if (mountedInTheLaboratory.has(name)) continue;
  if (!stated.has(name)) { missing.push(name); continue; }
  const why = stated.get(name) ?? '';
  if (why.length < 20) unreasoned.push(`${name}: the reason given is too short to be one`);
}

// And an absence nobody needs any more is itself drift: a router named here
// that production no longer mounts, or that the laboratory now mounts, is a
// stale excuse.
const stale = [...stated.keys()].filter(
  (name) => !mountedInProduction.includes(name) || mountedInTheLaboratory.has(name),
);

if (missing.length || unreasoned.length || stale.length) {
  console.error('✗ the laboratory is not the institution it reviews\n');
  for (const n of missing) {
    console.error(`  ${INDEX} mounts ${n} and ${WORLD} neither mounts it nor says why not`);
  }
  for (const n of unreasoned) console.error(`  ${n}`);
  for (const n of stale) {
    console.error(`  ${n} is named as a deliberate absence and is no longer one`);
  }
  console.error(`\n  Mount it in ownerApp(), or name it in NOT_MOUNTED_IN_THE_LABORATORY with a`);
  console.error('  reason about the product. A reviewer\'s finding must be about the institution.');
  process.exit(1);
}

console.log(`✓ the laboratory mounts what production mounts (${String(mountedInTheLaboratory.size)} routers, `
  + `${String(stated.size)} stated absences)`);
