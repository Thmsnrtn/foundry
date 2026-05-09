// =============================================================================
// FOUNDRY — Rejection Streak Detector (Wave 2, action 19)
// When a founder rejects N decisions in a row, that's a calibration signal:
// the agents are off-voice, off-priority, or the wisdom layer hasn't
// activated. Surface a one-time prompt rather than silently logging
// rejections as evolution feedback (Council 14 finding).
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

const STREAK_THRESHOLD = 3;       // 3 in a row triggers prompt
const PROMPT_COOLDOWN_DAYS = 7;   // don't re-prompt within a week

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Increment the rejection streak. Called from rejectDraft.
 * Returns whether a calibration prompt should fire to the founder.
 */
export async function recordRejection(
  founderId: string,
  productId: string,
  agentName: string | null
): Promise<{ shouldPrompt: boolean; consecutive: number }> {
  // Aggregate streak (agentName=null) — that's what we surface to the
  // founder. Per-agent streaks are recorded in parallel for diagnostic
  // depth but don't drive the prompt.
  const aggregate = await upsertAndIncrement(founderId, productId, null);
  if (agentName) {
    await upsertAndIncrement(founderId, productId, agentName);
  }

  if (aggregate.consecutive < STREAK_THRESHOLD) {
    return { shouldPrompt: false, consecutive: aggregate.consecutive };
  }

  // Cooldown check.
  if (aggregate.last_calibration_prompt_at) {
    const lastMs = new Date(aggregate.last_calibration_prompt_at.replace(' ', 'T') + 'Z').getTime();
    const daysSince = (Date.now() - lastMs) / (1000 * 60 * 60 * 24);
    if (daysSince < PROMPT_COOLDOWN_DAYS) {
      return { shouldPrompt: false, consecutive: aggregate.consecutive };
    }
  }

  // Mark prompt fired so the next streak starts a new window.
  await query(
    `UPDATE rejection_streaks
        SET last_calibration_prompt_at = datetime('now')
      WHERE founder_id = ? AND product_id = ? AND COALESCE(agent_name, '*') = '*'`,
    [founderId, productId]
  );
  return { shouldPrompt: true, consecutive: aggregate.consecutive };
}

/**
 * Reset the streak. Called from approveDraft.
 */
export async function recordApproval(
  founderId: string,
  productId: string,
  agentName: string | null
): Promise<void> {
  // Reset both aggregate and per-agent streaks.
  await query(
    `UPDATE rejection_streaks
        SET consecutive_rejections = 0
      WHERE founder_id = ? AND product_id = ? AND COALESCE(agent_name, '*') = '*'`,
    [founderId, productId]
  );
  if (agentName) {
    await query(
      `UPDATE rejection_streaks
          SET consecutive_rejections = 0
        WHERE founder_id = ? AND product_id = ? AND agent_name = ?`,
      [founderId, productId, agentName]
    );
  }
}

export async function getStreak(
  founderId: string,
  productId: string
): Promise<{ consecutive: number; last_rejected_at: string | null }> {
  const r = await query(
    `SELECT consecutive_rejections, last_rejected_at FROM rejection_streaks
      WHERE founder_id = ? AND product_id = ? AND COALESCE(agent_name, '*') = '*'`,
    [founderId, productId]
  );
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (!row) return { consecutive: 0, last_rejected_at: null };
  return {
    consecutive: Number(row.consecutive_rejections ?? 0),
    last_rejected_at: (row.last_rejected_at as string | null) ?? null,
  };
}

// ─── Internals ────────────────────────────────────────────────────────────────

async function upsertAndIncrement(
  founderId: string,
  productId: string,
  agentName: string | null
): Promise<{ consecutive: number; last_calibration_prompt_at: string | null }> {
  const agentKey = agentName ?? '*';
  const existing = await query(
    `SELECT id, consecutive_rejections, last_calibration_prompt_at
       FROM rejection_streaks
      WHERE founder_id = ? AND product_id = ? AND COALESCE(agent_name, '*') = ?`,
    [founderId, productId, agentKey]
  );

  if (existing.rows.length === 0) {
    await query(
      `INSERT INTO rejection_streaks
         (id, founder_id, product_id, agent_name, consecutive_rejections, last_rejected_at)
       VALUES (?, ?, ?, ?, 1, datetime('now'))`,
      [nanoid(), founderId, productId, agentName]
    );
    return { consecutive: 1, last_calibration_prompt_at: null };
  }

  const row = existing.rows[0] as Record<string, unknown>;
  const next = Number(row.consecutive_rejections ?? 0) + 1;
  await query(
    `UPDATE rejection_streaks
        SET consecutive_rejections = ?, last_rejected_at = datetime('now')
      WHERE id = ?`,
    [next, row.id as string]
  );
  return {
    consecutive: next,
    last_calibration_prompt_at: (row.last_calibration_prompt_at as string | null) ?? null,
  };
}
