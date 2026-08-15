// =============================================================================
// FOUNDRY — Webhook Delivery System
// Registers, delivers, and retries webhooks to customer-configured endpoints.
// =============================================================================

import { createHmac } from 'crypto';
import { query } from '../db/client.js';
import { nanoid } from 'nanoid';
import { log } from './logger.js';
import { assertUrlSafe } from '../services/outbound/ssrf.js';
import { decryptCredentialPayload, encrypt, isEncrypted } from '../services/encryption.js';

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
 * Dispatch a webhook event to all registered endpoints for a founder.
 */
export interface WebhookDeliveryReceipt {
  deliveryId: string;
  webhookId: string;
  certainty: 'provider_acknowledged' | 'provider_rejected' | 'ambiguous' | 'not_attempted';
  statusCode: number | null;
}

export async function dispatchWebhook(
  productId: string,
  founderId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<WebhookDeliveryReceipt[]> {
  const result = await query(
    "SELECT * FROM webhooks WHERE product_id = ? AND founder_id = ? AND active = 1 AND failure_count < 10",
    [productId, founderId]
  );

  const deliveries: Array<Promise<WebhookDeliveryReceipt>> = [];
  for (const row of result.rows) {
    const webhook = row as Record<string, unknown>;
    const events = JSON.parse((webhook.events as string) || '[]') as string[];
    if (!events.includes(event) && !events.includes('*')) continue;

    deliveries.push(deliverWebhook(
      webhook.id as string,
      webhook.url as string,
      webhook.secret as string,
      event,
      payload,
    ).catch((err) => {
      log.error('Webhook delivery failed', err, { webhookId: webhook.id, event });
      throw err;
    }));
  }
  return Promise.all(deliveries);
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
): Promise<WebhookDeliveryReceipt> {
  const body = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    data: payload,
  });

  const deliveryId = nanoid();
  let plaintextSecret: string;

  try {
    await assertUrlSafe(url); // call-time DNS check defeats rebinding after registration
    plaintextSecret = decryptCredentialPayload(secret) ?? '';
    if (!plaintextSecret) throw new Error('webhook signing secret unavailable');
    if (!isEncrypted(secret)) {
      await query('UPDATE webhooks SET secret = ? WHERE id = ?', [encrypt(secret), webhookId]);
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await recordDelivery(deliveryId, webhookId, event, null, 'not_attempted', reason, null);
    return { deliveryId, webhookId, certainty: 'not_attempted', statusCode: null };
  }

  const signature = createHmac('sha256', plaintextSecret).update(body).digest('hex');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Foundry-Signature': `sha256=${signature}`,
        'X-Foundry-Event': event,
        'X-Foundry-Delivery': deliveryId,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    const certainty = response.ok ? 'provider_acknowledged' : 'provider_rejected';
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

    await recordDelivery(deliveryId, webhookId, event, response.status, certainty,
      response.ok ? null : `HTTP ${response.status}`, null);
    return { deliveryId, webhookId, certainty, statusCode: response.status };
  } catch (err) {
    await query(
      'UPDATE webhooks SET failure_count = failure_count + 1 WHERE id = ?',
      [webhookId]
    );
    const reason = err instanceof Error ? err.message : 'Unknown error';
    const reconcileAfter = new Date(Date.now() + 15 * 60_000).toISOString();
    await recordDelivery(deliveryId, webhookId, event, null, 'ambiguous', reason, reconcileAfter);
    return { deliveryId, webhookId, certainty: 'ambiguous', statusCode: null };
  }
}

async function recordDelivery(
  id: string, webhookId: string, event: WebhookEvent, status: number | null,
  certainty: WebhookDeliveryReceipt['certainty'], error: string | null, reconcileAfter: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await query(
    `INSERT INTO webhook_deliveries
     (id, webhook_id, event, status_code, delivered_at, error, effect_certainty,
      provider_acknowledged_at, reconcile_after)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, webhookId, event, status ?? 0, certainty === 'provider_acknowledged' ? now : null,
      error, certainty, certainty === 'provider_acknowledged' ? now : null, reconcileAfter],
  );
}
