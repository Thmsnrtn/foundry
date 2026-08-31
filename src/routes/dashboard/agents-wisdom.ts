// =============================================================================
// FOUNDRY — Agent Wisdom Layer Routes
// Dashboard page showing synthesized behavioral wisdom from approval history.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import { requireCompanyCapability } from '../../middleware/rbac.js';
import {
  getWisdomSummary,
  getDecisionOutcomes,
  synthesizeWisdomPatterns,
  type WisdomPattern,
  type DecisionOutcome,
} from '../../services/scp/wisdom.js';

export const agentWisdomRoutes = new Hono<AuthEnv>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function patternTypeBadge(type: string) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    what_works:      { bg: '#4ecca322', color: '#4ecca3', label: 'What Works' },
    what_fails:      { bg: '#ff6b6b22', color: '#ff6b6b', label: 'What Fails' },
    agent_tendency:  { bg: '#6c63ff22', color: '#6c63ff', label: 'Agent Tendency' },
    approval_signal: { bg: '#38bdf822', color: '#38bdf8', label: 'Approval Signal' },
  };
  const style = map[type] ?? { bg: 'rgba(255,255,255,0.07)', color: 'var(--text-dim)', label: type };
  return html`<span style="font-size:0.65rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:2px 8px;border-radius:99px;background:${style.bg};color:${style.color};">${style.label}</span>`;
}

function agentBadge(agentName: string | null) {
  if (!agentName) return '';
  return html`<span style="font-size:0.65rem;font-weight:600;padding:2px 8px;border-radius:99px;background:rgba(108,99,255,0.15);color:#6c63ff;text-transform:capitalize;">${agentName}</span>`;
}

function outcomeBadge(outcome: string) {
  const isApproved = outcome === 'approved';
  const bg = isApproved ? '#4ecca322' : '#ff6b6b22';
  const color = isApproved ? '#4ecca3' : '#ff6b6b';
  const label = isApproved ? 'Approved' : 'Denied';
  return html`<span style="font-size:0.7rem;font-weight:700;padding:2px 9px;border-radius:99px;background:${bg};color:${color};">${label}</span>`;
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

// ─── GET /agents/wisdom — Wisdom Layer Dashboard ──────────────────────────────

agentWisdomRoutes.get('/agents/wisdom', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'agents', 'Wisdom Layer', undefined, c);

  const synthesized = c.req.query('synthesized');
  const synthesisError = c.req.query('synthesis_error');

  if (!ctx.productId) {
    const content = html`
      <h1 style="margin:0 0 0.5rem;">Wisdom Layer</h1>
      <p style="color:var(--text-dim);margin:0;">No product selected.</p>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;

  const [summary, recentDecisions] = await Promise.all([
    getWisdomSummary(productId),
    getDecisionOutcomes(productId, { limit: 20 }),
  ]);

  const toastHtml = synthesized === '1'
    ? html`<div style="background:#4ecca322;border:1px solid #4ecca344;border-radius:8px;padding:0.75rem 1rem;margin-bottom:1.5rem;color:#4ecca3;font-size:0.85rem;">Synthesis complete — ${c.req.query('found') ?? '0'} patterns identified.</div>`
    : synthesisError
      ? html`<div style="background:#ff6b6b22;border:1px solid #ff6b6b44;border-radius:8px;padding:0.75rem 1rem;margin-bottom:1.5rem;color:#ff6b6b;font-size:0.85rem;">Synthesis failed: ${synthesisError}</div>`
      : '';

  // Stats bar
  const statsBar = html`
    <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:2rem;">
      <div class="card" style="padding:1rem 1.5rem;flex:1;min-width:140px;text-align:center;">
        <div style="font-size:2rem;font-weight:800;color:var(--text-primary);line-height:1;">${summary.totalDecisions}</div>
        <div style="font-size:0.7rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);margin-top:0.25rem;">Decisions Tracked</div>
      </div>
      <div class="card" style="padding:1rem 1.5rem;flex:1;min-width:140px;text-align:center;">
        <div style="font-size:2rem;font-weight:800;color:#4ecca3;line-height:1;">${summary.approvalRate}%</div>
        <div style="font-size:0.7rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);margin-top:0.25rem;">Approval Rate</div>
      </div>
      <div class="card" style="padding:1rem 1.5rem;flex:1;min-width:140px;text-align:center;">
        <div style="font-size:2rem;font-weight:800;color:#6c63ff;line-height:1;">${summary.activePatterns}</div>
        <div style="font-size:0.7rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);margin-top:0.25rem;">Active Patterns</div>
      </div>
      <div class="card" style="padding:1rem 1.5rem;flex:1;min-width:140px;text-align:center;">
        <div style="font-size:2rem;font-weight:800;color:#38bdf8;line-height:1;">${summary.approvedCount}</div>
        <div style="font-size:0.7rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);margin-top:0.25rem;">Approved</div>
      </div>
      <div class="card" style="padding:1rem 1.5rem;flex:1;min-width:140px;text-align:center;">
        <div style="font-size:2rem;font-weight:800;color:#ff6b6b;line-height:1;">${summary.deniedCount}</div>
        <div style="font-size:0.7rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);margin-top:0.25rem;">Denied</div>
      </div>
    </div>
  `;

  // Active patterns section
  const patternCards = summary.topPatterns.length > 0
    ? summary.topPatterns.map((p: WisdomPattern) => {
        const confidencePct = Math.round(p.confidence * 100);
        const confColor = p.confidence >= 0.8 ? '#4ecca3' : p.confidence >= 0.6 ? '#ffb347' : '#ff6b6b';
        return html`
          <div class="card" style="padding:1.25rem;display:flex;flex-direction:column;gap:0.75rem;">
            <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
              ${patternTypeBadge(p.pattern_type)}
              ${agentBadge(p.agent_name)}
            </div>
            <p style="margin:0;font-size:0.88rem;color:var(--text-primary);line-height:1.55;">${p.pattern}</p>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;">
              <div style="display:flex;align-items:center;gap:0.5rem;flex:1;">
                <span style="font-size:0.7rem;color:var(--text-muted);white-space:nowrap;">Confidence</span>
                <div style="flex:1;height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;max-width:120px;">
                  <div style="height:100%;width:${confidencePct}%;background:${confColor};border-radius:2px;"></div>
                </div>
                <span style="font-size:0.7rem;font-weight:700;color:${confColor};">${confidencePct}%</span>
              </div>
              <span style="font-size:0.7rem;color:var(--text-muted);">${p.evidence_count} evidence${p.evidence_count === 1 ? '' : 's'}</span>
            </div>
          </div>`;
      })
    : [html`<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">No patterns synthesized yet. Run synthesis to discover patterns from your approval history.</div>`];

  const patternsSection = html`
    <div style="margin-bottom:2rem;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:0.75rem;">
        <div>
          <h2 style="margin:0 0 0.25rem;font-size:1.1rem;">Active Patterns</h2>
          <p style="margin:0;font-size:0.8rem;color:var(--text-dim);">Synthesized behavioral patterns from your decision history</p>
        </div>
        <form method="POST" action="/agents/wisdom/synthesize">
          <button type="submit" class="btn btn-primary" style="font-size:0.82rem;">Run Synthesis</button>
        </form>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1rem;">
        ${patternCards}
      </div>
    </div>
  `;

  // Recent decisions table
  const decisionRows = recentDecisions.length > 0
    ? recentDecisions.map((d: DecisionOutcome) => {
        const rationale = d.founder_rationale
          ? html`<span style="color:var(--text-muted);font-size:0.72rem;">${d.founder_rationale}</span>`
          : html`<span style="color:var(--text-muted);font-size:0.72rem;font-style:italic;">No rationale recorded</span>`;

        return html`
          <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
            <td style="padding:0.75rem 1rem;font-size:0.75rem;color:var(--text-muted);white-space:nowrap;">${formatDate(d.created_at)}</td>
            <td style="padding:0.75rem 0.5rem;">
              <span style="font-size:0.7rem;font-weight:600;padding:2px 8px;border-radius:99px;background:rgba(108,99,255,0.15);color:#6c63ff;text-transform:capitalize;">${d.agent_name}</span>
            </td>
            <td style="padding:0.75rem 0.5rem;font-size:0.82rem;color:var(--text-primary);">${d.decision_title}</td>
            <td style="padding:0.75rem 0.5rem;">${outcomeBadge(d.outcome)}</td>
            <td style="padding:0.75rem 1rem;">${rationale}</td>
          </tr>`;
      })
    : [html`
        <tr>
          <td colspan="5" style="padding:2rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">
            No decisions tracked yet. Decisions are recorded when you approve or deny agent proposals.
          </td>
        </tr>`];

  const decisionsSection = html`
    <div>
      <div style="margin-bottom:1rem;">
        <h2 style="margin:0 0 0.25rem;font-size:1.1rem;">Recent Decisions</h2>
        <p style="margin:0;font-size:0.8rem;color:var(--text-dim);">Last 20 approved and denied agent proposals</p>
      </div>
      <div class="card" style="padding:0;overflow:hidden;">
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="border-bottom:1px solid rgba(255,255,255,0.08);">
                <th style="padding:0.75rem 1rem;font-size:0.65rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);text-align:left;white-space:nowrap;">Date</th>
                <th style="padding:0.75rem 0.5rem;font-size:0.65rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);text-align:left;">Agent</th>
                <th style="padding:0.75rem 0.5rem;font-size:0.65rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);text-align:left;">Decision</th>
                <th style="padding:0.75rem 0.5rem;font-size:0.65rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);text-align:left;">Outcome</th>
                <th style="padding:0.75rem 1rem;font-size:0.65rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);text-align:left;">Rationale</th>
              </tr>
            </thead>
            <tbody>
              ${decisionRows}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  const content = html`
    ${toastHtml}

    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:0.25rem;flex-wrap:wrap;gap:0.5rem;">
      <h1 style="margin:0;">Wisdom Layer</h1>
      <a href="/agents" style="font-size:0.82rem;color:var(--text-dim);text-decoration:none;">← Agent Roster</a>
    </div>
    <p style="color:var(--text-dim);margin:0 0 2rem;font-size:0.88rem;">Decision patterns synthesized from your approval history</p>

    ${statsBar}
    ${patternsSection}
    ${decisionsSection}
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /agents/wisdom/synthesize — Run Synthesis ──────────────────────────

agentWisdomRoutes.post('/agents/wisdom/synthesize',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'agents', 'Wisdom Layer', undefined, c);

  if (!ctx.productId) return c.redirect('/agents/wisdom');

  try {
    const result = await synthesizeWisdomPatterns(ctx.productId);
    return c.redirect(`/agents/wisdom?synthesized=1&found=${result.patternsFound}`);
  } catch (err) {
    const msg = err instanceof Error ? encodeURIComponent(err.message) : 'unknown+error';
    return c.redirect(`/agents/wisdom?synthesis_error=${msg}`);
  }
});
