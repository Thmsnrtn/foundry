// =============================================================================
// FOUNDRY — Issuing an API key (owner decision: make the public API live)
//
// THE STATE THIS FIXES. `/api/v1` and the transcript webhooks were mounted,
// authenticated, and unreachable by anybody: both `createApiKey` functions had
// zero callers, and the endpoint the revenue dashboard advertised —
// `POST /api/v1/settings/api-keys` — did not exist. It could not have: minting
// a key from behind API-key authentication requires a key.
//
// So issuance belongs on the authenticated founder surface, and it is built
// like scoped ingest credentials (migration 139) rather than like the two dead
// helpers it replaces:
//
//   • Scopes are chosen explicitly at mint time, from a closed set that is
//     exactly what the routes enforce. There is no "everything" option.
//   • Every key expires. A credential with no end is a credential nobody ever
//     revisits.
//   • Issuing is a founder assertion, recorded as canonical evidence.
//   • The raw key is returned once and never stored — only its SHA-256.
//
// WHAT A KEY IS NOT. Not a role: the RBAC role map governs people, and a key
// is a bounded delegation of one product's surface. Not authority over the
// institution — nothing here can grant a responsibility, widen a consent, or
// reach a governed effect.
// =============================================================================

import { createHash, randomBytes } from 'node:crypto';
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

/** The closed set. Exactly the scopes `requireScope` actually enforces — a
 * test asserts in both directions, so a scope cannot be offered here without a
 * route honouring it, and a route cannot demand one a founder cannot grant.
 *
 * Writes are deliberately separated from reads. Three write routes used to sit
 * behind `agents:read`, and the MCP transport had no check at all. */
export const API_SCOPES = [
  'agents:read', 'agents:run', 'agents:write',
  'customers:read', 'customers:manage',
  'experiments:write', 'metrics:write',
] as const;
export type ApiScope = typeof API_SCOPES[number];

/** Plain descriptions, in the same shape the ingest credentials use: what it
 * may do, and what it still may not. The second half is the part people
 * assume. */
export const API_SCOPE_LABELS: Record<ApiScope, { may: string; mayNot: string }> = {
  'agents:read': {
    may: 'read agents, briefings, experiments, metrics and webhooks',
    mayNot: 'change any of them',
  },
  'agents:run': { may: 'run an agent on demand', mayNot: 'change its configuration' },
  'agents:write': {
    may: 'create and delete webhooks, and use the MCP tools that record or resolve a decision',
    mayNot: 'grant authority, or reach anything Foundry sends on your behalf',
  },
  'customers:read': { may: 'read your customer records and their timelines', mayNot: 'change them' },
  'customers:manage': { may: 'create customers and update their health', mayNot: 'delete them' },
  'experiments:write': { may: 'create experiments, post results, and conclude them', mayNot: 'read anything else' },
  'metrics:write': { may: 'post metric snapshots', mayNot: 'read anything else' },
};

export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value);
}

const MAX_DAYS = 365;
const DEFAULT_DAYS = 90;

export interface IssuedKey {
  id: string; label: string; scopes: ApiScope[]; expiresAt: string;
  /** Returned once. Never stored, never readable again. */
  key: string;
}

export interface ApiKeySummary {
  id: string; label: string; scopes: ApiScope[]; prefix: string;
  expiresAt: string | null; lastUsedAt: string | null; createdAt: string; revoked: boolean;
}

export type IssueRefusal = 'label_required' | 'scopes_required' | 'scope_unknown' | 'not_owned';

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * The owner issues a key for one of their products, for exactly the scopes
 * they chose, expiring on a date they can see.
 */
export async function issueApiKey(input: {
  productId: string; founderId: string; label: string; scopes: string[]; days?: number;
}): Promise<IssuedKey | { refused: IssueRefusal }> {
  const label = input.label?.trim();
  if (!label || label.length > 80) return { refused: 'label_required' };

  const requested = [...new Set(input.scopes ?? [])];
  if (!requested.length) return { refused: 'scopes_required' };
  if (requested.some((s) => !isApiScope(s))) return { refused: 'scope_unknown' };
  // Canonical order, so two keys with the same scopes are literally comparable.
  const scopes = API_SCOPES.filter((s) => requested.includes(s));

  const owned = await query('SELECT 1 FROM products WHERE id=? AND owner_id=?',
    [input.productId, input.founderId]);
  if (!owned.rows.length) return { refused: 'not_owned' };

  const days = Math.min(Math.max(input.days ?? DEFAULT_DAYS, 1), MAX_DAYS);
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();

  const signalId = nanoid();
  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
     VALUES (?,?,'founder_assertion_structured','founder_issued_api_key','low',?,?)`,
    [signalId, input.productId,
      JSON.stringify({ founder_id: input.founderId, label, scopes, expires_at: expiresAt }),
      `The founder issued an API key to "${label}"`],
  );

  const key = `fnd_${randomBytes(24).toString('base64url')}`;
  const id = nanoid();
  await query(
    `INSERT INTO api_keys
       (id,founder_id,product_id,name,key_hash,key_prefix,role,scopes,created_by,expires_at)
     VALUES (?,?,?,?,?,?,'viewer',?,?,?)`,
    [id, input.founderId, input.productId, label, hashKey(key), key.slice(0, 12),
      JSON.stringify(scopes), input.founderId, expiresAt],
  );
  return { id, label, scopes: [...scopes], expiresAt, key };
}

/** What the owner sees. The raw key is not here and cannot be — only its hash
 * was ever stored, which is the point. */
export async function getApiKeys(productId: string): Promise<ApiKeySummary[]> {
  const rows = await query(
    `SELECT id,name,scopes,key_prefix,expires_at,last_used_at,created_at,revoked_at
       FROM api_keys WHERE product_id=? ORDER BY created_at DESC, id`, [productId],
  );
  return (rows.rows as unknown as Array<Record<string, unknown>>).map((r) => {
    let scopes: ApiScope[] = [];
    try { scopes = JSON.parse(String(r.scopes)) as ApiScope[]; } catch { scopes = []; }
    return {
      id: String(r.id), label: String(r.name ?? ''), scopes,
      prefix: String(r.key_prefix ?? ''),
      expiresAt: r.expires_at == null ? null : String(r.expires_at),
      lastUsedAt: r.last_used_at == null ? null : String(r.last_used_at),
      createdAt: String(r.created_at), revoked: r.revoked_at != null,
    };
  });
}

/** Withdrawal is immediate. `validateApiKey` reads `revoked_at` on every
 * request, so the next one simply fails. */
export async function revokeIssuedApiKey(input: {
  productId: string; founderId: string; keyId: string;
}): Promise<boolean> {
  const result = await query(
    `UPDATE api_keys SET revoked_at=datetime('now')
      WHERE id=? AND product_id=? AND revoked_at IS NULL
        AND EXISTS (SELECT 1 FROM products p WHERE p.id=product_id AND p.owner_id=?)`,
    [input.keyId, input.productId, input.founderId],
  );
  return Number(result.rowsAffected ?? 0) > 0;
}
