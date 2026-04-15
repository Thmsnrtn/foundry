// =============================================================================
// FOUNDRY — Autonomy Engine
// Tracks founder trust, scales autonomy over time, and aligns value with pricing.
//
// Core principle: Foundry earns autonomy through demonstrated accuracy.
// More trust = more actions = more value = natural upgrade path.
// The founder never pays for actions that didn't help.
// =============================================================================

import { query } from '../../db/client.js';
import { log } from '../../lib/logger.js';

// ─── Trust Score ────────────────────────────────────────────────────────────

export interface TrustScore {
  /** Overall trust level 0-100. Determines how many actions/day and default gate. */
  score: number;
  level: 'new' | 'learning' | 'calibrated' | 'trusted' | 'autonomous';
  /** Actions per day this trust level allows */
  maxActionsPerDay: number;
  /** Default gate for new actions at this trust level */
  defaultGate: number;
  /** Categories where Gate 0 has been earned */
  autoApprovedCategories: string[];
  /** Stats that drive the score */
  stats: {
    totalActions: number;
    approved: number;
    dismissed: number;
    approvalRate: number;
    daysActive: number;
    wisdomActive: boolean;
    decisionsResolved: number;
  };
}

/** Trust levels and their thresholds */
const TRUST_LEVELS = [
  { name: 'new' as const,         minScore: 0,  maxActions: 1, defaultGate: 2 },
  { name: 'learning' as const,    minScore: 20, maxActions: 2, defaultGate: 2 },
  { name: 'calibrated' as const,  minScore: 45, maxActions: 3, defaultGate: 1 },
  { name: 'trusted' as const,     minScore: 70, maxActions: 5, defaultGate: 1 },
  { name: 'autonomous' as const,  minScore: 90, maxActions: 7, defaultGate: 0 },
] as const;

/**
 * Calculate the trust score for a product based on action history and engagement.
 *
 * Trust is earned through:
 * - Approving actions (the founder confirms Foundry's judgment was right)
 * - Time on platform (consistent engagement, not just signup)
 * - Wisdom Layer activation (founder invested in teaching Foundry)
 * - Decision history (resolved decisions train the pattern library)
 *
 * Trust is lost through:
 * - Dismissing actions (the founder says Foundry's judgment was wrong)
 * - Inactivity (metrics go stale, founder stops engaging)
 */
export async function calculateTrustScore(productId: string, founderId: string): Promise<TrustScore> {
  // Gather signals
  const [actionStats, wisdomStatus, decisionStats, productAge] = await Promise.all([
    query(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'approved' OR status = 'completed' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END) as dismissed
       FROM daily_actions WHERE product_id = ?`,
      [productId]
    ),
    query(
      'SELECT wisdom_layer_active, dna_completion_pct FROM lifecycle_state WHERE product_id = ?',
      [productId]
    ),
    query(
      `SELECT COUNT(*) as resolved FROM decisions WHERE product_id = ? AND status IN ('approved', 'executed')`,
      [productId]
    ),
    query('SELECT created_at FROM products WHERE id = ?', [productId]),
  ]);

  const aStats = actionStats.rows[0] as Record<string, number>;
  const wStatus = wisdomStatus.rows[0] as Record<string, unknown> | undefined;
  const dStats = decisionStats.rows[0] as Record<string, number>;
  const createdAt = (productAge.rows[0] as Record<string, string>)?.created_at;

  const totalActions = aStats?.total ?? 0;
  const approved = aStats?.approved ?? 0;
  const dismissed = aStats?.dismissed ?? 0;
  const approvalRate = totalActions > 0 ? approved / totalActions : 0;
  const wisdomActive = !!(wStatus?.wisdom_layer_active);
  const decisionsResolved = dStats?.resolved ?? 0;
  const daysActive = createdAt ? Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000) : 0;

  // Calculate score components (each 0-25, total 0-100)
  let score = 0;

  // Component 1: Approval rate (0-30 points)
  // Approval rate above 80% earns full points. Below 50% earns nothing.
  if (totalActions >= 5) {
    score += Math.min(30, Math.max(0, (approvalRate - 0.5) / 0.3 * 30));
  }

  // Component 2: Volume (0-25 points)
  // More approved actions = more data points = more confidence
  score += Math.min(25, approved * 1.5);

  // Component 3: Wisdom engagement (0-20 points)
  // DNA completion and wisdom activation show the founder is invested
  const dnaCompletion = (wStatus?.dna_completion_pct as number) ?? 0;
  score += wisdomActive ? 20 : Math.min(15, (dnaCompletion / 60) * 15);

  // Component 4: Decision history (0-15 points)
  // Resolved decisions mean the pattern library is being trained
  score += Math.min(15, decisionsResolved * 1.5);

  // Component 5: Time on platform (0-10 points)
  // Steady engagement over months, not just a signup spike
  score += Math.min(10, Math.floor(daysActive / 7)); // 1 point per week, max 10

  // Penalty: Dismissals reduce trust
  score -= dismissed * 3; // Each dismissal costs 3 points
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Determine level
  const level = [...TRUST_LEVELS].reverse().find((l) => score >= l.minScore) ?? TRUST_LEVELS[0];

  // Determine auto-approved categories (categories where founder has approved 5+ times without dismissal)
  const categoryApprovals = await query(
    `SELECT action_type,
       SUM(CASE WHEN status IN ('approved', 'completed') THEN 1 ELSE 0 END) as approvals,
       SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END) as dismissals
     FROM daily_actions WHERE product_id = ? GROUP BY action_type`,
    [productId]
  );
  const autoApproved = (categoryApprovals.rows as Array<Record<string, unknown>>)
    .filter((r) => (r.approvals as number) >= 5 && (r.dismissals as number) === 0)
    .map((r) => r.action_type as string);

  return {
    score,
    level: level.name,
    maxActionsPerDay: level.maxActions,
    defaultGate: level.defaultGate,
    autoApprovedCategories: autoApproved,
    stats: {
      totalActions,
      approved,
      dismissed,
      approvalRate: Math.round(approvalRate * 100) / 100,
      daysActive,
      wisdomActive,
      decisionsResolved,
    },
  };
}

// ─── Tier Action Limits ─────────────────────────────────────────────────────
// Philosophy: zero-cost actions (nudges, metric checks, badge updates) are UNLIMITED
// on all paid tiers. The limit is on AI-drafted content, which has real compute cost.
// This means every paying customer sees Foundry working hard for them every day.

export interface TierActionConfig {
  /** Maximum actions per day (including zero-cost actions). Effectively unlimited on paid tiers. */
  maxActionsPerDay: number;
  /** Maximum AI-drafted actions per day (churn emails, competitive plans — these cost $0.03-0.15 each) */
  aiDraftsPerDay: number;
  /** Maximum AI calls per month for daily actions (total budget for AI-heavy work) */
  aiCallsPerMonth: number;
  /** Whether the daily action uses the Wisdom Layer for calibration */
  wisdomCalibration: boolean;
}

export function getTierActionConfig(tier: string | null): TierActionConfig {
  switch (tier) {
    case 'founding_cohort':
      // $99/mo — full access, unlimited actions, generous AI budget
      // Cost: ~$5-10/mo in AI compute per active user. Margin: 90%+
      return { maxActionsPerDay: 20, aiDraftsPerDay: 5, aiCallsPerMonth: 300, wisdomCalibration: true };
    case 'scale':
      // $399/mo — unlimited actions, 3 AI drafts/day
      // Cost: ~$8-15/mo in AI compute. Margin: 96%+
      return { maxActionsPerDay: 20, aiDraftsPerDay: 3, aiCallsPerMonth: 200, wisdomCalibration: true };
    case 'growth':
      // $199/mo — unlimited zero-cost actions, 1 AI draft/day
      // Cost: ~$2-4/mo in AI compute. Margin: 98%+
      return { maxActionsPerDay: 15, aiDraftsPerDay: 1, aiCallsPerMonth: 60, wisdomCalibration: false };
    default:
      // Free/trial — limited actions, no AI drafts
      return { maxActionsPerDay: 3, aiDraftsPerDay: 0, aiCallsPerMonth: 0, wisdomCalibration: false };
  }
}

/**
 * Get the effective action limit for a product — minimum of trust score and tier ceiling.
 */
export async function getEffectiveActionLimit(productId: string, founderId: string, tier: string | null): Promise<{
  actionsPerDay: number;
  aiDraftsPerDay: number;
  wisdomCalibration: boolean;
  trustScore: TrustScore;
  tierConfig: TierActionConfig;
  /** If the founder would benefit from upgrading, this explains why */
  upgradePrompt: string | null;
}> {
  const [trust, tierConfig] = await Promise.all([
    calculateTrustScore(productId, founderId),
    Promise.resolve(getTierActionConfig(tier)),
  ]);

  // Actions per day: trust score determines autonomy WITHIN the tier ceiling
  // But on paid tiers the ceiling is high enough that trust is the real limiter
  const actionsPerDay = Math.min(trust.maxActionsPerDay, tierConfig.maxActionsPerDay);

  // AI drafts: tier determines the budget, trust determines if they auto-execute
  const aiDraftsPerDay = tierConfig.aiDraftsPerDay;

  // Upgrade prompt: show when the founder would get more AI drafts by upgrading
  let upgradePrompt: string | null = null;
  if (tier === 'growth' && trust.score >= 45) {
    upgradePrompt = 'Your trust level qualifies for AI-drafted churn interventions and competitive responses. Upgrade to Scale to unlock Wisdom-calibrated drafts.';
  } else if (!tier && trust.score >= 20) {
    upgradePrompt = 'Foundry is learning your product. Upgrade to Growth to unlock unlimited daily actions and your first AI draft per day.';
  }

  return {
    actionsPerDay,
    aiDraftsPerDay,
    wisdomCalibration: tierConfig.wisdomCalibration,
    trustScore: trust,
    tierConfig,
    upgradePrompt,
  };
}

// ─── Value Tracking ─────────────────────────────────────────────────────────
// Track the measurable value Foundry delivers so pricing feels transparent.

export interface ValueSummary {
  /** Total actions taken this month */
  actionsThisMonth: number;
  /** Actions that were approved (founder confirmed value) */
  approvedThisMonth: number;
  /** AI drafts generated this month */
  draftsGenerated: number;
  /** Stressors identified (problems caught early) */
  stressorsIdentified: number;
  /** Decisions facilitated */
  decisionsResolved: number;
  /** Estimated hours saved (conservative: 15min per action, 30min per draft, 1hr per decision) */
  estimatedHoursSaved: number;
}

export async function getMonthlyValueSummary(productId: string): Promise<ValueSummary> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const monthStart = startOfMonth.toISOString();

  const [actions, stressors, decisions] = await Promise.all([
    query(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('approved', 'completed') THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN draft_content IS NOT NULL THEN 1 ELSE 0 END) as drafts
       FROM daily_actions WHERE product_id = ? AND created_at >= ?`,
      [productId, monthStart]
    ),
    query(
      `SELECT COUNT(*) as count FROM stressor_history WHERE product_id = ? AND identified_at >= ?`,
      [productId, monthStart]
    ),
    query(
      `SELECT COUNT(*) as count FROM decisions WHERE product_id = ? AND decided_at >= ?`,
      [productId, monthStart]
    ),
  ]);

  const aRow = actions.rows[0] as Record<string, number>;
  const sRow = stressors.rows[0] as Record<string, number>;
  const dRow = decisions.rows[0] as Record<string, number>;

  const actionsTotal = aRow?.total ?? 0;
  const approvedTotal = aRow?.approved ?? 0;
  const draftsTotal = aRow?.drafts ?? 0;
  const stressorsTotal = sRow?.count ?? 0;
  const decisionsTotal = dRow?.count ?? 0;

  // Conservative estimate: 15 min per action, 30 min per draft, 60 min per decision
  const hoursSaved = (actionsTotal * 0.25) + (draftsTotal * 0.5) + (decisionsTotal * 1.0);

  return {
    actionsThisMonth: actionsTotal,
    approvedThisMonth: approvedTotal,
    draftsGenerated: draftsTotal,
    stressorsIdentified: stressorsTotal,
    decisionsResolved: decisionsTotal,
    estimatedHoursSaved: Math.round(hoursSaved * 10) / 10,
  };
}
