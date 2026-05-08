// =============================================================================
// FOUNDRY — Tool Gateway Kill-Switch (V3.1 Layer C)
// Refuses outbound when the product is paused, the specific tool is disabled,
// or the calling agent is paused. Reads existing fields plus the new
// products.disabled_tools JSON column added in migration 068.
// =============================================================================

import { query } from '../../db/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KillSwitchResult {
  blocked: boolean;
  reason: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check whether (product, tool, agent) is allowed to invoke. Blocks on:
 *   - product status != 'active' (product-wide pause)
 *   - tool listed in products.disabled_tools (per-tool kill)
 *   - agent_instances row for (product, agent) with status='paused'
 *
 * Agent check is skipped when agentName is omitted or 'system'.
 */
export async function checkKillSwitch(
  productId: string,
  tool: string,
  agentName?: string | null
): Promise<KillSwitchResult> {
  const productResult = await query(
    `SELECT status, disabled_tools FROM products WHERE id = ?`,
    [productId]
  );
  const productRow = productResult.rows[0] as Record<string, unknown> | undefined;
  if (!productRow) {
    return { blocked: true, reason: `product ${productId} not found` };
  }
  if (productRow.status && productRow.status !== 'active') {
    return {
      blocked: true,
      reason: `product status is '${productRow.status}'`,
    };
  }
  if (isToolDisabledForRow(productRow.disabled_tools, tool)) {
    return {
      blocked: true,
      reason: `tool '${tool}' is disabled for this product`,
    };
  }

  if (agentName && agentName !== 'system') {
    const agentResult = await query(
      `SELECT status FROM agent_instances WHERE product_id = ? AND agent_name = ?`,
      [productId, agentName]
    );
    const agentRow = agentResult.rows[0] as Record<string, unknown> | undefined;
    if (agentRow && agentRow.status === 'paused') {
      return { blocked: true, reason: `agent '${agentName}' is paused` };
    }
  }

  return { blocked: false, reason: 'ok' };
}

/**
 * Disable a tool for a product. Idempotent — adds the tool to
 * products.disabled_tools if not already present.
 */
export async function disableTool(productId: string, tool: string): Promise<void> {
  const current = await loadDisabledTools(productId);
  if (current.includes(tool)) return;
  current.push(tool);
  await query(`UPDATE products SET disabled_tools = ? WHERE id = ?`, [
    JSON.stringify(current),
    productId,
  ]);
}

/**
 * Re-enable a tool for a product. Idempotent — removes the tool from
 * products.disabled_tools if present.
 */
export async function enableTool(productId: string, tool: string): Promise<void> {
  const current = await loadDisabledTools(productId);
  const next = current.filter((t) => t !== tool);
  if (next.length === current.length) return;
  await query(`UPDATE products SET disabled_tools = ? WHERE id = ?`, [
    JSON.stringify(next),
    productId,
  ]);
}

// ─── Internals ────────────────────────────────────────────────────────────────

async function loadDisabledTools(productId: string): Promise<string[]> {
  const result = await query(`SELECT disabled_tools FROM products WHERE id = ?`, [
    productId,
  ]);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return [];
  return parseToolList(row.disabled_tools);
}

function isToolDisabledForRow(raw: unknown, tool: string): boolean {
  return parseToolList(raw).includes(tool);
}

function parseToolList(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
