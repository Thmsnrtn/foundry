// =============================================================================
// FOUNDRY — Tool Gateway Kill-Switch (V3.1 Layer C)
// Refuses outbound when the product is paused, the specific tool is disabled,
// or the calling agent is paused. Reads existing fields plus the new
// products.disabled_tools JSON column added in migration 068.
//
// TWO PAUSE AXES, BOTH LOAD-BEARING. `products.status` is the archive axis: the
// record is gone. `products.scp_status` is the acting axis: the company is not
// operating right now. Three separate places write `scp_status='paused'` — a
// cancelled Stripe subscription, a founder pausing from settings, and the
// hourly entitlement sweep that enforces "unpaid means read-only" — and until
// this file read it, none of them stopped a single outbound effect. The SCP
// scheduler honoured the pause, so no NEW agent work started; but every job
// that emails on its own timer (red daily, yellow pulse, DNA nudge, behavioural
// triggers) filtered on `status='active'` and sent anyway. The pause looked
// total from the code that wrote it and was not.
//
// It is checked HERE rather than at those call sites deliberately. This is the
// single door every outbound effect passes through, and the alternative —
// adding `AND scp_status='active'` to a dozen SELECTs — is the exact shape this
// codebase keeps finding broken: several implementations of one rule, drifting
// apart, with the weakest one live.
// =============================================================================

import { query } from '../../db/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KillSwitchResult {
  blocked: boolean;
  reason: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** SCP states in which the company is not acting outward.
 *
 * Named rather than inverted — `scp_status <> 'active'` would also catch
 * 'provisioning', and onboarding email is sent before a product is ever marked
 * active. Blocking signup in order to enforce billing is not the trade the
 * owner decision asked for. */
const NOT_ACTING = new Set(['paused', 'archived']);

/**
 * Check whether (product, tool, agent) is allowed to invoke. Blocks on:
 *   - product status != 'active' (the record is archived or deleted)
 *   - product scp_status in ('paused','archived') (the company is not acting)
 *   - tool listed in products.disabled_tools (per-tool kill)
 *   - agent_instances row for (product, agent) with status='paused'
 *
 * Agent check is skipped when agentName is omitted or 'system'.
 */
export async function checkKillSwitch(
  productId: string,
  tool: string,
  agentName?: string | null,
  /** Server-owned capability facts. Supplied by the gateway from the REGISTERED
   * policy for the tool — never from the request, which is why this parameter
   * has no route to a caller. */
  capability?: { deliverableWhilePaused?: boolean },
): Promise<KillSwitchResult> {
  const productResult = await query(
    `SELECT status, scp_status, disabled_tools FROM products WHERE id = ?`,
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
  // A missing scp_status does not block. The column has been on products since
  // migration 017 with a default, so NULL means a row older than the SCP model
  // rather than a company anybody paused — and refusing outbound for those
  // would silence accounts nobody made a decision about.
  const scpStatus = String(productRow.scp_status ?? '');
  if (NOT_ACTING.has(scpStatus)) {
    // Account mail is delivered to a paused customer, as every subscription
    // product delivers it: the notice explaining the pause cannot itself be
    // blocked by the pause. 'archived' is not exempt — that record is gone, and
    // there is no relationship left to write to.
    const exempt = capability?.deliverableWhilePaused === true && scpStatus === 'paused';
    if (!exempt) {
      return {
        blocked: true,
        reason: `company is ${scpStatus} — Foundry is not acting for this product`,
      };
    }
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
