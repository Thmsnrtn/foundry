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

// The read tools require product_id in their schemas; over the remote transport
// the product is fixed by the API key, so expose them with product_id removed.
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
    case 'tools/list':
      return c.json(rpcResult(body.id, { tools: [...READ_TOOLS_REMOTE, ...LOOP_TOOLS] }));
    case 'tools/call': {
      const params = body.params ?? {};
      const name = String(params.name ?? '');
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const productId = c.get('productId');
      const founderId = c.get('userId');

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
