// =============================================================================
// FOUNDRY — PostHog Integration
// Pull activation rates, feature adoption, session depth, and retention
// from PostHog Project Query API → updates metric_snapshots.
// =============================================================================

import { query } from '../../db/client.js';
import { invalidateSignalCache } from '../signal.js';
import { nanoid } from 'nanoid';

interface PostHogCredentials {
  api_key: string;        // Private project API key (not the public one)
  project_id: string;
  host?: string;          // Defaults to app.posthog.com
}

interface PostHogConfig {
  activation_event: string;  // e.g. "user_activated", "first_workflow_created"
  active_user_event?: string; // Event that counts as "active" — defaults to '$pageview'
  retention_event?: string;   // Event that indicates retained user
}

interface PostHogInsightResult {
  result?: Array<{ action?: { id: string }; count: number; data: number[] }>;
  results?: unknown[];
}

// ─── Core Sync Function ───────────────────────────────────────────────────────

export async function syncPostHogMetrics(
  productId: string,
  integrationId: string,
  credentials: PostHogCredentials,
  config: PostHogConfig,
): Promise<{ metricsUpdated: string[]; recordsProcessed: number }> {
  const host = credentials.host ?? 'https://app.posthog.com';
  const headers = {
    'Authorization': `Bearer ${credentials.api_key}`,
    'Content-Type': 'application/json',
  };

  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // A RATE MADE OF TWO DIFFERENT WINDOWS.
  //
  // `activation_rate` was `activations over THIRTY days / signups over SEVEN`,
  // and then `Math.max(signups, activated)` in the denominator to stop it
  // exceeding 1. For any company with steady growth the thirty-day numerator is
  // larger than the seven-day denominator, so the max fires, the two cancel, and
  // the rate is EXACTLY 1.0000 — a hundred percent activation, recorded for
  // essentially every healthy company, and read from there by the board deck,
  // the value delivery index and the portfolio benchmark percentiles.
  //
  // The clamp is what hid it. Without it the number would have been 3.2 and
  // somebody would have asked.
  //
  // Signups are fetched over both windows now: the seven-day count is what
  // `signups_7d` means and is kept, and the thirty-day count is the denominator
  // for a thirty-day numerator.
  const [signupsResult, signups30Result, activationResult, activeUsersResult, retentionResult] =
    await Promise.allSettled([
      fetchPostHogCount(host, headers, credentials.project_id, '$identify', sevenDaysAgo, today),
      fetchPostHogCount(host, headers, credentials.project_id, '$identify', thirtyDaysAgo, today),
      fetchPostHogCount(host, headers, credentials.project_id, config.activation_event, thirtyDaysAgo, today),
      fetchPostHogCount(host, headers, credentials.project_id, config.active_user_event ?? '$pageview', sevenDaysAgo, today),
      fetchPostHogRetention(host, headers, credentials.project_id, config.retention_event ?? config.activation_event, thirtyDaysAgo, today),
    ]);

  const columns: string[] = [];
  const values: (number | null)[] = [];

  if (signupsResult.status === 'fulfilled' && signupsResult.value !== null) {
    columns.push('signups_7d');
    values.push(signupsResult.value);
  }

  if (activationResult.status === 'fulfilled' && signups30Result.status === 'fulfilled') {
    const activated = activationResult.value;
    const signups30 = signups30Result.value;
    // Both counts, both over thirty days. This is a PERIOD RATIO, not a cohort
    // rate: the people who activated are not necessarily the people who signed
    // up in the window. It is the closest honest thing these two counts can say,
    // and it is what the column has always been fed.
    //
    // A ratio above 1 means more people activated than signed up in the same
    // thirty days — real, and it says the two events are not in the relationship
    // this column assumes. Nothing is written for that company rather than
    // recording a hundred percent, which is what the old clamp did.
    if (activated !== null && signups30 !== null && signups30 > 0 && activated <= signups30) {
      columns.push('activation_rate');
      values.push(parseFloat((activated / signups30).toFixed(4)));
    }
  }

  if (activeUsersResult.status === 'fulfilled' && activeUsersResult.value !== null) {
    columns.push('active_users');
    values.push(activeUsersResult.value);
  }

  if (retentionResult.status === 'fulfilled' && retentionResult.value !== null) {
    columns.push('day_30_retention');
    values.push(retentionResult.value);
  }

  if (columns.length > 0) {
    const setClause = columns.map((c) => `${c} = ?`).join(', ');
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, ${columns.join(', ')})
       VALUES (?, ?, ?, ${columns.map(() => '?').join(', ')})
       ON CONFLICT(product_id, snapshot_date) DO UPDATE SET ${setClause}`,
      [nanoid(), productId, today, ...values, ...values],
    );
    invalidateSignalCache(productId);
  }

  await query(
    `UPDATE integrations SET last_synced_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?`,
    [integrationId],
  );

  return { metricsUpdated: columns, recordsProcessed: columns.length };
}

// ─── PostHog API Helpers ──────────────────────────────────────────────────────

async function fetchPostHogCount(
  host: string,
  headers: Record<string, string>,
  projectId: string,
  eventName: string,
  dateFrom: string,
  dateTo: string,
): Promise<number | null> {
  const url = `${host}/api/projects/${projectId}/insights/trend/?` + new URLSearchParams({
    events: JSON.stringify([{ id: eventName, math: 'unique_group', math_group_type_index: 0 }]),
    date_from: dateFrom,
    date_to: dateTo,
    display: 'ActionsTable',
  });

  try {
    // `host` is founder-configured, so this URL is founder-supplied. The
    // canonical guarded path screens it AND re-screens every redirect hop,
    // because the server at the far end chooses those.
    const { safeFetch } = await import('../outbound/ssrf.js');
    const response = await safeFetch(url, { headers });
    if (!response.ok) return null;
    const data = await response.json() as PostHogInsightResult;
    if (!data.result?.length) return null;
    return data.result.reduce((sum, r) => sum + (r.count ?? 0), 0);
  } catch {
    return null;
  }
}

async function fetchPostHogRetention(
  host: string,
  headers: Record<string, string>,
  projectId: string,
  targetEvent: string,
  dateFrom: string,
  dateTo: string,
): Promise<number | null> {
  const url = `${host}/api/projects/${projectId}/insights/retention/?` + new URLSearchParams({
    target_entity: JSON.stringify({ id: targetEvent, type: 'events' }),
    returning_entity: JSON.stringify({ id: targetEvent, type: 'events' }),
    period: 'Day',
    retention_type: 'retention_recurring',
    date_from: dateFrom,
    date_to: dateTo,
    total_intervals: '31',
  });

  try {
    // `host` is founder-configured, so this URL is founder-supplied. The
    // canonical guarded path screens it AND re-screens every redirect hop,
    // because the server at the far end chooses those.
    const { safeFetch } = await import('../outbound/ssrf.js');
    const response = await safeFetch(url, { headers });
    if (!response.ok) return null;
    const data = await response.json() as { result?: Array<{ values: Array<{ count: number }> }> };
    if (!data.result?.length) return null;

    // Day 30 retention = percentage of cohort that returned on day 30
    const cohort = data.result[0];
    if (!cohort?.values?.length || cohort.values[0].count === 0) return null;
    const day30 = cohort.values[30]?.count ?? 0;
    return parseFloat((day30 / cohort.values[0].count).toFixed(4));
  } catch {
    return null;
  }
}

