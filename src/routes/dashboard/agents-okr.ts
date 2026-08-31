// =============================================================================
// FOUNDRY — Agents OKR
// OKR tracking dashboard showing company objectives and key results.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import { nanoid } from 'nanoid';
import type { AuthEnv } from '../../middleware/auth.js';
import { query } from '../../db/client.js';
import { requireOwner } from '../../middleware/rbac.js';
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

/**
 * WHO MOVED THIS NUMBER.
 *
 * `okr_progress_updates` records every change to a key result — from what, to
 * what, by whom, and why. Nothing read it. The page showed a current value and
 * a progress bar, so "78%" was a fact with no history and no author: a founder
 * could not see that they had moved it themselves last Tuesday with a note
 * explaining why, still less that something else had.
 *
 * The `source` column exists to tell a founder-made change from an agent-made
 * one. Right now every row says 'founder_manual', because the only code that
 * would have written 'agent_session' was `services/scp/okr.ts`, which nothing
 * could call and which is retired in this change. The distinction is rendered
 * anyway rather than assumed away — if an agent path comes back, the founder
 * sees it the day it does, not the day someone remembers to add a label.
 */
function updateAuthor(source: string): string {
  if (source === 'founder_manual') return 'you';
  if (source === 'agent_session') return 'an agent';
  return source;
}

interface ProgressUpdate {
  key_result_id: string;
  previous_value: number | null;
  new_value: number;
  source: string;
  note: string | null;
  created_at: string;
}

// ─── GET /okrs ─────────────────────────────────────────────────────────────────

agentsOkr.get('/agents/okr', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'okrs', 'OKRs', undefined, c);
  const quarter = c.req.query('quarter') ?? '';

  if (!ctx.productId) {
    // NOTHING COULD CREATE AN OBJECTIVE.
  //
  // This page renders objectives, key results, progress bars, a quarter filter
  // and an update form — and until this form existed there was no way, anywhere
  // in the running system, to produce a row for it to render. `createOKR` lived
  // in `services/scp/okr.ts`, which nothing imported; `compass.ts` and
  // `forecasting/targets.ts` read `company_okrs` too, so agents were reasoning
  // about objectives that could not exist. The empty state said so, which was
  // honest, and left the feature hollow.
  //
  // The gate that says a table read by live code must have a live writer found
  // it the moment the unreachable module was deleted — it had been counting the
  // INSERT inside that module as a writer, because a text scanner cannot see
  // reachability. Deleting the module made the hollow half visible.
  const createForm = html`
    <details class="card" style="padding:1.25rem;margin-bottom:1rem;">
      <summary style="cursor:pointer;font-weight:600;font-size:0.9rem;color:var(--accent);">New objective</summary>
      <form method="POST" action="/agents/okr/create" style="margin-top:1rem;display:flex;flex-direction:column;gap:0.75rem;">
        <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
          <div style="flex:2;min-width:240px;">
            <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:2px;">Objective</label>
            <input type="text" name="objective" required placeholder="Reach 100 paying teams"
              style="width:100%;padding:6px 9px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:var(--text-primary);font-size:0.85rem;" />
          </div>
          <div style="min-width:120px;">
            <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:2px;">Period</label>
            <input type="text" name="period" required placeholder="2026-Q4"
              style="width:130px;padding:6px 9px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:var(--text-primary);font-size:0.85rem;" />
          </div>
        </div>
        <div style="font-size:0.72rem;color:var(--text-muted);">Key results — at least one. An objective with nothing to measure is a wish, so a blank set is refused. Leave a row blank to skip it.</div>
        ${[0, 1, 2].map((i) => html`
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:flex-end;">
          <div style="flex:2;min-width:200px;">
            <input type="text" name="kr_description_${i}" placeholder="What you will measure"
              style="width:100%;padding:6px 9px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:var(--text-primary);font-size:0.82rem;" />
          </div>
          <div><input type="number" step="any" name="kr_start_${i}" placeholder="from"
            style="width:90px;padding:6px 9px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:var(--text-primary);font-size:0.82rem;" /></div>
          <div><input type="number" step="any" name="kr_target_${i}" placeholder="to"
            style="width:90px;padding:6px 9px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:var(--text-primary);font-size:0.82rem;" /></div>
          <div><input type="text" name="kr_unit_${i}" placeholder="unit"
            style="width:80px;padding:6px 9px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:var(--text-primary);font-size:0.82rem;" /></div>
        </div>`)}
        <div><button type="submit" class="btn btn-primary" style="font-size:0.82rem;">Create objective</button></div>
      </form>
    </details>
  `;

  const content = html`
      <h1 style="margin:0 0 1rem;">OKRs</h1>
      <div class="card" style="padding:2rem;text-align:center;color:var(--text-muted);">No product selected.</div>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;

  // progress is derived, not stored: (current - start) / (target - start),
  // clamped to [0, 100]. key_results has no progress column.
  const KR_PROGRESS_SQL = `MAX(0, MIN(100,
    CASE WHEN kr.target_value != kr.start_value
      THEN (kr.current_value - kr.start_value) * 100.0 / (kr.target_value - kr.start_value)
      ELSE 0 END))`;

  let sql = `SELECT co.*, co.period AS quarter,
    COUNT(kr.id) as kr_count,
    AVG(${KR_PROGRESS_SQL}) as avg_progress
    FROM company_okrs co
    LEFT JOIN key_results kr ON kr.okr_id = co.id
    WHERE co.product_id=?`;
  const params: unknown[] = [productId];

  if (quarter) {
    sql += ` AND co.period=?`;
    params.push(quarter);
  }

  sql += ` GROUP BY co.id ORDER BY co.created_at DESC`;

  const result = await query(sql, params);

  // One query for every key result on the page, grouped in memory — a history
  // query per key result would be one round trip per row.
  const historyRows = (await query(
    `SELECT u.key_result_id, u.previous_value, u.new_value, u.source, u.note, u.created_at
       FROM okr_progress_updates u
       JOIN key_results kr ON kr.id = u.key_result_id
       JOIN company_okrs co ON co.id = kr.okr_id
      WHERE co.product_id = ?
      ORDER BY u.created_at DESC`,
    [productId],
  )).rows as unknown as Array<Record<string, unknown>>;

  const historyByKr = new Map<string, ProgressUpdate[]>();
  for (const r of historyRows) {
    const krId = String(r.key_result_id);
    const list = historyByKr.get(krId) ?? [];
    list.push({
      key_result_id: krId,
      previous_value: r.previous_value == null ? null : Number(r.previous_value),
      new_value: Number(r.new_value),
      source: String(r.source),
      note: r.note == null ? null : String(r.note),
      created_at: String(r.created_at),
    });
    historyByKr.set(krId, list);
  }
  const okrs = result.rows as Array<Record<string, unknown>>;

  // Get available periods for the selector
  const quartersResult = await query(
    `SELECT DISTINCT period AS quarter FROM company_okrs WHERE product_id=? AND period IS NOT NULL ORDER BY period DESC LIMIT 8`,
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
      const baseline = Number(kr.start_value ?? 0);
      const current = Number(kr.current_value ?? baseline);
      const target = Number(kr.target_value ?? 100);
      const range = target - baseline;
      const krProgress = range !== 0 ? Math.min(100, Math.max(0, ((current - baseline) / range) * 100)) : 0;

      return html`
        <div style="padding:0.875rem 1rem;border-top:1px solid rgba(255,255,255,0.05);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem;gap:0.5rem;flex-wrap:wrap;">
            <span style="font-size:0.85rem;color:var(--text-primary);">${kr.description ?? '(unnamed)'}${
              kr.owner_agent == null
                ? ''
                : html`<span style="font-size:0.7rem;color:var(--text-muted);margin-left:0.5rem;">owned by ${String(kr.owner_agent)}</span>`
            }</span>
            <span style="font-size:0.78rem;color:var(--text-muted);white-space:nowrap;">${Number(baseline).toLocaleString()} → <strong style="color:var(--text-dim);">${Number(current).toLocaleString()}</strong> → ${Number(target).toLocaleString()}</span>
          </div>
          <div style="display:flex;align-items:center;gap:0.75rem;">
            <div style="flex:1;">${{ toString: () => progressBarHtml(krProgress, progressColor(krProgress)) }}</div>
            <span style="font-size:0.8rem;font-weight:700;color:${progressColor(krProgress)};min-width:36px;text-align:right;">${krProgress.toFixed(0)}%</span>
          </div>
          ${(() => {
            const history = historyByKr.get(String(kr.id)) ?? [];
            if (history.length === 0) {
              return html`<div style="margin-top:0.5rem;font-size:0.72rem;color:var(--text-muted);">
                This value has not been changed since the key result was created.
              </div>`;
            }
            return html`<div style="margin-top:0.5rem;">
              ${history.slice(0, 5).map((u) => html`
                <div style="font-size:0.72rem;color:var(--text-muted);line-height:1.6;">
                  <span style="color:var(--text-dim);">${u.created_at.slice(0, 10)}</span>
                  &nbsp;${u.previous_value == null ? '—' : u.previous_value.toLocaleString()}
                  → <strong style="color:var(--text-dim);">${u.new_value.toLocaleString()}</strong>
                  &nbsp;by ${updateAuthor(u.source)}${u.note ? html` — ${u.note}` : ''}
                </div>`)}
              ${history.length > 5
                ? html`<div style="font-size:0.7rem;color:var(--text-muted);">and ${history.length - 5} earlier ${history.length - 5 === 1 ? 'change' : 'changes'}.</div>`
                : ''}
            </div>`;
          })()}
          <!-- Update form -->
          <details style="margin-top:0.75rem;">
            <summary style="cursor:pointer;font-size:0.75rem;color:var(--accent);font-weight:600;">Update progress</summary>
            <form method="POST" action="/agents/okr/${okr.id}/key-results/${kr.id}/update" style="margin-top:0.5rem;display:flex;gap:0.5rem;flex-wrap:wrap;align-items:flex-end;">
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
              <h3 style="margin:0;font-size:1.05rem;color:var(--text-primary);">${okr.objective_text ?? '(untitled)'}</h3>
              ${String(okr.objective_owner ?? 'founder') === 'founder'
                ? ''
                : html`<div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">Owned by ${String(okr.objective_owner)}</div>`}
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

  // NOTHING COULD CREATE AN OBJECTIVE.
  //
  // This page renders objectives, key results, progress bars, a quarter filter
  // and an update form — and until this form existed there was no way, anywhere
  // in the running system, to produce a row for it to render. `createOKR` lived
  // in `services/scp/okr.ts`, which nothing imported; `compass.ts` and
  // `forecasting/targets.ts` read `company_okrs` too, so agents were reasoning
  // about objectives that could not exist. The empty state said so, which was
  // honest, and left the feature hollow.
  //
  // The gate that says a table read by live code must have a live writer found
  // it the moment the unreachable module was deleted — it had been counting the
  // INSERT inside that module as a writer, because a text scanner cannot see
  // reachability. Deleting the module made the hollow half visible.
  const createForm = html`
    <details class="card" style="padding:1.25rem;margin-bottom:1rem;">
      <summary style="cursor:pointer;font-weight:600;font-size:0.9rem;color:var(--accent);">New objective</summary>
      <form method="POST" action="/agents/okr/create" style="margin-top:1rem;display:flex;flex-direction:column;gap:0.75rem;">
        <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
          <div style="flex:2;min-width:240px;">
            <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:2px;">Objective</label>
            <input type="text" name="objective" required placeholder="Reach 100 paying teams"
              style="width:100%;padding:6px 9px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:var(--text-primary);font-size:0.85rem;" />
          </div>
          <div style="min-width:120px;">
            <label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:2px;">Period</label>
            <input type="text" name="period" required placeholder="2026-Q4"
              style="width:130px;padding:6px 9px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:var(--text-primary);font-size:0.85rem;" />
          </div>
        </div>
        <div style="font-size:0.72rem;color:var(--text-muted);">Key results — at least one. An objective with nothing to measure is a wish, so a blank set is refused. Leave a row blank to skip it.</div>
        ${[0, 1, 2].map((i) => html`
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:flex-end;">
          <div style="flex:2;min-width:200px;">
            <input type="text" name="kr_description_${i}" placeholder="What you will measure"
              style="width:100%;padding:6px 9px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:var(--text-primary);font-size:0.82rem;" />
          </div>
          <div><input type="number" step="any" name="kr_start_${i}" placeholder="from"
            style="width:90px;padding:6px 9px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:var(--text-primary);font-size:0.82rem;" /></div>
          <div><input type="number" step="any" name="kr_target_${i}" placeholder="to"
            style="width:90px;padding:6px 9px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:var(--text-primary);font-size:0.82rem;" /></div>
          <div><input type="text" name="kr_unit_${i}" placeholder="unit"
            style="width:80px;padding:6px 9px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:var(--text-primary);font-size:0.82rem;" /></div>
        </div>`)}
        <div><button type="submit" class="btn btn-primary" style="font-size:0.82rem;">Create objective</button></div>
      </form>
    </details>
  `;

  const content = html`
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:0.5rem;">
      <h1 style="margin:0;">OKRs</h1>
      ${quarters.length > 1 ? html`
        <form method="GET" action="/agents/okr" style="display:flex;align-items:center;gap:0.5rem;">
          <select name="quarter" onchange="this.form.submit()"
            style="padding:0.4rem 0.75rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:var(--text-primary);font-size:0.82rem;">
            <option value="">All quarters</option>
            ${quarters.map((q) => html`<option value="${q}" ${q === quarter ? 'selected' : ''}>${q}</option>`)}
          </select>
        </form>
      ` : ''}
    </div>

    ${createForm}

    ${okrs.length === 0
      ? html`<div class="card" style="padding:3rem;text-align:center;color:var(--text-muted);font-size:0.9rem;">
          <div>No objectives here.</div>
          <div style="margin-top:0.5rem;font-size:0.82rem;">Add one above. Nothing in Foundry writes objectives for you — agents read them, and Compass and the forecasting targets reason about them, but you set them.</div>
        </div>`
      : okrCards}
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /okrs/:okrId/key-results/:krId/update ───────────────────────────────

// Setting the company's objectives is an owner act: it defines what the company
// is trying to do, and agents read it. A team member with `can_trigger_actions`
// may move a key result — that is reporting a number — but not decide what the
// company is aiming at.
agentsOkr.post('/agents/okr/create', requireOwner(), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'okrs', 'OKRs', undefined, c);
  if (!ctx.productId) return c.redirect('/agents/okr');

  const body = await c.req.parseBody();
  const objective = String(body.objective ?? '').trim();
  const period = String(body.period ?? '').trim();
  if (objective.length === 0 || period.length === 0) return c.redirect('/agents/okr');

  const krs: Array<{ description: string; start: number; target: number; unit: string | null }> = [];
  for (const i of [0, 1, 2]) {
    const description = String(body[`kr_description_${i}`] ?? '').trim();
    if (description.length === 0) continue;
    const start = parseFloat(String(body[`kr_start_${i}`] ?? ''));
    const target = parseFloat(String(body[`kr_target_${i}`] ?? ''));
    // No target, nothing to measure against. The row is dropped rather than
    // stored with a target of zero, which every key result would instantly meet.
    if (!Number.isFinite(target)) continue;
    const unit = String(body[`kr_unit_${i}`] ?? '').trim();
    krs.push({
      description,
      start: Number.isFinite(start) ? start : 0,
      target,
      unit: unit.length > 0 ? unit : null,
    });
  }
  // An objective with no key result is a wish. Refuse it rather than store a
  // card whose progress bar can never move.
  if (krs.length === 0) return c.redirect('/agents/okr');

  const okrId = nanoid();
  await query(
    `INSERT INTO company_okrs (id, product_id, period, objective_text, objective_owner, status)
     VALUES (?, ?, ?, ?, 'founder', 'on_track')`,
    [okrId, ctx.productId, period, objective]);

  for (const kr of krs) {
    await query(
      // `owner_agent` is documented as "agent name, or NULL for founder-owned".
      // Writing the string 'founder' into it would contradict the column's own
      // meaning and make every key result look agent-owned to a reader that
      // tested for non-null.
      `INSERT INTO key_results
         (id, okr_id, description, start_value, target_value, current_value, unit, owner_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      [nanoid(), okrId, kr.description, kr.start, kr.target, kr.start, kr.unit]);
  }

  return c.redirect(`/agents/okr?quarter=${encodeURIComponent(period)}`);
});

agentsOkr.post('/agents/okr/:okrId/key-results/:krId/update', async (c) => {
  const founder = c.get('founder');
  const okrId = c.req.param('okrId');
  const krId = c.req.param('krId');
  const body = await c.req.parseBody();
  const currentValue = parseFloat(body.current_value as string);
  const note = (body.note as string) ?? null;

  if (!Number.isFinite(currentValue)) {
    return c.redirect('/agents/okr');
  }

  // Ownership walk: the key result must belong to the named OKR, and the OKR
  // to a product this founder owns. Anything else is a silent no-op redirect.
  const krResult = await query(
    `SELECT kr.* FROM key_results kr
     JOIN company_okrs co ON co.id = kr.okr_id
     JOIN products p ON p.id = co.product_id
     WHERE kr.id=? AND kr.okr_id=? AND p.owner_id=?`,
    [krId, okrId, founder.id]
  );
  if (krResult.rows.length === 0) return c.redirect('/agents/okr');

  const kr = krResult.rows[0] as Record<string, unknown>;
  const previousValue = Number(kr.current_value ?? 0);

  // Record the progress update, then move the current value. Progress itself
  // is derived from (start, current, target) wherever it is displayed.
  await query(
    `INSERT INTO okr_progress_updates (id, key_result_id, previous_value, new_value, source, source_id, note)
     VALUES (?, ?, ?, ?, 'founder_manual', ?, ?)`,
    [nanoid(), krId, previousValue, currentValue, founder.id, note]
  );

  await query(
    `UPDATE key_results SET current_value=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [currentValue, krId]
  );

  return c.redirect(`/agents/okr`);
});
