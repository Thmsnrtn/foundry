// =============================================================================
// FOUNDRY — Public API Key Authentication
// Validates API keys for the public REST API.
// Keys are stored hashed in the database.
// =============================================================================

import { createMiddleware } from 'hono/factory';
import { createHash, randomBytes } from 'crypto';
import { query, getProductsByOwner } from '../db/client.js';
import { nanoid } from 'nanoid';
import type { Founder } from '../types/index.js';

export interface ApiKeyEnv {
  Variables: {
    founder: Founder;
    apiKeyId: string;
  };
}

/**
 * Hash an API key for storage. We never store the raw key.
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Generate a new API key. Returns both the display key (shown once) and the hash.
 */
export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const prefix = 'fnd_';
  const raw = randomBytes(24).toString('base64url');
  const key = `${prefix}${raw}`;
  const hash = hashApiKey(key);
  return { key, hash, prefix };
}

/**
 * API key authentication middleware.
 * Looks for key in Authorization: Bearer <key> header.
 */
export const apiKeyAuth = createMiddleware<ApiKeyEnv>(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer fnd_')) {
    return c.json({ error: 'Invalid or missing API key. Use Authorization: Bearer fnd_...' }, 401);
  }

  const key = authHeader.slice(7); // Remove 'Bearer '
  const hash = hashApiKey(key);

  const result = await query(
    `SELECT ak.id, ak.founder_id, ak.name, f.* FROM api_keys ak
     JOIN founders f ON ak.founder_id = f.id
     WHERE ak.key_hash = ? AND ak.revoked_at IS NULL`,
    [hash]
  );

  if (result.rows.length === 0) {
    return c.json({ error: 'Invalid or revoked API key' }, 401);
  }

  const row = result.rows[0] as Record<string, unknown>;

  // Update last_used_at
  query('UPDATE api_keys SET last_used_at = ? WHERE id = ?', [new Date().toISOString(), row.id]).catch(() => {});

  const founder: Founder = {
    id: row.founder_id as string,
    clerk_user_id: row.clerk_user_id as string,
    email: row.email as string,
    name: row.name as string | null,
    stripe_customer_id: row.stripe_customer_id as string | null,
    tier: row.tier as Founder['tier'],
    cohort_id: row.cohort_id as string | null,
    created_at: row.created_at as string,
    preferences: row.preferences ? JSON.parse(row.preferences as string) : null,
    lifestyle_mode: Boolean(row.lifestyle_mode ?? 0),
    lifestyle_target_mrr: (row.lifestyle_target_mrr as number) ?? 0,
  };

  c.set('founder', founder);
  c.set('apiKeyId', row.id as string);
  await next();
});

/**
 * Create a new API key for a founder.
 */
export async function createApiKey(founderId: string, name: string): Promise<{ id: string; key: string; name: string }> {
  const { key, hash } = generateApiKey();
  const id = nanoid();
  await query(
    'INSERT INTO api_keys (id, founder_id, name, key_hash, key_prefix) VALUES (?, ?, ?, ?, ?)',
    [id, founderId, name, hash, key.slice(0, 8)]
  );
  return { id, key, name };
}

/**
 * List API keys for a founder (without revealing the actual keys).
 */
export async function listApiKeys(founderId: string): Promise<Array<{ id: string; name: string; key_prefix: string; created_at: string; last_used_at: string | null }>> {
  const result = await query(
    'SELECT id, name, key_prefix, created_at, last_used_at FROM api_keys WHERE founder_id = ? AND revoked_at IS NULL ORDER BY created_at DESC',
    [founderId]
  );
  return result.rows as unknown as Array<{ id: string; name: string; key_prefix: string; created_at: string; last_used_at: string | null }>;
}

/**
 * Revoke an API key.
 */
export async function revokeApiKey(keyId: string, founderId: string): Promise<boolean> {
  const result = await query(
    'UPDATE api_keys SET revoked_at = ? WHERE id = ? AND founder_id = ?',
    [new Date().toISOString(), keyId, founderId]
  );
  return result.rowsAffected > 0;
}
