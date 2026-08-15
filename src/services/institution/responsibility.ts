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

export async function createResponsibility(input: {
  productId: string; title: string; capability: string; description?: string;
}): Promise<Responsibility> {
  const title = input.title.trim();
  if (!title) throw new Error('responsibility title is required');
  const capability = input.capability.trim();
  if (!capability) throw new Error('responsibility capability is required');
  const id = nanoid();
  await query(
    `INSERT INTO institutional_responsibilities (id,product_id,title,capability,description)
     VALUES (?,?,?,?,?)`, [id, input.productId, title, capability, input.description?.trim() || null],
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
