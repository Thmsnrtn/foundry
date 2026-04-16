// =============================================================================
// FOUNDRY — Portfolio View
// Shown when a founder has 2+ products. Each product shows its Signal.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { getProductsByOwner } from '../../db/client.js';
import { computeSignal } from '../../services/signal.js';
import { layout } from '../../views/layout.js';

export const portfolioRoutes = new Hono<AuthEnv>();

portfolioRoutes.get('/portfolio', async (c) => {
  const founder = c.get('founder');
  const products = await getProductsByOwner(founder.id);

  if (products.rows.length === 0) return c.redirect('/onboarding');
  if (products.rows.length === 1) {
    // Single product: go directly to dashboard
    return c.redirect('/dashboard');
  }

  const founderName = founder.name ?? founder.email;

  // Compute Signals for all products in parallel
  const productRows = products.rows as Array<Record<string, unknown>>;
  const signals = await Promise.all(
    productRows.map((p) => computeSignal(p.id as string))
  );

  // Sort: lowest Signal first (most urgent at top)
  const sorted = productRows
    .map((p, i) => ({ product: p, signal: signals[i] }))
    .sort((a, b) => a.signal.score - b.signal.score);

  const content = html`
    <div class="portfolio-header">
      <h1>YOUR BUSINESSES</h1>
    </div>
    <div class="portfolio-grid">
      ${sorted.map(({ product, signal }) => html`
      <form method="POST" action="/switch-product" style="display:contents;">
        <input type="hidden" name="product_id" value="${product.id as string}" />
        <button type="submit" class="portfolio-card tier-${signal.tier}">
          <div class="portfolio-signal-number">${signal.score}</div>
          <div class="portfolio-product-name">${product.name as string}</div>
          <div class="portfolio-product-status">${signal.prose.split('.')[0]}.</div>
        </button>
      </form>`)}
    </div>
  `;

  return c.html(layout(
    {
      title: 'Portfolio',
      founderName,
      showNav: false,
    },
    content
  ));
});
