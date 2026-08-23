process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { benchmarkProduct } from '../../src/services/portfolio/manager.js';

// =============================================================================
// A YARDSTICK YOU CONTROL ON BOTH SIDES.
//
// `benchmarkProduct` scoped the PEER SET to the portfolio — `allMetrics` joins
// `portfolio_memberships` — and read the SUBJECT straight out of
// `metric_snapshots` by the id in the URL. The route checks only that the
// caller owns the PORTFOLIO, and `POST /api/portfolios` is unrestricted, so any
// authenticated founder could mint a portfolio and benchmark any product id in
// the system against it. That is RT02-05, raised by the red-team audit as P1
// and never remediated.
//
// It survived a reading because the response does not echo the subject's raw
// numbers: it returns a percentile. But the caller controls BOTH SIDES. Seed
// the portfolio with one product of your own, set that product's metrics
// through `POST /api/products/:id/metrics` — an upsert on
// (product_id, snapshot_date), so it can be rewritten all day — and the
// percentile collapses to a strict inequality against a threshold you choose.
// Bisection then recovers another company's exact active_users, churn_rate,
// activation_rate and nps_score.
//
// RT02-06's fix does not close it. That one made `addToPortfolio` refuse a
// company the caller does not own; the attacker never needed the victim IN the
// portfolio, only their own product as the yardstick.
//
// NULL RATHER THAN THE "never reported" BRANCH. A company that is not in this
// portfolio and a company that has reported nothing are different facts, and
// that branch is a statement about the company.
// =============================================================================

const OWNER = 'f_pf';
const VICTIM = 'f_vic';
const MINE = 'p_mine';
const THEIRS = 'p_theirs';
const PF = 'pf_1';

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  for (const [id, email] of [[OWNER, 'pf@x.com'], [VICTIM, 'v@x.com']]) {
    await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)', [id, `c_${id}`, email]);
  }
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Mine',?,'active')", [MINE, OWNER]);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Theirs',?,'active')", [THEIRS, VICTIM]);
  await query(
    `INSERT INTO portfolios (id, name, owner_email, organization_type, api_key)
     VALUES (?, 'Mine', 'pf@x.com', 'vc_fund', 'pfk_x')`, [PF]);
});

beforeEach(async () => {
  await query('DELETE FROM portfolio_memberships');
  await query('DELETE FROM metric_snapshots');
});

async function member(productId: string, founderId: string): Promise<void> {
  await query(
    `INSERT INTO portfolio_memberships (id, portfolio_id, product_id, founder_id, status)
     VALUES (?, ?, ?, ?, 'active')`, [nanoid(), PF, productId, founderId]);
}

async function reports(productId: string, activeUsers: number): Promise<void> {
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, active_users, churn_rate)
     VALUES (?, ?, date('now'), ?, 0.05)`, [nanoid(), productId, activeUsers]);
}

describe('a company that is not in the portfolio', () => {
  it('cannot be benchmarked against it at all', async () => {
    await member(MINE, OWNER);
    await reports(MINE, 100);
    await reports(THEIRS, 900);

    expect(await benchmarkProduct(PF, THEIRS)).toBeNull();
  });

  it('is refused even when it has reported nothing, which is a different fact', async () => {
    await member(MINE, OWNER);
    await reports(MINE, 100);

    // The old code would have fallen into the "never reported a metric
    // snapshot" branch and said so about a company it had no business reading.
    expect(await benchmarkProduct(PF, THEIRS)).toBeNull();
  });

  it('closes the oracle: the answer does not move with the yardstick', async () => {
    await member(MINE, OWNER);
    await reports(THEIRS, 500);

    // The bisection step, twice, with the attacker's own metric on either side
    // of the victim's. Both must be indistinguishable.
    await reports(MINE, 100);
    const low = await benchmarkProduct(PF, THEIRS);
    await query('DELETE FROM metric_snapshots WHERE product_id = ?', [MINE]);
    await reports(MINE, 900);
    const high = await benchmarkProduct(PF, THEIRS);

    expect(low).toBeNull();
    expect(high).toBeNull();
  });
});

describe('a company that is in the portfolio', () => {
  it('is still benchmarked', async () => {
    await member(MINE, OWNER);
    await member(THEIRS, VICTIM);
    await reports(MINE, 100);
    await reports(THEIRS, 900);

    const result = await benchmarkProduct(PF, THEIRS);

    expect(result).not.toBeNull();
    expect(result!.performance_percentile.active_users).toBeGreaterThan(0);
  });

  it('still says so when a member has reported nothing', async () => {
    await member(MINE, OWNER);
    await member(THEIRS, VICTIM);
    await reports(MINE, 100);

    const result = await benchmarkProduct(PF, THEIRS);

    expect(result).not.toBeNull();
    expect(result!.not_comparable.map((n) => n.reason))
      .toContain('this company has never reported a metric snapshot');
  });

  it('refuses one whose membership was withdrawn', async () => {
    await member(MINE, OWNER);
    await query(
      `INSERT INTO portfolio_memberships (id, portfolio_id, product_id, founder_id, status)
       VALUES (?, ?, ?, ?, 'removed')`, [nanoid(), PF, THEIRS, VICTIM]);
    await reports(MINE, 100);
    await reports(THEIRS, 900);

    expect(await benchmarkProduct(PF, THEIRS)).toBeNull();
  });
});
