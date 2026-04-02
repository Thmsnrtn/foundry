// =============================================================================
// FOUNDRY — Company Memory Graph & Decision Archaeology Routes
// Timeline of memory nodes, search, archaeology Q&A, node detail,
// sync from strategic decisions, and counterfactuals management.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import {
  getRecentNodes,
  searchMemory,
  getNode,
  getConnectedNodes,
  addMemoryNode,
  syncDecisionsToMemory,
} from '../../services/scp/memory/graph.js';
import type { MemoryNode } from '../../services/scp/memory/graph.js';
import {
  askAboutDecision,
  addCounterfactual,
  getCounterfactuals,
  getNodeForProduct,
} from '../../services/scp/memory/archaeology.js';
import { query } from '../../db/client.js';

export const memoryGraph = new Hono<AuthEnv>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nodeTypeBadgeStyle(type: MemoryNode['node_type']): string {
  const styles: Record<string, string> = {
    decision: 'background:#7c83fd22;color:#7c83fd;border:1px solid #7c83fd44;',
    outcome: 'background:#4ecca322;color:#4ecca3;border:1px solid #4ecca344;',
    context_snapshot: 'background:#ffb34722;color:#ffb347;border:1px solid #ffb34744;',
    hypothesis: 'background:#ab47bc22;color:#ab47bc;border:1px solid #ab47bc44;',
  };
  return styles[type] ?? 'background:rgba(255,255,255,0.06);color:var(--text-dim);border:1px solid rgba(255,255,255,0.1);';
}

function nodeTypeName(type: string): string {
  const map: Record<string, string> = {
    decision: 'Decision',
    outcome: 'Outcome',
    context_snapshot: 'Context',
    hypothesis: 'Hypothesis',
  };
  return map[type] ?? type;
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function fmtMonth(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function excerpt(text: string, max = 120): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + '…';
}

function confidenceBadge(level: 'high' | 'medium' | 'low'): string {
  const styles: Record<string, string> = {
    high: 'background:#4ecca322;color:#4ecca3;border:1px solid #4ecca344;',
    medium: 'background:#ffb34722;color:#ffb347;border:1px solid #ffb34744;',
    low: 'background:#ff6b6b22;color:#ff6b6b;border:1px solid #ff6b6b44;',
  };
  return styles[level] ?? '';
}

function regretDots(level: unknown): string {
  const n = Number(level) || 0;
  return Array.from({ length: 5 }, (_, i) =>
    `<span style="color:${i < n ? '#ff6b6b' : 'rgba(255,255,255,0.15)'}">●</span>`
  ).join('');
}

async function getEdgeCount(nodeId: string): Promise<number> {
  const r = await query(
    `SELECT COUNT(*) as cnt FROM memory_edges WHERE from_node_id = ? OR to_node_id = ?`,
    [nodeId, nodeId]
  );
  return Number((r.rows[0] as Record<string, number>)?.cnt ?? 0);
}

// ─── GET /memory ──────────────────────────────────────────────────────────────

memoryGraph.get('/memory', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'memory', 'Company Memory', undefined, c);

  if (!ctx.productId) {
    const content = html`
      <h1 style="margin:0 0 1rem;">Company Memory Graph</h1>
      <div class="card" style="padding:2rem;text-align:center;color:var(--text-muted);">No product selected.</div>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;
  const nodes = await getRecentNodes(productId, 30);

  // Group by month
  const grouped: Record<string, Array<MemoryNode & { edgeCount: number }>> = {};
  for (const node of nodes) {
    const month = fmtMonth(node.occurred_at);
    if (!grouped[month]) grouped[month] = [];
    const edgeCount = await getEdgeCount(node.id);
    grouped[month].push({ ...node, edgeCount });
  }

  const syncedCount = nodes.length;

  const content = html`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:.75rem;">
      <div>
        <h1 style="margin:0 0 .25rem;">Company Memory Graph</h1>
        <p style="margin:0;color:var(--text-muted);font-size:.875rem;">
          ${syncedCount} node${syncedCount !== 1 ? 's' : ''} in institutional memory.
        </p>
      </div>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;">
        <a href="/memory/search" class="btn btn-ghost btn-sm">Search</a>
        <a href="/memory/archaeology" class="btn btn-ghost btn-sm">Ask Memory</a>
        <a href="/memory/counterfactuals" class="btn btn-ghost btn-sm">Counterfactuals</a>
        <form method="POST" action="/memory/sync" style="display:inline;">
          <button type="submit" class="btn btn-primary btn-sm">Sync Decisions</button>
        </form>
      </div>
    </div>

    ${Object.keys(grouped).length === 0 ? html`
      <div class="card" style="padding:2rem;text-align:center;color:var(--text-muted);">
        No memory nodes yet.
        <form method="POST" action="/memory/sync" style="margin-top:1rem;">
          <button type="submit" class="btn btn-primary btn-sm">Sync from Strategic Decisions</button>
        </form>
      </div>
    ` : Object.entries(grouped).map(([month, monthNodes]) => html`
      <div style="margin-bottom:2rem;">
        <h3 style="margin:0 0 .75rem;font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);">${month}</h3>
        <div style="display:flex;flex-direction:column;gap:.5rem;">
          ${monthNodes.map(node => html`
            <div class="card" style="padding:1rem 1.25rem;display:flex;align-items:flex-start;gap:1rem;">
              <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.35rem;flex-wrap:wrap;">
                  <span style="font-size:.7rem;padding:.15rem .5rem;border-radius:4px;${nodeTypeBadgeStyle(node.node_type)}">
                    ${nodeTypeName(node.node_type)}
                  </span>
                  <span style="font-size:.75rem;color:var(--text-muted);">${fmtDate(node.occurred_at)}</span>
                  ${node.edgeCount > 0 ? html`<span style="font-size:.7rem;color:var(--text-dim);">${node.edgeCount} connection${node.edgeCount !== 1 ? 's' : ''}</span>` : ''}
                </div>
                <a href="/memory/node/${node.id}" style="font-weight:600;text-decoration:none;color:var(--text-primary);">${node.title}</a>
                <p style="margin:.25rem 0 0;font-size:.825rem;color:var(--text-muted);">${excerpt(node.content)}</p>
              </div>
            </div>
          `)}
        </div>
      </div>
    `)}
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── GET /memory/search ───────────────────────────────────────────────────────

memoryGraph.get('/memory/search', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'memory', 'Memory Search', undefined, c);
  const q = c.req.query('q') ?? '';

  let results: MemoryNode[] = [];
  if (ctx.productId && q) {
    results = await searchMemory(ctx.productId, q);
  }

  const content = html`
    <div style="margin-bottom:1.5rem;">
      <h1 style="margin:0 0 .5rem;">Search Memory</h1>
      <a href="/memory" style="font-size:.825rem;color:var(--text-muted);">← Timeline</a>
    </div>

    <form method="GET" action="/memory/search" style="margin-bottom:1.5rem;display:flex;gap:.5rem;">
      <input
        type="text"
        name="q"
        value="${q}"
        placeholder="Search decisions, outcomes, context…"
        class="form-control"
        style="flex:1;"
        autofocus
      />
      <button type="submit" class="btn btn-primary">Search</button>
    </form>

    ${q ? html`
      <p style="font-size:.825rem;color:var(--text-muted);margin-bottom:1rem;">
        ${results.length} result${results.length !== 1 ? 's' : ''} for "${q}"
      </p>
      ${results.length === 0 ? html`
        <div class="card" style="padding:2rem;text-align:center;color:var(--text-muted);">No matching nodes found.</div>
      ` : results.map(node => html`
        <div class="card" style="padding:1rem 1.25rem;margin-bottom:.5rem;">
          <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.35rem;flex-wrap:wrap;">
            <span style="font-size:.7rem;padding:.15rem .5rem;border-radius:4px;${nodeTypeBadgeStyle(node.node_type)}">
              ${nodeTypeName(node.node_type)}
            </span>
            <span style="font-size:.75rem;color:var(--text-muted);">${fmtDate(node.occurred_at)}</span>
          </div>
          <a href="/memory/node/${node.id}" style="font-weight:600;text-decoration:none;color:var(--text-primary);">${node.title}</a>
          <p style="margin:.25rem 0 0;font-size:.825rem;color:var(--text-muted);">${excerpt(node.content)}</p>
        </div>
      `)}
    ` : ''}
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── GET /memory/archaeology ──────────────────────────────────────────────────

memoryGraph.get('/memory/archaeology', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'memory', 'Ask Company Memory', undefined, c);

  const content = html`
    <div style="margin-bottom:1.5rem;">
      <h1 style="margin:0 0 .25rem;">Ask Your Company's Memory</h1>
      <p style="margin:0;color:var(--text-muted);font-size:.875rem;">
        Ask why decisions were made, what context existed, and what happened afterwards.
      </p>
      <a href="/memory" style="font-size:.825rem;color:var(--text-muted);">← Memory Timeline</a>
    </div>

    <div class="card" style="padding:1.5rem;margin-bottom:1.5rem;">
      <form method="POST" action="/memory/archaeology">
        <div style="margin-bottom:1rem;">
          <label style="font-size:.825rem;font-weight:600;display:block;margin-bottom:.5rem;">
            What do you want to know?
          </label>
          <textarea
            name="question"
            rows="4"
            class="form-control"
            style="width:100%;resize:vertical;"
            placeholder="e.g. Why did we pivot to enterprise? What were the assumptions behind our pricing decision? What stressors led to the Q3 hiring freeze?"
            required
          ></textarea>
        </div>
        <button type="submit" class="btn btn-primary">Ask Memory</button>
      </form>
    </div>

    <div class="card" style="padding:1.25rem;background:rgba(255,255,255,0.02);">
      <p style="margin:0 0 .5rem;font-size:.8rem;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em;">
        Example questions
      </p>
      <ul style="margin:0;padding-left:1.25rem;color:var(--text-muted);font-size:.825rem;">
        <li>Why did we change our pricing model?</li>
        <li>What context existed when we decided to hire a head of sales?</li>
        <li>What were the key assumptions behind our go-to-market strategy?</li>
        <li>What stressors were active when we paused the enterprise pilot?</li>
      </ul>
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /memory/archaeology ─────────────────────────────────────────────────

memoryGraph.post('/memory/archaeology', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'memory', 'Ask Company Memory', undefined, c);
  const body = await c.req.parseBody();
  const question = (body.question as string ?? '').trim();

  if (!question || !ctx.productId) {
    return c.redirect('/memory/archaeology');
  }

  const result = await askAboutDecision(ctx.productId, question);

  const content = html`
    <div style="margin-bottom:1.5rem;">
      <h1 style="margin:0 0 .25rem;">Ask Your Company's Memory</h1>
      <a href="/memory/archaeology" style="font-size:.825rem;color:var(--text-muted);">← Ask another question</a>
    </div>

    <div class="card" style="padding:1.25rem 1.5rem;margin-bottom:1rem;border-left:3px solid #7c83fd;">
      <p style="margin:0;font-size:.825rem;color:var(--text-muted);">Question</p>
      <p style="margin:.25rem 0 0;font-weight:600;">${question}</p>
    </div>

    <div class="card" style="padding:1.5rem;margin-bottom:1rem;">
      <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:1rem;">
        <span style="font-size:.875rem;font-weight:600;">Answer</span>
        <span style="font-size:.7rem;padding:.15rem .5rem;border-radius:4px;${confidenceBadge(result.confidence)}">
          ${result.confidence} confidence
        </span>
      </div>
      <div style="font-size:.9rem;line-height:1.6;white-space:pre-wrap;color:var(--text-primary);">${result.answer}</div>
    </div>

    ${result.suggestedFollowUps.length > 0 ? html`
      <div class="card" style="padding:1.25rem;margin-bottom:1rem;">
        <p style="margin:0 0 .5rem;font-size:.8rem;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em;">
          Suggested follow-ups
        </p>
        ${result.suggestedFollowUps.map(fu => html`
          <form method="POST" action="/memory/archaeology" style="margin-top:.5rem;">
            <input type="hidden" name="question" value="${fu}" />
            <button type="submit" class="btn btn-ghost btn-sm" style="text-align:left;width:100%;">${fu}</button>
          </form>
        `)}
      </div>
    ` : ''}

    ${result.relevantNodes.length > 0 ? html`
      <div style="margin-top:1.5rem;">
        <p style="font-size:.8rem;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.75rem;">
          Source nodes (${result.relevantNodes.length})
        </p>
        ${result.relevantNodes.map(node => html`
          <div class="card" style="padding:1rem 1.25rem;margin-bottom:.5rem;display:flex;align-items:flex-start;gap:1rem;">
            <div style="flex:1;min-width:0;">
              <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.25rem;flex-wrap:wrap;">
                <span style="font-size:.7rem;padding:.15rem .5rem;border-radius:4px;${nodeTypeBadgeStyle(node.node_type)}">
                  ${nodeTypeName(node.node_type)}
                </span>
                <span style="font-size:.75rem;color:var(--text-muted);">${fmtDate(node.occurred_at)}</span>
              </div>
              <a href="/memory/node/${node.id}" style="font-weight:600;text-decoration:none;color:var(--text-primary);">${node.title}</a>
            </div>
          </div>
        `)}
      </div>
    ` : ''}
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── GET /memory/node/:id ─────────────────────────────────────────────────────

memoryGraph.get('/memory/node/:id', async (c) => {
  const founder = c.get('founder');
  const nodeId = c.req.param('id');
  const ctx = await getLayoutContext(founder, 'memory', 'Memory Node', undefined, c);

  if (!ctx.productId) return c.redirect('/memory');

  const node = await getNodeForProduct(ctx.productId, nodeId);
  if (!node) return c.notFound();

  const { nodes: connectedNodes, edges } = await getConnectedNodes(nodeId, 2);
  const otherNodes = connectedNodes.filter(n => n.id !== nodeId);

  // Fetch counterfactuals for this node
  const cfResult = await query(
    `SELECT * FROM decision_counterfactuals WHERE memory_node_id = ? ORDER BY noted_at DESC`,
    [nodeId]
  );
  const counterfactuals = cfResult.rows as Array<Record<string, unknown>>;

  const content = html`
    <div style="margin-bottom:1.5rem;">
      <a href="/memory" style="font-size:.825rem;color:var(--text-muted);">← Memory Timeline</a>
    </div>

    <div class="card" style="padding:1.5rem;margin-bottom:1rem;">
      <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.75rem;flex-wrap:wrap;">
        <span style="font-size:.75rem;padding:.2rem .6rem;border-radius:4px;${nodeTypeBadgeStyle(node.node_type)}">
          ${nodeTypeName(node.node_type)}
        </span>
        <span style="font-size:.8rem;color:var(--text-muted);">${fmtDate(node.occurred_at)}</span>
        ${node.source_type ? html`<span style="font-size:.75rem;color:var(--text-dim);">via ${node.source_type}</span>` : ''}
      </div>

      <h2 style="margin:0 0 1rem;">${node.title}</h2>
      <div style="font-size:.9rem;line-height:1.7;white-space:pre-wrap;color:var(--text-primary);">${node.content}</div>

      ${Object.keys(node.metadata).length > 0 ? html`
        <details style="margin-top:1rem;">
          <summary style="font-size:.8rem;color:var(--text-muted);cursor:pointer;">Metadata</summary>
          <pre style="font-size:.75rem;color:var(--text-dim);margin:.5rem 0 0;overflow:auto;">${JSON.stringify(node.metadata, null, 2)}</pre>
        </details>
      ` : ''}
    </div>

    ${otherNodes.length > 0 ? html`
      <div style="margin-bottom:1rem;">
        <p style="font-size:.8rem;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.75rem;">
          Connected nodes (${otherNodes.length})
        </p>
        ${otherNodes.map(cn => {
          const edgesForNode = edges.filter(
            e => (e.from_node_id === nodeId && e.to_node_id === cn.id) ||
                 (e.to_node_id === nodeId && e.from_node_id === cn.id)
          );
          const edgeType = edgesForNode[0]?.edge_type ?? '';
          return html`
            <div class="card" style="padding:1rem 1.25rem;margin-bottom:.5rem;display:flex;align-items:center;gap:.75rem;">
              <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.2rem;flex-wrap:wrap;">
                  <span style="font-size:.7rem;padding:.15rem .5rem;border-radius:4px;${nodeTypeBadgeStyle(cn.node_type)}">
                    ${nodeTypeName(cn.node_type)}
                  </span>
                  ${edgeType ? html`<span style="font-size:.7rem;color:var(--text-dim);">→ ${edgeType}</span>` : ''}
                  <span style="font-size:.75rem;color:var(--text-muted);">${fmtDate(cn.occurred_at)}</span>
                </div>
                <a href="/memory/node/${cn.id}" style="font-weight:600;text-decoration:none;color:var(--text-primary);">${cn.title}</a>
              </div>
            </div>
          `;
        })}
      </div>
    ` : ''}

    <div style="margin-bottom:1rem;">
      <p style="font-size:.8rem;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.75rem;">
        Counterfactuals
      </p>

      ${counterfactuals.map(cf => html`
        <div class="card" style="padding:1.25rem;margin-bottom:.5rem;border-left:3px solid #ff6b6b44;">
          <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:.5rem;">
            Regret: ${regretDots(cf.regret_level)} &nbsp; ${fmtDate(cf.noted_at as string)}
          </div>
          <p style="margin:0 0 .35rem;font-size:.85rem;"><strong>Decided:</strong> ${cf.what_we_decided as string}</p>
          <p style="margin:0 0 .35rem;font-size:.85rem;"><strong>Could have done:</strong> ${cf.what_we_couldve_done as string}</p>
          ${cf.outcome_if_different ? html`<p style="margin:0;font-size:.85rem;"><strong>If different:</strong> ${cf.outcome_if_different as string}</p>` : ''}
        </div>
      `)}

      <details style="margin-top:.75rem;">
        <summary class="btn btn-ghost btn-sm" style="cursor:pointer;list-style:none;">+ Add counterfactual</summary>
        <div class="card" style="padding:1.25rem;margin-top:.5rem;">
          <form method="POST" action="/memory/counterfactuals">
            <input type="hidden" name="node_id" value="${nodeId}" />
            <div style="margin-bottom:.75rem;">
              <label style="font-size:.8rem;font-weight:600;display:block;margin-bottom:.35rem;">What we decided</label>
              <input type="text" name="what_we_decided" class="form-control" style="width:100%;" required />
            </div>
            <div style="margin-bottom:.75rem;">
              <label style="font-size:.8rem;font-weight:600;display:block;margin-bottom:.35rem;">What we could've done instead</label>
              <input type="text" name="what_we_couldve_done" class="form-control" style="width:100%;" required />
            </div>
            <div style="margin-bottom:.75rem;">
              <label style="font-size:.8rem;font-weight:600;display:block;margin-bottom:.35rem;">Outcome if different (optional)</label>
              <input type="text" name="outcome_if_different" class="form-control" style="width:100%;" />
            </div>
            <div style="margin-bottom:.75rem;">
              <label style="font-size:.8rem;font-weight:600;display:block;margin-bottom:.35rem;">Regret level (1–5)</label>
              <input type="number" name="regret_level" min="1" max="5" class="form-control" style="width:6rem;" />
            </div>
            <button type="submit" class="btn btn-primary btn-sm">Save</button>
          </form>
        </div>
      </details>
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /memory/sync ────────────────────────────────────────────────────────

memoryGraph.post('/memory/sync', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'memory', 'Memory Sync', undefined, c);

  if (!ctx.productId) return c.redirect('/memory');

  const count = await syncDecisionsToMemory(ctx.productId);
  return c.redirect(`/memory?synced=${count}`);
});

// ─── GET /memory/counterfactuals ──────────────────────────────────────────────

memoryGraph.get('/memory/counterfactuals', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'memory', 'Counterfactuals', undefined, c);

  if (!ctx.productId) {
    const content = html`
      <h1 style="margin:0 0 1rem;">Counterfactuals</h1>
      <div class="card" style="padding:2rem;text-align:center;color:var(--text-muted);">No product selected.</div>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const items = await getCounterfactuals(ctx.productId);

  const content = html`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:.75rem;">
      <div>
        <h1 style="margin:0 0 .25rem;">Counterfactuals</h1>
        <p style="margin:0;color:var(--text-muted);font-size:.875rem;">
          What we'd do differently — and why.
        </p>
      </div>
      <a href="/memory" style="font-size:.825rem;color:var(--text-muted);">← Memory Timeline</a>
    </div>

    ${items.length === 0 ? html`
      <div class="card" style="padding:2rem;text-align:center;color:var(--text-muted);">
        No counterfactuals recorded yet.
        Open any memory node to add one.
      </div>
    ` : items.map(({ node, counterfactual: cf }) => html`
      <div class="card" style="padding:1.25rem;margin-bottom:.75rem;border-left:3px solid #ff6b6b44;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem;flex-wrap:wrap;margin-bottom:.5rem;">
          <a href="/memory/node/${node.id}" style="font-weight:600;text-decoration:none;color:var(--text-primary);">${node.title}</a>
          <div style="font-size:.8rem;color:var(--text-muted);white-space:nowrap;">
            ${regretDots(cf.regret_level)}
          </div>
        </div>
        <div style="display:flex;gap:.5rem;margin-bottom:.5rem;flex-wrap:wrap;">
          <span style="font-size:.7rem;padding:.15rem .5rem;border-radius:4px;${nodeTypeBadgeStyle(node.node_type)}">
            ${nodeTypeName(node.node_type)}
          </span>
          <span style="font-size:.75rem;color:var(--text-muted);">${fmtDate(node.occurred_at)}</span>
        </div>
        <p style="margin:0 0 .3rem;font-size:.85rem;"><strong>Decided:</strong> ${cf.what_we_decided as string}</p>
        <p style="margin:0 0 .3rem;font-size:.85rem;"><strong>Could've done:</strong> ${cf.what_we_couldve_done as string}</p>
        ${cf.outcome_if_different ? html`<p style="margin:0;font-size:.85rem;"><strong>If different:</strong> ${cf.outcome_if_different as string}</p>` : ''}
      </div>
    `)}
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /memory/counterfactuals ─────────────────────────────────────────────

memoryGraph.post('/memory/counterfactuals', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'memory', 'Counterfactuals', undefined, c);

  if (!ctx.productId) return c.redirect('/memory');

  const body = await c.req.parseBody();
  const nodeId = (body.node_id as string ?? '').trim();
  const whatDecided = (body.what_we_decided as string ?? '').trim();
  const whatCould = (body.what_we_couldve_done as string ?? '').trim();
  const outcomeIfDiff = (body.outcome_if_different as string ?? '').trim() || undefined;
  const regretLevelRaw = Number(body.regret_level);
  const regretLevel = regretLevelRaw >= 1 && regretLevelRaw <= 5 ? regretLevelRaw : undefined;

  if (!nodeId || !whatDecided || !whatCould) {
    return c.redirect('/memory/counterfactuals');
  }

  // Verify the node belongs to this product
  const node = await getNodeForProduct(ctx.productId, nodeId);
  if (!node) return c.redirect('/memory/counterfactuals');

  await addCounterfactual(ctx.productId, nodeId, {
    what_we_decided: whatDecided,
    what_we_couldve_done: whatCould,
    outcome_if_different: outcomeIfDiff,
    regret_level: regretLevel,
  });

  return c.redirect(`/memory/node/${nodeId}`);
});
