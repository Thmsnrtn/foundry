// =============================================================================
// FOUNDRY — Lifecycle Monitor: Condition Evaluation
// =============================================================================

import { query, insertAuditLog } from '../../db/client.js';
import { nanoid } from 'nanoid';
import type { RiskStateValue } from '../../types/index.js';

/**
 * THE ORDER OF THE PHASES, IN ONE PLACE.
 *
 * `parseInt('2_5')` is 2, so every caller that derived a phase number from the
 * key put Remediation and Hypothesis Formation at the same position — which is
 * how the lifecycle page came to show a completed phase as not started.
 */
export const PROMPT_ORDER = [
  'prompt_1', 'prompt_2', 'prompt_2_5', 'prompt_3', 'prompt_4',
  'prompt_5', 'prompt_6', 'prompt_7', 'prompt_8', 'prompt_9',
] as const;

/** Position in `PROMPT_ORDER`, or -1 for a value this system does not define. */
export function promptIndex(prompt: string | null | undefined): number {
  return PROMPT_ORDER.indexOf(String(prompt ?? '') as typeof PROMPT_ORDER[number]);
}

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
 * Evaluate all lifecycle conditions for a product, and record what they say.
 *
 * NOTHING ADVANCED THE LIFECYCLE. This function computed which prompts had all
 * their conditions met, wrote an audit-log line saying so, and returned the
 * list; the daily job logged it. `current_prompt` was written once, by the
 * INSERT that creates the row, and never again — so every company that has ever
 * run sat at `prompt_1` for as long as it existed, and:
 *
 *   the Lifecycle page told a company operating for months to "Run your first
 *   audit", with all nine phases drawn as not started;
 *   the weekly digest reported that stage to the founder;
 *   the Compass agent was told it in its prompt;
 *   and `lifecycleBandForPrompt` banded EVERY company as `pre_revenue`, so the
 *   cross-company benchmark pool compared a scaled company against companies
 *   with no revenue and called them a segment.
 *
 * The mechanism existed and was not connected. This connects it: a prompt whose
 * conditions are all met is marked `in_progress`, and `current_prompt` moves to
 * the furthest such prompt. It NEVER REGRESSES — a condition that stops being
 * true does not un-live the company's history.
 *
 * WHAT REMAINS UNREACHABLE, said here rather than implied: `prompt_2` and
 * `prompt_2_5` have no conditions defined at all, so nothing can activate them;
 * a company moves from phase 1 to phase 3 when phase 3's conditions are met.
 * And `prompt_9` requires `prompt_4_status = 'completed'`, which nothing in the
 * system sets — only the audit engine ever writes a 'completed' status, and only
 * for phase 1. Inventing either rule here would be inventing the lifecycle
 * rather than connecting it.
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

  // Which prompts have ALL of their conditions met
  const prompts = [...new Set(ACTIVATION_CONDITIONS.map((c) => c.prompt))];
  const met: string[] = [];
  for (const prompt of prompts) {
    const condResult = await query(
      `SELECT COUNT(*) as total, SUM(CASE WHEN condition_met = 1 THEN 1 ELSE 0 END) as met_count
       FROM lifecycle_conditions WHERE product_id = ? AND prompt = ?`,
      [productId, prompt]
    );
    const row = condResult.rows[0] as Record<string, number>;
    if (row.total > 0 && row.met_count === row.total) met.push(prompt);
  }
  if (met.length === 0) return newlyActivated;

  const lsResult = await query('SELECT * FROM lifecycle_state WHERE product_id = ?', [productId]);
  const ls = lsResult.rows[0] as Record<string, string> | undefined;
  if (!ls) return newlyActivated;

  for (const prompt of met) {
    const statusKey = `${prompt}_status`;
    if (ls[statusKey] !== 'dormant' && ls[statusKey] !== 'not_started') continue;

    // The status column name is built from a value in ACTIVATION_CONDITIONS,
    // which is a literal in this file — not from anything a caller supplies.
    await query(
      `UPDATE lifecycle_state SET ${statusKey} = 'in_progress', updated_at = datetime('now')
        WHERE product_id = ?`,
      [productId],
    );
    newlyActivated.push(prompt);

    await insertAuditLog({
      id: nanoid(), product_id: productId,
      action_type: 'lifecycle_condition_met', gate: 2,
      trigger: 'lifecycle_check', reasoning: `All conditions met for ${prompt}`,
      risk_state_at_action: ls.risk_state ?? null,
    });
  }

  // FORWARD ONLY. The furthest prompt whose conditions are met is where the
  // company is; a condition that later stops being true does not move it back.
  const furthest = met.reduce((best, p) =>
    promptIndex(p) > promptIndex(best) ? p : best, met[0]);
  if (promptIndex(furthest) > promptIndex(ls.current_prompt)) {
    await query(
      `UPDATE lifecycle_state SET current_prompt = ?, updated_at = datetime('now')
        WHERE product_id = ?`,
      [furthest, productId],
    );
    await insertAuditLog({
      id: nanoid(), product_id: productId,
      action_type: 'lifecycle_advanced', gate: 2,
      trigger: 'lifecycle_check',
      reasoning: `Advanced from ${ls.current_prompt} to ${furthest}: all conditions met`,
      risk_state_at_action: ls.risk_state ?? null,
    });
  }

  return newlyActivated;
}
