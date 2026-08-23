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
import { requireTier } from '../../middleware/tier-gate.js';
import { encryptCredentialPayload } from '../../services/encryption.js';
import { requireCompanyCapability } from '../../middleware/rbac.js';
import { directionOf } from '../../services/integration/direction.js';

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

integrationsRoutes.get('/integrations', requireTier('integrations'), async (c) => {
  const founder = c.get('founder');
  const ctx = await buildSharedContext(c);
  if (!ctx.product) return c.redirect('/products');

  const existing = await query(
    `SELECT id, type, status, last_synced_at, last_error, COALESCE(error_count, 0) AS error_count
       FROM integrations WHERE product_id = ?`,
    [ctx.product.id],
  );

  // `status`, `last_synced_at` and `last_error` describe this moment and forget
  // everything before it — a successful sync clears the error, so an
  // integration failing four nights in five looked perfectly healthy here. The
  // attempt history was being recorded the whole time and nothing read it.
  const { getSyncHealth, SYNC_HEALTH_WINDOW_DAYS } =
    await import('../../services/integrations/health.js');
  const { MAX_CONSECUTIVE_SYNC_FAILURES } =
    await import('../../services/integrations/sync.js');
  const health = await getSyncHealth(ctx.product.id);

  const connectedTypes = new Map<string, {
    status: string; last_synced_at: string | null; last_error: string | null;
    error_count: number; health: import('../../services/integrations/health.js').SyncHealth | null;
  }>();
  for (const row of existing.rows) {
    const r = row as Record<string, string | number | null>;
    connectedTypes.set(r.type as string, {
      status: r.status as string,
      last_synced_at: r.last_synced_at as string | null,
      last_error: r.last_error as string | null,
      error_count: Number(r.error_count ?? 0),
      health: health.get(String(r.id)) ?? null,
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
        const hasError = connected?.status === 'error' || connected?.status === 'errored';
        // Foundry has stopped retrying this one. Say so, rather than showing the
        // same red badge it showed after the first failure — the two are very
        // different facts, and only one of them needs the founder.
        const givenUp = !!connected && connected.error_count >= MAX_CONSECUTIVE_SYNC_FAILURES;

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
            ${givenUp ? html`<p class="integration-error"><strong>Foundry has stopped syncing this.</strong> ${connected.error_count} syncs failed in a row, so it is no longer being tried. Its data is not updating. Reconnect to start again.</p>` : ''}
            ${hasError && connected?.last_error ? html`<p class="integration-error">${connected.last_error}</p>` : ''}
            ${connected ? html`<p class="integration-sync-history">${
              connected.health === null
                ? html`No sync has been attempted in the last ${SYNC_HEALTH_WINDOW_DAYS} days.`
                : connected.health.failed === 0 && connected.health.unfinished === 0
                  ? html`${connected.health.succeeded} of ${connected.health.attempts} syncs succeeded in the last ${SYNC_HEALTH_WINDOW_DAYS} days.`
                  : html`<span class="integration-sync-history-warn">${connected.health.failed} of ${connected.health.attempts} syncs failed in the last ${SYNC_HEALTH_WINDOW_DAYS} days${connected.health.unfinished > 0 ? html`, and ${connected.health.unfinished} never finished` : ''}.</span>${connected.health.last_success_at ? html` Last success: ${new Date(connected.health.last_success_at).toLocaleDateString()}.` : html` None have succeeded.`}`
            }</p>` : ''}
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

  return c.html(dashboardLayout(ctx, content));
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
        <p>OAuth connection for ${meta.name} isn't available yet. If ${meta.name} offers an API key, use a key-based integration — or connect any MCP-compatible service from the <a href="/connections" style="color:var(--accent);">Connections</a> page.</p>
        <a href="/integrations" class="btn btn-ghost">Back to integrations</a>
      </div>
    `}
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /integrations/:type/connect ────────────────────────────────────────

// Stores a third-party credential against the company. Disconnect stays
// open: it only removes reach.
integrationsRoutes.post('/integrations/:type/connect',
  requireCompanyCapability('can_manage_company'), async (c) => {
  const founder = c.get('founder');
  const type = c.req.param('type') as IntegrationType;
  const meta = INTEGRATION_META[type];
  if (!meta) return c.notFound();

  const ctx = await buildSharedContext(c);
  if (!ctx.product) return c.redirect('/products');

  const body = await c.req.parseBody() as Record<string, string>;

  // The same split the sibling form at /agents/integrations uses. It used to be
  // a literal list here and nothing there, which is how one form encrypted a
  // bot token while the other wrote it to a plaintext column.
  const { splitIntegrationFields } = await import('../../services/integration/fabric.js');
  const submitted: Record<string, unknown> = {};
  for (const field of (meta.fields ?? [])) {
    if (body[field.key]) submitted[field.key] = body[field.key];
  }
  const { config, credentials } = splitIntegrationFields(submitted);

  // Encrypt credentials at rest. config_json stays plaintext — it's
  // non-sensitive (event names, account ids).
  const credentialsCiphertext = encryptCredentialPayload(JSON.stringify(credentials));

  await saveConnectedIntegration({
    productId: ctx.product.id, type, credentialsCiphertext, config,
  });

  return c.redirect('/integrations?connected=' + type);
});

/**
 * Write what this page's connect form was given, and return nothing but the
 * fact that it happened.
 *
 * EXPORTED SO THE WRITER CAN BE RUN RATHER THAN IMITATED. It was inline in the
 * handler, and the first test written for it built its own INSERT that looked
 * like this one — so removing the fix from the handler left the test green.
 * A test that reproduces the writer proves only that the test agrees with
 * itself.
 *
 * 'active', THE SAME VALUE THE UPDATE BRANCH WRITES. The INSERT used to write
 * 'connected', and migration 074 exists because nothing reads that: `sync.ts`
 * selects `status IN ('active','error')`, every adapter in
 * `services/integration/` guards on `status === 'active'`, `framework.ts`
 * selects `WHERE status = 'active'`, and this page's own badge tests it too.
 * So a founder connecting FOR THE FIRST TIME stored their credentials, was
 * redirected to `?connected=<type>`, and read "Not connected" over an
 * integration nothing would ever sync. Reconnecting took the UPDATE branch and
 * worked, which is why it was easy to miss — and why 074's repair was undone
 * one founder at a time.
 *
 * AND `name`, WHICH THIS PAGE NEVER WROTE. It is how the event syncs identify
 * an integration: `getIntegration(productId, name)` matches on it, and all six
 * of sentry/linear/intercom/slack/posthog/github call it that way. With `name`
 * NULL they return `{ synced: 0 }` on their first branch — silently, because
 * "not connected" and "connected but found nothing" are the same return.
 * `sync.ts` matches on `type` instead, so the SAME ROW was visible to one sync
 * and invisible to the other, and which of Foundry's two connect pages a
 * founder used decided whether their integration produced events.
 *
 * Here the two are the same string, because this route's `:type` param IS the
 * provider key. That is not true of every writer — `fabric.ts` and
 * `framework.ts` put a CATEGORY in `type`, `connections.ts` puts a direction —
 * which is why migration 199's repair names the nine values this page can
 * produce instead of copying `type` wholesale.
 */
export async function saveConnectedIntegration(input: {
  productId: string;
  type: string;
  /** `string | null` because `encryptCredentialPayload` returns null for an
   *  empty payload, and this preserves what the inline version stored. */
  credentialsCiphertext: string | null;
  config: Record<string, unknown>;
}): Promise<void> {
  const existing = await query(
    `SELECT id FROM integrations WHERE product_id = ? AND type = ?`,
    [input.productId, input.type],
  );

  if (existing.rows.length > 0) {
    // `name` is set here too, which repairs a row this page created before it
    // started writing one.
    await query(
      `UPDATE integrations SET credentials_json = ?, config_json = ?, status = 'active',
       name = COALESCE(name, ?), provider = COALESCE(provider, ?), direction = ?,
       last_error = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE product_id = ? AND type = ?`,
      [input.credentialsCiphertext, JSON.stringify(input.config), input.type,
       input.type, directionOf(input.type), input.productId, input.type],
    );
    return;
  }

  // `input.type` IS A PROVIDER KEY — that is what this form collects and what
  // `INTEGRATION_META` is keyed by. It goes into `provider` as well now, and
  // the direction that provider actually has goes into `direction`
  // (migration 203). `type` keeps the same value until the retirement commit.
  await query(
    `INSERT INTO integrations (id, product_id, name, provider, type, direction, status, credentials_json, config_json)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    [nanoid(), input.productId, input.type, input.type, input.type, directionOf(input.type),
     input.credentialsCiphertext, JSON.stringify(input.config)],
  );
}

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
