// =============================================================================
// FOUNDRY — Integration Sync Health
//
// `integration_sync_log` had every attempt written into it and no reader. The
// only integration health a founder could see was on `integrations` itself:
// `status`, `last_synced_at`, and `last_error` — three columns that describe
// THIS MOMENT and forget everything before it.
//
// So an integration that fails four nights in five and succeeds on the fifth
// showed a green "Connected" badge, a recent sync time, and no error at all,
// because the successful run cleared `last_error`. Foundry's numbers were four
// days stale most of the time and the page said everything was fine.
//
// ONE TABLE, TWO WRITERS, TWO VOCABULARIES. `sync.ts` writes `status`
// ('running' | 'success' | 'partial' | 'failed') and `error_message`.
// `framework.ts` writes `provider`, `sync_type`, `duration_ms` and `errors` (a
// JSON array), and leaves `status` NULL. Migration 056 reconciled the two
// declarations of the table into one; nothing reconciled the two ways of
// writing to it. A reader that trusted `status` alone would report every
// framework-path sync as neither succeeded nor failed.
//
// So success is derived, not read: a row succeeded if it finished and recorded
// no error, by either writer's spelling.
// =============================================================================

import { query } from '../../db/client.js';

export interface SyncHealth {
  /** Attempts recorded in the window. Zero means no sync ran, not that all was well. */
  attempts: number;
  succeeded: number;
  failed: number;
  /** Still marked running — a sync that started and never recorded an end. */
  unfinished: number;
  /** ISO timestamp of the most recent attempt that succeeded, or null. */
  last_success_at: string | null;
  /** ISO timestamp of the most recent attempt that failed, or null. */
  last_failure_at: string | null;
}

export const SYNC_HEALTH_WINDOW_DAYS = 7;

/**
 * Sync attempt history per integration id, over the trailing window.
 *
 * Returns an entry only for integrations that attempted a sync in the window.
 * A caller must treat an absent entry as "no attempt recorded" and say so —
 * not as a clean bill of health.
 */
export async function getSyncHealth(
  productId: string,
  windowDays: number = SYNC_HEALTH_WINDOW_DAYS,
): Promise<Map<string, SyncHealth>> {
  const rows = (await query(
    `SELECT integration_id, status, error_message, errors, completed_at, started_at
       FROM integration_sync_log
      WHERE product_id = ?
        AND started_at >= datetime('now', ?)
      ORDER BY started_at ASC`,
    [productId, `-${windowDays} days`],
  )).rows as unknown as Array<Record<string, unknown>>;

  const out = new Map<string, SyncHealth>();

  for (const r of rows) {
    const id = String(r.integration_id);
    let h = out.get(id);
    if (!h) {
      h = { attempts: 0, succeeded: 0, failed: 0, unfinished: 0,
            last_success_at: null, last_failure_at: null };
      out.set(id, h);
    }

    h.attempts += 1;

    const finished = r.completed_at != null;
    // Either writer's spelling of "something went wrong".
    const errored = String(r.status ?? '') === 'failed'
      || r.error_message != null
      || (r.errors != null && String(r.errors).length > 0);
    const at = String(r.completed_at ?? r.started_at ?? '');

    if (!finished && !errored) {
      h.unfinished += 1;
    } else if (errored) {
      h.failed += 1;
      h.last_failure_at = at;
    } else {
      h.succeeded += 1;
      h.last_success_at = at;
    }
  }

  return out;
}
