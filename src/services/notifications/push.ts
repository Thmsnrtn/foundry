// =============================================================================
// FOUNDRY — Notification Infrastructure
// Web Push (VAPID), Slack webhooks, and outbound webhooks.
// =============================================================================

import { query, getAllActiveProducts } from '../../db/client.js';
import { nanoid } from 'nanoid';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data?: Record<string, unknown>;
  tag?: string;        // deduplication key
  requireInteraction?: boolean;
}

export type NotificationType =
  | 'risk_state_change'
  | 'critical_stressor'
  | 'decision_deadline'
  | 'daily_briefing'
  | 'milestone'
  | 'integration_error'
  | 'weekly_digest';

// ─── Send Push Notification ───────────────────────────────────────────────────

/**
 * Send a Web Push notification to all active subscriptions for a founder.
 * Uses VAPID authentication from environment variables.
 */
export async function sendPushNotification(
  founderId: string,
  productId: string | null,
  notificationType: NotificationType,
  payload: PushPayload,
): Promise<{ sent: number; failed: number }> {
  // Check which notification types this founder has enabled
  const subscriptions = await query(
    `SELECT id, endpoint, p256dh, auth, platform, apns_device_token, apns_bundle_id,
            notify_${notificationType} as enabled
     FROM push_subscriptions
     WHERE founder_id = ? AND active = TRUE AND notify_${notificationType} = TRUE`,
    [founderId],
  );

  let sent = 0;
  let failed = 0;

  for (const row of subscriptions.rows) {
    const sub = row as Record<string, unknown>;

    try {
      if (sub.platform === 'web' && sub.endpoint) {
        await sendWebPush(
          sub.endpoint as string,
          sub.p256dh as string,
          sub.auth as string,
          payload,
        );
        sent++;
      } else if (sub.platform === 'ios' && sub.apns_device_token) {
        await sendAPNS(
          sub.apns_device_token as string,
          sub.apns_bundle_id as string,
          payload,
        );
        sent++;
      }

      // Log delivery
      await query(
        `INSERT INTO push_log (id, founder_id, product_id, subscription_id, notification_type, title, body, data, status, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sent', CURRENT_TIMESTAMP)`,
        [nanoid(), founderId, productId, sub.id, notificationType, payload.title, payload.body, JSON.stringify(payload.data ?? {})],
      );

      // Update last delivered
      await query(
        `UPDATE push_subscriptions SET last_delivered_at = CURRENT_TIMESTAMP, failure_count = 0 WHERE id = ?`,
        [sub.id],
      );
    } catch (err) {
      failed++;
      const errorMsg = err instanceof Error ? err.message : String(err);

      await query(
        `UPDATE push_subscriptions SET failure_count = failure_count + 1 WHERE id = ?`,
        [sub.id],
      );

      // Disable subscription after 5 consecutive failures (likely invalid endpoint)
      await query(
        `UPDATE push_subscriptions SET active = FALSE WHERE id = ? AND failure_count >= 5`,
        [sub.id],
      );

      console.error(`[push] failed to deliver to subscription ${sub.id}:`, errorMsg);
    }
  }

  return { sent, failed };
}

// ─── Notify All Founders (Broadcast) ─────────────────────────────────────────

/**
 * Send a notification to all founders of a product.
 * Used for risk state changes that affect all team members.
 */
export async function notifyProductTeam(
  productId: string,
  notificationType: NotificationType,
  payload: PushPayload,
): Promise<void> {
  // Owner
  const ownerResult = await query(
    `SELECT owner_id FROM products WHERE id = ?`,
    [productId],
  );
  if (ownerResult.rows.length === 0) return;
  const ownerId = (ownerResult.rows[0] as Record<string, string>).owner_id;

  // Team members
  const teamResult = await query(
    `SELECT founder_id FROM team_members WHERE product_id = ? AND status = 'active'`,
    [productId],
  );

  const founderIds = new Set([ownerId]);
  for (const row of teamResult.rows) {
    founderIds.add((row as Record<string, string>).founder_id);
  }

  for (const founderId of founderIds) {
    await sendPushNotification(founderId, productId, notificationType, payload).catch(() => {});
  }
}

// ─── Slack Notifications ──────────────────────────────────────────────────────

export async function sendSlackNotification(
  founderId: string,
  productId: string | null,
  notificationType: NotificationType,
  title: string,
  body: string,
  fields?: Array<{ title: string; value: string; short?: boolean }>,
): Promise<void> {
  const slackResult = await query(
    `SELECT bot_token, channel_id, notify_${notificationType} as enabled
     FROM slack_integrations WHERE founder_id = ? AND active = TRUE`,
    [founderId],
  );

  if (slackResult.rows.length === 0) return;
  const slack = slackResult.rows[0] as Record<string, unknown>;
  if (!slack.enabled || !slack.bot_token || !slack.channel_id) return;

  const colorMap: Record<NotificationType, string> = {
    risk_state_change: '#FF6B6B',
    critical_stressor: '#FF8C42',
    decision_deadline: '#FFD166',
    daily_briefing: '#06D6A0',
    milestone: '#118AB2',
    integration_error: '#EF476F',
    weekly_digest: '#073B4C',
  };

  const message = {
    channel: slack.channel_id,
    attachments: [{
      color: colorMap[notificationType] ?? '#888888',
      title,
      text: body,
      fields: fields ?? [],
      footer: 'Foundry',
      ts: Math.floor(Date.now() / 1000),
    }],
  };

  try {
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${slack.bot_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });
  } catch (err) {
    console.error('[slack] failed to send notification:', err);
  }
}

// ─── Outbound Webhooks ────────────────────────────────────────────────────────

export async function deliverWebhookEvent(
  productId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const webhooks = await query(
    `SELECT id, url, secret FROM outbound_webhooks
     WHERE product_id = ? AND active = TRUE AND events LIKE ?`,
    [productId, `%"${eventType}"%`],
  );

  for (const row of webhooks.rows) {
    const wh = row as Record<string, string>;
    await deliverToWebhook(wh, eventType, payload);
  }
}

async function deliverToWebhook(
  webhook: Record<string, string>,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const body = JSON.stringify({
    event: eventType,
    timestamp: new Date().toISOString(),
    data: payload,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Foundry/1.0',
    'X-Foundry-Event': eventType,
  };

  if (webhook.secret) {
    // HMAC-SHA256 signature
    const encoder = new TextEncoder();
    const keyData = encoder.encode(webhook.secret);
    const messageData = encoder.encode(body);
    const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
    const hexSignature = Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, '0')).join('');
    headers['X-Foundry-Signature'] = `sha256=${hexSignature}`;
  }

  try {
    const response = await fetch(webhook.url, { method: 'POST', headers, body });

    if (response.ok) {
      await query(
        `UPDATE outbound_webhooks SET last_delivered_at = CURRENT_TIMESTAMP, failure_count = 0, last_error = NULL WHERE id = ?`,
        [webhook.id],
      );
    } else {
      await query(
        `UPDATE outbound_webhooks SET failure_count = failure_count + 1, last_error = ? WHERE id = ?`,
        [`HTTP ${response.status}`, webhook.id],
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await query(
      `UPDATE outbound_webhooks SET failure_count = failure_count + 1, last_error = ? WHERE id = ?`,
      [msg, webhook.id],
    );
  }
}

// ─── Platform-Specific Senders ────────────────────────────────────────────────

async function sendWebPush(
  endpoint: string,
  p256dh: string,
  auth: string,
  payload: PushPayload,
): Promise<void> {
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT ?? 'mailto:hello@foundry.app';

  if (!vapidPublicKey || !vapidPrivateKey) {
    // Web Push not configured — skip silently
    return;
  }

  // Use web-push library if available, otherwise skip
  try {
    const webpush = await import('web-push').catch(() => null);
    if (!webpush) return;

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    await webpush.sendNotification(
      { endpoint, keys: { p256dh, auth } },
      JSON.stringify(payload),
    );
  } catch (err) {
    throw new Error(`Web Push failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function sendAPNS(
  deviceToken: string,
  bundleId: string,
  payload: PushPayload,
): Promise<void> {
  const apnsKey = process.env.APNS_KEY;
  const apnsKeyId = process.env.APNS_KEY_ID;
  const apnsTeamId = process.env.APNS_TEAM_ID;

  if (!apnsKey || !apnsKeyId || !apnsTeamId) {
    // APNs not configured — skip silently
    return;
  }

  const apnsHost = process.env.NODE_ENV === 'production'
    ? 'https://api.push.apple.com'
    : 'https://api.sandbox.push.apple.com';

  const notification = {
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: 'default',
      badge: 1,
      'content-available': 1,
    },
    ...payload.data,
  };

  const response = await fetch(
    `${apnsHost}/3/device/${deviceToken}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apns-topic': bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'authorization': `bearer ${await generateAPNSJWT(apnsKey, apnsKeyId, apnsTeamId)}`,
      },
      body: JSON.stringify(notification),
    },
  );

  if (!response.ok) {
    const error = await response.text().catch(() => 'unknown');
    throw new Error(`APNs error: ${response.status} ${error}`);
  }
}

async function generateAPNSJWT(key: string, keyId: string, teamId: string): Promise<string> {
  // JWT signing for APNs — header.payload.signature
  const header = { alg: 'ES256', kid: keyId };
  const payload = { iss: teamId, iat: Math.floor(Date.now() / 1000) };

  const encode = (obj: unknown): string =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const signingInput = `${encode(header)}.${encode(payload)}`;

  // Import ES256 key and sign
  const pemContent = key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, '');
  const keyBuffer = Uint8Array.from(atob(pemContent), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyBuffer, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  );

  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    encoder.encode(signingInput),
  );

  const sigStr = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  return `${signingInput}.${sigStr}`;
}
