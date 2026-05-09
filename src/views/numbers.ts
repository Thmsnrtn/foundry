// =============================================================================
// FOUNDRY — Number Rendering (Wave 2, action 18)
// One helper for every number on the dashboard so deltas, sparklines, and
// up/down indicators are consistent. Council 3 (information designers):
// "no deliberate visual hierarchy" was the finding; this is the contract.
//
// Use in views as raw HTML (the helpers return strings).
// =============================================================================

import { html } from 'hono/html';

export type Direction = 'up' | 'down' | 'flat' | null;

// ─── Big numbers (the "number that matters" pattern) ─────────────────────────

/**
 * Render a primary metric with a value, label, and optional delta.
 * Used for Signal score, weekly outcome counts, MRR, etc.
 */
export function renderMetric(opts: {
  value: string | number;
  label: string;
  delta?: { value: string | number; direction: Direction; goodDirection?: 'up' | 'down' };
}) {
  const dir = opts.delta?.direction ?? null;
  // goodDirection inverts coloring — for churn or expense, "down" is good.
  const goodIsUp = (opts.delta?.goodDirection ?? 'up') === 'up';
  const isPositive = dir && (goodIsUp ? dir === 'up' : dir === 'down');
  const isNegative = dir && (goodIsUp ? dir === 'down' : dir === 'up');
  const color = isPositive
    ? 'var(--accent)'
    : isNegative
      ? 'var(--warning, #ffb347)'
      : 'var(--text-dim)';
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : dir === 'flat' ? '→' : '';
  return html`
    <div>
      <div style="font-size:1.5rem;font-weight:700;color:var(--text-primary);line-height:1.1;">
        ${String(opts.value)}
      </div>
      <div style="font-size:0.78rem;color:var(--text-dim);margin-top:0.15rem;">
        ${opts.label}
      </div>
      ${opts.delta ? html`
        <div style="font-size:0.78rem;color:${color};margin-top:0.15rem;">
          ${arrow} ${String(opts.delta.value)}
        </div>` : ''}
    </div>
  `;
}

// ─── Inline delta (used in tight rows like the briefing footer) ───────────────

export function renderInlineDelta(opts: {
  value: string | number;
  direction: Direction;
  goodDirection?: 'up' | 'down';
}) {
  const goodIsUp = (opts.goodDirection ?? 'up') === 'up';
  const isPositive = opts.direction && (goodIsUp ? opts.direction === 'up' : opts.direction === 'down');
  const color = isPositive ? 'var(--accent)' : 'var(--text-dim)';
  const arrow = opts.direction === 'up' ? '▲' : opts.direction === 'down' ? '▼' : '→';
  return html`<span style="color:${color};font-weight:600;">${arrow} ${String(opts.value)}</span>`;
}

// ─── Sparkline (delegates to existing sparklineSVG-style usage) ──────────────
//
// This module provides no SVG generation itself — sparklineSVG lives in
// dashboard/index.ts and stays there. The module documents that sparklines
// belong on metrics with at least 7 days of history, never on point-in-time
// counts.

// ─── Number formatters ───────────────────────────────────────────────────────

export function formatUsdK(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1000) return `$${Math.round(amount / 1000)}K`;
  return `$${Math.round(amount)}`;
}

export function formatPct(n: number, fractionDigits = 0): string {
  return `${n.toFixed(fractionDigits)}%`;
}

export function formatLatencyMs(ms: number | null | undefined): string {
  if (ms == null) return 'N/A';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}min`;
}

// ─── Direction helpers ───────────────────────────────────────────────────────

export function directionFromDelta(delta: number | null): Direction {
  if (delta == null || Number.isNaN(delta)) return null;
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'flat';
}
