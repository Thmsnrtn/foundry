// =============================================================================
// FOUNDRY — Remote MCP endpoint (the Trust Plane transport)
//
// A minimal, dependency-free MCP server over Streamable HTTP (JSON-RPC 2.0,
// tools-only). Any MCP client can connect:
//
//   claude mcp add --transport http foundry https://<host>/api/v1/mcp \
//     --header "Authorization: Bearer fnd_..."
//
// Auth + tenancy come from the surrounding api-key middleware: the key fixes
// productId/founderId, and every tool is scoped to that product regardless of
// arguments. Read tools (server.ts registry) + loop tools (loop-tools.ts).
// =============================================================================

import { Hono } from 'hono';
import type { ApiAuthEnv } from '../middleware/auth.js';
import { FOUNDRY_TOOLS, executeTool } from '../../mcp/server.js';
import { LOOP_TOOLS, executeLoopTool } from '../../mcp/loop-tools.js';

export const mcpApi = new Hono<ApiAuthEnv>();

const PROTOCOL_VERSION = '2025-06-18';
const LOOP_TOOL_NAMES = new Set(LOOP_TOOLS.map((t) => t.name));

// Tools that CHANGE something. Everything else on this transport reads.
//
// This endpoint had no scope check of any kind: it sat behind `apiKeyAuth` and
// nothing else, so a key issued to read metrics could resolve a decision and
// record a new one. Scopes were resolved by the middleware and then, on this
// one surface, never consulted.
//
// The check is per TOOL rather than per endpoint, because `tools/call` is one
// route carrying twenty different consequences. An endpoint-level scope would
// have to be the widest of them, which is how a read key ends up able to write.
const WRITING_TOOLS = new Set(['foundry_resolve_decision', 'foundry_record_decision']);

/** The scope one tool call needs. Unknown names are treated as writing: a tool
 * this map has not been taught about is not assumed to be harmless. */
function scopeForTool(name: string): 'agents:read' | 'agents:write' {
  if (WRITING_TOOLS.has(name)) return 'agents:write';
  if (LOOP_TOOL_NAMES.has(name) || READ_TOOL_NAMES.has(name)) return 'agents:read';
  return 'agents:write';
}

/** A key holds a scope when it was granted that scope. There is no value
 *  meaning "all of them": `issueApiKey` refuses any scope no route honours,
 *  `'*'` included, and the settings page tells the founder a key "does exactly
 *  what you tick and nothing else". This used to read `'*'` as every tool —
 *  a fail-open default for an unknown string, one unvalidated issuance path
 *  away from being reachable. That path is gone too. */
function holds(scopes: string[], scope: string): boolean {
  return scopes.includes(scope);
}

// The read tools require product_id in their schemas; over the remote transport
// the product is fixed by the API key, so expose them with product_id removed.
const READ_TOOL_NAMES = new Set(FOUNDRY_TOOLS.map((t) => t.name));
const READ_TOOLS_REMOTE = FOUNDRY_TOOLS.map((t) => ({
  ...t,
  inputSchema: {
    ...t.inputSchema,
    properties: Object.fromEntries(Object.entries(t.inputSchema.properties).filter(([k]) => k !== 'product_id')),
    required: t.inputSchema.required.filter((r) => r !== 'product_id'),
  },
}));

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

const rpcResult = (id: number | string | null | undefined, result: unknown) =>
  ({ jsonrpc: '2.0' as const, id: id ?? null, result });
const rpcError = (id: number | string | null | undefined, code: number, message: string) =>
  ({ jsonrpc: '2.0' as const, id: id ?? null, error: { code, message } });

mcpApi.post('/', async (c) => {
  let body: JsonRpcRequest;
  try {
    body = await c.req.json() as JsonRpcRequest;
  } catch {
    return c.json(rpcError(null, -32700, 'Parse error'), 400);
  }
  if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return c.json(rpcError(body?.id, -32600, 'Invalid request'), 400);
  }

  // Notifications (no id) are acknowledged without a body.
  if (body.id === undefined && body.method.startsWith('notifications/')) {
    return c.body(null, 202);
  }

  switch (body.method) {
    case 'initialize': {
      return c.json(rpcResult(body.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'foundry', version: '1.0.0' },
        instructions:
          'Foundry is the company\'s judgment infrastructure: its beliefs, decision queue, dissent, and earned trust. ' +
          'Start with foundry_letter for today\'s state. Contest gate-3+ decisions with foundry_red_team before resolving. ' +
          'Record consequential choices with foundry_record_decision so the company remembers WHY.',
      }));
    }
    case 'ping':
      return c.json(rpcResult(body.id, {}));
    case 'tools/list': {
      // Only what this key can actually call. Advertising a tool and then
      // refusing it teaches a client that the server is unreliable, when in
      // fact the key is simply narrower than the server.
      const scopes = c.get('scopes') ?? [];
      return c.json(rpcResult(body.id, {
        tools: [...READ_TOOLS_REMOTE, ...LOOP_TOOLS]
          .filter((t) => holds(scopes, scopeForTool(t.name))),
      }));
    }
    case 'tools/call': {
      const params = body.params ?? {};
      const name = String(params.name ?? '');
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const productId = c.get('productId');
      const founderId = c.get('userId');

      // Re-checked at call time, not inferred from what `tools/list` returned.
      // A client that remembers a tool from a wider key must still be refused.
      const required = scopeForTool(name);
      if (!holds(c.get('scopes') ?? [], required)) {
        return c.json(rpcError(body.id, -32603, `Insufficient permissions. Required scope: ${required}`), 403);
      }

      // AND MAY FOUNDRY ACT FOR THIS COMPANY AT ALL? The scope says what this
      // credential is allowed to do; this says whether the company is one
      // Foundry is operating. The API's method-based check cannot answer it
      // here — `tools/call` is a single POST carrying both reads and writes,
      // so refusing the method would refuse the reads the owner's read-only
      // decision permits. The same read/write vocabulary decides: a writing
      // tool is a write.
      if (required === 'agents:write' && productId) {
        const { companyMayBeChanged } = await import('../middleware/entitlement.js');
        const verdict = await companyMayBeChanged(productId);
        if (!verdict.allowed) {
          return c.json(rpcError(body.id, -32603,
            `Foundry is not currently acting for this company — ${verdict.reason}. `
            + 'Read tools still work.'), 403);
        }
      }

      const result = LOOP_TOOL_NAMES.has(name)
        ? await executeLoopTool(name, args, { productId, founderId })
        : await executeTool(name, { ...args, product_id: productId } as Record<string, string>);
      return c.json(rpcResult(body.id, { content: result.content, isError: result.content[0]?.text?.startsWith('Error') ?? false }));
    }
    default:
      return c.json(rpcError(body.id, -32601, `Method not found: ${body.method}`));
  }
});

// Streamable HTTP allows servers that don't offer a standalone stream.
mcpApi.get('/', (c) => c.json({ error: 'SSE stream not supported; POST JSON-RPC messages.' }, 405));
