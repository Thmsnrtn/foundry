// =============================================================================
// FOUNDRY — Portfolio View (Fleet Triage Dashboard)
// Shown when a founder has 2+ products. Each product shows its Signal,
// risk state, and pending decision count for at-a-glance fleet triage.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { getProductsByOwner, getPendingDecisions } from '../../db/client.js';
import { requireTier } from '../../middleware/tier-gate.js';
import { computeSignal } from '../../services/signal.js';
import type { SignalResult } from '../../services/signal.js';
import { getFleetInsights } from '../../services/fleet/insights.js';
import { layout } from '../../views/layout.js';

export const portfolioRoutes = new Hono<AuthEnv>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function riskBadgeStyle(riskState: string): string {
  if (riskState === 'red') return 'background:#ff6b6b22;color:#ff6b6b;border:1px solid #ff6b6b44;';
  if (riskState === 'yellow') return 'background:#ffb34722;color:#ffb347;border:1px solid #ffb34744;';
  return 'background:#4ecca322;color:#4ecca3;border:1px solid #4ecca344;';
}

function riskLabel(riskState: string): string {
  if (riskState === 'red') return 'RED — Recovery';
  if (riskState === 'yellow') return 'YELLOW — Monitoring';
  return 'GREEN — Stable';
}

function signalBarColor(score: number): string {
  if (score >= 70) return '#4ecca3';
  if (score >= 40) return '#ffb347';
  return '#ff6b6b';
}

interface FleetItem {
  product: Record<string, unknown>;
  signal: SignalResult;
  pendingCount: number;
}

portfolioRoutes.get('/portfolio', requireTier('multi_product'), async (c) => {
  const founder = c.get('founder');
  const products = await getProductsByOwner(founder.id);

  if (products.rows.length === 0) return c.redirect('/onboarding');
  if (products.rows.length === 1) {
    // Single product: go directly to dashboard
    return c.redirect('/dashboard');
  }

  const founderName = founder.name ?? founder.email;

  // Compute Signals and pending decisions for all products in parallel
  const productRows = products.rows as Array<Record<string, unknown>>;
  const [signals, pendingCounts, fleetInsights] = await Promise.all([
    Promise.all(productRows.map((p) => computeSignal(p.id as string))),
    Promise.all(productRows.map((p) => getPendingDecisions(p.id as string).then((r) => r.rows.length))),
    getFleetInsights(founder.id).catch(() => []),
  ]);

  // Build fleet items and sort: lowest Signal first (most urgent at top)
  const fleet: FleetItem[] = productRows
    .map((p, i) => ({ product: p, signal: signals[i], pendingCount: pendingCounts[i] }))
    .sort((a, b) => a.signal.score - b.signal.score);

  // Fleet-wide stats
  const totalPending = fleet.reduce((sum, f) => sum + f.pendingCount, 0);
  const redCount = fleet.filter((f) => f.signal.riskState === 'red').length;
  const yellowCount = fleet.filter((f) => f.signal.riskState === 'yellow').length;
  const avgSignal = Math.round(fleet.reduce((sum, f) => sum + f.signal.score, 0) / fleet.length);

  const content = html`
    <div class="portfolio-header" style="margin-bottom:1.5rem;">
      <h1 style="margin:0 0 0.25rem;">Fleet Triage</h1>
      <p style="margin:0;font-size:0.875rem;color:var(--text-dim);">${fleet.length} companies — sorted by urgency</p>
    </div>

    <!-- Fleet Summary Bar -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:0.75rem;margin-bottom:1.75rem;">
      <div class="card" style="padding:0.875rem 1rem;text-align:center;">
        <div style="font-size:1.5rem;font-weight:700;color:var(--text-primary);">${avgSignal}</div>
        <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);font-weight:600;">Avg Signal</div>
      </div>
      <div class="card" style="padding:0.875rem 1rem;text-align:center;">
        <div style="font-size:1.5rem;font-weight:700;color:${redCount > 0 ? '#ff6b6b' : 'var(--text-primary)'};">${redCount}</div>
        <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);font-weight:600;">Red Risk</div>
      </div>
      <div class="card" style="padding:0.875rem 1rem;text-align:center;">
        <div style="font-size:1.5rem;font-weight:700;color:${yellowCount > 0 ? '#ffb347' : 'var(--text-primary)'};">${yellowCount}</div>
        <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);font-weight:600;">Yellow Risk</div>
      </div>
      <div class="card" style="padding:0.875rem 1rem;text-align:center;">
        <div style="font-size:1.5rem;font-weight:700;color:${totalPending > 5 ? '#ffb347' : 'var(--text-primary)'};">${totalPending}</div>
        <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);font-weight:600;">Pending Decisions</div>
      </div>
    </div>

    <!-- Cross-Company Intelligence (fleet slice, 2026-07-13): what anonymized
         peers at the same stage chose on decisions like your open ones.
         Abstains honestly below the 5-peer floor. -->
    <div class="card" style="padding:1.1rem 1.25rem;margin-bottom:1.75rem;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.6rem;">
        What peers did — anonymized, ${fleetInsights.length > 0 ? 'from real recorded outcomes' : 'cross-company intelligence'}
      </div>
      ${fleetInsights.length === 0 ? html`
        <div style="font-size:0.85rem;color:var(--text-muted);">
          No peer signal strong enough for your open decisions yet — Foundry only speaks here when at least 5 founders'
          recorded outcomes match a decision you're facing. It will never pad this card.
        </div>
      ` : fleetInsights.map((ins) => html`
        <div style="padding:0.5rem 0;border-top:1px solid rgba(255,255,255,0.05);">
          <div style="font-size:0.88rem;color:var(--text-primary);">${ins.summary}</div>
          <a href="/decisions/${ins.decisionId}" style="font-size:0.78rem;color:var(--accent);">
            → your open decision: ${ins.decisionWhat} (${ins.productName})
          </a>
        </div>`)}
    </div>

    <!-- Fleet Triage Table -->
    <div class="card" style="padding:0;overflow:hidden;overflow-x:auto;margin-bottom:1.5rem;">
      <table style="width:100%;border-collapse:collapse;min-width:600px;">
        <thead>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.08);">
            <th style="padding:0.65rem 1rem;text-align:left;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Company</th>
            <th style="padding:0.65rem 1rem;text-align:center;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Signal</th>
            <th style="padding:0.65rem 1rem;text-align:center;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Risk</th>
            <th style="padding:0.65rem 1rem;text-align:center;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Pending</th>
            <th style="padding:0.65rem 1rem;text-align:left;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Status</th>
            <th style="padding:0.65rem 1rem;text-align:right;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);"></th>
          </tr>
        </thead>
        <tbody>
          ${fleet.map(({ product, signal, pendingCount }) => html`
          <tr style="border-bottom:1px solid rgba(255,255,255,0.04);transition:background 0.1s;" onmouseover="this.style.background='rgba(255,255,255,0.025)'" onmouseout="this.style.background=''">
            <td style="padding:0.75rem 1rem;">
              <div style="font-size:0.9rem;font-weight:600;color:var(--text-primary);">${product.name as string}</div>
              <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.15rem;">${signal.prose.split('.')[0]}.</div>
            </td>
            <td style="padding:0.75rem 1rem;text-align:center;">
              <div style="display:flex;align-items:center;justify-content:center;gap:0.5rem;">
                <div style="font-size:1.1rem;font-weight:700;color:${signalBarColor(signal.score)};">${signal.score}</div>
                <div style="width:48px;height:6px;border-radius:3px;background:rgba(255,255,255,0.08);overflow:hidden;">
                  <div style="width:${signal.score}%;height:100%;border-radius:3px;background:${signalBarColor(signal.score)};"></div>
                </div>
              </div>
            </td>
            <td style="padding:0.75rem 1rem;text-align:center;">
              <span style="display:inline-block;font-size:0.7rem;font-weight:600;padding:3px 10px;border-radius:99px;white-space:nowrap;${riskBadgeStyle(signal.riskState)}">${riskLabel(signal.riskState)}</span>
            </td>
            <td style="padding:0.75rem 1rem;text-align:center;">
              ${pendingCount > 0
                ? html`<span style="font-size:0.85rem;font-weight:700;color:${pendingCount > 3 ? '#ffb347' : 'var(--text-primary)'};">${pendingCount}</span>`
                : html`<span style="font-size:0.8rem;color:var(--text-muted);">0</span>`}
            </td>
            <td style="padding:0.75rem 1rem;">
              <span style="font-size:0.75rem;color:var(--text-dim);">${(product.status as string) === 'paused' ? 'Paused' : 'Active'}</span>
            </td>
            <td style="padding:0.75rem 1rem;text-align:right;">
              <form method="POST" action="/switch-product" style="display:inline;">
                <input type="hidden" name="product_id" value="${product.id as string}" />
                <button type="submit" class="btn btn-ghost btn-sm" style="font-size:0.78rem;padding:4px 12px;" aria-label="Open dashboard for ${product.name as string}">Open</button>
              </form>
            </td>
          </tr>`)}
        </tbody>
      </table>
    </div>

    <!-- Legacy Card Grid (quick-switch) -->
    <div class="portfolio-grid">
      ${fleet.map(({ product, signal }) => html`
      <form method="POST" action="/switch-product" style="display:contents;">
        <input type="hidden" name="product_id" value="${product.id as string}" />
        <button type="submit" class="portfolio-card tier-${signal.tier}" aria-label="Switch to ${product.name as string}">
          <div class="portfolio-signal-number">${signal.score}</div>
          <div class="portfolio-product-name">${product.name as string}</div>
          <div class="portfolio-product-status">${signal.prose.split('.')[0]}.</div>
        </button>
      </form>`)}
    </div>
  `;

  return c.html(layout(
    {
      title: 'Fleet Triage — Portfolio',
      founderName,
      showNav: false,
    },
    content
  ));
});
