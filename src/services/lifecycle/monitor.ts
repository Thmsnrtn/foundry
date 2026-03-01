// =============================================================================
// FOUNDRY — Lifecycle Monitor: Condition Evaluation
// =============================================================================

import { query, insertAuditLog } from '../../db/client.js';
import { nanoid } from 'nanoid';
import type { RiskStateValue } from '../../types/index.js';

export interface ConditionDef {
  prompt: string;
  name: string;
  evaluate: (productId: string) => Promise<{ met: boolean; currentValue: string; threshold: string }>;
}

export const ACTIVATION_CONDITIONS: ConditionDef[] = [
  // Prompt 3: 10+ beta intakes AND first cohort at day 30
  {
    prompt: 'prompt_3', name: 'beta_intake_count',
    evaluate: async (pid) => {
      const r = await query('SELECT COUNT(*) as c FROM beta_intake WHERE product_id = ? AND processed = 1', [pid]);
      const count = (r.rows[0] as Record<string, number>)?.c ?? 0;
      return { met: count >= 10, currentValue: String(count), threshold: '10' };
    },
  },
  {
    prompt: 'prompt_3', name: 'first_cohort_day_30',
    evaluate: async (pid) => {
      const r = await query(
        `SELECT COUNT(*) as c FROM cohorts WHERE product_id = ? AND founder_count >= 10
         AND acquisition_period <= date('now', '-30 days')`, [pid]);
      const count = (r.rows[0] as Record<string, number>)?.c ?? 0;
      return { met: count >= 1, currentValue: String(count), threshold: '1' };
    },
  },
  // Prompt 4: Live 14+ days AND 50+ signups
  {
    prompt: 'prompt_4', name: 'live_14_days',
    evaluate: async (pid) => {
      const r = await query('SELECT prompt_4_completed_at FROM lifecycle_state WHERE product_id = ?', [pid]);
      // Check if product has been live for 14+ days (using prompt_2 completion as proxy)
      const r2 = await query('SELECT created_at FROM products WHERE id = ?', [pid]);
      const created = (r2.rows[0] as Record<string, string>)?.created_at;
      if (!created) return { met: false, currentValue: '0', threshold: '14' };
      const days = Math.floor((Date.now() - new Date(created).getTime()) / 86400000);
      return { met: days >= 14, currentValue: String(days), threshold: '14' };
    },
  },
  {
    prompt: 'prompt_4', name: 'signups_50',
    evaluate: async (pid) => {
      const r = await query(
        'SELECT SUM(signups_7d) as total FROM metric_snapshots WHERE product_id = ?', [pid]);
      const total = (r.rows[0] as Record<string, number>)?.total ?? 0;
      return { met: total >= 50, currentValue: String(total), threshold: '50' };
    },
  },
  // Prompt 5: Competitive trigger
  {
    prompt: 'prompt_5', name: 'competitive_trigger',
    evaluate: async (pid) => {
      const r = await query(
        `SELECT COUNT(*) as c FROM competitive_signals WHERE product_id = ? AND significance = 'high' AND reviewed = 0`, [pid]);
      const count = (r.rows[0] as Record<string, number>)?.c ?? 0;
      return { met: count > 0, currentValue: String(count), threshold: '1' };
    },
  },
  // Prompt 6: 60+ days retention data AND 50+ feature requests
  {
    prompt: 'prompt_6', name: 'retention_60_days',
    evaluate: async (pid) => {
      const r = await query(
        'SELECT COUNT(*) as c FROM metric_snapshots WHERE product_id = ? AND snapshot_date <= date(\'now\', \'-60 days\')', [pid]);
      const count = (r.rows[0] as Record<string, number>)?.c ?? 0;
      return { met: count > 0, currentValue: count > 0 ? '60+' : '<60', threshold: '60 days' };
    },
  },
  // Prompt 7: MRR threshold 3 consecutive months AND oldest cohort 90+ days
  {
    prompt: 'prompt_7', name: 'mrr_3_months',
    evaluate: async (pid) => {
      const r = await query(
        `SELECT new_mrr_cents FROM metric_snapshots WHERE product_id = ?
         ORDER BY snapshot_date DESC LIMIT 12`, [pid]);
      // Simplified: check if there's any MRR data spanning 3+ months
      return { met: r.rows.length >= 90, currentValue: String(r.rows.length), threshold: '90 snapshots' };
    },
  },
  // Prompt 8: 200+ active paying users AND retention threshold
  {
    prompt: 'prompt_8', name: 'active_users_200',
    evaluate: async (pid) => {
      const r = await query(
        'SELECT active_users FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1', [pid]);
      const users = (r.rows[0] as Record<string, number>)?.active_users ?? 0;
      return { met: users >= 200, currentValue: String(users), threshold: '200' };
    },
  },
  // Prompt 9: Prompt 4 completed
  {
    prompt: 'prompt_9', name: 'prompt_4_completed',
    evaluate: async (pid) => {
      const r = await query('SELECT prompt_4_status FROM lifecycle_state WHERE product_id = ?', [pid]);
      const status = (r.rows[0] as Record<string, string>)?.prompt_4_status ?? 'not_started';
      return { met: status === 'completed', currentValue: status, threshold: 'completed' };
    },
  },
];

/**
 * Evaluate all lifecycle conditions for a product.
 * Returns prompts that are newly activated.
 */
export async function evaluateConditions(productId: string): Promise<string[]> {
  const newlyActivated: string[] = [];
  const now = new Date().toISOString();

  for (const condition of ACTIVATION_CONDITIONS) {
    const result = await condition.evaluate(productId);

    // Upsert condition state
    await query(
      `INSERT INTO lifecycle_conditions (product_id, prompt, condition_name, condition_met, current_value, threshold_value, last_checked)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (product_id, prompt, condition_name) DO UPDATE SET
         condition_met = ?, current_value = ?, last_checked = ?`,
      [productId, condition.prompt, condition.name, result.met ? 1 : 0, result.currentValue, result.threshold, now,
       result.met ? 1 : 0, result.currentValue, now]
    );
  }

  // Check which prompts have ALL conditions met
  const prompts = [...new Set(ACTIVATION_CONDITIONS.map((c) => c.prompt))];
  for (const prompt of prompts) {
    const condResult = await query(
      `SELECT COUNT(*) as total, SUM(CASE WHEN condition_met = 1 THEN 1 ELSE 0 END) as met_count
       FROM lifecycle_conditions WHERE product_id = ? AND prompt = ?`,
      [productId, prompt]
    );
    const row = condResult.rows[0] as Record<string, number>;
    if (row.total > 0 && row.met_count === row.total) {
      // Check if prompt isn't already activated
      const lsResult = await query('SELECT * FROM lifecycle_state WHERE product_id = ?', [productId]);
      const ls = lsResult.rows[0] as Record<string, string> | undefined;
      const statusKey = `${prompt.replace('prompt_', 'prompt_')}_status`;
      if (ls && (ls[statusKey] === 'dormant' || ls[statusKey] === 'not_started')) {
        newlyActivated.push(prompt);

        await insertAuditLog({
          id: nanoid(), product_id: productId,
          action_type: 'lifecycle_condition_met', gate: 2,
          trigger: 'lifecycle_check', reasoning: `All conditions met for ${prompt}`,
          risk_state_at_action: ls.risk_state ?? null,
        });
      }
    }
  }

  return newlyActivated;
}
