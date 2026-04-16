// =============================================================================
// FOUNDRY — Agent Constitution Routes
// Constitution viewer/editor at /agents/constitution.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import { query } from '../../db/client.js';
import {
  ALL_AGENTS,
  AGENT_DISPLAY_NAMES,
  AGENT_ROLES,
  DEFAULT_CONSTITUTION,
  type SCPConstitution,
  type AgentName,
  type EvolutionPolicy,
} from '../../services/scp/types.js';

export const agentConstitutionRoutes = new Hono<AuthEnv>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseJSONField<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function authorityLabel(level: number): string {
  if (level === 0) return 'Fully autonomous';
  if (level === 1) return 'Notify + override';
  return 'Require approval';
}

function authorityColor(level: number): string {
  if (level === 0) return '#4ecca3';
  if (level === 1) return '#ffb347';
  return '#6c63ff';
}

// ─── GET /agents/constitution — View/Edit Constitution ────────────────────────

agentConstitutionRoutes.get('/agents/constitution', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'agents', 'Constitution', undefined, c);

  const savedParam = c.req.query('saved');

  if (!ctx.productId) {
    const content = html`
      <div style="margin-bottom:1.5rem;">
        <a href="/agents" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Agent Roster</a>
      </div>
      <h1 style="margin:0 0 0.5rem;">Constitution</h1>
      <p style="color:var(--text-dim);">No product selected.</p>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;

  const constitutionResult = await query(
    'SELECT * FROM scp_constitutions WHERE product_id = ?',
    [productId]
  );

  // Build constitution object (DB row or DEFAULT)
  let constitution: SCPConstitution;
  if (constitutionResult.rows.length === 0) {
    constitution = {
      id: '',
      product_id: productId,
      version: DEFAULT_CONSTITUTION.version,
      core_values: DEFAULT_CONSTITUTION.core_values,
      operating_principles: DEFAULT_CONSTITUTION.operating_principles,
      authority_framework: DEFAULT_CONSTITUTION.authority_framework,
      evolution_policy: DEFAULT_CONSTITUTION.evolution_policy,
      created_at: '',
      updated_at: '',
    };
  } else {
    const row = constitutionResult.rows[0] as Record<string, unknown>;
    constitution = {
      id: row.id as string,
      product_id: row.product_id as string,
      version: (row.version as number) ?? 1,
      core_values: parseJSONField<string[]>(row.core_values, DEFAULT_CONSTITUTION.core_values),
      operating_principles: parseJSONField<string[]>(row.operating_principles, DEFAULT_CONSTITUTION.operating_principles),
      authority_framework: parseJSONField<Record<AgentName, 0 | 1 | 2>>(row.authority_framework, DEFAULT_CONSTITUTION.authority_framework as Record<AgentName, 0 | 1 | 2>),
      evolution_policy: parseJSONField<EvolutionPolicy>(row.evolution_policy, DEFAULT_CONSTITUTION.evolution_policy),
      created_at: (row.created_at as string) ?? '',
      updated_at: (row.updated_at as string) ?? '',
    };
  }

  const savedToast = savedParam
    ? html`<div style="background:#4ecca322;border:1px solid #4ecca344;border-radius:8px;padding:0.75rem 1rem;margin-bottom:1.5rem;color:#4ecca3;font-size:0.85rem;">Constitution saved — now at v${constitution.version}.</div>`
    : '';

  // Authority framework table
  const authorityRows = ALL_AGENTS.map((name) => {
    const level = (constitution.authority_framework as Record<string, number>)[name] ?? 2;
    return html`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:0.6rem 0;border-bottom:1px solid rgba(255,255,255,0.04);">
      <div>
        <span style="font-size:0.83rem;font-weight:600;color:var(--text-primary);">${AGENT_DISPLAY_NAMES[name]}</span>
        <span style="font-size:0.72rem;color:var(--text-muted);margin-left:0.4rem;">${AGENT_ROLES[name]}</span>
      </div>
      <span style="font-size:0.75rem;font-weight:600;padding:3px 10px;border-radius:99px;background:${authorityColor(level)}22;color:${authorityColor(level)};">Level ${level} — ${authorityLabel(level)}</span>
    </div>`;
  });

  // Evolution policy display
  const ep = constitution.evolution_policy;
  const evoPolicyDisplay = html`
    <div style="display:flex;flex-direction:column;gap:0.6rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0;border-bottom:1px solid rgba(255,255,255,0.04);">
        <span style="font-size:0.82rem;color:var(--text-dim);">Enabled</span>
        <span style="font-size:0.82rem;font-weight:600;color:${ep.enabled ? '#4ecca3' : '#ff6b6b'};">${ep.enabled ? 'Yes' : 'No'}</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0;border-bottom:1px solid rgba(255,255,255,0.04);">
        <span style="font-size:0.82rem;color:var(--text-dim);">Min sessions before evolution</span>
        <span style="font-size:0.82rem;font-weight:600;color:var(--text-primary);">${ep.min_sessions_before_evolution}</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0;border-bottom:1px solid rgba(255,255,255,0.04);">
        <span style="font-size:0.82rem;color:var(--text-dim);">Correction threshold</span>
        <span style="font-size:0.82rem;font-weight:600;color:var(--text-primary);">${(ep.correction_threshold * 100).toFixed(0)}%</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0;border-bottom:1px solid rgba(255,255,255,0.04);">
        <span style="font-size:0.82rem;color:var(--text-dim);">Auto-promote validation score</span>
        <span style="font-size:0.82rem;font-weight:600;color:var(--text-primary);">${(ep.auto_promote_on_validation_score * 100).toFixed(0)}%</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0;">
        <span style="font-size:0.82rem;color:var(--text-dim);">Max constraints per agent</span>
        <span style="font-size:0.82rem;font-weight:600;color:var(--text-primary);">${ep.max_constraints_per_agent}</span>
      </div>
    </div>
  `;

  const content = html`
    ${savedToast}

    <div style="margin-bottom:1.5rem;">
      <a href="/agents" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Agent Roster</a>
    </div>

    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:0.5rem;">
      <div>
        <h1 style="margin:0 0 0.25rem;">Constitution</h1>
        <span style="font-size:0.8rem;color:var(--text-muted);">Version ${constitution.version}${constitution.updated_at ? ` · Last updated ${new Date(constitution.updated_at).toLocaleDateString()}` : ''}</span>
      </div>
    </div>

    <!-- Editable sections -->
    <form method="POST" action="/agents/constitution">
      <div style="display:flex;flex-direction:column;gap:1.5rem;margin-bottom:1.5rem;">

        <!-- Core Values -->
        <div class="card" style="padding:1.25rem;">
          <label style="display:block;font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.5rem;">Core Values <span style="font-weight:400;font-size:0.65rem;text-transform:none;letter-spacing:0;">(one per line)</span></label>
          <textarea
            name="core_values"
            rows="7"
            style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:var(--text-primary);font-size:0.83rem;line-height:1.6;padding:0.75rem;resize:vertical;font-family:inherit;outline:none;"
            onfocus="this.style.borderColor='rgba(108,99,255,0.5)'"
            onblur="this.style.borderColor='rgba(255,255,255,0.1)'"
          >${constitution.core_values.join('\n')}</textarea>
        </div>

        <!-- Operating Principles -->
        <div class="card" style="padding:1.25rem;">
          <label style="display:block;font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.5rem;">Operating Principles <span style="font-weight:400;font-size:0.65rem;text-transform:none;letter-spacing:0;">(one per line)</span></label>
          <textarea
            name="operating_principles"
            rows="7"
            style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:var(--text-primary);font-size:0.83rem;line-height:1.6;padding:0.75rem;resize:vertical;font-family:inherit;outline:none;"
            onfocus="this.style.borderColor='rgba(108,99,255,0.5)'"
            onblur="this.style.borderColor='rgba(255,255,255,0.1)'"
          >${constitution.operating_principles.join('\n')}</textarea>
        </div>

      </div>

      <div style="margin-bottom:2rem;">
        <button type="submit" class="btn btn-primary">Save Constitution</button>
        <span style="font-size:0.75rem;color:var(--text-muted);margin-left:0.75rem;">Saving increments the version number.</span>
      </div>
    </form>

    <!-- Authority Framework (read-only) -->
    <div class="card" style="padding:1.25rem;margin-bottom:1.5rem;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.5rem;">Authority Framework <span style="font-weight:400;font-size:0.65rem;text-transform:none;letter-spacing:0;">(read-only — change via agent detail page)</span></div>
      ${authorityRows}
    </div>

    <!-- Evolution Policy (read-only) -->
    <div class="card" style="padding:1.25rem;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.75rem;">Evolution Policy <span style="font-weight:400;font-size:0.65rem;text-transform:none;letter-spacing:0;">(read-only)</span></div>
      ${evoPolicyDisplay}
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /agents/constitution — Save Constitution ────────────────────────────

agentConstitutionRoutes.post('/agents/constitution', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'agents', 'Constitution', undefined, c);

  if (!ctx.productId) return c.redirect('/agents/constitution');

  const productId = ctx.productId;
  const body = await c.req.parseBody() as Record<string, string>;

  const rawCoreValues = (body.core_values ?? '').trim();
  const rawOperatingPrinciples = (body.operating_principles ?? '').trim();

  const coreValues = rawCoreValues
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const operatingPrinciples = rawOperatingPrinciples
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Upsert the constitution record
  await query(
    `INSERT INTO scp_constitutions (id, product_id, version, core_values, operating_principles, authority_framework, evolution_policy, created_at, updated_at)
     VALUES (lower(hex(randomblob(16))), ?, 1, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(product_id) DO UPDATE SET
       core_values = excluded.core_values,
       operating_principles = excluded.operating_principles,
       version = scp_constitutions.version + 1,
       updated_at = CURRENT_TIMESTAMP`,
    [
      productId,
      JSON.stringify(coreValues),
      JSON.stringify(operatingPrinciples),
      JSON.stringify(DEFAULT_CONSTITUTION.authority_framework),
      JSON.stringify(DEFAULT_CONSTITUTION.evolution_policy),
    ]
  );

  return c.redirect('/agents/constitution?saved=1');
});
