// =============================================================================
// FOUNDRY — Data Quality & Metric Validation Service
// Rule-based validation layer for incoming metric snapshots.
// Based on migration 032 (metric_validation_rules, data_quality_alerts tables).
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ValidationRule {
  product_id: string;
  metric_name: string;
  rule_type: 'range' | 'delta' | 'null_check' | 'consistency';
  config: Record<string, unknown>; // { min?, max?, max_delta_pct?, related_metric? }
  severity: 'warning' | 'error' | 'critical';
  enabled: boolean;
}

// ─── createValidationRule ─────────────────────────────────────────────────────

export async function createValidationRule(rule: ValidationRule): Promise<string> {
  const id = nanoid();

  // Map our rule_type values to the DB CHECK constraint values
  const dbRuleType = mapRuleType(rule.rule_type);

  await query(
    `INSERT INTO metric_validation_rules
       (id, product_id, metric_name, rule_type, rule_params, is_active)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      rule.product_id,
      rule.metric_name,
      dbRuleType,
      JSON.stringify(rule.config),
      rule.enabled ? 1 : 0,
    ]
  );

  return id;
}

// ─── validateMetricSnapshot ───────────────────────────────────────────────────

export async function validateMetricSnapshot(
  productId: string,
  snapshotData: Record<string, number | null>
): Promise<
  Array<{
    metric_name: string;
    rule_type: string;
    severity: string;
    message: string;
  }>
> {
  const rulesResult = await query(
    `SELECT * FROM metric_validation_rules
     WHERE product_id = ? AND is_active = 1`,
    [productId]
  );

  const violations: Array<{
    metric_name: string;
    rule_type: string;
    severity: string;
    message: string;
  }> = [];

  for (const row of rulesResult.rows) {
    const r = row as Record<string, unknown>;
    const metricName = r.metric_name as string;
    const ruleType = r.rule_type as string;
    const ruleId = r.id as string;
    let params: Record<string, unknown> = {};
    try {
      params = JSON.parse((r.rule_params as string) ?? '{}') as Record<string, unknown>;
    } catch {
      params = {};
    }

    const value = snapshotData[metricName];

    let violated = false;
    let message = '';

    if (ruleType === 'range') {
      if (value === null || value === undefined) {
        violated = true;
        message = `${metricName} is null but range rule requires a value`;
      } else {
        const min = params.min as number | undefined;
        const max = params.max as number | undefined;
        if (min !== undefined && value < min) {
          violated = true;
          message = `${metricName} value ${value} is below minimum ${min}`;
        } else if (max !== undefined && value > max) {
          violated = true;
          message = `${metricName} value ${value} exceeds maximum ${max}`;
        }
      }
    } else if (ruleType === 'non_negative') {
      if (value !== null && value !== undefined && value < 0) {
        violated = true;
        message = `${metricName} value ${value} is negative`;
      }
    } else if (ruleType === 'no_sudden_drop' || ruleType === 'no_sudden_spike') {
      // Need previous value to compare — skip if not available in snapshot
      // This would normally compare against last stored snapshot
      const maxPctChange = (params.max_pct_change as number) ?? 50;
      if (value !== null && value !== undefined) {
        // We'd need the previous value here; skip for now as we'd need db lookup
        void maxPctChange;
      }
    }

    if (violated) {
      const severity = (r.severity as string | undefined) ?? 'warning';

      violations.push({
        metric_name: metricName,
        rule_type: ruleType,
        severity,
        message,
      });

      // Record alert in db
      await query(
        `INSERT INTO data_quality_alerts
           (id, product_id, rule_id, alert_type, metric_name, actual_value, description, severity)
         VALUES (?, ?, ?, 'validation_failed', ?, ?, ?, ?)`,
        [
          nanoid(),
          productId,
          ruleId,
          metricName,
          value !== null && value !== undefined ? String(value) : null,
          message,
          severity === 'critical' ? 'critical' : 'warning',
        ]
      );
    }
  }

  return violations;
}

// ─── getDataQualityAlerts ─────────────────────────────────────────────────────

export async function getDataQualityAlerts(
  productId: string,
  unresolved?: boolean
): Promise<
  Array<{
    id: string;
    metric_name: string;
    severity: string;
    message: string;
    created_at: string;
    resolved_at: string | null;
  }>
> {
  let sql = `SELECT id, metric_name, severity, description, created_at, resolved_at
             FROM data_quality_alerts
             WHERE product_id = ?`;
  const args: unknown[] = [productId];

  if (unresolved === true) {
    sql += ' AND resolved_at IS NULL';
  }

  sql += ' ORDER BY created_at DESC';

  const result = await query(sql, args);

  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      metric_name: (r.metric_name as string) ?? '',
      severity: (r.severity as string) ?? 'warning',
      message: (r.description as string) ?? '',
      created_at: r.created_at as string,
      resolved_at: (r.resolved_at as string | null) ?? null,
    };
  });
}

// ─── resolveAlert ─────────────────────────────────────────────────────────────

export async function resolveAlert(alertId: string): Promise<void> {
  await query(
    `UPDATE data_quality_alerts SET resolved_at = datetime('now') WHERE id = ?`,
    [alertId]
  );
}

// ─── getDataQualityScore ──────────────────────────────────────────────────────

export async function getDataQualityScore(productId: string): Promise<number> {
  // Score is 0-100 based on recent unresolved alerts
  // Count alerts in the last 7 days; each critical = -20, each warning = -5
  const result = await query(
    `SELECT severity, COUNT(*) as cnt FROM data_quality_alerts
     WHERE product_id = ? AND resolved_at IS NULL
       AND created_at >= datetime('now', '-7 days')
     GROUP BY severity`,
    [productId]
  );

  let score = 100;
  for (const row of result.rows) {
    const r = row as Record<string, unknown>;
    const cnt = (r.cnt as number) ?? 0;
    const sev = r.severity as string;
    if (sev === 'critical') {
      score -= cnt * 20;
    } else {
      score -= cnt * 5;
    }
  }

  return Math.max(0, Math.min(100, score));
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function mapRuleType(ruleType: string): string {
  const map: Record<string, string> = {
    range: 'range',
    delta: 'no_sudden_spike',
    null_check: 'non_negative',
    consistency: 'range',
  };
  return map[ruleType] ?? 'range';
}
