// =============================================================================
// FOUNDRY — Board Packet & Investor Hub Routes
// Fundraising readiness, quarterly board packets, and monthly investor updates.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import {
  generateBoardPacket,
  getBoardPacket,
  listBoardPackets,
  markPacketReviewed,
} from '../../services/scp/investor/board-packet.js';
import {
  assessFundraisingReadiness,
  getLatestReadinessScore,
  type FundraisingReadiness,
} from '../../services/scp/investor/fundraising-readiness.js';
import {
  generateInvestorUpdate,
  getInvestorUpdate,
  listInvestorUpdates,
  markUpdateSent,
} from '../../services/scp/investor/investor-update.js';
import { requireTier } from '../../middleware/tier-gate.js';

export const boardPacket = new Hono<AuthEnv>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function currentQuarter(): string {
  const now = new Date();
  const q = Math.ceil((now.getMonth() + 1) / 3);
  return `${now.getFullYear()}-Q${q}`;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function statusBadge(status: string): string {
  if (status === 'reviewed') {
    return '<span style="font-size:0.7rem;background:#4ecca322;color:#4ecca3;padding:2px 8px;border-radius:99px;font-weight:700;">Reviewed</span>';
  }
  if (status === 'sent') {
    return '<span style="font-size:0.7rem;background:#4ecca322;color:#4ecca3;padding:2px 8px;border-radius:99px;font-weight:700;">Sent</span>';
  }
  return '<span style="font-size:0.7rem;background:rgba(255,255,255,0.08);color:var(--text-muted);padding:2px 8px;border-radius:99px;">Draft</span>';
}

function urgencyBadge(urgency: 'high' | 'medium' | 'low'): string {
  if (urgency === 'high') return '<span style="font-size:0.7rem;background:#ff6b6b22;color:#ff6b6b;padding:2px 8px;border-radius:99px;font-weight:700;">High</span>';
  if (urgency === 'medium') return '<span style="font-size:0.7rem;background:#ffb34722;color:#ffb347;padding:2px 8px;border-radius:99px;font-weight:700;">Medium</span>';
  return '<span style="font-size:0.7rem;background:rgba(255,255,255,0.06);color:var(--text-muted);padding:2px 8px;border-radius:99px;">Low</span>';
}

function scoreBar(val: number): string {
  const pct = Math.round((val / 10) * 100);
  const color = val >= 7 ? '#4ecca3' : val >= 5 ? '#ffb347' : '#ff6b6b';
  return `<div style="display:flex;align-items:center;gap:0.5rem;">
    <div style="flex:1;height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;">
      <div style="width:${pct}%;height:100%;background:${color};border-radius:3px;"></div>
    </div>
    <span style="font-size:0.78rem;font-weight:600;color:${color};min-width:2.5rem;text-align:right;">${val.toFixed(1)}/10</span>
  </div>`;
}

function dimensionLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function trendIcon(trend: 'up' | 'down' | 'flat'): string {
  if (trend === 'up') return '<span style="color:#4ecca3;">↑</span>';
  if (trend === 'down') return '<span style="color:#ff6b6b;">↓</span>';
  return '<span style="color:var(--text-muted);">→</span>';
}

// ─── GET /board — Investor Hub ─────────────────────────────────────────────────

boardPacket.get('/', requireTier('investor_layer'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'investors', 'Investor Hub', undefined, c);

  if (!ctx.productId) {
    const content = html`
      <h1 style="margin:0 0 0.5rem;">Investor Hub</h1>
      <p style="color:var(--text-dim);">No product selected.</p>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;

  // Load all three sections in parallel
  const [readinessSeed, packets, updates] = await Promise.all([
    getLatestReadinessScore(productId, 'seed').catch(() => null),
    listBoardPackets(productId).catch(() => []),
    listInvestorUpdates(productId).catch(() => []),
  ]);

  // ── Section 1: Fundraising Readiness ──
  const readinessSection = readinessSeed
    ? html`
      ${readinessSeed.ready_to_raise
        ? html`<div style="background:rgba(78,204,163,0.08);border:1px solid rgba(78,204,163,0.25);border-radius:8px;padding:0.875rem 1.25rem;margin-bottom:1rem;display:flex;align-items:center;gap:0.75rem;">
            <span style="font-size:1.25rem;">🎯</span>
            <span style="font-weight:700;color:#4ecca3;">Ready to Raise</span>
            <span style="color:var(--text-dim);font-size:0.85rem;">Overall score ${readinessSeed.overall_score.toFixed(1)}/10 — above the 7.0 threshold</span>
          </div>`
        : html`<div style="margin-bottom:1rem;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.35rem;">
              <span style="font-size:0.8rem;color:var(--text-dim);">Overall Score</span>
              <span style="font-size:1rem;font-weight:700;color:${readinessSeed.overall_score >= 7 ? '#4ecca3' : readinessSeed.overall_score >= 5 ? '#ffb347' : '#ff6b6b'};">${readinessSeed.overall_score.toFixed(1)}/10</span>
            </div>
            ${readinessSeed.estimated_weeks_to_ready !== null
              ? html`<p style="font-size:0.8rem;color:var(--text-muted);margin:0 0 0.5rem;">Est. ${readinessSeed.estimated_weeks_to_ready} weeks to raise-ready</p>`
              : ''}
          </div>`}

      <div style="display:flex;flex-direction:column;gap:0.5rem;margin-bottom:1rem;">
        ${Object.entries(readinessSeed.scores).map(([key, val]) => html`
          <div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.2rem;">
              <span style="font-size:0.78rem;color:var(--text-dim);">${dimensionLabel(key)}</span>
            </div>
            ${scoreBar(val as number)}
          </div>
        `)}
      </div>

      ${readinessSeed.gaps.length > 0 ? html`
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.5rem;">Gaps to Close</div>
        <div style="display:flex;flex-direction:column;gap:0.5rem;">
          ${readinessSeed.gaps.map((gap) => html`
            <div style="padding:0.6rem 0.875rem;background:rgba(255,255,255,0.03);border-radius:6px;border-left:2px solid ${gap.urgency === 'high' ? '#ff6b6b' : gap.urgency === 'medium' ? '#ffb347' : 'rgba(255,255,255,0.15)'};">
              <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem;">
                <span style="font-size:0.78rem;font-weight:600;color:var(--text-primary);">${dimensionLabel(gap.dimension)}</span>
                ${urgencyBadge(gap.urgency)}
              </div>
              <div style="font-size:0.78rem;color:var(--text-dim);">${gap.recommendation}</div>
            </div>
          `)}
        </div>
      ` : ''}
    `
    : html`<p style="color:var(--text-muted);font-size:0.85rem;">No readiness assessment yet.</p>`;

  // ── Section 2: Board Packets ──
  const packetRows = packets.map((p) => html`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:0.75rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.05);gap:1rem;flex-wrap:wrap;">
      <div>
        <div style="font-size:0.85rem;font-weight:600;color:var(--text-primary);">${p.quarter}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.15rem;">${p.overall_health_summary}</div>
      </div>
      <div style="display:flex;align-items:center;gap:0.75rem;">
        ${statusBadge(p.status)}
        <a href="/board/packet/${p.id}" style="font-size:0.78rem;color:var(--accent);text-decoration:none;">View →</a>
      </div>
    </div>
  `);

  // ── Section 3: Investor Updates ──
  const updateRows = updates.map((u) => html`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:0.75rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.05);gap:1rem;flex-wrap:wrap;">
      <div style="font-size:0.85rem;font-weight:600;color:var(--text-primary);">${u.month}</div>
      <div style="display:flex;align-items:center;gap:0.75rem;">
        ${statusBadge(u.status)}
        <a href="/board/update/${u.id}" style="font-size:0.78rem;color:var(--accent);text-decoration:none;">View →</a>
        ${u.status === 'draft' ? html`
          <form method="POST" action="/board/update/${u.id}/sent" style="margin:0;">
            <button type="submit" style="font-size:0.75rem;background:none;border:1px solid rgba(255,255,255,0.15);color:var(--text-dim);padding:2px 10px;border-radius:4px;cursor:pointer;">Mark Sent</button>
          </form>
        ` : ''}
      </div>
    </div>
  `);

  const content = html`
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:0.5rem;">
      <h1 style="margin:0;">Investor Hub</h1>
    </div>

    <!-- Section 1: Fundraising Readiness -->
    <div style="margin-bottom:1.75rem;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;flex-wrap:wrap;gap:0.5rem;">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Fundraising Readiness — Seed Round</div>
        <form method="POST" action="/board/readiness/assess">
          <input type="hidden" name="round" value="seed" />
          <button type="submit" class="btn btn-ghost btn-sm" style="font-size:0.78rem;">Re-assess →</button>
        </form>
      </div>
      <div class="card" style="padding:1.25rem;">
        ${readinessSection}
      </div>
    </div>

    <!-- Section 2: Board Packets -->
    <div style="margin-bottom:1.75rem;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;flex-wrap:wrap;gap:0.5rem;">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Board Packets</div>
        <form method="POST" action="/board/packet/generate">
          <button type="submit" class="btn btn-primary" style="font-size:0.78rem;">Generate ${currentQuarter()} Packet →</button>
        </form>
      </div>
      <div class="card" style="padding:0;overflow:hidden;">
        ${packetRows.length === 0
          ? html`<div style="padding:2.5rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">No board packets yet. Generate your first one above.</div>`
          : packetRows}
      </div>
    </div>

    <!-- Section 3: Investor Updates -->
    <div style="margin-bottom:1.75rem;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;flex-wrap:wrap;gap:0.5rem;">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Investor Updates</div>
        <form method="POST" action="/board/update/generate">
          <button type="submit" class="btn btn-primary" style="font-size:0.78rem;">Generate ${currentMonth()} Update →</button>
        </form>
      </div>
      <div class="card" style="padding:0;overflow:hidden;">
        ${updateRows.length === 0
          ? html`<div style="padding:2.5rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">No investor updates yet. Generate your first one above.</div>`
          : updateRows}
      </div>
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /board/readiness — generate readiness assessment, redirect to detail ─

boardPacket.post('/readiness', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'investors', 'Investor Hub', undefined, c);

  if (!ctx.productId) return c.redirect('/board');

  const body = await c.req.parseBody();
  const round = (body['round'] as string) ?? 'seed';
  const validRounds = ['pre_seed', 'seed', 'series_a', 'series_b'] as const;
  type RoundType = (typeof validRounds)[number];
  const targetRound: RoundType = validRounds.includes(round as RoundType) ? (round as RoundType) : 'seed';

  try {
    await assessFundraisingReadiness(ctx.productId, targetRound);
  } catch {
    // Non-fatal
  }

  return c.redirect(`/board/readiness/${targetRound}`);
});

// ─── POST /board/readiness/assess — alias kept for backward compat ─────────────

boardPacket.post('/readiness/assess', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'investors', 'Investor Hub', undefined, c);

  if (!ctx.productId) return c.redirect('/board');

  const body = await c.req.parseBody();
  const round = (body['round'] as string) ?? 'seed';
  const validRounds = ['pre_seed', 'seed', 'series_a', 'series_b'] as const;
  type RoundType = (typeof validRounds)[number];
  const targetRound: RoundType = validRounds.includes(round as RoundType) ? (round as RoundType) : 'seed';

  try {
    await assessFundraisingReadiness(ctx.productId, targetRound);
  } catch {
    // Non-fatal
  }

  return c.redirect('/board');
});

// ─── GET /board/readiness/:round — readiness detail page ──────────────────────

boardPacket.get('/readiness/:round', async (c) => {
  const founder = c.get('founder');
  const roundParam = c.req.param('round') as FundraisingReadiness['target_round'];
  const ctx = await getLayoutContext(founder, 'investors', `Readiness — ${roundParam}`, undefined, c);

  if (!ctx.productId) return c.redirect('/board');

  const readiness = await getLatestReadinessScore(ctx.productId, roundParam).catch(() => null);

  if (!readiness) return c.redirect('/board');

  const content = html`
    <div style="margin-bottom:1.5rem;">
      <a href="/board" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Investor Hub</a>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:0.75rem;">
      <div>
        <h1 style="margin:0 0 0.25rem;">Fundraising Readiness</h1>
        <div style="font-size:0.8rem;color:var(--text-muted);">${roundParam.replace(/_/g, ' ')} · ${readiness.ready_to_raise ? 'Ready to raise' : `~${readiness.estimated_weeks_to_ready ?? '?'} weeks away`}</div>
      </div>
      <form method="POST" action="/board/readiness">
        <input type="hidden" name="round" value="${roundParam}" />
        <button type="submit" class="btn btn-ghost" style="font-size:0.78rem;">Re-assess</button>
      </form>
    </div>

    <!-- Overall score -->
    <div class="card" style="padding:1.5rem;margin-bottom:1.25rem;text-align:center;">
      <div style="font-size:3.5rem;font-weight:800;color:${readiness.overall_score >= 7 ? '#4ecca3' : readiness.overall_score >= 5 ? '#ffb347' : '#ff6b6b'};">${readiness.overall_score.toFixed(1)}</div>
      <div style="font-size:0.8rem;color:var(--text-muted);margin-top:0.35rem;">Overall Score / 10</div>
      ${readiness.ready_to_raise
        ? html`<div style="margin-top:0.75rem;background:rgba(78,204,163,0.1);border:1px solid rgba(78,204,163,0.25);border-radius:6px;padding:6px 14px;display:inline-block;font-weight:700;color:#4ecca3;font-size:0.85rem;">Ready to Raise</div>`
        : readiness.estimated_weeks_to_ready
          ? html`<div style="margin-top:0.75rem;font-size:0.8rem;color:var(--text-muted);">Est. ${readiness.estimated_weeks_to_ready} weeks to reach 7.0</div>`
          : ''}
    </div>

    <!-- Dimension scores -->
    <div class="card" style="padding:1.25rem;margin-bottom:1.25rem;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.875rem;">Dimension Scores</div>
      <div style="display:flex;flex-direction:column;gap:0.6rem;">
        ${Object.entries(readiness.scores).map(([key, val]) => html`
          <div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.2rem;">
              <span style="font-size:0.8rem;color:var(--text-dim);">${dimensionLabel(key)}</span>
            </div>
            ${scoreBar(val as number)}
          </div>
        `)}
      </div>
    </div>

    <!-- Gaps -->
    ${readiness.gaps.length > 0 ? html`
      <div class="card" style="padding:1.25rem;margin-bottom:1.25rem;">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.875rem;">Gaps to Close</div>
        <div style="display:flex;flex-direction:column;gap:0.6rem;">
          ${readiness.gaps.map((gap) => html`
            <div style="padding:0.75rem 1rem;background:rgba(255,255,255,0.03);border-radius:6px;border-left:2px solid ${gap.urgency === 'high' ? '#ff6b6b' : gap.urgency === 'medium' ? '#ffb347' : 'rgba(255,255,255,0.15)'};">
              <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.3rem;">
                <span style="font-size:0.82rem;font-weight:600;color:var(--text-primary);">${dimensionLabel(gap.dimension)}</span>
                ${urgencyBadge(gap.urgency)}
              </div>
              <div style="font-size:0.78rem;color:var(--text-dim);margin-bottom:0.2rem;">${gap.gap}</div>
              <div style="font-size:0.78rem;color:var(--accent);">${gap.recommendation}</div>
            </div>
          `)}
        </div>
      </div>
    ` : html`<div class="card" style="padding:1.25rem;text-align:center;color:#4ecca3;font-size:0.85rem;">No critical gaps — strong across all dimensions.</div>`}
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /board/packet/generate ──────────────────────────────────────────────

boardPacket.post('/packet/generate', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'investors', 'Investor Hub', undefined, c);

  if (!ctx.productId) return c.redirect('/board');

  const quarter = currentQuarter();
  const id = await generateBoardPacket(ctx.productId, quarter);
  return c.redirect(`/board/packet/${id}`);
});

// ─── GET /board/packet/:id ─────────────────────────────────────────────────────

boardPacket.get('/packet/:id', async (c) => {
  const founder = c.get('founder');
  const id = c.req.param('id');
  const ctx = await getLayoutContext(founder, 'investors', 'Board Packet', undefined, c);

  const data = await getBoardPacket(id).catch(() => null);

  if (!data) {
    const content = html`
      <div style="margin-bottom:1.5rem;">
        <a href="/board" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Investor Hub</a>
      </div>
      <p style="color:var(--text-muted);">Board packet not found.</p>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const { packet, quarter, status } = data;

  const metricsRows = packet.key_metrics.map((m) => html`
    <tr>
      <td style="padding:0.6rem 1rem;font-size:0.82rem;color:var(--text-primary);font-weight:600;">${m.name}</td>
      <td style="padding:0.6rem 1rem;font-size:0.82rem;color:var(--text-primary);">${m.value}</td>
      <td style="padding:0.6rem 1rem;font-size:0.82rem;">${trendIcon(m.trend)} ${m.vs_last_quarter}</td>
    </tr>
  `);

  const content = html`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:0.75rem;">
      <a href="/board" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Investor Hub</a>
      <div style="display:flex;align-items:center;gap:0.75rem;">
        ${statusBadge(status)}
        ${status !== 'reviewed' ? html`
          <form method="POST" action="/board/packet/${id}/reviewed">
            <button type="submit" class="btn btn-primary" style="font-size:0.78rem;">Mark Reviewed</button>
          </form>
        ` : ''}
      </div>
    </div>

    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1.25rem;flex-wrap:wrap;gap:0.5rem;">
      <h1 style="margin:0;">Board Packet — ${quarter}</h1>
    </div>

    <!-- Executive Summary -->
    <div class="card" style="padding:1.25rem;margin-bottom:1.25rem;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.5rem;">Executive Summary</div>
      <p style="margin:0;font-size:0.9rem;line-height:1.65;color:var(--text-primary);">${packet.executive_summary}</p>
    </div>

    <!-- Key Metrics -->
    <div class="card" style="padding:0;overflow:hidden;margin-bottom:1.25rem;">
      <div style="padding:0.875rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.07);">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Key Metrics</div>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.07);">
            <th style="padding:0.5rem 1rem;text-align:left;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Metric</th>
            <th style="padding:0.5rem 1rem;text-align:left;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Value</th>
            <th style="padding:0.5rem 1rem;text-align:left;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">vs Last Quarter</th>
          </tr>
        </thead>
        <tbody>
          ${metricsRows}
        </tbody>
      </table>
    </div>

    <!-- Wins & Risks side by side -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;margin-bottom:1.25rem;">
      <div class="card" style="padding:1.25rem;">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.75rem;">Wins</div>
        <ul style="margin:0;padding-left:1.25rem;display:flex;flex-direction:column;gap:0.4rem;">
          ${packet.wins.map((w) => html`<li style="font-size:0.85rem;color:var(--text-primary);line-height:1.5;">${w}</li>`)}
        </ul>
      </div>
      <div class="card" style="padding:1.25rem;">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.75rem;">Risks</div>
        <ul style="margin:0;padding-left:1.25rem;display:flex;flex-direction:column;gap:0.4rem;">
          ${packet.risks.map((r) => html`<li style="font-size:0.85rem;color:var(--text-primary);line-height:1.5;">${r}</li>`)}
        </ul>
      </div>
    </div>

    <!-- Asks -->
    <div class="card" style="padding:1.25rem;margin-bottom:1.25rem;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.75rem;">Asks from the Board</div>
      <ul style="margin:0;padding-left:1.25rem;display:flex;flex-direction:column;gap:0.4rem;">
        ${packet.asks.map((a) => html`<li style="font-size:0.85rem;color:var(--text-primary);line-height:1.5;">${a}</li>`)}
      </ul>
    </div>

    <!-- Next Quarter Goals -->
    <div class="card" style="padding:0;overflow:hidden;margin-bottom:1.25rem;">
      <div style="padding:0.875rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.07);">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Next Quarter Goals</div>
      </div>
      ${packet.next_quarter_goals.map((g) => html`
        <div style="padding:0.75rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.05);">
          <div style="font-size:0.85rem;font-weight:600;color:var(--text-primary);margin-bottom:0.2rem;">${g.goal}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);">Owner: ${g.owner} — ${g.success_metric}</div>
        </div>
      `)}
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /board/packet/:id/reviewed ──────────────────────────────────────────

boardPacket.post('/packet/:id/reviewed', async (c) => {
  const founder = c.get('founder');
  const id = c.req.param('id');
  try {
    await markPacketReviewed(id, founder.id);
  } catch {
    // Non-fatal
  }
  return c.redirect(`/board/packet/${id}`);
});

// ─── POST /board/update/generate ──────────────────────────────────────────────

boardPacket.post('/update/generate', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'investors', 'Investor Hub', undefined, c);

  if (!ctx.productId) return c.redirect('/board');

  const month = currentMonth();
  const id = await generateInvestorUpdate(ctx.productId, month);
  return c.redirect(`/board/update/${id}`);
});

// ─── GET /board/update/:id ─────────────────────────────────────────────────────

boardPacket.get('/update/:id', async (c) => {
  const founder = c.get('founder');
  const id = c.req.param('id');
  const ctx = await getLayoutContext(founder, 'investors', 'Investor Update', undefined, c);

  const data = await getInvestorUpdate(id, founder.id as string).catch(() => null);

  if (!data) {
    const content = html`
      <div style="margin-bottom:1.5rem;">
        <a href="/board" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Investor Hub</a>
      </div>
      <p style="color:var(--text-muted);">Investor update not found.</p>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const content = html`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:0.75rem;">
      <a href="/board" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Investor Hub</a>
      <div style="display:flex;align-items:center;gap:0.75rem;">
        ${statusBadge(data.status)}
        ${data.status === 'draft' ? html`
          <form method="POST" action="/board/update/${id}/sent">
            <button type="submit" class="btn btn-primary" style="font-size:0.78rem;">Mark as Sent</button>
          </form>
        ` : ''}
        <button onclick="navigator.clipboard.writeText(document.getElementById('update-text').textContent||'').then(()=>alert('Copied!'))" style="font-size:0.78rem;background:none;border:1px solid rgba(255,255,255,0.15);color:var(--text-dim);padding:4px 12px;border-radius:4px;cursor:pointer;">Copy</button>
      </div>
    </div>

    <h1 style="margin:0 0 1.25rem;">Investor Update — ${data.month}</h1>

    <div class="card" style="padding:1.25rem;">
      <pre id="update-text" style="margin:0;white-space:pre-wrap;word-wrap:break-word;font-family:inherit;font-size:0.85rem;line-height:1.7;color:var(--text-primary);">${data.draft_text}</pre>
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /board/update/:id/sent ──────────────────────────────────────────────

boardPacket.post('/update/:id/sent', async (c) => {
  const founder = c.get('founder');
  const id = c.req.param('id');
  try {
    await markUpdateSent(id, founder.id);
  } catch {
    // Non-fatal
  }
  return c.redirect(`/board/update/${id}`);
});
