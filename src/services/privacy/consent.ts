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
 * Columns never included in an export, by name pattern.
 *
 * A subject access request is a right to one's own data, not a mechanism for
 * extracting live credentials. An encrypted provider token or an API key hash
 * is material that can be replayed or attacked offline, and handing it back in
 * a downloadable file — to whoever has the session at that moment — is a worse
 * outcome than omitting it. The row still appears, so the founder can see THAT
 * an integration exists and when it was connected.
 */
const SECRET_COLUMN = /(token|secret|password|credential|api_key|key_hash|private|signature)/i;

/**
 * Tables left out of an export, and why. Same discipline as the erasure
 * retention list: an entry is an argument, not a convenience.
 */
const EXCLUDED_FROM_EXPORT: Record<string, string> = {
  idempotency_keys: 'internal at-most-once bookkeeping; carries no company content',
  communication_budgets: 'internal send counters',
  rate_limit_counters: 'internal request counters',
  ai_spend_reservations: 'internal cost accounting, mid-flight',
};

/** Exported for the gate that checks each exclusion has a reason. */
export const EXCLUDED_FROM_EXPORT_REASONS = EXCLUDED_FROM_EXPORT;

/**
 * Gather all product data for a GDPR-style export.
 *
 * DERIVED FROM THE SCHEMA, like the erasure. This was a hand-written list of
 * ten tables — five of them added by a fix whose comment reads "Export was 60%
 * incomplete", measured against a denominator that was itself a guess. The real
 * denominator is 218 tables carrying `product_id`. An access request answered
 * with ten of them is not an access request answered.
 *
 * Empty tables are omitted from the result rather than exported as empty
 * arrays: a file with two hundred empty keys is harder to read, not more
 * complete.
 */
export async function exportProductData(
  productId: string,
  _format: 'json' | 'csv'
): Promise<Record<string, unknown[]>> {
  const tables = (await tablesWithProductId())
    .filter((t) => !(t in EXCLUDED_FROM_EXPORT));

  const out: Record<string, unknown[]> = {};
  for (const table of tables) {
    try {
      const res = await query(`SELECT * FROM ${table} WHERE product_id = ?`, [productId]);
      if (res.rows.length === 0) continue;
      out[table] = (res.rows as unknown as Array<Record<string, unknown>>).map((row) => {
        const clean: Record<string, unknown> = {};
        for (const [col, value] of Object.entries(row)) {
          clean[col] = SECRET_COLUMN.test(col) && value != null ? '[redacted]' : value;
        }
        return clean;
      });
    } catch {
      // A table that cannot be read is omitted rather than failing the whole
      // export. Unlike the erasure, a partial export makes no claim to be
      // complete — it is a file, not a completion record.
      continue;
    }
  }
  return out;
}

// ─── What an erasure erases ───────────────────────────────────────────────────

/**
 * Tables that survive a product's erasure, and why.
 *
 * Everything else carrying `product_id` is deleted. An entry here has to be an
 * argument that erasing it would destroy something the erasure itself depends
 * on, or something a law requires be kept — never that clearing it was
 * inconvenient.
 */
const RETAINED_ON_ERASURE: Record<string, string> = {
  agent_audit_log:
    'holds the deletion request and its completion record; erasing it would erase the evidence that the erasure happened',
  products:
    'archived rather than deleted, so the id cannot be reissued and every foreign key stays resolvable',
  ai_daily_spend:
    'Foundry\'s own cost accounting, carrying no company content beyond an id',
  ai_spend_reservations:
    'the same accounting, mid-flight; dropping reservations would release ceilings that are still holding',
  idempotency_keys:
    'at-most-once records for effects already sent; deleting them would let a retry re-send a real message',
  stripe_webhook_events:
    'financial event ledger required for billing reconciliation',
};

/** Every table the live schema says carries a `product_id`. Read from the
 * database rather than written down, so a table added later is covered by
 * default — by both the erasure and the export. */
export async function tablesWithProductId(): Promise<string[]> {
  const res = await query(
    `SELECT m.name FROM sqlite_master m
      WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'
        AND EXISTS (SELECT 1 FROM pragma_table_info(m.name) WHERE name = 'product_id')
      ORDER BY m.name`, []);
  return (res.rows as unknown as Array<Record<string, unknown>>).map((r) => String(r.name));
}

/** Those tables minus the ones an erasure deliberately keeps. */
export async function tablesToErase(): Promise<string[]> {
  return (await tablesWithProductId()).filter((t) => !(t in RETAINED_ON_ERASURE));
}

/** Exported for the gate that checks each retention has a reason. */
export const RETAINED_ON_ERASURE_REASONS = RETAINED_ON_ERASURE;

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
    // `??`, not `||`. A founder who asks for erasure with no waiting period
    // records `delete_after_days: 0`, which is falsy — so `|| 30` silently
    // turned "delete now" into "delete in a month", for exactly the request
    // most likely to be urgent.
    const deleteAfterDays = metadata.delete_after_days ?? 30;
    const deletionDate = new Date(scheduledAt.getTime() + deleteAfterDays * 24 * 60 * 60 * 1000);

    if (new Date() < deletionDate) continue; // Not yet time

    // Actually delete the product's data across all tables.
    //
    // This was a hand-written list of thirteen table names. The schema has two
    // hundred and eighteen tables carrying `product_id` — agent messages, chat
    // sessions, call transcripts, customer intelligence, API keys, integration
    // records — so an erasure request deleted about six per cent of the
    // company's data and then wrote `data_deletion_completed`. The claim was
    // the part that worked.
    //
    // The list is now DERIVED from the live schema, so it cannot drift from it,
    // and what survives an erasure is an explicit allow-list with a reason
    // each. That is the fail-closed direction: a new table added next year is
    // deleted by default rather than quietly retained forever.
    for (const table of await tablesToErase()) {
      try {
        await query(`DELETE FROM ${table} WHERE product_id = ?`, [productId]);
      } catch (err) {
        // A table that cannot be cleared must not be silently skipped: the
        // completion record below would then be false. Recorded and rethrown to
        // the caller's per-product catch, which leaves the deletion pending and
        // retries it on the next run.
        throw new Error(`data deletion incomplete: ${table}: ${String(err)}`);
      }
    }

    // Archive the product itself.
    //
    // This wrote `status='deleted'`, which the CHECK constraint on
    // `products.status` has never permitted — the vocabulary is
    // active/paused/archived. So the scheduled deletion job deleted rows from
    // thirty tables and then threw on this line: the data was gone, the product
    // was never marked, and the "deletion completed" record below was never
    // written. A compliance path that half-completes and leaves no evidence of
    // having run is worse than one that fails early.
    //
    // `archived` is what the code's own comment says it is doing and is the
    // value the constraint has always expected.
    //
    // BOTH AXES. Writing only `status` left `scp_status='active'`, and around
    // twenty scheduled jobs select their work on `scp_status` alone — so a
    // company whose founder had withdrawn consent and whose data had just been
    // deleted stayed on every agent's work list, and kept being reasoned about
    // by model calls. Deletion has to end the operating relationship, not just
    // the record.
    await query(
      `UPDATE products SET status = 'archived', scp_status = 'archived',
                          github_access_token = NULL WHERE id = ?`,
      [productId]);

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
