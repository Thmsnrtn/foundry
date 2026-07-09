// =============================================================================
// FOUNDRY — Agents OKR
// OKR tracking dashboard showing company objectives and key results.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import { nanoid } from 'nanoid';
import type { AuthEnv } from '../../middleware/auth.js';
import { query } from '../../db/client.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';

export const agentsOkr = new Hono<AuthEnv>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function progressBarHtml(pct: number, color = '#4ecca3'): string {
  const clamped = Math.max(0, Math.min(100, pct));
  return `<div style="background:rgba(255,255,255,0.08);border-radius:4px;height:8px;overflow:hidden;"><div style="background:${color};height:100%;width:${clamped.toFixed(0)}%;transition:width 0.3s;"></div></div>`;
}

function statusBadgeStyle(status: string): string {
  if (status === 'on_track') return 'background:#4ecca322;color:#4ecca3;border:1px solid #4ecca344;';
  if (status === 'at_risk') return 'background:#ffb34722;color:#ffb347;border:1px solid #ffb34744;';
  if (status === 'off_track') return 'background:#ff6b6b22;color:#ff6b6b;border:1px solid #ff6b6b44;';
  if (status === 'completed') return 'background:rgba(255,255,255,0.08);color:#4ecca3;border:1px solid rgba(255,255,255,0.15);';
  return 'background:rgba(255,255,255,0.06);color:var(--text-muted);border:1px solid rgba(255,255,255,0.1);';
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function progressColor(pct: number): string {
  if (pct >= 70) return '#4ecca3';
  if (pct >= 40) return '#ffb347';
  return '#ff6b6b';
}

// ─── GET /okrs ─────────────────────────────────────────────────────────────────

agentsOkr.get('/okrs', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'okrs', 'OKRs', undefined, c);
  const quarter = c.req.query('quarter') ?? '';

  if (!ctx.productId) {
    const content = html`
      <h1 style="margin:0 0 1rem;">OKRs</h1>
      <div class="card" style="padding:2rem;text-align:center;color:var(--text-muted);">No product selected.</div>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;

  let sql = `SELECT co.*,
    COUNT(kr.id) as kr_count,
    AVG(kr.progress) as avg_progress
    FROM company_okrs co
    LEFT JOIN key_results kr ON kr.okr_id = co.id
    WHERE co.product_id=?`;
  const params: unknown[] = [productId];

  if (quarter) {
    sql += ` AND co.quarter=?`;
    params.push(quarter);
  }

  sql += ` GROUP BY co.id ORDER BY co.created_at DESC`;

  const result = await query(sql, params);
  const okrs = result.rows as Array<Record<string, unknown>>;

  // Get available quarters for selector
  const quartersResult = await query(
    `SELECT DISTINCT quarter FROM company_okrs WHERE product_id=? AND quarter IS NOT NULL ORDER BY quarter DESC LIMIT 8`,
    [productId]
  );
  const quarters = quartersResult.rows.map((r) => (r as Record<string, unknown>).quarter as string);

  const okrCards = await Promise.all(okrs.map(async (okr) => {
    const krResult = await query(
      `SELECT * FROM key_results WHERE okr_id=? ORDER BY created_at ASC`,
      [okr.id as string]
    );
    const krs = krResult.rows as Array<Record<string, unknown>>;
    const avgProgress = typeof okr.avg_progress === 'number' ? okr.avg_progress : parseFloat(String(okr.avg_progress ?? '0')) || 0;
    const pColor = progressColor(avgProgress);

    const krRows = krs.map((kr) => {
      const krProgress = typeof kr.progress === 'number' ? kr.progress : parseFloat(String(kr.progress ?? '0')) || 0;
      const baseline = kr.baseline_value ?? 0;
      const current = kr.current_value ?? baseline;
      const target = kr.target_value ?? 100;

      return html`
        <div style="padding:0.875rem 1rem;border-top:1px solid rgba(255,255,255,0.05);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem;gap:0.5rem;flex-wrap:wrap;">
            <span style="font-size:0.85rem;color:var(--text-primary);">${kr.title ?? kr.name ?? '(unnamed)'}</span>
            <span style="font-size:0.78rem;color:var(--text-muted);white-space:nowrap;">${Number(baseline).toLocaleString()} → <strong style="color:var(--text-dim);">${Number(current).toLocaleString()}</strong> → ${Number(target).toLocaleString()}</span>
          </div>
          <div style="display:flex;align-items:center;gap:0.75rem;">
            <div style="flex:1;">${{ toString: () => progressBarHtml(krProgress, progressColor(krProgress)) }}</div>
            <span style="font-size:0.8rem;font-weight:700;color:${progressColor(krProgress)};min-width:36px;text-align:right;">${krProgress.toFixed(0)}%</span>
          </div>
          <!-- Update form -->
          <details style="margin-top:0.75rem;">
            <summary style="cursor:pointer;font-size:0.75rem;color:var(--accent);font-weight:600;">Update progress</summary>
            <form method="POST" action="/okrs/${okr.id}/key-results/${kr.id}/update" style="margin-top:0.5rem;display:flex;gap:0.5rem;flex-wrap:wrap;align-items:flex-end;">
              <div>
                <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:2px;">Current value</label>
                <input type="number" name="current_value" value="${current}" required
                  style="width:120px;padding:5px 8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:var(--text-primary);font-size:0.82rem;" />
              </div>
              <div style="flex:1;min-width:160px;">
                <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:2px;">Note (optional)</label>
                <input type="text" name="note" placeholder="What changed?"
                  style="width:100%;padding:5px 8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:var(--text-primary);font-size:0.82rem;" />
              </div>
              <button type="submit" class="btn btn-primary" style="font-size:0.78rem;padding:0.35rem 0.75rem;">Save</button>
            </form>
          </details>
        </div>
      `;
    });

    return html`
      <div class="card" style="padding:0;overflow:hidden;margin-bottom:1rem;">
        <div style="padding:1.25rem;">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.75rem;">
            <div style="flex:1;">
              <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.25rem;">${okr.quarter ?? ''} Objective</div>
              <h3 style="margin:0;font-size:1.05rem;color:var(--text-primary);">${okr.title ?? okr.objective ?? '(untitled)'}</h3>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.4rem;flex-shrink:0;">
              <span style="font-size:0.7rem;padding:2px 8px;border-radius:99px;${statusBadgeStyle(okr.status as string ?? 'draft')}">${statusLabel(okr.status as string ?? 'draft')}</span>
              <span style="font-size:1rem;font-weight:700;color:${pColor};">${avgProgress.toFixed(0)}%</span>
            </div>
          </div>
          <div style="margin-bottom:0.5rem;">${{ toString: () => progressBarHtml(avgProgress, pColor) }}</div>
          ${okr.description ? html`<p style="margin:0.75rem 0 0;font-size:0.83rem;color:var(--text-dim);">${okr.description}</p>` : ''}
        </div>
        ${krs.length > 0 ? html`
          <div>
            <div style="padding:0.5rem 1rem;background:rgba(255,255,255,0.02);font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);">Key Results (${krs.length})</div>
            ${krRows}
          </div>
        ` : html`<div style="padding:0.75rem 1rem;font-size:0.82rem;color:var(--text-muted);">No key results defined yet.</div>`}
      </div>
    `;
  }));

  const content = html`
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:0.5rem;">
      <h1 style="margin:0;">OKRs</h1>
      ${quarters.length > 1 ? html`
        <form method="GET" action="/okrs" style="display:flex;align-items:center;gap:0.5rem;">
          <select name="quarter" onchange="this.form.submit()"
            style="padding:0.4rem 0.75rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:var(--text-primary);font-size:0.82rem;">
            <option value="">All quarters</option>
            ${quarters.map((q) => html`<option value="${q}" ${q === quarter ? 'selected' : ''}>${q}</option>`)}
          </select>
        </form>
      ` : ''}
    </div>

    ${okrs.length === 0
      ? html`<div class="card" style="padding:3rem;text-align:center;color:var(--text-muted);font-size:0.9rem;">No OKRs defined yet. Agents will create objectives as your strategy evolves.</div>`
      : okrCards}
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /okrs/:okrId/key-results/:krId/update ───────────────────────────────

agentsOkr.post('/okrs/:okrId/key-results/:krId/update', async (c) => {
  const founder = c.get('founder');
  const okrId = c.req.param('okrId');
  const krId = c.req.param('krId');
  const body = await c.req.parseBody();
  const currentValue = parseFloat(body.current_value as string);
  const note = (body.note as string) ?? null;

  if (isNaN(currentValue)) {
    return c.redirect('/okrs');
  }

  // Fetch the key result to compute progress
  const krResult = await query(
    `SELECT * FROM key_results WHERE id=?`,
    [krId]
  );
  if (krResult.rows.length === 0) return c.redirect('/okrs');

  const kr = krResult.rows[0] as Record<string, unknown>;
  const baseline = typeof kr.baseline_value === 'number' ? kr.baseline_value : parseFloat(String(kr.baseline_value ?? '0')) || 0;
  const target = typeof kr.target_value === 'number' ? kr.target_value : parseFloat(String(kr.target_value ?? '100')) || 100;
  const range = target - baseline;
  const progress = range > 0 ? Math.min(100, Math.max(0, ((currentValue - baseline) / range) * 100)) : 0;

  // Insert progress update record
  await query(
    `INSERT INTO okr_progress_updates (id, key_result_id, new_value, source, source_id, note)
     VALUES (?, ?, ?, 'founder_manual', ?, ?)`,
    [nanoid(), krId, currentValue, founder.id, note]
  );

  // Update the key result current value and progress
  await query(
    `UPDATE key_results SET current_value=?, progress=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [currentValue, progress, krId]
  );

  return c.redirect(`/okrs`);
});
