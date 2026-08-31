// =============================================================================
// FOUNDRY — Data Retention (Wave 4, action 31)
// agent_messages and audit_log grow unboundedly; both are high-write
// mostly-read-recent. This module archives rows older than the
// retention horizon to JSON-line cold storage in the same table or
// drops them outright depending on policy. Council 8 (DBE) finding.
// =============================================================================

import { query } from '../../db/client.js';
import { log } from '../../lib/logger.js';

// ─── Policy ───────────────────────────────────────────────────────────────────

interface RetentionPolicy {
  table: string;
  /** column used to compare against age cutoff */
  timestampColumn: string;
  /** delete rows older than this many days */
  retentionDays: number;
  /** maximum rows deleted per run (prevents one cron from blocking on a huge backlog) */
  batchSize: number;
  /** Which of the company's own retention settings may SHORTEN this table's
   *  horizon. Empty means none — either the rows carry no `product_id`, or the
   *  table is one a company's dropdown should not govern. Stated per table
   *  rather than probed: a table gaining a `product_id` should be a decision
   *  here, not a silent change in what gets deleted. */
  companyHorizons: CompanyHorizonColumn[];
}

/**
 * The settings columns a company may shorten a horizon with.
 *
 * A CLOSED SET BECAUSE THE NAME IS INTERPOLATED INTO SQL. It is a TypeScript
 * union in `privacy/consent.ts` too, and a union is erased at runtime — the
 * same shape that made `memberMay` one call site away from taking a
 * request-supplied column name. Checked below before it reaches a statement.
 */
const COMPANY_HORIZON_COLUMNS = ['data_retention_days', 'delete_agent_logs_after_days'] as const;
type CompanyHorizonColumn = typeof COMPANY_HORIZON_COLUMNS[number];

/**
 * THE ONLY RETENTION POLICY. There were two.
 *
 * `src/services/retention.ts` ran its own daily job over `agent_messages` and
 * `audit_log` with a single global window, and this one ran its own daily job
 * over five tables with per-table horizons. Both deleted. They overlapped on
 * `audit_log`, where this file said 365 days — "compliance-relevant; keep
 * longer" — and the other deleted at 180. The shorter one wins every time, so
 * the audit log was kept for 180 days while the code stating the policy said
 * 365 and nothing behaved that way.
 *
 * That is the whole defect: not a wrong number, but two implementations of one
 * rule silently disagreeing, with the documented intent losing to the cruder
 * job. The other implementation and its `data_retention` job are retired.
 *
 * `audit_log` STAYS AT 180 rather than being restored to the 365 written here.
 * Lengthening how long audit data is retained is not a tidy-up: it is exactly
 * the question already with counsel in `OWNER_DECISIONS_PENDING` §9, and the
 * conservative direction for records that may name people is the shorter one.
 * Removing the duplication must not quietly change what happens to anybody's
 * data; the 365 intent is recorded there for the owner to ratify or not.
 *
 * `DATA_RETENTION_DAYS` is honoured as a CAP across every policy, because a
 * deployment that set it did so to keep LESS, and dropping it would have
 * silently kept more.
 */
const POLICIES: RetentionPolicy[] = [
  // agent_messages — operational chatter; recent-only is fine. 180 days.
  { table: 'agent_messages', timestampColumn: 'created_at', retentionDays: 180, batchSize: 5000,
    // Both settings bite here: "how long Foundry retains your product data" and
    // "agent activity logs older than this are deleted" are both true of agent
    // chatter, and the shorter of the two wins because each runs.
    companyHorizons: ['data_retention_days', 'delete_agent_logs_after_days'] },
  // audit_log — 180 days, which is what has actually been happening. The
  // intent written here was 365; see the note above and OWNER_DECISIONS §9.
  { table: 'audit_log',      timestampColumn: 'created_at', retentionDays: 180, batchSize: 5000, companyHorizons: ['data_retention_days'] },
  // briefing_decision_links — telemetry; 90 days is plenty.
  { table: 'briefing_decision_links', timestampColumn: 'created_at', retentionDays: 90, batchSize: 5000, companyHorizons: ['data_retention_days'] },
  // ai_cost_log — financial reporting needs 13 months for year-over-year. NOT
  // company-scoped: the rows carry no `product_id`, and a financial record is
  // also the one place a company's shorter preference should not silently win.
  { table: 'ai_cost_log',    timestampColumn: 'timestamp',  retentionDays: 395, batchSize: 5000, companyHorizons: [] },
  // integration_events — high-volume; 60 days.
  { table: 'integration_events', timestampColumn: 'created_at', retentionDays: 60, batchSize: 10000, companyHorizons: ['data_retention_days'] },
];

/** Which company settings may shorten each table, exposed so a test asserts the
 *  decision rather than re-deriving it — the point of stating it per table is
 *  that adding one is a decision. */
export const POLICY_TABLE_HORIZONS: Record<string, readonly CompanyHorizonColumn[]> =
  Object.fromEntries(POLICIES.map((p) => [p.table, p.companyHorizons]));

// ─── Public API ───────────────────────────────────────────────────────────────

export interface RetentionResult {
  table: string;
  deleted: number;
  /** Of `deleted`, how many went because a company asked to keep less than the
   *  platform horizon. Reported separately so the setting is observable rather
   *  than asserted. */
  deleted_by_company_setting: number;
  cutoff_date: string;
}

/** A deployment-wide ceiling on retention, or null when unset. A deployment
 *  that set this did so to keep LESS; it can never extend a horizon. */
export function retentionCapDays(): number | null {
  const raw = parseInt(process.env.DATA_RETENTION_DAYS ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

export async function runRetentionPolicy(): Promise<RetentionResult[]> {
  const results: RetentionResult[] = [];
  const cap = retentionCapDays();

  for (const base of POLICIES) {
    const policy = cap === null ? base
      : { ...base, retentionDays: Math.min(base.retentionDays, cap) };
    const result = await applyPolicy(policy);
    // A COMPANY'S OWN SETTING, IN THE SAFE DIRECTION ONLY.
    //
    // The privacy page offers "Data Retention Period — how long Foundry retains
    // your product data", and nothing read it: `data_residency_settings` was
    // written by the form, read back by the same page, and consulted by no job.
    // A founder set a period and it governed nothing.
    //
    // Honoured only where it is SHORTER than the platform horizon, for exactly
    // the reason the deployment-wide cap is honoured that way: a company that
    // set this did so to keep less. Letting it keep MORE is the retention
    // question already with counsel (`OWNER_DECISIONS_PENDING` §9, §11), and
    // software must not answer that by reading a dropdown.
    result.deleted_by_company_setting = await applyCompanyHorizon(policy);
    result.deleted += result.deleted_by_company_setting;
    results.push(result);
    if (result.deleted > 0) {
      log.info('retention.applied', {
        jobName: 'retention_policy',
        table: result.table,
        deleted: result.deleted,
        cutoff_date: result.cutoff_date,
      });
    }
  }

  return results;
}

// ─── Internals ────────────────────────────────────────────────────────────────

async function applyPolicy(policy: RetentionPolicy): Promise<RetentionResult> {
  const cutoffDate = new Date(
    Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000
  ).toISOString();

  // First check if the table exists; on dev DBs without all migrations, skip.
  try {
    await query(`SELECT 1 FROM ${policy.table} LIMIT 1`, []);
  } catch {
    return { table: policy.table, deleted: 0, deleted_by_company_setting: 0, cutoff_date: cutoffDate };
  }

  // Delete in one bounded batch so a long-overdue run doesn't lock the
  // table for minutes. The cron can run multiple ticks to drain backlog.
  const result = await query(
    `DELETE FROM ${policy.table}
      WHERE rowid IN (
        SELECT rowid FROM ${policy.table}
         WHERE datetime(${policy.timestampColumn}) < datetime(?)
         ORDER BY ${policy.timestampColumn} ASC
         LIMIT ?
      )`,
    [cutoffDate, policy.batchSize]
  );

  return {
    table: policy.table,
    deleted: Number((result as unknown as { rowsAffected?: number }).rowsAffected ?? 0),
    deleted_by_company_setting: 0,
    cutoff_date: cutoffDate,
  };
}

/**
 * Delete rows for companies that asked to keep less than the platform horizon.
 *
 * One statement rather than a loop over companies: the setting lives beside the
 * company id, so the join does the selection. Rows whose company set a LONGER
 * period are untouched here and fall to the platform horizon above — keeping
 * more is not this function's decision to make.
 */
async function applyCompanyHorizon(policy: RetentionPolicy): Promise<number> {
  let deleted = 0;
  for (const column of policy.companyHorizons) {
    // Fails closed on a name this file does not recognise, rather than
    // interpolating it. The list above is a literal today; this is the check
    // that keeps it one.
    if (!COMPANY_HORIZON_COLUMNS.includes(column)) continue;
    try {
      const result = await query(
        `DELETE FROM ${policy.table}
          WHERE rowid IN (
            SELECT t.rowid FROM ${policy.table} t
              JOIN data_residency_settings s ON s.product_id = t.product_id
             WHERE s.${column} IS NOT NULL
               AND s.${column} < ?
               AND datetime(t.${policy.timestampColumn})
                   < datetime('now', '-' || s.${column} || ' days')
             ORDER BY t.${policy.timestampColumn} ASC
             LIMIT ?
          )`,
        [policy.retentionDays, policy.batchSize],
      );
      deleted += Number((result as unknown as { rowsAffected?: number }).rowsAffected ?? 0);
    } catch {
      // A dev database without every migration. The platform horizon above has
      // already run; this is the additional, narrower sweep.
    }
  }
  return deleted;
}
