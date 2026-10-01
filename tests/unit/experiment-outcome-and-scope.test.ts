// =============================================================================
// Tests: "we could not tell" is not "we proved it false"
//
// `experiments.winner` already had three values — control, treatment,
// inconclusive — because an experiment can end without separating its arms.
// `hypotheses.status` had six and none of them meant that, so the write that
// records a result had nowhere to put the commonest outcome:
//
//     const newStatus = results.significant ? 'completed' : 'disproven';
//
// Every experiment that failed to detect an effect marked its hypothesis
// disproven. That is the record the next agent reads before proposing again,
// so an untested idea looked closed — and `disproven_evidence`, the column the
// schema created to hold WHY, stayed NULL, because there was no why.
//
// Two further things were wrong in the same function, and both were invisible
// for the same reason: nothing calls it yet.
//
//   • it wrote `WHERE id = ?` with no product scope, in a file where every
//     reachable sibling takes a `scopeProductId` and uses it. So did
//     `validateHypothesis`. An unreachable cross-tenant write is a
//     cross-tenant write with a date on it.
//   • a significant result where CONTROL won was recorded as 'completed' —
//     the hypothesis succeeded — when control winning is the one outcome that
//     actually contradicts it.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

const F = 'exo_founder';
const MINE = 'exo_mine';

async function statusOf(hypId: string): Promise<Record<string, unknown>> {
  return (await query(
    'SELECT status, disproven_evidence FROM hypotheses WHERE id = ?', [hypId]))
    .rows[0] as Record<string, unknown>;
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [F, 'exo_clerk', 'exo@example.com']);
  for (const [id, name] of [[MINE, 'Mine']]) {
    await query(
      `INSERT INTO products (id, name, owner_id, status) VALUES (?,?,?, 'active')`,
      [id, name, F]);
  }
});

beforeEach(async () => {
  await query(`DELETE FROM experiments`);
  await query(`DELETE FROM hypotheses`);
});

describe('the schema has a name for an inconclusive result', () => {
  it('accepts it', async () => {
    await query(
      `INSERT INTO hypotheses (id, product_id, proposed_by, statement, status)
       VALUES ('exo_inc', ?, 'oracle', 'x', 'inconclusive')`, [MINE]);
    expect((await statusOf('exo_inc')).status).toBe('inconclusive');
  });

  it('and still refuses a status nobody defined', async () => {
    // The rebuild must not have dropped the constraint on the way past. A
    // CHECK quietly widened to "anything" is how vocabularies rot.
    // check-vocabulary:expected-refusal
    await expect(query(
      `INSERT INTO hypotheses (id, product_id, proposed_by, statement, status)
       VALUES ('exo_bad', ?, 'oracle', 'x', 'probably_true')`, [MINE]))
      .rejects.toThrow();
  });
});

// The cases that drove `updateResults` and `validateHypothesis`, and the source
// scan of `scp/experiments.ts`, went with that module in Roadmap 2027 R9.
