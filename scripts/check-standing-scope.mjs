#!/usr/bin/env node
// =============================================================================
// FOUNDRY — the existence boundary, enforced as a gate
//
// Migration 276 gave every economic asset a `standing`: 'experimental' while it
// is a test object with an identity and a budget, 'earned' once real economic
// evidence has recognised it as a real economic asset. `operatingProduct()` in
// src/db/client.ts folds the axis into the canonical predicate, and the
// database refuses the writes that would make a test object behave like an
// operating company — agents, ordinary model spend, situations, concentrations,
// responsibilities, delegations.
//
// SELECTs cannot be refused by a trigger, and a SELECT is how a test object
// becomes "one of your companies" on a page, in a count, in a roll-up. So this
// counts them, in exactly the shape of `check-reality-scope.mjs`: every query
// over `products` that does NOT bind a single company by id and does NOT
// mention the canonical predicate or the `standing` column is an offender, and
// the count may only shrink.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It does not demand the clause everywhere.
// An ownership check ("does this decision belong to the founder") is correctly
// indifferent to standing; a route that resolves an asset by id already is. The
// baseline is the list of queries a person has read and judged, and it shrinks
// as they are reviewed. A NEW unscoped query fails the build with the file.
// =============================================================================

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { walk, boundToOneCompany } from './lib/product-queries.mjs';

const BASELINE = 'docs/db/standing-scope-baseline.txt';
const WRITE = process.argv.includes('--write');

const offenders = [];
for (const file of walk('src')) {
  // The definition itself, and the asset lifecycle that reads every standing.
  if (file.endsWith('db/client.ts')) continue;
  const lines = readFileSync(file, 'utf8').split('\n');

  lines.forEach((line, i) => {
    if (!/FROM\s+products\b/i.test(line) && !/JOIN\s+products\b/i.test(line)) return;
    const window = lines.slice(Math.max(0, i - 6), Math.min(lines.length, i + 12)).join('\n');
    // A CLAUSE, NOT A WORD. "standing" in a comment above the query used to
    // satisfy this; only a comparison on the column, a read of it, or the
    // canonical predicate counts.
    if (/operatingProduct\(|\bstanding\s*(=|<>|!=|IS\b|IN\b|NOT\b)|\.standing\b|\bstanding,|,\s*standing\b|\bstanding\s+AS\b/i.test(window)) return;
    if (boundToOneCompany(window)) return;
    offenders.push(file);
  });
}

// PER FILE, NOT PER LINE, for the reason the reality gate gives: a baseline
// keyed to line numbers churns on every edit above it.
const perFile = new Map();
for (const f of offenders) perFile.set(f, (perFile.get(f) ?? 0) + 1);
const found = [...perFile.entries()].sort().map(([f, n]) => `${f} ${n}`);
const baseline = existsSync(BASELINE)
  ? readFileSync(BASELINE, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
  : [];

if (WRITE) {
  writeFileSync(BASELINE, found.join('\n') + '\n');
  console.log(`wrote ${found.length} product queries that do not read standing`);
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
  console.log('\nNew queries over `products` that do not honour the existence boundary:\n');
  for (const o of isNew) console.log(`  ${o}`);
  console.log(`
An EXPERIMENTAL asset is a test object, not an operating company. If this query
feeds a count of his companies, a roll-up of what they earn, a work-list, a
situation, a concentration, or anything that spends or acts, use
\`operatingProduct(alias)\` from src/db/client.ts or say \`standing = 'earned'\`.

If it is an ownership check, resolves a thing by id, or is a surface that should
show the experimental frontier AS the frontier, add it to the baseline with
--write and say in a comment above the query why standing does not apply.
`);
  process.exit(1);
}

const total = [...perFile.values()].reduce((a, b) => a + b, 0);
console.log(`✓ existence boundary: ${total} product queries not reading standing across `
  + `${String(perFile.size)} files (baseline ${baseline.length}), 0 new`);
