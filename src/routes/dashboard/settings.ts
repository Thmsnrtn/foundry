import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { query } from '../../db/client.js';
import { createCheckoutSession, cancelSubscription } from '../../services/billing/stripe.js';
import { dashboardLayout } from '../../views/layout.js';
import { settingsPage } from '../../views/components.js';
import { getLayoutContext } from './_shared.js';
import { getTierBadge, getTierCapabilities } from '../../middleware/tier-gate.js';
import { preferencesSchema, validate } from '../../lib/validation.js';
import { parseRequestBody, respondWithRedirectOrJson } from '../../lib/request.js';
import { env } from '../../lib/env.js';
import { nanoid } from 'nanoid';
import { log } from '../../lib/logger.js';

export const settingsRoutes = new Hono<AuthEnv>();

settingsRoutes.get('/settings', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'settings', 'Settings', undefined, c);

  const products = await query('SELECT id, name, github_repo_url FROM products WHERE owner_id = ?', [founder.id]);
  const productId = products.rows.length > 0 ? (products.rows[0] as Record<string, string>).id : null;
  const comps = productId
    ? await query('SELECT * FROM competitors WHERE product_id = ?', [productId])
    : { rows: [] };

  const tierLabel = getTierBadge(founder.tier);
  const capabilities = getTierCapabilities(founder.tier);

  const saved = c.req.query('saved') === '1';
  const prefs = founder.preferences ?? {};

  const content = html`
    <h1>Settings</h1>
    ${saved ? html`<div class="feedback-banner feedback-success"><span class="feedback-icon">&#10003;</span><span>Settings saved.</span></div>` : ''}

    ${settingsPage(
      { id: founder.id, email: founder.email, name: founder.name, tier: founder.tier },
      products.rows as Array<Record<string, unknown>>,
      comps.rows as Array<Record<string, unknown>>,
    )}

    <div class="card">
      <h3>Subscription</h3>
      <p><strong>Current Plan:</strong> <span class="status-badge status-blue">${tierLabel}</span></p>
      <p style="font-size:var(--text-sm);color:var(--color-text-muted);">You have access to ${capabilities.length} features.</p>
      ${founder.tier !== 'scale' && founder.tier !== 'founding_cohort' ? html`
        <a href="/settings/integrations" class="btn btn-primary btn-sm" style="margin-top:0.5rem;">Upgrade Plan</a>` : ''}
    </div>

    <div class="card">
      <h3>Preferences</h3>
      <form method="POST" action="/settings/preferences">
        <div class="form-group">
          <label for="digest_time">Digest Delivery Time</label>
          <input type="time" name="digest_time" id="digest_time" value="${prefs.digest_time ?? '09:00'}" />
        </div>
        <div class="form-group">
          <label for="timezone">Timezone</label>
          <select name="timezone" id="timezone">
            ${['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Shanghai', 'Australia/Sydney', 'UTC'].map((tz) => html`
              <option value="${tz}" ${prefs.timezone === tz ? 'selected' : ''}>${tz.replace(/_/g, ' ')}</option>
            `)}
          </select>
        </div>
        <div class="form-group">
          <label>Notification Channels</label>
          <div style="display:flex;gap:1rem;">
            <label style="display:flex;align-items:center;gap:0.35rem;cursor:pointer;font-size:var(--text-sm);">
              <input type="checkbox" name="notification_channels" value="email" ${(prefs.notification_channels ?? ['email']).includes('email') ? 'checked' : ''} /> Email
            </label>
            <label style="display:flex;align-items:center;gap:0.35rem;cursor:pointer;font-size:var(--text-sm);">
              <input type="checkbox" name="notification_channels" value="dashboard" ${(prefs.notification_channels ?? []).includes('dashboard') ? 'checked' : ''} /> Dashboard
            </label>
          </div>
        </div>
        <button type="submit" class="btn btn-primary btn-sm">Save Preferences</button>
      </form>
    </div>

    <div class="card">
      <h3>Integrations &amp; API</h3>
      <p style="font-size:var(--text-sm);color:var(--color-text-secondary);">Connect Stripe, manage API keys, and configure webhooks.</p>
      <a href="/settings/integrations" class="btn btn-secondary btn-sm" style="margin-top:0.5rem;">Manage Integrations</a>
      <a href="/settings/api-docs" class="btn btn-secondary btn-sm" style="margin-top:0.5rem;margin-left:0.5rem;">API Documentation</a>
    </div>

    <div class="card" style="border-top:2px solid var(--color-border);">
      <h3>Data &amp; Privacy</h3>
      <p style="font-size:var(--text-sm);color:var(--color-text-secondary);margin-bottom:0.75rem;">Export your data or request account deletion.</p>
      <div style="display:flex;gap:0.75rem;">
        <form method="POST" action="/settings/export-data">
          <button type="submit" class="btn btn-secondary btn-sm">Export My Data</button>
        </form>
        <form method="POST" action="/settings/request-deletion" onsubmit="return confirm('Are you sure you want to delete your account? This action requires email confirmation and takes 30 days to complete.')">
          <button type="submit" class="btn btn-danger btn-sm">Delete Account</button>
        </form>
      </div>
    </div>
  `;
  return c.html(dashboardLayout(ctx, content));
});

// ─── Update Preferences ─────────────────────────────────────────────────────

settingsRoutes.post('/settings/preferences', async (c) => {
  const founder = c.get('founder');
  const rawBody = await parseRequestBody(c);

  // Handle notification_channels from form checkboxes
  if (typeof rawBody.notification_channels === 'string') {
    rawBody.notification_channels = [rawBody.notification_channels];
  }

  const prefs = validate(preferencesSchema, rawBody);

  // Merge with existing preferences
  const existing = founder.preferences ?? {};
  const merged = { ...existing, ...prefs };

  await query(
    'UPDATE founders SET preferences = ? WHERE id = ?',
    [JSON.stringify(merged), founder.id]
  );

  return respondWithRedirectOrJson(c, '/settings?saved=1', { status: 'saved', preferences: merged });
});

// ─── Create Checkout Session ────────────────────────────────────────────────

settingsRoutes.post('/settings/upgrade', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.json() as { tier: string };

  const tier = body.tier as 'founding_cohort' | 'growth' | 'scale';
  if (!['founding_cohort', 'growth', 'scale'].includes(tier)) {
    return c.json({ error: 'Invalid tier' }, 400);
  }

  if (!founder.stripe_customer_id) {
    return c.json({ error: 'No billing account. Please contact support.' }, 400);
  }

  const appUrl = env().APP_URL;
  const sessionUrl = await createCheckoutSession(
    founder.stripe_customer_id,
    tier,
    `${appUrl}/settings?upgraded=1`,
    `${appUrl}/settings?cancelled=1`,
  );

  return c.json({ checkout_url: sessionUrl });
});

// ─── Data Export (GDPR Article 20) ──────────────────────────────────────────

settingsRoutes.post('/settings/export-data', async (c) => {
  const founder = c.get('founder');

  // Check for existing pending/processing request
  const existing = await query(
    "SELECT id FROM data_export_requests WHERE founder_id = ? AND status IN ('pending', 'processing')",
    [founder.id]
  );
  if (existing.rows.length > 0) {
    return c.json({ error: 'An export request is already in progress.' }, 409);
  }

  const requestId = nanoid();
  await query(
    'INSERT INTO data_export_requests (id, founder_id, status) VALUES (?, ?, ?)',
    [requestId, founder.id, 'pending']
  );

  log.info('Data export requested', { founderId: founder.id, requestId });

  return c.json({
    status: 'requested',
    request_id: requestId,
    message: 'Your data export has been queued. You will receive an email when it is ready.',
  });
});

// ─── Account Deletion (GDPR Article 17) ─────────────────────────────────────

settingsRoutes.post('/settings/request-deletion', async (c) => {
  const founder = c.get('founder');

  // Check for existing pending request
  const existing = await query(
    "SELECT id FROM deletion_requests WHERE founder_id = ? AND status IN ('pending', 'confirmed')",
    [founder.id]
  );
  if (existing.rows.length > 0) {
    return c.json({ error: 'A deletion request is already pending.' }, 409);
  }

  const requestId = nanoid();
  const confirmationToken = nanoid(32);

  await query(
    'INSERT INTO deletion_requests (id, founder_id, status, confirmation_token) VALUES (?, ?, ?, ?)',
    [requestId, founder.id, 'pending', confirmationToken]
  );

  log.info('Account deletion requested', { founderId: founder.id, requestId });

  // In production: send confirmation email with token
  return c.json({
    status: 'pending',
    request_id: requestId,
    message: 'A confirmation email has been sent. You must confirm deletion within 7 days.',
  });
});

settingsRoutes.post('/settings/confirm-deletion', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.json() as { confirmation_token: string };

  const request = await query(
    "SELECT id FROM deletion_requests WHERE founder_id = ? AND confirmation_token = ? AND status = 'pending'",
    [founder.id, body.confirmation_token]
  );

  if (request.rows.length === 0) {
    return c.json({ error: 'Invalid or expired confirmation token.' }, 400);
  }

  const requestId = (request.rows[0] as Record<string, string>).id;

  // Mark as confirmed — actual deletion happens via a scheduled job
  await query(
    "UPDATE deletion_requests SET status = 'confirmed', confirmed_at = ? WHERE id = ?",
    [new Date().toISOString(), requestId]
  );

  log.info('Account deletion confirmed', { founderId: founder.id, requestId });

  return c.json({
    status: 'confirmed',
    message: 'Your account and all associated data will be permanently deleted within 30 days. You can cancel by contacting support.',
  });
});

// ─── AI Usage Summary ───────────────────────────────────────────────────────

settingsRoutes.get('/settings/usage', async (c) => {
  const founder = c.get('founder');
  const products = await query('SELECT id, name FROM products WHERE owner_id = ?', [founder.id]);

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();

  const usageByProduct = await Promise.all(
    (products.rows as unknown as Array<{ id: string; name: string }>).map(async (p) => {
      const result = await query(
        `SELECT
           COALESCE(SUM(input_tokens), 0) as input_tokens,
           COALESCE(SUM(output_tokens), 0) as output_tokens,
           COALESCE(SUM(cache_read_tokens), 0) as cache_tokens,
           COALESCE(SUM(cost_cents), 0) as cost_cents,
           COUNT(*) as calls
         FROM ai_usage_log WHERE product_id = ? AND created_at BETWEEN ? AND ?`,
        [p.id, startOfMonth, endOfMonth]
      );
      const row = (result.rows[0] as Record<string, number>) ?? {};
      return {
        product_id: p.id,
        product_name: p.name,
        input_tokens: row.input_tokens ?? 0,
        output_tokens: row.output_tokens ?? 0,
        cache_tokens: row.cache_tokens ?? 0,
        cost_cents: row.cost_cents ?? 0,
        calls: row.calls ?? 0,
      };
    })
  );

  return c.json({
    period: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    usage: usageByProduct,
    total_cost_cents: usageByProduct.reduce((sum, p) => sum + p.cost_cents, 0),
  });
});

// ─── Cancel Subscription ────────────────────────────────────────────────────

settingsRoutes.post('/settings/cancel-subscription', async (c) => {
  const founder = c.get('founder');

  if (!founder.stripe_customer_id) {
    return respondWithRedirectOrJson(c, '/settings?error=no_subscription', { error: 'No active subscription' }, 400);
  }

  // Find active subscription from Stripe
  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', { apiVersion: '2023-10-16' });
    const subscriptions = await stripe.subscriptions.list({
      customer: founder.stripe_customer_id,
      status: 'active',
      limit: 1,
    });

    if (subscriptions.data.length === 0) {
      return respondWithRedirectOrJson(c, '/settings?error=no_active_subscription', { error: 'No active subscription found' }, 400);
    }

    // Cancel at end of billing period (not immediately)
    await stripe.subscriptions.update(subscriptions.data[0].id, {
      cancel_at_period_end: true,
    });

    log.info('Subscription cancelled at period end', { founderId: founder.id, subscriptionId: subscriptions.data[0].id });

    return respondWithRedirectOrJson(c, '/settings?cancelled=1', {
      status: 'cancelled',
      message: 'Your subscription will end at the end of the current billing period. You retain access until then.',
    });
  } catch (err) {
    log.error('Subscription cancellation failed', err, { founderId: founder.id });
    return respondWithRedirectOrJson(c, '/settings?error=cancel_failed', { error: 'Cancellation failed. Please try again or contact support.' }, 500);
  }
});

// ─── Cancel Deletion Request ────────────────────────────────────────────────

settingsRoutes.post('/settings/cancel-deletion', async (c) => {
  const founder = c.get('founder');

  const result = await query(
    "UPDATE deletion_requests SET status = 'cancelled' WHERE founder_id = ? AND status IN ('pending', 'confirmed')",
    [founder.id]
  );

  log.info('Deletion request cancelled', { founderId: founder.id });
  return respondWithRedirectOrJson(c, '/settings?deletion_cancelled=1', { status: 'cancelled' });
});
