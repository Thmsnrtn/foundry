// =============================================================================
// FOUNDRY — Number Rendering (Wave 2, action 18)
// One helper for every number on the dashboard so deltas, sparklines, and
// up/down indicators are consistent. Council 3 (information designers):
// "no deliberate visual hierarchy" was the finding.
//
// A PROPOSED CONTRACT, NOT ONE IN FORCE. Nothing imports this module — it is on
// the unreachable-modules baseline — so every dashboard still renders numbers
// its own way. The header used to say "this is the contract", which a reader
// could only take to mean the dashboards go through it.
//
// WHAT WAS CORRECTED BEFORE IT HAS A CALLER, because a contract that encodes a
// unit ambiguity hands that ambiguity to everyone who later adopts it:
//
//   `formatPct(n)` took "a number" and appended '%'. Every rate in this system
//   is stored as a 0–1 FRACTION — `churn_rate`, `activation_rate`,
//   `day_30_retention` — so the first caller passing one straight in would have
//   rendered 5% churn as "0.05%". That is the exact defect found in
//   `business-model.ts` this cycle, waiting here for its first adopter.
//
//   `formatUsdK(amount)` took "an amount". Every money column in this system is
//   `_cents`, so a caller passing `mrr_cents` would have rendered $50,000 as
//   "$5000K".
//
//   `renderMetric` had no way to say a number is not known, while the rest of
//   the system had just been taught to say exactly that.
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
  /** Null renders as "not measured" rather than as a digit. */
  value: string | number | null;
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
      <div style="font-size:${opts.value === null ? '0.95rem' : '1.5rem'};font-weight:700;color:${opts.value === null ? 'var(--text-dim)' : 'var(--text-primary)'};line-height:1.1;">
        ${opts.value === null ? 'not measured' : String(opts.value)}
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

/**
 * Format WHOLE DOLLARS. Named for the unit because every money column in this
 * system is `_cents`, and "amount" was an invitation to pass one.
 * Null renders as "not measured", the house convention.
 */
export function formatUsdFromDollars(dollars: number | null): string {
  if (dollars === null) return 'not measured';
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1000) return `$${Math.round(dollars / 1000)}K`;
  return `$${Math.round(dollars)}`;
}

/** The same, from cents, which is what the database holds. */
export function formatUsdFromCents(cents: number | null): string {
  return cents === null ? 'not measured' : formatUsdFromDollars(cents / 100);
}

/**
 * Format PERCENTAGE POINTS — 12.5 renders as "12.5%".
 *
 * If you are holding a rate from `metric_snapshots` it is a 0–1 FRACTION, and
 * `ratePoints()` in `services/ai/measured.ts` is the one place that converts.
 * Convert the value, never the threshold.
 */
export function formatPctPoints(points: number | null, fractionDigits = 0): string {
  return points === null ? 'not measured' : `${points.toFixed(fractionDigits)}%`;
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
