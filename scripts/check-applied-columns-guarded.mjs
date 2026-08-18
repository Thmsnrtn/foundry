#!/usr/bin/env node
// =============================================================================
// FOUNDRY — a column a ledger applies, that anything can also write directly
//
// The institution's governed state lives in a two-table pattern: a LEDGER that
// records what happened, guarded on insert by everything that makes the record
// trustworthy, and an AFTER INSERT trigger that APPLIES the result to a column
// on the parent row. `responsibility_transitions` -> `state`,
// `responsibility_dispositions` -> `disposition`, and so on.
//
// The guards are all on the ledger. The applied column is a plain column, and
// until migrations 159 and 160 both of the responsibility ones could be written
// directly:
//
//   UPDATE institutional_responsibilities SET state = 'operating' WHERE id = ?
//
// which skipped one-rung-at-a-time, evidence, authority, shadow proof and the
// frozen boundary in a single statement, and left nothing behind to show it had
// happened. The constitutional invariant is "Foundry may not silently redefine
// what Foundry is allowed to do." A governed column writable without its ledger
// is precisely that.
//
// So: every column that an AFTER INSERT trigger applies must also be named by a
// BEFORE UPDATE trigger on the same table. This does not check that the guard is
// CORRECT — only tests can bind that — but the absence of one is decidable, and
// it is the shape both instances took.
//
// Run: node scripts/check-applied-columns-guarded.mjs   (CI, beside lint:columns)
// =============================================================================
import { execSync } from 'child_process';
import { readdirSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const DB = '/tmp/_applied.db';
const MIGRATIONS = join(ROOT, 'src/db/migrations');

execSync(`rm -f ${DB}`);
for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
  try { execSync(`sqlite3 ${DB} < ${join(MIGRATIONS, f)} 2>/dev/null`); } catch { /* partial files expected */ }
}
const triggers = JSON.parse(execSync(
  `sqlite3 -json ${DB} "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='trigger'"`,
).toString());
execSync(`rm -f ${DB}`);

/** table -> Set(columns named by some BEFORE UPDATE trigger on it) */
const guarded = new Map();
for (const t of triggers) {
  const m = t.sql.match(/BEFORE\s+UPDATE(?:\s+OF\s+([\s\S]*?))?\s+ON\s+["'`]?(\w+)["'`]?/i);
  if (!m) continue;
  const table = m[2].toLowerCase();
  if (!guarded.has(table)) guarded.set(table, new Set());
  if (!m[1]) {
    // `BEFORE UPDATE ON t` with no column list guards every column.
    guarded.get(table).add('*');
    continue;
  }
  for (const c of m[1].split(',')) guarded.get(table).add(c.trim().replace(/["'`]/g, '').toLowerCase());
}

/** Columns an AFTER INSERT trigger writes onto another table from NEW. */
const applied = [];
for (const t of triggers) {
  if (!/AFTER\s+INSERT/i.test(t.sql)) continue;
  for (const m of t.sql.matchAll(/UPDATE\s+["'`]?(\w+)["'`]?\s+SET\s+([\s\S]*?)(?:WHERE|;)/gi)) {
    const table = m[1].toLowerCase();
    // Only the parent — a trigger updating its own table is a different shape.
    if (table === String(t.tbl_name).toLowerCase()) continue;
    for (const assign of m[2].split(/,(?![^(]*\))/)) {
      const col = assign.split('=')[0].trim().replace(/["'`]/g, '').toLowerCase();
      if (!/^[a-z_][a-z0-9_]*$/.test(col)) continue;
      // Bookkeeping columns carry no governance and are updated by everything.
      if (['updated_at', 'created_at'].includes(col)) continue;
      applied.push({ trigger: t.name, table, col });
    }
  }
}

const offenders = [...new Set(applied
  .filter(({ table, col }) => {
    const g = guarded.get(table);
    return !g || (!g.has('*') && !g.has(col));
  })
  .map(({ trigger, table, col }) => `${table}.${col} — applied by ${trigger}, guarded by nothing`))]
  .sort();

if (offenders.length) {
  console.error('A ledger applies a column that anything can also write directly:\n');
  for (const o of offenders) console.error('  ' + o);
  console.error('\nAdd a BEFORE UPDATE OF <column> trigger requiring the ledger record that');
  console.error('justifies the value. Every guard on the ledger is worth nothing while the');
  console.error('column it protects can be set with a plain UPDATE.');
  process.exit(1);
}
console.log(`✓ every ledger-applied column has a guard on it (${applied.length} applied columns)`);
