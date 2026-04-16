// =============================================================================
// FOUNDRY — Webhook Bridge
// Custom inbound webhook handler for external tools (Zapier, n8n, scripts).
// Allows arbitrary payloads to be mapped and pushed into the agent event pipeline.
// =============================================================================

import { query } from '../../db/client.js';
import { storeEvent } from './fabric.js';
import { nanoid } from 'nanoid';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WebhookSource {
  id: string;
  product_id: string;
  name: string;
  description: string | null;
  endpoint_token: string;
  field_mappings: FieldMapping[];
  default_event_type: string;
  total_events_received: number;
  last_received_at: string | null;
  is_active: number;
  created_at: string;
}

interface FieldMapping {
  incoming_field: string;
  mapped_to: string; // 'event_type' | 'actor_id' | 'data.fieldname'
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Process an inbound webhook payload from an external source.
 * Verifies HMAC signature if configured, applies field mappings, and stores the event.
 */
export async function processInboundWebhook(opts: {
  productId: string;
  sourceName: string;
  payload: Record<string, unknown>;
  signature?: string;
}): Promise<{ processed: boolean; eventType: string | null; error?: string }> {
  const source = await loadWebhookSource(opts.productId, opts.sourceName);
  if (!source) {
    return { processed: false, eventType: null, error: 'Webhook source not found or inactive' };
  }

  // HMAC verification if a secret is set
  const secretResult = await query(
    `SELECT endpoint_token FROM custom_webhook_sources WHERE id = ?`,
    [source.id]
  );
  // We use endpoint_token as the HMAC secret since no separate secret column exists
  const secret = secretResult.rows.length > 0
    ? (secretResult.rows[0] as Record<string, unknown>).endpoint_token as string
    : null;

  if (secret && opts.signature) {
    const payloadStr = JSON.stringify(opts.payload);
    const valid = await verifyHmac(payloadStr, opts.signature, secret);
    if (!valid) {
      return { processed: false, eventType: null, error: 'Invalid HMAC signature' };
    }
  }

  // Apply field mappings to extract/transform fields
  let eventType: string = source.default_event_type;
  let actorId: string | undefined;
  const data: Record<string, unknown> = { ...opts.payload };

  for (const mapping of source.field_mappings) {
    const incomingValue = getNestedField(opts.payload, mapping.incoming_field);
    if (incomingValue === undefined) continue;

    if (mapping.mapped_to === 'event_type') {
      eventType = String(incomingValue);
    } else if (mapping.mapped_to === 'actor_id') {
      actorId = String(incomingValue);
    } else if (mapping.mapped_to.startsWith('data.')) {
      const dataKey = mapping.mapped_to.slice(5);
      data[dataKey] = incomingValue;
    }
  }

  try {
    await storeEvent(opts.productId, {
      integration_name: `webhook:${opts.sourceName}`,
      event_type: eventType,
      actor_type: 'webhook',
      actor_id: actorId,
      data,
    });

    // Update event count and last_received_at
    await query(
      `UPDATE custom_webhook_sources
       SET total_events_received = total_events_received + 1,
           last_received_at = datetime('now')
       WHERE id = ?`,
      [source.id]
    );

    return { processed: true, eventType };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { processed: false, eventType, error: errorMsg };
  }
}

/**
 * Create a new webhook source with a generated secret token.
 */
export async function createWebhookSource(
  productId: string,
  opts: {
    sourceName: string;
    description: string;
    eventMappings: Array<{
      incoming_field: string;
      mapped_to: string;
    }>;
  }
): Promise<{ sourceId: string; secret: string; webhookUrl: string }> {
  const sourceId = nanoid();
  const secret = nanoid(32);
  const now = new Date().toISOString();

  const fieldMappingsJson = JSON.stringify(opts.eventMappings.map(m => ({
    incoming_field: m.incoming_field,
    mapped_to: m.mapped_to,
    transform: 'string',
  })));

  await query(
    `INSERT INTO custom_webhook_sources
       (id, product_id, name, description, endpoint_token, field_mappings, default_event_type, authorized_agents, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'custom_event', '["all"]', ?)`,
    [sourceId, productId, opts.sourceName, opts.description, secret, fieldMappingsJson, now]
  );

  const webhookUrl = `/webhooks/inbound/${secret}`;

  return { sourceId, secret, webhookUrl };
}

/**
 * List all active webhook sources for a product.
 */
export async function listWebhookSources(productId: string): Promise<Array<{
  id: string;
  source_name: string;
  description: string;
  event_count: number;
  last_received_at: string | null;
  created_at: string;
}>> {
  const result = await query(
    `SELECT id, name, description, total_events_received, last_received_at, created_at
     FROM custom_webhook_sources
     WHERE product_id = ? AND is_active = 1
     ORDER BY created_at DESC`,
    [productId]
  );

  return (result.rows as Record<string, unknown>[]).map(row => ({
    id: row.id as string,
    source_name: row.name as string,
    description: (row.description as string) || '',
    event_count: (row.total_events_received as number) ?? 0,
    last_received_at: row.last_received_at as string | null,
    created_at: row.created_at as string,
  }));
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function loadWebhookSource(productId: string, sourceName: string): Promise<WebhookSource | null> {
  const result = await query(
    `SELECT * FROM custom_webhook_sources WHERE product_id = ? AND name = ? AND is_active = 1`,
    [productId, sourceName]
  );
  if (result.rows.length === 0) return null;

  const row = result.rows[0] as Record<string, unknown>;
  return {
    id: row.id as string,
    product_id: row.product_id as string,
    name: row.name as string,
    description: row.description as string | null,
    endpoint_token: row.endpoint_token as string,
    field_mappings: (() => {
      try { return JSON.parse(row.field_mappings as string || '[]') as FieldMapping[]; } catch { return []; }
    })(),
    default_event_type: (row.default_event_type as string) || 'custom_event',
    total_events_received: (row.total_events_received as number) ?? 0,
    last_received_at: row.last_received_at as string | null,
    is_active: (row.is_active as number) ?? 1,
    created_at: row.created_at as string,
  };
}

function getNestedField(obj: Record<string, unknown>, fieldPath: string): unknown {
  const parts = fieldPath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

async function verifyHmac(payload: string, signature: string, secret: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const sigBytes = Uint8Array.from(
      signature.match(/.{1,2}/g)!.map(b => parseInt(b, 16))
    );
    return crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payload));
  } catch {
    return false;
  }
}
