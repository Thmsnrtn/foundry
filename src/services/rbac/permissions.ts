// =============================================================================
// FOUNDRY — RBAC Permissions Service
// Manages roles, permissions, and API keys for product access control.
// Based on migration 024 (account_roles, role_permissions, api_keys tables).
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

// ─── Role Permissions Map ─────────────────────────────────────────────────────

const ALL_PERMISSIONS = [
  'agents:run',
  'agents:configure',
  'integrations:manage',
  'briefings:view',
  'decisions:approve',
  'experiments:manage',
  'customers:view',
  'customers:manage',
  'billing:manage',
  'api:read',
  'api:write',
];

const ROLE_PERMISSIONS_MAP: Record<string, string[]> = {
  owner: [...ALL_PERMISSIONS],
  admin: ALL_PERMISSIONS.filter((p) => p !== 'billing:manage'),
  analyst: [
    'agents:run',
    'briefings:view',
    'decisions:approve',
    'experiments:manage',
    'customers:view',
    'api:read',
  ],
  viewer: ['briefings:view', 'customers:view', 'api:read'],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ─── getUserRole ──────────────────────────────────────────────────────────────

export async function getUserRole(productId: string, userId: string): Promise<string | null> {
  const result = await query(
    `SELECT role FROM account_roles
     WHERE founder_id = ? AND (product_id = ? OR product_id IS NULL)
       AND revoked_at IS NULL
     ORDER BY CASE WHEN product_id = ? THEN 0 ELSE 1 END ASC
     LIMIT 1`,
    [userId, productId, productId]
  );
  if (result.rows.length === 0) return null;
  return (result.rows[0] as Record<string, unknown>).role as string;
}

// ─── assignRole ───────────────────────────────────────────────────────────────

export async function assignRole(
  productId: string,
  userId: string,
  role: string,
  assignedBy: string
): Promise<void> {
  // Revoke any existing active role for the same (user, product) pair
  await query(
    `UPDATE account_roles SET revoked_at = datetime('now')
     WHERE founder_id = ? AND product_id = ? AND revoked_at IS NULL`,
    [userId, productId]
  );

  await query(
    `INSERT INTO account_roles (id, founder_id, product_id, role, granted_by)
     VALUES (?, ?, ?, ?, ?)`,
    [nanoid(), userId, productId, role, assignedBy]
  );
}

// ─── getRolePermissions ───────────────────────────────────────────────────────

export async function getRolePermissions(role: string): Promise<string[]> {
  return ROLE_PERMISSIONS_MAP[role] ?? [];
}

// ─── hasPermission ────────────────────────────────────────────────────────────

export async function hasPermission(
  productId: string,
  userId: string,
  permission: string
): Promise<boolean> {
  const role = await getUserRole(productId, userId);
  if (!role) return false;
  const perms = await getRolePermissions(role);
  return perms.includes(permission);
}

// ─── createApiKey ─────────────────────────────────────────────────────────────

export async function createApiKey(
  productId: string,
  userId: string,
  label: string,
  scopes: string[]
): Promise<{ key: string; keyId: string }> {
  const keyId = nanoid();
  const rawKey = 'fnd_' + nanoid(40);
  const keyHash = await hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, 12); // 'fnd_' + first 8 chars

  await query(
    `INSERT INTO api_keys (id, product_id, name, key_hash, key_prefix, role, scopes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [keyId, productId, label, keyHash, keyPrefix, 'viewer', JSON.stringify(scopes), userId]
  );

  return { key: rawKey, keyId };
}

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
