// =============================================================================
// FOUNDRY — Scoped ingest credentials (migration 139)
//
// One product-wide secret authenticated three public intakes with materially
// different consequences: posting numbers, raising work, and declaring that an
// effect achieved what it was for. The founder is told that secret is for
// metrics, and it is — plus two other things nobody mentioned.
//
// The rule this restores is the one the constitution applies everywhere else:
// authority is narrower than the credential you already hold, never a side
// effect of holding it.
//
// WHAT A CREDENTIAL IS. A named secret, issued by the owner to a specific
// system, that may use exactly the intakes the owner chose. Every intake still
// records EVIDENCE and grants nothing — narrowing who may say something says
// nothing about what follows from having said it.
//
// WHAT IT IS NOT. Not a permission model. Not a role. Not an identity: the
// `reported_by` a caller supplies is still provenance it names for itself, and
// the credential is what makes it attributable to a tenant at all.
//
// The secret is returned exactly once, at mint time, and is thereafter readable
// only by the owner on their own settings page — the same treatment the intake
// key for a support channel gets, because it is the same kind of thing.
// =============================================================================

import { randomBytes } from 'node:crypto';
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

/** The closed set. Migration 139 holds the same list in SQL, so a purpose
 * cannot be introduced at runtime; a test asserts the two never drift. A
 * purpose belongs here only when a route actually honours it. */
export const INGEST_PURPOSES = ['metrics', 'company_report', 'effect_outcome'] as const;
export type IngestPurpose = typeof INGEST_PURPOSES[number];

/** Plain descriptions for the owner. What the system may say, and what it
 * still may not do — because the second half is the part people assume. */
export const INGEST_PURPOSE_LABELS: Record<IngestPurpose, { may: string; mayNot: string }> = {
  metrics: {
    may: 'post readings for quantities you track',
    mayNot: 'raise work, say whether anything worked, or read anything back',
  },
  company_report: {
    may: 'say that something needs handling, in your company\'s words',
    mayNot: 'authorise anything, speak as you, or decide what happens next',
  },
  effect_outcome: {
    may: 'say whether something Foundry sent achieved what it was for',
    mayNot: 'send anything, change permission, or report on Foundry\'s behalf',
  },
};

export function isIngestPurpose(value: string): value is IngestPurpose {
  return (INGEST_PURPOSES as readonly string[]).includes(value);
}

export interface IngestCredential {
  id: string; label: string; purposes: IngestPurpose[];
  revoked: boolean; createdAt: string; lastUsedAt: string | null;
}

/** Returned once, at mint time. The secret is not in `IngestCredential` on
 * purpose: every other read path in this module is a listing. */
export interface MintedCredential extends IngestCredential { secret: string }

export type MintRefusal = 'label_required' | 'purposes_required' | 'purpose_unknown' | 'not_owned';

/**
 * The owner issues a credential to one of their systems.
 *
 * Recorded as canonical evidence first, exactly as registering a support
 * channel or an observation channel is: the owner said this system may tell
 * them things, and the association has provenance rather than being a
 * configuration row nobody can account for.
 */
export async function mintIngestCredential(input: {
  productId: string; founderId: string; label: string; purposes: string[];
}): Promise<MintedCredential | { refused: MintRefusal }> {
  const label = input.label?.trim();
  if (!label || label.length > 80) return { refused: 'label_required' };

  // Deduplicated and ordered canonically, so two credentials with the same
  // purposes are literally comparable.
  const purposes = [...new Set(input.purposes ?? [])];
  if (!purposes.length) return { refused: 'purposes_required' };
  if (purposes.some((p) => !isIngestPurpose(p))) return { refused: 'purpose_unknown' };
  const ordered = INGEST_PURPOSES.filter((p) => purposes.includes(p));

  const owned = await query('SELECT 1 FROM products WHERE id=? AND owner_id=?',
    [input.productId, input.founderId]);
  if (!owned.rows.length) return { refused: 'not_owned' };

  const signalId = nanoid();
  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
     VALUES (?,?,'founder_assertion_structured','founder_issued_ingest_credential','low',?,?)`,
    [signalId, input.productId,
      JSON.stringify({ founder_id: input.founderId, label, purposes: ordered }),
      `The founder issued "${label}" a credential for ${ordered.join(', ')}`],
  );

  const id = `ing_${nanoid()}`;
  const secret = randomBytes(24).toString('base64url');
  await query(
    `INSERT INTO ingest_credentials (id,product_id,label,secret,purposes_json,evidence_signal_id)
     VALUES (?,?,?,?,?,?)`,
    [id, input.productId, label, secret, JSON.stringify(ordered), signalId],
  );
  return {
    id, label, secret, purposes: [...ordered], revoked: false,
    createdAt: new Date().toISOString(), lastUsedAt: null,
  };
}

/** What the owner sees. Secrets are deliberately absent — see `revealSecret`. */
export async function getIngestCredentials(productId: string): Promise<IngestCredential[]> {
  const rows = await query(
    `SELECT id,label,purposes_json,revoked_at,created_at,last_used_at
       FROM ingest_credentials WHERE product_id=? ORDER BY created_at DESC, id`, [productId],
  );
  return (rows.rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), label: String(r.label),
    purposes: JSON.parse(String(r.purposes_json)) as IngestPurpose[],
    revoked: r.revoked_at != null, createdAt: String(r.created_at),
    lastUsedAt: r.last_used_at == null ? null : String(r.last_used_at),
  }));
}

/** The owner reads back a secret for a system they are configuring. Ownership
 * is re-checked here rather than assumed from the caller's context. */
export async function revealIngestSecret(input: {
  productId: string; founderId: string; credentialId: string;
}): Promise<string | null> {
  const row = (await query(
    `SELECT c.secret FROM ingest_credentials c JOIN products p ON p.id=c.product_id
      WHERE c.id=? AND c.product_id=? AND p.owner_id=? AND c.revoked_at IS NULL`,
    [input.credentialId, input.productId, input.founderId],
  )).rows[0] as Record<string, unknown> | undefined;
  return row ? String(row.secret) : null;
}

/** Withdrawal is immediate and needs no reason. Authentication reads
 * `revoked_at IS NULL` on every request, so the next one simply fails. */
export async function revokeIngestCredential(input: {
  productId: string; founderId: string; credentialId: string;
}): Promise<boolean> {
  const result = await query(
    `UPDATE ingest_credentials SET revoked_at=datetime('now')
      WHERE id=? AND product_id=? AND revoked_at IS NULL
        AND EXISTS (SELECT 1 FROM products p WHERE p.id=product_id AND p.owner_id=?)`,
    [input.credentialId, input.productId, input.founderId],
  );
  return Number(result.rowsAffected ?? 0) > 0;
}

export interface IngestIdentity { productId: string; credentialId: string; label: string }

/**
 * Authenticate one request against one purpose.
 *
 * The purpose is supplied by the ROUTE, never by the request, so a caller
 * cannot name the intake it would like to be allowed. A credential that is
 * unknown, revoked, or not scoped for this intake fails identically: the caller
 * learns nothing about which credentials exist or what they may do.
 */
export async function authenticateIngest(
  secret: string, purpose: IngestPurpose,
): Promise<IngestIdentity | null> {
  if (!secret || !isIngestPurpose(purpose)) return null;
  const row = (await query(
    `SELECT id,product_id,label FROM ingest_credentials
      WHERE secret=? AND revoked_at IS NULL
        AND EXISTS (SELECT 1 FROM json_each(purposes_json) WHERE json_each.value=?)`,
    [secret, purpose],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  // Last use is recorded so an owner can see which of their systems is actually
  // posting, and which credential has been sitting unused since somebody left.
  await query("UPDATE ingest_credentials SET last_used_at=datetime('now') WHERE id=?", [row.id]);
  return { productId: String(row.product_id), credentialId: String(row.id), label: String(row.label) };
}
