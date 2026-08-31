#!/usr/bin/env node
// =============================================================================
// FOUNDRY — a table no code can reach at all
//
// The third side of a triangle whose other two sides already exist.
// `check-writerless-tables` takes the tables live code READS and asks what
// writes them. `check-unread-tables` takes the tables live code WRITES and asks
// what reads them. Each gate's population is defined by the half it starts
// from, so A TABLE THAT IS NEITHER READ NOR WRITTEN IS IN NEITHER POPULATION.
// It is not passed; it is never considered.
//
// Thirteen tables were in that position: `autopilot_config` beside a live
// `autopilot_policies` with eight writers, `outbound_webhooks` beside live
// `webhooks` and `product_webhooks`, `strategic_plans` beside live
// `strategic_syntheses`. The pattern is a superseded store left in the schema
// after its successor arrived — one concept with two stores, where the
// disagreement never surfaced only because one of the two was always empty.
//
// A dead table is not free. It is schema surface that has to be migrated,
// classified for erasure, and reasoned about; and its NAME is a claim. Migration
// 007's `audit_trail` carried the header "Every mutation in the system should be
// traceable to a person or job" and had never held a row. An empty table named
// for a control is a claim of a control, which is the one thing this
// institution may not make.
//
// WHAT COUNTS AS A REFERENCE, matching the sibling gates exactly so the three
// agree about what "reached" means:
//   • Any SQL statement in `src/` naming the table — INSERT, UPDATE, DELETE,
//     FROM, or JOIN.
//   • A SQL TRIGGER body naming it. A table consumed entirely by triggers is
//     used; it is simply not used from TypeScript.
//   • An entry in the erasure map in `privacy/consent.ts`, whose dynamic
//     `SELECT * FROM ${table}` no static scan can attribute. Only the
//     object-valued entries count. A table listed as NOT company data is being
//     excluded from a sweep, not read by one.
//   • A FOREIGN KEY HELD BY A TABLE THAT STAYS. This one was learned the
//     expensive way. Migration 215 dropped eleven tables this gate had listed,
//     and fifty test files went red on
//     `no such table: main.agent_message_threads` — because
//     `agent_messages.thread_id REFERENCES agent_message_threads(id)`, and with
//     `foreign_keys = 1` SQLite resolves that on every DELETE against the
//     child. The erasure path could not complete. `experiments.holdout_id`
//     was the same. A table nothing in TypeScript names is still reached by the
//     database itself on every write to whatever points at it, so it is not a
//     table nobody can touch — and calling it one is how a working schema gets
//     broken by a cleanup.
//
//     The reference has to SURVIVE to count: a column dropped by a later
//     `ALTER TABLE ... DROP COLUMN`, or one on a table since dropped, points at
//     nothing. Migration 216 removed both dangling columns, which is why this
//     rule changes no current finding — it changes what a future one can be.
//
// TABLE REBUILDS ARE FOLLOWED THROUGH THEIR RENAME. SQLite cannot alter a
// constraint in place, so a rebuild is CREATE x_new, copy, DROP x, RENAME x_new
// TO x. Reading only CREATE and DROP leaves twelve phantom `_new` tables that
// were never dropped because they were renamed.
//
// SQL comments are stripped first. Migration 007's own prose quotes "CREATE
// TABLE IF NOT EXISTS" while explaining why an earlier migration was a no-op,
// and a scanner reading raw SQL takes IF for a table name.
//
// The baseline may only SHRINK. Removing a table from it means the table is
// gone or reached, not that it was forgiven.
// =============================================================================
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from './lib/strip-comments.mjs';

const MIGRATIONS = 'src/db/migrations';
const BASELINE = 'docs/db/unreferenced-tables-baseline.txt';

function walk(dir) {
  let out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (entry.endsWith('.ts')) out.push(p);
  }
  return out;
}

const stripSqlComments = (sql) => sql.replace(/--[^\n]*/g, '');

const tables = new Set();
const migrationFiles = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
let migrationSql = '';
for (const file of migrationFiles) {
  const sql = stripSqlComments(readFileSync(join(MIGRATIONS, file), 'utf8'));
  migrationSql += `\n${sql}`;
  for (const m of sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)/gi)) tables.add(m[1]);
  for (const m of sql.matchAll(/DROP TABLE\s+(?:IF EXISTS\s+)?(\w+)/gi)) tables.delete(m[1]);
  // SQLite cannot alter a constraint in place, so a rebuild is CREATE x_new,
  // copy, DROP x, RENAME x_new TO x. Without this the intermediate looks like a
  // table that was created and never dropped -- twelve of them on the first run.
  for (const m of sql.matchAll(/ALTER TABLE\s+(\w+)\s+RENAME\s+TO\s+(\w+)/gi)) {
    tables.delete(m[1]);
    tables.add(m[2]);
  }
}

// ─── Foreign keys that still point somewhere ─────────────────────────────────
//
// A parent counts only when the (table, column) holding the reference is still
// there: the referencing table survives, and the column was not dropped later.
const droppedColumns = new Set();
for (const m of migrationSql.matchAll(/ALTER TABLE\s+(\w+)\s+DROP COLUMN\s+(\w+)/gi)) {
  droppedColumns.add(`${m[1].toLowerCase()}.${m[2].toLowerCase()}`);
}
const fkParents = new Set();
const noteFk = (child, column, parent) => {
  if (!tables.has(child)) return;
  if (droppedColumns.has(`${child.toLowerCase()}.${column.toLowerCase()}`)) return;
  fkParents.add(parent);
};
for (const m of migrationSql.matchAll(
  /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\n\s*\);/gi)) {
  const child = m[1];
  for (const line of m[2].split('\n')) {
    const col = /^\s*(\w+)\s+[^,]*?REFERENCES\s+(\w+)/i.exec(line);
    if (col) noteFk(child, col[1], col[2]);
  }
}
for (const m of migrationSql.matchAll(
  /ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)[^;]*?REFERENCES\s+(\w+)/gi)) {
  noteFk(m[1], m[2], m[3]);
}

const triggerBodies = (migrationSql.match(/CREATE TRIGGER[\s\S]*?END;/gi) ?? []).join('\n');
const consent = readFileSync('src/services/privacy/consent.ts', 'utf8');
const src = walk('src')
  .map((f) => stripComments(readFileSync(f, 'utf8'), { lineComments: true })).join('\n');

const findings = [];
for (const table of [...tables].sort()) {
  const named = new RegExp(
    `(INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO|UPDATE|DELETE\\s+FROM|FROM|JOIN)\\s+${table}\\b`,
    'i').test(src);
  if (named) continue;
  if (new RegExp(`\\b${table}\\b`).test(triggerBodies)) continue;
  if (fkParents.has(table)) continue;
  if (new RegExp(`^\\s*${table}:\\s*\\{`, 'm').test(consent)) continue;
  findings.push(table);
}

let baseline = [];
try {
  baseline = readFileSync(BASELINE, 'utf8').trim().split('\n').filter(Boolean);
} catch { /* first run */ }

if (process.argv.includes('--write')) {
  writeFileSync(BASELINE, `${findings.join('\n')}\n`);
  console.log(`unreferenced tables baseline written: ${findings.length}`);
  process.exit(0);
}

const known = new Set(baseline);
const appeared = findings.filter((t) => !known.has(t));
const fixed = baseline.filter((t) => !findings.includes(t));

if (appeared.length) {
  console.error('✗ tables no code can reach, in either direction:\n');
  for (const t of appeared) console.error(`  ${t}`);
  console.error('\nNeither of the other two table gates can see this: each starts');
  console.error('from a half this table does not have. Either reach it, or drop it.');
  console.error('A table nobody can touch is still schema to migrate, still an');
  console.error('erasure question to answer, and its name is still a claim.');
  process.exit(1);
}
if (fixed.length) {
  console.error(`✓ ${fixed.length} table(s) are no longer unreferenced: ${fixed.join(', ')}`);
  console.error(`Remove them from ${BASELINE} with --write so they cannot come back.`);
  process.exit(1);
}
console.log(`✓ unreferenced tables: ${findings.length} (baseline ${baseline.length}), `
  + `${tables.size} tables checked`);
