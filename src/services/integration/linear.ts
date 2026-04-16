// =============================================================================
// FOUNDRY — Linear Integration
// Pulls engineering project management signals from Linear.
// Normalizes into integration_events for Atlas and Crucible agents.
// =============================================================================

import { query } from '../../db/client.js';
import { storeEvent, getIntegration } from './fabric.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LinearIssueNode {
  id: string;
  title: string;
  priority: number;
  estimate: number | null;
}

interface LinearIssuesResponse {
  data?: {
    issues?: {
      nodes: LinearIssueNode[];
      pageInfo?: { hasNextPage: boolean };
    };
  };
  errors?: Array<{ message: string }>;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function isLinearConnected(productId: string): Promise<boolean> {
  const integration = await getIntegration(productId, 'linear');
  return integration?.status === 'connected';
}

/**
 * Pull recent Linear sprint data and store as normalized integration_events.
 * Called by the hourly cron job.
 */
export async function syncLinearEvents(productId: string): Promise<{ synced: number; error?: string }> {
  const integration = await getIntegration(productId, 'linear');
  if (!integration || integration.status !== 'connected') {
    return { synced: 0 };
  }

  const apiKey = integration.config_json.api_key as string | undefined;
  const teamId = integration.config_json.team_id as string | undefined;

  if (!apiKey || !teamId) {
    return { synced: 0, error: 'Missing required Linear config fields (api_key, team_id)' };
  }

  let synced = 0;

  try {
    // In-progress issues
    const inProgressResult = await linearQuery<LinearIssuesResponse>(
      `{
        issues(filter: { team: { id: { eq: "${teamId}" } }, state: { type: { in: ["started", "inProgress"] } } }, first: 50) {
          nodes { id title priority estimate }
          pageInfo { hasNextPage }
        }
      }`,
      apiKey
    );

    const inProgressIssues = inProgressResult?.data?.issues?.nodes ?? [];
    const blocked = inProgressIssues.filter(i => i.priority === 1).length; // priority 1 = urgent, treat as blocked

    // Completed this week
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const completedResult = await linearQuery<LinearIssuesResponse>(
      `{
        issues(filter: { team: { id: { eq: "${teamId}" } }, state: { type: { eq: "completed" } }, completedAt: { gte: "${sevenDaysAgo}" } }, first: 100) {
          nodes { id estimate }
        }
      }`,
      apiKey
    );

    const completedIssues = completedResult?.data?.issues?.nodes ?? [];
    const completedThisWeek = completedIssues.length;
    const velocityThisWeek = completedIssues.reduce((sum, i) => sum + (i.estimate ?? 0), 0);

    // Velocity over last 2 weeks (story points)
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
    const velocityResult = await linearQuery<LinearIssuesResponse>(
      `{
        issues(filter: { team: { id: { eq: "${teamId}" } }, state: { type: { eq: "completed" } }, completedAt: { gte: "${fourteenDaysAgo}" } }, first: 200) {
          nodes { id estimate }
        }
      }`,
      apiKey
    );

    const velocityIssues = velocityResult?.data?.issues?.nodes ?? [];
    const velocity = velocityIssues.reduce((sum, i) => sum + (i.estimate ?? 0), 0);

    await storeEvent(productId, {
      integration_name: 'linear',
      event_type: 'sprint_status',
      actor_type: 'team',
      actor_id: teamId,
      data: {
        in_progress: inProgressIssues.length,
        completed_this_week: completedThisWeek,
        velocity,
        blocked,
        velocity_this_week: velocityThisWeek,
      },
    });
    synced++;

    await query(
      `UPDATE integrations SET last_synced_at=CURRENT_TIMESTAMP, last_error=NULL WHERE product_id=? AND name='linear'`,
      [productId]
    );

    return { synced };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await query(
      `UPDATE integrations SET last_error=?, error_count_trailing_7d=error_count_trailing_7d+1 WHERE product_id=? AND name='linear'`,
      [errorMsg, productId]
    );
    return { synced, error: errorMsg };
  }
}

/**
 * Get a summary of Linear sprint data for dashboard display.
 */
export async function getLinearSummary(productId: string): Promise<{
  connected: boolean;
  inProgressIssues: number | null;
  completedThisWeek: number | null;
  blockedIssues: number | null;
  velocity: number | null;
}> {
  const integration = await getIntegration(productId, 'linear');
  if (!integration || integration.status !== 'connected') {
    return {
      connected: false,
      inProgressIssues: null,
      completedThisWeek: null,
      blockedIssues: null,
      velocity: null,
    };
  }

  const eventsResult = await query(
    `SELECT event_type, data_json FROM integration_events
     WHERE product_id=? AND integration_name='linear'
       AND created_at >= datetime('now', '-25 hours')
     ORDER BY created_at DESC`,
    [productId]
  );

  let inProgressIssues: number | null = null;
  let completedThisWeek: number | null = null;
  let blockedIssues: number | null = null;
  let velocity: number | null = null;

  for (const row of eventsResult.rows as Record<string, unknown>[]) {
    const data = (() => { try { return JSON.parse(row.data_json as string || '{}'); } catch { return {}; } })();
    if (row.event_type === 'sprint_status') {
      inProgressIssues = data.in_progress != null ? Number(data.in_progress) : null;
      completedThisWeek = data.completed_this_week != null ? Number(data.completed_this_week) : null;
      blockedIssues = data.blocked != null ? Number(data.blocked) : null;
      velocity = data.velocity != null ? Number(data.velocity) : null;
      break; // Use most recent
    }
  }

  return { connected: true, inProgressIssues, completedThisWeek, blockedIssues, velocity };
}

// ─── Internal API helpers ─────────────────────────────────────────────────────

async function linearQuery<T>(gql: string, apiKey: string): Promise<T | null> {
  const resp = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: gql }),
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) return null;
  return resp.json() as Promise<T>;
}
