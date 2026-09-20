// =============================================================================
// FOUNDRY — WHAT ACTUALLY HAPPENED TO AN EXPERIMENT, COUNTED FROM THE ROWS
//
// WHY THIS IS A READING AND NOT A PARAGRAPH. A tranche report described
// Experiment 001 as "21 of 25 written to, 4 questions back, 1 opt-out" and
// separately as "11 pending". Not one of those four numbers was wrong about
// nothing — each was a real count of a real table — and together they described
// an experiment that does not exist:
//
//   the "4 questions" were rehearsal traffic: addresses at `.test`, the SES
//     simulator, a DMARC report and the owner's own mailbox;
//   the "1 opt-out" was a `.test` address, recorded two days BEFORE the send;
//   the "11 pending" were internal agent proposals with no experiment at all;
//   and "of 25" was a design figure, not a cohort that existed.
//
// Prose is where counts from different tables go to be added together. So the
// counts live here, each carrying the query that produced it and a sentence
// saying what it is and is not, and the report quotes this rather than
// remembering.
//
// THE RULE THIS ENFORCES: A NUMBER ABOUT PEOPLE MUST COME FROM THE ROW THAT
// NAMES THE PERSON. Replies are counted only from mail whose sender is one of
// the recipients actually written to. Opt-outs are counted only from
// suppressions tied to this experiment. Everything else is reported separately
// as what it is — rehearsal, infrastructure, or somebody else's traffic.
// =============================================================================

import { query } from '../../db/client.js';

export interface Count {
  /** What this counts, in the owner's words. */
  what: string;
  n: number;
  /** Why the number is what it is, and what it deliberately excludes. */
  because: string;
}

export interface ExperimentReconciliation {
  experimentId: string;
  /** Every authorising act that reached people, and what each permitted. */
  acts: Array<{
    id: string; summary: string; decidedBy: string | null; decidedAt: string | null;
    consumedAt: string | null; revokedAt: string | null; expiresAt: string;
  }>;
  cohort: Count[];
  reached: Count[];
  cameBack: Count[];
  /** Traffic that is NOT evidence about this experiment, named so it is not counted as if it were. */
  notEvidence: Count[];
  /** What authority remains. Empty means nothing further may be sent. */
  remainingAuthority: string;
}

const one = async (sql: string, args: unknown[]): Promise<number> => {
  const r = (await query(sql, args)).rows[0] as Record<string, unknown> | undefined;
  return Number(r?.n ?? 0);
};

/**
 * RECONSTRUCT ONE EXPERIMENT FROM SOURCE ROWS.
 *
 * Deliberately says nothing about whether the experiment succeeded. That is a
 * judgement over evidence; this is the evidence, counted.
 */
export async function reconcileExperiment(
  experimentId: string,
): Promise<ExperimentReconciliation> {
  const acts = ((await query(
    `SELECT id, summary, decided_by, decided_at, consumed_at, revoked_at, expires_at
       FROM proposed_acts WHERE experiment_id = ? ORDER BY proposed_at`, [experimentId]))
    .rows as unknown as Array<Record<string, unknown>>)
    .map((a) => ({
      id: String(a.id), summary: String(a.summary),
      decidedBy: a.decided_by == null ? null : String(a.decided_by),
      decidedAt: a.decided_at == null ? null : String(a.decided_at),
      consumedAt: a.consumed_at == null ? null : String(a.consumed_at),
      revokedAt: a.revoked_at == null ? null : String(a.revoked_at),
      expiresAt: String(a.expires_at),
    }));

  // ─── the cohort ────────────────────────────────────────────────────────────
  const approved = await one(
    "SELECT COUNT(*) AS n FROM experiment_recipients WHERE experiment_id = ? AND review_status = 'approved'",
    [experimentId]);
  const pending = await one(
    "SELECT COUNT(*) AS n FROM experiment_recipients WHERE experiment_id = ? AND review_status = 'pending'",
    [experimentId]);
  const struck = await one(
    "SELECT COUNT(*) AS n FROM experiment_recipients WHERE experiment_id = ? AND review_status = 'struck'",
    [experimentId]);
  const withAct = await one(
    `SELECT COUNT(*) AS n FROM experiment_recipients
      WHERE experiment_id = ? AND authorised_act_id IS NOT NULL`, [experimentId]);
  const actCount = await one(
    `SELECT COUNT(DISTINCT authorised_act_id) AS n FROM experiment_recipients
      WHERE experiment_id = ? AND authorised_act_id IS NOT NULL`, [experimentId]);

  const cohort: Count[] = [
    { what: 'approved to be written to', n: approved,
      because: 'the owner reviewed each one and said yes; this is the only set anything was sent to' },
    { what: 'carrying an authorising act', n: withAct,
      because: withAct === approved
        ? 'every approved recipient is covered by an act, and no unapproved one is'
        : 'THIS SHOULD EQUAL THE APPROVED COUNT — a recipient written to without an act, or approved without one, is the failure the act exists to prevent' },
    { what: 'distinct acts covering them', n: actCount,
      because: actCount <= 1
        ? 'one act, so the authority did not grow by accumulation'
        : 'more than one act reached this cohort; each needs its own reading' },
    { what: 'proposed but never approved', n: pending,
      because: 'candidates only. No act covers them, nothing was sent to them, and nothing may be' },
    { what: 'struck from the population', n: struck,
      because: 'reviewed and removed, with the reason on the row' },
  ];

  // ─── what reached people ───────────────────────────────────────────────────
  const attempted = await one(
    "SELECT COUNT(*) AS n FROM outbound_actions WHERE experiment_id = ? AND status = 'executed'",
    [experimentId]);
  const withReceipt = await one(
    `SELECT COUNT(*) AS n FROM outbound_actions
      WHERE experiment_id = ? AND status = 'executed' AND provider_receipt_json IS NOT NULL`,
    [experimentId]);
  const delivered = await one(
    `SELECT COUNT(*) AS n FROM outbound_actions
      WHERE experiment_id = ? AND outcome_status = 'verified_success'`, [experimentId]);
  const failed = await one(
    `SELECT COUNT(*) AS n FROM outbound_actions
      WHERE experiment_id = ? AND outcome_status = 'verified_failure'`, [experimentId]);
  const unresolved = await one(
    `SELECT COUNT(*) AS n FROM outbound_actions
      WHERE experiment_id = ? AND status = 'executed' AND outcome_status IS NULL`, [experimentId]);

  const reached: Count[] = [
    { what: 'messages sent', n: attempted,
      because: 'one per approved recipient, executed through the outbound door' },
    { what: 'accepted by the provider', n: withReceipt,
      because: 'each carries a provider receipt; acceptance is not delivery' },
    { what: 'delivered', n: delivered, because: 'verified against the provider afterwards' },
    { what: 'bounced', n: failed,
      because: 'the provider reported them undeliverable; each is on the suppression list' },
    { what: 'still unresolved', n: unresolved,
      because: 'sent, and the provider has not yet said what became of it' },
  ];

  // ─── what came back, counted only from the people written to ───────────────
  // SCOPED TO THE FOUNDER WHOSE EXPERIMENT THIS IS, and a test caught that it
  // was not. Matching on the address alone counts a message in anybody's
  // mailbox as a reply to this test the moment the addresses coincide — which
  // is not a hypothetical when the same business is approached twice.
  const replied = await one(
    `SELECT COUNT(*) AS n FROM workshop_mail m
      WHERE m.founder_id = (SELECT founder_id FROM venture_experiments WHERE id = ?)
        AND lower(m.from_email) IN (
          SELECT lower(email) FROM experiment_recipients
           WHERE experiment_id = ? AND review_status = 'approved')`,
    [experimentId, experimentId]);
  const optedOut = await one(
    `SELECT COUNT(*) AS n FROM public_suppressions
      WHERE experiment_id = ? AND reason = 'they_asked'`, [experimentId]);
  const suppressed = await one(
    'SELECT COUNT(*) AS n FROM public_suppressions WHERE experiment_id = ?', [experimentId]);
  const purchased = await one(
    'SELECT COUNT(*) AS n FROM experiment_fulfilments WHERE experiment_id = ?', [experimentId]);

  const cameBack: Count[] = [
    { what: 'replies from people written to', n: replied,
      because: 'mail whose sender is one of the approved recipients. Anything else in the mailbox is not a reply to this' },
    { what: 'asked not to be written to', n: optedOut,
      because: 'suppressions recorded against this experiment because somebody said so' },
    { what: 'on the suppression list because of this test', n: suppressed,
      because: 'opt-outs and bounces together; both stop further contact' },
    { what: 'paid', n: purchased,
      because: purchased > 0 ? 'a fulfilment row was written when money arrived; what is owed on it is read on this page under what needs you' : 'a fulfilment row is written when money arrives, and none has' },
  ];

  // ─── traffic that is not evidence about this experiment ────────────────────
  const strangers = await one(
    `SELECT COUNT(*) AS n FROM workshop_mail m
      WHERE m.founder_id = (SELECT founder_id FROM venture_experiments WHERE id = ?)
        AND lower(m.from_email) NOT IN (
          SELECT lower(email) FROM experiment_recipients
           WHERE experiment_id = ? AND review_status = 'approved')`,
    [experimentId, experimentId]);
  const orphanOutbound = await one(
    `SELECT COUNT(*) AS n FROM outbound_actions o
      WHERE o.experiment_id IS NULL AND o.status = 'pending_approval'
        AND EXISTS (SELECT 1 FROM products p JOIN venture_experiments e ON e.founder_id = p.owner_id
                     WHERE p.id = o.product_id AND e.id = ?)`, [experimentId]);

  const notEvidence: Count[] = [
    { what: 'other mail in the Workshop mailbox', n: strangers,
      because: 'delivery reports, mail the Workshop sent itself, rehearsal addresses and the owner writing in. Real, and not a response from anybody this test reached' },
    { what: 'internal proposals waiting, belonging to no experiment', n: orphanOutbound,
      because: 'agent proposals about the institution itself. They reach nobody outside and are not part of any test' },
  ];

  // ─── what may still happen ─────────────────────────────────────────────────
  const live = acts.filter((a) => a.revokedAt === null && a.consumedAt === null);
  const remainingAuthority = live.length === 0
    ? acts.length === 0
      ? 'No act has ever authorised writing to anybody for this test.'
      : 'None. Every act for this test has been used or withdrawn, so nothing further may be '
        + 'sent under it. Reaching anyone else needs its own authority, over its own named set.'
    : `${String(live.length)} act${live.length === 1 ? '' : 's'} not yet used: `
      + live.map((a) => a.summary).join('; ');

  return { experimentId, acts, cohort, reached, cameBack, notEvidence, remainingAuthority };
}
