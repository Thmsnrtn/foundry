import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

export const RESPONSIBILITY_STATES = [
  'unknown', 'visible', 'understood', 'shadowing', 'assisting', 'operating', 'mature', 'exception_owned',
] as const;
export type ResponsibilityState = typeof RESPONSIBILITY_STATES[number];

export interface Responsibility {
  id: string; productId: string; title: string; description: string | null; capability: string;
  state: ResponsibilityState; evidenceRef: string | null; authorityRef: string | null;
  outcomeRef: string | null; updatedAt: string;
}

/**
 * A responsibility, and the observation it was discovered from.
 *
 * THE EVIDENCE IS NOT OPTIONAL. This used to create a responsibility with no
 * `discovery_evidence_ref` at all — an institutional obligation that appeared
 * from nowhere, with nothing to point at when a founder asks why Foundry thinks
 * their company owes this. `discovery.ts`, the path production actually runs,
 * has always recorded it, and migration 105 puts a unique index on
 * (product_id, discovery_evidence_ref) so one observation yields one
 * responsibility rather than a new one on every pass.
 *
 * Verified against a real signal for this company rather than trusted as a
 * string: a caller-supplied reference that names nothing is exactly the
 * narrative-over-evidence this ladder exists to refuse, and a TypeScript
 * parameter is erased at runtime.
 */
export async function createResponsibility(input: {
  productId: string; title: string; capability: string;
  /** `signal_event:<id>`, naming an event this company actually recorded. */
  discoveryEvidenceRef: string;
  description?: string;
}): Promise<Responsibility> {
  const title = input.title.trim();
  if (!title) throw new Error('responsibility title is required');
  const capability = input.capability.trim();
  if (!capability) throw new Error('responsibility capability is required');

  const evidenceRef = input.discoveryEvidenceRef?.trim() ?? '';
  const signalId = evidenceRef.startsWith('signal_event:') ? evidenceRef.slice('signal_event:'.length) : '';
  if (!signalId) throw new Error('responsibility discovery evidence must be a signal_event reference');
  const observed = await query(
    'SELECT 1 FROM signal_events WHERE id=? AND product_id=?', [signalId, input.productId]);
  if (!observed.rows.length) throw new Error('responsibility discovery evidence names no signal of this company');

  const id = nanoid();
  await query(
    `INSERT INTO institutional_responsibilities (id,product_id,title,capability,description,discovery_evidence_ref)
     VALUES (?,?,?,?,?,?)`,
    [id, input.productId, title, capability, input.description?.trim() || null, evidenceRef],
  );
  return getResponsibility(input.productId, id) as Promise<Responsibility>;
}

export async function getResponsibility(productId: string, id: string): Promise<Responsibility | null> {
  const result = await query(
    `SELECT id,product_id,title,description,capability,state,evidence_ref,authority_ref,outcome_ref,updated_at
     FROM institutional_responsibilities WHERE id=? AND product_id=?`, [id, productId],
  );
  if (!result.rows.length) return null;
  const row = result.rows[0] as Record<string, unknown>;
  return {
    id: String(row.id), productId: String(row.product_id), title: String(row.title),
    description: row.description == null ? null : String(row.description), capability: String(row.capability),
    state: row.state as ResponsibilityState,
    evidenceRef: row.evidence_ref == null ? null : String(row.evidence_ref),
    authorityRef: row.authority_ref == null ? null : String(row.authority_ref),
    outcomeRef: row.outcome_ref == null ? null : String(row.outcome_ref),
    updatedAt: String(row.updated_at),
  };
}

export async function transitionResponsibility(input: {
  productId: string; responsibilityId: string; from: ResponsibilityState; to: ResponsibilityState;
  evidenceRef?: string; authorityRef?: string; outcomeRef?: string; reason: string; actorRef: string;
}): Promise<Responsibility> {
  const current = await getResponsibility(input.productId, input.responsibilityId);
  if (!current) throw new Error('responsibility not found');
  if (!input.reason.trim()) throw new Error('transition reason is required');
  if (!input.actorRef.trim()) throw new Error('transition actor is required');
  await query(
    `INSERT INTO responsibility_transitions
     (id,responsibility_id,from_state,to_state,evidence_ref,authority_ref,outcome_ref,reason,actor_ref)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [nanoid(), input.responsibilityId, input.from, input.to, input.evidenceRef ?? null,
      input.authorityRef ?? null, input.outcomeRef ?? null, input.reason.trim(), input.actorRef.trim()],
  );
  return getResponsibility(input.productId, input.responsibilityId) as Promise<Responsibility>;
}

/** Record or revoke deliberate non-action. Ownership is verified atomically by
 * the database trigger; a caller-supplied actor string cannot grant authority. */
export async function setResponsibilityDisposition(input: {
  productId: string; responsibilityId: string; ownerId: string;
  disposition: 'active' | 'deliberately_not_done'; reason: string; evidenceRef: string;
}): Promise<void> {
  await query(
    `INSERT INTO responsibility_dispositions
     (id,responsibility_id,product_id,disposition,reason,evidence_ref,owner_id)
     VALUES (?,?,?,?,?,?,?)`,
    [nanoid(), input.responsibilityId, input.productId, input.disposition,
      input.reason.trim(), input.evidenceRef.trim(), input.ownerId],
  );
}
