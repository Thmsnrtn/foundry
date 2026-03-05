// =============================================================================
// FOUNDRY — Stripe Native Integration
// Direct Stripe API sync: MRR decomposition, subscription events, churn signals.
// Updates metric_snapshots in real time — no waiting for weekly cron.
// =============================================================================

import { query } from '../../db/client.js';
import { invalidateSignalCache } from '../signal.js';
import { nanoid } from 'nanoid';

interface StripeCredentials {
  access_token: string;
  stripe_account_id?: string;
}

interface StripeSubscription {
  id: string;
  status: string;
  plan?: { amount: number; interval: string };
  items?: { data: Array<{ price: { unit_amount: number; recurring?: { interval: string } } }> };
  customer: string;
  current_period_start: number;
  current_period_end: number;
  canceled_at: number | null;
  created: number;
}

interface StripeInvoice {
  id: string;
  subscription: string | null;
  customer: string;
  amount_paid: number;
  amount_due: number;
  status: string;
  billing_reason: string | null;
  period_start: number;
  period_end: number;
  created: number;
}

// ─── Core Sync Function ───────────────────────────────────────────────────────

/**
 * Pull subscription and invoice data from Stripe and update metric_snapshots.
 * Uses incremental sync via the sync_cursor (last invoice created timestamp).
 */
export async function syncStripeMetrics(
  productId: string,
  integrationId: string,
  credentials: StripeCredentials,
  cursor: string | null,
): Promise<{ metricsUpdated: string[]; newCursor: string; recordsProcessed: number }> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${credentials.access_token}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  if (credentials.stripe_account_id) {
    headers['Stripe-Account'] = credentials.stripe_account_id;
  }

  // ── Fetch subscriptions ──────────────────────────────────────────────────
  const activeSubs = await fetchAllStripePages<StripeSubscription>(
    'https://api.stripe.com/v1/subscriptions',
    headers,
    { status: 'active', limit: '100' },
  );

  const canceledSubs = await fetchAllStripePages<StripeSubscription>(
    'https://api.stripe.com/v1/subscriptions',
    headers,
    { status: 'canceled', limit: '100', created: cursor ? `gt:${cursor}` : '' },
  );

  // ── Fetch recent invoices for MRR decomposition ───────────────────────────
  const invoiceParams: Record<string, string> = { limit: '100' };
  if (cursor) invoiceParams['created[gt]'] = cursor;

  const invoices = await fetchAllStripePages<StripeInvoice>(
    'https://api.stripe.com/v1/invoices',
    headers,
    invoiceParams,
  );

  // ── Compute MRR components ────────────────────────────────────────────────
  let newMrrCents = 0;
  let expansionMrrCents = 0;
  let contractionMrrCents = 0;
  let churnedMrrCents = 0;
  const today = new Date().toISOString().slice(0, 10);

  // Active subscriptions → new MRR
  for (const sub of activeSubs) {
    const mrr = getSubscriptionMonthlyCents(sub);
    if (sub.billing_reason_new || isNewThisMonth(sub.created)) {
      newMrrCents += mrr;
    }
  }

  // Canceled subscriptions → churned MRR
  for (const sub of canceledSubs) {
    if (sub.canceled_at && isRecentTimestamp(sub.canceled_at)) {
      churnedMrrCents += getSubscriptionMonthlyCents(sub);
    }
  }

  // Invoices → expansion / contraction signals
  for (const inv of invoices) {
    if (inv.billing_reason === 'subscription_update') {
      if (inv.amount_paid > 0) {
        expansionMrrCents += inv.amount_paid;
      } else if (inv.amount_paid < 0) {
        contractionMrrCents += Math.abs(inv.amount_paid);
      }
    }
  }

  const totalMrr = activeSubs.reduce((sum, s) => sum + getSubscriptionMonthlyCents(s), 0);
  const healthRatio = newMrrCents > 0 ? parseFloat((churnedMrrCents / newMrrCents).toFixed(4)) : null;
  const activeUserCount = activeSubs.length;

  // ── Upsert today's metric snapshot ──────────────────────────────────────
  const columns = [
    'new_mrr_cents', 'churned_mrr_cents', 'expansion_mrr_cents',
    'contraction_mrr_cents', 'active_users',
  ];
  const values = [newMrrCents, churnedMrrCents, expansionMrrCents, contractionMrrCents, activeUserCount];

  if (healthRatio !== null) {
    columns.push('mrr_health_ratio');
    values.push(healthRatio);
  }

  const setClause = columns.map((c) => `${c} = ?`).join(', ');

  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, ${columns.join(', ')})
     VALUES (?, ?, ?, ${columns.map(() => '?').join(', ')})
     ON CONFLICT(product_id, snapshot_date) DO UPDATE SET ${setClause}`,
    [nanoid(), productId, today, ...values, ...values],
  );

  // ── Update integration state ──────────────────────────────────────────────
  const newCursor = String(Math.floor(Date.now() / 1000) - 60); // 1 minute ago
  await query(
    `UPDATE integrations SET last_synced_at = CURRENT_TIMESTAMP, sync_cursor = ?,
     records_synced_total = records_synced_total + ?, last_error = NULL
     WHERE id = ?`,
    [newCursor, activeSubs.length + invoices.length, integrationId],
  );

  invalidateSignalCache(productId);

  return {
    metricsUpdated: columns,
    newCursor,
    recordsProcessed: activeSubs.length + canceledSubs.length + invoices.length,
  };
}

// ─── Stripe Webhook Event Handler ─────────────────────────────────────────────

/**
 * Process a real-time Stripe webhook event for a connected product.
 * Called from the /webhooks/stripe endpoint when the event is integration-linked.
 */
export async function handleStripeIntegrationEvent(
  productId: string,
  eventType: string,
  eventData: Record<string, unknown>,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  if (eventType === 'customer.subscription.deleted') {
    const sub = eventData.object as StripeSubscription;
    const churnedCents = getSubscriptionMonthlyCents(sub);

    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, churned_mrr_cents)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(product_id, snapshot_date) DO UPDATE SET
         churned_mrr_cents = churned_mrr_cents + ?`,
      [nanoid(), productId, today, churnedCents, churnedCents],
    );
    invalidateSignalCache(productId);
  }

  if (eventType === 'customer.subscription.created') {
    const sub = eventData.object as StripeSubscription;
    const newCents = getSubscriptionMonthlyCents(sub);

    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, new_mrr_cents)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(product_id, snapshot_date) DO UPDATE SET
         new_mrr_cents = new_mrr_cents + ?`,
      [nanoid(), productId, today, newCents, newCents],
    );
    invalidateSignalCache(productId);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchAllStripePages<T>(
  baseUrl: string,
  headers: Record<string, string>,
  params: Record<string, string>,
  maxPages = 5,
): Promise<T[]> {
  const results: T[] = [];
  let url = baseUrl;
  let page = 0;

  while (page < maxPages) {
    const queryString = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== ''))
    ).toString();
    const fullUrl = queryString ? `${url}?${queryString}` : url;

    const response = await fetch(fullUrl, { headers });
    if (!response.ok) break;

    const data = await response.json() as { data: T[]; has_more: boolean; data: T[] };
    results.push(...data.data);

    if (!data.has_more) break;
    const lastItem = data.data[data.data.length - 1] as Record<string, unknown>;
    params['starting_after'] = String(lastItem.id);
    page++;
  }

  return results;
}

function getSubscriptionMonthlyCents(sub: StripeSubscription): number {
  // Try items.data first (newer API)
  if (sub.items?.data?.length) {
    const price = sub.items.data[0].price;
    const amount = price.unit_amount ?? 0;
    const interval = price.recurring?.interval ?? 'month';
    return interval === 'year' ? Math.round(amount / 12) : amount;
  }
  // Fall back to plan
  if (sub.plan) {
    const interval = sub.plan.interval ?? 'month';
    return interval === 'year' ? Math.round(sub.plan.amount / 12) : sub.plan.amount;
  }
  return 0;
}

function isNewThisMonth(createdTimestamp: number): boolean {
  const created = new Date(createdTimestamp * 1000);
  const now = new Date();
  return created.getFullYear() === now.getFullYear() && created.getMonth() === now.getMonth();
}

function isRecentTimestamp(timestamp: number): boolean {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return timestamp * 1000 > thirtyDaysAgo;
}
