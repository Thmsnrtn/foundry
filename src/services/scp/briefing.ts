// =============================================================================
// FOUNDRY — SCP CEO Briefing Generator
// Assembles the daily CEO briefing from agent session outputs.
// Called by SCPInstance.generateBriefing() and schedulers.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { callSonnet } from '../ai/client.js';
import { buildBriefingHeadlinePrompt } from '../../prompts/briefing-headline.js';
import { buildDestinationContext } from '../destination/briefing-context.js';
import type {
  SCPBriefing,
  AgentBriefingContribution,
  AgentDecision,
  AgentAction,
  FinancialSummary,
  CompanyLifecycleState,
  AgentName,
} from './types.js';
import { AGENT_DISPLAY_NAMES, AGENT_ROLES } from './types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseJSON<T>(value: string | null | undefined, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function rowToBriefing(r: Record<string, unknown>): SCPBriefing {
  return {
    id: r.id as string,
    product_id: r.product_id as string,
    briefing_date: r.briefing_date as string,
    signal_score: r.signal_score as number | null,
    risk_state: r.risk_state as string | null,
    health_score: r.health_score as number | null,
    headline: r.headline as string,
    full_briefing: r.full_briefing as string,
    agent_contributions: parseJSON<AgentBriefingContribution[]>(r.agent_contributions as string | null, []),
    pending_decisions: parseJSON<AgentDecision[]>(r.pending_decisions as string | null, []),
    overnight_actions: parseJSON<AgentAction[]>(r.overnight_actions as string | null, []),
    financial_summary: parseJSON<FinancialSummary | null>(r.financial_summary as string | null, null),
    lifecycle_state: r.lifecycle_state as CompanyLifecycleState | null,
    tokens_used: (r.tokens_used as number) ?? 0,
    cost_usd: (r.cost_usd as number) ?? 0,
    created_at: r.created_at as string,
  };
}

// ─── generateDailyBriefing ────────────────────────────────────────────────────

export async function generateDailyBriefing(
  productId: string,
  forDate?: string
): Promise<SCPBriefing> {
  const briefingDate = forDate ?? today();

  // Check if briefing already exists for today
  const existing = await query(
    'SELECT * FROM scp_briefings WHERE product_id=? AND briefing_date=?',
    [productId, briefingDate]
  );
  if (existing.rows.length > 0) {
    return rowToBriefing(existing.rows[0] as Record<string, unknown>);
  }

  // Get product info
  const productResult = await query(
    `SELECT name, company_lifecycle_state, scp_status, health_score,
            ai_cost_trailing_30d_usd, attributed_revenue_trailing_30d_usd
     FROM products WHERE id=?`,
    [productId]
  );
  if (productResult.rows.length === 0) throw new Error(`Product ${productId} not found`);
  const prod = productResult.rows[0] as Record<string, unknown>;
  const companyName = (prod.name as string) ?? 'Unknown';

  // Get today's/yesterday's agent sessions — last completed session per agent
  const sessionsResult = await query(
    `SELECT * FROM agent_sessions
     WHERE product_id=? AND status='completed'
       AND DATE(started_at) IN (?, ?)
     ORDER BY started_at DESC`,
    [productId, briefingDate, yesterday()]
  );

  // De-duplicate: one per agent (most recent)
  const seenAgents = new Set<string>();
  const latestSessions: Record<string, unknown>[] = [];
  for (const row of sessionsResult.rows) {
    const r = row as Record<string, unknown>;
    const agentName = r.agent_name as string;
    if (!seenAgents.has(agentName)) {
      seenAgents.add(agentName);
      latestSessions.push(r);
    }
  }

  // Get signal score + risk state from signal_history
  let signalScore: number | null = null;
  let riskState: string | null = null;
  try {
    const signalResult = await query(
      `SELECT signal_score, risk_state FROM signal_history
       WHERE product_id=? ORDER BY computed_at DESC LIMIT 1`,
      [productId]
    );
    if (signalResult.rows.length > 0) {
      const sr = signalResult.rows[0] as Record<string, unknown>;
      signalScore = sr.signal_score as number | null;
      riskState = sr.risk_state as string | null;
    }
  } catch {
    // signal_history may not exist yet
  }

  // Get MRR from metric_snapshots
  let mrrCents: number | null = null;
  let mrrGrowthPct: number | null = null;
  try {
    const metricsResult = await query(
      `SELECT mrr_cents, mrr_growth_pct FROM metric_snapshots
       WHERE product_id=? ORDER BY snapshot_date DESC LIMIT 1`,
      [productId]
    );
    if (metricsResult.rows.length > 0) {
      const mr = metricsResult.rows[0] as Record<string, unknown>;
      mrrCents = mr.mrr_cents as number | null;
      mrrGrowthPct = mr.mrr_growth_pct as number | null;
    }
  } catch {
    // metric_snapshots columns may vary
  }

  // Compute health score
  const { SCPInstance } = await import('./instance.js');
  const healthScore = await new SCPInstance(productId).computeHealthScore();

  // Compute AI cost (30d) from agent_cost_log
  let aiCost30d = 0;
  try {
    const costResult = await query(
      `SELECT SUM(cost_usd) as total FROM agent_cost_log
       WHERE product_id=? AND logged_at >= datetime('now', '-30 days')`,
      [productId]
    );
    aiCost30d = ((costResult.rows[0] as Record<string, unknown>)?.total as number) ?? 0;
  } catch {
    aiCost30d = (prod.ai_cost_trailing_30d_usd as number) ?? 0;
  }

  const attributedRevenue = (prod.attributed_revenue_trailing_30d_usd as number) ?? 0;
  const roi = aiCost30d > 0 ? attributedRevenue / aiCost30d : null;

  const financialSummary: FinancialSummary = {
    mrr_cents: mrrCents,
    mrr_growth_pct: mrrGrowthPct,
    ai_cost_30d_usd: aiCost30d,
    attributed_revenue_usd: attributedRevenue,
    roi,
  };

  // Collect pending_decisions from all sessions
  const allPendingDecisions: AgentDecision[] = [];
  const overnightActions: AgentAction[] = [];
  const agentContributions: AgentBriefingContribution[] = [];

  for (const session of latestSessions) {
    const agentName = session.agent_name as AgentName;
    const decisions = parseJSON<AgentDecision[]>(session.pending_decisions as string | null, []);
    const actions = parseJSON<AgentAction[]>(session.actions_taken as string | null, []);
    const executedActions = actions.filter((a) => a.executed);

    allPendingDecisions.push(...decisions);
    overnightActions.push(...executedActions);

    agentContributions.push({
      agent_name: agentName,
      display_name: AGENT_DISPLAY_NAMES[agentName] ?? agentName,
      role: AGENT_ROLES[agentName] ?? '',
      contribution: (session.briefing_contribution as string) ?? '',
      priority: (session.briefing_priority as 'high' | 'normal' | 'low') ?? 'normal',
      pending_decisions_count: decisions.length,
      actions_taken_count: executedActions.length,
      session_id: (session.id as string) ?? null,
    });
  }

  // V3.1 Layer A: pull destination context (North Star + outcome tree).
  // Best-effort — briefing proceeds without it if anything fails.
  let destinationBlock = '';
  try {
    const ctx = await buildDestinationContext(productId);
    if (ctx.has_north_star) destinationBlock = ctx.briefing_block;
  } catch {
    // Non-blocking; older products without a North Star are unaffected.
  }

  // Generate headline via Claude
  let headline = `${companyName} — Daily Operations Summary`;
  let tokensUsed = 0;
  let costUsd = 0;

  if (agentContributions.length > 0) {
    try {
      // Centralized prompt builder — see src/prompts/briefing-headline.ts.
      // The builder is testable in isolation via tests/evals/.
      const prompt = buildBriefingHeadlinePrompt({
        companyName,
        observations: agentContributions.map((c) => ({
          display_name: c.display_name,
          contribution: c.contribution ?? null,
        })),
        destinationBlock,
      });

      const headlineResponse = await callSonnet(
        prompt.system,
        prompt.user,
        prompt.maxTokens,
        productId
      );
      headline = headlineResponse.content.trim().slice(0, 120);
      tokensUsed = headlineResponse.usage.input_tokens + headlineResponse.usage.output_tokens;
      // Approximate cost: $3/1M input, $15/1M output (Sonnet)
      costUsd = (headlineResponse.usage.input_tokens * 0.000003) + (headlineResponse.usage.output_tokens * 0.000015);
    } catch {
      // Use fallback headline
    }
  }

  // Build full briefing markdown
  const briefing: SCPBriefing = {
    id: nanoid(),
    product_id: productId,
    briefing_date: briefingDate,
    signal_score: signalScore,
    risk_state: riskState,
    health_score: healthScore,
    headline,
    full_briefing: '',
    agent_contributions: agentContributions,
    pending_decisions: allPendingDecisions,
    overnight_actions: overnightActions,
    financial_summary: financialSummary,
    lifecycle_state: (prod.company_lifecycle_state as CompanyLifecycleState) ?? null,
    tokens_used: tokensUsed,
    cost_usd: costUsd,
    created_at: new Date().toISOString(),
  };

  briefing.full_briefing = formatBriefingAsMarkdown(briefing, destinationBlock);

  // UPSERT into scp_briefings
  await query(
    `INSERT INTO scp_briefings
       (id, product_id, briefing_date, signal_score, risk_state, health_score,
        headline, full_briefing, agent_contributions, pending_decisions,
        overnight_actions, financial_summary, lifecycle_state, tokens_used, cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(product_id, briefing_date) DO UPDATE SET
       signal_score=excluded.signal_score,
       risk_state=excluded.risk_state,
       health_score=excluded.health_score,
       headline=excluded.headline,
       full_briefing=excluded.full_briefing,
       agent_contributions=excluded.agent_contributions,
       pending_decisions=excluded.pending_decisions,
       overnight_actions=excluded.overnight_actions,
       financial_summary=excluded.financial_summary,
       lifecycle_state=excluded.lifecycle_state,
       tokens_used=excluded.tokens_used,
       cost_usd=excluded.cost_usd`,
    [
      briefing.id,
      productId,
      briefingDate,
      signalScore,
      riskState,
      healthScore,
      headline,
      briefing.full_briefing,
      JSON.stringify(agentContributions),
      JSON.stringify(allPendingDecisions),
      JSON.stringify(overnightActions),
      JSON.stringify(financialSummary),
      briefing.lifecycle_state,
      tokensUsed,
      costUsd,
    ]
  );

  return briefing;
}

// ─── getLatestBriefing ────────────────────────────────────────────────────────

export async function getLatestBriefing(productId: string): Promise<SCPBriefing | null> {
  const result = await query(
    'SELECT * FROM scp_briefings WHERE product_id=? ORDER BY briefing_date DESC LIMIT 1',
    [productId]
  );
  if (result.rows.length === 0) return null;
  return rowToBriefing(result.rows[0] as Record<string, unknown>);
}

// ─── getBriefingHistory ───────────────────────────────────────────────────────

export async function getBriefingHistory(productId: string, limit = 30): Promise<SCPBriefing[]> {
  const result = await query(
    'SELECT * FROM scp_briefings WHERE product_id=? ORDER BY briefing_date DESC LIMIT ?',
    [productId, limit]
  );
  return result.rows.map((row) => rowToBriefing(row as Record<string, unknown>));
}

// ─── formatBriefingAsMarkdown ─────────────────────────────────────────────────

/**
 * Render the briefing in the V3.1 visual contract from
 * docs/design/surface-collapse-proposal.md (Surface 3):
 *
 *   1. Headline (already Sonnet-drafted)
 *   2. The number that matters — North Star progress when present, else
 *      a compact Signal/Risk/Health line.
 *   3. "Decide today" — top decisions front and center.
 *   4. "Overnight Activity" — agent contributions as a tight bulleted list.
 *   5. What's working / Needs attention — only when non-empty.
 *   6. Destination block (legacy, for callers passing pre-formatted text
 *      and for the briefing-destination test).
 *   7. Compact footer line: Signal · Risk · Health · MRR · AI 30d.
 *
 * Goal: a 90-second read on a phone. Most-touched user surface — see
 * elite-persona-review-2026-05-08.md (Tobi, Chesky, Norman, Tufte).
 */
export function formatBriefingAsMarkdown(briefing: SCPBriefing, destinationBlock?: string): string {
  const lines: string[] = [];

  // ─── Headline ─────────────────────────────────────────────────────────
  lines.push(`# ${briefing.headline}`);
  lines.push('');

  // ─── The number that matters ──────────────────────────────────────────
  // When the destination block carries a Progress line ("$X / $Y ARR"),
  // surface it as the prominent metric. Otherwise fall back to Signal.
  const progressLine = extractProgressLine(destinationBlock);
  if (progressLine) {
    lines.push(`> **${progressLine}**`);
    lines.push('');
  } else if (briefing.signal_score !== null) {
    const arrow = briefing.signal_score >= 70 ? '↑' : briefing.signal_score >= 40 ? '→' : '↓';
    lines.push(`> **Signal: ${briefing.signal_score}/100 ${arrow}**`);
    lines.push('');
  }

  // ─── Decide today ─────────────────────────────────────────────────────
  const decisions = briefing.pending_decisions ?? [];
  if (decisions.length > 0) {
    lines.push(`## Decide today (${decisions.length})`);
    lines.push('');
    // Top decision gets the most attention.
    const [top, ...rest] = decisions;
    lines.push(`**${top.title}** — ${AGENT_ROLES[top.agent_name] ?? top.agent_name}  `);
    lines.push(top.description);
    if (top.estimated_impact_usd) {
      lines.push(`Estimated value: $${top.estimated_impact_usd.toLocaleString()} · ${top.expected_impact}`);
    } else if (top.expected_impact) {
      lines.push(`Expected: ${top.expected_impact}`);
    }
    lines.push('');
    if (rest.length > 0) {
      lines.push(`<details><summary>${rest.length} more decision${rest.length === 1 ? '' : 's'} waiting</summary>`);
      lines.push('');
      for (const d of rest) {
        lines.push(`- **${d.title}** (${AGENT_ROLES[d.agent_name] ?? d.agent_name}): ${d.description}`);
      }
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  // ─── Overnight Activity ───────────────────────────────────────────────
  lines.push('## Overnight Activity');
  lines.push('');

  const highPriority = briefing.agent_contributions.filter((c) => c.priority === 'high' && c.contribution);
  const normalPriority = briefing.agent_contributions.filter((c) => c.priority !== 'high' && c.contribution);

  if (highPriority.length === 0 && normalPriority.length === 0) {
    lines.push('_No agent activity recorded for this period._');
  } else {
    // High-priority items get full sentences; normal gets a compact bullet list.
    for (const contrib of highPriority) {
      lines.push(`**${contrib.display_name} (${contrib.role}):** ${contrib.contribution}`);
    }
    if (highPriority.length > 0 && normalPriority.length > 0) lines.push('');
    for (const contrib of normalPriority) {
      lines.push(`- **${contrib.display_name}:** ${contrib.contribution}`);
    }
  }
  lines.push('');

  // ─── What's working / Needs attention ─────────────────────────────────
  const positiveObs = briefing.agent_contributions
    .filter((c) => c.contribution?.toLowerCase().includes('improv') || c.contribution?.toLowerCase().includes('increas') || c.contribution?.toLowerCase().includes('strong'))
    .map((c) => `- **${c.display_name}:** ${c.contribution}`);

  const criticalObs = briefing.agent_contributions
    .filter((c) => c.priority === 'high' && (c.contribution?.toLowerCase().includes('risk') || c.contribution?.toLowerCase().includes('issue') || c.contribution?.toLowerCase().includes('drop') || c.contribution?.toLowerCase().includes('fail')))
    .map((c) => `- **${c.display_name}:** ${c.contribution}`);

  if (positiveObs.length > 0) {
    lines.push('## What\'s working');
    lines.push('');
    lines.push(...positiveObs);
    lines.push('');
  }

  if (criticalObs.length > 0) {
    lines.push('## Needs attention');
    lines.push('');
    lines.push(...criticalObs);
    lines.push('');
  }

  // ─── Destination (legacy block, kept for test compat & callers that
  //     pass pre-formatted text). Only renders when supplied. ───────────
  if (destinationBlock && destinationBlock.trim().length > 0) {
    lines.push('## Destination');
    lines.push('');
    lines.push(destinationBlock.split('\n').join('  \n'));
    lines.push('');
  }

  // ─── Footer ───────────────────────────────────────────────────────────
  lines.push('---');
  lines.push('');
  const footer = buildBriefingFooter(briefing);
  lines.push(footer);

  return lines.join('\n');
}

function buildBriefingFooter(b: SCPBriefing): string {
  const parts: string[] = [];
  if (b.signal_score !== null) parts.push(`Signal ${b.signal_score}/100`);
  if (b.risk_state) parts.push(`Risk ${String(b.risk_state).toUpperCase()}`);
  if (b.health_score !== null) parts.push(`Health ${b.health_score}/100`);
  const fin = b.financial_summary;
  if (fin) {
    if (fin.mrr_cents !== null) parts.push(`MRR $${(fin.mrr_cents / 100).toLocaleString()}`);
    parts.push(`AI 30d $${fin.ai_cost_30d_usd.toFixed(2)}`);
  }
  return parts.join(' · ');
}

/**
 * Pull the most-prominent progress sentence out of a destination block —
 * looks for a "Progress: ..." line written by destination/briefing-context.ts.
 * Returns null when the block has no Progress line.
 */
function extractProgressLine(block: string | undefined): string | null {
  if (!block) return null;
  for (const raw of block.split('\n')) {
    const trimmed = raw.trim();
    if (trimmed.startsWith('Progress:')) {
      return trimmed.replace(/^Progress:\s*/, '');
    }
  }
  return null;
}

// ─── formatBriefingAsHTML ─────────────────────────────────────────────────────

export function formatBriefingAsHTML(briefing: SCPBriefing, companyName: string): string {
  const decisions = briefing.pending_decisions ?? [];
  const contributions = briefing.agent_contributions ?? [];
  const fin = briefing.financial_summary;

  const signalDelta = briefing.signal_score !== null
    ? (briefing.signal_score >= 70 ? '↑' : briefing.signal_score >= 40 ? '→' : '↓')
    : '';

  const escHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const decisionsHtml = decisions.map((d) => `
    <div style="background:var(--bg-card, #1a1a2e); border:1px solid var(--border, #2a2a3e); border-radius:8px; padding:16px; margin-bottom:12px;">
      <h4 style="margin:0 0 8px; color:var(--text-primary, #e2e8f0);">${escHtml(d.title)}</h4>
      <p style="margin:0 0 8px; color:var(--text-secondary, #94a3b8); font-size:14px;">${escHtml(d.description)}</p>
      <p style="margin:0 0 12px; font-size:13px; color:var(--accent, #6366f1);"><strong>Expected impact:</strong> ${escHtml(d.expected_impact)}</p>
      <div style="display:flex; gap:8px;">
        <form method="POST" action="/agents/decisions/${escHtml(d.id)}/approve" style="display:inline;">
          <button type="submit" style="background:var(--accent, #6366f1); color:white; border:none; border-radius:6px; padding:8px 16px; cursor:pointer; font-size:13px;">
            Approve
          </button>
        </form>
        <form method="POST" action="/agents/decisions/${escHtml(d.id)}/deny" style="display:inline;">
          <input type="hidden" name="reason" value="Declined by founder" />
          <button type="submit" style="background:var(--bg-card, #2a2a3e); color:var(--text-secondary, #94a3b8); border:1px solid var(--border, #2a2a3e); border-radius:6px; padding:8px 16px; cursor:pointer; font-size:13px;">
            Deny
          </button>
        </form>
      </div>
    </div>
  `).join('');

  const contribsHtml = contributions
    .filter((c) => c.contribution)
    .map((c) => {
      const priorityColor = c.priority === 'high' ? 'var(--accent, #6366f1)' : 'var(--text-secondary, #94a3b8)';
      return `
        <div style="border-left:3px solid ${priorityColor}; padding:8px 12px; margin-bottom:8px;">
          <span style="font-weight:600; color:var(--text-primary, #e2e8f0);">${escHtml(c.display_name)}</span>
          <span style="color:var(--text-muted, #64748b); font-size:12px; margin-left:6px;">${escHtml(c.role)}</span>
          <p style="margin:4px 0 0; color:var(--text-secondary, #94a3b8); font-size:14px;">${escHtml(c.contribution)}</p>
        </div>
      `;
    }).join('');

  const mrrDisplay = fin?.mrr_cents !== null && fin?.mrr_cents !== undefined
    ? `$${(fin.mrr_cents / 100).toLocaleString()}`
    : 'N/A';
  const roiDisplay = fin?.roi !== null && fin?.roi !== undefined
    ? `${fin.roi.toFixed(1)}x`
    : 'N/A';

  return `
<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 860px; margin: 0 auto; padding: 24px; color: var(--text-primary, #e2e8f0);">

  <!-- Header -->
  <div style="margin-bottom: 24px;">
    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
      <div>
        <h1 style="margin:0; font-size:22px; font-weight:700; color:var(--text-primary, #e2e8f0);">
          ${escHtml(companyName)} · CEO Briefing
        </h1>
        <p style="margin:4px 0 0; color:var(--text-muted, #64748b); font-size:14px;">${escHtml(briefing.briefing_date)}</p>
      </div>
      <div style="display:flex; gap:12px; font-size:13px;">
        <span style="background:var(--bg-card, #1a1a2e); border:1px solid var(--border, #2a2a3e); border-radius:6px; padding:4px 10px;">
          Signal: ${briefing.signal_score !== null ? `${briefing.signal_score}/100 ${signalDelta}` : 'N/A'}
        </span>
        <span style="background:var(--bg-card, #1a1a2e); border:1px solid var(--border, #2a2a3e); border-radius:6px; padding:4px 10px;">
          Health: ${briefing.health_score !== null ? `${briefing.health_score}/100` : 'N/A'}
        </span>
        ${briefing.risk_state ? `<span style="background:var(--bg-card, #1a1a2e); border:1px solid var(--border, #2a2a3e); border-radius:6px; padding:4px 10px;">
          Risk: ${escHtml(briefing.risk_state.toUpperCase())}
        </span>` : ''}
      </div>
    </div>

    <!-- Headline -->
    <div style="margin-top:16px; background:var(--bg-card, #1a1a2e); border:1px solid var(--accent, #6366f1); border-radius:8px; padding:14px 16px;">
      <p style="margin:0; font-size:16px; font-weight:500; color:var(--text-primary, #e2e8f0);">${escHtml(briefing.headline)}</p>
    </div>
  </div>

  <!-- Agent Activity -->
  <div style="margin-bottom:24px;">
    <h2 style="font-size:16px; font-weight:600; color:var(--text-primary, #e2e8f0); margin:0 0 12px; border-bottom:1px solid var(--border, #2a2a3e); padding-bottom:8px;">
      Overnight Activity
    </h2>
    ${contribsHtml || '<p style="color:var(--text-muted, #64748b); font-size:14px;">No agent activity recorded.</p>'}
  </div>

  <!-- Decisions -->
  <div style="margin-bottom:24px;">
    <h2 style="font-size:16px; font-weight:600; color:var(--text-primary, #e2e8f0); margin:0 0 12px; border-bottom:1px solid var(--border, #2a2a3e); padding-bottom:8px;">
      Decisions Waiting (${decisions.length})
    </h2>
    ${decisionsHtml || '<p style="color:var(--text-muted, #64748b); font-size:14px;">No pending decisions.</p>'}
  </div>

  <!-- Financial Snapshot -->
  <div style="background:var(--bg-card, #1a1a2e); border:1px solid var(--border, #2a2a3e); border-radius:8px; padding:16px;">
    <h2 style="font-size:14px; font-weight:600; color:var(--text-muted, #64748b); margin:0 0 10px; text-transform:uppercase; letter-spacing:0.05em;">Financial Snapshot</h2>
    <div style="display:flex; gap:24px; flex-wrap:wrap; font-size:14px; color:var(--text-secondary, #94a3b8);">
      <span><strong style="color:var(--text-primary, #e2e8f0);">MRR:</strong> ${mrrDisplay}</span>
      <span><strong style="color:var(--text-primary, #e2e8f0);">AI Cost (30d):</strong> $${fin ? fin.ai_cost_30d_usd.toFixed(2) : '0.00'}</span>
      <span><strong style="color:var(--text-primary, #e2e8f0);">ROI:</strong> ${roiDisplay}</span>
    </div>
  </div>

</div>
  `.trim();
}
