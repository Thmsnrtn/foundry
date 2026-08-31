// =============================================================================
// FOUNDRY — Real-Time Event Bus
// Event ingestion, rule-based routing, cascade chains, anomaly detection.
// =============================================================================

import { query } from '../../db/client.js';
import { log } from '../../lib/logger.js';
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
  action_type: RuleActionType;
  action_config: Record<string, unknown>;
}

/**
 * The actions a rule can take — the ones that exist.
 *
 * This union used to read
 *   'notify_coo' | 'create_stressor' | 'create_decision' | 'trigger_sync' | 'run_analysis'
 * and the switch below implemented two of the five. The other three fell to
 * `default: break`, which returns normally — so a rule set to create a
 * decision, trigger a sync or run an analysis did nothing at all, was counted
 * in `cascades_triggered` as having fired, and incremented `times_fired`. A
 * founder watching that number would have seen their automation working.
 *
 * A type that names capabilities the code does not have is not documentation
 * of an intention. It is the thing that stops anybody noticing the gap.
 */
export type RuleActionType = 'notify_coo' | 'create_stressor';

/** What a rule trigger actually did. None of these values means "it helped" —
 * only that the configured action ran, or did not. */
export type RuleActionOutcome = 'carried_out' | 'unsupported_action' | 'failed';

/** The runtime companion to `RuleActionType`, so creation can refuse what
 * firing cannot do. */
export const SUPPORTED_RULE_ACTIONS: ReadonlySet<string> =
  new Set<RuleActionType>(['notify_coo', 'create_stressor']);

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
  const anomaly = await detectAnomaly(productId, eventId, event);
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

    // `times_fired` is the number a founder reads to decide whether a rule is
    // working. It used to increment for a rule that did nothing, and the catch
    // below — "continue processing other rules" — meant a rule that threw was
    // invisible to everybody: not in the cascades, not in the count, not in
    // the log. Other rules should indeed still run. Silence was the mistake.
    let outcome: RuleActionOutcome;
    try {
      outcome = await executeRuleAction(productId, actionType, actionConfig, event);
    } catch (err) {
      outcome = 'failed';
      log.error('event_rule.action_failed', {
        productId, ruleId: String(rule.id), actionType, error: (err as Error).message,
      });
    }

    if (outcome === 'carried_out') {
      cascades.push(`rule:${rule.id}:${actionType}`);
      await query('UPDATE event_rules SET times_fired = times_fired + 1 WHERE id = ?', [rule.id]);
    } else {
      // Recorded on the event, so an operator reading what this event caused
      // can see the rules that were supposed to act and did not.
      cascades.push(`rule_not_carried_out:${rule.id}:${actionType}:${outcome}`);
      if (outcome === 'unsupported_action') {
        log.warn('event_rule.action_unsupported', {
          productId, ruleId: String(rule.id), actionType,
        });
      }
    }
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
  // Fail closed at the door. A rule whose action has no implementation can
  // only ever be a rule that does nothing, and the moment to say so is when
  // somebody creates it — not silently, once per event, forever after.
  if (!SUPPORTED_RULE_ACTIONS.has(rule.action_type)) {
    throw new Error(`unsupported rule action: ${rule.action_type}`);
  }
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
 *
 * A POINT WAS PART OF ITS OWN BASELINE, WHICH PUT A CEILING ON HOW ANOMALOUS
 * ANYTHING COULD BE. The event is written to `event_stream` before detection
 * runs, and the history query took the last 100 events of this type — so the
 * value being tested was included in the mean and the standard deviation it
 * was then compared against. That is not a small bias. For a run of n values
 * where one departs from the rest, the deviation this arithmetic can report is
 * at most √(n − 1), no matter how extreme the departure: at the minimum n = 10
 * a metric that went to infinity would score 3.0σ, and `deviation_sigma > 3`
 * — the branch that escalates an event to critical — could not be reached at
 * all. `excludeEventId` takes the point back out of its own baseline, and the
 * ten-observation floor now means ten observations that are not this one.
 *
 * Two more corrections in the same arithmetic:
 *
 *   The spread is estimated from a sample of history, not from a population,
 *   so it divides by n − 1. The n divisor understates σ and every deviation
 *   computed from it was correspondingly overstated.
 *
 *   `typeof v === 'number'` was checked on the incoming payload and never on
 *   the history. One historical row carrying a string under that key made
 *   `mean` a concatenation, every deviation `NaN`, and `NaN > 2.5` false — so
 *   a single bad value silently switched anomaly detection off for that metric
 *   and left no trace of having done so.
 */
async function detectAnomaly(productId: string, excludeEventId: string, event: Event): Promise<{
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
       WHERE product_id = ? AND event_type = ? AND id != ?
         AND created_at > datetime('now', '-30 days')
       ORDER BY created_at DESC LIMIT 100`,
      [`$.${key}`, productId, event.event_type, excludeEventId]
    );

    const values = (history.rows as unknown as Array<Record<string, unknown>>)
      .map((r) => r.val)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

    if (values.length < 10) continue;

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
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
): Promise<RuleActionOutcome> {
  switch (actionType) {
    case 'notify_coo': {
      const product = await query('SELECT owner_id FROM products WHERE id = ?', [productId]);
      const ownerId = (product.rows[0] as Record<string, string>)?.owner_id;
      if (ownerId) {
        const message = (config.message_template as string ?? `Event: ${event.event_type}`)
          .replace('{event_type}', event.event_type)
          .replace('{source}', event.source);
        await sendProactiveMessage(ownerId, productId, message);
        return 'carried_out';
      }
      // No owner to message. Nothing was done, and saying otherwise would put
      // this rule in the cascade list for an effect that never happened.
      return 'unsupported_action';
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
      return 'carried_out';
    }
    default:
      // An action type with no implementation. This used to `break` and return
      // normally, which is indistinguishable from having done the work.
      return 'unsupported_action';
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
    // FAIL CLOSED. This used to return true — "if condition parsing fails,
    // allow the rule to fire" — so a rule whose condition was malformed fired
    // on EVERY matching event instead of the narrow set it was written for.
    // The condition is the whole reason the rule is not unconditional; losing
    // it is the one outcome that must not follow from a broken one.
    log.warn('event_rule.condition_unparseable', { condition: condition.slice(0, 200) });
    return false;
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
