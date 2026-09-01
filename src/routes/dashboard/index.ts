// =============================================================================
// FOUNDRY — Operator Dashboard (home screen)
// The Signal: one number, three sentences, one query bar.
// =============================================================================

import { Hono } from 'hono';
import { html, raw } from 'hono/html';
import { setCookie, getCookie } from 'hono/cookie';
import type { AuthEnv } from '../../middleware/auth.js';
import { query, getProductsByOwner, getVisibleProducts, getProductByOwner, getActiveStressors } from '../../db/client.js';
import { computeSignal, getSignalHistory, getDailyInsight, getPreviousSignalScore } from '../../services/signal.js';
import { computeWeeklyOutcome } from '../../services/intelligence/weekly-outcome.js';
import { recordBriefingView, getBriefingOutcome } from '../../services/intelligence/briefing-telemetry.js';
import { isDueForNps } from '../../services/founder/feedback.js';
import { getStreak } from '../../services/founder/rejection-streak.js';
import { topPeerValidatedDecisionTypes } from '../../services/intelligence/peer-signal.js';
import { dashboardLayout } from '../../views/layout.js';
import { stressorReport, milestoneToastScript, type StressorData } from '../../views/components.js';
import type { SignalComponents } from '../../services/signal.js';
import { getLayoutContext } from './_shared.js';
import type { SCPBriefing } from '../../services/scp/types.js';

export const dashboardRoutes = new Hono<AuthEnv>();

// ─── Sparkline ────────────────────────────────────────────────────────────────

function sparklineSVG(history: Array<{ score: number }>, width = 120, height = 28) {
  if (history.length < 2) return raw('');
  const pts = history
    .map((h, i) => {
      const x = (i / (history.length - 1)) * width;
      const y = 2 + ((100 - h.score) / 100) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return raw(
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="signal-sparkline" aria-hidden="true">` +
    `<polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`,
  );
}

// ─── Signal Anatomy Dialog ────────────────────────────────────────────────────

function signalAnatomyDialog(score: number, components: SignalComponents, riskState: string) {
  const { stressorPenalty, mrrPenalty, backlogPenalty, lifecycleBonus } = components;
  const preCeiling = 85 - stressorPenalty - mrrPenalty - backlogPenalty + lifecycleBonus;
  const ceilingMap: Record<string, string> = {
    green: 'No cap',
    yellow: 'Capped at 72',
    red: 'Capped at 40',
  };
  const ceilingLabel = ceilingMap[riskState] ?? 'No cap';

  // Bar widths as % of max possible penalty for each component
  const stressorBarW = Math.round((stressorPenalty / 40) * 100);
  const mrrBarW = Math.round((mrrPenalty / 25) * 100);
  const backlogBarW = Math.round((backlogPenalty / 15) * 100);
  const bonusBarW = Math.round((lifecycleBonus / 10) * 100);

  const hint =
    stressorPenalty >= 20 ? 'Resolve active stressors for the biggest Signal improvement.' :
    mrrPenalty >= 15 ? 'Improve your MRR health ratio — reduce churn or grow new MRR.' :
    backlogPenalty >= 9 ? 'Clear the decision backlog — overdue decisions cost up to 15 points.' :
    riskState !== 'green' ? 'Exit the current risk state to lift the score ceiling.' :
    'Your Signal is well-balanced. Focus on lifecycle progression.';

  const row = (name: string, val: string, barW: number, type: 'neg' | 'pos' | 'zero' | 'sub' | 'total' | 'base') => {
    const cls = type === 'neg' ? 'anatomy-negative' : type === 'pos' ? 'anatomy-positive' :
                type === 'zero' ? 'anatomy-zero' : type === 'sub' ? 'anatomy-sub' :
                type === 'total' ? 'anatomy-total' : 'anatomy-base';
    return html`<div class="anatomy-row ${cls}">
      <span class="anatomy-name">${name}</span>
      ${barW > 0 ? html`<div class="anatomy-bar-track"><div class="anatomy-bar" style="width:${barW}%"></div></div>` : html`<span class="anatomy-spacer"></span>`}
      <span class="anatomy-value">${raw(val)}</span>
    </div>`;
  };

  return html`
  <dialog id="anatomy-dialog" class="anatomy-dialog">
    <button class="anatomy-close" onclick="document.getElementById('anatomy-dialog').close()" aria-label="Close">&#x2715;</button>
    <div class="anatomy-title">Signal Anatomy</div>
    <div class="anatomy-subtitle">How your ${score} is built</div>

    <div class="anatomy-table">
      ${row('Base score', '85', 0, 'base')}
      ${stressorPenalty > 0 ? row('Active stressors', `−${stressorPenalty}`, stressorBarW, 'neg') : row('Active stressors', '−0', 0, 'zero')}
      ${mrrPenalty > 0 ? row('MRR health', `−${mrrPenalty}`, mrrBarW, 'neg') : row('MRR health', '−0', 0, 'zero')}
      ${backlogPenalty > 0 ? row('Decision backlog', `−${backlogPenalty}`, backlogBarW, 'neg') : row('Decision backlog', '−0', 0, 'zero')}
      ${lifecycleBonus > 0 ? row('Lifecycle progress', `+${lifecycleBonus}`, bonusBarW, 'pos') : row('Lifecycle progress', '+0', 0, 'zero')}
      <div class="anatomy-divider"></div>
      ${row('Before ceiling', String(preCeiling), 0, 'sub')}
      ${row('Risk ceiling', ceilingLabel, 0, 'sub')}
      <div class="anatomy-divider"></div>
      ${row('Signal', String(score), 0, 'total')}
    </div>

    <div class="anatomy-hint">${hint}</div>

    <form method="dialog" style="text-align:center;margin-top:1rem;">
      <button class="btn btn-ghost btn-sm">Close</button>
    </form>
  </dialog>`;
}

// ─── Product Switcher ────────────────────────────────────────────────────────

dashboardRoutes.post('/switch-product', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.parseBody() as Record<string, string>;
  const productId = body.product_id;

  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.redirect('/dashboard');

  setCookie(c, 'foundry_product', productId, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 365,
  });

  const referer = c.req.header('Referer');
  return c.redirect(referer ?? '/dashboard');
});

// ─── Dashboard ───────────────────────────────────────────────────────────────

dashboardRoutes.get('/dashboard', async (c) => {
  const founder = c.get('founder');

  // EVERY OLD PATH LEADS BACK HERE, AND HERE IS THE OLD PRODUCT.
  //
  // The owner tapped a link to his surface and landed in the thirty-door
  // dashboard, because the sign-in page bounces an already-signed-in user to
  // `/dashboard` and the installed app's start_url was `/dashboard` too. Those
  // are fixed at their source; this is the backstop for everything else that
  // still points here — a bookmark, a home-screen icon installed before the
  // cutover, an internal redirect written years ago.
  //
  // Private deployments only: a commercial customer's dashboard is their
  // product, and this is not their surface.
  const { isPrivateOwnerInstance } = await import('../../lib/instance-posture.js');
  if (isPrivateOwnerInstance()) return c.redirect('/foundry');
  // Owned or accepted into. An invited co-founder used to land here and see
  // an empty dashboard.
  const products = await getVisibleProducts(founder.id);

  if (products.rows.length === 0) {
    return c.redirect('/onboarding');
  }

  // If founder has multiple products and no active selection: show portfolio
  const cookieProductId = getCookie(c, 'foundry_product');
  if (products.rows.length > 1 && !cookieProductId) {
    return c.redirect('/portfolio');
  }

  const ctx = await getLayoutContext(founder, 'dashboard', 'Dashboard', undefined, c);
  const productId = ctx.productId!;

  const [signal, stressors, history, dailyInsight, previousScore, latestBriefing, weeklyOutcome, briefingOutcome, npsDue, streak, peerSignals] = await Promise.all([
    computeSignal(productId),
    getActiveStressors(productId),
    getSignalHistory(productId, 60),
    getDailyInsight(productId),
    getPreviousSignalScore(productId),
    (async (): Promise<SCPBriefing | null> => {
      try {
        const { getLatestBriefing } = await import('../../services/scp/briefing.js');
        return await getLatestBriefing(productId);
      } catch {
        return null;
      }
    })(),
    computeWeeklyOutcome(productId).catch(() => null),
    getBriefingOutcome(productId).catch(() => null),
    isDueForNps(founder.id).catch(() => false),
    getStreak(founder.id, productId).catch(() => ({ consecutive: 0, last_rejected_at: null })),
    // Peer signal — match decision_patterns on the product's lifecycle
    // stage. Read it from the DB so the right stage is used; default
    // 'growth' on fetch failure.
    (async () => {
      try {
        const r = await query('SELECT growth_stage FROM products WHERE id = ?', [productId]);
        const stage = (r.rows[0] as Record<string, string | null> | undefined)?.growth_stage ?? 'growth';
        return await topPeerValidatedDecisionTypes(stage, 3);
      } catch { return []; }
    })(),
  ]) as [
    Awaited<ReturnType<typeof computeSignal>>,
    Awaited<ReturnType<typeof getActiveStressors>>,
    Awaited<ReturnType<typeof getSignalHistory>>,
    Awaited<ReturnType<typeof getDailyInsight>>,
    Awaited<ReturnType<typeof getPreviousSignalScore>>,
    SCPBriefing | null,
    Awaited<ReturnType<typeof computeWeeklyOutcome>> | null,
    Awaited<ReturnType<typeof getBriefingOutcome>> | null,
    boolean,
    Awaited<ReturnType<typeof getStreak>>,
    Awaited<ReturnType<typeof topPeerValidatedDecisionTypes>>,
  ];

  // Record that the founder viewed today's briefing — fire-and-forget so a
  // telemetry write failure doesn't break the page render.
  if (latestBriefing?.id) {
    recordBriefingView(founder.id, productId, latestBriefing.id).catch(() => {});
  }

  // A LIFETIME COUNTER STATED AS A CLAIM ABOUT THIS WEEK.
  //
  // `rejection_streaks.consecutive_rejections` has no date predicate anywhere:
  // it is incremented on every rejection and reset only by an approval, never
  // by time. The card said "Your agents have been off-target this week" — so
  // three rejections spread across eight months, with no approval since,
  // produced that sentence today, every day, forever.
  //
  // The streak is a real fact and keeps its sentence; what it cannot support is
  // the window. `last_rejected_at` is the one date the table does hold, so the
  // card says when, and stops nagging about a streak whose most recent
  // rejection is more than a month old — an old streak is a fact, not a signal.
  const streakDays = streak.last_rejected_at === null
    ? null
    : Math.max(0, Math.floor(
      (Date.now() - new Date(String(streak.last_rejected_at).replace(' ', 'T') + 'Z').getTime())
      / 86_400_000));

  const stressorRows = stressors.rows as unknown as StressorData[];
  const criticalCount = stressorRows.filter((s) => s.severity === 'critical').length;
  const pendingDecisions = ctx.ux.navBadges.decisions_count;

  // Delta vs. yesterday
  const delta = previousScore !== null ? signal.score - previousScore : null;
  const deltaStr = delta === null ? '' : delta > 0 ? `+${delta}` : delta < 0 ? String(delta) : '±0';
  const deltaCls = delta === null || delta === 0 ? '' : delta > 0 ? 'signal-delta-up' : 'signal-delta-down';

  // ─── Catch-up summary for returning users (F-068-A) ──────────────────────
  // Uses founders.last_seen_at to determine if the founder has been away.
  // The auth middleware updates last_seen_at on every request, so we query the
  // value that was set *before* this page load — which is the stored value.
  const lastSeenResult = await query(
    'SELECT last_seen_at FROM founders WHERE id = ?',
    [founder.id]
  );
  const lastSeenRow = lastSeenResult.rows[0] as Record<string, unknown> | undefined;
  const lastSeenAt = lastSeenRow?.last_seen_at as string | null | undefined;

  let catchUpHtml = '';
  if (lastSeenAt) {
    const lastSeen = new Date(lastSeenAt);
    const now = new Date();
    const msDiff = now.getTime() - lastSeen.getTime();
    const daysSince = Math.floor(msDiff / (1000 * 60 * 60 * 24));

    // Only show catch-up if the founder has been away for 2+ days
    if (daysSince >= 2) {
      const [decisionsResult, newStressorsResult, signalThenResult] = await Promise.all([
        query(
          `SELECT COUNT(*) as cnt FROM decisions
           WHERE product_id = ? AND status != 'pending' AND created_at >= ?`,
          [productId, lastSeenAt]
        ),
        query(
          `SELECT COUNT(*) as cnt FROM stressor_history
           WHERE product_id = ? AND identified_at >= ?`,
          [productId, lastSeenAt]
        ),
        query(
          `SELECT score FROM signal_history
           WHERE product_id = ? AND snapshot_date <= date(?)
           ORDER BY snapshot_date DESC LIMIT 1`,
          [productId, lastSeenAt]
        ),
      ]);

      const decisionsMade = (decisionsResult.rows[0] as Record<string, number>)?.cnt ?? 0;
      const newStressors = (newStressorsResult.rows[0] as Record<string, number>)?.cnt ?? 0;
      const scoreThen = (signalThenResult.rows[0] as Record<string, number>)?.score ?? null;
      const scoreChange = scoreThen !== null ? signal.score - scoreThen : null;
      const scoreChangeStr = scoreChange === null ? 'N/A'
        : scoreChange > 0 ? `+${scoreChange}`
        : scoreChange < 0 ? String(scoreChange)
        : '±0';
      const scoreChangeCls = scoreChange === null || scoreChange === 0 ? ''
        : scoreChange > 0 ? 'signal-delta-up'
        : 'signal-delta-down';

      catchUpHtml = `
      <div class="card" style="margin-bottom:1.5rem;border-left:3px solid var(--accent);background:rgba(78,204,163,0.04);">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--accent);margin-bottom:0.75rem;">
          Welcome back — ${daysSince} day${daysSince !== 1 ? 's' : ''} since your last visit
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:1rem;">
          <div>
            <div style="font-size:1.25rem;font-weight:700;color:var(--text-primary);">${decisionsMade}</div>
            <div style="font-size:0.78rem;color:var(--text-dim);">decision${decisionsMade !== 1 ? 's' : ''} made by agents</div>
          </div>
          <div>
            <div style="font-size:1.25rem;font-weight:700;color:${newStressors > 0 ? 'var(--warning)' : 'var(--text-primary)'};">${newStressors}</div>
            <div style="font-size:0.78rem;color:var(--text-dim);">new stressor${newStressors !== 1 ? 's' : ''}</div>
          </div>
          <div>
            <div style="font-size:1.25rem;font-weight:700;" class="${scoreChangeCls}">${scoreChangeStr}</div>
            <div style="font-size:0.78rem;color:var(--text-dim);">Signal score change</div>
          </div>
        </div>
      </div>`;
    }
  }

  const { getFluency: dashFl, explain: dashEx } = await import('../../services/ux/fluency.js');
  const dashIntro = dashEx('dashboard', dashFl(founder));

  const content = html`
    <div class="signal-home" data-product-id="${productId}">

      ${raw(catchUpHtml)}
      ${dashIntro ? html`<p style="color:var(--text-muted);font-size:0.8rem;margin:0 0 1rem;">${dashIntro}</p>` : ''}

      <div class="signal-display signal-${signal.hasData ? signal.tier : 'mid'}">
        ${signal.hasData ? html`
        <button
          class="signal-number"
          onclick="document.getElementById('anatomy-dialog').showModal()"
          title="Tap to see score breakdown"
          aria-haspopup="dialog"
        >${signal.score}</button>` : html`
        <div class="signal-number" style="font-size:1.4rem;opacity:0.7;">—</div>`}
        <div class="signal-label-row">
          <span class="signal-label">${signal.hasData ? 'Signal' : 'No data yet'}</span>
          ${signal.hasData && delta !== null ? raw(`<span class="signal-delta ${deltaCls}">${deltaStr}</span>`) : ''}
        </div>
        ${!signal.hasData ? html`<p style="font-size:0.8rem;color:var(--text-muted);margin:0.4rem auto 0;max-width:320px;line-height:1.5;">Your Signal appears once Foundry can see your numbers. <a href="/connections" style="color:var(--accent);">Connect a tool</a> to start.</p>` : ''}
        ${history.length >= 2 ? html`
        <div class="signal-sparkline-wrap">
          ${sparklineSVG(history)}
          <span class="signal-sparkline-label">${history.length}d trend</span>
        </div>` : ''}
      </div>

      <div class="signal-prose" id="signal-prose">
        ${signal.prose}
      </div>

      ${dailyInsight ? html`
      <details class="daily-insight">
        <summary class="daily-insight-summary">
          <span class="daily-insight-eyebrow">Today's focus</span>
          <span class="daily-insight-headline">${dailyInsight.headline}</span>
        </summary>
        <div class="daily-insight-body">
          <p>${dailyInsight.context}</p>
          ${dailyInsight.action ? html`<div class="daily-insight-action">${dailyInsight.action}</div>` : ''}
        </div>
      </details>` : ''}

      ${weeklyOutcome && (weeklyOutcome.surfaced_7d > 0 || weeklyOutcome.agent_actions_7d > 0) ? html`
      <div class="card" style="margin-bottom:1.5rem;padding:1rem 1.25rem;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem;">
          <span style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-dim);">This week — what Foundry did</span>
          <span style="font-size:0.7rem;color:var(--text-muted);">trailing 7 days</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:0.75rem;">
          <div>
            <div style="font-size:1.4rem;font-weight:700;color:var(--text-primary);">
              ${weeklyOutcome.acted_on_7d}<span style="font-size:0.85rem;color:var(--text-dim);font-weight:500;"> / ${weeklyOutcome.surfaced_7d}</span>
            </div>
            <div style="font-size:0.78rem;color:var(--text-dim);">
              decisions you handled${weeklyOutcome.percent_acted !== null ? ` (${weeklyOutcome.percent_acted}%)` : ''}
            </div>
          </div>
          <div>
            <div style="font-size:1.4rem;font-weight:700;color:var(--text-primary);">${weeklyOutcome.agent_actions_7d}</div>
            <div style="font-size:0.78rem;color:var(--text-dim);">agent actions executed</div>
          </div>
          ${weeklyOutcome.expired_7d > 0 ? html`
          <div>
            <div style="font-size:1.4rem;font-weight:700;color:var(--warning);">${weeklyOutcome.expired_7d}</div>
            <div style="font-size:0.78rem;color:var(--text-dim);">decisions expired unhandled</div>
          </div>` : ''}
          ${briefingOutcome && briefingOutcome.fast_actions_7d > 0 ? html`
          <div>
            <div style="font-size:1.4rem;font-weight:700;color:var(--accent);">${briefingOutcome.fast_actions_7d}</div>
            <div style="font-size:0.78rem;color:var(--text-dim);">acted within 5 min of reading</div>
          </div>` : ''}
        </div>
      </div>` : ''}

      ${streak.consecutive >= 3 && streakDays !== null && streakDays <= 30 ? html`
      <div class="card" style="margin-bottom:1.5rem;padding:1rem 1.25rem;border-left:3px solid var(--warning, #ffb347);background:rgba(255,179,71,0.04);">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--warning, #ffb347);margin-bottom:0.5rem;">
          ${streak.consecutive} rejections in a row
        </div>
        <p style="margin:0 0 0.5rem;font-size:0.88rem;color:var(--text-primary);line-height:1.55;">
          Your agents have been off-target — the most recent was
          ${streakDays === 0 ? 'today' : streakDays === 1 ? 'yesterday' : `${streakDays} days ago`}.
          Two minutes of calibration would help.
        </p>
        <a href="/agents/wisdom" style="font-size:0.8rem;color:var(--accent);font-weight:600;">Open the taste journal →</a>
      </div>` : ''}

      ${peerSignals.length > 0 ? html`
      <div class="card" style="margin-bottom:1.5rem;padding:1rem 1.25rem;">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--text-dim);margin-bottom:0.5rem;">Peer signal — what's working for founders like you</div>
        ${peerSignals.map((p) => html`
          <div style="display:flex;justify-content:space-between;align-items:baseline;padding:0.5rem 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:0.85rem;">
            <span style="color:var(--text-primary);">${p.decision_type.replace(/_/g, ' ')}</span>
            <span style="color:var(--text-dim);font-size:0.78rem;">${Math.round(p.positive_outcome_rate * 100)}% positive · n=${p.sample_size}</span>
          </div>
        `)}
        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.5rem;">Anonymized aggregate across founders at the same growth stage.</div>
      </div>` : ''}

      ${npsDue ? html`
      <div class="card" id="nps-prompt" style="margin-bottom:1.5rem;padding:1rem 1.25rem;border:1px dashed var(--accent);">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--accent);margin-bottom:0.5rem;">A monthly check-in</div>
        <p style="margin:0 0 0.75rem;font-size:0.88rem;color:var(--text-primary);">How likely are you to recommend Foundry?</p>
        <form hx-post="/api/feedback/nps" hx-target="#nps-prompt" hx-swap="outerHTML" style="display:flex;gap:0.4rem;flex-wrap:wrap;align-items:center;">
          ${[0,1,2,3,4,5,6,7,8,9,10].map((n) => html`
            <button type="submit" name="score" value="${n.toString()}" class="btn-ghost" style="min-width:34px;padding:0.4rem 0.6rem;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--text-primary);font-size:0.85rem;cursor:pointer;">${n.toString()}</button>
          `)}
          <input type="hidden" name="product_id" value="${productId}" />
        </form>
        <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.5rem;">0 = not at all · 10 = absolutely</div>
      </div>` : ''}

      ${latestBriefing ? html`
      <div class="card" style="margin-bottom:1.5rem;border-left:3px solid var(--accent);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;">
          <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--accent);">CEO BRIEFING · ${latestBriefing.briefing_date}</div>
          <a href="/agents" style="font-size:0.75rem;color:var(--text-dim);">Agent Roster →</a>
        </div>
        <p style="margin:0 0 0.75rem;line-height:1.5;color:var(--text-primary);">${latestBriefing.headline}</p>
        ${latestBriefing.pending_decisions.length > 0 ? html`
        <div style="font-size:0.8rem;color:var(--warning);">
          ${latestBriefing.pending_decisions.length} decision${latestBriefing.pending_decisions.length > 1 ? 's' : ''} waiting for approval
          <a href="/agents" style="color:var(--accent);margin-left:0.5rem;">Review →</a>
        </div>` : ''}
      </div>` : ''}

      <div class="query-bar">
        <form class="query-form" id="query-form" onsubmit="handleQuery(event)">
          <input
            type="text"
            class="query-input"
            id="query-input"
            placeholder="Ask anything about your business…"
            autocomplete="off"
            spellcheck="false"
          />
        </form>
        <div class="query-response" id="query-response"></div>
      </div>

      ${pendingDecisions > 0 || criticalCount > 0 ? html`
      <div class="signal-actions">
        ${pendingDecisions > 0 ? html`
        <a href="/decisions" class="signal-action">
          <span class="signal-action-number">${pendingDecisions}</span>
          <span class="signal-action-label">${pendingDecisions === 1 ? 'decision' : 'decisions'} waiting</span>
        </a>` : ''}
        ${criticalCount > 0 ? html`
        <a href="#stressors" class="signal-action signal-action-urgent">
          <span class="signal-action-number">${criticalCount}</span>
          <span class="signal-action-label">critical ${criticalCount === 1 ? 'stressor' : 'stressors'}</span>
        </a>` : ''}
      </div>` : ''}

      ${stressorRows.length > 0 ? html`
      <div class="signal-stressors" id="stressors">
        ${stressorReport(stressorRows)}
      </div>` : ''}

    </div>

    ${signalAnatomyDialog(signal.score, signal.components, signal.riskState)}

    ${milestoneToastScript(ctx.ux.unseenMilestones)}

    <script>
    (function() {
      const productId = document.querySelector('[data-product-id]').dataset.productId;
      const responseEl = document.getElementById('query-response');
      const proseEl = document.getElementById('signal-prose');
      let originalProse = null;

      window.handleQuery = async function(e) {
        e.preventDefault();
        const input = document.getElementById('query-input');
        const question = input.value.trim();
        if (!question) return;

        if (!originalProse) originalProse = proseEl.innerHTML;

        responseEl.className = 'query-response loading';
        responseEl.textContent = 'Thinking';

        try {
          const res = await fetch('/api/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ question, product_id: productId }),
          });

          if (!res.ok) throw new Error('Request failed');
          const data = await res.json();

          let html = '<p>' + data.answer + '</p>';
          if (data.data_points && data.data_points.length > 0) {
            html += '<div class="query-data-points">';
            data.data_points.forEach(function(dp) {
              html += '<span class="query-data-point">' + dp.label + ': ' + dp.value + '</span>';
            });
            html += '</div>';
          }
          html += '<button class="query-reset" onclick="resetQuery()">← Back to Signal</button>';

          responseEl.innerHTML = html;
          responseEl.className = 'query-response visible';
          input.value = '';

        } catch (err) {
          responseEl.className = 'query-response visible';
          responseEl.textContent = 'Something went wrong. Try again.';
        }
      };

      window.resetQuery = function() {
        responseEl.className = 'query-response';
        responseEl.innerHTML = '';
        if (originalProse) {
          proseEl.innerHTML = originalProse;
          originalProse = null;
        }
      };
    })();
    </script>
  `;

  return c.html(dashboardLayout(ctx, content));
});
