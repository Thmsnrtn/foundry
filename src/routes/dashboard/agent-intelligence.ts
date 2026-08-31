// =============================================================================
// FOUNDRY — Agent Intelligence Routes
// Prompt Evolution + Founder Communication Preferences dashboard.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import { generatePromptMutations, activateMutation, listEvolutions } from '../../services/scp/accuracy/prompt-evolver.js';
import { getPreferences, inferPreferencesFromHistory } from '../../services/scp/preferences/learner.js';
import { AGENT_DISPLAY_NAMES } from '../../services/scp/types.js';
import type { AgentName } from '../../services/scp/types.js';
import { requireCompanyCapability } from '../../middleware/rbac.js';

export const agentIntelligence = new Hono<AuthEnv>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(val: number | null): string {
  if (val === null || val === undefined) return '—';
  return `${Math.round(val * 100)}%`;
}

function accuracyColor(val: number | null): string {
  if (val === null) return 'var(--text-muted)';
  return val >= 0.7 ? '#4ecca3' : val >= 0.5 ? '#ffb347' : '#ff6b6b';
}

function mutationTypeBadge(type: string): string {
  const map: Record<string, string> = {
    emphasis_shift:   'background:#6c63ff22;color:#6c63ff;',
    context_addition: 'background:#38bdf822;color:#38bdf8;',
    framing_change:   'background:#ffb34722;color:#ffb347;',
  };
  const style = map[type] ?? '';
  const label = type.replace(/_/g, ' ');
  return `<span style="font-size:0.65rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:2px 7px;border-radius:99px;${style}">${label}</span>`;
}

function confidenceBar(confidence: number): string {
  const pctVal = Math.round(confidence * 100);
  const color = confidence >= 0.8 ? '#4ecca3' : confidence >= 0.6 ? '#ffb347' : 'rgba(255,255,255,0.3)';
  return `<div style="display:flex;align-items:center;gap:0.5rem;">
    <div style="width:80px;height:5px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;">
      <div style="width:${pctVal}%;height:100%;background:${color};border-radius:3px;"></div>
    </div>
    <span style="font-size:0.72rem;color:${color};font-weight:600;">${pctVal}%</span>
  </div>`;
}

function deltaBadge(before: number | null, after: number | null): string {
  if (before === null || after === null) return '<span style="color:var(--text-muted);font-size:0.78rem;">—</span>';
  const delta = after - before;
  const sign = delta >= 0 ? '+' : '';
  const color = delta >= 0.05 ? '#4ecca3' : delta <= -0.05 ? '#ff6b6b' : 'var(--text-muted)';
  return `<span style="font-size:0.78rem;font-weight:700;color:${color};">${sign}${Math.round(delta * 100)}pp</span>`;
}

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function prefTypeLabel(type: string): string {
  const map: Record<string, string> = {
    detail_level:    'Detail Level',
    framing:         'Framing',
    agent_trust:     'Agent Trust',
    override_pattern: 'Override Pattern',
  };
  return map[type] ?? type;
}

// ─── GET /agents/intelligence — Main page ────────────────────────────────────

agentIntelligence.get('/agents/intelligence', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'agents', 'Agent Intelligence', undefined, c);

  const msgParam = c.req.query('msg');
  const errorParam = c.req.query('error');

  if (!ctx.productId) {
    const content = html`
      <div style="margin-bottom:1.5rem;">
        <a href="/agents" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Agent Roster</a>
      </div>
      <h1 style="margin:0 0 0.5rem;">Agent Intelligence</h1>
      <p style="color:var(--text-dim);">No product selected.</p>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;

  const [evolutions, preferences] = await Promise.all([
    listEvolutions(productId),
    getPreferences(productId),
  ]);

  // Toast
  const toastHtml = msgParam
    ? html`<div style="background:#4ecca322;border:1px solid #4ecca344;border-radius:8px;padding:0.75rem 1rem;margin-bottom:1.5rem;color:#4ecca3;font-size:0.85rem;">${decodeURIComponent(msgParam)}</div>`
    : errorParam
      ? html`<div style="background:#ff6b6b22;border:1px solid #ff6b6b44;border-radius:8px;padding:0.75rem 1rem;margin-bottom:1.5rem;color:#ff6b6b;font-size:0.85rem;">Operation failed — ${decodeURIComponent(errorParam)}</div>`
      : '';

  // ── Section 1: Prompt Evolution ────────────────────────────────────────────

  const evolutionRows = evolutions.length === 0
    ? html`<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">
        No mutations generated yet. Click "Generate Mutations" to analyze underperforming agents.
      </div>`
    : evolutions.map((ev) => {
        const displayName = AGENT_DISPLAY_NAMES[ev.agentName as AgentName] ?? ev.agentName;
        const isActive = ev.isActive;
        return html`
        <div style="display:grid;grid-template-columns:120px 100px 110px 80px 1fr 180px;gap:0.75rem;align-items:center;padding:0.875rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.05);">
          <div style="font-size:0.85rem;font-weight:600;color:var(--text-primary);">
            ${displayName}
            ${isActive ? html`<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#4ecca3;margin-left:5px;vertical-align:middle;"></span>` : ''}
          </div>
          <div>${mutationTypeBadge(ev.mutationType)}</div>
          <div style="font-size:0.78rem;color:var(--text-dim);">
            <span style="color:${accuracyColor(ev.accuracyBefore)};">${pct(ev.accuracyBefore)}</span>
            <span style="color:var(--text-muted);"> → </span>
            <span style="color:${accuracyColor(ev.accuracyAfter)};">${pct(ev.accuracyAfter)}</span>
          </div>
          <div>${deltaBadge(ev.accuracyBefore, ev.accuracyAfter)}</div>
          <div style="font-size:0.78rem;color:var(--text-dim);line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;" title="${ev.reasoning}">${ev.reasoning}</div>
          <div style="display:flex;align-items:center;gap:0.5rem;justify-content:flex-end;">
            <span style="font-size:0.72rem;color:var(--text-muted);">${isActive ? `Active since ${fmtDate(ev.activatedAt)}` : `v${ev.currentVersion}`}</span>
            ${!isActive ? html`
            <form method="POST" action="/agents/intelligence/mutations/${ev.id}/activate" style="display:inline;">
              <button type="submit" class="btn btn-ghost btn-sm" style="font-size:0.72rem;padding:3px 10px;">Activate</button>
            </form>` : html`<span style="font-size:0.7rem;background:#4ecca322;color:#4ecca3;padding:2px 8px;border-radius:99px;font-weight:700;">Active</span>`}
          </div>
        </div>`;
      });

  // ── Section 2: Founder Preferences ────────────────────────────────────────

  const prefRows = preferences.length === 0
    ? html`<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">
        No preferences inferred yet. Click "Re-infer from History" to analyze your action patterns.
      </div>`
    : preferences.map((pref) => {
        const typeLabel = prefTypeLabel(pref.preference_type);
        return html`
        <div style="display:grid;grid-template-columns:130px 180px 1fr 160px;gap:0.75rem;align-items:center;padding:0.875rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.05);">
          <div style="font-size:0.72rem;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:var(--text-muted);">${typeLabel}</div>
          <div style="font-size:0.82rem;color:var(--text-dim);">${pref.preference_key}</div>
          <div style="font-size:0.85rem;color:var(--text-primary);">${pref.preference_value}</div>
          <div>${confidenceBar(pref.confidence)}</div>
        </div>`;
      });

  const content = html`
    ${toastHtml}

    <div style="margin-bottom:1.5rem;">
      <a href="/agents" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Agent Roster</a>
    </div>

    <div style="margin-bottom:2rem;">
      <h1 style="margin:0 0 0.25rem;">Agent Intelligence</h1>
      <p style="margin:0;font-size:0.9rem;color:var(--text-dim);">Prompts that learn from your company. Preferences that adapt to how you work.</p>
    </div>

    <!-- ── Section 1: Prompt Evolution ───────────────────────────────────── -->
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:0.75rem;gap:1rem;flex-wrap:wrap;">
      <div>
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.2rem;">Prompt Evolution</div>
        <p style="margin:0;font-size:0.82rem;color:var(--text-dim);">Agent prompts evolve based on prediction accuracy. Activate mutations to improve underperforming agents.</p>
      </div>
      <form method="POST" action="/agents/intelligence/mutations/generate">
        <button type="submit" class="btn btn-primary" style="font-size:0.8rem;">Generate Mutations</button>
      </form>
    </div>

    <div class="card" style="padding:0;overflow:hidden;margin-bottom:2rem;">
      <!-- Header row -->
      <div style="display:grid;grid-template-columns:120px 100px 110px 80px 1fr 180px;gap:0.75rem;padding:0.65rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.07);">
        <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Agent</span>
        <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Mutation Type</span>
        <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Before → After</span>
        <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Delta</span>
        <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Reasoning</span>
        <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);text-align:right;">Action</span>
      </div>
      ${evolutionRows}
    </div>

    <!-- ── Section 2: Founder Preferences ────────────────────────────────── -->
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:0.75rem;gap:1rem;flex-wrap:wrap;">
      <div>
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.2rem;">Founder Communication Preferences</div>
        <p style="margin:0;font-size:0.82rem;color:var(--text-dim);">Learned from your approval and override patterns. Higher confidence = stronger signal.</p>
      </div>
      <form method="POST" action="/agents/intelligence/preferences/infer">
        <button type="submit" class="btn btn-ghost" style="font-size:0.8rem;">Re-infer from History</button>
      </form>
    </div>

    <div class="card" style="padding:0;overflow:hidden;">
      <!-- Header row -->
      <div style="display:grid;grid-template-columns:130px 180px 1fr 160px;gap:0.75rem;padding:0.65rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.07);">
        <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Type</span>
        <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Key</span>
        <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Value</span>
        <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Confidence</span>
      </div>
      ${prefRows}
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /agents/intelligence/mutations/generate ─────────────────────────────

agentIntelligence.post('/agents/intelligence/mutations/generate',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'agents', 'Agent Intelligence', undefined, c);

  if (!ctx.productId) return c.redirect('/agents/intelligence');

  try {
    const mutations = await generatePromptMutations(ctx.productId);
    const msg = mutations.length > 0
      ? `Generated ${mutations.length} mutation${mutations.length === 1 ? '' : 's'} for underperforming agents.`
      : 'No underperforming agents found — all agents meet accuracy thresholds.';
    return c.redirect(`/agents/intelligence?msg=${encodeURIComponent(msg)}`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    return c.redirect(`/agents/intelligence?error=${encodeURIComponent(errMsg)}`);
  }
});

// ─── POST /agents/intelligence/mutations/:id/activate ────────────────────────

agentIntelligence.post('/agents/intelligence/mutations/:id/activate',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const mutationId = c.req.param('id');
  const ctx = await getLayoutContext(founder, 'agents', 'Agent Intelligence', undefined, c);

  if (!ctx.productId) return c.redirect('/agents/intelligence');

  try {
    // Look up agent name for this mutation
    const { query } = await import('../../db/client.js');
    const result = await query(
      `SELECT agent_name FROM evolved_prompts WHERE id = ? AND product_id = ?`,
      [mutationId, ctx.productId]
    );
    if (result.rows.length === 0) {
      return c.redirect('/agents/intelligence?error=Mutation+not+found');
    }
    const agentName = (result.rows[0] as Record<string, unknown>).agent_name as string;
    await activateMutation(ctx.productId, agentName, mutationId);
    return c.redirect(`/agents/intelligence?msg=${encodeURIComponent(`Mutation activated for ${AGENT_DISPLAY_NAMES[agentName as AgentName] ?? agentName}.`)}`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Activation failed';
    return c.redirect(`/agents/intelligence?error=${encodeURIComponent(errMsg)}`);
  }
});

// ─── POST /agents/intelligence/preferences/infer ──────────────────────────────

agentIntelligence.post('/agents/intelligence/preferences/infer',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'agents', 'Agent Intelligence', undefined, c);

  if (!ctx.productId) return c.redirect('/agents/intelligence');

  try {
    const count = await inferPreferencesFromHistory(ctx.productId);
    const msg = count > 0
      ? `Updated ${count} preference${count === 1 ? '' : 's'} from your history.`
      : 'No new preference signals found in history.';
    return c.redirect(`/agents/intelligence?msg=${encodeURIComponent(msg)}`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Inference failed';
    return c.redirect(`/agents/intelligence?error=${encodeURIComponent(errMsg)}`);
  }
});
