// =============================================================================
// Tests: Connections (Hands Law / Constitution Law 10)
// The founder shapes the system's hands: connect any MCP server, grant scoped
// abilities, watch the audit trail, revoke instantly. Reach is never license —
// proven end-to-end through the standing-order (mcp_tool) action path.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, it, expect, beforeAll } from 'vitest';
import { principalRef } from '../../src/services/outbound/acting-principal.js';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

let app: Hono;
const founder = { id: 'cx_f', email: 'cx@t.co', preferences: { fluency: 'plain' } };

const form = (data: Record<string, string>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(data).toString(),
});

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('cx_f','clk_cx','cx@t.co')", []);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES ('cx_p','CxCo','cx_f','active')", []);

  const { connectionRoutes } = await import('../../src/routes/dashboard/connections.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never, founder as never);
    c.set('csrfToken' as never, 't' as never);
    await next();
  });
  app.route('/', connectionRoutes);
});

describe('the connector fabric', () => {
  it('starts empty and says so plainly', async () => {
    const page = await (await app.request('/connections')).text();
    expect(page).toContain('Nothing connected yet');
    expect(page).toContain('Connect a new tool');
  });

  it('connects any MCP server by URL; token is stored encrypted', async () => {
    const res = await app.request('/connections/add', form({
      name: 'my-crm', url: 'https://crm.example/mcp', token: 'tok_secret_123',
    }));
    expect(res.status).toBe(302);

    const row = (await query(
      "SELECT credentials, config, status FROM integrations WHERE product_id='cx_p' AND provider='mcp' AND name='my-crm'", [],
    )).rows[0] as Record<string, string>;
    expect(row.status).toBe('active');
    expect(JSON.parse(row.config).url).toBe('https://crm.example/mcp');
    expect(row.credentials).not.toContain('tok_secret_123'); // encrypted at rest

    const page = await (await app.request('/connections')).text();
    expect(page).toContain('my-crm');
    expect(page).toContain('Foundry can see this tool but may not use it'); // reach ≠ license
  });

  it('rejects bad names and non-https URLs', async () => {
    await app.request('/connections/add', form({ name: 'Bad Name!', url: 'https://x.example/mcp' }));
    await app.request('/connections/add', form({ name: 'sneaky', url: 'ftp://x.example/mcp' }));
    const r = await query("SELECT COUNT(*) as c FROM integrations WHERE product_id='cx_p' AND provider='mcp'", []);
    expect((r.rows[0] as Record<string, number>).c).toBe(1); // still just my-crm
  });

  it('grants are scoped + capped, and only for servers that exist', async () => {
    await app.request('/connections/grant', form({
      server_name: 'my-crm', tool_pattern: 'send_email', max_calls: '50', expires_days: '14',
    }));
    await app.request('/connections/grant', form({
      server_name: 'ghost-server', tool_pattern: '*', max_calls: '999', expires_days: '30',
    }));

    const grants = (await query("SELECT * FROM mcp_grants WHERE product_id='cx_p'", []))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(grants.length).toBe(1); // ghost-server grant refused
    expect(grants[0].server_name).toBe('my-crm');
    expect(grants[0].max_calls).toBe(50);

    const page = await (await app.request('/connections')).text();
    expect(page).toContain('send_email');
    expect(page).toContain('0/50 calls used');
  });

  it('revoke is instant', async () => {
    const g = (await query("SELECT id FROM mcp_grants WHERE product_id='cx_p'", [])).rows[0] as Record<string, string>;
    await app.request(`/connections/grants/${g.id}/revoke`, form({}));
    const { checkGrant } = await import('../../src/services/integration/mcp-client.js');
    const check = await checkGrant('cx_p', 'my-crm', 'send_email');
    expect(check.ok).toBe(false);
  });
});

describe('five doors (Attention Law nav)', () => {
  it('sidebar leads with Today/Signal/Decide/Talk/Actions; groups auto-open where you are', async () => {
    const page = await (await app.request('/connections')).text();
    for (const s of ['href="/letter"', 'href="/talk"', 'href="/autopilot"', 'href="/connections"', '>Today<', '>Signal<', '>Decide<']) {
      expect(page).toContain(s);
    }
    expect(page).toMatch(/<details\s+open\s*>[\s\S]{0,200}AUTOPILOT/); // active group open
    expect(page).toMatch(/<details\s*>[\s\S]{0,200}INVESTOR/);        // inactive group closed
  });
});

describe('the hands obey the law end-to-end (standing-order mcp_tool action)', () => {
  it('no grant → the action fails with the reason, and nothing leaves the building', async () => {
    const { createExecution, approveAndExecute } = await import('../../src/services/scp/actions/executor.js');
    const execId = await createExecution('cx_p', null, {
      action_type: 'mcp_tool', integration: 'my-crm',
      server_name: 'my-crm', tool: 'send_email', tool_args: { to: 'x@y.z' },
    });
    const result = await approveAndExecute(execId, principalRef('founder', 'cx_f'));
    expect(result.success).toBe(false);
    expect(result.error).toContain('no live grant'); // revoked above — Hands Law holds
  });

  it('a disconnected server refuses calls even with a live grant', async () => {
    const { issueGrant, callMcpTool } = await import('../../src/services/integration/mcp-client.js');
    await issueGrant({ productId: 'cx_p', serverName: 'my-crm', toolPattern: '*', createdBy: 'cx_f' });
    await app.request('/connections/my-crm/disconnect', form({}));
    const r = await callMcpTool({
      productId: 'cx_p', agent: 'test', serverName: 'my-crm', tool: 'send_email',
      args: {}, dedupKey: 'k1',
    });
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toContain('not connected');
  });
});
