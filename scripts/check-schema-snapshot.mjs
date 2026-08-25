#!/usr/bin/env node
// =============================================================================
// FOUNDRY — the committed schema snapshot describes the migrations that exist
//
// `docs/db/schema.snapshot.sql` is the record of what the migrations produce,
// and `foundry-self-observation.test.ts` compares it against a freshly migrated
// database — Foundry observing its own schema, which is the one place a stale
// snapshot has to be caught.
//
// IT WAS CAUGHT THERE TWICE IN ONE SESSION, TWENTY-FIVE MINUTES INTO A FULL
// RUN EACH TIME. First when the snapshot was regenerated between migrations 215
// and 216 rather than after both; then when 217 was added and it was not
// regenerated at all — by the same person who had, an hour earlier, written
// "regenerate it AFTER the last migration of a batch" into the checkpoint. A
// note that has to be remembered at the right moment is not a control. The
// distance between the mistake and its discovery is what makes it expensive,
// and that distance is the thing to fix.
//
// So the same question is asked here, in seconds, at the front of the chain.
//
// WHY OBJECT NAMES RATHER THAN A BYTE DIFF: `sqlite3 .schema` formats
// differently across versions, and a gate that fails on somebody's newer sqlite
// is a gate people learn to bypass. Both sides of this comparison are built by
// the same binary in the same run, so the SET OF NAMES is the durable
// invariant — the same comparison the self-observation test makes, moved
// twenty-five minutes earlier.
//
// This gate has no baseline and never will. A snapshot either describes the
// migrations or it does not.
// =============================================================================
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const SNAPSHOT = 'docs/db/schema.snapshot.sql';

/** Every object the schema text declares, by name. */
function objectNames(sql) {
  const names = new Set();
  const re = /CREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX|TRIGGER|VIEW)\s+(?:IF NOT EXISTS\s+)?["'`[]?(\w+)/gi;
  for (const m of sql.matchAll(re)) {
    if (!m[2].startsWith('sqlite_')) names.add(m[2]);
  }
  return names;
}

let committed;
try {
  committed = readFileSync(SNAPSHOT, 'utf8');
} catch {
  console.error(`✗ ${SNAPSHOT} is missing. Run: bash scripts/schema-snapshot.sh`);
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'foundry-snapshot-'));
const db = join(dir, 'schema.db');
let live;
try {
  // The same loop as `scripts/schema-snapshot.sh`, tolerating the same
  // per-statement errors for the same reason: some older migrations have
  // planner-level issues the production runner swallows, and the resulting
  // schema is what matters either way.
  const migrations = execFileSync('ls', ['src/db/migrations'], { encoding: 'utf8' })
    .split('\n').filter((f) => f.endsWith('.sql')).sort();
  for (const file of migrations) {
    try {
      execFileSync('sqlite3', [db], {
        input: readFileSync(join('src/db/migrations', file), 'utf8'), stdio: ['pipe', 'ignore', 'ignore'],
      });
    } catch { /* per-statement tolerance, as above */ }
  }
  live = execFileSync('sqlite3', [db, '.schema'], { encoding: 'utf8' });
} catch (err) {
  // sqlite3 absent is not a schema failure and must not read as one.
  console.log(`… schema snapshot not checked: ${err.message.split('\n')[0]}`);
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const inSnapshot = objectNames(committed);
const inMigrations = objectNames(live);

const missing = [...inMigrations].filter((n) => !inSnapshot.has(n)).sort();
const extra = [...inSnapshot].filter((n) => !inMigrations.has(n)).sort();

if (missing.length || extra.length) {
  console.error('✗ the committed schema snapshot does not describe the migrations\n');
  for (const n of missing) console.error(`  the migrations create ${n} and the snapshot does not have it`);
  for (const n of extra) console.error(`  the snapshot has ${n} and no migration creates it`);
  console.error('\nRun: bash scripts/schema-snapshot.sh   — then commit the result.');
  console.error('Regenerate AFTER the last migration of a batch, not between two of them.');
  process.exit(1);
}

console.log(`✓ schema snapshot describes the migrations (${inMigrations.size} objects)`);
