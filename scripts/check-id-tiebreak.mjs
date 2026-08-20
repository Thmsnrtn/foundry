#!/usr/bin/env node
// =============================================================================
// AN ID IS NOT A CLOCK.
//
// Every id in this system is a nanoid or a content hash. Neither carries time,
// so ordering by one decides nothing — it shuffles. Where a query orders by
// something time-like and then falls back to `id`, every row sharing a
// timestamp is placed at random, and `created_at` is second-granular.
//
// That has produced three real defects in one campaign, in three modules that
// did not know about each other:
//
//   • `getReconstructionClaims` — which claim about a subject was current was
//     decided by claim id, so a correction could silently lose to the value it
//     was correcting.
//   • `getReplyProposalForMessage` — which reply was current was decided by the
//     proposal's CONTENT HASH, so a founder who rewrote a reply within a second
//     read whichever version hashed higher.
//   • `getSevenDayResponsibilitySummary` — which grant was the last one was
//     decided by consent id, so a founder who revoked a permission and
//     immediately restored it was told they had taken it away.
//
// `rowid` is the honest tiebreak: SQLite assigns it in insertion order, which
// is exactly the question these queries are asking.
//
// WHAT THIS CHECKS: an ORDER BY whose LAST term is `id` or `<alias>.id`. That
// is the position where a tiebreak lives.
//
// WHAT IT DOES NOT CHECK, and does not pretend to:
//   • Whether the tiebreak MATTERS. Ordering a list by id is merely arbitrary;
//     picking one winner by id is wrong. Telling those apart needs to know what
//     the caller does with the rows, so the baseline carries the existing ones
//     and this gate only refuses NEW ones.
//   • SQL assembled at runtime, or ordering done in JavaScript after the query.
//   • A table whose id genuinely is monotonic. There are none here today; if
//     one is introduced, say so at the query and add it to the baseline.
//
// Run: node scripts/check-id-tiebreak.mjs [--write]
// =============================================================================

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');
const BASELINE = join(ROOT, 'docs/db/id-tiebreak-baseline.txt');

function files(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files(path, out);
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}

const found = [];
for (const file of files(SRC)) {
  const source = readFileSync(file, 'utf8');
  // Comments are stripped so a note ABOUT this rule is never mistaken for it.
  const cleaned = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/\S/g, ' '))
    .split('\n').map((l) => (/^\s*(\/\/|--)/.test(l) ? '' : l)).join('\n');
  for (const match of cleaned.matchAll(/ORDER\s+BY\s+([\s\S]{0,200}?)(?=\bLIMIT\b|`|$)/gi)) {
    const terms = match[1].split(',').map((t) => t.trim()).filter(Boolean);
    if (!terms.length) continue;
    const last = terms[terms.length - 1];
    if (!/^(?:[a-z_][a-z0-9_]*\.)?id(?:\s+(?:ASC|DESC))?$/i.test(last)) continue;
    const line = cleaned.slice(0, match.index).split('\n').length;
    found.push(`${relative(ROOT, file)}:${line}`);
  }
}
found.sort();

if (process.argv.includes('--write')) {
  writeFileSync(BASELINE, found.join('\n') + '\n');
  console.log(`wrote ${found.length} id tiebreaks`);
  process.exit(0);
}

let baseline = [];
try {
  baseline = readFileSync(BASELINE, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
} catch {
  console.error(`Missing baseline ${relative(ROOT, BASELINE)}. Run with --write to create it.`);
  process.exit(1);
}

// Line numbers move when a file is edited, so a location already in the
// baseline is matched by FILE, up to the count that file had. A new tiebreak in
// an already-listed file is still caught; an unrelated edit above one is not.
const allowance = new Map();
for (const entry of baseline) {
  const file = entry.split(':')[0];
  allowance.set(file, (allowance.get(file) ?? 0) + 1);
}
const added = [];
for (const entry of found) {
  const file = entry.split(':')[0];
  const left = allowance.get(file) ?? 0;
  if (left > 0) allowance.set(file, left - 1);
  else added.push(entry);
}

if (added.length) {
  console.error(
    '\nORDER BY falling back to `id`, which is a nanoid or a content hash:\n\n'
    + added.map((c) => `  ${c}`).join('\n')
    + '\n\nAn id is not a clock. If this picks one winner, it picks at random\n'
    + 'whenever two rows share a timestamp. Use `rowid` — SQLite assigns it in\n'
    + 'insertion order, which is the question being asked.\n');
  process.exit(1);
}
console.log(`✓ no new id tiebreaks (${found.length} known, baseline ${baseline.length})`);
