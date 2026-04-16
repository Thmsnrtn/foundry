// =============================================================================
// FOUNDRY — Founder Intelligence Routes
// Decision quality and behavioral state detection dashboard.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import { query } from '../../db/client.js';
import {
  assessFounderState,
  getLatestFounderState,
  shouldWarnBeforeDecision,
} from '../../services/scp/founder/decision-quality.js';
import { getDecisionQualityTrends } from '../../services/scp/founder/decision-tracker.js';

export const founderIntelligence = new Hono<AuthEnv>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stateColor(state: string): string {
  if (state === 'optimal') return '#4ecca3';
  if (state === 'watchful') return '#ffdd57';
  if (state === 'stressed') return '#ffb347';
  if (state === 'degraded') return '#ff6b6b';
  return 'var(--text-muted)';
}

function stateBackground(state: string): string {
  if (state === 'optimal') return 'rgba(78,204,163,0.1)';
  if (state === 'watchful') return 'rgba(255,221,87,0.1)';
  if (state === 'stressed') return 'rgba(255,179,71,0.1)';
  if (state === 'degraded') return 'rgba(255,107,107,0.1)';
  return 'rgba(255,255,255,0.05)';
}

function stateBorder(state: string): string {
  if (state === 'optimal') return 'rgba(78,204,163,0.3)';
  if (state === 'watchful') return 'rgba(255,221,87,0.3)';
  if (state === 'stressed') return 'rgba(255,179,71,0.3)';
  if (state === 'degraded') return 'rgba(255,107,107,0.3)';
  return 'rgba(255,255,255,0.1)';
}

function stateLabel(state: string): string {
  if (state === 'optimal') return 'Optimal';
  if (state === 'watchful') return 'Watchful';
  if (state === 'stressed') return 'Stressed';
  if (state === 'degraded') return 'Degraded';
  return 'Unknown';
}

function stateEmoji(state: string): string {
  if (state === 'optimal') return '●';
  if (state === 'watchful') return '◐';
  if (state === 'stressed') return '▲';
  if (state === 'degraded') return '■';
  return '○';
}

function severityColor(severity: string): string {
  if (severity === 'high') return '#ff6b6b';
  if (severity === 'medium') return '#ffb347';
  return '#ffdd57';
}

function pct(val: number): string {
  return `${Math.round(val * 100)}%`;
}

function trendBadge(trend: 'improving' | 'declining' | 'stable'): string {
  if (trend === 'improving') return '<span style="font-size:0.7rem;background:#4ecca322;color:#4ecca3;padding:2px 8px;border-radius:99px;font-weight:700;">↑ Improving</span>';
  if (trend === 'declining') return '<span style="font-size:0.7rem;background:#ff6b6b22;color:#ff6b6b;padding:2px 8px;border-radius:99px;font-weight:700;">↓ Declining</span>';
  return '<span style="font-size:0.7rem;background:rgba(255,255,255,0.06);color:var(--text-muted);padding:2px 8px;border-radius:99px;">→ Stable</span>';
}

// ─── GET /founder/state ────────────────────────────────────────────────────────

founderIntelligence.get('/founder/state', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'founder', 'Founder Decision Intelligence', undefined, c);

  if (!ctx.productId) {
    const content = html`
      <h1 style="margin:0 0 0.5rem;">Founder Decision Intelligence</h1>
      <p style="color:var(--text-dim);">No product selected.</p>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;

  // Load latest state and trends in parallel
  const [founderState, trends] = await Promise.all([
    getLatestFounderState(productId),
    getDecisionQualityTrends(productId),
  ]);

  // Load recent behavioral signals
  const signalsResult = await query(
    `SELECT signal_type, signal_description, severity, detected_at
     FROM founder_behavioral_signals
     WHERE product_id = ?
     ORDER BY detected_at DESC
     LIMIT 20`,
    [productId]
  );
  const recentSignals = signalsResult.rows.map((r) => r as Record<string, unknown>);

  // Load recent state assessments
  const assessmentsResult = await query(
    `SELECT state, confidence, contributing_signals_json, recommendation, assessed_at
     FROM founder_state_assessments
     WHERE product_id = ?
     ORDER BY assessed_at DESC
     LIMIT 10`,
    [productId]
  );
  const recentAssessments = assessmentsResult.rows.map((r) => r as Record<string, unknown>);

  // Current state display
  const currentState = founderState?.state ?? 'optimal';
  const stateClr = stateColor(currentState);
  const stateBg = stateBackground(currentState);
  const stateBrd = stateBorder(currentState);

  const signalRows = recentSignals.map((s) => {
    const sevColor = severityColor(s.severity as string);
    const dt = new Date((s.detected_at as string) + (s.detected_at as string).includes('T') ? '' : 'Z');
    const dtStr = isNaN(dt.getTime()) ? (s.detected_at as string) : dt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
    return html`
    <div style="padding:0.75rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.04);display:grid;grid-template-columns:120px 1fr 80px;gap:0.75rem;align-items:center;">
      <span style="font-size:0.72rem;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${sevColor};">${s.severity}</span>
      <span style="font-size:0.82rem;color:var(--text-dim);">${s.signal_description}</span>
      <span style="font-size:0.72rem;color:var(--text-muted);text-align:right;">${dtStr}</span>
    </div>`;
  });

  const assessmentRows = recentAssessments.map((a) => {
    const st = a.state as string;
    const clr = stateColor(st);
    const conf = Math.round((a.confidence as number) * 100);
    const dt = new Date((a.assessed_at as string) + (a.assessed_at as string).includes('T') ? '' : 'Z');
    const dtStr = isNaN(dt.getTime()) ? (a.assessed_at as string) : dt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
    return html`
    <div style="padding:0.7rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.04);display:grid;grid-template-columns:100px 80px 1fr;gap:0.75rem;align-items:center;">
      <span style="font-size:0.82rem;font-weight:700;color:${clr};">${stateEmoji(st)} ${stateLabel(st)}</span>
      <span style="font-size:0.75rem;color:var(--text-muted);">${conf}% conf.</span>
      <span style="font-size:0.72rem;color:var(--text-muted);">${dtStr}</span>
    </div>`;
  });

  const content = html`
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:0.75rem;">
      <h1 style="margin:0;">Founder Decision Intelligence</h1>
      <form method="POST" action="/founder/state/assess">
        <button type="submit" class="btn btn-primary" style="font-size:0.8rem;">Run Assessment Now</button>
      </form>
    </div>

    <!-- Explainer -->
    <div class="card" style="padding:1rem 1.25rem;margin-bottom:1.5rem;background:rgba(78,204,163,0.04);border:1px solid rgba(78,204,163,0.15);">
      <p style="margin:0;font-size:0.82rem;color:var(--text-dim);line-height:1.6;">
        <strong style="color:#4ecca3;">What is this?</strong>
        Foundry monitors your behavioral patterns — approval speed, override frequency, late-night activity, decision reversals —
        and flags when you may be in a degraded decision state. The goal is to warn you <em>before</em> you make an irreversible call
        under stress, sleep deprivation, or emotional reactivity.
      </p>
    </div>

    <!-- Current state card -->
    <div class="card" style="padding:1.5rem;margin-bottom:1.5rem;background:${stateBg};border:1px solid ${stateBrd};">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
        <div>
          <div style="font-size:0.65rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.35rem;">Current State</div>
          <div style="font-size:2.2rem;font-weight:800;color:${stateClr};line-height:1;">${stateEmoji(currentState)} ${stateLabel(currentState)}</div>
          ${founderState ? html`
          <div style="margin-top:0.75rem;font-size:0.85rem;color:var(--text-dim);max-width:520px;line-height:1.5;">
            ${founderState.recommendation}
          </div>
          ${founderState.recommended_deferral_hours ? html`
          <div style="margin-top:0.5rem;font-size:0.78rem;font-weight:600;color:${stateClr};">
            Recommended deferral: ${founderState.recommended_deferral_hours} hour(s)
          </div>` : ''}
          ` : html`<div style="margin-top:0.5rem;font-size:0.82rem;color:var(--text-muted);">No assessment yet — run one above.</div>`}
        </div>
        ${founderState ? html`
        <div style="text-align:right;">
          <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.25rem;">Confidence</div>
          <div style="font-size:1.8rem;font-weight:700;color:${stateClr};">${Math.round(founderState.confidence * 100)}%</div>
          <div style="font-size:0.72rem;color:var(--text-muted);">${founderState.contributing_signals.length} signal(s)</div>
        </div>` : ''}
      </div>
    </div>

    <!-- Contributing signals (current) -->
    ${founderState && founderState.contributing_signals.length > 0 ? html`
    <div style="margin-bottom:1.5rem;">
      <div style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.75rem;">Active Signals</div>
      <div class="card" style="padding:0;overflow:hidden;">
        ${founderState.contributing_signals.map((sig) => html`
        <div style="padding:0.75rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.04);font-size:0.82rem;color:var(--text-dim);">
          • ${sig}
        </div>`)}
      </div>
    </div>` : ''}

    <!-- Decision quality trends -->
    <div style="margin-bottom:1.5rem;">
      <div style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.75rem;">Decision Quality Trends</div>
      <div class="card" style="padding:1.25rem;">
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:1.25rem;">
          <div>
            <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.25rem;">Avg Quality Score</div>
            <div style="font-size:1.5rem;font-weight:700;color:${trends.average_quality_score !== null ? (trends.average_quality_score >= 4 ? '#4ecca3' : trends.average_quality_score >= 3 ? '#ffb347' : '#ff6b6b') : 'var(--text-muted)'};">
              ${trends.average_quality_score !== null ? trends.average_quality_score.toFixed(1) : '—'}<span style="font-size:0.85rem;color:var(--text-muted);font-weight:400;">/5</span>
            </div>
          </div>
          <div>
            <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.25rem;">Full Context %</div>
            <div style="font-size:1.5rem;font-weight:700;color:${trends.decisions_with_full_context_pct >= 0.7 ? '#4ecca3' : trends.decisions_with_full_context_pct >= 0.4 ? '#ffb347' : '#ff6b6b'};">
              ${pct(trends.decisions_with_full_context_pct)}
            </div>
          </div>
          <div>
            <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.25rem;">Best Decision Time</div>
            <div style="font-size:1.1rem;font-weight:700;color:#4ecca3;">${trends.best_decision_time_of_day}</div>
          </div>
          <div>
            <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.25rem;">Worst Decision Time</div>
            <div style="font-size:1.1rem;font-weight:700;color:#ff6b6b;">${trends.worst_decision_time_of_day}</div>
          </div>
          <div>
            <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.25rem;">Override Rate 30d</div>
            <div style="font-size:1.5rem;font-weight:700;color:${trends.override_rate_30d > 0.4 ? '#ff6b6b' : trends.override_rate_30d > 0.2 ? '#ffb347' : '#4ecca3'};">
              ${pct(trends.override_rate_30d)}
            </div>
          </div>
          <div>
            <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.25rem;">Override Rate 90d</div>
            <div style="font-size:1.5rem;font-weight:700;color:${trends.override_rate_90d > 0.4 ? '#ff6b6b' : trends.override_rate_90d > 0.2 ? '#ffb347' : '#4ecca3'};">
              ${pct(trends.override_rate_90d)}
            </div>
          </div>
          <div>
            <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.4rem;">Quality Trend</div>
            <div>${trendBadge(trends.trend)}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Behavioral signal history -->
    <div style="margin-bottom:1.5rem;">
      <div style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.75rem;">Behavioral Signal History</div>
      <div class="card" style="padding:0;overflow:hidden;">
        ${recentSignals.length === 0
          ? html`<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">No signals detected yet. Run an assessment to start tracking.</div>`
          : html`
            <div style="display:grid;grid-template-columns:120px 1fr 80px;gap:0.75rem;padding:0.6rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.07);">
              <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Severity</span>
              <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Signal</span>
              <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);text-align:right;">Detected</span>
            </div>
            ${signalRows}`}
      </div>
    </div>

    <!-- State assessment history -->
    <div style="margin-bottom:2rem;">
      <div style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.75rem;">Assessment History</div>
      <div class="card" style="padding:0;overflow:hidden;">
        ${recentAssessments.length === 0
          ? html`<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">No assessments recorded yet.</div>`
          : html`
            <div style="display:grid;grid-template-columns:100px 80px 1fr;gap:0.75rem;padding:0.6rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.07);">
              <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">State</span>
              <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Confidence</span>
              <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">When</span>
            </div>
            ${assessmentRows}`}
      </div>
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /founder/state/assess ───────────────────────────────────────────────

founderIntelligence.post('/founder/state/assess', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'founder', 'Founder Decision Intelligence', undefined, c);

  if (!ctx.productId) {
    return c.redirect('/founder/state');
  }

  try {
    await assessFounderState(ctx.productId);
  } catch {
    // Non-fatal — redirect regardless
  }

  return c.redirect('/founder/state');
});

// ─── GET /founder/state/api ───────────────────────────────────────────────────

founderIntelligence.get('/founder/state/api', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'founder', 'Founder State API', undefined, c);

  if (!ctx.productId) {
    return c.json({ state: 'optimal', should_warn: false, warning_message: null });
  }

  const [founderState, warnResult] = await Promise.all([
    getLatestFounderState(ctx.productId),
    shouldWarnBeforeDecision(ctx.productId),
  ]);

  return c.json({
    state: founderState?.state ?? 'optimal',
    should_warn: warnResult.should_warn,
    warning_message: warnResult.warning_message,
  });
});

// ─── Middleware Helper (exported, not registered) ─────────────────────────────

/**
 * Returns a warning string if founder state is stressed or degraded, null otherwise.
 * Used by other routes to show inline warnings before consequential actions.
 */
export async function getFounderStateWarning(productId: string): Promise<string | null> {
  const result = await shouldWarnBeforeDecision(productId);
  return result.should_warn ? result.warning_message : null;
}
