// =============================================================================
// FOUNDRY — Investor Dashboard & Board Packets
// Manage investors, generate board packets, funding readiness score.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { buildSharedContext } from './_shared.js';
import { dashboardLayout } from '../../views/layout.js';
import { query } from '../../db/client.js';
import { generateBoardPacket, computeFundingReadiness } from '../../services/investor/board_packet.js';
import { nanoid } from 'nanoid';

export const investorRoutes = new Hono<AuthEnv>();

// ─── GET /investors ───────────────────────────────────────────────────────────

investorRoutes.get('/investors', async (c) => {
  const founder = c.get('founder');
  const ctx = await buildSharedContext(c);
  if (!ctx.product) return c.redirect('/products');

  const [investors, packets, readiness] = await Promise.all([
    query(
      `SELECT * FROM investors WHERE product_id = ? AND status = 'active' ORDER BY added_at DESC`,
      [ctx.product.id],
    ),
    query(
      `SELECT quarter, status, signal_start, signal_end, signal_delta, generated_at
       FROM board_packets WHERE product_id = ? ORDER BY quarter DESC LIMIT 8`,
      [ctx.product.id],
    ),
    query(
      `SELECT score, verdict, narrative, key_gaps, created_at
       FROM funding_readiness WHERE product_id = ? ORDER BY created_at DESC LIMIT 1`,
      [ctx.product.id],
    ),
  ]);

  const investorRows = investors.rows as Array<Record<string, unknown>>;
  const packetRows = packets.rows as Array<Record<string, unknown>>;
  const readinessRow = readiness.rows[0] as Record<string, unknown> | undefined;
  const keyGaps = readinessRow?.key_gaps
    ? JSON.parse(readinessRow.key_gaps as string) as string[]
    : [];

  const content = html`
    <div class="page-header">
      <h1>Investor Relations</h1>
      <p class="page-subtitle">Live dashboards, board packets, and funding readiness.</p>
    </div>

    ${readinessRow ? html`
      <div class="card funding-readiness-card">
        <div class="funding-score-row">
          <div class="funding-score-display">
            <span class="score-number ${(readinessRow.score as number) >= 75 ? 'high' : (readinessRow.score as number) >= 60 ? 'mid' : 'low'}">${readinessRow.score as number}</span>
            <div>
              <strong>Funding Readiness</strong>
              <span class="verdict-badge verdict-${readinessRow.verdict as string}">${(readinessRow.verdict as string).replace('_', ' ')}</span>
            </div>
          </div>
          <a href="/investors/funding-readiness" class="btn btn-outline btn-sm">View full report</a>
        </div>
        <p class="funding-narrative">${readinessRow.narrative as string}</p>
        ${keyGaps.length > 0 ? html`
          <div class="key-gaps">
            <strong>Key gaps:</strong>
            <ul>${keyGaps.map((g) => html`<li>${g}</li>`)}</ul>
          </div>
        ` : ''}
      </div>
    ` : html`
      <div class="card">
        <p>No funding readiness score yet.</p>
        <form method="POST" action="/investors/compute-readiness">
          <button type="submit" class="btn btn-primary">Compute Funding Readiness</button>
        </form>
      </div>
    `}

    <div class="section">
      <div class="section-header">
        <h2>Investors</h2>
        <a href="/investors/add" class="btn btn-primary btn-sm">Add investor</a>
      </div>

      ${investorRows.length === 0 ? html`
        <div class="empty-state">
          <p>No investors added yet. Add investors to give them access to live dashboards and milestone updates.</p>
        </div>
      ` : html`
        <div class="investor-list">
          ${investorRows.map((inv) => html`
            <div class="investor-row card">
              <div class="investor-info">
                <strong>${inv.name as string}</strong>
                ${inv.firm ? html`<span> · ${inv.firm as string}</span>` : ''}
                <span class="relationship-badge">${(inv.relationship as string ?? 'observer').replace('_', ' ')}</span>
              </div>
              <div class="investor-actions">
                ${inv.email ? html`<span class="investor-email">${inv.email as string}</span>` : ''}
                <a href="${`/share/investor/${inv.access_token as string}`}" target="_blank" class="btn btn-outline btn-sm">View dashboard</a>
                <button onclick="navigator.clipboard.writeText('${`${process.env.APP_URL ?? ''}/share/investor/${inv.access_token as string}`}')" class="btn btn-ghost btn-sm">Copy link</button>
                <form method="POST" action="/investors/${inv.id as string}/revoke" class="inline">
                  <button type="submit" class="btn btn-ghost btn-sm">Revoke</button>
                </form>
              </div>
            </div>
          `)}
        </div>
      `}
    </div>

    <div class="section">
      <div class="section-header">
        <h2>Board Packets</h2>
        <form method="POST" action="/investors/generate-packet" class="inline">
          <button type="submit" class="btn btn-primary btn-sm">Generate Q${Math.ceil((new Date().getMonth() + 1) / 3)} packet</button>
        </form>
      </div>

      ${packetRows.length === 0 ? html`
        <div class="empty-state">
          <p>No board packets generated yet. Generate your first quarterly board packet.</p>
        </div>
      ` : html`
        <div class="packet-list">
          ${packetRows.map((p) => html`
            <div class="packet-row card">
              <div class="packet-info">
                <strong>${p.quarter as string}</strong>
                <span class="packet-status packet-status-${p.status as string}">${p.status as string}</span>
                ${p.signal_delta !== null ? html`<span class="signal-delta ${(p.signal_delta as number) >= 0 ? 'positive' : 'negative'}">Signal ${(p.signal_delta as number) >= 0 ? '+' : ''}${p.signal_delta as number}</span>` : ''}
              </div>
              <div class="packet-actions">
                <a href="/investors/packets/${p.quarter as string}" class="btn btn-outline btn-sm">View</a>
                ${(p.status as string) === 'draft' ? html`
                  <form method="POST" action="/investors/packets/${p.quarter as string}/finalize" class="inline">
                    <button type="submit" class="btn btn-primary btn-sm">Finalize</button>
                  </form>
                ` : ''}
              </div>
            </div>
          `)}
        </div>
      `}
    </div>
  `;

  return c.html(dashboardLayout(ctx, String(content), 'Investors'));
});

// ─── POST /investors/generate-packet ─────────────────────────────────────────

investorRoutes.post('/investors/generate-packet', async (c) => {
  const founder = c.get('founder');
  const ctx = await buildSharedContext(c);
  if (!ctx.product) return c.redirect('/products');

  const now = new Date();
  const quarter = `${now.getFullYear()}-Q${Math.ceil((now.getMonth() + 1) / 3)}`;

  try {
    await generateBoardPacket(ctx.product.id, quarter);
    return c.redirect(`/investors/packets/${quarter}`);
  } catch (err) {
    console.error('[investors] board packet generation failed:', err);
    return c.redirect('/investors?error=packet_failed');
  }
});

// ─── GET /investors/packets/:quarter ─────────────────────────────────────────

investorRoutes.get('/investors/packets/:quarter', async (c) => {
  const founder = c.get('founder');
  const quarter = c.req.param('quarter');
  const ctx = await buildSharedContext(c);
  if (!ctx.product) return c.redirect('/products');

  const result = await query(
    `SELECT * FROM board_packets WHERE product_id = ? AND quarter = ?`,
    [ctx.product.id, quarter],
  );
  if (result.rows.length === 0) return c.notFound();

  const packet = result.rows[0] as Record<string, unknown>;

  const content = html`
    <div class="page-header">
      <a href="/investors" class="back-link">← Investor Relations</a>
      <div class="packet-header-row">
        <h1>Board Packet — ${quarter}</h1>
        <span class="packet-status packet-status-${packet.status as string}">${packet.status as string}</span>
      </div>
      <div class="packet-meta">
        ${packet.signal_start !== null ? html`Signal: ${packet.signal_start as number} → ${packet.signal_end as number} (${(packet.signal_delta as number) >= 0 ? '+' : ''}${packet.signal_delta as number})` : ''}
      </div>
    </div>

    <div class="packet-sections">
      ${packet.executive_summary ? html`
        <div class="packet-section">
          <h2>Executive Summary</h2>
          <p>${packet.executive_summary as string}</p>
        </div>
      ` : ''}
      ${packet.signal_narrative ? html`
        <div class="packet-section">
          <h2>Signal & Health</h2>
          <p>${packet.signal_narrative as string}</p>
        </div>
      ` : ''}
      ${packet.mrr_narrative ? html`
        <div class="packet-section">
          <h2>Revenue</h2>
          <p>${packet.mrr_narrative as string}</p>
        </div>
      ` : ''}
      ${packet.cohort_narrative ? html`
        <div class="packet-section">
          <h2>Cohorts & Retention</h2>
          <p>${packet.cohort_narrative as string}</p>
        </div>
      ` : ''}
      ${packet.competitive_narrative ? html`
        <div class="packet-section">
          <h2>Competitive Landscape</h2>
          <p>${packet.competitive_narrative as string}</p>
        </div>
      ` : ''}
      ${packet.next_quarter_focus ? html`
        <div class="packet-section">
          <h2>Next Quarter Focus</h2>
          <p>${packet.next_quarter_focus as string}</p>
        </div>
      ` : ''}
    </div>

    <div class="packet-actions-bar">
      ${(packet.status as string) === 'draft' ? html`
        <form method="POST" action="/investors/packets/${quarter}/finalize">
          <button type="submit" class="btn btn-primary">Finalize Packet</button>
        </form>
      ` : html`
        <form method="POST" action="/investors/packets/${quarter}/share">
          <button type="submit" class="btn btn-primary">Share with Investors</button>
        </form>
      `}
      <form method="POST" action="/investors/generate-packet">
        <input type="hidden" name="quarter" value="${quarter}" />
        <button type="submit" class="btn btn-outline">Regenerate</button>
      </form>
    </div>
  `;

  return c.html(dashboardLayout(ctx, String(content), `Board Packet ${quarter}`));
});

// ─── POST /investors/compute-readiness ───────────────────────────────────────

investorRoutes.post('/investors/compute-readiness', async (c) => {
  const founder = c.get('founder');
  const ctx = await buildSharedContext(c);
  if (!ctx.product) return c.redirect('/products');

  try {
    const result = await computeFundingReadiness(ctx.product.id);

    await query(
      `INSERT INTO funding_readiness
       (id, product_id, score, verdict, key_gaps, narrative,
        mrr_trajectory_score, churn_score, activation_score,
        technical_debt_score, decision_track_record_score,
        team_completeness_score, market_clarity_score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(product_id, date(created_at)) DO UPDATE SET
         score = excluded.score, verdict = excluded.verdict,
         key_gaps = excluded.key_gaps, narrative = excluded.narrative`,
      [
        nanoid(), ctx.product.id,
        result.score, result.verdict,
        JSON.stringify(result.key_gaps), result.narrative,
        result.component_scores.mrr_trajectory_score,
        result.component_scores.churn_score,
        result.component_scores.activation_score,
        result.component_scores.technical_debt_score,
        result.component_scores.decision_track_record_score,
        result.component_scores.team_completeness_score,
        result.component_scores.market_clarity_score,
      ],
    );

    return c.redirect('/investors');
  } catch (err) {
    console.error('[investors] funding readiness failed:', err);
    return c.redirect('/investors?error=readiness_failed');
  }
});

// ─── POST /investors/add ──────────────────────────────────────────────────────

investorRoutes.post('/investors/add', async (c) => {
  const founder = c.get('founder');
  const ctx = await buildSharedContext(c);
  if (!ctx.product) return c.redirect('/products');

  const body = await c.req.parseBody() as Record<string, string>;

  await query(
    `INSERT INTO investors (id, product_id, name, email, firm, relationship, access_token)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(), ctx.product.id,
      body.name ?? 'Investor',
      body.email || null,
      body.firm || null,
      body.relationship || 'angel',
      nanoid(32),
    ],
  );

  return c.redirect('/investors');
});

// ─── POST /investors/:id/revoke ───────────────────────────────────────────────

investorRoutes.post('/investors/:id/revoke', async (c) => {
  const founder = c.get('founder');
  const investorId = c.req.param('id');
  const ctx = await buildSharedContext(c);
  if (!ctx.product) return c.redirect('/products');

  await query(
    `UPDATE investors SET status = 'revoked' WHERE id = ? AND product_id = ?`,
    [investorId, ctx.product.id],
  );

  return c.redirect('/investors');
});

// ─── POST /investors/packets/:quarter/finalize ────────────────────────────────

investorRoutes.post('/investors/packets/:quarter/finalize', async (c) => {
  const founder = c.get('founder');
  const quarter = c.req.param('quarter');
  const ctx = await buildSharedContext(c);
  if (!ctx.product) return c.redirect('/products');

  await query(
    `UPDATE board_packets SET status = 'finalized', finalized_at = CURRENT_TIMESTAMP
     WHERE product_id = ? AND quarter = ?`,
    [ctx.product.id, quarter],
  );

  return c.redirect(`/investors/packets/${quarter}`);
});
