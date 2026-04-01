// =============================================================================
// FOUNDRY — Slack Integration
// Team communication insights and outbound notifications via Slack.
// Sends agent briefings, alerts, and notifications to configured channels.
// =============================================================================

import { query } from '../../db/client.js';
import { storeEvent, getIntegration } from './fabric.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SlackAuthTestResponse {
  ok: boolean;
  team?: string;
  user_id?: string;
  bot_id?: string;
  error?: string;
}

interface SlackPostMessageResponse {
  ok: boolean;
  ts?: string;
  error?: string;
}

interface SlackChannelInfoResponse {
  ok: boolean;
  channel?: {
    id: string;
    name: string;
  };
  error?: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function isSlackConnected(productId: string): Promise<boolean> {
  const integration = await getIntegration(productId, 'slack');
  return integration?.status === 'connected';
}

/**
 * Verify Slack connectivity and store a connection status event.
 * Called by the hourly cron job.
 */
export async function syncSlackEvents(productId: string): Promise<{ synced: number; error?: string }> {
  const integration = await getIntegration(productId, 'slack');
  if (!integration || integration.status !== 'connected') {
    return { synced: 0 };
  }

  const botToken = integration.config_json.bot_token as string | undefined;

  if (!botToken) {
    return { synced: 0, error: 'Missing required Slack config field (bot_token)' };
  }

  let synced = 0;

  try {
    const authResult = await slackGet<SlackAuthTestResponse>('auth.test', botToken);

    if (authResult?.ok) {
      await storeEvent(productId, {
        integration_name: 'slack',
        event_type: 'connection_status',
        actor_type: 'workspace',
        data: {
          ok: true,
          team: authResult.team ?? null,
          bot_user_id: authResult.bot_id ?? authResult.user_id ?? null,
        },
      });
      synced++;
    }

    await query(
      `UPDATE integrations SET last_synced_at=CURRENT_TIMESTAMP, last_error=NULL WHERE product_id=? AND name='slack'`,
      [productId]
    );

    return { synced };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await query(
      `UPDATE integrations SET last_error=?, error_count_trailing_7d=error_count_trailing_7d+1 WHERE product_id=? AND name='slack'`,
      [errorMsg, productId]
    );
    return { synced, error: errorMsg };
  }
}

/**
 * Send a Slack notification to the configured channel (or an override channel).
 */
export async function sendSlackNotification(
  productId: string,
  opts: {
    channel?: string;
    text: string;
    blocks?: unknown[];
  }
): Promise<boolean> {
  const integration = await getIntegration(productId, 'slack');
  if (!integration || integration.status !== 'connected') return false;

  const botToken = integration.config_json.bot_token as string | undefined;
  const defaultChannel = integration.config_json.channel_id as string | undefined;

  if (!botToken) return false;

  const channel = opts.channel ?? defaultChannel;
  if (!channel) return false;

  const body: Record<string, unknown> = {
    channel,
    text: opts.text,
  };
  if (opts.blocks) {
    body.blocks = opts.blocks;
  }

  const result = await slackPost<SlackPostMessageResponse>('chat.postMessage', botToken, body);
  return result?.ok === true;
}

/**
 * Send a formatted daily agent briefing as a rich Slack Block Kit message.
 */
export async function sendAgentBriefing(
  productId: string,
  briefingData: {
    date: string;
    health_score: number;
    headline: string;
    key_points: string[];
  }
): Promise<boolean> {
  const integration = await getIntegration(productId, 'slack');
  if (!integration || integration.status !== 'connected') return false;

  const botToken = integration.config_json.bot_token as string | undefined;
  const defaultChannel = integration.config_json.channel_id as string | undefined;

  if (!botToken || !defaultChannel) return false;

  const keyPointsText = briefingData.key_points
    .map(p => `• ${p}`)
    .join('\n');

  const blocks: unknown[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `Foundry Daily Briefing — ${briefingData.date}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Company Health Score: ${briefingData.health_score}/100*\n${briefingData.headline}`,
      },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: keyPointsText,
      },
    },
  ];

  const result = await slackPost<SlackPostMessageResponse>('chat.postMessage', botToken, {
    channel: defaultChannel,
    text: `Foundry Daily Briefing — ${briefingData.date}: Health Score ${briefingData.health_score}/100`,
    blocks,
  });

  return result?.ok === true;
}

/**
 * Get a summary of Slack integration status for dashboard display.
 */
export async function getSlackSummary(productId: string): Promise<{
  connected: boolean;
  channelName: string | null;
  lastNotification: string | null;
}> {
  const integration = await getIntegration(productId, 'slack');
  if (!integration || integration.status !== 'connected') {
    return {
      connected: false,
      channelName: null,
      lastNotification: null,
    };
  }

  const botToken = integration.config_json.bot_token as string | undefined;
  const channelId = integration.config_json.channel_id as string | undefined;

  // Fetch channel name if we have a channel ID
  let channelName: string | null = null;
  if (botToken && channelId) {
    const channelInfo = await slackGet<SlackChannelInfoResponse>(
      `conversations.info?channel=${encodeURIComponent(channelId)}`,
      botToken
    );
    channelName = channelInfo?.channel?.name ?? null;
  }

  // Get last notification time from integration events
  const lastEventResult = await query(
    `SELECT created_at FROM integration_events
     WHERE product_id=? AND integration_name='slack'
     ORDER BY created_at DESC LIMIT 1`,
    [productId]
  );

  const lastNotification = lastEventResult.rows.length > 0
    ? (lastEventResult.rows[0] as Record<string, unknown>).created_at as string
    : null;

  return { connected: true, channelName, lastNotification };
}

// ─── Internal API helpers ─────────────────────────────────────────────────────

async function slackGet<T>(endpoint: string, botToken: string): Promise<T | null> {
  const resp = await fetch(`https://slack.com/api/${endpoint}`, {
    headers: {
      Authorization: `Bearer ${botToken}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) return null;
  return resp.json() as Promise<T>;
}

async function slackPost<T>(endpoint: string, botToken: string, body: Record<string, unknown>): Promise<T | null> {
  const resp = await fetch(`https://slack.com/api/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) return null;
  return resp.json() as Promise<T>;
}
