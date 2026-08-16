#!/usr/bin/env node
// =============================================================================
// FOUNDRY — Guard NULL-safety check
//
// Three separate institutional guards were defeated by the same thing:
//
//   A `SELECT RAISE(ABORT,…) WHERE <predicate>` fires only when the predicate
//   is TRUE. A missing JSON key makes it NULL, and a NULL predicate does not
//   fire — so the guard accepts precisely the input it was written to refuse.
//   `x NOT IN (…)`, `x <> y`, `json_type(x,'$.k') <> 'array'` and
//   `json_array_length(x,'$.k')=0` are all NULL when the key is absent.
//
// Migrations 127, 128 and 130 fixed the instances. This stops the next one.
//
// WHAT IT CHECKS, precisely — the rule is narrow on purpose, because a noisy
// gate teaches people to ignore it:
//
//   In a top-level RAISE predicate (one not wrapped in EXISTS / NOT EXISTS),
//   a `json_extract` / `json_type` / `json_array_length` reading a specific
//   `'$.path'` must be wrapped in coalesce(), UNLESS an earlier statement in
//   the same trigger already refuses the absence of that exact path.
//
// WHAT IT DELIBERATELY DOES NOT CHECK:
//
//   • Subquery predicates. `WHERE NOT EXISTS (…)` is inherently fail-closed —
//     a NULL inside matches no row, NOT EXISTS becomes TRUE, and the refusal
//     fires. `WHERE EXISTS (SELECT … WHERE bad OR NOT EXISTS(…))` is safe for
//     the same reason. Flagging these would be pure noise.
//   • Whole-document reads with no path (`json_valid(NEW.col)`), which are
//     governed by the column's own NOT NULL constraint.
//   • Nullable *columns* compared with NOT IN / <>. That needs schema
//     nullability analysis this script does not do, and one real defect
//     (a NULL TEXT PRIMARY KEY in `system_identities`) was of exactly that
//     shape. Trigger tests remain the backstop there — see
//     tests/unit/guard-null-semantics.test.ts.
//
// Run: node scripts/check-guard-null-safety.mjs   (part of `npm run check`)
// =============================================================================
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const MIGRATIONS = 'src/db/migrations';

/** NULL-propagating operators. `IS` / `IS NOT` are excluded: they are the
 * NULL-safe forms and using them is the fix, not the defect. */
const NULL_PROPAGATING = /^\s*(NOT\s+IN|IN|<>|!=|=|<=|>=|<|>|\|\|)/i;

function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, '');
}

/** Effective triggers, honouring DROP TRIGGER in later migrations. */
function effectiveTriggers() {
  const triggers = new Map();
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = stripComments(readFileSync(join(MIGRATIONS, file), 'utf8'));
    for (const m of sql.matchAll(/DROP TRIGGER\s+(?:IF EXISTS\s+)?(\w+)/gi)) triggers.delete(m[1]);
    for (const m of sql.matchAll(/CREATE TRIGGER\s+(?:IF NOT EXISTS\s+)?(\w+)([\s\S]*?)\nEND;/gi)) {
      triggers.set(m[1], { file, body: m[2] });
    }
  }
  return triggers;
}

/** The JSON paths an already-executed statement refuses the absence of. */
function pathsProvenPresent(statement) {
  const proven = new Set();
  for (const m of statement.matchAll(/coalesce\s*\(\s*json_(?:extract|type|array_length)\s*\([^,]+,\s*'(\$[^']*)'/gi)) {
    proven.add(m[1]);
  }
  // `trim(coalesce(json_extract(x,'$.k'),''))=''` — the common presence check.
  for (const m of statement.matchAll(/trim\s*\(\s*coalesce\s*\(\s*json_extract\s*\([^,]+,\s*'(\$[^']*)'/gi)) {
    proven.add(m[1]);
  }
  return proven;
}

/** Split a trigger body into its individual `SELECT RAISE(...)` statements. */
function raiseStatements(body) {
  return [...body.matchAll(/SELECT RAISE\(ABORT,\s*'([^']+)'\)([\s\S]*?);/g)]
    .map((m) => ({ reason: m[1], predicate: m[2] }));
}

const offenders = [];
for (const [name, { file, body }] of effectiveTriggers()) {
  const proven = new Set();
  for (const { reason, predicate } of raiseStatements(body)) {
    // Subquery-guarded predicates are fail-closed; see the header.
    const guarded = /\bEXISTS\s*\(/i.test(predicate);
    if (!guarded) {
      for (const m of predicate.matchAll(/json_(?:extract|type|array_length)\s*\(([^,]+),\s*'(\$[^']*)'\s*\)/gi)) {
        const path = m[2];
        const before = predicate.slice(Math.max(0, m.index - 12), m.index).toLowerCase();
        if (before.includes('coalesce(')) continue;
        if (proven.has(path)) continue;
        const after = predicate.slice(m.index + m[0].length);
        if (!NULL_PROPAGATING.test(after)) continue; // IS NULL / IS NOT NULL etc.
        offenders.push(`${file}:${name} [${reason}] → ${m[0].trim()} ${after.trim().slice(0, 12)}…`);
      }
    }
    for (const path of pathsProvenPresent(predicate)) proven.add(path);
  }
}

if (offenders.length > 0) {
  console.error(
    '✗ guard-null-safety: a refusal can evaluate to NULL and silently not fire.\n' +
    '  Wrap the read in coalesce(), or refuse the absence in an earlier statement\n' +
    '  of the same trigger. Do not delete the check to make this pass.\n');
  for (const o of offenders) console.error('  ' + o);
  process.exit(1);
}
console.log('✓ guard-null-safety: every top-level RAISE predicate is fail-closed');
