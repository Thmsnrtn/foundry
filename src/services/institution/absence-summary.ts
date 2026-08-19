import { liveActGrant, query } from '../../db/client.js';
import type { ResponsibilityState } from './responsibility.js';

export type AbsenceClassification = 'HANDLED' | 'CHANGED' | 'NEEDS_YOU' | 'DELIBERATELY_NOT_DONE' | 'STILL_OPEN';
export interface AbsenceItem {
  responsibilityId: string; title: string; state: ResponsibilityState;
  classification: AbsenceClassification; evidenceRef: string | null;
  authorityRef: string | null; outcomeRef: string | null; reason: string | null;
  /** Why this needs the founder, when it does. Plain language, no ontology. */
  needsYouBecause?: 'overdue' | 'watching' | 'permission_withdrawn' | 'permission_expired' | 'outcome_unresolved';
  /** When the company said this was due, if it said. Never inferred. */
  dueAt?: string;
}

/** Deterministic seven-day responsibility view. Absence is not evidence:
 * DELIBERATELY_NOT_DONE is never inferred, and HANDLED requires a recent
 * outcome-bearing maturity transition. */
export async function getSevenDayResponsibilitySummary(
  productId: string, now: Date = new Date(),
): Promise<Record<AbsenceClassification, AbsenceItem[]>> {
  const cutoff = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const responsibilities = await query(
    `SELECT id,title,state,evidence_ref,authority_ref,outcome_ref,disposition,disposition_reason,disposition_evidence_ref,due_at
       FROM institutional_responsibilities WHERE product_id=? ORDER BY updated_at DESC`, [productId],
  );
  const transitions = await query(
    `SELECT rt.responsibility_id,rt.from_state,rt.to_state,rt.reason,rt.created_at
       FROM responsibility_transitions rt
       JOIN institutional_responsibilities r ON r.id=rt.responsibility_id
      WHERE r.product_id=? AND rt.created_at>=? ORDER BY rt.created_at DESC`, [productId, cutoff],
  );
  const latest = new Map<string, Record<string, unknown>>();
  for (const row of transitions.rows as unknown as Array<Record<string, unknown>>) {
    if (!latest.has(String(row.responsibility_id))) latest.set(String(row.responsibility_id), row);
  }
  // Responsibilities that are Assisting but have no live permission. Foundry
  // has not forgotten how to help — it simply may not act — and a founder
  // returning after a week must be able to see that without asking.
  const withoutAuthority = new Set((await query(
    `SELECT r.id FROM institutional_responsibilities r
      WHERE r.product_id=? AND r.state='assisting' AND r.disposition='active'
        AND NOT EXISTS (
          SELECT 1 FROM autonomy_consents a
          WHERE a.responsibility_id=r.id AND a.product_id=r.product_id AND a.capability=r.capability
            AND ${liveActGrant('a')})`,
    [productId],
  )).rows.map((row) => String((row as Record<string, unknown>).id)));

  // Whether authority ended by an explicit revocation or by a lapsed expiry.
  // Both leave Foundry unable to act; only one was a decision, and the founder
  // is owed the difference. Only the MOST RECENT grant answers this: a
  // responsibility that was revoked, deliberately re-granted, and then allowed
  // to expire was not withdrawn — saying so would blame the founder for a
  // decision they reversed.
  const lastGrantRevoked = new Map<string, boolean>();
  for (const row of (await query(
    `SELECT responsibility_id,revoked_at FROM autonomy_consents
      WHERE product_id=? AND responsibility_id IS NOT NULL
      ORDER BY accepted_at DESC, id DESC`, [productId],
  )).rows as unknown as Array<Record<string, unknown>>) {
    const rid = String(row.responsibility_id);
    if (!lastGrantRevoked.has(rid)) lastGrantRevoked.set(rid, row.revoked_at != null);
  }

  // Effects Foundry carried out whose business outcome nobody has established.
  // A provider accepting an email is not the customer's problem being solved,
  // and a week of silence is not success.
  const unresolvedEffects = new Set((await query(
    `SELECT DISTINCT responsibility_id FROM outbound_actions
      WHERE product_id=? AND responsibility_id IS NOT NULL AND status='executed'
        AND (outcome_status IS NULL OR outcome_status='unresolved')`,
    [productId],
  )).rows.map((row) => String((row as Record<string, unknown>).responsibility_id)));

  // Effects that were carried in this window and that someone outside has since
  // confirmed achieved what they were for. Until migration 137 nothing could
  // supply this, so HANDLED could only ever mean "the responsibility reached
  // maturity" — a rung — rather than "a thing was done and it worked", which is
  // what a founder means by the word.
  const verifiedRecently = new Set((await query(
    `SELECT DISTINCT responsibility_id FROM outbound_actions
      WHERE product_id=? AND responsibility_id IS NOT NULL AND status='executed'
        AND outcome_status='verified_success' AND datetime(executed_at)>=datetime(?)`,
    [productId, cutoff],
  )).rows.map((row) => String((row as Record<string, unknown>).responsibility_id)));

  const out: Record<AbsenceClassification, AbsenceItem[]> = {
    HANDLED: [], CHANGED: [], NEEDS_YOU: [], DELIBERATELY_NOT_DONE: [], STILL_OPEN: [],
  };
  for (const row of responsibilities.rows as unknown as Array<Record<string, unknown>>) {
    const id = String(row.id); const state = row.state as ResponsibilityState; const recent = latest.get(id);
    // Mature responsibility is only reported as handled when the outcome-bearing
    // transition happened in this window. Old mature work is neither open nor
    // falsely repeated as newly handled.
    if ((state === 'mature' || state === 'exception_owned') && !recent
      && !unresolvedEffects.has(id) && !verifiedRecently.has(id)) continue;
    // Why this needs the founder, if it does. Order matters: a withdrawn
    // permission is more urgent than an unresolved outcome, because nothing
    // further can happen at all until it is restored.
    // A DATE THE COMPANY STATED HAS PASSED. First in the order, and it is the
    // only reason here that is a fact about the world rather than about
    // Foundry's own posture: a withdrawn permission, an unresolved outcome and
    // a shadowing watch are all descriptions of where Foundry has got to. An
    // overdue obligation is the company being late, which is what the founder
    // is actually trying to find out. It is also the only one of the four with
    // a deadline attached, which `EXPERIENCE.md` requires of an interruption
    // and none of the others could carry.
    //
    // Not overdue once it is done: a responsibility whose disposition says it
    // was handled or deliberately not done is not late, it is finished.
    const dueAt = row.due_at == null ? undefined : String(row.due_at);
    const overdue = dueAt !== undefined
      && Date.parse(dueAt) < Date.now()
      && row.disposition !== 'deliberately_not_done'
      && !verifiedRecently.has(id);

    const needsYouBecause: AbsenceItem['needsYouBecause'] | undefined =
      overdue ? 'overdue'
        : withoutAuthority.has(id)
          ? (lastGrantRevoked.get(id) === true ? 'permission_withdrawn' : 'permission_expired')
          : unresolvedEffects.has(id) ? 'outcome_unresolved'
            : state === 'shadowing' ? 'watching' : undefined;

    const classification: AbsenceClassification =
      row.disposition === 'deliberately_not_done' ? 'DELIBERATELY_NOT_DONE' :
      // HANDLED is never inferred from an effect being DISPATCHED. A
      // responsibility with an executed action whose outcome nobody has
      // established is not handled — it is waiting to be found out about.
      //
      // It IS handled when someone outside confirmed the effect achieved what
      // it was for, and nothing else about it is still unresolved. That is the
      // founder's meaning of the word, and it no longer requires the
      // responsibility to have climbed to maturity: a dance school whose cover
      // request worked had that handled, whatever rung it is on.
      (verifiedRecently.has(id) && !unresolvedEffects.has(id))
      || ((state === 'mature' || state === 'exception_owned') && row.outcome_ref && recent
        && !unresolvedEffects.has(id)) ? 'HANDLED' :
      needsYouBecause ? 'NEEDS_YOU' :
      recent ? 'CHANGED' : 'STILL_OPEN';
    out[classification].push({
      responsibilityId: id, title: String(row.title), state, classification,
      evidenceRef: row.evidence_ref == null ? null : String(row.evidence_ref),
      authorityRef: row.authority_ref == null ? null : String(row.authority_ref),
      outcomeRef: row.outcome_ref == null ? null : String(row.outcome_ref),
      reason: row.disposition === 'deliberately_not_done' ? String(row.disposition_reason) :
        recent?.reason == null ? null : String(recent.reason),
      ...(needsYouBecause ? { needsYouBecause } : {}),
      ...(dueAt ? { dueAt } : {}),
    });
  }
  return out;
}
