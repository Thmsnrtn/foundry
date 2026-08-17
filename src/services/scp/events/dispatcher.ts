// =============================================================================
// FOUNDRY — Signal Event Dispatcher
// Event-driven agent activation: emit signals, trigger targeted agent runs
// within minutes of high-severity events arriving.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';
import { logger } from '../../logger.js';
import { isLoadableAgentName } from '../types.js';

// Maps event types to the agents best positioned to analyze them
const EVENT_AGENT_MAP: Record<string, string[]> = {
  churn_detected:           ['harbor', 'forge', 'oracle'],
  expansion_signal:         ['forge', 'harbor'],
  nps_drop:                 ['harbor', 'prism', 'oracle'],
  activation_failure:       ['prism', 'harbor', 'atlas'],
  revenue_milestone:        ['ledger', 'forge', 'compass'],
  competitor_signal:        ['beacon', 'compass'],
  support_spike:            ['harbor', 'sentinel', 'prism'],
  payment_failed:           ['ledger', 'forge'],
  performance_degradation:  ['sentinel', 'atlas'],
  experiment_result:        ['oracle', 'compass'],
};

// ─── emitSignalEvent ──────────────────────────────────────────────────────────

export async function emitSignalEvent(
  productId: string,
  event: {
    source: string;
    event_type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    payload: Record<string, unknown>;
    summary: string;
  },
): Promise<string> {
  const id = nanoid();
  const relevantAgents = EVENT_AGENT_MAP[event.event_type] ?? [];

  await query(
    `INSERT INTO signal_events
       (id, product_id, source, event_type, severity, payload_json, summary, relevant_agents_json, processed, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))`,
    [
      id,
      productId,
      event.source,
      event.event_type,
      event.severity,
      JSON.stringify(event.payload),
      event.summary,
      JSON.stringify(relevantAgents),
    ],
  );

  // Admit only evidence kinds with a stable responsibility contract. Failure
  // leaves the signal canonical and retryable; it never erases company truth.
  try {
    const { discoverResponsibilityFromSignal } = await import('../../institution/discovery.js');
    await discoverResponsibilityFromSignal(productId, id);
  } catch (err) {
    logger.error(`responsibility discovery failed for signal ${id}: ${err instanceof Error ? err.message : String(err)}`, { productId });
  }

  logger.info(
    `Signal emitted: ${event.event_type} (${event.severity}) for product ${productId} — id=${id}`,
    { productId },
  );

  // For high/critical severity: trigger processing immediately (fire-and-forget)
  if (event.severity === 'high' || event.severity === 'critical') {
    processSignalEvent(id).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`processSignalEvent(${id}) fire-and-forget failed: ${msg}`, { productId });
    });
  }

  return id;
}

// ─── processSignalEvent ───────────────────────────────────────────────────────

export async function processSignalEvent(eventId: string): Promise<void> {
  // Load the event record
  const eventResult = await query(
    `SELECT * FROM signal_events WHERE id = ?`,
    [eventId],
  );

  if (eventResult.rows.length === 0) {
    logger.warn(`processSignalEvent: event ${eventId} not found`);
    return;
  }

  const row = eventResult.rows[0] as Record<string, unknown>;

  // Skip if already processed
  if ((row.processed as number) === 1) {
    return;
  }

  const productId = row.product_id as string;
  const summary = row.summary as string;
  const eventType = row.event_type as string;
  const source = row.source as string;
  const severity = row.severity as string;

  let relevantAgents: string[] = [];
  try {
    // Narrowed to the closed vocabulary before any of it reaches `import()`.
    // These names were written by EVENT_AGENT_MAP, but they arrive here from a
    // database column, and a module specifier resolves paths — an unvalidated
    // stored string is a directory traversal waiting for a bad write.
    relevantAgents = (JSON.parse((row.relevant_agents_json as string) ?? '[]') as unknown[])
      .filter(isLoadableAgentName);
  } catch {
    relevantAgents = [];
  }

  if (relevantAgents.length === 0) {
    // Nothing to do — mark processed immediately
    await query(
      `UPDATE signal_events SET processed = 1, processed_at = datetime('now') WHERE id = ?`,
      [eventId],
    );
    return;
  }

  logger.info(
    `Processing signal ${eventId}: ${eventType} → agents [${relevantAgents.join(', ')}]`,
    { productId },
  );

  // Insert a synthetic integration event so each agent's context is enriched
  // with this signal when it runs. We insert once for the run context.
  let syntheticEventId: string | null = null;
  try {
    const { storeEvent } = await import('../../integration/fabric.js');
    syntheticEventId = await storeEvent(productId, {
      integration_name: source,
      event_type: eventType,
      actor_type: 'system',
      data: {
        signal_event_id: eventId,
        severity,
        summary,
        auto_triggered: true,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Could not insert synthetic integration event: ${msg}`, { productId });
  }

  // Track the last session id created (for linking)
  let lastSessionId: string | null = null;

  for (const agentName of relevantAgents) {
    try {
      // Dynamically import and run the agent
      const mod = await import(`../agents/${agentName}.js`) as Record<string, unknown>;

      // Agents export a default class instance or a named export matching the agent name
      // Convention: default export is the agent class or instance
      let agent: { run: (productId: string) => Promise<{ sessionId?: string }> } | null = null;

      if (mod.default && typeof (mod.default as { run?: unknown }).run === 'function') {
        agent = mod.default as { run: (productId: string) => Promise<{ sessionId?: string }> };
      } else {
        // Try to find a named export that has a run method
        for (const key of Object.keys(mod)) {
          const candidate = mod[key];
          if (
            candidate &&
            typeof candidate === 'object' &&
            typeof (candidate as { run?: unknown }).run === 'function'
          ) {
            agent = candidate as { run: (productId: string) => Promise<{ sessionId?: string }> };
            break;
          }
          // If the export is a class constructor, instantiate it
          if (typeof candidate === 'function') {
            try {
              const instance = new (candidate as new () => { run: (productId: string) => Promise<{ sessionId?: string }> })();
              if (typeof instance.run === 'function') {
                agent = instance;
                break;
              }
            } catch {
              // not a constructable class — skip
            }
          }
        }
      }

      if (!agent) {
        logger.warn(`Agent module '${agentName}' has no runnable export — skipping`, { productId, agentName });
        continue;
      }

      const output = await agent.run(productId);
      if (output?.sessionId) {
        lastSessionId = output.sessionId;
      }

      logger.info(`Agent '${agentName}' ran for signal ${eventId}`, { productId, agentName });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Agent '${agentName}' failed for signal ${eventId}: ${msg}`, { productId, agentName });
      // Non-fatal — continue with remaining agents
    }
  }

  // Clean up synthetic event if it was created (remove from integration_events
  // so it doesn't appear in normal agent context loads twice on next schedule)
  if (syntheticEventId) {
    try {
      await query(`DELETE FROM integration_events WHERE id = ?`, [syntheticEventId]);
    } catch {
      // Non-fatal cleanup
    }
  }

  // Mark signal event as processed
  await query(
    `UPDATE signal_events
     SET processed = 1, processed_at = datetime('now'), processing_session_id = ?
     WHERE id = ?`,
    [lastSessionId, eventId],
  );
}

// ─── processPendingSignalEvents ───────────────────────────────────────────────

export async function processPendingSignalEvents(productId: string): Promise<number> {
  const result = await query(
    `SELECT id FROM signal_events
     WHERE product_id = ? AND processed = 0
     ORDER BY created_at ASC`,
    [productId],
  );

  let count = 0;
  for (const row of result.rows) {
    const eventId = (row as Record<string, unknown>).id as string;
    try {
      await processSignalEvent(eventId);
      count++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`processPendingSignalEvents — event ${eventId} failed: ${msg}`, { productId });
    }
  }

  return count;
}

// ─── getSignalEvents ──────────────────────────────────────────────────────────

export async function getSignalEvents(
  productId: string,
  limit = 50,
): Promise<Array<Record<string, unknown>>> {
  const result = await query(
    `SELECT * FROM signal_events
     WHERE product_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [productId, limit],
  );

  return result.rows as Array<Record<string, unknown>>;
}

// ─── getUnprocessedCount ──────────────────────────────────────────────────────

export async function getUnprocessedCount(productId: string): Promise<number> {
  const result = await query(
    `SELECT COUNT(*) as cnt FROM signal_events
     WHERE product_id = ? AND processed = 0`,
    [productId],
  );

  const row = result.rows[0] as Record<string, number> | undefined;
  return row?.cnt ?? 0;
}
