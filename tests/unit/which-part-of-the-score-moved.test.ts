process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getCustomerHealthTrends } from '../../src/services/institution/company-customers.js';

// =============================================================================
// WHICH PART OF THE SCORE MOVED.
//
// Every health refresh writes a dated row to `customer_health_snapshots` — the
// composite, the churn risk, and the four components behind them: usage,
// support, payment, engagement. A previous cycle gave the composite a reader,
// so a customer sliding 90 → 55 can now be told from one that sat at 55. The
// four COMPONENT columns still had none, so the trend could say a customer fell
// 35 points and not which of the four fell — the only part of the answer that
// says what to do about it.
//
// They were invisible to the write-only-column gate for an accidental reason:
// the gate blanked write contexts by removing their text, and
// `INSERT INTO metric_snapshots (id, product_id, snapshot_date)` is a SUBSTRING
// of this table's column list, so blanking the short one first stopped the long
// one matching itself. Deleting that placeholder writer for unrelated reasons
// is what made these four appear.
// =============================================================================

const P = 'p_moved';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_m','c_m','m@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_m','active')", [P]);
  await query(
    `INSERT INTO customers (id, product_id, owner_id, external_id, name)
     VALUES ('cu_1', ?, 'f_m', 'cus_1', 'Northwind')`, [P]);
});
beforeEach(async () => { await query('DELETE FROM customer_health_snapshots'); });

const snapshot = (id: string, daysAgo: number, cols: Record<string, number | null>) => {
  const keys = Object.keys(cols);
  return query(
    `INSERT INTO customer_health_snapshots
       (id, customer_id, product_id, snapshot_date${keys.length ? ', ' + keys.join(', ') : ''})
     VALUES (?, 'cu_1', ?, date('now', ?)${keys.map(() => ', ?').join('')})`,
    [id, P, `-${daysAgo} days`, ...keys.map((k) => cols[k])]);
};

describe('a customer whose health is falling', () => {
  it('names the component that fell most', async () => {
    await snapshot('s1', 20, { health_score: 90, usage_score: 90, support_score: 80, payment_score: 100, engagement_score: 85 });
    await snapshot('s2', 1, { health_score: 55, usage_score: 40, support_score: 75, payment_score: 100, engagement_score: 70 });

    const [trend] = await getCustomerHealthTrends(P);
    expect(trend.deltaPoints).toBe(-35);
    expect(trend.largestDrop?.component).toBe('usage');
    expect(trend.largestDrop?.deltaPoints).toBe(-50);
  });

  it('ignores a component that rose', async () => {
    await snapshot('s3', 20, { health_score: 80, usage_score: 60, support_score: 90, payment_score: 100, engagement_score: 70 });
    await snapshot('s4', 1, { health_score: 60, usage_score: 80, support_score: 40, payment_score: 100, engagement_score: 65 });

    const [trend] = await getCustomerHealthTrends(P);
    expect(trend.largestDrop?.component).toBe('support');
  });

  it('says nothing when the components were never recorded', async () => {
    await snapshot('s5', 20, { health_score: 90 });
    await snapshot('s6', 1, { health_score: 55 });

    const [trend] = await getCustomerHealthTrends(P);
    expect(trend.deltaPoints).toBe(-35);
    expect(trend.largestDrop, 'a composite that fell for reasons this cannot name').toBeNull();
  });

  it('does not read an unmeasured component as a collapse to zero', async () => {
    // The end that reported nothing has no movement to report. A `?? 0` here
    // would make the unmeasured component the largest drop every time.
    await snapshot('s7', 20, { health_score: 90, usage_score: 90, engagement_score: 80 });
    await snapshot('s8', 1, { health_score: 70, usage_score: null, engagement_score: 60 });

    const [trend] = await getCustomerHealthTrends(P);
    expect(trend.largestDrop?.component).toBe('engagement');
    expect(trend.largestDrop?.deltaPoints).toBe(-20);
  });

  it('needs two readings, as before', async () => {
    await snapshot('s9', 3, { health_score: 90, usage_score: 90 });
    expect(await getCustomerHealthTrends(P)).toEqual([]);
  });
});
