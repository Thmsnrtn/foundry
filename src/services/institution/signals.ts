// =============================================================================
// FOUNDRY — a company signal, recorded
//
// The single door into responsibility discovery: the company reporting
// something about itself (`founder/company-report.ts`) is its one caller, by
// design, and `discovery-is-not-reachable-from-integrations.test.ts` holds that
// boundary.
//
// This used to live in `scp/events/dispatcher.ts`, beside a map from event
// types to the named agents that should look at each one. No agent was ever run
// that way — the report's event types were never keys in the map — and the
// agents were retired by the owner's decision on 30 September 2026 (PENDING 16,
// Roadmap 2027 R9). What is kept is the half that was always real: the row, and
// discovery asked of it.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { logger } from '../logger.js';

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
  await query(
    `INSERT INTO signal_events (id, product_id, source, event_type, severity, payload_json, summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [id, productId, event.source, event.event_type, event.severity, JSON.stringify(event.payload), event.summary],
  );

  // Admit only evidence kinds with a stable responsibility contract. Failure
  // leaves the signal canonical and retryable; it never erases company truth.
  try {
    const { discoverResponsibilityFromSignal } = await import('./discovery.js');
    await discoverResponsibilityFromSignal(productId, id);
  } catch (err) {
    logger.error(`responsibility discovery failed for signal ${id}: ${err instanceof Error ? err.message : String(err)}`, { productId });
  }
  return id;
}
