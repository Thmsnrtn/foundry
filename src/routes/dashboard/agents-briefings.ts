// =============================================================================
// FOUNDRY — Agent Briefings Routes
// CEO briefing history and detail pages under /agents/briefings/*.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import { getBriefingHistory, getLatestBriefing } from '../../services/scp/briefing.js';
import { query } from '../../db/client.js';
import type { SCPBriefing, AgentDecision, AgentBriefingContribution, FinancialSummary } from '../../services/scp/types.js';
import { AGENT_ROLES } from '../../services/scp/types.js';

export const agentBriefingRoutes = new Hono<AuthEnv>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function fmtShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function scoreColor(score: number | null): string {
  if (score === null) return 'var(--text-muted)';
  return score >= 70 ? '#4ecca3' : score >= 40 ? '#ffb347' : '#ff6b6b';
}

function riskBadgeStyle(risk: string | null): string {
  if (risk === 'red') return 'background:#ff6b6b22;color:#ff6b6b;border:1px solid #ff6b6b44;';
  if (risk === 'yellow') return 'background:#ffb34722;color:#ffb347;border:1px solid #ffb34744;';
  return 'background:#4ecca322;color:#4ecca3;border:1px solid #4ecca344;';
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── GET /agents/briefings/latest — Redirect to latest briefing ───────────────

agentBriefingRoutes.get('/agents/briefings/latest', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'agents-briefings', 'Briefings', undefined, c);

  if (!ctx.productId) return c.redirect('/agents');

  // Try to find the most recent existing briefing
  const latest = await getLatestBriefing(ctx.productId);
  if (latest) {
    return c.redirect(`/agents/briefings/${latest.briefing_date}`);
  }

  // No briefing yet — redirect to today's date (will show empty state)
  return c.redirect(`/agents/briefings/${todayStr()}`);
});

// ─── GET /agents/briefings — Briefing History List ────────────────────────────

agentBriefingRoutes.get('/agents/briefings', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'agents-briefings', 'Briefing History', undefined, c);
  const { getFluency: brFl, explain: brEx } = await import('../../services/ux/fluency.js');
  const briefIntro = brEx('briefings', brFl(founder));

  if (!ctx.productId) {
    const content = html`
      <div style="margin-bottom:1.5rem;">
        <a href="/agents" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Agent Roster</a>
      </div>
      <h1 style="margin:0 0 0.5rem;">Briefing History</h1>
      <p style="color:var(--text-dim);">No product selected.</p>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const briefings = await getBriefingHistory(ctx.productId, 30);

  const rows = briefings.map((b) => {
    const pendingCount = (b.pending_decisions ?? []).length;
    const healthScore = b.health_score;
    const hColor = scoreColor(healthScore);
    return html`
    <a href="/agents/briefings/${b.briefing_date}" style="display:flex;align-items:center;gap:1rem;padding:0.9rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.05);text-decoration:none;color:inherit;transition:background 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.03)'" onmouseout="this.style.background=''">
      <div style="min-width:110px;font-size:0.82rem;font-weight:600;color:var(--text-primary);">${fmtShortDate(b.briefing_date)}</div>
      <div style="flex:1;font-size:0.82rem;color:var(--text-dim);overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${b.headline}</div>
      <div style="display:flex;align-items:center;gap:0.75rem;flex-shrink:0;">
        ${healthScore !== null ? html`<span style="font-size:0.75rem;font-weight:700;color:${hColor};">H: ${healthScore}</span>` : ''}
        ${pendingCount > 0 ? html`<span style="font-size:0.7rem;font-weight:700;background:#ffb34722;color:#ffb347;padding:2px 8px;border-radius:99px;">${pendingCount} pending</span>` : html`<span style="font-size:0.7rem;color:var(--text-muted);">—</span>`}
        <span style="font-size:0.8rem;color:var(--accent);">→</span>
      </div>
    </a>`;
  });

  const content = html`
    <div style="margin-bottom:1.5rem;">
      <a href="/agents" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Agent Roster</a>
    </div>

    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:0.5rem;">
      <h1 style="margin:0;">Briefing History</h1>
      <a href="/agents/briefings/latest" class="btn btn-primary" style="font-size:0.8rem;">Latest Briefing →</a>
    </div>
    ${briefIntro ? html`<p style="color:var(--text-muted);font-size:0.8rem;margin:-0.75rem 0 1.25rem;">${briefIntro}</p>` : ''}

    <div class="card" style="padding:0;overflow:hidden;">
      <div style="padding:0.875rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.07);display:flex;gap:1rem;align-items:center;">
        <span style="min-width:110px;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Date</span>
        <span style="flex:1;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Headline</span>
        <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Status</span>
      </div>
      ${briefings.length === 0
        ? html`<div style="padding:3rem;text-align:center;color:var(--text-muted);font-size:0.9rem;">No briefings yet. They're generated automatically each day as agents run.</div>`
        : rows}
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── GET /agents/briefings/:date — Briefing Detail ────────────────────────────

agentBriefingRoutes.get('/agents/briefings/:date', async (c) => {
  const founder = c.get('founder');
  const dateParam = c.req.param('date');

  // Validate date format YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return c.redirect('/agents/briefings');
  }

  const ctx = await getLayoutContext(founder, 'agents-briefings', `Briefing — ${dateParam}`, undefined, c);

  if (!ctx.productId) {
    const content = html`
      <div style="margin-bottom:1.5rem;">
        <a href="/agents" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Agent Roster</a>
      </div>
      <p style="color:var(--text-dim);">No product selected.</p>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;

  // Load the specific briefing
  const briefingResult = await query(
    'SELECT * FROM scp_briefings WHERE product_id = ? AND briefing_date = ?',
    [productId, dateParam]
  );

  // Activation funnel: first briefing viewed (Phase 5.2). Only when a briefing
  // actually exists for this date. Fire-and-forget.
  if (briefingResult.rows.length > 0) {
    void (async () => {
      try {
        const { recordFunnelStep } = await import('../../services/telemetry/funnel.js');
        await recordFunnelStep('briefing_viewed', { founderId: founder.id, productId });
      } catch { /* non-fatal */ }
    })();
  }

  // Load adjacent briefings for prev/next nav
  const [prevResult, nextResult] = await Promise.all([
    query(
      'SELECT briefing_date FROM scp_briefings WHERE product_id = ? AND briefing_date < ? ORDER BY briefing_date DESC LIMIT 1',
      [productId, dateParam]
    ),
    query(
      'SELECT briefing_date FROM scp_briefings WHERE product_id = ? AND briefing_date > ? ORDER BY briefing_date ASC LIMIT 1',
      [productId, dateParam]
    ),
  ]);

  const prevDate = prevResult.rows.length > 0 ? (prevResult.rows[0] as Record<string, unknown>).briefing_date as string : null;
  const nextDate = nextResult.rows.length > 0 ? (nextResult.rows[0] as Record<string, unknown>).briefing_date as string : null;

  // Navigation bar
  const navBar = html`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:0.75rem;">
      <a href="/agents" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Agent Roster</a>
      <div style="display:flex;align-items:center;gap:0.75rem;">
        ${prevDate ? html`<a href="/agents/briefings/${prevDate}" class="btn btn-ghost btn-sm">← ${fmtShortDate(prevDate)}</a>` : html`<span style="opacity:0.3;font-size:0.8rem;">No earlier</span>`}
        <a href="/agents/briefings" style="font-size:0.8rem;color:var(--text-dim);text-decoration:none;">History</a>
        ${nextDate ? html`<a href="/agents/briefings/${nextDate}" class="btn btn-ghost btn-sm">${fmtShortDate(nextDate)} →</a>` : html`<span style="opacity:0.3;font-size:0.8rem;">Latest</span>`}
      </div>
    </div>
  `;

  if (briefingResult.rows.length === 0) {
    const content = html`
      ${navBar}
      <div style="text-align:center;padding:4rem 2rem;background:var(--bg-card);border-radius:12px;border:1px solid rgba(255,255,255,0.06);">
        <div style="font-size:2.5rem;margin-bottom:1rem;">📋</div>
        <h2 style="margin:0 0 0.5rem;">No briefing for ${dateParam}</h2>
        <p style="color:var(--text-dim);margin:0 0 1.5rem;max-width:360px;margin-left:auto;margin-right:auto;">
          Briefings are generated automatically as agents run each day. Check back after your agents have completed their sessions.
        </p>
        <a href="/agents/briefings" class="btn btn-ghost">View History</a>
      </div>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  // Parse briefing row
  function parseJSONField<T>(value: unknown, fallback: T): T {
    if (value === null || value === undefined) return fallback;
    if (typeof value !== 'string') return fallback;
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }

  const row = briefingResult.rows[0] as Record<string, unknown>;
  const briefing: SCPBriefing = {
    id: row.id as string,
    product_id: row.product_id as string,
    briefing_date: row.briefing_date as string,
    signal_score: row.signal_score as number | null,
    risk_state: row.risk_state as string | null,
    health_score: row.health_score as number | null,
    headline: row.headline as string,
    full_briefing: row.full_briefing as string,
    agent_contributions: parseJSONField<AgentBriefingContribution[]>(row.agent_contributions, []),
    pending_decisions: parseJSONField<AgentDecision[]>(row.pending_decisions, []),
    overnight_actions: [],
    financial_summary: parseJSONField<FinancialSummary | null>(row.financial_summary, null),
    lifecycle_state: null,
    tokens_used: (row.tokens_used as number) ?? 0,
    cost_usd: (row.cost_usd as number) ?? 0,
    created_at: row.created_at as string,
  };

  const decisions = briefing.pending_decisions ?? [];
  const contributions = briefing.agent_contributions ?? [];
  const fin = briefing.financial_summary;

  const signalScore = briefing.signal_score;
  const healthScore = briefing.health_score;
  const signalDelta = signalScore !== null
    ? (signalScore >= 70 ? '↑' : signalScore >= 40 ? '→' : '↓')
    : '';

  // Metrics bar
  const metricsBar = html`
    <div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-top:0.75rem;">
      <span style="font-size:0.78rem;padding:4px 12px;border-radius:99px;background:rgba(255,255,255,0.06);color:var(--text-dim);">
        Signal: <strong style="color:${scoreColor(signalScore)};">${signalScore !== null ? `${signalScore}/100 ${signalDelta}` : 'N/A'}</strong>
      </span>
      <span style="font-size:0.78rem;padding:4px 12px;border-radius:99px;background:rgba(255,255,255,0.06);color:var(--text-dim);">
        Health: <strong style="color:${scoreColor(healthScore)};">${healthScore !== null ? `${healthScore}/100` : 'N/A'}</strong>
      </span>
      ${briefing.risk_state ? html`<span style="font-size:0.78rem;padding:4px 12px;border-radius:99px;${riskBadgeStyle(briefing.risk_state)}">Risk: <strong>${briefing.risk_state.toUpperCase()}</strong></span>` : ''}
    </div>
  `;

  // Overnight Activity section
  const highPriority = contributions.filter((c) => c.priority === 'high' && c.contribution);
  const normalPriority = contributions.filter((c) => c.priority !== 'high' && c.contribution);

  const activityItems = [
    ...highPriority.map((c) => html`
      <div style="border-left:3px solid #4ecca3;padding:0.75rem 1rem;margin-bottom:0.75rem;background:rgba(78,204,163,0.04);border-radius:0 6px 6px 0;">
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.35rem;">
          <span style="font-size:0.85rem;font-weight:700;color:var(--text-primary);">${c.display_name}</span>
          <span style="font-size:0.72rem;color:var(--text-muted);">${c.role}</span>
          <span style="font-size:0.65rem;font-weight:700;background:#4ecca322;color:#4ecca3;padding:1px 7px;border-radius:99px;text-transform:uppercase;letter-spacing:0.06em;">High</span>
          ${c.pending_decisions_count > 0 ? html`<span style="font-size:0.65rem;background:#ffb34722;color:#ffb347;padding:1px 7px;border-radius:99px;">${c.pending_decisions_count} decision${c.pending_decisions_count === 1 ? '' : 's'}</span>` : ''}
        </div>
        <p style="margin:0;font-size:0.85rem;color:var(--text-dim);line-height:1.55;">${c.contribution}</p>
      </div>
    `),
    ...normalPriority.map((c) => html`
      <div style="border-left:2px solid rgba(255,255,255,0.1);padding:0.6rem 1rem;margin-bottom:0.5rem;">
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem;">
          <span style="font-size:0.8rem;font-weight:600;color:var(--text-primary);">${c.display_name}</span>
          <span style="font-size:0.7rem;color:var(--text-muted);">${c.role}</span>
          ${c.pending_decisions_count > 0 ? html`<span style="font-size:0.65rem;background:#ffb34722;color:#ffb347;padding:1px 7px;border-radius:99px;">${c.pending_decisions_count} decision${c.pending_decisions_count === 1 ? '' : 's'}</span>` : ''}
        </div>
        <p style="margin:0;font-size:0.8rem;color:var(--text-dim);line-height:1.5;">${c.contribution}</p>
      </div>
    `),
  ];

  // Decisions Waiting section
  const decisionCards = decisions.map((d) => {
    const role = AGENT_ROLES[d.agent_name] ?? d.agent_name;
    return html`
    <div class="card" style="padding:1.25rem;margin-bottom:0.75rem;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:0.75rem;flex-wrap:wrap;">
        <div>
          <div style="font-size:0.95rem;font-weight:700;color:var(--text-primary);margin-bottom:0.3rem;">${d.title}</div>
          <div style="font-size:0.72rem;color:var(--text-muted);">Proposed by ${d.agent_name} · ${role}</div>
        </div>
        ${d.estimated_impact_usd ? html`<span style="font-size:0.8rem;font-weight:700;color:#4ecca3;white-space:nowrap;">+$${d.estimated_impact_usd.toLocaleString()}</span>` : ''}
      </div>
      <p style="margin:0 0 0.6rem;font-size:0.83rem;color:var(--text-dim);line-height:1.55;">${d.description}</p>
      <p style="margin:0 0 1rem;font-size:0.78rem;color:var(--accent);line-height:1.4;"><strong>Expected impact:</strong> ${d.expected_impact}</p>
      <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
        <form method="POST" action="/agents/decisions/${d.id}/approve" style="display:inline;">
          <button type="submit" class="btn btn-primary" style="font-size:0.8rem;padding:0.4rem 1rem;">Approve</button>
        </form>
        <form method="POST" action="/agents/decisions/${d.id}/deny" style="display:inline;">
          <input type="hidden" name="reason" value="Declined by founder" />
          <button type="submit" class="btn btn-ghost" style="font-size:0.8rem;padding:0.4rem 1rem;color:#ff6b6b;border-color:#ff6b6b44;">Deny</button>
        </form>
      </div>
    </div>`;
  });

  // What's Working / Needs Attention
  const positiveContribs = contributions.filter(
    (c) => c.contribution && (
      c.contribution.toLowerCase().includes('improv') ||
      c.contribution.toLowerCase().includes('increas') ||
      c.contribution.toLowerCase().includes('strong') ||
      c.contribution.toLowerCase().includes('success')
    )
  );
  const attentionContribs = contributions.filter(
    (c) => c.priority === 'high' && c.contribution && (
      c.contribution.toLowerCase().includes('risk') ||
      c.contribution.toLowerCase().includes('issue') ||
      c.contribution.toLowerCase().includes('drop') ||
      c.contribution.toLowerCase().includes('fail')
    )
  );

  // Financial snapshot
  const mrrDisplay = fin?.mrr_cents !== null && fin?.mrr_cents !== undefined
    ? `$${(fin.mrr_cents / 100).toLocaleString()}`
    : 'N/A';
  const roiDisplay = fin?.roi !== null && fin?.roi !== undefined
    ? `${fin.roi.toFixed(1)}x`
    : 'N/A';

  const content = html`
    ${navBar}

    <!-- Header -->
    <div class="card" style="padding:1.5rem;margin-bottom:1.5rem;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
        <div style="flex:1;">
          <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.35rem;">CEO BRIEFING</div>
          <h1 style="margin:0 0 0.25rem;font-size:1.5rem;">${fmtDate(briefing.briefing_date)}</h1>
          <p style="margin:0;font-size:1rem;color:var(--text-dim);line-height:1.5;font-style:italic;">${briefing.headline}</p>
        </div>
      </div>
      ${metricsBar}
    </div>

    <!-- Overnight Activity -->
    <div style="margin-bottom:1.5rem;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.75rem;">Overnight Activity</div>
      ${activityItems.length === 0
        ? html`<div class="card" style="padding:1.25rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">No agent activity recorded for this period.</div>`
        : activityItems}
    </div>

    <!-- Decisions Waiting -->
    <div style="margin-bottom:1.5rem;">
      <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem;">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Decisions Waiting</div>
        ${decisions.length > 0 ? html`<span style="font-size:0.7rem;font-weight:700;background:#ffb34722;color:#ffb347;padding:2px 8px;border-radius:99px;">${decisions.length}</span>` : ''}
      </div>
      ${decisionCards.length === 0
        ? html`<div class="card" style="padding:1.25rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">No pending decisions.</div>`
        : decisionCards}
    </div>

    <!-- What's Working / Needs Attention -->
    ${positiveContribs.length > 0 ? html`
    <div style="margin-bottom:1.5rem;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#4ecca3;margin-bottom:0.75rem;">What's Working</div>
      <div class="card" style="padding:1.25rem;">
        ${positiveContribs.map((c) => html`
          <div style="padding:0.5rem 0;border-bottom:1px solid rgba(255,255,255,0.05);">
            <span style="font-weight:600;color:var(--text-primary);font-size:0.83rem;">${c.display_name}:</span>
            <span style="font-size:0.83rem;color:var(--text-dim);margin-left:0.35rem;">${c.contribution}</span>
          </div>
        `)}
      </div>
    </div>` : ''}

    ${attentionContribs.length > 0 ? html`
    <div style="margin-bottom:1.5rem;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#ff6b6b;margin-bottom:0.75rem;">Needs Attention</div>
      <div class="card" style="padding:1.25rem;border-left:3px solid #ff6b6b44;">
        ${attentionContribs.map((c) => html`
          <div style="padding:0.5rem 0;border-bottom:1px solid rgba(255,255,255,0.05);">
            <span style="font-weight:600;color:var(--text-primary);font-size:0.83rem;">${c.display_name}:</span>
            <span style="font-size:0.83rem;color:var(--text-dim);margin-left:0.35rem;">${c.contribution}</span>
          </div>
        `)}
      </div>
    </div>` : ''}

    <!-- Financial Snapshot -->
    <div class="card" style="padding:1.25rem;margin-bottom:1.5rem;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.875rem;">Financial Snapshot</div>
      <div style="display:flex;gap:2rem;flex-wrap:wrap;">
        <div>
          <div style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.25rem;">MRR</div>
          <div style="font-size:1.4rem;font-weight:700;color:var(--text-primary);">${mrrDisplay}</div>
          ${fin?.mrr_growth_pct !== null && fin?.mrr_growth_pct !== undefined
            ? html`<div style="font-size:0.75rem;color:${fin.mrr_growth_pct >= 0 ? '#4ecca3' : '#ff6b6b'};">${fin.mrr_growth_pct >= 0 ? '+' : ''}${fin.mrr_growth_pct.toFixed(1)}% MoM</div>`
            : ''}
        </div>
        <div>
          <div style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.25rem;">AI Cost (30d)</div>
          <div style="font-size:1.4rem;font-weight:700;color:var(--text-primary);">$${fin ? fin.ai_cost_30d_usd.toFixed(2) : '0.00'}</div>
        </div>
        <div>
          <div style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.25rem;">ROI</div>
          <div style="font-size:1.4rem;font-weight:700;color:${fin?.roi !== null && fin?.roi !== undefined && fin.roi >= 1 ? '#4ecca3' : 'var(--text-primary)'};">${roiDisplay}</div>
          <div style="font-size:0.7rem;color:var(--text-muted);">attributed / AI cost</div>
        </div>
      </div>
    </div>

    <!-- Bottom nav -->
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.75rem;">
      <a href="/agents" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Back to Agent Roster</a>
      <div style="display:flex;align-items:center;gap:0.75rem;">
        ${prevDate ? html`<a href="/agents/briefings/${prevDate}" class="btn btn-ghost btn-sm">← ${fmtShortDate(prevDate)}</a>` : ''}
        ${nextDate ? html`<a href="/agents/briefings/${nextDate}" class="btn btn-ghost btn-sm">${fmtShortDate(nextDate)} →</a>` : ''}
      </div>
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});
