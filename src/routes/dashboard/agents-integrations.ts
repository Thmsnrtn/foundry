// =============================================================================
// FOUNDRY — Integration Fabric Dashboard Routes
// Integration management UI: connect, disconnect, approve/reject outbound actions.
// =============================================================================

import { Hono } from 'hono';
import { describePrincipal } from '../../services/outbound/acting-principal.js';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { query } from '../../db/client.js';
import {
  getIntegrations,
  getIntegration,
  connectIntegration,
  disconnectIntegration,
  type IntegrationRecord,
} from '../../services/integration/fabric.js';
import {
  getPendingApprovals,
  approveAction,
  rejectAction,
  getActionHistory,
  type OutboundActionRecord,
} from '../../services/outbound/executor.js';
import { handleStripeWebhook } from '../../services/integration/stripe.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import { requireCompanyCapability } from '../../middleware/rbac.js';

export const agentIntegrationRoutes = new Hono<AuthEnv>();

// ─── Supported Integration Metadata ──────────────────────────────────────────

interface IntegrationMeta {
  name: string;
  label: string;
  description: string;
  category: string;
  type: string;
  configFields: Array<{ key: string; label: string; placeholder: string; secret?: boolean }>;
}

const SUPPORTED_INTEGRATIONS: IntegrationMeta[] = [
  {
    name: 'stripe',
    label: 'Stripe',
    description: 'Payment processing — MRR, churn, subscription events',
    category: 'Revenue',
    type: 'inbound',
    configFields: [
      { key: 'webhook_secret', label: 'Webhook Secret', placeholder: 'whsec_...', secret: true },
      { key: 'publishable_key', label: 'Publishable Key', placeholder: 'pk_live_...' },
    ],
  },
  {
    name: 'posthog',
    label: 'PostHog',
    description: 'Product analytics — signups, activation, feature usage',
    category: 'Analytics',
    type: 'inbound',
    configFields: [
      { key: 'api_key', label: 'API Key', placeholder: 'phc_...', secret: true },
      { key: 'host', label: 'Host', placeholder: 'https://app.posthog.com' },
    ],
  },
  {
    name: 'plausible',
    label: 'Plausible',
    description: 'Privacy-first web analytics — traffic, conversions',
    category: 'Analytics',
    type: 'inbound',
    configFields: [
      { key: 'api_key', label: 'API Key', placeholder: 'plausible_key', secret: true },
      { key: 'site_id', label: 'Site ID', placeholder: 'yourdomain.com' },
    ],
  },
  {
    name: 'resend',
    label: 'Resend',
    description: 'Email delivery — send campaigns, drip sequences, notifications',
    category: 'Outbound',
    type: 'outbound',
    configFields: [
      { key: 'api_key', label: 'API Key', placeholder: 're_...', secret: true },
      { key: 'from_domain', label: 'From Domain', placeholder: 'mail.yourapp.com' },
    ],
  },
  {
    name: 'github',
    label: 'GitHub',
    description: 'Code activity — deploys, PRs, issues, release events',
    category: 'Engineering',
    type: 'bidirectional',
    configFields: [
      { key: 'access_token', label: 'Personal Access Token', placeholder: 'ghp_...', secret: true },
      { key: 'org', label: 'Organization', placeholder: 'your-org' },
    ],
  },
  {
    name: 'sentry',
    label: 'Sentry',
    description: 'Error tracking — crashes, performance issues, regressions',
    category: 'Engineering',
    type: 'inbound',
    configFields: [
      { key: 'dsn', label: 'DSN', placeholder: 'https://...@sentry.io/...', secret: true },
      { key: 'org_slug', label: 'Organization Slug', placeholder: 'my-org' },
    ],
  },
  {
    name: 'linear',
    label: 'Linear',
    description: 'Project management — issues, cycles, roadmap sync',
    category: 'Product',
    type: 'bidirectional',
    configFields: [
      { key: 'api_key', label: 'API Key', placeholder: 'lin_api_...', secret: true },
      { key: 'team_id', label: 'Team ID', placeholder: 'your-team-id' },
    ],
  },
];

// ─── View Components ──────────────────────────────────────────────────────────

function statusBadge(status: string) {
  const map: Record<string, string> = {
    active: 'badge-success',
    paused: 'badge-warn',
    errored: 'badge-error',
    pending_auth: 'badge-muted',
    disconnected: 'badge-muted',
  };
  const cls = map[status] ?? 'badge-muted';
  const label = status.replace(/_/g, ' ');
  return html`<span class="badge ${cls}">${label}</span>`;
}

function authorityBadge(level: number) {
  if (level === 0) return html`<span class="badge badge-success">Auto-execute</span>`;
  if (level === 1) return html`<span class="badge badge-warn">1-hour window</span>`;
  return html`<span class="badge badge-error">CEO approval</span>`;
}

function confidenceBar(confidence: number) {
  const pct = Math.round(confidence * 100);
  const cls = pct >= 80 ? 'confidence-high' : pct >= 60 ? 'confidence-mid' : 'confidence-low';
  return html`<div class="confidence-bar">
    <div class="confidence-fill ${cls}" style="width:${pct}%"></div>
    <span class="confidence-label">${pct}%</span>
  </div>`;
}

function integrationCard(meta: IntegrationMeta, record: IntegrationRecord | null, productId: string) {
  const isConnected = record !== null && record.status !== 'disconnected';

  return html`
  <div class="card integration-card ${isConnected ? 'integration-connected' : ''}">
    <div class="integration-header">
      <div>
        <h3 class="integration-name">${meta.label}</h3>
        <span class="badge badge-muted" style="font-size:11px;">${meta.category} · ${meta.type}</span>
      </div>
      <div style="display:flex;gap:0.5rem;align-items:center;">
        ${record ? statusBadge(record.status) : html`<span class="badge badge-muted">not connected</span>`}
      </div>
    </div>

    <p class="text-muted" style="margin:0.5rem 0 0.75rem;">${meta.description}</p>

    ${record && isConnected ? html`
    <div class="integration-stats">
      <div class="stat-item">
        <span class="stat-value">${record.total_inbound_events.toLocaleString()}</span>
        <span class="stat-label">events received</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">${record.total_outbound_actions.toLocaleString()}</span>
        <span class="stat-label">actions taken</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">${record.error_count_trailing_7d}</span>
        <span class="stat-label">errors (7d)</span>
      </div>
      ${record.last_synced_at ? html`
      <div class="stat-item">
        <span class="stat-value" style="font-size:12px;">${record.last_synced_at.slice(0, 16).replace('T', ' ')}</span>
        <span class="stat-label">last sync</span>
      </div>` : ''}
    </div>
    ${record.last_error ? html`
    <div class="alert alert-error" style="margin-top:0.5rem;font-size:12px;">
      Last error: ${record.last_error}
    </div>` : ''}
    ` : ''}

    <div style="margin-top:1rem;display:flex;gap:0.75rem;align-items:flex-start;">
      ${!isConnected ? html`
      <details class="connect-form-toggle">
        <summary class="btn btn-primary btn-sm" style="cursor:pointer;list-style:none;">Connect ${meta.label}</summary>
        <div class="connect-form" style="margin-top:0.75rem;">
          <form method="POST" action="/agents/integrations/${meta.name}/connect">
            <input type="hidden" name="product_id" value="${productId}" />
            ${meta.configFields.map((field) => html`
            <div class="form-group">
              <label class="form-label">${field.label}</label>
              <input
                type="${field.secret ? 'password' : 'text'}"
                name="${field.key}"
                class="form-input"
                placeholder="${field.placeholder}"
              />
            </div>`)}
            <button type="submit" class="btn btn-primary btn-sm">Save &amp; Connect</button>
          </form>
        </div>
      </details>
      ` : html`
      <form method="POST" action="/agents/integrations/${meta.name}/disconnect" style="display:inline;">
        <input type="hidden" name="product_id" value="${productId}" />
        <button type="submit" class="btn btn-secondary btn-sm" onclick="return confirm('Disconnect ${meta.label}?')">
          Disconnect
        </button>
      </form>
      `}
    </div>
  </div>`;
}

function pendingActionCard(action: OutboundActionRecord) {
  const ageMs = Date.now() - new Date(action.created_at).getTime();
  const ageMin = Math.floor(ageMs / 60000);
  const ageLabel = ageMin < 60 ? `${ageMin}m ago` : `${Math.floor(ageMin / 60)}h ago`;

  const expiresLabel = action.expires_at
    ? (() => {
        const ms = new Date(action.expires_at).getTime() - Date.now();
        if (ms < 0) return 'expired';
        const h = Math.floor(ms / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        return h > 0 ? `expires in ${h}h ${m}m` : `expires in ${m}m`;
      })()
    : null;

  return html`
  <div class="card action-card">
    <div class="action-header">
      <div>
        <span class="badge badge-muted" style="font-size:11px;text-transform:uppercase;">${action.integration_name}</span>
        <span class="badge badge-muted" style="font-size:11px;margin-left:0.25rem;">${action.action_type}</span>
        ${authorityBadge(action.authority_level)}
      </div>
      <div class="text-muted" style="font-size:12px;">
        ${action.agent_name} · ${ageLabel}
        ${expiresLabel ? html` · <span style="color:#f59e0b;">${expiresLabel}</span>` : ''}
      </div>
    </div>

    ${action.preview_text ? html`
    <div class="action-preview">
      <strong>Action:</strong> ${action.preview_text}
    </div>` : ''}

    <div class="action-rationale">
      <strong>Why:</strong> ${action.rationale}
    </div>

    <div style="margin-top:0.5rem;display:flex;align-items:center;gap:0.5rem;">
      <span class="text-muted" style="font-size:12px;">Confidence:</span>
      ${confidenceBar(action.confidence)}
    </div>

    <div style="margin-top:1rem;display:flex;gap:0.75rem;">
      <form method="POST" action="/agents/integrations/actions/${action.id}/approve" style="display:inline;">
        <button type="submit" class="btn btn-primary btn-sm">Approve &amp; Execute</button>
      </form>
      <form method="POST" action="/agents/integrations/actions/${action.id}/reject" style="display:inline;">
        <input type="text" name="reason" placeholder="Rejection reason (optional)" class="form-input" style="font-size:12px;padding:4px 8px;width:200px;" />
        <button type="submit" class="btn btn-secondary btn-sm">Reject</button>
      </form>
    </div>
  </div>`;
}

/**
 * Who authorised this, as a person reads it.
 *
 * MOVED, not rewritten. This was the only reader of the principal vocabulary,
 * and it lived on the page for ONE of the two ledgers — so the other ledger's
 * approvals were recorded and never rendered anywhere. It knew about
 * `founder:`, `auto` and `institution:` and nothing about `voice:`,
 * `autopilot:` or `system:`, which is what the other ledger writes.
 *
 * One vocabulary, one reader: `services/outbound/acting-principal.ts`.
 */
const approverText = describePrincipal;

function actionHistoryRow(action: OutboundActionRecord, viewerId: string) {
  const statusMap: Record<string, string> = {
    executed: 'badge-success',
    failed: 'badge-error',
    rejected: 'badge-error',
    cancelled: 'badge-muted',
    pending_approval: 'badge-warn',
    approved: 'badge-warn',
    executing: 'badge-warn',
  };
  const cls = statusMap[action.status] ?? 'badge-muted';

  return html`
  <tr>
    <td style="font-size:12px;">${action.created_at.slice(0, 16).replace('T', ' ')}</td>
    <td><span class="badge badge-muted" style="font-size:11px;">${action.agent_name}</span></td>
    <td>${action.integration_name} / ${action.action_type}</td>
    <td>${action.preview_text ?? action.rationale.slice(0, 60)}</td>
    <td><span class="badge ${cls}">${action.status}</span></td>
    <td style="font-size:12px;">${approverText(action.approved_by, viewerId)}</td>
  </tr>`;
}

// ─── GET /agents/integrations ─────────────────────────────────────────────────

agentIntegrationRoutes.get('/agents/integrations', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'integrations', 'Integrations', undefined, c);

  if (!ctx.productId) {
    const content = html`
      <h1>Integrations</h1>
      <div class="card"><p class="text-muted">No product found. Create a product first.</p></div>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;

  const [integrations, pendingActions, history] = await Promise.all([
    getIntegrations(productId),
    getPendingApprovals(productId),
    getActionHistory(productId, 20),
  ]);

  // Build a map for quick lookup
  const integrationByName = new Map<string, IntegrationRecord>();
  for (const i of integrations) {
    integrationByName.set(i.name, i);
  }

  // Group integrations by category
  const categories = Array.from(new Set(SUPPORTED_INTEGRATIONS.map((i) => i.category)));

  const content = html`
    <div class="section-header">
      <h1>Integration Fabric</h1>
      <span class="text-muted" style="font-size:14px;">${integrations.filter((i) => i.status === 'active').length} of ${SUPPORTED_INTEGRATIONS.length} connected</span>
    </div>

    ${pendingActions.length > 0 ? html`
    <div class="section-header" style="margin-top:1.5rem;">
      <h2 style="color:#f59e0b;">
        Pending Approvals
        <span class="badge badge-error" style="margin-left:0.5rem;font-size:14px;">${pendingActions.length}</span>
      </h2>
      <a href="/agents/integrations/actions" class="btn btn-secondary btn-sm">View all</a>
    </div>
    <div class="card-grid">
      ${pendingActions.slice(0, 3).map((a) => pendingActionCard(a))}
    </div>
    ${pendingActions.length > 3 ? html`
    <div style="margin-top:0.5rem;">
      <a href="/agents/integrations/actions" class="text-link">+ ${pendingActions.length - 3} more pending actions</a>
    </div>` : ''}
    ` : ''}

    ${categories.map((category) => html`
    <div style="margin-top:2rem;">
      <h2 style="font-size:16px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:1rem;">${category}</h2>
      <div class="card-grid">
        ${SUPPORTED_INTEGRATIONS
          .filter((meta) => meta.category === category)
          .map((meta) => integrationCard(meta, integrationByName.get(meta.name) ?? null, productId))}
      </div>
    </div>`)}

    ${history.length > 0 ? html`
    <div style="margin-top:2rem;">
      <h2 style="font-size:16px;font-weight:600;margin-bottom:1rem;">Recent Action History</h2>
      <div class="card" style="padding:0;overflow:hidden;">
        <table class="data-table" style="width:100%;border-collapse:collapse;">
          <thead>
            <tr>
              <th>Time</th>
              <th>Agent</th>
              <th>Action</th>
              <th>Preview</th>
              <th>Status</th>
              <th>Approved by</th>
            </tr>
          </thead>
          <tbody>
            ${history.map((a) => actionHistoryRow(a, String(founder.id)))}
          </tbody>
        </table>
      </div>
    </div>` : ''}
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /agents/integrations/:name/connect ──────────────────────────────────

agentIntegrationRoutes.post('/agents/integrations/:name/connect', async (c) => {
  const founder = c.get('founder');
  const integrationName = c.req.param('name');

  const body = await c.req.parseBody();
  const productId = body.product_id as string;

  if (!productId) return c.redirect('/agents/integrations');

  // A THIRD DOOR ONTO "STORE A CREDENTIAL FOR THIS COMPANY". The other two —
  // /integrations/:type/connect and /connections/add — now ask
  // `can_manage_company`; this one asked whether you owned the company, which
  // is a different question and refused every co-founder who had been invited
  // to manage exactly this.
  //
  // Asked inline rather than in middleware because the company arrives in the
  // REQUEST BODY here. A router guard resolves the company from the path or the
  // selection, so it would have authorized one company while the handler wrote
  // a credential into another. Same predicate, asked where the answer is known.
  const { memberMay } = await import('../../services/team/members.js');
  if (!(await memberMay(productId, founder.id, 'can_manage_company'))) {
    return c.redirect('/agents/integrations');
  }

  // Every submitted field used to go into `config_json` in the clear — api
  // keys, bot tokens and auth tokens included — while the sibling form at
  // /integrations encrypted the same fields into `credentials_json`. The
  // adapters read config_json, so the plaintext path was the one that worked.
  //
  // One shared split now decides, and it is an allow-list of non-secret keys,
  // so a field nobody has classified is encrypted rather than exposed.
  const { splitIntegrationFields } = await import('../../services/integration/fabric.js');
  const submitted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (key !== 'product_id' && typeof value === 'string' && value.trim()) {
      submitted[key] = value.trim();
    }
  }
  const { config, credentials } = splitIntegrationFields(submitted);

  await connectIntegration(productId, integrationName, {
    config_json: config,
    credentials_json: Object.keys(credentials).length ? JSON.stringify(credentials) : undefined,
    authorized_agents: ['all'],
  });

  return c.redirect('/agents/integrations');
});

// ─── POST /agents/integrations/:name/disconnect ───────────────────────────────

agentIntegrationRoutes.post('/agents/integrations/:name/disconnect', async (c) => {
  const founder = c.get('founder');
  const integrationName = c.req.param('name');

  const body = await c.req.parseBody();
  const productId = body.product_id as string;

  if (!productId) return c.redirect('/agents/integrations');

  const prodResult = await query(
    'SELECT id FROM products WHERE id = ? AND owner_id = ?',
    [productId, founder.id],
  );
  if (prodResult.rows.length === 0) return c.redirect('/agents/integrations');

  await disconnectIntegration(productId, integrationName);

  return c.redirect('/agents/integrations');
});

// ─── GET /agents/integrations/actions ────────────────────────────────────────

agentIntegrationRoutes.get('/agents/integrations/actions', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'integrations', 'Pending Actions', undefined, c);

  if (!ctx.productId) {
    const content = html`<h1>Pending Actions</h1><div class="card"><p class="text-muted">No product found.</p></div>`;
    return c.html(dashboardLayout(ctx, content));
  }

  const pending = await getPendingApprovals(ctx.productId);
  const history = await getActionHistory(ctx.productId, 50);

  const content = html`
    <div class="section-header">
      <h1>Outbound Actions</h1>
      <a href="/agents/integrations" class="btn btn-secondary btn-sm">Back to Integrations</a>
    </div>

    <h2 style="margin-top:1.5rem;font-size:16px;font-weight:600;">
      Pending Approval
      ${pending.length > 0 ? html`<span class="badge badge-error" style="margin-left:0.5rem;">${pending.length}</span>` : ''}
    </h2>

    ${pending.length === 0
      ? html`<div class="card"><p class="text-muted">No actions awaiting approval.</p></div>`
      : html`<div class="card-grid">${pending.map((a) => pendingActionCard(a))}</div>`}

    <h2 style="margin-top:2rem;font-size:16px;font-weight:600;">Action History</h2>
    ${history.filter((a) => a.status !== 'pending_approval').length === 0
      ? html`<div class="card"><p class="text-muted">No completed actions yet.</p></div>`
      : html`
      <div class="card" style="padding:0;overflow:hidden;">
        <table class="data-table" style="width:100%;border-collapse:collapse;">
          <thead>
            <tr>
              <th>Time</th>
              <th>Agent</th>
              <th>Action</th>
              <th>Preview</th>
              <th>Status</th>
              <th>Approved by</th>
            </tr>
          </thead>
          <tbody>
            ${history.filter((a) => a.status !== 'pending_approval').map((a) => actionHistoryRow(a, String(founder.id)))}
          </tbody>
        </table>
      </div>`}
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /agents/integrations/actions/:id/approve ───────────────────────────

// A second approval surface for outward integration actions. The actions
// page asks can_trigger_actions; this one did not. Same consequence, same
// question.
agentIntegrationRoutes.post('/agents/integrations/actions/:id/approve',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const actionId = c.req.param('id');

  // Verify ownership — action must belong to a product owned by this founder
  const result = await query(
    `SELECT oa.id FROM outbound_actions oa
     JOIN products p ON p.id = oa.product_id
     WHERE oa.id = ? AND p.owner_id = ?`,
    [actionId, founder.id],
  );
  if (result.rows.length === 0) return c.redirect('/agents/integrations/actions');

  try {
    // WHO APPROVED IT IS A PERSON, NOT A ROLE. This passed the literal 'ceo',
    // so every approval by every founder of every company recorded the same
    // approver. Ownership is verified three lines above and then thrown away;
    // `approved_by` is the field that makes an authorisation attributable, and
    // a constant makes it merely attributed.
    await approveAction(actionId, `founder:${String(founder.id)}`);
  } catch (err) {
    console.error('[Integration] Approve action failed:', err);
  }

  return c.redirect('/agents/integrations/actions');
});

// ─── POST /agents/integrations/actions/:id/reject ────────────────────────────

agentIntegrationRoutes.post('/agents/integrations/actions/:id/reject',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const actionId = c.req.param('id');

  const result = await query(
    `SELECT oa.id FROM outbound_actions oa
     JOIN products p ON p.id = oa.product_id
     WHERE oa.id = ? AND p.owner_id = ?`,
    [actionId, founder.id],
  );
  if (result.rows.length === 0) return c.redirect('/agents/integrations/actions');

  const body = await c.req.parseBody();
  const reason = body.reason as string | undefined;

  await rejectAction(actionId, `founder:${String(founder.id)}`, reason);

  return c.redirect('/agents/integrations/actions');
});

// ─── POST /webhooks/integrations/stripe ──────────────────────────────────────
// No session auth — Stripe calls this directly and authenticates via its
// signature against the per-product webhook secret. Deliberately registered
// under /webhooks/* (rate-limited, unauthenticated); under /agents/* the
// auth+CSRF middleware would make it unreachable for Stripe.

agentIntegrationRoutes.post('/webhooks/integrations/stripe', async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header('stripe-signature') ?? '';

  // Extract product_id from query param or header
  const productId = c.req.query('product_id') ?? c.req.header('x-foundry-product-id') ?? '';
  if (!productId) {
    return c.json({ error: 'product_id required' }, 400);
  }

  // Look up the Stripe webhook secret for this product
  const integration = await getIntegration(productId, 'stripe');
  if (!integration) {
    return c.json({ error: 'Stripe integration not configured' }, 400);
  }

  const webhookSecret = (integration.config_json.webhook_secret as string) ?? '';
  if (!webhookSecret) {
    return c.json({ error: 'Webhook secret not configured' }, 400);
  }

  try {
    const result = await handleStripeWebhook(productId, rawBody, signature, webhookSecret);
    return c.json({ received: true, event_type: result.eventType });
  } catch (err) {
    console.error('[Stripe Webhook] Error:', err);
    return c.json({ error: 'Webhook processing failed' }, 400);
  }
});

/** Exposed for tests. The vocabulary is the load-bearing part: a principal this
 *  does not recognise is shown as-is rather than guessed at. */
export const __approverTextForTest = approverText;
