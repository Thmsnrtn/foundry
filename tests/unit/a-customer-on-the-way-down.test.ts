process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  getCustomerHealthTrends, getFallingCustomers, getCustomersAtRisk,
  FALLING_HEALTH_POINTS, TREND_WINDOW_DAYS,
} from '../../src/services/institution/company-customers.js';

// =============================================================================
// A CUSTOMER ON THE WAY DOWN.
//
// `customers.health_score` holds only where a customer IS. Every health refresh
// ALSO writes a dated row to `customer_health_snapshots` — the score, the churn
// risk, and the four components behind them — and nothing had ever read that
// table. So a customer sliding 90 → 70 → 55 looked identical, at 55, to one
// that had sat at 55 all year.
//
// Harbor's own system prompt says: "churn is never a surprise — it's always
// telegraphed 30-60 days in advance by behavioral signals that nobody watched.
// Your job is to watch them." The watching was being recorded and discarded, so
// the one thing that agent claims to be for was the one thing it could not see.
//
// Found by `check-unread-tables.mjs`, written one commit earlier, which is the
// argument for that gate: this table had been filled daily since migration 027.
// =============================================================================

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => {
  await query('DELETE FROM customer_health_snapshots');
  await query('DELETE FROM customers');
  await query('DELETE FROM products');
  await query('DELETE FROM founders');
});

let owner = '';
let productId = '';
async function company(): Promise<string> {
  owner = `f_${nanoid(8)}`;
  await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)',
    [owner, `c_${owner}`, `${owner}@example.com`]);
  productId = `p_${nanoid(8)}`;
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,?,?,'active')",
    [productId, 'C', owner]);
  return productId;
}

async function customer(healthNow: number, churnRisk: number | null = null): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO customers (id, product_id, owner_id, email, health_score, churn_risk)
     VALUES (?,?,?,?,?,?)`,
    [id, productId, owner, `${nanoid(6)}@example.com`, healthNow, churnRisk]);
  return id;
}

async function snapshot(customerId: string, daysAgo: number, score: number) {
  await query(
    `INSERT INTO customer_health_snapshots
       (id, customer_id, product_id, snapshot_date, health_score)
     VALUES (?,?,?, date('now', ?), ?)`,
    [nanoid(), customerId, productId, `-${daysAgo} days`, score]);
}

describe('a direction, not just a position', () => {
  it('sees a customer falling', async () => {
    await company();
    const id = await customer(55);
    await snapshot(id, 28, 90);
    await snapshot(id, 14, 70);
    await snapshot(id, 1, 55);

    const [trend] = await getCustomerHealthTrends(productId);
    expect(trend!.earliestScore).toBe(90);
    expect(trend!.latestScore).toBe(55);
    expect(trend!.deltaPoints).toBe(-35);
    expect(trend!.daysObserved).toBe(27);
  });

  it('tells a faller apart from somebody who has always been there', async () => {
    await company();
    const falling = await customer(55);
    await snapshot(falling, 28, 90);
    await snapshot(falling, 1, 55);
    const steady = await customer(55);
    await snapshot(steady, 28, 56);
    await snapshot(steady, 1, 55);

    const ids = (await getFallingCustomers(productId)).map((t) => t.customerId);
    expect(ids, 'both sit at 55 today').toEqual([falling]);
  });

  it('says nothing from a single reading', async () => {
    await company();
    const id = await customer(55);
    await snapshot(id, 1, 55);
    expect(await getCustomerHealthTrends(productId),
      'one snapshot is a position, not a direction').toEqual([]);
  });

  it('says nothing from two readings on the same day', async () => {
    await company();
    const id = await customer(55);
    await snapshot(id, 1, 90);
    await snapshot(id, 1, 55);
    expect(await getCustomerHealthTrends(productId)).toEqual([]);
  });

  it('ignores history older than the window', async () => {
    await company();
    const id = await customer(55);
    await snapshot(id, 200, 95);
    await snapshot(id, 2, 55);
    expect(await getCustomerHealthTrends(productId),
      'one reading inside the window is not a trend').toEqual([]);
  });

  it('does not call a small drift a fall', async () => {
    await company();
    const id = await customer(80);
    await snapshot(id, 20, 80 + (FALLING_HEALTH_POINTS - 1));
    await snapshot(id, 1, 80);
    expect(await getFallingCustomers(productId)).toEqual([]);
  });
});

describe('who this changes things for', () => {
  it('does NOT widen the set the outbound departments act on', async () => {
    await company();
    // Falling fast, but still well above the at-risk threshold.
    const id = await customer(78, 0.2);
    await snapshot(id, 28, 95);
    await snapshot(id, 1, 78);

    expect((await getFallingCustomers(productId)).map((t) => t.customerId)).toEqual([id]);
    expect(await getCustomersAtRisk(productId),
      'folding them in would widen who Foundry writes to with nobody deciding it')
      .toEqual([]);
  });

  it('reaches the founder’s page and Harbor’s prompt', () => {
    const page = readFileSync('src/routes/dashboard/agents-customers.ts', 'utf8');
    expect(page).toMatch(/Falling \(\$\{falling\.length\}\)/);
    expect(page, 'the reason for showing them above the line')
      .toMatch(/easier to keep than one already gone/);

    const harbor = readFileSync('src/services/scp/agents/harbor.ts', 'utf8');
    expect(harbor).toMatch(/getFallingCustomers/);
    expect(harbor, 'and it is told nothing when there is nothing to tell')
      .toMatch(/No customer's health has fallen meaningfully/);
  });

  it('took the table off the unread list', () => {
    const baseline = readFileSync('docs/db/unread-tables-baseline.txt', 'utf8');
    expect(baseline).not.toMatch(/customer_health_snapshots/);
  });

  it('names its threshold and window rather than burying them', () => {
    const src = stripComments(
      readFileSync('src/services/institution/company-customers.ts', 'utf8'),
      { lineComments: true });
    expect(src).toMatch(/export const FALLING_HEALTH_POINTS/);
    expect(src).toMatch(/export const TREND_WINDOW_DAYS/);
    expect(TREND_WINDOW_DAYS, 'the horizon Harbor’s prompt talks in').toBe(30);
  });
});
