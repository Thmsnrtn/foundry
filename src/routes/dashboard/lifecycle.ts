import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { query, getProductByOwner, getLifecycleState, getLifecycleConditions } from '../../db/client.js';
import { dashboardLayout } from '../../views/layout.js';
import { lifecycleProgress, lifecycleConditions } from '../../views/components.js';
import { getLayoutContext } from './_shared.js';
import { PROMPT_ORDER, promptIndex } from '../../services/lifecycle/monitor.js';

/** Human-readable descriptions and actions for each lifecycle prompt. */
const PROMPT_DESCRIPTIONS: Record<string, { name: string; description: string; what: string; nextAction: string }> = {
  prompt_1: {
    name: 'Initial Audit',
    description: 'Foundry analyzes your codebase across 10 dimensions to establish a baseline.',
    what: 'Run your first audit and review the results. Fix blocking issues before proceeding.',
    nextAction: 'Run an audit from the Audit page.',
  },
  prompt_2: {
    name: 'Hypothesis Formation',
    description: 'Based on your audit results, Foundry forms hypotheses about your product\'s market fit.',
    what: 'Review and validate the hypotheses Foundry generates. Confirm or reject each one.',
    nextAction: 'Check the Decisions queue for hypothesis validation tasks.',
  },
  prompt_2_5: {
    name: 'Remediation',
    description: 'Auto-fix blocking issues from your audit. PRs are opened against your repo.',
    what: 'Review and merge the remediation PRs Foundry creates.',
    nextAction: 'Check the Remediation page for open PRs.',
  },
  prompt_3: {
    name: 'Beta Infrastructure',
    description: 'Set up feedback loops with early users. Capture interviews, quotes, and activation data.',
    what: 'Record beta participant interviews and track activation outcomes.',
    nextAction: 'Visit the Beta page to log participant feedback.',
  },
  prompt_4: {
    name: 'Intelligence Activation',
    description: 'Stressor reports, competitive monitoring, and risk state assessment come online.',
    what: 'Start reporting metrics (MRR, retention, NPS) so intelligence can calibrate.',
    nextAction: 'Report metrics via the Revenue page or API.',
  },
  prompt_5: {
    name: 'Decision Engine',
    description: 'Foundry begins surfacing decisions with context, options, and scenario models.',
    what: 'Review and resolve decisions as they appear. Each resolution trains the pattern engine.',
    nextAction: 'Check the Decisions queue regularly.',
  },
  prompt_6: {
    name: 'Competitive Intelligence',
    description: 'Weekly competitive scans detect pricing changes, feature launches, and positioning shifts.',
    what: 'Review competitive signals and factor them into your strategy.',
    nextAction: 'Visit the Competitive page for the latest signals.',
  },
  prompt_7: {
    name: 'Cohort Analysis',
    description: 'Retention curves and cohort comparisons reveal which acquisition channels retain best.',
    what: 'Monitor cohort health and compare against historical averages.',
    nextAction: 'Visit the Cohorts page.',
  },
  prompt_8: {
    name: 'Scenario Modeling',
    description: 'Gate 3 decisions include forward projections at 30, 60, and 90 days.',
    what: 'Review scenario models before making high-impact decisions.',
    nextAction: 'Scenarios appear automatically on Gate 3+ decisions.',
  },
  prompt_9: {
    name: 'Full Autonomy',
    description: 'Foundry has exited cold start. Pattern library is calibrated. Maximum autonomous operation.',
    what: 'Continue operating. Foundry handles Gate 0-2 actions autonomously.',
    nextAction: 'Review the weekly digest and respond to Gate 3+ decisions.',
  },
};

export const lifecycleRoutes = new Hono<AuthEnv>();

lifecycleRoutes.get('/products/:id/lifecycle', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const ctx = await getLayoutContext(founder, 'lifecycle', 'Lifecycle', productId, c);
  const state = await getLifecycleState(productId);
  const conditionsResult = await getLifecycleConditions(productId);
  const ls = state.rows[0] as Record<string, unknown> | undefined;
  const currentPrompt = (ls?.current_prompt as string) ?? 'prompt_1';
  const riskState = (ls?.risk_state as string) ?? 'green';

  // `parseInt('2_5')` is 2, so Remediation and Hypothesis Formation shared a
  // position: at phase 2.5 the page drew phase 2 as not yet started. The order
  // is now read from the one place that defines it.
  const position = promptIndex(currentPrompt);
  const promptInfo: (typeof PROMPT_DESCRIPTIONS)[string] | null =
    PROMPT_DESCRIPTIONS[currentPrompt] ?? null;

  const content = html`
    <h1>Lifecycle</h1>

    <div class="card">
      <h3>Current Position</h3>
      ${lifecycleProgress(currentPrompt)}
    </div>

    <div class="card" style="border-left:3px solid #2563eb;">
      <div style="display:flex;justify-content:space-between;align-items:start;">
        <div>
          <h3 style="margin-bottom:0.25rem;">${promptInfo
            ? html`Phase ${position + 1}: ${promptInfo.name}`
            : html`Phase not recognised`}</h3>
          <p style="color:#4b5563;margin-bottom:0.75rem;">${promptInfo
            ? promptInfo.description
            : html`This company's lifecycle position is recorded as
              "${currentPrompt}", which is not one of the phases this page
              describes. Nothing here is a statement about the company.`}</p>
        </div>
        <span class="risk-badge risk-${riskState}">${riskState.toUpperCase()}</span>
      </div>
      ${promptInfo ? html`
      <div style="background:#f8fafc;border-radius:6px;padding:1rem;margin-bottom:0.75rem;">
        <strong style="font-size:0.87rem;">What you should be doing:</strong>
        <p style="color:#374151;margin:0.25rem 0 0;">${promptInfo.what}</p>
      </div>
      <p style="font-size:0.87rem;"><strong>Next action:</strong> ${promptInfo.nextAction}</p>` : ''}
    </div>

    <div class="card">
      <h3>All Phases</h3>
      <div style="display:flex;flex-direction:column;gap:0.5rem;">
        ${PROMPT_ORDER.map((key) => {
          const info = PROMPT_DESCRIPTIONS[key];
          const isCurrent = key === currentPrompt;
          const isPast = position >= 0 && promptIndex(key) < position;
          const statusIcon = isPast ? '✓' : isCurrent ? '→' : '○';
          const statusColor = isPast ? '#059669' : isCurrent ? '#2563eb' : '#9ca3af';
          return html`
            <div style="display:flex;align-items:start;gap:0.75rem;padding:0.5rem 0;${isPast ? 'opacity:0.6;' : ''}">
              <span style="color:${statusColor};font-weight:700;font-size:1.1rem;min-width:20px;text-align:center;">${statusIcon}</span>
              <div>
                <strong style="font-size:0.87rem;${isCurrent ? 'color:#2563eb;' : ''}">${info.name}</strong>
                <p style="font-size:0.8rem;color:#6b7280;margin:0;">${info.description}</p>
              </div>
            </div>
          `;
        })}
      </div>
    </div>

    <p style="font-size:0.8rem;color:#6b7280;margin:-0.5rem 0 1rem;">
      A phase is reached when every one of its activation conditions is met —
      the conditions below are what Foundry evaluates. Hypothesis Formation and
      Remediation have no conditions defined, so a company moves from the audit
      straight to Beta Infrastructure when that phase's conditions are met.
    </p>

    ${lifecycleConditions(conditionsResult.rows as Array<Record<string, unknown>>)}
  `;

  return c.html(dashboardLayout(ctx, content));
});
