process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getPortfolioSnapshots } from '../../src/services/portfolio/manager.js';

// =============================================================================
// A SNAPSHOT NOTHING COULD READ.
//
// `portfolio_snapshots` had two writers — a weekly job (`0 6 * * 1`) and
// `POST /api/portfolios/:id/snapshot`, which answered `{"status":"generated"}`
// — and no reader anywhere in the product. A trend was being accumulated one
// row a week that nobody could ever look at; the only path that reached the
// table at all was the erasure export.
//
// This pins the read half: the owner of the portfolio gets back what the job
// wrote, newest first; somebody else gets 404, not a portfolio's numbers.
// =============================================================================

const P = 'pf_snap';
const OWNER = 'owner@example.com';
const STRANGER = 'stranger@example.com';

beforeAll(async () => {
  await runMigrations();
  await query(
    "INSERT INTO portfolios (id, name, organization_type, owner_email) VALUES (?,'Fund','vc',?)",
    [P, OWNER],
  );
});

function appAs(email: string): Hono {
  const a = new Hono();
  a.use('*', async (c, next) => {
    c.set('founder' as never, { id: 'f_snap', email, preferences: {} } as never);
    await next();
  });
  return a;
}

async function get(email: string, path: string): Promise<Response> {
  const { platformApiRoutes } = await import('../../src/routes/api/platform.js');
  const a = appAs(email);
  a.route('/', platformApiRoutes as unknown as Hono);
  return a.request(path);
}

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

  it('the owner reads the trend; a stranger gets 404, not the numbers', async () => {
    await writeSnapshot('2026-01-12', 3, 9000);

    const mine = await get(OWNER, `/api/portfolios/${P}/snapshots`);
    expect(mine.status).toBe(200);
    const body = await mine.json() as { data: Array<{ snapshot_date: string }>; meta: { total: number } };
    expect(body.meta.total).toBe(1);
    expect(body.data[0]!.snapshot_date).toBe('2026-01-12');

    const theirs = await get(STRANGER, `/api/portfolios/${P}/snapshots`);
    expect(theirs.status).toBe(404);
    expect(await theirs.text()).not.toContain('9000');
  });

  it('a portfolio that does not exist is a 404, not an empty list', async () => {
    const res = await get(OWNER, '/api/portfolios/pf_nonexistent/snapshots');
    expect(res.status).toBe(404);
  });
});
