// =============================================================================
// FOUNDRY — Integrations Dashboard
// Connect and manage external data sources: Stripe, PostHog, Intercom, Linear.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { getProductByOwner, query } from '../../db/client.js';
import { buildSharedContext } from './_shared.js';
import { dashboardLayout } from '../../views/layout.js';
import { nanoid } from 'nanoid';
import type { IntegrationType } from '../../types/index.js';

export const integrationsRoutes = new Hono<AuthEnv>();

const INTEGRATION_META: Record<IntegrationType, {
  name: string;
  description: string;
  icon: string;
  authMethod: 'api_key' | 'oauth' | 'webhook';
  fields?: Array<{ key: string; label: string; placeholder: string; required: boolean }>;
  color: string;
}> = {
  stripe: {
    name: 'Stripe',
    description: 'Sync MRR decomposition, churn events, and subscription changes in real time.',
    icon: '💳',
    authMethod: 'api_key',
    fields: [
      { key: 'access_token', label: 'Stripe Restricted Key', placeholder: 'rk_live_...', required: true },
      { key: 'stripe_account_id', label: 'Connected Account ID (optional)', placeholder: 'acct_...', required: false },
    ],
    color: '#635BFF',
  },
  posthog: {
    name: 'PostHog',
    description: 'Pull activation rates, feature adoption, session depth, and day-30 retention.',
    icon: '🦔',
    authMethod: 'api_key',
    fields: [
      { key: 'api_key', label: 'Private Project API Key', placeholder: 'phx_...', required: true },
      { key: 'project_id', label: 'Project ID', placeholder: '12345', required: true },
      { key: 'activation_event', label: 'Activation Event Name', placeholder: 'user_activated', required: true },
      { key: 'host', label: 'PostHog Host (optional)', placeholder: 'https://app.posthog.com', required: false },
    ],
    color: '#F54E00',
  },
  intercom: {
    name: 'Intercom',
    description: 'Track support volume, NPS from CSAT, and auto-detect support spikes as stressors.',
    icon: '💬',
    authMethod: 'api_key',
    fields: [
      { key: 'access_token', label: 'Access Token', placeholder: 'dG9rO...', required: true },
    ],
    color: '#1F8DED',
  },
  linear: {
    name: 'Linear',
    description: 'Track ship cadence as execution velocity. Push audit blocking issues as Linear issues.',
    icon: '🔷',
    authMethod: 'api_key',
    fields: [
      { key: 'api_key', label: 'Personal API Key', placeholder: 'lin_api_...', required: true },
      { key: 'team_id', label: 'Team ID (optional)', placeholder: 'TEAM-...', required: false },
    ],
    color: '#5E6AD2',
  },
  slack: {
    name: 'Slack',
    description: 'Get risk state changes, critical stressors, and weekly digest in your Slack channel.',
    icon: '💼',
    authMethod: 'oauth',
    color: '#4A154B',
  },
  mixpanel: {
    name: 'Mixpanel',
    description: 'Pull activation and retention metrics from Mixpanel event data.',
    icon: '📊',
    authMethod: 'api_key',
    fields: [
      { key: 'api_key', label: 'Service Account Username', placeholder: 'service-account-...', required: true },
      { key: 'api_secret', label: 'Service Account Password', placeholder: '...', required: true },
      { key: 'project_id', label: 'Project ID', placeholder: '1234567', required: true },
    ],
    color: '#7856FF',
  },
  amplitude: {
    name: 'Amplitude',
    description: 'Sync retention and engagement metrics from Amplitude.',
    icon: '📈',
    authMethod: 'api_key',
    fields: [
      { key: 'api_key', label: 'API Key', placeholder: '...', required: true },
      { key: 'secret_key', label: 'Secret Key', placeholder: '...', required: true },
    ],
    color: '#1BAACC',
  },
  app_store_connect: {
    name: 'App Store Connect',
    description: 'Pull ratings, crash rates, and review sentiment for iOS/macOS apps.',
    icon: '🍎',
    authMethod: 'api_key',
    fields: [
      { key: 'issuer_id', label: 'Issuer ID', placeholder: '...', required: true },
      { key: 'key_id', label: 'Key ID', placeholder: '...', required: true },
      { key: 'private_key', label: 'Private Key (.p8)', placeholder: '-----BEGIN PRIVATE KEY-----...', required: true },
    ],
    color: '#000000',
  },
  github_app: {
    name: 'GitHub (Enhanced)',
    description: 'Upgrade to OAuth for richer commit analytics and ship cadence tracking.',
    icon: '🐙',
    authMethod: 'oauth',
    color: '#24292F',
  },
};

// ─── GET /integrations ────────────────────────────────────────────────────────

integrationsRoutes.get('/integrations', async (c) => {
  const founder = c.get('founder');
  const ctx = await buildSharedContext(c);
  if (!ctx.product) return c.redirect('/products');

  const existing = await query(
    `SELECT type, status, last_synced_at, last_error FROM integrations WHERE product_id = ?`,
    [ctx.product.id],
  );

  const connectedTypes = new Map<string, { status: string; last_synced_at: string | null; last_error: string | null }>();
  for (const row of existing.rows) {
    const r = row as Record<string, string | null>;
    connectedTypes.set(r.type as string, {
      status: r.status as string,
      last_synced_at: r.last_synced_at,
      last_error: r.last_error,
    });
  }

  const content = html`
    <div class="page-header">
      <h1>Integrations</h1>
      <p class="page-subtitle">Connect external data sources so Foundry can update Signal in real time.</p>
    </div>

    <div class="integration-grid">
      ${Object.entries(INTEGRATION_META).map(([type, meta]) => {
        const connected = connectedTypes.get(type);
        const isConnected = connected?.status === 'active';
        const hasError = connected?.status === 'error';

        return html`
          <div class="integration-card ${isConnected ? 'connected' : ''} ${hasError ? 'error' : ''}">
            <div class="integration-header">
              <span class="integration-icon">${meta.icon}</span>
              <div class="integration-title">
                <h3>${meta.name}</h3>
                ${isConnected ? html`<span class="badge badge-green">Connected</span>` :
                  hasError ? html`<span class="badge badge-red">Error</span>` :
                  html`<span class="badge badge-gray">Not connected</span>`}
              </div>
            </div>
            <p class="integration-description">${meta.description}</p>
            ${connected?.last_synced_at ? html`<p class="integration-sync-time">Last synced: ${new Date(connected.last_synced_at).toLocaleDateString()}</p>` : ''}
            ${hasError && connected?.last_error ? html`<p class="integration-error">${connected.last_error}</p>` : ''}
            <div class="integration-actions">
              ${isConnected ? html`
                <form method="POST" action="/integrations/${type}/disconnect">
                  <button type="submit" class="btn btn-ghost btn-sm">Disconnect</button>
                </form>
                <a href="/integrations/${type}/sync" class="btn btn-outline btn-sm">Sync now</a>
              ` : html`
                <a href="/integrations/${type}/connect" class="btn btn-primary btn-sm">Connect</a>
              `}
            </div>
          </div>
        `;
      })}
    </div>
  `;

  return c.html(dashboardLayout(ctx, String(content), 'Integrations'));
});

// ─── GET /integrations/:type/connect ─────────────────────────────────────────

integrationsRoutes.get('/integrations/:type/connect', async (c) => {
  const founder = c.get('founder');
  const type = c.req.param('type') as IntegrationType;
  const meta = INTEGRATION_META[type];
  if (!meta) return c.notFound();

  const ctx = await buildSharedContext(c);
  if (!ctx.product) return c.redirect('/products');

  const content = html`
    <div class="page-header">
      <a href="/integrations" class="back-link">← Integrations</a>
      <h1>Connect ${meta.name}</h1>
      <p class="page-subtitle">${meta.description}</p>
    </div>

    ${meta.authMethod === 'api_key' ? html`
      <form method="POST" action="/integrations/${type}/connect" class="form-card">
        ${(meta.fields ?? []).map((field) => html`
          <div class="form-group">
            <label for="${field.key}">${field.label}${field.required ? '' : ' (optional)'}</label>
            <input type="${field.key.includes('key') || field.key.includes('secret') || field.key.includes('token') ? 'password' : 'text'}"
                   id="${field.key}" name="${field.key}"
                   placeholder="${field.placeholder}"
                   ${field.required ? 'required' : ''} />
          </div>
        `)}
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Connect ${meta.name}</button>
          <a href="/integrations" class="btn btn-ghost">Cancel</a>
        </div>
      </form>
    ` : html`
      <div class="oauth-connect">
        <p>This integration uses OAuth. You'll be redirected to ${meta.name} to authorize access.</p>
        <a href="/integrations/${type}/oauth-start" class="btn btn-primary">Continue to ${meta.name}</a>
      </div>
    `}
  `;

  return c.html(dashboardLayout(ctx, String(content), `Connect ${meta.name}`));
});

// ─── POST /integrations/:type/connect ────────────────────────────────────────

integrationsRoutes.post('/integrations/:type/connect', async (c) => {
  const founder = c.get('founder');
  const type = c.req.param('type') as IntegrationType;
  const meta = INTEGRATION_META[type];
  if (!meta) return c.notFound();

  const ctx = await buildSharedContext(c);
  if (!ctx.product) return c.redirect('/products');

  const body = await c.req.parseBody() as Record<string, string>;

  // Build credentials object from form fields
  const credentials: Record<string, string> = {};
  const config: Record<string, unknown> = {};

  for (const field of (meta.fields ?? [])) {
    if (body[field.key]) {
      // Separate config fields from credential fields
      if (['activation_event', 'active_user_event', 'team_id', 'host', 'account_id'].includes(field.key)) {
        config[field.key] = body[field.key];
      } else {
        credentials[field.key] = body[field.key];
      }
    }
  }

  const existing = await query(
    `SELECT id FROM integrations WHERE product_id = ? AND type = ?`,
    [ctx.product.id, type],
  );

  if (existing.rows.length > 0) {
    await query(
      `UPDATE integrations SET credentials_json = ?, config_json = ?, status = 'active',
       last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE product_id = ? AND type = ?`,
      [JSON.stringify(credentials), JSON.stringify(config), ctx.product.id, type],
    );
  } else {
    await query(
      `INSERT INTO integrations (id, product_id, type, status, credentials_json, config_json)
       VALUES (?, ?, ?, 'active', ?, ?)`,
      [nanoid(), ctx.product.id, type, JSON.stringify(credentials), JSON.stringify(config)],
    );
  }

  return c.redirect('/integrations?connected=' + type);
});

// ─── POST /integrations/:type/disconnect ─────────────────────────────────────

integrationsRoutes.post('/integrations/:type/disconnect', async (c) => {
  const founder = c.get('founder');
  const type = c.req.param('type');
  const ctx = await buildSharedContext(c);
  if (!ctx.product) return c.redirect('/products');

  await query(
    `UPDATE integrations SET status = 'revoked', credentials_json = NULL WHERE product_id = ? AND type = ?`,
    [ctx.product.id, type],
  );

  return c.redirect('/integrations');
});

// ─── GET /integrations/:type/sync ─────────────────────────────────────────────

integrationsRoutes.get('/integrations/:type/sync', async (c) => {
  const founder = c.get('founder');
  const type = c.req.param('type');
  const ctx = await buildSharedContext(c);
  if (!ctx.product) return c.redirect('/products');

  try {
    const { syncProductIntegrations } = await import('../../services/integrations/sync.js');
    await syncProductIntegrations(ctx.product.id);
  } catch (err) {
    console.error('[integrations] manual sync error:', err);
  }

  return c.redirect('/integrations?synced=' + type);
});
