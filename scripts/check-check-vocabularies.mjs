#!/usr/bin/env node
// =============================================================================
// FOUNDRY — literal values written to columns with a closed vocabulary
//
// Three defects of one shape turned up in a single stretch:
//
//   outbound_actions.status = 'refused'        — CHECK permits seven values,
//                                                not that one
//   push_log.status = 'not_configured'         — CHECK permits four, not that
//   board_packets.status = 'reviewed'          — the table was created by
//                                                migration 011 with
//                                                draft/finalized/shared;
//                                                migration 039's CREATE TABLE
//                                                IF NOT EXISTS redefined it as
//                                                draft/reviewed/published and
//                                                was a silent no-op, and the
//                                                code was written against the
//                                                version that never ran
//
// Every one of them raised at runtime. Every one was inside a try/catch that
// treated the failure as unremarkable, so what a founder saw was a button that
// did nothing, a receipt that never appeared, an action stuck at 'executing'.
// And the tests that should have caught them built their own tables with no
// CHECK on the column at all.
//
// A closed vocabulary is checkable without running anything: the migrations
// say what the values are, and a string literal assigned to that column either
// is one of them or is not. `check-select-columns` proves the COLUMN exists;
// this proves the VALUE is one the column will accept.
//
// What it deliberately does not cover, rather than covering badly:
//   • values built at runtime (`status = ?`, template interpolation) — the
//     string in the file is not the string that runs;
//   • CHECK expressions that are not a plain `col IN (...)` list.
//
// Run: node scripts/check-check-vocabularies.mjs   (CI, beside lint:columns)
// =============================================================================
import { execSync } from 'child_process';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const DB = '/tmp/_checkvocab.db';

execSync(`rm -f ${DB}`);
for (const f of readdirSync(join(ROOT, 'src/db/migrations')).filter((f) => f.endsWith('.sql')).sort()) {
  try { execSync(`sqlite3 ${DB} < ${join(ROOT, 'src/db/migrations', f)} 2>/dev/null`); } catch { /* partial files expected */ }
}

// The vocabularies as the LIVE schema has them — which is not always what the
// latest migration mentioning the table says, and that difference is the whole
// point of reading it from here.
const vocab = new Map();
for (const { name, sql } of JSON.parse(execSync(
  `sqlite3 -json ${DB} "SELECT name, sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL"`,
).toString())) {
  for (const m of sql.matchAll(/CHECK\s*\(\s*"?(\w+)"?\s+IN\s*\(([^)]*)\)/gi)) {
    const values = [...m[2].matchAll(/'([^']*)'/g)].map((v) => v[1]);
    if (values.length) vocab.set(`${name}.${m[1]}`, new Set(values));
  }
}

function tsFiles(dir) {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** Split a VALUES tuple on top-level commas, respecting quotes and nesting. */
function splitTuple(text) {
  const out = [];
  let depth = 0, cur = '', quote = null;
  for (const ch of text) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const offenders = [];
const at = (src, index) => src.slice(0, index).split('\n').length;

for (const dir of ['src', 'tests']) {
  for (const file of tsFiles(join(ROOT, dir))) {
    const src = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file);

    // UPDATE t SET col = 'literal'
    for (const m of src.matchAll(/UPDATE\s+(\w+)\s+SET\s+([\s\S]{0,600}?)(?:WHERE|`)/gi)) {
      for (const a of m[2].matchAll(/(\w+)\s*=\s*'([^']*)'/g)) {
        const key = `${m[1]}.${a[1]}`;
        const values = vocab.get(key);
        if (values && !values.has(a[2])) {
          offenders.push(`${rel}:${at(src, m.index)} → ${key} = '${a[2]}' (permitted: ${[...values].join(', ')})`);
        }
      }
    }

    // INSERT INTO t (cols) VALUES (literals)
    for (const m of src.matchAll(
      /INSERT(?:\s+OR\s+\w+)?\s+INTO\s+(\w+)\s*\(([^)]*)\)\s*VALUES\s*([\s\S]{0,1200}?)(?:`|ON\s+CONFLICT|;)/gi)) {
      const table = m[1];
      const cols = m[2].split(',').map((c) => c.trim().replace(/["'`]/g, ''));
      if (!cols.some((c) => vocab.has(`${table}.${c}`))) continue;
      for (const tuple of m[3].matchAll(/\(([^()]*)\)/g)) {
        const vals = splitTuple(tuple[1]);
        if (vals.length !== cols.length) continue;      // can't align; say nothing
        cols.forEach((col, i) => {
          const values = vocab.get(`${table}.${col}`);
          if (!values) return;
          const literal = vals[i].match(/^'([^']*)'$/);
          if (!literal) return;                          // runtime value
          if (!values.has(literal[1])) {
            offenders.push(`${rel}:${at(src, m.index)} → ${table}.${col} = '${literal[1]}' (permitted: ${[...values].join(', ')})`);
          }
        });
      }
    }
  }
}

// A test may deliberately write a value the schema refuses, to prove it is
// refused. Those say so on the line above, so the exception is visible where
// it is taken rather than in a list somewhere else.
const allowed = new Set();
for (const dir of ['src', 'tests']) {
  for (const file of tsFiles(join(ROOT, dir))) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!/check-vocabulary:expected-refusal/.test(line)) return;
      // The marker sits on a comment line; the statement it excuses starts on
      // the next line or shortly after, depending on how the call is wrapped.
      for (let ahead = 1; ahead <= 4; ahead++) {
        allowed.add(`${relative(ROOT, file)}:${i + 1 + ahead}`);
      }
    });
  }
}

const real = [...new Set(offenders)].filter((o) => !allowed.has(o.split(' → ')[0]));

if (real.length) {
  console.error('A literal value is written to a column whose CHECK does not permit it.');
  console.error('This raises the moment it runs:\n');
  for (const o of real) console.error('  ' + o);
  console.error('\nIf a test writes it on purpose to prove the refusal, put');
  console.error('`check-vocabulary:expected-refusal` in a comment on the line above.');
  process.exit(1);
}
console.log(`✓ every literal status value is one its column accepts (${vocab.size} vocabularies)`);
