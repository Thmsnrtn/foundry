// =============================================================================
// FOUNDRY — Founder Autopilot Preferences
// Let founders fine-tune what Foundry does, how aggressively it acts,
// and which areas to focus on. Stored per-product.
// =============================================================================

import { query } from '../../db/client.js';
import { log } from '../../lib/logger.js';

export interface AutopilotPreferences {
  // ─── Focus Areas (which action types to prioritize) ───────────────────
  /** 1-10 priority weight for each action category. Higher = Foundry focuses more here. */
  focus: {
    churn_prevention: number;      // Churn interventions, retention alerts
    revenue_growth: number;        // Expansion opportunities, pricing suggestions
    competitive_awareness: number; // Competitor monitoring, market signals
    product_quality: number;       // Audit score, remediation, blocking issues
    operational_health: number;    // Metrics freshness, decision velocity
    wisdom_building: number;       // DNA completion, failure logging, pattern synthesis
  };

  // ─── Communication Style ──────────────────────────────────────────────
  /** How detailed should action summaries be? */
  detail_level: 'brief' | 'standard' | 'detailed';
  /** Should Foundry explain its reasoning or just state the action? */
  show_reasoning: boolean;

  // ─── Autonomy Preferences ─────────────────────────────────────────────
  /** Categories the founder wants to always approve (never auto-execute) */
  always_approve: string[];
  /** Categories the founder wants fully autonomous (skip approval even if Gate 2) */
  always_auto: string[];

  // ─── Notification Preferences ─────────────────────────────────────────
  /** Send daily action summary via email? */
  email_daily_summary: boolean;
  /** Only notify for actions above this priority threshold (0-100) */
  min_notification_priority: number;
  /** Quiet hours — don't send notifications between these times */
  quiet_start: string | null;  // HH:MM
  quiet_end: string | null;    // HH:MM
}

const DEFAULT_PREFERENCES: AutopilotPreferences = {
  focus: {
    churn_prevention: 8,
    revenue_growth: 6,
    competitive_awareness: 5,
    product_quality: 7,
    operational_health: 5,
    wisdom_building: 4,
  },
  detail_level: 'standard',
  show_reasoning: true,
  always_approve: [],
  always_auto: [],
  email_daily_summary: true,
  min_notification_priority: 20,
  quiet_start: null,
  quiet_end: null,
};

/**
 * Get autopilot preferences for a product. Returns defaults if not configured.
 */
export async function getAutopilotPreferences(productId: string): Promise<AutopilotPreferences> {
  const result = await query(
    'SELECT preferences FROM autopilot_config WHERE product_id = ?',
    [productId]
  );

  if (result.rows.length === 0) return { ...DEFAULT_PREFERENCES };

  try {
    const stored = JSON.parse((result.rows[0] as Record<string, string>).preferences);
    return { ...DEFAULT_PREFERENCES, ...stored };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

/**
 * Save autopilot preferences for a product.
 */
export async function saveAutopilotPreferences(productId: string, prefs: Partial<AutopilotPreferences>): Promise<void> {
  const current = await getAutopilotPreferences(productId);
  const merged = { ...current, ...prefs };

  // Validate focus weights are 1-10
  for (const [key, val] of Object.entries(merged.focus)) {
    merged.focus[key as keyof typeof merged.focus] = Math.max(1, Math.min(10, val));
  }

  await query(
    `INSERT INTO autopilot_config (product_id, preferences, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (product_id) DO UPDATE SET preferences = excluded.preferences, updated_at = CURRENT_TIMESTAMP`,
    [productId, JSON.stringify(merged)]
  );

  log.info('Autopilot preferences updated', { productId });
}

/**
 * Apply focus weights to action candidate priorities.
 * This is called during daily action planning to reweight candidates
 * based on what the founder cares about most.
 */
export function applyFocusWeights(
  candidates: Array<{ priority: number; action: { action_type: string } }>,
  focus: AutopilotPreferences['focus'],
): void {
  const focusMap: Record<string, keyof typeof focus> = {
    churn_intervention: 'churn_prevention',
    competitive_response: 'competitive_awareness',
    decision_nudge: 'operational_health',
    metrics_reminder: 'operational_health',
    dna_push: 'wisdom_building',
    audit_stale: 'product_quality',
    all_clear: 'operational_health',
  };

  for (const candidate of candidates) {
    const focusKey = focusMap[candidate.action.action_type];
    if (focusKey) {
      const weight = focus[focusKey]; // 1-10
      // Scale priority by focus weight: weight 10 = 1.5x, weight 5 = 1.0x, weight 1 = 0.5x
      const multiplier = 0.5 + (weight / 10);
      candidate.priority = Math.round(candidate.priority * multiplier);
    }
  }
}
