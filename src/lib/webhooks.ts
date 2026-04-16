// =============================================================================
// FOUNDRY — Webhook Delivery System
// Registers, delivers, and retries webhooks to customer-configured endpoints.
// =============================================================================

import { createHmac } from 'crypto';
import { query } from '../db/client.js';
import { nanoid } from 'nanoid';
import { log } from './logger.js';

export type WebhookEvent =
  | 'audit.completed'
  | 'decision.created'
  | 'decision.resolved'
  | 'stressor.identified'
  | 'stressor.resolved'
  | 'risk_state.changed'
  | 'metric.recorded'
  | 'digest.generated'
  | 'remediation.pr_opened'
  | 'remediation.pr_merged';

/**
 * Register a webhook endpoint for a founder.
 */
export async function registerWebhook(
  founderId: string,
  url: string,
  events: WebhookEvent[],
  secret: string,
): Promise<{ id: string; secret: string }> {
  const id = nanoid();
  await query(
    `INSERT INTO webhooks (id, founder_id, url, events, secret, active) VALUES (?, ?, ?, ?, ?, 1)`,
    [id, founderId, url, JSON.stringify(events), secret]
  );
  return { id, secret };
}

/**
 * List active webhooks for a founder.
 */
export async function listWebhooks(founderId: string): Promise<Array<{
  id: string; url: string; events: string[]; active: boolean; created_at: string;
  last_delivery_at: string | null; failure_count: number;
}>> {
  const result = await query(
    'SELECT * FROM webhooks WHERE founder_id = ? ORDER BY created_at DESC',
    [founderId]
  );
  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      url: r.url as string,
      events: JSON.parse((r.events as string) || '[]'),
      active: !!(r.active as number),
      created_at: r.created_at as string,
      last_delivery_at: r.last_delivery_at as string | null,
      failure_count: (r.failure_count as number) ?? 0,
    };
  });
}

/**
 * Delete a webhook.
 */
export async function deleteWebhook(webhookId: string, founderId: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM webhooks WHERE id = ? AND founder_id = ?',
    [webhookId, founderId]
  );
  return result.rowsAffected > 0;
}

/**
 * Dispatch a webhook event to all registered endpoints for a founder.
 */
export async function dispatchWebhook(
  founderId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  const result = await query(
    "SELECT * FROM webhooks WHERE founder_id = ? AND active = 1 AND failure_count < 10",
    [founderId]
  );

  for (const row of result.rows) {
    const webhook = row as Record<string, unknown>;
    const events = JSON.parse((webhook.events as string) || '[]') as string[];
    if (!events.includes(event) && !events.includes('*')) continue;

    // Fire and forget — delivery errors logged but don't block the caller
    deliverWebhook(
      webhook.id as string,
      webhook.url as string,
      webhook.secret as string,
      event,
      payload,
    ).catch((err) => {
      log.error('Webhook delivery failed', err, { webhookId: webhook.id, event });
    });
  }
}

/**
 * Deliver a single webhook with HMAC signature.
 */
async function deliverWebhook(
  webhookId: string,
  url: string,
  secret: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  const body = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    data: payload,
  });

  const signature = createHmac('sha256', secret).update(body).digest('hex');
  const deliveryId = nanoid();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Foundry-Signature': `sha256=${signature}`,
        'X-Foundry-Event': event,
        'X-Foundry-Delivery': deliveryId,
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.ok) {
      await query(
        'UPDATE webhooks SET last_delivery_at = ?, failure_count = 0 WHERE id = ?',
        [new Date().toISOString(), webhookId]
      );
    } else {
      await query(
        'UPDATE webhooks SET failure_count = failure_count + 1 WHERE id = ?',
        [webhookId]
      );
      log.warn('Webhook delivery non-200', { webhookId, status: response.status, deliveryId });
    }

    // Log delivery
    await query(
      'INSERT INTO webhook_deliveries (id, webhook_id, event, status_code, delivered_at) VALUES (?, ?, ?, ?, ?)',
      [deliveryId, webhookId, event, response.status, new Date().toISOString()]
    );
  } catch (err) {
    await query(
      'UPDATE webhooks SET failure_count = failure_count + 1 WHERE id = ?',
      [webhookId]
    );
    await query(
      'INSERT INTO webhook_deliveries (id, webhook_id, event, status_code, delivered_at, error) VALUES (?, ?, ?, 0, ?, ?)',
      [deliveryId, webhookId, event, new Date().toISOString(), err instanceof Error ? err.message : 'Unknown error']
    );
  }
}
