// =============================================================================
// FOUNDRY — API keys
//
// THIS FILE USED TO HOLD A SECOND COMPANY AUTHORIZATION MODEL. `account_roles`
// carried a viewer/analyst/admin/owner ladder and `ROLE_PERMISSIONS_MAP` an
// eleven-permission map, read by `requireRole` and `requirePermission`.
// `assignRole` was the only thing that could write a row and had no callers
// anywhere, so no row was ever created: `getUserRole` always returned null,
// `requireRole('admin')` reduced to the owner check inside it, and
// `requirePermission` had no call sites at all.
//
// Company membership and its permissions are canonical in
// `services/team/members.ts`, and ownership is asked separately as the
// exceptional boundary. Two company authorization systems is one too many, and
// the one nobody wrote to was the one the guards were reading.
//
// What is left here is what was always live and is a different subject: API
// keys, which authenticate a CREDENTIAL rather than a person.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ─── createApiKey: REMOVED ────────────────────────────────────────────────────
//
// A SECOND WAY TO MINT A KEY, WITH NO CLOSED SET BEHIND IT. This took a
// `scopes: string[]` and wrote it to `api_keys.scopes` verbatim — no
// `isApiScope`, no expiry, no record that a founder had asserted anything. It
// had no callers: `api-key-issuance.ts` says so in its own header, calling this
// one of "the two dead helpers it replaces".
//
// Dead is not harmless here. The settings page promises the founder that "a key
// does exactly what you tick and nothing else", and `issueApiKey` keeps that
// promise by refusing any scope no route honours — `'*'` included, which is
// what `api-key-issuance.test.ts` pins. This function would have accepted `'*'`,
// and `api/v1/mcp.ts` read `'*'` as every tool. One caller away from a key that
// does everything, under a page that says there is no everything option.
//
// The `'*'` branch in `mcp.ts` goes with it: no issuable scope is `'*'`, and a
// value that silently means "all of them" is a fail-open default for an unknown
// string. Narrowing what a credential may do is always permitted.
// ─── validateApiKey ───────────────────────────────────────────────────────────

export async function validateApiKey(
  key: string
): Promise<{ productId: string; userId: string; scopes: string[] } | null> {
  const keyHash = await hashKey(key);

  const result = await query(
    `SELECT id, product_id, created_by, scopes, expires_at, revoked_at
     FROM api_keys
     WHERE key_hash = ?`,
    [keyHash]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0] as Record<string, unknown>;

  // Check revoked
  if (row.revoked_at !== null && row.revoked_at !== undefined) return null;

  // Check expiry
  if (row.expires_at) {
    const expiry = new Date(row.expires_at as string);
    if (expiry < new Date()) return null;
  }

  // Update last_used_at
  await query(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`, [row.id]);

  let scopes: string[] = [];
  try {
    scopes = JSON.parse(row.scopes as string) as string[];
  } catch {
    scopes = [];
  }

  return {
    productId: row.product_id as string,
    userId: (row.created_by as string) ?? '',
    scopes,
  };
}

// ─── listApiKeys ──────────────────────────────────────────────────────────────

export async function listApiKeys(
  productId: string
): Promise<
  Array<{ id: string; label: string; scopes: string[]; last_used_at: string | null; created_at: string }>
> {
  const result = await query(
    `SELECT id, name, scopes, last_used_at, created_at
     FROM api_keys
     WHERE product_id = ? AND revoked_at IS NULL
     ORDER BY created_at DESC`,
    [productId]
  );

  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    let scopes: string[] = [];
    try {
      scopes = JSON.parse(r.scopes as string) as string[];
    } catch {
      scopes = [];
    }
    return {
      id: r.id as string,
      label: (r.name as string) ?? '',
      scopes,
      last_used_at: (r.last_used_at as string | null) ?? null,
      created_at: r.created_at as string,
    };
  });
}

// ─── revokeApiKey ─────────────────────────────────────────────────────────────

export async function revokeApiKey(keyId: string, productId: string): Promise<void> {
  await query(
    `UPDATE api_keys SET revoked_at = datetime('now')
     WHERE id = ? AND product_id = ?`,
    [keyId, productId]
  );
}
