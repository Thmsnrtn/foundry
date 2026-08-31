// =============================================================================
// FOUNDRY — Agent Remediations Dashboard
// Lists all remediations created by SCP agents (Atlas, Crucible, Sentinel).
// GET  /agents/remediations         — Full remediation queue
// POST /agents/remediations/:id/resolve  — Mark resolved (PRG)
// POST /agents/remediations/:id/dismiss  — Mark dismissed (PRG)
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { buildSharedContext } from './_shared.js';
import { dashboardLayout } from '../../views/layout.js';
import {
  getPendingRemediations,
  getRemediationSummary,
  resolveRemediation,
  dismissRemediation,
} from '../../services/scp/remediation.js';
import type { RemediationItem } from '../../services/scp/remediation.js';
import type { AgentName } from '../../services/scp/types.js';
import { requireCompanyCapability } from '../../middleware/rbac.js';

export const agentRemediationRoutes = new Hono<AuthEnv>();

// ─── Severity helpers ─────────────────────────────────────────────────────────

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#ff6b6b',
  high:     '#ff9800',
  medium:   '#ffb347',
  low:      '#9ca3af',
};

const SEVERITY_BG: Record<string, string> = {
  critical: 'rgba(255,107,107,0.15)',
  high:     'rgba(255,152,0,0.12)',
  medium:   'rgba(255,179,71,0.10)',
  low:      'rgba(156,163,175,0.10)',
};

const AGENT_COLOR: Record<string, string> = {
  atlas:    '#7c6af7',
  crucible: '#22c55e',
  sentinel: '#38bdf8',
};

function severityBadge(severity: string): string {
  const color = SEVERITY_COLOR[severity] ?? '#9ca3af';
  const bg = SEVERITY_BG[severity] ?? 'rgba(156,163,175,0.1)';
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;text-transform:uppercase;color:${color};background:${bg};border:1px solid ${color}33;">${severity}</span>`;
}

function agentBadge(agentName: string): string {
  const color = AGENT_COLOR[agentName] ?? '#6b7280';
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:500;color:${color};background:${color}1a;border:1px solid ${color}33;">${agentName}</span>`;
}

function remediationTypeLabel(t: string): string {
  const map: Record<string, string> = {
    code_quality:  'Code Quality',
    security:      'Security',
    test_coverage: 'Test Coverage',
    infra:         'Infrastructure',
    performance:   'Performance',
    compliance:    'Compliance',
  };
  return map[t] ?? t;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

// ─── GET /agents/remediations ─────────────────────────────────────────────────

agentRemediationRoutes.get('/agents/remediations', async (c) => {
  const ctx = await buildSharedContext(c);
  if (!ctx.product) return c.redirect('/products');

  const filter = c.req.query('filter') ?? 'all';
  const productId = ctx.product.id;

  const [summary, items] = await Promise.all([
    getRemediationSummary(productId),
    getPendingRemediations(productId, { limit: 200 }),
  ]);

  // Apply filter
  let filtered: RemediationItem[] = items;
  if (filter === 'critical') {
    filtered = items.filter((i) => i.severity === 'critical');
  } else if (filter === 'high') {
    filtered = items.filter((i) => i.severity === 'high');
  } else if (filter === 'atlas' || filter === 'crucible' || filter === 'sentinel') {
    filtered = items.filter((i) => i.agent_name === (filter as AgentName));
  }

  const agentCounts = summary.by_agent;

  const successMsg = c.req.query('success');

  const content = html`
    <div class="page-header" style="margin-bottom:1.5rem;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:1rem;">
        <div>
          <h1 style="margin:0 0 0.25rem;">Remediation Queue</h1>
          <p style="color:var(--text-dim);margin:0;">Agent-identified issues requiring action.</p>
        </div>
        <div style="display:flex;gap:1rem;flex-wrap:wrap;">
          <div style="background:var(--bg-card);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:0.75rem 1.25rem;text-align:center;">
            <div style="font-size:1.75rem;font-weight:700;color:var(--text-primary);">${summary.open}</div>
            <div style="font-size:12px;color:var(--text-muted);">Open</div>
          </div>
          <div style="background:var(--bg-card);border:1px solid ${summary.critical > 0 ? '#ff6b6b44' : 'rgba(255,255,255,0.08)'};border-radius:8px;padding:0.75rem 1.25rem;text-align:center;">
            <div style="font-size:1.75rem;font-weight:700;color:${summary.critical > 0 ? '#ff6b6b' : 'var(--text-primary)'};">${summary.critical}</div>
            <div style="font-size:12px;color:var(--text-muted);">Critical</div>
          </div>
          <div style="background:var(--bg-card);border:1px solid ${summary.high > 0 ? '#ff980044' : 'rgba(255,255,255,0.08)'};border-radius:8px;padding:0.75rem 1.25rem;text-align:center;">
            <div style="font-size:1.75rem;font-weight:700;color:${summary.high > 0 ? '#ff9800' : 'var(--text-primary)'};">${summary.high}</div>
            <div style="font-size:12px;color:var(--text-muted);">High</div>
          </div>
        </div>
      </div>
    </div>

    ${successMsg ? html`
      <div style="background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);border-radius:8px;padding:0.75rem 1rem;margin-bottom:1rem;color:#22c55e;font-size:14px;">
        ${successMsg === 'resolved' ? 'Remediation marked as resolved.' : 'Remediation dismissed.'}
      </div>
    ` : ''}

    <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1.5rem;">
      ${[
        { key: 'all',      label: `All (${summary.open})` },
        { key: 'critical', label: `Critical (${summary.critical})` },
        { key: 'high',     label: `High (${summary.high})` },
        { key: 'atlas',    label: `Atlas (${agentCounts['atlas'] ?? 0})` },
        { key: 'crucible', label: `Crucible (${agentCounts['crucible'] ?? 0})` },
        { key: 'sentinel', label: `Sentinel (${agentCounts['sentinel'] ?? 0})` },
      ].map(({ key, label }) => `
        <a href="/agents/remediations?filter=${key}"
           style="padding:6px 14px;border-radius:6px;font-size:13px;font-weight:500;text-decoration:none;
                  background:${filter === key ? 'var(--accent)' : 'var(--bg-card)'};
                  color:${filter === key ? '#fff' : 'var(--text-dim)'};
                  border:1px solid ${filter === key ? 'var(--accent)' : 'rgba(255,255,255,0.08)'};">
          ${label}
        </a>
      `).join('')}
    </div>

    ${filtered.length === 0 ? html`
      <div style="text-align:center;padding:3rem;color:var(--text-muted);">
        <div style="font-size:2rem;margin-bottom:0.5rem;">✓</div>
        <div style="font-size:16px;font-weight:500;margin-bottom:0.25rem;">No remediations in this category</div>
        <div style="font-size:13px;">Agents will surface new items as they run.</div>
      </div>
    ` : html`
      <div>
        ${filtered.map((item) => `
          <div class="card" style="padding:1.25rem;margin-bottom:1rem;border-left:3px solid ${SEVERITY_COLOR[item.severity] ?? '#6b7280'};">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
              <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.5rem;">
                  ${severityBadge(item.severity)}
                  ${agentBadge(item.agent_name)}
                  <span style="font-size:11px;color:var(--text-muted);background:rgba(255,255,255,0.06);padding:2px 8px;border-radius:4px;">${remediationTypeLabel(item.remediation_type)}</span>
                </div>
                <h3 style="margin:0 0 0.4rem;font-size:15px;font-weight:600;color:var(--text-primary);">${item.title}</h3>
                <p style="margin:0 0 0.75rem;font-size:13px;color:var(--text-dim);line-height:1.5;">${item.description}</p>
                ${item.suggested_fix ? `
                  <div style="background:rgba(255,255,255,0.04);border-radius:6px;padding:0.6rem 0.75rem;margin-bottom:0.5rem;">
                    <span style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Suggested fix</span>
                    <p style="margin:0.25rem 0 0;font-size:13px;color:var(--text-dim);">${item.suggested_fix}</p>
                  </div>
                ` : ''}
                ${item.affected_area ? `<div style="font-size:12px;color:var(--text-muted);">Affected: <span style="color:var(--text-dim);">${item.affected_area}</span></div>` : ''}
                ${item.estimated_effort ? `<div style="font-size:12px;color:var(--text-muted);">Effort: <span style="color:var(--text-dim);">${item.estimated_effort}</span></div>` : ''}
                <div style="font-size:11px;color:var(--text-muted);margin-top:0.5rem;">Created ${formatDate(item.created_at)}</div>
              </div>
              <div style="display:flex;flex-direction:column;gap:0.5rem;min-width:120px;">
                <form method="POST" action="/agents/remediations/${item.id}/resolve">
                  <button type="submit" style="width:100%;padding:6px 12px;background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.3);border-radius:6px;color:#22c55e;font-size:12px;font-weight:600;cursor:pointer;">
                    Mark Resolved
                  </button>
                </form>
                <details style="position:relative;">
                  <summary style="list-style:none;padding:6px 12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:var(--text-muted);font-size:12px;font-weight:500;cursor:pointer;text-align:center;">
                    Dismiss
                  </summary>
                  <div style="position:absolute;right:0;top:100%;margin-top:4px;z-index:10;background:var(--bg-card);border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:0.75rem;width:240px;box-shadow:0 8px 24px rgba(0,0,0,0.4);">
                    <form method="POST" action="/agents/remediations/${item.id}/dismiss">
                      <label style="display:block;font-size:12px;color:var(--text-dim);margin-bottom:0.4rem;">Reason for dismissal</label>
                      <input name="reason" type="text" placeholder="e.g. Not applicable, already fixed..." required
                        style="width:100%;padding:6px 8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:var(--text-primary);font-size:12px;margin-bottom:0.5rem;box-sizing:border-box;" />
                      <button type="submit" style="width:100%;padding:6px 12px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);border-radius:6px;color:#ef4444;font-size:12px;font-weight:600;cursor:pointer;">
                        Confirm Dismiss
                      </button>
                    </form>
                  </div>
                </details>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `}
  `;

  return c.html(dashboardLayout({ ...ctx, title: 'Remediation Queue', activeNav: 'agents' }, content));
});

// ─── POST /agents/remediations/:id/resolve ───────────────────────────────────

agentRemediationRoutes.post('/agents/remediations/:id/resolve',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const ctx = await buildSharedContext(c);
  if (!ctx.product) return c.redirect('/products');

  const id = c.req.param('id');
  await resolveRemediation(id, ctx.product.id);
  return c.redirect('/agents/remediations?success=resolved');
});

// ─── POST /agents/remediations/:id/dismiss ───────────────────────────────────

agentRemediationRoutes.post('/agents/remediations/:id/dismiss',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const ctx = await buildSharedContext(c);
  if (!ctx.product) return c.redirect('/products');

  const id = c.req.param('id');
  const body = await c.req.parseBody();
  const reason = String(body['reason'] ?? 'No reason provided');
  await dismissRemediation(id, ctx.product.id, reason);
  return c.redirect('/agents/remediations?success=dismissed');
});
