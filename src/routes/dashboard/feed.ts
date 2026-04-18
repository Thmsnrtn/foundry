// =============================================================================
// FOUNDRY — Activity Feed Dashboard Page
// Unified timeline of everything that happened.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { query, getProductsByOwner, getActiveStressors, getLatestMetrics, getPendingDecisions } from '../../db/client.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';

export const feedPageRoutes = new Hono<AuthEnv>();

feedPageRoutes.get('/dashboard/feed', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'dashboard', 'Activity Feed', undefined, c);

  const products = await getProductsByOwner(founder.id);
  const productIds = products.rows.map((p) => (p as Record<string, string>).id);
  const productMap = new Map(products.rows.map((p) => [(p as Record<string, string>).id, (p as Record<string, string>).name]));

  if (productIds.length === 0) {
    const content = html`
      <h1>Activity Feed</h1>
      <div class="empty-state-card">
        <h3>No activity yet</h3>
        <p style="color:var(--color-text-muted);">Complete onboarding to start seeing activity here.</p>
        <a href="/onboarding" class="btn btn-primary">Get Started</a>
      </div>`;
    return c.html(dashboardLayout(ctx, content));
  }

  const placeholders = productIds.map(() => '?').join(',');

  // Fetch recent activity from multiple sources
  const [logs, decisions, stressors, milestones] = await Promise.all([
    query(`SELECT id, product_id, action_type, reasoning, risk_state_at_action, created_at FROM audit_log WHERE product_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 30`, productIds),
    query(`SELECT id, product_id, category, what, status, created_at FROM decisions WHERE product_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 20`, productIds),
    query(`SELECT id, product_id, stressor_name, severity, status, identified_at FROM stressor_history WHERE product_id IN (${placeholders}) ORDER BY identified_at DESC LIMIT 15`, productIds),
    query(`SELECT id, product_id, milestone_title, milestone_description, created_at FROM milestone_events WHERE founder_id = ? ORDER BY created_at DESC LIMIT 10`, [founder.id]),
  ]);

  // Merge into unified timeline
  type FeedItem = { id: string; type: string; title: string; body: string; severity: string; product: string; time: string; url?: string };
  const feed: FeedItem[] = [];

  for (const r of logs.rows) {
    const row = r as Record<string, string>;
    feed.push({ id: row.id, type: 'system', title: formatType(row.action_type), body: (row.reasoning ?? '').slice(0, 150), severity: row.risk_state_at_action === 'red' ? 'critical' : row.risk_state_at_action === 'yellow' ? 'warning' : 'info', product: productMap.get(row.product_id) ?? '', time: row.created_at });
  }
  for (const r of decisions.rows) {
    const row = r as Record<string, string>;
    feed.push({ id: row.id, type: 'decision', title: row.what, body: `${row.category} · ${row.status}`, severity: row.category === 'urgent' ? 'warning' : 'info', product: productMap.get(row.product_id) ?? '', time: row.created_at, url: `/decisions/${row.id}` });
  }
  for (const r of stressors.rows) {
    const row = r as Record<string, string>;
    feed.push({ id: row.id, type: 'stressor', title: row.stressor_name, body: `${row.severity} · ${row.status}`, severity: row.severity === 'critical' ? 'critical' : 'warning', product: productMap.get(row.product_id) ?? '', time: row.identified_at });
  }
  for (const r of milestones.rows) {
    const row = r as Record<string, string>;
    feed.push({ id: row.id, type: 'milestone', title: row.milestone_title, body: row.milestone_description, severity: 'success', product: productMap.get(row.product_id) ?? '', time: row.created_at });
  }

  feed.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  const display = feed.slice(0, 50);

  const content = html`
    <h1>Activity Feed</h1>
    <div class="card">
      ${display.length === 0
        ? html`<p style="text-align:center;color:var(--color-text-muted);padding:2rem;">No activity recorded yet. Run an audit or enter metrics to get started.</p>`
        : html`<div class="stagger">${display.map((item) => html`
          <div class="feed-item">
            <div class="feed-dot feed-dot-${item.severity}"></div>
            <div style="flex:1;min-width:0;">
              <div style="display:flex;justify-content:space-between;align-items:start;gap:0.5rem;">
                <div class="feed-title">${item.url ? html`<a href="${item.url}" style="color:inherit;">${item.title}</a>` : item.title}</div>
                <span class="feed-time">${formatRelativeTime(item.time)}</span>
              </div>
              <div class="feed-body">${item.body}</div>
              ${item.product ? html`<div style="font-size:var(--text-xs);color:var(--color-text-faint);margin-top:2px;">${item.product}</div>` : ''}
            </div>
          </div>
        `)}</div>`}
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

function formatType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
