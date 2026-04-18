// =============================================================================
// FOUNDRY — ROI Dashboard & Recommendation Outcome Tracker
// Quantifies the value Foundry delivers monthly so renewal is arithmetic.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { getLayoutContext } from './_shared.js';
import { dashboardLayout } from '../../views/layout.js';
import { computeMonthlyROI, getROISummary, getROIBreakdown } from '../../services/scp/roi/calculator.js';
import { recordOutcome, inferOutcomesFromData } from '../../services/scp/roi/outcome-tracker.js';
import { query, getProductByOwner } from '../../db/client.js';

export const roiDashboard = new Hono<AuthEnv>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDollars(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}

function fmtPct(v: number): string {
  return `${v.toFixed(1)}%`;
}

const CATEGORY_LABELS: Record<string, string> = {
  churn_prevented: 'Churn Prevented',
  expansion_captured: 'Expansion Captured',
  cost_avoided: 'Cost Avoided',
  revenue_accelerated: 'Revenue Accelerated',
  risk_mitigated: 'Risk Mitigated',
  time_saved: 'Time Saved',
  other: 'Other',
};

// ─── GET /roi — ROI Hub ───────────────────────────────────────────────────────

roiDashboard.get('/roi', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'roi', 'ROI Dashboard', undefined, c);

  if (!ctx.productId) {
    const content = html`
      <div class="card" style="text-align:center;padding:3rem;">
        <h2>ROI Dashboard</h2>
        <p class="text-muted">Add a product to start tracking Foundry's value delivery.</p>
      </div>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;
  const summary = await getROISummary(productId);
  const cm = summary.current_month;

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const breakdown = await getROIBreakdown(productId, currentMonth);

  // Category donut data (as table fallback)
  const categoryRows = breakdown.by_category.length > 0
    ? breakdown.by_category
    : [{ category: 'No data yet', value: 0, count: 0 }];

  const content = html`
    <!-- ── Hero Section ─────────────────────────────────────────────────── -->
    <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);border-radius:1rem;padding:2.5rem;margin-bottom:1.5rem;color:#fff;position:relative;overflow:hidden;">
      <div style="position:absolute;top:-40px;right:-40px;width:200px;height:200px;background:rgba(99,102,241,0.15);border-radius:50%;pointer-events:none;"></div>
      <div style="position:absolute;bottom:-60px;left:-20px;width:160px;height:160px;background:rgba(16,185,129,0.1);border-radius:50%;pointer-events:none;"></div>

      <p style="margin:0 0 0.25rem;font-size:0.8rem;letter-spacing:0.12em;text-transform:uppercase;opacity:0.6;">Value Delivered This Month</p>
      <div style="font-size:clamp(2.5rem,6vw,4rem);font-weight:800;letter-spacing:-0.02em;line-height:1.1;margin-bottom:0.5rem;">
        ${fmtDollars(cm.total_value_dollars)}
      </div>
      ${cm.roi_multiple !== null ? html`
        <div style="display:inline-flex;align-items:center;gap:0.5rem;background:rgba(16,185,129,0.2);border:1px solid rgba(16,185,129,0.4);border-radius:2rem;padding:0.35rem 1rem;margin-bottom:1rem;">
          <span style="color:#10b981;font-weight:700;font-size:1.1rem;">${cm.roi_multiple.toFixed(1)}×</span>
          <span style="opacity:0.8;font-size:0.85rem;">ROI</span>
        </div>
      ` : html``}
      <p style="margin:0.75rem 0 0;font-size:1.05rem;opacity:0.85;max-width:600px;">${summary.headline}</p>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:1rem;margin-top:2rem;">
        <div style="background:rgba(255,255,255,0.07);border-radius:0.75rem;padding:1rem;">
          <div style="font-size:1.4rem;font-weight:700;">${cm.recommendations_made}</div>
          <div style="font-size:0.75rem;opacity:0.65;margin-top:0.2rem;">Recommendations</div>
        </div>
        <div style="background:rgba(255,255,255,0.07);border-radius:0.75rem;padding:1rem;">
          <div style="font-size:1.4rem;font-weight:700;">${fmtPct(cm.action_rate_pct)}</div>
          <div style="font-size:0.75rem;opacity:0.65;margin-top:0.2rem;">Action Rate</div>
        </div>
        <div style="background:rgba(255,255,255,0.07);border-radius:0.75rem;padding:1rem;">
          <div style="font-size:1.4rem;font-weight:700;">${fmtPct(cm.outcome_rate_pct)}</div>
          <div style="font-size:0.75rem;opacity:0.65;margin-top:0.2rem;">Positive Outcomes</div>
        </div>
        <div style="background:rgba(255,255,255,0.07);border-radius:0.75rem;padding:1rem;">
          <div style="font-size:1.4rem;font-weight:700;">${fmtDollars(summary.all_time_value)}</div>
          <div style="font-size:0.75rem;opacity:0.65;margin-top:0.2rem;">All-Time Value</div>
        </div>
      </div>
    </div>

    <!-- ── Actions Bar ───────────────────────────────────────────────────── -->
    <div style="display:flex;gap:0.75rem;margin-bottom:1.5rem;flex-wrap:wrap;">
      <a href="/roi/${currentMonth}" class="btn btn-ghost btn-sm">View Month Detail →</a>
      <form method="POST" action="/roi/compute" style="display:inline;">
        <button type="submit" class="btn btn-ghost btn-sm">↻ Recompute ROI</button>
      </form>
    </div>

    <!-- ── Value Breakdown by Category ──────────────────────────────────── -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;margin-bottom:1.5rem;">
      <div class="card">
        <h3 style="margin-top:0;">Value by Category</h3>
        <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
          <thead>
            <tr style="border-bottom:1px solid var(--border-color,#e2e8f0);">
              <th style="text-align:left;padding:0.4rem 0;font-weight:600;">Category</th>
              <th style="text-align:right;padding:0.4rem 0;font-weight:600;">Value</th>
              <th style="text-align:right;padding:0.4rem 0;font-weight:600;">Count</th>
            </tr>
          </thead>
          <tbody>
            ${categoryRows.map((cat) => html`
              <tr style="border-bottom:1px solid var(--border-color,#f1f5f9);">
                <td style="padding:0.5rem 0;">${CATEGORY_LABELS[cat.category] ?? cat.category}</td>
                <td style="padding:0.5rem 0;text-align:right;font-weight:600;color:var(--color-success,#059669);">${fmtDollars(cat.value)}</td>
                <td style="padding:0.5rem 0;text-align:right;opacity:0.6;">${cat.count}</td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>

      <!-- ── Trailing 3-Month Trend ──────────────────────────────────────── -->
      <div class="card">
        <h3 style="margin-top:0;">3-Month Trend</h3>
        <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
          <thead>
            <tr style="border-bottom:1px solid var(--border-color,#e2e8f0);">
              <th style="text-align:left;padding:0.4rem 0;font-weight:600;">Month</th>
              <th style="text-align:right;padding:0.4rem 0;font-weight:600;">Value</th>
              <th style="text-align:right;padding:0.4rem 0;font-weight:600;">ROI</th>
            </tr>
          </thead>
          <tbody>
            ${summary.trailing_3_months.map((m) => html`
              <tr style="border-bottom:1px solid var(--border-color,#f1f5f9);">
                <td style="padding:0.5rem 0;"><a href="/roi/${m.month}" style="text-decoration:none;">${m.month}</a></td>
                <td style="padding:0.5rem 0;text-align:right;font-weight:600;">${fmtDollars(m.total_value_dollars)}</td>
                <td style="padding:0.5rem 0;text-align:right;opacity:0.7;">${m.roi_multiple !== null ? `${m.roi_multiple.toFixed(1)}×` : '—'}</td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    </div>

    <!-- ── Agent Performance Table ──────────────────────────────────────── -->
    <div class="card" style="margin-bottom:1.5rem;">
      <h3 style="margin-top:0;">Agent Performance — ${currentMonth}</h3>
      ${breakdown.by_agent.length === 0
        ? html`<p class="text-muted">No recommendations tracked yet this month.</p>`
        : html`
          <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
            <thead>
              <tr style="border-bottom:1px solid var(--border-color,#e2e8f0);">
                <th style="text-align:left;padding:0.4rem 0;font-weight:600;">Agent</th>
                <th style="text-align:right;padding:0.4rem 0;font-weight:600;">Value Delivered</th>
                <th style="text-align:right;padding:0.4rem 0;font-weight:600;">Action Rate</th>
              </tr>
            </thead>
            <tbody>
              ${breakdown.by_agent.map((a) => html`
                <tr style="border-bottom:1px solid var(--border-color,#f1f5f9);">
                  <td style="padding:0.5rem 0;">${a.agent}</td>
                  <td style="padding:0.5rem 0;text-align:right;font-weight:600;color:var(--color-success,#059669);">${fmtDollars(a.value)}</td>
                  <td style="padding:0.5rem 0;text-align:right;">${fmtPct(a.action_rate)}</td>
                </tr>
              `)}
            </tbody>
          </table>
        `}
    </div>

    <!-- ── Top Recommendations ───────────────────────────────────────────── -->
    ${breakdown.top_recommendations.length > 0 ? html`
      <div class="card">
        <h3 style="margin-top:0;">Top Value-Generating Recommendations</h3>
        <div style="display:flex;flex-direction:column;gap:0.75rem;">
          ${breakdown.top_recommendations.map((rec) => html`
            <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:0.75rem;background:var(--bg-secondary,var(--surface-3));border-radius:0.5rem;gap:1rem;">
              <p style="margin:0;font-size:0.9rem;flex:1;">${rec.text}</p>
              <div style="text-align:right;white-space:nowrap;">
                <div style="font-weight:700;color:var(--color-success,#059669);">${fmtDollars(rec.value)}</div>
                <div style="font-size:0.75rem;opacity:0.6;">${rec.outcome}</div>
              </div>
            </div>
          `)}
        </div>
      </div>
    ` : html``}
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── GET /roi/:month — Month Detail ──────────────────────────────────────────

roiDashboard.get('/roi/:month', async (c) => {
  const founder = c.get('founder');
  const month = c.req.param('month');
  const ctx = await getLayoutContext(founder, 'roi', `ROI — ${month}`, undefined, c);

  if (!ctx.productId) return c.redirect('/roi');
  const productId = ctx.productId;

  const [roiData, breakdown, recommendations] = await Promise.all([
    computeMonthlyROI(productId, month),
    getROIBreakdown(productId, month),
    query(
      `SELECT id, agent_name, recommendation_text, recommendation_date, action_taken,
              outcome, outcome_notes, estimated_value_dollars, category
       FROM recommendation_outcomes
       WHERE product_id = ?
         AND strftime('%Y-%m', recommendation_date) = ?
       ORDER BY recommendation_date DESC`,
      [productId, month],
    ),
  ]);

  const recs = recommendations.rows as Array<Record<string, unknown>>;

  const content = html`
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:0.75rem;">
      <div>
        <a href="/roi" style="font-size:0.85rem;opacity:0.6;text-decoration:none;">← ROI Dashboard</a>
        <h1 style="margin:0.25rem 0 0;">ROI — ${month}</h1>
      </div>
      <div style="font-size:2rem;font-weight:800;color:var(--color-success,#059669);">${fmtDollars(roiData.total_value_dollars)}</div>
    </div>

    <!-- ── Month Summary Cards ────────────────────────────────────────────── -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1rem;margin-bottom:1.5rem;">
      <div class="card" style="padding:1rem;">
        <div style="font-size:1.5rem;font-weight:700;">${fmtDollars(roiData.churn_prevented_dollars)}</div>
        <div style="font-size:0.75rem;opacity:0.6;margin-top:0.2rem;">Churn Prevented</div>
      </div>
      <div class="card" style="padding:1rem;">
        <div style="font-size:1.5rem;font-weight:700;">${fmtDollars(roiData.expansion_captured_dollars)}</div>
        <div style="font-size:0.75rem;opacity:0.6;margin-top:0.2rem;">Expansion Captured</div>
      </div>
      <div class="card" style="padding:1rem;">
        <div style="font-size:1.5rem;font-weight:700;">${fmtDollars(roiData.cost_avoided_dollars)}</div>
        <div style="font-size:0.75rem;opacity:0.6;margin-top:0.2rem;">Cost Avoided</div>
      </div>
      <div class="card" style="padding:1rem;">
        <div style="font-size:1.5rem;font-weight:700;">${fmtDollars(roiData.time_saved_dollars)}</div>
        <div style="font-size:0.75rem;opacity:0.6;margin-top:0.2rem;">Time Saved</div>
      </div>
      <div class="card" style="padding:1rem;">
        <div style="font-size:1.5rem;font-weight:700;">${fmtPct(roiData.action_rate_pct)}</div>
        <div style="font-size:0.75rem;opacity:0.6;margin-top:0.2rem;">Action Rate</div>
      </div>
      <div class="card" style="padding:1rem;">
        <div style="font-size:1.5rem;font-weight:700;">${roiData.roi_multiple !== null ? `${roiData.roi_multiple.toFixed(1)}×` : '—'}</div>
        <div style="font-size:0.75rem;opacity:0.6;margin-top:0.2rem;">ROI Multiple</div>
      </div>
    </div>

    <!-- ── By Agent ───────────────────────────────────────────────────────── -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;margin-bottom:1.5rem;">
      <div class="card">
        <h3 style="margin-top:0;">By Agent</h3>
        ${breakdown.by_agent.length === 0
          ? html`<p class="text-muted">No data.</p>`
          : html`
            <table style="width:100%;border-collapse:collapse;font-size:0.875rem;">
              <thead><tr style="border-bottom:1px solid var(--border-color,#e2e8f0);">
                <th style="text-align:left;padding:0.4rem 0;">Agent</th>
                <th style="text-align:right;padding:0.4rem 0;">Value</th>
                <th style="text-align:right;padding:0.4rem 0;">Action %</th>
              </tr></thead>
              <tbody>
                ${breakdown.by_agent.map((a) => html`
                  <tr style="border-bottom:1px solid var(--border-color,#f1f5f9);">
                    <td style="padding:0.4rem 0;">${a.agent}</td>
                    <td style="padding:0.4rem 0;text-align:right;font-weight:600;">${fmtDollars(a.value)}</td>
                    <td style="padding:0.4rem 0;text-align:right;">${fmtPct(a.action_rate)}</td>
                  </tr>
                `)}
              </tbody>
            </table>
          `}
      </div>

      <!-- ── By Category ─────────────────────────────────────────────────── -->
      <div class="card">
        <h3 style="margin-top:0;">By Category</h3>
        ${breakdown.by_category.length === 0
          ? html`<p class="text-muted">No data.</p>`
          : html`
            <table style="width:100%;border-collapse:collapse;font-size:0.875rem;">
              <thead><tr style="border-bottom:1px solid var(--border-color,#e2e8f0);">
                <th style="text-align:left;padding:0.4rem 0;">Category</th>
                <th style="text-align:right;padding:0.4rem 0;">Value</th>
                <th style="text-align:right;padding:0.4rem 0;">Count</th>
              </tr></thead>
              <tbody>
                ${breakdown.by_category.map((cat) => html`
                  <tr style="border-bottom:1px solid var(--border-color,#f1f5f9);">
                    <td style="padding:0.4rem 0;">${CATEGORY_LABELS[cat.category] ?? cat.category}</td>
                    <td style="padding:0.4rem 0;text-align:right;font-weight:600;">${fmtDollars(cat.value)}</td>
                    <td style="padding:0.4rem 0;text-align:right;">${cat.count}</td>
                  </tr>
                `)}
              </tbody>
            </table>
          `}
      </div>
    </div>

    <!-- ── Full Recommendation List ──────────────────────────────────────── -->
    <div class="card">
      <h3 style="margin-top:0;">All Recommendations (${recs.length})</h3>
      ${recs.length === 0
        ? html`<p class="text-muted">No recommendations tracked for this month.</p>`
        : html`
          <div style="display:flex;flex-direction:column;gap:1rem;">
            ${recs.map((rec) => {
              const outcome = rec.outcome as string | null;
              const actionTaken = (rec.action_taken as number) === 1;
              const outcomeColor = outcome === 'positive' ? '#059669' : outcome === 'negative' ? '#dc2626' : '#94a3b8';
              return html`
                <div style="border:1px solid var(--border-color,#e2e8f0);border-radius:0.75rem;padding:1rem;">
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;margin-bottom:0.5rem;">
                    <div>
                      <span style="font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;opacity:0.55;">${rec.agent_name}</span>
                      <span style="margin-left:0.5rem;font-size:0.75rem;opacity:0.4;">${rec.recommendation_date}</span>
                    </div>
                    <div style="display:flex;gap:0.5rem;align-items:center;white-space:nowrap;">
                      ${actionTaken ? html`<span style="font-size:0.75rem;background:#dcfce7;color:#166534;border-radius:1rem;padding:0.15rem 0.6rem;">Acted On</span>` : html`<span style="font-size:0.75rem;background:#f1f5f9;color:#64748b;border-radius:1rem;padding:0.15rem 0.6rem;">Pending</span>`}
                      ${outcome ? html`<span style="font-size:0.75rem;border-radius:1rem;padding:0.15rem 0.6rem;background:${outcomeColor}20;color:${outcomeColor};">${outcome}</span>` : html``}
                      ${rec.estimated_value_dollars ? html`<span style="font-weight:700;color:#059669;">${fmtDollars(rec.estimated_value_dollars as number)}</span>` : html``}
                    </div>
                  </div>
                  <p style="margin:0 0 0.75rem;font-size:0.9rem;">${rec.recommendation_text}</p>
                  ${rec.outcome_notes ? html`<p style="margin:0;font-size:0.8rem;opacity:0.6;font-style:italic;">${rec.outcome_notes}</p>` : html``}

                  <!-- ── Outcome Form ─────────────────────────────────────── -->
                  ${!outcome ? html`
                    <details style="margin-top:0.75rem;">
                      <summary style="font-size:0.8rem;cursor:pointer;opacity:0.7;">Record Outcome</summary>
                      <form method="POST" action="/roi/outcome/${rec.id}" style="margin-top:0.75rem;display:flex;flex-direction:column;gap:0.5rem;">
                        <div style="display:flex;gap:1rem;">
                          <label style="font-size:0.85rem;display:flex;align-items:center;gap:0.35rem;"><input type="radio" name="outcome" value="positive" required> Positive</label>
                          <label style="font-size:0.85rem;display:flex;align-items:center;gap:0.35rem;"><input type="radio" name="outcome" value="neutral"> Neutral</label>
                          <label style="font-size:0.85rem;display:flex;align-items:center;gap:0.35rem;"><input type="radio" name="outcome" value="negative"> Negative</label>
                        </div>
                        <input type="number" name="actual_value" placeholder="Actual value ($, optional)" step="0.01" min="0" style="padding:0.35rem 0.6rem;border:1px solid var(--border-color,#e2e8f0);border-radius:0.4rem;font-size:0.85rem;width:200px;">
                        <textarea name="notes" placeholder="Notes (optional)" rows="2" style="padding:0.35rem 0.6rem;border:1px solid var(--border-color,#e2e8f0);border-radius:0.4rem;font-size:0.85rem;resize:vertical;"></textarea>
                        <div><button type="submit" class="btn btn-sm">Save Outcome</button></div>
                      </form>
                    </details>
                  ` : html``}
                </div>
              `;
            })}
          </div>
        `}
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /roi/compute — Trigger Recompute ────────────────────────────────────

roiDashboard.post('/roi/compute', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'roi', 'ROI', undefined, c);
  if (!ctx.productId) return c.redirect('/roi');

  const productId = ctx.productId;
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  await Promise.all([
    computeMonthlyROI(productId, currentMonth),
    inferOutcomesFromData(productId),
  ]);

  return c.redirect('/roi');
});

// ─── POST /roi/outcome/:id — Record Outcome ───────────────────────────────────

roiDashboard.post('/roi/outcome/:id', async (c) => {
  const founder = c.get('founder');
  const recommendationId = c.req.param('id');
  const body = await c.req.parseBody() as Record<string, string>;

  // Verify this recommendation belongs to this founder's product
  const check = await query(
    `SELECT ro.id, ro.recommendation_date FROM recommendation_outcomes ro
     JOIN products p ON ro.product_id = p.id
     WHERE ro.id = ? AND p.owner_id = ?`,
    [recommendationId, founder.id],
  );
  if (check.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const outcome = body.outcome as 'positive' | 'neutral' | 'negative';
  const notes = body.notes?.trim() || undefined;
  const actualValue = body.actual_value ? parseFloat(body.actual_value) : undefined;

  if (!['positive', 'neutral', 'negative'].includes(outcome)) {
    return c.redirect('/roi');
  }

  await recordOutcome(recommendationId, {
    outcome,
    notes,
    actual_value_dollars: actualValue && !isNaN(actualValue) ? actualValue : undefined,
  });

  // Redirect back to the month detail
  const rec = check.rows[0] as Record<string, string>;
  const month = rec.recommendation_date?.substring(0, 7) ?? '';
  return c.redirect(month ? `/roi/${month}` : '/roi');
});
