// =============================================================================
// FOUNDRY — Agents Wiki
// Browse the knowledge base built by agents (company wiki).
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import { nanoid } from 'nanoid';
import type { AuthEnv } from '../../middleware/auth.js';
import { query } from '../../db/client.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';

export const agentsWiki = new Hono<AuthEnv>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WIKI_CATEGORIES = ['strategy', 'product', 'technical', 'process', 'market', 'customer'];

function categoryBadgeStyle(category: string): string {
  const styles: Record<string, string> = {
    strategy: 'background:#4ecca322;color:#4ecca3;border:1px solid #4ecca344;',
    product: 'background:#7c83fd22;color:#7c83fd;border:1px solid #7c83fd44;',
    technical: 'background:#64b5f622;color:#64b5f6;border:1px solid #64b5f644;',
    process: 'background:#ffb34722;color:#ffb347;border:1px solid #ffb34744;',
    market: 'background:#ff6b6b22;color:#ff6b6b;border:1px solid #ff6b6b44;',
    customer: 'background:#ab47bc22;color:#ab47bc;border:1px solid #ab47bc44;',
  };
  return styles[category] ?? 'background:rgba(255,255,255,0.06);color:var(--text-dim);border:1px solid rgba(255,255,255,0.1);';
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function confidencePct(score: unknown): string {
  const n = typeof score === 'number' ? score : parseFloat(String(score ?? '0'));
  if (isNaN(n)) return '—';
  // Assume 0-1 range; if > 1 treat as percentage already
  return n <= 1 ? `${Math.round(n * 100)}%` : `${Math.round(n)}%`;
}

// ─── GET /wiki ─────────────────────────────────────────────────────────────────

agentsWiki.get('/wiki', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'wiki', 'Agents Wiki', undefined, c);

  if (!ctx.productId) {
    const content = html`
      <h1 style="margin:0 0 1rem;">Agents Wiki</h1>
      <div class="card" style="padding:2rem;text-align:center;color:var(--text-muted);">No product selected.</div>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;
  const category = c.req.query('category') ?? '';
  const q = c.req.query('q') ?? '';

  let sql = `SELECT awe.*, COUNT(awr.id) as read_count
    FROM agent_wiki_entries awe
    LEFT JOIN agent_wiki_reads awr ON awr.entry_id = awe.id
    WHERE awe.product_id=?`;
  const params: unknown[] = [productId];

  if (category) {
    sql += ` AND awe.category=?`;
    params.push(category);
  }
  if (q) {
    sql += ` AND (awe.title LIKE ? OR awe.content LIKE ?)`;
    params.push(`%${q}%`, `%${q}%`);
  }

  sql += ` GROUP BY awe.id ORDER BY awe.updated_at DESC LIMIT 50`;

  const result = await query(sql, params);
  const entries = result.rows as Array<Record<string, unknown>>;

  const catTabStyle = (cat: string) => cat === category
    ? 'padding:0.5rem 0.9rem;border-radius:6px;background:rgba(255,255,255,0.1);color:var(--text-primary);font-weight:600;font-size:0.8rem;text-decoration:none;'
    : 'padding:0.5rem 0.9rem;border-radius:6px;color:var(--text-dim);font-size:0.8rem;text-decoration:none;';

  const entryCards = entries.map((e) => html`
    <a href="/wiki/${e.id}" style="display:block;text-decoration:none;color:inherit;">
      <div class="card" style="padding:1.1rem 1.25rem;margin-bottom:0.75rem;transition:background 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.04)'" onmouseout="this.style.background=''">
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;flex-wrap:wrap;">
          <span style="font-size:0.7rem;padding:2px 8px;border-radius:99px;${categoryBadgeStyle(e.category as string)}">${e.category ?? 'general'}</span>
          <span style="font-size:0.75rem;color:var(--text-muted);">Confidence: <strong style="color:var(--text-dim);">${confidencePct(e.confidence_score)}</strong></span>
          <span style="font-size:0.72rem;color:var(--text-muted);margin-left:auto;">${fmtDate(e.updated_at as string)}</span>
        </div>
        <div style="font-size:0.95rem;font-weight:600;color:var(--text-primary);margin-bottom:0.3rem;">${e.title}</div>
        <div style="display:flex;align-items:center;gap:0.75rem;font-size:0.75rem;color:var(--text-muted);">
          <span>By ${e.created_by ?? 'Agent'}</span>
          ${(e.read_count as number) > 0 ? html`<span>${e.read_count} reads</span>` : ''}
        </div>
      </div>
    </a>
  `);

  const content = html`
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1.5rem;">
      <h1 style="margin:0;">Agents Wiki</h1>
      <span style="font-size:0.82rem;color:var(--text-muted);">${entries.length} entries</span>
    </div>

    <!-- Search -->
    <form method="GET" action="/wiki" style="margin-bottom:1.25rem;">
      ${category ? html`<input type="hidden" name="category" value="${category}" />` : ''}
      <div style="display:flex;gap:0.5rem;">
        <input type="text" name="q" value="${q}" placeholder="Search wiki entries…"
          style="flex:1;padding:0.6rem 0.875rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--text-primary);font-size:0.87rem;" />
        <button type="submit" class="btn btn-ghost" style="font-size:0.85rem;">Search</button>
        ${q ? html`<a href="/wiki${category ? `?category=${category}` : ''}" class="btn btn-ghost" style="font-size:0.85rem;">Clear</a>` : ''}
      </div>
    </form>

    <!-- Category filter tabs -->
    <div style="display:flex;gap:0.25rem;flex-wrap:wrap;margin-bottom:1.25rem;padding:0.25rem;background:rgba(255,255,255,0.03);border-radius:8px;">
      <a href="/wiki${q ? `?q=${encodeURIComponent(q)}` : ''}" style="${catTabStyle('')}">All</a>
      ${WIKI_CATEGORIES.map((cat) => html`
        <a href="/wiki?category=${cat}${q ? `&q=${encodeURIComponent(q)}` : ''}" style="${catTabStyle(cat)}">${cat.charAt(0).toUpperCase() + cat.slice(1)}</a>
      `)}
    </div>

    <!-- Entries -->
    ${entries.length === 0
      ? html`<div class="card" style="padding:3rem;text-align:center;color:var(--text-muted);font-size:0.9rem;">No wiki entries found${q ? ` for "${q}"` : ''}${category ? ` in ${category}` : ''}. Agents will populate this as they run.</div>`
      : entryCards}
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── GET /wiki/:id ─────────────────────────────────────────────────────────────

agentsWiki.get('/wiki/:id', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'wiki', 'Wiki Entry', undefined, c);
  const entryId = c.req.param('id');

  if (!ctx.productId) return c.redirect('/wiki');

  const result = await query(
    `SELECT * FROM agent_wiki_entries WHERE id=? AND product_id=?`,
    [entryId, ctx.productId]
  );

  if (result.rows.length === 0) return c.redirect('/wiki');

  const entry = result.rows[0] as Record<string, unknown>;

  // Record a read
  await query(
    `INSERT INTO agent_wiki_reads (id, entry_id, agent_name, read_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT DO NOTHING`,
    [nanoid(), entryId, founder.id]
  ).catch(() => {});

  const content = html`
    <div style="margin-bottom:1.5rem;">
      <a href="/wiki" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Wiki</a>
    </div>

    <div class="card" style="padding:1.75rem;">
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem;flex-wrap:wrap;">
        <span style="font-size:0.7rem;padding:2px 8px;border-radius:99px;${categoryBadgeStyle(entry.category as string)}">${entry.category ?? 'general'}</span>
        <span style="font-size:0.75rem;color:var(--text-muted);">Confidence: <strong>${confidencePct(entry.confidence_score)}</strong></span>
        <span style="font-size:0.72rem;color:var(--text-muted);margin-left:auto;">Updated ${fmtDate(entry.updated_at as string)}</span>
      </div>

      <h1 style="margin:0 0 0.5rem;font-size:1.5rem;">${entry.title}</h1>
      <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:1.5rem;">Created by ${entry.created_by ?? 'Agent'}</div>

      <div style="font-size:0.9rem;color:var(--text-dim);line-height:1.7;white-space:pre-wrap;">${entry.content}</div>

      ${entry.sources ? html`
        <div style="margin-top:1.5rem;padding-top:1.25rem;border-top:1px solid rgba(255,255,255,0.07);">
          <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.5rem;">Sources</div>
          <div style="font-size:0.82rem;color:var(--text-dim);">${entry.sources}</div>
        </div>
      ` : ''}
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});
