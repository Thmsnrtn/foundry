// =============================================================================
// FOUNDRY — Audit Log
// Security audit log showing all system actions.
// =============================================================================

import { Hono } from 'hono';
import { csvRow } from '../../lib/csv.js';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { query } from '../../db/client.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import { requireCompanyCapability } from '../../middleware/rbac.js';

export const auditLog = new Hono<AuthEnv>();

// EVERY ROUTE IN THIS ROUTER IS THE COMPANY’S AUDIT TRAIL.
//
// `team_members.can_view_audit` has existed since migration 010 and nothing read it.
// That was survivable only because an invited member could not see the company
// at all — the dashboard listed by `owner_id`. Now that membership makes the
// company visible, this is the guard that was always supposed to be here.
//
// Router-level rather than per-route: a capability that has to be remembered
// on each new handler is one that will be forgotten on one of them.
auditLog.use('*', requireCompanyCapability('can_view_audit'));


// ─── Helpers ──────────────────────────────────────────────────────────────────

function actorTypeBadge(actorType: string): string {
  if (actorType === 'agent') return 'background:#4ecca322;color:#4ecca3;border:1px solid #4ecca344;';
  if (actorType === 'user') return 'background:#7c83fd22;color:#7c83fd;border:1px solid #7c83fd44;';
  if (actorType === 'system') return 'background:rgba(255,255,255,0.08);color:var(--text-muted);border:1px solid rgba(255,255,255,0.15);';
  if (actorType === 'api') return 'background:#ffb34722;color:#ffb347;border:1px solid #ffb34744;';
  return 'background:rgba(255,255,255,0.06);color:var(--text-dim);border:1px solid rgba(255,255,255,0.1);';
}

function fmtTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function actionColor(action: string): string {
  if (action.includes('delete') || action.includes('remove')) return '#ff6b6b';
  if (action.includes('create') || action.includes('add')) return '#4ecca3';
  if (action.includes('update') || action.includes('edit')) return '#7c83fd';
  if (action.includes('approve')) return '#4ecca3';
  if (action.includes('deny') || action.includes('dismiss')) return '#ff6b6b';
  return 'var(--text-dim)';
}

// ─── GET /audit-log ────────────────────────────────────────────────────────────

auditLog.get('/audit-log', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'audit-log', 'Audit Log', undefined, c);

  if (!ctx.productId) {
    const content = html`
      <h1 style="margin:0 0 1rem;">Audit Log</h1>
      <div class="card" style="padding:2rem;text-align:center;color:var(--text-muted);">No product selected.</div>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;
  const actorType = c.req.query('actor_type') ?? '';
  const action = c.req.query('action') ?? '';
  const since = c.req.query('since') ?? '';

  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
  const PAGE_SIZE = 500;
  const offset = (page - 1) * PAGE_SIZE;

  let sql = `SELECT * FROM agent_audit_log WHERE product_id=?`;
  let countSql = `SELECT COUNT(*) as total FROM agent_audit_log WHERE product_id=?`;
  const params: unknown[] = [productId];
  const countParams: unknown[] = [productId];

  if (actorType) {
    sql += ` AND actor_type=?`;
    countSql += ` AND actor_type=?`;
    params.push(actorType);
    countParams.push(actorType);
  }
  if (action) {
    sql += ` AND action=?`;
    countSql += ` AND action=?`;
    params.push(action);
    countParams.push(action);
  }
  if (since) {
    sql += ` AND created_at >= ?`;
    countSql += ` AND created_at >= ?`;
    params.push(since);
    countParams.push(since);
  }

  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(PAGE_SIZE, offset);

  const [result, countResult] = await Promise.all([
    query(sql, params),
    query(countSql, countParams),
  ]);
  const entries = result.rows as Array<Record<string, unknown>>;
  const totalEntries = (countResult.rows[0] as Record<string, number>)?.total ?? 0;
  const totalPages = Math.ceil(totalEntries / PAGE_SIZE);

  // Collect distinct actor types and actions for filter suggestions
  const ACTOR_TYPES = ['agent', 'user', 'system', 'api'];

  const filterBadge = (key: string, val: string, current: string) => {
    const isActive = current === val;
    return `padding:4px 10px;border-radius:99px;font-size:0.75rem;font-weight:${isActive ? '700' : '500'};cursor:pointer;text-decoration:none;
      background:${isActive ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.04)'};
      color:${isActive ? 'var(--text-primary)' : 'var(--text-muted)'};
      border:1px solid ${isActive ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)'};`;
  };

  const buildUrl = (overrides: Record<string, string>) => {
    const params = new URLSearchParams();
    if (actorType) params.set('actor_type', actorType);
    if (action) params.set('action', action);
    if (since) params.set('since', since);
    if (page > 1) params.set('page', String(page));
    for (const [k, v] of Object.entries(overrides)) {
      if (v) params.set(k, v); else params.delete(k);
    }
    const qs = params.toString();
    return `/audit-log${qs ? `?${qs}` : ''}`;
  };

  const tableRows = entries.map((e) => {
    let detailStr = '';
    try {
      const details = e.details ?? e.metadata;
      if (details) {
        detailStr = typeof details === 'string' ? details : JSON.stringify(details).slice(0, 120);
      }
    } catch { /* ignore */ }

    return html`
      <tr style="border-bottom:1px solid rgba(255,255,255,0.04);transition:background 0.1s;" onmouseover="this.style.background='rgba(255,255,255,0.025)'" onmouseout="this.style.background=''">
        <td style="padding:0.65rem 0.875rem;font-size:0.75rem;color:var(--text-muted);white-space:nowrap;">${fmtTimestamp(e.created_at as string)}</td>
        <td style="padding:0.65rem 0.875rem;">
          <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
            <span style="font-size:0.75rem;font-weight:600;color:var(--text-primary);">${e.actor_name ?? e.actor_id ?? e.actor ?? '—'}</span>
            <span style="font-size:0.65rem;padding:1px 6px;border-radius:99px;${actorTypeBadge(e.actor_type as string ?? 'system')}">${e.actor_type ?? 'system'}</span>
          </div>
        </td>
        <td style="padding:0.65rem 0.875rem;font-size:0.8rem;font-weight:600;color:${actionColor(e.action as string ?? '')};">${e.action ?? '—'}</td>
        <td style="padding:0.65rem 0.875rem;font-size:0.78rem;color:var(--text-dim);">${e.resource_type ?? e.resource ?? '—'}${e.resource_id ? html` <span style="color:var(--text-muted);font-size:0.7rem;">#${(e.resource_id as string).slice(0, 8)}</span>` : ''}</td>
        <td style="padding:0.65rem 0.875rem;font-size:0.75rem;color:var(--text-muted);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${detailStr}</td>
        <td style="padding:0.65rem 0.875rem;font-size:0.72rem;color:var(--text-muted);">${e.ip_address ?? ''}</td>
      </tr>
    `;
  });

  const content = html`
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:0.5rem;">
      <h1 style="margin:0;">Audit Log</h1>
      <div style="display:flex;align-items:center;gap:1rem;">
        <span style="font-size:0.8rem;color:var(--text-muted);">${totalEntries} entries (page ${page} of ${Math.max(1, totalPages)})</span>
        <a href="${buildUrl({ export: 'csv' })}" class="btn btn-ghost btn-sm" style="font-size:0.75rem;padding:4px 10px;" aria-label="Export audit log as CSV">Export CSV</a>
      </div>
    </div>

    <!-- Filters -->
    <div style="display:flex;gap:0.75rem;flex-wrap:wrap;align-items:center;margin-bottom:1.25rem;">
      <!-- Actor type filters -->
      <div style="display:flex;gap:0.25rem;flex-wrap:wrap;">
        <a href="${buildUrl({ actor_type: '' })}" style="${filterBadge('actor_type', '', actorType)}">All</a>
        ${ACTOR_TYPES.map((type) => html`<a href="${buildUrl({ actor_type: type })}" style="${filterBadge('actor_type', type, actorType)}">${type.charAt(0).toUpperCase() + type.slice(1)}</a>`)}
      </div>

      <!-- Since date filter -->
      <form method="GET" action="/audit-log" style="display:flex;align-items:center;gap:0.4rem;margin-left:auto;">
        ${actorType ? html`<input type="hidden" name="actor_type" value="${actorType}" />` : ''}
        ${action ? html`<input type="hidden" name="action" value="${action}" />` : ''}
        <label style="font-size:0.75rem;color:var(--text-muted);">Since:</label>
        <input type="date" name="since" value="${since}"
          style="padding:4px 8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:var(--text-primary);font-size:0.78rem;" />
        <button type="submit" class="btn btn-ghost" style="font-size:0.78rem;padding:4px 10px;">Filter</button>
        ${since ? html`<a href="${buildUrl({ since: '' })}" class="btn btn-ghost" style="font-size:0.78rem;padding:4px 10px;">Clear</a>` : ''}
      </form>
    </div>

    <!-- Table -->
    <div class="card" style="padding:0;overflow:hidden;overflow-x:auto;">
      ${entries.length === 0
        ? html`<div style="padding:3rem;text-align:center;color:var(--text-muted);font-size:0.9rem;">No audit log entries found${actorType ? ` for ${actorType}` : ''}${since ? ` since ${since}` : ''}.</div>`
        : html`
          <table style="width:100%;border-collapse:collapse;min-width:700px;">
            <thead>
              <tr style="border-bottom:1px solid rgba(255,255,255,0.08);">
                <th style="padding:0.6rem 0.875rem;text-align:left;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Time</th>
                <th style="padding:0.6rem 0.875rem;text-align:left;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Actor</th>
                <th style="padding:0.6rem 0.875rem;text-align:left;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Action</th>
                <th style="padding:0.6rem 0.875rem;text-align:left;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Resource</th>
                <th style="padding:0.6rem 0.875rem;text-align:left;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Details</th>
                <th style="padding:0.6rem 0.875rem;text-align:left;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">IP</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
        `}
    </div>

    <!-- Pagination -->
    ${totalPages > 1 ? html`
    <div style="display:flex;justify-content:center;align-items:center;gap:0.75rem;margin-top:1.25rem;">
      ${page > 1
        ? html`<a href="${buildUrl({ page: String(page - 1) })}" class="btn btn-ghost btn-sm" style="font-size:0.78rem;">Previous</a>`
        : html`<span class="btn btn-ghost btn-sm" style="font-size:0.78rem;opacity:0.3;pointer-events:none;">Previous</span>`}
      <span style="font-size:0.8rem;color:var(--text-muted);">Page ${page} of ${totalPages}</span>
      ${page < totalPages
        ? html`<a href="${buildUrl({ page: String(page + 1) })}" class="btn btn-ghost btn-sm" style="font-size:0.78rem;">Next</a>`
        : html`<span class="btn btn-ghost btn-sm" style="font-size:0.78rem;opacity:0.3;pointer-events:none;">Next</span>`}
    </div>` : ''}
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── GET /audit-log/export — CSV Export ───────────────────────────────────────

auditLog.get('/audit-log/export', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'audit-log', 'Audit Log', undefined, c);

  if (!ctx.productId) {
    return c.json({ error: 'No product selected' }, 400);
  }

  const productId = ctx.productId;
  const actorType = c.req.query('actor_type') ?? '';
  const action = c.req.query('action') ?? '';
  const since = c.req.query('since') ?? '';

  let sql = `SELECT * FROM agent_audit_log WHERE product_id=?`;
  const params: unknown[] = [productId];

  if (actorType) {
    sql += ` AND actor_type=?`;
    params.push(actorType);
  }
  if (action) {
    sql += ` AND action=?`;
    params.push(action);
  }
  if (since) {
    sql += ` AND created_at >= ?`;
    params.push(since);
  }

  sql += ` ORDER BY created_at DESC`;

  const result = await query(sql, params);
  const entries = result.rows as Array<Record<string, unknown>>;

  // Build CSV
  const csvHeaders = ['created_at', 'actor_type', 'actor_name', 'actor_id', 'action', 'resource_type', 'resource_id', 'details', 'ip_address'];
  const csvRows = entries.map((e) => {
    // One escaper, shared with the privacy export. Both quoted correctly for
    // RFC 4180 and neither neutralised a formula; the audit log carries
    // `reasoning` and `trigger` strings that can hold content from outside.
    return csvRow(csvHeaders, e as Record<string, unknown>);
  });

  const csv = [csvHeaders.join(','), ...csvRows].join('\n');
  const today = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="audit-log-${today}.csv"`,
    },
  });
});
