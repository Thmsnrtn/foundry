// =============================================================================
// FOUNDRY — Stripe Integration Handler
// Normalizes Stripe webhook events and computes revenue metrics from stored events.
// No live Stripe API calls — works entirely from stored integration_events.
// =============================================================================

import { query } from '../../db/client.js';
import { storeEvent } from './fabric.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StripeMRRSummary {
  mrr: number;
  new_customers: number;
  churned_customers: number;
  upgrades: number;
  downgrades: number;
  net_revenue_retention: number;
}

// ─── Webhook Handling ─────────────────────────────────────────────────────────

/**
 * Validate Stripe webhook signature.
 * Implements the Stripe signature verification algorithm without using the Stripe SDK.
 */
async function validateStripeSignature(
  rawBody: string,
  signature: string,
  webhookSecret: string,
): Promise<boolean> {
  try {
    // Parse the signature header: t=timestamp,v1=signature,...
    const parts = signature.split(',');
    let timestamp = '';
    const v1Signatures: string[] = [];

    for (const part of parts) {
      const [key, value] = part.split('=');
      if (key === 't') timestamp = value;
      if (key === 'v1') v1Signatures.push(value);
    }

    if (!timestamp || v1Signatures.length === 0) return false;

    // Reject events older than 5 minutes
    const timeDiff = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
    if (timeDiff > 300) return false;

    // Compute expected signature: HMAC-SHA256(secret, `${timestamp}.${payload}`)
    const signedPayload = `${timestamp}.${rawBody}`;
    const encoder = new TextEncoder();
    const keyData = encoder.encode(webhookSecret);
    const msgData = encoder.encode(signedPayload);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
    const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return v1Signatures.includes(expectedSignature);
  } catch {
    return false;
  }
}

/**
 * Normalize a raw Stripe webhook event to our NormalizedEvent format.
 */
export function normalizeStripeEvent(stripeEvent: Record<string, unknown>): {
  event_type: string;
  actor_type: string;
  actor_id: string;
  data: Record<string, unknown>;
} {
  const eventType = stripeEvent.type as string ?? 'unknown';
  const eventObj = (stripeEvent.data as Record<string, unknown>)?.object as Record<string, unknown> ?? {};

  // Extract actor from the event object
  let actor_type = 'system';
  let actor_id = '';

  if (eventObj.customer) {
    actor_type = 'customer';
    actor_id = eventObj.customer as string;
  } else if (eventObj.id) {
    actor_type = 'stripe_object';
    actor_id = eventObj.id as string;
  }

  // Build normalized data — keep relevant fields from the Stripe object
  const data: Record<string, unknown> = {
    stripe_event_id: stripeEvent.id,
    stripe_event_type: eventType,
    livemode: stripeEvent.livemode,
  };

  // Extract key financial fields based on event type
  if (eventType.startsWith('customer.subscription')) {
    data.subscription_id = eventObj.id;
    data.customer_id = eventObj.customer;
    data.status = eventObj.status;
    data.current_period_end = eventObj.current_period_end;
    data.cancel_at_period_end = eventObj.cancel_at_period_end;
    // Extract plan/price info
    const items = eventObj.items as Record<string, unknown> | undefined;
    if (items) {
      const itemData = (items.data as unknown[]) ?? [];
      if (itemData.length > 0) {
        const firstItem = itemData[0] as Record<string, unknown>;
        const price = firstItem.price as Record<string, unknown> | undefined;
        if (price) {
          data.price_id = price.id;
          data.unit_amount = price.unit_amount;
          data.currency = price.currency;
          data.interval = (price.recurring as Record<string, unknown>)?.interval;
          data.amount_cents = price.unit_amount;
        }
      }
    }
    // Previous attributes for upgrade/downgrade detection
    if (stripeEvent.data && (stripeEvent.data as Record<string, unknown>).previous_attributes) {
      data.previous_attributes = (stripeEvent.data as Record<string, unknown>).previous_attributes;
    }
  } else if (eventType.startsWith('invoice')) {
    data.invoice_id = eventObj.id;
    data.customer_id = eventObj.customer;
    data.subscription_id = eventObj.subscription;
    data.amount_paid = eventObj.amount_paid;
    data.amount_due = eventObj.amount_due;
    data.currency = eventObj.currency;
    data.status = eventObj.status;
    data.period_start = eventObj.period_start;
    data.period_end = eventObj.period_end;
  } else if (eventType.startsWith('payment_intent') || eventType.startsWith('charge')) {
    data.object_id = eventObj.id;
    data.customer_id = eventObj.customer;
    data.amount = eventObj.amount;
    data.currency = eventObj.currency;
    data.status = eventObj.status;
  } else if (eventType.startsWith('customer.')) {
    data.customer_id = eventObj.id;
    data.email = eventObj.email;
    data.name = eventObj.name;
    data.created = eventObj.created;
  }

  return { event_type: eventType, actor_type, actor_id, data };
}

/**
 * Handle a Stripe webhook — validates signature, normalizes, and stores event.
 */
export async function handleStripeWebhook(
  productId: string,
  rawBody: string,
  signature: string,
  webhookSecret: string,
): Promise<{ success: boolean; eventType: string }> {
  const isValid = await validateStripeSignature(rawBody, signature, webhookSecret);
  if (!isValid) {
    throw new Error('Invalid Stripe webhook signature');
  }

  let stripeEvent: Record<string, unknown>;
  try {
    stripeEvent = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    throw new Error('Invalid JSON in webhook body');
  }

  const normalized = normalizeStripeEvent(stripeEvent);

  await storeEvent(productId, {
    integration_name: 'stripe',
    event_type: normalized.event_type,
    actor_type: normalized.actor_type,
    actor_id: normalized.actor_id,
    data: normalized.data,
  });

  return { success: true, eventType: normalized.event_type };
}

// ─── Metrics from Stored Events ───────────────────────────────────────────────

/**
 * Query a specific Stripe metric from stored integration_events.
 */
export async function queryStripeMetrics(
  productId: string,
  query_params: {
    metric: 'mrr' | 'churn_rate' | 'new_revenue' | 'churned_revenue';
    period_days: number;
  },
): Promise<number> {
  const since = new Date(Date.now() - query_params.period_days * 24 * 60 * 60 * 1000).toISOString();

  switch (query_params.metric) {
    case 'mrr': {
      // Sum active subscription amounts from subscription.updated events
      const result = await query(
        `SELECT data_json FROM integration_events
         WHERE product_id = ? AND integration_name = 'stripe'
           AND event_type IN ('customer.subscription.created', 'customer.subscription.updated')
           AND created_at >= ?
         ORDER BY created_at DESC`,
        [productId, since],
      );

      // Use a map to get the latest status per subscription
      const latestBySubscription = new Map<string, Record<string, unknown>>();
      for (const row of result.rows) {
        const r = row as Record<string, unknown>;
        let data: Record<string, unknown> = {};
        try { data = JSON.parse(r.data_json as string || '{}'); } catch { /* ignore */ }
        const subId = data.subscription_id as string;
        if (subId && !latestBySubscription.has(subId)) {
          latestBySubscription.set(subId, data);
        }
      }

      let mrrCents = 0;
      for (const data of latestBySubscription.values()) {
        if (data.status === 'active' || data.status === 'trialing') {
          const amountCents = (data.amount_cents as number) ?? 0;
          const interval = data.interval as string;
          // Normalize to monthly
          if (interval === 'year') {
            mrrCents += amountCents / 12;
          } else {
            mrrCents += amountCents;
          }
        }
      }

      return Math.round(mrrCents / 100); // Return in dollars
    }

    case 'new_revenue': {
      const result = await query(
        `SELECT data_json FROM integration_events
         WHERE product_id = ? AND integration_name = 'stripe'
           AND event_type = 'invoice.payment_succeeded'
           AND created_at >= ?`,
        [productId, since],
      );

      let total = 0;
      for (const row of result.rows) {
        const r = row as Record<string, unknown>;
        let data: Record<string, unknown> = {};
        try { data = JSON.parse(r.data_json as string || '{}'); } catch { /* ignore */ }
        total += (data.amount_paid as number) ?? 0;
      }

      return Math.round(total / 100);
    }

    case 'churned_revenue': {
      const result = await query(
        `SELECT data_json FROM integration_events
         WHERE product_id = ? AND integration_name = 'stripe'
           AND event_type IN ('customer.subscription.deleted', 'customer.subscription.updated')
           AND created_at >= ?`,
        [productId, since],
      );

      let total = 0;
      for (const row of result.rows) {
        const r = row as Record<string, unknown>;
        let data: Record<string, unknown> = {};
        try { data = JSON.parse(r.data_json as string || '{}'); } catch { /* ignore */ }
        if (data.status === 'canceled' || data.stripe_event_type === 'customer.subscription.deleted') {
          total += (data.amount_cents as number) ?? 0;
        }
      }

      return Math.round(total / 100);
    }

    case 'churn_rate': {
      const newRevenue = await queryStripeMetrics(productId, { metric: 'new_revenue', period_days: query_params.period_days });
      const churnedRevenue = await queryStripeMetrics(productId, { metric: 'churned_revenue', period_days: query_params.period_days });
      if (newRevenue === 0) return 0;
      return Math.round((churnedRevenue / (newRevenue + churnedRevenue)) * 100) / 100;
    }

    default:
      return 0;
  }
}

/**
 * Get MRR summary from stored Stripe events (last 30 days).
 */
export async function getStripeMRRSummary(productId: string): Promise<StripeMRRSummary> {
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Fetch all relevant stripe events in the last 30 days
  const result = await query(
    `SELECT event_type, data_json FROM integration_events
     WHERE product_id = ? AND integration_name = 'stripe' AND created_at >= ?
     ORDER BY created_at ASC`,
    [productId, since30d],
  );

  let mrr = 0;
  let new_customers = 0;
  let churned_customers = 0;
  let upgrades = 0;
  let downgrades = 0;
  let starting_mrr = 0;
  let churned_mrr = 0;

  for (const row of result.rows) {
    const r = row as Record<string, unknown>;
    const eventType = r.event_type as string;
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(r.data_json as string || '{}'); } catch { /* ignore */ }

    const amountCents = (data.amount_cents as number) ?? 0;
    const interval = data.interval as string;
    const normalizedMonthly = interval === 'year' ? amountCents / 12 : amountCents;

    if (eventType === 'customer.subscription.created') {
      mrr += normalizedMonthly;
      new_customers += 1;
    } else if (eventType === 'customer.subscription.deleted') {
      mrr -= normalizedMonthly;
      churned_customers += 1;
      churned_mrr += normalizedMonthly;
    } else if (eventType === 'customer.subscription.updated') {
      const prevAttrs = data.previous_attributes as Record<string, unknown> | undefined;
      if (prevAttrs) {
        // Detect upgrade vs downgrade based on amount change
        const prevItems = prevAttrs.items as Record<string, unknown> | undefined;
        if (prevItems) {
          const prevData = (prevItems.data as unknown[]) ?? [];
          if (prevData.length > 0) {
            const prevFirst = prevData[0] as Record<string, unknown>;
            const prevPrice = prevFirst.price as Record<string, unknown> | undefined;
            const prevAmount = prevPrice ? (prevPrice.unit_amount as number) ?? 0 : 0;
            if (normalizedMonthly > prevAmount) upgrades += 1;
            else if (normalizedMonthly < prevAmount) downgrades += 1;
          }
        }
      }
    }
  }

  // starting_mrr estimate: mrr before this period
  starting_mrr = mrr > 0 ? mrr - (new_customers * (mrr / Math.max(new_customers + churned_customers, 1))) : 0;

  const net_revenue_retention = starting_mrr > 0
    ? Math.round(((mrr - churned_mrr) / starting_mrr) * 100) / 100
    : 1.0;

  return {
    mrr: Math.round(mrr / 100),
    new_customers,
    churned_customers,
    upgrades,
    downgrades,
    net_revenue_retention,
  };
}
