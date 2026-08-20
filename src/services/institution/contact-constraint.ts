// =============================================================================
// FOUNDRY — what a person outside the company has said about being contacted
//
// The governed execution boundary answers "does the owner permit this actor to
// do this?" It could not answer "may this be done to THIS person?" — and the
// person an effect reaches is not represented by the founder's authority.
//
// WHAT WAS THERE. Migration 094 created a suppression list and stated the law
// on its face: "an address on this list is never contacted again, by any mode,
// at any trust level." One department consulted it. The institution's governed
// email path never did, and `addSuppression` had no caller anywhere — so
// nobody could get onto the list, and the one reader always found it empty. A
// control that cannot be populated and is not consulted is a stated rule with
// no consequence path, which is the shape this campaign keeps finding.
//
// WHAT THIS IS. One implementation, consulted at the point every outward effect
// converges, so no caller has to remember it. The list is the same one; what
// changes is who reads it and how somebody gets on it.
//
// IT IS A RECORDED FACT, NEVER AN INFERRED ONE. Foundry does not read a
// customer's reply and decide they meant "stop" — reading intent out of prose
// is how a person's wish becomes a model's guess. The company states it, the
// same way it states an obligation, and the record says who said so.
//
// SCOPE, stated because the envelope has more terms than this one: this is the
// only affected-party constraint that exists today. It is not a rights engine
// and adding a second kind means adding a recorded fact, not a policy language.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

/** Why this address is not contacted. A closed set: the reason is part of the
 *  record, and free text here would be somebody's summary of a person. */
export const CONTACT_CONSTRAINT_REASONS = [
  'they_asked',      // the person told the company to stop
  'bounced',         // the address does not accept mail
  'founder',         // the founder's own decision
] as const;
export type ContactConstraintReason = typeof CONTACT_CONSTRAINT_REASONS[number];

export const CONTACT_CONSTRAINT_LABELS: Record<ContactConstraintReason, string> = {
  they_asked: 'they asked not to be contacted',
  bounced: 'mail to them does not arrive',
  founder: 'you asked me not to contact them',
};

const normalise = (email: string): string => email.toLowerCase().trim();

/**
 * Does this person hold a recorded constraint against being contacted by this
 * company?
 *
 * Company-scoped on purpose. A person who told one company to stop has said
 * nothing about another, and treating it as global would be Foundry deciding
 * something on their behalf that they did not say.
 */
export async function contactIsRefused(
  productId: string, email: string,
): Promise<{ refused: true; reason: string } | { refused: false }> {
  const address = normalise(email);
  if (!address) return { refused: false };
  const row = (await query(
    'SELECT reason FROM outreach_suppressions WHERE product_id = ? AND email = ?',
    [productId, address],
  )).rows[0] as Record<string, unknown> | undefined;
  return row ? { refused: true, reason: String(row.reason) } : { refused: false };
}

/**
 * Record that this person is not to be contacted by this company.
 *
 * Append-only by design, per migration 094: rows are added, and removing
 * somebody is a deliberate act rather than a side effect of anything else.
 */
export async function recordContactConstraint(input: {
  productId: string; founderId: string; email: string; reason: ContactConstraintReason;
}): Promise<{ recorded: true } | { refused: 'email_invalid' | 'reason_invalid' | 'not_permitted' }> {
  const address = normalise(input.email);
  if (!address || !address.includes('@') || address.length > 320) return { refused: 'email_invalid' };
  if (!CONTACT_CONSTRAINT_REASONS.includes(input.reason)) return { refused: 'reason_invalid' };

  // ASKED THROUGH THE COMPANY'S OWN AUTHORIZATION MODEL, not through an inline
  // ownership scope. `owner_id = ?` answers "is this your company", which is a
  // different question from "may you do this" — and answering the first is how
  // the second went unasked across this codebase. An accepted co-founder who
  // hears somebody say stop must be able to record it; an investor observer
  // must not be able to mute the company's outreach silently.
  const { memberMay } = await import('../team/members.js');
  if (!(await memberMay(input.productId, input.founderId, 'can_manage_company'))) {
    return { refused: 'not_permitted' };
  }

  await query(
    `INSERT INTO outreach_suppressions (id, product_id, email, reason)
     VALUES (?, ?, ?, ?) ON CONFLICT(product_id, email) DO NOTHING`,
    [nanoid(), input.productId, address, input.reason],
  );
  return { recorded: true };
}

/** Everyone this company is not contacting, newest first. A list nobody can see
 *  is a list nobody can correct. */
export async function getContactConstraints(
  productId: string, limit = 50,
): Promise<Array<{ email: string; reason: string; recordedAt: string }>> {
  const rows = await query(
    `SELECT email, reason, created_at FROM outreach_suppressions
      WHERE product_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    [productId, limit],
  );
  return (rows.rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    email: String(r.email), reason: String(r.reason), recordedAt: String(r.created_at),
  }));
}
