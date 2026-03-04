// =============================================================================
// @foundry/sdk — Type Definitions
// =============================================================================

/**
 * Schema mapping: tells the adapter how your database columns map to
 * Foundry's metric concepts. Use dot notation: 'table.column'.
 *
 * Example:
 *   mrr_new:    'subscriptions.monthly_amount_cents'
 *   mrr_churn:  'cancellations.mrr_cents'
 *   signups:    'users.created_at'
 */
export interface SchemaMapping {
  /** New MRR (cents) — e.g. 'subscriptions.amount_cents' */
  mrr_new?: string;
  /** Churned MRR (cents) — e.g. 'cancellations.mrr_cents' */
  mrr_churn?: string;
  /** Expansion MRR (cents) */
  mrr_expansion?: string;
  /** Contraction MRR (cents) */
  mrr_contraction?: string;
  /** User signups — timestamp column for counting — e.g. 'users.created_at' */
  signups?: string;
  /** Active users — boolean/timestamp column */
  active_users?: string;
  /** Activation event timestamp */
  activation_event?: string;
  /** Cancellation/churn timestamp */
  churn_event?: string;
  /** NPS score column — e.g. 'nps_responses.score' */
  nps_score?: string;
}

/**
 * Configuration for the Foundry adapter.
 */
export interface FoundryAdapterConfig {
  /**
   * Your Foundry API key — find it in Settings → Connected Apps.
   * Required to authenticate metric pushes to Foundry.
   */
  apiKey: string;

  /**
   * Your Foundry product ID — find it in Settings.
   */
  productId: string;

  /**
   * The Foundry API base URL. Defaults to the hosted Foundry service.
   * Override to point at a self-hosted instance.
   */
  foundryUrl?: string;

  /**
   * Schema mapping: your database columns → Foundry metric concepts.
   * If omitted, the adapter will attempt auto-detection (requires dbClient).
   */
  schema?: SchemaMapping;

  /**
   * A function that executes a SQL query against your database.
   * Required for schema auto-detection and metric sync.
   *
   * @example
   *   queryFn: (sql, args) => db.execute(sql, args)
   */
  queryFn?: (sql: string, args?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;

  /**
   * How often to sync metrics to Foundry (in minutes). Default: 60.
   * Set to 0 to disable automatic sync (use manualSync() instead).
   */
  syncIntervalMinutes?: number;

  /**
   * Whether to mount the embedded Foundry Signal view at the adapter route.
   * Default: true. Set to false if you only want metric sync, no UI.
   */
  mountUI?: boolean;

  /**
   * Optional: whether to opt into the Foundry wisdom network.
   * Default: true. Set to false to disable cross-product pattern contribution.
   */
  wisdomNetworkOptIn?: boolean;
}

/**
 * The metric payload that gets pushed to Foundry.
 */
export interface FoundrySyncPayload {
  product_id: string;
  snapshot_date: string; // YYYY-MM-DD
  new_mrr_cents?: number;
  expansion_mrr_cents?: number;
  contraction_mrr_cents?: number;
  churned_mrr_cents?: number;
  signups_7d?: number;
  active_users?: number;
  activation_rate?: number;
  churn_rate?: number;
  nps_score?: number;
}

/**
 * Result of a schema auto-detection attempt.
 */
export interface DetectedSchema {
  schema: SchemaMapping;
  confidence: 'high' | 'medium' | 'low';
  notes: string[];
}
