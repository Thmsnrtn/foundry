#!/usr/bin/env node
// =============================================================================
// FOUNDRY — a trigger or view that names a table nothing creates
//
// THE GATES READ TYPESCRIPT. THE DATABASE ALSO CONTAINS CODE.
//
// `check-writerless-tables`, `check-unread-tables` and `check-unreferenced-
// tables` between them decide whether a table may be dropped. All three answer
// that question by scanning `src/`. None of them can see a TRIGGER BODY, and a
// trigger body is code that names tables.
//
// That gap nearly took production down. Migration 309 dropped
// `agent_wiki_entries` — correctly, by all three gates: its only reader and
// writer was a module deleted in the same pass. But `reconstruction_claim_guard`
// (migration 106) names it in one arm of the UNION that validates an evidence
// reference, and SQLite resolves a trigger body when the statement that fires
// it is PREPARED, not when the branch is taken. So every INSERT into
// `reconstruction_claims` — the table recording what the institution believes
// about a company and on what evidence, written by ten modules on the live path
// — would have failed with
//
//     no such table: main.agent_wiki_entries
//
// whether or not the claim cited a wiki entry at all. The failure surfaces far
// from the table that was dropped, in statements that have nothing to do with
// it, which is what makes it expensive to diagnose.
//
// So: every table named by a trigger or view in the schema snapshot must be a
// table the snapshot creates. The snapshot is the right source because it is
// the schema as migrations actually build it, not as any one migration file
// describes it — a trigger recreated three times is checked in its final form.
//
// This gate does not ask whether a trigger is a good idea, or whether a view is
// read. It asks one question with one answer: can this object be prepared?
// =============================================================================
import { readFileSync } from 'fs';
import { stripComments } from './lib/strip-comments.mjs';

// The snapshot to check. An argument overrides it so the gate can be pointed at
// a planted fixture — a gate nobody has watched fail is a gate nobody has
// checked, and this one cannot be exercised by planting a file in `src/` the
// way its siblings are.
const SNAPSHOT = process.argv[2] ?? 'docs/db/schema.snapshot.sql';
const sql = readFileSync(SNAPSHOT, 'utf8');

// Tables (and views — a view may legitimately select from another view) the
// snapshot actually creates. Quoted identifiers appear in this file, so the
// name may be wrapped in double quotes or backticks.
const NAME = '[`"\\[]?([A-Za-z_][A-Za-z0-9_]*)[`"\\]]?';
const created = new Set();
for (const m of sql.matchAll(new RegExp(`CREATE\\s+(?:TEMP\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${NAME}`, 'gi'))) {
  created.add(m[1]);
}
for (const m of sql.matchAll(new RegExp(`CREATE\\s+VIEW\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${NAME}`, 'gi'))) {
  created.add(m[1]);
}

// SQLite's own catalogue and the table-valued functions a trigger body may sit
// on top of. `json_each` and `json_tree` read like tables in a FROM clause and
// are built in, so they are named here rather than discovered.
const BUILTIN = new Set([
  'json_each', 'json_tree', 'pragma_foreign_key_list', 'pragma_table_info',
  'pragma_index_list', 'pragma_index_info', 'sqlite_master', 'sqlite_schema',
  'sqlite_sequence', 'sqlite_temp_master', 'generate_series',
]);

// ── Split the snapshot into schema objects that carry a body ─────────────────
//
// A trigger body runs to its matching END; a view ends at the first unbracketed
// semicolon. Both are found by scanning from the CREATE line rather than by a
// single regex, because a trigger body contains semicolons of its own.
const objects = [];
const lines = sql.split('\n');
for (let i = 0; i < lines.length; i++) {
  const head = lines[i];
  const trig = head.match(new RegExp(`^CREATE\\s+TRIGGER\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${NAME}`, 'i'));
  const view = head.match(new RegExp(`^CREATE\\s+VIEW\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${NAME}`, 'i'));
  if (!trig && !view) continue;
  const kind = trig ? 'TRIGGER' : 'VIEW';
  const name = (trig ?? view)[1];
  const body = [head];
  let j = i + 1;
  for (; j < lines.length; j++) {
    body.push(lines[j]);
    if (kind === 'TRIGGER' ? /^END\s*;/.test(lines[j]) : /;\s*$/.test(lines[j])) break;
  }
  objects.push({ kind, name, body: body.join('\n'), line: i + 1 });
  i = j;
}

// ── Which tables does each object name? ─────────────────────────────────────
//
// Parsed rather than grepped, because the first version of this gate grepped
// and reported a hundred and thirty false positives. Two reasons, both worth
// naming so the next reader does not reintroduce them:
//
//   • `UPDATE OF col ON tbl` is a trigger HEADER, not an UPDATE statement, so
//     a bare /UPDATE\s+(\w+)/ reports a table called "OF". The header is
//     therefore read separately from the body.
//   • Trigger bodies here carry long `--` comments, and English contains the
//     words "on", "from" and "a". Comments are stripped before anything else.
//
// The block-comment half uses the SHARED stripper in `lib/strip-comments.mjs`
// rather than a local regex. Ten gates once opened with a one-line non-greedy
// block-comment replace, which reads the slash-star inside a ROUTE GLOB as the
// start of a comment and blanks everything up to the next real terminator —
// 715 lines of code across 7 files, measured. `a-route-glob-is-not-a-comment`
// fails any gate that rolls its own, and it failed this one on its first
// version. (It scans for the literal pattern, so this note describes it rather
// than quoting it; a comment that spells it out fails the same guard.)
//
// SQL's `--` comments are this file's own business and are stripped here, line
// by line, which cannot swallow anything.
const stripSql = (t) => stripComments(t)
  .split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

const BODY_REFS = [
  new RegExp(`\\bFROM\\s+${NAME}`, 'gi'),
  new RegExp(`\\bJOIN\\s+${NAME}`, 'gi'),
  new RegExp(`\\bINSERT\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+${NAME}`, 'gi'),
  new RegExp(`\\bUPDATE\\s+(?:OR\\s+\\w+\\s+)?(?!OF\\b)${NAME}`, 'gi'),
  new RegExp(`\\bDELETE\\s+FROM\\s+${NAME}`, 'gi'),
];

// NEW/OLD are the trigger's own row aliases; the rest are SQL keywords that can
// follow FROM or UPDATE in a position this scan would otherwise read as a name.
const NOT_A_TABLE = /^(new|old|select|values|set|where|when|of|on|begin|end)$/i;

const findings = [];
for (const obj of objects) {
  const text = stripSql(obj.body);
  const missing = new Set();
  const note = (t) => {
    if (created.has(t) || BUILTIN.has(t) || NOT_A_TABLE.test(t)) return;
    missing.add(t);
  };

  if (obj.kind === 'TRIGGER') {
    // Header: everything before BEGIN. The table it fires ON lives here, and
    // this is the only place an `ON <table>` is a table reference.
    const cut = text.search(/\bBEGIN\b/i);
    const header = cut === -1 ? text : text.slice(0, cut);
    const body = cut === -1 ? '' : text.slice(cut);
    const on = header.match(new RegExp(`\\bON\\s+${NAME}`, 'i'));
    if (on) note(on[1]);
    for (const re of BODY_REFS) for (const m of body.matchAll(re)) note(m[1]);
  } else {
    for (const re of BODY_REFS) for (const m of text.matchAll(re)) note(m[1]);
  }

  if (missing.size) findings.push({ ...obj, missing: [...missing].sort() });
}

if (findings.length === 0) {
  console.log(`✓ every table named by a trigger or view exists (${objects.length} objects checked)`);
  process.exit(0);
}

console.error('\n✗ a schema object names a table the schema does not create:\n');
for (const f of findings) {
  console.error(`  ${f.kind} ${f.name}  (${SNAPSHOT}:${f.line})`);
  for (const t of f.missing) console.error(`      → ${t}`);
}
console.error(`
SQLite resolves a trigger or view body at PREPARE time, not when the branch is
taken. So this does not fail only for the statements that touch the missing
table — it fails EVERY statement that fires the trigger or reads the view, with
an error naming a table the caller never mentioned.

Dropping a table orphans more than the TypeScript that read it. Recreate the
object without the missing table (a new migration, DROP TRIGGER then CREATE),
and narrow any vocabulary that admitted it: a kind whose backing table is gone
can only ever ABORT, which is a trap rather than a permission.
`);
process.exit(1);
