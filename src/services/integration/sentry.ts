// =============================================================================
// FOUNDRY — Sentry Integration
// Pulls error tracking and release health signals from Sentry.
// Normalizes into integration_events for Sentinel and Crucible agents.
// =============================================================================

import { query } from '../../db/client.js';
import { storeEvent, getIntegration, getIntegrationCredentials } from './fabric.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SentryIssue {
  id: string;
  title: string;
  level: string; // 'error' | 'warning' | 'info' | 'critical' | 'fatal'
  status: string;
  count: string;
  firstSeen: string;
  lastSeen: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function isSentryConnected(productId: string): Promise<boolean> {
  const integration = await getIntegration(productId, 'sentry');
  return integration?.status === 'active';
}

/**
 * Pull recent Sentry error data and store as normalized integration_events.
 * Called by the hourly cron job.
 */
export async function syncSentryEvents(productId: string): Promise<{ synced: number; error?: string }> {
  const integration = await getIntegration(productId, 'sentry');
  if (!integration || integration.status !== 'active') {
    return { synced: 0 };
  }

  const authToken = (await getIntegrationCredentials(productId, 'sentry')).auth_token;
  const orgSlug = integration.config_json.org_slug as string | undefined;
  const projectSlug = integration.config_json.project_slug as string | undefined;

  if (!authToken || !orgSlug || !projectSlug) {
    return { synced: 0, error: 'Missing required Sentry config fields (auth_token, org_slug, project_slug)' };
  }

  let synced = 0;

  try {
    // Fetch open issues. `limit` is what makes the count below a floor rather
    // than a total, and the field names say which — the same correction the
    // GitHub summaries needed, for the same reason: this row is read by
    // Sentinel, and "25 unresolved issues" and "at least 25" are different
    // things to tell an agent reasoning about whether a system is in trouble.
    const ISSUE_LIMIT = 100;
    const issues = await sentryFetch<SentryIssue[]>(
      `/projects/${orgSlug}/${projectSlug}/issues/?query=is:unresolved&limit=${ISSUE_LIMIT}`,
      authToken
    );

    if (issues) {
      const truncated = issues.length >= ISSUE_LIMIT;
      const criticalIssues = issues.filter(i =>
        i.level === 'critical' || i.level === 'fatal'
      );

      await storeEvent(productId, {
        integration_name: 'sentry',
        event_type: 'error_summary',
        actor_type: 'project',
        actor_id: `${orgSlug}/${projectSlug}`,
        data: {
          ...(truncated
            ? { open_count_at_least: issues.length, open_page_truncated: true }
            : { open_count: issues.length, open_page_truncated: false }),
          // Counted within the page either way, and named so.
          critical_count_in_page: criticalIssues.length,
          top_error: issues[0]?.title ?? null,
        },
      });
      synced++;
    }

    // Fetch error rate stats for the last 24 hours
    const since24h = Math.floor((Date.now() - 24 * 3600 * 1000) / 1000);
    const stats = await sentryFetch<Array<[number, number]>>(
      `/projects/${orgSlug}/${projectSlug}/stats/?stat=received&resolution=1h&since=${since24h}`,
      authToken
    );

    if (stats) {
      const totalErrors = stats.reduce((sum, [, count]) => sum + count, 0);
      // Spike detection: last hour > 2x average of previous 23 hours
      const lastHourCount = stats[stats.length - 1]?.[1] ?? 0;
      const prevHoursAvg = stats.length > 1
        ? stats.slice(0, -1).reduce((sum, [, c]) => sum + c, 0) / (stats.length - 1)
        : 0;
      const spikeDetected = prevHoursAvg > 0 && lastHourCount > prevHoursAvg * 2;

      await storeEvent(productId, {
        integration_name: 'sentry',
        event_type: 'error_rate',
        actor_type: 'project',
        actor_id: `${orgSlug}/${projectSlug}`,
        data: {
          rate_24h: totalErrors,
          spike_detected: spikeDetected,
        },
      });
      synced++;
    }

    await query(
      `UPDATE integrations SET last_synced_at=CURRENT_TIMESTAMP, last_error=NULL WHERE product_id=? AND name='sentry'`,
      [productId]
    );

    return { synced };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await query(
      `UPDATE integrations SET last_error=?, error_count_trailing_7d=error_count_trailing_7d+1 WHERE product_id=? AND name='sentry'`,
      [errorMsg, productId]
    );
    return { synced, error: errorMsg };
  }
}

/**
 * Get a summary of Sentry error data for dashboard display.
 */
export async function getSentrySummary(productId: string): Promise<{
  connected: boolean;
  openIssues: number | null;
  /** True when `openIssues` is a floor from a truncated page, not a total. */
  openIssuesIsFloor: boolean;
  criticalIssues: number | null;
  errorRate24h: number | null;
  releaseHealth: string | null;
}> {
  const integration = await getIntegration(productId, 'sentry');
  if (!integration || integration.status !== 'active') {
    return {
      connected: false,
      openIssues: null,
      openIssuesIsFloor: false,
      criticalIssues: null,
      errorRate24h: null,
      releaseHealth: null,
    };
  }

  const eventsResult = await query(
    `SELECT event_type, data_json FROM integration_events
     WHERE product_id=? AND integration_name='sentry'
       AND created_at >= datetime('now', '-25 hours')
     ORDER BY created_at DESC`,
    [productId]
  );

  let openIssues: number | null = null;
  let openIssuesIsFloor = false;
  let criticalIssues: number | null = null;
  let errorRate24h: number | null = null;

  for (const row of eventsResult.rows as Record<string, unknown>[]) {
    const data = (() => { try { return JSON.parse(row.data_json as string || '{}'); } catch { return {}; } })();
    if (row.event_type === 'error_summary') {
      // A floor is still worth having, and losing it silently would have been
      // the cost of naming it honestly upstream. `openIssuesIsFloor` travels
      // with the number so a caller can say "at least" rather than implying a
      // total it does not have. `critical_count_in_page` is always page-bound;
      // its old name said otherwise.
      const exact = data.open_count;
      const floor = data.open_count_at_least;
      openIssues = exact != null ? Number(exact) : floor != null ? Number(floor) : null;
      openIssuesIsFloor = exact == null && floor != null;
      criticalIssues = Number(data.critical_count_in_page) || null;
    }
    if (row.event_type === 'error_rate') {
      errorRate24h = Number(data.rate_24h) || null;
    }
  }

  // Derive release health from the data we have
  let releaseHealth: string | null = null;
  if (errorRate24h !== null && criticalIssues !== null) {
    if (criticalIssues > 5 || errorRate24h > 1000) {
      releaseHealth = 'failed';
    } else if (criticalIssues > 0 || errorRate24h > 200) {
      releaseHealth = 'degraded';
    } else {
      releaseHealth = 'healthy';
    }
  }

  return { connected: true, openIssues, openIssuesIsFloor, criticalIssues, errorRate24h, releaseHealth };
}

// ─── Internal API helpers ─────────────────────────────────────────────────────

async function sentryFetch<T>(path: string, authToken: string): Promise<T | null> {
  const resp = await fetch(`https://sentry.io/api/0${path}`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) return null;
  return resp.json() as Promise<T>;
}
