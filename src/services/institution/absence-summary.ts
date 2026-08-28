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
  // `responsibility_transitions.created_at` is CURRENT_TIMESTAMP text and this
  // bound was an ISO string; compared as text, a space sorts before 'T', so a
  // transition recorded on the boundary date read as older than the window and
  // the "latest transition" for that responsibility went missing.
  const cutoff = new Date(now.getTime() - 7 * 86_400_000)
    .toISOString().replace('T', ' ').slice(0, 19);
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
      -- Ties break on INSERTION ORDER, not on id. accepted_at is
      -- second-granular and consent ids are nanoids, so a founder who revoked a
      -- permission and immediately granted a new one had "which grant is the
      -- last one" decided by which random id sorted higher — and the view then
      -- told them they had taken a permission away when they had just restored
      -- it and let it run out. Third instance of this shape in one campaign:
      -- reconstruction claims by claim id, reply proposals by content hash,
      -- and this.
      ORDER BY accepted_at DESC, rowid DESC`, [productId],
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

/**
 * How long the founder could be away before something the COMPANY said has a
 * date falls due — and everything that question cannot answer.
 *
 * `getSevenDayResponsibilitySummary` above answers what happened in the last
 * seven days, classified the way `EXPERIENCE.md` requires. It is backward
 * looking. The founder's actual question before they go is the other one, and
 * nothing answered it: CAN I LEAVE, AND FOR HOW LONG.
 *
 * THIS IS A FACT, NOT A PREDICTION, and the distinction is the whole design.
 * Foundry does not estimate how long it can cope. It reads the soonest date the
 * COMPANY ITSELF stated, on a responsibility that is still active, and reports
 * the interval to it. Nothing is inferred: a date with no author is refused at
 * the trigger, prose is never turned into a date, and a responsibility with no
 * stated date contributes nothing to this number in either direction.
 *
 * WHICH IS WHY THE CAVEATS ARE NOT DECORATION. A horizon computed only from
 * dated obligations is silent about undated ones, and reporting "eleven days"
 * while four things wait with no clock on them would be a composite resting on
 * what it did not measure — the defect this campaign spends its time removing.
 * So `needingYouWithoutDate` is returned beside the number and the surface must
 * say it. `alreadyOverdue` is separate again: those are not a horizon at all,
 * they are things that are already late.
 *
 * `loopsStopped` is the last caveat and the sharpest. If the passes that would
 * notice a problem are not running, the quiet this reading describes may be the
 * quiet of nothing looking. Absence of a signal is not a signal.
 */
export interface StepAwayHorizon {
  /** Whole days until the soonest stated due date. Null when nothing is dated —
   *  which is NOT "you can leave indefinitely". */
  daysUntilSoonestDue: number | null;
  /** The date itself, and whose responsibility carries it. */
  soonestDueAt: string | null;
  soonestDueTitle: string | null;
  /** Already past their stated date. Not a horizon — a debt. */
  alreadyOverdue: number;
  /** Needs the founder and carries no date, so the number above is silent
   *  about them. */
  needingYouWithoutDate: number;
  /** Institution passes not currently running. A quiet reading from a system
   *  that has stopped looking is not evidence of quiet. */
  loopsStopped: number;
}

export async function getStepAwayHorizon(
  productId: string, now: Date = new Date(),
): Promise<StepAwayHorizon> {
  const summary = await getSevenDayResponsibilitySummary(productId, now);
  const needsYou = summary.NEEDS_YOU;

  const dated = (await query(
    `SELECT title, due_at FROM institutional_responsibilities
      WHERE product_id = ? AND disposition = 'active' AND due_at IS NOT NULL
        AND datetime(due_at) > datetime(?)
      ORDER BY datetime(due_at) ASC, rowid ASC
      LIMIT 1`,
    [productId, now.toISOString()],
  )).rows[0] as Record<string, unknown> | undefined;

  const overdue = (await query(
    `SELECT COUNT(*) AS n FROM institutional_responsibilities
      WHERE product_id = ? AND disposition = 'active' AND due_at IS NOT NULL
        AND datetime(due_at) <= datetime(?)`,
    [productId, now.toISOString()],
  )).rows[0] as Record<string, unknown>;

  const { getFailingInstitutionLoops } = await import('./loop-health.js');
  const failing = await getFailingInstitutionLoops(now);

  const soonestDueAt = dated ? String(dated.due_at) : null;
  return {
    soonestDueAt,
    soonestDueTitle: dated ? String(dated.title) : null,
    // Whole days, rounded DOWN: a deadline in thirty hours is one day away, not
    // two. Rounding the other way would hand the founder a day they do not have.
    daysUntilSoonestDue: soonestDueAt === null ? null
      : Math.max(0, Math.floor(
        (new Date(soonestDueAt).getTime() - now.getTime()) / 86_400_000)),
    alreadyOverdue: Number(overdue.n ?? 0),
    needingYouWithoutDate: needsYou.filter((item) => !item.dueAt).length,
    loopsStopped: failing.length,
  };
}
