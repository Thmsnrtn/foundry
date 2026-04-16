// =============================================================================
// FOUNDRY — Founder Preference Learner
// Infers and records how the founder prefers to receive information from agents.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';

export interface FounderPreference {
  preference_type: string;
  preference_key: string;
  preference_value: string;
  confidence: number;
}

// ─── Record a single preference signal (upsert) ───────────────────────────────

export async function recordPreferenceSignal(
  productId: string,
  type: 'detail_level' | 'framing' | 'agent_trust' | 'override_pattern',
  key: string,
  value: string
): Promise<void> {
  // Check if exists
  const existing = await query(
    `SELECT id, confidence, evidence_count
     FROM founder_preferences
     WHERE product_id = ? AND preference_type = ? AND preference_key = ?`,
    [productId, type, key]
  );

  if (existing.rows.length === 0) {
    // Insert fresh
    await query(
      `INSERT INTO founder_preferences
         (id, product_id, preference_type, preference_key, preference_value,
          confidence, evidence_count, last_updated)
       VALUES (?, ?, ?, ?, ?, 0.5, 1, datetime('now'))`,
      [nanoid(), productId, type, key, value]
    );
  } else {
    const row = existing.rows[0] as Record<string, unknown>;
    const currentConf = (row.confidence as number) ?? 0.5;
    const evidenceCount = (row.evidence_count as number) ?? 1;
    // Increase confidence toward 1.0 with diminishing returns
    const newConf = Math.min(0.99, currentConf + (1 - currentConf) * 0.15);
    const newCount = evidenceCount + 1;

    await query(
      `UPDATE founder_preferences
       SET preference_value = ?, confidence = ?, evidence_count = ?, last_updated = datetime('now')
       WHERE product_id = ? AND preference_type = ? AND preference_key = ?`,
      [value, newConf, newCount, productId, type, key]
    );
  }
}

// ─── Get all preferences for a product ───────────────────────────────────────

export async function getPreferences(productId: string): Promise<FounderPreference[]> {
  const result = await query(
    `SELECT preference_type, preference_key, preference_value, confidence
     FROM founder_preferences
     WHERE product_id = ?
     ORDER BY confidence DESC, last_updated DESC`,
    [productId]
  );

  return result.rows.map((rawRow) => {
    const row = rawRow as Record<string, unknown>;
    return {
      preference_type: row.preference_type as string,
      preference_key: row.preference_key as string,
      preference_value: row.preference_value as string,
      confidence: row.confidence as number,
    };
  });
}

// ─── Get preference summary paragraph for injection into agent prompts ────────

export async function getPreferenceSummary(productId: string): Promise<string> {
  const prefs = await getPreferences(productId);
  if (prefs.length === 0) {
    return 'No founder communication preferences recorded yet.';
  }

  // Only include high-confidence preferences (≥ 0.6)
  const confident = prefs.filter((p) => p.confidence >= 0.6);
  if (confident.length === 0) {
    return 'Founder preferences are still being inferred — insufficient signal.';
  }

  const parts: string[] = [];

  // Group by type for readable output
  const byType: Record<string, FounderPreference[]> = {};
  for (const p of confident) {
    if (!byType[p.preference_type]) byType[p.preference_type] = [];
    byType[p.preference_type].push(p);
  }

  if (byType['detail_level']) {
    const levels = byType['detail_level'].map((p) => `${p.preference_key}: ${p.preference_value}`).join(', ');
    parts.push(`Preferred detail level — ${levels}.`);
  }

  if (byType['framing']) {
    const framings = byType['framing'].map((p) => `${p.preference_key}: ${p.preference_value}`).join(', ');
    parts.push(`Preferred framing — ${framings}.`);
  }

  if (byType['agent_trust']) {
    const trusted = byType['agent_trust']
      .filter((p) => p.preference_value === 'high')
      .map((p) => p.preference_key);
    const cautious = byType['agent_trust']
      .filter((p) => p.preference_value === 'low')
      .map((p) => p.preference_key);
    if (trusted.length > 0) parts.push(`Founder typically acts on recommendations from: ${trusted.join(', ')}.`);
    if (cautious.length > 0) parts.push(`Founder frequently overrides: ${cautious.join(', ')}.`);
  }

  if (byType['override_pattern']) {
    const patterns = byType['override_pattern'].map((p) => p.preference_value).join('; ');
    parts.push(`Known override patterns: ${patterns}.`);
  }

  return parts.join(' ');
}

// ─── Infer preferences from historical data ───────────────────────────────────

export async function inferPreferencesFromHistory(productId: string): Promise<number> {
  let updatedCount = 0;

  // ── 1. Agent trust: which agents get their actions approved vs cancelled ──
  const actionResult = await query(
    `SELECT oa.agent_name,
       COUNT(*) as total,
       COUNT(CASE WHEN oa.status IN ('approved','executed','completed') THEN 1 END) as approved,
       COUNT(CASE WHEN oa.status = 'cancelled' OR oa.status = 'rejected' THEN 1 END) as cancelled
     FROM outbound_actions oa
     WHERE oa.product_id = ?
     GROUP BY oa.agent_name
     HAVING total >= 3`,
    [productId]
  );

  for (const rawRow of actionResult.rows) {
    const row = rawRow as Record<string, unknown>;
    const agentName = row.agent_name as string;
    const approved = (row.approved as number) ?? 0;
    const cancelled = (row.cancelled as number) ?? 0;
    const total = (row.total as number) ?? 1;
    const approvalRate = approved / total;
    const cancellationRate = cancelled / total;

    if (approvalRate >= 0.7) {
      await recordPreferenceSignal(productId, 'agent_trust', agentName, 'high');
      updatedCount++;
    } else if (cancellationRate >= 0.4) {
      await recordPreferenceSignal(productId, 'agent_trust', agentName, 'low');
      updatedCount++;
    }
  }

  // ── 2. Agent trust: which agents are cited in strategic decisions ──────────
  const decisionsResult = await query(
    `SELECT agent_context_json FROM strategic_decisions_log
     WHERE product_id = ? AND agent_context_json != '{}'
     ORDER BY made_at DESC LIMIT 50`,
    [productId]
  );

  const agentDecisionCounts: Record<string, number> = {};
  for (const rawRow of decisionsResult.rows) {
    const row = rawRow as Record<string, unknown>;
    const jsonStr = row.agent_context_json as string;
    try {
      const ctx = JSON.parse(jsonStr) as Record<string, unknown>;
      for (const agentName of Object.keys(ctx)) {
        agentDecisionCounts[agentName] = (agentDecisionCounts[agentName] ?? 0) + 1;
      }
    } catch {
      // Skip malformed JSON
    }
  }

  for (const [agentName, count] of Object.entries(agentDecisionCounts)) {
    if (count >= 3) {
      await recordPreferenceSignal(productId, 'agent_trust', agentName, 'high');
      updatedCount++;
    }
  }

  // ── 3. Override patterns: most-cancelled action types ─────────────────────
  const cancelledTypesResult = await query(
    `SELECT oa.action_type, COUNT(*) as cnt
     FROM outbound_actions oa
     WHERE oa.product_id = ? AND (oa.status = 'cancelled' OR oa.status = 'rejected')
     GROUP BY oa.action_type
     HAVING cnt >= 2
     ORDER BY cnt DESC
     LIMIT 5`,
    [productId]
  );

  for (const rawRow of cancelledTypesResult.rows) {
    const row = rawRow as Record<string, unknown>;
    const actionType = row.action_type as string;
    const cnt = row.cnt as number;
    await recordPreferenceSignal(
      productId,
      'override_pattern',
      `cancelled_action_type_${actionType}`,
      `Founder frequently cancels "${actionType}" actions (${cnt}x)`
    );
    updatedCount++;
  }

  // ── 4. Detail level: infer from action execution feedback patterns ─────────
  const feedbackResult = await query(
    `SELECT
       COUNT(CASE WHEN ae.status = 'approved' THEN 1 END) as approved_count,
       COUNT(CASE WHEN ae.status = 'cancelled' THEN 1 END) as cancelled_count,
       COUNT(*) as total
     FROM action_executions ae
     WHERE ae.product_id = ?`,
    [productId]
  );

  if (feedbackResult.rows.length > 0) {
    const fb = feedbackResult.rows[0] as Record<string, unknown>;
    const total = (fb.total as number) ?? 0;
    const approvedCount = (fb.approved_count as number) ?? 0;
    if (total >= 5) {
      const approvalRate = approvedCount / total;
      if (approvalRate >= 0.75) {
        await recordPreferenceSignal(productId, 'detail_level', 'action_approval_style', 'quick_approve');
        updatedCount++;
      } else if (approvalRate < 0.4) {
        await recordPreferenceSignal(productId, 'detail_level', 'action_approval_style', 'careful_review');
        updatedCount++;
      }
    }
  }

  return updatedCount;
}
