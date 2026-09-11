// =============================================================================
// FOUNDRY — correcting a value that was never allowed to move
//
// The institution wrote a stratum onto a real candidate row to find out whether
// the write path worked, and the guard then refused to put it back. The guard
// was right. A stratum that can be revised after the results are in makes the
// only comparison the split exists for unfalsifiable.
//
// This is the narrow way out, and it is narrow on purpose:
//
//   · it writes a RECORD FIRST and the record is append-only;
//   · the record must attest that nothing happened under the wrong value;
//   · the database re-checks the parts of that attestation it can see, so a
//     false attestation does not buy anything;
//   · the correction is consumed by the one update it permits;
//   · without such a record, relabelling is refused exactly as before.
//
// WHAT THIS IS NOT: a way to fix a stratum that turned out to be commercially
// inconvenient. `origin` admits one value. A mistake the institution made to
// itself, before anybody was authorised or written to, is a clerical error.
// Anything else is a finding and stays on the record as one.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

export type Stratum = 'public_work_observed' | 'commercial_institutional_capable';

export class CorrectionRefused extends Error {}

export interface StratumCorrection {
  recipient: string; mistaken: Stratum; correct: Stratum; because: string; correctedAt: string;
}

/**
 * CORRECT ONE STRATUM, ON THE RECORD.
 *
 * Refuses before it writes anything if the row has been authorised, reviewed or
 * written to — the same conditions the trigger re-checks, asked here first so
 * the caller gets a sentence instead of a constraint name.
 */
export async function correctStratumOnTheRecord(input: {
  founderId: string; experimentId: string; recipientId: string;
  mistaken: Stratum; correct: Stratum; because: string; by: string;
}): Promise<StratumCorrection> {
  if (input.mistaken === input.correct) throw new CorrectionRefused('that is not a correction');
  if (input.because.trim().length < 40) throw new CorrectionRefused('a correction says why, in words a person can read');

  const r = (await query(
    `SELECT id, counterparty_ref, evidence_stratum, review_status, authorised_act_id
       FROM experiment_recipients WHERE id = ? AND experiment_id = ? AND founder_id = ?`,
    [input.recipientId, input.experimentId, input.founderId])).rows[0] as Record<string, unknown> | undefined;
  if (!r) throw new CorrectionRefused('no such recipient on that experiment');
  if (String(r.evidence_stratum) !== input.mistaken) {
    throw new CorrectionRefused(`the row says ${String(r.evidence_stratum)}, not ${input.mistaken}`);
  }
  if (r.authorised_act_id != null || String(r.review_status) !== 'pending') {
    throw new CorrectionRefused('this business has been decided on; its stratum is a finding now, not a typo');
  }
  const acted = Number((await query(
    'SELECT count(*) AS n FROM outbound_actions WHERE recipient_id = ?', [input.recipientId])).rows[0]?.n ?? 0);
  if (acted > 0) throw new CorrectionRefused('something was written to this business under the value being corrected');

  const id = nanoid();
  await query(
    `INSERT INTO recipient_stratum_corrections
       (id, founder_id, experiment_id, recipient_id, mistaken, correct, origin, because, corrected_by,
        nothing_authorised, nothing_sent, nobody_replied, nothing_paid, no_evidence_rests_on_it)
     VALUES (?,?,?,?,?,?,'institution_diagnostic',?,?,1,1,1,1,1)`,
    [id, input.founderId, input.experimentId, input.recipientId, input.mistaken, input.correct,
      input.because.trim(), input.by]);

  await query(
    `UPDATE experiment_recipients SET evidence_stratum = ?
      WHERE id = ? AND experiment_id = ? AND founder_id = ?`,
    [input.correct, input.recipientId, input.experimentId, input.founderId]);
  await query(
    `UPDATE recipient_stratum_corrections SET consumed_at = datetime('now') WHERE id = ?`, [id]);

  return {
    recipient: String(r.counterparty_ref), mistaken: input.mistaken, correct: input.correct,
    because: input.because.trim(), correctedAt: new Date().toISOString(),
  };
}

/**
 * EVERY CORRECTION EVER MADE TO THIS EXPERIMENT, for the owner and for an audit.
 *
 * The attestation is read back here rather than only written. That is the whole
 * reason those columns exist: a correction record that nobody can read is not a
 * record, it is a comment in a table. Anyone asking later whether a stratum was
 * moved — and whether anything had already happened under the old value when it
 * was — gets the answer from this, in the words the row was written with.
 */
export async function correctionsOf(experimentId: string): Promise<Array<{
  recipient: string; mistaken: string; correct: string; origin: string;
  because: string; by: string; at: string; consumed: boolean;
  /** What the correction attested was true when it was made. */
  attested: {
    nothingAuthorised: boolean; nothingSent: boolean; nobodyReplied: boolean;
    nothingPaid: boolean; noEvidenceRestsOnIt: boolean;
  };
  /** The attestation as one sentence, for a page or a report. */
  attestedInWords: string;
}>> {
  return ((await query(
    `SELECT r.counterparty_ref AS who, c.mistaken, c.correct, c.origin, c.because,
            c.corrected_by, c.corrected_at, c.consumed_at,
            c.nothing_authorised, c.nothing_sent, c.nobody_replied,
            c.nothing_paid, c.no_evidence_rests_on_it
       FROM recipient_stratum_corrections c
       JOIN experiment_recipients r ON r.id = c.recipient_id
      WHERE c.experiment_id = ? ORDER BY c.corrected_at`, [experimentId]))
    .rows as unknown as Array<Record<string, unknown>>).map((x) => {
    const attested = {
      nothingAuthorised: Number(x.nothing_authorised) === 1,
      nothingSent: Number(x.nothing_sent) === 1,
      nobodyReplied: Number(x.nobody_replied) === 1,
      nothingPaid: Number(x.nothing_paid) === 1,
      noEvidenceRestsOnIt: Number(x.no_evidence_rests_on_it) === 1,
    };
    const missing = [
      attested.nothingAuthorised ? null : 'something was authorised',
      attested.nothingSent ? null : 'something was sent',
      attested.nobodyReplied ? null : 'somebody replied',
      attested.nothingPaid ? null : 'something was paid',
      attested.noEvidenceRestsOnIt ? null : 'evidence rests on it',
    ].filter((m): m is string => m !== null);
    return {
      recipient: String(x.who), mistaken: String(x.mistaken), correct: String(x.correct),
      origin: String(x.origin), because: String(x.because), by: String(x.corrected_by),
      at: String(x.corrected_at), consumed: x.consumed_at != null,
      attested,
      attestedInWords: missing.length === 0
        ? 'Nothing had happened under the mistaken value: nothing authorised, nothing sent, '
          + 'nobody replied, nothing paid, and no evidence rests on it.'
        : `The attestation is incomplete — ${missing.join('; ')}.`,
    };
  });
}

/**
 * A PLACE TO TEST A WRITE THAT IS NOT SOMEBODY'S BUSINESS.
 *
 * The row that had to be corrected was a real candidate, picked because it was
 * convenient. This exists so that the convenient thing and the right thing are
 * the same thing: it makes a scratch recipient, hands it to the probe, and
 * removes it afterwards.
 *
 * It REFUSES to run against a row it did not create. A diagnostic that reaches
 * for a real business is the mistake this file was written after.
 */
export async function withScratchRecipient<T>(input: {
  founderId: string; experimentId: string;
}, probe: (recipientId: string) => Promise<T>): Promise<T> {
  const { addRecipients, recipientsOf } = await import('./hand.js');
  const ref = `SCRATCH — institution diagnostic ${nanoid(8)}`;
  await addRecipients({
    founderId: input.founderId,
    experimentId: input.experimentId,
    recipients: [{ counterpartyRef: ref, email: `scratch@invalid.test`, channel: 'email', sourceUrl: null }],
  });
  const row = (await recipientsOf(input.experimentId)).find((x) => x.counterpartyRef === ref);
  if (!row) throw new CorrectionRefused('the scratch row could not be made; no probe runs against a real one');
  try {
    return await probe(row.id);
  } finally {
    // The delete guard refuses if anything happened to it, which is the point:
    // a scratch row that somehow acquired consequence stays and is visible.
    await query('DELETE FROM experiment_recipients WHERE id = ?', [row.id]).catch(() => undefined);
  }
}
