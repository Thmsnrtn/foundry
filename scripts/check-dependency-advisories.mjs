#!/usr/bin/env node
// =============================================================================
// A KNOWN HOLE IS WRITTEN DOWN, OR IT FAILS (Roadmap 2027 R2, 30 September 2026).
//
// CI ran `npm audit --audit-level=high || true`. The `|| true` turned a gate
// into a log line nobody read: on the day it was removed the tree held eleven
// high advisories and one critical. The six with a compatible fix were fixed.
// The three that remain are listed below, each with the reason it cannot reach
// production and what would close it. Any OTHER high or critical advisory
// fails, so a new one is a decision rather than a line in a log.
//
// This needs the registry, so it runs in CI and not inside `npm run check`,
// which has to pass offline.
//
//   node scripts/check-dependency-advisories.mjs
//   --report <file>   read an `npm audit --json` report from a file (tests)
// =============================================================================
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ACCEPTED = {
  // js-cookie <=3.0.5, prototype hijack in assign(). Reached only through
  // @clerk/clerk-sdk-node 4 → @clerk/shared, where it is the BROWSER cookie
  // helper; the server never calls it. Closed by the Clerk SDK major upgrade,
  // which touches sign-in and gets its own slice with a sign-in rehearsal.
  'GHSA-qjx8-664m-686j': 'js-cookie via Clerk SDK 4: browser helper, not reached on the server',
  // vitest <3.2.6: arbitrary file read when the Vitest UI server is listening.
  // A dev dependency; the UI server is never started here or in CI, and
  // production images carry no dev dependencies. Closed by vitest 3+.
  'GHSA-5xrq-8626-4rwp': 'vitest UI server: never started; dev only',
  // vite server.fs.deny bypass on Windows alternate paths. The dev server is
  // never run; vite is present only as vitest's transform. Closed with vitest 3+.
  'GHSA-fx2h-pf6j-xcff': 'vite dev server on Windows: never run; dev only',
};

let raw;
const reportArg = process.argv.indexOf('--report');
if (reportArg >= 0) raw = readFileSync(process.argv[reportArg + 1], 'utf8');
else try {
  raw = execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (err) {
  // npm audit exits non-zero whenever anything is found; its JSON is still on stdout.
  raw = err.stdout;
  if (!raw) { console.error('npm audit produced no report:', err.message); process.exit(1); }
}
const report = JSON.parse(raw);
const found = new Map();
for (const v of Object.values(report.vulnerabilities ?? {})) {
  for (const via of v.via) {
    if (typeof via !== 'object' || !['high', 'critical'].includes(via.severity)) continue;
    const id = String(via.url ?? '').split('/').pop();
    found.set(id, `${via.severity} ${via.name}: ${via.title}`);
  }
}
const unexplained = [...found].filter(([id]) => !(id in ACCEPTED));
const stale = Object.keys(ACCEPTED).filter((id) => !found.has(id));
if (unexplained.length) {
  console.error('High or critical advisories with no written reason:\n');
  for (const [id, what] of unexplained) console.error(`  ${id}  ${what}`);
  console.error('\nFix it (npm audit fix), or say in this file why it cannot reach production and what would close it.');
  process.exit(1);
}
if (stale.length) {
  // An exemption for a hole that has closed would silently exempt it if it reopened.
  console.error(`Accepted advisories no longer present — remove them: ${stale.join(', ')}`);
  process.exit(1);
}
console.log(`✓ high/critical advisories: ${String(found.size)}, each with a written reason`);
