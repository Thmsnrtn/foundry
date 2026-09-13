process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// =============================================================================
// A COLUMN THAT WAS NEVER THERE, READ OFF A `SELECT *` ROW.
//
// `check-select-columns` reads the columns a query NAMES. It cannot see
// `SELECT *`, and that is where this class lives: the row is
// `Record<string, unknown>`, a property that is not a column is `undefined`,
// and `as number` satisfies the compiler. Nothing throws, ever.
//
// TEN of these were found in one cycle, all in surfaces a founder shows to
// somebody else: `mrr_growth_pct` in the fundraising readiness score, the
// monthly investor update, the compressed briefing and the BOARD PACKET;
// `customer_count` in two of those and in the M&A readiness score;
// `d30_retention` where the column is `day_30_retention`; and five DNA fields
// that made four boolean flags false for every company.
//
// This holds the gate that replaces reading each file by hand.
//
// THE DEFECTS ARE PLANTED INTO A FIXTURE MODULE, NOT INTO A REAL ONE. Until now
// each case was planted into `scp/investor/board-packet.ts` — one of the ten
// originals — by string-replacing a line of its source and restoring it
// afterwards. That module has since been deleted as production-dead, and with
// it every other file in the original ten. Pinning the gate to whichever real
// file happens to survive is how this test dies again the next time one is
// removed; what it is actually about is the three SHAPES the gate has to see,
// so each is written out here in full and deleted again. `metric_snapshots` and
// its real columns are what the shapes are read against, so a rename there
// still reaches this.
// =============================================================================

const GATE = 'scripts/check-star-select-columns.mjs';
const FIXTURE = 'src/services/_gate_fixture_star_select.ts';

function runGate(): { code: number; out: string } {
  try {
    const out = execFileSync('node', [GATE], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { code: e.status, out: `${e.stdout}${e.stderr}` };
  }
}

/** Write the fixture module. `src/services` is tracked and full, but the
 *  directory is created anyway: git does not track empty directories, and a
 *  sibling test in this suite was failing on a fresh clone for exactly that. */
function plant(body: string): void {
  mkdirSync(dirname(FIXTURE), { recursive: true });
  writeFileSync(FIXTURE, `import { query } from '../db/client.js';\n\n${body}\n`);
}

afterEach(() => { rmSync(FIXTURE, { force: true }); });

describe('the gate', () => {
  it('passes on the tree as it stands', () => {
    const { code, out } = runGate();
    expect(out).toContain('star-select reads');
    expect(code).toBe(0);
  });

  it('fails when a phantom column is read from a declared row', () => {
    plant([
      'export async function readIt(productId: string): Promise<number | null> {',
      "  const result = await query('SELECT * FROM metric_snapshots WHERE product_id = ?', [productId]);",
      '  const metricsSnapshot = result.rows[0] as unknown as Record<string, unknown>;',
      '  return (metricsSnapshot.mrr_growth_pct as number) ?? null;',
      '}',
    ].join('\n'));

    const { code, out } = runGate();
    expect(code, 'the planted read was not reported').toBe(1);
    expect(out).toContain('metric_snapshots.mrr_growth_pct');
  });

  it('fails when the row was ASSIGNED rather than declared', () => {
    // The shape the investor update used — `let row = {}; … row = r.rows[0]` —
    // which the first version of this gate could not see, so planting that
    // file's own defect back into it reported nothing.
    plant([
      'export async function readIt(productId: string): Promise<number | null> {',
      '  let metricsSnapshot: Record<string, unknown> = {};',
      "  const result = await query('SELECT * FROM metric_snapshots WHERE product_id = ?', [productId]);",
      '  metricsSnapshot = result.rows[0] as unknown as Record<string, unknown>;',
      '  return (metricsSnapshot.customer_count as number) ?? null;',
      '}',
    ].join('\n'));

    const { code, out } = runGate();
    expect(code).toBe(1);
    expect(out).toContain('metric_snapshots.customer_count');
  });

  it('does not report a lambda parameter that shadows a row variable', () => {
    // `allPaths.some((p) => p.endsWith('.ts'))` was reported as
    // `audit_scores.endsWith` by the version of this that had no scoping.
    plant([
      'export async function readIt(productId: string): Promise<string[]> {',
      "  const result = await query('SELECT * FROM metric_snapshots WHERE product_id = ?', [productId]);",
      '  const metricsSnapshot = result.rows[0] as unknown as Record<string, unknown>;',
      '  void metricsSnapshot.mrr_cents;',
      "  return ['a.ts'].filter((metricsSnapshot: string) => metricsSnapshot.endsWith('.ts'));",
      '}',
    ].join('\n'));

    const { code, out } = runGate();
    expect(code, `a shadowing parameter was read as a row:\n${out}`).toBe(0);
  });
});
