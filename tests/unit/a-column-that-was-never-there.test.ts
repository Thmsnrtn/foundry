process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
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
// =============================================================================

const GATE = 'scripts/check-star-select-columns.mjs';
const TARGET = 'src/services/scp/investor/board-packet.ts';
let saved: string | null = null;

function runGate(): { code: number; out: string } {
  try {
    const out = execFileSync('node', [GATE], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { code: e.status, out: `${e.stdout}${e.stderr}` };
  }
}

afterEach(() => {
  if (saved !== null) { writeFileSync(TARGET, saved); saved = null; }
});

describe('the gate', () => {
  it('passes on the tree as it stands', () => {
    const { code, out } = runGate();
    expect(out).toContain('star-select reads');
    expect(code).toBe(0);
  });

  it('fails when a phantom column is read from a declared row', () => {
    saved = readFileSync(TARGET, 'utf8');
    writeFileSync(TARGET, saved.replace(
      'const mrrCents = (metricsSnapshot.mrr_cents as number) ?? null;',
      'const mrrCents = (metricsSnapshot.mrr_growth_pct as number) ?? null;'));

    const { code, out } = runGate();
    expect(code, 'the planted read was not reported').toBe(1);
    expect(out).toContain('metric_snapshots.mrr_growth_pct');
  });

  it('fails when the row was ASSIGNED rather than declared', () => {
    // The shape the investor update uses — `let row = {}; … row = r.rows[0]` —
    // which the first version of this gate could not see, so planting that
    // file's own defect back into it reported nothing.
    saved = readFileSync(TARGET, 'utf8');
    expect(saved).toContain('metricsSnapshot = metricsResult.rows[0]');
    writeFileSync(TARGET, saved.replace(
      'const growthDisplay = mrrGrowthPct !== null',
      'const ghost = metricsSnapshot.customer_count; void ghost;\n  const growthDisplay = mrrGrowthPct !== null'));

    const { code, out } = runGate();
    expect(code).toBe(1);
    expect(out).toContain('metric_snapshots.customer_count');
  });

  it('does not report a lambda parameter that shadows a row variable', () => {
    // `allPaths.some((p) => p.endsWith('.ts'))` was reported as
    // `audit_scores.endsWith` by the version of this that had no scoping.
    saved = readFileSync(TARGET, 'utf8');
    writeFileSync(TARGET, saved.replace(
      'const growthDisplay = mrrGrowthPct !== null',
      'const names = [\'a.ts\'].filter((metricsSnapshot) => metricsSnapshot.endsWith(\'.ts\'));\n  void names;\n  const growthDisplay = mrrGrowthPct !== null'));

    const { code } = runGate();
    expect(code, 'a shadowing parameter was read as a row').toBe(0);
  });
});
