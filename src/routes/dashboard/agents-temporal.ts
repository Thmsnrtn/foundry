// =============================================================================
// FOUNDRY — Temporal Intelligence Routes
// Signal timeline, trend analysis, agent performance over time.
// Phase 3 (Investor-Ready tier) feature.
// =============================================================================

import { Hono } from 'hono';
import { html, raw } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import {
  getSignalTimeline,
  analyzeTemporalTrends,
  getAgentPerformanceOverTime,
  type SignalTimelineEntry,
} from '../../services/scp/temporal.js';
import { AGENT_DISPLAY_NAMES, AGENT_ROLES, type AgentName } from '../../services/scp/types.js';

export const agentTemporalRoutes = new Hono<AuthEnv>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function trendLabel(direction: string): string {
  if (direction === 'improving') return '↑ Improving';
  if (direction === 'declining') return '↓ Declining';
  return '→ Stable';
}

function trendColor(direction: string): string {
  if (direction === 'improving') return '#4ecca3';
  if (direction === 'declining') return '#ff6b6b';
  return '#ffb347';
}

function signalColor(score: number): string {
  if (score >= 70) return '#4ecca3';
  if (score >= 40) return '#ffb347';
  return '#ff6b6b';
}

function sparklineSVG(entries: SignalTimelineEntry[], width: number = 400, height: number = 60): string {
  if (entries.length < 2) return '';
  const scores = entries.map((e) => e.signal_score);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const range = maxScore - minScore || 1;

  const pts = entries
    .map((e, i) => {
      const x = (i / (entries.length - 1)) * width;
      const y = 4 + ((maxScore - e.signal_score) / range) * (height - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const lastEntry = entries[entries.length - 1];
  const strokeColor = signalColor(lastEntry?.signal_score ?? 50);
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow:visible;"><polyline points="${pts}" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/></svg>`;
}

function inflectionTypeBadge(type: string): string {
  const styles: Record<string, string> = {
    signal_spike: 'background:#4ecca322;color:#4ecca3;',
    signal_drop: 'background:#ff6b6b22;color:#ff6b6b;',
    evolution_burst: 'background:#6c63ff22;color:#6c63ff;',
    recovery: 'background:#ffb34722;color:#ffb347;',
  };
  const style = styles[type] ?? '';
  const label = type.replace(/_/g, ' ');
  return `<span style="font-size:0.65rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:2px 7px;border-radius:99px;${style}">${label}</span>`;
}

// ─── GET /agents/temporal ─────────────────────────────────────────────────────

agentTemporalRoutes.get('/agents/temporal', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'agents-temporal', 'Temporal Intelligence', undefined, c);

  if (!ctx.productId) {
    const content = html`
      <h1 style="margin:0 0 0.5rem;">Temporal Intelligence</h1>
      <p style="color:var(--text-dim);">No product selected.</p>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;

  let timeline: SignalTimelineEntry[] = [];
  try {
    timeline = await getSignalTimeline(productId, 90);
  } catch { /* non-fatal */ }

  let insights: Awaited<ReturnType<typeof analyzeTemporalTrends>> | null = null;
  if (timeline.length >= 7) {
    try {
      insights = await analyzeTemporalTrends(productId, timeline);
    } catch { /* non-fatal */ }
  }

  const topAgents: AgentName[] = ['oracle', 'harbor', 'atlas', 'ledger'];
  const agentPerfMap: Record<string, Array<{ date: string; sessions_count: number; success_rate: number; avg_health_score: number; decisions_proposed: number; evolution_events: number }>> = {};
  for (const agentName of topAgents) {
    try {
      agentPerfMap[agentName] = await getAgentPerformanceOverTime(productId, agentName, 30);
    } catch {
      agentPerfMap[agentName] = [];
    }
  }

  const avgSignal = timeline.length > 0
    ? Math.round(timeline.reduce((s, e) => s + e.signal_score, 0) / timeline.length)
    : null;
  const bestSignal = timeline.length > 0 ? Math.max(...timeline.map((e) => e.signal_score)) : null;
  const worstSignal = timeline.length > 0 ? Math.min(...timeline.map((e) => e.signal_score)) : null;
  const totalEvolutionEvents = timeline.reduce((s, e) => s + e.evolution_events, 0);
  const totalAiCost = timeline.reduce((s, e) => s + e.ai_cost_day, 0);
  const hasData = timeline.length >= 3;

  const content = html`
    <div style="margin-bottom:1.5rem;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;">
        <h1 style="margin:0;">Temporal Intelligence</h1>
        <span style="font-size:0.75rem;padding:3px 10px;border-radius:99px;background:rgba(108,99,255,0.12);color:#6c63ff;">Phase 3 — Investor-Ready</span>
      </div>
      <p style="color:var(--text-dim);margin:0.25rem 0 0;font-size:0.85rem;">Signal trends, agent performance over time, and inflection point detection.</p>
    </div>

    ${!hasData ? html`
    <div class="card" style="padding:2rem;text-align:center;">
      <div style="font-size:2.5rem;margin-bottom:0.75rem;">📈</div>
      <h3 style="margin:0 0 0.5rem;">Building your timeline</h3>
      <p style="color:var(--text-dim);margin:0;font-size:0.85rem;">Temporal intelligence activates after 3+ days of data. Your agents are running — check back soon.</p>
    </div>` : html`

    <!-- Stats -->
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:0.75rem;margin-bottom:1.5rem;">
      <div class="card" style="padding:1rem;text-align:center;">
        <div style="font-size:1.6rem;font-weight:800;color:var(--accent);">${timeline.length}</div>
        <div style="font-size:0.65rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);margin-top:0.2rem;">Days tracked</div>
      </div>
      ${avgSignal !== null ? html`
      <div class="card" style="padding:1rem;text-align:center;">
        <div style="font-size:1.6rem;font-weight:800;color:${signalColor(avgSignal)};">${avgSignal}</div>
        <div style="font-size:0.65rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);margin-top:0.2rem;">Avg Signal</div>
      </div>` : ''}
      ${bestSignal !== null ? html`
      <div class="card" style="padding:1rem;text-align:center;">
        <div style="font-size:1.6rem;font-weight:800;color:#4ecca3;">${bestSignal}</div>
        <div style="font-size:0.65rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);margin-top:0.2rem;">Peak Signal</div>
      </div>` : ''}
      <div class="card" style="padding:1rem;text-align:center;">
        <div style="font-size:1.6rem;font-weight:800;color:#6c63ff;">${totalEvolutionEvents}</div>
        <div style="font-size:0.65rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);margin-top:0.2rem;">Evolution Events</div>
      </div>
      <div class="card" style="padding:1rem;text-align:center;">
        <div style="font-size:1.3rem;font-weight:800;color:#38bdf8;">$${totalAiCost.toFixed(2)}</div>
        <div style="font-size:0.65rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);margin-top:0.2rem;">AI Cost</div>
      </div>
    </div>

    <!-- Signal Chart -->
    <div class="card" style="padding:1.25rem;margin-bottom:1.5rem;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:1rem;">
        Signal Over Time — ${timeline.length} days
      </div>
      <div style="overflow-x:auto;padding:0.25rem 0;">
        ${raw(sparklineSVG(timeline, Math.max(360, timeline.length * 5), 72))}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:0.7rem;color:var(--text-muted);margin-top:0.4rem;">
        <span>${timeline[0]?.date ?? ''}</span>
        <span>${timeline[timeline.length - 1]?.date ?? ''}</span>
      </div>
    </div>

    ${insights ? html`
    <!-- Trend -->
    <div class="card" style="padding:1.25rem;margin-bottom:1.5rem;border-left:3px solid ${trendColor(insights.trend_direction)};">
      <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.5rem;flex-wrap:wrap;">
        <span style="font-weight:700;font-size:0.95rem;color:${trendColor(insights.trend_direction)};">${trendLabel(insights.trend_direction)}</span>
        <span style="font-size:0.75rem;color:var(--text-muted);">AI cost ${insights.cost_trend} · $${insights.avg_daily_cost_usd.toFixed(3)}/day avg</span>
      </div>
      <p style="margin:0;font-size:0.85rem;color:var(--text-dim);line-height:1.6;">${insights.trend_description}</p>
      ${insights.prediction_notes ? html`<p style="margin:0.6rem 0 0;font-size:0.8rem;color:var(--text-muted);font-style:italic;">${insights.prediction_notes}</p>` : ''}
    </div>

    <!-- Best / Worst -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1.5rem;">
      <div class="card" style="padding:1rem;border-left:3px solid #4ecca3;">
        <div style="font-size:0.65rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#4ecca3;margin-bottom:0.4rem;">Best Week</div>
        <div style="font-size:1.5rem;font-weight:800;color:#4ecca3;">${insights.best_week.avg_signal.toFixed(0)}</div>
        <div style="font-size:0.72rem;color:var(--text-muted);">avg signal · ${insights.best_week.start_date}</div>
      </div>
      <div class="card" style="padding:1rem;border-left:3px solid #ff6b6b;">
        <div style="font-size:0.65rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#ff6b6b;margin-bottom:0.4rem;">Worst Week</div>
        <div style="font-size:1.5rem;font-weight:800;color:#ff6b6b;">${insights.worst_week.avg_signal.toFixed(0)}</div>
        <div style="font-size:0.72rem;color:var(--text-muted);">avg signal · ${insights.worst_week.start_date}</div>
      </div>
    </div>

    ${insights.inflection_points.length > 0 ? html`
    <!-- Inflection Points -->
    <div class="card" style="padding:0;overflow:hidden;margin-bottom:1.5rem;">
      <div style="padding:1rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.07);">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Key Inflection Points</div>
      </div>
      ${insights.inflection_points.map((pt) => html`
      <div style="padding:0.85rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;gap:0.75rem;align-items:flex-start;">
        <div style="flex-shrink:0;font-size:0.72rem;color:var(--text-muted);min-width:80px;padding-top:2px;">${pt.date}</div>
        <div style="flex:1;">
          <div style="margin-bottom:0.3rem;">${raw(inflectionTypeBadge(pt.type))}</div>
          <div style="font-size:0.82rem;color:var(--text-dim);">${pt.description}</div>
          <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.2rem;">${pt.signal_before} → ${pt.signal_after}</div>
        </div>
      </div>`)}
    </div>` : ''}` : ''}

    <!-- Agent Performance -->
    <div class="card" style="padding:0;overflow:hidden;margin-bottom:1.5rem;">
      <div style="padding:1rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.07);">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Top Agent Performance — 30 Days</div>
      </div>
      ${topAgents.map((agentName) => {
        const perf = agentPerfMap[agentName] ?? [];
        const totalSessions = perf.reduce((s, p) => s + p.sessions_count, 0);
        const avgSuccess = perf.length > 0 ? perf.reduce((s, p) => s + p.success_rate, 0) / perf.length : 0;
        const avgHealth = perf.length > 0 ? perf.reduce((s, p) => s + p.avg_health_score, 0) / perf.length : 50;
        const healthColor = avgHealth >= 70 ? '#4ecca3' : avgHealth >= 40 ? '#ffb347' : '#ff6b6b';

        return html`
        <div style="padding:0.85rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;align-items:center;gap:1rem;flex-wrap:wrap;">
          <div style="flex:1;min-width:100px;">
            <div style="font-size:0.85rem;font-weight:600;color:var(--text-primary);">${AGENT_DISPLAY_NAMES[agentName]}</div>
            <div style="font-size:0.7rem;color:var(--text-muted);">${AGENT_ROLES[agentName]}</div>
          </div>
          <div style="text-align:center;">
            <div style="font-size:1rem;font-weight:700;color:${healthColor};">${Math.round(avgHealth)}</div>
            <div style="font-size:0.62rem;color:var(--text-muted);">health</div>
          </div>
          <div style="text-align:center;">
            <div style="font-size:1rem;font-weight:700;color:var(--text-dim);">${totalSessions}</div>
            <div style="font-size:0.62rem;color:var(--text-muted);">sessions</div>
          </div>
          <div style="text-align:center;">
            <div style="font-size:1rem;font-weight:700;color:var(--text-dim);">${Math.round(avgSuccess * 100)}%</div>
            <div style="font-size:0.62rem;color:var(--text-muted);">success</div>
          </div>
        </div>`;
      })}
    </div>

    <div style="text-align:center;font-size:0.75rem;">
      <a href="/agents" style="color:var(--text-dim);">← Agent Roster</a>
    </div>
    `}
  `;

  return c.html(dashboardLayout(ctx, content));
});
