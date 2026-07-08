// =============================================================================
// FOUNDRY — PostHog Integration
// Pulls behavioral analytics events and funnel data from PostHog API.
// Normalizes into integration_events for Oracle and Beacon agents.
// =============================================================================

import { query } from '../../db/client.js';
import { storeEvent, getIntegration } from './fabric.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PostHogInsight {
  result: Array<{ label: string; data: number[]; labels: string[] }>;
}

interface PostHogFunnelStep {
  action_id: string;
  name: string;
  count: number;
  average_conversion_time: number | null;
}

interface PostHogFunnelResult {
  result: PostHogFunnelStep[][];
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function isPostHogConnected(productId: string): Promise<boolean> {
  const integration = await getIntegration(productId, 'posthog');
  return integration?.status === 'active';
}

/**
 * Pull recent PostHog events and store as normalized integration_events.
 * Called by the hourly cron job.
 */
export async function syncPostHogEvents(productId: string): Promise<{ synced: number; error?: string }> {
  const integration = await getIntegration(productId, 'posthog');
  if (!integration || integration.status !== 'active') {
    return { synced: 0 };
  }

  const apiKey = integration.config_json.api_key as string | undefined;
  const host = (integration.config_json.host as string | undefined) ?? 'https://app.posthog.com';
  const projectId = integration.config_json.project_id as string | undefined;

  if (!apiKey) return { synced: 0, error: 'Missing PostHog API key' };

  let synced = 0;

  try {
    // Pull active users trend (last 7 days)
    const activeUsersData = await fetchPostHogTrend(host, apiKey, projectId, '$pageview', 7);
    if (activeUsersData) {
      await storeEvent(productId, {
        integration_name: 'posthog',
        event_type: 'active_users_trend',
        actor_type: 'system',
        data: activeUsersData,
      });
      synced++;
    }

    // Pull signup events (identify events)
    const signupData = await fetchPostHogTrend(host, apiKey, projectId, '$identify', 7);
    if (signupData) {
      await storeEvent(productId, {
        integration_name: 'posthog',
        event_type: 'signup_trend',
        actor_type: 'system',
        data: signupData,
      });
      synced++;
    }

    // Pull feature usage for top events
    const featureEvents = await fetchTopEvents(host, apiKey, projectId);
    if (featureEvents.length > 0) {
      await storeEvent(productId, {
        integration_name: 'posthog',
        event_type: 'feature_usage_summary',
        actor_type: 'system',
        data: { top_events: featureEvents },
      });
      synced++;
    }

    // Update last_synced_at
    await query(
      `UPDATE integrations SET last_synced_at=CURRENT_TIMESTAMP, last_error=NULL WHERE product_id=? AND name='posthog'`,
      [productId]
    );

    return { synced };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await query(
      `UPDATE integrations SET last_error=?, error_count_trailing_7d=error_count_trailing_7d+1 WHERE product_id=? AND name='posthog'`,
      [errorMsg, productId]
    );
    return { synced, error: errorMsg };
  }
}

/**
 * Get a summary of PostHog metrics for dashboard display.
 */
export async function getPostHogSummary(productId: string): Promise<{
  connected: boolean;
  activeUsers7d: number | null;
  signups7d: number | null;
  topEvents: Array<{ name: string; count: number }>;
}> {
  const integration = await getIntegration(productId, 'posthog');
  if (!integration || integration.status !== 'active') {
    return { connected: false, activeUsers7d: null, signups7d: null, topEvents: [] };
  }

  // Read from recent stored events
  const eventsResult = await query(
    `SELECT event_type, data_json FROM integration_events
     WHERE product_id=? AND integration_name='posthog'
       AND created_at >= datetime('now', '-25 hours')
     ORDER BY created_at DESC`,
    [productId]
  );

  let activeUsers7d: number | null = null;
  let signups7d: number | null = null;
  let topEvents: Array<{ name: string; count: number }> = [];

  for (const row of eventsResult.rows as Record<string, unknown>[]) {
    const data = (() => { try { return JSON.parse(row.data_json as string || '{}'); } catch { return {}; } })();
    if (row.event_type === 'active_users_trend' && data.total !== undefined) {
      activeUsers7d = Number(data.total) || null;
    }
    if (row.event_type === 'signup_trend' && data.total !== undefined) {
      signups7d = Number(data.total) || null;
    }
    if (row.event_type === 'feature_usage_summary' && Array.isArray(data.top_events)) {
      topEvents = data.top_events.slice(0, 5);
    }
  }

  return { connected: true, activeUsers7d, signups7d, topEvents };
}

// ─── Internal API helpers ─────────────────────────────────────────────────────

async function fetchPostHogTrend(
  host: string,
  apiKey: string,
  projectId: string | undefined,
  eventName: string,
  days: number
): Promise<Record<string, unknown> | null> {
  const projectPath = projectId ? `/api/projects/${projectId}` : '/api/projects/@current';
  const dateFrom = new Date(Date.now() - days * 86400 * 1000).toISOString().slice(0, 10);

  const url = `${host}${projectPath}/insights/trend/?events=[{"id":"${encodeURIComponent(eventName)}"}]&date_from=${dateFrom}&interval=day`;

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10000),
  });

  if (!resp.ok) return null;

  const json = (await resp.json()) as PostHogInsight;
  if (!json.result || json.result.length === 0) return null;

  const series = json.result[0];
  const total = (series.data ?? []).reduce((sum, n) => sum + n, 0);
  const latest7 = (series.data ?? []).slice(-7);

  return {
    event: eventName,
    total,
    daily: latest7,
    labels: (series.labels ?? []).slice(-7),
    period_days: days,
  };
}

async function fetchTopEvents(
  host: string,
  apiKey: string,
  projectId: string | undefined
): Promise<Array<{ name: string; count: number }>> {
  const projectPath = projectId ? `/api/projects/${projectId}` : '/api/projects/@current';
  const url = `${host}${projectPath}/events/values/?key=event&limit=10`;

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(8000),
  });

  if (!resp.ok) return [];

  const json = (await resp.json()) as { name: string; count?: number }[];
  if (!Array.isArray(json)) return [];

  return json.slice(0, 10).map(e => ({ name: e.name, count: e.count ?? 0 }));
}
