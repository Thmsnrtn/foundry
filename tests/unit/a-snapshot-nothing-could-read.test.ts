process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getPortfolioSnapshots } from '../../src/services/portfolio/manager.js';

// =============================================================================
// A SNAPSHOT NOTHING COULD READ.
//
// `portfolio_snapshots` was written by a weekly job (`0 6 * * 1`) and read by
// nothing anywhere in the product. A trend was being accumulated one row a week
// that nobody could ever look at; the only path that reached the table at all
// was the erasure export.
//
// The read half is `getPortfolioSnapshots`, and this pins its contract: it
// returns what the job wrote, newest first, and it is bounded — a caller asking
// for a million rows gets the ceiling, not a million. Both are properties of the
// service, not of whatever calls it, which is why they are asserted here
// directly. The HTTP reader that used to call it belonged to the Commercial
// Foundry surface and has been removed along with the rest of it; the ownership
// check that answered a stranger with 404 lived in that route and went with it,
// so nothing here asserts it any more. The service takes a portfolio id and no
// viewer, and any future caller owes its own authorisation check.
// =============================================================================

const P = 'pf_snap';
const OWNER = 'owner@example.com';

beforeAll(async () => {
  await runMigrations();
  await query(
    "INSERT INTO portfolios (id, name, organization_type, owner_email) VALUES (?,'Fund','vc',?)",
    [P, OWNER],
  );
});

beforeEach(async () => { await query('DELETE FROM portfolio_snapshots'); });

async function writeSnapshot(date: string, companies: number, mrr: number): Promise<void> {
  await query(
    `INSERT INTO portfolio_snapshots
       (id, portfolio_id, snapshot_date, total_companies, avg_mrr, median_mrr,
        companies_green, companies_yellow, companies_red, total_portfolio_mrr)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [`snap_${date}`, P, date, companies, mrr / companies, mrr / companies, companies, 0, 0, mrr],
  );
}

describe('the weekly portfolio snapshot is reachable', () => {
  it('returns what the job wrote, newest first', async () => {
    await writeSnapshot('2026-01-05', 2, 4000);
    await writeSnapshot('2026-01-12', 3, 9000);

    const rows = await getPortfolioSnapshots(P);
    expect(rows.map((r) => r.snapshot_date)).toEqual(['2026-01-12', '2026-01-05']);
    expect(rows[0]!.total_companies).toBe(3);
    expect(rows[0]!.total_portfolio_mrr).toBe(9000);
  });

  it('is bounded — a limit past the ceiling does not widen it', async () => {
    for (let w = 1; w <= 30; w++) {
      await writeSnapshot(`2026-${String(w).padStart(2, '0')}-01`.slice(0, 10), 1, 100);
    }
    const written = await query('SELECT COUNT(*) AS n FROM portfolio_snapshots');
    const total = Number((written.rows[0] as unknown as { n: number }).n);

    expect(await getPortfolioSnapshots(P, 5)).toHaveLength(5);
    expect((await getPortfolioSnapshots(P, 1_000_000)).length).toBeLessThanOrEqual(104);
    expect((await getPortfolioSnapshots(P, 1_000_000)).length).toBe(Math.min(total, 104));
  });

  it('reads only the portfolio it was asked for', async () => {
    // The route that used to scope this by viewer is gone. What the query
    // itself still guarantees is that a portfolio id is a boundary: rows
    // belonging to another portfolio never appear in this one's trend.
    await query(
      "INSERT INTO portfolios (id, name, organization_type, owner_email) VALUES ('pf_other','Other','vc','other@example.com')",
    );
    await writeSnapshot('2026-01-12', 3, 9000);
    await query(
      `INSERT INTO portfolio_snapshots
         (id, portfolio_id, snapshot_date, total_companies, avg_mrr, median_mrr,
          companies_green, companies_yellow, companies_red, total_portfolio_mrr)
       VALUES ('snap_other','pf_other','2026-01-19',7,1,1,7,0,0,77777)`,
    );

    const rows = await getPortfolioSnapshots(P);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.total_portfolio_mrr).toBe(9000);
    expect(rows.some((r) => r.total_portfolio_mrr === 77777)).toBe(false);
  });
});
