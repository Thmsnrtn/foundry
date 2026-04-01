// =============================================================================
// FOUNDRY — Agents Inbox
// Unified view of all agent messages, pending decisions, and action proposals.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { query } from '../../db/client.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';

export const agentsInbox = new Hono<AuthEnv>();

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

function priorityBadge(priority: string | null): string {
  const p = priority ?? 'normal';
  if (p === 'critical') return 'background:#ff6b6b22;color:#ff6b6b;border:1px solid #ff6b6b44;';
  if (p === 'high') return 'background:#ffb34722;color:#ffb347;border:1px solid #ffb34744;';
  if (p === 'low') return 'background:rgba(255,255,255,0.05);color:var(--text-muted);border:1px solid rgba(255,255,255,0.1);';
  return 'background:#4ecca322;color:#4ecca3;border:1px solid #4ecca344;';
}

function priorityLabel(priority: string | null): string {
  return (priority ?? 'normal').charAt(0).toUpperCase() + (priority ?? 'normal').slice(1);
}

// ─── GET /inbox ────────────────────────────────────────────────────────────────

agentsInbox.get('/inbox', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'inbox', 'Agents Inbox', undefined, c);

  if (!ctx.productId) {
    const content = html`
      <h1 style="margin:0 0 1rem;">Agents Inbox</h1>
      <div class="card" style="padding:2rem;text-align:center;color:var(--text-muted);">No product selected.</div>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;
  const tab = (c.req.query('tab') as string) || 'messages';

  const [messagesResult, decisionsResult, actionsResult] = await Promise.all([
    query(
      `SELECT am.*, sender.display_name as from_display
       FROM agent_messages am
       LEFT JOIN agents sender ON sender.id = am.agent_id
       WHERE am.product_id=? AND am.read_at IS NULL
       ORDER BY am.created_at DESC LIMIT 50`,
      [productId]
    ),
    query(
      `SELECT * FROM agent_decisions
       WHERE product_id=? AND status='pending'
       ORDER BY created_at DESC LIMIT 20`,
      [productId]
    ),
    query(
      `SELECT * FROM outbound_actions
       WHERE product_id=? AND status='pending'
       ORDER BY created_at DESC LIMIT 20`,
      [productId]
    ),
  ]);

  const messages = messagesResult.rows as Array<Record<string, unknown>>;
  const decisions = decisionsResult.rows as Array<Record<string, unknown>>;
  const actions = actionsResult.rows as Array<Record<string, unknown>>;

  const tabStyle = (name: string) => name === tab
    ? 'padding:0.6rem 1.25rem;border-bottom:2px solid var(--accent);color:var(--text-primary);font-weight:600;font-size:0.9rem;text-decoration:none;'
    : 'padding:0.6rem 1.25rem;border-bottom:2px solid transparent;color:var(--text-dim);font-size:0.9rem;text-decoration:none;';

  const messageItems = messages.map((m) => html`
    <div style="padding:1rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;gap:1rem;align-items:flex-start;">
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.3rem;flex-wrap:wrap;">
          <span style="font-size:0.85rem;font-weight:600;color:var(--text-primary);">${m.from_display ?? m.agent_id ?? 'Agent'}</span>
          <span style="font-size:0.7rem;padding:2px 8px;border-radius:99px;${priorityBadge(m.priority as string)}">${priorityLabel(m.priority as string)}</span>
          <span style="font-size:0.72rem;color:var(--text-muted);margin-left:auto;">${timeAgo(m.created_at as string)}</span>
        </div>
        <div style="font-size:0.87rem;font-weight:600;color:var(--text-primary);margin-bottom:0.25rem;">${m.subject ?? m.title ?? '(no subject)'}</div>
        <div style="font-size:0.82rem;color:var(--text-dim);line-height:1.5;">${m.body ?? m.content ?? ''}</div>
      </div>
      <form method="POST" action="/inbox/messages/${m.id}/read" style="flex-shrink:0;">
        <button type="submit" style="font-size:0.72rem;padding:4px 10px;border:1px solid rgba(255,255,255,0.15);border-radius:4px;background:transparent;color:var(--text-muted);cursor:pointer;">Mark read</button>
      </form>
    </div>
  `);

  const decisionItems = decisions.map((d) => html`
    <div style="padding:1.25rem;border-bottom:1px solid rgba(255,255,255,0.05);">
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.4rem;flex-wrap:wrap;">
        <span style="font-size:0.85rem;font-weight:600;color:var(--text-primary);">${d.agent_name ?? d.agent_id ?? 'Agent'}</span>
        <span style="font-size:0.7rem;padding:2px 8px;border-radius:99px;${priorityBadge(d.priority as string)}">${priorityLabel(d.priority as string)}</span>
        <span style="font-size:0.72rem;color:var(--text-muted);margin-left:auto;">${timeAgo(d.created_at as string)}</span>
      </div>
      <div style="font-size:0.9rem;font-weight:600;color:var(--text-primary);margin-bottom:0.35rem;">${d.title ?? d.decision_title ?? '(untitled)'}</div>
      <div style="font-size:0.83rem;color:var(--text-dim);line-height:1.5;margin-bottom:0.875rem;">${d.description ?? d.rationale ?? ''}</div>
      <div style="display:flex;gap:0.5rem;">
        <form method="POST" action="/inbox/decisions/${d.id}/approve" style="display:inline;">
          <button type="submit" class="btn btn-primary" style="font-size:0.8rem;padding:0.35rem 0.9rem;">Approve</button>
        </form>
        <form method="POST" action="/inbox/decisions/${d.id}/dismiss" style="display:inline;">
          <button type="submit" class="btn btn-ghost" style="font-size:0.8rem;padding:0.35rem 0.9rem;color:#ff6b6b;border-color:#ff6b6b44;">Dismiss</button>
        </form>
      </div>
    </div>
  `);

  const actionItems = actions.map((a) => html`
    <div style="padding:1.25rem;border-bottom:1px solid rgba(255,255,255,0.05);">
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.4rem;flex-wrap:wrap;">
        <span style="font-size:0.85rem;font-weight:600;color:var(--text-primary);">${a.agent_name ?? a.agent_id ?? 'Agent'}</span>
        <span style="font-size:0.7rem;padding:2px 8px;border-radius:99px;${priorityBadge(a.priority as string)}">${priorityLabel(a.priority as string)}</span>
        <span style="font-size:0.72rem;color:var(--text-muted);margin-left:auto;">${timeAgo(a.created_at as string)}</span>
      </div>
      <div style="font-size:0.9rem;font-weight:600;color:var(--text-primary);margin-bottom:0.35rem;">${a.title ?? a.action_type ?? '(untitled)'}</div>
      <div style="font-size:0.83rem;color:var(--text-dim);line-height:1.5;margin-bottom:0.875rem;">${a.description ?? a.payload ?? ''}</div>
      <div style="display:flex;gap:0.5rem;">
        <form method="POST" action="/inbox/decisions/${a.id}/approve" style="display:inline;">
          <button type="submit" class="btn btn-primary" style="font-size:0.8rem;padding:0.35rem 0.9rem;">Approve</button>
        </form>
        <form method="POST" action="/inbox/decisions/${a.id}/dismiss" style="display:inline;">
          <button type="submit" class="btn btn-ghost" style="font-size:0.8rem;padding:0.35rem 0.9rem;color:#ff6b6b;border-color:#ff6b6b44;">Dismiss</button>
        </form>
      </div>
    </div>
  `);

  const content = html`
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1.5rem;">
      <h1 style="margin:0;">Agents Inbox</h1>
      <div style="display:flex;gap:0.5rem;font-size:0.8rem;color:var(--text-muted);">
        ${messages.length > 0 ? html`<span style="background:#ff6b6b22;color:#ff6b6b;padding:2px 8px;border-radius:99px;">${messages.length} unread</span>` : ''}
        ${decisions.length > 0 ? html`<span style="background:#ffb34722;color:#ffb347;padding:2px 8px;border-radius:99px;">${decisions.length} pending</span>` : ''}
      </div>
    </div>

    <div class="card" style="padding:0;overflow:hidden;">
      <!-- Tabs -->
      <div style="display:flex;border-bottom:1px solid rgba(255,255,255,0.08);padding:0 0.25rem;">
        <a href="/inbox?tab=messages" style="${tabStyle('messages')}">Messages${messages.length > 0 ? html` <span style="font-size:0.7rem;background:#ff6b6b;color:white;padding:1px 6px;border-radius:99px;margin-left:4px;">${messages.length}</span>` : ''}</a>
        <a href="/inbox?tab=decisions" style="${tabStyle('decisions')}">Decisions${decisions.length > 0 ? html` <span style="font-size:0.7rem;background:#ffb347;color:#1a1a2e;padding:1px 6px;border-radius:99px;margin-left:4px;">${decisions.length}</span>` : ''}</a>
        <a href="/inbox?tab=actions" style="${tabStyle('actions')}">Actions${actions.length > 0 ? html` <span style="font-size:0.7rem;background:#4ecca3;color:#1a1a2e;padding:1px 6px;border-radius:99px;margin-left:4px;">${actions.length}</span>` : ''}</a>
      </div>

      <!-- Messages Tab -->
      ${tab === 'messages' ? html`
        ${messages.length === 0
          ? html`<div style="padding:3rem;text-align:center;color:var(--text-muted);font-size:0.9rem;">No unread messages. All caught up.</div>`
          : messageItems}
      ` : ''}

      <!-- Decisions Tab -->
      ${tab === 'decisions' ? html`
        ${decisions.length === 0
          ? html`<div style="padding:3rem;text-align:center;color:var(--text-muted);font-size:0.9rem;">No pending decisions awaiting approval.</div>`
          : decisionItems}
      ` : ''}

      <!-- Actions Tab -->
      ${tab === 'actions' ? html`
        ${actions.length === 0
          ? html`<div style="padding:3rem;text-align:center;color:var(--text-muted);font-size:0.9rem;">No pending action proposals.</div>`
          : actionItems}
      ` : ''}
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /inbox/decisions/:id/approve ────────────────────────────────────────

agentsInbox.post('/inbox/decisions/:id/approve', async (c) => {
  const founder = c.get('founder');
  const id = c.req.param('id');
  await query(
    `UPDATE agent_decisions SET status='approved', approved_at=CURRENT_TIMESTAMP, approved_by=? WHERE id=?`,
    [founder.id, id]
  );
  return c.redirect('/inbox?tab=decisions');
});

// ─── POST /inbox/decisions/:id/dismiss ────────────────────────────────────────

agentsInbox.post('/inbox/decisions/:id/dismiss', async (c) => {
  const id = c.req.param('id');
  await query(
    `UPDATE agent_decisions SET status='dismissed' WHERE id=?`,
    [id]
  );
  return c.redirect('/inbox?tab=decisions');
});

// ─── POST /inbox/messages/:id/read ────────────────────────────────────────────

agentsInbox.post('/inbox/messages/:id/read', async (c) => {
  const id = c.req.param('id');
  await query(
    `UPDATE agent_messages SET read_at=CURRENT_TIMESTAMP WHERE id=?`,
    [id]
  );
  return c.redirect('/inbox?tab=messages');
});
