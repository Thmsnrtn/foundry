// =============================================================================
// FOUNDRY — Priority API Routes ("One Thing" System)
// HTMX fragment endpoints for the One Thing banner.
// =============================================================================

import { Hono } from 'hono';
import type { AuthEnv } from '../../middleware/auth.js';
import { query } from '../../db/client.js';
import {
  getTopPriorityAction,
  dismissAction,
  completeAction,
} from '../../services/scp/priority/ranker.js';

export const priorityApi = new Hono<AuthEnv>();

// ─── Source badge colors ──────────────────────────────────────────────────────

const SOURCE_COLORS: Record<string, string> = {
  harbor:            '#0ea5e9',
  forge:             '#f97316',
  ledger:            '#22c55e',
  atlas:             '#8b5cf6',
  beacon:            '#ec4899',
  sentinel:          '#ef4444',
  failure_pattern:   '#dc2626',
  execution_playbook: '#d97706',
  execution_engine:  '#6366f1',
};

function sourceBadgeStyle(source: string): string {
  const color = SOURCE_COLORS[source] ?? '#6b7280';
  return `background:${color}20;color:${color};border:1px solid ${color}40;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;white-space:nowrap;`;
}

const ACTION_TYPE_LABELS: Record<string, string> = {
  outreach: 'Reach out',
  decision: 'Decide',
  review:   'Review',
  execute:  'Execute',
  defer:    'Defer',
};

// ── GET /api/priority/one-thing ───────────────────────────────────────────────
// Returns an HTML fragment (not full page) for HTMX injection.
// Compact strip, max-height ~60px.

priorityApi.get('/api/priority/one-thing', async (c) => {
  const founder = c.get('founder');

  // Resolve product
  const products = await query('SELECT id FROM products WHERE owner_id = ?', [founder.id]);
  if (products.rows.length === 0) {
    return c.html(_renderAllClear());
  }
  const productId = (products.rows[0] as Record<string, string>).id;

  const action = await getTopPriorityAction(productId).catch(() => null);
  if (!action) {
    return c.html(_renderAllClear());
  }

  const actionLabel = ACTION_TYPE_LABELS[action.action_type] ?? 'Act';
  const deadlineText = action.deadline_hours != null
    ? `${action.deadline_hours}h`
    : null;

  const html = `<div style="display:flex;align-items:center;gap:12px;padding:10px 16px;background:#fafafa;border:1px solid #e5e7eb;border-radius:8px;min-height:44px;max-height:60px;overflow:hidden;font-family:inherit;">
  <span style="${sourceBadgeStyle(action.source)}">${action.source}</span>
  <span style="flex:1;font-size:13px;font-weight:500;color:#111827;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${_escAttr(action.title)}">${_escHtml(action.title)}</span>
  ${deadlineText ? `<span style="font-size:11px;color:#9ca3af;white-space:nowrap;">⏱ ${_escHtml(deadlineText)}</span>` : ''}
  ${action.action_url
    ? `<a href="${_escAttr(action.action_url)}" style="font-size:12px;font-weight:600;color:#fff;background:#111827;border:none;border-radius:5px;padding:4px 12px;cursor:pointer;text-decoration:none;white-space:nowrap;">${_escHtml(actionLabel)}</a>`
    : `<span style="font-size:12px;font-weight:600;color:#6b7280;white-space:nowrap;">${_escHtml(actionLabel)}</span>`
  }
  <button
    hx-post="/api/priority/${_escAttr(action.id)}/dismiss"
    hx-target="#one-thing-banner"
    hx-swap="innerHTML"
    style="font-size:11px;color:#9ca3af;background:none;border:none;cursor:pointer;padding:2px 4px;white-space:nowrap;"
    title="Dismiss"
  >✕</button>
</div>`;

  return c.html(html);
});

// ── POST /api/priority/:id/dismiss ────────────────────────────────────────────

priorityApi.post('/api/priority/:id/dismiss', async (c) => {
  const founder = c.get('founder');
  const actionId = c.req.param('id');

  // Verify the action belongs to this founder's product
  const products = await query('SELECT id FROM products WHERE owner_id = ?', [founder.id]);
  if (products.rows.length > 0) {
    const productId = (products.rows[0] as Record<string, string>).id;
    // Only dismiss if it belongs to this product
    const check = await query(
      'SELECT id FROM priority_actions WHERE id = ? AND product_id = ?',
      [actionId, productId]
    );
    if (check.rows.length > 0) {
      await dismissAction(actionId).catch(() => {});
    }
  }

  // Re-render the banner with the next top action
  const nextProductId = products.rows.length > 0
    ? (products.rows[0] as Record<string, string>).id
    : null;
  const next = nextProductId
    ? await getTopPriorityAction(nextProductId).catch(() => null)
    : null;

  if (!next) return c.html(_renderAllClear());

  const actionLabel = ACTION_TYPE_LABELS[next.action_type] ?? 'Act';
  const deadlineText = next.deadline_hours != null ? `${next.deadline_hours}h` : null;

  const html = `<div style="display:flex;align-items:center;gap:12px;padding:10px 16px;background:#fafafa;border:1px solid #e5e7eb;border-radius:8px;min-height:44px;max-height:60px;overflow:hidden;font-family:inherit;">
  <span style="${sourceBadgeStyle(next.source)}">${next.source}</span>
  <span style="flex:1;font-size:13px;font-weight:500;color:#111827;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${_escAttr(next.title)}">${_escHtml(next.title)}</span>
  ${deadlineText ? `<span style="font-size:11px;color:#9ca3af;white-space:nowrap;">⏱ ${_escHtml(deadlineText)}</span>` : ''}
  ${next.action_url
    ? `<a href="${_escAttr(next.action_url)}" style="font-size:12px;font-weight:600;color:#fff;background:#111827;border:none;border-radius:5px;padding:4px 12px;cursor:pointer;text-decoration:none;white-space:nowrap;">${_escHtml(actionLabel)}</a>`
    : `<span style="font-size:12px;font-weight:600;color:#6b7280;white-space:nowrap;">${_escHtml(actionLabel)}</span>`
  }
  <button
    hx-post="/api/priority/${_escAttr(next.id)}/dismiss"
    hx-target="#one-thing-banner"
    hx-swap="innerHTML"
    style="font-size:11px;color:#9ca3af;background:none;border:none;cursor:pointer;padding:2px 4px;white-space:nowrap;"
    title="Dismiss"
  >✕</button>
</div>`;

  return c.html(html);
});

// ── POST /api/priority/:id/complete ───────────────────────────────────────────

priorityApi.post('/api/priority/:id/complete', async (c) => {
  const founder = c.get('founder');
  const actionId = c.req.param('id');

  const products = await query('SELECT id FROM products WHERE owner_id = ?', [founder.id]);
  if (products.rows.length > 0) {
    const productId = (products.rows[0] as Record<string, string>).id;
    const check = await query(
      'SELECT id FROM priority_actions WHERE id = ? AND product_id = ?',
      [actionId, productId]
    );
    if (check.rows.length > 0) {
      await completeAction(actionId).catch(() => {});
    }
  }

  return c.json({ status: 'completed' });
});

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _renderAllClear(): string {
  return `<div style="display:flex;align-items:center;gap:8px;padding:10px 16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;min-height:44px;max-height:60px;font-family:inherit;">
  <span style="color:#16a34a;font-size:13px;font-weight:500;">All clear — no urgent actions right now</span>
</div>`;
}

function _escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _escAttr(str: string): string {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
