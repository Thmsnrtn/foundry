#!/usr/bin/env node
// =============================================================================
// FOUNDRY — mutating dashboard routes that ask nothing
//
// Two earlier batches created this class between them. Batch 51 gave the
// `team_members` permission columns their first readers; batch 52 made
// membership the thing that makes a company VISIBLE. Before both, an invited
// member could not reach any page at all, so a mutating route with no
// capability check was survivable by accident. It is not survivable now: an
// accepted member reaches every page, and the route decides what they may do
// there.
//
// The first run of this scan found 116. Most are ordinary company work an
// active member should be able to do, and gating them would be the other
// defect — a guard that refuses the legitimate principal is not extra secure.
// So this is a RATCHET, not a wall: the number may fall and never rise. Each
// route that leaves the list does so because somebody decided which capability
// it needs, or decided it needs none and said why.
//
// WHAT COUNTS AS ASKING: `requireCompanyCapability`, `requireOwner`, a
// router-level `.use('*', …)` carrying one, or a `memberMay(...)` call inside
// the handler. The last is the same predicate without the middleware wrapper,
// and some routes have to ask it there — a handler whose company arrives in the
// REQUEST BODY cannot be guarded by middleware that resolves the company from
// the path or the selection, or it would authorize one company and write to
// another.
//
// What does NOT count is an inline ownership scope — `owner_id = ?`, or a
// `getProductByOwner` call. That is what this campaign has been REMOVING:
// "the company you own" is a different question from "may you do this", and
// answering the first is how the second went unasked.
//
// Run: node scripts/check-route-guards.mjs [--write]
// =============================================================================
import { readdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const BASELINE = join(ROOT, 'docs/db/unguarded-route-baseline.txt');
const DIR = join(ROOT, 'src/routes/dashboard');

function tsFiles(dir) {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** Comments describe the defect; they are not the defect. */
function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n').map((l) => l.replace(/^(\s*)\/\/.*$/, '$1')).join('\n');
}

const GUARD = /require(CompanyCapability|Owner)\s*\(|\bmemberMay\s*\(/;
const found = [];

for (const file of tsFiles(DIR)) {
  const src = strip(readFileSync(file, 'utf8'));
  const rel = relative(ROOT, file);
  // A router-level guard covers every route in the file.
  if (/\.use\(\s*'\*'\s*,[\s\S]{0,200}?require(CompanyCapability|Owner)\s*\(/.test(src)) continue;

  const lines = src.split('\n');
  // Where each route declaration starts, so a handler's own body can be read
  // to its end rather than guessed at by a fixed number of lines.
  const starts = [];
  lines.forEach((line, i) => {
    // Anchored to the start of the line: a route declaration is a top-level
    // statement. Without the anchor `const founder = c.get('founder')` reads as
    // a route named "founder" and truncates the handler above it to one line —
    // which silently hid every inline check in this file.
    const m = line.match(/^\s*[A-Za-z_$][\w$]*\.(post|put|patch|delete|get)\(\s*'([^']+)'/);
    if (m) starts.push({ i, method: m[1], path: m[2] });
  });

  starts.forEach((r, n) => {
    if (r.method === 'get') return;                       // reads are not this
    const end = n + 1 < starts.length ? starts[n + 1].i : lines.length;
    if (GUARD.test(lines.slice(r.i, end).join('\n'))) return;
    found.push(`${r.method.toUpperCase()} ${r.path}`);
  });
}

const current = [...new Set(found)].sort();

if (process.argv.includes('--write')) {
  writeFileSync(BASELINE, current.join('\n') + '\n');
  console.log(`wrote ${current.length} unguarded mutating routes`);
  process.exit(0);
}

let baseline = [];
try {
  baseline = readFileSync(BASELINE, 'utf8').split('\n').filter(Boolean);
} catch {
  console.error(`No baseline at ${relative(ROOT, BASELINE)}. Run with --write.`);
  process.exit(1);
}

const known = new Set(baseline);
const added = current.filter((r) => !known.has(r));

if (added.length) {
  console.error('New mutating dashboard routes that ask no capability:\n');
  for (const a of added) console.error('  ' + a);
  console.error('\nDecide which capability the route needs and add');
  console.error('`requireCompanyCapability(...)` or `requireOwner()`. If it genuinely');
  console.error('needs none — a route that only LOWERS what Foundry may do, like a');
  console.error('panic switch or a revocation — say so in a comment above it and add');
  console.error('the line to the baseline with --write.');
  process.exit(1);
}

const removed = baseline.filter((r) => !current.includes(r));
if (current.length > baseline.length) {
  console.error(`Unguarded mutating routes rose: ${baseline.length} → ${current.length}`);
  process.exit(1);
}
console.log(`✓ unguarded mutating routes: ${current.length} (baseline ${baseline.length}`
  + `${removed.length ? `, ${removed.length} paid down — rerun with --write` : ''})`);
