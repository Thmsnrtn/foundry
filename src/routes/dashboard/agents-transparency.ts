// =============================================================================
// FOUNDRY — Agent Transparency Routes
//
// Shows what Foundry recorded about each agent run: status, cost, tokens,
// latency, the agent's own summary, and its observations. It said "exactly what
// each agent sees, thinks, and costs per run" while reading `agent_run_details`
// — a table nothing in the codebase has ever written, so every table on every
// one of these pages was empty for every company. See `run-history.ts`: the
// runs are in `agent_sessions`, which is where these reads now go.
//
// Prompt previews, a context summary, an input/output token split and a per-run
// health score are not stored anywhere, so this page no longer claims them.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import {
  getAgentCostSummary,
  getRecentRuns,
  getAgentRunHistory,
  getRunDetails,
  getAgentCurrentHealth,
} from '../../services/scp/transparency/run-history.js';
import { AGENT_DISPLAY_NAMES, AGENT_ROLES } from '../../services/scp/types.js';
import type { AgentName } from '../../services/scp/types.js';

export const agentsTransparency = new Hono<AuthEnv>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${(usd * 1000).toFixed(3)}m`;
  return `$${usd.toFixed(4)}`;
}

function fmtLatency(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtRelTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function statusBadge(status: string): string {
  if (status === 'completed') return '<span style="color:#4ecca3;font-weight:700;">✓</span>';
  if (status === 'failed') return '<span style="color:#ff6b6b;font-weight:700;">✗</span>';
  return '<span style="color:#ffb347;font-weight:700;">⟳</span>';
}

function healthColor(score: number | null): string {
  if (score === null) return 'var(--text-muted)';
  return score >= 70 ? '#4ecca3' : score >= 40 ? '#ffb347' : '#ff6b6b';
}

function trendColor(trend: string): string {
  if (trend === 'improving') return '#4ecca3';
  if (trend === 'declining') return '#ff6b6b';
  return '#ffb347';
}

// ─── GET /agents/transparency — Main Dashboard ───────────────────────────────

agentsTransparency.get('/agents/transparency', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'agents', 'Agent Transparency', undefined, c);

  if (!ctx.productId) {
    const content = html`
      <div style="margin-bottom:1.5rem;">
        <a href="/agents" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Agent Roster</a>
      </div>
      <h1 style="margin:0 0 0.5rem;">Agent Transparency</h1>
      <p style="color:var(--text-dim);">No product selected.</p>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;
  const [costSummary, recentRuns] = await Promise.all([
    getAgentCostSummary(productId, 30).catch(() => []),
    getRecentRuns(productId, 20).catch(() => []),
  ]);

  // Section 1: Cost Overview
  const totalCost = costSummary.reduce((sum, a) => sum + a.total_cost_usd, 0);
  const totalRuns = costSummary.reduce((sum, a) => sum + a.total_runs, 0);
  const totalTokens = costSummary.reduce((sum, a) => sum + a.total_tokens, 0);
  // A failed run records no cost, so the average is per COMPLETED run and says
  // so. Dividing by every run mixed a real numerator with a denominator that
  // includes runs which recorded nothing.
  const completedRuns = costSummary.reduce((sum, a) => sum + a.completed_runs, 0);

  const costRows = costSummary.map((agent) => {
    const name = agent.agent_name as AgentName;
    const displayName = AGENT_DISPLAY_NAMES[name] ?? agent.agent_name;
    const role = AGENT_ROLES[name] ?? '';
    const costPct = totalCost > 0 ? ((agent.total_cost_usd / totalCost) * 100).toFixed(0) : '0';
    return html`
    <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
      <td style="padding:0.75rem 1rem;">
        <a href="/agents/transparency/${agent.agent_name}" style="font-weight:600;color:var(--text-primary);text-decoration:none;font-size:0.85rem;">${displayName}</a>
        <span style="font-size:0.72rem;color:var(--text-muted);margin-left:0.35rem;">${role}</span>
      </td>
      <td style="padding:0.75rem 1rem;font-size:0.85rem;color:var(--text-dim);">${agent.total_runs}<span style="font-size:0.7rem;color:var(--text-muted);margin-left:0.3rem;">${agent.completed_runs} done</span></td>
      <td style="padding:0.75rem 1rem;">
        <span style="font-size:0.85rem;font-weight:600;color:var(--text-primary);">${fmtCost(agent.total_cost_usd)}</span>
        <span style="font-size:0.7rem;color:var(--text-muted);margin-left:0.35rem;">${costPct}%</span>
      </td>
      <td style="padding:0.75rem 1rem;font-size:0.82rem;color:var(--text-dim);">${agent.avg_cost_per_completed_run === null
        ? html`<span style="color:var(--text-muted);">not measured</span>`
        : fmtCost(agent.avg_cost_per_completed_run)}</td>
      <td style="padding:0.75rem 1rem;font-size:0.82rem;color:var(--text-dim);">${fmtLatency(agent.avg_latency_ms)}</td>
      <td style="padding:0.75rem 1rem;font-size:0.82rem;color:var(--text-dim);">${fmtTokens(agent.total_tokens)}</td>
    </tr>`;
  });

  // Section 2: Recent Runs
  const runRows = recentRuns.map((run) => {
    const name = run.agent_name as AgentName;
    const displayName = AGENT_DISPLAY_NAMES[name] ?? run.agent_name;
    return html`
    <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
      <td style="padding:0.65rem 1rem;">
        <a href="/agents/transparency/${run.agent_name}" style="font-weight:600;color:var(--text-primary);text-decoration:none;font-size:0.83rem;">${displayName}</a>
      </td>
      <td style="padding:0.65rem 1rem;text-align:center;">${html`${statusBadge(run.status)}`}</td>
      <td style="padding:0.65rem 1rem;font-size:0.82rem;color:var(--text-dim);">${fmtCost(run.cost_usd)}</td>
      <td style="padding:0.65rem 1rem;font-size:0.82rem;color:var(--text-dim);">${fmtLatency(run.latency_ms)}</td>
      <td style="padding:0.65rem 1rem;font-size:0.78rem;color:var(--text-dim);max-width:260px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">
        ${run.headline
          ? html`<a href="/agents/transparency/${run.agent_name}/run/${run.id}" style="color:var(--text-dim);text-decoration:none;">${run.headline}</a>`
          : html`<a href="/agents/transparency/${run.agent_name}/run/${run.id}" style="color:var(--text-muted);text-decoration:none;">View details →</a>`}
      </td>
      <td style="padding:0.65rem 1rem;font-size:0.75rem;color:var(--text-muted);white-space:nowrap;">${fmtRelTime(run.run_started_at)}</td>
    </tr>`;
  });

  const content = html`
    <div style="margin-bottom:1.5rem;">
      <a href="/agents" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Agent Roster</a>
    </div>

    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:0.5rem;">
      <h1 style="margin:0;">Agent Transparency</h1>
      <span style="font-size:0.8rem;color:var(--text-muted);">Last 30 days</span>
    </div>

    <!-- Summary Stats -->
    <div style="display:flex;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap;">
      <div class="card" style="padding:1rem 1.5rem;flex:1;min-width:140px;">
        <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:0.4rem;">Total Cost</div>
        <div style="font-size:1.5rem;font-weight:700;color:var(--text-primary);">${fmtCost(totalCost)}</div>
        <div style="font-size:0.72rem;color:var(--text-muted);">30 days</div>
      </div>
      <div class="card" style="padding:1rem 1.5rem;flex:1;min-width:140px;">
        <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:0.4rem;">Total Runs</div>
        <div style="font-size:1.5rem;font-weight:700;color:var(--text-primary);">${totalRuns}</div>
        <div style="font-size:0.72rem;color:var(--text-muted);">across all agents</div>
      </div>
      <div class="card" style="padding:1rem 1.5rem;flex:1;min-width:140px;">
        <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:0.4rem;">Total Tokens</div>
        <div style="font-size:1.5rem;font-weight:700;color:var(--text-primary);">${fmtTokens(totalTokens)}</div>
        <div style="font-size:0.72rem;color:var(--text-muted);">input + output</div>
      </div>
      <div class="card" style="padding:1rem 1.5rem;flex:1;min-width:140px;">
        <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:0.4rem;">Avg Per Run</div>
        <div style="font-size:1.5rem;font-weight:700;color:var(--text-primary);">${completedRuns > 0 ? fmtCost(totalCost / completedRuns) : 'not measured'}</div>
        <div style="font-size:0.72rem;color:var(--text-muted);">per completed run (${completedRuns} of ${totalRuns})</div>
      </div>
    </div>

    <!-- Section 1: Cost Overview -->
    <div style="margin-bottom:1.5rem;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.75rem;">Cost Overview — Last 30 Days</div>
      <div class="card" style="padding:0;overflow:hidden;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid rgba(255,255,255,0.08);">
              <th style="padding:0.75rem 1rem;text-align:left;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Agent</th>
              <th style="padding:0.75rem 1rem;text-align:left;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Runs</th>
              <th style="padding:0.75rem 1rem;text-align:left;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Total Cost</th>
              <th style="padding:0.75rem 1rem;text-align:left;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Avg/Completed Run</th>
              <th style="padding:0.75rem 1rem;text-align:left;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Avg Latency</th>
              <th style="padding:0.75rem 1rem;text-align:left;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Tokens</th>
            </tr>
          </thead>
          <tbody>
            ${costSummary.length === 0
              ? html`<tr><td colspan="6" style="padding:2rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">No run data yet. Agents will appear here once they complete their first run.</td></tr>`
              : costRows}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Section 2: Recent Runs -->
    <div style="margin-bottom:1.5rem;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.75rem;">Recent Runs — All Agents</div>
      <div class="card" style="padding:0;overflow:hidden;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid rgba(255,255,255,0.08);">
              <th style="padding:0.65rem 1rem;text-align:left;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Agent</th>
              <th style="padding:0.65rem 1rem;text-align:center;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Status</th>
              <th style="padding:0.65rem 1rem;text-align:left;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Cost</th>
              <th style="padding:0.65rem 1rem;text-align:left;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Latency</th>
              <th style="padding:0.65rem 1rem;text-align:left;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Headline</th>
              <th style="padding:0.65rem 1rem;text-align:left;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">When</th>
            </tr>
          </thead>
          <tbody>
            ${recentRuns.length === 0
              ? html`<tr><td colspan="6" style="padding:2rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">No runs recorded yet.</td></tr>`
              : runRows}
          </tbody>
        </table>
      </div>
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── GET /agents/transparency/:agentName — Per-Agent Page ────────────────────

agentsTransparency.get('/agents/transparency/:agentName', async (c) => {
  const founder = c.get('founder');
  const agentName = c.req.param('agentName');
  const displayName = AGENT_DISPLAY_NAMES[agentName as AgentName] ?? agentName;
  const role = AGENT_ROLES[agentName as AgentName] ?? '';

  const ctx = await getLayoutContext(founder, 'agents', `${displayName} — Transparency`, undefined, c);

  if (!ctx.productId) {
    const content = html`<p style="color:var(--text-dim);">No product selected.</p>`;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;
  const [runs, currentHealth] = await Promise.all([
    getAgentRunHistory(productId, agentName, 20).catch(() => []),
    getAgentCurrentHealth(productId, agentName).catch(() => null),
  ]);

  const totalCostAll = runs.reduce((sum, r) => sum + r.cost_usd, 0);
  const successCount = runs.filter((r) => r.status === 'completed').length;

  const runRows = runs.map((run) => {
    return html`
    <tr style="border-bottom:1px solid rgba(255,255,255,0.05);" id="run-${run.id}">
      <td style="padding:0.7rem 1rem;text-align:center;">${html`${statusBadge(run.status)}`}</td>
      <td style="padding:0.7rem 1rem;font-size:0.82rem;color:var(--text-dim);">${fmtCost(run.cost_usd)}</td>
      <td style="padding:0.7rem 1rem;font-size:0.82rem;color:var(--text-dim);">${fmtLatency(run.latency_ms)}</td>
      <td style="padding:0.7rem 1rem;font-size:0.75rem;color:var(--text-dim);">${run.decisions_count} decisions · ${run.actions_count} actions</td>
      <td style="padding:0.7rem 1rem;font-size:0.78rem;color:var(--text-dim);max-width:220px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">
        ${run.headline || html`<span style="color:var(--text-muted);">—</span>`}
      </td>
      <td style="padding:0.7rem 1rem;font-size:0.75rem;color:var(--text-muted);white-space:nowrap;">${fmtRelTime(run.run_started_at)}</td>
      <td style="padding:0.7rem 1rem;">
        <a href="/agents/transparency/${agentName}/run/${run.id}" style="font-size:0.75rem;color:var(--accent);text-decoration:none;">Details →</a>
      </td>
    </tr>`;
  });

  const content = html`
    <div style="margin-bottom:1.5rem;display:flex;align-items:center;gap:1rem;">
      <a href="/agents/transparency" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Transparency</a>
    </div>

    <div style="display:flex;align-items:baseline;gap:0.75rem;margin-bottom:1.5rem;flex-wrap:wrap;">
      <h1 style="margin:0;">${displayName}</h1>
      <span style="font-size:0.85rem;color:var(--text-muted);">${role}</span>
    </div>

    <!-- Stats row -->
    <div style="display:flex;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap;">
      <div class="card" style="padding:1rem 1.5rem;flex:1;min-width:120px;">
        <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:0.4rem;">Total Runs</div>
        <div style="font-size:1.4rem;font-weight:700;">${runs.length}</div>
      </div>
      <div class="card" style="padding:1rem 1.5rem;flex:1;min-width:120px;">
        <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:0.4rem;">Success Rate</div>
        <div style="font-size:1.4rem;font-weight:700;color:#4ecca3;">${runs.length > 0 ? `${Math.round((successCount / runs.length) * 100)}%` : '—'}</div>
      </div>
      <div class="card" style="padding:1rem 1.5rem;flex:1;min-width:120px;">
        <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:0.4rem;">Total Cost</div>
        <div style="font-size:1.4rem;font-weight:700;">${fmtCost(totalCostAll)}</div>
      </div>
      <div class="card" style="padding:1rem 1.5rem;flex:1;min-width:120px;">
        <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:0.4rem;">Domain Health Now</div>
        <div style="font-size:1.4rem;font-weight:700;color:${healthColor(currentHealth)};">${currentHealth !== null ? currentHealth : 'not scored'}</div>
        <div style="font-size:0.65rem;color:var(--text-muted);margin-top:0.2rem;">this agent's current score, not an average over runs</div>
      </div>
    </div>

    <!-- Run history table -->
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.75rem;">Run History (last 20)</div>
    <div class="card" style="padding:0;overflow:hidden;">
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.08);">
            <th style="padding:0.65rem 1rem;text-align:center;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Status</th>
            <th style="padding:0.65rem 1rem;text-align:left;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Cost</th>
            <th style="padding:0.65rem 1rem;text-align:left;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Latency</th>
            <th style="padding:0.65rem 1rem;text-align:left;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Output</th>
            <th style="padding:0.65rem 1rem;text-align:left;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Headline</th>
            <th style="padding:0.65rem 1rem;text-align:left;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">When</th>
            <th style="padding:0.65rem 1rem;"></th>
          </tr>
        </thead>
        <tbody>
          ${runs.length === 0
            ? html`<tr><td colspan="7" style="padding:2rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">No runs recorded for this agent yet.</td></tr>`
            : runRows}
        </tbody>
      </table>
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── GET /agents/transparency/:agentName/run/:runId — Full Run Detail ─────────

agentsTransparency.get('/agents/transparency/:agentName/run/:runId', async (c) => {
  const founder = c.get('founder');
  const agentName = c.req.param('agentName');
  const runId = c.req.param('runId');
  const displayName = AGENT_DISPLAY_NAMES[agentName as AgentName] ?? agentName;

  const ctx = await getLayoutContext(founder, 'agents', `${displayName} Run Detail`, undefined, c);

  // SCOPED TO THIS COMPANY. The read took a run id alone, so a founder holding
  // an id could open another company's run detail — prompt previews included.
  // Unexploitable only because the table it read had never been written to.
  const run = ctx.productId
    ? await getRunDetails(ctx.productId, runId).catch(() => null)
    : null;

  if (!run) {
    const content = html`
      <div style="margin-bottom:1.5rem;">
        <a href="/agents/transparency/${agentName}" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← ${displayName}</a>
      </div>
      <div class="card" style="padding:2rem;text-align:center;">
        <p style="color:var(--text-muted);">Run record not found.</p>
      </div>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const runDuration = run.run_completed_at
    ? ((new Date(run.run_completed_at).getTime() - new Date(run.run_started_at).getTime()) / 1000).toFixed(1)
    : null;

  const content = html`
    <div style="margin-bottom:1.5rem;display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">
      <a href="/agents/transparency/${agentName}" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← ${displayName}</a>
      <span style="color:var(--text-muted);">›</span>
      <span style="font-size:0.85rem;color:var(--text-muted);font-family:monospace;">${runId.slice(0, 8)}…</span>
    </div>

    <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap;">
      <h1 style="margin:0;font-size:1.4rem;">${displayName} Run Detail</h1>
      <span>${html`${statusBadge(run.status)}`} <span style="font-size:0.85rem;color:var(--text-muted);">${run.status}</span></span>
      <span style="font-size:0.8rem;color:var(--text-muted);">${fmtRelTime(run.run_started_at)}</span>
    </div>

    ${run.headline ? html`
    <div class="card" style="padding:1.25rem;margin-bottom:1.5rem;border-left:3px solid var(--accent);">
      <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:0.4rem;">Agent Summary</div>
      <p style="margin:0;font-size:1rem;color:var(--text-primary);font-style:italic;">${run.headline}</p>
    </div>` : ''}

    ${run.error_message ? html`
    <div class="card" style="padding:1.25rem;margin-bottom:1.5rem;border-left:3px solid #ff6b6b;background:rgba(255,107,107,0.05);">
      <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.1em;color:#ff6b6b;margin-bottom:0.4rem;">Error</div>
      <p style="margin:0;font-size:0.85rem;color:#ff6b6b;font-family:monospace;">${run.error_message}</p>
    </div>` : ''}

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem;margin-bottom:1.5rem;">

      <!-- What the agent reported -->
      <div class="card" style="padding:1.25rem;">
        <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:0.875rem;">What the Agent Reported</div>
        ${run.observations.length > 0
          ? run.observations.map((item) => html`
            <div style="display:flex;align-items:flex-start;gap:0.5rem;padding:0.35rem 0;border-bottom:1px solid rgba(255,255,255,0.04);">
              <span style="color:#4ecca3;font-size:0.75rem;line-height:1.6;">●</span>
              <span style="font-size:0.82rem;color:var(--text-dim);">${item}</span>
            </div>`)
          : html`<p style="font-size:0.82rem;color:var(--text-muted);margin:0;">This run recorded no observations.</p>`}
        <p style="font-size:0.7rem;color:var(--text-muted);margin:0.75rem 0 0;">
          The inputs the agent read are not recorded. This card used to list a
          context summary from a table nothing wrote, so it was always empty.
        </p>
      </div>

      <!-- Output Summary -->
      <div class="card" style="padding:1.25rem;">
        <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:0.875rem;">What the Agent Decided</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
          <div style="padding:0.625rem;background:rgba(255,255,255,0.03);border-radius:8px;">
            <div style="font-size:1.4rem;font-weight:700;color:var(--text-primary);">${run.decisions_count}</div>
            <div style="font-size:0.7rem;color:var(--text-muted);">Decisions</div>
          </div>
          <div style="padding:0.625rem;background:rgba(255,255,255,0.03);border-radius:8px;">
            <div style="font-size:1.4rem;font-weight:700;color:var(--text-primary);">${run.actions_count}</div>
            <div style="font-size:0.7rem;color:var(--text-muted);">Actions</div>
          </div>
        </div>
        <p style="font-size:0.7rem;color:var(--text-muted);margin:0.75rem 0 0;">
          Counted from what this run stored. Hypotheses, messages sent, customer
          signals and a per-run health score were four more tiles here, read
          from a table with no writer.
        </p>
      </div>

      <!-- Cost Breakdown -->
      <div class="card" style="padding:1.25rem;">
        <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:0.875rem;">Cost</div>
        <div style="margin-bottom:0.75rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0;border-bottom:1px solid rgba(255,255,255,0.05);">
            <span style="font-size:0.82rem;color:var(--text-dim);">Tokens</span>
            <span style="font-size:0.82rem;color:var(--text-primary);">${fmtTokens(run.tokens_used)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0;">
            <span style="font-size:0.85rem;font-weight:700;color:var(--text-primary);">Recorded cost</span>
            <span style="font-size:0.95rem;font-weight:700;color:var(--accent);">${fmtCost(run.cost_usd)}</span>
          </div>
        </div>
        <div style="font-size:0.72rem;color:var(--text-muted);">
          The run stores one token total and the cost the agent computed. The
          input/output split this card used to price at Sonnet rates is not
          recorded${run.status === 'failed' ? ', and a failed run records no cost at all' : ''}.
        </div>
        ${run.latency_ms !== null ? html`
        <div style="margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid rgba(255,255,255,0.05);">
          <div style="display:flex;justify-content:space-between;">
            <span style="font-size:0.82rem;color:var(--text-dim);">Duration</span>
            <span style="font-size:0.82rem;color:var(--text-primary);">${fmtLatency(run.latency_ms)}</span>
          </div>
          ${runDuration ? html`
          <div style="display:flex;justify-content:space-between;margin-top:0.25rem;">
            <span style="font-size:0.82rem;color:var(--text-dim);">Start to finish</span>
            <span style="font-size:0.82rem;color:var(--text-primary);">${runDuration}s</span>
          </div>` : ''}
        </div>` : ''}
      </div>
    </div>

    <!-- Timing -->
    <div class="card" style="padding:1.25rem;margin-bottom:1.5rem;">
      <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:0.5rem;">Timing</div>
      <div style="display:flex;gap:2rem;flex-wrap:wrap;font-size:0.82rem;color:var(--text-dim);">
        <span>Started: <strong style="color:var(--text-primary);">${run.run_started_at}</strong></span>
        ${run.run_completed_at ? html`<span>Completed: <strong style="color:var(--text-primary);">${run.run_completed_at}</strong></span>` : ''}
      </div>
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});
