#!/usr/bin/env node
// =============================================================================
// FOUNDRY — a table something writes and nothing reads
//
// The mirror of `check-writerless-tables.mjs`, and the cheaper half of the same
// defect: a rule with nothing on one side of it. There, live code SELECTed from
// a table nothing filled. Here, live code FILLS a table nothing SELECTs from —
// work done every day, an erasure obligation carried, schema surface
// maintained, for a record nobody ever looks at.
//
// It exists because of `founder_focus_settings`, which the column-level probe
// found only obliquely. That table held six controls over how Foundry paces
// itself for a founder, had no writer at all, and a nightly job clearing
// expired values nobody could set. The sibling case was removed in migration
// 157 and this one was left standing beside the comment explaining why it
// should not be. A table-level check would have caught it the day it stopped
// being reached.
//
// WHAT COUNTS AS A READ, and why the exclusions are not softening:
//   • `SELECT ... FROM <table>` in `src/` — the ordinary case.
//   • A SQL TRIGGER body naming the table. `ai_spend_reservations` is consumed
//     entirely by migration 099's triggers, which roll `actual_cents` into
//     `ai_daily_spend`. That is a real reader; it is simply not TypeScript.
//   • The erasure/export map in `privacy/consent.ts`. Tables listed there are
//     read by `exportFounderData`'s dynamic `SELECT * FROM ${table}`, which no
//     static scan can attribute. `gate_events` and `referral_conversions` reach
//     a person that way.
//
// A table that is written, never read, and reachable by none of those is on the
// baseline with the rest. The baseline may only SHRINK.
// =============================================================================
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from './lib/strip-comments.mjs';

const MIGRATIONS = 'src/db/migrations';
const BASELINE = 'docs/db/unread-tables-baseline.txt';

function walk(dir) {
  let out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (entry.endsWith('.ts')) out.push(p);
  }
  return out;
}

// ─── The schema, honouring later DROP TABLE ──────────────────────────────────
//
// SQL COMMENTS ARE STRIPPED FIRST, and that is not tidiness. Migration 007's
// prose quotes the phrase "CREATE TABLE IF NOT EXISTS" inside backticks while
// explaining why an earlier migration was a no-op, and a scanner reading raw
// SQL takes `IF` for a table name. `check-write-only-columns.mjs` strips them
// for the same reason. Trigger bodies are read from the stripped text too: a
// table named only in a trigger's COMMENT is not a reader of it.
const stripSqlComments = (sql) => sql.replace(/--[^\n]*/g, '');

const tables = new Set();
const migrationFiles = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
let migrationSql = '';
for (const file of migrationFiles) {
  const sql = stripSqlComments(readFileSync(join(MIGRATIONS, file), 'utf8'));
  migrationSql += `\n${sql}`;
  for (const m of sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)/gi)) tables.add(m[1]);
  for (const m of sql.matchAll(/DROP TABLE\s+(?:IF EXISTS\s+)?(\w+)/gi)) tables.delete(m[1]);
}

const triggerBodies = (migrationSql.match(/CREATE TRIGGER[\s\S]*?END;/gi) ?? []).join('\n');
const consent = readFileSync('src/services/privacy/consent.ts', 'utf8');
const src = walk('src')
  .map((f) => stripComments(readFileSync(f, 'utf8'), { lineComments: true })).join('\n');

const findings = [];
let written = 0;
for (const table of [...tables].sort()) {
  const isWritten = new RegExp(
    `(INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO|UPDATE)\\s+${table}\\b`, 'i').test(src);
  if (!isWritten) continue;           // writerless tables are the other gate's job
  written++;

  if (new RegExp(`FROM\\s+${table}\\b`, 'i').test(src)) continue;
  if (new RegExp(`\\b${table}\\b`).test(triggerBodies)) continue;
  if (new RegExp(`^\\s*${table}:\\s*\\{`, 'm').test(consent)) continue;

  findings.push(table);
}

let baseline = [];
try {
  baseline = readFileSync(BASELINE, 'utf8').trim().split('\n').filter(Boolean);
} catch { /* first run */ }

if (process.argv.includes('--write')) {
  writeFileSync(BASELINE, `${findings.join('\n')}\n`);
  console.log(`unread tables baseline written: ${findings.length}`);
  process.exit(0);
}

const known = new Set(baseline);
const appeared = findings.filter((t) => !known.has(t));
const fixed = baseline.filter((t) => !findings.includes(t));

if (appeared.length) {
  console.error('✗ tables that something writes and nothing reads:\n');
  for (const t of appeared) console.error(`  ${t}`);
  console.error('\nEither read it where the record was meant to be used, or stop');
  console.error('writing it. A table nobody reads still costs a write on every');
  console.error('path that fills it, an erasure obligation, and schema surface.');
  process.exit(1);
}
if (fixed.length) {
  console.error(`✓ ${fixed.length} table(s) are no longer unread: ${fixed.join(', ')}`);
  console.error(`Remove them from ${BASELINE} with --write so they cannot come back.`);
  process.exit(1);
}
console.log(`✓ unread tables: ${findings.length} (baseline ${baseline.length}), `
  + `${written} written tables checked`);
