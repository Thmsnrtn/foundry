process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  correctStratumOnTheRecord, correctionsOf, withScratchRecipient,
} from '../../src/services/venture/stratum-correction.js';

// =============================================================================
// A CORRECTION IS A RECORD, NOT A LOOPHOLE.
//
// The institution wrote a stratum onto a real candidate row to see whether the
// write path worked, and the guard refused to put it back. Correcting that
// without destroying the property the guard protects is the whole problem, and
// these are the four things that had to be proved before it was allowed at all.
// =============================================================================

const OWNER = 'corr_owner';
let X = '';

async function aRecipient(ref: string): Promise<string> {
  const { addRecipients, qualifyRecipient, recordStratum, recipientsOf } = await import('../../src/services/venture/hand.js');
  await addRecipients({ founderId: OWNER, experimentId: X,
    recipients: [{ counterpartyRef: ref, email: `${ref.replace(/\W+/g, '')}@example.com`, channel: 'email', sourceUrl: 'https://example.com/' }] });
  const r = (await recipientsOf(X)).find((x) => x.counterpartyRef === ref)!;
  await qualifyRecipient({ founderId: OWNER, experimentId: X, recipientId: r.id,
    because: 'its own site shows commercial millwork for institutional clients', source: 'https://example.com/' });
  await recordStratum({ founderId: OWNER, experimentId: X, recipientId: r.id, stratum: 'public_work_observed' });
  return r.id;
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_corr', 'corr@example.com', 'Owner']);
  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const { designExperiment } = await import('../../src/services/venture/validation.js');
  const opened = await openMandate({ founderId: OWNER, statement: 'Make the river stronger', shape: null, evidenceMode: 'real' });
  if ('refused' in opened) throw new Error(opened.refused);
  await query(
    `INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
     VALUES ('opp_corr',?,?,'a brief','MA millwork shops','scattered','somebody sells it','nobody pays','[]','real')`, [opened.id, OWNER]);
  await query(`INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test)
     VALUES ('unk_corr',?,'opp_corr','will anyone pay',1,'write once')`, [OWNER]);
  X = await designExperiment({
    founderId: OWNER, opportunityId: 'opp_corr', unknownId: 'unk_corr', evidenceMode: 'real',
    whatWeDo: 'write once', whatWeExpect: 'one pays', wouldDisprove: 'none pays', costCents: 0 });
});

describe('1. normal runtime still refuses to relabel a stratum', () => {
  it('refuses a bare update, with or without a reason attached', async () => {
    const id = await aRecipient('Plain Shop, Lowell');
    await expect(query('UPDATE experiment_recipients SET evidence_stratum = ? WHERE id = ?',
      ['commercial_institutional_capable', id])).rejects.toThrow(/stratum_stands/);
    await expect(query('UPDATE experiment_recipients SET evidence_stratum = NULL WHERE id = ?', [id]))
      .rejects.toThrow(/stratum_stands/);
  });

  it('refuses a correction record that does not name this exact change', async () => {
    const id = await aRecipient('Mismatch Shop, Canton');
    await query(
      `INSERT INTO recipient_stratum_corrections
         (id, founder_id, experiment_id, recipient_id, mistaken, correct, origin, because, corrected_by,
          nothing_authorised, nothing_sent, nobody_replied, nothing_paid, no_evidence_rests_on_it)
       VALUES ('c_mismatch',?,?,?,'commercial_institutional_capable','public_work_observed',
               'institution_diagnostic','a record pointing the other way entirely','institution',1,1,1,1,1)`,
      [OWNER, X, id]);
    // The row is public_work_observed; the record permits the opposite move.
    await expect(query('UPDATE experiment_recipients SET evidence_stratum = ? WHERE id = ?',
      ['commercial_institutional_capable', id])).rejects.toThrow(/stratum_stands/);
  });
});

describe('2. a correction that is recorded, attested and consumed', () => {
  it('moves the value and leaves an auditable record behind', async () => {
    const id = await aRecipient('Quality Shop, Boston');
    const out = await correctStratumOnTheRecord({
      founderId: OWNER, experimentId: X, recipientId: id,
      mistaken: 'public_work_observed', correct: 'commercial_institutional_capable',
      because: 'the institution wrote this value onto a real row while testing whether the write path '
        + 'worked at all, and the guard then refused to put it back',
      by: 'institution:diagnostic',
    });
    expect(out.correct).toBe('commercial_institutional_capable');
    const row = (await query('SELECT evidence_stratum FROM experiment_recipients WHERE id = ?', [id]))
      .rows[0] as Record<string, unknown>;
    expect(row.evidence_stratum).toBe('commercial_institutional_capable');

    const rec = (await correctionsOf(X)).find((c) => c.recipient === 'Quality Shop, Boston')!;
    expect(rec.mistaken).toBe('public_work_observed');
    expect(rec.correct).toBe('commercial_institutional_capable');
    expect(rec.origin).toBe('institution_diagnostic');
    expect(rec.consumed).toBe(true);
    expect(rec.because.length).toBeGreaterThan(40);
  });

  it('is one-shot: the same record cannot move the value back', async () => {
    const id = await aRecipient('Twice Shop, Norton');
    await correctStratumOnTheRecord({
      founderId: OWNER, experimentId: X, recipientId: id,
      mistaken: 'public_work_observed', correct: 'commercial_institutional_capable',
      because: 'an institution diagnostic wrote the wrong value before anything had happened to the row',
      by: 'institution:diagnostic' });
    await expect(query('UPDATE experiment_recipients SET evidence_stratum = ? WHERE id = ?',
      ['public_work_observed', id])).rejects.toThrow(/stratum_stands/);
  });

  it('refuses once the business has been decided on or written to', async () => {
    const id = await aRecipient('Decided Shop, Woburn');
    const { reviewRecipient } = await import('../../src/services/venture/hand.js');
    await reviewRecipient({ founderId: OWNER, experimentId: X, recipientId: id, decision: 'approved' });
    await expect(correctStratumOnTheRecord({
      founderId: OWNER, experimentId: X, recipientId: id,
      mistaken: 'public_work_observed', correct: 'commercial_institutional_capable',
      because: 'trying to correct a stratum on a business the owner has already decided about',
      by: 'institution:diagnostic' })).rejects.toThrow(/decided on/);
  });
});

describe('3. a diagnostic runs on a scratch row, never on a real business', () => {
  it('makes its own row, hands it over, and takes it away again', async () => {
    const { recipientsOf } = await import('../../src/services/venture/hand.js');
    const before = (await recipientsOf(X)).length;
    let sawRef = '';
    const result = await withScratchRecipient({ founderId: OWNER, experimentId: X }, async (rid) => {
      const r = (await recipientsOf(X)).find((x) => x.id === rid)!;
      sawRef = r.counterpartyRef;
      return 'probe ran';
    });
    expect(result).toBe('probe ran');
    expect(sawRef).toMatch(/^SCRATCH — institution diagnostic /);
    expect((await recipientsOf(X)).length, 'the scratch row outlived the probe').toBe(before);
  });

  it('cleans up even when the probe throws, so a failure leaves no stray business', async () => {
    const { recipientsOf } = await import('../../src/services/venture/hand.js');
    const before = (await recipientsOf(X)).length;
    await expect(withScratchRecipient({ founderId: OWNER, experimentId: X }, async () => {
      throw new Error('the probe blew up');
    })).rejects.toThrow(/blew up/);
    expect((await recipientsOf(X)).length).toBe(before);
  });
});

describe('4. delete and reinsert is not a way to relabel', () => {
  it('remembers what a business was put in, and refuses a different answer on a fresh row', async () => {
    const { addRecipients, qualifyRecipient, recordStratum, recipientsOf } = await import('../../src/services/venture/hand.js');
    const ref = 'Relabel Shop, Webster';
    const id = await aRecipient(ref);            // public_work_observed
    await query('DELETE FROM experiment_recipients WHERE id = ?', [id]);
    expect((await recipientsOf(X)).find((x) => x.counterpartyRef === ref)).toBeUndefined();

    await addRecipients({ founderId: OWNER, experimentId: X,
      recipients: [{ counterpartyRef: ref, email: 'again@example.com', channel: 'email', sourceUrl: 'https://example.com/' }] });
    const again = (await recipientsOf(X)).find((x) => x.counterpartyRef === ref)!;
    await qualifyRecipient({ founderId: OWNER, experimentId: X, recipientId: again.id,
      because: 'the same business, written into the experiment a second time', source: 'https://example.com/' });

    // THE LOOPHOLE, CLOSED. A fresh row for a business this experiment has
    // already stratified meets the answer it was given the first time.
    await expect(recordStratum({ founderId: OWNER, experimentId: X, recipientId: again.id,
      stratum: 'commercial_institutional_capable' }))
      .rejects.toThrow(/stratum_was_already_decided_for_this_business/);

    // The original answer is still available, which is the point of remembering.
    await recordStratum({ founderId: OWNER, experimentId: X, recipientId: again.id, stratum: 'public_work_observed' });
    const back = (await recipientsOf(X)).find((x) => x.id === again.id)!;
    expect(back.evidenceStratum).toBe('public_work_observed');
  });

  it('refuses to delete a recipient that anything has happened to', async () => {
    const id = await aRecipient('Consequence Shop, Watertown');
    const { reviewRecipient } = await import('../../src/services/venture/hand.js');
    await reviewRecipient({ founderId: OWNER, experimentId: X, recipientId: id, decision: 'approved' });
    await expect(query('DELETE FROM experiment_recipients WHERE id = ?', [id]))
      .rejects.toThrow(/something_happened_to_this_one/);
  });
});
