process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getMRRDecomposition } from '../../src/services/intelligence/revenue.js';

// =============================================================================
// A FLAT MONTH NOBODY REPORTED.
//
// `getMRRDecomposition` read the LATEST metric snapshot, full stop. The daily
// job writes a placeholder row carrying nothing but (id, product_id,
// snapshot_date); that row is the latest one on every ordinary day; and the
// four movement columns are `INTEGER DEFAULT 0`. So this returned a confident
// decomposition of zeros for essentially every company, every day.
//
// Ten modules import from here. The founder's chat context listed new $0,
// churned $0, expansion $0, contraction $0 as measured facts. The digest email
// printed a net-new figure. The COO prompt was told "net new this period: $0".
// And the voice briefing SPOKE ALOUD "Net new MRR this period: flat" — a
// statement about the month, from a row that recorded nothing.
//
// WHAT THIS DOES NOT FIX, because a query cannot: those four columns are
// DEFAULT 0, so a company that reported a genuine zero and one that reported no
// movement at all store the same value. Reading a row that reported SOMETHING
// removes the systematic daily fabrication; it does not make that row's
// movements distinguishable from unreported. The end state is those columns
// nullable, which is a table rebuild plus every reader that adds them up — and
// rows already written can never be repaired, because the information that
// would tell 0 from unknown was never stored.
// =============================================================================

const P = 'p_rev';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_r2','c_r2','r2@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_r2','active')", [P]);
});

beforeEach(async () => { await query('DELETE FROM metric_snapshots WHERE product_id = ?', [P]); });

/** Exactly what the daily job writes. */
async function placeholder(daysAgo: number): Promise<void> {
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date)
     VALUES (?, ?, date('now', ?))`, [nanoid(), P, `-${daysAgo} days`]);
}

async function reported(daysAgo: number, fields: {
  level?: number; newMrr?: number; churned?: number; expansion?: number; contraction?: number;
}): Promise<void> {
  await query(
    `INSERT INTO metric_snapshots
       (id, product_id, snapshot_date, mrr_cents, new_mrr_cents, churned_mrr_cents,
        expansion_mrr_cents, contraction_mrr_cents)
     VALUES (?, ?, date('now', ?), ?, ?, ?, ?, ?)`,
    [nanoid(), P, `-${daysAgo} days`, fields.level ?? null,
     fields.newMrr ?? 0, fields.churned ?? 0, fields.expansion ?? 0, fields.contraction ?? 0]);
}

describe('a company whose latest row is the daily placeholder', () => {
  it('reports nothing rather than a decomposition of zeros', async () => {
    await placeholder(0);

    expect(await getMRRDecomposition(P)).toBeNull();
  });

  it('reads past it to the last figures the company actually gave', async () => {
    await reported(3, { level: 5_000_00, newMrr: 20_000, churned: 5_000 });
    await placeholder(1);
    await placeholder(0);

    const mrr = await getMRRDecomposition(P);

    expect(mrr).not.toBeNull();
    expect(mrr!.level_cents).toBe(5_000_00);
    expect(mrr!.new_cents).toBe(20_000);
    expect(mrr!.churned_cents).toBe(5_000);
    expect(mrr!.net_new_cents).toBe(15_000);
  });

  it('does not read past a real report to an older one', async () => {
    await reported(10, { level: 1_000_00, newMrr: 99_999 });
    await reported(1, { level: 5_000_00, newMrr: 20_000 });
    await placeholder(0);

    const mrr = await getMRRDecomposition(P);
    expect(mrr!.level_cents).toBe(5_000_00);
    expect(mrr!.new_cents).toBe(20_000);
  });

  it('counts a level-only report as a report', async () => {
    // What the Stripe adapter writes since it stopped inventing movements: the
    // level, and nothing else.
    await reported(1, { level: 5_000_00 });
    await placeholder(0);

    const mrr = await getMRRDecomposition(P);
    expect(mrr).not.toBeNull();
    expect(mrr!.level_cents).toBe(5_000_00);
    // And the health ratio abstains, because there is no new MRR to divide by.
    expect(mrr!.health_ratio).toBeNull();
  });

  it('counts a movement-only report as a report', async () => {
    await reported(1, { newMrr: 20_000, churned: 4_000 });
    await placeholder(0);

    const mrr = await getMRRDecomposition(P);
    expect(mrr).not.toBeNull();
    expect(mrr!.level_cents).toBeNull();
    expect(mrr!.health_ratio).toBeCloseTo(0.2, 6);
  });

  // Each movement column has to carry the test on its own, or a clause can be
  // dropped from the predicate without anything noticing — which is what the
  // first version of this file let happen.
  it.each([
    ['new business', { newMrr: 20_000 }],
    ['churn', { churned: 4_000 }],
    ['expansion', { expansion: 3_000 }],
    ['contraction', { contraction: 2_000 }],
  ])('counts a report of %s alone as a report', async (_label, fields) => {
    await reported(1, fields as {
      newMrr?: number; churned?: number; expansion?: number; contraction?: number });
    await placeholder(0);

    expect(await getMRRDecomposition(P)).not.toBeNull();
  });

  it('reports nothing for a company that has never said anything', async () => {
    expect(await getMRRDecomposition(P)).toBeNull();
  });
});
