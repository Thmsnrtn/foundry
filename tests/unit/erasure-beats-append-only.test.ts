// =============================================================================
// Tests: a founder who had ever dispositioned a judgment could not be erased
//
// Two rules in direct contradiction, and erasure lost every time.
//
// Migration 118 made `institutional_judgment_dispositions` append-only: "a later
// change of direction is a new row, never an edit or deletion of the earlier
// one." Correct — the record of what a founder decided about an institutional
// judgment must not be rewritten.
//
// The erasure plan classifies that same table `erase_by_product`, because it is
// the founder's own decisions about their own company and no allow-list retains
// it. So `eraseFounderAccount` reached it, the trigger aborted, and the failure
// was recorded rather than swallowed — which stopped the whole thing:
//
//   {"productsErased":[], "failed":[{"error":"data deletion incomplete:
//     institutional_judgment_dispositions: judgment_disposition:append_only"}],
//    "founderRedacted":false}
//
// Not a partial erasure. The founder row is deliberately left intact when any
// company fails, so nothing was erased and the person stayed. For as long as
// both rules have existed.
//
// APPEND-ONLY MEANS HISTORY IS NOT REWRITTEN. It does not mean a person's data
// outlives their right to have it removed. Editing stays absolutely refused —
// that is the property the rule is actually for, and these tests hold it.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';
import { createDeterministicCapacityJudgment } from '../../src/services/institution/institutional-judgment.js';
import { eraseFounderAccount } from '../../src/services/privacy/consent.js';

const F = 'eba_founder';
const P = 'eba_product';

async function seedJudgmentDisposition(): Promise<void> {
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
    VALUES ('eba_sig',?,'operations','capacity_observed','medium','{}','two blocks')`, [P]);
  await query(`INSERT INTO institutional_responsibilities (id,product_id,title,capability,state) VALUES
    ('eba_support',?,'Urgent support','customer_support','understood'),
    ('eba_dev',?,'Planned development','development','understood')`, [P, P]);
  for (const [subject, predicate, value] of [
    [`product:${P}`, 'resource_capacity', { resource: 'work_block', amount: 2 }],
    ['responsibility:eba_support', 'resource_demand',
      { resource: 'work_block', amount: 2, deadline: 'today', consequence: 'customer commitment at risk' }],
    ['responsibility:eba_dev', 'resource_demand',
      { resource: 'work_block', amount: 1, consequence: 'planned investment delayed' }],
  ] as const) {
    await recordReconstructionClaim({
      productId: P, subject, predicate, value, epistemicStatus: 'known',
      evidenceRefs: [{ kind: 'signal_event', id: 'eba_sig' }],
      derivationMethod: 'canonical fixture evidence', observedAt: new Date(),
    });
  }
  const judgmentId = await createDeterministicCapacityJudgment(P, ['eba_support', 'eba_dev']);
  if (!judgmentId) throw new Error('fixture did not produce a judgment');
  await query(
    `INSERT INTO institutional_judgment_dispositions
       (id, judgment_id, product_id, owner_id, disposition, reason)
     VALUES ('eba_disp', ?, ?, ?, 'accepted', 'We will do the support work first')`,
    [judgmentId, P, F]);
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [F, 'clerk_eba', 'eba@test.local']);
  await query(`INSERT INTO products (id, name, owner_id) VALUES (?, 'Judged Co', ?)`, [P, F]);
  await seedJudgmentDisposition();
});

describe('history is not rewritten', () => {
  it('still refuses an edit', async () => {
    await expect(query(
      `UPDATE institutional_judgment_dispositions SET reason = 'Actually the other one' WHERE id = 'eba_disp'`,
      [])).rejects.toThrow(/append_only/);
  });

  it('still refuses a deletion for a company that is not being erased', async () => {
    // The property the rule is for: a founder cannot quietly remove the record
    // of a decision they now regret.
    await expect(query(
      `DELETE FROM institutional_judgment_dispositions WHERE id = 'eba_disp'`, []))
      .rejects.toThrow(/append_only/);
  });
});

describe('but erasure is not a rewrite', () => {
  it('erases the founder and their company completely', async () => {
    const before = await query(
      `SELECT COUNT(*) AS n FROM institutional_judgment_dispositions WHERE product_id = ?`, [P]);
    expect(Number((before.rows[0] as Record<string, unknown>).n)).toBe(1);

    const outcome = await eraseFounderAccount(F);
    expect(outcome.failed, JSON.stringify(outcome.failed)).toEqual([]);
    expect(outcome.productsErased).toEqual([P]);
    expect(outcome.founderRedacted,
      'the founder row is left intact when any company fails, so this is the '
      + 'whole thing working or none of it').toBe(true);

    const after = await query(
      `SELECT COUNT(*) AS n FROM institutional_judgment_dispositions WHERE product_id = ?`, [P]);
    expect(Number((after.rows[0] as Record<string, unknown>).n)).toBe(0);
  });

  it('leaves nothing identifying behind on the founder', async () => {
    const row = (await query(
      `SELECT email, name, clerk_user_id FROM founders WHERE id = ?`, [F]))
      .rows[0] as Record<string, unknown>;
    expect(String(row.email)).toContain('@invalid');
    expect(row.name).toBeNull();
    expect(String(row.clerk_user_id)).toMatch(/^erased:/);
  });
});
