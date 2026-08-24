// =============================================================================
// FOUNDRY — Exit & Liquidity Intelligence
// M&A readiness, acquirer tracking, cap table modeling, term sheet simulation.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { getLayoutContext } from './_shared.js';
import { dashboardLayout } from '../../views/layout.js';
import { assessMAReadiness, getLatestMAScore } from '../../services/scp/exit/ma-readiness.js';
import {
  addAcquirerSignal,
  getAcquirerSignals,
  getTopAcquirerCandidates,
  generateAcquirerThesis,
} from '../../services/scp/exit/acquirer-tracker.js';
import {
  saveCapTableScenario,
  getCapTableScenarios,
  runMultipleExitScenarios,
  type Stakeholder,
} from '../../services/scp/exit/cap-table.js';
import { modelTermSheet, getTermSheetModels } from '../../services/scp/exit/term-sheet.js';
import { requireTier } from '../../middleware/tier-gate.js';
import { requireCompanyCapability } from '../../middleware/rbac.js';

export const exitRoutes = new Hono<AuthEnv>();

// EVERY ROUTE IN THIS ROUTER IS EXIT AND VALUATION MATERIAL.
//
// `team_members.can_view_financials` has existed since migration 010 and nothing read it.
// That was survivable only because an invited member could not see the company
// at all — the dashboard listed by `owner_id`. Now that membership makes the
// company visible, this is the guard that was always supposed to be here.
//
// Router-level rather than per-route: a capability that has to be remembered
// on each new handler is one that will be forgotten on one of them.
exitRoutes.use('*', requireCompanyCapability('can_view_financials'));


// ─── Helpers ─────────────────────────────────────────────────────────────────

function scoreBar(score: number, max = 10): string {
  const pct = (score / max) * 100;
  const color = score >= 7 ? '#4ecca3' : score >= 5 ? '#f59e0b' : '#ef4444';
  return `<div class="score-bar-wrap"><div class="score-bar" style="width:${pct}%;background:${color}"></div></div>`;
}

function readinessBadge(score: number): string {
  if (score >= 7) return '<span class="badge badge-green">Ready</span>';
  if (score >= 5) return '<span class="badge badge-yellow">Getting There</span>';
  return '<span class="badge badge-red">Not Ready</span>';
}

function fitBadge(score: number): string {
  const pct = Math.round(score * 100);
  const color = score >= 0.7 ? '#4ecca3' : score >= 0.5 ? '#f59e0b' : '#94a3b8';
  return `<span class="badge" style="background:${color}20;color:${color}">${pct}% fit</span>`;
}

// ─── GET /exit — Exit Intelligence Hub ───────────────────────────────────────

exitRoutes.get('/exit', requireTier('investor_layer'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'exit', 'Exit Intelligence', undefined, c);
  if (!ctx.productId) return c.redirect('/products');

  const [maScore, topAcquirers, capScenarios, termModels] = await Promise.all([
    getLatestMAScore(ctx.productId).catch(() => null),
    getTopAcquirerCandidates(ctx.productId).catch(() => []),
    getCapTableScenarios(ctx.productId).catch(() => []),
    getTermSheetModels(ctx.productId).catch(() => []),
  ]);

  const content = html`
    <div class="page-header">
      <h1>Exit Intelligence</h1>
      <p class="text-muted">M&amp;A readiness, acquirer tracking, cap table modeling, and term sheet simulation.</p>
    </div>

    <!-- M&A Readiness -->
    <div class="section">
      <div class="section-header">
        <h2>M&amp;A Readiness</h2>
        <form method="POST" action="/exit/readiness/assess" style="display:inline">
          <button type="submit" class="btn btn-secondary btn-sm">Re-assess</button>
        </form>
      </div>
      ${!maScore ? html`
        <div class="empty-state">
          <p>No M&amp;A readiness assessment yet.</p>
          <form method="POST" action="/exit/readiness/assess">
            <button type="submit" class="btn btn-primary">Run Assessment</button>
          </form>
        </div>
      ` : html`
        <div class="readiness-hero">
          <div class="readiness-score">
            <span class="score-number">${maScore.overall_score.toFixed(1)}</span>
            <span class="score-label">/ 10</span>
            ${readinessBadge(maScore.overall_score)}
          </div>
          ${maScore.customer_concentration_score === null ? html`
            <p class="text-muted text-sm" style="margin:0.35rem 0 0;">
              Scored over four of five dimensions: Foundry knows of no paying
              customers for this company, so customer concentration is not part
              of this number.
            </p>` : ''}
          ${maScore.estimated_multiple_range ? html`
            <div class="multiple-range">
              <span class="text-muted">Estimated multiple:</span>
              <strong>${maScore.estimated_multiple_range}</strong>
            </div>
          ` : ''}
        </div>
        <div class="dimension-grid">
          ${[
            ['Revenue Quality', maScore.revenue_quality_score],
            ['IP Clarity', maScore.ip_clarity_score],
            ['Team Retention', maScore.team_retention_score],
            ['Integration Complexity', maScore.integration_complexity_score],
            ['Customer Concentration', maScore.customer_concentration_score],
          ].map(([label, score]) => html`
            <div class="dimension-row">
              <span class="dimension-label">${label}</span>
              ${score === null
                ? html`<span class="dimension-score text-muted">not scored</span>`
                : html`${scoreBar(score as number)}
              <span class="dimension-score">${(score as number).toFixed(1)}</span>`}
            </div>
          `)}
        </div>
        ${maScore.key_gaps.length > 0 ? html`
          <div class="gaps-section">
            <h4>Key Gaps</h4>
            <ul>${maScore.key_gaps.map(gap => html`<li class="text-muted text-sm">${gap}</li>`)}</ul>
          </div>
        ` : ''}
        ${maScore.target_acquirer_profile ? html`
          <div class="acquirer-profile">
            <h4>Ideal Acquirer Profile</h4>
            <p class="text-muted">${maScore.target_acquirer_profile}</p>
          </div>
        ` : ''}
      `}
    </div>

    <!-- Top Acquirer Candidates -->
    <div class="section">
      <div class="section-header">
        <h2>Acquirer Pipeline</h2>
        <a href="/exit/acquirers" class="btn btn-secondary btn-sm">View All</a>
      </div>
      ${topAcquirers.length === 0 ? html`
        <div class="empty-state">
          <p>No acquirer signals tracked yet. <a href="/exit/acquirers">Add signals →</a></p>
        </div>
      ` : html`
        <table class="data-table">
          <thead><tr><th>Acquirer</th><th>Type</th><th>Signals</th><th>Fit</th><th>Rationale</th></tr></thead>
          <tbody>
            ${topAcquirers.slice(0, 5).map(a => html`
              <tr>
                <td><strong>${a.acquirer_name}</strong></td>
                <td><span class="badge badge-neutral">${a.acquirer_type}</span></td>
                <td>${a.signal_count}</td>
                <td>${fitBadge(a.avg_fit_score)}</td>
                <td class="text-muted text-sm">${a.strategic_rationale ? String(a.strategic_rationale).slice(0, 80) + '…' : '—'}</td>
              </tr>
            `)}
          </tbody>
        </table>
      `}
    </div>

    <!-- Cap Table -->
    <div class="section">
      <div class="section-header">
        <h2>Cap Table &amp; Exit Scenarios</h2>
        <a href="/exit/cap-table" class="btn btn-secondary btn-sm">Model Scenarios</a>
      </div>
      ${capScenarios.length === 0 ? html`
        <div class="empty-state">
          <p>No cap table scenarios modeled yet. <a href="/exit/cap-table">Build yours →</a></p>
        </div>
      ` : html`
        <p class="text-muted text-sm">${capScenarios.length} scenario${capScenarios.length !== 1 ? 's' : ''} saved. <a href="/exit/cap-table">View →</a></p>
      `}
    </div>

    <!-- Term Sheet -->
    <div class="section">
      <div class="section-header">
        <h2>Term Sheet Models</h2>
        <a href="/exit/term-sheet" class="btn btn-secondary btn-sm">Model Terms</a>
      </div>
      ${termModels.length === 0 ? html`
        <div class="empty-state">
          <p>No term sheets modeled yet. <a href="/exit/term-sheet">Simulate a round →</a></p>
        </div>
      ` : html`
        <table class="data-table">
          <thead><tr><th>Round</th><th>Pre-money</th><th>Amount</th><th>Dilution</th><th>Investor %</th></tr></thead>
          <tbody>
            ${termModels.slice(0, 3).map(m => html`
              <tr>
                <td><span class="badge badge-neutral">${m.round_type}</span></td>
                <td>$${(m.pre_money_valuation / 1_000_000).toFixed(1)}M</td>
                <td>$${(m.investment_amount / 1_000_000).toFixed(1)}M</td>
                <td>${m.new_dilution_pct.toFixed(1)}%</td>
                <td>${m.investor_ownership_pct.toFixed(1)}%</td>
              </tr>
            `)}
          </tbody>
        </table>
      `}
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /exit/readiness/assess ─────────────────────────────────────────────

exitRoutes.post('/exit/readiness/assess', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'exit', 'Exit Intelligence', undefined, c);
  if (!ctx.productId) return c.redirect('/products');
  await assessMAReadiness(ctx.productId).catch(() => {});
  return c.redirect('/exit');
});

// ─── GET /exit/acquirers ──────────────────────────────────────────────────────

exitRoutes.get('/exit/acquirers', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'exit', 'Acquirer Pipeline', undefined, c);
  if (!ctx.productId) return c.redirect('/products');

  const [signals, topCandidates] = await Promise.all([
    getAcquirerSignals(ctx.productId).catch(() => []),
    getTopAcquirerCandidates(ctx.productId).catch(() => []),
  ]);

  const content = html`
    <div class="page-header">
      <a href="/exit" class="back-link">← Exit Intelligence</a>
      <h1>Acquirer Pipeline</h1>
    </div>

    <div class="section-header" style="margin-bottom:16px">
      <div style="display:flex;gap:8px">
        <form method="POST" action="/exit/acquirers/thesis">
          <button type="submit" class="btn btn-secondary btn-sm">Generate Acquirer Thesis</button>
        </form>
        <a href="/exit/acquirers/new" class="btn btn-primary btn-sm">+ Add Signal</a>
      </div>
    </div>

    ${topCandidates.length > 0 ? html`
      <div class="section">
        <h2>Top Candidates (by fit score)</h2>
        <div class="card-grid">
          ${topCandidates.map(a => html`
            <div class="card">
              <div class="card-header">
                <h3>${a.acquirer_name}</h3>
                ${fitBadge(a.avg_fit_score)}
              </div>
              <div class="meta-row"><span>Type</span><span class="badge badge-neutral">${a.acquirer_type}</span></div>
              <div class="meta-row"><span>Signals</span><span>${a.signal_count}</span></div>
              <div class="meta-row"><span>Latest</span><span class="text-muted text-xs">${a.latest_signal}</span></div>
              ${a.strategic_rationale ? html`<p class="text-sm text-muted" style="margin-top:8px">${a.strategic_rationale}</p>` : ''}
            </div>
          `)}
        </div>
      </div>
    ` : ''}

    <div class="section">
      <h2>All Signals</h2>
      ${signals.length === 0 ? html`
        <div class="empty-state"><p>No signals yet. Add your first acquirer signal to start tracking.</p></div>
      ` : html`
        <table class="data-table">
          <thead><tr><th>Acquirer</th><th>Signal</th><th>Type</th><th>Fit</th><th>Date</th></tr></thead>
          <tbody>
            ${signals.map(s => html`
              <tr>
                <td><strong>${s.acquirer_name}</strong></td>
                <td class="text-sm">${s.signal_description.slice(0, 80)}${s.signal_description.length > 80 ? '…' : ''}</td>
                <td><span class="badge badge-neutral">${s.signal_type}</span></td>
                <td>${fitBadge(s.fit_score)}</td>
                <td class="text-muted text-xs">${String(s.detected_at).slice(0, 10)}</td>
              </tr>
            `)}
          </tbody>
        </table>
      `}
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── GET /exit/acquirers/new ──────────────────────────────────────────────────

exitRoutes.get('/exit/acquirers/new', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'exit', 'Add Acquirer Signal', undefined, c);
  if (!ctx.productId) return c.redirect('/products');

  const content = html`
    <div class="page-header">
      <a href="/exit/acquirers" class="back-link">← Acquirers</a>
      <h1>Add Acquirer Signal</h1>
    </div>
    <div class="form-card" style="max-width:580px">
      <form method="POST" action="/exit/acquirers">
        <div class="form-group">
          <label>Acquirer Name</label>
          <input type="text" name="acquirer_name" class="form-control" required placeholder="Salesforce" />
        </div>
        <div class="form-group">
          <label>Acquirer Type</label>
          <select name="acquirer_type" class="form-control">
            <option value="strategic">Strategic</option>
            <option value="financial">Financial (VC/Family Office)</option>
            <option value="pe">Private Equity</option>
          </select>
        </div>
        <div class="form-group">
          <label>Signal Type</label>
          <select name="signal_type" class="form-control">
            <option value="product_gap">Product Gap</option>
            <option value="hiring_signal">Hiring Signal</option>
            <option value="partnership_interest">Partnership Interest</option>
            <option value="competitor_acquisition">Competitor Acquisition</option>
            <option value="manual">Manual / Research</option>
          </select>
        </div>
        <div class="form-group">
          <label>Signal Description</label>
          <textarea name="signal_description" class="form-control" rows="3" required placeholder="Describe what you observed..."></textarea>
        </div>
        <div class="form-group">
          <label>Strategic Rationale (why they'd want us)</label>
          <textarea name="strategic_rationale" class="form-control" rows="2" placeholder="They're missing X capability which we provide..."></textarea>
        </div>
        <div class="form-group">
          <label>Fit Score (0–1)</label>
          <input type="number" name="fit_score" class="form-control" min="0" max="1" step="0.05" value="0.5" />
        </div>
        <button type="submit" class="btn btn-primary">Add Signal</button>
      </form>
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /exit/acquirers ─────────────────────────────────────────────────────

exitRoutes.post('/exit/acquirers', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'exit', 'Add Acquirer Signal', undefined, c);
  if (!ctx.productId) return c.redirect('/products');

  const body = await c.req.parseBody();
  await addAcquirerSignal(ctx.productId, {
    acquirer_name: String(body['acquirer_name'] ?? ''),
    acquirer_type: (String(body['acquirer_type'] ?? 'strategic')) as 'strategic' | 'financial' | 'pe',
    signal_type: String(body['signal_type'] ?? 'manual'),
    signal_description: String(body['signal_description'] ?? ''),
    strategic_rationale: body['strategic_rationale'] ? String(body['strategic_rationale']) : undefined,
    fit_score: body['fit_score'] ? parseFloat(String(body['fit_score'])) : 0.5,
  });

  return c.redirect('/exit/acquirers');
});

// ─── POST /exit/acquirers/thesis ──────────────────────────────────────────────

exitRoutes.post('/exit/acquirers/thesis', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'exit', 'Acquirer Thesis', undefined, c);
  if (!ctx.productId) return c.redirect('/products');

  const thesis = await generateAcquirerThesis(ctx.productId).catch(() => 'Unable to generate thesis — add more acquirer signals first.');

  const content = html`
    <div class="page-header">
      <a href="/exit/acquirers" class="back-link">← Acquirers</a>
      <h1>Acquirer Thesis</h1>
    </div>
    <div class="insight-card" style="max-width:700px">
      <p style="line-height:1.7">${thesis}</p>
    </div>
    <div style="margin-top:16px">
      <a href="/exit/acquirers" class="btn btn-secondary">Back to Pipeline</a>
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── GET /exit/cap-table ──────────────────────────────────────────────────────

exitRoutes.get('/exit/cap-table', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'exit', 'Cap Table', undefined, c);
  if (!ctx.productId) return c.redirect('/products');

  const scenarios = await getCapTableScenarios(ctx.productId).catch(() => []);

  const content = html`
    <div class="page-header">
      <a href="/exit" class="back-link">← Exit Intelligence</a>
      <h1>Cap Table &amp; Exit Scenarios</h1>
    </div>

    <div class="section">
      <div class="section-header">
        <h2>Build Exit Scenario</h2>
      </div>
      <div class="form-card" style="max-width:700px">
        <p class="text-muted text-sm" style="margin-bottom:16px">Enter your stakeholders to model proceeds across exit valuations.</p>
        <form method="POST" action="/exit/cap-table">
          <div class="form-group">
            <label>Scenario Name</label>
            <input type="text" name="scenario_name" class="form-control" required placeholder="Current cap table" />
          </div>
          <div class="form-group">
            <label>Exit valuation to save against (optional, $)</label>
            <input type="number" name="exit_valuation" class="form-control" placeholder="50000000" />
            <p class="text-muted text-xs" style="margin-top:4px">
              The table below models six exit sizes either way. This is the one
              the saved scenario keeps its proceeds for — without it the saved
              row holds the stakeholders and nothing else.
            </p>
          </div>
          <div class="form-group">
            <label>Stakeholders (JSON array)</label>
            <textarea name="stakeholders_json" class="form-control" rows="8" required placeholder='[
  {"name":"Founder A","type":"founder","shares":3000000,"options":0,"invested":0,"preference_multiple":1,"is_participating":false,"vested_pct":100},
  {"name":"Seed VC","type":"investor","shares":500000,"options":0,"invested":500000,"preference_multiple":1,"is_participating":false,"vested_pct":100}
]'></textarea>
          </div>
          <button type="submit" class="btn btn-primary">Model Exits</button>
        </form>
      </div>
    </div>

    ${scenarios.length > 0 ? html`
      <div class="section">
        <h2>Saved Scenarios</h2>
        <table class="data-table">
          <thead><tr><th>Name</th><th>Exit Valuation</th><th>Founder Proceeds</th><th>Investor share of proceeds</th><th>Created</th></tr></thead>
          <tbody>
            ${scenarios.map(s => html`
              <tr>
                <td>${s.scenario_name}</td>
                <td>${s.exit_valuation === null
                  ? html`<span class="text-muted">not modelled</span>`
                  : '$' + (Number(s.exit_valuation) / 1_000_000).toFixed(1) + 'M'}</td>
                <td>${s.founder_proceeds === null
                  ? html`<span class="text-muted">not modelled</span>`
                  : '$' + (Number(s.founder_proceeds) / 1_000).toFixed(0) + 'K'}</td>
                <td>${s.investor_proceeds_pct === null
                  ? html`<span class="text-muted">not modelled</span>`
                  : Number(s.investor_proceeds_pct).toFixed(1) + '%'}</td>
                <td class="text-muted text-xs">${String(s.created_at).slice(0, 10)}</td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    ` : ''}
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /exit/cap-table ─────────────────────────────────────────────────────

exitRoutes.post('/exit/cap-table', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'exit', 'Cap Table', undefined, c);
  if (!ctx.productId) return c.redirect('/products');

  const body = await c.req.parseBody();
  let stakeholders: Stakeholder[];
  try {
    stakeholders = JSON.parse(String(body['stakeholders_json'] ?? '[]'));
  } catch {
    return c.redirect('/exit/cap-table');
  }

  const scenarioName = String(body['scenario_name'] ?? 'Scenario');

  // THE SAVED ROW USED TO HOLD NOTHING BUT NAMES. `saveCapTableScenario` fills
  // `founder_proceeds` and `investor_proceeds_pct` only when it is given an
  // exit valuation to model against, and this call never passed one — so both
  // columns were NULL in every row ever written, and the Saved Scenarios table
  // advertised two numbers it could not produce.
  const rawValuation = parseFloat(String(body['exit_valuation'] ?? ''));
  const exitValuation = Number.isFinite(rawValuation) && rawValuation > 0
    ? rawValuation : undefined;

  const exitScenarios = await runMultipleExitScenarios(ctx.productId, stakeholders).catch(() => []);
  await saveCapTableScenario(ctx.productId, {
    scenario_name: scenarioName, stakeholders, exit_valuation: exitValuation,
  }).catch(() => {});

  const content = html`
    <div class="page-header">
      <a href="/exit/cap-table" class="back-link">← Cap Table</a>
      <h1>${scenarioName} — Exit Proceeds</h1>
    </div>
    <table class="data-table" style="max-width:600px">
      <thead><tr><th>Exit Valuation</th><th>Founder Proceeds</th><th>Founder %</th><th>Converts to common</th></tr></thead>
      <tbody>
        ${exitScenarios.map(s => html`
          <tr>
            <td><strong>${s.label}</strong></td>
            <td>$${(s.founder_proceeds / 1_000_000).toFixed(2)}M</td>
            <td>${s.founder_pct.toFixed(1)}%</td>
            <td class="text-muted text-sm">${s.converting_investors.length > 0
              ? s.converting_investors.join(', ')
              : '—'}</td>
          </tr>
        `)}
      </tbody>
    </table>
    <p class="text-muted text-sm" style="max-width:600px;margin-top:10px">
      A non-participating investor takes whichever is larger: their liquidation
      preference, or their shares converted to common. The last column names the
      ones who do better converting at that valuation — which is why the
      founder's share falls as the exit grows rather than approaching 100%.
      Not modelled: participation caps, seniority stacks, accrued dividends,
      option-pool refresh at close.
    </p>
    <div style="margin-top:16px">
      <a href="/exit/cap-table" class="btn btn-secondary">Back</a>
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── GET /exit/term-sheet ─────────────────────────────────────────────────────

exitRoutes.get('/exit/term-sheet', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'exit', 'Term Sheet Modeler', undefined, c);
  if (!ctx.productId) return c.redirect('/products');

  const models = await getTermSheetModels(ctx.productId).catch(() => []);

  const content = html`
    <div class="page-header">
      <a href="/exit" class="back-link">← Exit Intelligence</a>
      <h1>Term Sheet Modeler</h1>
    </div>

    <div class="form-card" style="max-width:580px;margin-bottom:32px">
      <form method="POST" action="/exit/term-sheet">
        <div class="form-group">
          <label>Round Type</label>
          <select name="round_type" class="form-control">
            <option value="seed">Seed</option>
            <option value="series_a">Series A</option>
            <option value="series_b">Series B</option>
          </select>
        </div>
        <div class="form-group">
          <label>Investment Amount ($)</label>
          <input type="number" name="investment_amount" class="form-control" required placeholder="2000000" />
        </div>
        <div class="form-group">
          <label>Pre-money Valuation ($)</label>
          <input type="number" name="pre_money_valuation" class="form-control" required placeholder="8000000" />
        </div>
        <div class="form-group">
          <label>Liquidation Preference</label>
          <select name="liquidation_preference" class="form-control">
            <option value="1x_non_participating">1× Non-participating</option>
            <option value="1x_participating">1× Participating</option>
            <option value="2x_non_participating">2× Non-participating</option>
          </select>
        </div>
        <div class="form-group">
          <label>Anti-dilution</label>
          <select name="anti_dilution" class="form-control">
            <option value="broad_based_weighted_avg">Broad-based weighted average</option>
            <option value="narrow_based_weighted_avg">Narrow-based weighted average</option>
            <option value="full_ratchet">Full ratchet</option>
            <option value="none">None</option>
          </select>
        </div>
        <div class="form-group">
          <label>Board Seats</label>
          <input type="number" name="board_seats" class="form-control" value="1" min="0" max="3" />
        </div>
        <button type="submit" class="btn btn-primary">Model Terms</button>
      </form>
    </div>

    ${models.length > 0 ? html`
      <div class="section">
        <h2>Previous Models</h2>
        <table class="data-table">
          <thead><tr><th>Round</th><th>Pre-money</th><th>Raise</th><th>Post-money</th><th>Dilution</th><th>Investor %</th></tr></thead>
          <tbody>
            ${models.map(m => html`
              <tr>
                <td><span class="badge badge-neutral">${m.round_type}</span></td>
                <td>$${(m.pre_money_valuation / 1_000_000).toFixed(1)}M</td>
                <td>$${(m.investment_amount / 1_000_000).toFixed(1)}M</td>
                <td>$${(m.post_money_valuation / 1_000_000).toFixed(1)}M</td>
                <td>${m.new_dilution_pct.toFixed(1)}%</td>
                <td>${m.investor_ownership_pct.toFixed(1)}%</td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    ` : ''}
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /exit/term-sheet ────────────────────────────────────────────────────

exitRoutes.post('/exit/term-sheet', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'exit', 'Term Sheet Result', undefined, c);
  if (!ctx.productId) return c.redirect('/products');

  const body = await c.req.parseBody();
  const result = await modelTermSheet(ctx.productId, {
    round_type: String(body['round_type'] ?? 'seed'),
    investment_amount: parseFloat(String(body['investment_amount'] ?? '0')),
    pre_money_valuation: parseFloat(String(body['pre_money_valuation'] ?? '0')),
    liquidation_preference: String(body['liquidation_preference'] ?? '1x_non_participating'),
    anti_dilution: String(body['anti_dilution'] ?? 'broad_based_weighted_avg'),
    pro_rata_rights: true,
    board_seats: parseInt(String(body['board_seats'] ?? '1')),
  });

  const content = html`
    <div class="page-header">
      <a href="/exit/term-sheet" class="back-link">← Term Sheet Modeler</a>
      <h1>${String(body['round_type']).replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())} — Modeled Terms</h1>
    </div>

    <div class="detail-grid" style="max-width:700px">
      <div class="metric-row"><span>Post-money Valuation</span><strong>$${(result.post_money / 1_000_000).toFixed(2)}M</strong></div>
      <div class="metric-row"><span>New Dilution</span><strong>${result.new_dilution_pct.toFixed(2)}%</strong></div>
      <div class="metric-row"><span>Investor Ownership</span><strong>${result.investor_ownership_pct.toFixed(2)}%</strong></div>
    </div>

    ${result.market_context ? html`
      <div class="insight-card" style="max-width:700px;margin-top:16px">
        <h3>Commentary</h3>
        <p class="text-muted">${result.market_context}</p>
        <p class="text-muted text-xs" style="margin-top:8px">
          Written by a model from the terms above and a fixed reference list of
          commonly cited terms. Foundry has no market data feed: nothing here
          samples current term sheets, and no range on this page is a
          measurement. It was headed "Market Context".
        </p>
      </div>
    ` : ''}

    <div style="margin-top:16px">
      <a href="/exit/term-sheet" class="btn btn-secondary">Model Another</a>
      <a href="/exit" class="btn btn-secondary" style="margin-left:8px">Back to Exit Hub</a>
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});
