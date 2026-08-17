// =============================================================================
// FOUNDRY — founder-authored notices about a responsibility (migration 136)
//
// The support path assumes a customer wrote in first. Most companies are not
// doing customer support: a dance school needs to tell a teacher their class
// needs cover, an agency needs to tell a client their month is at risk, a
// boatyard needs to tell an owner their parts arrived. There is no inbound
// message to reply to, and waiting for one would mean the work never happens.
//
// This is the same governed boundary as the support reply, reached by a
// different capability. Migration 136 made that possible by removing
// `capability='customer_support'` from the effect guard; this is the path that
// makes the second effect kind real rather than a vocabulary entry with nobody
// behind it.
//
// EVERY SEPARATION THE SUPPORT PATH KEEPS IS KEPT HERE.
//
//   • The founder writes the words. Foundry composes nothing — there is no
//     model on this path and none implied by it. A notice Foundry wrote would
//     be a claim about the company made in the company's name.
//   • Authoring is not planning. Writing a notice records evidence that the
//     founder said something; it sends nothing and authorises nothing.
//   • Planning is not sending. Authority is read at plan time and read again
//     immediately before dispatch, so a withdrawal in between stops the send.
//   • Dispatch is not outcome. A provider accepting a notice is not the teacher
//     turning up.
//
// The recipient is supplied by the founder rather than derived from company
// data, because unlike a support reply there is no message whose sender
// structurally determines who this is for. That is a real difference, and it is
// why the notice carries the recipient in its own evidence: whoever it reaches,
// a person chose them and the record says who chose.
// =============================================================================

import { createHash } from 'node:crypto';
import { query } from '../../db/client.js';
import {
  RESPONSIBILITY_NOTICE_SCOPE, planAssistedSupportEmail,
} from './responsibility-assisted-email.js';

const MAX_BODY = 8192;
const MAX_SUBJECT = 200;

export interface ResponsibilityNotice {
  id: string; responsibilityId: string; recipient: string;
  subject: string; body: string; authoredAt: string;
}

export type NoticeRefusal =
  | 'recipient_required' | 'content_required' | 'content_too_large'
  | 'responsibility_invalid' | 'not_assisting' | 'no_authority';

/** Stable identity for one authored notice, so re-submitting the same words to
 * the same person converges instead of queueing a second one. */
function noticeId(productId: string, responsibilityId: string, recipient: string, body: string): string {
  return 'notice_' + createHash('sha256')
    .update([productId, responsibilityId, recipient, body].join('\n')).digest('hex').slice(0, 32);
}

/**
 * The founder writes a notice. Nothing is sent and nothing is authorised.
 *
 * Recorded as canonical evidence, exactly as a support reply proposal is: a
 * company said something, with provenance, and that is all this is.
 */
export async function proposeResponsibilityNotice(input: {
  productId: string; founderId: string; responsibilityId: string;
  recipient: string; subject: string; body: string;
}): Promise<{ notice: ResponsibilityNotice; duplicate: boolean } | { refused: NoticeRefusal }> {
  const recipient = input.recipient?.trim();
  const subject = input.subject?.trim();
  const body = input.body?.trim();
  if (!recipient || !recipient.includes('@') || recipient.length > 320) return { refused: 'recipient_required' };
  if (!body || !subject) return { refused: 'content_required' };
  if (body.length > MAX_BODY || subject.length > MAX_SUBJECT) return { refused: 'content_too_large' };

  const owned = (await query(
    `SELECT r.id FROM institutional_responsibilities r JOIN products p ON p.id=r.product_id
      WHERE r.id=? AND r.product_id=? AND p.owner_id=? AND r.disposition='active'`,
    [input.responsibilityId, input.productId, input.founderId],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!owned) return { refused: 'responsibility_invalid' };

  const id = noticeId(input.productId, input.responsibilityId, recipient, body);
  const existing = await findNotice(input.productId, id);
  if (existing) return { notice: existing, duplicate: true };

  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
     VALUES (?,?,'founder_responsibility_notice','founder_authored_notice','low',?,?)`,
    [id, input.productId,
      JSON.stringify({
        responsibility_id: input.responsibilityId, founder_id: input.founderId,
        recipient, subject, body,
      }),
      'The founder wrote a notice about a responsibility'],
  );
  return { notice: (await findNotice(input.productId, id))!, duplicate: false };
}

async function findNotice(productId: string, id: string): Promise<ResponsibilityNotice | null> {
  const row = (await query(
    `SELECT id,payload_json,created_at FROM signal_events
      WHERE id=? AND product_id=? AND source='founder_responsibility_notice'`, [id, productId],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const payload = JSON.parse(String(row.payload_json)) as {
    responsibility_id: string; recipient: string; subject: string; body: string;
  };
  return {
    id: String(row.id), responsibilityId: payload.responsibility_id, recipient: payload.recipient,
    subject: payload.subject, body: payload.body, authoredAt: String(row.created_at),
  };
}

/**
 * Bind an authored notice to exact current authority and write a plan.
 *
 * Sends nothing. `executeAssistedSupportEmail` revalidates every binding again
 * immediately before dispatch, which is what makes a revocation between
 * planning and sending actually stop the send.
 */
export async function planResponsibilityNotice(input: {
  productId: string; founderId: string; noticeId: string;
}): Promise<{ actionId: string; duplicate: boolean } | { refused: NoticeRefusal }> {
  const notice = await findNotice(input.productId, input.noticeId);
  if (!notice) return { refused: 'responsibility_invalid' };

  const responsibility = (await query(
    `SELECT r.id,r.state,r.capability FROM institutional_responsibilities r
       JOIN products p ON p.id=r.product_id
      WHERE r.id=? AND r.product_id=? AND p.owner_id=?`,
    [notice.responsibilityId, input.productId, input.founderId],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!responsibility) return { refused: 'responsibility_invalid' };
  if (String(responsibility.state) !== 'assisting') return { refused: 'not_assisting' };

  const consent = (await query(
    `SELECT id FROM autonomy_consents
      WHERE product_id=? AND responsibility_id=? AND capability=? AND to_mode='act'
        AND revoked_at IS NULL AND datetime(expires_at)>datetime('now')
        AND consequence_boundary='low'
        AND instr(allowed_scope_json,json_quote(?))>0
      ORDER BY accepted_at DESC LIMIT 1`,
    [input.productId, notice.responsibilityId, String(responsibility.capability), RESPONSIBILITY_NOTICE_SCOPE],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!consent) return { refused: 'no_authority' };

  // One live plan per authored notice. A second planning call converges rather
  // than sending the same words to the same person twice.
  const live = await query(
    `SELECT id,authority_consent_id FROM outbound_actions
      WHERE product_id=? AND effect_id=? AND status<>'cancelled'`,
    [input.productId, notice.id],
  );
  if (live.rows.length) {
    const row = live.rows[0] as Record<string, unknown>;
    if (String(row.authority_consent_id) === String(consent.id)) {
      return { actionId: String(row.id), duplicate: true };
    }
    // Stranded on a grant that no longer authorises anything. It is cancelled
    // and stays cancelled — its binding does not migrate to the new grant, and
    // a new grant requires new planning before anything can be sent.
    await query("UPDATE outbound_actions SET status='cancelled' WHERE id=?", [String(row.id)]);
  }

  const actionId = await planAssistedSupportEmail({
    productId: input.productId, responsibilityId: notice.responsibilityId,
    authorityConsentId: String(consent.id), effectId: notice.id,
    to: notice.recipient, subject: notice.subject,
    html: notice.body, rationale: 'A notice the founder wrote about this responsibility',
    scope: RESPONSIBILITY_NOTICE_SCOPE,
  });
  return { actionId, duplicate: false };
}

/** Notices authored for a responsibility, newest first. */
export async function getResponsibilityNotices(
  productId: string, responsibilityId: string, limit = 10,
): Promise<ResponsibilityNotice[]> {
  const rows = await query(
    `SELECT id,payload_json,created_at FROM signal_events
      WHERE product_id=? AND source='founder_responsibility_notice'
        AND json_extract(payload_json,'$.responsibility_id')=?
      ORDER BY created_at DESC LIMIT ?`,
    [productId, responsibilityId, limit],
  );
  return (rows.rows as unknown as Array<Record<string, unknown>>).map((row) => {
    const payload = JSON.parse(String(row.payload_json)) as {
      responsibility_id: string; recipient: string; subject: string; body: string;
    };
    return {
      id: String(row.id), responsibilityId: payload.responsibility_id, recipient: payload.recipient,
      subject: payload.subject, body: payload.body, authoredAt: String(row.created_at),
    };
  });
}
