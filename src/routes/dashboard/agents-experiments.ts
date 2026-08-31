// =============================================================================
// FOUNDRY — Experiments Dashboard
// Hypothesis queue, running experiments, and completed experiment results.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import { requireCompanyCapability } from '../../middleware/rbac.js';
import { hasProductAccess } from '../../services/team/members.js';
import {
  getHypotheses,
  getExperiments,
  getActiveExperimentCount,
  approveAndCreateExperiment,
  startExperiment,
  stopEarlyExperiment,
  type HypothesisRecord,
  type ExperimentRecord,
} from '../../services/scp/experiments.js';

export const agentExperimentRoutes = new Hono<AuthEnv>();

// ─── GET /products/:id/agents/experiments ────────────────────────────────────

agentExperimentRoutes.get('/products/:id/agents/experiments', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');

  // Membership, not ownership: the capability guard above already decided
  // whether this person may run experiments here; this only confirms the
  // company in the path is one they belong to.
  if (!(await hasProductAccess(productId, founder.id))) return c.redirect('/dashboard');

  const ctx = await getLayoutContext(founder, 'agents-strategy', 'Experiments', productId);

  const [hypotheses, experiments, activeCount] = await Promise.all([
    getHypotheses(productId),
    getExperiments(productId),
    getActiveExperimentCount(productId),
  ]);

  const pendingHypotheses = hypotheses.filter((h) => h.status === 'proposed');
  const runningExperiments = experiments.filter((e) => e.status === 'running');
  const designedExperiments = experiments.filter((e) => e.status === 'designed');
  const completedExperiments = experiments.filter((e) =>
    ['completed', 'stopped_early'].includes(e.status),
  );

  const content = html`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;">
      <h2 style="margin:0;">Experiments</h2>
      <div style="display:flex;align-items:center;gap:12px;">
        <span style="font-size:13px;color:#6b7280;">
          ${activeCount}/3 experiments running
        </span>
        <a href="/products/${productId}/agents/strategy" style="font-size:13px;color:#2563eb;">← Strategy</a>
      </div>
    </div>

    ${hypothesisQueueCard(pendingHypotheses, productId)}
    ${designedExperimentsCard(designedExperiments, productId, activeCount)}
    ${runningExperimentsCard(runningExperiments, productId)}
    ${completedExperimentsCard(completedExperiments)}
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /products/:id/agents/experiments/:hypId/approve ────────────────────

// AN EXPERIMENT RUNS ON REAL CUSTOMERS. Approving, starting and stopping one
// were scoped on ownership and gated by nothing: a co-founder who runs the
// product could not start one, and nothing but the ownership scope stopped
// anyone else. The guard resolves the company from the path, which is the
// company these handlers serve.
agentExperimentRoutes.post('/products/:id/agents/experiments/:hypId/approve',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const hypId = c.req.param('hypId');

  // Membership, not ownership: the capability guard above already decided
  // whether this person may run experiments here; this only confirms the
  // company in the path is one they belong to.
  if (!(await hasProductAccess(productId, founder.id))) return c.redirect('/dashboard');

  const body = await c.req.parseBody();
  const name = (body.name as string) || 'Experiment';
  const type = (body.type as string) || 'ab_test';
  const controlDescription = (body.control_description as string) || 'Current behavior';
  const treatmentDescription = (body.treatment_description as string) || 'New behavior';
  const successMetric = (body.success_metric as string) || 'conversion_rate';
  const plannedDays = body.planned_days ? parseInt(body.planned_days as string, 10) : undefined;

  try {
    await approveAndCreateExperiment(hypId, {
      name,
      type: type as 'ab_test' | 'before_after' | 'cohort_comparison',
      controlDescription,
      treatmentDescription,
      successMetric,
      plannedDurationDays: plannedDays,
    }, productId);
  } catch (err) {
    console.error('[EXPERIMENTS] Approve failed:', err);
  }

  return c.redirect(`/products/${productId}/agents/experiments`);
});

// ─── POST /products/:id/agents/experiments/:expId/start ──────────────────────

agentExperimentRoutes.post('/products/:id/agents/experiments/:expId/start',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const expId = c.req.param('expId');

  // Membership, not ownership: the capability guard above already decided
  // whether this person may run experiments here; this only confirms the
  // company in the path is one they belong to.
  if (!(await hasProductAccess(productId, founder.id))) return c.redirect('/dashboard');

  const activeCount = await getActiveExperimentCount(productId);
  if (activeCount >= 3) {
    // Too many experiments running — redirect back
    return c.redirect(`/products/${productId}/agents/experiments`);
  }

  try {
    await startExperiment(expId, productId);
  } catch (err) {
    console.error('[EXPERIMENTS] Start failed:', err);
  }

  return c.redirect(`/products/${productId}/agents/experiments`);
});

// ─── POST /products/:id/agents/experiments/:expId/stop ───────────────────────

agentExperimentRoutes.post('/products/:id/agents/experiments/:expId/stop',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const expId = c.req.param('expId');

  // Membership, not ownership: the capability guard above already decided
  // whether this person may run experiments here; this only confirms the
  // company in the path is one they belong to.
  if (!(await hasProductAccess(productId, founder.id))) return c.redirect('/dashboard');

  const body = await c.req.parseBody();
  const reason = (body.reason as string) || 'Stopped by CEO';

  try {
    await stopEarlyExperiment(expId, reason, productId);
  } catch (err) {
    console.error('[EXPERIMENTS] Stop failed:', err);
  }

  return c.redirect(`/products/${productId}/agents/experiments`);
});

// ─── UI Components ────────────────────────────────────────────────────────────

function hypothesisQueueCard(hypotheses: HypothesisRecord[], productId: string) {
  return html`
    <div class="card">
      <h3>Hypothesis Queue (${hypotheses.length} pending approval)</h3>
      ${hypotheses.length === 0
        ? html`<p style="color:#6b7280;font-size:14px;">No hypotheses awaiting approval.</p>`
        : html`
          <div style="display:flex;flex-direction:column;gap:12px;">
            ${hypotheses.map((h) => html`
              <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;">
                <div style="font-weight:600;font-size:14px;margin-bottom:4px;">${h.statement}</div>
                <div style="font-size:12px;color:#6b7280;margin-bottom:8px;">
                  Proposed by: <strong>${h.proposed_by}</strong>
                  ${h.predicted_effect_size ? html` · Predicted effect: <strong>+${(h.predicted_effect_size * 100).toFixed(1)}%</strong>` : ''}
                  ${h.estimated_duration_days ? html` · Est. duration: <strong>${h.estimated_duration_days}d</strong>` : ''}
                  ${h.estimated_cost_usd ? html` · Est. cost: <strong>$${h.estimated_cost_usd.toFixed(2)}</strong>` : ''}
                </div>
                ${h.risk_assessment ? html`<div style="font-size:12px;color:var(--text-muted);background:rgba(255,179,71,0.1);padding:6px 10px;border-radius:4px;margin-bottom:8px;">Risk: ${h.risk_assessment}</div>` : ''}
                <details style="margin-top:8px;">
                  <summary style="cursor:pointer;font-size:13px;color:#2563eb;font-weight:600;">Approve &amp; Create Experiment</summary>
                  <form method="POST" action="/products/${productId}/agents/experiments/${h.id}/approve" style="margin-top:12px;display:grid;gap:8px;">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                      <div>
                        <label style="font-size:12px;color:#374151;display:block;margin-bottom:3px;">Experiment Name</label>
                        <input name="name" type="text" required placeholder="e.g., Pricing Page A/B Test"
                          style="width:100%;padding:6px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:13px;" />
                      </div>
                      <div>
                        <label style="font-size:12px;color:#374151;display:block;margin-bottom:3px;">Type</label>
                        <select name="type" style="width:100%;padding:6px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:13px;">
                          <option value="ab_test">A/B Test</option>
                          <option value="before_after">Before/After</option>
                          <option value="cohort_comparison">Cohort Comparison</option>
                        </select>
                      </div>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                      <div>
                        <label style="font-size:12px;color:#374151;display:block;margin-bottom:3px;">Control Description</label>
                        <input name="control_description" type="text" required placeholder="Current behavior"
                          style="width:100%;padding:6px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:13px;" />
                      </div>
                      <div>
                        <label style="font-size:12px;color:#374151;display:block;margin-bottom:3px;">Treatment Description</label>
                        <input name="treatment_description" type="text" required placeholder="New behavior"
                          style="width:100%;padding:6px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:13px;" />
                      </div>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                      <div>
                        <label style="font-size:12px;color:#374151;display:block;margin-bottom:3px;">Success Metric</label>
                        <input name="success_metric" type="text" required placeholder="e.g., trial_to_paid_rate"
                          style="width:100%;padding:6px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:13px;" />
                      </div>
                      <div>
                        <label style="font-size:12px;color:#374151;display:block;margin-bottom:3px;">Planned Duration (days)</label>
                        <input name="planned_days" type="number" min="1" placeholder="14"
                          style="width:100%;padding:6px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:13px;" />
                      </div>
                    </div>
                    <div>
                      <button type="submit" class="btn btn-primary btn-sm">Approve &amp; Create Experiment</button>
                    </div>
                  </form>
                </details>
              </div>`)}
          </div>`}
    </div>`;
}

function designedExperimentsCard(experiments: ExperimentRecord[], productId: string, activeCount: number) {
  if (experiments.length === 0) return html``;

  return html`
    <div class="card">
      <h3>Ready to Start (${experiments.length})</h3>
      ${activeCount >= 3 ? html`
        <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;padding:10px 14px;margin-bottom:12px;font-size:13px;color:#92400e;">
          Maximum 3 concurrent experiments running. Stop one before starting another.
        </div>` : ''}
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${experiments.map((e) => html`
          <div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;display:flex;align-items:center;justify-content:space-between;">
            <div>
              <div style="font-weight:600;font-size:14px;">${e.name}</div>
              <div style="font-size:12px;color:#6b7280;margin-top:2px;">
                ${e.type.replace('_', ' ')} · Metric: ${e.success_metric}
                ${e.planned_end_at ? html` · Planned end: ${new Date(e.planned_end_at).toLocaleDateString()}` : ''}
              </div>
            </div>
            ${activeCount < 3 ? html`
              <form method="POST" action="/products/${productId}/agents/experiments/${e.id}/start">
                <button type="submit" class="btn btn-primary btn-sm">Start</button>
              </form>` : html`
              <span style="font-size:12px;color:#9ca3af;">Max active</span>`}
          </div>`)}
      </div>
    </div>`;
}

function runningExperimentsCard(experiments: ExperimentRecord[], productId: string) {
  if (experiments.length === 0) {
    return html`
      <div class="card">
        <h3>Running Experiments</h3>
        <p style="color:#6b7280;font-size:14px;">No experiments currently running.</p>
      </div>`;
  }

  return html`
    <div class="card">
      <h3>Running Experiments (${experiments.length})</h3>
      <div style="display:flex;flex-direction:column;gap:12px;">
        ${experiments.map((e) => {
          const started = e.started_at ? new Date(e.started_at) : null;
          const plannedEnd = e.planned_end_at ? new Date(e.planned_end_at) : null;
          const now = new Date();
          let progressPct = 0;
          let daysRemaining = 0;
          if (started && plannedEnd) {
            const totalMs = plannedEnd.getTime() - started.getTime();
            const elapsedMs = now.getTime() - started.getTime();
            progressPct = Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100));
            daysRemaining = Math.max(0, Math.ceil((plannedEnd.getTime() - now.getTime()) / 86400000));
          }

          return html`
            <div style="border:1px solid rgba(108,99,255,0.15);border-radius:8px;padding:14px;background:var(--surface-2);">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                <div>
                  <span style="font-weight:600;font-size:14px;">${e.name}</span>
                  <span style="margin-left:8px;font-size:12px;color:#6b7280;">${e.type.replace('_', ' ')}</span>
                </div>
                <div style="display:flex;align-items:center;gap:8px;">
                  <span style="font-size:12px;color:#2563eb;background:#dbeafe;padding:2px 8px;border-radius:4px;font-weight:600;">RUNNING</span>
                </div>
              </div>
              <div style="font-size:12px;color:#374151;margin-bottom:8px;">
                Metric: <strong>${e.success_metric}</strong>
                ${daysRemaining > 0 ? html` · ${daysRemaining} days remaining` : ''}
              </div>
              ${progressPct > 0 ? html`
                <div style="margin-bottom:10px;">
                  <div style="background:#bfdbfe;border-radius:4px;height:6px;overflow:hidden;">
                    <div style="background:#2563eb;height:100%;width:${progressPct.toFixed(0)}%;"></div>
                  </div>
                  <div style="font-size:11px;color:#6b7280;margin-top:3px;">${progressPct.toFixed(0)}% complete</div>
                </div>` : ''}
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;color:#374151;margin-bottom:10px;">
                <div><strong>Control:</strong> ${e.control_description}</div>
                <div><strong>Treatment:</strong> ${e.treatment_description}</div>
              </div>
              <details>
                <summary style="cursor:pointer;font-size:12px;color:#dc2626;font-weight:600;">Stop Early</summary>
                <form method="POST" action="/products/${productId}/agents/experiments/${e.id}/stop" style="margin-top:8px;display:flex;gap:8px;align-items:center;">
                  <input name="reason" type="text" placeholder="Reason for stopping" required
                    style="flex:1;padding:6px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:12px;" />
                  <button type="submit" class="btn btn-sm" style="background:#dc2626;color:white;">Stop</button>
                </form>
              </details>
            </div>`;
        })}
      </div>
    </div>`;
}

function completedExperimentsCard(experiments: ExperimentRecord[]) {
  if (experiments.length === 0) {
    return html`
      <div class="card">
        <h3>Completed Experiments</h3>
        <p style="color:#6b7280;font-size:14px;">No completed experiments yet.</p>
      </div>`;
  }

  const winnerColors: Record<string, string> = {
    treatment: '#059669',
    control: '#d97706',
    inconclusive: '#6b7280',
  };

  return html`
    <div class="card">
      <h3>Completed Experiments</h3>
      <table style="width:100%;font-size:13px;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:2px solid #e5e7eb;color:#6b7280;font-size:12px;">
            <th style="text-align:left;padding:6px 8px;">Experiment</th>
            <th style="text-align:left;padding:6px 8px;">Metric</th>
            <th style="text-align:right;padding:6px 8px;">Effect Size</th>
            <th style="text-align:right;padding:6px 8px;">p-value</th>
            <th style="text-align:right;padding:6px 8px;">Revenue Impact</th>
            <th style="text-align:center;padding:6px 8px;">Winner</th>
          </tr>
        </thead>
        <tbody>
          ${experiments.map((e) => html`
            <tr style="border-bottom:1px solid #f3f4f6;">
              <td style="padding:8px 8px;font-weight:500;">
                <div>${e.name}</div>
                <div style="font-size:11px;color:#9ca3af;">${e.status === 'stopped_early' ? 'Stopped early' : 'Completed'}</div>
              </td>
              <td style="padding:8px 8px;color:#6b7280;">${e.success_metric}</td>
              <td style="padding:8px 8px;text-align:right;">
                ${e.results?.effect_size != null
                  ? html`${(e.results.effect_size * 100).toFixed(1)}%`
                  : html`<span style="color:#9ca3af;">—</span>`}
              </td>
              <td style="padding:8px 8px;text-align:right;">
                ${e.results?.p_value != null
                  ? html`${e.results.p_value.toFixed(3)}`
                  : html`<span style="color:#9ca3af;">—</span>`}
              </td>
              <td style="padding:8px 8px;text-align:right;">
                ${e.actual_revenue_impact_usd != null
                  ? html`$${e.actual_revenue_impact_usd.toFixed(2)}`
                  : html`<span style="color:#9ca3af;">—</span>`}
              </td>
              <td style="padding:8px 8px;text-align:center;">
                ${e.winner
                  ? html`<span style="font-size:11px;font-weight:700;color:${winnerColors[e.winner] ?? '#6b7280'};text-transform:uppercase;background:#f3f4f6;padding:2px 8px;border-radius:4px;">${e.winner}</span>`
                  : html`<span style="color:#9ca3af;font-size:12px;">—</span>`}
              </td>
            </tr>`)}
        </tbody>
      </table>
    </div>`;
}

// ─── Flat redirect: /agents/experiments → /products/:id/agents/experiments ───

agentExperimentRoutes.get('/agents/experiments', async (c) => {
  const founder = c.get('founder');
  const ctx = await import('./_shared.js').then(m => m.getLayoutContext(founder, 'agents-experiments', 'Experiments'));
  if (!ctx.productId) return c.redirect('/dashboard');
  return c.redirect(`/products/${ctx.productId}/agents/experiments`);
});
