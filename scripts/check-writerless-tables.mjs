#!/usr/bin/env node
// =============================================================================
// FOUNDRY — a table something reads and nothing writes
//
// The characteristic defect of this codebase is not a broken rule. It is a rule
// with nothing on one side of it — and the cheapest version to detect is a
// TABLE that live code SELECTs from and that no INSERT anywhere fills.
//
// Eight of them existed when this check was written, and none was harmless:
//
//   agent_decisions      the /agents/inbox Decisions tab, a documented public
//                        endpoint returning {"data": []} forever, and the
//                        investor board packet's "Key Decisions This Quarter"
//   deletion_requests    a second Article 17 erasure that deletes ~25 tables of
//                        ~266 and then writes status='completed'
//   data_export_requests a second Article 20 export beside the working one
//   cofounder_profiles   made every founder read as SOLO, so the product told
//                        founders with co-founders they were building alone
//   customer_notes       a public API field that could only ever be empty
//   chat_webhooks        a delivery channel nothing could configure
//   decision_snooze_log  a nightly sweep of an always-empty table
//   daily_actions        a trust score for a module with no importers
//   ai_usage_log         an operating-margin figure whose only rows came from
//                        the test asserting it
//
// Baseline zero. Unlike the column-level version of this probe — which returns
// two dozen false positives from runtime-assembled column lists and from
// columns maintained by migration triggers — the table-level one is decidable:
// resolve table-name constants, count `buildInsert`, and read the migrations
// (including trigger bodies) as writers.
//
// A NEW UNWRITTEN TABLE IS USUALLY HALF A FEATURE. Adding the reading half
// first is a reasonable way to work; shipping it and stopping is what this
// catches.
//
// Run: node scripts/check-writerless-tables.mjs   (CI, beside lint:columns)
// =============================================================================
import { execSync } from 'child_process';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const DB = '/tmp/_writerless.db';
const MIGRATIONS = join(ROOT, 'src/db/migrations');

execSync(`rm -f ${DB}`);
const migrationFiles = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
for (const f of migrationFiles) {
  try { execSync(`sqlite3 ${DB} < ${join(MIGRATIONS, f)} 2>/dev/null`); } catch { /* partial files expected */ }
}
const tables = new Set(JSON.parse(execSync(
  `sqlite3 -json ${DB} "SELECT name FROM sqlite_master WHERE type='table' AND sql IS NOT NULL"`,
).toString()).map((r) => r.name.toLowerCase()));
execSync(`rm -f ${DB}`);

const migrationSql = migrationFiles.map((f) => readFileSync(join(MIGRATIONS, f), 'utf8')).join('\n');

function tsFiles(dir) {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}
/** Comments describe the defect; they are not the defect. */
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .split('\n').map((l) => l.replace(/^(\s*)\/\/.*$/, '$1')).join('\n');

const files = tsFiles(join(ROOT, 'src'));
const sources = new Map(files.map((f) => [f, strip(readFileSync(f, 'utf8'))]));

// `buildInsert(DECISION_PREMISES, …)` names its table through a constant.
const constants = new Map();
for (const s of sources.values()) {
  for (const m of s.matchAll(/export\s+const\s+([A-Z_][A-Z0-9_]*)\s*=\s*'(\w+)'/g)) {
    constants.set(m[1], m[2].toLowerCase());
  }
}

const written = new Set();
const readBy = new Map();

for (const [file, s] of sources) {
  const rel = relative(ROOT, file);
  for (const m of s.matchAll(/INSERT(?:\s+OR\s+\w+)?\s+INTO\s+(\w+)/gi)) written.add(m[1].toLowerCase());
  for (const m of s.matchAll(/buildInsert\(\s*'?(\w+)'?/g)) {
    written.add(constants.get(m[1]) ?? m[1].toLowerCase());
  }
  for (const m of s.matchAll(/(?:FROM|JOIN)\s+(\w+)/gi)) {
    const t = m[1].toLowerCase();
    if (!tables.has(t)) continue;
    if (!readBy.has(t)) readBy.set(t, new Set());
    readBy.get(t).add(rel);
  }
}
// A migration that seeds rows, or a trigger that inserts them, is a writer.
for (const m of migrationSql.matchAll(/INSERT(?:\s+OR\s+\w+)?\s+INTO\s+(\w+)/gi)) {
  written.add(m[1].toLowerCase());
}

const offenders = [...readBy.entries()]
  .filter(([t]) => !written.has(t))
  .map(([t, sites]) => `${t} — read by ${[...sites].sort().join(', ')}`)
  .sort();

if (offenders.length) {
  console.error('A table is read by live code and written by nothing:\n');
  for (const o of offenders) console.error('  ' + o);
  console.error('\nEither give it a writer, or remove the half that reads it. A surface');
  console.error('showing permanent emptiness is worse than an absent one — an integrator');
  console.error('builds against it, and a founder believes it.');
  process.exit(1);
}
console.log(`✓ every table live code reads has something that writes it (${tables.size} tables)`);
