// =============================================================================
// FOUNDRY — SCP Agent Scheduler
// Manages when agents run. Called by cron jobs / background workers.
// =============================================================================

import { query } from '../../db/client.js';
import { SCPInstance } from './instance.js';
import { generateDailyBriefing } from './briefing.js';
import { runEvolutionSynthesis } from './evolution.js';
import type { AgentName, AgentSessionOutput } from './types.js';
import { ALL_AGENTS } from './types.js';

// ─── runDueAgentsForProduct ───────────────────────────────────────────────────

export async function runDueAgentsForProduct(productId: string): Promise<void> {
  try {
    const instance = new SCPInstance(productId);
    await instance.runAllDueAgents();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[scheduler] runDueAgentsForProduct(${productId}) failed: ${msg}`);
    throw err;
  }
}

// ─── runDueAgentsForAllProducts ───────────────────────────────────────────────

export async function runDueAgentsForAllProducts(): Promise<void> {
  const result = await query(
    `SELECT id FROM products
     WHERE scp_status='active' AND company_lifecycle_state != 'setup'`,
    []
  );

  let totalSessionsRun = 0;
  let totalCostUsd = 0;

  for (const row of result.rows) {
    const productId = (row as Record<string, unknown>).id as string;
    try {
      const instance = new SCPInstance(productId);
      const outputs: AgentSessionOutput[] = await instance.runAllDueAgents();
      totalSessionsRun += outputs.length;
      totalCostUsd += outputs.reduce((acc, o) => acc + o.costUsd, 0);
      console.log(`[scheduler] ${productId}: ran ${outputs.length} agents`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[scheduler] runDueAgentsForAllProducts — product ${productId} failed: ${msg}`);
      // Continue to next product
    }
  }

  console.log(
    `[scheduler] runDueAgentsForAllProducts complete. ` +
    `Products: ${result.rows.length}, Sessions: ${totalSessionsRun}, Cost: $${totalCostUsd.toFixed(4)}`
  );
}

// ─── scheduleNextRun ──────────────────────────────────────────────────────────

export async function scheduleNextRun(
  productId: string,
  agentName: AgentName,
  cadenceHours: number
): Promise<void> {
  const nextRunAt = new Date(Date.now() + cadenceHours * 3600 * 1000).toISOString();
  await query(
    `UPDATE agent_instances SET next_run_at=?, updated_at=CURRENT_TIMESTAMP
     WHERE product_id=? AND agent_name=?`,
    [nextRunAt, productId, agentName]
  );
}

// ─── getDueAgents ─────────────────────────────────────────────────────────────

export async function getDueAgents(productId: string): Promise<AgentName[]> {
  const result = await query(
    `SELECT agent_name FROM agent_instances
     WHERE product_id=? AND status='active'
       AND (next_run_at IS NULL OR next_run_at <= CURRENT_TIMESTAMP)`,
    [productId]
  );

  return result.rows.map(
    (row) => (row as Record<string, unknown>).agent_name as AgentName
  );
}

// ─── runEvolutionForAllProducts ───────────────────────────────────────────────

export async function runEvolutionForAllProducts(): Promise<void> {
  const result = await query(
    `SELECT id FROM products WHERE scp_status='active' AND evolution_enabled=1`,
    []
  );

  for (const row of result.rows) {
    const productId = (row as Record<string, unknown>).id as string;

    for (const agentName of ALL_AGENTS) {
      try {
        const outcome = await runEvolutionSynthesis(productId, agentName);
        if (outcome.evolved) {
          console.log(`[scheduler] Evolution: ${productId}/${agentName} → v${outcome.newVersion}: ${outcome.description}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[scheduler] Evolution failed for ${productId}/${agentName}: ${msg}`);
        // Non-fatal — continue
      }
    }
  }
}

// ─── generateBriefingsForAllProducts ─────────────────────────────────────────

export async function generateBriefingsForAllProducts(): Promise<void> {
  const result = await query(
    `SELECT id FROM products WHERE scp_status='active'`,
    []
  );

  let generated = 0;

  for (const row of result.rows) {
    const productId = (row as Record<string, unknown>).id as string;
    try {
      await generateDailyBriefing(productId);
      generated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[scheduler] generateBriefing failed for ${productId}: ${msg}`);
    }
  }

  console.log(`[scheduler] generateBriefingsForAllProducts complete. Generated: ${generated}/${result.rows.length}`);
}
