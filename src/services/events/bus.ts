// =============================================================================
// FOUNDRY — Real-Time Event Bus
// Event ingestion, rule-based routing, cascade chains, anomaly detection.
// =============================================================================

import { query } from '../../db/client.js';
import { sendProactiveMessage } from '../chat/coo.js';
import { nanoid } from 'nanoid';

export interface Event {
  source: string;
  event_type: string;
  severity: 'info' | 'warning' | 'critical';
  payload: Record<string, unknown>;
}

export interface EventRule {
  name: string;
  trigger_event_type: string;
  condition?: string; // JSON expression
  action_type: 'notify_coo' | 'create_stressor' | 'create_decision' | 'trigger_sync' | 'run_analysis';
  action_config: Record<string, unknown>;
}

/**
 * Ingest an event into the stream and process it through rules.
 */
export async function ingestEvent(productId: string, event: Event): Promise<{
  event_id: string;
  cascades_triggered: string[];
}> {
  const eventId = nanoid();
  const cascades: string[] = [];

  // Persist event
  await query(
    `INSERT INTO event_stream (id, product_id, source, event_type, severity, payload)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [eventId, productId, event.source, event.event_type, event.severity, JSON.stringify(event.payload)]
  );

  // Run anomaly detection
  const anomaly = await detectAnomaly(productId, event);
  if (anomaly) {
    cascades.push(`anomaly:${anomaly.id}`);
    // Escalate anomaly severity to the event
    if (anomaly.deviation_sigma > 3) event.severity = 'critical';
  }

  // Process through rules
  const rules = await query(
    `SELECT * FROM event_rules WHERE product_id = ? AND trigger_event_type = ? AND active = 1`,
    [productId, event.event_type]
  );

  for (const row of rules.rows as unknown as Array<Record<string, unknown>>) {
    const rule = row;

    // Evaluate condition if present
    if (rule.condition) {
      const conditionMet = evaluateCondition(rule.condition as string, event.payload);
      if (!conditionMet) continue;
    }

    const actionType = rule.action_type as string;
    const actionConfig = JSON.parse(rule.action_config as string) as Record<string, unknown>;

    try {
      await executeRuleAction(productId, actionType, actionConfig, event);
      cascades.push(`rule:${rule.id}:${actionType}`);

      // Update times_fired
      await query('UPDATE event_rules SET times_fired = times_fired + 1 WHERE id = ?', [rule.id]);
    } catch { /* Continue processing other rules */ }
  }

  // Critical events always notify COO
  if (event.severity === 'critical') {
    const product = await query('SELECT owner_id, name FROM products WHERE id = ?', [productId]);
    const p = product.rows[0] as Record<string, string> | undefined;
    if (p) {
      const message = `🔴 Critical event: ${event.event_type} from ${event.source}. ${summarizePayload(event.payload)}`;
      await sendProactiveMessage(p.owner_id, productId, message);
      cascades.push('coo_notified');
    }
  }

  // Mark event as processed
  await query(
    'UPDATE event_stream SET processed = 1, cascades_triggered = ? WHERE id = ?',
    [JSON.stringify(cascades), eventId]
  );

  return { event_id: eventId, cascades_triggered: cascades };
}

/**
 * Create an event rule.
 */
export async function createEventRule(
  productId: string,
  ownerId: string,
  rule: EventRule
): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO event_rules (id, product_id, owner_id, name, trigger_event_type, condition, action_type, action_config)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, productId, ownerId, rule.name, rule.trigger_event_type, rule.condition ?? null, rule.action_type, JSON.stringify(rule.action_config)]
  );
  return id;
}

/**
 * Detect statistical anomalies in the event stream.
 */
async function detectAnomaly(productId: string, event: Event): Promise<{
  id: string;
  deviation_sigma: number;
} | null> {
  // Only check numeric payload values
  const numericKeys = Object.entries(event.payload).filter(([, v]) => typeof v === 'number');
  if (numericKeys.length === 0) return null;

  for (const [key, value] of numericKeys) {
    // Get historical values for this metric
    const history = await query(
      `SELECT json_extract(payload, ?) as val FROM event_stream
       WHERE product_id = ? AND event_type = ? AND created_at > datetime('now', '-30 days')
       ORDER BY created_at DESC LIMIT 100`,
      [`$.${key}`, productId, event.event_type]
    );

    const values = (history.rows as unknown as Array<Record<string, number>>)
      .map((r) => r.val)
      .filter((v) => v !== null && v !== undefined);

    if (values.length < 10) continue;

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) continue;

    const deviation = Math.abs((value as number) - mean) / stdDev;

    if (deviation > 2.5) {
      const anomalyId = nanoid();
      await query(
        `INSERT INTO anomalies (id, product_id, metric_name, expected_value, actual_value, deviation_sigma, description)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          anomalyId, productId, `${event.event_type}.${key}`,
          mean, value, deviation,
          `${key} is ${deviation.toFixed(1)}σ from mean (expected ~${mean.toFixed(1)}, got ${value})`,
        ]
      );
      return { id: anomalyId, deviation_sigma: deviation };
    }
  }

  return null;
}

/**
 * Execute a rule action.
 */
async function executeRuleAction(
  productId: string,
  actionType: string,
  config: Record<string, unknown>,
  event: Event
): Promise<void> {
  switch (actionType) {
    case 'notify_coo': {
      const product = await query('SELECT owner_id FROM products WHERE id = ?', [productId]);
      const ownerId = (product.rows[0] as Record<string, string>)?.owner_id;
      if (ownerId) {
        const message = (config.message_template as string ?? `Event: ${event.event_type}`)
          .replace('{event_type}', event.event_type)
          .replace('{source}', event.source);
        await sendProactiveMessage(ownerId, productId, message);
      }
      break;
    }
    case 'create_stressor': {
      await query(
        `INSERT INTO stressor_history (id, product_id, stressor_name, signal, timeframe_days, neutralizing_action, severity, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
        [
          nanoid(), productId,
          config.stressor_name as string ?? event.event_type,
          summarizePayload(event.payload),
          config.timeframe_days as number ?? 30,
          config.neutralizing_action as string ?? 'Investigate this event.',
          event.severity === 'critical' ? 'critical' : 'elevated',
        ]
      );
      break;
    }
    default:
      break;
  }
}

/**
 * Evaluate a simple JSON condition against event data.
 */
function evaluateCondition(condition: string, payload: Record<string, unknown>): boolean {
  try {
    const parsed = JSON.parse(condition) as Record<string, unknown>;
    for (const [key, expected] of Object.entries(parsed)) {
      if (payload[key] !== expected) return false;
    }
    return true;
  } catch {
    return true; // If condition parsing fails, allow the rule to fire
  }
}

function summarizePayload(payload: Record<string, unknown>): string {
  const entries = Object.entries(payload).slice(0, 5);
  return entries.map(([k, v]) => `${k}: ${v}`).join(', ');
}

/**
 * Get recent events for a product.
 */
export async function getRecentEvents(productId: string, limit: number = 50): Promise<Array<Record<string, unknown>>> {
  const result = await query(
    'SELECT * FROM event_stream WHERE product_id = ? ORDER BY created_at DESC LIMIT ?',
    [productId, limit]
  );
  return result.rows as unknown as Array<Record<string, unknown>>;
}

/**
 * Get active anomalies for a product.
 */
export async function getActiveAnomalies(productId: string): Promise<Array<Record<string, unknown>>> {
  const result = await query(
    "SELECT * FROM anomalies WHERE product_id = ? AND status = 'active' ORDER BY deviation_sigma DESC",
    [productId]
  );
  return result.rows as unknown as Array<Record<string, unknown>>;
}
