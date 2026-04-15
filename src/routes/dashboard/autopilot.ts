// =============================================================================
// FOUNDRY — Autopilot Settings
// Founders configure how Foundry works on their behalf.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import { getAutopilotPreferences, saveAutopilotPreferences } from '../../services/autonomous/preferences.js';
import { calculateTrustScore, getMonthlyValueSummary } from '../../services/autonomous/autonomy-engine.js';

export const autopilotRoutes = new Hono<AuthEnv>();

autopilotRoutes.get('/settings/autopilot', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'settings', 'Autopilot Settings', undefined, c);
  const productId = ctx.productId;
  if (!productId) return c.redirect('/dashboard');

  const [prefs, trust, value] = await Promise.all([
    getAutopilotPreferences(productId),
    calculateTrustScore(productId, founder.id),
    getMonthlyValueSummary(productId),
  ]);

  const saved = c.req.query('saved') === '1';

  const focusAreas = [
    { key: 'churn_prevention', label: 'Churn Prevention', desc: 'Re-engagement emails, retention alerts, at-risk customer flagging' },
    { key: 'revenue_growth', label: 'Revenue Growth', desc: 'Expansion opportunities, pricing suggestions, MRR optimization' },
    { key: 'competitive_awareness', label: 'Competitive Awareness', desc: 'Competitor monitoring, market signals, positioning responses' },
    { key: 'product_quality', label: 'Product Quality', desc: 'Audit scores, remediation PRs, blocking issue prioritization' },
    { key: 'operational_health', label: 'Operational Health', desc: 'Metric freshness, decision velocity, stressor management' },
    { key: 'wisdom_building', label: 'Wisdom Building', desc: 'DNA completion, failure logging, judgment pattern synthesis' },
  ];

  const actionTypes = [
    { key: 'churn_intervention', label: 'Churn Interventions' },
    { key: 'competitive_response', label: 'Competitive Responses' },
    { key: 'decision_nudge', label: 'Decision Nudges' },
    { key: 'metrics_reminder', label: 'Metrics Reminders' },
    { key: 'dna_push', label: 'DNA Completion Pushes' },
    { key: 'audit_stale', label: 'Audit Freshness Alerts' },
  ];

  const content = html`
    <h1>Autopilot Settings</h1>
    ${saved ? html`<div class="feedback-banner feedback-success"><span class="feedback-icon">&#10003;</span><span>Autopilot preferences saved.</span></div>` : ''}

    <p style="color:var(--color-text-muted);margin-bottom:1.5rem;">
      Configure how Foundry operates on your behalf. These settings control which areas Foundry prioritizes,
      how much autonomy it has, and how it communicates with you.
    </p>

    <!-- Trust Summary -->
    <div class="card" style="margin-bottom:1.5rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <h3 style="margin:0;">Trust Level: <span style="color:var(--color-primary);">${trust.level.charAt(0).toUpperCase() + trust.level.slice(1)}</span></h3>
          <p style="font-size:var(--text-sm);color:var(--color-text-muted);margin:0.25rem 0 0;">
            Score: ${trust.score}/100 · ${value.actionsThisMonth} actions this month · ${value.estimatedHoursSaved}h saved
          </p>
        </div>
        <div style="text-align:right;">
          <div style="font-size:var(--text-sm);color:var(--color-text-muted);">Approval rate</div>
          <div style="font-size:1.2rem;font-weight:700;color:${trust.stats.approvalRate >= 0.8 ? 'var(--color-success)' : 'var(--color-text)'};">${(trust.stats.approvalRate * 100).toFixed(0)}%</div>
        </div>
      </div>
      ${trust.autoApprovedCategories.length > 0 ? html`
        <div style="margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid var(--color-border-subtle);font-size:var(--text-sm);">
          <strong>Auto-approved:</strong> ${trust.autoApprovedCategories.join(', ')}
        </div>` : ''}
    </div>

    <form method="POST" action="/settings/autopilot">
      <!-- Focus Areas -->
      <div class="card">
        <h3>Focus Areas</h3>
        <p style="font-size:var(--text-sm);color:var(--color-text-muted);margin-bottom:1rem;">
          Drag the sliders to tell Foundry what matters most. Higher = more actions in that area.
        </p>
        ${focusAreas.map((area) => {
          const val = prefs.focus[area.key as keyof typeof prefs.focus];
          return html`
          <div style="margin-bottom:1.25rem;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem;">
              <label style="font-weight:600;font-size:var(--text-base);">${area.label}</label>
              <span style="font-size:var(--text-sm);font-weight:700;color:var(--color-primary);min-width:24px;text-align:right;">${val}</span>
            </div>
            <input type="range" name="focus_${area.key}" min="1" max="10" value="${val}"
              oninput="this.previousElementSibling?.querySelector('span')&&(this.closest('div').querySelector('span').textContent=this.value)"
              style="width:100%;accent-color:var(--color-primary);" />
            <p style="font-size:var(--text-xs);color:var(--color-text-faint);margin:0.15rem 0 0;">${area.desc}</p>
          </div>`;
        })}
      </div>

      <!-- Autonomy Controls -->
      <div class="card">
        <h3>Autonomy Controls</h3>
        <p style="font-size:var(--text-sm);color:var(--color-text-muted);margin-bottom:1rem;">
          Override the trust system for specific action types. "Always approve" means you review every time.
          "Always auto" means Foundry acts without asking.
        </p>
        <div style="display:grid;grid-template-columns:1fr auto auto;gap:0.5rem;align-items:center;font-size:var(--text-sm);">
          <div style="font-weight:600;">Action Type</div>
          <div style="font-weight:600;text-align:center;">Always Ask</div>
          <div style="font-weight:600;text-align:center;">Always Auto</div>
          ${actionTypes.map((t) => html`
            <div>${t.label}</div>
            <div style="text-align:center;">
              <input type="checkbox" name="always_approve" value="${t.key}" ${prefs.always_approve.includes(t.key) ? 'checked' : ''} />
            </div>
            <div style="text-align:center;">
              <input type="checkbox" name="always_auto" value="${t.key}" ${prefs.always_auto.includes(t.key) ? 'checked' : ''} />
            </div>
          `)}
        </div>
      </div>

      <!-- Communication -->
      <div class="card">
        <h3>Communication</h3>
        <div class="form-group">
          <label for="detail_level">Action Detail Level</label>
          <select name="detail_level" id="detail_level">
            <option value="brief" ${prefs.detail_level === 'brief' ? 'selected' : ''}>Brief — just the action and result</option>
            <option value="standard" ${prefs.detail_level === 'standard' ? 'selected' : ''}>Standard — action, reasoning, and next step</option>
            <option value="detailed" ${prefs.detail_level === 'detailed' ? 'selected' : ''}>Detailed — full context, data used, alternatives considered</option>
          </select>
        </div>
        <div style="display:flex;gap:2rem;margin-bottom:1rem;">
          <label style="display:flex;align-items:center;gap:0.5rem;font-size:var(--text-sm);cursor:pointer;">
            <input type="checkbox" name="show_reasoning" ${prefs.show_reasoning ? 'checked' : ''} /> Show Foundry's reasoning
          </label>
          <label style="display:flex;align-items:center;gap:0.5rem;font-size:var(--text-sm);cursor:pointer;">
            <input type="checkbox" name="email_daily_summary" ${prefs.email_daily_summary ? 'checked' : ''} /> Email daily action summary
          </label>
        </div>
        <div class="form-group">
          <label for="min_notification_priority">Minimum notification priority (0-100)</label>
          <input type="number" name="min_notification_priority" id="min_notification_priority" value="${prefs.min_notification_priority}" min="0" max="100" />
          <p style="font-size:var(--text-xs);color:var(--color-text-faint);">Actions below this priority won't create notifications. 0 = notify for everything.</p>
        </div>
      </div>

      <button type="submit" class="btn btn-primary" style="margin-top:0.5rem;">Save Autopilot Settings</button>
    </form>
  `;

  return c.html(dashboardLayout(ctx, content));
});

autopilotRoutes.post('/settings/autopilot', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'settings', 'Autopilot Settings', undefined, c);
  const productId = ctx.productId;
  if (!productId) return c.redirect('/dashboard');

  const raw = await c.req.parseBody() as Record<string, string | string[]>;

  // Parse focus areas
  const focus: Record<string, number> = {};
  for (const key of ['churn_prevention', 'revenue_growth', 'competitive_awareness', 'product_quality', 'operational_health', 'wisdom_building']) {
    focus[key] = parseInt(raw[`focus_${key}`] as string ?? '5', 10);
  }

  // Parse checkbox arrays
  const toArray = (v: string | string[] | undefined): string[] => {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    return [v];
  };

  await saveAutopilotPreferences(productId, {
    focus: focus as any,
    detail_level: (raw.detail_level as 'brief' | 'standard' | 'detailed') ?? 'standard',
    show_reasoning: raw.show_reasoning === 'on',
    always_approve: toArray(raw.always_approve),
    always_auto: toArray(raw.always_auto),
    email_daily_summary: raw.email_daily_summary === 'on',
    min_notification_priority: parseInt(raw.min_notification_priority as string ?? '20', 10),
  });

  return c.redirect('/settings/autopilot?saved=1');
});
