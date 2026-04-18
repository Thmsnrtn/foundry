// =============================================================================
// FOUNDRY — Benchmarks
// Compare your metrics against anonymized industry benchmarks.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { query } from '../../db/client.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import { requireTier } from '../../middleware/tier-gate.js';

export const benchmarks = new Hono<AuthEnv>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BENCHMARK_METRICS: Array<{ key: string; label: string; unit: string; higherIsBetter: boolean }> = [
  { key: 'mrr_growth_rate', label: 'MRR Growth Rate', unit: '%', higherIsBetter: true },
  { key: 'churn_rate', label: 'Churn Rate', unit: '%', higherIsBetter: false },
  { key: 'activation_rate', label: 'Activation Rate', unit: '%', higherIsBetter: true },
  { key: 'cac_payback_months', label: 'CAC Payback', unit: 'mo', higherIsBetter: false },
  { key: 'nrr', label: 'Net Revenue Retention', unit: '%', higherIsBetter: true },
];

function percentileLabel(pct: number, higherIsBetter: boolean): { label: string; color: string } {
  const good = higherIsBetter ? pct >= 75 : pct <= 25;
  const aboveMedian = higherIsBetter ? pct >= 50 : pct <= 50;

  if (good) return { label: 'Top 25%', color: '#4ecca3' };
  if (aboveMedian) return { label: 'Above median', color: '#7c83fd' };
  if (!higherIsBetter ? pct >= 75 : pct <= 25) return { label: 'Bottom 25%', color: '#ff6b6b' };
  return { label: 'Below median', color: '#ffb347' };
}

function fmtMetricValue(value: number | null, unit: string): string {
  if (value === null || value === undefined) return '—';
  if (unit === '%') return `${value.toFixed(1)}%`;
  if (unit === 'mo') return `${value.toFixed(1)} mo`;
  return String(value);
}

// ─── GET /benchmarks ──────────────────────────────────────────────────────────

benchmarks.get('/benchmarks', requireTier('benchmarks'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'benchmarks', 'Benchmarks', undefined, c);

  if (!ctx.productId) {
    const content = html`
      <h1 style="margin:0 0 1rem;">Benchmarks</h1>
      <div class="card" style="padding:2rem;text-align:center;color:var(--text-muted);">No product selected.</div>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;

  const [snapshotResult, benchmarkResult] = await Promise.all([
    query(
      `SELECT * FROM metric_snapshots WHERE product_id=? ORDER BY snapshot_date DESC LIMIT 1`,
      [productId]
    ),
    query(
      `SELECT * FROM benchmark_percentiles
       WHERE metric_name IN ('mrr_growth_rate','churn_rate','activation_rate','cac_payback_months','nrr')
       ORDER BY metric_name`,
      []
    ),
  ]);

  const snapshot = snapshotResult.rows.length > 0
    ? snapshotResult.rows[0] as Record<string, unknown>
    : null;
  const benchmarkRows = benchmarkResult.rows as Array<Record<string, unknown>>;

  // Index benchmarks by metric name
  const benchmarkByKey: Record<string, Record<string, unknown>> = {};
  for (const row of benchmarkRows) {
    benchmarkByKey[row.metric_name as string] = row;
  }

  const hasBenchmarks = benchmarkRows.length > 0;

  const metricCards = BENCHMARK_METRICS.map((metric) => {
    const snap = snapshot;
    const bench = benchmarkByKey[metric.key];
    const yourValue = snap ? (snap[metric.key] as number | null) ?? null : null;

    if (!bench) {
      return html`
        <div class="card" style="padding:1.25rem;margin-bottom:0.75rem;opacity:0.6;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;">
            <div>
              <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.25rem;">${metric.label}</div>
              <div style="font-size:1.3rem;font-weight:700;color:var(--text-primary);">${fmtMetricValue(yourValue, metric.unit)}</div>
            </div>
            <div style="font-size:0.8rem;color:var(--text-muted);">No benchmark data</div>
          </div>
        </div>
      `;
    }

    const p25 = bench.p25 as number | null;
    const p50 = bench.p50 as number | null;
    const p75 = bench.p75 as number | null;
    const sampleCount = bench.sample_count as number | null;

    // Compute percentile rank for your value
    let yourPercentile = 50;
    if (yourValue !== null && p25 !== null && p50 !== null && p75 !== null) {
      if (metric.higherIsBetter) {
        if (yourValue >= p75) yourPercentile = 80;
        else if (yourValue >= p50) yourPercentile = 65;
        else if (yourValue >= p25) yourPercentile = 35;
        else yourPercentile = 15;
      } else {
        // Lower is better — invert
        if (yourValue <= p25) yourPercentile = 80;
        else if (yourValue <= p50) yourPercentile = 65;
        else if (yourValue <= p75) yourPercentile = 35;
        else yourPercentile = 15;
      }
    }

    const { label: pLabel, color: pColor } = percentileLabel(
      yourPercentile,
      metric.higherIsBetter
    );

    return html`
      <div class="card" style="padding:1.25rem;margin-bottom:0.75rem;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:1rem;flex-wrap:wrap;">
          <div>
            <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.25rem;">${metric.label}</div>
            <div style="font-size:1.5rem;font-weight:700;color:var(--text-primary);">${fmtMetricValue(yourValue, metric.unit)}</div>
            <div style="font-size:0.75rem;color:var(--text-muted);">Your value</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:1rem;font-weight:700;color:${pColor};">${pLabel}</div>
            ${sampleCount ? html`<div style="font-size:0.72rem;color:var(--text-muted);">vs ${sampleCount} companies</div>` : ''}
          </div>
        </div>

        <!-- Percentile bar -->
        <div style="position:relative;margin-bottom:0.75rem;">
          <div style="background:rgba(255,255,255,0.06);border-radius:4px;height:10px;overflow:visible;position:relative;">
            <!-- P25 marker -->
            ${p25 !== null ? html`<div style="position:absolute;top:-4px;bottom:-4px;left:25%;width:1px;background:rgba(255,255,255,0.2);"></div>` : ''}
            <!-- P50 marker -->
            ${p50 !== null ? html`<div style="position:absolute;top:-4px;bottom:-4px;left:50%;width:1px;background:rgba(255,255,255,0.35);"></div>` : ''}
            <!-- P75 marker -->
            ${p75 !== null ? html`<div style="position:absolute;top:-4px;bottom:-4px;left:75%;width:1px;background:rgba(255,255,255,0.2);"></div>` : ''}
            <!-- Your position indicator -->
            ${yourValue !== null ? html`<div style="position:absolute;top:50%;left:${yourPercentile}%;transform:translate(-50%,-50%);width:14px;height:14px;border-radius:50%;background:${pColor};border:2px solid var(--bg-card);z-index:1;"></div>` : ''}
          </div>
          <!-- Labels -->
          <div style="display:flex;justify-content:space-between;margin-top:0.5rem;font-size:0.67rem;color:var(--text-muted);">
            <span>P25: ${fmtMetricValue(p25, metric.unit)}</span>
            <span>Median: ${fmtMetricValue(p50, metric.unit)}</span>
            <span>P75: ${fmtMetricValue(p75, metric.unit)}</span>
          </div>
        </div>
      </div>
    `;
  });

  const content = html`
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1.5rem;">
      <h1 style="margin:0;">Benchmarks</h1>
      ${snapshot ? html`<span style="font-size:0.8rem;color:var(--text-muted);">Latest snapshot: ${(snapshot.snapshot_date as string)?.slice(0, 10) ?? 'recent'}</span>` : ''}
    </div>

    ${!hasBenchmarks ? html`
      <div class="card" style="padding:2rem;text-align:center;margin-bottom:1.5rem;border:1px dashed rgba(255,255,255,0.15);">
        <div style="font-size:1.5rem;margin-bottom:0.75rem;">📊</div>
        <h3 style="margin:0 0 0.5rem;color:var(--text-primary);">Contributing to benchmarks…</h3>
        <p style="color:var(--text-dim);font-size:0.87rem;max-width:420px;margin:0 auto 0.5rem;">
          Foundry anonymously aggregates key metrics across all products to build industry percentiles.
          Your data is always anonymized — no company names, no identifiable info.
        </p>
        <p style="color:var(--text-muted);font-size:0.8rem;margin:0;">
          Benchmarks will appear once enough data has been collected across the network.
        </p>
      </div>
    ` : ''}

    ${snapshot === null ? html`
      <div class="card" style="padding:1.25rem;margin-bottom:1rem;border-left:3px solid #ffb34744;">
        <div style="font-size:0.85rem;color:var(--text-dim);">
          No metric snapshot found for this product. Ingest some data first to see your values compared to benchmarks.
        </div>
      </div>
    ` : ''}

    <!-- Metric cards -->
    ${metricCards}
  `;

  return c.html(dashboardLayout(ctx, content));
});
