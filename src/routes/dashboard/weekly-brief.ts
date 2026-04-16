// =============================================================================
// FOUNDRY — Weekly Compressed Brief Route
// 15-minute digest for low-engagement users.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import {
  generateCompressedWeeklyBrief,
  getLatestCompressedBrief,
} from '../../services/scp/briefing/compressed.js';

export const weeklyBrief = new Hono<AuthEnv>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtWeek(weekOf: string): string {
  // '2026-W14' → 'Week of Apr 7, 2026'
  try {
    const [year, week] = weekOf.split('-W');
    const yearNum = parseInt(year, 10);
    const weekNum = parseInt(week, 10);
    // Find the Monday of that ISO week
    const jan4 = new Date(Date.UTC(yearNum, 0, 4));
    const weekStart = new Date(jan4.getTime() + (weekNum - 1) * 7 * 86400000);
    const dayOfWeek = weekStart.getUTCDay() || 7;
    weekStart.setUTCDate(weekStart.getUTCDate() - dayOfWeek + 1);
    return `Week of ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`;
  } catch {
    return weekOf;
  }
}

function trendArrow(trend: string): string {
  if (trend === 'improving') return '↑';
  if (trend === 'declining') return '↓';
  return '→';
}

function trendColor(trend: string): string {
  if (trend === 'improving') return '#4ecca3';
  if (trend === 'declining') return '#ff6b6b';
  return '#ffb347';
}

function fmtDelta(val: unknown, suffix = '%'): string {
  if (val === null || val === undefined) return '—';
  const n = Number(val);
  if (isNaN(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}${suffix}`;
}

function healthColor(score: number): string {
  return score >= 70 ? '#4ecca3' : score >= 40 ? '#ffb347' : '#ff6b6b';
}

// ─── GET /brief ───────────────────────────────────────────────────────────────

weeklyBrief.get('/brief', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'agents', 'Weekly Brief', undefined, c);

  if (!ctx.productId) {
    const content = html`
      <div style="margin-bottom:1.5rem;">
        <a href="/agents" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Agent Roster</a>
      </div>
      <h1 style="margin:0 0 0.5rem;">Weekly Brief</h1>
      <p style="color:var(--text-dim);">No product selected.</p>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;
  const brief = await getLatestCompressedBrief(productId).catch(() => null);

  const backNav = html`
    <div style="margin-bottom:1.5rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.75rem;">
      <a href="/agents" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Agent Roster</a>
      <form method="POST" action="/brief/generate">
        <button type="submit" class="btn btn-ghost" style="font-size:0.8rem;">Regenerate</button>
      </form>
    </div>
  `;

  if (!brief) {
    const content = html`
      ${backNav}
      <div style="max-width:520px;margin:0 auto;">
        <div class="card" style="padding:2.5rem;text-align:center;border:1px solid rgba(255,255,255,0.06);">
          <div style="font-size:2rem;margin-bottom:1rem;">📋</div>
          <h2 style="margin:0 0 0.5rem;">No weekly brief yet</h2>
          <p style="color:var(--text-dim);margin:0 0 1.5rem;font-size:0.9rem;">Generate your first compressed brief to get a 3-minute summary of your company's status.</p>
          <form method="POST" action="/brief/generate">
            <button type="submit" class="btn btn-primary">Generate Weekly Brief</button>
          </form>
        </div>
      </div>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const hColor = healthColor(brief.health_score);
  const trend = brief.health_trend;
  const delta = brief.metrics_delta;

  // Metric deltas
  const hasMrr = delta.mrr_change_pct !== undefined && delta.mrr_change_pct !== null;
  const hasChurn = delta.churn_change !== undefined && delta.churn_change !== null;
  const hasActivation = delta.activation_change !== undefined && delta.activation_change !== null;
  const hasMetrics = hasMrr || hasChurn || hasActivation;

  const mrrDelta = fmtDelta(delta.mrr_change_pct);
  const churnDelta = fmtDelta(delta.churn_change);
  const activationDelta = fmtDelta(delta.activation_change);

  // Churn direction is inverted: negative change = good
  const churnDeltaColor = delta.churn_change !== undefined && delta.churn_change !== null
    ? (Number(delta.churn_change) <= 0 ? '#4ecca3' : '#ff6b6b')
    : 'var(--text-primary)';
  const mrrDeltaColor = delta.mrr_change_pct !== undefined && delta.mrr_change_pct !== null
    ? (Number(delta.mrr_change_pct) >= 0 ? '#4ecca3' : '#ff6b6b')
    : 'var(--text-primary)';
  const activationDeltaColor = delta.activation_change !== undefined && delta.activation_change !== null
    ? (Number(delta.activation_change) >= 0 ? '#4ecca3' : '#ff6b6b')
    : 'var(--text-primary)';

  const content = html`
    ${backNav}

    <!-- Main brief card — deliberately minimal, single column, large text -->
    <div style="max-width:560px;margin:0 auto;">
      <div class="card" style="padding:2rem;border:1px solid rgba(255,255,255,0.08);">

        <!-- Week header -->
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:1.25rem;">
          ${fmtWeek(brief.week_of)}
          <span style="margin-left:0.75rem;opacity:0.5;">~${brief.estimated_read_minutes.toFixed(0)} min read</span>
        </div>

        <!-- Health score -->
        <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1.5rem;">
          <span style="font-size:2rem;font-weight:800;color:${hColor};">${brief.health_score}</span>
          <div>
            <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);">Health Score</div>
            <div style="font-size:0.9rem;font-weight:600;color:${trendColor(trend)};">${trendArrow(trend)} ${trend}</div>
          </div>
        </div>

        <!-- One-sentence status — large, readable -->
        <div style="font-size:1.1rem;line-height:1.6;color:var(--text-primary);margin-bottom:1.75rem;padding:1rem 1.25rem;background:rgba(255,255,255,0.03);border-radius:8px;border-left:3px solid var(--accent);">
          &ldquo;${brief.one_sentence_status}&rdquo;
        </div>

        <!-- This week's 3 things -->
        <div style="margin-bottom:1.75rem;">
          <div style="font-size:0.72rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.875rem;">This week's 3 things</div>
          ${brief.top_3.map((item, i) => html`
          <div style="display:flex;gap:0.875rem;align-items:flex-start;padding:0.625rem 0;border-bottom:1px solid rgba(255,255,255,0.04);">
            <span style="font-size:1rem;font-weight:700;color:var(--accent);min-width:1.25rem;">${i + 1}.</span>
            <span style="font-size:0.9rem;color:var(--text-dim);line-height:1.5;">${item}</span>
          </div>`)}
        </div>

        <!-- One decision to make -->
        ${brief.one_decision_to_make ? html`
        <div style="margin-bottom:1.75rem;padding:1rem 1.25rem;background:rgba(255,179,71,0.06);border:1px solid rgba(255,179,71,0.2);border-radius:8px;">
          <div style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#ffb347;margin-bottom:0.4rem;">One decision to make</div>
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
            <p style="margin:0;font-size:0.9rem;color:var(--text-primary);line-height:1.5;flex:1;">${brief.one_decision_to_make}</p>
            <a href="/agents/decisions" class="btn btn-ghost" style="font-size:0.8rem;white-space:nowrap;color:#ffb347;border-color:#ffb34744;">Decide →</a>
          </div>
        </div>` : ''}

        <!-- Metrics delta -->
        ${hasMetrics ? html`
        <div style="margin-bottom:1.75rem;">
          <div style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.625rem;">── Metrics ──────────────────</div>
          <div style="display:flex;gap:2rem;flex-wrap:wrap;">
            ${hasMrr ? html`
            <div>
              <div style="font-size:0.7rem;color:var(--text-muted);">MRR</div>
              <div style="font-size:1.1rem;font-weight:700;color:${mrrDeltaColor};">${mrrDelta}</div>
            </div>` : ''}
            ${hasChurn ? html`
            <div>
              <div style="font-size:0.7rem;color:var(--text-muted);">Churn</div>
              <div style="font-size:1.1rem;font-weight:700;color:${churnDeltaColor};">${churnDelta}</div>
            </div>` : ''}
            ${hasActivation ? html`
            <div>
              <div style="font-size:0.7rem;color:var(--text-muted);">Activation</div>
              <div style="font-size:1.1rem;font-weight:700;color:${activationDeltaColor};">${activationDelta}</div>
            </div>` : ''}
          </div>
        </div>` : ''}

        <!-- Agent consensus -->
        ${brief.agent_consensus ? html`
        <div style="margin-bottom:1.75rem;padding:0.875rem 1rem;background:rgba(255,255,255,0.02);border-radius:6px;">
          <div style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.35rem;">Agent Consensus</div>
          <p style="margin:0;font-size:0.85rem;color:var(--text-dim);line-height:1.5;">${brief.agent_consensus}</p>
        </div>` : ''}

        <!-- Footer -->
        <div style="padding-top:1rem;border-top:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;">
          <span style="font-size:0.72rem;color:var(--text-muted);">Generated ${new Date(brief.generated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          <a href="/agents/briefings/latest" style="font-size:0.82rem;color:var(--accent);text-decoration:none;">View full briefing →</a>
        </div>
      </div>
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /brief/generate ─────────────────────────────────────────────────────

weeklyBrief.post('/brief/generate', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'agents', 'Generate Brief', undefined, c);

  if (!ctx.productId) {
    return c.redirect('/brief');
  }

  try {
    await generateCompressedWeeklyBrief(ctx.productId);
  } catch {
    // Non-fatal — just redirect back
  }

  return c.redirect('/brief');
});
