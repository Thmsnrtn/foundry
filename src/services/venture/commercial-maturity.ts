// =============================================================================
// FOUNDRY — how far a test's thesis has met commercial reality (CE0–CE6).
//
// RIVER.md keeps two ladders apart: E0–E6 says whether the machinery is
// proven; CE0–CE6 says whether a thesis has met commercial reality. Until now
// the second ladder existed only in prose, graded by hand in the maturity map
// (MASTER_COMPLETION_MATRIX row 36: "The E0–E6 and CE0–CE6 ladders do not
// exist as schema"). The owner's handoff of 28 September asks for it on every
// asset. This reads it from rows that already exist, and never says a rung the
// rows do not support:
//
//   CE1  a real, direct observation supports the claim the test bears on
//   CE2  somebody the provider could not match to the owner began to pay,
//        asked to keep hearing, or paid (even if the money went back)
//   CE3  such a payment, still paid: not refunded, not disputed unless the
//        dispute was won
//   CE4  and what that payment bought was delivered — for a venue, made
//        available by the venue's own rule, which is not a download seen
//
// CE5 (repeat, renewal, referral, repeatable distribution) and CE6 (sustained
// positive contribution) are judgements over time and conditions. No row says
// them, so this never does: the reading stops at CE4 and says so.
//
// Only the real world counts. Sandbox, reference, test-mode, the owner's own
// purchases and anything internal are not commercial reality, however they
// look in the ledger.
// =============================================================================

import { query } from '../../db/client.js';

export type CommercialRung = 'CE0' | 'CE1' | 'CE2' | 'CE3' | 'CE4';

export interface CommercialMaturity {
  rung: CommercialRung;
  /** What the rung rests on, in words that name the rows. */
  because: string;
  /** What the next rung would need, or why none is read here. */
  next: string;
}

type Row = Record<string, unknown>;

export async function commercialMaturityOf(experimentId: string): Promise<CommercialMaturity> {
  const r = (await query(
    `SELECT
       (SELECT COUNT(*) FROM market_observations o
         WHERE o.claim_id = e.claim_id AND o.evidence_mode = 'real' AND o.bearing = 'supports'
           AND o.directness = 'direct' AND o.from_absence = 0) AS observed,
       (SELECT COUNT(*) FROM business_outcome_events b JOIN experiment_exposures x ON x.id = b.exposure_id
         WHERE x.experiment_id = e.id AND x.evidence_mode = 'real' AND b.evidence_mode = 'real'
           AND b.counterparty = 'unmatched_external'
           AND b.kind IN ('checkout_started','continuation_requested','payment')
           -- A checkout opened and left (R35) is reach, not a beginning to pay:
           -- only an attempt the provider made an intent for is a commitment.
           AND NOT (b.kind = 'checkout_started' AND substr(b.provider_event_ref, 1, 3) = 'cs_')) AS committed,
       (SELECT COUNT(*) FROM experiment_fulfilments f
          JOIN business_outcome_events p ON p.id = f.payment_event_id
          JOIN experiment_exposures x ON x.id = f.exposure_id
         WHERE x.experiment_id = e.id AND x.evidence_mode = 'real' AND p.evidence_mode = 'real'
           AND p.counterparty = 'unmatched_external' AND f.refund_ref IS NULL AND f.status <> 'refunded'
           AND (f.disputed_at IS NULL OR f.dispute_outcome = 'won')) AS paid,
       (SELECT COUNT(*) FROM experiment_fulfilments f
          JOIN business_outcome_events p ON p.id = f.payment_event_id
          JOIN experiment_exposures x ON x.id = f.exposure_id
         WHERE x.experiment_id = e.id AND x.evidence_mode = 'real' AND p.evidence_mode = 'real'
           AND p.counterparty = 'unmatched_external' AND f.refund_ref IS NULL AND f.status = 'delivered'
           AND (f.disputed_at IS NULL OR f.dispute_outcome = 'won')) AS delivered,
       -- WHICH DELIVERY THE SENTENCE DESCRIBES: one that earned the rung, under
       -- the same conditions, never the owner's own or a refunded one. A mail
       -- delivery the provider confirmed outranks a venue's rule.
       (SELECT f.provider FROM experiment_fulfilments f
          JOIN business_outcome_events p ON p.id = f.payment_event_id
          JOIN experiment_exposures x ON x.id = f.exposure_id
         WHERE x.experiment_id = e.id AND x.evidence_mode = 'real' AND p.evidence_mode = 'real'
           AND p.counterparty = 'unmatched_external' AND f.refund_ref IS NULL AND f.status = 'delivered'
           AND (f.disputed_at IS NULL OR f.dispute_outcome = 'won')
         ORDER BY f.provider = 'stripe' DESC, f.created_at LIMIT 1) AS delivered_through,
       e.evidence_mode
       FROM venture_experiments e WHERE e.id = ?`, [experimentId])).rows[0] as Row | undefined;

  const beyond = 'CE5 and CE6 — repeat or repeatable distribution, and sustained positive contribution — are judged over time, not read from any row here';
  if (!r || String(r.evidence_mode) !== 'real') {
    return { rung: 'CE0', because: r ? 'a rehearsal in the laboratory, not the real world' : 'no such test',
      next: 'only a test in the real world can climb this ladder' };
  }
  const n = (k: string): number => Number(r[k] ?? 0);
  if (n('delivered') > 0) {
    const venue = r.delivered_through != null && String(r.delivered_through) !== 'stripe';
    return { rung: 'CE4',
      because: venue
        ? 'somebody the provider could not match to you paid, the money is still paid, and the venue made the file available by its own rule — the download itself is not observed'
        : 'somebody the provider could not match to you paid, the money is still paid, and the provider confirmed delivery',
      next: beyond };
  }
  if (n('paid') > 0) {
    return { rung: 'CE3', because: 'somebody the provider could not match to you paid, and the money is still paid',
      next: 'CE4 needs what they paid for to be delivered' };
  }
  if (n('committed') > 0) {
    return { rung: 'CE2', because: 'somebody the provider could not match to you began to pay, asked to hear more, or paid and was refunded',
      next: 'CE3 needs a payment that stays paid' };
  }
  if (n('observed') > 0) {
    return { rung: 'CE1', because: 'a direct observation in the real world supports the claim this test bears on',
      next: 'CE2 needs somebody the provider could not match to you to commit: begin to pay, or ask to hear more' };
  }
  return { rung: 'CE0', because: 'a hypothesis: no real observation supports its claim yet, and nobody has committed',
    next: 'CE1 needs a direct, real observation of the friction or the spending it assumes' };
}

/** One line for a page: the rung, what it rests on, and what it does not say. */
export function commercialMaturitySentence(m: CommercialMaturity): string {
  return `Commercial evidence: ${m.rung} — ${m.because}. ${m.next.charAt(0).toUpperCase()}${m.next.slice(1)}.`;
}
