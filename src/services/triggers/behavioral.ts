// =============================================================================
// FOUNDRY — Behavioral Trigger Email System
// All Gate 0 (fully autonomous). Logged in audit_log.
// =============================================================================

import { query, insertAuditLog } from '../../db/client.js';
import { sendTriggerEmail } from '../digest/delivery.js';
import { nanoid } from 'nanoid';
import type { RiskStateValue } from '../../types/index.js';

interface TriggerCheck {
  name: string;
  condition: string;
  subject: string;
  body: string;
  check: (founderId: string, productId: string) => Promise<boolean>;
}

const STANDARD_TRIGGERS: TriggerCheck[] = [
  {
    name: 'stuck_at_github',
    condition: 'signed up but no github_connected within 24h',
    subject: 'Connect your GitHub to see your product\'s score',
    body: '<p>You signed up for Foundry but haven\'t connected a GitHub repository yet.</p><p>Connect your repo to get your product\'s ten-dimension assessment in under 10 minutes.</p>',
    check: async (fid) => {
      const r = await query(
        `SELECT f.created_at, (SELECT COUNT(*) FROM products WHERE owner_id = f.id AND github_repo_url IS NOT NULL) as has_repo
         FROM founders f WHERE f.id = ?`, [fid]);
      const row = r.rows[0] as Record<string, unknown> | undefined;
      if (!row) return false;
      const hours = (Date.now() - new Date(row.created_at as string).getTime()) / 3600000;
      return hours >= 24 && (row.has_repo as number) === 0;
    },
  },
  {
    name: 'stuck_at_repo',
    condition: 'github connected but no repo selected within 24h',
    subject: 'Select a repository to run your first audit',
    body: '<p>You connected GitHub but haven\'t selected a repository for audit yet.</p>',
    check: async (fid) => {
      const r = await query(
        `SELECT p.created_at, p.github_repo_name,
           (SELECT COUNT(*) FROM audit_scores WHERE product_id = p.id) as audit_count
         FROM products p WHERE p.owner_id = ? AND p.github_repo_url IS NOT NULL ORDER BY p.created_at DESC LIMIT 1`, [fid]);
      if (r.rows.length === 0) return false;
      const row = r.rows[0] as Record<string, unknown>;
      const hours = (Date.now() - new Date(row.created_at as string).getTime()) / 3600000;
      return hours >= 24 && (row.audit_count as number) === 0;
    },
  },
  {
    name: 'audit_no_action',
    condition: 'audit completed but no next action within 7d',
    subject: 'Your audit found blocking issues — here\'s your #1 priority',
    body: '<p>Your audit completed but you haven\'t taken any next steps. Start with the highest-priority blocking issue.</p>',
    check: async (fid) => {
      const r = await query(
        `SELECT a.created_at, a.blocking_issues FROM audit_scores a
         JOIN products p ON a.product_id = p.id WHERE p.owner_id = ?
         ORDER BY a.created_at DESC LIMIT 1`, [fid]);
      if (r.rows.length === 0) return false;
      const row = r.rows[0] as Record<string, unknown>;
      const days = (Date.now() - new Date(row.created_at as string).getTime()) / 86400000;
      return days >= 7 && row.blocking_issues !== null;
    },
  },
  {
    name: 'decisions_growing',
    condition: '3+ decisions pending for 5+ days',
    subject: 'Decisions waiting for your review',
    body: '<p>You have pending decisions that need attention. The most urgent ones are highlighted in your dashboard.</p>',
    check: async (fid) => {
      const r = await query(
        `SELECT COUNT(*) as c FROM decisions d JOIN products p ON d.product_id = p.id
         WHERE p.owner_id = ? AND d.status = 'pending' AND d.created_at < datetime('now', '-5 days')`, [fid]);
      return ((r.rows[0] as Record<string, number>)?.c ?? 0) >= 3;
    },
  },
];

/**
 * Evaluate all behavioral triggers for all founders.
 */
export async function evaluateTriggers(): Promise<void> {
  const founders = await query('SELECT id, email FROM founders', []);

  for (const fRow of founders.rows) {
    const founder = fRow as Record<string, string>;
    const products = await query('SELECT id FROM products WHERE owner_id = ?', [founder.id]);
    const productId = (products.rows[0] as Record<string, string>)?.id ?? '';

    // Get risk state
    let riskState: RiskStateValue = 'green';
    if (productId) {
      const ls = await query('SELECT risk_state FROM lifecycle_state WHERE product_id = ?', [productId]);
      riskState = ((ls.rows[0] as Record<string, string>)?.risk_state as RiskStateValue) ?? 'green';
    }

    for (const trigger of STANDARD_TRIGGERS) {
      // Check if already sent recently (within 7 days)
      const sent = await query(
        `SELECT id FROM audit_log WHERE product_id = ? AND action_type = ? AND created_at > datetime('now', '-7 days')`,
        [productId, `trigger_${trigger.name}`]
      );
      if (sent.rows.length > 0) continue;

      const shouldFire = await trigger.check(founder.id, productId);
      if (shouldFire) {
        await sendTriggerEmail(founder.email, trigger.subject, trigger.body);
        await insertAuditLog({
          id: nanoid(), product_id: productId || 'system',
          action_type: `trigger_${trigger.name}`, gate: 0,
          trigger: 'behavioral_trigger', reasoning: trigger.condition,
          risk_state_at_action: riskState,
        });
      }
    }
  }
}
