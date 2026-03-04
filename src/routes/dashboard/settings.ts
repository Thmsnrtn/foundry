// =============================================================================
// FOUNDRY — Settings Route
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { query } from '../../db/client.js';
import { createCheckoutSession } from '../../services/billing/stripe.js';
import { dashboardLayout } from '../../views/layout.js';
import { settingsPage } from '../../views/components.js';
import { getLayoutContext } from './_shared.js';
import { getTierBadge, getTierCapabilities } from '../../middleware/tier-gate.js';
import { nanoid } from 'nanoid';

export const settingsRoutes = new Hono<AuthEnv>();

settingsRoutes.get('/settings', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'settings', 'Settings');

  const products = await query('SELECT id, name, github_repo_url, share_token, ingest_token FROM products WHERE owner_id = ?', [founder.id]);
  const firstProduct = products.rows.length > 0 ? (products.rows[0] as Record<string, string>) : null;
  const productId = firstProduct?.id ?? null;
  const shareToken = firstProduct?.share_token ?? null;
  const ingestToken = firstProduct?.ingest_token ?? null;
  const comps = productId
    ? await query('SELECT * FROM competitors WHERE product_id = ?', [productId])
    : { rows: [] };

  // Get current wisdom opt-in state
  const wisdomResult = await query(
    'SELECT wisdom_network_opted_in FROM founders WHERE id = ?',
    [founder.id]
  );
  const wisdomOptIn = ((wisdomResult.rows[0] as Record<string, unknown>)?.wisdom_network_opted_in ?? 1) === 1;
  const appUrl = process.env.APP_URL ?? 'http://localhost:8080';

  const tierLabel = getTierBadge(founder.tier);
  const capabilities = getTierCapabilities(founder.tier);

  const content = html`
    <h1>Settings</h1>
    ${settingsPage(
      { id: founder.id, email: founder.email, name: founder.name, tier: founder.tier },
      products.rows as Array<Record<string, unknown>>,
      comps.rows as Array<Record<string, unknown>>,
    )}
    <div class="card">
      <h3>Subscription</h3>
      <p><strong>Current Plan:</strong> <span class="tier-badge">${tierLabel}</span></p>
      <p style="font-size:0.87rem;color:var(--text-muted);">You have access to ${capabilities.length} features.</p>
      ${founder.tier !== 'scale' && founder.tier !== 'founding_cohort' ? html`<a href="/settings" class="btn btn-primary btn-sm" style="margin-top:0.5rem;">Upgrade to Scale</a>` : ''}
    </div>

    <div class="card">
      <h3>Wisdom Network</h3>
      <p style="font-size:0.87rem;color:var(--text-muted);margin-bottom:1rem;">
        When enabled, Foundry contributes anonymized decision patterns from your business to
        the cross-product wisdom layer. No identifying information, revenue figures, or product
        names are ever shared — only aggregated shapes and outcomes. In return, your AI
        recommendations benefit from patterns across all contributing businesses.
      </p>
      <div class="wisdom-toggle-row">
        <div>
          <div class="wisdom-toggle-label">Contribute anonymously</div>
          <div class="wisdom-toggle-desc">Share decision outcomes to improve AI for everyone</div>
        </div>
        <form method="POST" action="/settings/wisdom-toggle" style="display:flex;align-items:center;">
          <label class="toggle" title="${wisdomOptIn ? 'Click to opt out' : 'Click to opt in'}">
            <input
              type="checkbox"
              name="opted_in"
              value="1"
              ${wisdomOptIn ? 'checked' : ''}
              onchange="this.closest('form').submit()"
            />
            <span class="toggle-track"></span>
            <span class="toggle-thumb"></span>
          </label>
        </form>
      </div>
    </div>

    ${productId ? html`
    <div class="card">
      <h3>Investor / Advisor Access</h3>
      <p style="font-size:0.87rem;color:var(--text-muted);margin-bottom:1rem;">
        Generate a private link to share a live read-only view of your Signal score,
        metrics, and recent decisions with investors or advisors. No login required.
        Revoke it at any time by regenerating.
      </p>
      ${shareToken ? html`
      <div style="margin-bottom:0.75rem;">
        <div style="font-size:0.8rem;color:var(--text-dim);margin-bottom:0.35rem;">Your share link</div>
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <input
            type="text"
            id="share-link-input"
            value="${appUrl}/share/${shareToken}"
            readonly
            style="flex:1;font-size:0.82rem;font-family:monospace;cursor:pointer;"
            onclick="this.select()"
          />
          <button
            class="btn btn-secondary btn-sm"
            onclick="navigator.clipboard.writeText(document.getElementById('share-link-input').value).then(()=>{this.textContent='Copied!';setTimeout(()=>{this.textContent='Copy'},1500)})"
          >Copy</button>
        </div>
      </div>
      <form method="POST" action="/settings/generate-share" style="display:inline;">
        <button type="submit" class="btn btn-ghost btn-sm">Regenerate link</button>
      </form>
      ` : html`
      <form method="POST" action="/settings/generate-share">
        <button type="submit" class="btn btn-secondary btn-sm">Generate share link</button>
      </form>`}
    </div>` : ''}

    ${productId ? html`
    <div class="card">
      <h3>Metric Ingest</h3>
      <p style="font-size:0.87rem;color:var(--text-muted);margin-bottom:1rem;">
        A secret URL your tools can POST to — Stripe webhooks, Zapier, cron jobs, or your own pipeline.
        Foundry maps the fields to your metrics and recomputes Signal automatically.
        No login required; the URL is the secret.
      </p>
      ${ingestToken ? html`
      <div style="margin-bottom:0.75rem;">
        <div style="font-size:0.8rem;color:var(--text-dim);margin-bottom:0.35rem;">Ingest endpoint</div>
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <input
            type="text"
            id="ingest-url-input"
            value="${appUrl}/ingest/${ingestToken}"
            readonly
            style="flex:1;font-size:0.78rem;font-family:monospace;cursor:pointer;"
            onclick="this.select()"
          />
          <button
            class="btn btn-secondary btn-sm"
            onclick="navigator.clipboard.writeText(document.getElementById('ingest-url-input').value).then(()=>{this.textContent='Copied!';setTimeout(()=>{this.textContent='Copy'},1500)})"
          >Copy</button>
        </div>
      </div>
      <details style="margin-bottom:0.75rem;">
        <summary style="font-size:0.82rem;color:var(--text-dim);cursor:pointer;">Example payload</summary>
        <pre class="ingest-example">{
  "new_mrr": 4500,
  "churned_mrr": 200,
  "activation_rate": 0.34,
  "day_30_retention": 0.68,
  "churn_rate": 0.02,
  "nps_score": 42,
  "active_users": 87,
  "signups_7d": 23
}</pre>
        <p style="font-size:0.78rem;color:var(--text-dim);margin:0.35rem 0 0;">MRR values in dollars. Rates as decimals (0.34 = 34%).</p>
      </details>
      <form method="POST" action="/settings/generate-ingest" style="display:inline;">
        <button type="submit" class="btn btn-ghost btn-sm">Regenerate token</button>
      </form>
      ` : html`
      <form method="POST" action="/settings/generate-ingest">
        <button type="submit" class="btn btn-secondary btn-sm">Generate ingest URL</button>
      </form>`}
    </div>` : ''}
  `;
  return c.html(dashboardLayout(ctx, content));
});

// ─── Share Token Generation ───────────────────────────────────────────────────

settingsRoutes.post('/settings/generate-share', async (c) => {
  const founder = c.get('founder');
  const products = await query('SELECT id FROM products WHERE owner_id = ? LIMIT 1', [founder.id]);
  if (products.rows.length === 0) return c.redirect('/settings');

  const productId = (products.rows[0] as Record<string, string>).id;
  const token = nanoid(32);

  await query('UPDATE products SET share_token = ? WHERE id = ? AND owner_id = ?', [token, productId, founder.id]);
  return c.redirect('/settings');
});

// ─── Ingest Token Generation ──────────────────────────────────────────────────

settingsRoutes.post('/settings/generate-ingest', async (c) => {
  const founder = c.get('founder');
  const products = await query('SELECT id FROM products WHERE owner_id = ? LIMIT 1', [founder.id]);
  if (products.rows.length === 0) return c.redirect('/settings');

  const productId = (products.rows[0] as Record<string, string>).id;
  const token = nanoid(32);

  await query('UPDATE products SET ingest_token = ? WHERE id = ? AND owner_id = ?', [token, productId, founder.id]);
  return c.redirect('/settings');
});

// ─── Wisdom Toggle ────────────────────────────────────────────────────────────

settingsRoutes.post('/settings/wisdom-toggle', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.parseBody() as Record<string, string>;
  const optedIn = body.opted_in === '1' ? 1 : 0;

  await query(
    'UPDATE founders SET wisdom_network_opted_in = ? WHERE id = ?',
    [optedIn, founder.id]
  );

  return c.redirect('/settings');
});
