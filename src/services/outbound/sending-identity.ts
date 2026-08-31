// =============================================================================
// FOUNDRY — the company's own sender
//
// `sender-of-record.ts` states the rule: Foundry must never be the From on a
// message to a founder's CUSTOMER. Those go out under the founder's own
// connected sender — their domain, their opt-out footer, their CAN-SPAM
// responsibility. Foundry's domain is the From only on mail to the FOUNDER.
//
// That rule presupposed something the system did not have. Every send went
// through Foundry's platform Resend key, so no caller could satisfy it, which
// is why the guard sat with zero callers for as long as it existed. This is
// the missing half: a per-company sending identity, so a third-party send has
// a sender to be sent under.
//
// WHY IT HOLDS A CREDENTIAL AND NOT JUST AN ADDRESS. Recording a From the
// founder typed would be a verification nothing here can perform — we cannot
// check that they own the domain, and a `verified_at` we set ourselves would
// be a claim with no evidence behind it. Sending through the FOUNDER'S OWN
// provider account makes the verification real and performed by somebody who
// can do it: the provider refuses a domain the account has not verified. It
// also makes the rule's substance true rather than cosmetic — reputation,
// bounce handling and the compliance obligation land on the account that owns
// the domain.
// =============================================================================

import { query } from '../../db/client.js';
import { decrypt, encrypt } from '../encryption.js';

export type SendingProvider = 'resend';

export interface SendingIdentity {
  productId: string;
  provider: SendingProvider;
  /** Decrypted. Only the send boundary should ever hold this. */
  credential: string;
  fromEmail: string;
  fromName: string | null;
  /** When a send through this identity was last accepted by the provider.
   * NULL means connected but never used, which is not the same as working. */
  lastAcceptedAt: string | null;
}

/** What a founder may see: everything except the credential. */
export interface SendingIdentitySummary {
  provider: SendingProvider;
  fromEmail: string;
  fromName: string | null;
  lastAcceptedAt: string | null;
  connectedAt: string;
}

const EMAIL = /^[^\s@<>]+@[^\s@<>.]+\.[^\s@<>]+$/;

/** The address a company sends third-party mail as, or null if it has not
 * connected one. Null is the reason a third-party send refuses — it is a fact
 * about setup, and the refusal says so. */
export async function getSendingIdentity(productId: string): Promise<SendingIdentity | null> {
  const res = await query(
    `SELECT provider, credential, from_email, from_name, last_accepted_at
       FROM product_sending_identities WHERE product_id = ?`, [productId]);
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    productId,
    provider: String(row.provider) as SendingProvider,
    credential: decrypt(String(row.credential)),
    fromEmail: String(row.from_email),
    fromName: row.from_name == null ? null : String(row.from_name),
    lastAcceptedAt: row.last_accepted_at == null ? null : String(row.last_accepted_at),
  };
}

/** The same thing without the credential, for anything that renders. Nothing
 * that displays a settings page has a reason to decrypt an API key. */
export async function getSendingIdentitySummary(
  productId: string,
): Promise<SendingIdentitySummary | null> {
  const res = await query(
    `SELECT provider, from_email, from_name, last_accepted_at, created_at
       FROM product_sending_identities WHERE product_id = ?`, [productId]);
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    provider: String(row.provider) as SendingProvider,
    fromEmail: String(row.from_email),
    fromName: row.from_name == null ? null : String(row.from_name),
    lastAcceptedAt: row.last_accepted_at == null ? null : String(row.last_accepted_at),
    connectedAt: String(row.created_at),
  };
}

export class SendingIdentityError extends Error {
  readonly code = 'SENDING_IDENTITY';
}

/**
 * Connect (or replace) a company's sending identity.
 *
 * The From is checked against the Foundry-domain rule here as well as at the
 * send boundary: a founder who pastes a Foundry address into this form has
 * misunderstood what it is for, and telling them at the point of setup is
 * better than refusing every send afterwards.
 */
export async function setSendingIdentity(input: {
  productId: string;
  provider: SendingProvider;
  credential: string;
  fromEmail: string;
  fromName?: string | null;
}): Promise<void> {
  const fromEmail = input.fromEmail.trim().toLowerCase();
  if (!EMAIL.test(fromEmail)) {
    throw new SendingIdentityError(`'${input.fromEmail}' is not an email address`);
  }
  const { isFoundryDomain } = await import('./sender-of-record.js');
  if (isFoundryDomain(fromEmail)) {
    throw new SendingIdentityError(
      'This has to be an address on your own domain — that is the point of it. '
      + 'Mail to your customers goes out as you, not as Foundry.');
  }
  if (!input.credential.trim()) {
    throw new SendingIdentityError('A provider API key is required');
  }

  await query(
    `INSERT INTO product_sending_identities
       (product_id, provider, credential, from_email, from_name, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(product_id) DO UPDATE SET
       provider = excluded.provider,
       credential = excluded.credential,
       from_email = excluded.from_email,
       from_name = excluded.from_name,
       -- Replacing the identity resets the record of it having worked. The
       -- previous key's successes say nothing about this one.
       last_accepted_at = NULL,
       updated_at = datetime('now')`,
    [input.productId, input.provider, encrypt(input.credential), fromEmail,
      input.fromName?.trim() || null]);
}

/** Disconnect. Third-party sends refuse again afterwards, which is the point:
 * a company with no sender of its own may not send as somebody else. */
export async function clearSendingIdentity(productId: string): Promise<boolean> {
  const res = await query(
    `DELETE FROM product_sending_identities WHERE product_id = ?`, [productId]);
  return (res.rowsAffected ?? 0) > 0;
}

/** Record that the provider accepted a send through this identity. Called
 * after a successful dispatch, never before — "connected" and "working" are
 * different facts and the settings page shows both. */
export async function recordSendingIdentityAccepted(productId: string): Promise<void> {
  await query(
    `UPDATE product_sending_identities SET last_accepted_at = datetime('now')
      WHERE product_id = ?`, [productId]);
}

/** The From line for a provider call, assembled from the identity. */
export function fromLine(identity: SendingIdentity): string {
  return identity.fromName ? `${identity.fromName} <${identity.fromEmail}>` : identity.fromEmail;
}
