// =============================================================================
// FOUNDRY — Scenario Modeling & Probabilistic Forecasting
// Answers: "What's going to happen?"
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import { query } from '../../db/client.js';
import {
  generateScenariosForProduct,
  getForecastAccuracy,
  getLatestScenarios,
} from '../../services/scp/forecasting/runway.js';
import { getActiveTargetForecasts } from '../../services/scp/forecasting/targets.js';
import { requireCompanyCapability } from '../../middleware/rbac.js';
import { log } from '../../lib/logger.js';
import {
  getFinancialPosition, stateFinancialPosition, isStale, STALE_AFTER_DAYS,
  type FinancialPosition,
} from '../../services/financial/position.js';

export const scenarios = new Hono<AuthEnv>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** The two numbers Foundry cannot see. Dollars, because that is what a person
 *  reads off a bank statement, and a date, because a balance is a fact about a
 *  moment rather than a standing property of the company. */
function financialPositionForm(current: FinancialPosition | null) {
  const cash = current ? (current.cashOnHandCents / 100).toFixed(2) : '';
  const burn = current ? (current.monthlyBurnCents / 100).toFixed(2) : '';
  const asOf = current ? current.asOfDate.slice(0, 10) : '';
  return html`
    <form method="POST" action="/scenarios/financial-position"
          style="display:flex;flex-wrap:wrap;gap:0.75rem;align-items:flex-end;">
      <label style="font-size:0.75rem;color:var(--text-muted);">
        Cash on hand ($)<br/>
        <input type="number" name="cash_on_hand" step="0.01" min="0" required value="${cash}"
               style="margin-top:0.25rem;padding:0.4rem 0.6rem;" />
      </label>
      <label style="font-size:0.75rem;color:var(--text-muted);">
        Monthly burn ($)<br/>
        <input type="number" name="monthly_burn" step="0.01" min="0" required value="${burn}"
               style="margin-top:0.25rem;padding:0.4rem 0.6rem;" />
      </label>
      <label style="font-size:0.75rem;color:var(--text-muted);">
        True as of<br/>
        <input type="date" name="as_of_date" required value="${asOf}"
               style="margin-top:0.25rem;padding:0.4rem 0.6rem;" />
      </label>
      <button type="submit" class="btn btn-primary" style="font-size:0.8rem;">
        Save and model
      </button>
    </form>`;
}

function fmtCents(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1)}k`;
  return `$${dollars.toFixed(0)}`;
}

function probabilityColor(p: number): string {
  if (p >= 0.7) return '#4ecca3';
  if (p >= 0.4) return '#ffb347';
  return '#ff6b6b';
}

function runwayColor(months: number): string {
  if (months >= 18) return '#4ecca3';
  if (months >= 9) return '#ffb347';
  return '#ff6b6b';
}

function probabilityBadge(p: number): string {
  const pct = Math.round(p * 100);
  const color = probabilityColor(p);
  return `<span style="font-size:0.85rem;font-weight:700;color:${color};">${pct}%</span>`;
}

function runwayRangeBar(p10: number, median: number, p90: number): string {
  const max = Math.max(p90, 36);
  const p10Pct = Math.min(100, (p10 / max) * 100).toFixed(1);
  const medPct = Math.min(100, (median / max) * 100).toFixed(1);
  const p90Pct = Math.min(100, (p90 / max) * 100).toFixed(1);
  const medColor = runwayColor(median);

  return `<div style="position:relative;height:20px;background:rgba(255,255,255,0.06);border-radius:10px;overflow:hidden;margin:0.5rem 0;">
    <div style="position:absolute;left:${p10Pct}%;right:${(100 - parseFloat(p90Pct)).toFixed(1)}%;height:100%;background:rgba(255,255,255,0.08);border-radius:10px;"></div>
    <div style="position:absolute;left:calc(${medPct}% - 2px);width:4px;height:100%;background:${medColor};border-radius:2px;"></div>
  </div>
  <div style="display:flex;justify-content:space-between;font-size:0.7rem;color:var(--text-muted);">
    <span>P10: ${p10}mo</span>
    <span style="color:${medColor};font-weight:700;">${median}mo</span>
    <span>P90: ${p90}mo</span>
  </div>`;
}

function scenarioCard(s: {
  id: string;
  name: string;
  runway_months: number;
  runway_months_p10: number;
  runway_months_p90: number;
  breakeven_months: number | null;
  probability_18_months: number;
  scenario_type: string;
}): string {
  const mColor = runwayColor(s.runway_months);
  const breakevenText = s.breakeven_months !== null
    ? `Month ${s.breakeven_months}`
    : 'Never in 36mo';

  return `<div class="card" style="padding:1.25rem;flex:1 1 280px;min-width:260px;max-width:380px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;">
      <div style="font-size:0.95rem;font-weight:700;color:var(--text-primary);">${s.name}</div>
      <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;background:rgba(255,255,255,0.07);color:var(--text-muted);padding:2px 8px;border-radius:99px;">${s.scenario_type}</span>
    </div>

    <div style="display:flex;gap:1.5rem;margin-bottom:0.875rem;flex-wrap:wrap;">
      <div>
        <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.2rem;">Median Runway</div>
        <div style="font-size:1.5rem;font-weight:800;color:${mColor};">${s.runway_months}<span style="font-size:0.85rem;font-weight:400;color:var(--text-muted);margin-left:2px;">mo</span></div>
      </div>
      <div>
        <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.2rem;">18-Month Survival</div>
        <div style="font-size:1.5rem;font-weight:800;">${probabilityBadge(s.probability_18_months)}</div>
      </div>
      <div>
        <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.2rem;">Breakeven</div>
        <div style="font-size:0.85rem;font-weight:600;color:var(--text-dim);">${breakevenText}</div>
      </div>
    </div>

    ${runwayRangeBar(s.runway_months_p10, s.runway_months, s.runway_months_p90)}

    <div style="margin-top:0.875rem;">
      <a href="/scenarios/${s.id}" style="font-size:0.78rem;color:var(--accent);text-decoration:none;">View projection table →</a>
    </div>
  </div>`;
}

// ─── GET /scenarios — Main Dashboard ──────────────────────────────────────────

scenarios.get('/scenarios', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'scenarios', 'Scenario Modeling', undefined, c);

  if (!ctx.productId) {
    const content = html`
      <h1 style="margin:0 0 1rem;">Scenario Modeling</h1>
      <div class="card" style="padding:2rem;text-align:center;color:var(--text-muted);">No product selected.</div>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;

  const [scenarioList, targetForecasts, position, accuracy] = await Promise.all([
    getLatestScenarios(productId),
    getActiveTargetForecasts(productId),
    getFinancialPosition(productId),
    getForecastAccuracy(productId),
  ]);

  // ── Nothing to model ───────────────────────────────────────────────────────
  //
  // Runway used to be computed from cash = 12 x the AI spend cap, which
  // defaults to $50/month. The simulation ran, the bands rendered, and none of
  // it was about this company's money. A cash balance is a fact about a bank
  // account and the founder is the only source, so the page asks.
  if (position === null) {
    const content = html`
      <h1 style="margin:0 0 1rem;">Scenario Modeling</h1>
      <div class="card" style="padding:1.5rem;margin-bottom:1.5rem;">
        <h2 style="margin:0 0 0.5rem;font-size:1rem;">Runway needs two numbers only you have</h2>
        <p style="color:var(--text-dim);font-size:0.85rem;line-height:1.6;margin:0 0 1rem;">
          Foundry can see what your customers pay you. It cannot see your bank balance or
          what you spend, and it will not guess: a survival forecast built on a guess looks
          exactly like one built on your books. Tell it these two, and the scenarios below
          are about your company.
        </p>
        ${financialPositionForm(null)}
      </div>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  // ── Empty state ──────────────────────────────────────────────────────────────
  if (scenarioList.length === 0) {
    const content = html`
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:0.5rem;">
        <h1 style="margin:0;">Scenario Modeling</h1>
      </div>

      <div class="card" style="padding:1.25rem;margin-bottom:1.5rem;background:rgba(78,204,163,0.04);border:1px solid rgba(78,204,163,0.15);">
        <div style="font-size:0.78rem;color:var(--text-dim);line-height:1.6;">
          These projections use Monte Carlo simulation with 1,000 iterations to model the uncertainty in your growth and churn rates.
          Each scenario runs 1,000 simulated futures varying your growth rate (±30%) and churn rate (±20%) to give you a realistic
          probability distribution — not just a single point estimate.
        </div>
      </div>

      <div style="text-align:center;padding:4rem 2rem;background:var(--bg-card);border-radius:12px;border:1px solid rgba(255,255,255,0.06);">
        <div style="font-size:2.5rem;margin-bottom:1rem;">📊</div>
        <h2 style="margin:0 0 0.5rem;">No scenarios generated yet</h2>
        <p style="color:var(--text-dim);margin:0 0 1.5rem;max-width:400px;margin-left:auto;margin-right:auto;">
          Generate your first set of Monte Carlo scenarios to see runway projections across Base, Bear, and Bull cases.
        </p>
        <form method="POST" action="/scenarios/regenerate">
          <button type="submit" class="btn btn-primary">Generate Scenarios</button>
        </form>
      </div>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  // ── Scenario cards ───────────────────────────────────────────────────────────
  const cardHtml = scenarioList.map((s) => scenarioCard(s)).join('');

  // ── Target Probability section ───────────────────────────────────────────────
  const targetRows = targetForecasts.map((tf) => {
    const pct = Math.round(tf.probability * 100);
    const pColor = probabilityColor(tf.probability);
    const onTrackBadge = tf.on_track
      ? `<span style="font-size:0.65rem;font-weight:700;background:#4ecca322;color:#4ecca3;border:1px solid #4ecca344;padding:1px 7px;border-radius:99px;">On Track</span>`
      : `<span style="font-size:0.65rem;font-weight:700;background:#ff6b6b22;color:#ff6b6b;border:1px solid #ff6b6b44;padding:1px 7px;border-radius:99px;">Off Track</span>`;

    const currentFmt = tf.current_value.toFixed(tf.metric.includes('rate') ? 1 : 0);
    const targetFmt = tf.target_value.toFixed(tf.metric.includes('rate') ? 1 : 0);
    const projectedFmt = tf.projected_value_at_target_date.toFixed(tf.metric.includes('rate') ? 1 : 0);

    return `<div style="display:flex;align-items:center;gap:1rem;padding:0.875rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.05);flex-wrap:wrap;">
      <div style="min-width:140px;font-size:0.82rem;font-weight:600;color:var(--text-primary);">${tf.metric}</div>
      <div style="flex:1;min-width:180px;">
        <div style="font-size:0.75rem;color:var(--text-muted);">Current: <strong style="color:var(--text-dim);">${currentFmt}</strong> → Target: <strong style="color:var(--text-dim);">${targetFmt}</strong> by ${tf.target_date}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">Projected at target date: <strong style="color:var(--text-dim);">${projectedFmt}</strong></div>
      </div>
      <div style="display:flex;align-items:center;gap:0.75rem;flex-shrink:0;">
        ${onTrackBadge}
        <span style="font-size:1.1rem;font-weight:800;color:${pColor};">${pct}%</span>
      </div>
    </div>`;
  }).join('');

  const lastGenerated = scenarioList[0]?.created_at ?? '';
  const lastGenDate = lastGenerated
    ? new Date(lastGenerated).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  const content = html`
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:0.5rem;">
      <h1 style="margin:0;">Scenario Modeling</h1>
      <form method="POST" action="/scenarios/regenerate">
        <button type="submit" class="btn btn-ghost" style="font-size:0.8rem;">Regenerate Scenarios</button>
      </form>
    </div>

    <!-- Monte Carlo explanation -->
    <div class="card" style="padding:1.25rem;margin-bottom:1.5rem;background:rgba(78,204,163,0.04);border:1px solid rgba(78,204,163,0.15);">
      <div style="display:flex;align-items:flex-start;gap:0.75rem;">
        <div style="font-size:1.2rem;flex-shrink:0;">🎲</div>
        <div>
          <div style="font-size:0.82rem;font-weight:700;color:var(--text-primary);margin-bottom:0.25rem;">Monte Carlo Simulation</div>
          <div style="font-size:0.78rem;color:var(--text-dim);line-height:1.6;">
            These projections use Monte Carlo simulation with 1,000 iterations to model the uncertainty in your growth and churn rates.
            Each bar shows the P10 (pessimistic) → median → P90 (optimistic) range. The 18-month survival probability reflects
            how often your company survives 18 months across all 1,000 simulated futures.
            ${lastGenDate ? `<span style="color:var(--text-muted);"> Last generated: ${lastGenDate}.</span>` : ''}
          </div>
        </div>
      </div>
    </div>

    <!-- What the simulation was given -->
    <div class="card" style="padding:1rem 1.25rem;margin-bottom:1.5rem;">
      <div style="font-size:0.78rem;color:var(--text-dim);line-height:1.6;">
        Modelled from the position you stated: <strong>${fmtCents(position.cashOnHandCents)}</strong>
        on hand, <strong>${fmtCents(position.monthlyBurnCents)}</strong> a month out, as of
        ${position.asOfDate}${position.daysOld > 0 ? ` — ${position.daysOld} days ago` : ''}.
        ${isStale(position) ? html`<span style="color:#ffb347;font-weight:600;">
          That is more than ${STALE_AFTER_DAYS} days old, so these projections start from a
          balance you have since spent or grown.</span>` : ''}
      </div>
      <details style="margin-top:0.75rem;">
        <summary style="font-size:0.78rem;color:var(--text-muted);cursor:pointer;">Update it</summary>
        <div style="margin-top:0.75rem;">${financialPositionForm(position)}</div>
      </details>
    </div>

    <!-- How right these have been -->
    <div class="card" style="padding:1rem 1.25rem;margin-bottom:1.5rem;">
      <div style="font-size:0.78rem;color:var(--text-dim);line-height:1.6;">
        ${accuracy.resolved === 0 ? html`
          <strong>No forecast has come due yet.</strong>
          ${accuracy.pending > 0
            ? `${accuracy.pending} prediction${accuracy.pending > 1 ? 's are' : ' is'} written down and waiting for the month to arrive.`
            : 'Predictions are written down at one, three and six months so they can be checked against what actually happens.'}
        ` : html`
          <strong>Past forecasts have been out by a median of
          ${accuracy.median_abs_variance_pct}%</strong> across ${accuracy.resolved}
          prediction${accuracy.resolved > 1 ? 's' : ''} that have come due${
            accuracy.median_signed_variance_pct === null ? '' :
            accuracy.median_signed_variance_pct > 0
              ? ' — running high, so the numbers above are probably optimistic'
              : accuracy.median_signed_variance_pct < 0
                ? ' — running low, so the numbers above are probably conservative'
                : ''}.
          ${accuracy.pending > 0 ? `${accuracy.pending} more are waiting.` : ''}
        `}
      </div>
    </div>

    <!-- Scenario Cards -->
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.875rem;">Runway Scenarios</div>
    <div style="display:flex;flex-wrap:wrap;gap:1rem;margin-bottom:2rem;">
      ${{toString: () => cardHtml}}
    </div>

    <!-- Legend -->
    <div style="display:flex;gap:1.5rem;flex-wrap:wrap;margin-bottom:2rem;padding:0.875rem 1.25rem;background:rgba(255,255,255,0.03);border-radius:8px;border:1px solid rgba(255,255,255,0.06);">
      <div style="font-size:0.72rem;color:var(--text-muted);">Range bar: <span style="color:var(--text-dim);">P10 → median → P90</span></div>
      <div style="font-size:0.72rem;color:var(--text-muted);">Runway color: <span style="color:#4ecca3;">18+ mo ✓</span> <span style="color:#ffb347;">9–17 mo ⚠</span> <span style="color:#ff6b6b;">&lt;9 mo ✗</span></div>
      <div style="font-size:0.72rem;color:var(--text-muted);">Survival %: probability company reaches month 18</div>
    </div>

    <!-- Target Probability -->
    ${targetForecasts.length > 0 ? html`
    <div style="margin-bottom:2rem;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.875rem;">Target Probability — OKR Key Results</div>
      <div class="card" style="padding:0;overflow:hidden;">
        <div style="padding:0.75rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.07);display:flex;gap:1rem;flex-wrap:wrap;">
          <span style="min-width:140px;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Metric</span>
          <span style="flex:1;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Progress</span>
          <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Probability</span>
        </div>
        ${{toString: () => targetRows}}
      </div>
      <div style="margin-top:0.5rem;font-size:0.72rem;color:var(--text-muted);padding:0 0.25rem;">
        Probability based on linear regression of last 8 weeks of metric snapshots. Update your metric snapshots regularly for accurate forecasts.
      </div>
    </div>
    ` : html`
    <div style="margin-bottom:2rem;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.875rem;">Target Probability — OKR Key Results</div>
      <div class="card" style="padding:1.5rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">
        No active OKR key results with metric tracking found. <a href="/agents/okr" style="color:var(--accent);text-decoration:none;">Set up OKRs →</a>
      </div>
    </div>
    `}
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /scenarios/regenerate — Trigger regeneration ────────────────────────

scenarios.post('/scenarios/regenerate',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'scenarios', 'Scenario Modeling', undefined, c);

  if (!ctx.productId) return c.redirect('/scenarios');

  try {
    await generateScenariosForProduct(ctx.productId);
  } catch (err) {
    console.error('[scenarios] Failed to generate scenarios:', err);
  }

  return c.redirect('/scenarios');
});

// ─── POST /scenarios/financial-position — the founder states cash and burn ────
//
// Same capability as regenerating, because that is what it does: this is the
// only input to the runway model that Foundry cannot observe, and stating it is
// what makes a forecast possible at all.
scenarios.post('/scenarios/financial-position',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'scenarios', 'Scenario Modeling', undefined, c);
  if (!ctx.productId) return c.redirect('/scenarios');

  const form = await c.req.parseBody();
  const cash = Number(form.cash_on_hand);
  const burn = Number(form.monthly_burn);
  const asOf = String(form.as_of_date ?? '').slice(0, 10);

  // REFUSED, NOT CORRECTED. A clamped typo becomes a plausible number, and this
  // one drives what a founder is told about surviving. The amount and date
  // rules are also triggers in migration 181, so a second caller cannot skip
  // them; this check is here so the person gets a page rather than a 500.
  if (!Number.isFinite(cash) || !Number.isFinite(burn) || cash < 0 || burn < 0
      || !/^\d{4}-\d{2}-\d{2}$/.test(asOf) || asOf > new Date().toISOString().slice(0, 10)) {
    return c.redirect('/scenarios?error=position_invalid');
  }

  await stateFinancialPosition({
    productId: ctx.productId,
    cashOnHandDollars: cash,
    monthlyBurnDollars: burn,
    asOfDate: asOf,
    statedBy: founder.id,
  });

  // Model it immediately: the founder just answered the question that was
  // blocking the page, and sending them back to an empty one would be odd.
  try {
    await generateScenariosForProduct(ctx.productId);
  } catch (err) {
    log.error('scenarios: generation failed after position stated', {
      productId: ctx.productId, error: (err as Error)?.name ?? 'Error' });
  }

  return c.redirect('/scenarios');
});

// ─── GET /scenarios/:id — Detail view ─────────────────────────────────────────

scenarios.get('/scenarios/:id', async (c) => {
  const founder = c.get('founder');
  const scenarioId = c.req.param('id');
  const ctx = await getLayoutContext(founder, 'scenarios', 'Scenario Detail', undefined, c);

  if (!ctx.productId) return c.redirect('/scenarios');

  // Load the specific scenario (scoped to product for security)
  const result = await query(
    `SELECT * FROM forecast_scenarios WHERE id = ? AND product_id = ?`,
    [scenarioId, ctx.productId]
  );

  if (result.rows.length === 0) {
    const content = html`
      <div style="margin-bottom:1.5rem;">
        <a href="/scenarios" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Scenarios</a>
      </div>
      <div class="card" style="padding:2rem;text-align:center;color:var(--text-muted);">Scenario not found.</div>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const row = result.rows[0] as Record<string, unknown>;
  let assumptions: Record<string, unknown> = {};
  let scenarioResults: Record<string, unknown> = {};
  try { assumptions = JSON.parse(row.assumptions_json as string); } catch { /* ignore */ }
  try { scenarioResults = JSON.parse(row.results_json as string); } catch { /* ignore */ }

  const name = row.name as string;
  const medianMonths = (scenarioResults.runway_months as number) ?? 0;
  const p10 = (scenarioResults.runway_months_p10 as number) ?? 0;
  const p90 = (scenarioResults.runway_months_p90 as number) ?? 0;
  const breakevenMonths = (scenarioResults.breakeven_months as number | null) ?? null;
  const prob18 = (scenarioResults.probability_18_months as number) ?? 0;
  const monthlyProjection = (scenarioResults.monthly_projection as Array<{
    month: number;
    mrr_cents_median: number;
    cash_cents_median: number;
    is_breakeven: boolean;
  }>) ?? [];

  const mColor = runwayColor(medianMonths);

  // Build projection table rows
  const projectionRows = monthlyProjection.map((mp) => {
    const breakevenMark = mp.is_breakeven
      ? `<span style="font-size:0.65rem;font-weight:700;background:#4ecca322;color:#4ecca3;padding:1px 6px;border-radius:99px;margin-left:4px;">BREAKEVEN</span>`
      : '';
    return `<tr>
      <td style="padding:0.5rem 1rem;font-size:0.8rem;color:var(--text-dim);">${mp.month}</td>
      <td style="padding:0.5rem 1rem;font-size:0.8rem;color:var(--text-primary);">${fmtCents(mp.mrr_cents_median)}/mo${breakevenMark}</td>
      <td style="padding:0.5rem 1rem;font-size:0.8rem;color:${mp.cash_cents_median < 50000_00 ? '#ff6b6b' : 'var(--text-primary)'};">${fmtCents(mp.cash_cents_median)}</td>
    </tr>`;
  }).join('');

  // Build assumptions display
  const assumptionItems = Object.entries(assumptions).map(([k, v]) => {
    const label = k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    let valDisplay = String(v);
    if (k.includes('cents')) valDisplay = fmtCents(Number(v));
    else if (k.includes('rate')) valDisplay = `${(Number(v) * 100).toFixed(1)}%`;
    return `<div style="display:flex;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid rgba(255,255,255,0.04);">
      <span style="font-size:0.78rem;color:var(--text-muted);">${label}</span>
      <span style="font-size:0.78rem;font-weight:600;color:var(--text-dim);">${valDisplay}</span>
    </div>`;
  }).join('');

  const content = html`
    <div style="margin-bottom:1.5rem;">
      <a href="/scenarios" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← All Scenarios</a>
    </div>

    <!-- Header -->
    <div class="card" style="padding:1.5rem;margin-bottom:1.5rem;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.4rem;">SCENARIO DETAIL</div>
      <h1 style="margin:0 0 0.75rem;font-size:1.5rem;">${name}</h1>
      <div style="display:flex;gap:2rem;flex-wrap:wrap;">
        <div>
          <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.2rem;">Median Runway</div>
          <div style="font-size:1.8rem;font-weight:800;color:${mColor};">${medianMonths}<span style="font-size:1rem;color:var(--text-muted);margin-left:3px;">months</span></div>
        </div>
        <div>
          <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.2rem;">P10 – P90 Range</div>
          <div style="font-size:1rem;font-weight:600;color:var(--text-dim);">${p10} – ${p90} months</div>
        </div>
        <div>
          <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.2rem;">18-Month Survival</div>
          <div style="font-size:1.8rem;font-weight:800;color:${probabilityColor(prob18)};">${Math.round(prob18 * 100)}%</div>
        </div>
        <div>
          <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.2rem;">Breakeven</div>
          <div style="font-size:1rem;font-weight:600;color:var(--text-dim);">${breakevenMonths !== null ? `Month ${breakevenMonths}` : 'Never in 36mo'}</div>
        </div>
      </div>
      <div style="margin-top:1rem;">
        ${{toString: () => runwayRangeBar(p10, medianMonths, p90)}}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:1.5rem;">

      <!-- Assumptions -->
      <div class="card" style="padding:1.25rem;">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.875rem;">Assumptions</div>
        ${{toString: () => assumptionItems}}
      </div>

      <!-- Monthly Projection Table -->
      <div class="card" style="padding:1.25rem;">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.875rem;">Monthly Projection (Median Path)</div>
        ${monthlyProjection.length > 0 ? html`
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="border-bottom:1px solid rgba(255,255,255,0.08);">
                <th style="padding:0.4rem 1rem;font-size:0.65rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);text-align:left;">Month</th>
                <th style="padding:0.4rem 1rem;font-size:0.65rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);text-align:left;">MRR</th>
                <th style="padding:0.4rem 1rem;font-size:0.65rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);text-align:left;">Cash</th>
              </tr>
            </thead>
            <tbody>
              ${{toString: () => projectionRows}}
            </tbody>
          </table>
        </div>
        ` : html`<div style="color:var(--text-muted);font-size:0.85rem;">No projection data available.</div>`}
      </div>

    </div>

    <div style="margin-top:1rem;">
      <a href="/scenarios" class="btn btn-ghost" style="font-size:0.8rem;">← Back to All Scenarios</a>
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});
