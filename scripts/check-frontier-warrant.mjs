#!/usr/bin/env node
// =============================================================================
// FOUNDRY — the most expensive model may not be reached without an argument
//
// `callOpus` is the only door to the frontier model in this repository, and it
// costs five times the operational model and twenty-five times the cheap one.
// Nothing stopped a new call site appearing beside an old one, and nothing
// asked the author to say why.
//
// This is not a ratchet with a baseline file. It is a table a person wrote,
// `src/lib/frontier-warrant.ts`, with one entry per file that reaches the
// frontier, how many times it does, the question it asks, and the argument for
// paying frontier prices to answer it. This script checks the table against
// the code in both directions:
//
//   a file that reaches the frontier with no entry            fails
//   a file whose call sites outnumber its entry               fails
//   an entry for a file that no longer reaches the frontier   fails
//   an entry whose warrant is empty or nearly so              fails
//
// The last one matters most. A gate that accepts any string as a reason is a
// gate that teaches people to write "needed for quality", and this one exists
// precisely because that sentence is not an argument.
// =============================================================================

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

/** The only file allowed to define the door rather than walk through it. */
const THE_DOOR = 'src/services/ai/client.ts';

/** A warrant shorter than this is not an argument. */
const MIN_WARRANT_CHARS = 80;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

// ─── what the code does ──────────────────────────────────────────────────────

const found = new Map();
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  if (rel === THE_DOOR) continue;
  const text = readFileSync(file, 'utf8');
  // Call sites only: `await callOpus(` and `callOpus(`, never the import line
  // and never the word inside a comment, which is how this file talks about it.
  const sites = [...text.matchAll(/(?<![A-Za-z0-9_.])callOpus\s*\(/g)].length;
  if (sites > 0) found.set(rel, sites);
}

// ─── what the table claims ───────────────────────────────────────────────────

const table = readFileSync(join(SRC, 'lib/frontier-warrant.ts'), 'utf8');
const entries = [];
for (const block of table.split(/\n\s*\{\s*\n/).slice(1)) {
  const file = /file:\s*'([^']+)'/.exec(block)?.[1];
  const sites = /sites:\s*(\d+)/.exec(block)?.[1];
  if (!file || !sites) continue;
  // The warrant runs from `warrant:` to the next field or the end of the entry,
  // across the string concatenations it is written with.
  const warrant = /warrant:\s*([\s\S]*?)(?:\n\s*(?:watched|file|sites|question):|\n\s*\},)/.exec(block)?.[1] ?? '';
  entries.push({ file, sites: Number(sites), warrant: warrant.replace(/['+\s]/g, ' ').trim() });
}

// ─── the four ways this fails ────────────────────────────────────────────────

const problems = [];

for (const [file, sites] of found) {
  const entry = entries.find((e) => e.file === file);
  if (!entry) {
    problems.push(`${file} reaches the frontier model ${sites} time(s) and has no entry in `
      + `src/lib/frontier-warrant.ts. Add one saying what is asked and why it is worth `
      + `frontier prices — being wrong must be expensive AND the occasion must be rare.`);
    continue;
  }
  if (entry.sites !== sites) {
    problems.push(`${file} reaches the frontier model ${sites} time(s); its warrant claims `
      + `${entry.sites}. Either the new call site has an argument of its own — write it — or `
      + `it should not be at the frontier.`);
  }
}

for (const entry of entries) {
  if (!found.has(entry.file)) {
    problems.push(`src/lib/frontier-warrant.ts carries a warrant for ${entry.file}, which no `
      + `longer reaches the frontier model. Remove the entry: a table describing code that is `
      + `not there is a sentence nobody rereads.`);
    continue;
  }
  if (entry.warrant.length < MIN_WARRANT_CHARS) {
    problems.push(`the warrant for ${entry.file} is ${entry.warrant.length} characters. That is `
      + `not an argument. Say what would go wrong if the answer were wrong, and how often it is `
      + `asked.`);
  }
}

if (problems.length > 0) {
  console.error('✗ frontier model reached without an argument\n');
  for (const p of problems) console.error(`  - ${p}\n`);
  process.exit(1);
}

const watched = (table.match(/watched:\s*true/g) ?? []).length;
console.log(`✓ ${found.size} file(s) reach the frontier model, every one with a written warrant`
  + `${watched > 0 ? ` (${watched} marked watched)` : ''}`);
