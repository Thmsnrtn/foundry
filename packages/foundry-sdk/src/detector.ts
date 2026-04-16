// =============================================================================
// @foundry/sdk — Schema Auto-Detector
// Analyzes your database schema and suggests a SchemaMapping.
// =============================================================================

import type { DetectedSchema, SchemaMapping } from './types.js';

type QueryFn = (sql: string, args?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;

/**
 * Attempts to detect the schema mapping from the host database by
 * examining table and column names for common patterns.
 *
 * This does NOT read any data — only metadata (table/column names).
 */
export class FoundrySchemaDetector {
  constructor(private queryFn: QueryFn) {}

  async detect(): Promise<DetectedSchema> {
    const schema: SchemaMapping = {};
    const notes: string[] = [];
    let confidence: 'high' | 'medium' | 'low' = 'low';
    let matches = 0;

    // Try to get table list (SQLite / Postgres / MySQL)
    const tables = await this.getTables();
    if (tables.length === 0) {
      return { schema, confidence: 'low', notes: ['Could not read database schema.'] };
    }

    // For each table, get columns and try to match patterns
    for (const table of tables) {
      const columns = await this.getColumns(table);
      const colNames = columns.map((c) => c.toLowerCase());

      // ── MRR / Subscription detection ──
      if (
        table.match(/subscri|payment|invoice|billing|charge/i) ||
        colNames.some((c) => c.match(/amount|price|mrr|revenue/))
      ) {
        const amountCol = columns.find((c) =>
          c.match(/amount|price|cents|mrr/i)
        );
        if (amountCol) {
          schema.mrr_new = `${table}.${amountCol}`;
          notes.push(`Detected MRR source: ${table}.${amountCol}`);
          matches++;
        }
      }

      // ── Cancellation / Churn detection ──
      if (table.match(/cancel|churn|unsubscri/i)) {
        const amountCol = columns.find((c) => c.match(/amount|mrr|cents/i));
        const dateCol = columns.find((c) => c.match(/cancel|churn|at|date/i));
        if (amountCol) {
          schema.mrr_churn = `${table}.${amountCol}`;
          notes.push(`Detected churn MRR source: ${table}.${amountCol}`);
          matches++;
        }
        if (dateCol) {
          schema.churn_event = `${table}.${dateCol}`;
        }
      }

      // ── User / Signup detection ──
      if (table.match(/^users?$|^accounts?$|^members?$/i)) {
        const createdCol = columns.find((c) => c.match(/created_at|signed_up|registered/i));
        if (createdCol) {
          schema.signups = `${table}.${createdCol}`;
          schema.active_users = `${table}.${createdCol}`;
          notes.push(`Detected user table: ${table}`);
          matches++;
        }
      }

      // ── NPS detection ──
      if (table.match(/nps|survey|feedback|rating/i)) {
        const scoreCol = columns.find((c) => c.match(/score|rating|value|nps/i));
        if (scoreCol) {
          schema.nps_score = `${table}.${scoreCol}`;
          notes.push(`Detected NPS source: ${table}.${scoreCol}`);
          matches++;
        }
      }
    }

    if (matches >= 3) confidence = 'high';
    else if (matches >= 1) confidence = 'medium';

    if (notes.length === 0) {
      notes.push('No matching patterns found. Provide schema mapping manually.');
    }

    return { schema, confidence, notes };
  }

  private async getTables(): Promise<string[]> {
    // Try SQLite
    try {
      const res = await this.queryFn(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        []
      );
      if (res.rows.length > 0) {
        return res.rows.map((r) => (r as Record<string, string>).name);
      }
    } catch { /* not SQLite */ }

    // Try Postgres
    try {
      const res = await this.queryFn(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
        []
      );
      if (res.rows.length > 0) {
        return res.rows.map((r) => (r as Record<string, string>).tablename);
      }
    } catch { /* not Postgres */ }

    return [];
  }

  private async getColumns(table: string): Promise<string[]> {
    // SQLite
    try {
      const res = await this.queryFn(`PRAGMA table_info(${table})`, []);
      if (res.rows.length > 0) {
        return res.rows.map((r) => (r as Record<string, string>).name);
      }
    } catch { /* not SQLite */ }

    // Postgres
    try {
      const res = await this.queryFn(
        'SELECT column_name FROM information_schema.columns WHERE table_name = $1',
        [table]
      );
      if (res.rows.length > 0) {
        return res.rows.map((r) => (r as Record<string, string>).column_name);
      }
    } catch { /* not Postgres */ }

    return [];
  }
}
