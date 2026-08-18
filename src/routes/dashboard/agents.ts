// =============================================================================
// FOUNDRY — Agent Management Routes (Sovereign Company Protocol)
// Roster, detail, manual triggers, authority controls, decision approval.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { query } from '../../db/client.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import { recordFounderCorrection } from '../../services/scp/evolution.js';
import { recordDecisionOutcome } from '../../services/scp/wisdom.js';
import { SCPInstance } from '../../services/scp/instance.js';
import {
  ALL_AGENTS,
  AGENT_DISPLAY_NAMES,
  AGENT_ROLES,
  type AgentName,
  type AgentInstance,
  type GoldenSuiteEntry,
  type EvolutionVersion,
} from '../../services/scp/types.js';
import { requireCompanyCapability } from '../../middleware/rbac.js';

export const agentRoutes = new Hono<AuthEnv>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidAgentName(name: string): name is AgentName {
  return (ALL_AGENTS as string[]).includes(name);
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function successRate(instance: Record<string, unknown>): number {
  const total = (instance.total_sessions as number) ?? 0;
  const successful = (instance.successful_sessions as number) ?? 0;
  if (total === 0) return 0;
  return Math.round((successful / total) * 100);
}

function authorityLabel(level: number): string {
  if (level === 0) return 'Fully autonomous';
  if (level === 1) return 'Notify + override';
  return 'Require approval';
}

function lifecycleBadge(state: string | null): string {
  const map: Record<string, string> = {
    setup:      '⚪ Setup',
    learning:   '🔵 Learning',
    operating:  '🟢 Operating',
    optimizing: '🟡 Optimizing',
    scaling:    '🟣 Scaling',
  };
  return map[state ?? ''] ?? '⚪ Unknown';
}

function statusDot(status: string) {
  const color = status === 'active' ? '#4ecca3' : status === 'paused' ? '#ffb347' : '#ff6b6b';
  return html`<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:0.35rem;flex-shrink:0;"></span>`;
}

function lessonTypeBadge(type: string) {
  const map: Record<string, string> = {
    correction: 'background:#ff6b6b22;color:#ff6b6b;',
    validation: 'background:#4ecca322;color:#4ecca3;',
    behavioral: 'background:#6c63ff22;color:#6c63ff;',
    domain:     'background:#ffb34722;color:#ffb347;',
  };
  const style = map[type] ?? '';
  return html`<span style="font-size:0.65rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:2px 7px;border-radius:99px;${style}">${type}</span>`;
}

function changeTypeBadge(type: string) {
  const map: Record<string, string> = {
    golden_lesson:       'background:#4ecca322;color:#4ecca3;',
    constraint_added:    'background:#6c63ff22;color:#6c63ff;',
    authority_change:    'background:#ffb34722;color:#ffb347;',
    prompt_refinement:   'background:#38bdf822;color:#38bdf8;',
    founder_correction:  'background:#ff6b6b22;color:#ff6b6b;',
    initial_provision:   'background:#ffffff11;color:#9ca3af;',
  };
  const style = map[type] ?? '';
  const label = type.replace(/_/g, ' ');
  return html`<span style="font-size:0.65rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:2px 7px;border-radius:99px;${style}">${label}</span>`;
}

// ─── GET /agents — Agent Roster ───────────────────────────────────────────────

agentRoutes.get('/', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'agents', 'Agent Roster', undefined, c);

  const errorParam = c.req.query('error');
  const decisionApproved = c.req.query('decision_approved');
  const decisionDenied = c.req.query('decision_denied');

  if (!ctx.productId) {
    const content = html`
      <h1 style="margin:0 0 0.5rem;">Agent Roster</h1>
      <p style="color:var(--text-dim);margin:0 0 2rem;">No product selected.</p>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;

  const [agentResult, productResult] = await Promise.all([
    query('SELECT * FROM agent_instances WHERE product_id = ? ORDER BY agent_name', [productId]),
    query('SELECT company_lifecycle_state, scp_status FROM products WHERE id = ?', [productId]),
  ]);

  const agents = agentResult.rows as unknown as AgentInstance[];
  const product = (productResult.rows[0] ?? {}) as Record<string, unknown>;
  const lifecycleState = (product.company_lifecycle_state as string) ?? null;

  const toastHtml = errorParam === 'provision_failed'
    ? html`<div style="background:#ff6b6b22;border:1px solid #ff6b6b44;border-radius:8px;padding:0.75rem 1rem;margin-bottom:1.5rem;color:#ff6b6b;font-size:0.85rem;">Provisioning failed. Please try again or contact support.</div>`
    : decisionApproved
      ? html`<div style="background:#4ecca322;border:1px solid #4ecca344;border-radius:8px;padding:0.75rem 1rem;margin-bottom:1.5rem;color:#4ecca3;font-size:0.85rem;">Decision approved.</div>`
      : decisionDenied
        ? html`<div style="background:#ffb34722;border:1px solid #ffb34744;border-radius:8px;padding:0.75rem 1rem;margin-bottom:1.5rem;color:#ffb347;font-size:0.85rem;">Decision denied and correction recorded.</div>`
        : '';

  if (agents.length === 0) {
    const content = html`
      ${toastHtml}
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:0.5rem;">
        <h1 style="margin:0;">Agent Roster</h1>
        <span style="font-size:0.8rem;color:var(--text-dim);">Your 12 AI specialists</span>
      </div>

      <div style="text-align:center;padding:4rem 2rem;background:var(--bg-card);border-radius:12px;border:1px solid rgba(255,255,255,0.06);">
        <div style="font-size:3rem;margin-bottom:1rem;">🤖</div>
        <h2 style="margin:0 0 0.5rem;color:var(--text-primary);">Provisioning...</h2>
        <p style="color:var(--text-dim);margin:0 0 1.5rem;max-width:380px;margin-left:auto;margin-right:auto;">
          Your AI team hasn't been set up yet. Provision your 12 specialized agents to get started with the Sovereign Company Protocol.
        </p>
        <form method="POST" action="/agents/provision" style="display:inline;">
          <button type="submit" class="btn btn-primary">Set up your AI team</button>
        </form>
      </div>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const agentCards = agents.map((agent) => {
    const rate = successRate(agent as unknown as Record<string, unknown>);
    const healthScore = (agent.domain_health_score as number) ?? 50;
    const healthColor = healthScore >= 70 ? '#4ecca3' : healthScore >= 40 ? '#ffb347' : '#ff6b6b';
    const displayName = AGENT_DISPLAY_NAMES[agent.agent_name] ?? agent.display_name;
    const role = AGENT_ROLES[agent.agent_name] ?? agent.role_description ?? '';

    return html`
    <div class="card" style="padding:1.25rem;display:flex;flex-direction:column;gap:0.75rem;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:0.5rem;">
        <div>
          <div style="font-size:1rem;font-weight:700;color:var(--text-primary);">
            ${displayName}
            <span style="color:var(--text-dim);font-weight:400;"> · </span>
            <span style="color:var(--text-dim);font-weight:500;font-size:0.85rem;">${role}</span>
          </div>
        </div>
        <span style="font-size:0.7rem;font-weight:700;letter-spacing:0.06em;background:rgba(108,99,255,0.15);color:#6c63ff;padding:2px 8px;border-radius:99px;white-space:nowrap;">v${agent.version}</span>
      </div>

      <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;">
          ${statusDot(agent.status)}
          <span style="font-size:0.75rem;color:var(--text-dim);text-transform:capitalize;">${agent.status}</span>
        </div>
        <span style="color:var(--text-muted);font-size:0.75rem;">·</span>
        <span style="font-size:0.7rem;padding:2px 7px;border-radius:99px;background:rgba(255,255,255,0.06);color:var(--text-dim);">
          Level ${agent.authority_level} — ${authorityLabel(agent.authority_level as number)}
        </span>
      </div>

      <div>
        <div style="display:flex;justify-content:space-between;margin-bottom:0.3rem;">
          <span style="font-size:0.7rem;color:var(--text-muted);letter-spacing:0.05em;text-transform:uppercase;">Domain Health</span>
          <span style="font-size:0.7rem;font-weight:700;color:${healthColor};">${healthScore}</span>
        </div>
        <div style="height:4px;border-radius:2px;background:rgba(255,255,255,0.08);overflow:hidden;">
          <div style="height:100%;width:${healthScore}%;background:${healthColor};border-radius:2px;transition:width 0.3s;"></div>
        </div>
      </div>

      <div style="font-size:0.75rem;color:var(--text-dim);">
        ${agent.total_sessions} sessions · ${rate}% success
      </div>

      <div style="font-size:0.72rem;color:var(--text-muted);">
        Last run: ${timeAgo(agent.last_run_at)}
      </div>

      <a href="/agents/${agent.agent_name}" style="font-size:0.8rem;color:var(--accent);text-decoration:none;margin-top:auto;">View details →</a>
    </div>`;
  });

  const content = html`
    ${toastHtml}

    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:0.5rem;">
      <h1 style="margin:0;">Agent Roster</h1>
      <span style="font-size:0.8rem;color:var(--text-dim);">Your 12 AI specialists</span>
    </div>

    <div style="margin-bottom:1.5rem;">
      <span style="font-size:0.8rem;padding:4px 12px;border-radius:99px;background:rgba(255,255,255,0.07);color:var(--text-dim);">${lifecycleBadge(lifecycleState)}</span>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:1rem;margin-bottom:2rem;">
      ${agentCards}
    </div>

    <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap;">
      <a href="/agents/evolve" class="btn btn-primary">Manage Evolution</a>
      <a href="/agents/briefings/latest" style="font-size:0.85rem;color:var(--accent);">View Latest Briefing →</a>
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /agents/provision — Provision SCP ───────────────────────────────────

agentRoutes.post('/provision', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'agents', 'Agent Roster', undefined, c);

  if (!ctx.productId) return c.redirect('/agents');

  try {
    const { provisionSCP } = await import('../../services/scp/provisioner.js');
    await provisionSCP(ctx.productId, founder.id);
    return c.redirect('/agents');
  } catch {
    return c.redirect('/agents?error=provision_failed');
  }
});

// ─── GET /agents/:name — Agent Detail ─────────────────────────────────────────

agentRoutes.get('/:name', async (c) => {
  const founder = c.get('founder');
  const name = c.req.param('name');

  if (!isValidAgentName(name)) return c.redirect('/agents');

  const ctx = await getLayoutContext(founder, 'agents', `${AGENT_DISPLAY_NAMES[name]} — Agent`, undefined, c);
  if (!ctx.productId) return c.redirect('/agents');

  const productId = ctx.productId;
  const ranParam = c.req.query('ran');

  const [instanceResult, sessionsResult, goldenResult, evolutionResult] = await Promise.all([
    query(
      'SELECT * FROM agent_instances WHERE product_id = ? AND agent_name = ?',
      [productId, name]
    ),
    query(
      'SELECT * FROM agent_sessions WHERE product_id = ? AND agent_name = ? ORDER BY started_at DESC LIMIT 10',
      [productId, name]
    ),
    query(
      'SELECT * FROM golden_suite WHERE product_id = ? AND agent_name = ? AND active = 1 ORDER BY confidence DESC',
      [productId, name]
    ),
    query(
      'SELECT * FROM agent_evolution_versions WHERE product_id = ? AND agent_name = ? ORDER BY version DESC LIMIT 20',
      [productId, name]
    ),
  ]);

  if (instanceResult.rows.length === 0) {
    const content = html`
      <a href="/agents" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Agent Roster</a>
      <div style="margin-top:2rem;text-align:center;color:var(--text-dim);">Agent not provisioned yet.</div>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const agent = instanceResult.rows[0] as unknown as AgentInstance;
  const sessions = sessionsResult.rows as unknown as Array<Record<string, unknown>>;
  const goldenEntries = goldenResult.rows as unknown as GoldenSuiteEntry[];
  const evolutionHistory = evolutionResult.rows as unknown as EvolutionVersion[];

  const rate = successRate(agent as unknown as Record<string, unknown>);
  const displayName = AGENT_DISPLAY_NAMES[agent.agent_name] ?? agent.display_name;
  const role = AGENT_ROLES[agent.agent_name] ?? agent.role_description ?? '';
  const healthScore = (agent.domain_health_score as number) ?? 50;
  const healthColor = healthScore >= 70 ? '#4ecca3' : healthScore >= 40 ? '#ffb347' : '#ff6b6b';

  const ranToast = ranParam === '1'
    ? html`<div style="background:#4ecca322;border:1px solid #4ecca344;border-radius:8px;padding:0.75rem 1rem;margin-bottom:1.5rem;color:#4ecca3;font-size:0.85rem;">Agent run triggered successfully.</div>`
    : '';

  const sessionRows = sessions.map((s) => {
    const isSuccess = s.status === 'completed';
    const statusIcon = isSuccess ? '✅' : '❌';
    const started = s.started_at ? new Date(s.started_at as string).toLocaleDateString() : '—';
    const durationMs = (s.completed_at && s.started_at)
      ? new Date(s.completed_at as string).getTime() - new Date(s.started_at as string).getTime()
      : null;
    const durationStr = durationMs !== null ? `${(durationMs / 1000).toFixed(1)}s` : '—';
    const contribution = (s.briefing_contribution as string) ?? '';

    return html`
    <div style="padding:0.9rem 1rem;border-bottom:1px solid rgba(255,255,255,0.05);last-child:border-none;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.3rem;">
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <span>${statusIcon}</span>
          <span style="font-size:0.8rem;color:var(--text-dim);">${started}</span>
          <span style="font-size:0.75rem;color:var(--text-muted);">${durationStr}</span>
        </div>
        <span style="font-size:0.7rem;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:var(--text-muted);">${s.briefing_priority as string ?? 'normal'}</span>
      </div>
      ${contribution ? html`<p style="margin:0;font-size:0.8rem;color:var(--text-dim);line-height:1.5;">${contribution}</p>` : ''}
    </div>`;
  });

  const goldenRows = goldenEntries.map((g) => {
    const confidence = Math.round((g.confidence ?? 0) * 100);
    return html`
    <div style="padding:0.9rem 1rem;border-bottom:1px solid rgba(255,255,255,0.05);">
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">
        ${lessonTypeBadge(g.lesson_type)}
        <span style="font-size:0.72rem;color:var(--text-muted);">reinforced ${g.times_reinforced}×</span>
      </div>
      <p style="margin:0 0 0.5rem;font-size:0.82rem;color:var(--text-primary);line-height:1.5;">${g.lesson}</p>
      <div style="display:flex;align-items:center;gap:0.5rem;">
        <span style="font-size:0.7rem;color:var(--text-muted);">Confidence</span>
        <div style="flex:1;height:3px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;max-width:100px;">
          <div style="height:100%;width:${confidence}%;background:#6c63ff;border-radius:2px;"></div>
        </div>
        <span style="font-size:0.7rem;color:var(--text-dim);">${confidence}%</span>
      </div>
    </div>`;
  });

  const evolutionRows = evolutionHistory.map((ev) => {
    const date = ev.created_at ? new Date(ev.created_at).toLocaleDateString() : '—';
    return html`
    <div style="padding:0.9rem 1rem;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;align-items:flex-start;gap:0.75rem;">
      <span style="font-size:0.75rem;font-weight:700;color:var(--text-muted);min-width:2rem;">v${ev.version}</span>
      <div style="flex:1;">
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.3rem;flex-wrap:wrap;">
          ${changeTypeBadge(ev.change_type)}
          <span style="font-size:0.72rem;color:var(--text-muted);">${date}</span>
        </div>
        <p style="margin:0;font-size:0.8rem;color:var(--text-dim);line-height:1.5;">${ev.change_description}</p>
      </div>
    </div>`;
  });

  const content = html`
    ${ranToast}

    <div style="margin-bottom:1.5rem;">
      <a href="/agents" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Agent Roster</a>
    </div>

    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap;">
      <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">
        <h1 style="margin:0;font-size:1.6rem;">${displayName}</h1>
        <span style="font-size:0.8rem;padding:3px 10px;border-radius:99px;background:rgba(108,99,255,0.15);color:#6c63ff;">${role}</span>
        <span style="font-size:0.75rem;padding:2px 8px;border-radius:99px;background:rgba(255,255,255,0.07);color:var(--text-dim);">v${agent.version}</span>
        <div style="display:flex;align-items:center;">${statusDot(agent.status)}<span style="font-size:0.8rem;color:var(--text-dim);text-transform:capitalize;">${agent.status}</span></div>
      </div>
      <form method="POST" action="/agents/${name}/run" style="display:inline;">
        <button type="submit" class="btn btn-ghost btn-sm">Run now</button>
      </form>
    </div>

    <div style="display:flex;gap:1.5rem;flex-wrap:wrap;margin-bottom:2rem;">
      <div style="font-size:0.82rem;color:var(--text-dim);">${agent.total_sessions} sessions</div>
      <div style="font-size:0.82rem;color:var(--text-dim);">${rate}% success</div>
      <div style="font-size:0.82rem;color:var(--text-dim);">v${agent.version}</div>
      <div style="font-size:0.82rem;color:var(--text-dim);">Level ${agent.authority_level} authority</div>
    </div>

    <!-- Domain Health Score -->
    <div class="card" style="padding:1.25rem;margin-bottom:1.5rem;display:flex;align-items:center;gap:1.5rem;">
      <div style="text-align:center;">
        <div style="font-size:2.5rem;font-weight:800;color:${healthColor};line-height:1;">${healthScore}</div>
        <div style="font-size:0.7rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);margin-top:0.25rem;">Domain Health</div>
      </div>
      <div style="flex:1;">
        <div style="height:8px;border-radius:4px;background:rgba(255,255,255,0.08);overflow:hidden;">
          <div style="height:100%;width:${healthScore}%;background:${healthColor};border-radius:4px;transition:width 0.4s;"></div>
        </div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.5rem;">Last run: ${timeAgo(agent.last_run_at)}</div>
      </div>
    </div>

    <!-- Recent Sessions -->
    <div class="card" style="padding:0;overflow:hidden;margin-bottom:1.5rem;">
      <div style="padding:1rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.07);">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Recent Sessions</div>
      </div>
      ${sessions.length === 0
        ? html`<div style="padding:1.5rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">No sessions yet.</div>`
        : sessionRows}
    </div>

    <!-- Golden Suite -->
    <div class="card" style="padding:0;overflow:hidden;margin-bottom:1.5rem;">
      <div style="padding:1rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.07);">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Golden Suite — ${goldenEntries.length} active lessons</div>
      </div>
      ${goldenEntries.length === 0
        ? html`<div style="padding:1.5rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">No golden lessons yet. They accumulate as the agent runs.</div>`
        : goldenRows}
    </div>

    <!-- Evolution History -->
    <div class="card" style="padding:0;overflow:hidden;margin-bottom:1.5rem;">
      <div style="padding:1rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.07);">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Evolution History</div>
      </div>
      ${evolutionHistory.length === 0
        ? html`<div style="padding:1.5rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">No evolution history yet.</div>`
        : evolutionRows}
    </div>

    <!-- Authority Controls -->
    <div class="card" style="padding:1.25rem;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.75rem;">Authority Controls</div>
      <div style="font-size:0.9rem;color:var(--text-primary);margin-bottom:1rem;">
        Current: <strong>Level ${agent.authority_level}</strong> — ${authorityLabel(agent.authority_level as number)}
      </div>
      <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
        ${(agent.authority_level as number) > 0 ? html`
        <form method="POST" action="/agents/${name}/authority" style="display:inline;">
          <input type="hidden" name="level" value="${(agent.authority_level as number) - 1}" />
          <button type="submit" class="btn btn-ghost btn-sm" style="color:#ff6b6b;border-color:#ff6b6b44;">Reduce Authority</button>
        </form>` : ''}
        ${(agent.authority_level as number) < 2 ? html`
        <form method="POST" action="/agents/${name}/authority" style="display:inline;">
          <input type="hidden" name="level" value="${(agent.authority_level as number) + 1}" />
          <button type="submit" class="btn btn-ghost btn-sm" style="color:#4ecca3;border-color:#4ecca344;">Increase Authority</button>
        </form>` : ''}
      </div>
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /agents/:name/run — Manual Trigger ──────────────────────────────────

agentRoutes.post('/:name/run', async (c) => {
  const founder = c.get('founder');
  const name = c.req.param('name');

  if (!isValidAgentName(name)) return c.redirect('/agents');

  const ctx = await getLayoutContext(founder, 'agents', 'Agent Roster', undefined, c);
  if (!ctx.productId) return c.redirect('/agents');

  try {
    const agentModule = await import(`../../services/scp/agents/${name}.js`);
    const AgentClass = agentModule.default ?? Object.values(agentModule)[0];
    const agentInstance = new (AgentClass as new () => { run: (productId: string) => Promise<unknown> })();
    await agentInstance.run(ctx.productId);
  } catch {
    // Even if the run fails, redirect to the detail page — the session record will show the error.
  }

  return c.redirect(`/agents/${name}?ran=1`);
});

// ─── POST /agents/:name/authority — Change Authority Level ────────────────────

// SETTING AN AGENT'S AUTHORITY LEVEL IS GRANTING AUTHORITY. It decides how
// far the company's agents may act without a human, and it asked nothing:
// any member who could select the company could raise it.
agentRoutes.post('/:name/authority',
  requireCompanyCapability('can_manage_company'), async (c) => {
  const founder = c.get('founder');
  const name = c.req.param('name');

  if (!isValidAgentName(name)) return c.redirect('/agents');

  const ctx = await getLayoutContext(founder, 'agents', 'Agent Roster', undefined, c);
  if (!ctx.productId) return c.redirect('/agents');

  const productId = ctx.productId;
  const body = await c.req.parseBody() as Record<string, string>;
  const rawLevel = parseInt(body.level ?? '', 10);

  if (isNaN(rawLevel) || rawLevel < 0 || rawLevel > 2) {
    return c.redirect(`/agents/${name}`);
  }

  const level = rawLevel as 0 | 1 | 2;

  // Fetch current agent for version + previous config snapshot
  const agentResult = await query(
    'SELECT * FROM agent_instances WHERE product_id = ? AND agent_name = ?',
    [productId, name]
  );

  if (agentResult.rows.length === 0) return c.redirect(`/agents/${name}`);

  const agent = agentResult.rows[0] as unknown as AgentInstance;
  const newVersion = (agent.version as number) + 1;

  await Promise.all([
    query(
      'UPDATE agent_instances SET authority_level = ?, version = ?, updated_at = CURRENT_TIMESTAMP WHERE product_id = ? AND agent_name = ?',
      [level, newVersion, productId, name]
    ),
    query(
      `INSERT INTO agent_evolution_versions (id, product_id, agent_name, version, change_type, change_description, previous_config, new_config, promoted_at)
       VALUES (lower(hex(randomblob(16))), ?, ?, ?, 'authority_change', ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        productId,
        name,
        newVersion,
        `Authority level changed from ${agent.authority_level} to ${level} by founder`,
        JSON.stringify({ authority_level: agent.authority_level }),
        JSON.stringify({ authority_level: level }),
      ]
    ),
  ]);

  return c.redirect(`/agents/${name}`);
});

// ─── POST /agents/decisions/:id/approve — Approve a Decision ─────────────────

agentRoutes.post('/decisions/:id/approve', async (c) => {
  const founder = c.get('founder');
  const decisionId = c.req.param('id');

  const ctx = await getLayoutContext(founder, 'agents', 'Agent Roster', undefined, c);
  if (!ctx.productId) return c.redirect('/agents');

  const productId = ctx.productId;
  const body = await c.req.parseBody() as Record<string, string>;

  // Log audit notification
  try {
    await query(
      `INSERT INTO notifications (id, founder_id, product_id, type, title, body, created_at)
       VALUES (lower(hex(randomblob(16))), ?, ?, 'scp_decision', 'Decision Approved', ?, CURRENT_TIMESTAMP)`,
      [
        founder.id,
        productId,
        `SCP decision ${decisionId} was approved by founder.`,
      ]
    );
  } catch {
    // notifications table may not exist yet — non-fatal
  }

  // Look up the session and agent that contains this decision
  try {
    const sessionResult = await query(
      `SELECT id, agent_name, pending_decisions FROM agent_sessions
       WHERE product_id = ? AND pending_decisions LIKE ?
       ORDER BY started_at DESC LIMIT 1`,
      [productId, `%${decisionId}%`]
    );

    let resolvedAgentName: AgentName = 'oracle';
    let sessionId: string | null = null;
    let decisionTitle = `Decision ${decisionId}`;
    let decisionDescription = '';

    if (sessionResult.rows.length > 0) {
      const session = sessionResult.rows[0] as Record<string, unknown>;
      resolvedAgentName = (session.agent_name as AgentName) ?? 'oracle';
      sessionId = session.id as string;

      // Parse pending_decisions JSON to extract title/description
      try {
        const pendingRaw = session.pending_decisions as string | null;
        if (pendingRaw) {
          const decisions = JSON.parse(pendingRaw) as Array<Record<string, unknown>>;
          const found = decisions.find((d) => d.id === decisionId);
          if (found) {
            decisionTitle = (found.title as string) ?? decisionTitle;
            decisionDescription = (found.description as string) ?? '';
          }
        }
      } catch {
        // JSON parse failure — use defaults
      }
    }

    await recordDecisionOutcome({
      productId,
      agentName: resolvedAgentName,
      sessionId,
      decisionTitle,
      decisionDescription,
      outcome: 'approved',
      founderRationale: body.rationale ?? undefined,
    });
  } catch {
    // Non-fatal — wisdom tracking should not block the approval flow
  }

  return c.redirect('/agents?decision_approved=1');
});

// ─── POST /agents/decisions/:id/deny — Deny a Decision ───────────────────────

agentRoutes.post('/decisions/:id/deny', async (c) => {
  const founder = c.get('founder');
  const decisionId = c.req.param('id');

  const ctx = await getLayoutContext(founder, 'agents', 'Agent Roster', undefined, c);
  if (!ctx.productId) return c.redirect('/agents');

  const productId = ctx.productId;
  const body = await c.req.parseBody() as Record<string, string>;
  const founderRationale = body.rationale ?? undefined;

  // Look up the session and agent that contains this decision
  let resolvedAgentName: AgentName = 'oracle';
  let sessionId: string | null = null;
  let decisionTitle = `Decision ${decisionId}`;
  let decisionDescription = '';

  try {
    const sessionResult = await query(
      `SELECT id, agent_name, pending_decisions FROM agent_sessions
       WHERE product_id = ? AND pending_decisions LIKE ?
       ORDER BY started_at DESC LIMIT 1`,
      [productId, `%${decisionId}%`]
    );

    if (sessionResult.rows.length > 0) {
      const session = sessionResult.rows[0] as Record<string, unknown>;
      resolvedAgentName = (session.agent_name as AgentName) ?? 'oracle';
      sessionId = session.id as string;

      // Parse pending_decisions JSON to extract title/description
      try {
        const pendingRaw = session.pending_decisions as string | null;
        if (pendingRaw) {
          const decisions = JSON.parse(pendingRaw) as Array<Record<string, unknown>>;
          const found = decisions.find((d) => d.id === decisionId);
          if (found) {
            decisionTitle = (found.title as string) ?? decisionTitle;
            decisionDescription = (found.description as string) ?? '';
          }
        }
      } catch {
        // JSON parse failure — use defaults
      }
    }
  } catch {
    // Session lookup failed — use fallback agent name
  }

  // Mark decision as denied in agent_sessions via SCPInstance
  try {
    const instance = new SCPInstance(productId);
    await instance.denyDecision(decisionId, founderRationale ?? 'Denied by founder');
  } catch {
    // Non-fatal — decision may already be resolved or session not found
  }

  // Record founder correction via evolution engine
  try {
    await recordFounderCorrection(
      productId,
      resolvedAgentName,
      sessionId,
      `Decision ${decisionId} proposed`,
      'Denied by founder',
      founderRationale ?? 'Decision denied without modification',
    );
  } catch {
    // Non-fatal — evolution service may not be fully wired yet
  }

  // Record denial in wisdom layer
  try {
    await recordDecisionOutcome({
      productId,
      agentName: resolvedAgentName,
      sessionId,
      decisionTitle,
      decisionDescription,
      outcome: 'denied',
      founderRationale,
    });
  } catch {
    // Non-fatal — wisdom tracking should not block the denial flow
  }

  return c.redirect('/agents?decision_denied=1');
});

// ─── POST /agents/:name/pause — Pause Agent ───────────────────────────────────

agentRoutes.post('/:name/pause', async (c) => {
  const founder = c.get('founder');
  const name = c.req.param('name');

  if (!isValidAgentName(name)) return c.redirect('/agents');

  const ctx = await getLayoutContext(founder, 'agents', 'Agent Roster', undefined, c);
  if (!ctx.productId) return c.redirect('/agents');

  try {
    const instance = new SCPInstance(ctx.productId);
    await instance.pauseAgent(name);
  } catch {
    // Non-fatal — redirect to agent page regardless
  }

  return c.redirect(`/agents/${name}`);
});

// ─── POST /agents/:name/resume — Resume Agent ────────────────────────────────

agentRoutes.post('/:name/resume', async (c) => {
  const founder = c.get('founder');
  const name = c.req.param('name');

  if (!isValidAgentName(name)) return c.redirect('/agents');

  const ctx = await getLayoutContext(founder, 'agents', 'Agent Roster', undefined, c);
  if (!ctx.productId) return c.redirect('/agents');

  try {
    const instance = new SCPInstance(ctx.productId);
    await instance.resumeAgent(name);
  } catch {
    // Non-fatal — redirect to agent page regardless
  }

  return c.redirect(`/agents/${name}`);
});
