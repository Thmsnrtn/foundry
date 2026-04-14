import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { query, getProductByOwner } from '../../db/client.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import { validate } from '../../lib/validation.js';
import { z } from 'zod';

const icpSchema = z.object({
  product_id: z.string().min(1),
  target_role: z.string().min(1).max(200),
  target_industry: z.string().min(1).max(200),
  company_size: z.string().min(1).max(100),
  pain_points: z.array(z.string().max(500)).max(10),
  qualifying_signals: z.array(z.string().max(500)).max(10),
});

export const koldlyRoutes = new Hono<AuthEnv>();

koldlyRoutes.get('/koldly', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'koldly', 'Koldly Integration', undefined, c);
  const ecosystemKey = process.env.ECOSYSTEM_SERVICE_KEY ? 'Configured' : 'Not configured';
  const koldlyUrl = process.env.KOLDLY_INTERNAL_API_URL ?? 'Not configured';

  const products = await query('SELECT id, name, stack_description FROM products WHERE owner_id = ?', [founder.id]);
  const productId = products.rows.length > 0 ? (products.rows[0] as Record<string, string>).id : null;
  const existingIcp = productId
    ? await query('SELECT stack_description FROM products WHERE id = ?', [productId])
    : null;
  let icpData = null;
  try {
    const desc = (existingIcp?.rows[0] as Record<string, string>)?.stack_description;
    if (desc) icpData = JSON.parse(desc)?.icp;
  } catch { /* no existing ICP */ }

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
          <p style="font-weight:600;color:${koldlyUrl !== 'Not configured' ? '#059669' : '#dc2626'};">${koldlyUrl !== 'Not configured' ? 'Connected' : 'Not configured'}</p>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>ICP Configuration</h3>
      <p style="font-size:0.87rem;color:#6b7280;margin-bottom:1rem;">Define your Ideal Customer Profile. Koldly uses this to target outbound campaigns.</p>
      ${productId ? html`
        <form method="POST" action="/koldly/icp" id="icp-form">
          <input type="hidden" name="product_id" value="${productId}" />
          <div class="form-group">
            <label for="target_role">Target Role</label>
            <input type="text" name="target_role" id="target_role" value="${icpData?.target_role ?? ''}" placeholder="e.g., Technical Founder, CTO" required />
          </div>
          <div class="form-group">
            <label for="target_industry">Target Industry</label>
            <input type="text" name="target_industry" id="target_industry" value="${icpData?.target_industry ?? ''}" placeholder="e.g., SaaS, Developer Tools" required />
          </div>
          <div class="form-group">
            <label for="company_size">Company Size</label>
            <input type="text" name="company_size" id="company_size" value="${icpData?.company_size ?? ''}" placeholder="e.g., 1-10, 10-50" required />
          </div>
          <div class="form-group">
            <label for="pain_points">Pain Points (one per line)</label>
            <textarea name="pain_points" id="pain_points" rows="3" placeholder="No operational layer&#10;Building features but not the business">${(icpData?.pain_points ?? []).join('\n')}</textarea>
          </div>
          <div class="form-group">
            <label for="qualifying_signals">Qualifying Signals (one per line)</label>
            <textarea name="qualifying_signals" id="qualifying_signals" rows="3" placeholder="Active GitHub repo&#10;Pre-launch SaaS">${(icpData?.qualifying_signals ?? []).join('\n')}</textarea>
          </div>
          <button type="submit" class="btn btn-primary">Save ICP</button>
        </form>
      ` : html`<p style="color:#d97706;">No product found. Complete onboarding first.</p>`}
    </div>

    <div class="card">
      <h3>API Endpoints</h3>
      <p style="font-size:0.87rem;color:#6b7280;margin-bottom:1rem;">These endpoints are available for ecosystem integration. Authenticate with the <code>X-Ecosystem-Key</code> header.</p>
      <div style="font-size:0.87rem;">
        <div style="padding:0.5rem 0;border-bottom:1px solid #f3f4f6;"><code>GET /internal/health</code> — Health check (no auth required)</div>
        <div style="padding:0.5rem 0;border-bottom:1px solid #f3f4f6;"><code>GET /internal/icp</code> — Get ICP configuration for Koldly targeting</div>
        <div style="padding:0.5rem 0;border-bottom:1px solid #f3f4f6;"><code>POST /internal/conversion-signal</code> — Report conversion events from Koldly campaigns</div>
        <div style="padding:0.5rem 0;"><code>POST /internal/campaign/receive</code> — Receive campaign data from Koldly</div>
      </div>
    </div>
  `;
  return c.html(dashboardLayout(ctx, content));
});

koldlyRoutes.post('/koldly/icp', async (c) => {
  const founder = c.get('founder');
  const rawBody = await c.req.parseBody() as Record<string, string>;
  const body = validate(icpSchema, {
    product_id: rawBody.product_id,
    target_role: rawBody.target_role,
    target_industry: rawBody.target_industry,
    company_size: rawBody.company_size,
    pain_points: (rawBody.pain_points ?? '').split('\n').map((s: string) => s.trim()).filter(Boolean),
    qualifying_signals: (rawBody.qualifying_signals ?? '').split('\n').map((s: string) => s.trim()).filter(Boolean),
  });
  const prodResult = await getProductByOwner(body.product_id, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  await query('UPDATE products SET stack_description = ? WHERE id = ?',
    [JSON.stringify({ icp: body }), body.product_id]);

  return c.redirect('/koldly?saved=1');
});
