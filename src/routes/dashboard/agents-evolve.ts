// =============================================================================
// FOUNDRY — Agent Evolution Routes
// Evolution management dashboard at /agents/evolve.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import { runEvolutionSynthesis } from '../../services/scp/evolution.js';
import { query } from '../../db/client.js';
import {
  ALL_AGENTS,
  AGENT_DISPLAY_NAMES,
  AGENT_ROLES,
  type AgentName,
  type AgentInstance,
  type EvolutionVersion,
} from '../../services/scp/types.js';

export const agentEvolveRoutes = new Hono<AuthEnv>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidAgentName(name: string): name is AgentName {
  return (ALL_AGENTS as string[]).includes(name);
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function changeTypeBadge(type: string) {
  const map: Record<string, string> = {
    golden_lesson:      'background:#4ecca322;color:#4ecca3;',
    constraint_added:   'background:#6c63ff22;color:#6c63ff;',
    authority_change:   'background:#ffb34722;color:#ffb347;',
    prompt_refinement:  'background:#38bdf822;color:#38bdf8;',
    founder_correction: 'background:#ff6b6b22;color:#ff6b6b;',
    initial_provision:  'background:rgba(255,255,255,0.07);color:#9ca3af;',
  };
  const style = map[type] ?? '';
  const label = type.replace(/_/g, ' ');
  return html`<span style="font-size:0.65rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:2px 7px;border-radius:99px;${style}">${label}</span>`;
}

function lifecycleStepColor(state: string, current: string): string {
  const steps = ['setup', 'learning', 'operating', 'optimizing', 'scaling'];
  const currentIdx = steps.indexOf(current);
  const stateIdx = steps.indexOf(state);
  if (stateIdx < currentIdx) return '#4ecca3';   // completed
  if (stateIdx === currentIdx) return '#6c63ff'; // current
  return 'rgba(255,255,255,0.15)';               // future
}

// ─── GET /agents/evolve — Evolution Dashboard ─────────────────────────────────

agentEvolveRoutes.get('/agents/evolve', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'agents', 'Evolution Engine', undefined, c);

  const ranParam = c.req.query('ran');
  const errorParam = c.req.query('error');

  if (!ctx.productId) {
    const content = html`
      <div style="margin-bottom:1.5rem;">
        <a href="/agents" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Agent Roster</a>
      </div>
      <h1 style="margin:0 0 0.5rem;">Evolution Engine</h1>
      <p style="color:var(--text-dim);">No product selected.</p>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;

  const [agentsResult, productResult, recentEvosResult] = await Promise.all([
    query('SELECT * FROM agent_instances WHERE product_id = ? ORDER BY agent_name', [productId]),
    query(
      'SELECT company_lifecycle_state, total_evolution_cycles, golden_suite_size FROM products WHERE id = ?',
      [productId]
    ),
    query(
      `SELECT aev.*, ai.display_name
       FROM agent_evolution_versions aev
       LEFT JOIN agent_instances ai ON ai.product_id = aev.product_id AND ai.agent_name = aev.agent_name
       WHERE aev.product_id = ?
       ORDER BY aev.created_at DESC LIMIT 20`,
      [productId]
    ),
  ]);

  const agents = agentsResult.rows as unknown as AgentInstance[];
  const product = (productResult.rows[0] ?? {}) as Record<string, unknown>;
  const lifecycleState = (product.company_lifecycle_state as string) ?? 'setup';
  const totalEvoCycles = (product.total_evolution_cycles as number) ?? 0;
  const goldenSuiteSize = (product.golden_suite_size as number) ?? 0;
  const agentsEvolved = agents.filter((a) => (a.total_evolution_cycles as unknown as number) > 0).length;

  // Load golden suite counts per agent in one query
  const goldenCountsResult = await query(
    `SELECT agent_name, COUNT(*) as cnt FROM golden_suite WHERE product_id = ? AND active = 1 GROUP BY agent_name`,
    [productId]
  );
  const goldenCounts: Record<string, number> = {};
  for (const row of goldenCountsResult.rows) {
    const r = row as Record<string, unknown>;
    goldenCounts[r.agent_name as string] = r.cnt as number;
  }

  const toastHtml = ranParam
    ? html`<div style="background:#4ecca322;border:1px solid #4ecca344;border-radius:8px;padding:0.75rem 1rem;margin-bottom:1.5rem;color:#4ecca3;font-size:0.85rem;">Evolution synthesis complete for ${ranParam}.</div>`
    : errorParam
      ? html`<div style="background:#ff6b6b22;border:1px solid #ff6b6b44;border-radius:8px;padding:0.75rem 1rem;margin-bottom:1.5rem;color:#ff6b6b;font-size:0.85rem;">Evolution synthesis failed. The agent may not have enough sessions yet (minimum 5 required).</div>`
      : '';

  // Agent cards
  const agentCards = ALL_AGENTS.map((name) => {
    const agent = agents.find((a) => a.agent_name === name);
    const displayName = AGENT_DISPLAY_NAMES[name];
    const role = AGENT_ROLES[name];
    const version = agent ? (agent.version as unknown as number) : 1;
    const evoCycles = agent ? (agent.total_evolution_cycles as unknown as number) : 0;
    const golden = goldenCounts[name] ?? 0;
    const statusColor = !agent ? 'rgba(255,255,255,0.2)' : agent.status === 'active' ? '#4ecca3' : agent.status === 'paused' ? '#ffb347' : '#ff6b6b';

    return html`
    <div class="card" style="padding:1.25rem;display:flex;flex-direction:column;gap:0.75rem;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:0.5rem;">
        <div>
          <div style="font-size:0.9rem;font-weight:700;color:var(--text-primary);">${displayName}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.15rem;">${role}</div>
        </div>
        <div style="display:flex;align-items:center;gap:0.35rem;">
          <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${statusColor};flex-shrink:0;"></span>
          <span style="font-size:0.7rem;font-weight:700;background:rgba(108,99,255,0.15);color:#6c63ff;padding:2px 7px;border-radius:99px;">v${version}</span>
        </div>
      </div>

      <div style="display:flex;gap:1rem;">
        <div>
          <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">Cycles</div>
          <div style="font-size:1.1rem;font-weight:700;color:${evoCycles > 0 ? '#6c63ff' : 'var(--text-muted)'};">${evoCycles}</div>
        </div>
        <div>
          <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">Golden</div>
          <div style="font-size:1.1rem;font-weight:700;color:${golden > 0 ? '#4ecca3' : 'var(--text-muted)'};">${golden}</div>
        </div>
      </div>

      ${agent ? html`
      <form method="POST" action="/agents/evolve/${name}/synthesize" style="margin-top:auto;">
        <button type="submit" class="btn btn-ghost btn-sm" style="width:100%;font-size:0.75rem;">Run Synthesis</button>
      </form>` : html`<div style="font-size:0.75rem;color:var(--text-muted);text-align:center;margin-top:auto;">Not provisioned</div>`}
    </div>`;
  });

  // Recent evolution events
  const recentEvoRows = (recentEvosResult.rows as unknown as Array<EvolutionVersion & { display_name?: string }>).map((ev) => {
    const date = ev.created_at ? fmtDate(ev.created_at) : '—';
    const dName = ev.display_name ?? AGENT_DISPLAY_NAMES[ev.agent_name] ?? ev.agent_name;
    return html`
    <div style="display:flex;align-items:flex-start;gap:0.75rem;padding:0.875rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.05);">
      <div style="flex-shrink:0;text-align:right;min-width:2rem;">
        <span style="font-size:0.72rem;font-weight:700;color:var(--text-muted);">v${ev.version}</span>
      </div>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.3rem;flex-wrap:wrap;">
          <span style="font-size:0.78rem;font-weight:600;color:var(--text-primary);">${dName}</span>
          ${changeTypeBadge(ev.change_type)}
          <span style="font-size:0.7rem;color:var(--text-muted);">${date}</span>
        </div>
        <p style="margin:0;font-size:0.78rem;color:var(--text-dim);line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${ev.change_description}</p>
      </div>
    </div>`;
  });

  // Lifecycle progression visual
  const lifecycleSteps = [
    { key: 'setup', label: 'Setup', desc: 'Provisioning' },
    { key: 'learning', label: 'Learning', desc: 'Accumulating lessons' },
    { key: 'operating', label: 'Operating', desc: 'Daily runs active' },
    { key: 'optimizing', label: 'Optimizing', desc: 'Compounding knowledge' },
    { key: 'scaling', label: 'Scaling', desc: 'Largely autonomous' },
  ];

  const lifecycleVisual = html`
    <div style="display:flex;align-items:stretch;gap:0;overflow-x:auto;padding:0.25rem 0;">
      ${lifecycleSteps.map((step, i) => {
        const color = lifecycleStepColor(step.key, lifecycleState);
        const isCurrent = step.key === lifecycleState;
        return html`
        <div style="flex:1;min-width:100px;text-align:center;position:relative;">
          ${i > 0 ? html`<div style="position:absolute;left:0;top:14px;width:50%;height:2px;background:${lifecycleStepColor(lifecycleSteps[i - 1].key, lifecycleState)};transform:translateY(-50%);"></div>` : ''}
          <div style="position:relative;z-index:1;width:28px;height:28px;border-radius:50%;background:${color};margin:0 auto 0.5rem;display:flex;align-items:center;justify-content:center;border:2px solid ${isCurrent ? 'var(--accent)' : 'transparent'};">
            ${isCurrent ? html`<div style="width:8px;height:8px;border-radius:50%;background:white;"></div>` : ''}
          </div>
          <div style="font-size:0.72rem;font-weight:${isCurrent ? '700' : '500'};color:${isCurrent ? 'var(--text-primary)' : 'var(--text-muted)'};">${step.label}</div>
          <div style="font-size:0.65rem;color:var(--text-muted);margin-top:0.15rem;">${step.desc}</div>
          ${i < lifecycleSteps.length - 1 ? html`<div style="position:absolute;right:0;top:14px;width:50%;height:2px;background:${color};transform:translateY(-50%);"></div>` : ''}
        </div>`;
      })}
    </div>
  `;

  const content = html`
    ${toastHtml}

    <div style="margin-bottom:1.5rem;">
      <a href="/agents" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Agent Roster</a>
    </div>

    <div style="margin-bottom:1.5rem;">
      <h1 style="margin:0 0 0.25rem;">Evolution Engine</h1>
      <p style="margin:0;font-size:0.9rem;color:var(--text-dim);">How your agents learn and improve over time.</p>
    </div>

    <!-- Stats bar -->
    <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:2rem;">
      <div class="card" style="padding:1rem 1.5rem;flex:1;min-width:140px;text-align:center;">
        <div style="font-size:2rem;font-weight:800;color:#6c63ff;">${totalEvoCycles}</div>
        <div style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.07em;margin-top:0.25rem;">Total Cycles</div>
      </div>
      <div class="card" style="padding:1rem 1.5rem;flex:1;min-width:140px;text-align:center;">
        <div style="font-size:2rem;font-weight:800;color:#4ecca3;">${goldenSuiteSize}</div>
        <div style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.07em;margin-top:0.25rem;">Golden Suite</div>
      </div>
      <div class="card" style="padding:1rem 1.5rem;flex:1;min-width:140px;text-align:center;">
        <div style="font-size:2rem;font-weight:800;color:#ffb347;">${agentsEvolved}</div>
        <div style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.07em;margin-top:0.25rem;">Agents Evolved</div>
      </div>
    </div>

    <!-- Lifecycle Progression -->
    <div class="card" style="padding:1.25rem;margin-bottom:2rem;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:1rem;">Lifecycle Progression</div>
      ${lifecycleVisual}
    </div>

    <!-- Agent Cards -->
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.75rem;">All 12 Agents</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1rem;margin-bottom:2rem;">
      ${agentCards}
    </div>

    <!-- Recent Evolution Events -->
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.75rem;">Recent Evolution Events</div>
    <div class="card" style="padding:0;overflow:hidden;">
      ${recentEvoRows.length === 0
        ? html`<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">No evolution events yet. Run agents to start accumulating lessons.</div>`
        : recentEvoRows}
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /agents/evolve/:name/synthesize — Trigger Evolution ─────────────────

agentEvolveRoutes.post('/agents/evolve/:name/synthesize', async (c) => {
  const founder = c.get('founder');
  const name = c.req.param('name');

  if (!isValidAgentName(name)) return c.redirect('/agents/evolve');

  const ctx = await getLayoutContext(founder, 'agents', 'Evolution Engine', undefined, c);
  if (!ctx.productId) return c.redirect('/agents/evolve');

  try {
    const result = await runEvolutionSynthesis(ctx.productId, name);
    if (result.evolved) {
      return c.redirect(`/agents/evolve?ran=${encodeURIComponent(AGENT_DISPLAY_NAMES[name])}`);
    }
    // Not enough data or no improvements — redirect with informational error
    return c.redirect('/agents/evolve?error=1');
  } catch {
    return c.redirect('/agents/evolve?error=1');
  }
});
