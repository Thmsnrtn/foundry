// =============================================================================
// FOUNDRY — Execution Playbooks
// Founder-facing UI to create and manage standing-order playbooks.
// Rules evaluate automatically on every agent run; actions fire without
// per-execution approval when auto_execute=true AND the company's autonomy
// for that capability permits it (see `autoExecuteVerdict`).
//
// APPROVING ONE ACTION NEEDED `can_trigger_actions`; WRITING THE STANDING
// ORDER THAT APPROVES ACTIONS FOREVER NEEDED NOTHING. Every mutating route
// here creates, arms, disarms or fires outward effects, so every one of them
// asks the same capability the one-off approval asks. Reading is left open:
// anyone who can see the company can see what it has standing orders to do,
// and hiding that from a member would make the machine less legible, not
// safer.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import {
  createExecutionPlaybook,
  listExecutionPlaybooks,
  evaluatePlaybooksForProduct,
  togglePlaybook,
  deletePlaybook,
  getTriggerLog,
  getWeeklyExecutionCounts,
  autoExecuteVerdict,
  playbookCapability,
} from '../../services/scp/playbooks/execution-engine.js';
import type { AutoExecuteVerdict } from '../../services/scp/playbooks/execution-engine.js';
import { requireCompanyCapability } from '../../middleware/rbac.js';

export const executionPlaybooks = new Hono<AuthEnv>();

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

function triggerTypeLabel(t: string): string {
  switch (t) {
    case 'metric_threshold': return 'Metric Threshold';
    case 'agent_signal':     return 'Agent Signal';
    case 'schedule':         return 'Schedule';
    case 'manual':           return 'Manual';
    default:                 return t;
  }
}

function actionTypeLabel(t: string): string {
  switch (t) {
    case 'send_email':     return 'Send Email';
    case 'create_ticket':  return 'Create Ticket';
    case 'post_slack':     return 'Post Slack';
    case 'custom_webhook': return 'Custom Webhook';
    case 'mcp_tool':       return 'Connected Tool';
    default:               return t;
  }
}

function resultBadgeStyle(result: string): string {
  switch (result) {
    case 'triggered':      return 'background:#4ecca322;color:#4ecca3;border:1px solid #4ecca344;';
    case 'skipped':        return 'background:rgba(255,255,255,0.05);color:var(--text-muted);border:1px solid rgba(255,255,255,0.1);';
    case 'budget_exceeded': return 'background:#ffb34722;color:#ffb347;border:1px solid #ffb34744;';
    case 'held_for_approval': return 'background:#7aa2f722;color:#7aa2f7;border:1px solid #7aa2f744;';
    default:               return 'background:rgba(255,255,255,0.05);color:var(--text-muted);border:1px solid rgba(255,255,255,0.1);';
  }
}

/** The reason a requested auto-execute will not fire, or null if it will.
 *  Narrowing in a template literal is unreadable; narrowing here is not. */
function heldReason(v: AutoExecuteVerdict | undefined): string | null {
  return v && !v.allowed ? v.reason : null;
}

const INPUT_STYLE = 'width:100%;box-sizing:border-box;padding:0.45rem 0.65rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:var(--text-primary);font-size:0.85rem;';
const SELECT_STYLE = INPUT_STYLE;
const LABEL_STYLE = 'display:block;font-size:0.8rem;color:var(--text-dim);margin-bottom:4px;';

// ─── GET /playbooks/execution ─────────────────────────────────────────────────

executionPlaybooks.get('/playbooks/execution', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'agents', 'Execution Playbooks', undefined, c);

  if (!ctx.productId) {
    const content = html`
      <h1 style="margin:0 0 1rem;">Execution Playbooks</h1>
      <div class="card" style="padding:2rem;text-align:center;color:var(--text-muted);">No product selected.</div>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;
  const flash = c.req.query('triggered');

  const [playbooks, weeklyCounts] = await Promise.all([
    listExecutionPlaybooks(productId),
    getWeeklyExecutionCounts(productId),
  ]);

  // A BADGE THAT SAYS "Auto-execute" WHEN NOTHING WILL AUTO-EXECUTE IS A LIE
  // THE FOUNDER PLANS AROUND. The checkbox records what they asked for; the
  // ladder, the platform cap and the consent ledger decide what happens. Show
  // the second thing, and say which of the three is holding it.
  const verdicts = new Map<string, Awaited<ReturnType<typeof autoExecuteVerdict>>>();
  await Promise.all(playbooks.filter((p) => p.auto_execute).map(async (p) => {
    verdicts.set(p.id, await autoExecuteVerdict(productId, p.action_type));
  }));

  const playbookItems = playbooks.map((p) => {
    const weeklyCount = weeklyCounts[p.id] ?? 0;
    const budgetLabel = p.execution_budget_weekly !== null
      ? `${weeklyCount}/${p.execution_budget_weekly} this week`
      : `${weeklyCount} this week`;
    const budgetOver = p.execution_budget_weekly !== null && weeklyCount >= p.execution_budget_weekly;

    return html`
      <div style="padding:1.25rem;border-bottom:1px solid rgba(255,255,255,0.05);">
        <div style="display:flex;align-items:flex-start;gap:1rem;">
          <div style="flex:1;min-width:0;">
            <!-- Header -->
            <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.35rem;flex-wrap:wrap;">
              <span style="font-size:0.9rem;font-weight:600;color:var(--text-primary);">${p.name}</span>
              <span style="font-size:0.7rem;padding:2px 8px;border-radius:99px;background:rgba(255,255,255,0.07);color:var(--text-dim);border:1px solid rgba(255,255,255,0.12);">${triggerTypeLabel(p.trigger_type)}</span>
              <span style="font-size:0.7rem;padding:2px 8px;border-radius:99px;background:rgba(255,255,255,0.07);color:var(--text-dim);border:1px solid rgba(255,255,255,0.12);">${actionTypeLabel(p.action_type)}</span>
              ${!p.auto_execute
                ? html`<span style="font-size:0.7rem;padding:2px 8px;border-radius:99px;background:#ffb34722;color:#ffb347;border:1px solid #ffb34744;">Needs approval</span>`
                : verdicts.get(p.id)?.allowed
                  ? html`<span style="font-size:0.7rem;padding:2px 8px;border-radius:99px;background:#4ecca322;color:#4ecca3;border:1px solid #4ecca344;">Auto-executes</span>`
                  : html`<span title="${heldReason(verdicts.get(p.id)) ?? ''}" style="font-size:0.7rem;padding:2px 8px;border-radius:99px;background:#7aa2f722;color:#7aa2f7;border:1px solid #7aa2f744;">Auto-execute asked — held</span>`}
              ${!p.is_active
                ? html`<span style="font-size:0.7rem;padding:2px 8px;border-radius:99px;background:rgba(255,255,255,0.04);color:var(--text-muted);border:1px solid rgba(255,255,255,0.08);">Inactive</span>`
                : ''}
              <span style="font-size:0.72rem;color:${budgetOver ? '#ff6b6b' : 'var(--text-muted)'};margin-left:auto;">${budgetLabel}</span>
            </div>

            ${heldReason(verdicts.get(p.id))
              ? html`<div style="font-size:0.78rem;color:#7aa2f7;margin-bottom:0.4rem;">Waiting for approval each time: ${heldReason(verdicts.get(p.id))}. Grant it under <a href="/controls" style="color:#7aa2f7;">Controls → ${playbookCapability(p.action_type)}</a>.</div>`
              : ''}

            <!-- Description / Conditions -->
            ${p.description ? html`<div style="font-size:0.82rem;color:var(--text-dim);margin-bottom:0.35rem;">${p.description}</div>` : ''}

            <div style="font-size:0.79rem;color:var(--text-muted);margin-bottom:0.75rem;">
              ${p.trigger_config.conditions.map((cond) =>
                html`<span style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:3px;padding:1px 6px;margin-right:4px;font-family:monospace;">${cond.metric ?? '?'} ${cond.operator} ${cond.value}</span>`
              )}
              ${p.trigger_config.conditions.length > 1
                ? html`<span style="font-size:0.72rem;color:var(--text-muted);">(${p.trigger_config.logic})</span>`
                : ''}
            </div>

            <!-- Last triggered -->
            ${p.last_triggered_at
              ? html`<div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.5rem;">Last triggered: ${timeAgo(p.last_triggered_at)}</div>`
              : html`<div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.5rem;">Never triggered</div>`}

            <!-- Actions -->
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
              <form method="POST" action="/playbooks/execution/${p.id}/toggle" style="display:inline;">
                <input type="hidden" name="active" value="${p.is_active ? '0' : '1'}" />
                <button type="submit" class="btn btn-ghost" style="font-size:0.78rem;padding:0.3rem 0.8rem;">
                  ${p.is_active ? 'Disable' : 'Enable'}
                </button>
              </form>
              <form method="POST" action="/playbooks/execution/${p.id}/delete" style="display:inline;" onsubmit="return confirm('Delete this playbook?')">
                <button type="submit" class="btn btn-ghost" style="font-size:0.78rem;padding:0.3rem 0.8rem;color:#ff6b6b;border-color:#ff6b6b44;">
                  Delete
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    `;
  });

  const content = html`
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1.5rem;">
      <h1 style="margin:0;">Execution Playbooks</h1>
      <div style="display:flex;gap:0.5rem;align-items:center;">
        <a href="/playbooks/execution/log" style="font-size:0.82rem;color:var(--text-muted);text-decoration:none;padding:0.3rem 0.75rem;border:1px solid rgba(255,255,255,0.1);border-radius:4px;">
          Trigger Log
        </a>
        <form method="POST" action="/playbooks/execution/evaluate" style="display:inline;">
          <button type="submit" class="btn btn-ghost" style="font-size:0.82rem;padding:0.3rem 0.75rem;">
            Run Evaluation
          </button>
        </form>
        <a href="/playbooks/execution/new" class="btn btn-primary" style="font-size:0.82rem;padding:0.35rem 1rem;text-decoration:none;">
          + New Playbook
        </a>
      </div>
    </div>

    ${flash ? html`
      <div style="margin-bottom:1rem;padding:0.75rem 1rem;border-radius:6px;background:#4ecca322;color:#4ecca3;border:1px solid #4ecca344;font-size:0.87rem;">
        Evaluation complete: ${flash} playbook(s) triggered.
      </div>
    ` : ''}

    <div class="card" style="padding:0;overflow:hidden;">
      <div style="padding:1rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:0.9rem;font-weight:600;color:var(--text-primary);">Standing Orders (${playbooks.length})</span>
        <span style="font-size:0.79rem;color:var(--text-muted);">Evaluated on every agent run</span>
      </div>
      ${playbooks.length === 0
        ? html`<div style="padding:3rem;text-align:center;color:var(--text-muted);font-size:0.9rem;">No playbooks yet. Create your first standing order.</div>`
        : playbookItems}
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── GET /playbooks/execution/new ─────────────────────────────────────────────

executionPlaybooks.get('/playbooks/execution/new', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'agents', 'New Execution Playbook', undefined, c);

  const content = html`
    <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem;">
      <a href="/playbooks/execution" style="font-size:0.85rem;color:var(--text-muted);text-decoration:none;">← Playbooks</a>
      <h1 style="margin:0;">New Execution Playbook</h1>
    </div>

    <div style="max-width:640px;">
      <div class="card" style="padding:1.5rem;">
        <form method="POST" action="/playbooks/execution" style="display:flex;flex-direction:column;gap:1rem;">

          <!-- Name -->
          <div>
            <label style="${LABEL_STYLE}">Playbook Name</label>
            <input type="text" name="name" required placeholder="e.g. Low NPS Support Ticket"
              style="${INPUT_STYLE}" />
          </div>

          <!-- Description -->
          <div>
            <label style="${LABEL_STYLE}">Description (optional)</label>
            <input type="text" name="description" placeholder="What does this playbook do?"
              style="${INPUT_STYLE}" />
          </div>

          <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:0.25rem 0;" />
          <h2 style="margin:0;font-size:0.95rem;font-weight:600;color:var(--text-primary);">Trigger</h2>

          <!-- Trigger Type -->
          <div>
            <label style="${LABEL_STYLE}">Trigger Type</label>
            <select name="trigger_type" required style="${SELECT_STYLE}">
              <option value="metric_threshold">Metric Threshold</option>
              <option value="agent_signal">Agent Signal</option>
              <option value="schedule">Schedule</option>
              <option value="manual">Manual</option>
            </select>
          </div>

          <!-- Condition Logic -->
          <div>
            <label style="${LABEL_STYLE}">Condition Logic</label>
            <select name="condition_logic" style="${SELECT_STYLE}">
              <option value="AND">AND — all conditions must be true</option>
              <option value="OR">OR — any condition is enough</option>
            </select>
          </div>

          <!-- Condition 1 -->
          <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:1rem;">
            <div style="font-size:0.8rem;color:var(--text-dim);margin-bottom:0.75rem;font-weight:600;">Condition</div>
            <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:0.5rem;align-items:end;">
              <div>
                <label style="${LABEL_STYLE}">Metric</label>
                <select name="cond_metric" style="${SELECT_STYLE}">
                  <option value="nps">NPS Score</option>
                  <option value="churn_rate">Churn Rate</option>
                  <option value="mrr">New MRR (cents)</option>
                  <option value="active_users">Active Users</option>
                  <option value="signups_7d">Signups (7d)</option>
                  <option value="activation_rate">Activation Rate</option>
                  <option value="day_30_retention">Day-30 Retention</option>
                  <option value="support_volume_7d">Support Volume (7d)</option>
                  <option value="mrr_health_ratio">MRR Health Ratio</option>
                </select>
              </div>
              <div>
                <label style="${LABEL_STYLE}">Operator</label>
                <select name="cond_operator" style="${SELECT_STYLE}">
                  <option value="lt">&lt;</option>
                  <option value="lte">&lt;=</option>
                  <option value="gt">&gt;</option>
                  <option value="gte">&gt;=</option>
                  <option value="eq">=</option>
                </select>
              </div>
              <div>
                <label style="${LABEL_STYLE}">Value</label>
                <input type="number" name="cond_value" required placeholder="e.g. 7" step="any"
                  style="${INPUT_STYLE}" />
              </div>
            </div>
            <div style="margin-top:0.5rem;">
              <label style="${LABEL_STYLE}">Filter (optional, e.g. mrr_gt_500)</label>
              <input type="text" name="cond_filter" placeholder="Optional segment filter"
                style="${INPUT_STYLE}" />
            </div>
          </div>

          <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:0.25rem 0;" />
          <h2 style="margin:0;font-size:0.95rem;font-weight:600;color:var(--text-primary);">Action</h2>

          <!-- Action Type -->
          <div>
            <label style="${LABEL_STYLE}">Action Type</label>
            <select name="action_type" required style="${SELECT_STYLE}">
              <option value="create_ticket">Create Ticket (Linear)</option>
              <option value="post_slack">Post Slack Message</option>
              <option value="send_email">Send Email</option>
              <option value="custom_webhook">Custom Webhook</option>
              <option value="mcp_tool">Connected Tool (any MCP server you've connected)</option>
            </select>
          </div>

          <!-- Action Config JSON -->
          <div>
            <label style="${LABEL_STYLE}">Action Config (JSON)</label>
            <textarea name="action_config_json" rows="5"
              placeholder='{"integration":"linear","ticket_title":"Low NPS alert","ticket_description":"NPS dropped below threshold."}'
              style="${INPUT_STYLE}font-family:monospace;resize:vertical;"></textarea>
            <div style="font-size:0.73rem;color:var(--text-muted);margin-top:4px;">
              For create_ticket: ticket_title, ticket_description, team_id. For post_slack: channel, text. For send_email: to_email, subject, body. For custom_webhook: webhook_url, webhook_payload. For mcp_tool: server_name, tool, tool_args — requires a live grant on <a href="/connections" style="color:var(--accent);">Connections</a>.
            </div>
          </div>

          <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:0.25rem 0;" />
          <h2 style="margin:0;font-size:0.95rem;font-weight:600;color:var(--text-primary);">Execution Settings</h2>

          <!-- Auto-execute -->
          <div style="display:flex;align-items:center;gap:0.75rem;">
            <input type="checkbox" name="auto_execute" id="auto_execute" value="1"
              style="width:16px;height:16px;accent-color:#4ecca3;" />
            <label for="auto_execute" style="font-size:0.87rem;color:var(--text-dim);cursor:pointer;">
              Auto-execute (no approval required)
            </label>
          </div>
          <div style="font-size:0.73rem;color:var(--text-muted);margin:-0.4rem 0 0 1.9rem;">
            This asks for autonomy; it does not grant it. Foundry auto-executes only
            while the matching dial in <a href="/controls" style="color:var(--accent);">Controls</a>
            is set to act and a live consent is on record. Actions that leave your own
            tools — email, calls, webhooks, MCP tools — sit under Outreach, which the
            platform currently holds at suggest, so those always wait for you.
          </div>

          <!-- Weekly Budget -->
          <div>
            <label style="${LABEL_STYLE}">Weekly Execution Budget (optional)</label>
            <input type="number" name="execution_budget_weekly" placeholder="Leave blank for unlimited" min="1"
              style="${INPUT_STYLE}" />
            <div style="font-size:0.73rem;color:var(--text-muted);margin-top:4px;">Maximum times this playbook can trigger per 7-day rolling window.</div>
          </div>

          <div style="display:flex;gap:0.75rem;margin-top:0.5rem;">
            <button type="submit" class="btn btn-primary" style="flex:1;">Create Playbook</button>
            <a href="/playbooks/execution" class="btn btn-ghost" style="flex:1;text-align:center;text-decoration:none;padding:0.45rem 1rem;">Cancel</a>
          </div>
        </form>
      </div>
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /playbooks/execution ────────────────────────────────────────────────

executionPlaybooks.post('/playbooks/execution',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'agents', 'New Execution Playbook', undefined, c);

  if (!ctx.productId) {
    return c.redirect('/playbooks/execution');
  }

  const body = await c.req.parseBody();

  const name = (body.name as string || '').trim();
  const description = (body.description as string || '').trim() || null;
  const triggerType = (body.trigger_type as string) || 'metric_threshold';
  const conditionLogic = ((body.condition_logic as string) || 'AND') as 'AND' | 'OR';
  const condMetric = (body.cond_metric as string || '').trim();
  const condOperator = (body.cond_operator as string || 'lt') as 'lt' | 'gt' | 'lte' | 'gte' | 'eq';
  const condValue = parseFloat((body.cond_value as string) || '0');
  const condFilter = (body.cond_filter as string || '').trim() || undefined;
  const actionType = (body.action_type as string) || 'create_ticket';
  const actionConfigRaw = (body.action_config_json as string || '{}').trim();
  const autoExecute = body.auto_execute === '1';
  const budgetRaw = (body.execution_budget_weekly as string || '').trim();
  const executionBudgetWeekly = budgetRaw ? parseInt(budgetRaw, 10) : null;

  let actionConfig: Record<string, unknown> = {};
  try {
    actionConfig = JSON.parse(actionConfigRaw) as Record<string, unknown>;
  } catch {
    // Fall through with empty config
  }

  if (name) {
    await createExecutionPlaybook(ctx.productId, {
      name,
      description,
      trigger_type: triggerType,
      trigger_config: {
        logic: conditionLogic,
        conditions: condMetric
          ? [{
              metric: condMetric,
              operator: condOperator,
              value: condValue,
              filter: condFilter,
            }]
          : [],
      },
      action_type: actionType,
      action_config: actionConfig,
      auto_execute: autoExecute,
      execution_budget_weekly: executionBudgetWeekly,
    });
  }

  return c.redirect('/playbooks/execution');
});

// ─── POST /playbooks/execution/:id/toggle ────────────────────────────────────

executionPlaybooks.post('/playbooks/execution/:id/toggle',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
    const founder = c.get('founder');
    const id = c.req.param('id');
    const ctx = await getLayoutContext(founder, 'agents', 'Execution Playbooks', undefined, c);
    if (!ctx.productId) return c.redirect('/playbooks/execution');
    const body = await c.req.parseBody();
    const active = (body.active as string) === '1';
    // Scoped to the company the guard just authorized. Pausing a standing
    // order is the emergency stop for it; an ownership scope put that out of
    // reach of the people most likely to need it.
    await togglePlaybook(id, active, ctx.productId);
    return c.redirect('/playbooks/execution');
  });

// ─── POST /playbooks/execution/:id/delete ────────────────────────────────────

executionPlaybooks.post('/playbooks/execution/:id/delete',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
    const founder = c.get('founder');
    const id = c.req.param('id');
    const ctx = await getLayoutContext(founder, 'agents', 'Execution Playbooks', undefined, c);
    if (!ctx.productId) return c.redirect('/playbooks/execution');
    await deletePlaybook(id, ctx.productId);
    return c.redirect('/playbooks/execution');
  });

// ─── POST /playbooks/execution/evaluate ──────────────────────────────────────

executionPlaybooks.post('/playbooks/execution/evaluate',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'agents', 'Execution Playbooks', undefined, c);

  if (!ctx.productId) {
    return c.redirect('/playbooks/execution');
  }

  const { triggered } = await evaluatePlaybooksForProduct(ctx.productId);
  return c.redirect(`/playbooks/execution?triggered=${triggered}`);
});

// ─── GET /playbooks/execution/log ─────────────────────────────────────────────

executionPlaybooks.get('/playbooks/execution/log', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'agents', 'Playbook Trigger Log', undefined, c);

  if (!ctx.productId) {
    const content = html`
      <h1 style="margin:0 0 1rem;">Playbook Trigger Log</h1>
      <div class="card" style="padding:2rem;text-align:center;color:var(--text-muted);">No product selected.</div>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const entries = await getTriggerLog(ctx.productId, 50);

  const logItems = entries.map((entry) => {
    const snapshot = entry.condition_snapshot;
    const snapshotText = snapshot
      ? Object.entries(snapshot).map(([k, v]) => `${k}: ${v ?? 'null'}`).join(' | ')
      : '';

    return html`
      <div style="padding:1rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;gap:0.75rem;align-items:flex-start;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem;flex-wrap:wrap;">
            <span style="font-size:0.72rem;padding:2px 8px;border-radius:99px;${resultBadgeStyle(entry.evaluation_result)}">${entry.evaluation_result}</span>
            <span style="font-size:0.84rem;font-weight:600;color:var(--text-primary);">${entry.playbook_name}</span>
            <span style="font-size:0.72rem;color:var(--text-muted);margin-left:auto;">${timeAgo(entry.triggered_at)}</span>
          </div>
          ${snapshotText
            ? html`<div style="font-size:0.78rem;color:var(--text-muted);font-family:monospace;margin-top:2px;">${snapshotText}</div>`
            : ''}
          ${entry.action_execution_id
            ? html`<div style="font-size:0.75rem;color:var(--text-dim);margin-top:4px;">Execution: ${entry.action_execution_id}</div>`
            : ''}
        </div>
      </div>
    `;
  });

  const content = html`
    <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem;">
      <a href="/playbooks/execution" style="font-size:0.85rem;color:var(--text-muted);text-decoration:none;">← Playbooks</a>
      <h1 style="margin:0;">Playbook Trigger Log</h1>
    </div>

    <div class="card" style="padding:0;overflow:hidden;">
      <div style="padding:1rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.08);">
        <span style="font-size:0.9rem;font-weight:600;color:var(--text-primary);">Last 50 evaluation events</span>
      </div>
      ${entries.length === 0
        ? html`<div style="padding:3rem;text-align:center;color:var(--text-muted);font-size:0.9rem;">No evaluation events yet. Run an evaluation to see results here.</div>`
        : logItems}
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});
