// =============================================================================
// FOUNDRY — Canonical system identity (migration 123)
//
// Answers exactly one question: "which product row IS the Foundry company?"
//
// Before this module, three runtime paths answered it with
// `WHERE name = 'Foundry' ORDER BY created_at ASC LIMIT 1` — a mutable display
// field plus row creation order. That made Foundry's own institutional identity
// depend on presentation data, partly customer-influenced, and destroyed by a
// rename.
//
// Three properties this deliberately has:
//
//   1. Identity is not authority. Resolving the canonical identity returns a
//      product id and nothing else. There is no capability, scope, consent, or
//      permission anywhere in `system_identities` for a caller to read, so no
//      authority decision can be derived from being Foundry. Every capability,
//      effect, receipt, and outcome still crosses the ordinary governed
//      boundaries — including the outbound gateway and migration 115's
//      Assisting → Operating freeze.
//
//   2. Resolution takes no arguments. A caller cannot pass a name, token, id,
//      or key and have it treated as the platform's identity; there is nothing
//      caller-controlled in the lookup at all.
//
//   3. Absence is unknown, not a fallback. If the identity has never been
//      established, this returns null and callers decline to act. It never
//      degrades to a name guess — that degradation was the original defect.
//
// The institutional kernel (src/services/institution/**, src/services/outbound/**)
// must NOT import this module. Nothing in the kernel may be able to recognise
// that it is operating Foundry — see tests/unit/recursive-institution.test.ts,
// which fails if it can.
// =============================================================================

import { query } from '../db/client.js';

/** Closed vocabulary — mirrors the CHECK in migration 123. */
export const FOUNDRY_IDENTITY_KEY = 'foundry';

export type SystemIdentityKey = typeof FOUNDRY_IDENTITY_KEY;

/**
 * The product row bound to a canonical system identity, or null when that
 * identity has never been established. Deliberately uncached: the binding is
 * immutable, but a cache would be one more place for identity to be wrong, and
 * this is a primary-key lookup.
 */
export async function resolveSystemIdentityProductId(
  key: SystemIdentityKey
): Promise<string | null> {
  try {
    const r = await query(
      'SELECT product_id FROM system_identities WHERE identity_key = ?',
      [key]
    );
    return r.rows.length
      ? String((r.rows[0] as Record<string, unknown>).product_id)
      : null;
  } catch {
    // Pre-migration databases and degraded reads resolve to unknown, never to
    // a name guess.
    return null;
  }
}

/** The Foundry company's own product row, or null when not established. */
export async function resolveFoundryProductId(): Promise<string | null> {
  return resolveSystemIdentityProductId(FOUNDRY_IDENTITY_KEY);
}

/**
 * Establish a canonical identity. Single writer of `system_identities`.
 *
 * Claiming is a one-time institutional act performed by migration 123's
 * backfill on existing databases and by the seed on new ones. It is idempotent
 * against itself and refuses to move an identity that is already bound —
 * the database refuses too, on its own, in three triggers.
 */
export async function establishSystemIdentity(
  key: SystemIdentityKey,
  productId: string,
  reason: string
): Promise<{ established: boolean; productId: string | null }> {
  const existing = await resolveSystemIdentityProductId(key);
  if (existing) {
    return { established: existing === productId, productId: existing };
  }
  // PROVENANCE, ON PURPOSE. `established_reason` is written and read by no
  // code, and a trigger only checks it is non-empty — validation is not
  // consumption. It is here for a person asking, later, why THIS product is the
  // one the system answers to, at a point where the answer would otherwise be
  // "because it was first". `check-write-only-columns.mjs` will ask about it;
  // this is the answer, stated where it is written as that gate instructs.
  await query(
    'INSERT INTO system_identities (identity_key, product_id, established_reason) VALUES (?, ?, ?)',
    [key, productId, reason]
  );
  return { established: true, productId };
}
