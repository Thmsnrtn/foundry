// =============================================================================
// FOUNDRY — Push notifications (Web Push / APNs)
//
// MOUNTED, NEVER LIVE. `POST /api/push/register` and `/api/push/preferences`
// have been accepting device registrations and per-type preferences the whole
// time, and nothing has ever sent a push: `sendPushNotification` had no callers
// anywhere in the tree. Founders could opt into a channel that had never
// delivered anything — the same "mounted is not live" shape as the public API.
//
// The owner's decision was to make it real, through the gateway rather than
// beside it. That matters more here than anywhere else, because this module
// reached the network directly: no kill-switch, no pause, no budget, no dedup,
// no audit row. A push is an outward effect on a founder's phone; it belongs to
// the same door as email and webhooks, and now it uses it.
//
// Consequences that fall out of that, rather than being bolted on:
//   • a paused or read-only company sends no push, because the kill-switch
//     refuses it — the entitlement rule reaches this channel for free;
//   • a retried job cannot double-notify, because the gateway dedups;
//   • every send is in audit_log with its refusal reason if it did not go.
//
// A push with no product has no authority context, so there is nothing to check
// it against. Those fail closed rather than sending ungoverned.
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
import { pathSegment } from '../outbound/path-segment.js';
import { invoke, registerToolHandler, type GatewayRequest } from '../outbound/gateway.js';
import { log } from '../../lib/logger.js';

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

/** The notification types, as VALUES rather than only as a type. The union
 * below is erased at runtime, and the query in `sendPushNotification` builds a
 * column name by interpolating this string — so the only thing standing between
 * it and SQL injection is that no route currently passes a caller-supplied
 * type. That is a property of the wiring, not of this function, and this
 * function is one wiring away from being live. */
export const NOTIFICATION_TYPES = [
  'risk_state_change',
  'critical_stressor',
  'decision_deadline',
  'daily_briefing',
  'milestone',
  'integration_error',
  'weekly_digest',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Notification type → the `push_subscriptions` column holding the founder's
 * preference for it. A lookup, so an unknown key yields undefined rather than a
 * column name assembled from whatever was passed in. */
const PREFERENCE_COLUMN: Record<string, string> = Object.freeze(
  Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t, `notify_${t}`])));

// ─── Send Push Notification ───────────────────────────────────────────────────

/**
 * The transport: deliver to every subscription a founder has enabled for this
 * type. NOT the entry point — `notifyFounder` is, and it goes through the
 * gateway. Exported for the handler and for tests; production callers that
 * reach this directly would be reaching around the kill-switch.
 */
export async function deliverPushNotification(
  founderId: string,
  productId: string | null,
  notificationType: NotificationType,
  payload: PushPayload,
): Promise<{ sent: number; failed: number }> {
  // The type names a COLUMN, so it is resolved through a frozen map rather than
  // interpolated from the argument. The union that used to guarantee this is
  // erased at runtime, and the difference between an allow-list and a string
  // concatenation here is the difference between a preference and an injection.
  const column = PREFERENCE_COLUMN[notificationType];
  if (!column) throw new Error('unknown notification type');

  // `SELECT *` on purpose: the enabled-flag column differs per notification
  // type, so naming it would mean building the select list from the same value.
  const subscriptions = await query(
    `SELECT * FROM push_subscriptions
      WHERE founder_id = ? AND active = TRUE AND ${column} = TRUE`,
    [founderId],
  );

  let sent = 0;
  let failed = 0;

  for (const row of subscriptions.rows) {
    const sub = row as Record<string, unknown>;

    try {
      // DISPATCHED, OR ONLY ATTEMPTED? Both platform senders return quietly
      // when their credentials are unset — and `sent++` counted that as a
      // delivery, then wrote a push_log row saying 'sent'. A receipt for
      // something that never left the building is worse than no receipt: it is
      // the one record anybody would check.
      let dispatched = false;
      if (sub.platform === 'web' && sub.endpoint) {
        dispatched = await sendWebPush(
          sub.endpoint as string,
          sub.p256dh as string,
          sub.auth as string,
          payload,
        );
      } else if (sub.platform === 'ios' && sub.apns_device_token) {
        dispatched = await sendAPNS(
          sub.apns_device_token as string,
          sub.apns_bundle_id as string,
          payload,
        );
      }
      if (dispatched) sent++;

      // Log delivery, saying which of the two happened.
      await query(
        `INSERT INTO push_log (id, founder_id, product_id, subscription_id, notification_type, title, body, data, status, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [nanoid(), founderId, productId, sub.id, notificationType, payload.title, payload.body,
          JSON.stringify(payload.data ?? {}), dispatched ? 'sent' : 'not_configured'],
      );

      // Update last delivered — ONLY IF SOMETHING WAS DELIVERED. Stamping
      // `last_delivered_at` after a push that was never dispatched is the same
      // mistake as the log row above, in the column an operator reads to find
      // subscriptions that have gone quiet.
      if (dispatched) {
        await query(
          `UPDATE push_subscriptions SET last_delivered_at = CURRENT_TIMESTAMP, failure_count = 0 WHERE id = ?`,
          [sub.id],
        );
      }
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
    await notifyFounder({ productId, founderId, notificationType, payload }).catch(() => {});
  }
}

// ─── The governed entry point ────────────────────────────────────────────────

interface PushToolParams {
  founder_id: string;
  notification_type: NotificationType;
  payload: PushPayload;
}

/** Exported for tests that must exercise the real authority check rather than a
 * stub — the same reason `sendEmailHandler` is exported. Production callers use
 * `notifyFounder`, which goes through the gateway. */
export async function pushHandler(req: GatewayRequest): Promise<{ sent: number; failed: number }> {
  const params = req.params as unknown as PushToolParams;
  if (!(NOTIFICATION_TYPES as readonly string[]).includes(params.notification_type)) {
    throw new Error('unknown notification type');
  }
  // THE GATEWAY ESTABLISHED THE COMPANY, NOT THE PERSON. `founder_id` arrives
  // in the payload, so without this a caller holding one company's authority
  // could push to anybody's phone — the company is checked, the recipient was
  // taken on trust. Same shape as an account notice addressed by its caller.
  if (!(await belongsToCompany(params.founder_id, req.productId))) {
    throw new Error('recipient does not belong to this company');
  }
  return deliverPushNotification(
    params.founder_id, req.productId, params.notification_type, params.payload);
}

/** Owner, or an active team member. Anyone else is not this company's to notify. */
async function belongsToCompany(founderId: string, productId: string): Promise<boolean> {
  if (!founderId) return false;
  const res = await query(
    `SELECT 1 AS ok FROM products WHERE id = ? AND owner_id = ?
      UNION ALL
     SELECT 1 AS ok FROM team_members
      WHERE product_id = ? AND founder_id = ? AND status = 'active'`,
    [productId, founderId, productId, founderId]);
  return res.rows.length > 0;
}

export const SEND_PUSH_POLICY = {
  actor: 'push_delivery',
  surface: 'push_notification',
  dataClass: 'general',
  requireDedupKey: true,
  requireCustomerExternalId: false,
} as const;

registerToolHandler('send_push', pushHandler, SEND_PUSH_POLICY);

/**
 * Send one founder a push, through the gateway.
 *
 * The dedup key defaults to the payload's own `tag` when it has one — that
 * field already means "replace the previous notification with this" on both
 * platforms, so it is the caller's own statement of identity — and otherwise to
 * the notification type and title for the day. Either way a job that runs twice
 * notifies once.
 */
export async function notifyFounder(input: {
  productId: string | null;
  founderId: string;
  notificationType: NotificationType;
  payload: PushPayload;
  dedupKey?: string;
}): Promise<{ sent: number; failed: number }> {
  const { productId, founderId, notificationType, payload } = input;
  if (!productId) {
    // No company, no authority to check the send against.
    log.warn('push.no_product_context', { founderId, notificationType });
    return { sent: 0, failed: 0 };
  }
  const day = new Date().toISOString().slice(0, 10);
  const result = await invoke({
    productId,
    tool: 'send_push',
    action: `push: ${notificationType} — ${payload.title}`,
    params: { founder_id: founderId, notification_type: notificationType, payload },
    dedupKey: input.dedupKey
      ?? `push:${notificationType}:${founderId}:${payload.tag ?? payload.title}:${day}`,
  });
  if (!result.ok) {
    log.warn('push.refused', {
      productId, founderId, notificationType,
      phase: result.phase, reason: result.reason,
    });
    return { sent: 0, failed: 0 };
  }
  return result.result as { sent: number; failed: number };
}

// ─── Platform-Specific Senders ────────────────────────────────────────────────

/** Returns whether the notification actually left for the provider. */
async function sendWebPush(
  endpoint: string,
  p256dh: string,
  auth: string,
  payload: PushPayload,
): Promise<boolean> {
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT ?? 'mailto:hello@foundry.app';

  if (!vapidPublicKey || !vapidPrivateKey) {
    // Web Push is not configured. Nothing was delivered, and the caller is told
    // so rather than being handed a success.
    return false;
  }

  // Use web-push library if available, otherwise skip
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const webpush = await import('web-push' as any).catch(() => null);
    if (!webpush) return false;

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    await webpush.sendNotification(
      { endpoint, keys: { p256dh, auth } },
      JSON.stringify(payload),
    );
    return true;
  } catch (err) {
    throw new Error(`Web Push failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Returns whether the notification actually left for the provider. */
async function sendAPNS(
  deviceToken: string,
  bundleId: string,
  payload: PushPayload,
): Promise<boolean> {
  const apnsKey = process.env.APNS_KEY;
  const apnsKeyId = process.env.APNS_KEY_ID;
  const apnsTeamId = process.env.APNS_TEAM_ID;

  if (!apnsKey || !apnsKeyId || !apnsTeamId) {
    // Not configured. Not delivered. Said so.
    return false;
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
    `${apnsHost}/3/device/${pathSegment(deviceToken, 'apns_device_token')}`,
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
  return true;
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
