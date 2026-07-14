// =============================================================================
// FOUNDRY — MCP client through the gateway (Trust Plane phase 2)
//
// The agents' hands multiply: any MCP server the founder connects becomes
// callable — but every call is GOVERNED. The chain, all mandatory:
//
//   grant check (founder-issued, tool-scoped, call-capped, expiring, revocable)
//     → outbound gateway (kill-switch · idempotency dedup · audit log)
//       → JSON-RPC tools/call with a 10s timeout
//         → grant consumption (exactly-once per fresh call)
//
// Server configs live on the canonical integrations table (provider='mcp'):
// config JSON carries {url}; credentials carries the encrypted bearer token.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { invoke, registerToolHandler, type GatewayRequest } from '../outbound/gateway.js';
import { getPlaintextToken } from '../../lib/crypto.js';
import { buildInsert } from '../../db/schema/kernel.js';
import { log } from '../../lib/logger.js';
import { checkReserved } from '../outbound/reserved.js';
import { checkAndConsume } from '../outbound/envelopes.js';

const MCP_TIMEOUT_MS = 10_000;

export interface McpCallInput {
  productId: string;
  agent: string;            // which Foundry agent is acting (or 'founder')
  serverName: string;       // integrations.name of the connected MCP server
  tool: string;             // the remote tool to call
  args: Record<string, unknown>;
  /** stable key for at-most-once semantics (e.g. 'invoice:cus_123:2026-07') */
  dedupKey: string;
}

export interface GrantCheck {
  ok: boolean;
  grantId?: string;
  reason?: string;
}

/** A call is licensed only by a live grant: unrevoked, unexpired, under its
 *  call cap, matching this server + tool (exact or '*'). */
export async function checkGrant(productId: string, serverName: string, tool: string): Promise<GrantCheck> {
  const r = await query(
    `SELECT id, tool_pattern, max_calls, calls_used FROM mcp_grants
     WHERE product_id = ? AND server_name = ? AND revoked_at IS NULL
       AND expires_at > datetime('now')
       AND (tool_pattern = ? OR tool_pattern = '*')
     ORDER BY CASE WHEN tool_pattern = ? THEN 0 ELSE 1 END
     LIMIT 1`,
    [productId, serverName, tool, tool],
  );
  const grant = r.rows[0] as Record<string, unknown> | undefined;
  if (!grant) return { ok: false, reason: `no live grant for ${serverName}/${tool} — the founder issues grants in Controls` };
  if (Number(grant.calls_used) >= Number(grant.max_calls)) {
    return { ok: false, reason: `grant call cap reached (${grant.max_calls}) for ${serverName}/${tool}` };
  }
  return { ok: true, grantId: String(grant.id) };
}

export async function issueGrant(opts: {
  productId: string; serverName: string; toolPattern: string;
  maxCalls?: number; expiresDays?: number; createdBy: string;
}): Promise<string> {
  const id = nanoid();
  const { sql, args } = buildInsert('mcp_grants', {
    id,
    product_id: opts.productId,
    server_name: opts.serverName,
    tool_pattern: opts.toolPattern,
    max_calls: opts.maxCalls ?? 25,
    calls_used: 0,
    expires_at: new Date(Date.now() + (opts.expiresDays ?? 30) * 86_400_000).toISOString(),
    created_by: opts.createdBy,
  });
  await query(sql, args);
  return id;
}

export async function revokeGrant(grantId: string, productId: string): Promise<void> {
  await query(
    'UPDATE mcp_grants SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND product_id = ?',
    [grantId, productId],
  );
}

// ── The gateway handler: the only code path that actually leaves the building ─

interface McpHandlerParams {
  server_url: string;
  bearer: string | null;
  tool: string;
  args: Record<string, unknown>;
}

async function mcpToolHandler(req: GatewayRequest): Promise<unknown> {
  const p = req.params as unknown as McpHandlerParams;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS);
  try {
    // SSRF guard at CALL time (defeats DNS rebinding after add-time approval).
    const { assertUrlSafe } = await import('../outbound/ssrf.js');
    await assertUrlSafe(p.server_url, { allowLoopback: true });
    const res = await fetch(p.server_url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(p.bearer ? { authorization: `Bearer ${p.bearer}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: p.tool, arguments: p.args },
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`MCP server responded ${res.status}`);
    const body = await res.json() as { result?: unknown; error?: { message?: string } };
    if (body.error) throw new Error(`MCP error: ${body.error.message ?? 'unknown'}`);
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}
registerToolHandler('mcp_tool', mcpToolHandler);

/** Call a tool on a founder-connected MCP server, fully governed. */
export async function callMcpTool(input: McpCallInput): Promise<
  { ok: true; result: unknown; cached: boolean } | { ok: false; reason: string }
> {
  // 1. The server must be connected + active.
  const server = await query(
    `SELECT config, credentials FROM integrations
     WHERE product_id = ? AND provider = 'mcp' AND name = ? AND status = 'active'`,
    [input.productId, input.serverName],
  );
  const row = server.rows[0] as Record<string, string> | undefined;
  if (!row) return { ok: false, reason: `MCP server '${input.serverName}' is not connected` };
  let url: string | undefined;
  try { url = (JSON.parse(row.config ?? '{}') as { url?: string }).url; } catch { /* fall through */ }
  if (!url) return { ok: false, reason: `MCP server '${input.serverName}' has no URL configured` };

  // 2. The call must be licensed by a live grant.
  const grant = await checkGrant(input.productId, input.serverName, input.tool);
  if (!grant.ok) return { ok: false, reason: grant.reason! };

  // 2b. Reserved powers never delegate — at any trust level, under any grant.
  const reserved = checkReserved(input.tool);
  if (reserved.reserved) {
    return { ok: false, reason: `reserved power: ${reserved.why}` };
  }

  // 2c. The weekly envelope bounds how much without asking (Hands Law).
  const envelope = await checkAndConsume(input.productId, `mcp:${input.serverName}`);
  if (!envelope.allowed) {
    return {
      ok: false,
      reason: `weekly envelope reached for ${input.serverName} (${envelope.used}/${envelope.cap} this week) — raise it on Connections if intended`,
    };
  }

  // 3. Through the gateway: kill-switch, idempotency, audit.
  const result = await invoke({
    productId: input.productId,
    agent: input.agent,
    tool: 'mcp_tool',
    action: `MCP ${input.serverName}/${input.tool}`,
    params: {
      server_url: url,
      bearer: getPlaintextToken(row.credentials ?? null),
      tool: input.tool,
      args: input.args,
    },
    dedupKey: `mcp:${input.serverName}:${input.tool}:${input.dedupKey}`,
  });

  // Exactly-once accounting: cached (deduped) and refused calls did no fresh
  // work, so the envelope unit reserved in 2c is returned.
  const refundEnvelope = () => query(
    `UPDATE envelope_usage SET used_count = MAX(used_count - 1, 0)
     WHERE product_id = ? AND scope = ? AND week_starting = (
       SELECT week_starting FROM envelope_usage
       WHERE product_id = ? AND scope = ? ORDER BY week_starting DESC LIMIT 1)`,
    [input.productId, `mcp:${input.serverName}`, input.productId, `mcp:${input.serverName}`],
  );

  if (!result.ok) {
    await refundEnvelope();
    return { ok: false, reason: `${result.phase}: ${result.reason}` };
  }

  // 4. Fresh (non-cached) executions consume the grant.
  if (!result.cached) {
    await query('UPDATE mcp_grants SET calls_used = calls_used + 1 WHERE id = ?', [grant.grantId]);
  } else {
    await refundEnvelope();
  }
  log.info('mcp tool call', {
    productId: input.productId, server: input.serverName, tool: input.tool,
    agent: input.agent, cached: result.cached,
  });
  return { ok: true, result: result.result, cached: result.cached };
}
