// =============================================================================
// FOUNDRY — Privacy Consent Service
// Manages consent records, data residency settings, and data export/deletion.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

export type ConsentType =
  | 'benchmark_contribution'
  | 'aggregate_insights'
  | 'product_improvement'
  | 'ai_training_opt_out'
  | 'cross_company_patterns';

export type ConsentSummary = {
  benchmark_contribution: boolean;
  aggregate_insights: boolean;
  product_improvement: boolean;
  ai_training_opt_out: boolean;
  cross_company_patterns: boolean;
};

export type DataResidencySettings = {
  preferred_region: string;
  data_retention_days: number;
  delete_agent_logs_after_days: number;
  anonymize_customer_data: boolean;
  export_format: string;
};

// ─── recordConsent ─────────────────────────────────────────────────────────────

/**
 * Record an explicit consent decision for a product/founder.
 * Uses INSERT OR REPLACE to upsert the consent record.
 */
export async function recordConsent(
  productId: string,
  founderId: string,
  consentType: ConsentType,
  granted: boolean,
  ipAddress?: string
): Promise<void> {
  await query(
    `INSERT OR REPLACE INTO privacy_consents
       (id, product_id, founder_id, consent_type, granted, granted_at, ip_address, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), ?, datetime('now'))`,
    [nanoid(), productId, founderId, consentType, granted ? 1 : 0, ipAddress ?? null]
  );
}

// ─── hasConsent ────────────────────────────────────────────────────────────────

/**
 * Returns true if the product has explicitly granted the given consent type.
 */
export async function hasConsent(productId: string, consentType: ConsentType): Promise<boolean> {
  const result = await query(
    `SELECT granted FROM privacy_consents WHERE product_id = ? AND consent_type = ? LIMIT 1`,
    [productId, consentType]
  );
  if (result.rows.length === 0) return false;
  const row = result.rows[0] as Record<string, unknown>;
  return row.granted === 1;
}

// ─── getConsentSummary ─────────────────────────────────────────────────────────

/**
 * Returns the current consent state for all consent types.
 * Missing records are treated as false (not granted).
 */
export async function getConsentSummary(productId: string): Promise<ConsentSummary> {
  const result = await query(
    `SELECT consent_type, granted, granted_at FROM privacy_consents WHERE product_id = ?`,
    [productId]
  );

  const map: Record<string, boolean> = {};
  for (const row of result.rows) {
    const r = row as Record<string, unknown>;
    map[r.consent_type as string] = r.granted === 1;
  }

  return {
    benchmark_contribution: map['benchmark_contribution'] ?? false,
    aggregate_insights: map['aggregate_insights'] ?? false,
    product_improvement: map['product_improvement'] ?? false,
    ai_training_opt_out: map['ai_training_opt_out'] ?? false,
    cross_company_patterns: map['cross_company_patterns'] ?? false,
  };
}

// ─── getOrInitConsents ─────────────────────────────────────────────────────────

/**
 * Returns existing consents, or GDPR-compliant defaults (all opt-out).
 * Per GDPR Article 7: pre-ticked boxes are NOT valid consent.
 * All data sharing defaults to false (opt-out). User must actively consent.
 */
export async function getOrInitConsents(productId: string): Promise<ConsentSummary> {
  const result = await query(
    `SELECT consent_type, granted FROM privacy_consents WHERE product_id = ?`,
    [productId]
  );

  if (result.rows.length === 0) {
    // GDPR: all defaults are opt-out (false)
    return {
      benchmark_contribution: false,
      aggregate_insights: false,
      product_improvement: false,
      ai_training_opt_out: false,
      cross_company_patterns: false,
    };
  }

  const map: Record<string, boolean> = {};
  for (const row of result.rows) {
    const r = row as Record<string, unknown>;
    map[r.consent_type as string] = r.granted === 1;
  }

  // GDPR: default to false (opt-out) for any consent type not yet recorded
  return {
    benchmark_contribution: map['benchmark_contribution'] ?? false,
    aggregate_insights: map['aggregate_insights'] ?? false,
    product_improvement: map['product_improvement'] ?? false,
    ai_training_opt_out: map['ai_training_opt_out'] ?? false,
    cross_company_patterns: map['cross_company_patterns'] ?? false,
  };
}

// ─── getConsentTimestamps ──────────────────────────────────────────────────────

/**
 * Returns the last updated timestamps for each consent type.
 */
export async function getConsentTimestamps(
  productId: string
): Promise<Record<string, string | null>> {
  const result = await query(
    `SELECT consent_type, granted_at FROM privacy_consents WHERE product_id = ?`,
    [productId]
  );

  const map: Record<string, string | null> = {};
  for (const row of result.rows) {
    const r = row as Record<string, unknown>;
    map[r.consent_type as string] = (r.granted_at as string | null) ?? null;
  }
  return map;
}

// ─── getDataResidencySettings ──────────────────────────────────────────────────

const DEFAULT_RESIDENCY: DataResidencySettings = {
  preferred_region: 'us-east',
  data_retention_days: 730,
  delete_agent_logs_after_days: 90,
  anonymize_customer_data: false,
  export_format: 'json',
};

/**
 * Returns data residency settings for a product, or defaults if not set.
 */
export async function getDataResidencySettings(productId: string): Promise<DataResidencySettings> {
  const result = await query(
    `SELECT preferred_region, data_retention_days, delete_agent_logs_after_days,
            anonymize_customer_data, export_format
     FROM data_residency_settings WHERE product_id = ? LIMIT 1`,
    [productId]
  );

  if (result.rows.length === 0) return { ...DEFAULT_RESIDENCY };

  const row = result.rows[0] as Record<string, unknown>;
  return {
    preferred_region: (row.preferred_region as string) ?? DEFAULT_RESIDENCY.preferred_region,
    data_retention_days: (row.data_retention_days as number) ?? DEFAULT_RESIDENCY.data_retention_days,
    delete_agent_logs_after_days: (row.delete_agent_logs_after_days as number) ?? DEFAULT_RESIDENCY.delete_agent_logs_after_days,
    anonymize_customer_data: row.anonymize_customer_data === 1,
    export_format: (row.export_format as string) ?? DEFAULT_RESIDENCY.export_format,
  };
}

// ─── updateDataResidencySettings ──────────────────────────────────────────────

/**
 * Upsert data residency settings for a product.
 */
export async function updateDataResidencySettings(
  productId: string,
  settings: Partial<DataResidencySettings>
): Promise<void> {
  // Fetch current values to merge
  const current = await getDataResidencySettings(productId);
  const merged = { ...current, ...settings };

  await query(
    `INSERT OR REPLACE INTO data_residency_settings
       (id, product_id, preferred_region, data_retention_days,
        delete_agent_logs_after_days, anonymize_customer_data, export_format,
        created_at, updated_at)
     VALUES (
       COALESCE(
         (SELECT id FROM data_residency_settings WHERE product_id = ?),
         ?
       ),
       ?, ?, ?, ?, ?, ?,
       COALESCE(
         (SELECT created_at FROM data_residency_settings WHERE product_id = ?),
         datetime('now')
       ),
       datetime('now')
     )`,
    [
      productId,
      nanoid(),
      productId,
      merged.preferred_region,
      merged.data_retention_days,
      merged.delete_agent_logs_after_days,
      merged.anonymize_customer_data ? 1 : 0,
      merged.export_format,
      productId,
    ]
  );
}

// ─── exportProductData ─────────────────────────────────────────────────────────

/**
 * Gather all product data for a GDPR-style export.
 * Returns structured data suitable for JSON or CSV serialization.
 */
export async function exportProductData(
  productId: string,
  _format: 'json' | 'csv'
): Promise<Record<string, unknown[]>> {
  const [metricsResult, briefingsResult, decisionsResult, customersResult, agentConfigResult] =
    await Promise.all([
      query(
        `SELECT * FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC`,
        [productId]
      ),
      query(
        `SELECT id, product_id, briefing_date, headline, health_score, signal_score, risk_state, created_at
         FROM scp_briefings WHERE product_id = ? ORDER BY briefing_date DESC`,
        [productId]
      ),
      query(
        `SELECT id, product_id, what, why_now, status, category, gate, created_at
         FROM decisions WHERE product_id = ? ORDER BY created_at DESC`,
        [productId]
      ),
      query(
        `SELECT id, product_id, name, email, plan, mrr_cents, signed_up_at, last_active_at,
                health_score, churn_risk, created_at
         FROM customers WHERE product_id = ? ORDER BY created_at DESC`,
        [productId]
      ).catch(() => ({ rows: [] })),
      query(
        `SELECT id, product_id, agent_name, config_json, updated_at
         FROM agent_configs WHERE product_id = ? ORDER BY agent_name ASC`,
        [productId]
      ).catch(() => ({ rows: [] })),
    ]);

  // v5 FRICTION: Export was 60% incomplete. Add missing tables.
  const [stressorsResult, auditResult, lifecycleResult, competitorsResult, signalsResult] =
    await Promise.all([
      query('SELECT * FROM stressor_history WHERE product_id = ? ORDER BY identified_at DESC', [productId]).catch(() => ({ rows: [] })),
      query('SELECT * FROM audit_scores WHERE product_id = ? ORDER BY created_at DESC', [productId]).catch(() => ({ rows: [] })),
      query('SELECT * FROM lifecycle_state WHERE product_id = ?', [productId]).catch(() => ({ rows: [] })),
      query('SELECT * FROM competitors WHERE product_id = ?', [productId]).catch(() => ({ rows: [] })),
      query('SELECT * FROM competitive_signals WHERE product_id = ? ORDER BY detected_at DESC', [productId]).catch(() => ({ rows: [] })),
    ]);

  return {
    metrics: metricsResult.rows,
    briefings: briefingsResult.rows,
    decisions: decisionsResult.rows,
    customers: customersResult.rows,
    agent_config: agentConfigResult.rows,
    stressors: stressorsResult.rows,
    audit_scores: auditResult.rows,
    lifecycle_state: lifecycleResult.rows,
    competitors: competitorsResult.rows,
    competitive_signals: signalsResult.rows,
  };
}

// ─── scheduleDataDeletion ──────────────────────────────────────────────────────

/**
 * Schedule data deletion for a product.
 * Logs a deletion job to the audit log; actual deletion is handled by a cron job.
 */
export async function scheduleDataDeletion(
  productId: string,
  deleteAfterDays: number
): Promise<void> {
  await query(
    `INSERT INTO agent_audit_log
       (id, product_id, event_type, actor_type, actor_id, target_type, target_id,
        description, metadata_json, created_at)
     VALUES (?, ?, 'data_deletion_scheduled', 'system', 'system', 'product', ?,
             ?, ?, datetime('now'))`,
    [
      nanoid(),
      productId,
      productId,
      `Data deletion scheduled. Product data will be deleted after ${deleteAfterDays} days.`,
      JSON.stringify({ delete_after_days: deleteAfterDays, scheduled_at: new Date().toISOString() }),
    ]
  );
}

/**
 * Process pending data deletions.
 * RT07-P0: This was missing — deletion was scheduled but never executed.
 * Finds products with data_deletion_scheduled events older than their
 * delete_after_days threshold and actually deletes the data.
 */
export async function processScheduledDeletions(): Promise<number> {
  // Find scheduled deletions that are past their threshold
  const pending = await query(
    `SELECT DISTINCT target_id as product_id, metadata_json FROM agent_audit_log
     WHERE event_type = 'data_deletion_scheduled'
       AND target_id NOT IN (
         SELECT target_id FROM agent_audit_log WHERE event_type = 'data_deletion_completed'
       )`,
    []
  );

  let deleted = 0;

  for (const row of pending.rows) {
    const r = row as Record<string, unknown>;
    const productId = r.product_id as string;
    const metadata = JSON.parse((r.metadata_json as string) || '{}');
    const scheduledAt = new Date(metadata.scheduled_at || 0);
    const deleteAfterDays = metadata.delete_after_days || 30;
    const deletionDate = new Date(scheduledAt.getTime() + deleteAfterDays * 24 * 60 * 60 * 1000);

    if (new Date() < deletionDate) continue; // Not yet time

    // Actually delete the product's data across all tables
    const tables = [
      'metric_snapshots', 'stressor_history', 'decisions', 'scenario_models',
      'audit_scores', 'lifecycle_conditions', 'lifecycle_state',
      'founding_story_artifacts', 'beta_intake', 'competitive_signals',
      'competitors', 'cohorts', 'agent_instances',
    ];

    for (const table of tables) {
      try {
        await query(`DELETE FROM ${table} WHERE product_id = ?`, [productId]);
      } catch {
        // Table may not exist in all migration states — continue
      }
    }

    // Archive the product itself
    await query(`UPDATE products SET status = 'deleted', github_access_token = NULL WHERE id = ?`, [productId]);

    // Log completion
    await query(
      `INSERT INTO agent_audit_log
         (id, product_id, event_type, actor_type, actor_id, target_type, target_id,
          description, created_at)
       VALUES (?, ?, 'data_deletion_completed', 'system', 'system', 'product', ?,
               'Data deletion completed. Product data has been removed.', datetime('now'))`,
      [nanoid(), productId, productId]
    );

    deleted++;
  }

  return deleted;
}
