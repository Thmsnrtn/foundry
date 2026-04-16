// =============================================================================
// FOUNDRY — Decisions Routes
// List: dashboard layout. Detail: Decision Chamber (focused, no sidebar).
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { query, getProductByOwner, getScenarioModels, getRelevantPatterns } from '../../db/client.js';
import { getDecisionQueue, resolveDecision, recordOutcome } from '../../services/decisions/queue.js';
import { dashboardLayout, chamberLayout } from '../../views/layout.js';
import { decisionList, type DecisionData } from '../../views/components.js';
import { getLayoutContext } from './_shared.js';
import { checkAndAwardMilestones } from '../../services/ux/milestones.js';
import { callSonnet } from '../../services/ai/client.js';
import type { RiskStateValue } from '../../types/index.js';

export const decisionRoutes = new Hono<AuthEnv>();

// ─── Decision Queue ───────────────────────────────────────────────────────────

decisionRoutes.get('/decisions', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'decisions', 'Decisions', undefined, c);
  if (!ctx.productId) {
    const content = html`<h1>Decisions</h1>${decisionList([])}`;
    return c.html(dashboardLayout(ctx, content));
  }
  const productId = ctx.productId;
  const ls = await query('SELECT risk_state FROM lifecycle_state WHERE product_id = ?', [productId]);
  const riskState = ((ls.rows[0] as Record<string, string>)?.risk_state as RiskStateValue) ?? 'green';
  const decisions = await getDecisionQueue(productId, riskState);

  const content = html`
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1.25rem;">
      <h1 style="margin:0;">Decisions</h1>
      <a href="/decisions/analytics" class="btn btn-ghost btn-sm">Decision Intelligence →</a>
    </div>
    ${decisionList(decisions as unknown as DecisionData[])}
  `;
  return c.html(dashboardLayout(ctx, content));
});

// ─── Decision Chamber (focused detail view) ───────────────────────────────────

decisionRoutes.get('/decisions/:id', async (c) => {
  const founder = c.get('founder');
  const decisionId = c.req.param('id');
  const ctx = await getLayoutContext(founder, 'decisions', 'Decision', undefined, c);

  const result = await query(
    `SELECT d.* FROM decisions d
     JOIN products p ON d.product_id = p.id
     WHERE d.id = ? AND p.owner_id = ?`,
    [decisionId, founder.id]
  );
  if (result.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const decision = result.rows[0] as Record<string, unknown>;
  const productId = decision.product_id as string;

  const [scenariosResult, lifecycleResult] = await Promise.all([
    getScenarioModels(decisionId),
    query('SELECT current_prompt, risk_state FROM lifecycle_state WHERE product_id = ?', [productId]),
  ]);

  const scenarios = scenariosResult.rows as Array<Record<string, unknown>>;
  const ls = (lifecycleResult.rows[0] ?? {}) as Record<string, string>;

  // Fetch relevant cross-product patterns
  const patterns = await getRelevantPatterns(
    (decision.category as string) ?? 'product',
    ls.current_prompt ?? 'prompt_1',
    ls.risk_state ?? 'green',
    null,
    3
  );
  const relevantPatterns = patterns.rows as Array<Record<string, unknown>>;

  // Parse options
  let options: Array<{ label: string; description: string; trade_offs?: string }> = [];
  try {
    if (decision.options) {
      options = typeof decision.options === 'string'
        ? JSON.parse(decision.options)
        : (decision.options as typeof options);
    }
  } catch { /* leave empty */ }

  const status = decision.status as string;

  const content = html`
    <a href="/decisions" class="chamber-back">← All decisions</a>

    <h1 class="chamber-what">${decision.what}</h1>

    ${decision.why_now ? html`
    <div class="chamber-section">
      <div class="chamber-section-label">Why now</div>
      <p class="chamber-why">${decision.why_now}</p>
    </div>` : ''}

    ${decision.recommendation ? html`
    <div class="chamber-section">
      <div class="chamber-section-label">Recommendation</div>
      <p class="chamber-why">${decision.recommendation}</p>
    </div>` : ''}

    ${relevantPatterns.length > 0 ? html`
    <div class="chamber-section">
      <div class="chamber-section-label">Pattern from similar decisions</div>
      ${chamberPatternBlock(relevantPatterns)}
    </div>` : ''}

    ${options.length > 0 ? html`
    <div class="chamber-section">
      <div class="chamber-section-label">Options</div>
      ${options.map((o) => html`
      <div style="padding:0.85rem 1rem;background:var(--surface-2);border:1px solid var(--border);border-radius:6px;margin-bottom:0.5rem;">
        <div style="font-weight:600;margin-bottom:0.25rem;">${o.label}</div>
        <div style="font-size:0.87rem;color:var(--text-muted);">${o.description}</div>
        ${o.trade_offs ? html`<div style="font-size:0.82rem;color:var(--text-dim);margin-top:0.25rem;">${o.trade_offs}</div>` : ''}
      </div>`)}
    </div>` : ''}

    ${scenarios.length > 0 ? html`
    <div class="chamber-section">
      <div class="chamber-section-label">Scenarios</div>
      ${scenarioGrid(scenarios)}
    </div>` : ''}

    ${status === 'pending' ? html`
    <div class="chamber-section chamber-reflect" id="reflect-section">
      <p>What are you most uncertain about?</p>
      <textarea
        class="chamber-reflect-input"
        id="uncertainty"
        placeholder="Describe what's holding you back from deciding…"
      ></textarea>
      <button class="btn btn-secondary btn-sm" id="reflect-btn" onclick="getClarity()">Get clarity</button>
      <div class="chamber-reflect-response" id="reflect-response"></div>
    </div>

    <div class="chamber-resolve">
      <h3>Resolve this decision</h3>
      <div class="form-group">
        <label>Chosen option</label>
        <input type="text" id="chosen-option" placeholder="Enter the option you're choosing…" />
      </div>
      <div class="form-group">
        <label>Reasoning <span style="color:var(--text-dim)">(required for Gate 3)</span></label>
        <textarea id="resolution-reasoning" placeholder="Why did you choose this? What data drove the decision?"></textarea>
      </div>
      <button class="btn btn-primary" onclick="resolveDecision()">Resolve decision</button>
      <div id="resolve-result" style="margin-top:0.75rem;font-size:0.87rem;color:var(--text-muted);"></div>
    </div>` : html`
    <div class="card" style="margin-top:2rem;">
      <div class="chamber-section-label">Resolved</div>
      <p style="margin:0.35rem 0 0;">Chosen: <strong>${decision.chosen_option ?? '—'}</strong></p>
      ${decision.outcome ? html`
        <p style="margin:0.35rem 0 0;color:var(--text-muted);">Outcome: ${decision.outcome}</p>
        ${(decision as unknown as Record<string, unknown>).outcome_valence != null ? html`
        <p style="margin:0.25rem 0 0;font-size:0.82rem;">
          Result: <strong>${(decision as unknown as Record<string, unknown>).outcome_valence === 1 ? '✓ Worked' : (decision as unknown as Record<string, unknown>).outcome_valence === -1 ? '✗ Didn\'t work' : '◎ Mixed'}</strong>
        </p>` : ''}
      ` : html`
        <div class="outcome-log-form" style="margin-top:1rem;" id="outcome-log">
          <div class="chamber-section-label" style="margin-bottom:0.6rem;">Log outcome</div>
          <textarea id="outcome-text" class="outcome-textarea" placeholder="What happened? Be specific — this feeds your Decision Intelligence." rows="3"></textarea>
          <div class="outcome-valence-row">
            <span class="outcome-valence-label">How did it go?</span>
            <label class="valence-option"><input type="radio" name="valence" value="1" /> Worked</label>
            <label class="valence-option"><input type="radio" name="valence" value="0" /> Mixed</label>
            <label class="valence-option"><input type="radio" name="valence" value="-1" /> Didn't work</label>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="logOutcome()" style="margin-top:0.75rem;">Save outcome</button>
          <div id="outcome-result" style="margin-top:0.5rem;font-size:0.82rem;color:var(--text-muted);"></div>
        </div>
      `}
    </div>`}

    <script>
    (function() {
      const decisionId = '${decisionId}';

      window.getClarity = async function() {
        const uncertainty = document.getElementById('uncertainty').value.trim();
        if (!uncertainty) return;

        const btn = document.getElementById('reflect-btn');
        const responseEl = document.getElementById('reflect-response');
        btn.disabled = true;
        btn.textContent = 'Thinking…';

        try {
          const res = await fetch('/api/decisions/' + decisionId + '/reflect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ uncertainty }),
          });
          const data = await res.json();
          responseEl.textContent = data.clarity;
          responseEl.className = 'chamber-reflect-response visible';
          btn.style.display = 'none';
        } catch {
          btn.disabled = false;
          btn.textContent = 'Get clarity';
        }
      };

      window.logOutcome = async function() {
        const outcome = document.getElementById('outcome-text').value.trim();
        const valenceEl = document.querySelector('input[name="valence"]:checked');
        const resultEl = document.getElementById('outcome-result');
        if (!outcome) { resultEl.textContent = 'Write what happened first.'; return; }
        try {
          const res = await fetch('/decisions/' + decisionId + '/outcome', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              outcome,
              valence: valenceEl ? parseInt(valenceEl.value, 10) : null,
            }),
          });
          if (!res.ok) throw new Error();
          resultEl.textContent = 'Saved. This feeds your Decision Intelligence.';
          document.getElementById('outcome-log').style.opacity = '0.5';
          setTimeout(function() { window.location.reload(); }, 1500);
        } catch {
          resultEl.textContent = 'Something went wrong.';
        }
      };

      window.resolveDecision = async function() {
        const chosen = document.getElementById('chosen-option').value.trim();
        const reasoning = document.getElementById('resolution-reasoning').value.trim();
        const resultEl = document.getElementById('resolve-result');

        if (!chosen) {
          resultEl.textContent = 'Please enter the chosen option.';
          return;
        }

        try {
          const res = await fetch('/decisions/' + decisionId + '/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ chosen_option: chosen, resolution_reasoning: reasoning }),
          });
          if (!res.ok) {
            const err = await res.json();
            resultEl.textContent = err.error || 'Failed to resolve.';
            return;
          }
          resultEl.textContent = 'Decision resolved. Redirecting…';
          setTimeout(function() { window.location.href = '/decisions'; }, 1000);
        } catch {
          resultEl.textContent = 'Something went wrong.';
        }
      };
    })();
    </script>
  `;

  return c.html(chamberLayout(ctx, content));
});

// ─── Helpers: Pattern Block ───────────────────────────────────────────────────

function chamberPatternBlock(patterns: Array<Record<string, unknown>>) {
  const positive = patterns.filter((p) => p.outcome_direction === 'positive').length;
  const total = patterns.length;
  if (total === 0) return html``;

  const pct = Math.round((positive / total) * 100);
  const sample = patterns[0];

  return html`
  <div class="chamber-pattern">
    <span class="chamber-pattern-stat">${pct}%</span>
    of similar decisions had positive outcomes at this stage.
    ${sample && sample.option_chosen_category ? html`
    <span style="display:block;margin-top:0.4rem;font-size:0.82rem;color:var(--text-dim);">
      Most common choice: ${sample.option_chosen_category}
    </span>` : ''}
  </div>`;
}

// ─── Helpers: Scenario Grid ───────────────────────────────────────────────────

function scenarioGrid(scenarios: Array<Record<string, unknown>>) {
  return html`${scenarios.map((s) => html`
  <div style="margin-bottom:1.25rem;">
    <div style="font-size:0.82rem;font-weight:600;color:var(--text-muted);margin-bottom:0.5rem;">${s.option_label}</div>
    <div class="chamber-scenario-grid">
      <div class="chamber-scenario chamber-scenario-best">
        <div class="chamber-scenario-label">Best case</div>
        <div class="chamber-scenario-text">${summarizeCase(s.best_case)}</div>
      </div>
      <div class="chamber-scenario chamber-scenario-base">
        <div class="chamber-scenario-label">Base case</div>
        <div class="chamber-scenario-text">${summarizeCase(s.base_case)}</div>
      </div>
      <div class="chamber-scenario chamber-scenario-stress">
        <div class="chamber-scenario-label">Stress case</div>
        <div class="chamber-scenario-text">${summarizeCase(s.stress_case)}</div>
      </div>
    </div>
  </div>`)}`;
}

function summarizeCase(caseData: unknown): string {
  if (!caseData) return 'No data';
  try {
    const parsed = typeof caseData === 'string' ? JSON.parse(caseData) : caseData;
    return (parsed as Record<string, unknown>).narrative as string
      ?? JSON.stringify(parsed).slice(0, 140);
  } catch { return 'No data'; }
}

// ─── Resolve Decision ─────────────────────────────────────────────────────────

decisionRoutes.post('/decisions/:id/resolve', async (c) => {
  const founder = c.get('founder');
  const decisionId = c.req.param('id');
  const body = await c.req.json() as { chosen_option: string; resolution_reasoning?: string };
  const result = await query(
    `SELECT d.product_id, d.gate FROM decisions d
     JOIN products p ON d.product_id = p.id
     WHERE d.id = ? AND p.owner_id = ?`,
    [decisionId, founder.id]
  );
  if (result.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const row = result.rows[0] as Record<string, unknown>;
  const productId = row.product_id as string;
  const gate = row.gate as number | null;

  if (gate === 3 && !body.resolution_reasoning) {
    return c.json({ error: 'Gate 3 decisions require resolution_reasoning' }, 400);
  }

  await resolveDecision(decisionId, productId, body.chosen_option, 'founder');

  checkAndAwardMilestones(productId, founder.id).catch(() => {});

  if (body.resolution_reasoning) {
    await query(
      `UPDATE decisions SET resolution_reasoning = ?, wisdom_context_used = ? WHERE id = ?`,
      [body.resolution_reasoning, gate === 3 ? 1 : 0, decisionId]
    );
  }

  return c.json({ status: 'resolved' });
});

// ─── Record Outcome ───────────────────────────────────────────────────────────

decisionRoutes.post('/decisions/:id/outcome', async (c) => {
  const founder = c.get('founder');
  const decisionId = c.req.param('id');
  const body = await c.req.json() as { outcome: string; valence?: number };
  const result = await query(
    `SELECT d.product_id FROM decisions d
     JOIN products p ON d.product_id = p.id
     WHERE d.id = ? AND p.owner_id = ?`,
    [decisionId, founder.id]
  );
  if (result.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const productId = (result.rows[0] as Record<string, string>).product_id;
  const valence = body.valence != null ? Number(body.valence) : null;
  await recordOutcome(decisionId, productId, body.outcome, valence);
  return c.json({ status: 'recorded' });
});

// ─── Reflect: AI Clarity on Uncertainty ──────────────────────────────────────

decisionRoutes.post('/api/decisions/:id/reflect', async (c) => {
  const founder = c.get('founder');
  const decisionId = c.req.param('id');
  const body = await c.req.json() as { uncertainty: string };

  if (!body.uncertainty?.trim()) {
    return c.json({ error: 'uncertainty is required' }, 400);
  }

  const result = await query(
    `SELECT d.* FROM decisions d
     JOIN products p ON d.product_id = p.id
     WHERE d.id = ? AND p.owner_id = ?`,
    [decisionId, founder.id]
  );
  if (result.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const decision = result.rows[0] as Record<string, unknown>;

  const systemPrompt = `You are a strategic advisor for a SaaS founder. You give clear, direct guidance. No hedging. No "you might want to consider." You answer in 2-3 sentences maximum.`;

  const userPrompt = `A founder is facing this decision: "${decision.what}"

Their uncertainty: "${body.uncertainty}"

Context: ${decision.why_now ?? ''}

Give them 2-3 sentences of direct clarity on their specific uncertainty. Address exactly what they're unsure about.`;

  try {
    const response = await callSonnet(systemPrompt, userPrompt, 300);
    return c.json({ clarity: response.content.trim() });
  } catch {
    return c.json({ clarity: 'Unable to generate clarity right now. Trust what you know.' });
  }
});

// ─── Decision Intelligence (Analytics) ───────────────────────────────────────

import { callOpus, parseJSONResponse } from '../../services/ai/client.js';

decisionRoutes.get('/decisions/analytics', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'decisions', 'Decision Intelligence', undefined, c);
  if (!ctx.productId) return c.redirect('/decisions');

  const productId = ctx.productId;

  const [totalsResult, categoryResult, speedResult] = await Promise.all([
    query(
      `SELECT
         COUNT(*) as total,
         COUNT(CASE WHEN status = 'approved' THEN 1 END) as resolved,
         COUNT(CASE WHEN outcome_valence IS NOT NULL THEN 1 END) as with_outcomes,
         COUNT(CASE WHEN outcome_valence = 1 THEN 1 END) as favorable,
         COUNT(CASE WHEN outcome_valence = -1 THEN 1 END) as unfavorable
       FROM decisions WHERE product_id = ?`,
      [productId],
    ),
    query(
      `SELECT
         category,
         COUNT(*) as total,
         COUNT(CASE WHEN status = 'approved' THEN 1 END) as resolved,
         COUNT(CASE WHEN outcome_valence IS NOT NULL THEN 1 END) as with_outcomes,
         COUNT(CASE WHEN outcome_valence = 1 THEN 1 END) as favorable,
         COUNT(CASE WHEN outcome_valence = -1 THEN 1 END) as unfavorable,
         ROUND(AVG(CASE WHEN decided_at IS NOT NULL THEN julianday(decided_at) - julianday(created_at) END), 1) as avg_days
       FROM decisions
       WHERE product_id = ? AND category NOT IN ('informational')
       GROUP BY category ORDER BY total DESC`,
      [productId],
    ),
    query(
      `SELECT
         CASE
           WHEN julianday(decided_at) - julianday(created_at) < 3 THEN 'fast'
           WHEN julianday(decided_at) - julianday(created_at) <= 7 THEN 'medium'
           ELSE 'slow'
         END as bucket,
         COUNT(*) as total,
         COUNT(CASE WHEN outcome_valence = 1 THEN 1 END) as favorable,
         COUNT(CASE WHEN outcome_valence IS NOT NULL THEN 1 END) as with_outcomes,
         ROUND(AVG(julianday(decided_at) - julianday(created_at)), 1) as avg_days
       FROM decisions
       WHERE product_id = ? AND status = 'approved' AND decided_at IS NOT NULL
       GROUP BY bucket`,
      [productId],
    ),
  ]);

  const totals = (totalsResult.rows[0] ?? {}) as Record<string, number>;
  const categories = categoryResult.rows as Array<Record<string, unknown>>;
  const speedRows = speedResult.rows as Array<Record<string, unknown>>;

  // Merge speed buckets into a fixed order
  const speedBuckets = ['fast', 'medium', 'slow'].map((b) => {
    const found = speedRows.find((r) => r.bucket === b);
    return found ?? { bucket: b, total: 0, favorable: 0, with_outcomes: 0, avg_days: null };
  }) as Array<Record<string, unknown>>;

  // AI synthesis only if there's enough outcome data
  let synthesis: string | null = null;
  if (totals.with_outcomes >= 3) {
    const catSummary = categories
      .filter((c) => (c.with_outcomes as number) > 0)
      .map((c) => `${c.category}: ${c.favorable}/${c.with_outcomes} favorable, avg ${c.avg_days ?? '?'}d to decide`)
      .join('\n');
    const speedSummary = speedBuckets
      .filter((b) => (b.with_outcomes as number) > 0)
      .map((b) => `${b.bucket} (<${b.bucket === 'fast' ? '3' : b.bucket === 'medium' ? '7' : '7+'}d): ${b.favorable}/${b.with_outcomes} favorable`)
      .join('\n');

    try {
      const raw = await callOpus(
        'You are Foundry. Given decision history data, synthesize the founder\'s pattern in 2-3 direct sentences. No markdown. No hedging. Address them as "You".',
        `Categories:\n${catSummary}\n\nSpeed vs quality:\n${speedSummary}\n\nReturn JSON only: { "synthesis": "2-3 sentence pattern insight" }`,
        350,
      );
      const parsed = parseJSONResponse<{ synthesis: string }>(raw.content);
      synthesis = parsed?.synthesis ?? null;
    } catch { /* non-critical */ }
  }

  // Render helpers
  const pct = (favorable: number, total: number) =>
    total > 0 ? Math.round((favorable / total) * 100) : null;

  const barRow = (label: string, favorable: number, total: number, extra = '') => {
    const p = pct(favorable, total);
    const barW = p ?? 0;
    return html`
    <div class="analytics-row">
      <div class="analytics-row-label">${label}</div>
      <div class="analytics-row-bar">
        <div class="analytics-bar-fill" style="width:${barW}%"></div>
      </div>
      <div class="analytics-row-stat">
        ${p !== null ? html`<span class="analytics-pct">${p}%</span> <span class="analytics-sub">(${favorable}/${total})</span>` : html`<span class="analytics-sub">no outcomes yet</span>`}
        ${extra ? html`<span class="analytics-extra"> · ${extra}</span>` : ''}
      </div>
    </div>`;
  };

  const categoryLabels: Record<string, string> = {
    urgent: 'Urgent', strategic: 'Strategic', product: 'Product', marketing: 'Marketing',
  };

  const content = html`
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1.5rem;">
      <h1 style="margin:0;">Decision Intelligence</h1>
      <a href="/decisions" class="btn btn-ghost btn-sm">← All decisions</a>
    </div>

    <div class="analytics-totals">
      <div class="analytics-total-item">
        <div class="analytics-total-value">${totals.total ?? 0}</div>
        <div class="analytics-total-label">Total decisions</div>
      </div>
      <div class="analytics-total-item">
        <div class="analytics-total-value">${totals.resolved ?? 0}</div>
        <div class="analytics-total-label">Resolved</div>
      </div>
      <div class="analytics-total-item">
        <div class="analytics-total-value">${totals.with_outcomes ?? 0}</div>
        <div class="analytics-total-label">Outcomes logged</div>
      </div>
      <div class="analytics-total-item">
        <div class="analytics-total-value">${totals.with_outcomes > 0 ? `${pct(totals.favorable, totals.with_outcomes)}%` : '—'}</div>
        <div class="analytics-total-label">Favorable rate</div>
      </div>
    </div>

    ${categories.length > 0 ? html`
    <div class="card analytics-section">
      <div class="analytics-section-label">Outcome quality by category</div>
      ${categories.map((cat) => barRow(
        categoryLabels[cat.category as string] ?? (cat.category as string),
        cat.favorable as number,
        cat.with_outcomes as number,
        cat.avg_days ? `avg ${cat.avg_days}d to decide` : '',
      ))}
    </div>` : ''}

    <div class="card analytics-section">
      <div class="analytics-section-label">Decision speed vs. quality</div>
      ${barRow('Fast  (<3 days)', speedBuckets[0].favorable as number, speedBuckets[0].with_outcomes as number,
        (speedBuckets[0].total as number) > 0 ? `${speedBuckets[0].total} decisions` : '')}
      ${barRow('Medium (3–7 days)', speedBuckets[1].favorable as number, speedBuckets[1].with_outcomes as number,
        (speedBuckets[1].total as number) > 0 ? `${speedBuckets[1].total} decisions` : '')}
      ${barRow('Slow  (>7 days)', speedBuckets[2].favorable as number, speedBuckets[2].with_outcomes as number,
        (speedBuckets[2].total as number) > 0 ? `${speedBuckets[2].total} decisions` : '')}
    </div>

    ${synthesis ? html`
    <div class="card analytics-synthesis">
      <div class="analytics-section-label">Your pattern</div>
      <p class="analytics-synthesis-text">${synthesis}</p>
    </div>` : totals.with_outcomes < 3 ? html`
    <div class="card" style="text-align:center;padding:2rem;">
      <div style="font-size:0.87rem;color:var(--text-dim);">
        Log outcomes on ${3 - (totals.with_outcomes ?? 0)} more decision${3 - (totals.with_outcomes ?? 0) === 1 ? '' : 's'} to unlock your decision pattern.
      </div>
      <a href="/decisions" class="btn btn-ghost btn-sm" style="margin-top:0.75rem;">Go to decisions</a>
    </div>` : ''}
  `;

  return c.html(dashboardLayout(ctx, content));
});
