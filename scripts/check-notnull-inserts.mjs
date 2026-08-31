#!/usr/bin/env node
// =============================================================================
// FOUNDRY — an INSERT that omits a column the table will not accept as absent
//
// `check-insert-columns` proves every column an INSERT NAMES exists. It cannot
// see the opposite defect: a column the INSERT does NOT name, which the table
// declares NOT NULL with no default.
//
// The instance that prompted this: `board_packets.period_start` and
// `period_end` are NOT NULL with no default, and `generateBoardPacket` never
// supplied them — while computing both at the top of the same function. So
// every board packet the system has ever tried to generate raised at the last
// step, AFTER the AI call had already been made and paid for. The founder
// clicked Generate, money was spent, a narrative was written, the write threw,
// and nothing appeared.
//
// Like the CHECK-vocabulary gate, this is decidable without running anything:
// the migrations say which columns cannot be absent, and an INSERT either
// names them or does not.
//
// What it deliberately does not cover, rather than covering badly:
//   • INSERT … SELECT and INSERT with no column list — the columns are not
//     enumerated, so there is nothing to compare;
//   • a column list assembled by interpolation (`(${fields.join(', ')})`) —
//     the string in the file is not the string that runs;
//   • `schema_migrations`, which migrate.ts creates ITSELF at runtime before
//     any .sql file executes. Migration 004 declares a different shape for it
//     and has therefore always been a silent no-op; the schema this gate reads
//     is the one that never took effect, not the one the code writes to;
//   • columns with a DEFAULT, including CURRENT_TIMESTAMP — absent is fine;
//   • the primary key when it is INTEGER (SQLite fills a rowid alias);
//   • tables built inside tests, which the fabrication gate handles.
//
// Run: node scripts/check-notnull-inserts.mjs   (CI, beside lint:columns)
// =============================================================================
import { execSync } from 'child_process';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import { stripComments } from './lib/strip-comments.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DB = '/tmp/_notnull.db';

execSync(`rm -f ${DB}`);
for (const f of readdirSync(join(ROOT, 'src/db/migrations')).filter((f) => f.endsWith('.sql')).sort()) {
  try { execSync(`sqlite3 ${DB} < ${join(ROOT, 'src/db/migrations', f)} 2>/dev/null`); } catch { /* partial files expected */ }
}

/** table -> [columns that must be named]. Read from the LIVE schema, which is
 *  not always what the latest migration mentioning the table says. */
const required = new Map();
for (const { name } of JSON.parse(execSync(
  `sqlite3 -json ${DB} "SELECT name FROM sqlite_master WHERE type='table' AND sql IS NOT NULL"`,
).toString())) {
  const info = JSON.parse(execSync(
    `sqlite3 -json ${DB} "SELECT name, type, [notnull], dflt_value, pk FROM pragma_table_info('${name}')"`,
  ).toString());
  const must = info
    .filter((c) => Number(c.notnull) === 1 && c.dflt_value === null)
    // An INTEGER PRIMARY KEY is the rowid; SQLite supplies it.
    .filter((c) => !(Number(c.pk) === 1 && String(c.type).toUpperCase() === 'INTEGER'))
    .map((c) => c.name.toLowerCase());
  if (must.length) required.set(name.toLowerCase(), must);
}
execSync(`rm -f ${DB}`);

function tsFiles(dir) {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const offenders = [];
const at = (src, index) => src.slice(0, index).split('\n').length;

for (const file of tsFiles(join(ROOT, 'src'))) {
  // Comments describe the defect; they are not the defect.
  const src = stripComments(readFileSync(file, 'utf8'), { lineComments: false })
    .split('\n').map((l) => l.replace(/^(\s*)\/\/.*$/, '$1')).join('\n');
  const rel = relative(ROOT, file);

  for (const m of src.matchAll(
    /INSERT(?:\s+OR\s+\w+)?\s+INTO\s+(\w+)\s*\(([^)]*)\)/gi)) {
    const table = m[1].toLowerCase();
    if (table === 'schema_migrations') continue;      // see the header
    const must = required.get(table);
    if (!must) continue;
    if (m[2].includes('${')) continue;                 // built at runtime
    const named = new Set(m[2].split(',').map((c) => c.trim().replace(/["'`]/g, '').toLowerCase()));
    const missing = must.filter((c) => !named.has(c));
    if (missing.length) {
      offenders.push(`${rel}:${at(src, m.index)} → ${table} omits ${missing.join(', ')}`);
    }
  }
}

// A generic builder assembles its column list at runtime, so the literal here
// is not the literal that runs. Those are marked where they are taken.
const allowed = new Set();
for (const file of tsFiles(join(ROOT, 'src'))) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (!/notnull-insert:runtime-columns/.test(line)) return;
    for (let ahead = 1; ahead <= 4; ahead++) allowed.add(`${relative(ROOT, file)}:${i + 1 + ahead}`);
  });
}

const real = [...new Set(offenders)].filter((o) => !allowed.has(o.split(' → ')[0]));

if (real.length) {
  console.error('An INSERT omits a column the table will not accept as absent.');
  console.error('This raises the moment it runs:\n');
  for (const o of real) console.error('  ' + o);
  console.error('\nIf the column list is assembled at runtime, put');
  console.error('`notnull-insert:runtime-columns` in a comment on the line above.');
  process.exit(1);
}
console.log(`✓ every enumerated INSERT names the columns its table requires (${required.size} tables)`);
