// =============================================================================
// FOUNDRY — Feedback API (Wave 2 follow-up)
// In-product NPS prompt POST handler. Returns a small thank-you HTML
// fragment on success so HTMX can swap the form out of the dashboard.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { submitNps } from '../../services/founder/feedback.js';

export const feedbackRoutes = new Hono<AuthEnv>();

feedbackRoutes.post('/api/feedback/nps', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.parseBody();
  const scoreRaw = body.score as string | undefined;
  const productId = (body.product_id as string | undefined) ?? null;

  const score = Number(scoreRaw);
  if (!Number.isFinite(score)) {
    return c.html(
      html`<div class="card" style="margin-bottom:1.5rem;padding:1rem 1.25rem;color:var(--warning, #ffb347);">
        Couldn't read that score — try again.
      </div>`,
      400
    );
  }

  await submitNps(founder.id, productId, score).catch(() => {});

  // Thank-you fragment that replaces the form via HTMX outerHTML swap.
  return c.html(html`
    <div class="card" style="margin-bottom:1.5rem;padding:1rem 1.25rem;background:rgba(78,204,163,0.05);border:1px solid rgba(78,204,163,0.2);">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--accent);margin-bottom:0.5rem;">Thanks</div>
      <p style="margin:0;font-size:0.88rem;color:var(--text-dim);line-height:1.55;">
        Got it. I read every response personally — if you have a minute, hit reply on the welcome email and tell me what's working or noisy.
      </p>
    </div>
  `);
});
