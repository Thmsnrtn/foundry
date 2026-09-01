// =============================================================================
// Tests: the instruments, turned on themselves
//
// This campaign's defect class is "a rule that exists, is believed, and has no
// edge to the thing it governs." A CI gate is a rule. Two of them had exactly
// that shape:
//
//   check-route-guards      its route-declaration pattern was unanchored, so
//                           `const founder = c.get('founder')` matched as a
//                           route and truncated every handler above it to one
//                           line — hiding every inline check inside it.
//   check-sql-columns       it found `UPDATE products SET a_column_that_does
//                           _not_exist = 1` perfectly well, printed it, and
//                           exited 0. Every time. `lint:columns` chains with
//                           `&&`, so the line went into a log nobody read and
//                           the build went green.
//
// A detector with no edge to a consequence is a detector nobody can rely on,
// and neither of those was findable by reading the script — only by giving it
// something it should refuse and watching what it did.
//
// So each gate gets a defect it is supposed to catch, and has to fail. This is
// the same standard the campaign applies to every other load-bearing gate: a
// guard is believed after it has been mutated, not after it has been read.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import {
  existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const ROOT = resolve(__dirname, '../..');
const planted: string[] = [];

/** THIS FILE MUST NOT LOOK LIKE THE THING IT PLANTS. Several gates scan
 *  `tests/` as well as `src/`, so a forbidden status literal or a fabricated
 *  CREATE TABLE written out in full here would make them fail on a clean tree —
 *  the test would be the defect. Every fixture is therefore assembled from
 *  fragments that are harmless apart. */
const j = (...parts: string[]): string => parts.join('');

/** Write a file the gate under test should object to. Named so nothing else in
 *  the suite collects it: the fabrication gate scans tests/ too. */
function plant(relPath: string, contents: string): void {
  const abs = resolve(ROOT, relPath);
  writeFileSync(abs, contents);
  planted.push(abs);
}

function run(script: string, args: string[] = []): { code: number; output: string } {
  try {
    const output = execFileSync('node', [resolve(ROOT, 'scripts', script), ...args],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

afterEach(() => {
  for (const p of planted.splice(0)) if (existsSync(p)) rmSync(p);
});

/**
 * SWEEP WHAT AN EARLIER RUN LEFT BEHIND.
 *
 * `afterEach` cleans up when this process finishes its work. A run that is
 * KILLED does not, and one such leftover — `_gate_fixture_agent.ts`, planted to
 * prove the reachability gate — survived into a commit and reached the branch,
 * where the public-claims audit read it as a thirteenth AI agent against a
 * pricing claim of twelve. The audit caught it, which is the system working;
 * this is so the next run heals rather than inheriting.
 *
 * `.gitignore` stops such a file being committed at all. This stops it being
 * PRESENT, which is what makes a clean tree actually clean.
 */
beforeAll(() => {
  const sweep = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = resolve(dir, entry.name);
      if (entry.isDirectory()) sweep(abs);
      else if (/^_gate_fixture_.*\.ts$/.test(entry.name)) rmSync(abs);
    }
  };
  sweep(resolve(ROOT, 'src'));
});

describe('every gate refuses the defect it exists for', () => {
  it('check-sql-columns fails on an UPDATE SET of a column that does not exist', () => {
    // The one that reported and passed. Asserting the EXIT CODE, not the
    // output, is the whole point — it always printed the right thing.
    plant('src/services/_gate_fixture_a.ts',
      'import { query } from "../db/client.js";\n'
      + j('export const q = () => query(`UPDATE ', 'products SET ',
        'zz_not_a_column = 1 WHERE id = ?`, []);\n'));
    const r = run('check-sql-columns.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('zz_not_a_column');
  });

  it('check-select-columns fails on a SELECT of a column that does not exist', () => {
    plant('src/services/_gate_fixture_b.ts',
      'import { query } from "../db/client.js";\n'
      + j('export const q = () => query(`SELECT ', 'zz_not_a_column FROM ',
        'products WHERE id = ?`, []);\n'));
    expect(run('check-select-columns.mjs').code).toBe(1);
  });

  it('check-select-columns fails on the same column behind a table alias', () => {
    // The alias was the hiding place. The gate skipped `FROM products p`
    // along with the JOINs, and the public API's list-customers endpoint sat
    // behind exactly that shape — three columns the table does not have,
    // throwing on every request since it was written, behind a catch that
    // returned a fixed sentence. One table is one table, alias or not.
    plant('src/services/_gate_fixture_b2.ts',
      'import { query } from "../db/client.js";\n'
      + j('export const q = () => query(`SELECT ', 'p.zz_not_a_column FROM ',
        'products p WHERE p.id = ?`, []);\n'));
    const r = run('check-select-columns.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('zz_not_a_column');
  });

  it('check-insert-columns fails on an INSERT naming a column that does not exist', () => {
    plant('src/services/_gate_fixture_c.ts',
      'import { query } from "../db/client.js";\n'
      + j('export const q = () => query(`INSERT ', 'INTO products ',
        '(id, zz_not_a_column) VALUES (?, ?)`, []);\n'));
    expect(run('check-insert-columns.mjs').code).toBe(1);
  });

  it('check-query-arity fails on a statement with more placeholders than arguments', () => {
    // The shape that had never once run: `forecast_scenarios` was written with
    // seven placeholders and six arguments, `generated_by` is NOT NULL, and
    // both callers swallowed the throw. Every other gate passed it: the SQL is
    // valid, the columns exist, the types check.
    plant('src/services/_gate_fixture_arity.ts',
      'import { query } from "../db/client.js";\n'
      + j('export const q = () => query(`INSERT ', 'INTO products ',
        '(id, name, owner_id) VALUES (?, ?, ?)`, [1, 2]);\n'));
    const r = run('check-query-arity.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('3 placeholder(s), 2 argument(s)');
  });

  it('check-query-arity fails on a statement with more arguments than placeholders', () => {
    plant('src/services/_gate_fixture_arity2.ts',
      'import { query } from "../db/client.js";\n'
      + j('export const q = () => query(`SELECT ', 'id FROM products ',
        'WHERE id = ?`, [1, 2]);\n'));
    expect(run('check-query-arity.mjs').code).toBe(1);
  });

  it('check-query-arity is not fooled by an apostrophe in a SQL comment', () => {
    // The first version of the counter toggled string state on every quote, so
    // a comment reading "the row's id" opened a string that never closed and
    // every placeholder after it went uncounted. It reported five false
    // positives against correct code — and the fix for a noisy gate is a
    // baseline, which is where a gate goes to stop working.
    plant('src/services/_gate_fixture_arity3.ts',
      'import { query } from "../db/client.js";\n'
      + j('export const q = () => query(`SELECT id FROM products\n',
        "  -- the row's own id, not the owner's\n",
        '  WHERE id = ? AND owner_id = ?`, [1, 2]);\n'));
    const r = run('check-query-arity.mjs');
    expect(r.code, r.output).toBe(0);
  });

  it('check-query-arity fails on an INSERT whose column list is a different length', () => {
    // The sibling shape: valid SQL, real columns, correct types, and fatal.
    plant('src/services/_gate_fixture_arity4.ts',
      'import { query } from "../db/client.js";\n'
      + j('export const q = () => query(`INSERT ', 'INTO products ',
        '(id, name, owner_id) VALUES (?, ?)`, [1, 2]);\n'));
    const r = run('check-query-arity.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('3 column(s), 2 value(s)');
  });

  it('check-query-arity counts a nested SQL call as one value', () => {
    // `datetime('now')` and `COALESCE(?, x)` both carry parentheses and commas.
    plant('src/services/_gate_fixture_arity5.ts',
      'import { query } from "../db/client.js";\n'
      + j('export const q = () => query(`INSERT ', 'INTO products ',
        "(id, name, owner_id) VALUES (?, ?, COALESCE(?, 'x'))`, [1, 2, 3]);\n"));
    const r = run('check-query-arity.mjs');
    expect(r.code, r.output).toBe(0);
  });

  it('check-unread-tables fails on a table something writes and nothing reads', () => {
    // THIS FIXTURE USED TO BORROW A REAL TABLE, and the borrowed table went
    // away. `sector_remediation_templates` qualified — in the schema, reached
    // by nothing at all, not in the erasure map — until migration 215 dropped
    // it with the ten others nothing had ever written. A fixture that depends
    // on a real defect surviving rots every time one is cleaned up, so this
    // one brings its own schema: a table planted for the length of the test,
    // given a writer and no reader, which is exactly the moment this gate
    // exists to catch — a record starting to be kept that nobody looks at.
    // (`onboarding_checklist` would NOT do here — it is in the erasure map, so
    // the export's dynamic `SELECT * FROM ${table}` reads it and the gate is
    // right to say so.)
    plant('src/db/migrations/998_gate_fixture_unread.sql',
      j('CREATE TABLE ', 'IF NOT EXISTS ', '_gate_fixture_unread_table (id TEXT PRIMARY KEY);\n'));
    plant('src/services/_gate_fixture_unread.ts',
      'import { query } from "../db/client.js";\n'
      + j('export const q = () => query(`INSERT ', 'INTO _gate_fixture_unread_table ',
        '(id) VALUES (?)`, [1]);\n'));
    const r = run('check-unread-tables.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('_gate_fixture_unread_table');
  });

  it('check-unread-tables counts a SQL trigger as a reader', () => {
    // `ai_spend_reservations` is consumed entirely by migration 099's triggers,
    // which roll `actual_cents` into `ai_daily_spend`. A real reader that is
    // simply not TypeScript, and excluding it would put a working table on a
    // list of broken ones.
    const r = run('check-unread-tables.mjs');
    expect(r.code, r.output).toBe(0);
    expect(readFileSync(resolve(ROOT, 'docs/db/unread-tables-baseline.txt'), 'utf8'))
      .not.toMatch(/ai_spend_reservations/);
  });

  it('check-check-vocabularies fails on a status the column will not accept', () => {
    plant('src/services/_gate_fixture_d.ts',
      'import { query } from "../db/client.js";\n'
      + j('export const q = () => query(`UPDATE ', 'push_log SET status',
        " = 'zz_not", "_a_status' WHERE id = ?`, []);\n"));
    const r = run('check-check-vocabularies.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('zz_not_a_status');
  });

  it('check-check-vocabularies fails rather than reading part of a long statement', () => {
    // THE BRANCH THAT REFUSES TO READ A FRAGMENT. A scan window is a bound on
    // how much of each statement the gate sees, and a gate that silently reads
    // the first N characters of what it claims to check is the defect class
    // this one exists to catch. It reports an overrun instead — and that branch
    // fired on real code before it had a test, which is why it has one now.
    //
    // The padding is a SQL comment, because that is how a statement in this
    // codebase actually gets long: `stripComments` removes TypeScript comments,
    // and the SQL comments inside a template literal are part of the string.
    //
    // The fixture reads the bound it is testing out of the script, so raising
    // the window does not silently stop this from exercising the branch — and
    // renaming the constant fails here rather than going quiet.
    const window = Number(/const WINDOW = (\d+)/.exec(
      readFileSync(resolve(ROOT, 'scripts/check-check-vocabularies.mjs'), 'utf8'))?.[1]);
    expect(window, 'the scan window this test is about could not be read').toBeGreaterThan(0);
    const line = (i: number) => `      -- padding line ${i}`;
    const padding = Array.from({ length: Math.ceil(window / line(0).length) + 50 }, (_, i) => line(i)).join('\n');
    plant('src/services/_gate_fixture_window.ts',
      'import { query } from "../db/client.js";\n'
      + j('export const q = () => query(`UPDATE ', 'push_log SET status',
        " = 'sent'\n", padding, '\n      WHERE id = ?`, []);\n'));
    const r = run('check-check-vocabularies.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('scan window');
    expect(r.output).toContain('_gate_fixture_window');
  });

  it('check-autonomous-approval fails on an approval that asks nothing', () => {
    plant('src/services/_gate_fixture_e.ts',
      'import { approveAndExecute } from "../scp/actions/executor.js";\n'
      + 'export const go = (id: string) => approveAndExecute(id, "whoever");\n');
    expect(run('check-autonomous-approval.mjs').code).toBe(1);
  });

  it('check-autonomous-approval fails on an execution status advanced outside the executor', () => {
    plant('src/services/_gate_fixture_f.ts',
      'import { query } from "../db/client.js";\n'
      + j('export const q = () => query(`UPDATE ', 'action_executions SET ',
        "status='approved' WHERE id=?`, []);\n"));
    expect(run('check-autonomous-approval.mjs').code).toBe(1);
  });

  it('check-route-guards fails on a new mutating route that asks no capability', () => {
    // The gate that was reading one line of each handler. A route planted in a
    // file with no guards at all has to surface.
    plant('src/routes/dashboard/_gate_fixture_g.ts',
      "import { Hono } from 'hono';\n"
      + "export const gateFixture = new Hono();\n"
      + "gateFixture.post('/zz-gate-fixture', async (c) => c.text('x'));\n");
    const r = run('check-route-guards.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('/zz-gate-fixture');
  });

  it('check-reality-scope fails on a new query that reads every company', () => {
    // THE BOUNDARY THIS GUARDS. A reference company is synthetic and must never
    // reach owner truth. Six readers found roughly thirty existing places where
    // it would have — the fleet letter, the revenue roll-ups, the cross-company
    // pools — and each was fixed by hand. Hand-fixing does not survive the next
    // commit, which is what this gate is for: the thirty-first query has to
    // fail the build rather than quietly put fiction on his page.
    plant('src/services/_gate_fixture_reality.ts',
      j("import { query } from '../db/client.js';\n",
        'export async function everyCompany() {\n',
        "  return query('SELECT id, name FROM ", "products', []);\n",
        '}\n'));
    const r = run('check-reality-scope.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('_gate_fixture_reality');
  });

  it('check-reality-scope does not object to a query about one named company', () => {
    // The false positive that would make the gate useless. Most queries name a
    // single company by id and are already scoped by construction; if those
    // failed, the baseline would swallow everything and the gate would stop
    // meaning anything.
    plant('src/services/_gate_fixture_reality_ok.ts',
      j("import { query } from '../db/client.js';\n",
        'export async function oneCompany(id: string) {\n',
        "  return query('SELECT name FROM ", "products WHERE id = ?', [id]);\n",
        '}\n'));
    const r = run('check-reality-scope.mjs');
    expect(r.code, r.output).toBe(0);
  });

  it('check-reachability fails on a module nothing can reach', () => {
    plant('src/services/_gate_fixture_orphan.ts',
      "export const orphan = () => 'nothing imports this';\n");
    const r = run('check-reachability.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('_gate_fixture_orphan');
  });

  it('check-reachability does not call a dynamically-loaded module dead', () => {
    // The false positive that matters. A previous run of this class named
    // ~160KB of live, dynamically-loaded agents as unreachable — the walker
    // follows literal specifiers and the dispatcher builds its one by name.
    // Planting a file INSIDE that declared directory must not be reported.
    plant('src/services/scp/agents/_gate_fixture_agent.ts',
      "export const run = () => 'loaded by computed name';\n");
    const r = run('check-reachability.mjs');
    expect(r.code, r.output).toBe(0);
  });

  it('check-migration-order fails on a number that already exists', () => {
    // The case that reorders production: a fresh database applies this in
    // lexical position, an existing one applies it last. No other test in the
    // repository can tell the difference, because they all build fresh.
    plant('src/db/migrations/100_gate_fixture_reuse.sql', 'SELECT 1;\n');
    const r = run('check-migration-order.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('New duplicated migration numbers');
  });

  it('check-migration-order fails on a width that breaks lexical ordering', () => {
    // `1000_` sorts before `999_`. The migrator's comment says "001 < 002 etc"
    // and it stops being true silently the day somebody writes four digits.
    plant('src/db/migrations/1000_gate_fixture_wide.sql', 'SELECT 1;\n');
    const r = run('check-migration-order.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toMatch(/three digits|Lexical order/);
  });

  it('check-migration-order fails on a short number that still sorts plausibly', () => {
    // Mutation testing found this gap. `1000_` is caught by the ORDERING
    // invariant — lexically first, numerically last — so relaxing the
    // three-digit rule to `\\d+` still failed that case, and the width rule
    // looked redundant. It is not: `12_thing.sql` sorts before `164_` AND is
    // numerically smaller, so lexical and numeric order agree and only the
    // fixed-width rule objects. Three digits is what keeps the two orders the
    // same forever rather than by coincidence.
    plant('src/db/migrations/12_gate_fixture_short.sql', 'SELECT 1;\n');
    const r = run('check-migration-order.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('three digits');
  });

  it('check-migration-order accepts the next number in sequence', () => {
    // The gate must not refuse the legitimate act. A guard that blocks the
    // ordinary case is the other defect.
    plant('src/db/migrations/900_gate_fixture_next.sql', 'SELECT 1;\n');
    const r = run('check-migration-order.mjs');
    expect(r.code, r.output).toBe(0);
  });

  it('check-route-guards sees the API surface it used to be blind to', () => {
    // THE GATE SCANNED `src/routes/dashboard` AND NOTHING ELSE, and printed
    // its count as though it described the system. `src/routes/api` held
    // eighty-one more mutating routes on the same session-authenticated
    // surface, and the gate's silence about them read as their absence. This
    // plants OUTSIDE the old directory: it fails if the scan narrows back.
    plant('src/routes/api/_gate_fixture_k.ts',
      "import { Hono } from 'hono';\n"
      + "export const gateFixture = new Hono();\n"
      + "gateFixture.post('/zz-gate-api-fixture', async (c) => c.text('x'));\n");
    const r = run('check-route-guards.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('/zz-gate-api-fixture');
  });

  it('check-route-guards leaves token surfaces out, and only those', () => {
    // Ingest and webhooks authenticate a token, not a member, so "which
    // capability does this member hold" is not a question that can be asked of
    // them — padding the baseline with routes that can never leave it would
    // make the number mean less. That exclusion is a decision, so it is
    // testable: a route planted there is NOT a finding...
    plant('src/routes/ingest/_gate_fixture_l.ts',
      "import { Hono } from 'hono';\n"
      + "export const gateFixture = new Hono();\n"
      + "gateFixture.post('/zz-gate-ingest-fixture', async (c) => c.text('x'));\n");
    const r = run('check-route-guards.mjs');
    expect(r.code, r.output).toBe(0);
    // ...and the exclusion is narrow: it is the named directories, not any
    // path that happens to contain the word.
    expect(readFileSync('scripts/check-route-guards.mjs', 'utf8'))
      .toMatch(/rel\.startsWith\(d \+ '\/'\)/);
  });

  it('check-route-guards accepts a route that asks inline, not only in middleware', () => {
    // A handler whose company arrives in the request body cannot be guarded by
    // middleware that resolves the company from the path or the selection. The
    // gate has to read the handler to see that.
    plant('src/routes/dashboard/_gate_fixture_h.ts',
      "import { Hono } from 'hono';\n"
      + "import { memberMay } from '../../services/team/members.js';\n"
      + "export const gateFixture = new Hono();\n"
      + "gateFixture.post('/zz-gate-inline', async (c) => {\n"
      + "  const founder = c.get('founder') as { id: string };\n"
      + "  if (!(await memberMay('p', founder.id, 'can_manage_company'))) return c.text('no', 403);\n"
      + "  return c.text('ok');\n"
      + "});\n");
    const r = run('check-route-guards.mjs');
    expect(r.code, r.output).toBe(0);
  });

  it('check-kernel-boundary fails when the kernel imports a pack', () => {
    plant('src/services/memory/_gate_fixture_i.ts',
      "import type { ActionType } from '../scp/actions/executor.js';\n"
      + 'export type Y = ActionType;\n');
    expect(run('check-kernel-boundary.mjs').code).toBe(1);
  });

  it('check-test-schema-fabrication fails when a test builds a table the migrations own', () => {
    plant('tests/unit/_gate_fixture_j.ts',
      'import { query } from "../../src/db/client.js";\n'
      + j('export const x = () => query(`CREATE ', 'TABLE IF NOT EXISTS ',
        'decisions (id TEXT PRIMARY KEY)`, []);\n'));
    expect(run('check-test-schema-fabrication.mjs').code).toBe(1);
  });

  it('check-writerless-tables fails on a read of a table nothing writes', () => {
    // The characteristic defect of this codebase is a rule with nothing on one
    // side of it. `deal_rooms` is one of 25 tables in the schema that no code
    // ever fills; reading one is how a surface comes to show permanent
    // emptiness that an integrator builds against and a founder believes.
    plant('src/services/_gate_fixture_l.ts',
      j('import { query } from "../db/client.js";\n',
        'export const q = () => query(`SELECT ', 'id FROM deal_rooms', ' WHERE id = ?`, []);\n'));
    const r = run('check-writerless-tables.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('deal_rooms');
  });

  it('check-write-only-columns fails on a column written with no reader', () => {
    // The mirror of check-writerless-tables. `learned_claim_id` was written on
    // four tables — every one of them recording what Foundry had learned — and
    // read by none, so it was paying to think and filing the thought somewhere
    // it never looked.
    plant('src/services/_gate_fixture_n.ts',
      j('import { query } from "../db/client.js";\n',
        'export const w = () => query(`INSERT ', 'INTO webhook_deliveries',
        ' (attempt_count) VALUES (?)`, []);\n'));
    const r = run('check-write-only-columns.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('attempt_count');
  });

  it('check-write-only-columns still reports when one write list is a substring of another', () => {
    // THE ANSWER USED TO DEPEND ON MIGRATION FILE ORDER. The gate built one copy
    // of the source with every write context's TEXT REMOVED and asked whether a
    // column name survived. Removal is destructive: one table's INSERT column
    // list can be a SUBSTRING of another's, and blanking the short one first
    // chopped it out of the long one, so the long one no longer matched itself
    // and its columns read as read.
    //
    // That is exactly what hid `customer_health_snapshots.usage_score` and its
    // three siblings behind `INSERT INTO metric_snapshots (id, product_id,
    // snapshot_date)`. Deleting that placeholder writer for unrelated reasons is
    // what made them visible, which is not a way to find defects.
    // Two writes to one table, where the first list is a leading SUBSTRING of
    // the second. Under the old removal-based gate, blanking the short one
    // first left the long one unmatched and `attempt_count` read as read.
    plant('src/services/_gate_fixture_n2.ts',
      j('import { query } from "../db/client.js";\n',
        'export const a = () => query(`INSERT ', 'INTO webhook_deliveries',
        ' (id, webhook_id) VALUES (?, ?)`, []);\n',
        'export const b = () => query(`INSERT ', 'INTO webhook_deliveries',
        ' (id, webhook_id, attempt_count) VALUES (?, ?, ?)`, []);\n'));
    const r = run('check-write-only-columns.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('attempt_count');
  });

  it('check-backticks-in-embedded-comments fails on a backtick in embedded SQL', () => {
    // Three parse errors in one campaign, each to somebody who had already
    // written the lesson down. The backtick closes the template literal and the
    // error surfaces tens of lines from the cause.
    //
    // Assembled from fragments so this file does not contain the defect it
    // plants: the gate scans tests/ too.
    plant('src/services/_gate_fixture_b.ts',
      j('import { query } from "../db/client.js";\n',
        'export const q = () => query(`SELECT id FROM products\n',
        '  -- the ', '`', 'id', '`', ' column\n',
        '  WHERE id = ?`, []);\n'));
    const r = run('check-backticks-in-embedded-comments.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('_gate_fixture_b');
  });

  it('check-backticks-in-embedded-comments sees a continuation line', () => {
    // The first version tested only whether a line BEGAN a comment, so a
    // multi-line HTML comment hid the defect everywhere after the first line —
    // which is where a long explanation names the symbol it is about. It
    // reported clean while a parse error sat in the tree.
    plant('src/services/_gate_fixture_m.ts',
      j('export const q = (): string => `\n',
        '  <div>\n',
        '    <', '!-- a note that runs on\n',
        '         and names a ', '`', 'symbol', '`', ' on the second line --', '>\n',
        '  </div>`;\n'));
    const r = run('check-backticks-in-embedded-comments.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('_gate_fixture_m');
  });

  it('check-integration-status-vocabulary fails on a new \'connected\' literal', () => {
    // Migration 074 retired that value and `fabric.ts` repeats the rule in a
    // JSDoc saying "Do NOT write 'connected'". It was still written by the
    // first-connect route and still required by the Linear executor — a rule
    // written down twice and broken twice, which is a wish until something
    // mechanical enforces it.
    plant('src/services/_gate_fixture_status.ts',
      j('import { query } from "../db/client.js";\n',
        'export const c = () => query(`INSERT ', 'INTO integrations\n',
        '  (id, product_id, type, status)\n',
        "  VALUES (?, ?, ?, 'conn", "ected')`, []);\n"));
    const r = run('check-integration-status-vocabulary.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('_gate_fixture_status');
  });

  it('check-integration-status-vocabulary does not read its own explanation as a breach', () => {
    // The rule is explained in comments in three places, including the gate's
    // own header. Prose about a literal is not the literal.
    plant('src/services/_gate_fixture_status_prose.ts',
      j('// Never write ', "'conn", "ected' to integrations.status.\n",
        'export const x = 1;\n'));
    const r = run('check-integration-status-vocabulary.mjs');
    expect(r.code, r.output).toBe(0);
  });

  it('check-unreferenced-tables fails on a table no code can reach', () => {
    // The population neither sibling gate has: check-writerless-tables starts
    // from tables that are read, check-unread-tables from tables that are
    // written, and a table with neither half is in no population at all.
    plant('src/db/migrations/998_gate_fixture_unreferenced.sql',
      j('CREATE TABLE IF NOT EXISTS _gate_fixture_orphan_table (\n',
        '  id TEXT PRIMARY KEY\n', ');\n'));
    const r = run('check-unreferenced-tables.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('_gate_fixture_orphan_table');
  });

  // ─── The six gates nobody had ever made fail ──────────────────────────────
  //
  // `the-gates-actually-run.test.ts` opened by stating that every gate in this
  // repository has a planted-defect test. It was not true of six of the thirty
  // chained into `npm run check`, and nothing was checking the claim.
  // `check-gates-are-tested.mjs` checks it now; these pay the baseline down.
  // A gate that has never failed is indistinguishable from one that cannot.

  it('check-guard-null-safety fails on a RAISE predicate a missing key makes NULL', () => {
    // The defect three institutional guards were defeated by: a top-level
    // `SELECT RAISE(ABORT,…) WHERE json_extract(...) <> 'x'` is NULL when the
    // key is absent, and a NULL predicate does not fire — so the guard accepts
    // precisely the input it was written to refuse.
    plant('src/db/migrations/995_gate_fixture_nullguard.sql',
      j('CREATE TRIGGER ', 'IF NOT EXISTS _gate_fixture_null_guard\n',
        'BEFORE INSERT ON products\n', 'BEGIN\n',
        "  SELECT RAISE(ABORT,'_gate_fixture:bad')\n",
        "   WHERE json_extract(NEW.disabled_tools,'$.kind') <> 'permitted';\n",
        'END;\n'));
    const r = run('check-guard-null-safety.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('995_gate_fixture_nullguard');
  });

  it('check-guard-null-safety accepts the coalesce()d form, so it is not just refusing', () => {
    plant('src/db/migrations/995_gate_fixture_nullguard.sql',
      j('CREATE TRIGGER ', 'IF NOT EXISTS _gate_fixture_null_guard\n',
        'BEFORE INSERT ON products\n', 'BEGIN\n',
        "  SELECT RAISE(ABORT,'_gate_fixture:bad')\n",
        "   WHERE coalesce(json_extract(NEW.disabled_tools,'$.kind'),'') <> 'permitted';\n",
        'END;\n'));
    const r = run('check-guard-null-safety.mjs');
    expect(r.code, r.output).toBe(0);
  });

  it('check-applied-columns-guarded fails on a column a ledger applies with no UPDATE guard', () => {
    // The constitutional shape: an AFTER INSERT trigger applies a governed
    // value to a parent column, and nothing stops a direct UPDATE writing that
    // column around the ledger entirely.
    plant('src/db/migrations/994_gate_fixture_applied.sql',
      j('CREATE TABLE ', 'IF NOT EXISTS _gate_fixture_parent (id TEXT PRIMARY KEY, _gate_state TEXT);\n',
        'CREATE TABLE ', 'IF NOT EXISTS _gate_fixture_ledger (id TEXT PRIMARY KEY, parent_id TEXT, to_state TEXT);\n',
        'CREATE TRIGGER ', 'IF NOT EXISTS _gate_fixture_apply\n',
        'AFTER INSERT ON _gate_fixture_ledger\n', 'BEGIN\n',
        '  UPDATE _gate_fixture_parent SET _gate_state = NEW.to_state WHERE id = NEW.parent_id;\n',
        'END;\n'));
    const r = run('check-applied-columns-guarded.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('_gate_state');
  });

  it('check-ai-attribution fails on a model call charged to no company', () => {
    plant('src/services/_gate_fixture_attribution.ts',
      'import { callSonnet } from "./ai/client.js";\n'
      + j('export const q = () => call', 'Sonnet("system", "user", 512);\n'));
    const r = run('check-ai-attribution.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('_gate_fixture_attribution');
  });

  it('ratchet fails when a pattern appears more often than its baseline allows', () => {
    // A ratchet freezes a count. The planted config's pattern matches something
    // this repository certainly contains, against a baseline of zero.
    plant('scripts/ratchets/_gate_fixture.json', JSON.stringify({
      name: '_gate_fixture_ratchet',
      description: 'planted for the gate suite; matches something that exists',
      pattern: j('export ', 'async ', 'function'),
      roots: ['src/services/metrics'],
      includePath: '\\.ts$',
      baseline: 0,
      direction: 'down',
    }));
    const r = run('ratchet.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('_gate_fixture_ratchet');
  });

  it('ratchet also fails when the count falls below its baseline, unlocked', () => {
    // The other half, and the reason a ratchet is not merely a maximum: an
    // improvement that is not written down can be undone by the next commit
    // without anything noticing.
    plant('scripts/ratchets/_gate_fixture.json', JSON.stringify({
      name: '_gate_fixture_ratchet',
      description: 'planted for the gate suite; baseline above the real count',
      pattern: j('export ', 'async ', 'function'),
      roots: ['src/services/metrics'],
      includePath: '\\.ts$',
      baseline: 10_000,
      direction: 'down',
    }));
    const r = run('ratchet.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('_gate_fixture_ratchet');
  });

  it('audit-public-claims fails when the shipped agent roster stops matching the page', () => {
    // "All plans include 12 AI agents" is verified against the files in
    // `src/services/scp/agents`. THIS EXACT PLANT HAPPENED BY ACCIDENT ONCE:
    // a fixture left behind by a killed run was read as a thirteenth agent and
    // the audit caught it, which is this file's own header describing the
    // system working. Deliberately, now.
    plant('src/services/scp/agents/_gate_fixture_agent.ts',
      'export const unusedAgent = () => null;\n');
    const r = run('audit-public-claims.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toMatch(/12 AI agents/);
  });

  it('audit-unauthorized-votes fails on a vote cast by a principal not entitled to cast it', () => {
    // The audit takes a database path, so this needs nothing from the tree: a
    // freshly migrated schema with one vote by a member whose membership does
    // not carry `can_vote_decisions`. That is the defect migration 010 left
    // open for as long as nothing read the column.
    const dbDir = mkdtempSync(join(tmpdir(), 'foundry-votes-'));
    const db = join(dbDir, 'votes.db');
    try {
      const migrations = readdirSync(resolve(ROOT, 'src/db/migrations'))
        .filter((f) => f.endsWith('.sql')).sort();
      for (const f of migrations) {
        try {
          execFileSync('sqlite3', [db], {
            input: readFileSync(resolve(ROOT, 'src/db/migrations', f), 'utf8'),
            stdio: ['pipe', 'ignore', 'ignore'],
          });
        } catch { /* the same per-statement tolerance the audit itself uses */ }
      }
      execFileSync('sqlite3', [db], { stdio: ['pipe', 'ignore', 'ignore'], input: [
        "INSERT INTO founders (id,clerk_user_id,email) VALUES ('gf_owner','gf_c1','o@example.com');",
        "INSERT INTO founders (id,clerk_user_id,email) VALUES ('gf_observer','gf_c2','i@example.com');",
        "INSERT INTO products (id,name,owner_id) VALUES ('gf_prod','Acme','gf_owner');",
        "INSERT INTO team_members (id,product_id,founder_id,role,status,can_vote_decisions)"
          + " VALUES ('gf_tm','gf_prod','gf_observer','investor_observer','active',0);",
        "INSERT INTO decisions (id,product_id,category,what,why_now,status)"
          + " VALUES ('gf_dec','gf_prod','strategic','Raise or not','runway',"
          + "'pending');",
        "INSERT INTO decision_votes (id,product_id,decision_id,founder_id,vote)"
          + " VALUES ('gf_v','gf_prod','gf_dec','gf_observer','approve');",
      ].join('\n') });

      const r = run('audit-unauthorized-votes.mjs', [db]);
      expect(r.code, r.output).toBe(1);
      expect(r.output).toContain('gf_observer');

      // And the same audit on the same schema with no such vote passes, so it
      // is reading the entitlement rather than refusing every vote.
      execFileSync('sqlite3', [db], { stdio: ['pipe', 'ignore', 'ignore'],
        input: "DELETE FROM decision_votes;" });
      expect(run('audit-unauthorized-votes.mjs', [db]).code).toBe(0);
    } finally {
      rmSync(dbDir, { recursive: true, force: true });
    }
  });

  it('check-star-select-columns does not believe a second CREATE that is a no-op', () => {
    // NINE TABLES IN THIS REPOSITORY ARE DECLARED MORE THAN ONCE, and a second
    // `CREATE TABLE IF NOT EXISTS` for a name that already exists does nothing
    // at all. This gate used to MERGE the loser's columns in, so a property
    // read off a `SELECT *` row that exists only in the losing declaration was
    // judged valid — while at runtime it is `undefined` forever, which is
    // exactly the defect the gate was written to catch.
    plant('src/db/migrations/993_gate_fixture_dup_a.sql',
      j('CREATE TABLE ', 'IF NOT EXISTS ', '_gate_fixture_dup (\n',
        '  id TEXT PRIMARY KEY,\n', '  real_column TEXT\n', ');\n'));
    plant('src/db/migrations/993_gate_fixture_dup_b.sql',
      j('CREATE TABLE ', 'IF NOT EXISTS ', '_gate_fixture_dup (\n',
        '  id TEXT PRIMARY KEY,\n', '  never_arrives TEXT\n', ');\n'));
    plant('src/services/_gate_fixture_dup_read.ts',
      'import { query } from "../db/client.js";\n'
      + 'export async function q(): Promise<unknown> {\n'
      + j('  const r = await query("SELECT ', '* FROM _gate_fixture_dup WHERE id = ?", [1]);\n')
      + '  const row = r.rows[0] as Record<string, unknown>;\n'
      + '  return row.never_arrives;\n'
      + '}\n');
    const r = run('check-star-select-columns.mjs');
    // The fixture reads a column only the LOSING declaration has.
    expect(r.output).not.toContain('real_column');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('never_arrives');
  });

  it('every baselined gate refuses a baseline entry that names no real offender', () => {
    // A BASELINE ENTRY THAT NO LONGER NAMES A REAL OFFENDER IS A PERMANENT
    // EXEMPTION — the ratchet failing in the exact direction it exists to
    // prevent. Fix the offender, leave the line, and the day somebody
    // reintroduces it at that same place the gate says nothing, because it is
    // "known".
    //
    // This was measured rather than reasoned about: a probe line appended to
    // each of the eleven baselines found THREE gates accepting an entry that
    // matched no finding — `check-id-tiebreak`, `check-route-guards` and
    // `check-star-select-columns`. The other eight already refused. The probe
    // is kept as a test because the property belongs to the FAMILY of gates,
    // not to any one of them, and the next gate somebody adds should inherit
    // it or be found not to have.
    const pairs: Array<[string, string]> = [
      ['check-gates-are-tested.mjs', 'docs/db/untested-gates-baseline.txt'],
      ['check-id-tiebreak.mjs', 'docs/db/id-tiebreak-baseline.txt'],
      ['check-integration-status-vocabulary.mjs', 'docs/db/integration-status-literals-baseline.txt'],
      ['check-reachability.mjs', 'docs/db/unreachable-modules-baseline.txt'],
      ['check-route-guards.mjs', 'docs/db/unguarded-route-baseline.txt'],
      ['check-star-select-columns.mjs', 'docs/db/star-select-baseline.txt'],
      ['check-tenant-scope.mjs', 'docs/db/tenant-scope-baseline.txt'],
      ['check-test-schema-fabrication.mjs', 'docs/db/test-schema-fabrication-baseline.txt'],
      ['check-unread-tables.mjs', 'docs/db/unread-tables-baseline.txt'],
      ['check-unreferenced-tables.mjs', 'docs/db/unreferenced-tables-baseline.txt'],
      ['check-write-only-columns.mjs', 'docs/db/write-only-columns-baseline.txt'],
    ];
    // A line no scanner can produce: not a path that exists, not a route that
    // is served, not a table or column any migration declares.
    const probe = j('src/_gate_probe_', 'nothing_here.ts:1 nothing.nowhere');

    for (const [gate, baselinePath] of pairs) {
      const abs = resolve(ROOT, baselinePath);
      const saved = readFileSync(abs, 'utf8');
      try {
        writeFileSync(abs, `${saved.trimEnd()}\n${probe}\n`);
        const r = run(gate);
        expect(r.code, `${gate} accepted a baseline entry matching nothing:\n${r.output}`)
          .toBe(1);
      } finally {
        writeFileSync(abs, saved);
      }
      expect(readFileSync(abs, 'utf8')).toBe(saved);
    }
  });

  it('the gate that checks gates is itself proved to fail', () => {
    // IT FLAGGED ITSELF ON ITS FIRST RUN, and then stopped — because the
    // comment above these fixtures NAMES it, and a comment naming a script in a
    // file that runs other scripts looked exactly like coverage. An instrument
    // that counts a sentence about a gate as proof the gate works is the defect
    // it was written to find. Comments are stripped now, like every other
    // scanner here, and this is the planted defect that proves it still bites:
    // a gate chained into the check with no test that ever runs it.
    //
    // THE FIXTURE'S NAME IS ASSEMBLED, and the first attempt failed for the
    // reason this file's own header gives: a test must not look like the thing
    // it plants. Writing the fake gate's filename out in full put it in a test
    // that runs gates — which is exactly what this gate reads as coverage, so
    // the planted defect made itself look covered and the gate passed.
    const fixture = j('_gate_fixture_', 'unproved.mjs');
    const pkgPath = resolve(ROOT, 'package.json');
    const savedPkg = readFileSync(pkgPath, 'utf8');
    try {
      writeFileSync(pkgPath, savedPkg.replace(
        'node scripts/check-gates-are-tested.mjs',
        `node scripts/check-gates-are-tested.mjs && node scripts/${fixture}`,
      ));
      const r = run('check-gates-are-tested.mjs');
      expect(r.code, r.output).toBe(1);
      expect(r.output).toContain(fixture);
    } finally {
      writeFileSync(pkgPath, savedPkg);
    }
    // And the tree is left exactly as it was, which the next assertion needs.
    expect(readFileSync(pkgPath, 'utf8')).toBe(savedPkg);
    expect(run('check-gates-are-tested.mjs').code).toBe(0);
  });

  it('check-schema-snapshot fails when a migration adds an object the snapshot lacks', () => {
    // THE GATE THAT EXISTS BECAUSE A NOTE WAS NOT ENOUGH. The committed
    // snapshot was caught stale twice in one session by
    // `foundry-self-observation.test.ts` — correct, and twenty-five minutes
    // into a full run each time, the second time by the same person who had
    // written "regenerate it after the last migration of a batch" into the
    // checkpoint an hour earlier. A note that must be remembered at the right
    // moment is not a control; the distance between the mistake and its
    // discovery is what makes it expensive.
    plant('src/db/migrations/996_gate_fixture_snapshot.sql',
      j('CREATE TABLE ', 'IF NOT EXISTS ', '_gate_fixture_unsnapshotted (id TEXT PRIMARY KEY);\n'));
    const r = run('check-schema-snapshot.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('_gate_fixture_unsnapshotted');
  });

  it('check-unreferenced-tables does not call a foreign-key parent unreachable', () => {
    // THE EXPENSIVE ONE. Migration 215 dropped eleven tables this gate had
    // listed and fifty test files went red on `no such table:
    // main.agent_message_threads`, because `agent_messages.thread_id`
    // REFERENCES it and `foreign_keys = 1` makes SQLite resolve that on every
    // DELETE against the child — so the erasure path could not complete. A
    // table no TypeScript names is still reached by the database itself on
    // every write to whatever points at it.
    plant('src/db/migrations/997_gate_fixture_fk.sql',
      j('CREATE TABLE ', 'IF NOT EXISTS ', '_gate_fixture_fk_parent (\n',
        '  id TEXT PRIMARY KEY\n', ');\n',
        'ALTER TABLE products ADD COLUMN _gate_fixture_ptr TEXT ',
        'REFERENCES _gate_fixture_fk_parent(id);\n'));
    const r = run('check-unreferenced-tables.mjs');
    expect(r.code, r.output).toBe(0);
    expect(r.output).not.toContain('_gate_fixture_fk_parent');
  });

  it('check-unreferenced-tables ignores a foreign key whose column was dropped', () => {
    // The other direction, and the reason the rule tracks columns rather than
    // just counting REFERENCES: a pointer that has since been removed points at
    // nothing, and a table only such a pointer reached IS unreachable. This is
    // what migration 216 did to `thread_id` and `holdout_id`.
    plant('src/db/migrations/997_gate_fixture_fk.sql',
      j('CREATE TABLE ', 'IF NOT EXISTS ', '_gate_fixture_fk_parent (\n',
        '  id TEXT PRIMARY KEY\n', ');\n',
        'ALTER TABLE products ADD COLUMN _gate_fixture_ptr TEXT ',
        'REFERENCES _gate_fixture_fk_parent(id);\n',
        'ALTER TABLE products DROP COLUMN _gate_fixture_ptr;\n'));
    const r = run('check-unreferenced-tables.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('_gate_fixture_fk_parent');
  });

  it('check-unreferenced-tables follows a rebuild through its rename', () => {
    // SQLite cannot alter a constraint in place, so a rebuild is CREATE x_new,
    // copy, DROP x, RENAME x_new TO x. Reading only CREATE and DROP left twelve
    // phantom `_new` tables on the first run of this gate — a false positive
    // rate that would have made the baseline meaningless.
    plant('src/db/migrations/999_gate_fixture_rebuild.sql',
      j('CREATE TABLE IF NOT EXISTS _gate_fixture_rebuilt_new (\n',
        '  id TEXT PRIMARY KEY\n', ');\n',
        'ALTER TABLE _gate_fixture_rebuilt_new RENAME TO products;\n'));
    const r = run('check-unreferenced-tables.mjs');
    // The intermediate is gone, not reported, and the renamed target is a table
    // live code reads, so the tree is still clean.
    expect(r.code, r.output).toBe(0);
    expect(r.output).not.toContain('_gate_fixture_rebuilt_new');
  });

  it('check-no-raw-control-bytes fails on a raw NUL in source', () => {
    // git calls a file binary if a NUL sits in its first 8000 bytes, and then
    // prints "Binary files differ" instead of the change — in git diff, in
    // git show, and in a pull request review. Two real files here had one, both
    // deliberate, both correct in intent and wrong in encoding.
    //
    // The byte is built at runtime so this file does not contain the defect it
    // plants: the gate scans tests/ too.
    plant('src/services/_gate_fixture_n.ts',
      j('export const SENTINEL = ', "'", String.fromCharCode(0), 'marker', "'", ';\n'));
    const r = run('check-no-raw-control-bytes.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('_gate_fixture_n');
    expect(r.output).toContain('raw NUL');
    // And it says WHY it matters, because the cost is invisible otherwise.
    expect(r.output).toContain('binary');
  });

  it('check-no-raw-control-bytes fails on a control byte that git would tolerate', () => {
    // A NUL past the 8000-byte mark still leaves git willing to diff the file,
    // so the gate cannot key on git's own threshold. An ESC or a stray CR costs
    // no diff at all and is still not something source has a reason to carry.
    plant('src/services/_gate_fixture_esc.ts',
      j('export const S = ', "'", String.fromCharCode(0x1b), '[0m', "'", ';\n'));
    const r = run('check-no-raw-control-bytes.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('_gate_fixture_esc');
    expect(r.output).toContain('raw ESC');
  });

  it('check-backticks-in-embedded-comments sees inside a NESTED template', () => {
    // The state was a boolean and template literals nest. A line like
    // `${rows.map((r) => html` opens a second template inside the first — one
    // backtick, odd — so the flag flipped OFF and everything inside the nested
    // template was invisible. Which is where the HTML actually is. A real
    // defect sailed through this gate while tsc reported the parse error.
    plant('src/services/_gate_fixture_nest.ts',
      j('export const page = (rows: string[]): string => `\n',
        '  <div>\n',
        '    ${rows.map((r) => `\n',
        '      <', '!-- naming a ', '`', 'symbol', '`', ' in here --', '>\n',
        '      <span>${r}</span>`)}\n',
        '  </div>`;\n'));
    const r = run('check-backticks-in-embedded-comments.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('_gate_fixture_nest');
  });

  it('check-backticks-in-embedded-comments does not read TypeScript prose as markup', () => {
    // The first version of the simplification flagged the gate's own header,
    // because a comment explaining the rule names the markup it is about. A
    // line of TypeScript prose cannot be embedded markup.
    plant('src/services/_gate_fixture_prose.ts',
      j('// A note that mentions <', '!-- an HTML comment --', '> and a ', '`', 'symbol', '`', '.\n',
        'export const x = 1;\n'));
    const r = run('check-backticks-in-embedded-comments.mjs');
    expect(r.code, r.output).toBe(0);
  });

  it('check-id-tiebreak fails on a new ORDER BY that falls back to id', () => {
    // An id is not a clock. Three real defects in one campaign came from a
    // nanoid or a content hash deciding which row was current.
    plant('src/services/_gate_fixture_t.ts',
      j('import { query } from "../db/client.js";\n',
        'export const q = () => query(`SELECT id FROM products\n',
        '  ORDER ', 'BY created_at DESC, id DESC LIMIT 1`, []);\n'));
    const r = run('check-id-tiebreak.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('_gate_fixture_t');
  });

  it('audit-consequential-effects fails on an outward call its rules cannot see', () => {
    // The window blind spot: a POST to a URL held in a variable matched no rule
    // and was therefore absent from the inventory rather than reported.
    plant('src/services/_gate_fixture_k.ts',
      'export async function sneak(endpoint: string): Promise<void> {\n'
      + '  await fetch(endpoint, { headers: {}, body: "{}", method: "POST" });\n'
      + '}\n');
    const r = run('audit-consequential-effects.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('_gate_fixture_k');
  });
});

describe('and passes on a clean tree', () => {
  it('every gate is green with nothing planted', () => {
    // The other half of the mutation: a gate that always fails is as useless as
    // one that never does.
    for (const script of [
      'check-sql-columns.mjs', 'check-select-columns.mjs', 'check-insert-columns.mjs',
      'check-check-vocabularies.mjs', 'check-autonomous-approval.mjs',
      'check-route-guards.mjs', 'check-kernel-boundary.mjs',
      'check-test-schema-fabrication.mjs', 'audit-consequential-effects.mjs',
      'check-writerless-tables.mjs', 'check-notnull-inserts.mjs',
      'check-write-only-columns.mjs', 'check-backticks-in-embedded-comments.mjs',
      'check-id-tiebreak.mjs',
    ]) {
      const r = run(script);
      expect(r.code, `${script}: ${r.output}`).toBe(0);
    }
  });
});
