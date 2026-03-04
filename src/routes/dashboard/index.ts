// =============================================================================
// FOUNDRY — Operator Dashboard (home screen)
// The Signal: one number, three sentences, one query bar.
// =============================================================================

import { Hono } from 'hono';
import { html, raw } from 'hono/html';
import { setCookie, getCookie } from 'hono/cookie';
import type { AuthEnv } from '../../middleware/auth.js';
import { getProductsByOwner, getProductByOwner, getActiveStressors } from '../../db/client.js';
import { computeSignal, getSignalHistory, getDailyInsight, getPreviousSignalScore } from '../../services/signal.js';
import { dashboardLayout } from '../../views/layout.js';
import { stressorReport, milestoneToastScript, type StressorData } from '../../views/components.js';
import type { SignalComponents } from '../../services/signal.js';
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

// ─── Signal Anatomy Dialog ────────────────────────────────────────────────────

function signalAnatomyDialog(score: number, components: SignalComponents, riskState: string) {
  const { stressorPenalty, mrrPenalty, backlogPenalty, lifecycleBonus } = components;
  const preCeiling = 85 - stressorPenalty - mrrPenalty - backlogPenalty + lifecycleBonus;
  const ceilingMap: Record<string, string> = {
    green: 'No cap',
    yellow: 'Capped at 72',
    red: 'Capped at 40',
  };
  const ceilingLabel = ceilingMap[riskState] ?? 'No cap';

  // Bar widths as % of max possible penalty for each component
  const stressorBarW = Math.round((stressorPenalty / 40) * 100);
  const mrrBarW = Math.round((mrrPenalty / 25) * 100);
  const backlogBarW = Math.round((backlogPenalty / 15) * 100);
  const bonusBarW = Math.round((lifecycleBonus / 10) * 100);

  const hint =
    stressorPenalty >= 20 ? 'Resolve active stressors for the biggest Signal improvement.' :
    mrrPenalty >= 15 ? 'Improve your MRR health ratio — reduce churn or grow new MRR.' :
    backlogPenalty >= 9 ? 'Clear the decision backlog — overdue decisions cost up to 15 points.' :
    riskState !== 'green' ? 'Exit the current risk state to lift the score ceiling.' :
    'Your Signal is well-balanced. Focus on lifecycle progression.';

  const row = (name: string, val: string, barW: number, type: 'neg' | 'pos' | 'zero' | 'sub' | 'total' | 'base') => {
    const cls = type === 'neg' ? 'anatomy-negative' : type === 'pos' ? 'anatomy-positive' :
                type === 'zero' ? 'anatomy-zero' : type === 'sub' ? 'anatomy-sub' :
                type === 'total' ? 'anatomy-total' : 'anatomy-base';
    return html`<div class="anatomy-row ${cls}">
      <span class="anatomy-name">${name}</span>
      ${barW > 0 ? html`<div class="anatomy-bar-track"><div class="anatomy-bar" style="width:${barW}%"></div></div>` : html`<span class="anatomy-spacer"></span>`}
      <span class="anatomy-value">${raw(val)}</span>
    </div>`;
  };

  return html`
  <dialog id="anatomy-dialog" class="anatomy-dialog">
    <button class="anatomy-close" onclick="document.getElementById('anatomy-dialog').close()" aria-label="Close">&#x2715;</button>
    <div class="anatomy-title">Signal Anatomy</div>
    <div class="anatomy-subtitle">How your ${score} is built</div>

    <div class="anatomy-table">
      ${row('Base score', '85', 0, 'base')}
      ${stressorPenalty > 0 ? row('Active stressors', `−${stressorPenalty}`, stressorBarW, 'neg') : row('Active stressors', '−0', 0, 'zero')}
      ${mrrPenalty > 0 ? row('MRR health', `−${mrrPenalty}`, mrrBarW, 'neg') : row('MRR health', '−0', 0, 'zero')}
      ${backlogPenalty > 0 ? row('Decision backlog', `−${backlogPenalty}`, backlogBarW, 'neg') : row('Decision backlog', '−0', 0, 'zero')}
      ${lifecycleBonus > 0 ? row('Lifecycle progress', `+${lifecycleBonus}`, bonusBarW, 'pos') : row('Lifecycle progress', '+0', 0, 'zero')}
      <div class="anatomy-divider"></div>
      ${row('Before ceiling', String(preCeiling), 0, 'sub')}
      ${row('Risk ceiling', ceilingLabel, 0, 'sub')}
      <div class="anatomy-divider"></div>
      ${row('Signal', String(score), 0, 'total')}
    </div>

    <div class="anatomy-hint">${hint}</div>

    <form method="dialog" style="text-align:center;margin-top:1rem;">
      <button class="btn btn-ghost btn-sm">Close</button>
    </form>
  </dialog>`;
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

  const [signal, stressors, history, dailyInsight, previousScore] = await Promise.all([
    computeSignal(productId),
    getActiveStressors(productId),
    getSignalHistory(productId, 60),
    getDailyInsight(productId),
    getPreviousSignalScore(productId),
  ]);

  const stressorRows = stressors.rows as unknown as StressorData[];
  const criticalCount = stressorRows.filter((s) => s.severity === 'critical').length;
  const pendingDecisions = ctx.ux.navBadges.decisions_count;

  // Delta vs. yesterday
  const delta = previousScore !== null ? signal.score - previousScore : null;
  const deltaStr = delta === null ? '' : delta > 0 ? `+${delta}` : delta < 0 ? String(delta) : '±0';
  const deltaCls = delta === null || delta === 0 ? '' : delta > 0 ? 'signal-delta-up' : 'signal-delta-down';

  const content = html`
    <div class="signal-home" data-product-id="${productId}">

      <div class="signal-display signal-${signal.tier}">
        <button
          class="signal-number"
          onclick="document.getElementById('anatomy-dialog').showModal()"
          title="Tap to see score breakdown"
          aria-haspopup="dialog"
        >${signal.score}</button>
        <div class="signal-label-row">
          <span class="signal-label">Signal</span>
          ${delta !== null ? raw(`<span class="signal-delta ${deltaCls}">${deltaStr}</span>`) : ''}
        </div>
        ${history.length >= 2 ? html`
        <div class="signal-sparkline-wrap">
          ${sparklineSVG(history)}
          <span class="signal-sparkline-label">${history.length}d trend</span>
        </div>` : ''}
      </div>

      <div class="signal-prose" id="signal-prose">
        ${signal.prose}
      </div>

      ${dailyInsight ? html`
      <details class="daily-insight">
        <summary class="daily-insight-summary">
          <span class="daily-insight-eyebrow">Today's focus</span>
          <span class="daily-insight-headline">${dailyInsight.headline}</span>
        </summary>
        <div class="daily-insight-body">
          <p>${dailyInsight.context}</p>
          ${dailyInsight.action ? html`<div class="daily-insight-action">${dailyInsight.action}</div>` : ''}
        </div>
      </details>` : ''}

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

    ${signalAnatomyDialog(signal.score, signal.components, signal.riskState)}

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
