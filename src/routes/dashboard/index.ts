// =============================================================================
// FOUNDRY — Operator Dashboard (home screen)
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import { setCookie, getCookie } from 'hono/cookie';
import type { AuthEnv } from '../../middleware/auth.js';
import { getProductsByOwner, getProductByOwner, getActiveStressors, getLatestMetrics, getPendingDecisions, getLifecycleState } from '../../db/client.js';
import { query } from '../../db/client.js';
import { getMRRDecomposition, computeHealthRatio } from '../../services/intelligence/revenue.js';
import { getLatestCohortSummary } from '../../services/intelligence/cohort.js';
import { dashboardLayout } from '../../views/layout.js';
import { riskStateBadge, stressorReport, mrrDecomposition, metricsGrid, lifecycleProgress, dashboardSummaryCard, pageHintBanner, tourOverlay, milestoneToastScript, type StressorData } from '../../views/components.js';
import { getLayoutContext } from './_shared.js';
import { getPageHints } from '../../services/ux/hints.js';
import { TOUR_STEPS, buildTourStepData, fillTemplate } from '../../services/ux/tour.js';
import type { RiskStateValue } from '../../types/index.js';

export const dashboardRoutes = new Hono<AuthEnv>();

// ─── Product Switcher ────────────────────────────────────────────────────────

dashboardRoutes.post('/switch-product', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.parseBody() as Record<string, string>;
  const productId = body.product_id;

  // Verify this product belongs to the founder
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.redirect('/dashboard');

  setCookie(c, 'foundry_product', productId, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });

  // Redirect back to the referring page (same-origin only), or dashboard
  const referer = c.req.header('Referer');
  let safePath = '/dashboard';
  if (referer) {
    try {
      const appUrl = process.env.APP_URL ?? 'http://localhost:8080';
      const refUrl = new URL(referer, appUrl);
      if (refUrl.origin === new URL(appUrl).origin) {
        safePath = refUrl.pathname + refUrl.search;
      }
    } catch { /* Invalid URL, use default */ }
  }
  return c.redirect(safePath);
});

// ─── Dashboard ───────────────────────────────────────────────────────────────

dashboardRoutes.get('/dashboard', async (c) => {
  const founder = c.get('founder');
  const products = await getProductsByOwner(founder.id);

  if (products.rows.length === 0) {
    return c.redirect('/onboarding');
  }

  const ctx = await getLayoutContext(founder, 'dashboard', 'Dashboard', undefined, c);
  const productId = ctx.productId!;

  const [stressors, metrics, decisions, latestAudit] = await Promise.all([
    getActiveStressors(productId),
    getLatestMetrics(productId),
    getPendingDecisions(productId),
    query('SELECT * FROM audit_scores WHERE product_id = ? ORDER BY created_at DESC LIMIT 1', [productId]),
  ]);
  const mrr = await getMRRDecomposition(productId);
  const mrrHealth = mrr ? computeHealthRatio(mrr) : { value: 0, indicator: 'green' as const };
  const cohort = await getLatestCohortSummary(productId);

  const lsResult = await getLifecycleState(productId);
  const ls = lsResult.rows[0] as Record<string, unknown> | undefined;
  const riskState = (ls?.risk_state as RiskStateValue) ?? 'green';
  const riskReason = (ls?.risk_state_reason as string) ?? 'No risk signals detected.';
  const riskChangedAt = (ls?.risk_state_changed_at as string) ?? null;
  const currentPrompt = (ls?.current_prompt as string) ?? 'prompt_1';
  const metricsRow = (metrics.rows[0] as Record<string, unknown>) ?? {};
  const stressorRows = (stressors.rows as unknown as StressorData[]);
  const hasMetrics = metrics.rows.length > 0 && (metricsRow.signups_7d != null || metricsRow.new_mrr_cents != null);
  const audit = latestAudit.rows[0] as Record<string, unknown> | undefined;
  const composite = (audit?.composite as number) ?? null;
  const verdict = (audit?.verdict as string) ?? null;

  // UX Intelligence: page hints
  const hints = await getPageHints('dashboard', founder, productId, {
    metrics_count: metrics.rows.length,
    stressor_count: stressorRows.length,
    risk_state: riskState,
    first_red: false,
  });

  // Tour: detect ?tour=1 and active tour state
  const showTour = c.req.query('tour') === '1' && ctx.ux.tourState && !ctx.ux.tourState.completed_at && !ctx.ux.tourState.skipped_at;
  const tourStep = showTour ? TOUR_STEPS.find((s) => s.step === ctx.ux.tourState!.current_step) ?? null : null;

  // Setup checklist for new users
  const setupSteps = [
    { done: !!audit, label: 'Run first audit', url: `/products/${productId}/audit`, action: 'Run Audit' },
    { done: hasMetrics, label: 'Report revenue metrics', url: `/products/${productId}/revenue`, action: 'Enter Metrics' },
    { done: (ctx.dnaCompletionPct ?? 0) >= 30, label: 'Start Product DNA (ICP, positioning)', url: `/products/${productId}/dna`, action: 'Edit DNA' },
    { done: stressorRows.length > 0 || decisions.rows.length > 0, label: 'First intelligence cycle (runs Friday)', url: '/digest', action: 'View Digest' },
  ];
  const setupComplete = setupSteps.every((s) => s.done);
  const setupProgress = setupSteps.filter((s) => s.done).length;

  const content = html`
    ${pageHintBanner(hints)}

    ${!setupComplete ? html`
    <div class="card" style="border-left:3px solid #2563eb;margin-bottom:1.5rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
        <h3 style="margin:0;">Getting Started</h3>
        <span style="font-size:0.8rem;color:#6b7280;">${setupProgress}/${setupSteps.length} complete</span>
      </div>
      <div style="height:6px;background:#e5e7eb;border-radius:3px;margin-bottom:1rem;">
        <div style="height:100%;background:#2563eb;border-radius:3px;width:${(setupProgress / setupSteps.length) * 100}%;transition:width 0.3s;"></div>
      </div>
      ${setupSteps.map((step) => html`
        <div style="display:flex;align-items:center;gap:0.75rem;padding:0.5rem 0;${step.done ? 'opacity:0.5;' : ''}">
          <span style="font-size:1.1rem;min-width:24px;text-align:center;">${step.done ? '✓' : '○'}</span>
          <span style="flex:1;font-size:0.9rem;${step.done ? 'text-decoration:line-through;' : ''}">${step.label}</span>
          ${!step.done ? html`<a href="${step.url}" class="btn btn-secondary btn-sm">${step.action}</a>` : ''}
        </div>
      `)}
    </div>
    ` : ''}

    ${composite !== null ? html`
    <div class="card" style="margin-bottom:1rem;">
      <div style="display:flex;align-items:center;gap:1.5rem;">
        <div style="text-align:center;">
          <div style="font-size:2.5rem;font-weight:800;color:${composite >= 7 ? '#059669' : composite >= 5 ? '#d97706' : '#dc2626'};">${composite.toFixed(1)}</div>
          <div style="font-size:0.75rem;color:#6b7280;text-transform:uppercase;">Composite</div>
        </div>
        <div style="flex:1;">
          <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem;">
            <span class="verdict-badge ${verdict === 'READY' ? 'verdict-ready' : verdict === 'READY_WITH_CONDITIONS' ? 'verdict-conditions' : 'verdict-not-ready'}">${verdict?.replace(/_/g, ' ') ?? 'Pending'}</span>
          </div>
          <p style="font-size:0.87rem;color:#4b5563;margin:0;">
            ${composite >= 7
              ? 'Your product meets launch readiness standards across all dimensions.'
              : composite >= 5
                ? 'Nearly there. Fix blocking issues to reach launch readiness.'
                : 'Significant gaps found. Focus on the blocking issues in your audit.'}
          </p>
        </div>
        <a href="/products/${productId}/audit" class="btn btn-secondary btn-sm">View Full Audit</a>
      </div>
    </div>
    ` : ''}

    ${riskStateBadge(riskState, riskReason, riskChangedAt)}

    <div class="dashboard-grid">
      ${dashboardSummaryCard('Pending Decisions', decisions.rows.length, '/decisions')}
      ${dashboardSummaryCard('Active Stressors', stressorRows.length, '#stressors')}
      ${dashboardSummaryCard('Current Phase', currentPrompt.replace('prompt_', 'P'), '/products/' + productId + '/lifecycle')}
      ${dashboardSummaryCard('MRR Health', mrr && mrrHealth.value > 0 ? mrrHealth.value.toFixed(2) : '—', '/products/' + productId + '/revenue')}
    </div>

    <div class="card">
      <h3>Lifecycle</h3>
      ${lifecycleProgress(currentPrompt)}
    </div>

    <div id="stressors">
      ${stressorReport(stressorRows)}
    </div>

    ${mrr ? mrrDecomposition(mrr, mrrHealth.indicator) : ''}

    ${hasMetrics ? metricsGrid(metricsRow) : ''}

    ${tourStep ? tourOverlay(
      tourStep,
      buildTourStepData(tourStep, { composite: metricsRow.composite ?? null }, {
        blocking_count: 0,
        remediation_enabled: false,
        remediation_queued: 0,
        risk_state: riskState,
        pending_decisions: decisions.rows.length,
      }),
      TOUR_STEPS.length,
      founder.id,
      fillTemplate(tourStep.body_template, buildTourStepData(tourStep, { composite: metricsRow.composite ?? null }, {
        blocking_count: 0,
        remediation_enabled: false,
        remediation_queued: 0,
        risk_state: riskState,
        pending_decisions: decisions.rows.length,
      })),
    ) : ''}
    ${milestoneToastScript(ctx.ux.unseenMilestones)}
  `;

  return c.html(dashboardLayout(ctx, content));
});
