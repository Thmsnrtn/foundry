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

export const settingsRoutes = new Hono<AuthEnv>();

settingsRoutes.get('/settings', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'settings', 'Settings');

  const products = await query('SELECT id, name, github_repo_url FROM products WHERE owner_id = ?', [founder.id]);
  const productId = products.rows.length > 0 ? (products.rows[0] as Record<string, string>).id : null;
  const comps = productId
    ? await query('SELECT * FROM competitors WHERE product_id = ?', [productId])
    : { rows: [] };

  // Get current wisdom opt-in state
  const wisdomResult = await query(
    'SELECT wisdom_network_opted_in FROM founders WHERE id = ?',
    [founder.id]
  );
  const wisdomOptIn = ((wisdomResult.rows[0] as Record<string, unknown>)?.wisdom_network_opted_in ?? 1) === 1;

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
  `;
  return c.html(dashboardLayout(ctx, content));
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
