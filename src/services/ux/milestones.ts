// =============================================================================
// FOUNDRY — Milestone System
// Detects and celebrates meaningful progress events.
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
import { createNotification } from './notifications.js';
import { captureArtifact } from '../story/engine.js';
import type { MilestoneEvent } from '../../types/index.js';

// Milestones that also generate Founding Story artifacts
const STORY_MILESTONES = new Set([
  'first_ready_verdict',
  'wisdom_activated',
  'first_pr_merged',
  'composite_seven',
]);

interface MilestoneDefinition {
  title: string;
  description: string;
  check: (productId: string) => Promise<boolean>;
}

const MILESTONE_DEFINITIONS: Record<string, MilestoneDefinition> = {
  first_audit: {
    title: 'First Audit Complete',
    description: 'Foundry has a baseline. Every subsequent audit measures improvement from this score.',
    check: async (productId: string) => {
      const r = await query('SELECT COUNT(*) as c FROM audit_scores WHERE product_id = ?', [productId]);
      return ((r.rows[0] as Record<string, number>).c ?? 0) > 0;
    },
  },
  first_green: {
    title: 'GREEN State Achieved',
    description: 'All intelligence systems are operating normally. No immediate risks detected.',
    check: async (productId: string) => {
      const r = await query('SELECT risk_state FROM lifecycle_state WHERE product_id = ?', [productId]);
      return (r.rows[0] as Record<string, unknown>)?.risk_state === 'green';
    },
  },
  first_ready_verdict: {
    title: 'Audit Verdict: READY',
    description: 'Every dimension above 7. Composite above 7. Your product has crossed the threshold.',
    check: async (productId: string) => {
      const r = await query("SELECT COUNT(*) as c FROM audit_scores WHERE product_id = ? AND verdict = 'READY'", [productId]);
      return ((r.rows[0] as Record<string, number>).c ?? 0) > 0;
    },
  },
  wisdom_activated: {
    title: 'Wisdom Layer Activated',
    description: 'Foundry now knows your product, your ICP, and your positioning. Every judgment call improves from here.',
    check: async (productId: string) => {
      const r = await query('SELECT wisdom_layer_active FROM lifecycle_state WHERE product_id = ?', [productId]);
      return (r.rows[0] as Record<string, unknown>)?.wisdom_layer_active === 1;
    },
  },
  first_pr_merged: {
    title: 'First Automated Fix Merged',
    description: 'Foundry fixed something in your product while you were doing something else.',
    check: async (productId: string) => {
      const r = await query("SELECT COUNT(*) as c FROM remediation_prs WHERE product_id = ? AND status = 'merged'", [productId]);
      return ((r.rows[0] as Record<string, number>).c ?? 0) > 0;
    },
  },
  first_decision_reasoning: {
    title: 'Decision Intelligence Building',
    description: 'Your first decision with reasoning recorded. Foundry is beginning to learn how you think.',
    check: async (productId: string) => {
      const r = await query('SELECT COUNT(*) as c FROM decisions WHERE product_id = ? AND resolution_reasoning IS NOT NULL', [productId]);
      return ((r.rows[0] as Record<string, number>).c ?? 0) > 0;
    },
  },
  first_beta_user: {
    title: 'First Beta Intake Submitted',
    description: 'Someone is waiting to use what you built.',
    check: async (productId: string) => {
      const r = await query('SELECT COUNT(*) as c FROM beta_intake WHERE product_id = ?', [productId]);
      return ((r.rows[0] as Record<string, number>).c ?? 0) > 0;
    },
  },
  score_up_one_point: {
    title: 'Audit Score Improved 1+ Point',
    description: 'Measurable, documented progress. The methodology is working.',
    check: async (productId: string) => {
      const r = await query('SELECT composite FROM audit_scores WHERE product_id = ? ORDER BY created_at ASC LIMIT 2', [productId]);
      if (r.rows.length < 2) return false;
      const first = (r.rows[0] as Record<string, number>).composite;
      const second = (r.rows[1] as Record<string, number>).composite;
      return (second ?? 0) - (first ?? 0) >= 1.0;
    },
  },
  composite_seven: {
    title: 'Composite Score Above 7.0',
    description: 'Market-ready territory. Above the threshold on every dimension.',
    check: async (productId: string) => {
      const r = await query('SELECT composite FROM audit_scores WHERE product_id = ? ORDER BY created_at DESC LIMIT 1', [productId]);
      return ((r.rows[0] as Record<string, number>)?.composite ?? 0) >= 7.0;
    },
  },
  first_stressor_resolved: {
    title: 'First Stressor Resolved',
    description: 'A forward-looking risk was identified, addressed, and neutralized.',
    check: async (productId: string) => {
      const r = await query("SELECT COUNT(*) as c FROM stressor_history WHERE product_id = ? AND status = 'resolved'", [productId]);
      return ((r.rows[0] as Record<string, number>).c ?? 0) > 0;
    },
  },
};

/**
 * Run all milestone checks. Awards new milestones, creates notifications and story artifacts.
 * Returns array of newly awarded milestones.
 */
export async function checkAndAwardMilestones(
  productId: string,
  founderId: string,
): Promise<MilestoneEvent[]> {
  const awarded: MilestoneEvent[] = [];

  for (const [key, def] of Object.entries(MILESTONE_DEFINITIONS)) {
    try {
      // Check if already awarded
      const existing = await query(
        'SELECT id FROM milestone_events WHERE founder_id = ? AND product_id = ? AND milestone_key = ?',
        [founderId, productId, key],
      );
      if (existing.rows.length > 0) continue;

      // Check if milestone condition is met
      const passed = await def.check(productId);
      if (!passed) continue;

      // Award milestone
      const id = nanoid();
      const now = new Date().toISOString();
      await query(
        `INSERT INTO milestone_events (id, founder_id, product_id, milestone_key, milestone_title, milestone_description)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, founderId, productId, key, def.title, def.description],
      );

      const milestone: MilestoneEvent = {
        id,
        founder_id: founderId,
        product_id: productId,
        milestone_key: key,
        milestone_title: def.title,
        milestone_description: def.description,
        seen_at: null,
        created_at: now,
      };
      awarded.push(milestone);

      // Create notification
      await createNotification(
        founderId,
        productId,
        'milestone',
        `🏆 ${def.title}`,
        def.description,
        `/products/${productId}/journey`,
        'View Journey',
      );

      // Create Founding Story artifact for significant milestones
      if (STORY_MILESTONES.has(key)) {
        await captureArtifact({
          productId,
          phase: 'milestone',
          artifactType: 'milestone',
          title: def.title,
          content: def.description,
        });
      }
    } catch (err) {
      console.error(`[MILESTONES] Error checking ${key} for product ${productId}:`, err);
    }
  }

  return awarded;
}

/**
 * Get milestones that the founder has not yet seen.
 */
export async function getUnseenMilestones(founderId: string): Promise<MilestoneEvent[]> {
  const result = await query(
    'SELECT * FROM milestone_events WHERE founder_id = ? AND seen_at IS NULL ORDER BY created_at DESC',
    [founderId],
  );
  return result.rows as unknown as MilestoneEvent[];
}

/**
 * Mark all unseen milestones as seen for this founder.
 */
export async function markMilestonesAsSeen(founderId: string): Promise<void> {
  await query(
    'UPDATE milestone_events SET seen_at = CURRENT_TIMESTAMP WHERE founder_id = ? AND seen_at IS NULL',
    [founderId],
  );
}
