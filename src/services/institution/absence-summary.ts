import { query } from '../../db/client.js';
import type { ResponsibilityState } from './responsibility.js';

export type AbsenceClassification = 'HANDLED' | 'CHANGED' | 'NEEDS_YOU' | 'DELIBERATELY_NOT_DONE' | 'STILL_OPEN';
export interface AbsenceItem {
  responsibilityId: string; title: string; state: ResponsibilityState;
  classification: AbsenceClassification; evidenceRef: string | null;
  authorityRef: string | null; outcomeRef: string | null; reason: string | null;
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
  const out: Record<AbsenceClassification, AbsenceItem[]> = {
    HANDLED: [], CHANGED: [], NEEDS_YOU: [], DELIBERATELY_NOT_DONE: [], STILL_OPEN: [],
  };
  for (const row of responsibilities.rows as unknown as Array<Record<string, unknown>>) {
    const id = String(row.id); const state = row.state as ResponsibilityState; const recent = latest.get(id);
    // Mature responsibility is only reported as handled when the outcome-bearing
    // transition happened in this window. Old mature work is neither open nor
    // falsely repeated as newly handled.
    if ((state === 'mature' || state === 'exception_owned') && !recent) continue;
    const classification: AbsenceClassification =
      row.disposition === 'deliberately_not_done' ? 'DELIBERATELY_NOT_DONE' :
      (state === 'mature' || state === 'exception_owned') && row.outcome_ref && recent ? 'HANDLED' :
      state === 'shadowing' ? 'NEEDS_YOU' :
      recent ? 'CHANGED' : 'STILL_OPEN';
    out[classification].push({
      responsibilityId: id, title: String(row.title), state, classification,
      evidenceRef: row.evidence_ref == null ? null : String(row.evidence_ref),
      authorityRef: row.authority_ref == null ? null : String(row.authority_ref),
      outcomeRef: row.outcome_ref == null ? null : String(row.outcome_ref),
      reason: row.disposition === 'deliberately_not_done' ? String(row.disposition_reason) :
        recent?.reason == null ? null : String(recent.reason),
    });
  }
  return out;
}
