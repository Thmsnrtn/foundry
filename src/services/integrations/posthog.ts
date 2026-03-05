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

  const [signupsResult, activationResult, activeUsersResult, retentionResult] = await Promise.allSettled([
    fetchPostHogCount(host, headers, credentials.project_id, '$identify', sevenDaysAgo, today),
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

  if (activationResult.status === 'fulfilled' && signupsResult.status === 'fulfilled') {
    const activated = activationResult.value ?? 0;
    const signups = signupsResult.value ?? 0;
    if (signups > 0) {
      columns.push('activation_rate');
      values.push(parseFloat((activated / Math.max(signups, activated)).toFixed(4)));
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
    const response = await fetch(url, { headers });
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
    const response = await fetch(url, { headers });
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
