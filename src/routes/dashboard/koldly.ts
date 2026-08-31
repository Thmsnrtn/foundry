import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
export const koldlyRoutes = new Hono<AuthEnv>();

koldlyRoutes.get('/koldly', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'koldly', 'Koldly Integration', undefined, c);
  const ecosystemKey = process.env.ECOSYSTEM_SERVICE_KEY ? 'Configured' : 'Not configured';
  const koldlyUrl = process.env.KOLDLY_INTERNAL_API_URL ?? 'Not configured';

  // The company the switcher has selected, which is the one the sidebar and
  // the header on this page are already showing. This used to run its own
  // `WHERE owner_id = ?` and take row zero, so the DNA link could point at a
  // different company from the one the page said it was about.
  const productId = ctx.productId;

  const content = html`
    <h1>Koldly Integration</h1>

    <div class="card">
      <h3>Connection Status</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
        <div>
          <p style="font-size:0.8rem;color:#6b7280;margin-bottom:0.25rem;">Ecosystem Key</p>
          <p style="font-weight:600;color:${ecosystemKey === 'Configured' ? '#059669' : '#dc2626'};">${ecosystemKey}</p>
        </div>
        <div>
          <p style="font-size:0.8rem;color:#6b7280;margin-bottom:0.25rem;">Koldly API URL</p>
          <!-- "Connected" was the word for "an environment variable is set".
               Nothing here has called Koldly. -->
          <p style="font-weight:600;color:${koldlyUrl !== 'Not configured' ? '#059669' : '#dc2626'};">${koldlyUrl !== 'Not configured' ? 'Configured (not tested)' : 'Not configured'}</p>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>ICP Configuration</h3>
      <p style="font-size:0.87rem;color:#6b7280;margin-bottom:0.5rem;">
        Your Ideal Customer Profile lives in your company's DNA — the audience,
        the pain, the trigger, the positioning — where every agent reads it.
        ${productId ? html`<a href="/products/${productId}/dna">Edit it there</a>.` : 'Complete onboarding first.'}
      </p>
      <p style="font-size:0.8rem;color:#6b7280;">
        THIS PAGE USED TO HOLD A SECOND ICP FORM. It saved into
        <code>products.stack_description</code> — overwriting the stack
        description that field is for, and that four prompts read — and nothing
        anywhere read what it wrote. <code>GET /internal/icp</code>, the endpoint
        the copy said Koldly targets campaigns from, returns a fixed profile
        written into the source; it does not take a company and never read this
        form.
      </p>
    </div>

    <div class="card">
      <h3>API Endpoints</h3>
      <p style="font-size:0.87rem;color:#6b7280;margin-bottom:1rem;">
        These endpoints are available for ecosystem integration. The key travels
        in the <code>X-Ecosystem-Key</code> header, and the two that touch a
        company resolve it to a principal and check that company is in its
        scope — so until the owner issues one, they serve nobody.
      </p>
      <div style="font-size:0.87rem;">
        <div style="padding:0.5rem 0;border-bottom:1px solid #f3f4f6;"><code>GET /internal/health</code> — Health check (no auth required)</div>
        <div style="padding:0.5rem 0;border-bottom:1px solid #f3f4f6;"><code>GET /internal/icp</code> — a FIXED profile, written into the source. It takes no company and reads nothing this founder has entered.</div>
        <div style="padding:0.5rem 0;border-bottom:1px solid #f3f4f6;"><code>POST /internal/conversion-signal</code> — report a conversion event against a named company. Requires a principal scoped to that company.</div>
        <div style="padding:0.5rem 0;"><code>POST /internal/campaign/receive</code> — receive campaign data for a named company. Requires a principal scoped to that company.</div>
      </div>
    </div>
  `;
  return c.html(dashboardLayout(ctx, content));
});
