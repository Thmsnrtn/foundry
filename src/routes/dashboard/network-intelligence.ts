// =============================================================================
// FOUNDRY — Network Intelligence
// Cohort failure patterns, richer benchmark percentiles, and anonymized
// pattern library — collective intelligence from the Foundry network.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import { requireCompanyCapability } from '../../middleware/rbac.js';
import {
  getCohortPatterns,
  getCohortBenchmarks,
  getProductCohortProfile,
  seedDefaultCohortPatterns,
} from '../../services/network/cohort-patterns.js';
import {
  scanForFailurePatterns,
  getActivePatternMatches,
  getAllFailurePatterns,
  resolvePattern,
  type PatternMatch,
} from '../../services/network/failure-library.js';

export const networkIntelligence = new Hono<AuthEnv>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#ff4444',
  high: '#ff8c42',
  medium: '#ffb347',
  low: '#4ecca3',
};

const SEVERITY_BG: Record<string, string> = {
  critical: 'rgba(255,68,68,0.08)',
  high: 'rgba(255,140,66,0.08)',
  medium: 'rgba(255,179,71,0.08)',
  low: 'rgba(78,204,163,0.08)',
};

function trendArrow(trend: 'improving' | 'declining' | 'stable'): string {
  if (trend === 'improving') return '↑';
  if (trend === 'declining') return '↓';
  return '→';
}

function trendColor(trend: 'improving' | 'declining' | 'stable'): string {
  if (trend === 'improving') return '#4ecca3';
  if (trend === 'declining') return '#ff6b6b';
  return 'var(--text-muted)';
}

function fmtScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}

/**
 * TWO SCALES, ONE FORMATTER, ONE PER CENT SIGN.
 *
 * `churn_rate`, `activation_rate` and `day_30_retention` are stored as 0–1
 * FRACTIONS; `mrr_growth_rate` is computed in this module as a percentage
 * already multiplied by 100; `nps_score` is on its own -100..100 scale. This
 * printed all of them as `value.toFixed(1)%`, so a company churning five per
 * cent a month read "0.1%" on its own cohort page — a number a founder would
 * take as extraordinary retention.
 */
const FRACTION_METRICS = new Set(['churn_rate', 'activation_rate', 'day_30_retention']);

/** Exposed for the test that holds the two scales apart. */
export const __fmtMetricForTest = (v: number | null, m: string): string => fmtMetric(v, m);

function fmtMetric(value: number | null, metric: string): string {
  if (value === null || value === undefined) return '—';
  if (metric === 'nps_score') return value.toFixed(0);
  if (FRACTION_METRICS.has(metric)) return `${(value * 100).toFixed(1)}%`;
  return `${value.toFixed(1)}%`;
}

function percentileBar(pct: number | null): string {
  const pos = pct ?? 50;
  const color = pos >= 75 ? '#4ecca3' : pos >= 50 ? '#7c83fd' : pos >= 25 ? '#ffb347' : '#ff6b6b';
  return `<div style="position:relative;background:rgba(255,255,255,0.06);border-radius:4px;height:8px;overflow:visible;">
    <div style="position:absolute;top:-3px;bottom:-3px;left:25%;width:1px;background:rgba(255,255,255,0.15);"></div>
    <div style="position:absolute;top:-3px;bottom:-3px;left:50%;width:1px;background:rgba(255,255,255,0.25);"></div>
    <div style="position:absolute;top:-3px;bottom:-3px;left:75%;width:1px;background:rgba(255,255,255,0.15);"></div>
    ${pct !== null ? `<div style="position:absolute;top:50%;left:${pos}%;transform:translate(-50%,-50%);width:12px;height:12px;border-radius:50%;background:${color};border:2px solid var(--bg-card);z-index:1;"></div>` : ''}
  </div>`;
}

function renderPatternAlert(match: PatternMatch, productId: string): string {
  const color = SEVERITY_COLOR[match.pattern.severity] ?? '#ffb347';
  const bg = SEVERITY_BG[match.pattern.severity] ?? 'rgba(255,179,71,0.08)';
  const matchId = `pm_${productId}_${match.pattern.id}`;

  const signalsHtml = match.matched_signals
    .map((s) => `<li style="margin-bottom:0.25rem;color:var(--text-dim);">${s}</li>`)
    .join('');

  const actionsHtml = match.recommended_actions
    .map((a) => `<li style="margin-bottom:0.25rem;color:var(--text-dim);">${a}</li>`)
    .join('');

  const daysNote = match.days_until_typical_failure !== null
    ? `<span style="font-size:0.72rem;color:var(--text-muted);margin-left:0.5rem;">~${match.days_until_typical_failure}d lead time</span>`
    : '';

  return `<div class="card" style="padding:1.25rem;margin-bottom:0.75rem;border-left:3px solid ${color};background:${bg};">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:0.75rem;flex-wrap:wrap;">
      <div>
        <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.25rem;">
          <span style="font-size:0.7rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${color};background:${bg};padding:0.15rem 0.5rem;border-radius:3px;border:1px solid ${color}33;">${match.pattern.severity.toUpperCase()}</span>
          <span style="font-weight:700;color:var(--text-primary);">${match.pattern.pattern_name}</span>
          ${daysNote}
        </div>
        <p style="margin:0;font-size:0.82rem;color:var(--text-muted);max-width:600px;">${match.pattern.description}</p>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div style="font-size:1.1rem;font-weight:700;color:${color};">${fmtScore(match.match_score)}</div>
        <div style="font-size:0.7rem;color:var(--text-muted);">match</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:0.75rem;">
      <div>
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.35rem;">Matched Signals</div>
        <ul style="margin:0;padding-left:1.1rem;font-size:0.8rem;">${signalsHtml || '<li style="color:var(--text-muted);">No specific signals matched</li>'}</ul>
      </div>
      <div>
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.35rem;">Recommended Actions</div>
        <ul style="margin:0;padding-left:1.1rem;font-size:0.8rem;">${actionsHtml || '<li style="color:var(--text-muted);">Review pattern details</li>'}</ul>
      </div>
    </div>

    <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
      <form method="POST" action="/network/patterns/${matchId}/resolve" style="display:inline;">
        <input type="hidden" name="outcome" value="avoided" />
        <button type="submit" style="padding:0.3rem 0.75rem;font-size:0.75rem;background:rgba(78,204,163,0.15);color:#4ecca3;border:1px solid #4ecca333;border-radius:4px;cursor:pointer;">Mark Avoided</button>
      </form>
      <form method="POST" action="/network/patterns/${matchId}/resolve" style="display:inline;">
        <input type="hidden" name="outcome" value="occurred" />
        <button type="submit" style="padding:0.3rem 0.75rem;font-size:0.75rem;background:rgba(255,107,107,0.12);color:#ff6b6b;border:1px solid #ff6b6b33;border-radius:4px;cursor:pointer;">Mark Occurred</button>
      </form>
    </div>
  </div>`;
}

// ─── GET /network ─────────────────────────────────────────────────────────────

networkIntelligence.get('/network', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'network', 'Network Intelligence', undefined, c);

  if (!ctx.productId) {
    const content = html`
      <h1 style="margin:0 0 1rem;">Network Intelligence</h1>
      <div class="card" style="padding:2rem;text-align:center;color:var(--text-muted);">No product selected.</div>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;

  await seedDefaultCohortPatterns();

  const [activeMatches, benchmarks] = await Promise.all([
    getActivePatternMatches(productId),
    getCohortBenchmarks(productId),
  ]);

  const criticalOrHigh = activeMatches.filter(
    (m) => m.pattern.severity === 'critical' || m.pattern.severity === 'high',
  );
  const otherMatches = activeMatches.filter(
    (m) => m.pattern.severity !== 'critical' && m.pattern.severity !== 'high',
  );

  const alertsHtml = activeMatches.length === 0
    ? `<div class="card" style="padding:1.5rem;text-align:center;border:1px dashed rgba(255,255,255,0.12);">
        <div style="font-size:0.9rem;color:var(--text-muted);">No active pattern alerts. <a href="/network/scan" style="color:#7c83fd;text-decoration:none;">Run a scan</a> to check your current state.</div>
       </div>`
    : [...criticalOrHigh, ...otherMatches]
        .map((m) => renderPatternAlert(m, productId))
        .join('');

  const benchmarkRowsHtml = benchmarks
    .map((b) => {
      const metricLabel: Record<string, string> = {
        mrr_growth_rate: 'MRR Growth Rate',
        churn_rate: 'Churn Rate',
        activation_rate: 'Activation Rate',
        nps_score: 'NPS Score',
        day_30_retention: '30-Day Retention',
      };
      const label = metricLabel[b.metric] ?? b.metric;
      const pctColor =
        b.your_percentile !== null
          ? b.your_percentile >= 75
            ? '#4ecca3'
            : b.your_percentile >= 50
              ? '#7c83fd'
              : b.your_percentile >= 25
                ? '#ffb347'
                : '#ff6b6b'
          : 'var(--text-muted)';
      const arrow = trendArrow(b.trend);
      const arrowColor = trendColor(b.trend);
      const bar = percentileBar(b.your_percentile);

      return `<div class="card" style="padding:1.1rem;margin-bottom:0.6rem;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:0.6rem;flex-wrap:wrap;">
          <div style="flex:1;min-width:140px;">
            <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.2rem;">${label}</div>
            <div style="display:flex;align-items:baseline;gap:0.5rem;">
              <span style="font-size:1.35rem;font-weight:700;color:var(--text-primary);">${fmtMetric(b.your_value, b.metric)}</span>
              <span style="font-size:0.9rem;color:${arrowColor};font-weight:600;">${arrow}</span>
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            ${b.your_percentile !== null
              ? `<div style="font-size:0.95rem;font-weight:700;color:${pctColor};">P${b.your_percentile}</div>
                 <div style="font-size:0.68rem;color:var(--text-muted);">in cohort</div>`
              : `<div style="font-size:0.8rem;color:var(--text-muted);">No data</div>`}
          </div>
        </div>
        <div style="margin-bottom:0.5rem;">${bar}</div>
        ${b.cohort_median !== null
          ? `<div style="display:flex;justify-content:space-between;font-size:0.67rem;color:var(--text-muted);margin-bottom:0.5rem;">
          <span>P25: ${fmtMetric(b.cohort_p25, b.metric)}</span>
          <span>Median: ${fmtMetric(b.cohort_median, b.metric)}</span>
          <span>P75: ${fmtMetric(b.cohort_p75, b.metric)}</span>
        </div>`
          : `<div style="font-size:0.67rem;color:var(--text-muted);margin-bottom:0.5rem;">
          No cohort distribution published yet — a percentile is only shown once
          enough distinct companies in this segment have contributed.
        </div>`}
        ${b.cohort_insight !== null
          ? `<div style="font-size:0.78rem;color:var(--text-dim);border-top:1px solid rgba(255,255,255,0.06);padding-top:0.5rem;">${b.cohort_insight}</div>`
          : ''}
      </div>`;
    })
    .join('');

  const content = html`
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap;">
      <h1 style="margin:0;">Network Intelligence</h1>
      <div style="display:flex;gap:0.5rem;">
        <a href="/network/cohort" style="padding:0.4rem 0.85rem;font-size:0.8rem;background:rgba(124,131,253,0.12);color:#7c83fd;border:1px solid #7c83fd33;border-radius:5px;text-decoration:none;">Cohort Profile</a>
        <a href="/network/patterns" style="padding:0.4rem 0.85rem;font-size:0.8rem;background:rgba(255,255,255,0.06);color:var(--text-dim);border:1px solid rgba(255,255,255,0.1);border-radius:5px;text-decoration:none;">Pattern Library</a>
        <form method="POST" action="/network/scan" style="display:inline;">
          <button type="submit" style="padding:0.4rem 0.85rem;font-size:0.8rem;background:rgba(78,204,163,0.12);color:#4ecca3;border:1px solid #4ecca333;border-radius:5px;cursor:pointer;">Scan Now</button>
        </form>
      </div>
    </div>

    <!-- Section 1: Pattern Alerts -->
    <div style="margin-bottom:2rem;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;">
        <h2 style="margin:0;font-size:1.05rem;font-weight:700;">Pattern Alerts</h2>
        ${activeMatches.length > 0
          ? `<span style="font-size:0.75rem;color:var(--text-muted);">${activeMatches.length} active</span>`
          : ''}
      </div>
      ${{ toString: () => alertsHtml }}
    </div>

    <!-- Section 2: Cohort Benchmarks -->
    <div>
      <div style="margin-bottom:0.75rem;">
        <h2 style="margin:0 0 0.25rem;font-size:1.05rem;font-weight:700;">Cohort Benchmarks</h2>
        <p style="margin:0;font-size:0.8rem;color:var(--text-muted);">Your metrics vs. anonymized peers at your stage and business model.</p>
      </div>
      ${{ toString: () => benchmarkRowsHtml || '<div class="card" style="padding:1.5rem;text-align:center;color:var(--text-muted);">No benchmark data available yet. Contribute metric snapshots to populate this section.</div>' }}
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /network/scan ───────────────────────────────────────────────────────

networkIntelligence.post('/network/scan',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'network', 'Network Intelligence', undefined, c);

  if (ctx.productId) {
    await scanForFailurePatterns(ctx.productId);
  }

  return c.redirect('/network');
});

// ─── GET /network/patterns ────────────────────────────────────────────────────

networkIntelligence.get('/network/patterns', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'network', 'Pattern Library', undefined, c);

  const patterns = await getAllFailurePatterns();

  const patternCards = patterns
    .map((p) => {
      const color = SEVERITY_COLOR[p.severity] ?? '#ffb347';
      const bg = SEVERITY_BG[p.severity] ?? 'rgba(255,179,71,0.08)';
      let signals: string[] = [];
      let mitigations: string[] = [];
      try { signals = JSON.parse(p.warning_signals_json) as string[]; } catch { /* empty */ }
      try { mitigations = JSON.parse(p.mitigation_actions_json) as string[]; } catch { /* empty */ }

      const signalsHtml = signals
        .map((s) => `<li style="margin-bottom:0.2rem;color:var(--text-dim);font-size:0.8rem;">${s}</li>`)
        .join('');
      const mitigationsHtml = mitigations
        .map((m) => `<li style="margin-bottom:0.2rem;color:var(--text-dim);font-size:0.8rem;">${m}</li>`)
        .join('');

      const leadTime = p.typical_lead_time_days !== null
        ? `<span style="font-size:0.72rem;color:var(--text-muted);">~${p.typical_lead_time_days} day lead time</span>`
        : '';

      return `<div class="card" style="padding:1.25rem;margin-bottom:0.75rem;border-left:3px solid ${color};background:${bg};">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:0.6rem;flex-wrap:wrap;">
          <div>
            <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.25rem;">
              <span style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:${color};border:1px solid ${color}33;padding:0.1rem 0.45rem;border-radius:3px;">${p.severity}</span>
              <span style="font-size:0.68rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);border:1px solid rgba(255,255,255,0.1);padding:0.1rem 0.45rem;border-radius:3px;">${p.category.replace(/_/g, ' ')}</span>
              ${leadTime}
            </div>
            <h3 style="margin:0;font-size:0.95rem;font-weight:700;color:var(--text-primary);">${p.pattern_name}</h3>
          </div>
        </div>
        <p style="margin:0 0 0.75rem;font-size:0.82rem;color:var(--text-muted);">${p.description}</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
          <div>
            <div style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin-bottom:0.35rem;">Warning Signals</div>
            <ul style="margin:0;padding-left:1rem;">${signalsHtml}</ul>
          </div>
          <div>
            <div style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin-bottom:0.35rem;">Mitigation Actions</div>
            <ul style="margin:0;padding-left:1rem;">${mitigationsHtml}</ul>
          </div>
        </div>
      </div>`;
    })
    .join('');

  const content = html`
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap;">
      <div>
        <h1 style="margin:0 0 0.25rem;">Failure Pattern Library</h1>
        <p style="margin:0;font-size:0.83rem;color:var(--text-muted);">Known failure precursors and how to avoid them. Patterns are continuously updated from the Foundry network.</p>
      </div>
      <div style="display:flex;gap:0.5rem;align-items:center;">
        <a href="/network" style="font-size:0.8rem;color:var(--text-muted);text-decoration:none;">← Back</a>
        <form method="POST" action="/network/scan" style="display:inline;">
          <button type="submit" style="padding:0.4rem 0.85rem;font-size:0.8rem;background:rgba(78,204,163,0.12);color:#4ecca3;border:1px solid #4ecca333;border-radius:5px;cursor:pointer;">Scan Now</button>
        </form>
      </div>
    </div>

    ${{ toString: () => patternCards || '<div class="card" style="padding:2rem;text-align:center;color:var(--text-muted);">No patterns loaded yet.</div>' }}
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── GET /network/cohort ──────────────────────────────────────────────────────

networkIntelligence.get('/network/cohort', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'network', 'Cohort Profile', undefined, c);

  if (!ctx.productId) {
    const content = html`
      <h1 style="margin:0 0 1rem;">Cohort Profile</h1>
      <div class="card" style="padding:2rem;text-align:center;color:var(--text-muted);">No product selected.</div>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;
  await seedDefaultCohortPatterns();

  const [profile, patterns] = await Promise.all([
    getProductCohortProfile(productId),
    getCohortPatterns(productId),
  ]);

  const profileFields: Array<{ label: string; value: string }> = [
    { label: 'Business Model', value: profile.business_model.replace(/_/g, ' ').toUpperCase() },
    { label: 'Stage', value: profile.stage.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) },
    { label: 'MRR Range', value: profile.mrr_bucket },
    { label: 'Team Size', value: profile.team_size_bucket },
  ];

  const profileHtml = profileFields
    .map(
      (f) =>
        `<div style="padding:0.75rem 1rem;background:rgba(255,255,255,0.04);border-radius:5px;">
           <div style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin-bottom:0.2rem;">${f.label}</div>
           <div style="font-size:0.95rem;font-weight:600;color:var(--text-primary);">${f.value}</div>
         </div>`,
    )
    .join('');

  const PATTERN_TYPE_LABELS: Record<string, string> = {
    growth_trajectory: 'Growth',
    churn_inflection: 'Churn',
    fundraising_window: 'Fundraising',
    team_scaling: 'Team',
  };

  const patternCardsHtml = patterns.length === 0
    ? `<div class="card" style="padding:1.5rem;text-align:center;border:1px dashed rgba(255,255,255,0.12);">
         <p style="color:var(--text-muted);margin:0;">No cohort patterns available for your profile yet. Patterns populate as more companies contribute data.</p>
       </div>`
    : patterns
        .map(({ pattern: p, relevance_score, insight }) => {
          const typeLabel = PATTERN_TYPE_LABELS[p.pattern_type] ?? p.pattern_type;
          const relevancePct = Math.round(relevance_score * 100);
          const relevanceColor = relevancePct >= 70 ? '#4ecca3' : relevancePct >= 50 ? '#7c83fd' : '#ffb347';

          return `<div class="card" style="padding:1.25rem;margin-bottom:0.6rem;">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:0.5rem;flex-wrap:wrap;">
              <div>
                <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.25rem;">
                  <span style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#7c83fd;border:1px solid #7c83fd33;padding:0.1rem 0.45rem;border-radius:3px;">${typeLabel}</span>
                  <span style="font-size:0.72rem;color:var(--text-muted);">${p.company_count} companies · ${Math.round(p.confidence * 100)}% confidence</span>
                </div>
                <h3 style="margin:0;font-size:0.95rem;font-weight:700;color:var(--text-primary);">${p.pattern_name}</h3>
              </div>
              <div style="text-align:right;flex-shrink:0;">
                <div style="font-size:0.95rem;font-weight:700;color:${relevanceColor};">${relevancePct}%</div>
                <div style="font-size:0.68rem;color:var(--text-muted);">relevance</div>
              </div>
            </div>
            <p style="margin:0;font-size:0.82rem;color:var(--text-muted);">${insight}</p>
          </div>`;
        })
        .join('');

  const content = html`
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap;">
      <div>
        <h1 style="margin:0 0 0.25rem;">Cohort Profile</h1>
        <p style="margin:0;font-size:0.83rem;color:var(--text-muted);">Where you fit in the Foundry network — and what your peers have learned.</p>
      </div>
      <a href="/network" style="font-size:0.8rem;color:var(--text-muted);text-decoration:none;">← Back</a>
    </div>

    <div class="card" style="padding:1.25rem;margin-bottom:1.5rem;">
      <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin-bottom:0.75rem;">Your Cohort</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:0.5rem;">
        ${{ toString: () => profileHtml }}
      </div>
    </div>

    <div>
      <h2 style="margin:0 0 0.75rem;font-size:1.05rem;font-weight:700;">Cohort Patterns</h2>
      ${{ toString: () => patternCardsHtml }}
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /network/patterns/:matchId/resolve ──────────────────────────────────

networkIntelligence.post('/network/patterns/:matchId/resolve', async (c) => {
  const founder = c.get('founder');
  const matchId = c.req.param('matchId');
  const body = await c.req.parseBody();
  const outcome = body['outcome'] as string;

  if (outcome === 'avoided' || outcome === 'occurred') {
    await resolvePattern(matchId, outcome, founder.id);
  }

  return c.redirect('/network');
});
