// =============================================================================
// FOUNDRY — Tool Gateway Audit Adapter (V3.1 Layer C)
// Thin adapter over the existing audit_log infrastructure. Tags every entry
// with a gateway invocation_id so cross-references to idempotency_keys and
// the result trail are recoverable.
// =============================================================================

import { nanoid } from 'nanoid';
import { insertAuditLog } from '../../db/client.js';

export interface GatewayAuditEntry {
  invocation_id: string;
  product_id: string;
  agent: string | null;
  tool: string;
  action: string;
  outcome: 'allowed' | 'cached' | 'refused' | 'failed';
  reason: string;
  params_summary?: string;
  result_summary?: string;
}

/**
 * Append a gateway invocation to audit_log. Failure is non-fatal — the
 * gateway must continue even if the audit table is temporarily unavailable.
 */
export async function recordGatewayInvocation(
  entry: GatewayAuditEntry
): Promise<void> {
  try {
    await insertAuditLog({
      id: nanoid(),
      product_id: entry.product_id,
      action_type: `gateway:${entry.tool}`,
      gate: 0,
      trigger: entry.agent ? `gateway/${entry.agent}` : 'gateway/system',
      reasoning: entry.reason,
      input_context: JSON.stringify({
        invocation_id: entry.invocation_id,
        action: entry.action,
        params_summary: entry.params_summary ?? null,
      }),
      output: entry.result_summary,
      outcome: entry.outcome,
    });
  } catch { /* audit failure must not break the gateway */ }
}

export function newInvocationId(): string {
  return `gw_${nanoid()}`;
}
