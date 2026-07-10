// =============================================================================
// FOUNDRY — The Letter (Ascent B7 / Attention Law)
// One page. What ran without you, the one thing that needs you, what was
// learned, how trust moved. When it's quiet, it says so and lets you leave.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import { composeLetter } from '../../services/letter/composer.js';
import {
  getAllPolicies, setPolicy, panicStop, getShadowStats,
  MODE_LABELS, PROMOTION_THRESHOLD, type AutopilotMode,
} from '../../services/autopilot/policy.js';

export const letterRoutes = new Hono<AuthEnv>();

const section = (label: string, items: string[]) => items.length === 0 ? '' : html`
  <div class="card" style="padding:1.25rem;margin-bottom:1rem;">
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.6rem;">${label}</div>
    ${items.map((i) => html`<div style="font-size:0.9rem;color:var(--text-primary);padding:0.35rem 0;border-top:1px solid rgba(255,255,255,0.05);">${i}</div>`)}
  </div>`;

letterRoutes.get('/letter', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'letter', 'The Letter', undefined, c);
  if (!ctx.productId) return c.redirect('/dashboard');

  const letter = await composeLetter(ctx.productId);

  const content = html`
    <h1 style="margin-bottom:0.25rem;">The Letter</h1>
    <p style="color:var(--text-dim);font-size:0.85rem;margin-bottom:1.5rem;">${new Date().toDateString()} — from your team.</p>

    ${letter.quiet ? html`
      <div class="card" style="padding:1.5rem;text-align:center;">
        <div style="font-size:1rem;color:var(--text-primary);">Quiet day. Nothing needs you.</div>
        <div style="font-size:0.82rem;color:var(--text-muted);margin-top:0.4rem;">That's the goal. Go build — or rest.</div>
      </div>` : html`
      ${letter.needsYou ? html`
      <div class="card" style="padding:1.25rem;margin-bottom:1rem;border:1px solid var(--accent);">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--accent);margin-bottom:0.4rem;">The one thing that needs you</div>
        <div style="font-size:0.95rem;color:var(--text-primary);">${letter.needsYou}</div>
        <a href="/decisions" class="btn btn-primary" style="margin-top:0.75rem;font-size:0.82rem;display:inline-block;">Decide</a>
      </div>` : ''}
      ${section('What I handled', letter.handled)}
      ${section('What I learned', letter.learned)}
      ${section('How trust moved', letter.trust)}
    `}
  `;
  return c.html(dashboardLayout(ctx, content));
});

// ─── Controls (Ascent B6 / Trust Law) — the autopilot's cockpit ───────────────
// Per-category dials in plain language, the evidence behind each level, and the
// big red button. Granting 'act' is the founder's explicit consent moment.

letterRoutes.get('/autopilot', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'autopilot', 'Controls', undefined, c);
  if (!ctx.productId) return c.redirect('/dashboard');

  const [policies, shadow] = await Promise.all([
    getAllPolicies(ctx.productId),
    getShadowStats(ctx.productId),
  ]);
  const shadowByCat = new Map(shadow.map((s) => [s.category, s]));

  const rows = policies.map((p) => {
    const s = shadowByCat.get(p.category);
    const agreement = s?.agreementRate != null ? `${Math.round(s.agreementRate * 100)}% agreement (${s.agreed}/${s.sampled})` : 'not enough shadow data yet';
    return html`
      <div class="card" style="padding:1rem 1.25rem;margin-bottom:0.75rem;">
        <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">
          <div style="flex:1;min-width:180px;">
            <div style="font-weight:600;color:var(--text-primary);text-transform:capitalize;">${p.category}</div>
            <div style="font-size:0.8rem;color:var(--accent);">${MODE_LABELS[p.mode as AutopilotMode]}</div>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.25rem;">
              Shadow record: ${agreement} · ${p.clean_cycles}/${PROMOTION_THRESHOLD} clean cycles banked
              ${p.last_demotion_reason ? html`<br/>Last pulled back: ${p.last_demotion_reason}` : ''}
            </div>
          </div>
          <div style="display:flex;gap:0.4rem;flex-shrink:0;">
            ${p.mode !== 'act' ? html`
            <form method="POST" action="/autopilot/policy">
              <input type="hidden" name="category" value="${p.category}" />
              <input type="hidden" name="mode" value="${p.mode === 'shadow' ? 'suggest' : 'act'}" />
              <button type="submit" class="btn btn-secondary" style="font-size:0.78rem;padding:0.3rem 0.75rem;">
                Grant ${p.mode === 'shadow' ? 'suggest' : 'act'}
              </button>
            </form>` : ''}
            ${p.mode !== 'shadow' ? html`
            <form method="POST" action="/autopilot/policy">
              <input type="hidden" name="category" value="${p.category}" />
              <input type="hidden" name="mode" value="shadow" />
              <button type="submit" class="btn btn-ghost" style="font-size:0.78rem;padding:0.3rem 0.75rem;">Pause</button>
            </form>` : ''}
          </div>
        </div>
      </div>`;
  });

  const content = html`
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:0.5rem;flex-wrap:wrap;gap:0.5rem;">
      <h1 style="margin:0;">Controls</h1>
      <form method="POST" action="/autopilot/panic"
        onsubmit="return confirm('Stop the autopilot everywhere? All categories return to Watching only. Trust records are kept.')">
        <button type="submit" class="btn" style="font-size:0.8rem;background:#c0392b;color:#fff;border:none;padding:0.45rem 1rem;border-radius:6px;">■ Stop the autopilot</button>
      </form>
    </div>
    <p style="color:var(--text-dim);font-size:0.85rem;margin-bottom:1.5rem;">
      Autonomy is earned, never assumed. Foundry watches first, suggests when its record supports it,
      and acts only on low-stakes decisions in categories you explicitly grant — always undoable, always logged.
      An undo pulls that category back automatically.
    </p>
    ${policies.length === 0 ? html`
      <div class="card" style="padding:1.25rem;color:var(--text-muted);">No decision categories yet — the ladder starts with your first decision.</div>
    ` : rows}
    <p style="font-size:0.72rem;color:var(--text-muted);margin-top:1rem;">
      Ladder: Watching only → Suggests (earned at ${PROMOTION_THRESHOLD} clean cycles, quality-held) → Acts (your explicit grant, gate-≤1 only, ${12}h grace, 24h undo).
    </p>`;
  return c.html(dashboardLayout(ctx, content));
});

letterRoutes.post('/autopilot/policy', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'autopilot', 'Controls', undefined, c);
  if (!ctx.productId) return c.redirect('/dashboard');
  const body = await c.req.parseBody();
  const category = (body.category as string)?.trim();
  const mode = (body.mode as string)?.trim() as AutopilotMode;
  if (category && ['shadow', 'suggest', 'act'].includes(mode)) {
    await setPolicy(ctx.productId, category, mode, founder.id as string);
  }
  return c.redirect('/autopilot');
});

letterRoutes.post('/autopilot/panic', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'autopilot', 'Controls', undefined, c);
  if (!ctx.productId) return c.redirect('/dashboard');
  await panicStop(ctx.productId, founder.id as string);
  return c.redirect('/autopilot');
});
