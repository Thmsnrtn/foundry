// =============================================================================
// FOUNDRY — Inbound customer communication (migration 131)
//
// Provider-neutral by construction: no vendor name appears here or in the
// schema. An adapter for a helpdesk, a mailbox, or a form is an ordinary caller
// that authenticates as a channel and posts a normalised message.
//
// WHY A CHANNEL EXISTS AT ALL. The hard part of this vertical is not carrying a
// message — it is knowing which responsibility the message belongs to without
// inferring it from prose. So the founder registers a channel *against* a
// responsibility, and the message is attributed because it arrived on that
// responsibility's own channel. The attribution is structural, and no text
// classification is involved.
//
// The intake key is what establishes channel identity. A caller does not label
// itself as a channel — it authenticates as one — which is why the payload has
// no channel field for anyone to forge.
//
// A customer message is evidence that someone outside said something. It is not
// a responsibility, not authority, not consent, not proof the customer is
// correct, and not proof that anything was resolved.
// =============================================================================

import { randomBytes } from 'node:crypto';
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { recordReconstructionClaim } from './reconstruction.js';

const MAX_BODY = 8192;
const MAX_SUBJECT = 512;

export interface SupportChannel {
  id: string; label: string; responsibilityId: string;
  responsibilityTitle: string; intakeKey: string; revoked: boolean;
}

/**
 * The founder declares that a way customers reach them belongs to a specific
 * responsibility, and receives the key that channel authenticates with.
 *
 * This is an ordinary founder assertion: it is recorded as canonical evidence
 * and a bounded claim, so the association has provenance rather than being a
 * configuration row nobody can account for.
 */
export async function registerSupportChannel(input: {
  productId: string; responsibilityId: string; founderId: string; label: string;
}): Promise<SupportChannel | null> {
  const label = input.label.trim();
  if (!label || label.length > 120) return null;

  const owned = (await query(
    `SELECT r.title FROM institutional_responsibilities r JOIN products p ON p.id=r.product_id
      WHERE r.id=? AND r.product_id=? AND p.owner_id=? AND r.capability='customer_support'
        AND r.disposition='active'`,
    [input.responsibilityId, input.productId, input.founderId],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!owned) return null;

  const id = `chan_${nanoid()}`;
  const intakeKey = randomBytes(24).toString('base64url');
  await query(
    'INSERT INTO support_channels (id,product_id,responsibility_id,label,intake_key) VALUES (?,?,?,?,?)',
    [id, input.productId, input.responsibilityId, label, intakeKey],
  );

  // The founder said this; it is evidence, with provenance, like anything else
  // they tell Foundry.
  const signalId = nanoid();
  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
     VALUES (?,?,'founder_assertion_structured','founder_registered_support_channel','low',?,?)`,
    [signalId, input.productId,
      JSON.stringify({ founder_id: input.founderId, responsibility_id: input.responsibilityId, channel_id: id, label }),
      `The founder said "${label}" is how customers reach them about this`],
  );
  await recordReconstructionClaim({
    productId: input.productId, subject: `responsibility:${input.responsibilityId}`,
    predicate: 'support_channel', value: { channelId: id, label },
    epistemicStatus: 'known', evidenceRefs: [{ kind: 'signal_event', id: signalId }],
    derivationMethod: 'authenticated founder channel registration', observedAt: new Date(),
  });

  return {
    id, label, intakeKey, revoked: false,
    responsibilityId: input.responsibilityId, responsibilityTitle: String(owned.title),
  };
}

export async function getSupportChannels(productId: string): Promise<SupportChannel[]> {
  const rows = await query(
    `SELECT c.id,c.label,c.intake_key,c.revoked_at,c.responsibility_id,r.title
       FROM support_channels c JOIN institutional_responsibilities r ON r.id=c.responsibility_id
      WHERE c.product_id=? ORDER BY c.created_at`, [productId],
  );
  return (rows.rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), label: String(r.label), intakeKey: String(r.intake_key),
    revoked: r.revoked_at != null, responsibilityId: String(r.responsibility_id),
    responsibilityTitle: String(r.title),
  }));
}

export async function revokeSupportChannel(input: {
  productId: string; channelId: string; founderId: string;
}): Promise<boolean> {
  const result = await query(
    `UPDATE support_channels SET revoked_at=datetime('now')
      WHERE id=? AND product_id=? AND revoked_at IS NULL
        AND EXISTS (SELECT 1 FROM products p WHERE p.id=product_id AND p.owner_id=?)`,
    [input.channelId, input.productId, input.founderId],
  );
  return Number(result.rowsAffected ?? 0) > 0;
}

export interface InboundMessage {
  id: string; responsibilityId: string; conversationRef: string | null;
  contactEmail: string; subject: string | null; body: string;
  sourceObservedAt: string; receivedAt: string;
}

export type IntakeRefusal =
  | 'unknown_channel' | 'identity_required' | 'contact_required'
  | 'content_required' | 'content_too_large' | 'timestamp_invalid';

/**
 * A message arrives from outside.
 *
 * The channel key establishes both tenant and channel — nothing about identity
 * is taken from the body. Redelivery of the same provider event converges on
 * the message already stored rather than creating a second one.
 *
 * The body is kept as text and never as markup. Rendering escapes it at the
 * surface, so a message containing script-like content is a message containing
 * script-like content.
 */
export async function ingestCustomerMessage(input: {
  intakeKey: string;
  externalMessageId: string;
  contactEmail: string;
  body: string;
  subject?: string;
  conversationRef?: string;
  sourceObservedAt?: string;
}): Promise<{ message: InboundMessage; duplicate: boolean } | { refused: IntakeRefusal }> {
  const channel = (await query(
    `SELECT id,product_id,responsibility_id FROM support_channels
      WHERE intake_key=? AND revoked_at IS NULL`, [input.intakeKey],
  )).rows[0] as Record<string, unknown> | undefined;
  // A revoked or unknown key is refused identically: the caller learns nothing
  // about which channels exist.
  if (!channel) return { refused: 'unknown_channel' };

  const productId = String(channel.product_id);
  const channelId = String(channel.id);
  const responsibilityId = String(channel.responsibility_id);

  const externalMessageId = input.externalMessageId?.trim();
  const contactEmail = input.contactEmail?.trim();
  const body = input.body?.trim();
  const subject = input.subject?.trim() || null;
  if (!externalMessageId) return { refused: 'identity_required' };
  if (!contactEmail || !contactEmail.includes('@') || contactEmail.length > 320) {
    return { refused: 'contact_required' };
  }
  if (!body) return { refused: 'content_required' };
  if (body.length > MAX_BODY || (subject !== null && subject.length > MAX_SUBJECT)) {
    return { refused: 'content_too_large' };
  }

  // The source's own clock is preserved separately from ours. A delayed
  // delivery is late, not recent.
  let sourceObservedAt = new Date().toISOString();
  if (input.sourceObservedAt) {
    const parsed = new Date(input.sourceObservedAt);
    if (Number.isNaN(parsed.getTime())) return { refused: 'timestamp_invalid' };
    sourceObservedAt = parsed.toISOString();
  }

  const existing = await findMessage(productId, channelId, externalMessageId);
  if (existing) return { message: existing, duplicate: true };

  const signalId = nanoid();
  const messageId = `msg_${nanoid()}`;
  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
     VALUES (?,?,'customer_message_ingest','customer_message_received','medium',?,?)`,
    [signalId, productId,
      JSON.stringify({
        channel_id: channelId, external_message_id: externalMessageId,
        contact_email: contactEmail, source_observed_at: sourceObservedAt,
      }),
      subject ? `A customer wrote about "${subject}"` : 'A customer wrote in'],
  );
  try {
    await query(
      `INSERT INTO inbound_customer_messages
         (id,product_id,channel_id,responsibility_id,external_message_id,conversation_ref,
          contact_email,subject,body,source_observed_at,evidence_signal_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [messageId, productId, channelId, responsibilityId, externalMessageId,
        input.conversationRef?.trim() || null, contactEmail, subject, body, sourceObservedAt, signalId],
    );
  } catch (error) {
    // A concurrent redelivery won the unique identity. Converge on it.
    const won = await findMessage(productId, channelId, externalMessageId);
    if (!won) throw error;
    return { message: won, duplicate: true };
  }
  return { message: (await findMessage(productId, channelId, externalMessageId))!, duplicate: false };
}

async function findMessage(
  productId: string, channelId: string, externalMessageId: string,
): Promise<InboundMessage | null> {
  const row = (await query(
    `SELECT id,responsibility_id,conversation_ref,contact_email,subject,body,source_observed_at,received_at
       FROM inbound_customer_messages
      WHERE product_id=? AND channel_id=? AND external_message_id=?`,
    [productId, channelId, externalMessageId],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id), responsibilityId: String(row.responsibility_id),
    conversationRef: row.conversation_ref == null ? null : String(row.conversation_ref),
    contactEmail: String(row.contact_email),
    subject: row.subject == null ? null : String(row.subject),
    body: String(row.body), sourceObservedAt: String(row.source_observed_at),
    receivedAt: String(row.received_at),
  };
}

/** Messages attributed to a responsibility, newest first. Attribution is the
 * channel binding — never an interpretation of what the message says. */
export async function getMessagesForResponsibility(
  productId: string, responsibilityId: string, limit = 20,
): Promise<InboundMessage[]> {
  const rows = await query(
    `SELECT id,responsibility_id,conversation_ref,contact_email,subject,body,source_observed_at,received_at
       FROM inbound_customer_messages WHERE product_id=? AND responsibility_id=?
      ORDER BY datetime(source_observed_at) DESC, id DESC LIMIT ?`,
    [productId, responsibilityId, limit],
  );
  return (rows.rows as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id), responsibilityId: String(row.responsibility_id),
    conversationRef: row.conversation_ref == null ? null : String(row.conversation_ref),
    contactEmail: String(row.contact_email),
    subject: row.subject == null ? null : String(row.subject),
    body: String(row.body), sourceObservedAt: String(row.source_observed_at),
    receivedAt: String(row.received_at),
  }));
}
