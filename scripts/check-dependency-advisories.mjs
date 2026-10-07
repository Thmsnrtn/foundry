#!/usr/bin/env node
// =============================================================================
// A KNOWN HOLE IS WRITTEN DOWN, OR IT FAILS (Roadmap 2027 R2, 30 September 2026).
//
// CI ran `npm audit --audit-level=high || true`. The `|| true` turned a gate
// into a log line nobody read: on the day it was removed the tree held eleven
// high advisories and one critical. The six with a compatible fix were fixed.
// What remains is listed below, each with the reason it cannot reach
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
  // Closed on 6 October 2026 by the remediation program's dependency PR: the
  // Clerk SDK (and with it js-cookie, GHSA-qjx8-664m-686j) was replaced by
  // `@clerk/backend` 3 used directly, and vitest 1 → 4 removed tinypool
  // (GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr), the UI-server read
  // (GHSA-5xrq-8626-4rwp) and vite's Windows path bypass (GHSA-fx2h-pf6j-xcff);
  // vite 8's postcss carries source-map-js 1.2.2 (GHSA-68fv-2mgg-jv7q).

  // braces <=3.0.3, stack exhaustion on deeply nested patterns (published 3
  // October 2026; no patched braces exists). Reached only through tsc-alias
  // (a dev dependency) → chokidar and globby/micromatch, which run once at
  // build time over this repository's own paths. The production image carries
  // the files (its node_modules come from a full install) but the server never
  // loads them, and no pattern from outside ever reaches them. Closed by a
  // braces release above 3.0.3, or by dropping tsc-alias from the build.
  'GHSA-vfj7-8cjw-p6xm': 'braces via tsc-alias: build-time only, over our own paths; no fix released',
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
