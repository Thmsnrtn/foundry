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

/**
 * THE EVENTS FOUNDRY ACTUALLY SENDS.
 *
 * This list had ten names and three of them were ever dispatched. The other
 * seven — `audit.completed`, `decision.created`, `stressor.identified`,
 * `stressor.resolved`, `digest.generated`, `remediation.pr_opened`,
 * `remediation.pr_merged` — appeared in the type, were accepted by
 * `POST /v1/webhooks` without complaint, and were emitted by nothing. An
 * integrator subscribing to one got a 201 and silence for as long as they
 * waited.
 *
 * A subscription vocabulary is a promise about what will arrive. This one now
 * lists what `dispatchWebhook` is called with, and the API validates against
 * it: a name that is not here is refused, with the list, rather than accepted
 * into a table nothing will ever match.
 *
 * ADDING AN EVENT MEANS DISPATCHING IT. Put the name here in the same change
 * that calls `dispatchWebhook` with it, not before.
 */
export const WEBHOOK_EVENTS = [
  'decision.resolved',
  'metric.recorded',
  'risk_state.changed',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

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
  // MAY FOUNDRY ACT FOR THIS COMPANY AT ALL?
  //
  // There are two webhook paths. `services/distribution/outbound-webhooks.ts`
  // goes through the outbound gateway and inherits the kill switch, the
  // entitlement pause and the audit trail. This one — the customer-facing
  // webhook fan-out, fired on risk-state changes, metric syncs and decision
  // resolutions — reached none of that, so a company whose subscription had
  // lapsed, whose founder had paused it, or whose data had just been erased
  // kept POSTing to its own endpoints.
  //
  // The owner's decision is that an unpaid account is read-only: no spend, no
  // outward effects. A webhook is an outward effect.
  const { checkKillSwitch } = await import('../services/outbound/kill-switch.js');
  const gate = await checkKillSwitch(productId, 'post_webhook');
  if (gate.blocked) {
    log.warn('webhook.refused', { productId, event, reason: gate.reason });
    return [];
  }

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
