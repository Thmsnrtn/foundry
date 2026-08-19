import { nanoid } from 'nanoid';
import { batch, query } from '../../db/client.js';
import { getResponsibility, type Responsibility } from './responsibility.js';

// THE FOUR SAAS EVENT TYPES ARE GONE.
//
// `discovery.ts` used to map `payment_failed`, `churn_detected`,
// `support_spike` and `activation_failure` straight onto responsibilities.
// Nothing in production ever emitted any of them: `emitSignalEvent` is the only
// function that runs discovery and its one caller reports a stated obligation.
// Read on its own, that map said Foundry notices a company's billing and support
// problems and takes them up. It did not, and it had not since before it was
// written.
//
// It survived a deletion attempt because twenty test files built their ladder
// state through it — the institution's own suite entering through a door the
// running system does not have. Those files were moved onto the real intake
// first, one at a time under a ratchet, because turning twenty-five tests red at
// once is how tests get weakened under pressure rather than moved. With the
// ratchet at zero the map had nothing left holding it up.
//
// What remains below is the vocabulary that actually runs, and it is the same
// semantic rule stated without the SaaS words: evidence whose operational
// responsibility is unambiguous, because the company said what kind it is.

/** Generic operational obligations a company can report about itself.
 *
 * None of them names an industry, and migration 126 holds the same closed set,
 * so a sector-specific kind cannot be introduced at runtime.
 *
 * The title is the company's own description of what must be handled. Foundry
 * does not paraphrase the company back to itself. */
const OBLIGATION_CAPABILITIES: Record<string, string> = {
  recurring_work: 'operations',
  customer_commitment: 'customer_support',
  exception: 'operations',
  revenue_collection: 'billing_recovery',
  delivery: 'operations',
  maintenance: 'operations',
  development: 'development',
  operational_dependency: 'operations',
};

/** Admit only evidence whose operational responsibility is unambiguous.
 * Unsupported evidence remains evidence; it does not manufacture ontology. */
export async function discoverResponsibilityFromSignal(
  productId: string, signalEventId: string,
): Promise<Responsibility | null> {
  const evidence = await query(
    'SELECT source,event_type,summary,payload_json FROM signal_events WHERE id=? AND product_id=?',
    [signalEventId, productId],
  );
  if (!evidence.rows.length) return null;
  const row = evidence.rows[0] as Record<string, unknown>;

  // A person said it, or one of the company's own systems did. Both state the
  // kind explicitly from the same closed set, and both are refused by the
  // database if they do not. What differs is provenance, which is preserved in
  // the evidence rather than flattened here — a rota system noticing a class
  // has no teacher is not the founder saying so, and the record says which.
  if (!['founder_report', 'external_company_report'].includes(String(row.source))) return null;

  // Nothing is inferred from prose: an unrecognised kind is refused by
  // migration 126 before it reaches here, and a report without one never
  // becomes a responsibility.
  let contract: { title: string; capability: string } | undefined;
  let due: { at: string; statedBy: string } | null = null;
  try {
    const payload = JSON.parse(String(row.payload_json)) as {
      obligation_kind?: unknown; what?: unknown; due_at?: unknown; due_stated_by?: unknown;
    };
    const capability = typeof payload.obligation_kind === 'string'
      ? OBLIGATION_CAPABILITIES[payload.obligation_kind] : undefined;
    if (capability && typeof payload.what === 'string' && payload.what.trim()) {
      contract = { title: payload.what.trim(), capability };
      // A DATE THE COMPANY STATED, carried from the same evidence that
      // created the responsibility. Both fields or neither — the database
      // refuses a date with no author, so reading them separately here would
      // only move the failure later.
      if (typeof payload.due_at === 'string' && typeof payload.due_stated_by === 'string') {
        due = { at: payload.due_at, statedBy: payload.due_stated_by };
      }
    }
  } catch { return null; }
  if (!contract) return null;
  const evidenceRef = `signal_event:${signalEventId}`;
  const existing = await query(
    'SELECT id FROM institutional_responsibilities WHERE product_id=? AND discovery_evidence_ref=?',
    [productId, evidenceRef],
  );
  if (existing.rows.length) return getResponsibility(productId, String((existing.rows[0] as Record<string,unknown>).id));
  const id = nanoid(); const transitionId = nanoid();
  try {
    await batch([
      { sql: `INSERT INTO institutional_responsibilities
        (id,product_id,title,description,capability,discovery_evidence_ref,due_at,due_stated_by)
        VALUES (?,?,?,?,?,?,?,?)`,
        args: [id,productId,contract.title,String(row.summary),contract.capability,evidenceRef,
          due?.at ?? null, due?.statedBy ?? null] },
      { sql: `INSERT INTO responsibility_transitions
        (id,responsibility_id,from_state,to_state,evidence_ref,reason,actor_ref)
        VALUES (?,?,'unknown','visible',?,?,?)`,
        args: [transitionId,id,evidenceRef,'Company signal made this responsibility visible',`intake:signal_event:${signalEventId}`] },
    ]);
  } catch (error) {
    // A concurrent discovery may win the unique evidence claim. Return its
    // canonical record; rethrow every other failure.
    const won = await query('SELECT id FROM institutional_responsibilities WHERE product_id=? AND discovery_evidence_ref=?', [productId,evidenceRef]);
    if (!won.rows.length) throw error;
    return getResponsibility(productId,String((won.rows[0] as Record<string,unknown>).id));
  }
  return getResponsibility(productId,id);
}
