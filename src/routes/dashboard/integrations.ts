// =============================================================================
// FOUNDRY — Integration Management Routes
// Connect external services (Stripe, Slack, etc.) for automatic data flow.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { query, getProductsByOwner } from '../../db/client.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import { getStripeConnectUrl, handleStripeOAuthCallback } from '../../services/integrations/stripe-sync.js';
import { listApiKeys, createApiKey, revokeApiKey } from '../../middleware/api-key.js';
import { listWebhooks, registerWebhook, deleteWebhook, type WebhookEvent } from '../../lib/webhooks.js';
import { z } from 'zod';
import { validate } from '../../lib/validation.js';
import { nanoid } from 'nanoid';
import { randomBytes } from 'crypto';
import { log } from '../../lib/logger.js';

export const integrationRoutes = new Hono<AuthEnv>();

// ─── Integration Hub ────────────────────────────────────────────────────────

integrationRoutes.get('/settings/integrations', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'settings', 'Integrations');
  const products = await getProductsByOwner(founder.id);
  const productId = products.rows.length > 0 ? (products.rows[0] as Record<string, string>).id : null;

  // Check existing integrations
  const integrations = await query('SELECT provider, active, updated_at FROM integrations WHERE founder_id = ?', [founder.id]);
  const connected = new Map((integrations.rows as Array<Record<string, unknown>>).map((r) => [r.provider as string, r]));

  // API Keys
  const apiKeys = await listApiKeys(founder.id);

  // Webhooks
  const webhooks = await listWebhooks(founder.id);

  const stripeUrl = productId ? getStripeConnectUrl(founder.id, productId) : '';

  const content = html`
    <h1>Integrations</h1>

    <!-- Stripe -->
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:start;">
        <div>
          <h3>Stripe</h3>
          <p style="font-size:var(--text-base);color:var(--color-text-secondary);">
            Automatically sync MRR, churn, new customers, and subscription data. No manual entry needed.
          </p>
        </div>
        ${connected.has('stripe')
          ? html`<span class="status-badge status-green">Connected</span>`
          : stripeUrl
            ? html`<a href="${stripeUrl}" class="btn btn-primary btn-sm">Connect Stripe</a>`
            : html`<span class="status-badge status-gray">Configure STRIPE_CONNECT_CLIENT_ID</span>`
        }
      </div>
      ${connected.has('stripe') ? html`
        <div style="margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid var(--color-border-subtle);font-size:var(--text-sm);color:var(--color-text-muted);">
          Revenue data syncs daily at midnight UTC. Last sync: ${(connected.get('stripe') as Record<string, string>)?.updated_at ?? 'Never'}
        </div>` : ''}
    </div>

    <!-- API Keys -->
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
        <h3 style="margin:0;">API Keys</h3>
        <form method="POST" action="/settings/integrations/api-keys" style="display:flex;gap:0.5rem;">
          <input type="text" name="name" placeholder="Key name (e.g. CI Pipeline)" required style="padding:0.35rem 0.75rem;border:1px solid var(--color-border);border-radius:var(--radius-md);font-size:var(--text-sm);" />
          <button type="submit" class="btn btn-secondary btn-sm">Create Key</button>
        </form>
      </div>
      ${apiKeys.length === 0
        ? html`<p style="color:var(--color-text-muted);font-size:var(--text-sm);">No API keys. Create one to integrate with the public REST API.</p>`
        : html`<div style="font-size:var(--text-sm);">
          ${apiKeys.map((k) => html`
            <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0;border-bottom:1px solid var(--color-border-subtle);">
              <div>
                <strong>${k.name}</strong>
                <code style="margin-left:0.5rem;">${k.key_prefix}...</code>
                <span style="color:var(--color-text-faint);margin-left:0.5rem;">Last used: ${k.last_used_at ?? 'Never'}</span>
              </div>
              <form method="POST" action="/settings/integrations/api-keys/${k.id}/revoke" onsubmit="return confirm('Revoke this API key? This cannot be undone.')">
                <button type="submit" class="btn btn-danger btn-sm">Revoke</button>
              </form>
            </div>
          `)}
        </div>`}
      <p style="font-size:var(--text-xs);color:var(--color-text-faint);margin-top:0.75rem;">
        <a href="/settings/api-docs" style="color:var(--color-primary);">View API documentation</a> for endpoint reference and code examples.
      </p>
    </div>

    <!-- Webhooks -->
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
        <h3 style="margin:0;">Webhooks</h3>
      </div>
      <p style="font-size:var(--text-sm);color:var(--color-text-secondary);margin-bottom:1rem;">
        Receive real-time notifications when events occur. All deliveries are signed with HMAC-SHA256.
      </p>

      <form method="POST" action="/settings/integrations/webhooks" style="margin-bottom:1rem;padding:1rem;background:var(--color-bg);border-radius:var(--radius-md);">
        <div class="form-group" style="margin-bottom:0.75rem;">
          <label for="webhook_url">Endpoint URL</label>
          <input type="url" name="url" id="webhook_url" placeholder="https://your-app.com/webhooks/foundry" required />
        </div>
        <div class="form-group" style="margin-bottom:0.75rem;">
          <label>Events</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.35rem;font-size:var(--text-sm);">
            ${(['audit.completed', 'decision.created', 'decision.resolved', 'stressor.identified', 'stressor.resolved', 'risk_state.changed', 'metric.recorded', 'digest.generated', 'remediation.pr_opened', 'remediation.pr_merged'] as WebhookEvent[]).map((e) => html`
              <label style="display:flex;align-items:center;gap:0.35rem;cursor:pointer;">
                <input type="checkbox" name="events" value="${e}" /> ${e}
              </label>
            `)}
          </div>
        </div>
        <button type="submit" class="btn btn-primary btn-sm">Register Webhook</button>
      </form>

      ${webhooks.length > 0 ? html`
        <div style="font-size:var(--text-sm);">
          ${webhooks.map((w) => html`
            <div style="display:flex;justify-content:space-between;align-items:start;padding:0.75rem 0;border-bottom:1px solid var(--color-border-subtle);">
              <div>
                <code style="font-size:var(--text-xs);">${w.url}</code>
                <div style="margin-top:0.25rem;">
                  ${w.events.map((e: string) => html`<span class="status-badge status-blue" style="margin-right:0.25rem;margin-bottom:0.25rem;">${e}</span>`)}
                </div>
                <div style="color:var(--color-text-faint);font-size:var(--text-xs);margin-top:0.25rem;">
                  ${w.failure_count > 0 ? html`<span style="color:var(--color-danger);">${w.failure_count} failures</span> · ` : ''}
                  Last delivery: ${w.last_delivery_at ?? 'Never'}
                </div>
              </div>
              <form method="POST" action="/settings/integrations/webhooks/${w.id}/delete" onsubmit="return confirm('Delete this webhook?')">
                <button type="submit" class="btn btn-danger btn-sm">Delete</button>
              </form>
            </div>
          `)}
        </div>` : ''}
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── Stripe OAuth Callback ──────────────────────────────────────────────────

integrationRoutes.get('/integrations/stripe/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) return c.redirect('/settings/integrations?error=missing_params');

  try {
    const { productId } = await handleStripeOAuthCallback(code, state);
    return c.redirect(`/settings/integrations?connected=stripe`);
  } catch (err) {
    log.error('Stripe OAuth callback failed', err);
    return c.redirect('/settings/integrations?error=stripe_failed');
  }
});

// ─── API Key Management ─────────────────────────────────────────────────────

integrationRoutes.post('/settings/integrations/api-keys', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.parseBody() as Record<string, string>;
  const name = (body.name ?? '').trim();
  if (!name || name.length > 100) return c.redirect('/settings/integrations?error=invalid_name');

  const existing = await listApiKeys(founder.id);
  if (existing.length >= 5) return c.redirect('/settings/integrations?error=max_keys');

  const result = await createApiKey(founder.id, name);

  // Show the key once — redirect with flash
  return c.html(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>API Key Created</title><link rel="stylesheet" href="/static/styles.css"></head><body>
    <header class="site-header"><div class="header-left"><a href="/dashboard" class="logo">Foundry</a></div></header>
    <main class="main-full" style="max-width:600px;">
      <div class="card" style="border-left:3px solid var(--color-success);">
        <h2>API Key Created</h2>
        <p style="color:var(--color-text-secondary);">Copy this key now. It won't be shown again.</p>
        <div style="background:var(--color-sidebar-bg);color:#e8eaf0;padding:1rem;border-radius:var(--radius-md);font-family:var(--font-mono);font-size:var(--text-base);word-break:break-all;margin:1rem 0;">
          ${result.key}
        </div>
        <p style="font-size:var(--text-sm);color:var(--color-text-muted);">Name: ${result.name}</p>
        <a href="/settings/integrations" class="btn btn-primary" style="margin-top:1rem;">Done</a>
      </div>
    </main></body></html>`);
});

integrationRoutes.post('/settings/integrations/api-keys/:id/revoke', async (c) => {
  const founder = c.get('founder');
  const keyId = c.req.param('id');
  await revokeApiKey(keyId, founder.id);
  return c.redirect('/settings/integrations');
});

// ─── Webhook Management ─────────────────────────────────────────────────────

const webhookSchema = z.object({
  url: z.string().url(),
  events: z.union([z.string(), z.array(z.string())]),
});

integrationRoutes.post('/settings/integrations/webhooks', async (c) => {
  const founder = c.get('founder');
  const raw = await c.req.parseBody() as Record<string, unknown>;

  // Events can come as a single string or array from checkboxes
  let events: string[] = [];
  if (Array.isArray(raw.events)) events = raw.events as string[];
  else if (typeof raw.events === 'string') events = [raw.events];

  if (!raw.url || events.length === 0) return c.redirect('/settings/integrations?error=invalid_webhook');

  const secret = randomBytes(32).toString('hex');
  await registerWebhook(founder.id, raw.url as string, events as WebhookEvent[], secret);

  return c.redirect('/settings/integrations?webhook_created=1');
});

integrationRoutes.post('/settings/integrations/webhooks/:id/delete', async (c) => {
  const founder = c.get('founder');
  const webhookId = c.req.param('id');
  await deleteWebhook(webhookId, founder.id);
  return c.redirect('/settings/integrations');
});
