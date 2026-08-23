// =============================================================================
// FOUNDRY — Integration Fabric
// Central integration manager for all inbound/outbound integrations.
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
import { decryptCredentialPayload, encryptCredentialPayload } from '../encryption.js';
import { DIRECTION_BY_PROVIDER } from './direction.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IntegrationRecord {
  id: string;
  product_id: string;
  name: string;
  type: string;
  status: string;
  config_json: Record<string, unknown>;
  authorized_agents: string[];
  last_synced_at: string | null;
  last_error: string | null;
  total_inbound_events: number;
  total_outbound_actions: number;
  error_count_trailing_7d: number;
  cost_trailing_30d_usd: number;
  created_at: string;
}

export interface NormalizedEvent {
  id: string;
  product_id: string;
  integration_name: string;
  event_type: string;
  actor_type: string | null;
  actor_id: string | null;
  data: Record<string, unknown>;
  relevance_scores: Record<string, number>;
  processed_by: string[];
  created_at: string;
}

// ─── What is a credential, and what is merely configuration ──────────────────
//
// Two founder-facing forms configured integrations and disagreed about this,
// with real consequences in both directions:
//
//   /integrations/:type/connect         split the form, encrypting everything
//                                       that was not one of five named config
//                                       keys into `credentials_json`.
//   /agents/integrations/:name/connect  put EVERY form field into `config_json`
//                                       in plaintext — api keys, bot tokens and
//                                       auth tokens included.
//
// And all four sync adapters read their credential from `config_json`. So the
// path that worked was the one storing provider secrets in the clear, and the
// path that encrypted them correctly produced integrations that silently never
// synced: the adapter looked in the wrong place and reported "missing config
// field" forever.
//
// One list now decides, in both writers and every reader. It is an ALLOW-list
// of non-secret keys, so a field nobody has classified is treated as a
// credential — the fail-closed direction. A new provider whose config key is
// missing here gets encrypted unnecessarily, which costs nothing; the opposite
// mistake writes somebody's API key to a plaintext column.
export const NON_SECRET_CONFIG_KEYS = [
  'activation_event', 'active_user_event', 'team_id', 'host', 'account_id',
  'org_slug', 'project_slug', 'project_id', 'workspace', 'region', 'channel',
  // Identifiers, not secrets: which org, which repo, which channel. Knowing
  // one tells you where to point a credential you do not have.
  'org', 'repo', 'owner', 'channel_id', 'workspace_id', 'base_url',
] as const;

export function isNonSecretConfigKey(key: string): boolean {
  return (NON_SECRET_CONFIG_KEYS as readonly string[]).includes(key);
}

/** Split a submitted form into what may be stored in the clear and what may not. */
export function splitIntegrationFields(
  fields: Record<string, unknown>,
): { config: Record<string, unknown>; credentials: Record<string, string> } {
  const config: Record<string, unknown> = {};
  const credentials: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || value === '') continue;
    if (isNonSecretConfigKey(key)) config[key] = value;
    else credentials[key] = String(value);
  }
  return { config, credentials };
}

/**
 * The credentials an adapter needs, decrypted.
 *
 * ONE SOURCE. There is deliberately no `config_json` fallback any more.
 * Migration 140 moved every secret-shaped key out of that column and now
 * refuses new ones, so a value that is not in `credentials_json` is not a
 * credential this system will use.
 *
 * The fallback existed for one session as compatibility, and removing it is
 * the point rather than a tidy-up: while it was there, an adapter would
 * silently authenticate with a secret that had been sitting in a plaintext
 * column, which is exactly the state that needs to become impossible instead
 * of merely deprecated.
 */
export async function getIntegrationCredentials(
  productId: string, name: string,
): Promise<Record<string, string>> {
  const row = (await query(
    'SELECT credentials_json FROM integrations WHERE product_id=? AND name=?',
    [productId, name],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!row) return {};
  try {
    const plaintext = decryptCredentialPayload(row.credentials_json as string | null);
    return plaintext ? JSON.parse(plaintext) as Record<string, string> : {};
  } catch { return {}; }
}

export interface QuarantinedSecret {
  integration: string; key: string; quarantinedAt: string; rotated: boolean;
}

/**
 * Secrets that were found sitting in a plaintext config column, by key.
 *
 * Migration 140 recorded the KEY and discarded the value on purpose: this list
 * exists to tell an operator what to rotate, and a quarantine that stores the
 * secret is the plaintext column with a more reassuring name.
 *
 * A secret that has been in a plaintext column must be rotated, not relocated.
 * Nothing here can do that for them — the new value has to come from the
 * provider — so the honest product behaviour is to say so plainly.
 */
export async function quarantinedSecrets(
  productId: string, includeRotated = false,
): Promise<QuarantinedSecret[]> {
  const rows = await query(
    `SELECT integration_name, secret_key, quarantined_at, rotated_at
       FROM integration_secret_quarantine
      WHERE product_id=?${includeRotated ? '' : ' AND rotated_at IS NULL'}
      ORDER BY quarantined_at, secret_key`, [productId]);
  return (rows.rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    integration: String(r.integration_name ?? 'unknown'),
    key: String(r.secret_key),
    quarantinedAt: String(r.quarantined_at),
    rotated: r.rotated_at != null,
  }));
}

/** Marks a quarantined key as rotated. Called when a founder re-enters the
 * credential through the ordinary form, because re-entering IS the rotation —
 * the new value arrives encrypted and the old one is already gone. */
export async function markSecretsRotated(
  productId: string, integrationName: string,
): Promise<number> {
  const result = await query(
    `UPDATE integration_secret_quarantine SET rotated_at=datetime('now')
      WHERE product_id=? AND integration_name=? AND rotated_at IS NULL`,
    [productId, integrationName]);
  return Number(result.rowsAffected ?? 0);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function rowToIntegration(row: Record<string, unknown>): IntegrationRecord {
  return {
    id: row.id as string,
    product_id: row.product_id as string,
    name: row.name as string,
    // The DIRECTION, from the column that means direction since migration 203.
    // This field has always carried a direction on this path — `type` is what
    // it was stored in, and two other writers put a provider key there.
    type: (row.direction ?? row.type) as string,
    status: row.status as string,
    config_json: (() => {
      try { return JSON.parse(row.config_json as string || '{}'); } catch { return {}; }
    })(),
    authorized_agents: (() => {
      try { return JSON.parse(row.authorized_agents as string || '["all"]'); } catch { return ['all']; }
    })(),
    last_synced_at: row.last_synced_at as string | null,
    last_error: row.last_error as string | null,
    total_inbound_events: (row.total_inbound_events as number) ?? 0,
    total_outbound_actions: (row.total_outbound_actions as number) ?? 0,
    error_count_trailing_7d: (row.error_count_trailing_7d as number) ?? 0,
    cost_trailing_30d_usd: (row.cost_trailing_30d_usd as number) ?? 0.0,
    created_at: row.created_at as string,
  };
}

function rowToEvent(row: Record<string, unknown>): NormalizedEvent {
  return {
    id: row.id as string,
    product_id: row.product_id as string,
    integration_name: row.integration_name as string,
    event_type: row.event_type as string,
    actor_type: row.actor_type as string | null,
    actor_id: row.actor_id as string | null,
    data: (() => {
      try { return JSON.parse(row.data_json as string || '{}'); } catch { return {}; }
    })(),
    relevance_scores: (() => {
      try { return JSON.parse(row.relevance_scores as string || '{}'); } catch { return {}; }
    })(),
    processed_by: (() => {
      try { return JSON.parse(row.processed_by as string || '[]'); } catch { return []; }
    })(),
    created_at: row.created_at as string,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get all integrations for a product.
 */
export async function getIntegrations(productId: string): Promise<IntegrationRecord[]> {
  const result = await query(
    'SELECT * FROM integrations WHERE product_id = ? ORDER BY name ASC',
    [productId],
  );
  return result.rows.map((r) => rowToIntegration(r as Record<string, unknown>));
}

/**
 * Get a specific integration by name.
 */
export async function getIntegration(productId: string, name: string): Promise<IntegrationRecord | null> {
  const result = await query(
    'SELECT * FROM integrations WHERE product_id = ? AND name = ?',
    [productId, name],
  );
  if (result.rows.length === 0) return null;
  return rowToIntegration(result.rows[0] as Record<string, unknown>);
}

/**
 * Connect/update an integration (upsert). Sets status to 'active'.
 *
 * NOTE: 'active' is the canonical healthy-integration status. It's the value
 * every `integrations` schema's status CHECK constraint permits (008/021), and
 * every sync adapter guards on status === 'active'. The original bug was that
 * adapters guarded on 'connected' — a value nothing wrote AND no schema allows,
 * so every scheduled sync silently no-op'd. The fix standardizes on 'active'
 * (writer + guards + schema all agree). Do NOT write 'connected': it fails the
 * CHECK constraint. See migration 074_integration_status_fix.sql.
 */
export async function connectIntegration(
  productId: string,
  name: string,
  config: {
    credentials_json?: string;
    config_json?: Record<string, unknown>;
    authorized_agents?: string[];
  },
): Promise<void> {
  const existing = await getIntegration(productId, name);

  // WHICH WAY THIS CONNECTION POINTS. This map has always been a DIRECTION, and
  // it was being written into `type` — a column two other writers fill with a
  // provider key and one with a category. `direction` is its own column now
  // (migration 203) with a database trigger holding the vocabulary, and `type`
  // keeps the same value only until the retirement commit removes it.
  const direction = DIRECTION_BY_PROVIDER[name] ?? 'inbound';
  const type = direction;

  const configJson = JSON.stringify(config.config_json ?? {});
  const authorizedAgents = JSON.stringify(config.authorized_agents ?? ['all']);
  const now = new Date().toISOString();
  const credentialsCiphertext = encryptCredentialPayload(config.credentials_json);

  // Re-entering a credential IS the rotation: the new value arrives encrypted
  // and the plaintext one is already gone. Anything still quarantined for this
  // integration is therefore settled by this write.
  if (credentialsCiphertext) await markSecretsRotated(productId, name);

  if (existing) {
    await query(
      `UPDATE integrations SET
        status = 'active',
        type = ?,
        direction = ?,
        provider = COALESCE(provider, ?),
        credentials_json = COALESCE(?, credentials_json),
        config_json = ?,
        authorized_agents = ?,
        updated_at = ?
       WHERE product_id = ? AND name = ?`,
      [type, direction, name, credentialsCiphertext, configJson, authorizedAgents, now, productId, name],
    );
  } else {
    await query(
      `INSERT INTO integrations (id, product_id, name, provider, type, direction, status, credentials_json, config_json, authorized_agents, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
      [nanoid(), productId, name, name, type, direction, credentialsCiphertext, configJson,
       authorizedAgents, now, now],
    );
  }
}

/**
 * Disconnect an integration (set status to 'disconnected').
 */
export async function disconnectIntegration(productId: string, name: string): Promise<void> {
  await query(
    `UPDATE integrations SET status = 'disconnected', updated_at = ? WHERE product_id = ? AND name = ?`,
    [new Date().toISOString(), productId, name],
  );
}

/**
 * Store a normalized inbound event and compute relevance scores.
 * Returns the event ID.
 */
export async function storeEvent(
  productId: string,
  event: {
    integration_name: string;
    event_type: string;
    actor_type?: string;
    actor_id?: string;
    data: Record<string, unknown>;
  },
): Promise<string> {
  const id = nanoid();
  const relevanceScores = computeRelevanceScores(event.integration_name, event.event_type);
  const now = new Date().toISOString();

  await query(
    `INSERT INTO integration_events (id, product_id, integration_name, event_type, actor_type, actor_id, data_json, relevance_scores, processed_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)`,
    [
      id,
      productId,
      event.integration_name,
      event.event_type,
      event.actor_type ?? 'system',
      event.actor_id ?? null,
      JSON.stringify(event.data),
      JSON.stringify(relevanceScores),
      now,
    ],
  );

  // Update total_inbound_events counter on the integration
  await query(
    `UPDATE integrations SET total_inbound_events = total_inbound_events + 1, last_synced_at = ?, updated_at = ?
     WHERE product_id = ? AND name = ?`,
    [now, now, productId, event.integration_name],
  );

  return id;
}

/**
 * Compute relevance scores for an event — which agents should care?
 * Returns a map of agent_name → score (0–1).
 */
export function computeRelevanceScores(
  integrationName: string,
  eventType: string,
): Record<string, number> {
  const scores: Record<string, number> = {};
  const lower = eventType.toLowerCase();

  switch (integrationName) {
    case 'stripe': {
      scores.forge = 0.9;
      scores.oracle = 0.6;
      scores.ledger = 0.7;
      // Churn/cancel events are high priority for harbor
      if (lower.includes('cancel') || lower.includes('churn') || lower.includes('deleted')) {
        scores.harbor = 0.9;
      }
      break;
    }

    case 'posthog':
    case 'plausible': {
      scores.oracle = 0.9;
      if (lower.includes('signup') || lower.includes('sign_up') || lower.includes('registered')) {
        scores.beacon = 0.7;
      }
      if (lower.includes('onboard') || lower.includes('setup') || lower.includes('activation')) {
        scores.compass = 0.7;
      }
      break;
    }

    case 'github': {
      scores.atlas = 0.8;
      scores.crucible = 0.7;
      if (lower.includes('deploy') || lower.includes('release') || lower.includes('push')) {
        scores.sentinel = 0.9;
      }
      break;
    }

    case 'resend': {
      scores.harbor = 0.8;
      if (lower.includes('campaign') || lower.includes('broadcast') || lower.includes('newsletter')) {
        scores.beacon = 0.7;
      }
      break;
    }

    case 'sentry': {
      scores.sentinel = 0.9;
      scores.crucible = 0.8;
      scores.atlas = 0.7;
      break;
    }

    default:
      break;
  }

  return scores;
}

/**
 * Get unprocessed events for an agent (relevance > 0.3, not yet in processed_by).
 */
export async function getUnprocessedEvents(
  productId: string,
  agentName: string,
  limit: number = 50,
): Promise<NormalizedEvent[]> {
  // We fetch recent events and filter in application layer for flexibility
  const result = await query(
    `SELECT * FROM integration_events
     WHERE product_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [productId, limit * 4], // Fetch extra to account for filtered-out events
  );

  const events: NormalizedEvent[] = [];
  for (const row of result.rows) {
    const event = rowToEvent(row as Record<string, unknown>);
    const relevance = event.relevance_scores[agentName] ?? 0;
    const alreadyProcessed = event.processed_by.includes(agentName);

    if (relevance > 0.3 && !alreadyProcessed) {
      events.push(event);
      if (events.length >= limit) break;
    }
  }

  return events;
}

/**
 * Mark events as processed by an agent.
 */
export async function markEventsProcessed(eventIds: string[], agentName: string): Promise<void> {
  for (const id of eventIds) {
    // Fetch current processed_by
    const result = await query('SELECT processed_by FROM integration_events WHERE id = ?', [id]);
    if (result.rows.length === 0) continue;

    const row = result.rows[0] as Record<string, unknown>;
    let processedBy: string[] = [];
    try {
      processedBy = JSON.parse(row.processed_by as string || '[]');
    } catch {
      processedBy = [];
    }

    if (!processedBy.includes(agentName)) {
      processedBy.push(agentName);
      await query(
        'UPDATE integration_events SET processed_by = ? WHERE id = ?',
        [JSON.stringify(processedBy), id],
      );
    }
  }
}

/**
 * Get integration health summary for CEO briefing.
 */
export async function getIntegrationHealth(productId: string): Promise<{
  total: number;
  active: number;
  errored: number;
  pending_auth: number;
  health_pct: number;
}> {
  const result = await query(
    `SELECT status, COUNT(*) as count FROM integrations WHERE product_id = ? GROUP BY status`,
    [productId],
  );

  let total = 0;
  let active = 0;
  let errored = 0;
  let pending_auth = 0;

  for (const row of result.rows) {
    const r = row as Record<string, unknown>;
    const count = r.count as number;
    total += count;
    if (r.status === 'active') active += count;
    if (r.status === 'errored') errored += count;
    if (r.status === 'pending_auth') pending_auth += count;
  }

  const health_pct = total === 0 ? 100 : Math.round((active / total) * 100);

  return { total, active, errored, pending_auth, health_pct };
}
