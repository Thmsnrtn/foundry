process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { recordPremise, checkPremises, normaliseThreshold } from '../../src/services/memory/kernel.js';

// =============================================================================
// A THRESHOLD A MODEL CHOSE, IN THE UNITS A MODEL WOULD CHOOSE.
//
// `churn_rate`, `activation_rate`, `day_30_retention` and `mrr_health_ratio`
// are stored 0–1. A premise threshold reaches the memory kernel from three
// places and only one of them converted: the founder's own sentence, parsed by
// `ux/fluency.ts`. The other two — the `foundry_record_decision` MCP tool and
// the chat capture — pass a number a MODEL chose, and a model asked for "the
// threshold" on churn writes 5 for five per cent.
//
// `0.05 < 5` holds forever. The belief could never be falsified, so the
// accountability queue — the whole point of the memory kernel — would never
// mention the decision that rests on it.
// =============================================================================

const P = 'p_prem';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_prem','c_prem','p@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_prem','active')", [P]);
});

beforeEach(async () => {
  await query('DELETE FROM decision_premises');
  await query('DELETE FROM metric_snapshots');
});

describe('the units rule', () => {
  it('reads a value above 1 on a rate metric as percentage points', () => {
    expect(normaliseThreshold('churn_rate', 5)).toBeCloseTo(0.05, 6);
    expect(normaliseThreshold('day_30_retention', 60)).toBeCloseTo(0.6, 6);
  });

  it('leaves an already-converted value alone, so applying it twice is safe', () => {
    expect(normaliseThreshold('churn_rate', 0.05)).toBeCloseTo(0.05, 6);
    expect(normaliseThreshold('churn_rate', normaliseThreshold('churn_rate', 5))).toBeCloseTo(0.05, 6);
  });

  it('does not touch a metric that is not a fraction', () => {
    expect(normaliseThreshold('nps_score', 50)).toBe(50);
    expect(normaliseThreshold('mrr_cents', 5_000_000)).toBe(5_000_000);
    expect(normaliseThreshold(undefined, 5)).toBe(5);
  });
});

describe('a premise recorded through the tool', () => {
  it('is stored in the column’s units', async () => {
    await recordPremise({
      productId: P, decisionId: 'd_1', premise: 'Churn stays under five per cent',
      metricKey: 'churn_rate', comparator: '<', threshold: 5,
    });
    const row = (await query('SELECT threshold FROM decision_premises'))
      .rows[0] as unknown as Record<string, unknown>;
    expect(Number(row.threshold)).toBeCloseTo(0.05, 6);
  });

  it('is falsified when the metric crosses it', async () => {
    await recordPremise({
      productId: P, decisionId: 'd_2', premise: 'Churn stays under five per cent',
      metricKey: 'churn_rate', comparator: '<', threshold: 5,
    });
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, churn_rate)
       VALUES ('ms_1', ?, date('now'), 0.08)`, [P]);

    const result = await checkPremises(P);
    expect(result.checked).toBe(1);
    expect(result.falsified, 'a belief that could never be falsified is not a belief').toBe(1);
  });

  it('still holds when the metric is inside it', async () => {
    await recordPremise({
      productId: P, decisionId: 'd_3', premise: 'Churn stays under five per cent',
      metricKey: 'churn_rate', comparator: '<', threshold: 5,
    });
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, churn_rate)
       VALUES ('ms_1', ?, date('now'), 0.02)`, [P]);

    const result = await checkPremises(P);
    expect(result.falsified).toBe(0);
    const row = (await query('SELECT status FROM decision_premises'))
      .rows[0] as unknown as Record<string, unknown>;
    expect(row.status).toBe('holding');
  });
});
