#!/usr/bin/env node
// =============================================================================
// FOUNDRY — the reality boundary, enforced as a gate
//
// Migration 222 gave every company a `reality`, and `realCompany()` in
// src/db/client.ts is the one definition of it. The guarantee that matters is
// that synthetic evidence never reaches owner truth — and that guarantee is
// only as good as the LAST query somebody wrote.
//
// Six independent readers of this codebase found roughly thirty places where a
// synthetic company's data would have reached the owner: the fleet letter, the
// portfolio triage counts, `getPulse`'s revenue roll-ups, the cross-company
// benchmark and wisdom pools with their contributor floors, the operator spend
// surfaces. Each was fixed by hand. Hand-fixing does not survive the next
// commit, and a boundary that depends on remembering is not a boundary.
//
// So this counts them. Every SELECT over `products` that does NOT constrain a
// single company by id and does NOT apply the predicate is an offender, and the
// count may only shrink. New ones fail the build with the file and line.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It does not demand the predicate
// everywhere: a reference company that no routine touches exercises nothing,
// and the job work-lists SHOULD hand it to the institution — that is the entire
// point. The rule is about where ANSWERS TRAVEL, not where work happens, and
// no regex can tell those apart. So this is a ratchet with a baseline, in the
// same shape as the other gates here: the baseline is the list of queries a
// person has looked at and judged safe, and it shrinks as they are reviewed.
// =============================================================================

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BASELINE = 'docs/db/reality-scope-baseline.txt';
const WRITE = process.argv.includes('--write');

function walk(dir) {
  let out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** A query that names one company by id is already scoped to that company. */
function boundToOneCompany(sql) {
  return /\b(id|product_id|p\.id)\s*=\s*\?/.test(sql)
    || /\bWHERE\s+id\s*=/.test(sql)
    || /products\s+WHERE\s+id/i.test(sql);
}

const offenders = [];
for (const file of walk('src')) {
  // The definition itself, and the migration that created the column.
  if (file.endsWith('db/client.ts')) continue;
  const lines = readFileSync(file, 'utf8').split('\n');

  lines.forEach((line, i) => {
    if (!/FROM\s+products\b/i.test(line) && !/JOIN\s+products\b/i.test(line)) return;
    // Read a window, because these queries are template literals spanning lines.
    const window = lines.slice(Math.max(0, i - 6), Math.min(lines.length, i + 12)).join('\n');
    if (/realCompany\(|referenceCompany\(|reality\s*=/.test(window)) return;
    if (boundToOneCompany(window)) return;
    offenders.push(file);
  });
}

// COUNTED PER FILE, NOT PER LINE. A baseline keyed to line numbers churns on
// every edit above it and reports moved code as a new offence — which is
// exactly what happened the first time this ran, and what makes a gate get
// baselined into silence. A file with two unscoped queries is what it is
// wherever they sit in it.
const perFile = new Map();
for (const f of offenders) perFile.set(f, (perFile.get(f) ?? 0) + 1);
const found = [...perFile.entries()].sort().map(([f, n]) => `${f} ${n}`);
const baseline = existsSync(BASELINE)
  ? readFileSync(BASELINE, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
  : [];

if (WRITE) {
  writeFileSync(BASELINE, found.join('\n') + '\n');
  console.log(`wrote ${found.length} unscoped product queries`);
  process.exit(0);
}

const known = new Map(baseline.map((l) => {
  const at = l.lastIndexOf(' ');
  return [l.slice(0, at), Number(l.slice(at + 1))];
}));
const isNew = [...perFile.entries()]
  .filter(([f, n]) => n > (known.get(f) ?? 0))
  .map(([f, n]) => `${f} — ${n} unscoped, baseline ${known.get(f) ?? 0}`);

if (isNew.length) {
  console.log('\nNew queries over `products` that do not apply the reality boundary:\n');
  for (const o of isNew) console.log(`  ${o}`);
  console.log(`
A reference company is synthetic and must never reach owner truth. If this query
feeds anything the OWNER reads as his — his companies, his economics, a
benchmark, a track record — or anything that spends money or contacts a person,
apply \`realCompany(alias)\` from src/db/client.ts.

If it drives WORK rather than an answer (a job work-list, a routine that should
exercise the reference company too), that is correct as written: add it to the
baseline with --write and say in a comment above the query why it is safe.
`);
  process.exit(1);
}

const total = [...perFile.values()].reduce((a, b) => a + b, 0);
console.log(`✓ reality boundary: ${total} unscoped product queries across `
  + `${String(perFile.size)} files (baseline ${baseline.length}), 0 new`);
