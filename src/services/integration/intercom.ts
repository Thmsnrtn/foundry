// =============================================================================
// FOUNDRY — Intercom Integration
// Pulls customer support metrics from Intercom.
// Normalizes into integration_events for Harbor and Compass agents.
// =============================================================================

import { query } from '../../db/client.js';
import { storeEvent, getIntegration } from './fabric.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface IntercomConversation {
  id: string;
  created_at: number;
  updated_at: number;
  open: boolean;
  statistics?: {
    first_contact_reply_at: number | null;
    last_assignment_at: number | null;
  };
}

interface IntercomConversationList {
  conversations: IntercomConversation[];
  pages?: { total_pages: number };
  total_count?: number;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function isIntercomConnected(productId: string): Promise<boolean> {
  const integration = await getIntegration(productId, 'intercom');
  return integration?.status === 'connected';
}

/**
 * Pull recent Intercom support metrics and store as normalized integration_events.
 * Called by the hourly cron job.
 */
export async function syncIntercomEvents(productId: string): Promise<{ synced: number; error?: string }> {
  const integration = await getIntegration(productId, 'intercom');
  if (!integration || integration.status !== 'connected') {
    return { synced: 0 };
  }

  const accessToken = integration.config_json.access_token as string | undefined;

  if (!accessToken) {
    return { synced: 0, error: 'Missing required Intercom config field (access_token)' };
  }

  let synced = 0;

  try {
    // Fetch open conversations
    const openConvData = await intercomFetch<IntercomConversationList>(
      '/conversations?open=true&per_page=50',
      accessToken
    );

    const openConversations = openConvData?.conversations?.length ?? 0;
    const totalCount = openConvData?.total_count ?? openConversations;

    // Estimate opened today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartUnix = Math.floor(todayStart.getTime() / 1000);
    const openedToday = (openConvData?.conversations ?? []).filter(c =>
      c.created_at >= todayStartUnix
    ).length;

    // Fetch recent conversations for response time calculation
    const recentConvData = await intercomFetch<IntercomConversationList>(
      '/conversations?per_page=50&sort=updated_at&order=desc',
      accessToken
    );

    let avgResponseHours: number | null = null;
    if (recentConvData?.conversations && recentConvData.conversations.length > 0) {
      const responseTimes: number[] = [];
      for (const conv of recentConvData.conversations) {
        const stats = conv.statistics;
        if (stats?.first_contact_reply_at && stats?.last_assignment_at) {
          const diff = Math.abs(stats.first_contact_reply_at - stats.last_assignment_at);
          responseTimes.push(diff / 3600); // convert seconds to hours
        }
      }
      if (responseTimes.length > 0) {
        avgResponseHours = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
        avgResponseHours = Math.round(avgResponseHours * 10) / 10;
      }
    }

    await storeEvent(productId, {
      integration_name: 'intercom',
      event_type: 'support_metrics',
      actor_type: 'workspace',
      data: {
        open_conversations: openConversations,
        avg_response_hours: avgResponseHours,
        csat_score: null, // CSAT requires Survey/NPS feature, not available via basic conversations API
      },
    });
    synced++;

    await storeEvent(productId, {
      integration_name: 'intercom',
      event_type: 'conversation_volume',
      actor_type: 'workspace',
      data: {
        total_conversations: totalCount,
        opened_today: openedToday,
      },
    });
    synced++;

    await query(
      `UPDATE integrations SET last_synced_at=CURRENT_TIMESTAMP, last_error=NULL WHERE product_id=? AND name='intercom'`,
      [productId]
    );

    return { synced };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await query(
      `UPDATE integrations SET last_error=?, error_count_trailing_7d=error_count_trailing_7d+1 WHERE product_id=? AND name='intercom'`,
      [errorMsg, productId]
    );
    return { synced, error: errorMsg };
  }
}

/**
 * Get a summary of Intercom support metrics for dashboard display.
 */
export async function getIntercomSummary(productId: string): Promise<{
  connected: boolean;
  openConversations: number | null;
  avgResponseTimeHours: number | null;
  csatScore: number | null;
  npsScore: number | null;
}> {
  const integration = await getIntegration(productId, 'intercom');
  if (!integration || integration.status !== 'connected') {
    return {
      connected: false,
      openConversations: null,
      avgResponseTimeHours: null,
      csatScore: null,
      npsScore: null,
    };
  }

  const eventsResult = await query(
    `SELECT event_type, data_json FROM integration_events
     WHERE product_id=? AND integration_name='intercom'
       AND created_at >= datetime('now', '-25 hours')
     ORDER BY created_at DESC`,
    [productId]
  );

  let openConversations: number | null = null;
  let avgResponseTimeHours: number | null = null;
  let csatScore: number | null = null;
  let npsScore: number | null = null;

  for (const row of eventsResult.rows as Record<string, unknown>[]) {
    const data = (() => { try { return JSON.parse(row.data_json as string || '{}'); } catch { return {}; } })();
    if (row.event_type === 'support_metrics') {
      if (openConversations === null) openConversations = data.open_conversations != null ? Number(data.open_conversations) : null;
      if (avgResponseTimeHours === null) avgResponseTimeHours = data.avg_response_hours != null ? Number(data.avg_response_hours) : null;
      if (csatScore === null) csatScore = data.csat_score != null ? Number(data.csat_score) : null;
      if (npsScore === null) npsScore = data.nps_score != null ? Number(data.nps_score) : null;
    }
  }

  return { connected: true, openConversations, avgResponseTimeHours, csatScore, npsScore };
}

// ─── Internal API helpers ─────────────────────────────────────────────────────

async function intercomFetch<T>(path: string, accessToken: string): Promise<T | null> {
  const resp = await fetch(`https://api.intercom.io${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) return null;
  return resp.json() as Promise<T>;
}
