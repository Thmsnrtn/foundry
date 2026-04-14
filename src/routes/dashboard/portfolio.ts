// =============================================================================
// FOUNDRY — Portfolio Dashboard
// Multi-product overview for founders managing multiple SaaS products.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { getProductsByOwner, getLifecycleState, getLatestAudit, getActiveStressors, getPendingDecisions } from '../../db/client.js';
import { calculateHealthScore } from '../../services/intelligence/health-score.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import type { RiskStateValue } from '../../types/index.js';

export const portfolioRoutes = new Hono<AuthEnv>();

portfolioRoutes.get('/dashboard/portfolio', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'dashboard', 'Portfolio', undefined, c);

  const products = await getProductsByOwner(founder.id);
  if (products.rows.length <= 1) {
    return c.redirect('/dashboard');
  }

  // Gather health data for each product in parallel
  const productData = await Promise.all(
    (products.rows as unknown as Array<Record<string, string>>).map(async (p) => {
      const [health, ls, audit, stressors, decisions] = await Promise.all([
        calculateHealthScore(p.id),
        getLifecycleState(p.id),
        getLatestAudit(p.id),
        getActiveStressors(p.id),
        getPendingDecisions(p.id),
      ]);
      const lsRow = ls.rows[0] as Record<string, unknown> | undefined;
      const auditRow = audit.rows[0] as Record<string, unknown> | undefined;
      return {
        id: p.id,
        name: p.name,
        health,
        riskState: (lsRow?.risk_state as RiskStateValue) ?? 'green',
        currentPrompt: (lsRow?.current_prompt as string) ?? 'prompt_1',
        auditScore: auditRow?.composite as number ?? null,
        stressorCount: stressors.rows.length,
        pendingDecisions: decisions.rows.length,
      };
    })
  );

  // Sort by health score (lowest first = needs attention)
  productData.sort((a, b) => a.health.score - b.health.score);

  // Portfolio-level summary
  const avgHealth = Math.round(productData.reduce((sum, p) => sum + p.health.score, 0) / productData.length);
  const totalStressors = productData.reduce((sum, p) => sum + p.stressorCount, 0);
  const totalDecisions = productData.reduce((sum, p) => sum + p.pendingDecisions, 0);
  const redProducts = productData.filter((p) => p.riskState === 'red').length;

  const content = html`
    <h1>Portfolio</h1>

    <div class="dashboard-grid" style="margin-bottom:1.5rem;">
      <div class="card" style="text-align:center;">
        <div style="font-size:2rem;font-weight:800;">${avgHealth}</div>
        <div style="font-size:var(--text-sm);color:var(--color-text-muted);">Avg Health Score</div>
      </div>
      <div class="card" style="text-align:center;">
        <div style="font-size:2rem;font-weight:800;">${productData.length}</div>
        <div style="font-size:var(--text-sm);color:var(--color-text-muted);">Products</div>
      </div>
      <div class="card" style="text-align:center;">
        <div style="font-size:2rem;font-weight:800;${totalStressors > 0 ? 'color:var(--color-warning);' : ''}">${totalStressors}</div>
        <div style="font-size:var(--text-sm);color:var(--color-text-muted);">Active Stressors</div>
      </div>
      <div class="card" style="text-align:center;">
        <div style="font-size:2rem;font-weight:800;${redProducts > 0 ? 'color:var(--color-danger);' : ''}">${redProducts}</div>
        <div style="font-size:var(--text-sm);color:var(--color-text-muted);">In Red State</div>
      </div>
    </div>

    <div class="stagger">
      ${productData.map((p) => html`
        <a href="/dashboard" onclick="document.cookie='foundry_product=${p.id};path=/;max-age=31536000'" class="card card-interactive" style="text-decoration:none;color:inherit;display:block;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="display:flex;align-items:center;gap:1rem;">
              <div style="text-align:center;min-width:48px;">
                <div style="font-size:1.5rem;font-weight:800;color:${p.health.grade === 'A' ? 'var(--color-success)' : p.health.grade === 'B' ? 'var(--color-primary)' : p.health.grade === 'C' ? 'var(--color-warning)' : 'var(--color-danger)'};">${p.health.score}</div>
                <div style="font-size:var(--text-xs);color:var(--color-text-faint);">Grade ${p.health.grade}</div>
              </div>
              <div>
                <h3 style="margin:0;">${p.name}</h3>
                <div style="font-size:var(--text-sm);color:var(--color-text-muted);display:flex;gap:1rem;margin-top:0.25rem;">
                  <span>Phase ${p.currentPrompt.replace('prompt_', '')}</span>
                  ${p.stressorCount > 0 ? html`<span style="color:var(--color-warning);">${p.stressorCount} stressors</span>` : ''}
                  ${p.pendingDecisions > 0 ? html`<span>${p.pendingDecisions} decisions</span>` : ''}
                </div>
              </div>
            </div>
            <span class="risk-badge risk-${p.riskState}">${p.riskState.toUpperCase()}</span>
          </div>
        </a>
      `)}
    </div>

    ${productData.length > 1 && productData[0].health.score < 50 ? html`
    <div class="card" style="border-left:3px solid var(--color-warning);margin-top:1rem;">
      <h3>Recommendation</h3>
      <p style="color:var(--color-text-secondary);font-size:var(--text-base);">
        <strong>${productData[0].name}</strong> has the lowest health score (${productData[0].health.score}).
        ${productData[0].riskState === 'red'
          ? 'It is in Red state — focus your attention here until it stabilizes.'
          : `Consider spending more time on it this week. ${productData[0].health.summary}`}
      </p>
    </div>
    ` : ''}
  `;

  return c.html(dashboardLayout(ctx, content));
});
