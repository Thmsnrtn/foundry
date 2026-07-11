// =============================================================================
// FOUNDRY — Department plumbing (Hands Law layer 3)
// Every department is the same closed loop on the same governance: a trust
// ladder category (visible in Controls from first run, never overriding the
// founder), an envelope, and audit-logged shadow work.
// =============================================================================

import { nanoid } from 'nanoid';
import { query, insertAuditLog } from '../../db/client.js';

/** Make a department's dial visible in Controls without overriding any choice
 *  the founder already made. */
export async function ensurePolicyVisible(productId: string, category: string): Promise<void> {
  await query(
    `INSERT INTO autopilot_policies (id, product_id, category, mode, set_by)
     VALUES (?, ?, ?, 'shadow', 'system_bootstrap')
     ON CONFLICT(product_id, category) DO NOTHING`,
    [nanoid(), productId, category],
  );
}

/** Record what a shadowed department WOULD have done — the record that later
 *  earns 'suggest'. */
export async function recordShadowWork(
  productId: string, category: string, reasoning: string, context: Record<string, unknown>,
): Promise<void> {
  await insertAuditLog({
    id: nanoid(),
    product_id: productId,
    action_type: `dept:${category}`,
    gate: 0,
    trigger: `${category}_sweep`,
    reasoning,
    input_context: JSON.stringify(context),
    output: undefined,
    outcome: 'shadow',
  });
}
