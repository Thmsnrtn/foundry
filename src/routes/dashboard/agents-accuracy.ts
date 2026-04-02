// =============================================================================
// FOUNDRY — Agent Prediction Accuracy Routes
// Overview and detail pages for agent prediction accuracy tracking.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import { query } from '../../db/client.js';
import { getAgentAccuracyReport, measurePendingPredictions } from '../../services/scp/accuracy/tracker.js';
import { AGENT_DISPLAY_NAMES, ALL_AGENTS } from '../../services/scp/types.js';
import type { AgentName } from '../../services/scp/types.js';

export const agentsAccuracy = new Hono<AuthEnv>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(val: number | null): string {
  if (val === null || val === undefined) return '—';
  return `${Math.round(val * 100)}%`;
}

function accuracyColor(val: number | null): string {
  if (val === null) return 'var(--text-muted)';
  return val >= 0.7 ? '#4ecca3' : val >= 0.5 ? '#ffb347' : '#ff6b6b';
}

function trendBadge(trend: 'improving' | 'stable' | 'degrading'): string {
  if (trend === 'improving') return '<span style="font-size:0.7rem;background:#4ecca322;color:#4ecca3;padding:2px 8px;border-radius:99px;font-weight:700;">↑ Improving</span>';
  if (trend === 'degrading') return '<span style="font-size:0.7rem;background:#ff6b6b22;color:#ff6b6b;padding:2px 8px;border-radius:99px;font-weight:700;">↓ Degrading</span>';
  return '<span style="font-size:0.7rem;background:rgba(255,255,255,0.06);color:var(--text-muted);padding:2px 8px;border-radius:99px;">→ Stable</span>';
}

function outcomeChip(outcome: string | null): string {
  if (!outcome) return '<span style="font-size:0.7rem;color:var(--text-muted);">Pending</span>';
  if (outcome === 'correct') return '<span style="font-size:0.7rem;background:#4ecca322;color:#4ecca3;padding:2px 8px;border-radius:99px;">Correct</span>';
  if (outcome === 'partial') return '<span style="font-size:0.7rem;background:#ffb34722;color:#ffb347;padding:2px 8px;border-radius:99px;">Partial</span>';
  if (outcome === 'incorrect') return '<span style="font-size:0.7rem;background:#ff6b6b22;color:#ff6b6b;padding:2px 8px;border-radius:99px;">Incorrect</span>';
  return '<span style="font-size:0.7rem;color:var(--text-muted);">Unmeasurable</span>';
}

function progressBar(val: number | null, width: number = 200): string {
  const pctVal = val !== null ? Math.round(val * 100) : 0;
  const color = accuracyColor(val);
  return `<div style="display:flex;align-items:center;gap:0.5rem;">
    <div style="width:${width}px;height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;">
      <div style="width:${pctVal}%;height:100%;background:${color};border-radius:3px;transition:width 0.3s;"></div>
    </div>
    <span style="font-size:0.78rem;font-weight:600;color:${color};">${pct(val)}</span>
  </div>`;
}

function fmtDate(dateStr: string): string {
  try {
    return new Date(dateStr + 'T00:00:00Z').toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    });
  } catch {
    return dateStr;
  }
}

// ─── GET /agents/accuracy — Overview of all agents ────────────────────────────

agentsAccuracy.get('/agents/accuracy', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'agents', 'Agent Prediction Accuracy', undefined, c);

  if (!ctx.productId) {
    const content = html`
      <div style="margin-bottom:1.5rem;">
        <a href="/agents" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Agent Roster</a>
      </div>
      <h1 style="margin:0 0 0.5rem;">Agent Prediction Accuracy</h1>
      <p style="color:var(--text-dim);">No product selected.</p>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;

  // Load accuracy overview for all agents that have predictions
  const agentScores = await query(
    `SELECT agent_name,
       AVG(accuracy_rate) as avg_accuracy,
       SUM(total_predictions) as total_predictions,
       SUM(measured_predictions) as measured_predictions,
       AVG(calibration_score) as avg_calibration
     FROM agent_accuracy_scores
     WHERE product_id = ?
     GROUP BY agent_name
     ORDER BY avg_accuracy DESC NULLS LAST`,
    [productId]
  );

  // Also count pending (unmeasured) predictions per agent
  const pendingResult = await query(
    `SELECT agent_name, COUNT(*) as pending_count
     FROM agent_predictions
     WHERE product_id = ? AND outcome IS NULL
     GROUP BY agent_name`,
    [productId]
  );
  const pendingByAgent: Record<string, number> = {};
  for (const r of pendingResult.rows) {
    const row = r as Record<string, unknown>;
    pendingByAgent[row.agent_name as string] = row.pending_count as number;
  }

  const rows = agentScores.rows.map((r) => {
    const row = r as Record<string, unknown>;
    const agentName = row.agent_name as string;
    const accuracy = row.avg_accuracy as number | null;
    const total = (row.total_predictions as number) ?? 0;
    const measured = (row.measured_predictions as number) ?? 0;
    const calibration = row.avg_calibration as number | null;
    const pending = pendingByAgent[agentName] ?? 0;
    const displayName = AGENT_DISPLAY_NAMES[agentName as AgentName] ?? agentName;
    const color = accuracyColor(accuracy);

    return html`
    <a href="/agents/accuracy/${agentName}" style="display:grid;grid-template-columns:140px 1fr 120px 100px 80px;align-items:center;gap:1rem;padding:0.875rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.05);text-decoration:none;color:inherit;transition:background 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.03)'" onmouseout="this.style.background=''">
      <div style="font-size:0.85rem;font-weight:600;color:var(--text-primary);">${displayName}</div>
      <div>${progressBar(accuracy, 160)}</div>
      <div style="font-size:0.8rem;color:var(--text-dim);">${measured}/${total} measured</div>
      <div style="font-size:0.78rem;color:${calibration !== null && calibration < 0.15 ? '#4ecca3' : calibration !== null && calibration < 0.3 ? '#ffb347' : 'var(--text-muted)'};">
        ${calibration !== null ? `Cal: ${(calibration * 100).toFixed(0)}pp` : '—'}
      </div>
      <div style="font-size:0.75rem;color:${pending > 0 ? '#ffb347' : 'var(--text-muted)'};">
        ${pending > 0 ? `${pending} pending` : '—'}
      </div>
    </a>`;
  });

  // Count total pending predictions
  const totalPendingResult = await query(
    `SELECT COUNT(*) as cnt FROM agent_predictions WHERE product_id = ? AND outcome IS NULL`,
    [productId]
  );
  const totalPending = (totalPendingResult.rows[0] as Record<string, unknown>)?.cnt as number ?? 0;

  const content = html`
    <div style="margin-bottom:1.5rem;">
      <a href="/agents" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Agent Roster</a>
    </div>

    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:0.5rem;flex-wrap:wrap;gap:0.5rem;">
      <h1 style="margin:0;">Agent Prediction Accuracy</h1>
      <form method="POST" action="/agents/accuracy/measure">
        <button type="submit" class="btn btn-primary" style="font-size:0.8rem;">
          Measure Pending${totalPending > 0 ? ` (${totalPending})` : ''}
        </button>
      </form>
    </div>

    <!-- Explainer -->
    <div class="card" style="padding:1rem 1.25rem;margin-bottom:1.5rem;background:rgba(78,204,163,0.04);border:1px solid rgba(78,204,163,0.15);">
      <p style="margin:0;font-size:0.82rem;color:var(--text-dim);line-height:1.6;">
        <strong style="color:#4ecca3;">What is calibration?</strong>
        A well-calibrated agent's 70% confidence predictions come true ~70% of the time.
        The calibration score shows the average gap between stated confidence and actual accuracy — lower is better.
        Agents use this data to self-correct over time, making them demonstrably smarter with each prediction cycle.
      </p>
    </div>

    <div class="card" style="padding:0;overflow:hidden;">
      <!-- Header row -->
      <div style="display:grid;grid-template-columns:140px 1fr 120px 100px 80px;gap:1rem;padding:0.75rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.07);">
        <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Agent</span>
        <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Overall Accuracy</span>
        <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Predictions</span>
        <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Calibration</span>
        <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Pending</span>
      </div>
      ${rows.length === 0
        ? html`<div style="padding:3rem;text-align:center;color:var(--text-muted);font-size:0.9rem;">
            No predictions recorded yet. Agents automatically record predictions as they run.
            <br/><br/>
            <a href="/agents" style="color:var(--accent);">View Agents →</a>
          </div>`
        : rows}
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── GET /agents/accuracy/:agentName — Detail for one agent ──────────────────

agentsAccuracy.get('/agents/accuracy/:agentName', async (c) => {
  const founder = c.get('founder');
  const agentName = c.req.param('agentName');
  const displayName = AGENT_DISPLAY_NAMES[agentName as AgentName] ?? agentName;

  const ctx = await getLayoutContext(founder, 'agents', `${displayName} — Prediction Accuracy`, undefined, c);

  if (!ctx.productId) {
    const content = html`
      <div style="margin-bottom:1.5rem;">
        <a href="/agents/accuracy" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Accuracy Overview</a>
      </div>
      <p style="color:var(--text-dim);">No product selected.</p>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;

  const report = await getAgentAccuracyReport(productId, agentName);

  // Pending predictions
  const pendingResult = await query(
    `SELECT prediction_text, prediction_type, confidence, measure_by_date, predicted_value
     FROM agent_predictions
     WHERE product_id = ? AND agent_name = ? AND outcome IS NULL
     ORDER BY measure_by_date ASC
     LIMIT 20`,
    [productId, agentName]
  );
  const pendingPredictions = pendingResult.rows.map((r) => r as Record<string, unknown>);

  // Calibration buckets: group predictions by confidence range and show actual accuracy
  const calibBuckets = await query(
    `SELECT
       ROUND(confidence * 10) / 10 as conf_bucket,
       COUNT(*) as cnt,
       AVG(accuracy_score) as avg_accuracy
     FROM agent_predictions
     WHERE product_id = ? AND agent_name = ?
       AND outcome IS NOT NULL AND outcome != 'unmeasurable'
     GROUP BY ROUND(confidence * 10) / 10
     ORDER BY conf_bucket ASC`,
    [productId, agentName]
  );

  // Build by-type accuracy bars
  const byTypeSection = report.by_type.length === 0
    ? html`<div style="padding:1.25rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">No predictions recorded for this agent.</div>`
    : report.by_type.map((t) => {
        const label = t.prediction_type.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
        return html`
        <div style="padding:0.875rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.05);">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:0.4rem;flex-wrap:wrap;">
            <span style="font-size:0.85rem;font-weight:600;color:var(--text-primary);">${label}</span>
            <span style="font-size:0.75rem;color:var(--text-muted);">${t.measured}/${t.total} measured</span>
          </div>
          ${progressBar(t.accuracy_rate > 0 || t.measured > 0 ? t.accuracy_rate : null, 240)}
        </div>`;
      });

  // Calibration chart (text-based)
  const calibRows = calibBuckets.rows.map((r) => {
    const row = r as Record<string, unknown>;
    const bucket = row.conf_bucket as number;
    const cnt = row.cnt as number;
    const avgAcc = row.avg_accuracy as number | null;
    const confPct = Math.round(bucket * 100);
    const accPct = avgAcc !== null ? Math.round(avgAcc * 100) : null;
    const gap = accPct !== null ? accPct - confPct : null;
    const gapStr = gap !== null
      ? gap > 5
        ? `<span style="color:#4ecca3;">+${gap}pp (underconfident)</span>`
        : gap < -5
        ? `<span style="color:#ff6b6b;">${gap}pp (overconfident)</span>`
        : `<span style="color:var(--text-dim);">~calibrated</span>`
      : '<span style="color:var(--text-muted);">—</span>';
    return html`
    <div style="display:grid;grid-template-columns:100px 80px 80px 1fr;gap:0.75rem;align-items:center;padding:0.6rem 0;border-bottom:1px solid rgba(255,255,255,0.04);">
      <span style="font-size:0.82rem;color:var(--text-dim);">Said ${confPct}%</span>
      <span style="font-size:0.82rem;color:${accuracyColor(avgAcc)};font-weight:600;">Was ${accPct !== null ? `${accPct}%` : '—'}</span>
      <span style="font-size:0.75rem;color:var(--text-muted);">(${cnt} predictions)</span>
      <span style="font-size:0.78rem;">${gapStr}</span>
    </div>`;
  });

  // Recent predictions list
  const recentRows = report.recent_predictions.map((p) => {
    return html`
    <div style="display:grid;grid-template-columns:1fr 80px 80px 110px;gap:0.75rem;align-items:center;padding:0.7rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.04);">
      <div style="font-size:0.82rem;color:var(--text-dim);overflow:hidden;white-space:nowrap;text-overflow:ellipsis;" title="${p.text}">${p.text}</div>
      <div style="font-size:0.78rem;color:var(--text-muted);text-align:center;">${pct(p.confidence)}</div>
      <div style="text-align:center;">${outcomeChip(p.outcome)}</div>
      <div style="font-size:0.75rem;color:var(--text-muted);">${fmtDate(p.measure_by_date)}</div>
    </div>`;
  });

  // Pending predictions list
  const pendingRows = pendingPredictions.map((p) => {
    const typeLabel = (p.prediction_type as string).replace(/_/g, ' ');
    return html`
    <div style="display:grid;grid-template-columns:1fr 120px 80px 110px;gap:0.75rem;align-items:center;padding:0.7rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.04);">
      <div style="font-size:0.82rem;color:var(--text-dim);overflow:hidden;white-space:nowrap;text-overflow:ellipsis;" title="${p.prediction_text}">${p.prediction_text}</div>
      <div style="font-size:0.72rem;color:var(--text-muted);">${typeLabel}</div>
      <div style="font-size:0.78rem;color:var(--text-muted);text-align:center;">${pct(p.confidence as number)}</div>
      <div style="font-size:0.75rem;color:#ffb347;">Due ${fmtDate(p.measure_by_date as string)}</div>
    </div>`;
  });

  const trendHtml = trendBadge(report.trend);
  const overallColor = accuracyColor(report.overall_accuracy);

  const content = html`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:0.75rem;">
      <a href="/agents/accuracy" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Accuracy Overview</a>
      <form method="POST" action="/agents/accuracy/measure">
        <button type="submit" class="btn btn-ghost btn-sm" style="font-size:0.78rem;">Measure Pending</button>
      </form>
    </div>

    <!-- Header card -->
    <div class="card" style="padding:1.5rem;margin-bottom:1.5rem;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
        <div>
          <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.35rem;">Prediction Accuracy</div>
          <h1 style="margin:0 0 0.25rem;font-size:1.4rem;">${displayName}</h1>
          <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.5rem;">
            ${trendHtml}
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.25rem;">Overall Accuracy</div>
          <div style="font-size:2.5rem;font-weight:700;color:${overallColor};">${pct(report.overall_accuracy)}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);">${report.by_type.reduce((s, t) => s + t.measured, 0)} measured predictions</div>
        </div>
      </div>
    </div>

    <!-- By type breakdown -->
    <div style="margin-bottom:1.5rem;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.75rem;">Accuracy by Prediction Type</div>
      <div class="card" style="padding:0;overflow:hidden;">
        ${byTypeSection}
      </div>
    </div>

    <!-- Calibration chart -->
    ${calibBuckets.rows.length > 0 ? html`
    <div style="margin-bottom:1.5rem;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.5rem;">Calibration Chart</div>
      <div style="font-size:0.75rem;color:var(--text-dim);margin-bottom:0.75rem;">When this agent expresses a confidence level, how often does it come true?</div>
      <div class="card" style="padding:1rem 1.25rem;">
        <div style="display:grid;grid-template-columns:100px 80px 80px 1fr;gap:0.75rem;padding-bottom:0.5rem;margin-bottom:0.25rem;border-bottom:1px solid rgba(255,255,255,0.07);">
          <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Said</span>
          <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Actual</span>
          <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Count</span>
          <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Assessment</span>
        </div>
        ${calibRows}
      </div>
    </div>` : ''}

    <!-- Recent predictions -->
    <div style="margin-bottom:1.5rem;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.75rem;">Recent Predictions</div>
      <div class="card" style="padding:0;overflow:hidden;">
        <div style="display:grid;grid-template-columns:1fr 80px 80px 110px;gap:0.75rem;padding:0.6rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.07);">
          <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Prediction</span>
          <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);text-align:center;">Confidence</span>
          <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);text-align:center;">Outcome</span>
          <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Measure By</span>
        </div>
        ${recentRows.length === 0
          ? html`<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">No predictions recorded yet.</div>`
          : recentRows}
      </div>
    </div>

    <!-- Pending predictions -->
    <div style="margin-bottom:1.5rem;">
      <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem;">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Pending Predictions</div>
        ${pendingPredictions.length > 0
          ? html`<span style="font-size:0.7rem;background:#ffb34722;color:#ffb347;padding:2px 8px;border-radius:99px;font-weight:700;">${pendingPredictions.length}</span>`
          : ''}
      </div>
      <div class="card" style="padding:0;overflow:hidden;">
        ${pendingPredictions.length === 0
          ? html`<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">No pending predictions — all have been measured or none recorded yet.</div>`
          : html`
            <div style="display:grid;grid-template-columns:1fr 120px 80px 110px;gap:0.75rem;padding:0.6rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.07);">
              <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Prediction</span>
              <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Type</span>
              <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);text-align:center;">Confidence</span>
              <span style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Due Date</span>
            </div>
            ${pendingRows}`}
      </div>
    </div>

    <div style="margin-top:2rem;">
      <a href="/agents/accuracy" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Back to Accuracy Overview</a>
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /agents/accuracy/measure — Trigger measurement ──────────────────────

agentsAccuracy.post('/agents/accuracy/measure', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'agents', 'Agent Prediction Accuracy', undefined, c);

  if (!ctx.productId) {
    return c.redirect('/agents/accuracy');
  }

  try {
    await measurePendingPredictions(ctx.productId);
  } catch {
    // Non-fatal — redirect regardless
  }

  return c.redirect('/agents/accuracy');
});

// ─── Suppress unused import warning ──────────────────────────────────────────
void ALL_AGENTS;
