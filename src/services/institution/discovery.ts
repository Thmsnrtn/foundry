import { nanoid } from 'nanoid';
import { batch, query } from '../../db/client.js';
import { getResponsibility, type Responsibility } from './responsibility.js';

const SIGNAL_RESPONSIBILITIES: Record<string, { title: string; capability: string }> = {
  payment_failed: { title: 'Resolve failed customer payments', capability: 'billing_recovery' },
  churn_detected: { title: 'Respond to detected customer churn', capability: 'customer_success' },
  support_spike: { title: 'Restore support response capacity', capability: 'customer_support' },
  activation_failure: { title: 'Investigate customer activation failure', capability: 'customer_success' },
};

/** Admit only signal kinds whose operational responsibility is unambiguous.
 * Unsupported evidence remains evidence; it does not manufacture ontology. */
export async function discoverResponsibilityFromSignal(
  productId: string, signalEventId: string,
): Promise<Responsibility | null> {
  const evidence = await query(
    'SELECT event_type,summary FROM signal_events WHERE id=? AND product_id=?', [signalEventId, productId],
  );
  if (!evidence.rows.length) return null;
  const row = evidence.rows[0] as Record<string, unknown>;
  const contract = SIGNAL_RESPONSIBILITIES[String(row.event_type)];
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
        (id,product_id,title,description,capability,discovery_evidence_ref)
        VALUES (?,?,?,?,?,?)`, args: [id,productId,contract.title,String(row.summary),contract.capability,evidenceRef] },
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
