// =============================================================================
// FOUNDRY — Agent Debate & Synthesis Routes
// Lists debate sessions, shows full debate detail, triggers new debate runs.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import {
  runDebateForProduct,
  getDebateSession,
  listDebateSessions,
} from '../../services/scp/debate/orchestrator.js';
import type { SynthesisOutput } from '../../services/scp/agents/synthesizer.js';
import { requireCompanyCapability } from '../../middleware/rbac.js';

export const agentsDebate = new Hono<AuthEnv>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(dateStr: string): string {
  try {
    return new Date(dateStr + 'T00:00:00Z').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return dateStr;
  }
}

function severityColor(severity: 'high' | 'medium' | 'low'): string {
  if (severity === 'high') return '#ff6b6b';
  if (severity === 'medium') return '#ffb347';
  return '#4ecca3';
}

function statusBadge(status: string): string {
  // 'failed' exists because it used to not exist: a debate that threw, or whose
  // synthesizer returned nothing usable, was stored as 'complete' and shown
  // here in green beside a conflict count of zero — the same row a debate in
  // which every agent agreed would produce.
  if (status === 'failed') {
    return '<span style="font-size:0.7rem;background:#ff6b6b22;color:#ff6b6b;padding:2px 8px;border-radius:99px;font-weight:700;">Failed</span>';
  }
  if (status === 'complete') {
    return '<span style="font-size:0.7rem;background:#4ecca322;color:#4ecca3;padding:2px 8px;border-radius:99px;font-weight:700;">Complete</span>';
  }
  if (status === 'running') {
    return '<span style="font-size:0.7rem;background:#ffb34722;color:#ffb347;padding:2px 8px;border-radius:99px;font-weight:700;">Running</span>';
  }
  return '<span style="font-size:0.7rem;background:rgba(255,255,255,0.06);color:var(--text-muted);padding:2px 8px;border-radius:99px;">Pending</span>';
}

function parseSynthesis(raw: string | null): SynthesisOutput | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SynthesisOutput;
  } catch {
    return null;
  }
}

function parseConflicts(raw: string | null): Array<{ targetAgent: string; assertion: string; challengeText: string; severity: 'high' | 'medium' | 'low' }> {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Array<{ targetAgent: string; assertion: string; challengeText: string; severity: 'high' | 'medium' | 'low' }>;
  } catch {
    return [];
  }
}

function parsePositions(raw: string | null): Array<{ agentName: string; content: string; confidence: number }> {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Array<{ agentName: string; content: string; confidence: number }>;
  } catch {
    return [];
  }
}

// ─── GET /agents/debate — List of recent debate sessions ─────────────────────

agentsDebate.get('/agents/debate', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'agents', 'Agent Debate & Synthesis', undefined, c);

  if (!ctx.productId) {
    const content = html`
      <div style="margin-bottom:1.5rem;">
        <a href="/agents" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Agent Roster</a>
      </div>
      <h1 style="margin:0 0 0.5rem;">Agent Debate & Synthesis</h1>
      <p style="color:var(--text-dim);">No product selected.</p>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;
  const sessions = await listDebateSessions(productId, 14);

  const sessionRows = sessions.map((s) => {
    const conflicts = parseConflicts(s.conflicts_json);
    const synthesis = parseSynthesis(s.synthesis_json);
    const topRec = synthesis?.confidenceWeightedRecommendations?.[0];

    return html`
    <a href="/agents/debate/${s.briefing_date}" style="display:grid;grid-template-columns:120px 80px 60px 1fr 80px;align-items:start;gap:1rem;padding:1rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.05);text-decoration:none;color:inherit;transition:background 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.03)'" onmouseout="this.style.background=''">
      <div>
        <div style="font-size:0.85rem;font-weight:600;color:var(--text-primary);">${fmtDate(s.briefing_date)}</div>
        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">${s.briefing_date}</div>
      </div>
      <div>${statusBadge(s.status)}</div>
      <div>
        ${synthesis?.failure_reason
          ? html`<span style="font-size:0.72rem;color:var(--text-muted);">not reached</span>`
          : conflicts.length > 0
          ? html`<span style="font-size:0.8rem;font-weight:700;color:#ff6b6b;">${conflicts.length}</span>
                 <span style="font-size:0.7rem;color:var(--text-muted);"> conflicts</span>`
          : html`<span style="font-size:0.75rem;color:var(--text-muted);">none</span>`}
      </div>
      <div style="font-size:0.82rem;color:var(--text-dim);line-height:1.4;padding-right:1rem;">
        ${synthesis?.failure_reason
          ? html`<span style="color:#ff6b6b;">${synthesis.failure_reason.slice(0, 140)}</span>`
          : topRec
          ? html`<span style="color:var(--text-primary);">${topRec.recommendation.slice(0, 120)}${topRec.recommendation.length > 120 ? '…' : ''}</span>
                 <span style="font-size:0.7rem;color:var(--text-muted);margin-left:0.5rem;">w=${topRec.weight.toFixed(2)}</span>`
          : synthesis?.executiveSummary
            ? html`<span style="color:var(--text-dim);">${synthesis.executiveSummary.slice(0, 140)}${synthesis.executiveSummary.length > 140 ? '…' : ''}</span>`
            : html`<span style="color:var(--text-muted);">No synthesis yet</span>`}
      </div>
      <div style="text-align:right;">
        <span style="font-size:0.78rem;color:var(--accent);">View →</span>
      </div>
    </a>`;
  });

  const content = html`
    <div style="margin-bottom:1.5rem;">
      <a href="/agents" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Agent Roster</a>
    </div>

    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:0.5rem;flex-wrap:wrap;gap:0.5rem;">
      <h1 style="margin:0;">Agent Debate & Synthesis</h1>
      <form method="POST" action="/agents/debate/run">
        <button type="submit" class="btn btn-primary" style="font-size:0.8rem;">
          Run Debate for Today
        </button>
      </form>
    </div>

    <!-- Explainer -->
    <div class="card" style="padding:1rem 1.25rem;margin-bottom:1.5rem;background:rgba(78,204,163,0.04);border:1px solid rgba(78,204,163,0.15);">
      <p style="margin:0;font-size:0.82rem;color:var(--text-dim);line-height:1.6;">
        <strong style="color:#4ecca3;">What is Agent Debate?</strong>
        After all 12 SCP agents run, the Debate Network extracts their key positions,
        runs a Challenger pass to surface conflicts and unexamined assumptions, then
        synthesizes everything into a single confidence-weighted position. High-accuracy
        agents are weighted more heavily. Dissenting views are preserved.
      </p>
    </div>

    <div class="card" style="padding:0;overflow:hidden;">
      <div style="display:grid;grid-template-columns:120px 80px 60px 1fr 80px;gap:1rem;padding:0.75rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.07);">
        <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Date</span>
        <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Status</span>
        <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Conflicts</span>
        <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Top Recommendation / Synthesis</span>
        <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);text-align:right;">Detail</span>
      </div>
      ${sessionRows.length === 0
        ? html`<div style="padding:3rem;text-align:center;color:var(--text-muted);font-size:0.9rem;">
            No debate sessions yet. Click "Run Debate for Today" to begin.
          </div>`
        : sessionRows}
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── GET /agents/debate/:date — Full debate detail ────────────────────────────

agentsDebate.get('/agents/debate/:date', async (c) => {
  const founder = c.get('founder');
  const date = c.req.param('date');
  const ctx = await getLayoutContext(founder, 'agents', `Debate — ${date}`, undefined, c);

  if (!ctx.productId) {
    const content = html`
      <div style="margin-bottom:1.5rem;">
        <a href="/agents/debate" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Debate Sessions</a>
      </div>
      <p style="color:var(--text-dim);">No product selected.</p>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const session = await getDebateSession(ctx.productId, date);

  if (!session) {
    const content = html`
      <div style="margin-bottom:1.5rem;">
        <a href="/agents/debate" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Debate Sessions</a>
      </div>
      <h1 style="margin:0 0 0.5rem;">Debate — ${fmtDate(date)}</h1>
      <div class="card" style="padding:2rem;text-align:center;color:var(--text-muted);">
        No debate session found for ${date}.
        <br/><br/>
        <form method="POST" action="/agents/debate/run">
          <button type="submit" class="btn btn-primary">Run Debate for Today</button>
        </form>
      </div>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const synthesis = parseSynthesis(session.synthesis_json);
  const conflicts = parseConflicts(session.conflicts_json);
  const positions = parsePositions(session.positions_json);

  // Group positions by agent
  const positionsByAgent: Record<string, Array<{ content: string; confidence: number }>> = {};
  for (const pos of positions) {
    if (!positionsByAgent[pos.agentName]) {
      positionsByAgent[pos.agentName] = [];
    }
    positionsByAgent[pos.agentName].push({ content: pos.content, confidence: pos.confidence });
  }

  // Build challenges map: targetAgent -> challenges
  const challengesByAgent: Record<string, typeof conflicts> = {};
  for (const challenge of conflicts) {
    if (!challengesByAgent[challenge.targetAgent]) {
      challengesByAgent[challenge.targetAgent] = [];
    }
    challengesByAgent[challenge.targetAgent].push(challenge);
  }

  // ── Synthesis section ──────────────────────────────────────────────────────
  // A failed run gets its own card. The failure text used to be rendered as the
  // executive summary inside the green "Unified Synthesis" card.
  const synthesisSection = synthesis?.failure_reason ? html`
    <div class="card" style="padding:1.5rem 2rem;margin-bottom:1.5rem;background:rgba(255,107,107,0.05);border:1px solid rgba(255,107,107,0.25);">
      <div style="font-size:0.65rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#ff6b6b;margin-bottom:0.75rem;">This Debate Did Not Finish</div>
      <p style="font-size:0.95rem;line-height:1.6;color:var(--text-dim);margin:0 0 1rem;">${synthesis.failure_reason}</p>
      <p style="font-size:0.82rem;color:var(--text-muted);margin:0;">The positions below were collected before it stopped. There is no synthesis, and nothing from this run reached your daily briefing.</p>
    </div>
  ` : synthesis ? html`
    <div class="card" style="padding:1.5rem 2rem;margin-bottom:1.5rem;background:rgba(78,204,163,0.04);border:1px solid rgba(78,204,163,0.2);">
      <div style="font-size:0.65rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#4ecca3;margin-bottom:0.75rem;">Unified Synthesis</div>
      <p style="font-size:1.05rem;line-height:1.65;color:var(--text-primary);margin:0 0 1.25rem;font-weight:500;">${synthesis.executiveSummary}</p>

      ${synthesis.confidenceWeightedRecommendations.length > 0 ? html`
      <div style="margin-bottom:1.25rem;">
        <div style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.6rem;">Confidence-Weighted Recommendations</div>
        ${synthesis.confidenceWeightedRecommendations.map((r, i) => html`
        <div style="display:flex;align-items:flex-start;gap:0.75rem;padding:0.6rem 0;border-bottom:1px solid rgba(255,255,255,0.05);">
          <span style="font-size:0.75rem;font-weight:700;color:#4ecca3;min-width:20px;">${i + 1}.</span>
          <div style="flex:1;">
            <span style="font-size:0.88rem;color:var(--text-primary);">${r.recommendation}</span>
            <div style="margin-top:0.3rem;display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
              <span style="font-size:0.7rem;color:var(--text-muted);">Supported by: ${r.supportingAgents.join(', ') || '—'}</span>
              <span style="font-size:0.7rem;background:rgba(78,204,163,0.12);color:#4ecca3;padding:1px 7px;border-radius:99px;">weight ${r.weight.toFixed(2)}</span>
            </div>
          </div>
        </div>`)}
      </div>` : ''}

      ${synthesis.keyConflicts.length > 0 ? html`
      <div style="margin-bottom:1rem;">
        <div style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.6rem;">Key Conflicts & Resolutions</div>
        ${synthesis.keyConflicts.map((kc) => html`
        <div style="padding:0.6rem 0;border-bottom:1px solid rgba(255,255,255,0.05);">
          <div style="font-size:0.85rem;color:#ffb347;margin-bottom:0.2rem;">${kc.description}</div>
          <div style="font-size:0.82rem;color:var(--text-dim);">${kc.resolution}</div>
        </div>`)}
      </div>` : ''}
    </div>
  ` : html`<div class="card" style="padding:1.5rem;margin-bottom:1.5rem;text-align:center;color:var(--text-muted);">Synthesis not yet available.</div>`;

  // ── Dissenting view callout ────────────────────────────────────────────────
  const dissentingSection = synthesis?.dissenting_view ? html`
    <div class="card" style="padding:1.25rem 1.5rem;margin-bottom:1.5rem;background:rgba(255,107,107,0.05);border:1px solid rgba(255,107,107,0.2);">
      <div style="font-size:0.65rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#ff6b6b;margin-bottom:0.5rem;">Dissenting View</div>
      <p style="margin:0;font-size:0.88rem;color:var(--text-dim);line-height:1.55;font-style:italic;">"${synthesis.dissenting_view}"</p>
    </div>
  ` : '';

  // ── Agent positions grid with inline challenges ────────────────────────────
  const agentNames = Object.keys(positionsByAgent);

  const agentCards = agentNames.map((agentName) => {
    const agentPositions = positionsByAgent[agentName] ?? [];
    const agentChallenges = challengesByAgent[agentName] ?? [];

    const positionItems = agentPositions.map((pos) => html`
      <li style="font-size:0.82rem;color:var(--text-dim);line-height:1.5;margin-bottom:0.4rem;padding-left:0.25rem;">
        ${pos.content}
        <span style="font-size:0.68rem;color:var(--text-muted);margin-left:0.5rem;">${(pos.confidence * 100).toFixed(0)}%</span>
      </li>`);

    const challengeItems = agentChallenges.map((ch) => html`
      <div style="margin-top:0.5rem;padding:0.6rem 0.75rem;background:rgba(255,107,107,0.06);border-left:2px solid ${severityColor(ch.severity)};border-radius:0 4px 4px 0;">
        <div style="font-size:0.68rem;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:${severityColor(ch.severity)};margin-bottom:0.2rem;">
          ${ch.severity} challenge
        </div>
        <div style="font-size:0.78rem;color:var(--text-dim);line-height:1.45;">${ch.challengeText}</div>
      </div>`);

    return html`
    <div class="card" style="padding:1rem 1.25rem;">
      <div style="font-size:0.75rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--accent);margin-bottom:0.6rem;">${agentName}</div>
      <ul style="margin:0 0 0.25rem;padding-left:1rem;list-style:disc;">
        ${positionItems}
      </ul>
      ${challengeItems}
    </div>`;
  });

  // ── Challenges summary ─────────────────────────────────────────────────────
  const challengesSummary = conflicts.length > 0 ? html`
    <div style="margin-bottom:1.5rem;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.75rem;">
        Challenger Findings (${conflicts.length})
      </div>
      <div class="card" style="padding:0;overflow:hidden;">
        ${conflicts.map((ch) => html`
        <div style="padding:0.875rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.05);">
          <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.3rem;flex-wrap:wrap;">
            <span style="font-size:0.72rem;font-weight:700;background:${severityColor(ch.severity)}22;color:${severityColor(ch.severity)};padding:2px 8px;border-radius:99px;text-transform:uppercase;">${ch.severity}</span>
            <span style="font-size:0.78rem;color:var(--text-primary);font-weight:600;">${ch.targetAgent}</span>
            <span style="font-size:0.75rem;color:var(--text-muted);font-style:italic;">"${ch.assertion.slice(0, 80)}${ch.assertion.length > 80 ? '…' : ''}"</span>
          </div>
          <div style="font-size:0.82rem;color:var(--text-dim);line-height:1.5;">${ch.challengeText}</div>
        </div>`)}
      </div>
    </div>` : '';

  const content = html`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:0.75rem;">
      <a href="/agents/debate" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Debate Sessions</a>
      ${statusBadge(session.status)}
    </div>

    <div style="margin-bottom:1.25rem;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.2rem;">Debate Session</div>
      <h1 style="margin:0;font-size:1.5rem;">${fmtDate(date)}</h1>
      <div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.2rem;">
        ${positions.length} agent positions · ${conflicts.length} conflicts identified
        ${session.completed_at ? ` · Completed ${session.completed_at.slice(0, 16)}` : ''}
      </div>
    </div>

    <!-- Synthesis at top with big text -->
    ${synthesisSection}

    <!-- Dissenting view callout -->
    ${dissentingSection}

    <!-- Challenger findings summary -->
    ${challengesSummary}

    <!-- Agent positions grid -->
    <div style="margin-bottom:1rem;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.75rem;">
        Agent Positions (${agentNames.length} agents)
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:1rem;">
        ${agentCards.length === 0
          ? html`<div style="grid-column:1/-1;padding:2rem;text-align:center;color:var(--text-muted);">No agent positions recorded for this session.</div>`
          : agentCards}
      </div>
    </div>

    <div style="margin-top:2rem;">
      <a href="/agents/debate" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Back to Debate Sessions</a>
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /agents/debate/run — Trigger debate for today ──────────────────────

agentsDebate.post('/agents/debate/run',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'agents', 'Agent Debate & Synthesis', undefined, c);

  if (!ctx.productId) {
    return c.redirect('/agents/debate');
  }

  const today = new Date().toISOString().slice(0, 10);

  try {
    await runDebateForProduct(ctx.productId, today);
  } catch {
    // Non-fatal — redirect regardless
  }

  return c.redirect(`/agents/debate/${today}`);
});
