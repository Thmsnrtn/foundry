// =============================================================================
// FOUNDRY — Outbound Webhooks (Wave 3, action 23)
// One-way bridge: Foundry posts notifications to Linear / Slack / Notion
// when meaningful events fire (decision-needed, signal-tier-shift,
// briefing-ready). Founders living in those tools see Foundry where they
// already are. Council 26 finding.
//
// Design:
//   - Per-product webhook config stored in product_webhooks table.
//   - Dispatch goes through the V3.1 gateway as tool='post_webhook' so
//     it inherits idempotency / kill-switch / audit.
//   - Three target shapes (linear, slack, notion) — each formats the
//     payload to the destination's API.
// =============================================================================

import { nanoid } from 'nanoid';
import { createHmac } from 'node:crypto';
import { query } from '../../db/client.js';
import { invoke, registerToolHandler, type GatewayRequest } from '../outbound/gateway.js';
import { withRetry } from '../resilience.js';
import { log } from '../../lib/logger.js';

/** HMAC-SHA256 over the exact JSON body, so a receiver can verify the webhook
 *  genuinely came from Foundry and wasn't forged or tampered with. Format:
 *  `sha256=<hex>` (the GitHub/Stripe convention). Previously this header was
 *  sent EMPTY — a signature that proved nothing (fixed 2026-07-14). */
export function signWebhookBody(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type WebhookTarget = 'slack' | 'linear' | 'notion' | 'generic';

export type WebhookEventType =
  | 'decision_needed'
  | 'signal_tier_shift'
  | 'briefing_ready'
  | 'agent_action_executed';

export interface WebhookConfig {
  id: string;
  product_id: string;
  target: WebhookTarget;
  url: string;                        // destination URL
  secret: string | null;              // for HMAC sig if target supports
  event_types: WebhookEventType[];    // subset of events to deliver
  enabled: boolean;
}

export interface WebhookPayload {
  event_type: WebhookEventType;
  product_id: string;
  product_name: string;
  headline: string;
  detail?: string;
  url?: string;                       // deep link back into Foundry
}

const WEBHOOK_TIMEOUT_MS = 8_000;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Dispatch a webhook event to all configured destinations for a product.
 * Each destination dispatch is one gateway invocation with a unique
 * dedupKey, so a flaky destination's retry doesn't fire duplicates.
 */
export async function dispatchEvent(
  productId: string,
  payload: WebhookPayload
): Promise<{ sent: number; refused: number }> {
  const configs = await loadEnabledConfigs(productId, payload.event_type);
  if (configs.length === 0) return { sent: 0, refused: 0 };

  let sent = 0;
  let refused = 0;
  for (const cfg of configs) {
    const dedupKey = `webhook:${cfg.id}:${payload.event_type}:${Date.now()}`;
    const result = await invoke({
      productId,
      tool: 'post_webhook',
      action: `${payload.event_type} → ${cfg.target}`,
      params: { config: cfg, payload },
      dedupKey,
      surface: 'integration_webhook',
      dataClass: 'general',
    });
    if (result.ok) sent++;
    else refused++;
  }
  return { sent, refused };
}

// ─── Webhook Handler (registered with the gateway) ───────────────────────────

async function postWebhookHandler(req: GatewayRequest): Promise<{ status: number; target: WebhookTarget }> {
  const params = req.params as unknown as { config: WebhookConfig; payload: WebhookPayload };
  const { config, payload } = params;

  const body = formatPayload(config.target, payload);
  const serialized = JSON.stringify(body);

  // Checked at CALL time, not only at registration — a hostname that resolved
  // publicly when the founder saved it can resolve to a private address later,
  // which is the whole point of DNS rebinding. The two sibling senders
  // (`lib/webhooks.ts` and the approved-action executor) both do this; this one
  // did not, and the only reason that was not exploitable is that nothing can
  // currently register a target: `addWebhookConfig` has no caller. One wiring
  // away is not a safety property.
  const { assertUrlSafe } = await import('../outbound/ssrf.js');
  await assertUrlSafe(config.url);

  const response = await withRetry(
    () =>
      fetch(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Signed with the founder's webhook secret so the receiver can verify
          // authenticity (was an empty header — proved nothing).
          ...(config.secret ? { 'X-Foundry-Signature': signWebhookBody(config.secret, serialized) } : {}),
        },
        body: serialized,
      }),
    { timeoutMs: WEBHOOK_TIMEOUT_MS, maxRetries: 2 }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`webhook ${config.target} ${response.status}: ${text.slice(0, 200)}`);
  }

  log.info('webhook.dispatched', {
    productId: req.productId,
    target: config.target,
    event: payload.event_type,
    status: response.status,
  });

  return { status: response.status, target: config.target };
}

// Side-effect at module load: register the gateway handler.
registerToolHandler('post_webhook', postWebhookHandler, {
  actor: 'webhook_delivery', surface: 'integration_webhook', dataClass: 'general',
  requireDedupKey: true, requireCustomerExternalId: false,
});

// ─── Per-target payload formatters ───────────────────────────────────────────

function formatPayload(target: WebhookTarget, payload: WebhookPayload): unknown {
  const link = payload.url
    ? `\n<${payload.url}|View in Foundry>`
    : '';

  switch (target) {
    case 'slack':
      // Slack incoming-webhook format
      return {
        text: `*${payload.headline}*${payload.detail ? '\n' + payload.detail : ''}${link}`,
        attachments: [
          {
            footer: `Foundry · ${payload.product_name}`,
            color: payload.event_type === 'signal_tier_shift' ? 'warning' : 'good',
          },
        ],
      };

    case 'linear':
      // Linear's create-issue webhook shape (assumes the URL is a
      // configured webhook that creates an issue from a payload). The
      // operator points the webhook at a Linear automation that creates
      // an issue from { title, description }.
      return {
        title: payload.headline,
        description: [
          payload.detail ?? '',
          payload.url ? `\nLink: ${payload.url}` : '',
          `\nProduct: ${payload.product_name}`,
          `\nEvent: ${payload.event_type}`,
        ]
          .join('')
          .trim(),
        labels: ['foundry', payload.event_type],
      };

    case 'notion':
      // Notion's database-add via a configured automation. Same pattern
      // as Linear: Foundry POSTs structured data; the operator's
      // automation maps fields onto a Notion DB.
      return {
        properties: {
          Title: payload.headline,
          Detail: payload.detail ?? '',
          Product: payload.product_name,
          Event: payload.event_type,
          Url: payload.url ?? '',
        },
      };

    case 'generic':
    default:
      return {
        event_type: payload.event_type,
        product_id: payload.product_id,
        product_name: payload.product_name,
        headline: payload.headline,
        detail: payload.detail ?? null,
        url: payload.url ?? null,
        delivered_at: new Date().toISOString(),
      };
  }
}

// ─── Config CRUD ──────────────────────────────────────────────────────────────

export async function addWebhookConfig(opts: {
  productId: string;
  target: WebhookTarget;
  url: string;
  secret?: string;
  event_types?: WebhookEventType[];
}): Promise<string> {
  // Refused at registration as well, so a founder gets an error when they save
  // rather than silence at dispatch time.
  const { assertUrlSafe } = await import('../outbound/ssrf.js');
  await assertUrlSafe(opts.url);

  const id = nanoid();
  const events = opts.event_types ?? [
    'decision_needed',
    'signal_tier_shift',
    'briefing_ready',
  ];
  await query(
    `INSERT INTO product_webhooks
       (id, product_id, target, url, secret, event_types_json, enabled)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [id, opts.productId, opts.target, opts.url, opts.secret ?? null, JSON.stringify(events)]
  );
  return id;
}

export async function disableWebhook(configId: string): Promise<void> {
  await query('UPDATE product_webhooks SET enabled = 0 WHERE id = ?', [configId]);
}

// ─── Internals ────────────────────────────────────────────────────────────────

async function loadEnabledConfigs(
  productId: string,
  eventType: WebhookEventType
): Promise<WebhookConfig[]> {
  const r = await query(
    `SELECT * FROM product_webhooks
      WHERE product_id = ? AND enabled = 1`,
    [productId]
  );
  return r.rows
    .map((row) => rowToConfig(row as Record<string, unknown>))
    .filter((c) => c.event_types.includes(eventType));
}

function rowToConfig(row: Record<string, unknown>): WebhookConfig {
  let events: WebhookEventType[] = [];
  try {
    const parsed = JSON.parse(String(row.event_types_json ?? '[]'));
    if (Array.isArray(parsed)) events = parsed as WebhookEventType[];
  } catch { /* default empty */ }
  return {
    id: row.id as string,
    product_id: row.product_id as string,
    target: row.target as WebhookTarget,
    url: row.url as string,
    secret: (row.secret as string | null) ?? null,
    event_types: events,
    enabled: Number(row.enabled ?? 0) === 1,
  };
}
