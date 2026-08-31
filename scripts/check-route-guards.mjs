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
// WHERE IT LOOKS, AND WHY THAT WAS WRONG.
//
// This scanned `src/routes/dashboard` and nothing else, and printed
// "unguarded mutating routes: 34" — a statement about one directory, in the
// voice of a statement about the system. `src/routes/api` holds EIGHTY-ONE
// more, on the same surface, reached by the same session-authenticated
// principal: `POST /api/network/peer-review` takes a `product_id` out of the
// request body and writes a row against it with nothing asked at all. The gate
// was silent about them, and silence read as absence — the same defect this
// campaign has been finding in product copy, in a report that could not read
// its own source, and in a table classified as naming nobody.
//
// So the population is now every founder-authenticated route surface, and the
// baseline jumped accordingly. THAT IS NOT A RELAXATION. Nothing was permitted
// that was refused before; a number that was measuring a quarter of the
// surface has been corrected to measure the surface. The ratchet still only
// falls.
//
// WHAT IS DELIBERATELY OUT OF SCOPE, and why each one:
//   • `api/webhooks`, `ingest` — authenticated by a token or a provider
//     signature, not by a member. "Which capability does this member hold" is
//     not a question that can be asked of them, and padding the baseline with
//     routes that can never leave it would make the number mean less.
//   • `auth` — the identity provider's own callbacks, same reason.
//   • `internal` — the institution talking to itself; no member is present.
// Each of those surfaces has its own door and its own tests; this gate is
// about the one where an accepted member reaches every page.
//
// Run: node scripts/check-route-guards.mjs [--write]
//
// A BASELINE ENTRY THAT NO LONGER NAMES A REAL OFFENDER IS A PERMANENT
// EXEMPTION, which is the ratchet failing in the exact direction it exists to
// prevent. Fix the offender, leave the line, and the day somebody reintroduces
// it at that same place the gate says nothing — it is "known". Every sibling
// gate here refuses to pass on an improvement that has not been written down;
// this one printed a suggestion, or nothing at all. Measured rather than
// assumed: a probe line appended to each of the eleven baselines showed three
// gates accepting an entry that matched no finding.
//
// =============================================================================
import { readdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import { stripComments } from './lib/strip-comments.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const BASELINE = join(ROOT, 'docs/db/unguarded-route-baseline.txt');
const DIR = join(ROOT, 'src/routes');

/** Surfaces where no member is present, so member capability is not the
 *  question. Reasoned in the header; listed here so a new one is a decision. */
const NOT_A_MEMBER_SURFACE = [
  'src/routes/api/webhooks',
  'src/routes/ingest',
  'src/routes/internal',
  'src/routes/auth',
];

function tsFiles(dir) {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** Comments describe the defect; they are not the defect. */
function strip(src) {
  return stripComments(src, { lineComments: false })
    .split('\n').map((l) => l.replace(/^(\s*)\/\/.*$/, '$1')).join('\n');
}

// `requireInstitutionOwner` counts too. It asks a deployment-level question —
// are you the principal this institution belongs to — for the one route that
// cannot ask a company-level one, because it is the route that creates the
// first company. It grants nothing about any company's data, so it is not a
// general substitute for the two above.
const GUARD = /require(CompanyCapability|Owner|InstitutionOwner)\s*\(|\bmemberMay\s*\(/;
const found = [];

for (const file of tsFiles(DIR)) {
  const rel = relative(ROOT, file).split('\\').join('/');
  if (NOT_A_MEMBER_SURFACE.some((d) => rel.startsWith(d + '/'))) continue;
  const src = strip(readFileSync(file, 'utf8'));
  // ROUTER-LEVEL GUARDS, AND THE PATHS THEY ACTUALLY COVER.
  //
  // This recognised only `.use('*', …)` and treated it as covering every route
  // in the file. That was the coarse reading of a pattern that turned out to be
  // the cause of three dead surfaces: a router mounted at '/' with `use('*')`
  // applies its middleware to the whole application, so those guards had to be
  // scoped to the paths their own router declares — and once scoped, this gate
  // could no longer see them and reported thirteen guarded routes as unguarded.
  //
  // A guard covers the routes its PATTERN matches. `'*'` still covers the file;
  // `/exit/*` covers `/exit/...` and nothing else. Strictly more accurate than
  // what it replaced, and it no longer rewards the shape that caused the defect.
  const guardPatterns = [];
  for (const g of src.matchAll(/\.use\(\s*'([^']+)'\s*,[\s\S]{0,200}?require(?:CompanyCapability|Owner)\s*\(/g)) {
    guardPatterns.push(g[1]);
  }
  // `:param` matches one segment; a trailing `*` matches the rest.
  const covers = (pattern, path) => {
    if (pattern === '*') return true;
    const rx = new RegExp('^' + pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/:[A-Za-z0-9_]+/g, '[^/]+')
      .replace(/\*/g, '.*') + '$');
    return rx.test(path);
  };
  if (guardPatterns.includes('*')) continue;

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
    // A router-level guard whose pattern covers this route guards it, exactly
    // as the inline form above does.
    if (guardPatterns.some((pattern) => covers(pattern, r.path))) return;
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
if (removed.length) {
  // THIS USED TO BE A SUGGESTION AND IS NOW A REFUSAL. A route that has been
  // given a capability check and left on the baseline is exempt forever: remove
  // the guard again tomorrow and this gate is silent, because the route is
  // "known". An improvement nobody wrote down is one the next commit can undo.
  console.error(`\n✓ ${removed.length} route(s) now ask a capability:\n`);
  for (const r of removed) console.error(`  ${r}`);
  console.error(`\nRemove them from ${relative(ROOT, BASELINE)} with --write so they`);
  console.error('cannot come back unguarded without this gate noticing.');
  process.exit(1);
}
console.log(`✓ unguarded mutating routes: ${current.length} (baseline ${baseline.length})`);
