// =============================================================================
// FOUNDRY — Operator Dashboard (home screen)
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import { setCookie, getCookie } from 'hono/cookie';
import type { AuthEnv } from '../../middleware/auth.js';
import { getProductsByOwner, getProductByOwner, getActiveStressors, getLatestMetrics, getPendingDecisions, getLifecycleState } from '../../db/client.js';
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

  // Redirect back to the referring page, or dashboard
  const referer = c.req.header('Referer');
  return c.redirect(referer ?? '/dashboard');
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

  const [stressors, metrics, decisions] = await Promise.all([
    getActiveStressors(productId),
    getLatestMetrics(productId),
    getPendingDecisions(productId),
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

  const content = html`
    ${pageHintBanner(hints)}
    ${riskStateBadge(riskState, riskReason, riskChangedAt)}

    <div class="dashboard-grid">
      ${dashboardSummaryCard('Pending Decisions', decisions.rows.length, '/decisions')}
      ${dashboardSummaryCard('Active Stressors', stressorRows.length, '#stressors')}
      ${dashboardSummaryCard('Current Prompt', currentPrompt.replace('prompt_', 'P'), '/products/' + productId + '/lifecycle')}
      ${dashboardSummaryCard('MRR Health', mrrHealth.value.toFixed(2), '/products/' + productId + '/cohorts')}
    </div>

    <div class="card">
      <h3>Lifecycle</h3>
      ${lifecycleProgress(currentPrompt)}
    </div>

    <div id="stressors">
      ${stressorReport(stressorRows)}
    </div>

    ${mrr ? mrrDecomposition(mrr, mrrHealth.indicator) : ''}

    ${metricsGrid(metricsRow)}

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
