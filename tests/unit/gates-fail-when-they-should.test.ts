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

import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
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

  it('check-ladder-fixture-door fails on a new fixture entering through the dead door', () => {
    // The ladder's first rung is supplied by exactly one intake in production —
    // a company saying what it owes. `discovery.ts` also maps four SaaS event
    // types onto responsibilities, and nothing emits any of them. A test that
    // builds its state through that map is asserting against a state the
    // running system cannot reach, which is a defect that reads as coverage.
    plant('tests/unit/_gate_fixture_m.ts',
      j('export const evidence = { event_type: "', 'support_', 'spike" };\n'));
    const r = run('check-ladder-fixture-door.mjs');
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain('_gate_fixture_m');
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
      'check-ladder-fixture-door.mjs',
    ]) {
      const r = run(script);
      expect(r.code, `${script}: ${r.output}`).toBe(0);
    }
  });
});
