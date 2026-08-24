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

import { nanoid } from 'nanoid';
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

/**
 * Record one sync attempt, in the vocabulary `getSyncHealth` above reads.
 *
 * THE SIX EVENT SYNCS NEVER WROTE THIS TABLE. `syncSentryEvents`,
 * `syncLinearEvents`, `syncIntercomEvents`, `syncSlackEvents`,
 * `syncPostHogEvents` and `syncGitHubEvents` each update
 * `integrations.last_synced_at` and `last_error` — the three columns the header
 * of this file describes as the ones that "describe THIS MOMENT and forget
 * everything before it", and the reason `integration_sync_log` exists.
 *
 * So the integrations page, which is careful and right, told the founder "No
 * sync has been attempted in the last 7 days" about integrations Foundry had
 * been syncing every two hours. `getSyncHealth`'s own contract says an absent
 * entry means no attempt was RECORDED and must be said as such — it was, and
 * the sentence was still false, because the writer was missing rather than the
 * attempt.
 *
 * `last_error` was equally invisible: the page shows it only when `status` is
 * 'error', and none of the six touches `status`. A sync failing every night set
 * a column nothing rendered.
 *
 * Written from the JOB rather than inside each module, because both jobs in
 * `jobs/index.ts` are the only callers of all six, and the job is also where
 * the `error` those functions return was being discarded.
 *
 * An integration that is not connected has no attempt to record: the sync
 * returned zero for that reason, and inventing a row would make "no integration"
 * look like a sync that found nothing.
 */
export async function recordSyncAttempt(input: {
  productId: string;
  /** `integrations.name` — what the six modules look themselves up by. */
  provider: string;
  /** ISO timestamp taken before the sync ran. */
  startedAt: string;
  recordsProcessed: number;
  error?: string | null;
}): Promise<void> {
  const row = (await query(
    'SELECT id FROM integrations WHERE product_id = ? AND name = ?',
    [input.productId, input.provider],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!row) return;

  await query(
    `INSERT INTO integration_sync_log
       (id, integration_id, product_id, started_at, completed_at, status,
        records_processed, error_message)
     VALUES (?, ?, ?, datetime(?), CURRENT_TIMESTAMP, ?, ?, ?)`,
    [
      nanoid(), String(row.id), input.productId, input.startedAt,
      input.error ? 'failed' : 'success',
      input.recordsProcessed,
      input.error ?? null,
    ],
  );
}
