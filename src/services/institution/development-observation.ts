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

/**
 * Checks about this company that are currently reporting failed.
 *
 * A LOG IS NOT A RECORD, AND THIS ONE WAS ONLY A LOG. When Foundry observes
 * that its own schema snapshot has drifted from the migrations that produce it,
 * the job writes `logger.warn(...)` and moves on. The observation itself IS
 * recorded — it lands as a `development_verification` signal event and feeds
 * Shadowing — but the FACT that a check about this company is failing right now
 * reached nobody. `every-gate-runs.test.ts` states the same lesson about job
 * failures in as many words: "a week in which the institution's loops threw on
 * every run looked exactly like a calm week on the page the founder reads."
 * That reasoning produced `job_health` and the loops-stopped card, and was not
 * applied here.
 *
 * LATEST PER CHECK, NOT EVERY FAILURE EVER. A check that failed on Tuesday and
 * passed on Wednesday is not failing; reporting it would make a fixed problem
 * permanent. The observation carries its own `observed_at`, which is the clock
 * that decides — not `created_at`, which records when the row was written.
 *
 * GENERIC BY CONSTRUCTION. Nothing here names Foundry. Any company with
 * development observations gets this surface; Foundry is simply the only
 * company that currently has any, because it is the only one whose repository
 * Foundry can independently see.
 */
export interface FailingSelfCheck {
  check: string;
  detail: string;
  observedAt: string;
}

export async function getFailingSelfChecks(productId: string): Promise<FailingSelfCheck[]> {
  const rows = await query(
    `SELECT payload_json FROM signal_events
      WHERE product_id = ? AND source = 'development_verification'
      ORDER BY datetime(json_extract(payload_json,'$.observed_at')) DESC, rowid DESC`,
    [productId],
  );

  const latest = new Map<string, FailingSelfCheck & { result: string }>();
  for (const row of rows.rows as unknown as Array<Record<string, unknown>>) {
    let payload: { check?: unknown; result?: unknown; detail?: unknown; observed_at?: unknown };
    try {
      payload = JSON.parse(String(row.payload_json)) as typeof payload;
    } catch {
      continue;
    }
    const check = String(payload.check ?? '');
    if (!check || latest.has(check)) continue;
    latest.set(check, {
      check,
      result: String(payload.result ?? ''),
      detail: String(payload.detail ?? ''),
      observedAt: String(payload.observed_at ?? ''),
    });
  }

  return [...latest.values()]
    .filter((c) => c.result === 'failed')
    .map(({ check, detail, observedAt }) => ({ check, detail, observedAt }));
}
