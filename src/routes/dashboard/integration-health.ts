// =============================================================================
// FOUNDRY — Integration Health Dashboard Routes
// Real-time integration status, data freshness, and signal event feed.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import { requireCompanyCapability } from '../../middleware/rbac.js';
import {
  getIntegrationHealth,
  getHealthSummary,
  computeIntegrationStatuses,
} from '../../services/integrations/health-monitor.js';
import {
  getSignalEvents,
  getUnprocessedCount,
  processPendingSignalEvents,
} from '../../services/scp/events/dispatcher.js';

export const integrationHealth = new Hono<AuthEnv>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtRelTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function statusColor(status: string): string {
  switch (status) {
    case 'healthy':  return '#4ecca3';
    case 'degraded': return '#ffb347';
    case 'stale':    return '#ffb347';
    case 'error':    return '#ff6b6b';
    default:         return 'var(--text-muted)';
  }
}

function statusDot(status: string): string {
  const color = statusColor(status);
  return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px;vertical-align:middle;"></span>`;
}

function severityBadge(severity: string): string {
  let bg: string;
  let text: string;
  switch (severity) {
    case 'critical': bg = '#ff6b6b'; text = '#000'; break;
    case 'high':     bg = '#ff9f43'; text = '#000'; break;
    case 'medium':   bg = '#ffb347'; text = '#000'; break;
    default:         bg = 'rgba(255,255,255,0.12)'; text = 'var(--text-dim)'; break;
  }
  return `<span style="display:inline-block;padding:1px 7px;border-radius:10px;font-size:0.68rem;font-weight:700;background:${bg};color:${text};letter-spacing:0.04em;text-transform:uppercase;">${severity}</span>`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── GET /integrations/health — Integration Health Dashboard ─────────────────

integrationHealth.get('/integrations/health', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'integrations', 'Integration Health', undefined, c);

  if (!ctx.productId) {
    const content = html`
      <h1 style="margin:0 0 0.5rem;">Integration Health</h1>
      <p style="color:var(--text-dim);">No product selected.</p>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;

  // Refresh computed statuses before displaying
  await computeIntegrationStatuses(productId).catch(() => {});

  const [integrations, summary, unprocessedCount] = await Promise.all([
    getIntegrationHealth(productId).catch(() => []),
    getHealthSummary(productId).catch(() => ({
      healthy: 0, degraded: 0, stale: 0, error: 0,
      worst_status: 'unknown', action_needed: null,
    })),
    getUnprocessedCount(productId).catch(() => 0),
  ]);

  const actionBanner = summary.action_needed
    ? html`
      <div style="background:rgba(255,107,107,0.1);border:1px solid rgba(255,107,107,0.3);border-radius:8px;padding:0.85rem 1.1rem;margin-bottom:1.5rem;display:flex;align-items:center;gap:0.75rem;">
        <span style="color:#ff6b6b;font-size:1.1rem;">!</span>
        <span style="font-size:0.85rem;color:var(--text-primary);">${summary.action_needed}</span>
      </div>`
    : '';

  const statsBar = html`
    <div style="display:flex;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap;">
      <div class="card" style="padding:0.85rem 1.25rem;flex:1;min-width:120px;">
        <div style="font-size:0.62rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:0.3rem;">Healthy</div>
        <div style="font-size:1.4rem;font-weight:700;color:#4ecca3;">${summary.healthy}</div>
      </div>
      <div class="card" style="padding:0.85rem 1.25rem;flex:1;min-width:120px;">
        <div style="font-size:0.62rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:0.3rem;">Degraded</div>
        <div style="font-size:1.4rem;font-weight:700;color:#ffb347;">${summary.degraded}</div>
      </div>
      <div class="card" style="padding:0.85rem 1.25rem;flex:1;min-width:120px;">
        <div style="font-size:0.62rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:0.3rem;">Stale</div>
        <div style="font-size:1.4rem;font-weight:700;color:#ffb347;">${summary.stale}</div>
      </div>
      <div class="card" style="padding:0.85rem 1.25rem;flex:1;min-width:120px;">
        <div style="font-size:0.62rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:0.3rem;">Error</div>
        <div style="font-size:1.4rem;font-weight:700;color:#ff6b6b;">${summary.error}</div>
      </div>
      <div class="card" style="padding:0.85rem 1.25rem;flex:1;min-width:120px;">
        <div style="font-size:0.62rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:0.3rem;">Pending Signals</div>
        <div style="font-size:1.4rem;font-weight:700;color:${unprocessedCount > 0 ? '#ffb347' : 'var(--text-dim)'};">${unprocessedCount}</div>
      </div>
    </div>`;

  const integrationRows = integrations.length === 0
    ? html`<tr><td colspan="4" style="padding:2rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">No integrations tracked yet. Events will appear here as data flows in.</td></tr>`
    : integrations.map((integ) => html`
      <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
        <td style="padding:0.75rem 1rem;">
          <span style="font-weight:600;font-size:0.85rem;color:var(--text-primary);">${cap(integ.source)}</span>
        </td>
        <td style="padding:0.75rem 1rem;">
          ${html`${statusDot(integ.status)}`}<span style="font-size:0.82rem;color:${statusColor(integ.status)};font-weight:600;">${cap(integ.status)}</span>
        </td>
        <td style="padding:0.75rem 1rem;font-size:0.8rem;color:var(--text-dim);">
          ${integ.data_freshness_hours !== null
            ? (integ.data_freshness_hours < 1
                ? `${Math.round(integ.data_freshness_hours * 60)}m`
                : integ.data_freshness_hours < 24
                  ? `${Math.round(integ.data_freshness_hours)}h`
                  : `${Math.floor(integ.data_freshness_hours / 24)}d`)
            : '—'}
        </td>
        <td style="padding:0.75rem 1rem;font-size:0.8rem;color:var(--text-dim);max-width:320px;">${integ.status_message}</td>
      </tr>`);

  const integTable = html`
    <div style="margin-bottom:2rem;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.75rem;">Integration Status</div>
      <div class="card" style="padding:0;overflow:hidden;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid rgba(255,255,255,0.08);">
              <th style="padding:0.7rem 1rem;text-align:left;font-size:0.63rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Source</th>
              <th style="padding:0.7rem 1rem;text-align:left;font-size:0.63rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Status</th>
              <th style="padding:0.7rem 1rem;text-align:left;font-size:0.63rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Freshness</th>
              <th style="padding:0.7rem 1rem;text-align:left;font-size:0.63rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Message</th>
            </tr>
          </thead>
          <tbody>${integrationRows}</tbody>
        </table>
      </div>
    </div>`;

  const signalsLink = html`
    <div style="margin-bottom:1.5rem;display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap;">
      <a href="/integrations/health/signals" style="font-size:0.82rem;color:var(--text-dim);text-decoration:none;border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:0.4rem 0.85rem;">View Signal Feed →</a>
      ${unprocessedCount > 0
        ? html`
          <form method="POST" action="/integrations/health/process" style="margin:0;">
            <button type="submit" style="font-size:0.82rem;background:rgba(78,204,163,0.1);color:#4ecca3;border:1px solid rgba(78,204,163,0.3);border-radius:6px;padding:0.4rem 0.85rem;cursor:pointer;">
              Process ${unprocessedCount} Pending Signal${unprocessedCount > 1 ? 's' : ''}
            </button>
          </form>`
        : ''}
    </div>`;

  const content = html`
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:0.5rem;">
      <h1 style="margin:0;">Integration Health</h1>
      <span style="font-size:0.78rem;color:var(--text-muted);">Real-time data pipeline status</span>
    </div>
    ${actionBanner}
    ${statsBar}
    ${integTable}
    ${signalsLink}
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── GET /integrations/health/signals — Signal Event Feed ────────────────────

integrationHealth.get('/integrations/health/signals', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'integrations', 'Signal Feed', undefined, c);

  if (!ctx.productId) {
    const content = html`
      <h1 style="margin:0 0 0.5rem;">Signal Feed</h1>
      <p style="color:var(--text-dim);">No product selected.</p>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;
  const events = await getSignalEvents(productId, 50).catch(() => []);

  const eventRows = events.length === 0
    ? html`<tr><td colspan="5" style="padding:2rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">No signal events yet. Events appear here when integrations send data.</td></tr>`
    : events.map((ev) => {
        const severity = (ev.severity as string) ?? 'medium';
        const processedAt = ev.processed_at as string | null;
        const relevantAgents: string[] = (() => {
          try { return JSON.parse((ev.relevant_agents_json as string) ?? '[]') as string[]; }
          catch { return []; }
        })();

        return html`
        <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
          <td style="padding:0.7rem 1rem;white-space:nowrap;">
            ${html`${severityBadge(severity)}`}
          </td>
          <td style="padding:0.7rem 1rem;font-size:0.82rem;color:var(--text-dim);">
            <span style="font-weight:600;color:var(--text-primary);">${cap(ev.source as string)}</span>
            <span style="font-size:0.75rem;color:var(--text-muted);margin-left:0.5rem;">${ev.event_type as string}</span>
          </td>
          <td style="padding:0.7rem 1rem;font-size:0.82rem;color:var(--text-dim);max-width:280px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">
            ${ev.summary as string}
          </td>
          <td style="padding:0.7rem 1rem;font-size:0.75rem;color:var(--text-muted);">
            ${relevantAgents.length > 0
              ? relevantAgents.map(a => `<span style="display:inline-block;margin-right:4px;padding:1px 5px;background:rgba(255,255,255,0.06);border-radius:4px;">${a}</span>`).join('')
              : '<span style="color:var(--text-muted);">—</span>'}
          </td>
          <td style="padding:0.7rem 1rem;white-space:nowrap;font-size:0.75rem;">
            ${processedAt
              ? html`<span style="color:#4ecca3;">Processed ${fmtRelTime(processedAt)}</span>`
              : html`<span style="color:#ffb347;">Pending</span>`}
          </td>
        </tr>`;
      });

  const content = html`
    <div style="margin-bottom:1.5rem;display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;">
      <div>
        <a href="/integrations/health" style="font-size:0.82rem;color:var(--text-dim);text-decoration:none;">← Integration Health</a>
        <h1 style="margin:0.5rem 0 0;">Signal Feed</h1>
      </div>
      <span style="font-size:0.78rem;color:var(--text-muted);">Last 50 events</span>
    </div>

    <div class="card" style="padding:0;overflow:hidden;">
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.08);">
            <th style="padding:0.7rem 1rem;text-align:left;font-size:0.63rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Severity</th>
            <th style="padding:0.7rem 1rem;text-align:left;font-size:0.63rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Source / Type</th>
            <th style="padding:0.7rem 1rem;text-align:left;font-size:0.63rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Summary</th>
            <th style="padding:0.7rem 1rem;text-align:left;font-size:0.63rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Agents Triggered</th>
            <th style="padding:0.7rem 1rem;text-align:left;font-size:0.63rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Status</th>
          </tr>
        </thead>
        <tbody>${eventRows}</tbody>
      </table>
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /integrations/health/process — Manually trigger pending processing ──

integrationHealth.post('/integrations/health/process',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'integrations', 'Integration Health', undefined, c);

  if (!ctx.productId) {
    return c.redirect('/integrations/health');
  }

  const count = await processPendingSignalEvents(ctx.productId).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[integration-health] processPendingSignalEvents failed: ${msg}`);
    return 0;
  });

  return c.redirect(`/integrations/health?processed=${count}`);
});
