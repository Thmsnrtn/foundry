#!/usr/bin/env node
// =============================================================================
// FOUNDRY — SELECT column drift (single-table queries)
//
// `check-insert-columns.mjs` and `check-sql-columns.mjs` close the write side:
// every INSERT column list and every UPDATE-SET column is verified against the
// real migrated schema. The drift findings doc records what those two
// deliberately left alone:
//
//   "What remains unswept: multi-table SELECT/JOIN column references (too
//    alias-ambiguous for a low-noise static check)"
//
// That reasoning is right about JOINs and wrong about the rest. A SELECT from
// ONE table has no alias ambiguity at all, and the public API was full of them:
// `agent_instances.is_active` (the column is `status`), `agent_messages.role`,
// `customer_intelligence.name`, `webhook_deliveries.event_type`. Every one
// throws at runtime, which on those routes means a 500 for every caller — the
// difference between an endpoint being MOUNTED and being LIVE.
//
// So this checks exactly the tractable case and skips the rest honestly:
//   • single-table SELECT only — anything with a JOIN or an alias is skipped;
//   • `SELECT *` is skipped, it names no columns;
//   • aliases introduced by `AS` are skipped, they are output names;
//   • SQL keywords and functions are skipped.
//
// Run: node scripts/check-select-columns.mjs   (CI, beside lint:columns)
// =============================================================================
import { execSync } from 'child_process';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const DB = '/tmp/_selcol.db';
execSync(`rm -f ${DB}`);
for (const f of readdirSync(join(ROOT, 'src/db/migrations')).filter((f) => f.endsWith('.sql')).sort()) {
  try { execSync(`sqlite3 ${DB} < ${join(ROOT, 'src/db/migrations', f)} 2>/dev/null`); } catch { /* partial files are expected */ }
}
const tables = new Map();
for (const line of execSync(`sqlite3 ${DB} "SELECT name FROM sqlite_master WHERE type IN ('table','view')"`)
  .toString().trim().split('\n').filter(Boolean)) {
  tables.set(line, new Set(
    execSync(`sqlite3 ${DB} "PRAGMA table_info('${line}')"`).toString().trim().split('\n')
      .map((l) => l.split('|')[1]?.toLowerCase()).filter(Boolean)));
}

/** SQL words that are never column names. */
const NOT_A_COLUMN = new Set([
  'select', 'from', 'as', 'distinct', 'case', 'when', 'then', 'else', 'end', 'null',
  'and', 'or', 'not', 'in', 'is', 'like', 'glob', 'between', 'exists', 'all',
  'count', 'sum', 'avg', 'max', 'min', 'coalesce', 'ifnull', 'nullif', 'cast',
  'json_extract', 'json_valid', 'json_type', 'json_array_length', 'json_group_array',
  'json_group_object', 'json_object', 'json_each', 'json_quote', 'group_concat',
  'datetime', 'date', 'strftime', 'julianday', 'length', 'trim', 'lower', 'upper',
  'substr', 'replace', 'round', 'abs', 'hex', 'randomblob', 'instr', 'total',
]);

function tsFiles(dir) {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const offenders = [];

/** Every string literal that looks like SQL, with the line it starts on.
 *
 * Extracting the strings FIRST is the whole correctness of this script. Running
 * the SELECT pattern over raw source lets a match escape its own literal and
 * run into the JavaScript after it: the first version reported twenty confident
 * findings about columns like `lifecycle_state.await`, because a single-quoted
 * query has no backtick to stop at. Bounding by the delimiter that opened the
 * string is the only version that is right for all three quote styles.
 */
function sqlStrings(source) {
  const out = [];
  const re = /(`)((?:[^`\\]|\\.)*)`|(')((?:[^'\\\n]|\\.)*)'|(")((?:[^"\\\n]|\\.)*)"/g;
  for (const m of source.matchAll(re)) {
    const body = m[2] ?? m[4] ?? m[6] ?? '';
    if (!/\bSELECT\b/i.test(body)) continue;
    out.push({ body, line: source.slice(0, m.index).split('\n').length });
  }
  return out;
}

for (const file of tsFiles(join(ROOT, 'src'))) {
  const source = readFileSync(file, 'utf8')
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, ' ')
    .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');

  for (const { body, line } of sqlStrings(source)) {
    for (const m of body.matchAll(/SELECT\s+([\s\S]*?)\s+FROM\s+([a-z_][a-z0-9_]*)([\s\S]*)/gi)) {
      const [, selectList, table, rest] = m;
      if (selectList.includes('*')) continue;                 // names no columns
      if (/\bJOIN\b/i.test(rest) || /\bJOIN\b/i.test(selectList)) continue;
      if (/^\s*[a-z]{1,3}\b/i.test(rest)) continue;             // aliased table: `FROM x t`
      if (/\bSELECT\b/i.test(rest)) continue;                  // subquery: not single-table
      const columns = tables.get(table);
      if (!columns) continue;                                  // phantom tables have their own gate
      // Created by the migration runner itself, before any migration has run,
      // so its shape is not derivable from the migrations directory.
      if (table === 'schema_migrations') continue;

      // What is left after removing everything that is not a column reference.
      // A noisy gate teaches people to ignore it, so each of these removals is
      // a real category rather than a way to reach zero:
      //   'now', '-7 days', 'approved'   SQL string literals
      //   ${column}                      interpolated identifiers
      //   AS total                       output names, not columns
      const cleaned = selectList
        .replace(/'(?:[^'\\]|\\.)*'/g, ' ')
        .replace(/\$\{[^}]*\}/g, ' ')
        .replace(/\bAS\s+\w+/gi, ' ');
      for (const raw of cleaned.matchAll(/\b([a-z_][a-z0-9_]{2,})\b/gi)) {
        const col = raw[1].toLowerCase();
        if (NOT_A_COLUMN.has(col) || columns.has(col)) continue;
        offenders.push(`${relative(ROOT, file)}:${line} → ${table}.${col}`);
      }
    }
  }
}

execSync(`rm -f ${DB}`);

// ─── Ratchet, not a wall ─────────────────────────────────────────────────────
//
// Turning this on found 46 real defects across the codebase, ten of them on the
// public API. Failing the build on all 46 at once would mean either a very
// large unreviewable change or a gate somebody disables — so the public API was
// fixed immediately (§10: "live" has to mean the contract works) and the rest
// are recorded as a baseline that may only shrink.
//
// A new offender fails. A fixed one must be removed from the baseline, exactly
// like the architectural ratchets: debt can be paid down and never quietly
// re-accumulated.
const BASELINE_PATH = join(ROOT, 'docs/db/select-column-baseline.txt');
const baseline = new Set(
  readFileSync(BASELINE_PATH, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean));
const found = new Set(offenders);

const added = [...found].filter((o) => !baseline.has(o)).sort();
const fixed = [...baseline].filter((o) => !found.has(o)).sort();

if (added.length) {
  console.error('SELECT references a column the table does not have:\n' + added.join('\n'));
  console.error('\nThese throw at runtime. On a route, that is a 500 for every caller.');
  process.exit(1);
}
if (fixed.length) {
  console.error(
    'These were fixed — remove them from docs/db/select-column-baseline.txt so the '
    + 'debt cannot come back:\n' + fixed.join('\n'));
  process.exit(1);
}
console.log(`CLEAN — no new SELECT column drift (${baseline.size} known, paid down over time)`);
