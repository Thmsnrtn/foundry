// =============================================================================
// FOUNDRY — Notification Service
// In-app notifications for milestones, risk changes, PRs, and system events.
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
import type { AppNotification } from '../../types/index.js';

/**
 * Create an in-app notification.
 */
export async function createNotification(
  founderId: string,
  productId: string | null,
  type: string,
  title: string,
  body: string,
  actionUrl?: string,
  actionLabel?: string,
): Promise<void> {
  await query(
    `INSERT INTO notifications (id, founder_id, product_id, type, title, body, action_url, action_label)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [nanoid(), founderId, productId, type, title, body, actionUrl ?? null, actionLabel ?? null],
  );
}

/**
 * Get unread notifications for a founder, most recent first.
 */
export async function getUnreadNotifications(
  founderId: string,
  limit: number = 10,
): Promise<AppNotification[]> {
  const result = await query(
    `SELECT * FROM notifications WHERE founder_id = ? AND read_at IS NULL ORDER BY created_at DESC LIMIT ?`,
    [founderId, limit],
  );
  return result.rows as unknown as AppNotification[];
}

/**
 * Get count of unread notifications.
 */
export async function getUnreadCount(founderId: string): Promise<number> {
  const result = await query(
    `SELECT COUNT(*) as cnt FROM notifications WHERE founder_id = ? AND read_at IS NULL`,
    [founderId],
  );
  return (result.rows[0] as Record<string, number>)?.cnt ?? 0;
}

/**
 * Mark a single notification as read.
 */
export async function markRead(notificationId: string, founderId: string): Promise<void> {
  await query(
    `UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND founder_id = ?`,
    [notificationId, founderId],
  );
}

/**
 * Mark all notifications as read for a founder.
 */
export async function markAllRead(founderId: string): Promise<void> {
  await query(
    `UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE founder_id = ? AND read_at IS NULL`,
    [founderId],
  );
}
