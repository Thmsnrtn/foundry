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
