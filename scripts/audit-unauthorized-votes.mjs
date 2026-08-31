#!/usr/bin/env node
// =============================================================================
// FOUNDRY — decision votes cast by principals not entitled to cast them
//
// `team_members.can_vote_decisions` existed since migration 010 and nothing
// read it, so an `investor_observer` could cast a vote on a company decision
// and that vote fed `computeAlignmentScore`. The route refuses new ones now,
// and the alignment computation counts only votes whose caster is entitled
// today — but neither of those answers the question an owner actually has:
//
//   DID IT HAPPEN, AND WHERE?
//
// This reports it against a real database rather than assuming. The rows are
// never deleted: what happened is evidence, and erasing it would fabricate a
// history in which it did not. The distinction the report preserves is
//
//   historical unauthorized input existed
//        vs
//   current canonical alignment excludes it
//
// and only the second is something code can fix.
//
// Run: node scripts/audit-unauthorized-votes.mjs [path/to/db]
// With no argument it reports against a freshly migrated empty schema, which
// is the honest answer for a checkout with no data: none, because there are no
// votes at all.
// =============================================================================
import { execSync } from 'child_process';
import { readdirSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
let db = process.argv[2];

if (!db) {
  db = '/tmp/_votes_audit.db';
  execSync(`rm -f ${db}`);
  for (const f of readdirSync(join(ROOT, 'src/db/migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    try { execSync(`sqlite3 ${db} < ${join(ROOT, 'src/db/migrations', f)} 2>/dev/null`); } catch { /* partial */ }
  }
  console.log('No database given — reporting against a freshly migrated schema.');
}

// A SEVERED VOTE IS NOT AN UNAUTHORIZED ONE. Migration 175 made `founder_id`
// nullable so an erased person's identity leaves a company they did not own
// while the company keeps its decision record. NULL means "the person who cast
// this has been erased", and they were entitled at the time — this audit asks
// who voted WITHOUT THE RIGHT TO, and a row with nobody in it cannot answer
// that. Without `dv.founder_id IS NOT NULL`, every account erasure would
// manufacture a finding here.
//
// The clause lives in the SQL and its explanation lives HERE, because this
// string is flattened with `.replace(/\n/g, ' ')` before it is executed — a
// `--` comment inside it swallows the rest of the query on one line. Same shape
// as a backtick inside an embedded comment, and it failed the same way once.
const SQL = `
SELECT dv.id, dv.product_id, dv.decision_id, dv.founder_id, dv.voted_at,
       COALESCE(t.role, 'not a member') AS role
  FROM decision_votes dv
  LEFT JOIN team_members t
    ON t.product_id = dv.product_id AND t.founder_id = dv.founder_id
 WHERE dv.founder_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM products p
                    WHERE p.id = dv.product_id AND p.owner_id = dv.founder_id)
   AND NOT EXISTS (SELECT 1 FROM team_members t2
                    WHERE t2.product_id = dv.product_id
                      AND t2.founder_id = dv.founder_id
                      AND t2.status = 'active'
                      AND t2.can_vote_decisions = 1)
 ORDER BY dv.voted_at`;

const total = execSync(`sqlite3 ${db} "SELECT COUNT(*) FROM decision_votes"`).toString().trim();
const rows = execSync(`sqlite3 -json ${db} "${SQL.replace(/\n/g, ' ')}"`).toString().trim();
const found = rows ? JSON.parse(rows) : [];

console.log(`decision_votes rows: ${total}`);
if (found.length === 0) {
  console.log('✓ none were cast by a principal not entitled to cast them.');
  console.log('  Recorded as a fact rather than assumed: the query ran.');
  process.exit(0);
}

console.error(`\n${found.length} vote(s) cast without can_vote_decisions:\n`);
for (const r of found) {
  console.error(`  ${r.voted_at}  product=${r.product_id}  decision=${r.decision_id}`
    + `  voter=${r.founder_id}  (${r.role})`);
}
console.error('\nThe rows stay — they are evidence of what happened. Current alignment');
console.error('already excludes them: computeAlignmentScore counts only votes whose');
console.error('caster is entitled today. Recompute the affected snapshots to carry that');
console.error('through to stored history.');
process.exit(1);
