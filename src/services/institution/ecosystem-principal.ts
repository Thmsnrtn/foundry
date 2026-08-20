// =============================================================================
// FOUNDRY — a portfolio principal, not one global secret
//
// `GET /internal/operator/dashboard-data?product_id=…` returned a named
// company's entire operating picture behind a single process-wide
// `ECOSYSTEM_SERVICE_KEY` and nothing else: no owner check, no tenant binding,
// no per-caller identity. The key is issued to nobody, so holding it is
// indistinguishable from being every company at once, and the company id is a
// query parameter.
//
// THE OWNER'S INSTRUCTION (§12) is that private owner-portfolio access may
// exist, but "must be represented as an explicit service/portfolio principal
// with scoped company membership rather than possession of one global secret
// plus arbitrary product_id", and that commercial customer access must remain
// isolated.
//
// SO SCOPE IS ENUMERATED MEMBERSHIP, NOT A FLAG. There is no wildcard and no
// "all companies" option here, deliberately. Reaching a company outside the
// scope is not a permission check that could be written wrong; it is a row that
// does not exist.
//
// AND ISOLATION IS A PROPERTY OF THE DATA. A principal may only be scoped to
// companies its ISSUER OWNS — checked here, and again by a database trigger,
// because the check here is a property of one function while the trigger is a
// property of the table. Ownership can change after issuance; the trigger makes
// that a refusal rather than a silent inheritance.
//
// WHAT THIS DOES NOT DO. It does not rotate the deployed secret. That is an
// operational act only the owner can perform. What the code can do is stop the
// old shape from being sufficient, which is what the callers of `resolve` now
// require.
// =============================================================================

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

const MAX_DAYS = 365;
const DEFAULT_DAYS = 90;

export type IssueRefusal =
  | 'label_required'
  | 'companies_required'
  | 'not_owned';

export interface IssuedPrincipal {
  id: string;
  label: string;
  companyIds: string[];
  expiresAt: string;
  /** Returned once. Never stored, never readable again. */
  key: string;
}

export interface PrincipalSummary {
  id: string;
  label: string;
  prefix: string;
  companyIds: string[];
  expiresAt: string;
  lastUsedAt: string | null;
  createdAt: string;
  revoked: boolean;
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Issue a principal scoped to companies the founder owns.
 *
 * ALL OR NOTHING ON SCOPE. If any named company is not theirs, nothing is
 * issued — rather than issuing a principal quietly narrower than what was
 * asked for, which would look like it worked and read less than expected.
 */
export async function issueEcosystemPrincipal(input: {
  founderId: string;
  label: string;
  companyIds: string[];
  days?: number;
}): Promise<IssuedPrincipal | { refused: IssueRefusal }> {
  const label = input.label?.trim();
  if (!label || label.length > 80) return { refused: 'label_required' };

  const companyIds = [...new Set(input.companyIds ?? [])].filter(Boolean);
  if (!companyIds.length) return { refused: 'companies_required' };

  const owned = await query(
    `SELECT id FROM products WHERE owner_id = ? AND id IN (${companyIds.map(() => '?').join(',')})`,
    [input.founderId, ...companyIds]);
  if (owned.rows.length !== companyIds.length) return { refused: 'not_owned' };

  const days = Math.min(Math.max(input.days ?? DEFAULT_DAYS, 1), MAX_DAYS);
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
  const key = `eco_${randomBytes(24).toString('base64url')}`;
  const id = nanoid();

  await query(
    `INSERT INTO ecosystem_principals
       (id, label, key_hash, key_prefix, created_by, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, label, hashKey(key), key.slice(0, 12), input.founderId, expiresAt]);

  for (const productId of companyIds) {
    await query(
      `INSERT INTO ecosystem_principal_companies (id, principal_id, product_id)
       VALUES (?, ?, ?)`, [nanoid(), id, productId]);
  }

  return { id, label, companyIds, expiresAt, key };
}

export interface ResolvedPrincipal {
  id: string;
  label: string;
}

/**
 * Who is calling, or nobody.
 *
 * Hash lookup rather than a scan, and the stored hash is compared timing-safely
 * on top of that — the index narrows it to one row, and the comparison is what
 * stops a near-miss being distinguishable by how long it took.
 *
 * An expired or revoked principal resolves to null. There is no separate
 * "expired" answer: telling a caller which of the two it was tells somebody
 * holding a wrong key that a right one exists.
 */
export async function resolveEcosystemPrincipal(
  presentedKey: string | null | undefined,
): Promise<ResolvedPrincipal | null> {
  if (!presentedKey) return null;
  const hash = hashKey(presentedKey);
  const row = (await query(
    `SELECT id, label, key_hash FROM ecosystem_principals
      WHERE key_hash = ? AND revoked_at IS NULL AND datetime(expires_at) > datetime('now')`,
    [hash])).rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  const a = Buffer.from(String(row.key_hash));
  const b = Buffer.from(hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  await query(
    `UPDATE ecosystem_principals SET last_used_at = datetime('now') WHERE id = ?`,
    [String(row.id)]);
  return { id: String(row.id), label: String(row.label) };
}

/**
 * May this principal read this company?
 *
 * The whole question, asked as one row lookup. Nothing here consults the global
 * key, an owner, or a tier: a principal reads the companies it was scoped to
 * and no others, and a principal with no scope reads nothing.
 */
export async function principalMayRead(
  principalId: string, productId: string,
): Promise<boolean> {
  if (!principalId || !productId) return false;
  const row = await query(
    `SELECT 1 FROM ecosystem_principal_companies
      WHERE principal_id = ? AND product_id = ?`, [principalId, productId]);
  return row.rows.length > 0;
}

/** What the owner sees. The raw key is not here and cannot be. */
export async function listEcosystemPrincipals(founderId: string): Promise<PrincipalSummary[]> {
  const rows = (await query(
    `SELECT id, label, key_prefix, expires_at, last_used_at, created_at, revoked_at
       FROM ecosystem_principals WHERE created_by = ?
      -- Tie-broken on rowid rather than id. Two principals issued in the same
      -- second share a timestamp, and a nanoid is not a clock; SQLite assigns
      -- rowid in insertion order, which is the question being asked.
      ORDER BY created_at DESC, rowid DESC`, [founderId])).rows as unknown as Array<Record<string, unknown>>;

  const out: PrincipalSummary[] = [];
  for (const r of rows) {
    const scope = (await query(
      `SELECT product_id FROM ecosystem_principal_companies
        WHERE principal_id = ? ORDER BY product_id`, [String(r.id)]))
      .rows as unknown as Array<Record<string, unknown>>;
    out.push({
      id: String(r.id),
      label: String(r.label),
      prefix: String(r.key_prefix),
      companyIds: scope.map((x) => String(x.product_id)),
      expiresAt: String(r.expires_at),
      lastUsedAt: r.last_used_at == null ? null : String(r.last_used_at),
      createdAt: String(r.created_at),
      revoked: r.revoked_at != null,
    });
  }
  return out;
}

/** Revocation is the brake, and it is scoped to the issuer's own principals. */
export async function revokeEcosystemPrincipal(
  principalId: string, founderId: string,
): Promise<{ revoked: boolean }> {
  const res = await query(
    `UPDATE ecosystem_principals SET revoked_at = datetime('now')
      WHERE id = ? AND created_by = ? AND revoked_at IS NULL`,
    [principalId, founderId]);
  return { revoked: (res.rowsAffected ?? 0) > 0 };
}
