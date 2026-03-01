// =============================================================================
// FOUNDRY — Reusable View Components
// Server-rendered HTML fragments for the dashboard.
// =============================================================================

import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import type { HtmlContent } from './layout.js';
import type { NextAction, PageHint, MilestoneEvent, FeatureGateConfig } from '../types/index.js';
import type { TourStep } from '../services/ux/tour.js';

// ─── Risk State Badge ────────────────────────────────────────────────────────

export function riskStateBadge(
  state: string,
  reason: string | null,
  changedAt: string | null
): HtmlContent {
  const stateLabel = state.toUpperCase();
  const messages: Record<string, string> = {
    green: 'Your product is operating normally. No immediate risks detected.',
    yellow: `Heightened monitoring active. ${reason ?? ''}`,
    red: `Recovery mode. ${reason ?? 'See Recovery Protocol below.'}`,
  };
  return html`
  <div class="risk-state-card risk-bg-${state}">
    <div class="risk-state-header">
      <span class="risk-badge risk-${state}">${stateLabel}</span>
      ${changedAt ? html`<span class="risk-changed">Since ${formatDate(changedAt)}</span>` : ''}
    </div>
    <p class="risk-state-message">${messages[state] ?? reason ?? ''}</p>
  </div>`;
}

// ─── Stressor Report ─────────────────────────────────────────────────────────

export interface StressorData {
  name: string;
  signal: string;
  timeframe_days: number;
  neutralizing_action: string;
  severity: string;
}

export function stressorReport(stressors: StressorData[]): HtmlContent {
  if (stressors.length === 0) {
    return html`
    <div class="card">
      <h3>Stressor Report</h3>
      <p class="text-muted">No significant forward-looking risks identified this week.</p>
    </div>`;
  }
  return html`
  <div class="card">
    <h3>Stressor Report</h3>
    <div class="stressor-list">
      ${stressors.map((s) => html`
      <div class="stressor-item severity-${s.severity}">
        <div class="stressor-header">
          <strong>${s.name}</strong>
          <span class="badge badge-${s.severity}">${s.severity}</span>
        </div>
        <p class="stressor-signal">${s.signal}</p>
        <div class="stressor-meta">
          <span>⏱ ${s.timeframe_days}d to material</span>
          <span>→ ${s.neutralizing_action}</span>
        </div>
      </div>`)}
    </div>
  </div>`;
}

// ─── MRR Decomposition ──────────────────────────────────────────────────────

export interface MRRData {
  new_cents: number;
  expansion_cents: number;
  contraction_cents: number;
  churned_cents: number;
  total_cents: number;
  health_ratio: number | null;
}

export function mrrDecomposition(
  mrr: MRRData,
  healthIndicator: string
): HtmlContent {
  return html`
  <div class="card">
    <h3>MRR Decomposition</h3>
    <div class="mrr-total">
      <span class="mrr-amount">$${formatCents(mrr.total_cents)}</span>
      <span class="mrr-label">Total MRR</span>
    </div>
    <div class="mrr-grid">
      <div class="mrr-component mrr-new">
        <span class="mrr-comp-label">New</span>
        <span class="mrr-comp-value">$${formatCents(mrr.new_cents)}</span>
      </div>
      <div class="mrr-component mrr-expansion">
        <span class="mrr-comp-label">Expansion</span>
        <span class="mrr-comp-value">$${formatCents(mrr.expansion_cents)}</span>
      </div>
      <div class="mrr-component mrr-contraction">
        <span class="mrr-comp-label">Contraction</span>
        <span class="mrr-comp-value">$${formatCents(mrr.contraction_cents)}</span>
      </div>
      <div class="mrr-component mrr-churned">
        <span class="mrr-comp-label">Churned</span>
        <span class="mrr-comp-value">$${formatCents(mrr.churned_cents)}</span>
      </div>
    </div>
    <div class="mrr-health">
      <span>Health Ratio:</span>
      <span class="risk-badge risk-${healthIndicator}">${mrr.health_ratio?.toFixed(2) ?? 'N/A'}</span>
    </div>
  </div>`;
}

// ─── Metric Card ─────────────────────────────────────────────────────────────

export function metricCard(
  label: string,
  value: string | number | null,
  format?: 'number' | 'percent' | 'score'
): HtmlContent {
  let display = value === null || value === undefined ? '—' : String(value);
  if (format === 'percent' && typeof value === 'number') display = `${(value * 100).toFixed(1)}%`;
  if (format === 'score' && typeof value === 'number') display = value.toFixed(1);

  return html`
  <div class="metric-card">
    <span class="metric-value">${display}</span>
    <span class="metric-label">${label}</span>
  </div>`;
}

export function metricsGrid(metrics: Record<string, unknown>): HtmlContent {
  return html`
  <div class="card">
    <h3>Key Metrics</h3>
    <div class="metrics-grid">
      ${metricCard('Signups (7d)', metrics.signups_7d as number | null, 'number')}
      ${metricCard('Active Users', metrics.active_users as number | null, 'number')}
      ${metricCard('Activation Rate', metrics.activation_rate as number | null, 'percent')}
      ${metricCard('Day 30 Retention', metrics.day_30_retention as number | null, 'percent')}
      ${metricCard('Support Volume (7d)', metrics.support_volume_7d as number | null, 'number')}
      ${metricCard('NPS', metrics.nps_score as number | null, 'score')}
      ${metricCard('Churn Rate', metrics.churn_rate as number | null, 'percent')}
    </div>
  </div>`;
}

// ─── Audit Dimension Scores ──────────────────────────────────────────────────

const DIMENSION_NAMES: Record<string, string> = {
  d1_score: 'D1 Functional Completeness',
  d2_score: 'D2 Experience Coherence',
  d3_score: 'D3 Trust Density',
  d4_score: 'D4 Value Legibility',
  d5_score: 'D5 Operational Readiness',
  d6_score: 'D6 Commercial Integrity',
  d7_score: 'D7 Self-Sufficiency',
  d8_score: 'D8 Competitive Defensibility',
  d9_score: 'D9 Launch Readiness',
  d10_score: 'D10 Stranger Test',
};

const DIMENSION_WEIGHTS: Record<string, number> = {
  d1_score: 0.15, d2_score: 0.10, d3_score: 0.15, d4_score: 0.10,
  d5_score: 0.15, d6_score: 0.10, d7_score: 0.10, d8_score: 0.05,
  d9_score: 0.05, d10_score: 0.05,
};

export function auditScoreCard(audit: Record<string, unknown>): HtmlContent {
  const composite = audit.composite as number | null;
  const verdict = audit.verdict as string | null;
  const verdictClass = verdict === 'READY' ? 'verdict-ready'
    : verdict === 'READY WITH CONDITIONS' ? 'verdict-conditions'
    : 'verdict-not-ready';

  return html`
  <div class="audit-summary">
    <div class="audit-composite">
      <span class="composite-score">${composite?.toFixed(1) ?? '—'}</span>
      <span class="composite-label">Composite</span>
    </div>
    <span class="verdict-badge ${verdictClass}">${verdict ?? 'N/A'}</span>
  </div>
  <div class="dimension-grid">
    ${Object.entries(DIMENSION_NAMES).map(([key, name]) => {
      const score = audit[key] as number | null;
      const weight = DIMENSION_WEIGHTS[key];
      const scoreClass = score === null ? '' : score >= 7 ? 'score-good' : score >= 5 ? 'score-warn' : 'score-bad';
      return html`
      <div class="dimension-row ${scoreClass}">
        <span class="dim-name">${name}</span>
        <span class="dim-weight">${(weight * 100).toFixed(0)}%</span>
        <div class="dim-bar-track">
          <div class="dim-bar-fill" style="width: ${(score ?? 0) * 10}%"></div>
        </div>
        <span class="dim-score">${score ?? '—'}</span>
      </div>`;
    })}
  </div>`;
}

export function auditComparison(
  current: Record<string, unknown>,
  prior: Record<string, unknown>
): HtmlContent {
  return html`
  <div class="card">
    <h3>Audit Comparison</h3>
    <div class="comparison-grid">
      <div class="comp-header">
        <span>Dimension</span><span>Prior</span><span>Current</span><span>Delta</span>
      </div>
      ${Object.entries(DIMENSION_NAMES).map(([key, name]) => {
        const cur = current[key] as number | null;
        const prev = prior[key] as number | null;
        const delta = cur !== null && prev !== null ? cur - prev : null;
        const deltaClass = delta === null ? '' : delta > 0 ? 'delta-up' : delta < 0 ? 'delta-down' : '';
        return html`
        <div class="comp-row">
          <span>${name}</span>
          <span>${prev ?? '—'}</span>
          <span>${cur ?? '—'}</span>
          <span class="${deltaClass}">${delta !== null ? (delta > 0 ? '+' : '') + delta : '—'}</span>
        </div>`;
      })}
      <div class="comp-row comp-total">
        <span>Composite</span>
        <span>${(prior.composite as number | null)?.toFixed(1) ?? '—'}</span>
        <span>${(current.composite as number | null)?.toFixed(1) ?? '—'}</span>
        <span class="${
          (current.composite as number ?? 0) > (prior.composite as number ?? 0) ? 'delta-up' : 'delta-down'
        }">${
          current.composite != null && prior.composite != null
            ? ((current.composite as number) - (prior.composite as number) > 0 ? '+' : '') +
              ((current.composite as number) - (prior.composite as number)).toFixed(1)
            : '—'
        }</span>
      </div>
    </div>
  </div>`;
}

// ─── Blocking Issues ─────────────────────────────────────────────────────────

export function blockingIssues(issuesJson: string | null): HtmlContent {
  if (!issuesJson) return html``;
  let issues: Array<{ id: string; dimension: string; issue: string; evidence: string; definition_of_done: string }>;
  try { issues = JSON.parse(issuesJson); } catch { return html``; }
  if (issues.length === 0) return html``;

  return html`
  <div class="card">
    <h3>Blocking Issues</h3>
    <div class="blocking-list">
      ${issues.map((issue) => html`
      <div class="blocking-item">
        <div class="blocking-header">
          <code>${issue.id}</code>
          <span class="blocking-dim">${issue.dimension}</span>
        </div>
        <p class="blocking-issue">${issue.issue}</p>
        <details>
          <summary>Evidence &amp; Resolution</summary>
          <p><strong>Evidence:</strong> ${issue.evidence}</p>
          <p><strong>Done when:</strong> ${issue.definition_of_done}</p>
        </details>
      </div>`)}
    </div>
  </div>`;
}

// ─── Lifecycle Progress ──────────────────────────────────────────────────────

export function lifecycleProgress(currentPrompt: string): HtmlContent {
  const prompts = ['prompt_1', 'prompt_2', 'prompt_2_5', 'prompt_3', 'prompt_4', 'prompt_5', 'prompt_6', 'prompt_7', 'prompt_8', 'prompt_9'];
  const currentIdx = prompts.indexOf(currentPrompt);

  return html`
  <div class="lifecycle-bar">
    ${prompts.map((p, i) => {
      const cls = i < currentIdx ? 'lc-done' : i === currentIdx ? 'lc-current' : 'lc-pending';
      return html`<span class="lc-step ${cls}" title="${p}">${p.replace('prompt_', 'P')}</span>`;
    })}
  </div>`;
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

/**
 * Empty state placeholder.
 */
export function emptyState(message: string, action?: { label: string; href: string }): HtmlContent {
  return html`
  <div class="empty-state">
    <p>${message}</p>
    ${action ? html`<a href="${action.href}" class="btn btn-primary">${action.label}</a>` : ''}
  </div>`;
}

// ─── Decision List ───────────────────────────────────────────────────────────

export interface DecisionData {
  id: string;
  category: string | null;
  gate: number | null;
  what: string;
  why_now: string | null;
  status: string;
  created_at: string;
}

export function decisionList(decisions: DecisionData[]): HtmlContent {
  if (decisions.length === 0) {
    return emptyState('No pending decisions.', { label: 'Back to Dashboard', href: '/dashboard' });
  }
  return html`
  <div class="card">
    <div class="section-header">
      <h3>Decision Queue</h3>
      <span class="badge badge-elevated">${decisions.length} pending</span>
    </div>
    ${decisions.map((d) => html`
    <a href="/decisions/${d.id}" style="text-decoration:none;color:inherit;">
      <div class="decision-card ${d.category ?? 'product'}">
        <div class="decision-what">${d.what}</div>
        <div class="decision-meta">
          <span>${d.category ?? 'general'}</span>
          <span>Gate ${d.gate ?? 3}</span>
          <span>${formatDate(d.created_at)}</span>
        </div>
      </div>
    </a>`)}
  </div>`;
}

export function decisionDetail(
  decision: Record<string, unknown>,
  scenarios: Array<Record<string, unknown>>,
): HtmlContent {
  const status = decision.status as string;
  return html`
  <div class="card">
    <div class="section-header">
      <h2>${decision.what}</h2>
      <span class="badge badge-${status === 'pending' ? 'elevated' : 'watch'}">${status}</span>
    </div>
    <p>${decision.why_now ?? ''}</p>
    ${decision.recommendation ? html`
    <div style="margin-top:0.75rem;padding:0.75rem;background:#f0f9ff;border-radius:6px;">
      <strong>Recommendation:</strong> ${decision.recommendation}
    </div>` : ''}
    ${decision.options ? optionsList(decision.options as Array<{ label: string; description: string }>) : ''}
  </div>
  ${scenarios.length > 0 ? scenarioCards(scenarios) : ''}
  ${status === 'pending' ? resolveForm(decision.id as string) : ''}`;
}

function optionsList(options: Array<{ label: string; description: string }>): HtmlContent {
  return html`
  <div style="margin-top:1rem;">
    <h3>Options</h3>
    ${options.map((o, i) => html`
    <div style="padding:0.5rem 0;border-bottom:1px solid #f3f4f6;">
      <strong>${i + 1}. ${o.label}</strong>
      <p style="font-size:0.87rem;color:#4b5563;margin:0.25rem 0 0;">${o.description}</p>
    </div>`)}
  </div>`;
}

function scenarioCards(scenarios: Array<Record<string, unknown>>): HtmlContent {
  return html`
  <div class="card">
    <h3>Scenario Models</h3>
    ${scenarios.map((s) => html`
    <details style="margin-bottom:0.75rem;">
      <summary><strong>${s.option_label}</strong></summary>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.5rem;margin-top:0.5rem;">
        <div style="padding:0.75rem;background:#ecfdf5;border-radius:6px;"><strong>Best Case</strong><br/>${summarizeCase(s.best_case)}</div>
        <div style="padding:0.75rem;background:#f0f9ff;border-radius:6px;"><strong>Base Case</strong><br/>${summarizeCase(s.base_case)}</div>
        <div style="padding:0.75rem;background:#fef2f2;border-radius:6px;"><strong>Stress Case</strong><br/>${summarizeCase(s.stress_case)}</div>
      </div>
    </details>`)}
  </div>`;
}

function summarizeCase(caseData: unknown): string {
  if (!caseData) return 'No data';
  try {
    const parsed = typeof caseData === 'string' ? JSON.parse(caseData) : caseData;
    return (parsed as Record<string, unknown>).narrative as string ?? JSON.stringify(parsed).slice(0, 120);
  } catch { return 'No data'; }
}

function resolveForm(decisionId: string): HtmlContent {
  return html`
  <div class="card">
    <h3>Resolve Decision</h3>
    <form method="POST" action="/decisions/${decisionId}/resolve">
      <div class="form-group">
        <label for="chosen_option">Chosen Option</label>
        <input type="text" id="chosen_option" name="chosen_option" required />
      </div>
      <button type="submit" class="btn btn-primary">Resolve</button>
    </form>
  </div>`;
}

// ─── Cohort Table ────────────────────────────────────────────────────────────

export interface CohortData {
  acquisition_period: string;
  acquisition_channel: string | null;
  founder_count: number;
  activated_count: number | null;
  retained_day_7: number | null;
  retained_day_14: number | null;
  retained_day_30: number | null;
  retained_day_60: number | null;
}

export function cohortTable(
  cohorts: CohortData[],
  historicalAvg: { retention_day_7: number | null; retention_day_14: number | null; retention_day_30: number | null } | null,
  byChannel: Record<string, { count: number; avgRetention14: number }> | null,
): HtmlContent {
  if (cohorts.length === 0) {
    return emptyState('No cohort data yet. Cohorts are created as users sign up.');
  }
  return html`
  <div class="card">
    <h3>Cohort Retention</h3>
    <div class="comparison-grid">
      <div class="comp-header">
        <span>Period</span><span>Users</span><span>D7</span><span>D14</span><span>D30</span><span>D60</span>
      </div>
      ${historicalAvg ? html`
      <div class="comp-row" style="background:#f0f9ff;">
        <span><em>Historical Avg</em></span>
        <span>—</span>
        <span>${historicalAvg.retention_day_7 !== null ? historicalAvg.retention_day_7.toFixed(0) + '%' : '—'}</span>
        <span>${historicalAvg.retention_day_14 !== null ? historicalAvg.retention_day_14.toFixed(0) + '%' : '—'}</span>
        <span>${historicalAvg.retention_day_30 !== null ? historicalAvg.retention_day_30.toFixed(0) + '%' : '—'}</span>
        <span>—</span>
      </div>` : ''}
      ${cohorts.map((c) => {
        const fc = c.founder_count || 1;
        return html`
      <div class="comp-row">
        <span>${c.acquisition_period} <span class="text-muted">${c.acquisition_channel ?? ''}</span></span>
        <span>${c.founder_count}</span>
        <span>${c.retained_day_7 !== null ? ((c.retained_day_7 / fc) * 100).toFixed(0) + '%' : '—'}</span>
        <span>${c.retained_day_14 !== null ? ((c.retained_day_14 / fc) * 100).toFixed(0) + '%' : '—'}</span>
        <span>${c.retained_day_30 !== null ? ((c.retained_day_30 / fc) * 100).toFixed(0) + '%' : '—'}</span>
        <span>${c.retained_day_60 !== null ? ((c.retained_day_60 / fc) * 100).toFixed(0) + '%' : '—'}</span>
      </div>`;
      })}
    </div>
  </div>
  ${byChannel ? channelBreakdown(byChannel) : ''}`;
}

function channelBreakdown(byChannel: Record<string, { count: number; avgRetention14: number }>): HtmlContent {
  const entries = Object.entries(byChannel);
  if (entries.length === 0) return html``;
  return html`
  <div class="card">
    <h3>By Channel</h3>
    <div class="metrics-grid">
      ${entries.map(([ch, data]) => html`
      <div class="metric-card">
        <span class="metric-value">${data.avgRetention14.toFixed(0)}%</span>
        <span class="metric-label">${ch} (${data.count} users)</span>
      </div>`)}
    </div>
  </div>`;
}

// ─── Competitive View ────────────────────────────────────────────────────────

export function competitiveView(
  competitors: Array<Record<string, unknown>>,
  signals: Array<Record<string, unknown>>,
  productId: string,
): HtmlContent {
  return html`
  <div class="card">
    <div class="section-header">
      <h3>Competitors</h3>
      <span class="text-muted">${competitors.length} tracked</span>
    </div>
    ${competitors.length === 0
      ? html`<p class="text-muted">No competitors configured.</p>`
      : competitors.map((c) => html`
      <div style="padding:0.5rem 0;border-bottom:1px solid #f3f4f6;display:flex;justify-content:space-between;">
        <div>
          <strong>${c.name}</strong>
          ${c.website ? html` · <a href="${c.website}" target="_blank">${c.website}</a>` : ''}
          ${c.positioning ? html`<br/><span class="text-muted" style="font-size:0.87rem;">${c.positioning}</span>` : ''}
        </div>
        <span class="text-muted" style="font-size:0.8rem;">${c.last_checked ? 'Checked ' + formatDate(c.last_checked as string) : ''}</span>
      </div>`)}
    <form method="POST" action="/products/${productId}/competitors" style="margin-top:1rem;display:flex;gap:0.5rem;">
      <input type="text" name="name" placeholder="Competitor name" class="form-group" style="flex:1;padding:0.4rem 0.75rem;border:1px solid #d1d5db;border-radius:6px;" required />
      <button type="submit" class="btn btn-secondary btn-sm">Add</button>
    </form>
  </div>
  ${signals.length > 0 ? html`
  <div class="card">
    <h3>Recent Signals</h3>
    <div class="stressor-list">
      ${signals.map((s) => html`
      <div class="stressor-item severity-${(s.significance as string) === 'high' ? 'critical' : (s.significance as string) === 'medium' ? 'elevated' : 'watch'}">
        <div class="stressor-header">
          <strong>${s.competitor_name}</strong>
          <span class="badge badge-${(s.significance as string) === 'high' ? 'critical' : (s.significance as string) === 'medium' ? 'elevated' : 'watch'}">${s.significance}</span>
        </div>
        <p class="stressor-signal">${s.signal_summary}</p>
        <div class="stressor-meta">
          <span>${s.signal_type}</span>
          <span>${formatDate(s.detected_at as string)}</span>
        </div>
      </div>`)}
    </div>
  </div>` : html`
  <div class="card">
    <h3>Recent Signals</h3>
    <p class="text-muted">No competitive signals detected recently.</p>
  </div>`}`;
}

// ─── Journey Timeline ────────────────────────────────────────────────────────

export function journeyTimeline(
  artifacts: Array<Record<string, unknown>>,
  productId: string,
): HtmlContent {
  if (artifacts.length === 0) {
    return emptyState('No founding story artifacts yet. They are created as your product progresses through lifecycle prompts.');
  }
  return html`
  <div class="card">
    <h3>Founding Story</h3>
    ${artifacts.map((a) => html`
    <div style="padding:0.75rem 0;border-bottom:1px solid #f3f4f6;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <span class="badge badge-watch">${a.artifact_type}</span>
          <span class="text-muted" style="margin-left:0.5rem;font-size:0.8rem;">${a.phase}</span>
        </div>
        <span class="text-muted" style="font-size:0.8rem;">${formatDate(a.created_at as string)}</span>
      </div>
      <h4 style="margin:0.35rem 0 0.25rem;">${a.title}</h4>
      <div style="display:flex;gap:0.5rem;">
        ${a.published
          ? html`<span class="badge" style="background:#d1fae5;color:#065f46;">Published</span>`
          : html`<form method="POST" action="/products/${productId}/journey/${a.id}/publish" style="display:inline;">
              <button type="submit" class="btn btn-secondary btn-sm">Publish</button>
            </form>`}
      </div>
    </div>`)}
  </div>`;
}

// ─── Digest View ─────────────────────────────────────────────────────────────

export function digestView(digests: Array<{
  product_id: string;
  product_name: string;
  risk_state: { state: string; reason: string; changed_at: string | null };
  stressors: Array<{ name: string; signal: string; timeframe_days: number; neutralizing_action: string; severity: string }>;
  mrr: { new_cents: number; expansion_cents: number; contraction_cents: number; churned_cents: number; total_cents: number; health_ratio: number | null };
  mrr_health: { value: number; indicator: string };
  metrics: Record<string, unknown> | null;
  cohort_snapshot: Record<string, unknown> | null;
  generated_at: string;
}>): HtmlContent {
  if (digests.length === 0) {
    return emptyState('No digest data available.', { label: 'Back to Dashboard', href: '/dashboard' });
  }
  return html`
  ${digests.map((d) => html`
  <div style="margin-bottom:2rem;">
    <div class="section-header">
      <h2>${d.product_name}</h2>
      <span class="text-muted">Generated ${formatDate(d.generated_at)}</span>
    </div>
    ${riskStateBadge(d.risk_state.state, d.risk_state.reason, d.risk_state.changed_at)}
    ${stressorReport(d.stressors)}
    ${mrrDecomposition(d.mrr, d.mrr_health.indicator)}
    ${d.metrics ? metricsGrid(d.metrics) : ''}
  </div>`)}`;
}

// ─── Settings Page ───────────────────────────────────────────────────────────

export function settingsPage(
  founder: { id: string; email: string; name: string | null; tier: string | null },
  connectedRepos: Array<Record<string, unknown>>,
  competitors: Array<Record<string, unknown>>,
): HtmlContent {
  return html`
  <div class="card">
    <h3>Profile</h3>
    <p><strong>Name:</strong> ${founder.name ?? 'Not set'}</p>
    <p><strong>Email:</strong> ${founder.email}</p>
    <p><strong>Tier:</strong> <span class="badge badge-watch">${founder.tier ?? 'Free'}</span></p>
  </div>
  <div class="card">
    <h3>Connected Repositories</h3>
    ${connectedRepos.length === 0
      ? html`<p class="text-muted">No repositories connected.</p>`
      : connectedRepos.map((r) => html`
      <div style="padding:0.35rem 0;border-bottom:1px solid #f3f4f6;">
        <strong>${r.name}</strong>
        ${r.github_repo_url ? html` · <a href="${r.github_repo_url}" target="_blank">${r.github_repo_url}</a>` : ''}
      </div>`)}
  </div>
  <div class="card">
    <h3>Competitors</h3>
    ${competitors.length === 0
      ? html`<p class="text-muted">No competitors configured.</p>`
      : competitors.map((c) => html`
      <div style="padding:0.35rem 0;border-bottom:1px solid #f3f4f6;">
        <strong>${c.name}</strong>
        ${c.website ? html` · <a href="${c.website}" target="_blank">${c.website}</a>` : ''}
      </div>`)}
  </div>`;
}

// ─── Beta Status ─────────────────────────────────────────────────────────────

export function betaStatus(
  intakes: Array<Record<string, unknown>>,
  totalCount: number,
): HtmlContent {
  return html`
  <div class="card">
    <div class="section-header">
      <h3>Beta Infrastructure</h3>
      <span class="badge badge-watch">${totalCount} intakes</span>
    </div>
    ${intakes.length === 0
      ? html`<p class="text-muted">No beta intake submissions yet.</p>`
      : intakes.map((i) => html`
      <div style="padding:0.5rem 0;border-bottom:1px solid #f3f4f6;">
        <strong>${i.participant_name}</strong>
        <span class="text-muted" style="margin-left:0.5rem;font-size:0.8rem;">${formatDate(i.created_at as string)}</span>
      </div>`)}
  </div>`;
}

// ─── Onboarding Steps ────────────────────────────────────────────────────────

export function onboardingWizard(
  step: 'connect_github' | 'select_repo' | 'identify_competitors' | 'running_audit' | 'complete',
  data: Record<string, unknown>,
): HtmlContent {
  const steps = [
    { key: 'connect_github', label: 'Connect GitHub', number: 1 },
    { key: 'select_repo', label: 'Select Repository', number: 2 },
    { key: 'identify_competitors', label: 'Identify Competitors', number: 3 },
    { key: 'running_audit', label: 'First Audit', number: 4 },
  ];
  const currentIdx = steps.findIndex((s) => s.key === step);

  return html`
  <div class="onboarding-steps">
    <div style="display:flex;gap:0.5rem;margin-bottom:2rem;justify-content:center;">
      ${steps.map((s, i) => html`
      <div style="display:flex;align-items:center;gap:0.25rem;">
        <span class="step-number" style="${i < currentIdx ? 'background:#059669;' : i === currentIdx ? '' : 'background:#d1d5db;'}">${s.number}</span>
        <span style="font-size:0.8rem;${i === currentIdx ? 'font-weight:600;' : 'color:#6b7280;'}">${s.label}</span>
        ${i < steps.length - 1 ? html`<span style="color:#d1d5db;margin:0 0.25rem;">→</span>` : ''}
      </div>`)}
    </div>
    ${step === 'connect_github' ? onboardingGitHub(data.github_oauth_url as string) : ''}
    ${step === 'select_repo' ? onboardingRepoSelect(data.repos as Array<Record<string, unknown>>, data._token as string) : ''}
    ${step === 'identify_competitors' ? onboardingCompetitors(data.product_id as string) : ''}
    ${step === 'running_audit' ? onboardingRunAudit(data.product_id as string) : ''}
    ${step === 'complete' ? onboardingComplete(data.audit as Record<string, unknown>) : ''}
  </div>`;
}

function onboardingGitHub(githubUrl: string): HtmlContent {
  return html`
  <div class="step-card">
    <h2><span class="step-number">1</span> Connect GitHub</h2>
    <p>Foundry reads your codebase to run a ten-dimension product audit. We need read-only access to your repository.</p>
    <a href="${githubUrl}" class="btn btn-primary" style="margin-top:1rem;">Connect GitHub →</a>
  </div>`;
}

function onboardingRepoSelect(repos: Array<Record<string, unknown>>, token: string): HtmlContent {
  return html`
  <div class="step-card">
    <h2><span class="step-number">2</span> Select Repository</h2>
    <p>Choose the repository for your product's first audit.</p>
    ${repos.map((r) => html`
    <form method="POST" action="/onboarding/select-repo" style="display:inline;">
      <input type="hidden" name="repo_owner" value="${r.owner}" />
      <input type="hidden" name="repo_name" value="${r.name}" />
      <input type="hidden" name="access_token" value="${token}" />
      <button type="submit" class="btn btn-secondary" style="margin:0.25rem;">${r.full_name ?? r.name}</button>
    </form>`)}
  </div>`;
}

function onboardingCompetitors(productId: string): HtmlContent {
  return html`
  <div class="step-card">
    <h2><span class="step-number">3</span> Identify Competitors</h2>
    <p>Name up to 5 competitors so Foundry can monitor the competitive landscape.</p>
    <form method="POST" action="/onboarding/competitors">
      <input type="hidden" name="product_id" value="${productId}" />
      <div class="form-group">
        <label>Competitor 1</label>
        <input type="text" name="competitors[0].name" placeholder="Company name" />
      </div>
      <div class="form-group">
        <label>Competitor 2</label>
        <input type="text" name="competitors[1].name" placeholder="Company name" />
      </div>
      <div class="form-group">
        <label>Competitor 3</label>
        <input type="text" name="competitors[2].name" placeholder="Company name" />
      </div>
      <button type="submit" class="btn btn-primary">Continue</button>
      <a href="/onboarding/run-audit?product_id=${productId}" class="btn btn-secondary" style="margin-left:0.5rem;">Skip</a>
    </form>
  </div>`;
}

function onboardingRunAudit(productId: string): HtmlContent {
  return html`
  <div class="step-card">
    <h2><span class="step-number">4</span> Run First Audit</h2>
    <p>Foundry will analyze your codebase across ten dimensions. This usually takes 2-5 minutes.</p>
    <form method="POST" action="/onboarding/run-audit">
      <input type="hidden" name="product_id" value="${productId}" />
      <button type="submit" class="btn btn-primary">Run Audit →</button>
    </form>
  </div>`;
}

function onboardingComplete(audit: Record<string, unknown>): HtmlContent {
  const composite = audit?.composite as number | null;
  const verdict = audit?.verdict as string | null;
  return html`
  <div class="step-card completed">
    <h2>Audit Complete</h2>
    ${composite !== null ? html`
    <div class="audit-summary" style="justify-content:center;margin:1.5rem 0;">
      <div class="audit-composite">
        <span class="composite-score">${composite.toFixed(1)}</span>
        <span class="composite-label">Composite Score</span>
      </div>
      <span class="verdict-badge ${verdict === 'READY' ? 'verdict-ready' : verdict === 'READY WITH CONDITIONS' ? 'verdict-conditions' : 'verdict-not-ready'}">${verdict}</span>
    </div>` : ''}
    <a href="/dashboard" class="btn btn-primary">Go to Dashboard →</a>
  </div>`;
}

// ─── Lifecycle Conditions ────────────────────────────────────────────────────

export function lifecycleConditions(
  conditions: Array<Record<string, unknown>>,
): HtmlContent {
  if (conditions.length === 0) {
    return html`<p class="text-muted">No activation conditions recorded yet.</p>`;
  }
  return html`
  <div class="card">
    <h3>Activation Conditions</h3>
    ${conditions.map((c) => html`
    <div style="padding:0.5rem 0;border-bottom:1px solid #f3f4f6;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <strong>${c.condition_key}</strong>
        <span class="text-muted" style="margin-left:0.5rem;font-size:0.8rem;">${c.prompt}</span>
      </div>
      <span class="badge ${c.met ? 'badge-watch' : ''}" style="${c.met ? 'background:#d1fae5;color:#065f46;' : ''}">${c.met ? 'Met' : 'Pending'}</span>
    </div>`)}
  </div>`;
}

// ─── Koldly Integration ──────────────────────────────────────────────────────

// ─── UX Intelligence Components ──────────────────────────────────────────────

export function nextActionCard(action: NextAction): HtmlContent {
  if (action.urgency === 'positive') {
    return html`
    <div class="card" style="background:#f0fdf4;border-color:#bbf7d0;">
      <p style="font-size:0.9rem;color:#065f46;margin:0;"><strong>${action.headline}</strong></p>
      <p style="font-size:0.85rem;color:#047857;margin:0.25rem 0 0;">${action.subtext}</p>
    </div>`;
  }
  const bgMap = { critical: '#fef2f2', elevated: '#fffbeb', normal: '#f8fafc' };
  const borderMap = { critical: '#fecaca', elevated: '#fde68a', normal: '#e2e5ea' };
  return html`
  <div class="card" style="background:${bgMap[action.urgency]};border-color:${borderMap[action.urgency]};">
    <div style="display:flex;align-items:center;gap:12px;">
      <div style="flex:1;">
        <p style="font-weight:600;margin:0;">${action.headline}</p>
        <p style="font-size:0.87rem;color:#4b5563;margin:0.25rem 0 0;">${action.subtext}</p>
      </div>
      ${action.action_url ? html`<a href="${action.action_url}" class="btn ${action.urgency === 'critical' ? 'btn-danger' : 'btn-primary'} btn-sm">${action.action_label}</a>` : ''}
    </div>
  </div>`;
}

export function tourOverlay(
  step: TourStep,
  stepData: Record<string, string>,
  totalSteps: number,
  founderId: string,
  bodyText: string,
): HtmlContent {
  const currentStep = step.step;
  return html`
  <div class="tour-backdrop"></div>
  <div class="tour-card">
    <div class="tour-headline">${step.headline}</div>
    <div class="tour-body">${bodyText}</div>
    <div class="tour-controls">
      <div class="tour-progress">
        ${Array.from({ length: totalSteps }, (_, i) =>
          html`<span class="tour-dot ${i + 1 === currentStep ? 'active' : ''}"></span>`
        )}
      </div>
      ${currentStep > 1 ? html`
      <form method="POST" action="/api/tour/back" style="display:inline;">
        <input type="hidden" name="step" value="${currentStep}" />
        <button type="submit" class="btn btn-secondary btn-sm">Back</button>
      </form>` : ''}
      <form method="POST" action="/api/tour/advance" style="display:inline;">
        <input type="hidden" name="step" value="${currentStep}" />
        <button type="submit" class="btn btn-primary btn-sm">${currentStep === totalSteps ? 'Finish' : 'Next'}</button>
      </form>
      <form method="POST" action="/api/tour/skip" style="display:inline;">
        <button type="submit" class="btn btn-secondary btn-sm" style="font-size:0.75rem;opacity:0.7;">Skip</button>
      </form>
    </div>
  </div>
  <script>document.querySelector('${step.target_selector}')?.classList.add('tour-highlight');</script>`;
}

export function milestoneToastScript(milestones: MilestoneEvent[]): HtmlContent {
  if (milestones.length === 0) return html``;
  const toasts = milestones.map((m) => ({
    key: m.milestone_key,
    title: m.milestone_title,
    body: m.milestone_description,
  }));
  return html`
  <script>
  (function() {
    var toasts = ${JSON.stringify(toasts)};
    var delay = 0;
    toasts.forEach(function(t) {
      if (sessionStorage.getItem('ms_' + t.key)) return;
      sessionStorage.setItem('ms_' + t.key, '1');
      setTimeout(function() {
        var el = document.createElement('div');
        el.className = 'milestone-toast';
        el.innerHTML = '<div class="milestone-toast-title">\uD83C\uDFC6 ' + t.title + '</div><div class="milestone-toast-body">' + t.body + '</div>';
        document.body.appendChild(el);
        setTimeout(function() { el.style.opacity = '0'; el.style.transition = 'opacity 0.5s'; setTimeout(function() { el.remove(); }, 500); }, 8000);
      }, delay);
      delay += 1000;
    });
  })();
  </script>`;
}

export function gatedFeatureCard(feature: FeatureGateConfig, currentTier: string | null): HtmlContent {
  return html`
  <div class="card" style="background:#f9fafb;border-color:#e2e5ea;position:relative;">
    <span style="position:absolute;top:12px;right:12px;font-size:14px;">\uD83D\uDD12</span>
    <h3>${feature.name}</h3>
    <p style="font-size:0.87rem;color:#4b5563;">${feature.description}</p>
    ${feature.upgradeMessage ? html`<div class="gate-upgrade-message" style="margin-top:0.75rem;">${feature.upgradeMessage}</div>` : ''}
    <a href="/settings" class="btn btn-primary btn-sm" style="margin-top:0.75rem;">Upgrade to Scale</a>
  </div>`;
}

export function dimensionRowWithHint(
  dimensionKey: string,
  dimensionName: string,
  weight: number,
  score: number | null,
  hint: string | null,
): HtmlContent {
  const scoreClass = score === null ? '' : score >= 7 ? 'score-good' : score >= 5 ? 'score-warn' : 'score-bad';
  return html`
  <div class="dimension-row ${scoreClass}">
    <span class="dim-name">
      <span class="dim-hint-wrapper">
        ${dimensionName}
        ${hint ? html`<span class="dim-hint-icon">ⓘ</span><span class="dim-hint-tooltip">${hint}</span>` : ''}
      </span>
    </span>
    <span class="dim-weight">${(weight * 100).toFixed(0)}%</span>
    <div class="dim-bar-track">
      <div class="dim-bar-fill" style="width: ${(score ?? 0) * 10}%"></div>
    </div>
    <span class="dim-score">${score ?? '\u2014'}</span>
  </div>`;
}

export function emptyStateWithHint(hint: PageHint | null, fallbackMessage: string, action?: { label: string; href: string }): HtmlContent {
  if (hint) {
    return html`
    <div class="empty-state">
      <h3 style="font-size:1rem;margin-bottom:0.5rem;">${hint.headline}</h3>
      <p style="max-width:480px;margin:0 auto 1rem;">${hint.body}</p>
      ${hint.action_url ? html`<a href="${hint.action_url}" class="btn btn-primary">${hint.action_label}</a>` : ''}
    </div>`;
  }
  return emptyState(fallbackMessage, action);
}

export function auditRunButton(productId: string): HtmlContent {
  return html`
  <form method="POST" action="/products/${productId}/audit/run" style="display:inline;">
    <button type="submit" class="btn btn-primary btn-sm" onclick="this.style.pointerEvents='none';this.style.opacity='0.5';">Run New Audit</button>
  </form>`;
}

export function pageHintBanner(hints: PageHint[]): HtmlContent {
  if (hints.length === 0) return html``;
  return html`${hints.map((h) => {
    const bgMap: Record<string, string> = { warning: '#fffbeb', tip: '#f0fdf4', contextual: '#f0f9ff', empty_state: '#f8fafc' };
    const borderMap: Record<string, string> = { warning: '#fde68a', tip: '#bbf7d0', contextual: '#bae6fd', empty_state: '#e2e5ea' };
    return html`
    <div style="padding:0.75rem 1rem;background:${bgMap[h.type] ?? '#f8fafc'};border:1px solid ${borderMap[h.type] ?? '#e2e5ea'};border-radius:6px;margin-bottom:0.75rem;font-size:0.87rem;">
      <strong>${h.headline}</strong>
      <p style="margin:0.25rem 0 0;color:#4b5563;">${h.body}</p>
      ${h.action_url ? html`<a href="${h.action_url}" style="font-size:0.8rem;">${h.action_label}</a>` : ''}
    </div>`;
  })}`;
}

export function milestoneTimeline(milestones: MilestoneEvent[]): HtmlContent {
  if (milestones.length === 0) return html``;
  return html`
  <div class="card">
    <h3>Milestones</h3>
    ${milestones.map((m) => html`
    <div style="padding:0.5rem 0;border-bottom:1px solid #f3f4f6;display:flex;align-items:center;gap:0.75rem;">
      <span style="font-size:1.2rem;">\uD83C\uDFC6</span>
      <div style="flex:1;">
        <strong style="font-size:0.9rem;">${m.milestone_title}</strong>
        <p style="font-size:0.8rem;color:#6b7280;margin:0.15rem 0 0;">${m.milestone_description}</p>
      </div>
      <span style="font-size:0.75rem;color:#9ca3af;white-space:nowrap;">${formatDate(m.created_at)}</span>
    </div>`)}
  </div>`;
}

export function koldlySetup(
  endpoints: Array<{ path: string; description: string }>,
): HtmlContent {
  return html`
  <div class="card">
    <h3>Koldly Integration</h3>
    <p>Connect Foundry intelligence to Koldly's outbound engine for ICP-targeted campaigns.</p>
    <h4 style="margin-top:1rem;">Available Endpoints</h4>
    ${endpoints.map((e) => html`
    <div style="padding:0.5rem 0;border-bottom:1px solid #f3f4f6;">
      <code>${e.path}</code>
      <span class="text-muted" style="margin-left:0.5rem;font-size:0.87rem;">${e.description}</span>
    </div>`)}
  </div>`;
}

// ─── Dashboard Summary Card ──────────────────────────────────────────────────

export function dashboardSummaryCard(
  label: string,
  value: string | number,
  href: string,
): HtmlContent {
  return html`
  <a href="${href}" style="text-decoration:none;color:inherit;">
    <div class="metric-card" style="cursor:pointer;">
      <span class="metric-value">${value}</span>
      <span class="metric-label">${label}</span>
    </div>
  </a>`;
}

// ─── Wisdom Layer Components ─────────────────────────────────────────────────

export interface DNASection {
  key: string;
  label: string;
  value: string | null;
  placeholder: string;
  type: 'text' | 'textarea';
}

const DNA_SECTIONS: DNASection[] = [
  { key: 'icp_description', label: 'ICP Description', value: null, placeholder: 'Who is your ideal customer? Be specific.', type: 'textarea' },
  { key: 'icp_pain', label: 'ICP Pain', value: null, placeholder: 'What specific pain does your product solve?', type: 'textarea' },
  { key: 'icp_trigger', label: 'ICP Trigger', value: null, placeholder: 'What event causes someone to seek a solution?', type: 'text' },
  { key: 'icp_sophistication', label: 'ICP Sophistication', value: null, placeholder: 'How technically sophisticated is your buyer?', type: 'text' },
  { key: 'positioning_statement', label: 'Positioning Statement', value: null, placeholder: 'Your current positioning statement.', type: 'textarea' },
  { key: 'what_we_are_not', label: 'What We Are Not', value: null, placeholder: 'Explicit anti-positioning — what your product deliberately avoids being.', type: 'textarea' },
  { key: 'primary_objection', label: 'Primary Objection', value: null, placeholder: 'The #1 objection prospects raise.', type: 'text' },
  { key: 'objection_response', label: 'Objection Response', value: null, placeholder: 'How you counter the primary objection.', type: 'textarea' },
  { key: 'market_insight', label: 'Market Insight', value: null, placeholder: 'A non-obvious belief about your market.', type: 'textarea' },
  { key: 'retention_hypothesis', label: 'Retention Hypothesis', value: null, placeholder: 'Why do users keep coming back?', type: 'textarea' },
];

export function dnaEditor(
  dna: Record<string, unknown> | null,
  completionPct: number,
  productId: string,
): HtmlContent {
  const milestoneReached = completionPct >= 60;
  const barColor = milestoneReached ? '#059669' : '#3b82f6';

  return html`
  <div class="card">
    <div class="section-header">
      <h3>Product DNA</h3>
      ${wisdomContextBadge(milestoneReached, completionPct, 0, 0)}
    </div>
    <div style="margin-bottom:1.5rem;">
      <div style="display:flex;justify-content:space-between;font-size:0.8rem;margin-bottom:0.25rem;">
        <span>Completion</span>
        <span style="font-weight:600;">${completionPct}%</span>
      </div>
      <div style="background:#e5e7eb;border-radius:4px;height:8px;overflow:hidden;">
        <div style="background:${barColor};height:100%;width:${completionPct}%;transition:width 0.3s;"></div>
      </div>
      ${completionPct < 60 ? html`<p style="font-size:0.8rem;color:#6b7280;margin-top:0.5rem;">Reach 60% to activate the Wisdom Layer — Foundry will score against <em>your</em> ICP and positioning instead of generic best practices.</p>` : ''}
      ${milestoneReached ? html`<p style="font-size:0.8rem;color:#059669;margin-top:0.5rem;">✓ Wisdom Layer active — audit scoring now uses your product DNA.</p>` : ''}
    </div>
    <form method="POST" action="/products/${productId}/dna">
      ${DNA_SECTIONS.map((s) => {
        const current = dna ? (dna[s.key] as string | null) : null;
        const filled = current !== null && current !== '';
        return html`
        <div class="form-group" style="margin-bottom:1rem;">
          <label style="display:flex;align-items:center;gap:0.5rem;">
            <span style="color:${filled ? '#059669' : '#d1d5db'};">${filled ? '●' : '○'}</span>
            ${s.label}
          </label>
          ${s.type === 'textarea'
            ? html`<textarea name="${s.key}" placeholder="${s.placeholder}" rows="3" style="width:100%;padding:0.5rem 0.75rem;border:1px solid #d1d5db;border-radius:6px;font-size:0.87rem;">${current ?? ''}</textarea>`
            : html`<input type="text" name="${s.key}" value="${current ?? ''}" placeholder="${s.placeholder}" style="width:100%;padding:0.5rem 0.75rem;border:1px solid #d1d5db;border-radius:6px;" />`}
        </div>`;
      })}
      <button type="submit" class="btn btn-primary">Save DNA</button>
    </form>
  </div>`;
}

export function wisdomContextBadge(
  wisdomActive: boolean,
  completionPct: number,
  patternsCount: number,
  failuresCount: number,
): HtmlContent {
  if (!wisdomActive) {
    return html`<span class="badge" style="background:#f3f4f6;color:#6b7280;">Wisdom: ${completionPct}%</span>`;
  }
  return html`<span class="badge" style="background:#d1fae5;color:#065f46;">Wisdom Active · ${patternsCount}P · ${failuresCount}F</span>`;
}

export function remediationStatusBadge(status: string): HtmlContent {
  const styles: Record<string, string> = {
    generating: 'background:#fef3c7;color:#92400e;',
    pr_open: 'background:#dbeafe;color:#1e40af;',
    merged: 'background:#d1fae5;color:#065f46;',
    rejected: 'background:#fee2e2;color:#991b1b;',
    failed: 'background:#fee2e2;color:#991b1b;',
    skipped: 'background:#f3f4f6;color:#6b7280;',
  };
  return html`<span class="badge" style="${styles[status] ?? ''}">${status.replace('_', ' ')}</span>`;
}

export function remediationSummaryCard(
  stats: import('../types/index.js').RemediationStats,
): HtmlContent {
  const delta = stats.composite_before !== null && stats.composite_after !== null
    ? stats.composite_after - stats.composite_before
    : null;
  return html`
  <div class="card">
    <h3>Remediation Summary</h3>
    <div class="metrics-grid">
      ${metricCard('Total Issues', stats.total_issues, 'number')}
      ${metricCard('Auto-fixable', stats.auto_count, 'number')}
      ${metricCard('Wisdom Required', stats.wisdom_required_count, 'number')}
      ${metricCard('Human Only', stats.human_only_count, 'number')}
    </div>
    <div class="metrics-grid" style="margin-top:0.75rem;">
      ${metricCard('PRs Open', stats.prs_open, 'number')}
      ${metricCard('PRs Merged', stats.prs_merged, 'number')}
      ${metricCard('PRs Skipped', stats.prs_skipped, 'number')}
      ${metricCard('PRs Failed', stats.prs_failed, 'number')}
    </div>
    ${delta !== null ? html`
    <div style="margin-top:0.75rem;padding:0.75rem;background:${delta >= 0 ? '#ecfdf5' : '#fef2f2'};border-radius:6px;text-align:center;">
      <strong>Composite Delta:</strong> <span style="color:${delta >= 0 ? '#059669' : '#dc2626'};">${delta > 0 ? '+' : ''}${delta.toFixed(1)}</span>
    </div>` : ''}
  </div>`;
}

export function failureLogView(
  failures: Array<Record<string, unknown>>,
  productId: string,
): HtmlContent {
  const categories = ['positioning', 'pricing', 'onboarding', 'acquisition', 'retention', 'messaging', 'feature', 'operations', 'other'];
  return html`
  <div class="card">
    <div class="section-header">
      <h3>Failure Log</h3>
      <span class="text-muted">${failures.length} recorded</span>
    </div>
    ${failures.length === 0
      ? html`<p class="text-muted">No failures logged yet. Recording failures helps Foundry avoid recommending approaches that have already been tried.</p>`
      : failures.map((f) => html`
      <div style="padding:0.75rem 0;border-bottom:1px solid #f3f4f6;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span class="badge badge-watch">${f.category}</span>
          <span class="text-muted" style="font-size:0.8rem;">${formatDate(f.created_at as string)}</span>
        </div>
        <p style="margin:0.35rem 0 0.25rem;font-weight:500;">${f.what_was_tried}</p>
        <p style="font-size:0.87rem;color:#4b5563;margin:0;">${f.outcome}</p>
        ${f.founder_hypothesis ? html`<p style="font-size:0.8rem;color:#6b7280;margin:0.25rem 0 0;font-style:italic;">Hypothesis: ${f.founder_hypothesis}</p>` : ''}
      </div>`)}
  </div>
  <div class="card">
    <h3>Record a Failure</h3>
    <form method="POST" action="/products/${productId}/failures">
      <div class="form-group">
        <label>Category</label>
        <select name="category" required style="width:100%;padding:0.5rem 0.75rem;border:1px solid #d1d5db;border-radius:6px;">
          ${categories.map((c) => html`<option value="${c}">${c}</option>`)}
        </select>
      </div>
      <div class="form-group">
        <label>What was tried?</label>
        <textarea name="what_was_tried" required rows="2" style="width:100%;padding:0.5rem 0.75rem;border:1px solid #d1d5db;border-radius:6px;" placeholder="Describe the approach you tried."></textarea>
      </div>
      <div class="form-group">
        <label>Timeframe</label>
        <input type="text" name="timeframe" placeholder="e.g. 2 weeks, Q3 2024" style="width:100%;padding:0.5rem 0.75rem;border:1px solid #d1d5db;border-radius:6px;" />
      </div>
      <div class="form-group">
        <label>Outcome</label>
        <textarea name="outcome" required rows="2" style="width:100%;padding:0.5rem 0.75rem;border:1px solid #d1d5db;border-radius:6px;" placeholder="What happened? Why did it fail?"></textarea>
      </div>
      <div class="form-group">
        <label>Your Hypothesis (optional)</label>
        <textarea name="founder_hypothesis" rows="2" style="width:100%;padding:0.5rem 0.75rem;border:1px solid #d1d5db;border-radius:6px;" placeholder="Why do you think it failed?"></textarea>
      </div>
      <button type="submit" class="btn btn-primary">Log Failure</button>
    </form>
  </div>`;
}

export function judgmentPatternsView(
  patterns: Array<Record<string, unknown>>,
  productId: string,
): HtmlContent {
  return html`
  <div class="card">
    <div class="section-header">
      <h3>Judgment Patterns</h3>
      <span class="text-muted">${patterns.length} detected</span>
    </div>
    ${patterns.length === 0
      ? html`<p class="text-muted">No judgment patterns synthesized yet. Resolve 3+ Gate 3 decisions with reasoning to enable pattern synthesis.</p>`
      : patterns.map((p) => html`
      <div style="padding:0.75rem 0;border-bottom:1px solid #f3f4f6;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <span class="badge badge-watch">${p.category}</span>
            <span style="margin-left:0.5rem;font-size:0.8rem;color:#6b7280;">Confidence: ${((p.confidence as number) * 100).toFixed(0)}% · Observed ${p.times_observed}×</span>
          </div>
          ${!(p.invalidated as boolean) ? html`
          <form method="POST" action="/products/${productId}/patterns/${p.id}/invalidate" style="display:inline;">
            <button type="submit" class="btn btn-secondary btn-sm" style="font-size:0.75rem;">Invalidate</button>
          </form>` : html`<span class="text-muted" style="font-size:0.8rem;">Invalidated</span>`}
        </div>
        <p style="margin:0.35rem 0 0;">${p.pattern_description}</p>
      </div>`)}
  </div>`;
}

export function failureCapturePrompt(
  stressorName: string,
  productId: string,
  stressorId: string,
): HtmlContent {
  return html`
  <div class="card" style="border-left:3px solid #f59e0b;">
    <h4 style="margin:0 0 0.5rem;">💡 Have you tried addressing "${stressorName}" before?</h4>
    <p style="font-size:0.87rem;color:#4b5563;margin:0 0 0.75rem;">Recording past attempts helps Foundry avoid suggesting approaches that didn't work.</p>
    <a href="/products/${productId}/failures?linked_stressor=${stressorId}" class="btn btn-secondary btn-sm">Log What You Tried</a>
  </div>`;
}

export function remediationPRList(
  prs: Array<Record<string, unknown>>,
): HtmlContent {
  if (prs.length === 0) {
    return html`
    <div class="card">
      <h3>Remediation Pull Requests</h3>
      <p class="text-muted">No remediation PRs have been generated yet. Run an audit to trigger automated fixes.</p>
    </div>`;
  }
  return html`
  <div class="card">
    <h3>Remediation Pull Requests</h3>
    ${prs.map((pr) => html`
    <div style="padding:0.75rem 0;border-bottom:1px solid #f3f4f6;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <strong>${pr.blocking_issue_id}</strong>
          <span class="text-muted" style="margin-left:0.5rem;font-size:0.87rem;">${pr.blocking_issue_dimension}</span>
        </div>
        ${remediationStatusBadge(pr.status as string)}
      </div>
      <p style="margin:0.35rem 0;font-size:0.87rem;">${pr.fix_summary ?? pr.blocking_issue_summary}</p>
      ${pr.github_pr_url ? html`<a href="${pr.github_pr_url}" target="_blank" style="font-size:0.8rem;">View PR #${pr.github_pr_number} →</a>` : ''}
      ${pr.skipped_reason ? html`<p style="font-size:0.8rem;color:#6b7280;margin:0.25rem 0 0;">Skipped: ${pr.skipped_reason}</p>` : ''}
      ${pr.post_fix_dimension_score !== null && pr.pre_fix_dimension_score !== null ? html`
      <div style="font-size:0.8rem;margin-top:0.25rem;">
        Score: ${pr.pre_fix_dimension_score} → ${pr.post_fix_dimension_score}
        <span style="color:${(pr.post_fix_dimension_score as number) > (pr.pre_fix_dimension_score as number) ? '#059669' : '#dc2626'};">
          (${(pr.post_fix_dimension_score as number) > (pr.pre_fix_dimension_score as number) ? '+' : ''}${((pr.post_fix_dimension_score as number) - (pr.pre_fix_dimension_score as number)).toFixed(1)})
        </span>
      </div>` : ''}
    </div>`)}
  </div>`;
}
