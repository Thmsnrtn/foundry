// =============================================================================
// FOUNDRY — Daily Actions Dashboard Page
// Shows today's action and action history.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import { getRecentActions, approveAction, dismissAction } from '../../services/autonomous/daily-actions.js';
import { calculateTrustScore, getMonthlyValueSummary, getEffectiveActionLimit } from '../../services/autonomous/autonomy-engine.js';

export const actionRoutes = new Hono<AuthEnv>();

actionRoutes.get('/dashboard/actions', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'dashboard', 'Daily Actions', undefined, c);
  const productId = ctx.productId;

  if (!productId) {
    return c.redirect('/onboarding');
  }

  const [actions, trust, value, limits] = await Promise.all([
    getRecentActions(productId, 30),
    calculateTrustScore(productId, founder.id),
    getMonthlyValueSummary(productId),
    getEffectiveActionLimit(productId, founder.id, founder.tier),
  ]);
  const todayActions = actions.filter((a) => isToday(a.created_at));
  const history = actions.filter((a) => !isToday(a.created_at));

  const content = html`
    <h1>Daily Actions</h1>
    <!-- Trust & Value Summary -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:1rem;margin-bottom:1.5rem;">
      <div class="card" style="text-align:center;padding:1rem;margin:0;">
        <div style="font-size:1.3rem;font-weight:800;color:${trust.score >= 70 ? 'var(--color-success)' : trust.score >= 45 ? 'var(--color-primary)' : 'var(--color-text-muted)'};">${trust.score}</div>
        <div style="font-size:var(--text-xs);color:var(--color-text-muted);">Trust Score</div>
        <div style="font-size:var(--text-xs);color:var(--color-text-faint);margin-top:2px;">${trust.level}</div>
      </div>
      <div class="card" style="text-align:center;padding:1rem;margin:0;">
        <div style="font-size:1.3rem;font-weight:800;">${limits.actionsPerDay}</div>
        <div style="font-size:var(--text-xs);color:var(--color-text-muted);">Actions/Day</div>
        <div style="font-size:var(--text-xs);color:var(--color-text-faint);margin-top:2px;">of ${limits.tierConfig.maxActionsPerDay} max</div>
      </div>
      <div class="card" style="text-align:center;padding:1rem;margin:0;">
        <div style="font-size:1.3rem;font-weight:800;">${value.actionsThisMonth}</div>
        <div style="font-size:var(--text-xs);color:var(--color-text-muted);">Actions This Month</div>
        <div style="font-size:var(--text-xs);color:var(--color-text-faint);margin-top:2px;">${value.approvedThisMonth} approved</div>
      </div>
      <div class="card" style="text-align:center;padding:1rem;margin:0;">
        <div style="font-size:1.3rem;font-weight:800;">${value.estimatedHoursSaved}h</div>
        <div style="font-size:var(--text-xs);color:var(--color-text-muted);">Hours Saved</div>
        <div style="font-size:var(--text-xs);color:var(--color-text-faint);margin-top:2px;">this month</div>
      </div>
    </div>

    ${limits.upgradePrompt ? html`
    <div class="card" style="border-left:3px solid var(--color-primary);margin-bottom:1.5rem;padding:1rem 1.25rem;">
      <p style="font-size:var(--text-sm);color:var(--color-text-secondary);margin:0;">${limits.upgradePrompt}</p>
      <a href="/settings/integrations" class="btn btn-primary btn-sm" style="margin-top:0.75rem;">Upgrade</a>
    </div>` : ''}

    <p style="color:var(--color-text-muted);margin-bottom:1.5rem;">Every day, Foundry analyzes your product and takes action calibrated by your data and Wisdom Layer. As you approve actions, trust grows and autonomy expands.</p>

    ${todayActions.length > 0 ? html`
    <div class="stagger">
    ${todayActions.map((todayAction) => html`
    <div class="card card-enter" style="border-left:3px solid ${todayAction.status === 'pending_approval' ? 'var(--color-warning)' : todayAction.action_type === 'all_clear' ? 'var(--color-success)' : 'var(--color-primary)'};">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:0.75rem;">
        <div>
          <span style="font-size:var(--text-xs);color:var(--color-text-faint);text-transform:uppercase;letter-spacing:0.5px;">Today</span>
          <h3 style="margin:0.25rem 0 0;">${todayAction.title}</h3>
        </div>
        <div style="display:flex;gap:0.5rem;align-items:center;">
          <span class="status-badge ${todayAction.status === 'pending_approval' ? 'status-yellow' : todayAction.status === 'completed' ? 'status-green' : todayAction.status === 'approved' ? 'status-blue' : 'status-gray'}">${todayAction.status.replace(/_/g, ' ')}</span>
          <span class="status-badge status-gray">Gate ${todayAction.gate}</span>
        </div>
      </div>
      <p style="color:var(--color-text-secondary);margin-bottom:0.5rem;font-size:var(--text-sm);">${todayAction.summary}</p>

      ${todayAction.draft_content ? html`
      <details style="margin-top:0.75rem;">
        <summary style="font-weight:600;font-size:var(--text-sm);cursor:pointer;">View draft</summary>
        <div style="margin-top:0.5rem;padding:1rem;background:var(--color-bg);border-radius:var(--radius-md);font-size:var(--text-sm);white-space:pre-wrap;line-height:1.7;">${todayAction.draft_content}</div>
      </details>` : ''}

      <div style="display:flex;gap:0.75rem;margin-top:0.75rem;">
        ${todayAction.action_url ? html`<a href="${todayAction.action_url}" class="btn btn-secondary btn-sm">${todayAction.requires_approval ? 'Review' : 'View'}</a>` : ''}
        ${todayAction.status === 'pending_approval' ? html`
          <form method="POST" action="/dashboard/actions/${todayAction.id}/approve" style="display:inline;">
            <button type="submit" class="btn btn-sm" style="background:var(--color-success);color:#fff;border-color:var(--color-success);">Approve</button>
          </form>
          <form method="POST" action="/dashboard/actions/${todayAction.id}/dismiss" style="display:inline;">
            <button type="submit" class="btn btn-secondary btn-sm">Dismiss</button>
          </form>
        ` : ''}
      </div>
    </div>
    `)}
    </div>
    ` : html`
    <div class="card" style="text-align:center;padding:2rem;background:var(--color-bg);">
      <p style="color:var(--color-text-muted);">Today's actions haven't run yet. Foundry plans actions daily at 7:00 AM UTC.</p>
    </div>
    `}

    ${history.length > 0 ? html`
    <h3 style="margin-top:2rem;margin-bottom:1rem;">Action History</h3>
    <div class="stagger">
      ${history.map((a) => html`
        <div class="feed-item" style="padding:var(--space-4) 0;">
          <div class="feed-dot feed-dot-${a.status === 'completed' || a.status === 'approved' ? 'success' : a.status === 'dismissed' ? 'info' : 'warning'}"></div>
          <div style="flex:1;">
            <div style="display:flex;justify-content:space-between;align-items:start;">
              <div>
                <span class="feed-title">${a.title}</span>
                <span class="status-badge ${a.status === 'completed' ? 'status-green' : a.status === 'approved' ? 'status-blue' : a.status === 'dismissed' ? 'status-gray' : 'status-yellow'}" style="margin-left:0.5rem;font-size:9px;">${a.status}</span>
              </div>
              <span class="feed-time">${formatDate(a.created_at)}</span>
            </div>
            <div class="feed-body">${a.summary}</div>
          </div>
        </div>
      `)}
    </div>
    ` : ''}
  `;

  return c.html(dashboardLayout(ctx, content));
});

// Approve action
actionRoutes.post('/dashboard/actions/:id/approve', async (c) => {
  const founder = c.get('founder');
  await approveAction(c.req.param('id'), founder.id);
  return c.redirect('/dashboard/actions');
});

// Dismiss action
actionRoutes.post('/dashboard/actions/:id/dismiss', async (c) => {
  const founder = c.get('founder');
  await dismissAction(c.req.param('id'), founder.id);
  return c.redirect('/dashboard/actions');
});

function isToday(dateStr: string): boolean {
  return dateStr.startsWith(new Date().toISOString().split('T')[0]);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}
