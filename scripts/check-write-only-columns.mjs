#!/usr/bin/env node
// =============================================================================
// FOUNDRY — columns the system writes and never reads
//
// `check-writerless-tables.mjs` holds one half of this defect: a table nothing
// fills, read by a surface that therefore shows permanent emptiness. This is
// the other half, and it was found by hand twice before anything looked for it.
//
// `learned_claim_id` is written on four tables. Every one of those writes
// records what Foundry learned — whether a change it made to the founder's
// systems held up, whether a judgment it made about the company was borne out —
// and nothing read any of them. Foundry was paying to think and then filing the
// thought somewhere it never looked. Two of the four now have readers, and both
// turned into something the founder can see.
//
// A write-only column is not automatically a defect: provenance is a real
// reason to record something no code consumes, and `autonomy_consents.from_mode`
// or a rollback digest are honest examples. But it is always a QUESTION, and
// the answer should be written down rather than assumed. So this is a RATCHET
// on the count, not a wall.
//
// WHAT IT CAN AND CANNOT SEE, stated because a gate that overstates its
// coverage is the defect it exists to catch:
//   • A column is WRITTEN if it appears in an `INSERT INTO <table> (...)` list
//     or an `UPDATE <table> SET ...` clause in `src/`. `INSERT OR IGNORE` and
//     `INSERT OR REPLACE` count — the first version of this gate missed both,
//     so every column written only through a conflict-handling insert was
//     invisible to it and could never be reported.
//   • WRITTEN means "there is code that writes it", not "that code runs".
//     `signal_events.processing_session_id` is on the list and is in fact
//     written by a branch nothing can reach, so it is never written at all.
//     That is a different defect wearing the same face, and
//     `check-reachability.mjs` is the instrument for it. Neither gate should
//     grow the other'"'"'s job; when an entry looks odd, ask both.
//   • A column is READ if its name appears anywhere in `src/` outside every
//     such write context, comments stripped.
//   • It therefore MISSES a read that never names the column — `SELECT *`
//     followed by generic row iteration. That is a false positive in the
//     direction of asking a question, which is the safe direction.
//   • It ignores `tests/` on purpose. A test reading a column is not the
//     product consuming it, and counting it would hide exactly the defect this
//     is for.
//   • It ignores DATABASE TRIGGERS, and that is a distinction rather than an
//     omission. Migration 111 reads `learned_claim_id` to refuse a reference to
//     a claim that does not exist — which makes the column VALIDATED, not
//     consumed. A trigger checking that what you recorded is well-formed is not
//     anything reading what you recorded. That was true of all four
//     `learned_claim_id` columns, and the learning still went nowhere.
//
// Run: node scripts/check-write-only-columns.mjs [--write]
// =============================================================================
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, relative, resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const MIGRATIONS = join(ROOT, 'src/db/migrations');
const SRC = join(ROOT, 'src');
const BASELINE = join(ROOT, 'docs/db/write-only-columns-baseline.txt');

const COLUMN_TYPE = /^(\w+)\s+(TEXT|INTEGER|REAL|DATETIME|BLOB|NUMERIC|BOOLEAN)\b/i;

/** Split a CREATE TABLE body on the commas that separate definitions — not the
 *  ones inside `CHECK (x IN ('a','b'))` or `REFERENCES t(id)`. Splitting on
 *  every comma is what makes a naive parser lose half a table. */
function definitions(body) {
  const out = [];
  let depth = 0, current = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(current); current = ''; continue; }
    current += ch;
  }
  out.push(current);
  return out.map((d) => d.trim()).filter(Boolean);
}

/** Effective schema: every CREATE TABLE and ALTER TABLE ADD COLUMN in order,
 *  honouring DROP TABLE in later migrations. */
function schema() {
  const tables = new Map();
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8').replace(/--[^\n]*/g, '');
    for (const m of sql.matchAll(/DROP TABLE\s+(?:IF EXISTS\s+)?(\w+)/gi)) tables.delete(m[1]);
    for (const m of sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\n\s*\);/gi)) {
      if (!tables.has(m[1])) tables.set(m[1], new Set());
      for (const definition of definitions(m[2])) {
        const column = COLUMN_TYPE.exec(definition);
        if (column) tables.get(m[1]).add(column[1]);
      }
    }
    for (const m of sql.matchAll(/ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)/gi)) {
      if (tables.has(m[1])) tables.get(m[1]).add(m[2]);
    }
  }
  return tables;
}

function sourceFiles(dir = SRC, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}

const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((line) => line.replace(/^\s*\/\/.*$/, '')).join('\n');

const code = stripComments(sourceFiles().map((f) => readFileSync(f, 'utf8')).join('\n'));
const tables = schema();

// Every write context, per table — and one copy of the code with all of them
// blanked out, which is everywhere a column could be read from.
const writeContexts = new Map();
let readable = code;
for (const table of tables.keys()) {
  const contexts = [];
  for (const pattern of [
    new RegExp(`INSERT\\s+(?:OR\\s+(?:IGNORE|REPLACE|ABORT|FAIL|ROLLBACK)\\s+)?INTO\\s+${table}\\s*\\(([^)]*)\\)`, 'gi'),
    new RegExp(`UPDATE\\s+${table}\\s+SET([\\s\\S]{0,600}?)(?=WHERE|\`)`, 'gi'),
  ]) for (const m of code.matchAll(pattern)) contexts.push(m[1]);
  if (contexts.length) writeContexts.set(table, contexts);
}
for (const contexts of writeContexts.values()) {
  for (const context of contexts) readable = readable.split(context).join(' ');
}

const writeOnly = [];
for (const [table, contexts] of writeContexts) {
  for (const column of tables.get(table) ?? []) {
    const written = contexts.some((c) => new RegExp(`\\b${column}\\b`).test(c));
    if (!written) continue;
    if (!new RegExp(`\\b${column}\\b`).test(readable)) writeOnly.push(`${table}.${column}`);
  }
}
writeOnly.sort();

if (process.argv.includes('--write')) {
  writeFileSync(BASELINE, writeOnly.join('\n') + '\n');
  console.log(`wrote ${writeOnly.length} write-only columns`);
  process.exit(0);
}

let baseline = [];
try {
  baseline = readFileSync(BASELINE, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
} catch {
  console.error(`Missing baseline ${relative(ROOT, BASELINE)}. Run with --write to create it.`);
  process.exit(1);
}

const added = writeOnly.filter((c) => !baseline.includes(c));
if (added.length > 0) {
  console.error(
    '\nColumns this system writes and never reads:\n\n'
    + added.map((c) => `  ${c}`).join('\n')
    + '\n\nEither give it a reader, or delete it. If it is provenance — recorded\n'
    + 'for a person or an audit rather than for code — say so where it is\n'
    + 'written and add it to the baseline deliberately.\n\n'
    + 'Two things that are NOT readers, before you conclude it has one:\n'
    + '  • a database trigger validating the column checks that what you wrote\n'
    + '    is well-formed; it does not consume what you wrote.\n'
    + '  • a test asserting the column is not the product using it.\n\n'
    + 'A read this cannot see is a `SELECT *` with generic row iteration; name\n'
    + 'the column somewhere and it will be found.\n');
  process.exit(1);
}

const resolved = baseline.filter((c) => !writeOnly.includes(c));
if (resolved.length > 0) {
  console.error(
    `\n${resolved.length} column(s) are no longer write-only. Remove them from the\n`
    + 'baseline with --write so they cannot come back:\n\n'
    + resolved.map((c) => `  ${c}`).join('\n') + '\n');
  process.exit(1);
}

console.log(`✓ write-only columns: ${writeOnly.length} (baseline ${baseline.length})`);
