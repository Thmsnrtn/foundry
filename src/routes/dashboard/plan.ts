// =============================================================================
// FOUNDRY — Weekly Operating Plan
// Every Monday: 3 prioritized actions that would move Signal the most.
// Founders check items off as they execute. Outcome feeds decision analytics.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { query } from '../../db/client.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';

export const planRoutes = new Hono<AuthEnv>();

// ─── ISO week helper ──────────────────────────────────────────────────────────

function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// ─── Plan Item Type ───────────────────────────────────────────────────────────

interface PlanItem {
  id: string;
  text: string;
  category: string;  // 'signal' | 'decision' | 'relationship' | 'product'
  impact: 'high' | 'medium' | 'low';
  done: boolean;
}

// ─── GET /plan ────────────────────────────────────────────────────────────────

planRoutes.get('/plan', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'plan', 'Weekly Plan', undefined, c);
  if (!ctx.productId) return c.redirect('/dashboard');

  const productId = ctx.productId;
  const week = isoWeek(new Date());

  const planResult = await query(
    `SELECT * FROM weekly_plans WHERE product_id = ? AND week_of = ?`,
    [productId, week],
  );

  // Last 4 weeks for history
  const historyResult = await query(
    `SELECT week_of, signal_at_generation, items_json, synthesis FROM weekly_plans
     WHERE product_id = ? AND week_of < ?
     ORDER BY week_of DESC LIMIT 4`,
    [productId, week],
  );

  const plan = planResult.rows.length > 0
    ? (planResult.rows[0] as Record<string, unknown>)
    : null;
  const items: PlanItem[] = plan ? JSON.parse(plan.items_json as string) : [];

  const impactColor = { high: '#4ecca3', medium: '#ffb347', low: '#7878a0' };
  const categoryIcon = {
    signal: '◎', decision: '→', relationship: '◯', product: '◈', default: '·',
  };

  const content = html`
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:0.5rem;">
      <h1 style="margin:0;">Weekly Plan</h1>
      <span class="plan-week-label">${week}</span>
    </div>

    ${!plan ? html`
    <div class="card" style="text-align:center;padding:3rem;">
      <div style="font-size:1.1rem;font-weight:600;color:var(--text);margin-bottom:0.75rem;">No plan yet for this week</div>
      <p style="font-size:0.87rem;color:var(--text-dim);max-width:340px;margin:0 auto 1.25rem;">
        Your Weekly Operating Plan is generated every Monday at 8:00 UTC.
        It prioritizes the 3 moves that would move Signal the most this week.
      </p>
      <form method="POST" action="/plan/generate">
        <button type="submit" class="btn btn-primary btn-sm">Generate now</button>
      </form>
    </div>` : html`

    ${plan.synthesis ? html`
    <div class="plan-synthesis">${plan.synthesis as string}</div>` : ''}

    <div class="plan-items">
      ${items.map((item, idx) => html`
      <div class="plan-item ${item.done ? 'plan-item-done' : ''}" id="plan-item-${item.id}">
        <button
          class="plan-check ${item.done ? 'plan-check-done' : ''}"
          onclick="togglePlanItem('${item.id}', ${item.done ? 'false' : 'true'})"
          aria-label="${item.done ? 'Mark incomplete' : 'Mark complete'}"
        >
          ${item.done ? html`<svg viewBox="0 0 16 16" fill="currentColor"><path d="M13.5 3.5L6 11 2.5 7.5l-1 1L6 13l8.5-8.5z"/></svg>` : ''}
        </button>
        <div class="plan-item-body">
          <span class="plan-category-icon" title="${item.category}">${(categoryIcon as Record<string, string>)[item.category] ?? categoryIcon.default}</span>
          <span class="plan-item-text">${item.text}</span>
          <span class="plan-impact" style="color:${(impactColor as Record<string, string>)[item.impact] ?? '#7878a0'}">${item.impact}</span>
        </div>
      </div>`)}
    </div>

    <div class="plan-meta">
      Generated at Signal ${plan.signal_at_generation ?? '—'} &middot; week of ${week}
    </div>`}

    ${historyResult.rows.length > 0 ? html`
    <div class="card plan-history">
      <div class="plan-history-label">Previous weeks</div>
      ${historyResult.rows.map((w) => {
        const pw = w as Record<string, unknown>;
        const prevItems: PlanItem[] = JSON.parse(pw.items_json as string);
        const doneCount = prevItems.filter((i) => i.done).length;
        return html`
        <div class="plan-history-row">
          <span class="plan-history-week">${pw.week_of as string}</span>
          <span class="plan-history-score">Signal ${pw.signal_at_generation ?? '—'}</span>
          <span class="plan-history-done">${doneCount}/${prevItems.length} done</span>
        </div>`;
      })}
    </div>` : ''}

    <script>
    window.togglePlanItem = async function(itemId, done) {
      try {
        await fetch('/plan/item/' + itemId, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ done }),
        });
        const el = document.getElementById('plan-item-' + itemId);
        if (done === true || done === 'true') el.classList.add('plan-item-done');
        else el.classList.remove('plan-item-done');
      } catch {}
    };
    </script>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /plan/generate — on-demand generation ───────────────────────────────

import { nanoid } from 'nanoid';
import { callOpus, parseJSONResponse } from '../../services/ai/client.js';
import { computeSignal } from '../../services/signal.js';
import { getActiveStressors, getLatestMetrics } from '../../db/client.js';

planRoutes.post('/plan/generate', async (c) => {
  const founder = c.get('founder');
  const products = await query('SELECT id, name FROM products WHERE owner_id = ? LIMIT 1', [founder.id]);
  if (products.rows.length === 0) return c.redirect('/plan');

  const p = products.rows[0] as Record<string, string>;
  const week = isoWeek(new Date());

  // Idempotent
  const existing = await query('SELECT id FROM weekly_plans WHERE product_id = ? AND week_of = ?', [p.id, week]);
  if (existing.rows.length > 0) return c.redirect('/plan');

  try {
    const [signal, stressors, metrics, lifecycle, pendingResult] = await Promise.all([
      computeSignal(p.id),
      getActiveStressors(p.id),
      getLatestMetrics(p.id),
      query('SELECT current_prompt, risk_state FROM lifecycle_state WHERE product_id = ?', [p.id]),
      query("SELECT COUNT(*) as c FROM decisions WHERE product_id = ? AND status = 'pending'", [p.id]),
    ]);

    const ls = (lifecycle.rows[0] ?? {}) as Record<string, string>;
    const m = (metrics.rows[0] ?? {}) as Record<string, unknown>;
    const stressorList = (stressors.rows as Array<Record<string, string>>)
      .map((s) => `${s.title} (${s.severity})`).slice(0, 5).join('; ') || 'none';
    const pendingCount = (pendingResult.rows[0] as Record<string, number>)?.c ?? 0;

    const prompt = `Signal score: ${signal.score} (${signal.tier} tier)
Risk state: ${signal.riskState}
Stage: ${ls.current_prompt ?? 'unknown'}
Active stressors: ${stressorList}
Pending decisions: ${pendingCount}
Signal components: stressors −${signal.components.stressorPenalty}, MRR health −${signal.components.mrrPenalty}, backlog −${signal.components.backlogPenalty}, lifecycle +${signal.components.lifecycleBonus}
Activation rate: ${m.activation_rate != null ? ((m.activation_rate as number) * 100).toFixed(1) + '%' : 'unknown'}
Churn rate: ${m.churn_rate != null ? ((m.churn_rate as number) * 100).toFixed(1) + '%' : 'unknown'}

Generate exactly 3 prioritized actions for this week that would move Signal the most.
Each action must be specific, concrete, and executable in one week. No generic advice.
Order by impact (highest first).

Return JSON only:
{
  "synthesis": "1-2 sentence framing of this week's strategic context",
  "items": [
    { "id": "1", "text": "Specific action", "category": "signal|decision|relationship|product", "impact": "high|medium|low" }
  ]
}`;

    const raw = await callOpus('You are Foundry. Generate a weekly operating plan for a founder.', prompt, 600);
    const plan = parseJSONResponse<{ synthesis: string; items: Array<{ id: string; text: string; category: string; impact: string }> }>(raw.content);

    if (plan?.items) {
      const items: PlanItem[] = plan.items.map((item) => ({ ...item, done: false, impact: item.impact as 'high' | 'medium' | 'low' }));
      await query(
        `INSERT INTO weekly_plans (id, product_id, week_of, signal_at_generation, items_json, synthesis)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(product_id, week_of) DO NOTHING`,
        [nanoid(), p.id, week, signal.score, JSON.stringify(items), plan.synthesis ?? null],
      );
    }
  } catch (err) {
    console.error('[plan] generation error:', err);
  }

  return c.redirect('/plan');
});

// ─── PATCH /plan/item/:id — toggle done ───────────────────────────────────────

planRoutes.patch('/plan/item/:id', async (c) => {
  const founder = c.get('founder');
  const itemId = c.req.param('id');
  const body = await c.req.json() as { done: boolean };
  const week = isoWeek(new Date());

  const planResult = await query(
    `SELECT wp.id, wp.items_json FROM weekly_plans wp
     JOIN products p ON wp.product_id = p.id
     WHERE p.owner_id = ? AND wp.week_of = ?`,
    [founder.id, week],
  );

  if (planResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const plan = planResult.rows[0] as Record<string, string>;
  const items: PlanItem[] = JSON.parse(plan.items_json);
  const item = items.find((i) => i.id === itemId);
  if (!item) return c.json({ error: 'Item not found' }, 404);
  item.done = body.done;

  await query('UPDATE weekly_plans SET items_json = ? WHERE id = ?', [JSON.stringify(items), plan.id]);
  return c.json({ status: 'ok' });
});
