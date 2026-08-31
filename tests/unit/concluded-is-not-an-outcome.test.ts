process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { issueApiKey } from '../../src/services/api/api-key-issuance.js';
import { experimentOutcome } from '../../src/services/scp/investor/board-packet.js';

// =============================================================================
// THE DOCUMENTED DOOR COULD NOT SAY THE ONE THING THE INSTITUTION READS.
//
// `POST /v1/experiments/:id/conclude` wrote `outcome` and `winning_variant_id`
// and left `winner` NULL. Every institutional reader — the board packet, the
// investor update, the accuracy tracker, `WHERE winner = 'treatment'` — reads
// `winner`. A company that concluded an experiment the documented way was
// invisible to every surface that reports experiments.
//
// The mapping cannot be inferred: `experiment_variants` carries no
// control/treatment marker, so `winning_variant_id` cannot be turned into the
// shared vocabulary without inventing a convention, and inventing one on a
// documented contract is a product decision rather than a repair. What the
// caller CAN do is say it, in the vocabulary the column already has — and a
// value outside that vocabulary is refused rather than stored and dropped.
//
// And "completed" is a STATE, not an outcome. The board packet fell through to
// the status, so a concluded experiment whose winner nobody recorded appeared
// in the outcome column as "completed", reading like a result.
// =============================================================================

const P = 'p_exp';
let app: Hono;
let key: string;

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id,clerk_user_id,email) VALUES ('f_e','c_e','e@example.com')");
  await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,'Acme','f_e','active')", [P]);
  await query(
    `INSERT INTO hypotheses (id, product_id, proposed_by, statement, status)
     VALUES ('h1', ?, 'oracle', 'Raising the price will not raise churn', 'active')`, [P]);
  key = (await issueApiKey({
    productId: P, founderId: 'f_e', label: 'k', scopes: ['experiments:write'],
  }) as { key: string }).key;
  const { apiV1 } = await import('../../src/api/v1/index.js');
  app = new Hono();
  app.route('/api/v1', apiV1 as unknown as Hono);
});

beforeEach(async () => {
  await query('DELETE FROM experiments');
  // The table carries migration 023's schema and 028's at once — 028's
  // `CREATE TABLE IF NOT EXISTS` was a no-op and 056 reconciled by ALTER — so a
  // row needs 023's NOT NULL columns whichever writer means to create it.
  await query(
    `INSERT INTO experiments
       (id, product_id, hypothesis_id, name, type, control_description,
        treatment_description, success_metric, status)
     VALUES ('e1', ?, 'h1', 'Pricing test', 'ab_test', 'current price',
             'higher price', 'churn_rate', 'running')`, [P]);
});

const conclude = (body: Record<string, unknown>) =>
  app.request('/api/v1/experiments/e1/conclude', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('concluding through the documented door', () => {
  it('records a winner the institution can read', async () => {
    const res = await conclude({ outcome: 'price held', winning_variant_id: 'v2', winner: 'treatment' });
    expect(res.status).toBe(200);

    const row = (await query("SELECT winner, outcome, winning_variant_id, status FROM experiments WHERE id = 'e1'"))
      .rows[0] as unknown as { winner: string; outcome: string; winning_variant_id: string; status: string };
    expect(row.winner).toBe('treatment');
    expect(row.outcome, "the caller's own field is still theirs").toBe('price held');
    expect(row.winning_variant_id).toBe('v2');
    expect(row.status).toBe('completed');
  });

  it('refuses a winner outside the vocabulary rather than dropping it', async () => {
    const res = await conclude({ winner: 'variant_b' });
    expect(res.status).toBe(400);

    const row = (await query("SELECT status, winner FROM experiments WHERE id = 'e1'"))
      .rows[0] as unknown as { status: string; winner: string | null };
    expect(row.status, 'nothing was concluded').toBe('running');
    expect(row.winner).toBeNull();
  });

  it('still concludes without one, which is the old contract', async () => {
    const res = await conclude({ outcome: 'shipped it' });
    expect(res.status).toBe(200);

    const row = (await query("SELECT status, winner FROM experiments WHERE id = 'e1'"))
      .rows[0] as unknown as { status: string; winner: string | null };
    expect(row.status).toBe('completed');
    expect(row.winner).toBeNull();
  });
});

describe('what a board packet says about it', () => {
  it('does not report a state as an outcome', () => {
    expect(experimentOutcome({ status: 'completed', winner: null, early_stop_reason: null }))
      .toBe('concluded — the winning arm was not recorded');
  });

  it('reports a winner as a winner', () => {
    expect(experimentOutcome({ status: 'completed', winner: 'treatment' })).toBe('treatment won');
  });

  it('reports inconclusive as itself', () => {
    expect(experimentOutcome({ status: 'completed', winner: 'inconclusive' }))
      .toBe('inconclusive — the arms did not separate');
  });

  it('leaves a running experiment as running', () => {
    expect(experimentOutcome({ status: 'running', winner: null })).toBe('running');
  });
});
