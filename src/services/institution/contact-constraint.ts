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
  /** The at-most-once identity of the effect about to be attempted, when the
   * caller has one. Used only to recognise an effect the institution already
   * owes; never to widen what may be done. */
  effectId?: string | null,
): Promise<{ refused: true; reason: string } | { refused: false }> {
  const address = normalise(email);
  if (!address) return { refused: false };
  const row = (await query(
    'SELECT reason FROM outreach_suppressions WHERE product_id = ? AND email = ?',
    [productId, address],
  )).rows[0] as Record<string, unknown> | undefined;
  if (row) return { refused: true, reason: String(row.reason) };
  // AND THE OWNER'S PUBLIC WORKSHOP'S LIST (migration 285). One public identity
  // stands behind every experiment of an owner, so a no said to any of them
  // is a no said to all of them: a person who opted out during one test is
  // not written to by the next because its id changed. Resolved through the
  // company's owner, so a company that is not the Workshop's (another
  // owner's) reads nothing here.
  const shared = (await query(
    `SELECT s.reason FROM public_suppressions s JOIN products p ON p.owner_id = s.founder_id
      WHERE p.id = ? AND s.email = ?`, [productId, address],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!shared) return { refused: false };
  // WHAT IS OWED IS NOT PROSPECTING. Somebody who told the Workshop to stop
  // writing to them and then bought something is owed what they bought: this
  // list governs being APPROACHED, never being ANSWERED, and a workshop that
  // withheld a paid-for delivery because of a marketing opt-out would be
  // keeping the money and calling it respect.
  //
  // The exemption is exactly the effects the institution already owes — an
  // outbound action bound to a purchase as a delivery — and nothing else. It
  // is recognised from the effect's own row, so no caller can claim it.
  if (effectId) {
    const owed = (await query(
      `SELECT 1 AS owed FROM outbound_actions WHERE effect_id = ? AND experiment_act = 'delivery'`, [effectId],
    )).rows[0];
    if (owed) return { refused: false };
    // AND ANSWERING SOMEBODY IS NOT APPROACHING THEM. A person who writes to
    // the Workshop — including to say "stop" — is owed a reply to the message
    // they chose to send; a list that governs being approached must not make
    // the Workshop go silent on somebody mid-sentence, least of all when the
    // sentence was a refusal and the reply is what confirms it was heard.
    //
    // Recognised, like the delivery above, from the effect's OWN row: there
    // must be a recorded answer bound to a message that THIS address actually
    // sent. A caller cannot claim it, because it requires an inbound message
    // that exists and came from them.
    const answering = (await query(
      `SELECT 1 AS answering FROM workshop_replies r JOIN workshop_mail m ON m.id = r.mail_id
        WHERE r.effect_id = ? AND m.from_email = ?`, [effectId, address],
    )).rows[0];
    if (answering) return { refused: false };
  }
  return { refused: true, reason: `workshop:${String(shared.reason)}` };
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
