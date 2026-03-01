// =============================================================================
// FOUNDRY — Recovery Protocol (Red State Only)
// =============================================================================

import { callOpus, parseJSONResponse } from '../ai/client.js';
import { query, insertAuditLog } from '../../db/client.js';
import { nanoid } from 'nanoid';
import type { RecoveryProtocol } from '../../types/index.js';

export async function generateRecoveryProtocol(input: {
  productId: string;
  productName: string;
  activeStress: string;
  mrrTrajectory: string;
  cohortTrends: string;
  competitiveSignals: string;
  activeDecisions: string;
  stressorTrajectory: string;
}): Promise<RecoveryProtocol> {
  const systemPrompt = `You are the Foundry Recovery Protocol engine. A product has entered Red state.
Produce a focused recovery plan. No optimization — only stabilization.

Output JSON:
{
  "diagnosis": "root variable driving the stress",
  "root_variable": "single most important variable",
  "recovery_plan": [{"order": 1, "action": "...", "expected_effect": "...", "measurement": "..."}],
  "what_to_stop": ["normal operations to pause during recovery"],
  "estimated_recovery_days": 30
}`;

  const userPrompt = `Product: ${input.productName}
Active stress: ${input.activeStress}
MRR trajectory: ${input.mrrTrajectory}
Cohort trends: ${input.cohortTrends}
Competitive signals: ${input.competitiveSignals}
Active decisions: ${input.activeDecisions}
Stressor trajectory: ${input.stressorTrajectory}`;

  const response = await callOpus(systemPrompt, userPrompt, 4096);
  const protocol = parseJSONResponse<RecoveryProtocol>(response.content);

  // Create pinned decision
  const decisionId = nanoid();
  await query(
    `INSERT INTO decisions (id, product_id, category, gate, what, why_now, recommendation, status)
     VALUES (?, ?, 'urgent', 2, ?, ?, ?, 'pending')`,
    [decisionId, input.productId, `Recovery Protocol: ${protocol.diagnosis}`,
     `Product entered Red state. Root variable: ${protocol.root_variable}`,
     JSON.stringify(protocol.recovery_plan)]
  );

  await insertAuditLog({
    id: nanoid(), product_id: input.productId,
    action_type: 'recovery_protocol_generated', gate: 2,
    trigger: 'red_state_transition',
    reasoning: `Recovery protocol generated. Root variable: ${protocol.root_variable}`,
    output: JSON.stringify(protocol), risk_state_at_action: 'red',
  });

  return protocol;
}
