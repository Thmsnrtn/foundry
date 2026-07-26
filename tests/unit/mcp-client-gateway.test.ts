// =============================================================================
// Tests: MCP client through the gateway (Trust Plane phase 2)
// No grant no call; caps and expiry hold; the gateway dedups; grants consume
// exactly-once; revocation is instant. Remote server mocked at the fetch layer.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

let remoteCalls = 0;
vi.stubGlobal('fetch', vi.fn(async () => {
  remoteCalls++;
  return new Response(JSON.stringify({
    jsonrpc: '2.0', id: 1,
    result: { content: [{ type: 'text', text: 'invoice created' }] },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}));

import { callMcpTool, issueGrant, revokeGrant, checkGrant } from '../../src/services/integration/mcp-client.js';
import { encryptToken } from '../../src/lib/crypto.js';

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES ('mg_p','Co','o1','active')", []);
  await query(
    `INSERT INTO integrations (id, product_id, owner_id, name, provider, type, status, credentials, config)
     VALUES ('mg_srv', 'mg_p', 'o1', 'books', 'mcp', 'outbound', 'active', ?, ?)`,
    [encryptToken('tok_secret'), JSON.stringify({ url: 'https://books.example/mcp' })],
  );
});

describe('grants are the license', () => {
  it('no grant → no call, with the reason pointing at Controls', async () => {
    const r = await callMcpTool({
      productId: 'mg_p', agent: 'ledger', serverName: 'books', tool: 'create_invoice',
      args: { amount: 100 }, dedupKey: 'inv:1',
    });
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toContain('no live grant');
    expect(remoteCalls).toBe(0);
  });

  it('a live grant licenses the call; the grant is consumed exactly once', async () => {
    const grantId = await issueGrant({
      productId: 'mg_p', serverName: 'books', toolPattern: 'create_invoice',
      maxCalls: 2, expiresDays: 7, createdBy: 'o1',
    });
    const r = await callMcpTool({
      productId: 'mg_p', agent: 'ledger', serverName: 'books', tool: 'create_invoice',
      args: { amount: 100 }, dedupKey: 'inv:1',
    });
    expect(r.ok).toBe(true);
    expect(remoteCalls).toBe(1);

    // Same dedupKey → gateway idempotency: served from cache, remote NOT re-hit,
    // grant NOT re-consumed.
    const again = await callMcpTool({
      productId: 'mg_p', agent: 'ledger', serverName: 'books', tool: 'create_invoice',
      args: { amount: 100 }, dedupKey: 'inv:1',
    });
    expect(again.ok).toBe(true);
    expect((again as { cached: boolean }).cached).toBe(true);
    expect(remoteCalls).toBe(1);
    const used = await query('SELECT calls_used FROM mcp_grants WHERE id = ?', [grantId]);
    expect(Number((used.rows[0] as Record<string, unknown>).calls_used)).toBe(1);
  });

  it('the call cap holds', async () => {
    // One more fresh call uses the cap (2); the next is refused.
    const second = await callMcpTool({
      productId: 'mg_p', agent: 'ledger', serverName: 'books', tool: 'create_invoice',
      args: { amount: 200 }, dedupKey: 'inv:2',
    });
    expect(second.ok).toBe(true);
    const third = await callMcpTool({
      productId: 'mg_p', agent: 'ledger', serverName: 'books', tool: 'create_invoice',
      args: { amount: 300 }, dedupKey: 'inv:3',
    });
    expect(third.ok).toBe(false);
    expect((third as { reason: string }).reason).toContain('calls remaining');
  });

  it('wildcard grants cover any tool on the server; revocation is instant', async () => {
    const gid = await issueGrant({
      productId: 'mg_p', serverName: 'books', toolPattern: '*', maxCalls: 10, createdBy: 'o1',
    });
    expect((await checkGrant('mg_p', 'books', 'send_statement')).ok).toBe(true);
    await revokeGrant(gid, 'mg_p');
    expect((await checkGrant('mg_p', 'books', 'send_statement')).ok).toBe(false);
  });

  it('expired grants never license', async () => {
    await query(
      `INSERT INTO mcp_grants (id, product_id, server_name, tool_pattern, max_calls, expires_at, created_by)
       VALUES ('mg_old', 'mg_p', 'books', 'old_tool', 5, datetime('now', '-1 day'), 'o1')`,
      [],
    );
    expect((await checkGrant('mg_p', 'books', 'old_tool')).ok).toBe(false);
  });

  it('an unconnected server is refused before any grant logic', async () => {
    const r = await callMcpTool({
      productId: 'mg_p', agent: 'ledger', serverName: 'ghost_server', tool: 'x',
      args: {}, dedupKey: 'k',
    });
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toContain('not connected');
  });
});
