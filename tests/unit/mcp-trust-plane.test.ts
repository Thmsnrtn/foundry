// =============================================================================
// Tests: the Trust Plane — remote MCP endpoint (JSON-RPC lifecycle + loop tools)
// Drives the real transport + real services against the migrated schema with a
// mocked model. Tenancy: the API key's product is law; foreign ids 404 inside
// tool results.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('../../src/services/ai/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/ai/client.js')>();
  return {
    ...actual,
    callSonnet: vi.fn(async (systemPrompt: string) => ({
      content: systemPrompt.includes('RED TEAM')
        ? JSON.stringify({
            verdict: 'proceed_with_changes',
            strongest_objection: 'Churn risk is untested',
            confidence: 0.6,
            objections: [{ lens: 'downside', claim: 'Churn breaches 6%', severity: 'serious', metric_key: 'churn_rate', comparator: '>', threshold: 0.06 }],
          })
        : JSON.stringify({ options: [{ label: 'Proceed', growth_delta_pp: 0.5, rationale: 'r' }] }),
      model: 'sonnet',
      usage: { input_tokens: 100, output_tokens: 100 },
    })),
  };
});

import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

let app: Hono;
/** The transport itself, so a test can mount it behind a narrower key. */
let mcpApiRef: Hono;

async function rpc(method: string, params?: Record<string, unknown>, id: number | null = 1): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', ...(id === null ? {} : { id }), method, params }),
  });
  const bodyText = await res.text();
  return { status: res.status, body: bodyText ? JSON.parse(bodyText) : null };
}
const toolText = (body: Record<string, unknown>): string =>
  ((body.result as Record<string, unknown>).content as Array<{ text: string }>)[0].text;

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('mcp_f','clk_mcp','m@t.co')", []);
  await query("INSERT INTO products (id, name, owner_id) VALUES ('mcp_p','McpCo','mcp_f')", []);
  await query("INSERT INTO products (id, name, owner_id) VALUES ('mcp_foreign','OtherCo','other')", []);
  await query(
    `INSERT INTO decisions (id, product_id, category, gate, what, why_now, options, recommendation, status)
     VALUES ('mcp_d1', 'mcp_p', 'strategic', 3, 'Enter enterprise', 'pull', '[{"label":"Go"},{"label":"Wait"}]', 'Wait', 'pending')`,
    [],
  );
  await query(
    `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status)
     VALUES ('mcp_dforeign', 'mcp_foreign', 'strategic', 1, 'Foreign', 'x', 'pending')`,
    [],
  );

  const { mcpApi } = await import('../../src/api/v1/mcp.js');
  mcpApiRef = mcpApi as unknown as Hono;
  app = new Hono();
  // Stand-in for apiKeyAuth: the key fixes the tenant AND carries scopes.
  //
  // It used to set only the first two, which is exactly how this surface went
  // its whole life without a scope check — the fixture modelled an auth
  // middleware that resolves no permissions, so nothing here could notice that
  // the endpoint consulted none. A stand-in that is weaker than the thing it
  // stands in for tests a system nobody runs.
  app.use('*', async (c, next) => {
    c.set('productId' as never, 'mcp_p' as never);
    c.set('userId' as never, 'mcp_f' as never);
    c.set('scopes' as never, ['agents:read', 'agents:write'] as never);
    await next();
  });
  app.route('/mcp', mcpApi);
});

describe('JSON-RPC lifecycle', () => {
  it('initialize → capabilities + instructions; notifications get 202', async () => {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
    expect(init.status).toBe(200);
    const result = init.body!.result as Record<string, unknown>;
    expect((result.serverInfo as Record<string, unknown>).name).toBe('foundry');
    expect(String(result.instructions)).toContain('foundry_letter');

    const res = await app.request('/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    expect(res.status).toBe(202);
  });

  it('tools/list merges read tools (product_id stripped) + loop tools', async () => {
    const r = await rpc('tools/list');
    const tools = (r.body!.result as Record<string, unknown>).tools as Array<{ name: string; inputSchema: { required: string[] } }>;
    const names = tools.map((t) => t.name);
    expect(names).toContain('foundry_full_context');
    expect(names).toContain('foundry_letter');
    expect(names).toContain('foundry_resolve_decision');
    const fullCtx = tools.find((t) => t.name === 'foundry_full_context')!;
    expect(fullCtx.inputSchema.required).not.toContain('product_id'); // fixed by the key
  });

  it('unknown methods get -32601', async () => {
    const r = await rpc('resources/list');
    expect((r.body!.error as Record<string, unknown>).code).toBe(-32601);
  });
});

describe('the loop over MCP', () => {
  it('reads the queue, contests, and resolves — with overruled dissent monitored', async () => {
    const queue = await rpc('tools/call', { name: 'foundry_decision_queue', arguments: {} });
    expect(toolText(queue.body!)).toContain('Enter enterprise');

    const redteam = await rpc('tools/call', { name: 'foundry_red_team', arguments: { decision_id: 'mcp_d1' } });
    expect(toolText(redteam.body!)).toContain('proceed_with_changes');

    // Gate-3 without reasoning → refused.
    const bare = await rpc('tools/call', { name: 'foundry_resolve_decision', arguments: { decision_id: 'mcp_d1', chosen_option: 'Go' } });
    expect(toolText(bare.body!)).toContain('require reasoning');

    const resolved = await rpc('tools/call', {
      name: 'foundry_resolve_decision',
      arguments: { decision_id: 'mcp_d1', chosen_option: 'Go', reasoning: 'Pipeline demands it' },
    });
    expect(toolText(resolved.body!)).toContain('monitored premises'); // dissent overruled → accountable
    const premises = await query("SELECT COUNT(*) AS n FROM decision_premises WHERE decision_id='mcp_d1' AND origin='red_team'", []);
    expect(Number((premises.rows[0] as Record<string, unknown>).n)).toBe(1);
  });

  it('records a decision with a monitored premise into the ledger', async () => {
    const r = await rpc('tools/call', {
      name: 'foundry_record_decision',
      arguments: {
        title: 'Stay self-serve', decision: 'No sales hires this year',
        premise: 'churn stays under 5%', premise_metric: 'churn_rate', premise_comparator: '<', premise_threshold: 0.05,
      },
    });
    expect(toolText(r.body!)).toContain('accountable');
    const p = await query("SELECT COUNT(*) AS n FROM decision_premises WHERE product_id='mcp_p' AND premise='churn stays under 5%'", []);
    expect(Number((p.rows[0] as Record<string, unknown>).n)).toBe(1);
  });

  it('letter + trust read from the ledgers', async () => {
    const letter = await rpc('tools/call', { name: 'foundry_letter', arguments: {} });
    expect(toolText(letter.body!)).toContain('handled');
    const trust = await rpc('tools/call', { name: 'foundry_trust', arguments: {} });
    expect(toolText(trust.body!)).toContain('graduation_proposals');
  });

  it('tenancy is sealed: foreign decisions are invisible whatever the args say', async () => {
    const r = await rpc('tools/call', { name: 'foundry_resolve_decision', arguments: { decision_id: 'mcp_dforeign', chosen_option: 'hijack' } });
    expect(toolText(r.body!)).toContain('not found');
    const foreign = await query("SELECT status FROM decisions WHERE id='mcp_dforeign'", []);
    expect((foreign.rows[0] as Record<string, unknown>).status).toBe('pending');
  });
});

// =============================================================================
// Scope, on the one surface that never had any.
//
// This endpoint sat behind `apiKeyAuth` and nothing else for its whole life.
// The middleware resolved scopes and this transport never consulted them, so a
// key issued to read metrics could resolve a decision and record a new one.
//
// `tools/call` is a single route carrying twenty different consequences, which
// is why the check is per TOOL. An endpoint-level scope would have to be the
// widest of them, and that is precisely how a read key ends up able to write.
// =============================================================================

describe('a narrow key over MCP', () => {
  /** The same transport, reached with a key that may only read. */
  async function readOnlyRpc(method: string, params?: Record<string, unknown>) {
    const narrow = new Hono();
    narrow.use('*', async (c, next) => {
      c.set('productId' as never, 'mcp_p' as never);
      c.set('userId' as never, 'mcp_f' as never);
      c.set('scopes' as never, ['agents:read'] as never);
      await next();
    });
    narrow.route('/mcp', mcpApiRef);
    const res = await narrow.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) as Record<string, unknown> : null };
  }

  it('may read', async () => {
    const r = await readOnlyRpc('tools/call', { name: 'foundry_letter', arguments: {} });
    expect(r.status).toBe(200);
  });

  it('may not resolve or record a decision', async () => {
    for (const name of ['foundry_resolve_decision', 'foundry_record_decision']) {
      const r = await readOnlyRpc('tools/call', { name, arguments: {} });
      expect(r.status, `${name} must be refused for a read-only key`).toBe(403);
      expect(JSON.stringify(r.body)).toContain('agents:write');
    }
    // And nothing happened as a side effect of being refused.
    const still = await query("SELECT status FROM decisions WHERE id='mcp_dforeign'", []);
    expect((still.rows[0] as Record<string, unknown>).status).toBe('pending');
  });

  it('is not offered tools it cannot call', async () => {
    // Advertising a tool and then refusing it teaches a client that the server
    // is unreliable, when in fact the key is narrower than the server.
    const listed = await readOnlyRpc('tools/list');
    const names = ((listed.body!.result as Record<string, unknown>).tools as Array<{ name: string }>)
      .map((t) => t.name);
    expect(names).toContain('foundry_letter');
    expect(names).not.toContain('foundry_resolve_decision');
    expect(names).not.toContain('foundry_record_decision');
  });

  it('treats a tool it has never heard of as writing, not as harmless', async () => {
    const r = await readOnlyRpc('tools/call', { name: 'foundry_something_new', arguments: {} });
    expect(r.status).toBe(403);
  });
});
