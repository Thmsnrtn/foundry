// =============================================================================
// FOUNDRY — Agents Actions
// Founder-facing UI to review, approve, and cancel agent-proposed outbound
// actions (emails, Linear tickets, Slack messages, webhooks, etc.)
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import {
  approveAndExecute,
  cancelExecution,
  listPendingExecutions,
} from '../../services/scp/actions/executor.js';
import { getAllTemplates, createTemplate } from '../../services/scp/actions/templates.js';
import { query } from '../../db/client.js';
import type { ActionType } from '../../services/scp/actions/executor.js';
import { requireCompanyCapability } from '../../middleware/rbac.js';

export const agentsActions = new Hono<AuthEnv>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function actionTypeIcon(actionType: string): string {
  switch (actionType) {
    case 'send_email':    return '📧';
    case 'create_ticket': return '🎫';
    case 'post_slack':    return '💬';
    case 'custom_webhook': return '🔗';
    case 'schedule_call': return '📅';
    case 'update_crm':    return '📋';
    default:              return '⚡';
  }
}

function actionTypeLabel(actionType: string): string {
  switch (actionType) {
    case 'send_email':    return 'Email';
    case 'create_ticket': return 'Ticket';
    case 'post_slack':    return 'Slack';
    case 'custom_webhook': return 'Webhook';
    case 'schedule_call': return 'Call';
    case 'update_crm':    return 'CRM';
    default:              return actionType;
  }
}

function statusBadgeStyle(status: string): string {
  switch (status) {
    case 'completed': return 'background:#4ecca322;color:#4ecca3;border:1px solid #4ecca344;';
    case 'failed':    return 'background:#ff6b6b22;color:#ff6b6b;border:1px solid #ff6b6b44;';
    case 'cancelled': return 'background:rgba(255,255,255,0.05);color:var(--text-muted);border:1px solid rgba(255,255,255,0.1);';
    case 'executing': return 'background:#4fc3f722;color:#4fc3f7;border:1px solid #4fc3f744;';
    case 'approved':  return 'background:#ffb34722;color:#ffb347;border:1px solid #ffb34744;';
    default:          return 'background:#ffb34722;color:#ffb347;border:1px solid #ffb34744;';
  }
}

function formatPayloadPreview(payload: Record<string, unknown>): string {
  const lines: string[] = [];
  if (payload.to_email)          lines.push(`To: ${payload.to_email}`);
  if (payload.subject)           lines.push(`Subject: ${payload.subject}`);
  if (payload.body)              lines.push(`Body: ${String(payload.body).slice(0, 120)}${String(payload.body).length > 120 ? '…' : ''}`);
  if (payload.ticket_title)      lines.push(`Title: ${payload.ticket_title}`);
  if (payload.ticket_description) lines.push(`Desc: ${String(payload.ticket_description).slice(0, 120)}${String(payload.ticket_description).length > 120 ? '…' : ''}`);
  if (payload.channel)           lines.push(`Channel: ${payload.channel}`);
  if (payload.text)              lines.push(`Message: ${String(payload.text).slice(0, 120)}${String(payload.text).length > 120 ? '…' : ''}`);
  if (payload.webhook_url)       lines.push(`URL: ${payload.webhook_url}`);
  if (lines.length === 0)        lines.push(JSON.stringify(payload).slice(0, 200));
  return lines.join('\n');
}

function formatResult(result: unknown): string {
  if (!result) return '';
  if (typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (r.note) return String(r.note);
    if (r.identifier) return `Ticket ${r.identifier} created`;
    if (r.url) return String(r.url);
  }
  return JSON.stringify(result).slice(0, 200);
}

// ─── GET /agents/actions ──────────────────────────────────────────────────────

agentsActions.get('/agents/actions', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'agents', 'Action Execution', undefined, c);

  if (!ctx.productId) {
    const content = html`
      <h1 style="margin:0 0 1rem;">Action Execution</h1>
      <div class="card" style="padding:2rem;text-align:center;color:var(--text-muted);">No product selected.</div>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;
  const tab = (c.req.query('tab') as string) || 'pending';

  const [pendingExecutions, recentResult] = await Promise.all([
    listPendingExecutions(productId),
    query(
      `SELECT ae.*, oa.agent_name, oa.rationale
       FROM action_executions ae
       LEFT JOIN outbound_actions oa ON oa.id = ae.outbound_action_id
       WHERE ae.product_id=? AND ae.status IN ('completed','failed','cancelled')
       ORDER BY ae.created_at DESC LIMIT 20`,
      [productId]
    ),
  ]);

  const recentExecutions = recentResult.rows as Array<Record<string, unknown>>;

  const tabStyle = (name: string) => name === tab
    ? 'padding:0.6rem 1.25rem;border-bottom:2px solid var(--accent);color:var(--text-primary);font-weight:600;font-size:0.9rem;text-decoration:none;'
    : 'padding:0.6rem 1.25rem;border-bottom:2px solid transparent;color:var(--text-dim);font-size:0.9rem;text-decoration:none;';

  const pendingItems = pendingExecutions.map((ex) => {
    const icon = actionTypeIcon(ex.action_type);
    const label = actionTypeLabel(ex.action_type);
    const preview = formatPayloadPreview(ex.payload as unknown as Record<string, unknown>);
    const previewLines = preview.split('\n');

    return html`
      <div style="padding:1.25rem;border-bottom:1px solid rgba(255,255,255,0.05);">
        <div style="display:flex;align-items:flex-start;gap:1rem;">
          <!-- Icon -->
          <div style="font-size:1.5rem;line-height:1;flex-shrink:0;padding-top:2px;">${icon}</div>

          <div style="flex:1;min-width:0;">
            <!-- Header row -->
            <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.3rem;flex-wrap:wrap;">
              <span style="font-size:0.72rem;padding:2px 8px;border-radius:99px;background:#ffb34722;color:#ffb347;border:1px solid #ffb34744;">${label}</span>
              ${ex.agent_name ? html`<span style="font-size:0.82rem;font-weight:600;color:var(--text-primary);">${ex.agent_name}</span>` : ''}
              <span style="font-size:0.72rem;color:var(--text-muted);margin-left:auto;">${timeAgo(ex.created_at)}</span>
            </div>

            <!-- Payload preview -->
            <div style="font-size:0.82rem;color:var(--text-dim);line-height:1.6;margin-bottom:0.5rem;background:rgba(255,255,255,0.03);border-radius:4px;padding:0.5rem 0.75rem;border-left:2px solid rgba(255,255,255,0.08);">
              ${previewLines.map((line) => html`<div>${line}</div>`)}
            </div>

            <!-- Rationale -->
            ${ex.rationale ? html`
              <div style="font-size:0.79rem;color:var(--text-muted);margin-bottom:0.75rem;font-style:italic;">
                Rationale: ${ex.rationale}
              </div>
            ` : ''}

            <!-- Actions -->
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
              <form method="POST" action="/agents/actions/${ex.id}/approve" style="display:inline;">
                <button type="submit" class="btn btn-primary" style="font-size:0.8rem;padding:0.35rem 1rem;background:#4ecca3;color:#0d0d1a;border-color:#4ecca3;">
                  Approve &amp; Execute
                </button>
              </form>
              <form method="POST" action="/agents/actions/${ex.id}/cancel" style="display:inline;">
                <button type="submit" class="btn btn-ghost" style="font-size:0.8rem;padding:0.35rem 0.9rem;color:#ff6b6b;border-color:#ff6b6b44;">
                  Cancel
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    `;
  });

  const recentItems = recentExecutions.map((ex) => {
    const icon = actionTypeIcon(ex.action_type as string);
    const label = actionTypeLabel(ex.action_type as string);
    const status = ex.status as string;
    const result = (() => { try { return ex.result_json ? JSON.parse(ex.result_json as string) : null; } catch { return null; } })();
    const resultText = formatResult(result);

    return html`
      <div style="padding:1rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;gap:0.75rem;align-items:flex-start;">
        <div style="font-size:1.25rem;line-height:1;flex-shrink:0;padding-top:2px;opacity:0.7;">${icon}</div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.2rem;flex-wrap:wrap;">
            <span style="font-size:0.72rem;padding:2px 8px;border-radius:99px;${statusBadgeStyle(status)}">${status}</span>
            <span style="font-size:0.79rem;color:var(--text-dim);">${label}</span>
            ${ex.agent_name ? html`<span style="font-size:0.79rem;color:var(--text-muted);">by ${ex.agent_name}</span>` : ''}
            <span style="font-size:0.72rem;color:var(--text-muted);margin-left:auto;">${timeAgo(ex.created_at as string)}</span>
          </div>
          ${resultText ? html`<div style="font-size:0.8rem;color:var(--text-dim);">${resultText}</div>` : ''}
          ${ex.error_message ? html`<div style="font-size:0.79rem;color:#ff6b6b;">${ex.error_message}</div>` : ''}
        </div>
      </div>
    `;
  });

  const content = html`
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1.5rem;">
      <h1 style="margin:0;">Action Execution</h1>
      <div style="display:flex;gap:0.5rem;align-items:center;">
        ${pendingExecutions.length > 0 ? html`<span style="background:#ffb34722;color:#ffb347;padding:2px 10px;border-radius:99px;font-size:0.8rem;">${pendingExecutions.length} pending</span>` : ''}
        <a href="/agents/actions/templates" style="font-size:0.82rem;color:var(--text-muted);text-decoration:none;padding:0.3rem 0.75rem;border:1px solid rgba(255,255,255,0.1);border-radius:4px;">
          Manage Templates
        </a>
      </div>
    </div>

    <div class="card" style="padding:0;overflow:hidden;">
      <!-- Tabs -->
      <div style="display:flex;border-bottom:1px solid rgba(255,255,255,0.08);padding:0 0.25rem;">
        <a href="/agents/actions?tab=pending" style="${tabStyle('pending')}">
          Pending Approval${pendingExecutions.length > 0 ? html` <span style="font-size:0.7rem;background:#ffb347;color:#1a1a2e;padding:1px 6px;border-radius:99px;margin-left:4px;">${pendingExecutions.length}</span>` : ''}
        </a>
        <a href="/agents/actions?tab=history" style="${tabStyle('history')}">Recent History</a>
      </div>

      <!-- Pending Tab -->
      ${tab === 'pending' ? html`
        ${pendingExecutions.length === 0
          ? html`<div style="padding:3rem;text-align:center;color:var(--text-muted);font-size:0.9rem;">No actions pending approval. Agents are waiting for instructions.</div>`
          : pendingItems}
      ` : ''}

      <!-- History Tab -->
      ${tab === 'history' ? html`
        ${recentExecutions.length === 0
          ? html`<div style="padding:3rem;text-align:center;color:var(--text-muted);font-size:0.9rem;">No execution history yet.</div>`
          : recentItems}
      ` : ''}
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /agents/actions/:id/approve ─────────────────────────────────────────

agentsActions.post('/agents/actions/:id/approve',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
    const founder = c.get('founder');
    const id = c.req.param('id');
    const ctx = await getLayoutContext(founder, 'agents', 'Actions', undefined, c);
    if (!ctx.productId) return c.redirect('/agents/actions');
    // Scoped to the company the guard above just authorized, not to ownership.
    // The ownership scope was the only thing keeping a non-owner out, which
    // made approving an outward effect owner-only by accident;
    // `can_trigger_actions` exists to say who may.
    await approveAndExecute(id, founder.id, { scopeProductId: ctx.productId });
    return c.redirect('/agents/actions?tab=history');
  });

// ─── POST /agents/actions/:id/cancel ──────────────────────────────────────────

agentsActions.post('/agents/actions/:id/cancel',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
    const founder = c.get('founder');
    const id = c.req.param('id');
    const ctx = await getLayoutContext(founder, 'agents', 'Actions', undefined, c);
    if (!ctx.productId) return c.redirect('/agents/actions');
    await cancelExecution(id, ctx.productId);
    return c.redirect('/agents/actions?tab=pending');
  });

// ─── GET /agents/actions/templates ────────────────────────────────────────────

agentsActions.get('/agents/actions/templates', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'agents', 'Action Templates', undefined, c);

  if (!ctx.productId) {
    const content = html`
      <h1 style="margin:0 0 1rem;">Action Templates</h1>
      <div class="card" style="padding:2rem;text-align:center;color:var(--text-muted);">No product selected.</div>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const templates = await getAllTemplates(ctx.productId);

  const templateItems = templates.map((t) => {
    const icon = actionTypeIcon(t.action_type);
    const label = actionTypeLabel(t.action_type);
    return html`
      <div style="padding:1rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;gap:0.75rem;align-items:flex-start;">
        <div style="font-size:1.25rem;line-height:1;flex-shrink:0;padding-top:2px;">${icon}</div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.2rem;flex-wrap:wrap;">
            <span style="font-size:0.87rem;font-weight:600;color:var(--text-primary);">${t.name}</span>
            <span style="font-size:0.7rem;padding:2px 8px;border-radius:99px;background:rgba(255,255,255,0.07);color:var(--text-dim);border:1px solid rgba(255,255,255,0.12);">${label}</span>
            <span style="font-size:0.7rem;padding:2px 8px;border-radius:99px;background:rgba(255,255,255,0.04);color:var(--text-muted);border:1px solid rgba(255,255,255,0.08);">${t.integration}</span>
            ${!t.is_active ? html`<span style="font-size:0.7rem;padding:2px 8px;border-radius:99px;background:#ff6b6b22;color:#ff6b6b;border:1px solid #ff6b6b44;">inactive</span>` : ''}
            <span style="font-size:0.72rem;color:var(--text-muted);margin-left:auto;">${timeAgo(t.created_at)}</span>
          </div>
          <div style="font-size:0.79rem;color:var(--text-muted);">
            ${Object.keys(t.template_json).join(', ')}
          </div>
        </div>
      </div>
    `;
  });

  const ACTION_TYPES: ActionType[] = ['send_email', 'create_ticket', 'post_slack', 'schedule_call', 'update_crm', 'custom_webhook'];

  const content = html`
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1.5rem;">
      <div style="display:flex;align-items:center;gap:1rem;">
        <a href="/agents/actions" style="font-size:0.85rem;color:var(--text-muted);text-decoration:none;">← Actions</a>
        <h1 style="margin:0;">Action Templates</h1>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 360px;gap:1.5rem;align-items:start;">
      <!-- Template List -->
      <div class="card" style="padding:0;overflow:hidden;">
        <div style="padding:1rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:0.9rem;font-weight:600;color:var(--text-primary);">Templates (${templates.length})</span>
        </div>
        ${templates.length === 0
          ? html`<div style="padding:3rem;text-align:center;color:var(--text-muted);font-size:0.9rem;">No templates yet. Create your first one.</div>`
          : templateItems}
      </div>

      <!-- Create Template Form -->
      <div class="card" style="padding:1.25rem;">
        <h2 style="margin:0 0 1rem;font-size:1rem;font-weight:600;">New Template</h2>
        <form method="POST" action="/agents/actions/templates" style="display:flex;flex-direction:column;gap:0.75rem;">
          <div>
            <label style="display:block;font-size:0.8rem;color:var(--text-dim);margin-bottom:4px;">Template Name</label>
            <input type="text" name="name" required placeholder="e.g. Customer Save Email"
              style="width:100%;box-sizing:border-box;padding:0.45rem 0.65rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:var(--text-primary);font-size:0.85rem;" />
          </div>
          <div>
            <label style="display:block;font-size:0.8rem;color:var(--text-dim);margin-bottom:4px;">Action Type</label>
            <select name="action_type" required
              style="width:100%;box-sizing:border-box;padding:0.45rem 0.65rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:var(--text-primary);font-size:0.85rem;">
              ${ACTION_TYPES.map((t) => html`<option value="${t}">${actionTypeIcon(t)} ${actionTypeLabel(t)}</option>`)}
            </select>
          </div>
          <div>
            <label style="display:block;font-size:0.8rem;color:var(--text-dim);margin-bottom:4px;">Integration</label>
            <input type="text" name="integration" required placeholder="e.g. slack, linear, resend"
              style="width:100%;box-sizing:border-box;padding:0.45rem 0.65rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:var(--text-primary);font-size:0.85rem;" />
          </div>
          <div>
            <label style="display:block;font-size:0.8rem;color:var(--text-dim);margin-bottom:4px;">Template JSON</label>
            <textarea name="template_json" rows="6" placeholder='{"subject": "Hello {{name}}", "body_template": "Hi {{name}},\n\n..."}'
              style="width:100%;box-sizing:border-box;padding:0.45rem 0.65rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:var(--text-primary);font-size:0.82rem;font-family:monospace;resize:vertical;"></textarea>
            <div style="font-size:0.73rem;color:var(--text-muted);margin-top:4px;">Use &#123;&#123;variable_name&#125;&#125; for placeholders</div>
          </div>
          <button type="submit" class="btn btn-primary" style="margin-top:0.25rem;">Create Template</button>
        </form>
      </div>
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /agents/actions/templates ───────────────────────────────────────────

agentsActions.post('/agents/actions/templates', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'agents', 'Action Templates', undefined, c);

  if (!ctx.productId) {
    return c.redirect('/agents/actions/templates');
  }

  const body = await c.req.parseBody();
  const name = (body.name as string || '').trim();
  const actionType = (body.action_type as ActionType) || 'send_email';
  const integration = (body.integration as string || '').trim();
  const templateJsonRaw = (body.template_json as string || '{}').trim();

  let templateJson: Record<string, unknown> = {};
  try {
    templateJson = JSON.parse(templateJsonRaw) as Record<string, unknown>;
  } catch {
    // Fall back to empty object on invalid JSON
  }

  if (name && integration) {
    await createTemplate(ctx.productId, {
      product_id: ctx.productId,
      name,
      action_type: actionType,
      integration,
      template_json: templateJson,
      is_active: true,
    });
  }

  return c.redirect('/agents/actions/templates');
});
