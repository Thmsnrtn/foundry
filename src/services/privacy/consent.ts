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
/**
 * WHAT SURVIVES AN ERASURE, AND ON WHAT TERMS.
 *
 * This was a map from table name to a sentence. A table name is not a legal
 * conclusion: it says nothing about which FIELDS are kept, what may be done
 * with them while they are kept, or when the decision should be looked at
 * again. It also let two tables be "retained" that the erasure had never
 * touched — `stripe_webhook_events` and `ai_daily_spend` carry no `product_id`
 * at all, so retaining them was a decision about nothing, recorded as though it
 * were a decision about something.
 *
 * A disposition says what is kept and why. Three shapes:
 *
 *   RETAIN   the rows stay, whole, because the purpose needs them whole
 *   REDACT   the rows stay, with named columns cleared — the record survives,
 *            the personal content does not
 *   PROJECT  only the rows matching `keepRows` stay; the rest are deleted
 *
 * Durations are deliberately absent from most entries. A number here would be
 * folklore: retention periods are a policy question about jurisdictions and
 * record classes, and inventing "seven years" in a source file would make a
 * legal claim this codebase is not entitled to make. `reviewAfterDays` records
 * when somebody has to decide, not what they will decide.
 */
export type RetentionCategory =
  | 'compliance_evidence'
  | 'financial_record'
  | 'safety_control'
  | 'referential_integrity';

export interface RetentionDisposition {
  category: RetentionCategory;
  /** Why this may be kept when the rest was erased. */
  basis: string;
  /** What may be done with it while it is kept. Narrow by default: surviving an
   * erasure does not make data ordinarily usable again. */
  processing: string;
  /** When the decision must be revisited, or null when the purpose does not
   * expire (evidence that an erasure happened does not expire on a timer). */
  reviewAfterDays: number | null;
  /** Extra predicate: rows NOT matching it are deleted like anything else. */
  keepRows?: string;
  /** Columns cleared to NULL on the rows that stay. */
  redactColumns?: string[];
  /** Columns the schema forbids from being NULL, overwritten with a marker
   * instead. Named separately rather than inferred, so that a NOT NULL column
   * being redacted is a visible decision rather than a silent fallback. */
  redactToMarker?: string[];
}

const RETAINED_ON_ERASURE: Record<string, RetentionDisposition> = {
  agent_audit_log: {
    category: 'compliance_evidence',
    basis: 'holds the erasure request and its completion record; erasing it would erase the evidence that the erasure happened',
    processing: 'compliance evidence only — never product cognition, model context, network insight or analytics',
    reviewAfterDays: null,
    // Only the erasure record itself. The rest of this company's activity log
    // is not evidence of the erasure and has no purpose that survives it —
    // retaining the whole log was keeping a description of everything the
    // company ever did, plus an IP address, forever.
    keepRows: "event_type IN ('data_deletion_scheduled','data_deletion_completed')",
    redactColumns: ['ip_address'],
  },
  products: {
    category: 'referential_integrity',
    basis: 'archived rather than deleted so the id cannot be reissued and every foreign key stays resolvable',
    processing: 'identity resolution only',
    reviewAfterDays: null,
    // The row survives; the company does not. Keeping the name and repository
    // of an erased company is keeping the company.
    redactColumns: [
      'stack_description', 'market_category', 'sector_profile',
      'github_repo_url', 'github_repo_owner', 'github_repo_name',
      // Every credential on the row, not just the one somebody remembered.
      // `ingest_token` is a live write credential and `share_token` is a public
      // link; both outlived the company they belonged to, so a monitoring
      // script kept posting metrics into a deleted company and a share URL kept
      // rendering its name.
      'github_access_token', 'ingest_token', 'share_token',
    ],
    redactToMarker: ['name'],
  },
  ai_spend_reservations: {
    category: 'financial_record',
    basis: 'cost accounting, including reservations still holding a ceiling; dropping them would release limits that are live',
    processing: 'accounting and ceiling enforcement only',
    reviewAfterDays: 365,
    // The amounts are the record. The person is not part of it: an accounting
    // total does not need to say whose it was once the account is gone.
    redactColumns: ['founder_id'],
  },
  idempotency_keys: {
    category: 'safety_control',
    basis: 'at-most-once records for effects already sent; deleting them would let a retry re-send a real message',
    processing: 'duplicate suppression only',
    reviewAfterDays: 30,
    // The KEY is the control. The stored result is a provider response that can
    // carry recipient addresses, and nothing needs it after the effect is done.
    redactColumns: ['result_json'],
  },
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

// =============================================================================
// THE TABLES THAT DO NOT SAY WHOSE THEY ARE
//
// `tablesWithProductId()` finds the tables an erasure can key on directly.
// Fifty-five tables in this schema do not carry the column, and treating that
// as "not company data" was wrong for three quarters of them:
//
//   • Eleven are CHILDREN of a table that is erased — chat_messages hangs off
//     chat_sessions, webhook_deliveries off webhooks, key_results off
//     company_okrs, and so on down two levels. Their parents were deleted and
//     they were not, so a founder's chat history, their webhook payloads and
//     their OKR record all survived an erasure as orphans.
//
//     Worse than surviving: seven of those foreign keys are ON DELETE NO
//     ACTION, and this database runs with foreign_keys=ON. So on any company
//     with a single chat message, `DELETE FROM chat_sessions` RAISES, and the
//     erasure could not complete at all. It was not that erasure left a little
//     behind — on a real company it did not finish.
//
//   • Three name the subject under a different column. `peer_reviews` calls it
//     `reviewee_product_id`; `decision_patterns` carries a `contributor_hash`
//     and no id at all, which is how an erased company's decisions kept being
//     aggregated into insights published to its competitors.
//
//   • The rest are the founder's rather than the company's, or the
//     institution's rather than anyone's. Those are stated below by name, with
//     a reason each, because "we did not think about it" and "we thought about
//     it and it stays" must not look the same from outside.
//
// And because FK order matters, the plan is TOPOLOGICALLY SORTED: children are
// deleted before parents. The old list was alphabetical, which happened to
// work for `experiments` before `hypotheses` and would have stopped working
// the first time somebody added a table whose name sorted the other way.
// =============================================================================

/** Tables that identify the company under a column that is not `product_id`.
 * Each entry is a deliberate statement that this data belongs to the company
 * and goes when the company does. */
const ERASE_BY_NAMED_KEY: Record<string, { column: string; subject: 'product_id' | 'contributor_hash' }> = {
  peer_reviews: { column: 'reviewee_product_id', subject: 'product_id' },
  // The whole point of this table is that it carries no product id — patterns
  // are pooled across companies. `contributor_hash` was added so distinct
  // companies could be COUNTED; it also makes them erasable, which is the only
  // reason an erased company's decisions can be taken back out of the pool.
  // Rows written before migration 144 have no hash and cannot be attributed to
  // anyone; they are already excluded from every aggregation for the same
  // reason.
  decision_patterns: { column: 'contributor_hash', subject: 'contributor_hash' },
};

/** Tables that belong to the FOUNDER, not to one of their products.
 * A founder with two companies who erases one must keep their own account,
 * their notification preferences and their usage counters. These go with the
 * founder's account, not with a product, and nothing here erases a founder. */
const FOUNDER_SCOPED: Record<string, string> = {
  founders: 'the account itself',
  ai_output_feedback: 'the founder\'s ratings of outputs, across all their products',
  chat_webhooks: 'the founder\'s own notification endpoints',
  cohort_memberships: 'peer-group membership, which is the founder\'s not a product\'s',
  data_export_requests: 'the founder\'s export history',
  deletion_requests: 'the founder\'s erasure requests — deleting these would delete the request',
  founder_ai_profile: 'how the founder likes to be written to',
  founder_health: 'the founder\'s own circumstances',
  founder_health_snapshots: 'the same, over time',
  founder_voice: 'the founder\'s writing preferences',
  gate_events: 'which features the founder hit a tier wall on',
  introductions: 'introductions between founders, involving a second person who did not ask for anything',
  network_profiles: 'the founder\'s own profile in the peer network',
  push_subscriptions: 'the founder\'s devices',
  referral_links: 'the founder\'s referral codes',
  referral_conversions: 'and what those codes did',
  slack_integrations: 'the founder\'s workspace connection',
  usage_limits: 'the founder\'s plan counters',
};

/** Tables that are the institution's or nobody's: reference data, global
 * counters, cross-company aggregates that name no company. Stated by name so
 * that a table landing here is a decision rather than an omission. */
const NOT_COMPANY_DATA: Record<string, string> = {
  agent_wiki_reads: 'which internal agent read which internal wiki entry',
  ai_daily_spend: 'daily spend totals keyed by scope, not by company row',
  audit_trail: 'created by migration 007 and never written or read by any code path',
  benchmark_percentiles: 'percentiles over a cohort, naming no member',
  cohort_groups: 'the groups themselves, not who is in them',
  cohort_patterns: 'patterns across a cohort, naming no member',
  cross_product_insights: 'aggregate claims that name no contributor; the rows behind them are erased via decision_patterns',
  failure_patterns: 'a library of known failure shapes, written by the institution',
  governed_effect_kinds: 'the effect vocabulary',
  intelligence_benchmarks: 'benchmarks over a cohort, naming no member',
  job_locks: 'scheduler leases',
  leading_indicators: 'indicator definitions per sector',
  network_benchmarks: 'benchmark aggregates, naming no contributor',
  network_contributions: 'single metric values with no key of any kind — nothing in the row identifies who contributed it',
  portfolios: 'an investor organisation, not a founder\'s company',
  portfolio_snapshots: 'that organisation\'s own aggregates',
  rate_limit_counters: 'request counters keyed by an opaque bucket',
  role_permissions: 'the permission model',
  schema_migrations: 'which migrations have run',
  sector_remediation_templates: 'template text per sector',
  sector_scoring_overrides: 'scoring configuration per sector',
  stripe_webhook_events: 'processed-event ids for at-most-once billing handling, carrying no company reference',
};

interface TableRelation { table: string; column: string; parent: string; parentColumn: string }

/** Children whose relationship the schema never declared. `experiment_variants`
 * carries an `experiment_id` and no foreign key, so no amount of reading the
 * schema finds it — it has to be written down, and being written down is what
 * makes it visible when it changes. */
const UNDECLARED_PARENTS: TableRelation[] = [
  { table: 'experiment_variants', column: 'experiment_id', parent: 'experiments', parentColumn: 'id' },
];

/** Child tables — no `product_id`, but a foreign key into something erased. */
async function childTablesOfErasure(): Promise<TableRelation[]> {
  const withProduct = new Set(await tablesWithProductId());
  const all = (await query(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name`, [])).rows as unknown as Array<Record<string, unknown>>;

  const found: TableRelation[] = [];
  // Erasable-by-descent grows as the walk goes deeper: okr_progress_updates
  // reaches a product only through key_results, which reaches it through
  // company_okrs. One pass per level, until a pass adds nothing.
  const reachable = new Set([...withProduct, ...Object.keys(ERASE_BY_NAMED_KEY)]);
  for (const rel of UNDECLARED_PARENTS) {
    if (reachable.has(rel.table) || !reachable.has(rel.parent)) continue;
    found.push(rel);
    reachable.add(rel.table);
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of all) {
      const table = String(row.name);
      if (reachable.has(table)) continue;
      const fks = (await query(
        `SELECT "table" AS parent, "from" AS col, "to" AS parentCol
           FROM pragma_foreign_key_list(?)`, [table])).rows as unknown as
        Array<Record<string, unknown>>;
      const link = fks.find((f) => reachable.has(String(f.parent)));
      if (!link) continue;
      found.push({
        table,
        column: String(link.col),
        parent: String(link.parent),
        // A foreign key with no explicit target column references the parent's
        // primary key, which pragma reports as NULL rather than 'id'.
        parentColumn: link.parentCol == null ? 'id' : String(link.parentCol),
      });
      reachable.add(table);
      grew = true;
    }
  }
  return found;
}

/** One deletion, and the order it must happen in. */
export interface ErasureStep {
  table: string;
  sql: string;
  /** 0 for a table keyed directly on the company; deeper for each level of
   * descent. Higher runs first, so children go before their parents. */
  depth: number;
}

/**
 * Every deletion an erasure performs, ordered children-first.
 *
 * Order is not cosmetic here. These foreign keys are ON DELETE NO ACTION and
 * the connection runs with foreign_keys=ON, so deleting a parent that still
 * has children RAISES — which is what an erasure did on any company that had
 * ever sent a chat message.
 */
export async function erasurePlan(): Promise<ErasureStep[]> {
  const steps: ErasureStep[] = [];

  for (const table of await tablesToErase()) {
    steps.push({ table, sql: `DELETE FROM ${table} WHERE product_id = ?`, depth: 0 });
  }
  for (const [table, key] of Object.entries(ERASE_BY_NAMED_KEY)) {
    steps.push({ table, sql: `DELETE FROM ${table} WHERE ${key.column} = ?`, depth: 0 });
  }

  // A child is deleted through its parent's own predicate, nested as deep as
  // the descent goes. The parent rows still exist at this point precisely
  // because children run first.
  const predicates = new Map<string, string>();
  for (const t of await tablesToErase()) predicates.set(t, 'product_id = ?');
  for (const [t, k] of Object.entries(ERASE_BY_NAMED_KEY)) predicates.set(t, `${k.column} = ?`);

  const children = await childTablesOfErasure();
  const depthOf = new Map<string, number>();
  for (const c of children) {
    const parentPredicate = predicates.get(c.parent);
    if (!parentPredicate) continue;                       // parent is retained, not erased
    const predicate =
      `${c.column} IN (SELECT ${c.parentColumn} FROM ${c.parent} WHERE ${parentPredicate})`;
    predicates.set(c.table, predicate);
    const depth = (depthOf.get(c.parent) ?? 0) + 1;
    depthOf.set(c.table, depth);
    steps.push({ table: c.table, sql: `DELETE FROM ${c.table} WHERE ${predicate}`, depth });
  }

  return steps.sort((a, b) => b.depth - a.depth);
}

/** Every table the live schema holds, and which bucket it falls in. Exported
 * so the gate can prove the classification is TOTAL: a table in none of them
 * is a table nobody has decided about, and the erasure would step around it in
 * silence. */
export async function classifyTables(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const all = (await query(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name`, [])).rows as unknown as Array<Record<string, unknown>>;
  const byProduct = new Set(await tablesToErase());
  const byParent = new Set((await childTablesOfErasure()).map((c) => c.table));

  for (const row of all) {
    const t = String(row.name);
    out[t] =
      t in RETAINED_ON_ERASURE ? 'retained'
      : byProduct.has(t) ? 'erase_by_product'
      : t in ERASE_BY_NAMED_KEY ? 'erase_by_named_key'
      : byParent.has(t) ? 'erase_by_parent'
      : t in FOUNDER_SCOPED ? 'founder_scoped'
      : t in NOT_COMPANY_DATA ? 'not_company_data'
      : 'UNCLASSIFIED';
  }
  return out;
}

/** Exported for the gate: the two allow-lists that are written down rather
 * than derived, so their reasons can be read. */
export const FOUNDER_SCOPED_REASONS = FOUNDER_SCOPED;
export const NOT_COMPANY_DATA_REASONS = NOT_COMPANY_DATA;
export const ERASE_BY_NAMED_KEY_TABLES = ERASE_BY_NAMED_KEY;

/** The SET clause for a disposition's redaction, or '' when it redacts nothing.
 * Column names come from the disposition map in this file — never from a
 * caller — so there is nothing here a request can reach. */
function redactionSql(d: RetentionDisposition): string {
  return [
    ...(d.redactColumns ?? []).map((c) => `${c} = NULL`),
    ...(d.redactToMarker ?? []).map((c) => `${c} = '[erased]'`),
  ].join(', ');
}

/** What an erasure actually did, per table. The completion record states it,
 * so "complete" can be checked rather than believed. */
export interface ErasureOutcome {
  deleted: string[];
  redacted: string[];
  retained: string[];
  failed: string[];
}

/** Exported so the gate can check every retention explains itself. */
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
export async function processScheduledDeletions(): Promise<ErasureRunOutcome> {
  // Find scheduled deletions that are past their threshold.
  //
  // `target_id IS NOT NULL` inside the subquery is not decoration. `x NOT IN
  // (a, NULL)` is NULL in SQLite, never true — so ONE completion row with a
  // null target would make this select return nothing, for every founder,
  // forever, with no error anywhere. The column is nullable and this is a
  // compliance path with a legal clock on it; a silent total stop is the worst
  // failure it has.
  const pending = await query(
    `SELECT DISTINCT target_id as product_id, metadata_json FROM agent_audit_log
     WHERE event_type = 'data_deletion_scheduled'
       AND target_id IS NOT NULL
       AND target_id NOT IN (
         SELECT target_id FROM agent_audit_log
          WHERE event_type = 'data_deletion_completed' AND target_id IS NOT NULL
       )`,
    []
  );

  const result: ErasureRunOutcome = { completed: 0, failed: [] };

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

    // ONE FOUNDER'S ERASURE MUST NOT BLOCK ANOTHER'S.
    //
    // The inner catch below rethrows, and its comment said the throw was
    // "rethrown to the caller's per-product catch, which leaves the deletion
    // pending and retries it on the next run". There was no per-product catch.
    // The throw left this function entirely, so a single product whose erasure
    // could not complete — a trigger refusing a delete, a foreign key, a
    // corrupt row — aborted the whole batch and every founder queued behind it
    // was skipped, every day, indefinitely. Their requests stayed pending and
    // nothing said so.
    //
    // The retry semantics the comment described are the right ones. This is
    // where they actually happen.
    try {
      await eraseOneProduct(productId);
      result.completed++;
    } catch (err) {
      // No completion record was written — that happens only at the end of a
      // successful erasure — so this product stays pending and is retried on
      // the next run, which is the same behaviour it had, minus taking
      // everybody else down with it.
      result.failed.push({ productId, error: (err as Error).message });
      await recordErasureFailure(productId, err as Error);
    }
  }

  return result;
}

/** Why an erasure run ended the way it did. A count alone cannot distinguish
 * "nothing was due" from "everything failed", and those are opposite facts. */
export interface ErasureRunOutcome {
  completed: number;
  failed: Array<{ productId: string; error: string }>;
}

/** A failed erasure leaves evidence too. Without this the only record of a
 * request that could not be honoured is its absence. */
async function recordErasureFailure(productId: string, err: Error): Promise<void> {
  try {
    await query(
      `INSERT INTO agent_audit_log
         (id, product_id, event_type, actor_type, actor_id, target_type, target_id,
          description, metadata_json, created_at)
       VALUES (?, ?, 'data_deletion_failed', 'system', 'system', 'product', ?,
               ?, ?, datetime('now'))`,
      [nanoid(), productId, productId,
        'Erasure attempt did not complete; the request remains pending and will be retried.',
        JSON.stringify({ error: err.message })]);
  } catch {
    // If even the failure record cannot be written there is nothing further
    // this path can do, and throwing here would resurrect the bug above.
  }
}

/** Erase one product, or throw leaving it pending. Extracted so a failure is
 * one founder's failure rather than the batch's. */
async function eraseOneProduct(productId: string): Promise<void> {
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
    const outcome: ErasureOutcome = { deleted: [], redacted: [], retained: [], failed: [] };

    // Ordered children-first, and including the tables that carry no
    // `product_id` — the ones that used to make this throw.
    for (const step of await erasurePlan()) {
      try {
        // `decision_patterns` names its subject by contributor hash, not id.
        // Everything else is keyed on the product itself.
        const subject = step.table === 'decision_patterns'
          ? (await import('../wisdom/network.js')).contributorHash(productId)
          : productId;
        await query(step.sql, [subject]);
        outcome.deleted.push(step.table);
      } catch (err) {
        const table = step.table;
        // A table that cannot be cleared must not be silently skipped: the
        // completion record below would then be false. Recorded and rethrown to
        // the per-product catch in the caller, which leaves this deletion
        // pending, retries it on the next run, and lets the rest of the batch
        // through.
        outcome.failed.push(table);
        throw new Error(`data deletion incomplete: ${table}: ${String(err)}`);
      }
    }

    // Then the tables that survive, on the terms their disposition states.
    // "Retained" is not a synonym for "left alone": rows outside the retained
    // purpose are deleted, and columns outside it are cleared. Keeping a
    // company's entire activity log because two of its rows are erasure
    // evidence is the version of this that reports success and keeps the
    // company.
    for (const [table, disposition] of Object.entries(RETAINED_ON_ERASURE)) {
      if (table === 'products') continue;                 // handled below, whole
      try {
        if (disposition.keepRows) {
          await query(
            `DELETE FROM ${table} WHERE product_id = ? AND NOT (${disposition.keepRows})`,
            [productId]);
        }
        const clears = redactionSql(disposition);
        if (clears) {
          await query(`UPDATE ${table} SET ${clears} WHERE product_id = ?`, [productId]);
          outcome.redacted.push(table);
        } else {
          outcome.retained.push(table);
        }
      } catch (err) {
        outcome.failed.push(table);
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
    // BOTH AXES. Writing only `status` left `scp_status='active'`, and around
    // twenty scheduled jobs select their work on `scp_status` alone — so a
    // company whose founder had withdrawn consent and whose data had just been
    // deleted stayed on every agent's work list, and kept being reasoned about
    // by model calls. Deletion has to end the operating relationship, not just
    // the record.
    //
    // AND THE ROW IS REDACTED, not merely marked. It survives so its id cannot
    // be reissued and foreign keys stay resolvable; it does not survive as a
    // description of the company. Keeping the name, the repository and the
    // market of an erased company is keeping the company.
    await query(
      `UPDATE products SET status = 'archived', scp_status = 'archived',
              ${redactionSql(RETAINED_ON_ERASURE.products)}
        WHERE id = ?`,
      [productId]);
    outcome.redacted.push('products');

    // Log completion — TRUTHFULLY.
    //
    // "Product data has been removed" was the whole record, and it was written
    // over an erasure that had removed six per cent of the company. A
    // completion record that cannot distinguish deleted from retained is a
    // claim nobody can check, and the one thing a compliance record exists to
    // let somebody check is exactly that.
    await query(
      `INSERT INTO agent_audit_log
         (id, product_id, event_type, actor_type, actor_id, target_type, target_id,
          description, metadata_json, created_at)
       VALUES (?, ?, 'data_deletion_completed', 'system', 'system', 'product', ?,
               ?, ?, datetime('now'))`,
      [nanoid(), productId, productId,
        `Erasure complete: ${outcome.deleted.length} tables deleted, `
        + `${outcome.redacted.length} redacted, ${outcome.retained.length} retained `
        + 'for a stated purpose.',
        JSON.stringify({
          deleted: outcome.deleted,
          redacted: outcome.redacted,
          retained: outcome.retained,
          failed: outcome.failed,
          retention: Object.fromEntries(Object.entries(RETAINED_ON_ERASURE).map(
            ([table, d]) => [table, {
              category: d.category, basis: d.basis, processing: d.processing,
              review_after_days: d.reviewAfterDays,
              fields_cleared: [...(d.redactColumns ?? []), ...(d.redactToMarker ?? [])],
              rows_kept: d.keepRows ?? 'all',
            }])),
        })]
    );
}
