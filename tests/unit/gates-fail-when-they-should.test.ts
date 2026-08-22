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
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { resolve } from 'path';

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

function run(script: string): { code: number; output: string } {
  try {
    const output = execFileSync('node', [resolve(ROOT, 'scripts', script)],
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
    // `sector_remediation_templates` exists in the schema and is reached by
    // nothing at all — no writer, no reader, no trigger, not in the erasure
    // map. Giving it a writer is exactly the moment this gate exists to catch:
    // a record starting to be kept that nobody looks at. (`onboarding_checklist`
    // would NOT do here — it is in the erasure map, so the export's dynamic
    // `SELECT * FROM ${table}` reads it and the gate is right to say so.)
    plant('src/services/_gate_fixture_unread.ts',
      'import { query } from "../db/client.js";\n'
      + j('export const q = () => query(`INSERT ', 'INTO sector_remediation_templates ',
        '(id) VALUES (?)`, [1]);\n'));
    const r = run('check-unread-tables.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('sector_remediation_templates');
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
