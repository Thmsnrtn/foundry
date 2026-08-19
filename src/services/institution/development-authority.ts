// =============================================================================
// FOUNDRY — Responsibility-bound development authority
//
// Reuses the ordinary consent ledger. There is no `can_write_code` flag, no
// developer role, and no separate permission system: authority is a specific,
// expiring, revocable grant naming one responsibility, one repository, exact
// path prefixes, one class of change, and the verification it must produce.
//
// Capability is not authority. Competence is not authority. A passing test is
// not authority. Only a current grant is.
// =============================================================================

import { nanoid } from 'nanoid';
import { liveActGrant, query } from '../../db/client.js';

/**
 * The constitutional ring: code, migrations, documents, and enforcement
 * scripts that define or bind what Foundry is allowed to do.
 *
 * Mirrors the database guard in migration 120, which is authoritative — this
 * copy exists so plan-time checks need no round trip, and a test asserts the
 * two never drift apart.
 */
export const CONSTITUTIONAL_PATHS = [
  'src/db/migrations/',      // every institutional guard is a database trigger
  'docs/foundry-institution/', // the governing contract
  'scripts/',                // the ratchets and audits that make it binding
  'src/services/institution/', // responsibility, authority, and evidence semantics
  'src/services/outbound/',  // the governed consequential-effect boundary
  'AGENTS.md',               // the repository's own instruction contract
] as const;

export type DevelopmentChangeClass = 'generated_artifact' | 'test' | 'documentation';

export interface DevelopmentAuthority {
  consentId: string;
  responsibilityId: string;
  repository: string;
  allowedPathPrefixes: string[];
  changeClass: DevelopmentChangeClass;
  requiredVerification: string[];
  expiresAt: string;
}

/** True when a path lies inside the constitutional ring, whatever was granted. */
export function isConstitutionalPath(path: string): boolean {
  const normalized = path.replace(/^\.\//, '');
  return CONSTITUTIONAL_PATHS.some((ring) => ring.endsWith('/')
    ? normalized.startsWith(ring)
    : normalized === ring);
}

/**
 * Whether one concrete repository path is permitted by a grant.
 *
 * Deny dominates: the constitutional ring and path escapes are refused before
 * any granted prefix is consulted, so a grant can never widen its own reach.
 */
export function isPathWithinAuthority(path: string, authority: DevelopmentAuthority): boolean {
  const normalized = path.replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) return false;
  if (isConstitutionalPath(normalized)) return false;
  return authority.allowedPathPrefixes.some((prefix) => normalized.startsWith(prefix));
}

/**
 * Record an authenticated owner's bounded development grant.
 *
 * `ownerId` must come from the caller's authenticated session. Every binding
 * below is independently verified by the database: the responsibility must be
 * in Shadowing with a matching capability under the real product owner, the
 * paths must stay outside the constitutional ring, the change class must be in
 * the closed vocabulary, verification must be required, and the grant must
 * expire.
 */
export async function grantDevelopmentAuthority(input: {
  productId: string; responsibilityId: string; ownerId: string;
  repository: string; allowedPathPrefixes: string[];
  changeClass: DevelopmentChangeClass; requiredVerification: string[];
  disclosureVersion?: string; expiresAt: Date;
}): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO autonomy_consents
     (id,founder_id,product_id,capability,from_mode,to_mode,disclosure_version,
      responsibility_id,allowed_scope_json,consequence_boundary,expires_at,
      repository_ref,allowed_path_prefixes_json,allowed_change_class,required_verification_json)
     VALUES (?,?,?,'development','suggest','act',?,?,?,'low',?,?,?,?,?)`,
    [id, input.ownerId, input.productId, input.disclosureVersion ?? 'development-authority-v1',
      input.responsibilityId, JSON.stringify([input.changeClass]), input.expiresAt.toISOString(),
      input.repository, JSON.stringify(input.allowedPathPrefixes), input.changeClass,
      JSON.stringify(input.requiredVerification)],
  );
  return id;
}

/**
 * The exact current development grant for one responsibility, or null.
 *
 * Revoked and expired grants are simply absent — there is no "recently valid"
 * state to fall back on. Call this again immediately before any irreversible
 * mutation; a plan made while authority was valid must not execute after it
 * has lapsed.
 */
export async function getCurrentDevelopmentAuthority(
  productId: string, responsibilityId: string,
): Promise<DevelopmentAuthority | null> {
  const row = (await query(
    `SELECT a.id,a.responsibility_id,a.repository_ref,a.allowed_path_prefixes_json,
            a.allowed_change_class,a.required_verification_json,a.expires_at
     FROM autonomy_consents a
     JOIN institutional_responsibilities r ON r.id=a.responsibility_id
     WHERE a.product_id=? AND a.responsibility_id=? AND a.capability='development'
       AND r.product_id=a.product_id AND r.capability='development'
       AND ${liveActGrant('a')}
     ORDER BY a.accepted_at DESC,a.rowid DESC LIMIT 1`,
    [productId, responsibilityId],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    consentId: String(row.id),
    responsibilityId: String(row.responsibility_id),
    repository: String(row.repository_ref),
    allowedPathPrefixes: JSON.parse(String(row.allowed_path_prefixes_json)) as string[],
    changeClass: String(row.allowed_change_class) as DevelopmentChangeClass,
    requiredVerification: JSON.parse(String(row.required_verification_json)) as string[],
    expiresAt: String(row.expires_at),
  };
}

/** Owner withdrawal. Revocation takes effect for every later authority read. */
export async function revokeDevelopmentAuthority(
  productId: string, consentId: string, ownerId: string,
): Promise<void> {
  await query(
    `UPDATE autonomy_consents SET revoked_at=CURRENT_TIMESTAMP
     WHERE id=? AND product_id=? AND founder_id=? AND revoked_at IS NULL`,
    [consentId, productId, ownerId],
  );
}
