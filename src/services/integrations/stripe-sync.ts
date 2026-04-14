// =============================================================================
// FOUNDRY — Stripe Revenue Sync
// Automatically ingests MRR data from a founder's Stripe account.
// Connects via OAuth, pulls invoice/subscription data, computes MRR decomposition.
// =============================================================================

import Stripe from 'stripe';
import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
import { encryptToken, getPlaintextToken } from '../../lib/crypto.js';
import { log } from '../../lib/logger.js';
import { dispatchWebhook } from '../../lib/webhooks.js';

/**
 * Generate Stripe Connect OAuth URL for a founder to connect their Stripe account.
 */
export function getStripeConnectUrl(founderId: string, productId: string): string {
  const clientId = process.env.STRIPE_CONNECT_CLIENT_ID;
  const appUrl = process.env.APP_URL ?? 'http://localhost:8080';
  if (!clientId) return '';

  const state = Buffer.from(JSON.stringify({ founderId, productId })).toString('base64url');
  return `https://connect.stripe.com/oauth/authorize?response_type=code&client_id=${clientId}&scope=read_only&state=${state}&redirect_uri=${encodeURIComponent(`${appUrl}/integrations/stripe/callback`)}`;
}

/**
 * Handle Stripe Connect OAuth callback. Exchanges code for access token.
 */
export async function handleStripeOAuthCallback(code: string, state: string): Promise<{ founderId: string; productId: string }> {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', { apiVersion: '2023-10-16' });

  const response = await stripe.oauth.token({
    grant_type: 'authorization_code',
    code,
  });

  const parsed = JSON.parse(Buffer.from(state, 'base64url').toString()) as { founderId: string; productId: string };
  const encryptedToken = encryptToken(response.access_token ?? '');

  // Store the integration
  await query(
    `INSERT INTO integrations (id, founder_id, provider, access_token_encrypted, scope, metadata, active)
     VALUES (?, ?, 'stripe', ?, 'read_only', ?, 1)
     ON CONFLICT (founder_id, provider) DO UPDATE SET
       access_token_encrypted = excluded.access_token_encrypted,
       scope = excluded.scope,
       metadata = excluded.metadata,
       updated_at = CURRENT_TIMESTAMP,
       active = 1`,
    [nanoid(), parsed.founderId, encryptedToken, JSON.stringify({
      stripe_user_id: response.stripe_user_id,
      product_id: parsed.productId,
    })]
  );

  log.info('Stripe integration connected', { founderId: parsed.founderId, stripeUserId: response.stripe_user_id });
  return parsed;
}

/**
 * Sync revenue data from a founder's connected Stripe account.
 * Pulls the last 30 days of invoice data and computes MRR decomposition.
 */
export async function syncStripeRevenue(founderId: string): Promise<void> {
  const integration = await query(
    "SELECT * FROM integrations WHERE founder_id = ? AND provider = 'stripe' AND active = 1",
    [founderId]
  );

  if (integration.rows.length === 0) return;

  const row = integration.rows[0] as Record<string, string>;
  const accessToken = getPlaintextToken(row.access_token_encrypted);
  if (!accessToken) {
    log.warn('Stripe token corrupted for founder', { founderId });
    return;
  }

  const metadata = JSON.parse(row.metadata ?? '{}') as { product_id?: string; stripe_user_id?: string };
  const productId = metadata.product_id;
  if (!productId) return;

  try {
    const stripe = new Stripe(accessToken, { apiVersion: '2023-10-16' });

    // Fetch recent invoices (last 30 days)
    const thirtyDaysAgo = Math.floor((Date.now() - 30 * 86400000) / 1000);
    const invoices = await stripe.invoices.list({
      created: { gte: thirtyDaysAgo },
      limit: 100,
      status: 'paid',
    });

    // Fetch active subscriptions for MRR calculation
    const subscriptions = await stripe.subscriptions.list({
      status: 'active',
      limit: 100,
    });

    // Calculate MRR from active subscriptions
    let currentMrr = 0;
    for (const sub of subscriptions.data) {
      for (const item of sub.items.data) {
        const amount = item.price?.unit_amount ?? 0;
        const interval = item.price?.recurring?.interval;
        if (interval === 'month') currentMrr += amount;
        else if (interval === 'year') currentMrr += Math.round(amount / 12);
      }
    }

    // Fetch churned subscriptions (cancelled in last 30 days)
    const cancelledSubs = await stripe.subscriptions.list({
      status: 'canceled',
      limit: 100,
    });
    let churnedMrr = 0;
    for (const sub of cancelledSubs.data) {
      if (sub.canceled_at && sub.canceled_at >= thirtyDaysAgo) {
        for (const item of sub.items.data) {
          const amount = item.price?.unit_amount ?? 0;
          const interval = item.price?.recurring?.interval;
          if (interval === 'month') churnedMrr += amount;
          else if (interval === 'year') churnedMrr += Math.round(amount / 12);
        }
      }
    }

    // Count new customers (created in last 7 days)
    const sevenDaysAgo = Math.floor((Date.now() - 7 * 86400000) / 1000);
    const newCustomers = await stripe.customers.list({
      created: { gte: sevenDaysAgo },
      limit: 100,
    });

    // Calculate new MRR (subscriptions created in last 30 days)
    let newMrr = 0;
    for (const sub of subscriptions.data) {
      if (sub.created >= thirtyDaysAgo) {
        for (const item of sub.items.data) {
          const amount = item.price?.unit_amount ?? 0;
          const interval = item.price?.recurring?.interval;
          if (interval === 'month') newMrr += amount;
          else if (interval === 'year') newMrr += Math.round(amount / 12);
        }
      }
    }

    const today = new Date().toISOString().split('T')[0];
    const healthRatio = newMrr > 0 ? churnedMrr / newMrr : null;

    // Upsert metric snapshot
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, new_mrr_cents, churned_mrr_cents, signups_7d, active_users, mrr_health_ratio)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (product_id, snapshot_date) DO UPDATE SET
         new_mrr_cents = excluded.new_mrr_cents,
         churned_mrr_cents = excluded.churned_mrr_cents,
         signups_7d = excluded.signups_7d,
         active_users = excluded.active_users,
         mrr_health_ratio = excluded.mrr_health_ratio`,
      [nanoid(), productId, today, newMrr, churnedMrr, newCustomers.data.length, subscriptions.data.length, healthRatio]
    );

    // Dispatch webhook
    const ownerResult = await query('SELECT owner_id FROM products WHERE id = ?', [productId]);
    const ownerId = (ownerResult.rows[0] as Record<string, string>)?.owner_id;
    if (ownerId) {
      dispatchWebhook(ownerId, 'metric.recorded', {
        product_id: productId, source: 'stripe', new_mrr_cents: newMrr, churned_mrr_cents: churnedMrr, active_subscriptions: subscriptions.data.length,
      }).catch(() => {});
    }

    log.info('Stripe revenue synced', { founderId, productId, currentMrr, newMrr, churnedMrr });
  } catch (err) {
    log.error('Stripe revenue sync failed', err, { founderId, productId });
  }
}
