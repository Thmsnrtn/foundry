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
