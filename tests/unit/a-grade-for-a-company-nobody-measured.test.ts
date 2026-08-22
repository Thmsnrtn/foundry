process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { calculateHealthScore } from '../../src/services/intelligence/health-score.js';
import { computeHealthRatio, getMRRDecomposition, computeTotalMRR } from '../../src/services/intelligence/revenue.js';

// =============================================================================
// A GRADE FOR A COMPANY NOBODY HAD MEASURED.
//
// Every component of the composite health score substituted a number when it
// had nothing, and every one substituted in a different direction:
//
//   audit       `composite ?? 0` → 0/100 for a company never audited, at 35%
//               weight. The LABEL said "Not run" — the label told the truth and
//               the number did not, and the number is what was weighted.
//   revenue     a null health ratio became 0, and `(1 - value) * 100` turned
//               that into 100/100. The best possible revenue score for the
//               absence of new MRR to divide by.
//   risk        `risk_state ?? 'green'` — no lifecycle state read as healthy,
//               and with no stressors that is 100/100.
//   engagement  a default of 100 with deductions, so a company with nothing to
//               deduct from scored high.
//
// A brand-new company came out around 57 — grade C, "Mixed signals. Some
// components need attention." A verdict about a company with no data at all,
// served through the MCP tool an outside model reads. `getAuditContext`, forty
// lines below it in the same file, correctly says "No audit has been run yet".
//
// AND THE FIELD CALLED `total_cents` WAS ONE PERIOD'S NET CHANGE. It was
// `new + expansion - contraction - churned` and it was displayed as "MRR" in the
// voice briefing, the weekly digest email, the COO chat context, the
// conversation context and the dashboard card. A company at $50k MRR with a flat
// month was told its MRR was $0 — and heard it spoken aloud.
//
// It is `net_new_cents` now, with `level_cents` beside it. RENAMED rather than
// fixed in place, so that no reader could keep treating the movement as the
// level by accident: the compiler made every call site declare itself.
// =============================================================================

const P = 'p_hs';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_hs','c_hs','h@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_hs','active')", [P]);
});
beforeEach(async () => {
  await query('DELETE FROM metric_snapshots');
  await query('DELETE FROM audit_scores');
  await query('DELETE FROM lifecycle_state');
});

async function snap(cols: Record<string, number>) {
  const keys = Object.keys(cols);
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, ${keys.join(', ')})
     VALUES (?, ?, date('now'), ${keys.map(() => '?').join(', ')})`,
    [nanoid(), P, ...keys.map((k) => cols[k]!)]);
}

describe('a company with nothing measured', () => {
  it('has no health score and no grade', async () => {
    const h = await calculateHealthScore(P);
    expect(h.score, 'it used to come out around 57 — a C').toBeNull();
    expect(h.grade).toBeNull();
    expect(h.coverage).toBeNull();
  });

  it('is told so rather than given a verdict', async () => {
    const h = await calculateHealthScore(P);
    expect(h.headline).toMatch(/Not enough has been measured/);
    expect(h.summary).toMatch(/no health score/);
  });

  it('has no component scores, and labels that already said so', async () => {
    const h = await calculateHealthScore(P);
    expect(h.components.audit.score).toBeNull();
    expect(h.components.audit.label, 'the label was right the whole time').toBe('Not run');
    expect(h.components.revenue.score).toBeNull();
    expect(h.components.risk.score).toBeNull();
    expect(h.components.risk.label).toBe('No lifecycle state');
    expect(h.components.engagement.score).toBeNull();
  });
});

describe('a company with some of it measured', () => {
  it('scores over what was measured and says how much that is', async () => {
    await query(
      `INSERT INTO lifecycle_state (product_id, risk_state) VALUES (?, 'green')`, [P]);

    const h = await calculateHealthScore(P);
    expect(h.score, 'risk alone, renormalised, is the risk score itself').toBe(100);
    expect(h.coverage).toBeCloseTo(0.25, 5);
    expect(h.summary).toMatch(/rests on 25% of its weighting/);
    expect(h.summary).toMatch(/Not measured: audit, revenue, engagement/);
  });

  it('does not let an unmeasured component drag the score down', async () => {
    // The audit is the 35% component. Never run, it used to contribute 0.
    await query(
      `INSERT INTO lifecycle_state (product_id, risk_state) VALUES (?, 'green')`, [P]);
    const h = await calculateHealthScore(P);
    expect(h.score, '0.35 * 0 would have made this 25').toBe(100);
  });
});

describe('the MRR health ratio', () => {
  it('is unknown when there was no new MRR to divide by', async () => {
    await snap({ mrr_cents: 5_000_000, new_mrr_cents: 0, churned_mrr_cents: 10_000 });
    const d = (await getMRRDecomposition(P))!;
    const h = computeHealthRatio(d);
    expect(h.value, '`?? 0` fell straight through to the first branch').toBeNull();
    expect(h.indicator, 'and that branch is GREEN').toBe('unknown');
  });

  it('is a real ratio when there was', async () => {
    await snap({ mrr_cents: 5_000_000, new_mrr_cents: 100_000, churned_mrr_cents: 90_000 });
    const h = computeHealthRatio((await getMRRDecomposition(P))!);
    expect(h.value).toBeCloseTo(0.9, 5);
    expect(h.indicator).toBe('red');
  });
});

describe('the level and the movement', () => {
  it('are separate fields with separate names', async () => {
    await snap({
      mrr_cents: 5_000_000, new_mrr_cents: 100_000, expansion_mrr_cents: 20_000,
      contraction_mrr_cents: 10_000, churned_mrr_cents: 110_000,
    });
    const d = (await getMRRDecomposition(P))!;
    expect(d.level_cents, 'what a founder means by MRR').toBe(5_000_000);
    expect(d.net_new_cents, 'and what the old `total_cents` actually was').toBe(0);
  });

  it('report the level as null when nobody supplied one', async () => {
    await snap({ new_mrr_cents: 100_000 });
    expect((await getMRRDecomposition(P))!.level_cents).toBeNull();
  });

  it('and computeTotalMRR reads the level rather than summing two periods', async () => {
    await snap({ mrr_cents: 5_000_000, new_mrr_cents: 100_000 });
    expect(await computeTotalMRR(P)).toBe(5_000_000);
  });

  it('with null when there is no level anywhere', async () => {
    await snap({ new_mrr_cents: 100_000 });
    expect(await computeTotalMRR(P)).toBeNull();
  });
});

describe('no surface still shows the movement as MRR', () => {
  const SURFACES = [
    'src/services/voice/briefing.ts',
    'src/services/digest/delivery.ts',
    'src/services/chat/coo.ts',
    'src/services/conversation/context.ts',
    'src/views/components.ts',
    'src/mcp/server.ts',
  ];

  it('none of them reads total_cents', () => {
    for (const f of SURFACES) {
      expect(stripComments(readFileSync(f, 'utf8'), { lineComments: true }), `${f}`)
        .not.toMatch(/total_cents/);
    }
  });

  it('and each says "not reported" rather than printing a zero', () => {
    for (const f of ['src/services/voice/briefing.ts', 'src/services/digest/delivery.ts',
                     'src/views/components.ts', 'src/mcp/server.ts']) {
      expect(readFileSync(f, 'utf8'), `${f}`).toMatch(/[Nn]ot reported/);
    }
  });
});
