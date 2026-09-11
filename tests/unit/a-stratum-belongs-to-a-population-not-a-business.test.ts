process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// A STRATUM BELONGS TO A POPULATION, NOT TO A BUSINESS.
//
// `recipient_stratum_history` exists to stop one thing: deleting a recipient
// and inserting it again as a way to relabel its evidence stratum after the
// fact. That protection has to be scoped to the experiment whose comparison is
// being protected — and no wider.
//
// EVIDENCE STRATUM IS NOT A PROPERTY OF A COMPANY. It is a statement about what
// could be observed about that company AGAINST ONE POPULATION DEFINITION. A
// shop with no public-sector record under this experiment's definition may sit
// squarely inside the observed stratum of a later experiment that defines its
// population differently, or that runs after the shop has won public work. A
// key of `business -> one stratum forever` would quietly turn an observation
// into a permanent label and corrupt every experiment that came after it.
//
// So the durable key is (experiment, business) -> the stratum first recorded.
// These tests hold it there from both sides: the same business may be
// classified differently in a different experiment, and may not be relabelled
// inside the same one.
// =============================================================================

const OWNER = 'scope_owner';
const REF = 'Same Shop, Boston';
let X1 = '';
let X2 = '';

async function makeExperiment(tag: string): Promise<string> {
  const { openMandate, stopMandate, currentMandate } = await import('../../src/services/venture/mandate.js');
  const { designExperiment } = await import('../../src/services/venture/validation.js');
  const cur = await currentMandate(OWNER);
  if (cur) await stopMandate(OWNER, 'making room for the next population');
  const m = await openMandate({ founderId: OWNER, statement: `Population ${tag}`, shape: null, evidenceMode: 'real' });
  if ('refused' in m) throw new Error(m.refused);
  await query(
    `INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
     VALUES (?,?,?,?,?,?,?,?,'[]','real')`,
    [`opp_${tag}`, m.id, OWNER, `brief ${tag}`, `population ${tag}`, 'scattered', 'somebody sells it', 'nobody pays']);
  await query(
    `INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test)
     VALUES (?,?,?,'will anyone pay',1,'write once')`, [`unk_${tag}`, OWNER, `opp_${tag}`]);
  return designExperiment({
    founderId: OWNER, opportunityId: `opp_${tag}`, unknownId: `unk_${tag}`, evidenceMode: 'real',
    whatWeDo: 'write once', whatWeExpect: 'one pays', wouldDisprove: 'none pays', costCents: 0,
  });
}

async function place(
  X: string, ref: string, stratum: 'public_work_observed' | 'commercial_institutional_capable',
): Promise<string> {
  const { addRecipients, qualifyRecipient, recordStratum, recipientsOf } = await import('../../src/services/venture/hand.js');
  await addRecipients({
    founderId: OWNER, experimentId: X,
    recipients: [{ counterpartyRef: ref, email: 'x@example.com', channel: 'email', sourceUrl: 'https://e.example/' }],
  });
  const r = (await recipientsOf(X)).find((x) => x.counterpartyRef === ref)!;
  if (!r.qualifiedAt) {
    await qualifyRecipient({
      founderId: OWNER, experimentId: X, recipientId: r.id,
      because: 'its own public record shows work of the kind this population names', source: 'https://e.example/',
    });
  }
  await recordStratum({ founderId: OWNER, experimentId: X, recipientId: r.id, stratum });
  return r.id;
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_scope', 'scope@example.com', 'Owner']);
  X1 = await makeExperiment('one');
  X2 = await makeExperiment('two');
});

describe('the memory is keyed by population and business, not by business alone', () => {
  it('lets the same business sit in a different stratum in a different experiment', async () => {
    await place(X1, REF, 'public_work_observed');
    // A DIFFERENT POPULATION MAY SEE THE SAME COMPANY DIFFERENTLY. If this
    // throws, evidence stratum has become a permanent global label on a
    // business and every later experiment inherits this one's definition.
    const id2 = await place(X2, REF, 'commercial_institutional_capable');
    const row = (await query('SELECT evidence_stratum FROM experiment_recipients WHERE id = ?', [id2]))
      .rows[0] as Record<string, unknown>;
    expect(row.evidence_stratum).toBe('commercial_institutional_capable');
  });

  it('still refuses a relabel by delete and reinsert inside the same experiment', async () => {
    await query('DELETE FROM experiment_recipients WHERE experiment_id = ? AND counterparty_ref = ?', [X1, REF]);
    await expect(place(X1, REF, 'commercial_institutional_capable'))
      .rejects.toThrow(/stratum_was_already_decided_for_this_business/);
    // And the answer it was first given is still available to it.
    const id = await place(X1, REF, 'public_work_observed');
    const row = (await query('SELECT evidence_stratum FROM experiment_recipients WHERE id = ?', [id]))
      .rows[0] as Record<string, unknown>;
    expect(row.evidence_stratum).toBe('public_work_observed');
  });

  it('remembers the business once per experiment, each with its own answer', async () => {
    const rows = (await query(
      `SELECT experiment_id, counterparty, stratum FROM recipient_stratum_history
        WHERE counterparty = ? ORDER BY experiment_id`, [REF.toLowerCase()]))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(rows, 'the same business should be remembered once per experiment').toHaveLength(2);
    expect(new Set(rows.map((r) => String(r.stratum))).size,
      'both experiments were forced to the same answer').toBe(2);
  });
});
