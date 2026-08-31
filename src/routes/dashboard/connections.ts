// =============================================================================
// FOUNDRY — Connections (Hands Law / Constitution Law 10)
//
// The founder shapes the system's hands. Any MCP server is a connector: paste
// a URL, its tools become REACHABLE. Reach is never license — every tool needs
// a founder-issued grant (scoped, capped, expiring, revocable), and every call
// flows the outbound gateway (idempotent, audited, kill-switchable). This page
// is the whole story in one place: what is connected, what Foundry MAY do with
// it, what it HAS done with it, and the controls to change any of that.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import { nanoid } from 'nanoid';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import { query } from '../../db/client.js';
import { encryptToken } from '../../lib/crypto.js';
import { issueGrant, revokeGrant } from '../../services/integration/mcp-client.js';
import { getCap, getUsage, setCap } from '../../services/outbound/envelopes.js';
import { getFluency, explain } from '../../services/ux/fluency.js';
import { requireCompanyCapability } from '../../middleware/rbac.js';

export const connectionRoutes = new Hono<AuthEnv>();

const SERVER_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

// Add-time screen (fast, no DNS). The authoritative guard runs at CALL time
// in the MCP handler (assertUrlSafe, with rebinding defense) — this just
// rejects obviously-bad URLs before they're stored.
async function urlAllowed(u: string): Promise<boolean> {
  try {
    const { assertUrlSafe } = await import('../../services/outbound/ssrf.js');
    await assertUrlSafe(u, { allowLoopback: true });
    return true;
  } catch { return false; }
}

const INPUT_STYLE = 'width:100%;padding:0.5rem 0.75rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:var(--text-primary);font-size:0.85rem;';
const LABEL_STYLE = 'display:block;font-size:0.75rem;color:var(--text-muted);margin-bottom:0.25rem;';

connectionRoutes.get('/connections', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'connections', 'Connections', undefined, c);
  if (!ctx.productId) return c.redirect('/dashboard');
  const fluency = getFluency(founder);

  const [servers, grants, recentCalls] = await Promise.all([
    query(
      `SELECT name, config, status, created_at FROM integrations
       WHERE product_id = ? AND provider = 'mcp' AND status = 'active' ORDER BY created_at DESC`,
      [ctx.productId],
    ),
    query(
      `SELECT id, server_name, tool_pattern, max_calls, calls_used, expires_at FROM mcp_grants
       WHERE product_id = ? AND revoked_at IS NULL AND expires_at > datetime('now')
       ORDER BY created_at DESC`,
      [ctx.productId],
    ),
    query(
      `SELECT input_context, outcome, created_at FROM audit_log
       WHERE product_id = ? AND action_type = 'gateway:mcp_tool'
       ORDER BY created_at DESC LIMIT 12`,
      [ctx.productId],
    ),
  ]);

  const grantsByServer = new Map<string, Array<Record<string, unknown>>>();
  for (const g of grants.rows as unknown as Array<Record<string, unknown>>) {
    const key = String(g.server_name);
    if (!grantsByServer.has(key)) grantsByServer.set(key, []);
    grantsByServer.get(key)!.push(g);
  }

  const serverList = servers.rows as unknown as Array<Record<string, string>>;
  const envelopes = await Promise.all(serverList.map(async (s) => ({
    cap: await getCap(ctx.productId!, `mcp:${s.name}`),
    used: await getUsage(ctx.productId!, `mcp:${s.name}`),
  })));

  const serverCards = serverList.map((s, i) => {
    let url = '';
    try { url = (JSON.parse(s.config ?? '{}') as { url?: string }).url ?? ''; } catch { /* show blank */ }
    const serverGrants = grantsByServer.get(s.name) ?? [];
    const env = envelopes[i];
    return html`
    <div class="card" style="padding:1.1rem 1.25rem;margin-bottom:0.9rem;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;">
        <div>
          <span style="font-weight:600;color:var(--text-primary);">${s.name}</span>
          <span style="font-size:0.75rem;color:var(--text-muted);margin-left:0.5rem;">${url}</span>
        </div>
        <form method="POST" action="/connections/${s.name}/disconnect"
          onsubmit="return confirm('Disconnect ${s.name}? Its grants stop working immediately.')">
          <button type="submit" class="btn btn-ghost" style="font-size:0.75rem;padding:0.25rem 0.6rem;">Disconnect</button>
        </form>
      </div>

      <div style="margin-top:0.75rem;">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.4rem;">
          ${fluency === 'technical' ? 'Live grants' : 'What Foundry may do with this'}
        </div>
        ${serverGrants.length === 0 ? html`
          <div style="font-size:0.82rem;color:var(--text-muted);">Nothing yet — Foundry can see this tool but may not use it until you allow something below.</div>
        ` : serverGrants.map((g) => html`
          <div style="display:flex;align-items:center;gap:0.6rem;font-size:0.82rem;color:var(--text-primary);padding:0.3rem 0;border-top:1px solid rgba(255,255,255,0.05);flex-wrap:wrap;">
            <code style="font-size:0.8rem;">${String(g.tool_pattern) === '*' ? (fluency === 'technical' ? '*' : 'any tool') : String(g.tool_pattern)}</code>
            <span style="color:var(--text-muted);">${g.calls_used}/${g.max_calls} calls used · expires ${String(g.expires_at).slice(0, 10)}</span>
            <form method="POST" action="/connections/grants/${g.id}/revoke" style="margin-left:auto;">
              <button type="submit" class="btn btn-ghost" style="font-size:0.72rem;padding:0.15rem 0.5rem;">Revoke</button>
            </form>
          </div>`)}

        <form method="POST" action="/connections/grant" style="display:flex;gap:0.5rem;margin-top:0.6rem;flex-wrap:wrap;align-items:end;">
          <input type="hidden" name="server_name" value="${s.name}" />
          <div style="flex:2;min-width:140px;">
            <label style="${LABEL_STYLE}">${fluency === 'technical' ? 'Tool pattern' : 'Which tool (or * for any)'}</label>
            <input type="text" name="tool_pattern" placeholder="e.g. send_email or *" required style="${INPUT_STYLE}" />
          </div>
          <div style="flex:1;min-width:80px;">
            <label style="${LABEL_STYLE}">Max calls</label>
            <input type="number" name="max_calls" value="25" min="1" max="10000" style="${INPUT_STYLE}" />
          </div>
          <div style="flex:1;min-width:80px;">
            <label style="${LABEL_STYLE}">Days valid</label>
            <input type="number" name="expires_days" value="30" min="1" max="365" style="${INPUT_STYLE}" />
          </div>
          <button type="submit" class="btn btn-secondary" style="font-size:0.8rem;">Allow</button>
        </form>

        <form method="POST" action="/connections/envelope" style="display:flex;gap:0.5rem;margin-top:0.75rem;align-items:center;flex-wrap:wrap;border-top:1px solid rgba(255,255,255,0.05);padding-top:0.6rem;">
          <input type="hidden" name="server_name" value="${s.name}" />
          <span style="font-size:0.78rem;color:var(--text-muted);">
            ${fluency === 'technical' ? 'Weekly envelope' : 'Weekly limit, no matter what'}:
            <strong style="color:var(--text-primary);">${env.used}/${env.cap}</strong> used this week
          </span>
          <input type="number" name="weekly_cap" value="${env.cap}" min="0" max="100000"
            style="width:90px;padding:0.3rem 0.5rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:var(--text-primary);font-size:0.8rem;" />
          <button type="submit" class="btn btn-ghost" style="font-size:0.75rem;padding:0.25rem 0.6rem;">Set</button>
        </form>
      </div>
    </div>`;
  });

  const auditRows = (recentCalls.rows as unknown as Array<Record<string, string>>).map((r) => {
    let action = '';
    try { action = (JSON.parse(r.input_context ?? '{}') as { action?: string }).action ?? ''; } catch { /* leave blank */ }
    const color = r.outcome === 'allowed' || r.outcome === 'cached' ? 'var(--accent)' : '#ff6b6b';
    return html`
      <div style="display:flex;gap:0.75rem;font-size:0.8rem;padding:0.35rem 0;border-top:1px solid rgba(255,255,255,0.05);">
        <span style="color:${color};min-width:60px;">${r.outcome}</span>
        <span style="color:var(--text-primary);flex:1;">${action}</span>
        <span style="color:var(--text-muted);">${String(r.created_at).slice(0, 16)}</span>
      </div>`;
  });

  const content = html`
    <h1 style="margin-bottom:0.25rem;">Connections</h1>
    <p style="color:var(--text-dim);font-size:0.85rem;margin-bottom:1.5rem;max-width:720px;">
      ${explain('connections', fluency) || 'Connect any MCP server; issue tool-scoped, call-capped, expiring grants. Every call routes the gateway: idempotent, audited, kill-switchable. Reach is never license.'}
    </p>

    ${servers.rows.length === 0 ? html`
      <div class="card" style="padding:1.25rem;margin-bottom:1rem;color:var(--text-muted);font-size:0.88rem;">
        Nothing connected yet. Add your first tool below — anything that speaks MCP works.
      </div>` : serverCards}

    <div class="card" style="padding:1.1rem 1.25rem;margin-bottom:1.5rem;">
      <div style="font-weight:600;color:var(--text-primary);margin-bottom:0.6rem;">Connect a new tool</div>
      <form method="POST" action="/connections/add" style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:end;">
        <div style="flex:1;min-width:120px;">
          <label style="${LABEL_STYLE}">Name</label>
          <input type="text" name="name" placeholder="e.g. my-crm" required pattern="[a-z0-9][a-z0-9_-]*" style="${INPUT_STYLE}" />
        </div>
        <div style="flex:2;min-width:200px;">
          <label style="${LABEL_STYLE}">${fluency === 'technical' ? 'MCP server URL' : 'Tool server address (MCP)'}</label>
          <input type="url" name="url" placeholder="https://…" required style="${INPUT_STYLE}" />
        </div>
        <div style="flex:2;min-width:160px;">
          <label style="${LABEL_STYLE}">Access token (optional)</label>
          <input type="password" name="token" placeholder="stored encrypted" style="${INPUT_STYLE}" />
        </div>
        <button type="submit" class="btn btn-primary" style="font-size:0.85rem;">Connect</button>
      </form>
      <p style="font-size:0.75rem;color:var(--text-muted);margin:0.6rem 0 0;">
        Connecting only makes the tool visible. Foundry can't use it until you allow specific tools on it — and you can revoke that anytime.
      </p>
    </div>

    <div class="card" style="padding:1.1rem 1.25rem;margin-bottom:1.5rem;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.4rem;">
        ${fluency === 'technical' ? 'Gateway audit — mcp_tool' : 'What Foundry has done with your tools'}
      </div>
      ${auditRows.length === 0
        ? html`<div style="font-size:0.82rem;color:var(--text-muted);">No calls yet. Every use of a connected tool will show here — nothing happens off the record.</div>`
        : auditRows}
    </div>

    <p style="font-size:0.8rem;color:var(--text-muted);">
      Looking for the built-in connections (Stripe, analytics, GitHub, Slack…)?
      They live on <a href="/integrations" style="color:var(--accent);">Integrations</a> — same rules, pre-wired.
    </p>`;
  return c.html(dashboardLayout(ctx, content));
});

// Stores a credential for the company. Revoking and disconnecting stay open
// — those only ever remove reach.
connectionRoutes.post('/connections/add',
  requireCompanyCapability('can_manage_company'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'connections', 'Connections', undefined, c);
  if (!ctx.productId) return c.redirect('/dashboard');

  const body = await c.req.parseBody();
  const name = String(body.name ?? '').trim().toLowerCase();
  const url = String(body.url ?? '').trim();
  const token = String(body.token ?? '').trim();
  if (!SERVER_NAME_RE.test(name) || !(await urlAllowed(url))) return c.redirect('/connections');

  const existing = await query(
    `SELECT id FROM integrations WHERE product_id = ? AND provider = 'mcp' AND name = ?`,
    [ctx.productId, name],
  );
  const credentials = token ? encryptToken(token) : null;
  const config = JSON.stringify({ url });
  if (existing.rows.length > 0) {
    await query(
      `UPDATE integrations SET config = ?, credentials = COALESCE(?, credentials), status = 'active',
       updated_at = CURRENT_TIMESTAMP WHERE product_id = ? AND provider = 'mcp' AND name = ?`,
      [config, credentials, ctx.productId, name],
    );
  } else {
    await query(
      // An MCP server is something Foundry CALLS. It has always been outbound;
      // that fact was in `type`, which two other writers use for a provider key.
      `INSERT INTO integrations (id, product_id, owner_id, name, provider, direction, status, credentials, config)
       VALUES (?, ?, ?, ?, 'mcp', 'outbound', 'active', ?, ?)`,
      [nanoid(), ctx.productId, founder.id, name, credentials, config],
    );
  }
  return c.redirect('/connections');
});

// Grants a connection the right to be used. Authority, not configuration.
connectionRoutes.post('/connections/grant',
  requireCompanyCapability('can_manage_company'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'connections', 'Connections', undefined, c);
  if (!ctx.productId) return c.redirect('/dashboard');

  const body = await c.req.parseBody();
  const serverName = String(body.server_name ?? '').trim().toLowerCase();
  const toolPattern = String(body.tool_pattern ?? '').trim();
  const maxCalls = Math.min(Math.max(parseInt(String(body.max_calls ?? '25'), 10) || 25, 1), 10_000);
  const expiresDays = Math.min(Math.max(parseInt(String(body.expires_days ?? '30'), 10) || 30, 1), 365);

  // A grant may only target a server this product actually has connected.
  const server = await query(
    `SELECT id FROM integrations WHERE product_id = ? AND provider = 'mcp' AND name = ? AND status = 'active'`,
    [ctx.productId, serverName],
  );
  if (server.rows.length > 0 && toolPattern.length > 0 && toolPattern.length <= 80) {
    await issueGrant({
      productId: ctx.productId, serverName, toolPattern,
      maxCalls, expiresDays, createdBy: founder.id,
    });
  }
  return c.redirect('/connections');
});

// The weekly cap on a connected server. Raising it raises how far Foundry
// may reach through it, which is the same kind of decision as granting it.
connectionRoutes.post('/connections/envelope',
  requireCompanyCapability('can_manage_company'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'connections', 'Connections', undefined, c);
  if (!ctx.productId) return c.redirect('/dashboard');

  const body = await c.req.parseBody();
  const serverName = String(body.server_name ?? '').trim().toLowerCase();
  const cap = parseInt(String(body.weekly_cap ?? ''), 10);
  const server = await query(
    `SELECT id FROM integrations WHERE product_id = ? AND provider = 'mcp' AND name = ?`,
    [ctx.productId, serverName],
  );
  if (server.rows.length > 0 && Number.isFinite(cap) && cap >= 0) {
    await setCap(ctx.productId, `mcp:${serverName}`, cap);
  }
  return c.redirect('/connections');
});

connectionRoutes.post('/connections/grants/:id/revoke', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'connections', 'Connections', undefined, c);
  if (!ctx.productId) return c.redirect('/dashboard');
  await revokeGrant(c.req.param('id'), ctx.productId);
  return c.redirect('/connections');
});

connectionRoutes.post('/connections/:name/disconnect', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'connections', 'Connections', undefined, c);
  if (!ctx.productId) return c.redirect('/dashboard');
  await query(
    `UPDATE integrations SET status = 'revoked', updated_at = CURRENT_TIMESTAMP
     WHERE product_id = ? AND provider = 'mcp' AND name = ?`,
    [ctx.productId, c.req.param('name')],
  );
  return c.redirect('/connections');
});
