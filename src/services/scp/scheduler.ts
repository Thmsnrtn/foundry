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
import { logger } from '../logger.js';

// ─── runDueAgentsForProduct ───────────────────────────────────────────────────

export async function runDueAgentsForProduct(productId: string): Promise<void> {
  try {
    const instance = new SCPInstance(productId);
    await instance.runAllDueAgents();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`runDueAgentsForProduct(${productId}) failed: ${msg}`, { productId });
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
      logger.info(`${productId}: ran ${outputs.length} agents`, { productId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`runDueAgentsForAllProducts — product ${productId} failed: ${msg}`, { productId });
      // Continue to next product
    }
  }

  logger.info(
    `runDueAgentsForAllProducts complete. ` +
    `Products: ${result.rows.length}, Sessions: ${totalSessionsRun}, Cost: $${totalCostUsd.toFixed(4)}`
  );
}

// ─── scheduleNextRun ──────────────────────────────────────────────────────────

export async function scheduleNextRun(
  productId: string,
  agentName: AgentName,
  cadenceHours: number
): Promise<void> {
  // Wave 2: weekend mode multiplier. A product with cadence_mode='weekend'
  // (Council 14: side-project founder) drops every cadence to weekly.
  // Failure to read the column is non-fatal — falls back to standard.
  let effectiveHours = cadenceHours;
  try {
    const r = await query('SELECT cadence_mode FROM products WHERE id = ?', [productId]);
    const mode = (r.rows[0] as Record<string, string | null> | undefined)?.cadence_mode;
    if (mode === 'weekend') {
      // Weekend mode: clamp every cadence to weekly (168h) minimum.
      effectiveHours = Math.max(cadenceHours, 168);
    }
  } catch { /* schema lacks column on dev DBs; continue with default */ }

  const nextRunAt = new Date(Date.now() + effectiveHours * 3600 * 1000).toISOString();
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
          logger.info(`Evolution: ${productId}/${agentName} → v${outcome.newVersion}: ${outcome.description}`, { productId, agentName });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`Evolution failed for ${productId}/${agentName}: ${msg}`, { productId, agentName });
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
      // Fire-and-forget: send briefing to Slack if connected
      _sendBriefingToSlack(productId).catch((err) => { logger.error(`_sendBriefingToSlack failed for ${productId}: ${err}`); });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`generateBriefing failed for ${productId}: ${msg}`, { productId });
    }
  }

  logger.info(`generateBriefingsForAllProducts complete. Generated: ${generated}/${result.rows.length}`);
}

// ─── Internal: Slack Briefing Delivery ────────────────────────────────────────

async function _sendBriefingToSlack(productId: string): Promise<void> {
  try {
    const { sendAgentBriefing, isSlackConnected } = await import('../integration/slack.js');
    const connected = await isSlackConnected(productId);
    if (!connected) return;

    // Load today's briefing
    const { query: dbQuery } = await import('../../db/client.js');
    const today = new Date().toISOString().slice(0, 10);
    const result = await dbQuery(
      `SELECT * FROM briefings WHERE product_id=? AND DATE(generated_at)=? ORDER BY generated_at DESC LIMIT 1`,
      [productId, today]
    );
    if (result.rows.length === 0) return;

    const row = result.rows[0] as Record<string, unknown>;
    const headline = (row.headline as string) ?? 'Daily briefing ready';
    const healthScore = Number(row.overall_health_score ?? 70);

    // Extract top 3 insights from agent contributions
    let keyPoints: string[] = [];
    try {
      const contribs = JSON.parse(row.agent_contributions as string || '[]') as Array<Record<string, unknown>>;
      keyPoints = contribs
        .sort((a, b) => (b.priority_score as number ?? 0) - (a.priority_score as number ?? 0))
        .slice(0, 3)
        .map(c => (c.contribution as string ?? '').slice(0, 120));
    } catch { /* non-fatal */ }

    await sendAgentBriefing(productId, {
      date: today,
      health_score: healthScore,
      headline,
      key_points: keyPoints.length > 0 ? keyPoints : ['Briefing generated — view in Foundry for details'],
    });
  } catch { /* non-fatal */ }
}
