// =============================================================================
// FOUNDRY — "Your Move" Engine
// Evaluates product state and surfaces the single most important action.
// =============================================================================

import { query } from '../../db/client.js';
import type { Founder, NextAction } from '../../types/index.js';

/**
 * Evaluate product state and return the highest-priority action.
 * Returns null-action with urgency 'positive' when nothing needs attention.
 */
export async function getNextAction(
  founder: Founder,
  productId: string,
): Promise<NextAction> {
  // Fetch lifecycle state
  const lsResult = await query('SELECT * FROM lifecycle_state WHERE product_id = ?', [productId]);
  const ls = lsResult.rows[0] as Record<string, unknown> | undefined;
  if (!ls) {
    return positiveState();
  }

  const riskState = ls.risk_state as string;
  const riskChangedAt = ls.risk_state_changed_at as string | null;

  // 1. Red risk state
  if (riskState === 'red') {
    return {
      priority: 1,
      type: 'risk_red',
      headline: 'Your product is in recovery mode.',
      subtext: 'Foundry has activated the recovery protocol. Review the diagnosis and stabilization plan.',
      action_label: 'View Recovery Protocol',
      action_url: `/products/${productId}/lifecycle`,
      urgency: 'critical',
    };
  }

  // 2. Yellow risk state changed within 48 hours
  if (riskState === 'yellow' && riskChangedAt) {
    const changedMs = new Date(riskChangedAt).getTime();
    const hoursAgo = (Date.now() - changedMs) / (1000 * 60 * 60);
    if (hoursAgo <= 48) {
      return {
        priority: 2,
        type: 'risk_yellow_recent',
        headline: 'Risk state elevated to Yellow.',
        subtext: 'Heightened monitoring is active. Review the current stressor report to understand what triggered this.',
        action_label: 'Review Stressors',
        action_url: '/dashboard#stressors',
        urgency: 'elevated',
      };
    }
  }

  // 3. Critical active stressor
  const criticalStressors = await query(
    "SELECT id, stressor_name FROM stressor_history WHERE product_id = ? AND severity = 'critical' AND status = 'active' LIMIT 1",
    [productId],
  );
  if (criticalStressors.rows.length > 0) {
    return {
      priority: 3,
      type: 'stressor_critical',
      headline: 'Critical risk signal detected.',
      subtext: 'A stressor has been classified as critical and requires attention within the timeframe specified.',
      action_label: 'View Stressor',
      action_url: '/dashboard#stressors',
      urgency: 'elevated',
    };
  }

  // 4. Gate 2 decision pending > 7 days
  const gate2Overdue = await query(
    `SELECT id, CAST((julianday('now') - julianday(created_at)) AS INTEGER) as days_pending
     FROM decisions WHERE product_id = ? AND gate = 2 AND status = 'pending'
     AND created_at < datetime('now', '-7 days') ORDER BY created_at ASC LIMIT 1`,
    [productId],
  );
  if (gate2Overdue.rows.length > 0) {
    const row = gate2Overdue.rows[0] as Record<string, unknown>;
    const days = row.days_pending as number;
    return {
      priority: 4,
      type: 'decision_gate2_overdue',
      headline: `A decision has been waiting ${days} days.`,
      subtext: 'Gate 2 decisions are time-sensitive. Delayed resolution reduces the value of Foundry\'s scenario modeling.',
      action_label: 'Resolve Decision',
      action_url: `/decisions/${row.id}`,
      urgency: 'elevated',
    };
  }

  // 5. Gate 3 decisions pending > 14 days
  const gate3Pending = await query(
    `SELECT COUNT(*) as cnt FROM decisions WHERE product_id = ? AND gate = 3 AND status = 'pending'
     AND created_at < datetime('now', '-14 days')`,
    [productId],
  );
  const gate3Count = (gate3Pending.rows[0] as Record<string, number>)?.cnt ?? 0;
  if (gate3Count > 0) {
    return {
      priority: 5,
      type: 'decision_gate3_pending',
      headline: `${gate3Count} strategic decision${gate3Count > 1 ? 's' : ''} pending.`,
      subtext: 'These require your reasoning to activate Foundry\'s judgment pattern learning.',
      action_label: 'Review Decisions',
      action_url: '/decisions',
      urgency: 'normal',
    };
  }

  // 6. DNA < 60% with 3+ audits and wisdom inactive
  const dnaResult = await query(
    'SELECT completion_pct FROM product_dna WHERE product_id = ?',
    [productId],
  );
  const dnaPct = (dnaResult.rows[0] as Record<string, number>)?.completion_pct ?? 0;
  const wisdomActive = (ls.wisdom_layer_active as number) === 1;
  if (dnaPct < 60 && !wisdomActive) {
    const auditCount = await query('SELECT COUNT(*) as c FROM audit_scores WHERE product_id = ?', [productId]);
    if (((auditCount.rows[0] as Record<string, number>)?.c ?? 0) >= 3) {
      return {
        priority: 6,
        type: 'dna_incomplete',
        headline: 'Wisdom layer is inactive.',
        subtext: `Product DNA is ${dnaPct}% complete. Reaching 60% activates product-specific intelligence and unlocks automated fixes for D2, D3, D4 blocking issues.`,
        action_label: 'Complete Product DNA',
        action_url: `/products/${productId}/dna`,
        urgency: 'normal',
      };
    }
  }

  // 7. Open remediation PRs
  const openPRs = await query(
    "SELECT COUNT(*) as cnt FROM remediation_prs WHERE product_id = ? AND status = 'pr_open'",
    [productId],
  );
  const prCount = (openPRs.rows[0] as Record<string, number>)?.cnt ?? 0;
  if (prCount > 0) {
    return {
      priority: 7,
      type: 'remediation_prs',
      headline: `Foundry opened ${prCount} pull request${prCount > 1 ? 's' : ''}.`,
      subtext: 'Automated fixes are ready for your review. Merging them triggers dimension re-audits.',
      action_label: 'Review Pull Requests',
      action_url: `/products/${productId}/remediation`,
      urgency: 'normal',
    };
  }

  // 8. Stale audit (> 30 days)
  const latestAudit = await query(
    'SELECT created_at FROM audit_scores WHERE product_id = ? ORDER BY created_at DESC LIMIT 1',
    [productId],
  );
  if (latestAudit.rows.length > 0) {
    const auditDate = new Date((latestAudit.rows[0] as Record<string, string>).created_at);
    const daysSince = Math.floor((Date.now() - auditDate.getTime()) / 86400000);
    if (daysSince > 30) {
      return {
        priority: 8,
        type: 'audit_stale',
        headline: `Audit is ${daysSince} days old.`,
        subtext: 'Weekly re-audits track the impact of your changes and generate new remediation opportunities.',
        action_label: 'Run Audit',
        action_url: `/products/${productId}/audit`,
        urgency: 'normal',
      };
    }
  }

  // 9. No metrics in last 10 days
  const recentMetrics = await query(
    "SELECT id FROM metric_snapshots WHERE product_id = ? AND snapshot_date > date('now', '-10 days') LIMIT 1",
    [productId],
  );
  if (recentMetrics.rows.length === 0) {
    return {
      priority: 9,
      type: 'metrics_missing',
      headline: 'Weekly metrics not submitted.',
      subtext: 'Metrics power stressor detection and MRR decomposition. Without them, Foundry is operating with incomplete signal.',
      action_label: 'Submit Metrics',
      action_url: `/products/${productId}/audit`,
      urgency: 'normal',
    };
  }

  // 10. Unreviewed high-significance competitive signal in last 7 days
  const unreviewed = await query(
    `SELECT id FROM competitive_signals WHERE product_id = ? AND significance = 'high' AND reviewed = 0
     AND detected_at > datetime('now', '-7 days') LIMIT 1`,
    [productId],
  );
  if (unreviewed.rows.length > 0) {
    return {
      priority: 10,
      type: 'competitive_signal',
      headline: 'Competitive signal detected.',
      subtext: 'A high-significance competitor event was detected. Review before it becomes a stressor.',
      action_label: 'View Competitive Intelligence',
      action_url: `/products/${productId}/competitive`,
      urgency: 'normal',
    };
  }

  // 11. All clear
  return positiveState();
}

function positiveState(): NextAction {
  return {
    priority: 99,
    type: 'clear',
    headline: 'Foundry is operating autonomously.',
    subtext: 'No action needed today. All intelligence systems are running normally.',
    action_label: '',
    action_url: '',
    urgency: 'positive',
  };
}
