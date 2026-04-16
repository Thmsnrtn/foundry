// =============================================================================
// @foundry/sdk — Metrics Builder
// Translates the host app's schema mapping into a Foundry metric payload.
// =============================================================================

import type { FoundrySyncPayload, SchemaMapping } from './types.js';

type QueryFn = (sql: string, args?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;

/**
 * Build a Foundry metric snapshot from the host app's database,
 * using the provided schema mapping.
 */
export async function buildMetricsFromSchema(
  queryFn: QueryFn,
  schema: SchemaMapping,
  productId: string,
): Promise<FoundrySyncPayload> {
  const today = new Date().toISOString().split('T')[0];
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const payload: FoundrySyncPayload = {
    product_id: productId,
    snapshot_date: today,
  };

  const promises: Promise<void>[] = [];

  // ── New MRR ──
  if (schema.mrr_new) {
    const [table, column] = schema.mrr_new.split('.');
    promises.push(
      queryFn(
        `SELECT COALESCE(SUM(${column}), 0) as total FROM ${table} WHERE DATE(created_at) = ?`,
        [today]
      ).then((res) => {
        payload.new_mrr_cents = Math.round((res.rows[0]?.total as number) ?? 0);
      }).catch(() => {})
    );
  }

  // ── Churned MRR ──
  if (schema.mrr_churn) {
    const [table, column] = schema.mrr_churn.split('.');
    promises.push(
      queryFn(
        `SELECT COALESCE(SUM(${column}), 0) as total FROM ${table} WHERE DATE(created_at) = ?`,
        [today]
      ).then((res) => {
        payload.churned_mrr_cents = Math.round((res.rows[0]?.total as number) ?? 0);
      }).catch(() => {})
    );
  }

  // ── Signups (7d) ──
  if (schema.signups) {
    const [table, column] = schema.signups.split('.');
    promises.push(
      queryFn(
        `SELECT COUNT(*) as count FROM ${table} WHERE DATE(${column}) >= ?`,
        [sevenDaysAgo]
      ).then((res) => {
        payload.signups_7d = Math.round((res.rows[0]?.count as number) ?? 0);
      }).catch(() => {})
    );
  }

  // ── Active Users ──
  if (schema.active_users) {
    const [table, column] = schema.active_users.split('.');
    promises.push(
      queryFn(
        `SELECT COUNT(*) as count FROM ${table} WHERE DATE(${column}) >= ?`,
        [sevenDaysAgo]
      ).then((res) => {
        payload.active_users = Math.round((res.rows[0]?.count as number) ?? 0);
      }).catch(() => {})
    );
  }

  // ── NPS ──
  if (schema.nps_score) {
    const [table, column] = schema.nps_score.split('.');
    promises.push(
      queryFn(
        `SELECT AVG(${column}) as avg FROM ${table} WHERE DATE(created_at) >= DATE('now', '-30 days')`,
        []
      ).then((res) => {
        const avg = res.rows[0]?.avg as number | null;
        if (avg !== null && avg !== undefined) {
          payload.nps_score = Math.round(avg * 10) / 10;
        }
      }).catch(() => {})
    );
  }

  // ── Churn rate (derived) ──
  if (schema.churn_event && schema.active_users) {
    const [churnTable, churnCol] = schema.churn_event.split('.');
    const [userTable] = schema.active_users.split('.');
    promises.push(
      Promise.all([
        queryFn(`SELECT COUNT(*) as count FROM ${churnTable} WHERE DATE(${churnCol}) >= ?`, [sevenDaysAgo]),
        queryFn(`SELECT COUNT(*) as count FROM ${userTable}`, []),
      ]).then(([churned, total]) => {
        const c = (churned.rows[0]?.count as number) ?? 0;
        const t = (total.rows[0]?.count as number) ?? 1;
        if (t > 0) payload.churn_rate = c / t;
      }).catch(() => {})
    );
  }

  await Promise.all(promises);

  // Compute MRR health ratio if we have the components
  if (payload.new_mrr_cents !== undefined && payload.churned_mrr_cents !== undefined && payload.new_mrr_cents > 0) {
    // Not included in payload — Foundry computes it server-side
  }

  return payload;
}
