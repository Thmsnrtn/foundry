// =============================================================================
// FOUNDRY — FleetObservatory route (Phase 4.2)
// One screen showing every agent's status across all of a founder's products.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import { getFleetOverview, type FleetAgent } from '../../services/fleet/observatory.js';

export const fleetRoutes = new Hono<AuthEnv>();

function fmtWhen(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diffMin = Math.round((t - Date.now()) / 60000);
  const abs = Math.abs(diffMin);
  const unit = abs >= 1440 ? `${Math.round(abs / 1440)}d` : abs >= 60 ? `${Math.round(abs / 60)}h` : `${abs}m`;
  return diffMin >= 0 ? `in ${unit}` : `${unit} ago`;
}

function statusColor(status: string): string {
  return status === 'active' ? '#4ecca3' : status === 'paused' ? '#ffb347' : '#ff6b6b';
}

function healthColor(score: number | null): string {
  if (score === null) return '#64748b';
  return score >= 70 ? '#4ecca3' : score >= 40 ? '#ffb347' : '#ff6b6b';
}

function agentRow(a: FleetAgent) {
  return html`
    <tr>
      <td style="padding:0.4rem 0.6rem;">${a.displayName}</td>
      <td style="padding:0.4rem 0.6rem;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusColor(a.status)};margin-right:0.4rem;"></span>${a.status}
      </td>
      <td style="padding:0.4rem 0.6rem;color:#94a3b8;">${fmtWhen(a.lastRunAt)}</td>
      <td style="padding:0.4rem 0.6rem;color:#94a3b8;">${fmtWhen(a.nextRunAt)}</td>
      <td style="padding:0.4rem 0.6rem;color:${healthColor(a.healthScore)};">${a.healthScore ?? '—'}</td>
    </tr>`;
}

fleetRoutes.get('/fleet', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'fleet', 'Fleet Observatory', undefined, c);
  const fleet = await getFleetOverview(founder.id);

  const content = html`
    <div class="section-header" style="display:flex;align-items:baseline;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
      <h1>Fleet Observatory</h1>
      <span class="text-muted" style="font-size:0.85rem;">
        ${fleet.totals.products} product${fleet.totals.products === 1 ? '' : 's'} ·
        ${fleet.totals.activeAgents}/${fleet.totals.agents} agents active ·
        ${fleet.totals.pendingDecisions} decision${fleet.totals.pendingDecisions === 1 ? '' : 's'} pending
      </span>
    </div>

    ${fleet.products.length === 0 ? html`
      <div class="card" style="margin-top:1rem;text-align:center;padding:2rem;color:#94a3b8;">
        No active products yet. <a href="/onboarding" style="color:#a5b4fc;">Connect one</a> to populate the fleet.
      </div>` : fleet.products.map((p) => html`
      <div class="card" style="margin-top:1.25rem;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:0.5rem;flex-wrap:wrap;">
          <h2 style="margin:0;font-size:1.1rem;">
            ${p.productName}
            <span style="font-size:0.7rem;color:${statusColor(p.scpStatus ?? 'active')};margin-left:0.5rem;">${p.scpStatus ?? 'active'}</span>
          </h2>
          <div style="display:flex;gap:1rem;font-size:0.8rem;color:#94a3b8;">
            <span>next run ${fmtWhen(p.nextRunAt)}</span>
            ${p.pendingDecisions > 0
              ? html`<a href="/decisions" style="color:#ffb347;">${p.pendingDecisions} pending</a>`
              : html`<span>0 pending</span>`}
          </div>
        </div>
        ${p.agents.length === 0 ? html`<p class="text-muted" style="font-size:0.85rem;margin:0;">No agents provisioned yet.</p>` : html`
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
            <thead>
              <tr style="text-align:left;color:#64748b;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;">
                <th style="padding:0.4rem 0.6rem;">Agent</th>
                <th style="padding:0.4rem 0.6rem;">Status</th>
                <th style="padding:0.4rem 0.6rem;">Last run</th>
                <th style="padding:0.4rem 0.6rem;">Next run</th>
                <th style="padding:0.4rem 0.6rem;">Health</th>
              </tr>
            </thead>
            <tbody>${p.agents.map(agentRow)}</tbody>
          </table>
        </div>`}
      </div>`)}
  `;
  return c.html(dashboardLayout(ctx, content));
});
