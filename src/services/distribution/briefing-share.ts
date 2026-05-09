// =============================================================================
// FOUNDRY — Share-My-Briefing (Wave 3, action 21)
// Founder-opted-in public snapshot of their weekly outcome. The shared page
// renders Foundry's value-evidence (decisions handled, agent actions
// executed, signal trend) in a sanitized, attribution-friendly format.
// Spotify-Wrapped-style organic distribution.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

const SHARE_CODE_LENGTH = 12;
const DEFAULT_TTL_DAYS = 30;

export interface ShareableBriefing {
  share_code: string;
  product_name: string;
  signal_score: number | null;
  decisions_handled_7d: number;
  decisions_surfaced_7d: number;
  agent_actions_7d: number;
  briefing_date: string;
  expires_at: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a share for a specific briefing. Returns the share_code (used in
 * the public URL like /shared/briefing/<code>).
 */
export async function createBriefingShare(
  founderId: string,
  productId: string,
  briefingId: string,
  ttlDays: number = DEFAULT_TTL_DAYS
): Promise<string> {
  // Verify ownership.
  const ownership = await query(
    'SELECT id FROM products WHERE id = ? AND owner_id = ?',
    [productId, founderId]
  );
  if (ownership.rows.length === 0) {
    throw new Error('not your product');
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const id = nanoid();
    const shareCode = nanoid(SHARE_CODE_LENGTH);
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
    try {
      await query(
        `INSERT INTO briefing_shares (id, share_code, founder_id, product_id, briefing_id, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, shareCode, founderId, productId, briefingId, expiresAt]
      );
      return shareCode;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/UNIQUE/i.test(msg)) throw err;
    }
  }
  throw new Error('briefing share creation failed after retries');
}

/**
 * Resolve a share code to a sanitized snapshot, or null (expired/missing).
 * Increments view_count as a side effect.
 */
export async function resolveShare(code: string): Promise<ShareableBriefing | null> {
  const r = await query(
    `SELECT bs.*, p.name AS product_name, sb.signal_score, sb.briefing_date
       FROM briefing_shares bs
       JOIN products p ON p.id = bs.product_id
       LEFT JOIN scp_briefings sb ON sb.id = bs.briefing_id
      WHERE bs.share_code = ?
        AND datetime(bs.expires_at) > datetime('now')
      LIMIT 1`,
    [code]
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0] as Record<string, unknown>;

  // Aggregate counts come from existing services. We re-query so the
  // shared page reflects current state (within the trailing-7d window).
  const productId = row.product_id as string;
  const decisions = await query(
    `SELECT
       SUM(CASE WHEN status IN ('approved','rejected') AND datetime(decided_at) > datetime('now', '-7 days') THEN 1 ELSE 0 END) AS handled,
       SUM(CASE WHEN gate >= 1 AND datetime(created_at) > datetime('now', '-7 days') THEN 1 ELSE 0 END) AS surfaced
       FROM decisions WHERE product_id = ?`,
    [productId]
  );
  const drow = decisions.rows[0] as Record<string, number | null>;

  const actions = await query(
    `SELECT COUNT(*) AS n FROM action_drafts
      WHERE product_id = ? AND status = 'executed'
        AND datetime(COALESCE(executed_at, created_at)) > datetime('now', '-7 days')`,
    [productId]
  );

  // Increment view counter (fire-and-forget; failure shouldn't break render).
  query('UPDATE briefing_shares SET view_count = view_count + 1 WHERE share_code = ?', [code]).catch(
    () => {}
  );

  return {
    share_code: code,
    product_name: row.product_name as string,
    signal_score: (row.signal_score as number | null) ?? null,
    decisions_handled_7d: Number(drow.handled ?? 0),
    decisions_surfaced_7d: Number(drow.surfaced ?? 0),
    agent_actions_7d: Number((actions.rows[0] as Record<string, number | null>).n ?? 0),
    briefing_date: (row.briefing_date as string | null) ?? '',
    expires_at: row.expires_at as string,
  };
}

/**
 * Revoke a share early. Used when a founder regrets sharing.
 */
export async function revokeShare(founderId: string, shareCode: string): Promise<boolean> {
  const r = await query(
    `DELETE FROM briefing_shares WHERE share_code = ? AND founder_id = ?`,
    [shareCode, founderId]
  );
  return Number((r as unknown as { rowsAffected?: number }).rowsAffected ?? 0) > 0;
}
