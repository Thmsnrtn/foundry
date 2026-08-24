// =============================================================================
// FOUNDRY — Independent development verification intake
//
// The single writer of development observations. It records what a check
// actually ran and what it actually reported, and knows nothing whatsoever
// about what anyone expected: this module has no parameter, query, or import
// that could reach an expectation, a responsibility, or a proposed change.
//
// It performs no repository mutation and executes no commands. Development
// work is carried out by the development environment; Foundry observes the
// result. Observing is not carrying, and a passing check is not permission.
// =============================================================================

import { createHash } from 'node:crypto';
import { query } from '../../db/client.js';

/**
 * The canonical event identity for one development fact. Derived only from
 * the check and its result, so an expectation and an observation agree on
 * naming without either being able to see the other.
 */
export function developmentEventType(check: string, result: string): string {
  return `development_verified:${check.trim()}:${result.trim()}`;
}

export interface DevelopmentObservation {
  id: string;
  eventType: string;
  check: string;
  result: string;
}

/**
 * Record one independently produced development fact as a canonical signal.
 *
 * Identity is content-derived, so re-recording the same fact converges on one
 * observation rather than inflating the evidence. `detail` carries the raw
 * reported output so the observation stays auditable rather than a bare
 * assertion that something passed.
 */
export async function recordDevelopmentObservation(input: {
  productId: string; check: string; result: string; detail: string; observedAt?: Date;
}): Promise<DevelopmentObservation> {
  const check = input.check.trim();
  const result = input.result.trim();
  if (!check || !result) throw new Error('development observation refused');
  const observedAt = (input.observedAt ?? new Date()).toISOString();

  const id = `devobs_${createHash('sha256')
    // NUL joins the fields so no field's content can forge a boundary. Escaped,
    // not a raw byte: a raw NUL makes git diff this file as binary.
    .update([input.productId, check, result, input.detail, observedAt].join('\u0000'))
    .digest('hex').slice(0, 32)}`;
  const eventType = developmentEventType(check, result);
  const severity = result === 'passed' ? 'low' : 'medium';

  await query(
    `INSERT OR IGNORE INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary,created_at)
     VALUES (?,?,'development_verification',?,?,?,?,datetime(?))`,
    [id, input.productId, eventType, severity,
      JSON.stringify({ check, result, detail: input.detail, observed_at: observedAt }),
      `${check} reported ${result}`, observedAt],
  );
  return { id, eventType, check, result };
}

/**
 * Every independent development observation for a product within a window.
 *
 * The window is supplied by the expectation, never by whoever wants a verdict,
 * so a favourable observation cannot be cherry-picked while a deviating one in
 * the same window is left unresolved.
 *
 * `from` is exclusive: evidence must genuinely follow the expectation it tests.
 * An observation that already existed cannot confirm a prediction made after
 * it. Where timestamp resolution makes ordering ambiguous the observation is
 * excluded, so the expectation stays unresolved rather than falsely confirmed.
 */
export async function getDevelopmentObservationsInWindow(
  productId: string, from: string, until: string | null,
): Promise<DevelopmentObservation[]> {
  const rows = (await query(
    `SELECT id,event_type,payload_json FROM signal_events
     WHERE product_id=? AND source='development_verification'
       AND datetime(created_at)>datetime(?)
       AND (? IS NULL OR datetime(created_at)<=datetime(?))
     ORDER BY created_at,rowid`,
    [productId, from, until, until],
  )).rows as Array<Record<string, unknown>>;

  return rows.map((row) => {
    const payload = JSON.parse(String(row.payload_json)) as { check?: string; result?: string };
    return {
      id: String(row.id), eventType: String(row.event_type),
      check: String(payload.check ?? ''), result: String(payload.result ?? ''),
    };
  });
}
