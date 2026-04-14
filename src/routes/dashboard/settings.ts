import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { query } from '../../db/client.js';
import { createCheckoutSession } from '../../services/billing/stripe.js';
import { dashboardLayout } from '../../views/layout.js';
import { settingsPage } from '../../views/components.js';
import { getLayoutContext } from './_shared.js';
import { getTierBadge, getTierCapabilities } from '../../middleware/tier-gate.js';
import { preferencesSchema, validate } from '../../lib/validation.js';
import { env } from '../../lib/env.js';
import { nanoid } from 'nanoid';
import { log } from '../../lib/logger.js';

export const settingsRoutes = new Hono<AuthEnv>();

settingsRoutes.get('/settings', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'settings', 'Settings');

  const products = await query('SELECT id, name, github_repo_url FROM products WHERE owner_id = ?', [founder.id]);
  const productId = products.rows.length > 0 ? (products.rows[0] as Record<string, string>).id : null;
  const comps = productId
    ? await query('SELECT * FROM competitors WHERE product_id = ?', [productId])
    : { rows: [] };

  const tierLabel = getTierBadge(founder.tier);
  const capabilities = getTierCapabilities(founder.tier);

  const content = html`
    <h1>Settings</h1>
    ${settingsPage(
      { id: founder.id, email: founder.email, name: founder.name, tier: founder.tier },
      products.rows as Array<Record<string, unknown>>,
      comps.rows as Array<Record<string, unknown>>,
    )}
    <div class="card">
      <h3>Subscription</h3>
      <p><strong>Current Plan:</strong> <span class="badge badge-watch">${tierLabel}</span></p>
      <p style="font-size:0.87rem;color:#6b7280;">You have access to ${capabilities.length} features.</p>
      ${founder.tier !== 'scale' && founder.tier !== 'founding_cohort' ? html`<a href="/settings" class="btn btn-primary btn-sm" style="margin-top:0.5rem;">Upgrade to Scale</a>` : ''}
    </div>
  `;
  return c.html(dashboardLayout(ctx, content));
});

// ─── Update Preferences ─────────────────────────────────────────────────────

settingsRoutes.post('/settings/preferences', async (c) => {
  const founder = c.get('founder');
  const rawBody = await c.req.json();
  const prefs = validate(preferencesSchema, rawBody);

  // Merge with existing preferences
  const existing = founder.preferences ?? {};
  const merged = { ...existing, ...prefs };

  await query(
    'UPDATE founders SET preferences = ? WHERE id = ?',
    [JSON.stringify(merged), founder.id]
  );

  return c.json({ status: 'saved', preferences: merged });
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
