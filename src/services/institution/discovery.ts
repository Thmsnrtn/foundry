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

  // THE SAME OBLIGATION, REPORTED AGAIN, IS ONE OBLIGATION.
  //
  // A founder who reports something and does not see it land the way they
  // expected reports it again; a co-founder reports what the founder already
  // did. Each report is its own signal, so this used to make its own
  // responsibility for each, and the company owed the same thing twice — listed
  // twice in the seven-day view, summed twice into a capacity judgment,
  // permissioned twice, and understood twice before either copy could move.
  //
  // The second REPORT is kept. A company saying a thing again is something
  // that happened, and the evidence says so. What converges is the obligation.
  //
  // Four things must match. A deadline is part of what is owed: the same words
  // for a different stated date are a different obligation, and converging them
  // would silently discard a date the company just stated — which no path here
  // is allowed to do, since the institution may not state a deadline itself.
  // Only an ACTIVE responsibility converges: reporting something again after
  // deciding not to do it is the company changing its mind, not a duplicate.
  //
  // And the SOURCE must match, so this converges a founder onto a founder and a
  // tool onto a tool, never one onto the other. That is deliberately narrower
  // than the obligation itself warrants — a company does not owe term reports
  // twice because a person and a rota both noticed — but merging across sources
  // is a decision about what provenance a responsibility carries when two
  // independent witnesses agree, and it is recorded for the owner rather than
  // taken here. The visible duplicate that remains is the one a founder and one
  // of their own systems both report.
  const sameObligation = await query(
    `SELECT r.id FROM institutional_responsibilities r
       JOIN signal_events e ON ('signal_event:' || e.id) = r.discovery_evidence_ref
        AND e.product_id = r.product_id
      WHERE r.product_id=? AND r.title=? AND r.capability=? AND r.disposition='active'
        AND ((r.due_at IS NULL AND ? IS NULL) OR r.due_at=?)
        AND e.source=?
      -- Oldest first, by INSERTION ORDER. Two responsibilities cannot both be
      -- the convergence target, and a nanoid tiebreak would pick between them
      -- at random.
      ORDER BY r.created_at,r.rowid LIMIT 1`,
    [productId, contract.title, contract.capability, due?.at ?? null, due?.at ?? null,
      String(row.source)],
  );
  if (sameObligation.rows.length) {
    return getResponsibility(productId, String((sameObligation.rows[0] as Record<string,unknown>).id));
  }

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
