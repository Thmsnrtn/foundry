// =============================================================================
// FOUNDRY — Investor / Advisor Share Route
// Public, token-gated read-only view. The URL token IS the secret.
// No authentication required — share the link to grant read access.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import { query } from '../../db/client.js';
import { computeSignal, getSignalHistory } from '../../services/signal.js';

export const shareRoutes = new Hono();

// ─── Sparkline SVG ────────────────────────────────────────────────────────────

function sparklineSVG(
  history: Array<{ score: number; snapshot_date: string }>,
  width = 300,
  height = 60,
): string {
  if (history.length < 2) return '';
  const scores = history.map((h) => h.score);
  const W = width, H = height, pad = 3;
  const pts = scores
    .map((s, i) => {
      const x = pad + (i / (scores.length - 1)) * (W - pad * 2);
      const y = pad + ((100 - s) / 100) * (H - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true" style="display:block;"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/></svg>`;
}

// ─── Share Page ───────────────────────────────────────────────────────────────

shareRoutes.get('/share/:token', async (c) => {
  const token = c.req.param('token');
  if (!token || !/^[\w-]{8,64}$/.test(token)) return c.notFound();

  const productResult = await query(
    `SELECT p.*, f.name as founder_name
     FROM products p
     JOIN founders f ON p.owner_id = f.id
     WHERE p.share_token = ?`,
    [token],
  );
  if (productResult.rows.length === 0) return c.notFound();

  const product = productResult.rows[0] as Record<string, unknown>;
  const productId = product.id as string;

  const [signal, history, metricsResult, decisionsResult, lifecycleResult] = await Promise.all([
    computeSignal(productId),
    getSignalHistory(productId, 90),
    query('SELECT * FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1', [productId]),
    query(
      `SELECT what, chosen_option, decided_at, outcome FROM decisions
       WHERE product_id = ? AND status = 'approved' AND chosen_option IS NOT NULL
       ORDER BY decided_at DESC LIMIT 5`,
      [productId],
    ),
    query('SELECT current_prompt, risk_state FROM lifecycle_state WHERE product_id = ?', [productId]),
  ]);

  const metrics = (metricsResult.rows[0] ?? {}) as Record<string, unknown>;
  const decisions = decisionsResult.rows as Array<Record<string, unknown>>;
  const lifecycle = (lifecycleResult.rows[0] ?? {}) as Record<string, unknown>;

  const promptIndex: Record<string, number> = {
    prompt_1: 1, prompt_2: 2, prompt_2_5: 3, prompt_3: 4,
    prompt_4: 5, prompt_5: 6, prompt_6: 7, prompt_7: 8, prompt_8: 9, prompt_9: 9,
  };
  const stageNum = promptIndex[(lifecycle.current_prompt as string) ?? 'prompt_1'] ?? 1;

  const tierColor: Record<string, string> = {
    high: '#4ecca3',
    mid: '#ffb347',
    low: '#ff6b6b',
  };
  const signalColor = tierColor[signal.tier] ?? '#4ecca3';

  const sparkline = sparklineSVG(history);

  const formatMrr = (cents: unknown) =>
    cents ? `$${Math.round((cents as number) / 100).toLocaleString()}` : null;

  const newMrr = formatMrr(metrics.new_mrr_cents);
  const churnedMrr = formatMrr(metrics.churned_mrr_cents);
  const activation = metrics.activation_rate
    ? `${((metrics.activation_rate as number) * 100).toFixed(1)}%`
    : null;
  const day30 = metrics.day_30_retention
    ? `${((metrics.day_30_retention as number) * 100).toFixed(1)}%`
    : null;
  const churnRate = metrics.churn_rate
    ? `${((metrics.churn_rate as number) * 100).toFixed(1)}%`
    : null;
  const nps = metrics.nps_score !== null && metrics.nps_score !== undefined
    ? String(metrics.nps_score)
    : null;

  const metricItems: Array<{ label: string; value: string }> = [
    newMrr && { label: 'New MRR', value: newMrr },
    churnedMrr && { label: 'Churned MRR', value: churnedMrr },
    activation && { label: 'Activation Rate', value: activation },
    day30 && { label: '30-Day Retention', value: day30 },
    churnRate && { label: 'Churn Rate', value: churnRate },
    nps && { label: 'NPS', value: nps },
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  const page = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${product.name as string} — Foundry Signal</title>
  <meta name="robots" content="noindex, nofollow" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { font-size: 14px; -webkit-font-smoothing: antialiased; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: #0a0a12;
      color: #e4e4f0;
      line-height: 1.6;
      min-height: 100vh;
    }
    a { color: #6c63ff; text-decoration: none; }
    a:hover { color: #7c73ff; }

    .share-wrap {
      max-width: 580px;
      margin: 0 auto;
      padding: 3rem 1.5rem 5rem;
    }

    /* Header */
    .share-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 3rem;
    }
    .share-product-name {
      font-size: 1rem;
      font-weight: 700;
      letter-spacing: -0.3px;
      color: #e4e4f0;
    }
    .share-badge {
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      padding: 3px 10px;
      border-radius: 99px;
      background: rgba(108,99,255,0.15);
      color: #6c63ff;
    }

    /* Signal block */
    .share-signal {
      text-align: center;
      margin-bottom: 2rem;
    }
    .share-number {
      font-size: 7rem;
      font-weight: 800;
      line-height: 1;
      letter-spacing: -5px;
      font-variant-numeric: tabular-nums;
      color: ${signalColor};
    }
    .share-label {
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: #44445a;
      margin-top: 0.3rem;
    }

    /* Sparkline */
    .share-sparkline {
      color: ${signalColor};
      margin: 1.5rem auto 0.5rem;
      display: block;
    }
    .share-sparkline-label {
      text-align: center;
      font-size: 0.72rem;
      color: #44445a;
      margin-bottom: 2rem;
    }

    /* Prose */
    .share-prose {
      text-align: center;
      font-size: 1.05rem;
      line-height: 1.75;
      color: #7878a0;
      margin-bottom: 2.5rem;
      padding: 0 0.5rem;
    }

    /* Stage */
    .share-meta {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1.5rem;
      margin-bottom: 2.5rem;
    }
    .share-meta-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.2rem;
    }
    .share-meta-value {
      font-size: 1.1rem;
      font-weight: 700;
      color: #e4e4f0;
    }
    .share-meta-label {
      font-size: 0.72rem;
      color: #44445a;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    /* Sections */
    .share-section {
      margin-bottom: 2rem;
    }
    .share-section-label {
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #44445a;
      margin-bottom: 0.75rem;
    }

    /* Metrics grid */
    .share-metrics {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.65rem;
    }
    .share-metric {
      background: #111120;
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 8px;
      padding: 0.85rem 1rem;
    }
    .share-metric-value {
      font-size: 1.1rem;
      font-weight: 700;
      color: #e4e4f0;
      font-variant-numeric: tabular-nums;
    }
    .share-metric-label {
      font-size: 0.72rem;
      color: #7878a0;
      margin-top: 0.15rem;
    }

    /* Decisions */
    .share-decision {
      padding: 0.85rem 1rem;
      background: #111120;
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 8px;
      margin-bottom: 0.5rem;
    }
    .share-decision-what {
      font-size: 0.9rem;
      font-weight: 500;
      color: #e4e4f0;
      margin-bottom: 0.2rem;
    }
    .share-decision-chosen {
      font-size: 0.82rem;
      color: #7878a0;
    }
    .share-decision-outcome {
      font-size: 0.8rem;
      color: #4ecca3;
      margin-top: 0.2rem;
    }

    /* Footer */
    .share-footer {
      margin-top: 4rem;
      padding-top: 1.5rem;
      border-top: 1px solid rgba(255,255,255,0.07);
      text-align: center;
    }
    .share-footer-text {
      font-size: 0.8rem;
      color: #44445a;
    }
    .share-footer-cta {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      margin-top: 0.75rem;
      padding: 0.45rem 1.1rem;
      background: rgba(108,99,255,0.12);
      border: 1px solid rgba(108,99,255,0.25);
      border-radius: 99px;
      font-size: 0.82rem;
      color: #6c63ff;
      font-weight: 500;
    }
    .share-footer-cta:hover {
      background: rgba(108,99,255,0.2);
      color: #6c63ff;
    }

    @media (max-width: 480px) {
      .share-number { font-size: 5rem; }
      .share-metrics { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
  <div class="share-wrap">

    <div class="share-header">
      <div class="share-product-name">${product.name as string}</div>
      <span class="share-badge">LIVE SIGNAL</span>
    </div>

    <div class="share-signal">
      <div class="share-number">${signal.score}</div>
      <div class="share-label">Signal Score</div>
    </div>

    ${sparkline ? `
    <div class="share-sparkline">${sparkline}</div>
    <div class="share-sparkline-label">Last 90 days</div>
    ` : ''}

    <div class="share-prose">${signal.prose}</div>

    <div class="share-meta">
      <div class="share-meta-item">
        <div class="share-meta-value">Stage ${stageNum} of 9</div>
        <div class="share-meta-label">Lifecycle</div>
      </div>
      <div class="share-meta-item">
        <div class="share-meta-value" style="color:${signal.riskState === 'red' ? '#ff6b6b' : signal.riskState === 'yellow' ? '#ffb347' : '#4ecca3'}">${signal.riskState.toUpperCase()}</div>
        <div class="share-meta-label">Risk State</div>
      </div>
    </div>

    ${metricItems.length > 0 ? `
    <div class="share-section">
      <div class="share-section-label">Key Metrics</div>
      <div class="share-metrics">
        ${metricItems.map((m) => `
        <div class="share-metric">
          <div class="share-metric-value">${m.value}</div>
          <div class="share-metric-label">${m.label}</div>
        </div>`).join('')}
      </div>
    </div>` : ''}

    ${decisions.length > 0 ? `
    <div class="share-section">
      <div class="share-section-label">Recent Decisions</div>
      ${decisions.map((d) => `
      <div class="share-decision">
        <div class="share-decision-what">${d.what as string}</div>
        ${d.chosen_option ? `<div class="share-decision-chosen">Chose: ${d.chosen_option as string}</div>` : ''}
        ${d.outcome ? `<div class="share-decision-outcome">${d.outcome as string}</div>` : ''}
      </div>`).join('')}
    </div>` : ''}

    <div class="share-footer">
      <div class="share-footer-text">This is a live read-only view. Updated in real-time.</div>
      <a href="/" class="share-footer-cta">Track your own business with Foundry</a>
    </div>

  </div>
</body>
</html>`;

  return c.html(page);
});
