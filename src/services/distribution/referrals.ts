// =============================================================================
// FOUNDRY — Referral Links (Wave 3, action 21)
// Each founder gets a unique invite link; conversions credit back to the
// inviter. Cheap acquisition mechanism per Council 21 (GTM): a happy
// alpha founder telling another founder is the cheapest acquisition.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReferralLink {
  id: string;
  founder_id: string;
  code: string;
  created_at: string;
  click_count: number;
  signup_count: number;
  paid_count: number;
}

const CODE_LENGTH = 10; // ~62^10 = ~10^17 — collision-free at any scale

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get-or-create the founder's referral link. Idempotent. The code is
 * stable for the founder's lifetime so links shared yesterday still work.
 */
export async function getOrCreateReferralLink(founderId: string): Promise<ReferralLink> {
  const existing = await query(
    'SELECT * FROM referral_links WHERE founder_id = ?',
    [founderId]
  );
  if (existing.rows.length > 0) {
    return rowToLink(existing.rows[0] as Record<string, unknown>);
  }

  // Generate; retry on the rare collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = nanoid();
    const code = nanoid(CODE_LENGTH);
    try {
      await query(
        `INSERT INTO referral_links (id, founder_id, code) VALUES (?, ?, ?)`,
        [id, founderId, code]
      );
      const r = await query('SELECT * FROM referral_links WHERE id = ?', [id]);
      return rowToLink(r.rows[0] as Record<string, unknown>);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/UNIQUE/i.test(msg)) throw err;
      // Either founder_id collision (race with another caller) or code
      // collision; loop and try again.
      const retry = await query(
        'SELECT * FROM referral_links WHERE founder_id = ?',
        [founderId]
      );
      if (retry.rows.length > 0) {
        return rowToLink(retry.rows[0] as Record<string, unknown>);
      }
    }
  }
  throw new Error('referral link creation failed after retries');
}

/**
 * Resolve a code to its link, or null. Used by the public landing page
 * when ?ref=<code> is in the URL.
 */
export async function resolveReferralCode(code: string): Promise<ReferralLink | null> {
  const r = await query('SELECT * FROM referral_links WHERE code = ?', [code]);
  if (r.rows.length === 0) return null;
  return rowToLink(r.rows[0] as Record<string, unknown>);
}

/**
 * Record a conversion event. event_type is 'click' (visit landing with ?ref=...),
 * 'signup' (founder created via that link), or 'paid' (subscription started).
 * Increments the appropriate counter on the link.
 */
export async function recordReferralEvent(
  code: string,
  event_type: 'click' | 'signup' | 'paid',
  opts: { invited_founder_id?: string; metadata?: Record<string, unknown> } = {}
): Promise<void> {
  const link = await resolveReferralCode(code);
  if (!link) return; // unknown code — silently ignore
  await query(
    `INSERT INTO referral_conversions (id, referral_link_id, event_type, invited_founder_id, metadata_json)
     VALUES (?, ?, ?, ?, ?)`,
    [nanoid(), link.id, event_type, opts.invited_founder_id ?? null, JSON.stringify(opts.metadata ?? {})]
  );
  const counterCol =
    event_type === 'click' ? 'click_count' :
    event_type === 'signup' ? 'signup_count' :
    'paid_count';
  await query(
    `UPDATE referral_links SET ${counterCol} = ${counterCol} + 1 WHERE id = ?`,
    [link.id]
  );
}

// ─── Internals ────────────────────────────────────────────────────────────────

function rowToLink(row: Record<string, unknown>): ReferralLink {
  return {
    id: row.id as string,
    founder_id: row.founder_id as string,
    code: row.code as string,
    created_at: row.created_at as string,
    click_count: Number(row.click_count ?? 0),
    signup_count: Number(row.signup_count ?? 0),
    paid_count: Number(row.paid_count ?? 0),
  };
}
