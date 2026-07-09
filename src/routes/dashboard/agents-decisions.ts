// =============================================================================
// FOUNDRY — Agents Decisions
// Strategic decision log — approved decisions, outcomes, and learnings.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import { nanoid } from 'nanoid';
import type { AuthEnv } from '../../middleware/auth.js';
import { query } from '../../db/client.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';

export const agentsDecisions = new Hono<AuthEnv>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusBadgeStyle(status: string): string {
  if (status === 'approved') return 'background:#4ecca322;color:#4ecca3;border:1px solid #4ecca344;';
  if (status === 'implemented') return 'background:#7c83fd22;color:#7c83fd;border:1px solid #7c83fd44;';
  if (status === 'retrospective') return 'background:rgba(255,255,255,0.08);color:var(--text-dim);border:1px solid rgba(255,255,255,0.15);';
  if (status === 'proposed') return 'background:#ffb34722;color:#ffb347;border:1px solid #ffb34744;';
  return 'background:rgba(255,255,255,0.06);color:var(--text-muted);border:1px solid rgba(255,255,255,0.1);';
}

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function starsHtml(rating: number | null): string {
  if (rating === null || rating === undefined) return '';
  const filled = Math.round(Math.max(1, Math.min(5, rating)));
  let s = '';
  for (let i = 1; i <= 5; i++) {
    s += `<span style="color:${i <= filled ? '#ffb347' : 'rgba(255,255,255,0.15)'};">★</span>`;
  }
  return s;
}

function madeByBadge(madeBy: string): string {
  if (madeBy === 'agent' || (madeBy ?? '').startsWith('agent:')) {
    return 'background:#4ecca322;color:#4ecca3;';
  }
  return 'background:rgba(255,255,255,0.08);color:var(--text-dim);';
}

// ─── GET /strategic-decisions ─────────────────────────────────────────────────

agentsDecisions.get('/strategic-decisions', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'strategic-decisions', 'Strategic Decisions', undefined, c);

  if (!ctx.productId) {
    const content = html`
      <h1 style="margin:0 0 1rem;">Strategic Decisions</h1>
      <div class="card" style="padding:2rem;text-align:center;color:var(--text-muted);">No product selected.</div>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;

  const result = await query(
    `SELECT * FROM strategic_decisions_log
     WHERE product_id=?
     ORDER BY made_at DESC
     LIMIT 50`,
    [productId]
  );
  const decisions = result.rows as Array<Record<string, unknown>>;

  // Memory Kernel (Ascent B1): decisions whose premise your own metrics now contradict.
  const { getExpiredBeliefs } = await import('../../services/memory/kernel.js');
  const expiredBeliefs = await getExpiredBeliefs(productId);

  const timelineItems = decisions.map((d) => {
    const madeBy = (d.made_by as string) ?? (d.decided_by as string) ?? 'human';
    const status = (d.status as string) ?? 'proposed';
    const rating = d.retrospective_score !== null && d.retrospective_score !== undefined
      ? Number(d.retrospective_score)
      : null;

    return html`
      <div style="display:flex;gap:1rem;margin-bottom:1.25rem;">
        <!-- Timeline dot -->
        <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;">
          <div style="width:10px;height:10px;border-radius:50%;background:var(--accent);margin-top:6px;flex-shrink:0;"></div>
          <div style="width:1px;flex:1;background:rgba(255,255,255,0.08);margin-top:4px;"></div>
        </div>

        <!-- Card -->
        <div class="card" style="flex:1;padding:1rem 1.25rem;margin-bottom:0;">
          <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;flex-wrap:wrap;">
            <span style="font-size:0.7rem;padding:2px 8px;border-radius:99px;${statusBadgeStyle(status)}">${statusLabel(status)}</span>
            <span style="font-size:0.7rem;padding:2px 8px;border-radius:99px;${madeByBadge(madeBy)}">${madeBy}</span>
            <span style="font-size:0.72rem;color:var(--text-muted);margin-left:auto;">${fmtDate(d.made_at as string)}</span>
          </div>

          <h3 style="margin:0 0 0.4rem;font-size:1rem;color:var(--text-primary);">${d.decision_title ?? '(untitled)'}</h3>

          ${d.decision_rationale ? html`<p style="margin:0 0 0.5rem;font-size:0.83rem;color:var(--text-dim);line-height:1.5;">${d.decision_rationale}</p>` : ''}

          ${d.decision_description ? html`
            <div style="margin-top:0.5rem;padding:0.6rem 0.875rem;background:rgba(78,204,163,0.06);border-left:3px solid #4ecca344;border-radius:0 4px 4px 0;font-size:0.82rem;color:var(--text-dim);">
              <strong style="color:var(--text-primary);">Decision:</strong> ${d.decision_description}
            </div>
          ` : ''}

          ${d.alternatives_considered_json ? html`
            <div style="margin-top:0.5rem;font-size:0.78rem;color:var(--text-muted);"><strong>Alternatives:</strong> ${d.alternatives_considered_json}</div>
          ` : ''}

          ${d.actual_outcome ? html`
            <div style="margin-top:0.75rem;padding:0.6rem 0.875rem;background:rgba(255,255,255,0.04);border-radius:6px;">
              <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.3rem;">Outcome</div>
              <div style="font-size:0.82rem;color:var(--text-dim);">${d.actual_outcome}</div>
              ${rating !== null ? html`<div style="margin-top:0.35rem;font-size:1rem;">${{ toString: () => starsHtml(rating) }}</div>` : ''}
            </div>
          ` : html`
            <!-- Record outcome form -->
            <details style="margin-top:0.75rem;">
              <summary style="cursor:pointer;font-size:0.75rem;color:var(--accent);font-weight:600;">Record outcome</summary>
              <form method="POST" action="/strategic-decisions/${d.id}/outcome" style="margin-top:0.5rem;display:flex;flex-direction:column;gap:0.5rem;">
                <textarea name="outcome_description" placeholder="What happened? What was the impact?" rows="2" required
                  style="padding:0.5rem 0.75rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:var(--text-primary);font-size:0.82rem;resize:vertical;"></textarea>
                <div style="display:flex;align-items:center;gap:0.75rem;">
                  <label style="font-size:0.75rem;color:var(--text-muted);">Rating:</label>
                  <select name="outcome_rating"
                    style="padding:4px 8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:var(--text-primary);font-size:0.82rem;">
                    <option value="">— no rating —</option>
                    <option value="1">1 ★</option>
                    <option value="2">2 ★★</option>
                    <option value="3">3 ★★★</option>
                    <option value="4">4 ★★★★</option>
                    <option value="5">5 ★★★★★</option>
                  </select>
                  <button type="submit" class="btn btn-primary" style="font-size:0.78rem;padding:0.3rem 0.75rem;">Save</button>
                </div>
              </form>
            </details>
          `}
        </div>
      </div>
    `;
  });

  const content = html`
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:0.75rem;">
      <h1 style="margin:0;">Strategic Decisions</h1>
      <button onclick="document.getElementById('new-decision-form').style.display=document.getElementById('new-decision-form').style.display==='none'?'block':'none'"
        class="btn btn-primary" style="font-size:0.82rem;">+ New Decision</button>
    </div>

    ${expiredBeliefs.length > 0 ? html`
    <div style="margin-bottom:1.5rem;padding:1rem 1.25rem;border-radius:8px;background:rgba(255,107,107,0.07);border:1px solid rgba(255,107,107,0.28);">
      <div style="font-size:0.72rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#ff6b6b;margin-bottom:0.5rem;">⚠ Expired beliefs — ${expiredBeliefs.length} decision${expiredBeliefs.length > 1 ? 's' : ''} rest on a premise your metrics now contradict</div>
      ${expiredBeliefs.map((e) => html`
        <div style="display:flex;align-items:center;gap:0.75rem;padding:0.5rem 0;border-top:1px solid rgba(255,255,255,0.05);">
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.85rem;color:var(--text-primary);font-weight:600;">${e.decision_title ?? 'A past decision'}</div>
            <div style="font-size:0.8rem;color:var(--text-dim);">Believed: <em>${e.premise.premise}</em></div>
            <div style="font-size:0.75rem;color:#ff6b6b;">${e.premise.evidence}</div>
          </div>
          <form method="POST" action="/strategic-decisions/premise/${e.premise.id}/revisit" style="flex-shrink:0;">
            <button type="submit" class="btn btn-ghost" style="font-size:0.75rem;padding:0.3rem 0.75rem;">Revisited</button>
          </form>
        </div>
      `)}
    </div>` : ''}

    <!-- New decision form (hidden by default) -->
    <div id="new-decision-form" style="display:none;margin-bottom:1.5rem;">
      <div class="card" style="padding:1.25rem;">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.875rem;">Record a New Decision</div>
        <form method="POST" action="/strategic-decisions" style="display:flex;flex-direction:column;gap:0.75rem;">
          <div>
            <label style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:3px;">Title *</label>
            <input type="text" name="title" required placeholder="What decision was made?"
              style="width:100%;padding:0.5rem 0.75rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:var(--text-primary);font-size:0.87rem;" />
          </div>
          <div>
            <label style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:3px;">Decision Made *</label>
            <input type="text" name="decision_made" required placeholder="The chosen direction / outcome"
              style="width:100%;padding:0.5rem 0.75rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:var(--text-primary);font-size:0.87rem;" />
          </div>
          <div>
            <label style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:3px;">Rationale</label>
            <textarea name="rationale" placeholder="Why was this decision made?" rows="2"
              style="width:100%;padding:0.5rem 0.75rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:var(--text-primary);font-size:0.87rem;resize:vertical;"></textarea>
          </div>
          <div>
            <label style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:3px;">Alternatives Considered</label>
            <input type="text" name="alternatives_considered" placeholder="What other options were on the table?"
              style="width:100%;padding:0.5rem 0.75rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:var(--text-primary);font-size:0.87rem;" />
          </div>
          <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:0.75rem;">
            <label style="font-size:0.75rem;color:var(--accent);display:block;margin-bottom:3px;">Key premise — the belief this rests on</label>
            <input type="text" name="premise" placeholder="e.g. Churn stays under 5% without enterprise support"
              style="width:100%;padding:0.5rem 0.75rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:var(--text-primary);font-size:0.87rem;" />
            <div style="display:flex;gap:0.4rem;margin-top:0.4rem;align-items:center;">
              <span style="font-size:0.72rem;color:var(--text-muted);">Auto-check (optional):</span>
              <select name="premise_metric" style="padding:0.35rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:var(--text-primary);font-size:0.8rem;">
                <option value="">— metric —</option>
                <option value="churn_rate">churn_rate</option>
                <option value="activation_rate">activation_rate</option>
                <option value="day_30_retention">day_30_retention</option>
                <option value="nps_score">nps_score</option>
                <option value="mrr_health_ratio">mrr_health_ratio</option>
              </select>
              <select name="premise_comparator" style="padding:0.35rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:var(--text-primary);font-size:0.8rem;">
                <option value="<">&lt;</option><option value="<=">&le;</option><option value=">">&gt;</option><option value=">=">&ge;</option>
              </select>
              <input type="number" step="any" name="premise_threshold" placeholder="value"
                style="width:90px;padding:0.35rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:var(--text-primary);font-size:0.8rem;" />
            </div>
            <div style="font-size:0.68rem;color:var(--text-muted);margin-top:0.3rem;">Foundry will watch this belief and flag the decision if your metrics later contradict it.</div>
          </div>
          <div style="display:flex;gap:0.5rem;">
            <button type="submit" class="btn btn-primary" style="font-size:0.85rem;">Save Decision</button>
            <button type="button" onclick="document.getElementById('new-decision-form').style.display='none'" class="btn btn-ghost" style="font-size:0.85rem;">Cancel</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Timeline -->
    ${decisions.length === 0
      ? html`<div class="card" style="padding:3rem;text-align:center;color:var(--text-muted);font-size:0.9rem;">No strategic decisions recorded yet. Start by recording your first decision above.</div>`
      : html`<div>${timelineItems}</div>`}
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /strategic-decisions ────────────────────────────────────────────────

agentsDecisions.post('/strategic-decisions', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'strategic-decisions', 'Strategic Decisions', undefined, c);
  if (!ctx.productId) return c.redirect('/strategic-decisions');

  const body = await c.req.parseBody();
  const title = (body.title as string)?.trim();
  const rationale = (body.rationale as string)?.trim() ?? null;
  const alternatives = (body.alternatives_considered as string)?.trim() ?? null;
  const decisionMade = (body.decision_made as string)?.trim();

  if (!title || !decisionMade) return c.redirect('/strategic-decisions');

  const decisionId = nanoid();
  await query(
    `INSERT INTO strategic_decisions_log
       (id, product_id, decision_title, decision_description, decision_rationale,
        alternatives_considered_json, made_by, status)
     VALUES (?, ?, ?, ?, ?, ?, 'founder', 'active')`,
    [decisionId, ctx.productId, title, decisionMade, rationale, alternatives]
  );

  // Memory Kernel (Ascent B1): capture the belief behind the decision so it can
  // be held accountable to live telemetry later.
  const premise = (body.premise as string)?.trim();
  if (premise) {
    const metricKey = (body.premise_metric as string)?.trim() || undefined;
    const comparator = (body.premise_comparator as string)?.trim() as '<' | '<=' | '>' | '>=' | undefined;
    const thresholdRaw = (body.premise_threshold as string)?.trim();
    const threshold = thresholdRaw ? Number(thresholdRaw) : undefined;
    try {
      const { recordPremise } = await import('../../services/memory/kernel.js');
      await recordPremise({
        productId: ctx.productId, decisionId, decisionSource: 'strategic', premise,
        metricKey, comparator, threshold: Number.isFinite(threshold) ? threshold : undefined,
      });
    } catch { /* premise capture is best-effort; never block the decision */ }
  }

  return c.redirect('/strategic-decisions');
});

// ─── POST /strategic-decisions/premise/:id/revisit (Memory Kernel) ────────────
agentsDecisions.post('/strategic-decisions/premise/:id/revisit', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'strategic-decisions', 'Strategic Decisions', undefined, c);
  if (!ctx.productId) return c.redirect('/strategic-decisions');
  const { markRevisited } = await import('../../services/memory/kernel.js');
  await markRevisited(c.req.param('id'), ctx.productId);
  return c.redirect('/strategic-decisions');
});

// ─── POST /strategic-decisions/:id/outcome ────────────────────────────────────

agentsDecisions.post('/strategic-decisions/:id/outcome', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.parseBody();
  const outcomeDescription = (body.outcome_description as string)?.trim();
  const outcomeRating = body.outcome_rating ? parseInt(body.outcome_rating as string, 10) : null;

  if (!outcomeDescription) return c.redirect('/strategic-decisions');

  // Map the 1–5 rating onto the table's status vocabulary (CHECK-constrained).
  const status =
    outcomeRating != null && outcomeRating >= 4 ? 'succeeded'
      : outcomeRating != null && outcomeRating <= 2 ? 'failed'
        : 'inconclusive';

  await query(
    `UPDATE strategic_decisions_log
     SET actual_outcome=?, retrospective_score=?, updated_at=CURRENT_TIMESTAMP, status=?
     WHERE id=?`,
    [outcomeDescription, outcomeRating, status, id]
  );

  return c.redirect('/strategic-decisions');
});
