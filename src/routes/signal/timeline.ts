// =============================================================================
// FOUNDRY — Signal Timeline
// Full-page view: Signal over time annotated with stressors, decisions,
// risk state changes, and milestones. Server-rendered SVG. No JS required.
// =============================================================================

import { Hono } from 'hono';
import { html, raw } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { query } from '../../db/client.js';
import { getSignalHistory } from '../../services/signal.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from '../dashboard/_shared.js';

export const timelineRoutes = new Hono<AuthEnv>();

// ─── SVG Timeline ─────────────────────────────────────────────────────────────

interface HistoryPoint {
  score: number;
  tier: string;
  risk_state: string;
  snapshot_date: string;
}

interface TimelineEvent {
  date: string;
  type: 'decision' | 'stressor_add' | 'stressor_resolve' | 'milestone' | 'risk_change';
  label: string;
  color: string;
}

function buildTimelineSVG(history: HistoryPoint[], W = 800, H = 160): string {
  if (history.length < 2) return '';

  const pad = { top: 28, right: 20, bottom: 20, left: 38 };
  const cW = W - pad.left - pad.right;
  const cH = H - pad.top - pad.bottom;

  const xOf = (i: number) => pad.left + (i / (history.length - 1)) * cW;
  const yOf = (score: number) => pad.top + ((100 - score) / 100) * cH;

  // Risk-state background bands
  let bands = '';
  let bStart = 0;
  for (let i = 1; i <= history.length; i++) {
    const prev = history[i - 1];
    const curr = history[i];
    if (!curr || curr.risk_state !== prev.risk_state) {
      const state = prev.risk_state;
      const x1 = xOf(bStart);
      const x2 = xOf(Math.min(i, history.length - 1));
      const fill =
        state === 'red'    ? 'rgba(255,107,107,0.07)' :
        state === 'yellow' ? 'rgba(255,179,71,0.07)'  :
                             'rgba(78,204,163,0.04)';
      bands += `<rect x="${x1.toFixed(1)}" y="${pad.top}" width="${(x2 - x1).toFixed(1)}" height="${cH}" fill="${fill}" rx="0"/>`;
      bStart = i;
    }
  }

  // Area fill polygon (under the line)
  const areaPts =
    history.map((h, i) => `${xOf(i).toFixed(1)},${yOf(h.score).toFixed(1)}`).join(' ') +
    ` ${xOf(history.length - 1).toFixed(1)},${(pad.top + cH).toFixed(1)} ${pad.left.toFixed(1)},${(pad.top + cH).toFixed(1)}`;

  // Signal polyline
  const linePts = history.map((h, i) => `${xOf(i).toFixed(1)},${yOf(h.score).toFixed(1)}`).join(' ');

  // Horizontal grid lines
  let grid = '';
  for (const v of [0, 25, 50, 75, 100]) {
    const y = yOf(v).toFixed(1);
    grid += `<line x1="${pad.left}" y1="${y}" x2="${(pad.left + cW).toFixed(1)}" y2="${y}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`;
    grid += `<text x="${(pad.left - 5).toFixed(1)}" y="${(yOf(v) + 3).toFixed(1)}" font-size="8" fill="#3a3a5a" text-anchor="end" font-family="monospace">${v}</text>`;
  }

  // Month labels
  let monthLabels = '';
  const seenMonths = new Set<string>();
  const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  history.forEach((h, i) => {
    const m = h.snapshot_date.slice(0, 7);
    if (!seenMonths.has(m)) {
      seenMonths.add(m);
      const mm = parseInt(m.slice(5), 10);
      const x = xOf(i).toFixed(1);
      monthLabels += `<text x="${x}" y="${(pad.top - 10).toFixed(1)}" font-size="8.5" fill="#44445a" text-anchor="middle" font-family="-apple-system,sans-serif">${MONTHS[mm]}</text>`;
      monthLabels += `<line x1="${x}" y1="${(pad.top - 4).toFixed(1)}" x2="${x}" y2="${(pad.top + cH).toFixed(1)}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>`;
    }
  });

  return `<svg viewBox="0 0 ${W} ${H}" class="timeline-svg" preserveAspectRatio="none" aria-hidden="true">
  <defs>
    <linearGradient id="tl-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#6c63ff" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#6c63ff" stop-opacity="0.01"/>
    </linearGradient>
  </defs>
  ${bands}
  ${grid}
  ${monthLabels}
  <polygon points="${areaPts}" fill="url(#tl-grad)"/>
  <polyline points="${linePts}" fill="none" stroke="#6c63ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

// ─── Route ────────────────────────────────────────────────────────────────────

timelineRoutes.get('/signal/timeline', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'timeline', 'Signal Timeline', undefined, c);
  if (!ctx.productId) return c.redirect('/dashboard');

  const productId = ctx.productId;

  const [history, decisionsResult, stressorsResult, milestonesResult] = await Promise.all([
    getSignalHistory(productId, 365),
    query(
      `SELECT what, decided_at FROM decisions
       WHERE product_id = ? AND status = 'approved' AND decided_at IS NOT NULL
       ORDER BY decided_at ASC`,
      [productId],
    ),
    query(
      `SELECT stressor_name, severity, identified_at, resolved_at FROM stressor_history
       WHERE product_id = ?
       ORDER BY identified_at ASC`,
      [productId],
    ),
    query(
      `SELECT milestone_title, created_at FROM milestone_events
       WHERE product_id = ?
       ORDER BY created_at ASC`,
      [productId],
    ),
  ]);

  // Detect risk state transitions in history
  const riskChanges: TimelineEvent[] = [];
  for (let i = 1; i < history.length; i++) {
    if (history[i].risk_state !== history[i - 1].risk_state) {
      riskChanges.push({
        date: history[i].snapshot_date,
        type: 'risk_change',
        label: `→ ${history[i].risk_state.toUpperCase()}`,
        color: history[i].risk_state === 'red' ? '#ff6b6b' : history[i].risk_state === 'yellow' ? '#ffb347' : '#4ecca3',
      });
    }
  }

  // Build events list
  const events: TimelineEvent[] = [
    ...(decisionsResult.rows as Array<Record<string, string>>).map((d) => ({
      date: d.decided_at.slice(0, 10),
      type: 'decision' as const,
      label: d.what.length > 55 ? d.what.slice(0, 55) + '…' : d.what,
      color: '#6c63ff',
    })),
    ...(stressorsResult.rows as Array<Record<string, string>>).map((s) => ({
      date: s.identified_at.slice(0, 10),
      type: 'stressor_add' as const,
      label: `⚠ ${s.stressor_name}`,
      color: s.severity === 'critical' ? '#ff6b6b' : '#ffb347',
    })),
    ...(stressorsResult.rows as Array<Record<string, string>>)
      .filter((s) => s.resolved_at)
      .map((s) => ({
        date: s.resolved_at.slice(0, 10),
        type: 'stressor_resolve' as const,
        label: `✓ Resolved: ${s.stressor_name}`,
        color: '#4ecca3',
      })),
    ...(milestonesResult.rows as Array<Record<string, string>>).map((m) => ({
      date: m.created_at.slice(0, 10),
      type: 'milestone' as const,
      label: `★ ${m.milestone_title}`,
      color: '#ffd700',
    })),
    ...riskChanges,
  ].sort((a, b) => a.date.localeCompare(b.date));

  const svgStr = buildTimelineSVG(history);

  // Summary stats
  const firstScore = history[0]?.score ?? null;
  const lastScore = history[history.length - 1]?.score ?? null;
  const peakScore = history.length > 0 ? Math.max(...history.map((h) => h.score)) : null;
  const troughScore = history.length > 0 ? Math.min(...history.map((h) => h.score)) : null;
  const totalDelta = firstScore !== null && lastScore !== null ? lastScore - firstScore : null;

  const content = html`
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1.5rem;">
      <h1 style="margin:0;">Signal Timeline</h1>
      <a href="/dashboard" class="btn btn-ghost btn-sm">← Signal</a>
    </div>

    ${history.length < 2 ? html`
    <div class="card" style="text-align:center;padding:3rem;">
      <p style="color:var(--text-dim);font-size:0.9rem;">Signal history builds over time. Check back in a few days.</p>
      <a href="/dashboard" class="btn btn-ghost btn-sm" style="margin-top:1rem;">Go to Signal</a>
    </div>` : html`

    <div class="timeline-stats">
      ${firstScore !== null ? html`<div class="tl-stat"><div class="tl-stat-value">${firstScore}</div><div class="tl-stat-label">First signal</div></div>` : ''}
      ${lastScore !== null ? html`<div class="tl-stat"><div class="tl-stat-value">${lastScore}</div><div class="tl-stat-label">Current</div></div>` : ''}
      ${peakScore !== null ? html`<div class="tl-stat"><div class="tl-stat-value">${peakScore}</div><div class="tl-stat-label">Peak</div></div>` : ''}
      ${troughScore !== null ? html`<div class="tl-stat"><div class="tl-stat-value">${troughScore}</div><div class="tl-stat-label">Trough</div></div>` : ''}
      ${totalDelta !== null ? html`<div class="tl-stat"><div class="tl-stat-value ${totalDelta >= 0 ? 'tl-pos' : 'tl-neg'}">${totalDelta >= 0 ? '+' : ''}${totalDelta}</div><div class="tl-stat-label">Net change</div></div>` : ''}
    </div>

    <div class="card timeline-card">
      <div class="timeline-svg-wrap">${raw(svgStr)}</div>
      <div class="timeline-legend">
        <span class="tl-legend-item"><span class="tl-dot" style="background:#4ecca3"></span>Green state</span>
        <span class="tl-legend-item"><span class="tl-dot" style="background:#ffb347"></span>Yellow state</span>
        <span class="tl-legend-item"><span class="tl-dot" style="background:#ff6b6b"></span>Red state</span>
      </div>
    </div>

    ${events.length > 0 ? html`
    <div class="card">
      <div style="font-size:0.68rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-dim);margin-bottom:0.85rem;">Events</div>
      <div class="timeline-events">
        ${events.map((e) => html`
        <div class="tl-event">
          <div class="tl-event-date">${e.date}</div>
          <div class="tl-event-dot" style="background:${e.color}"></div>
          <div class="tl-event-label" style="color:${e.color === '#6c63ff' ? 'var(--text-muted)' : e.color}">${e.label}</div>
        </div>`)}
      </div>
    </div>` : ''}`}
  `;

  return c.html(dashboardLayout(ctx, content));
});
