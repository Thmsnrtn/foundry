// =============================================================================
// FOUNDRY — Server-Sent Events (SSE) Stream
// Real-time updates pushed to the browser without polling.
// =============================================================================

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AuthEnv } from '../../middleware/auth.js';
import { query } from '../../db/client.js';

export const sseRoutes = new Hono<AuthEnv>();

/**
 * SSE endpoint that streams real-time updates for a founder's products.
 * Client connects with EventSource('/api/events') and receives typed events.
 */
sseRoutes.get('/api/events', async (c) => {
  const founder = c.get('founder');
  const founderId = founder.id;

  return streamSSE(c, async (stream) => {
    let lastCheck = new Date().toISOString();

    // Send initial heartbeat
    await stream.writeSSE({ event: 'connected', data: JSON.stringify({ founder_id: founderId, timestamp: lastCheck }) });

    // Poll for new events every 10 seconds
    const interval = setInterval(async () => {
      try {
        // Check for new notifications
        const notifications = await query(
          'SELECT id, type, title, body, action_url FROM notifications WHERE founder_id = ? AND created_at > ? AND read_at IS NULL ORDER BY created_at DESC LIMIT 5',
          [founderId, lastCheck]
        );

        for (const row of notifications.rows) {
          const n = row as Record<string, string>;
          await stream.writeSSE({
            event: 'notification',
            data: JSON.stringify({ id: n.id, type: n.type, title: n.title, body: n.body, action_url: n.action_url }),
            id: n.id,
          });
        }

        // Check for new milestones
        const milestones = await query(
          'SELECT id, milestone_title, milestone_description FROM milestone_events WHERE founder_id = ? AND created_at > ? AND seen_at IS NULL',
          [founderId, lastCheck]
        );

        for (const row of milestones.rows) {
          const m = row as Record<string, string>;
          await stream.writeSSE({
            event: 'milestone',
            data: JSON.stringify({ id: m.id, title: m.milestone_title, description: m.milestone_description }),
            id: m.id,
          });
        }

        // Check for risk state changes
        const riskChanges = await query(
          `SELECT al.reasoning, al.risk_state_at_action, al.created_at
           FROM audit_log al
           JOIN products p ON al.product_id = p.id
           WHERE p.owner_id = ? AND al.action_type = 'risk_state_transition' AND al.created_at > ?`,
          [founderId, lastCheck]
        );

        for (const row of riskChanges.rows) {
          const r = row as Record<string, string>;
          await stream.writeSSE({
            event: 'risk_change',
            data: JSON.stringify({ reasoning: r.reasoning, risk_state: r.risk_state_at_action, timestamp: r.created_at }),
          });
        }

        lastCheck = new Date().toISOString();

        // Heartbeat
        await stream.writeSSE({ event: 'heartbeat', data: JSON.stringify({ timestamp: lastCheck }) });
      } catch {
        // Connection may be closed — interval will be cleared
      }
    }, 10_000);

    // Cleanup on disconnect
    stream.onAbort(() => {
      clearInterval(interval);
    });

    // Keep the connection alive for up to 5 minutes
    await new Promise((resolve) => setTimeout(resolve, 300_000));
    clearInterval(interval);
  });
});
