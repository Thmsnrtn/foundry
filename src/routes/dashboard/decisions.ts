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
    <h1>Decisions</h1>
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
      ${decision.outcome ? html`<p style="margin:0.35rem 0 0;color:var(--text-muted);">Outcome: ${decision.outcome}</p>` : ''}
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
  const body = await c.req.json() as { outcome: string };
  const result = await query(
    `SELECT d.product_id FROM decisions d
     JOIN products p ON d.product_id = p.id
     WHERE d.id = ? AND p.owner_id = ?`,
    [decisionId, founder.id]
  );
  if (result.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const productId = (result.rows[0] as Record<string, string>).product_id;
  await recordOutcome(decisionId, productId, body.outcome);
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
