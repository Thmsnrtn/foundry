// =============================================================================
// FOUNDRY — Operator Dashboard (home screen)
// The Signal: one number, three sentences, one query bar.
// =============================================================================

import { Hono } from 'hono';
import { html, raw } from 'hono/html';
import { setCookie, getCookie } from 'hono/cookie';
import type { AuthEnv } from '../../middleware/auth.js';
import { getProductsByOwner, getProductByOwner, getActiveStressors } from '../../db/client.js';
import { computeSignal, getSignalHistory } from '../../services/signal.js';
import { dashboardLayout } from '../../views/layout.js';
import { stressorReport, milestoneToastScript, type StressorData } from '../../views/components.js';
import { getLayoutContext } from './_shared.js';

export const dashboardRoutes = new Hono<AuthEnv>();

// ─── Sparkline ────────────────────────────────────────────────────────────────

function sparklineSVG(history: Array<{ score: number }>, width = 120, height = 28) {
  if (history.length < 2) return raw('');
  const pts = history
    .map((h, i) => {
      const x = (i / (history.length - 1)) * width;
      const y = 2 + ((100 - h.score) / 100) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return raw(
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="signal-sparkline" aria-hidden="true">` +
    `<polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`,
  );
}

// ─── Product Switcher ────────────────────────────────────────────────────────

dashboardRoutes.post('/switch-product', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.parseBody() as Record<string, string>;
  const productId = body.product_id;

  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.redirect('/dashboard');

  setCookie(c, 'foundry_product', productId, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 365,
  });

  const referer = c.req.header('Referer');
  return c.redirect(referer ?? '/dashboard');
});

// ─── Dashboard ───────────────────────────────────────────────────────────────

dashboardRoutes.get('/dashboard', async (c) => {
  const founder = c.get('founder');
  const products = await getProductsByOwner(founder.id);

  if (products.rows.length === 0) {
    return c.redirect('/onboarding');
  }

  // If founder has multiple products and no active selection: show portfolio
  const cookieProductId = getCookie(c, 'foundry_product');
  if (products.rows.length > 1 && !cookieProductId) {
    return c.redirect('/portfolio');
  }

  const ctx = await getLayoutContext(founder, 'dashboard', 'Dashboard', undefined, c);
  const productId = ctx.productId!;

  const [signal, stressors, history] = await Promise.all([
    computeSignal(productId),
    getActiveStressors(productId),
    getSignalHistory(productId, 60),
  ]);

  const stressorRows = stressors.rows as unknown as StressorData[];
  const criticalCount = stressorRows.filter((s) => s.severity === 'critical').length;

  // Pending decisions count from ctx nav badges
  const pendingDecisions = ctx.ux.navBadges.decisions_count;

  const content = html`
    <div class="signal-home" data-product-id="${productId}">

      <div class="signal-display signal-${signal.tier}">
        <div class="signal-number">${signal.score}</div>
        <div class="signal-label">Signal</div>
        ${history.length >= 2 ? html`
        <div class="signal-sparkline-wrap">
          ${sparklineSVG(history)}
          <span class="signal-sparkline-label">${history.length}d trend</span>
        </div>` : ''}
      </div>

      <div class="signal-prose" id="signal-prose">
        ${signal.prose}
      </div>

      <div class="query-bar">
        <form class="query-form" id="query-form" onsubmit="handleQuery(event)">
          <input
            type="text"
            class="query-input"
            id="query-input"
            placeholder="Ask anything about your business…"
            autocomplete="off"
            spellcheck="false"
          />
        </form>
        <div class="query-response" id="query-response"></div>
      </div>

      ${pendingDecisions > 0 || criticalCount > 0 ? html`
      <div class="signal-actions">
        ${pendingDecisions > 0 ? html`
        <a href="/decisions" class="signal-action">
          <span class="signal-action-number">${pendingDecisions}</span>
          <span class="signal-action-label">${pendingDecisions === 1 ? 'decision' : 'decisions'} waiting</span>
        </a>` : ''}
        ${criticalCount > 0 ? html`
        <a href="#stressors" class="signal-action signal-action-urgent">
          <span class="signal-action-number">${criticalCount}</span>
          <span class="signal-action-label">critical ${criticalCount === 1 ? 'stressor' : 'stressors'}</span>
        </a>` : ''}
      </div>` : ''}

      ${stressorRows.length > 0 ? html`
      <div class="signal-stressors" id="stressors">
        ${stressorReport(stressorRows)}
      </div>` : ''}

    </div>

    ${milestoneToastScript(ctx.ux.unseenMilestones)}

    <script>
    (function() {
      const productId = document.querySelector('[data-product-id]').dataset.productId;
      const responseEl = document.getElementById('query-response');
      const proseEl = document.getElementById('signal-prose');
      let originalProse = null;

      window.handleQuery = async function(e) {
        e.preventDefault();
        const input = document.getElementById('query-input');
        const question = input.value.trim();
        if (!question) return;

        if (!originalProse) originalProse = proseEl.innerHTML;

        responseEl.className = 'query-response loading';
        responseEl.textContent = 'Thinking';

        try {
          const res = await fetch('/api/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ question, product_id: productId }),
          });

          if (!res.ok) throw new Error('Request failed');
          const data = await res.json();

          let html = '<p>' + data.answer + '</p>';
          if (data.data_points && data.data_points.length > 0) {
            html += '<div class="query-data-points">';
            data.data_points.forEach(function(dp) {
              html += '<span class="query-data-point">' + dp.label + ': ' + dp.value + '</span>';
            });
            html += '</div>';
          }
          html += '<button class="query-reset" onclick="resetQuery()">← Back to Signal</button>';

          responseEl.innerHTML = html;
          responseEl.className = 'query-response visible';
          input.value = '';

        } catch (err) {
          responseEl.className = 'query-response visible';
          responseEl.textContent = 'Something went wrong. Try again.';
        }
      };

      window.resetQuery = function() {
        responseEl.className = 'query-response';
        responseEl.innerHTML = '';
        if (originalProse) {
          proseEl.innerHTML = originalProse;
          originalProse = null;
        }
      };
    })();
    </script>
  `;

  return c.html(dashboardLayout(ctx, content));
});
