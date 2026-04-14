// =============================================================================
// FOUNDRY — UI Component Library
// Reusable, consistent UI primitives for the entire application.
// =============================================================================

import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

type HtmlContent = HtmlEscapedString | Promise<HtmlEscapedString>;

// ─── Loading States ─────────────────────────────────────────────────────────

export function loadingSpinner(size: 'sm' | 'md' | 'lg' = 'md'): HtmlContent {
  const px = size === 'sm' ? 16 : size === 'md' ? 24 : 40;
  return html`<div class="spinner" style="width:${px}px;height:${px}px;" role="status" aria-label="Loading"></div>`;
}

export function loadingCard(message: string = 'Loading...'): HtmlContent {
  return html`
  <div class="card" style="text-align:center;padding:3rem;">
    ${loadingSpinner('lg')}
    <p style="color:#6b7280;margin-top:1rem;">${message}</p>
  </div>`;
}

export function skeletonLine(width: string = '100%'): HtmlContent {
  return html`<div class="skeleton" style="width:${width};height:14px;"></div>`;
}

export function skeletonCard(): HtmlContent {
  return html`
  <div class="card">
    ${skeletonLine('60%')}
    <div style="margin-top:0.75rem;">${skeletonLine('100%')}</div>
    <div style="margin-top:0.5rem;">${skeletonLine('80%')}</div>
    <div style="margin-top:0.5rem;">${skeletonLine('40%')}</div>
  </div>`;
}

// ─── Feedback States ────────────────────────────────────────────────────────

export function successBanner(message: string): HtmlContent {
  return html`
  <div class="feedback-banner feedback-success" role="alert">
    <span class="feedback-icon">&#10003;</span>
    <span>${message}</span>
  </div>`;
}

export function errorBanner(message: string): HtmlContent {
  return html`
  <div class="feedback-banner feedback-error" role="alert">
    <span class="feedback-icon">!</span>
    <span>${message}</span>
  </div>`;
}

export function warningBanner(message: string): HtmlContent {
  return html`
  <div class="feedback-banner feedback-warning" role="alert">
    <span class="feedback-icon">&#9888;</span>
    <span>${message}</span>
  </div>`;
}

export function infoBanner(message: string): HtmlContent {
  return html`
  <div class="feedback-banner feedback-info" role="alert">
    <span class="feedback-icon">i</span>
    <span>${message}</span>
  </div>`;
}

// ─── Status Badges ──────────────────────────────────────────────────────────

export type BadgeVariant = 'green' | 'yellow' | 'red' | 'blue' | 'gray' | 'purple';

export function statusBadge(label: string, variant: BadgeVariant = 'gray'): HtmlContent {
  return html`<span class="status-badge status-${variant}">${label}</span>`;
}

// ─── Empty States ───────────────────────────────────────────────────────────

export function actionableEmptyState(
  headline: string,
  description: string,
  action?: { label: string; url: string },
): HtmlContent {
  return html`
  <div class="empty-state-card">
    <div class="empty-state-icon">
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="20" stroke="#d1d5db" stroke-width="2" stroke-dasharray="4 4"/>
        <path d="M24 16v8m0 4h.01" stroke="#9ca3af" stroke-width="2" stroke-linecap="round"/>
      </svg>
    </div>
    <h3 style="margin-bottom:0.5rem;">${headline}</h3>
    <p style="color:#6b7280;max-width:400px;margin:0 auto 1.5rem;">${description}</p>
    ${action ? html`<a href="${action.url}" class="btn btn-primary">${action.label}</a>` : ''}
  </div>`;
}

// ─── Trend Indicators ───────────────────────────────────────────────────────

export function trendIndicator(current: number, previous: number | null, format: 'number' | 'percent' | 'currency' = 'number'): HtmlContent {
  if (previous === null || previous === undefined) return html`<span class="trend-neutral">—</span>`;

  const delta = current - previous;
  const pctChange = previous !== 0 ? ((delta / previous) * 100) : 0;
  const isUp = delta > 0;
  const isDown = delta < 0;
  const arrow = isUp ? '&#9650;' : isDown ? '&#9660;' : '&#8722;';
  const color = isUp ? 'trend-up' : isDown ? 'trend-down' : 'trend-neutral';

  let formatted = '';
  if (format === 'currency') {
    formatted = `$${Math.abs(delta / 100).toFixed(0)}`;
  } else if (format === 'percent') {
    formatted = `${Math.abs(pctChange).toFixed(1)}%`;
  } else {
    formatted = Math.abs(delta).toLocaleString();
  }

  return html`<span class="${color}" title="Change: ${delta >= 0 ? '+' : ''}${delta}">${arrow} ${formatted}</span>`;
}

// ─── Metric Card with Trend ─────────────────────────────────────────────────

export function metricCardWithTrend(
  label: string,
  value: string,
  trend?: { current: number; previous: number | null; format?: 'number' | 'percent' | 'currency' },
): HtmlContent {
  return html`
  <div class="metric-card">
    <span class="metric-value">${value}</span>
    <span class="metric-label">${label}</span>
    ${trend ? html`<div class="metric-trend">${trendIndicator(trend.current, trend.previous, trend.format)}</div>` : ''}
  </div>`;
}

// ─── Confirm Dialog ─────────────────────────────────────────────────────────

export function confirmButton(
  label: string,
  confirmMessage: string,
  formAction: string,
  variant: 'danger' | 'primary' = 'danger',
): HtmlContent {
  return html`
  <form method="POST" action="${formAction}" style="display:inline;"
    onsubmit="return confirm('${confirmMessage.replace(/'/g, "\\'")}')">
    <button type="submit" class="btn btn-${variant === 'danger' ? 'danger' : 'primary'} btn-sm">${label}</button>
  </form>`;
}

// ─── Data Age Indicator ─────────────────────────────────────────────────────

export function dataAge(date: string | null, warningDays: number = 7): HtmlContent {
  if (!date) return html`<span class="data-age data-age-unknown">No data</span>`;
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
  const cls = days > warningDays ? 'data-age-stale' : 'data-age-fresh';
  const label = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days}d ago`;
  return html`<span class="data-age ${cls}">${label}</span>`;
}

// ─── Pagination Controls ────────────────────────────────────────────────────

export function paginationNav(
  baseUrl: string,
  page: number,
  totalPages: number,
  total: number,
): HtmlContent {
  if (totalPages <= 1) return html``;
  return html`
  <nav class="pagination" aria-label="Pagination">
    ${page > 1
      ? html`<a href="${baseUrl}${baseUrl.includes('?') ? '&' : '?'}page=${page - 1}" class="btn btn-secondary btn-sm" aria-label="Previous page">&larr; Prev</a>`
      : html`<span class="btn btn-secondary btn-sm" style="opacity:0.4;">&larr; Prev</span>`}
    <span class="pagination-info">Page ${page} of ${totalPages} (${total} total)</span>
    ${page < totalPages
      ? html`<a href="${baseUrl}${baseUrl.includes('?') ? '&' : '?'}page=${page + 1}" class="btn btn-secondary btn-sm" aria-label="Next page">Next &rarr;</a>`
      : html`<span class="btn btn-secondary btn-sm" style="opacity:0.4;">Next &rarr;</span>`}
  </nav>`;
}

// ─── Section Header with Action ─────────────────────────────────────────────

export function sectionHeaderWithAction(
  title: string,
  action?: { label: string; url: string; variant?: 'primary' | 'secondary' },
): HtmlContent {
  return html`
  <div class="section-header">
    <h2>${title}</h2>
    ${action ? html`<a href="${action.url}" class="btn btn-${action.variant ?? 'secondary'} btn-sm">${action.label}</a>` : ''}
  </div>`;
}
