// =============================================================================
// FOUNDRY — the only two ways the Mandate reaches anything that acts.
//
// INSTITUTION_MODEL §3.2, §4.1 (30 September 2026). Steering "may narrow what
// Foundry looks for, and that is safe because it narrows." This module is the
// whole of that reach, kept in one place so it can be read and proven:
//
//   avoidsAsGuidance  the owner's portfolio-wide "leave X alone", handed to
//                     the search's own filter in the shape it already reads.
//                     A candidate can only be turned away by it.
//   spendFactor       "spend less": a number the daily thinking ceiling is
//                     multiplied by. Always between 0.5 and 1 — the Mandate
//                     can lower a ceiling and cannot raise one.
//
// Everything else in the Mandate is read by pages, never by a gate.
// (Scenarios 610 "No SaaS for now" and 611 "Spend less this month".)
// =============================================================================

import { mandateOf } from './statements.js';

/** The share of the daily thinking ceiling that stands while the owner asks Foundry to spend less. */
export const CONSERVE_FACTOR = 0.5;

/**
 * THE OWNER'S "LEAVE IT ALONE", AS SEARCH GUIDANCE. The id names the Mandate
 * row, so nothing that edits the search's own guidance can reach it; the
 * statement says where it came from, so a turned-away candidate says why.
 */
export async function avoidsAsGuidance(founderId: string, now: Date = new Date()): Promise<Array<{
  id: string; statement: string; kind: 'avoid'; subject: string; dimension: null;
}>> {
  return (await mandateOf(founderId, now))
    .filter((s) => s.dimension === 'avoid' && s.scope.kind === 'portfolio')
    .map((s) => ({ id: `mandate:${s.id}`, statement: `${s.statement} (what you want, on Control)`, kind: 'avoid' as const,
      subject: s.label, dimension: null }));
}

/**
 * HOW MUCH OF THE THINKING CEILING STANDS. 1 unless the owner asked Foundry
 * to spend less and that has not lapsed; then CONSERVE_FACTOR. Clamped, so no
 * statement — however it was written — can return more than 1.
 */
export async function spendFactor(founderId: string, now: Date = new Date()): Promise<{ factor: number; said: string | null; until: string | null }> {
  const conserve = (await mandateOf(founderId, now))
    .find((s) => s.dimension === 'posture' && s.subject === 'conserve' && s.scope.kind === 'portfolio');
  if (!conserve) return { factor: 1, said: null, until: null };
  return { factor: Math.min(1, Math.max(0, CONSERVE_FACTOR)), said: conserve.statement, until: conserve.until ?? conserve.reviewAt };
}
