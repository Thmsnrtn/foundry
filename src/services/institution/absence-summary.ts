import { query } from '../../db/client.js';
import type { ResponsibilityState } from './responsibility.js';

export type AbsenceClassification = 'HANDLED' | 'CHANGED' | 'NEEDS_YOU' | 'DELIBERATELY_NOT_DONE' | 'STILL_OPEN';
export interface AbsenceItem {
  responsibilityId: string; title: string; state: ResponsibilityState;
  classification: AbsenceClassification; evidenceRef: string | null;
  authorityRef: string | null; outcomeRef: string | null; reason: string | null;
  /** Why this needs the founder, when it does. Plain language, no ontology. */
  needsYouBecause?: 'watching' | 'permission_withdrawn' | 'permission_expired' | 'outcome_unresolved';
}

/** Deterministic seven-day responsibility view. Absence is not evidence:
 * DELIBERATELY_NOT_DONE is never inferred, and HANDLED requires a recent
 * outcome-bearing maturity transition. */
export async function getSevenDayResponsibilitySummary(
  productId: string, now: Date = new Date(),
): Promise<Record<AbsenceClassification, AbsenceItem[]>> {
  const cutoff = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const responsibilities = await query(
    `SELECT id,title,state,evidence_ref,authority_ref,outcome_ref,disposition,disposition_reason,disposition_evidence_ref
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
            AND a.to_mode='act' AND a.revoked_at IS NULL AND datetime(a.expires_at)>datetime('now'))`,
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

  const out: Record<AbsenceClassification, AbsenceItem[]> = {
    HANDLED: [], CHANGED: [], NEEDS_YOU: [], DELIBERATELY_NOT_DONE: [], STILL_OPEN: [],
  };
  for (const row of responsibilities.rows as unknown as Array<Record<string, unknown>>) {
    const id = String(row.id); const state = row.state as ResponsibilityState; const recent = latest.get(id);
    // Mature responsibility is only reported as handled when the outcome-bearing
    // transition happened in this window. Old mature work is neither open nor
    // falsely repeated as newly handled.
    if ((state === 'mature' || state === 'exception_owned') && !recent && !unresolvedEffects.has(id)) continue;
    // Why this needs the founder, if it does. Order matters: a withdrawn
    // permission is more urgent than an unresolved outcome, because nothing
    // further can happen at all until it is restored.
    const needsYouBecause: AbsenceItem['needsYouBecause'] | undefined =
      withoutAuthority.has(id)
        ? (lastGrantRevoked.get(id) === true ? 'permission_withdrawn' : 'permission_expired')
        : unresolvedEffects.has(id) ? 'outcome_unresolved'
          : state === 'shadowing' ? 'watching' : undefined;

    const classification: AbsenceClassification =
      row.disposition === 'deliberately_not_done' ? 'DELIBERATELY_NOT_DONE' :
      // HANDLED is never inferred from an effect being dispatched. A
      // responsibility with an executed action whose outcome nobody has
      // established is not handled — it is waiting to be found out about.
      (state === 'mature' || state === 'exception_owned') && row.outcome_ref && recent
        && !unresolvedEffects.has(id) ? 'HANDLED' :
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
    });
  }
  return out;
}
