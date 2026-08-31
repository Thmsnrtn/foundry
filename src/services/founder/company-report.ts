// =============================================================================
// FOUNDRY — Founder-reported company obligations (migration 126)
//
// Two audit findings made this necessary.
//
// First: `emitSignalEvent` — the only function that records a company signal
// and runs responsibility discovery — had no caller anywhere in `src/`. The
// institution's evidence intake was reachable and never fed, so the ladder's
// first rung had no supply. This is its first production caller.
//
// Second: discovery admitted four signal kinds named after software-company
// events. The semantic rule behind them is right — admit only evidence whose
// operational responsibility is unambiguous — but the vocabulary meant a marina
// or a dance school could only be recognised when its reality happened to fit a
// software company's words.
//
// So the founder states the kind explicitly, from a closed set of generic
// operational obligations. Nothing is inferred from free-form prose: an
// unrecognised kind never becomes a responsibility, and ambiguous chat stays
// conversation. Foundry does not paraphrase the company back to itself either —
// the responsibility is titled in the founder's own words.
//
// Reporting an obligation is not permission to discharge it. The responsibility
// enters at Visible like any other, and every fact needed to understand it must
// still be established through the ordinary evidence path.
// =============================================================================

import { query } from '../../db/client.js';
import { emitSignalEvent } from '../scp/events/dispatcher.js';
import { type Responsibility } from '../institution/responsibility.js';
import { discoverResponsibilityFromSignal } from '../institution/discovery.js';

/** Generic operational semantics. None of these names an industry, and the
 * same closed set is held in migration 126 so it cannot be widened at runtime. */
export const REPORTABLE_OBLIGATIONS = [
  'recurring_work', 'customer_commitment', 'exception', 'revenue_collection',
  'delivery', 'maintenance', 'development', 'operational_dependency',
] as const;
export type ReportableObligation = typeof REPORTABLE_OBLIGATIONS[number];

/** Plain labels for the founder. The internal kind never appears on screen. */
export const OBLIGATION_LABELS: Record<ReportableObligation, string> = {
  recurring_work: 'Something that has to happen regularly',
  customer_commitment: 'Something a customer is waiting on',
  exception: 'Something that went wrong and needs handling',
  revenue_collection: 'Money owed to us that needs collecting',
  delivery: 'Something we owe someone by a date',
  maintenance: 'Something that has to be kept working',
  development: 'Something that has to be built or changed',
  operational_dependency: 'Something we depend on to operate',
};

export function isReportableObligation(value: string): value is ReportableObligation {
  return (REPORTABLE_OBLIGATIONS as readonly string[]).includes(value);
}

/**
 * An authenticated founder reports something their company must handle.
 *
 * Returns the responsibility if the report was unambiguous enough to become
 * one, and null when it was not — an unusable report is still recorded as
 * evidence, because a company said it. It simply does not manufacture ontology.
 */
/**
 * A stated due date, or null.
 *
 * ONLY THE COMPANY MAY STATE ONE. Foundry never infers a date from prose —
 * "by the end of the month" is a sentence, not a deadline, and turning it into
 * one would be Foundry authoring the thing it later judges itself against. The
 * founder or the reporting system supplies an explicit ISO date or nothing.
 *
 * A date already past is refused rather than stored. It is almost always a
 * typo or a timezone confusion, and the one thing worse than no sense of time
 * is a sense of time that starts by reporting a fabricated overdue.
 */
export function statedDueDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  // A minute of slack: a date entered as "today" is due at midnight, and a
  // request arriving a moment later should not be refused for it.
  if (t < Date.now() - 60_000) return null;
  return new Date(t).toISOString();
}

export async function reportCompanyObligation(input: {
  productId: string; founderId: string; obligationKind: string; what: string;
  /** When the company says this is due. Optional; never inferred. */
  dueAt?: string;
}): Promise<{ signalId: string; responsibility: Responsibility | null } | null> {
  const what = input.what.trim();
  if (!what || !isReportableObligation(input.obligationKind)) return null;
  const dueAt = statedDueDate(input.dueAt);

  // Defence in depth: the database verifies ownership too, and refuses the
  // whole report if it cannot.
  const owned = await query('SELECT 1 FROM products WHERE id=? AND owner_id=?',
    [input.productId, input.founderId]);
  if (!owned.rows.length) return null;

  const signalId = await emitSignalEvent(input.productId, {
    source: 'founder_report',
    event_type: `founder_reported:${input.obligationKind}`,
    severity: 'medium',
    payload: {
      obligation_kind: input.obligationKind, what, founder_id: input.founderId,
      // Carried on the evidence, so the responsibility's date and the record
      // of who said it come from the same place.
      ...(dueAt ? { due_at: dueAt, due_stated_by: input.founderId } : {}),
    },
    summary: what,
  });

  // Asked of discovery rather than read back by evidence reference. Discovery
  // converges a repeat of the same obligation onto the responsibility that
  // already exists, and that one does not carry THIS signal's reference — so
  // the read-back reported "nothing was discovered" for the case where
  // something was. Re-running discovery is idempotent by construction.
  const responsibility = await discoverResponsibilityFromSignal(input.productId, signalId);
  return { signalId, responsibility };
}

/**
 * One of the company's own systems reports something that must be handled.
 *
 * The same closed vocabulary the founder uses, and the same consequence: the
 * responsibility enters at Visible with nothing granted. Provenance is NOT
 * laundered — this is recorded under its own source, so a rota system noticing
 * a class has no teacher is never mistaken for the founder saying it, and the
 * database refuses any payload that tries to carry a founder id.
 *
 * Identity is the ingest token. The body does not get to claim one.
 */
export async function reportExternalObligation(input: {
  productId: string; reportedBy: string; obligationKind: string; what: string;
  /** When the reporting system says this is due. Optional; never inferred. */
  dueAt?: string;
}): Promise<{ signalId: string; responsibility: Responsibility | null } | null> {
  const what = input.what.trim();
  const reportedBy = input.reportedBy.trim();
  if (!what || what.length > 200 || !reportedBy) return null;
  if (!isReportableObligation(input.obligationKind)) return null;
  const dueAt = statedDueDate(input.dueAt);

  const signalId = await emitSignalEvent(input.productId, {
    source: 'external_company_report',
    event_type: `external_reported:${input.obligationKind}`,
    severity: 'medium',
    payload: {
      obligation_kind: input.obligationKind, what, reported_by: reportedBy,
      // The channel key is the author, exactly as it is for the report itself.
      // A rota system stating a date is not the founder stating one.
      ...(dueAt ? { due_at: dueAt, due_stated_by: reportedBy } : {}),
    },
    summary: what,
  });

  // Same as the founder path: ask discovery, which converges a repeat of the
  // same obligation rather than reporting nothing was found.
  const responsibility = await discoverResponsibilityFromSignal(input.productId, signalId);
  return { signalId, responsibility };
}
