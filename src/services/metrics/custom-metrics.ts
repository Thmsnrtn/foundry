// =============================================================================
// FOUNDRY — one column, three writers, one of which read it first
//
// `metric_snapshots.custom_metrics` is a JSON object holding everything that is
// not a named metric column. THREE LIVE PATHS WROTE IT AND TWO OF THEM WROTE
// WHOLESALE:
//
//   integrations/linear.ts     read the day's value, merged its two keys in,
//                              wrote the result. The correct pattern, and the
//                              only one doing it.
//   integrations/framework.ts  wrote `{commits_7d, deploys_recent}` over
//                              whatever was there. Runs hourly
//                              (`scp_integration_fabric_sync`).
//   routes/ingest/index.ts     wrote the caller's `custom` object over
//                              whatever was there. Runs whenever the founder's
//                              pipeline posts.
//
// So for a company with a GitHub integration and a Linear integration,
// `custom_metrics.linear_velocity_7d` was destroyed within the hour, every
// hour — while `syncLinearMetrics` returned `metricsUpdated:
// ['custom_metrics.linear_velocity_7d']` and the sync log recorded a success.
// Add a founder pipeline posting `custom` and all three took turns, so what a
// company could read back was decided by which writer ran last.
//
// The merge belongs in one place, and so does the bound. Merging without
// re-bounding would turn the ingest door's twenty-key cap into an unbounded
// growth path — twenty new keys per request, forever — which is why the stored
// object has its own ceiling and it is checked after the merge, not before.
//
// TWO CAPS, BECAUSE THEY ANSWER DIFFERENT QUESTIONS. `MAX_CUSTOM_METRIC_KEYS`
// bounds what one public request may carry. `MAX_STORED_CUSTOM_KEYS` bounds
// what the row may hold once the integrations have added their handful, and is
// deliberately larger: a founder using their whole allowance should not be the
// reason a Linear sync starts failing.
// =============================================================================

import { query } from '../../db/client.js';

/** What a single ingest body may carry. Both halves of this pair are the
 *  PUBLIC-DOOR bound from the 2026-07-13 security close-out, and neither may
 *  be relaxed by the merge: splitting the key cap in two and forgetting to
 *  split the byte cap raised a public limit from 8KB to 16KB, which
 *  `security-closeout.test.ts` caught on the next full run. A cap on what one
 *  request may send and a cap on what the row may hold are different
 *  quantities; when one is split, every one of them is. */
export const MAX_CUSTOM_METRIC_KEYS = 20;
export const MAX_CUSTOM_METRIC_BYTES = 8_192;
/** What the stored object may hold, after the named integrations add theirs. */
export const MAX_STORED_CUSTOM_KEYS = 32;
export const MAX_STORED_CUSTOM_BYTES = 16_384;

export type CustomMetricsMerge =
  | { merged: Record<string, unknown>; json: string }
  | { refused: string };

/**
 * The day's stored custom metrics with `patch` applied over them. Returns the
 * merged object and its JSON for the caller to write in its own statement —
 * the caller does the write so each writer keeps a single upsert, and so a
 * refusal happens before anything is written rather than after.
 */
export async function mergeCustomMetrics(
  productId: string,
  snapshotDate: string,
  patch: Record<string, unknown>,
): Promise<CustomMetricsMerge> {
  const existingResult = await query(
    'SELECT custom_metrics FROM metric_snapshots WHERE product_id = ? AND snapshot_date = ?',
    [productId, snapshotDate],
  );
  const row = existingResult.rows[0] as unknown as Record<string, unknown> | undefined;

  let stored: Record<string, unknown> = {};
  if (row?.custom_metrics) {
    try {
      const decoded: unknown = JSON.parse(String(row.custom_metrics));
      // A malformed or non-object value is not a reason to lose the patch, and
      // not a reason to pretend it held keys. It is replaced, and the caller
      // learns nothing it could act on either way.
      if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
        stored = decoded as Record<string, unknown>;
      }
    } catch {
      stored = {};
    }
  }

  const merged = { ...stored, ...patch };
  const json = JSON.stringify(merged);

  if (Object.keys(merged).length > MAX_STORED_CUSTOM_KEYS) {
    return {
      refused: `custom metrics would hold ${Object.keys(merged).length} keys; `
        + `the stored limit is ${MAX_STORED_CUSTOM_KEYS}`,
    };
  }
  if (json.length > MAX_STORED_CUSTOM_BYTES) {
    return {
      refused: `custom metrics would be ${json.length} bytes; `
        + `the stored limit is ${MAX_STORED_CUSTOM_BYTES}`,
    };
  }

  return { merged, json };
}
