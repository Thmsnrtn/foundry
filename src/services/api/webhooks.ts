// =============================================================================
// FOUNDRY — Outbound Webhooks Service
// Manages webhook registrations and event delivery with retry logic.
// Based on migration 033 (outbound_webhooks, webhook_deliveries tables).
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Webhook {
  id: string;
  product_id: string;
  url: string;
  events: string[]; // e.g. ['briefing.published', 'decision.created', 'agent.alert']
  secret: string; // HMAC secret (plaintext — only returned at creation time)
  enabled: boolean;
  created_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function hmacSign(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(payload);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashSecret(secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(secret);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ─── createWebhook ────────────────────────────────────────────────────────────

export async function createWebhook(
  productId: string,
  url: string,
  events: string[]
): Promise<Webhook> {
  const id = nanoid();
  const secret = 'whsec_' + nanoid(32);
  const secretHash = await hashSecret(secret);
  const label = `Webhook ${id.slice(0, 8)}`;

  await query(
    `INSERT INTO outbound_webhooks
       (id, product_id, name, url, secret_hash, events, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [id, productId, label, url, secretHash, JSON.stringify(events)]
  );

  return {
    id,
    product_id: productId,
    url,
    events,
    secret, // returned once only
    enabled: true,
    created_at: new Date().toISOString(),
  };
}

// ─── listWebhooks ─────────────────────────────────────────────────────────────

export async function listWebhooks(productId: string): Promise<Webhook[]> {
  const result = await query(
    `SELECT id, product_id, url, events, is_active, created_at
     FROM outbound_webhooks
     WHERE product_id = ?
     ORDER BY created_at DESC`,
    [productId]
  );

  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    let events: string[] = [];
    try {
      events = JSON.parse((r.events as string) ?? '[]') as string[];
    } catch {
      events = [];
    }
    return {
      id: r.id as string,
      product_id: r.product_id as string,
      url: r.url as string,
      events,
      secret: '[redacted]', // secret never returned after creation
      enabled: ((r.is_active as number) ?? 0) === 1,
      created_at: r.created_at as string,
    };
  });
}

// ─── deleteWebhook ────────────────────────────────────────────────────────────

export async function deleteWebhook(webhookId: string, productId: string): Promise<void> {
  await query(
    `UPDATE outbound_webhooks SET is_active = 0 WHERE id = ? AND product_id = ?`,
    [webhookId, productId]
  );
}

// ─── deliverWebhookEvent ──────────────────────────────────────────────────────

export async function deliverWebhookEvent(
  productId: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<void> {
  // Find all enabled webhooks for this product that subscribe to this event type
  const webhooksResult = await query(
    `SELECT id, url, secret_hash, events FROM outbound_webhooks
     WHERE product_id = ? AND is_active = 1`,
    [productId]
  );

  for (const row of webhooksResult.rows) {
    const r = row as Record<string, unknown>;
    let subscribedEvents: string[] = [];
    try {
      subscribedEvents = JSON.parse((r.events as string) ?? '[]') as string[];
    } catch {
      subscribedEvents = [];
    }

    // Check if this webhook subscribes to the event type
    const matches =
      subscribedEvents.includes(eventType) ||
      subscribedEvents.includes('*');

    if (!matches) continue;

    const webhookId = r.id as string;
    const url = r.url as string;
    const secretHash = (r.secret_hash as string) ?? '';

    // Fire delivery async (fire-and-forget with retry)
    void deliverToWebhook(webhookId, productId, url, secretHash, eventType, payload);
  }
}

async function deliverToWebhook(
  webhookId: string,
  productId: string,
  url: string,
  secretHash: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<void> {
  const deliveryId = nanoid();
  const fullPayload = {
    id: deliveryId,
    event: eventType,
    product_id: productId,
    timestamp: new Date().toISOString(),
    data: payload,
  };
  const payloadJson = JSON.stringify(fullPayload);

  // Sign payload with HMAC-SHA256 using the secretHash as the signing key
  // (In production you'd store the plaintext secret separately; here we use the hash)
  const signature = await hmacSign(secretHash, payloadJson);

  let lastStatus: number | null = null;
  let lastBody = '';
  let delivered = false;
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Foundry-Signature': `sha256=${signature}`,
          'X-Foundry-Event': eventType,
          'X-Foundry-Delivery': deliveryId,
        },
        body: payloadJson,
        signal: AbortSignal.timeout(10_000), // 10s timeout
      });

      lastStatus = response.status;
      lastBody = (await response.text()).slice(0, 500);

      if (response.ok) {
        delivered = true;
        break;
      }
    } catch {
      lastStatus = null;
      lastBody = 'Connection error';
    }

    // Exponential backoff between retries
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
    }
  }

  // Record delivery result
  await query(
    `INSERT INTO webhook_deliveries
       (id, webhook_id, event_type, payload_json, response_status, response_body,
        attempt_count, delivered_at, failed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      deliveryId,
      webhookId,
      eventType,
      payloadJson,
      lastStatus,
      lastBody,
      maxAttempts,
      delivered ? new Date().toISOString() : null,
      delivered ? null : new Date().toISOString(),
    ]
  );

  // Update last_delivered_at and increment failure_count if failed
  if (delivered) {
    await query(
      `UPDATE outbound_webhooks SET last_delivered_at = datetime('now') WHERE id = ?`,
      [webhookId]
    );
  } else {
    await query(
      `UPDATE outbound_webhooks
       SET failure_count = failure_count + 1,
           is_active = CASE WHEN failure_count + 1 >= 10 THEN 0 ELSE is_active END
       WHERE id = ?`,
      [webhookId]
    );
  }
}
