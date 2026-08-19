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
 * touched — `stripe_webhook_events` carries no `product_id` at all, so retaining
 * it was a decision about nothing, recorded as though it were a decision about
 * something. (`ai_daily_spend` was listed here for the same stated reason, and
 * the reason was wrong: it carries both the company and the founder under
 * `scope_id`. It is erased on both axes now.)
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
    // AND `actor_id` STOPS NAMING THE ERASED PERSON — not here, but in the
    // cross-company sever, which nulls it wherever it holds this founder.
    //
    // That looks like it contradicts the grace-window rule that WHO ASKED is
    // the entire point of this trail, and it does not: both are true at
    // different times. During the thirty days the person still exists, the row
    // is intact, and `pendingDeletion` reads `actor_id` to tell them who
    // scheduled it. Once the erasure completes there is no person to name, and
    // this trail's stated purpose is that the erasure HAPPENED — not who they
    // were. A retention that keeps a personal identifier forever needs to say
    // so; this one no longer keeps it.
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
  return (await tablesWithProductId())
    .filter((t) => !(t in RETAINED_ON_ERASURE))
    // NOT_COMPANY_DATA WAS ONLY CONSULTED FOR TABLES WITHOUT A product_id.
    // A table that carries the column but is not a customer's data — the one
    // instance is `system_identities`, which names WHICH PRODUCT ROW IS FOUNDRY
    // — was swept in anyway, so its entry in that list decided nothing. The
    // classifier's own precedence hid it: `byProduct` was tested before
    // NOT_COMPANY_DATA, so it reported erase_by_product for a table the list
    // said was not company data at all. Declared in one place and contradicted
    // in another is the shape this whole campaign is about, and the erasure
    // classifier is not exempt from it.
    .filter((t) => !(t in NOT_COMPANY_DATA));
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
//   • Some name the subject under a different column. `decision_patterns`
//     carries a `contributor_hash` and no id at all, which is how an erased
//     company's decisions kept being aggregated into insights published to its
//     competitors; `ai_daily_spend` calls it `scope_id` and holds a founder
//     there too. (`peer_reviews` was a third until migration 163 retired it —
//     a live writer, no reader anywhere, and no contract to keep.)
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
const ERASE_BY_NAMED_KEY: Record<string, {
  column: string;
  subject: 'product_id' | 'contributor_hash';
  /**
   * How the subject sits in the column. `exact` (the default) means the column
   * IS the id. `prefix` means the id is the first component of a composite key
   * the writer assembled — matched as `id || '%'` rather than by containment,
   * so one company's id can never match another's row.
   */
  match?: 'exact' | 'prefix';
  /**
   * Narrows the delete when the column holds more than one kind of subject.
   *
   * DEFENCE IN DEPTH, NOT THE MECHANISM. What actually keeps the scopes apart
   * is that their ids cannot collide — `__global__` is a literal no product or
   * founder id can equal — so removing this clause changes no behaviour today
   * and no test catches its removal. It is here so that the scope a delete
   * means is written down at the delete, and it becomes load-bearing the day
   * a scope keys on something an id could equal.
   */
  where?: string;
}> = {
  // The whole point of this table is that it carries no product id — patterns
  // are pooled across companies. `contributor_hash` was added so distinct
  // companies could be COUNTED; it also makes them erasable, which is the only
  // reason an erased company's decisions can be taken back out of the pool.
  // Rows written before migration 144 have no hash and cannot be attributed to
  // anyone; they are already excluded from every aggregation for the same
  // reason.
  decision_patterns: { column: 'contributor_hash', subject: 'contributor_hash' },
  // The daily spend rollup keys on `scope_id`, which is a product id when
  // scope='product'. Nothing found it before because it has no `product_id`
  // column: it was a derived summary, written by an AFTER INSERT trigger on
  // `ai_spend_reservations`, carrying the company id under another name. The
  // `where` states which rollup this delete means. The founder's rollup goes
  // with the founder and the global row names nobody and must not shrink
  // because a company left — though what enforces that today is that their
  // scope_ids cannot collide, not this clause. See the type above.
  ai_daily_spend: { column: 'scope_id', subject: 'product_id', where: "scope = 'product'" },
  // THE COMPANY IS IN THE PRIMARY KEY, WHICH IS WHY NOTHING FOUND IT.
  // `network_contributions` has no `product_id` column — its writer builds the
  // key as `${productId}_week_${metric}` — so the by-product sweep could not
  // see it and it sat in NOT_COMPANY_DATA under the reason "single metric
  // values with no key of any kind". Every row named the company that
  // contributed it, and `recomputeBenchmarks` kept folding erased companies
  // into percentiles shown to other founders. That is the exact harm the
  // `decision_patterns` contributor hash exists to prevent.
  network_contributions: { column: 'id', subject: 'product_id', match: 'prefix' },
};

/**
 * Tables that belong to the FOUNDER, not to one of their products — AND WHAT
 * HAPPENS TO THEM WHEN THE FOUNDER GOES.
 *
 * This was a map from table name to one sentence, and the sentence answered
 * only half the question. It said why the table survives erasing ONE OF TWO
 * COMPANIES, which is right: a founder who closes a company keeps their
 * account, their notification preferences and their usage counters.
 *
 * Nothing ever asked the other half. `eraseFounderAccount` erased every
 * company the person owned, redacted the `founders` row, and stopped — so
 * after Foundry reported an account erasure complete, the founder's health
 * circumstances, their voice, their devices, their Slack workspace token,
 * their peer-network profile and their referral history were all still there,
 * still keyed to a founder id that still existed. Twelve tables. Being out of
 * scope for a product erasure had been silently read as having been decided
 * about.
 *
 * So each entry now carries the op that runs when the PERSON is erased:
 *
 *   DELETE  nothing survives the person; the rows were only ever about them
 *   REDACT  the row survives cleared, because foreign keys resolve to it
 *   SEVER   the row survives because it is ALSO SOMEBODY ELSE'S — an
 *           introduction names two founders and a referral conversion is the
 *           referrer's attribution. The erased person's link is cut and their
 *           own contribution cleared; the other person keeps their record.
 *           Deleting these would erase a second person who never asked for
 *           anything.
 */
type AccountErasure =
  | { op: 'delete'; by?: string; where?: string; match?: 'exact' | 'suffix' }
  | { op: 'redact'; clears: string[]; resets: Record<string, number> }
  | { op: 'sever'; marker: string | null; parties: Array<{ column: string; alsoClear?: string[] }> };

const FOUNDER_SCOPED: Record<string, { reason: string; onAccountErasure: AccountErasure }> = {
  founders: {
    reason: 'the account itself',
    // WHAT SURVIVES ON IT, NAMED. This said `{ op: 'redact' }` and nothing
    // else, so the most personal row in the schema was the one row with no
    // written statement of what is kept — while every table that survives a
    // PRODUCT erasure has carried a field-level disposition for months.
    //
    // Clearing `country_code` and keeping `ppp_factor` and `local_currency`
    // was the sharpest version of that: those two are functions of the country
    // it deliberately removed, so the fact was erased and re-derivable from
    // the same row. `referred_by_code` resolves through `referral_links` to
    // the person who recruited them — the other side of the linkage
    // `referral_conversions` goes to the trouble of severing.
    // KEPT, AND WHY: `id` so foreign keys resolve and the id cannot be
    // reissued; `tier`, `paid_through`, `trial_ends_at` because retained
    // financial records reference the commercial relationship and say nothing
    // about the person; `created_at` because an account that existed is a fact
    // the erasure trail already records. Redacted rather than deleted for the
    // same reason the product row is.
    onAccountErasure: {
      op: 'redact',
      clears: [
        'email', 'name', 'clerk_user_id', 'stripe_customer_id', 'preferences',
        'country_code', 'local_currency', 'ppp_factor', 'referred_by_code',
        'cohort_id', 'lifestyle_mode', 'lifestyle_target_mrr',
        'wisdom_network_consent_date',
        'last_seen_at', 'onboarding_completed_at',
      ],
      // NOT NULL, so they are RESET rather than cleared — and the value is not
      // the column default. `wisdom_network_opted_in` defaults to 1; an erased
      // account must not read as consenting to a cross-company pool it can no
      // longer be asked about. Withdrawn is the only honest state for a
      // consent flag on an account that no longer exists.
      resets: { wisdom_network_opted_in: 0, network_opt_in: 0 },
    },
  },
  ai_output_feedback: {
    reason: 'the founder\'s ratings of outputs, across all their products',
    onAccountErasure: { op: 'delete' },
  },
  cohort_memberships: {
    reason: 'peer-group membership, which is the founder\'s not a product\'s',
    onAccountErasure: { op: 'delete' },
  },
  founder_ai_profile: {
    reason: 'how the founder likes to be written to',
    onAccountErasure: { op: 'delete' },
  },
  founder_health: {
    reason: 'the founder\'s own circumstances',
    onAccountErasure: { op: 'delete' },
  },
  founder_health_snapshots: {
    reason: 'the same, over time',
    onAccountErasure: { op: 'delete' },
  },
  founder_voice: {
    reason: 'the founder\'s writing preferences',
    onAccountErasure: { op: 'delete' },
  },
  gate_events: {
    reason: 'which features the founder hit a tier wall on',
    onAccountErasure: { op: 'delete' },
  },
  introductions: {
    reason: 'introductions between founders, involving a second person who did not ask for anything',
    // The second person is the reason this is severed rather than deleted.
    // `feedback_a` and `feedback_b` are each written by one of the two, so the
    // erased party's own words go and the other party's stay.
    onAccountErasure: {
      op: 'sever',
      marker: 'erased',
      parties: [
        { column: 'founder_a_id', alsoClear: ['feedback_a'] },
        { column: 'founder_b_id', alsoClear: ['feedback_b'] },
      ],
    },
  },
  network_profiles: {
    reason: 'the founder\'s own profile in the peer network',
    onAccountErasure: { op: 'delete' },
  },
  push_subscriptions: {
    reason: 'the founder\'s devices',
    onAccountErasure: { op: 'delete' },
  },
  referral_links: {
    reason: 'the founder\'s referral codes',
    // Their own conversions go with them: `referral_conversions.referral_link_id`
    // is ON DELETE CASCADE.
    onAccountErasure: { op: 'delete' },
  },
  referral_conversions: {
    reason: 'and what those codes did',
    // Rows on SOMEBODY ELSE'S link, where this founder was the person invited.
    // That the referrer brought in a paying company is the referrer's fact and
    // may be owed to them; who it was is not part of it. The column is
    // nullable, so the linkage severs cleanly to nothing.
    onAccountErasure: { op: 'sever', marker: null, parties: [{ column: 'invited_founder_id' }] },
  },
  slack_integrations: {
    reason: 'the founder\'s workspace connection',
    onAccountErasure: { op: 'delete' },
  },
  usage_limits: {
    reason: 'the founder\'s plan counters',
    onAccountErasure: { op: 'delete' },
  },
  rate_limit_counters: {
    reason: 'request counters bucketed per founder and per product, keyed by a composite string rather than by a column',
    // CLASSIFIED AS "AN OPAQUE BUCKET". The buckets are `audit:founder:<id>`
    // and `apimodel:<product_id>` — the key names exactly who is being
    // counted. The residue is short-lived (a sweep expires old windows) but
    // the written reason was false, and a reason nobody can check is how
    // `network_contributions` stayed misclassified too.
    onAccountErasure: { op: 'delete', by: 'key', where: "key LIKE 'audit:founder:%'", match: 'suffix' },
  },
  ai_daily_spend: {
    reason: 'the founder\'s own daily spend rollup, keyed by scope rather than by a founder column',
    // THE ROLLUP CARRIES THE PERSON UNDER A NAME NOTHING WAS LOOKING FOR.
    // `scope_id` holds a product id when scope='product' and a founder id when
    // scope='founder', so a classification that finds company data by looking
    // for a `product_id` column could not see it, and this table sat in
    // NOT_COMPANY_DATA under the reason "keyed by scope, not by company row" —
    // a negative claim about a table that names both the company and the
    // person. The product rows go with the product (ERASE_BY_NAMED_KEY); these
    // go with the founder. The scope='global' row names nobody and stays, so
    // the institution's own daily ceiling is not reduced by an erasure.
    onAccountErasure: { op: 'delete', by: 'scope_id', where: "scope = 'founder'" },
  },
};

/** Tables that are the institution's or nobody's: reference data, global
 * counters, cross-company aggregates that name no company. Stated by name so
 * that a table landing here is a decision rather than an omission. */
const NOT_COMPANY_DATA: Record<string, string> = {
  // WHICH PRODUCT ROW *IS* FOUNDRY. A platform fact that happens to carry a
  // product_id, which is the only reason the by-product sweep ever picked it
  // up. Erasing a customer company never matches it; the one case it would
  // match is Foundry's own product being erased, which its immutability trigger
  // refuses and should. Naming it here says that on purpose rather than relying
  // on the delete finding no rows.
  system_identities: 'names which product row is Foundry itself, not a customer\'s data',
  agent_wiki_reads: 'which internal agent read which internal wiki entry',
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
  portfolios: 'an investor organisation, not a founder\'s company',
  portfolio_snapshots: 'that organisation\'s own aggregates',
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
function namedKeyPredicate(
  key: { column: string; where?: string; match?: 'exact' | 'prefix' },
): string {
  // `prefix` anchors at the start deliberately. A bare LIKE '%id%' would let a
  // company whose id is a substring of another's delete rows that are not
  // theirs, which is a worse defect than the one it fixes.
  const subject = key.match === 'prefix'
    ? `${key.column} LIKE ? || '_%'`
    : `${key.column} = ?`;
  return key.where ? `${subject} AND ${key.where}` : subject;
}

export async function erasurePlan(): Promise<ErasureStep[]> {
  const steps: ErasureStep[] = [];

  for (const table of await tablesToErase()) {
    steps.push({ table, sql: `DELETE FROM ${table} WHERE product_id = ?`, depth: 0 });
  }
  for (const [table, key] of Object.entries(ERASE_BY_NAMED_KEY)) {
    steps.push({ table, sql: `DELETE FROM ${table} WHERE ${namedKeyPredicate(key)}`, depth: 0 });
  }

  // A child is deleted through its parent's own predicate, nested as deep as
  // the descent goes. The parent rows still exist at this point precisely
  // because children run first.
  const predicates = new Map<string, string>();
  for (const t of await tablesToErase()) predicates.set(t, 'product_id = ?');
  for (const [t, k] of Object.entries(ERASE_BY_NAMED_KEY)) predicates.set(t, namedKeyPredicate(k));

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
/** Exported so the end-to-end sweep can derive which survivors are stated,
 *  rather than keeping a second list of them that could drift. */
export const RETAINED_ON_ERASURE_DISPOSITIONS = RETAINED_ON_ERASURE;

export const FOUNDER_SCOPED_REASONS: Record<string, string> = Object.fromEntries(
  Object.entries(FOUNDER_SCOPED).map(([t, d]) => [t, d.reason]));

/** Exported so a test can prove every founder-scoped table has an op, and that
 *  the op that runs is the op that was written down. */
export const FOUNDER_SCOPED_DISPOSITIONS = FOUNDER_SCOPED;

/**
 * Erase a founder's ACCOUNT — every company they own, then the person.
 *
 * THE ONLY PLACE THAT TRIED THIS DID IT BY HAND. The Clerk `user.deleted`
 * webhook ran `DELETE FROM products WHERE id = ?` for each company and then
 * `DELETE FROM founders`. Two things were wrong with that, and the first one
 * meant the second never got a chance:
 *
 *   • it raises. Seven foreign keys into products' descendants are ON DELETE
 *     NO ACTION and this database runs with foreign_keys=ON, so deleting a
 *     company that has ever had a chat message fails outright. Account
 *     deletion via the identity provider has never completed for a real
 *     company, and left no record of having been attempted.
 *
 *   • it bypassed everything erasure knows. No ordering, no retention
 *     dispositions, no completion record — it would have deleted the evidence
 *     that the erasure happened, the financial records that must survive it,
 *     and the idempotency keys that stop a retry re-sending a real message.
 *
 * So it goes through the same door as every other erasure, and the founder row
 * is REDACTED rather than deleted, for the same reason the product row is:
 * retained financial records reference it, and an id that can be reissued is
 * worse than one that resolves to a cleared row. What leaves is the person —
 * their email, their name, the identity-provider handle, the billing customer
 * id. What stays is a shell that keeps foreign keys resolvable and says
 * nothing about anybody.
 */
export async function eraseFounderAccount(founderId: string): Promise<{
  productsErased: string[];
  failed: Array<{ productId: string; error: string }>;
  founderRedacted: boolean;
}> {
  const owned = await query('SELECT id FROM products WHERE owner_id = ?', [founderId]);
  const productIds = (owned.rows as unknown as Array<Record<string, unknown>>)
    .map((r) => String(r.id));

  const productsErased: string[] = [];
  const failed: Array<{ productId: string; error: string }> = [];
  for (const productId of productIds) {
    try {
      // MARK IT BEFORE TOUCHING IT, IN BOTH RECORDS. The scheduled path sets
      // this thirty days earlier; the immediate path — an account deletion, the
      // identity provider's webhook — used to set nothing, so an append-only
      // ledger had no way to tell a genuine erasure from an attempt to rewrite
      // history and refused both. It is also what stops the company acting
      // while this runs, which is the truth about it either way.
      //
      // AND THE LEDGER ROW, WHICH THIS PATH DID NOT WRITE. Two records of one
      // fact are tolerated here — hot paths read the column, the trail keeps
      // the events — on the condition that they never disagree, and this was
      // the path where they did. `pendingDeletion` reads the ledger and found
      // nothing, so `cancelDataDeletion` refused, while the COLUMN went on
      // pausing the company. If `eraseOneProduct` then threw for one product,
      // that company was frozen with no door: not operating, and the only
      // cancel returning `nothing_pending` forever. Recording the intent first
      // means the ordinary cancel works on the ordinary state.
      if ((await pendingDeletion(productId)) === null) {
        await scheduleDataDeletion(productId, 0, founderId);
      }
      await query(
        `UPDATE products SET erasure_scheduled_at = COALESCE(erasure_scheduled_at, datetime('now'))
          WHERE id = ?`, [productId]);
      // `eraseOneProduct` writes the completion record itself, so an
      // account erasure leaves the same audit trail as any other.
      await eraseOneProduct(productId);
      productsErased.push(productId);
    } catch (err) {
      failed.push({ productId, error: (err as Error).message });
      await recordErasureFailure(productId, err as Error);
    }
  }

  // The person only goes once their companies have. A founder row cleared
  // while a company still names them is a company with no reachable owner.
  if (failed.length > 0) return { productsErased, failed, founderRedacted: false };

  // THE PERSON'S OWN TABLES, WHICH NOTHING USED TO TOUCH.
  //
  // Every company is gone at this point, and this is the step that was simply
  // missing: `FOUNDER_SCOPED` said these survive erasing a company, which is
  // true, and that was read as though it also said what happens when the
  // person goes. Nothing happened when the person went. Each entry now names
  // its own op and this runs it.
  //
  // It runs BEFORE the founders row is cleared, so a failure here leaves an
  // account that still resolves and can be retried, rather than a redacted
  // shell with the person's health history still hanging off it.
  await runFounderScopedErasure(founderId);

  // AND THE COMPANIES THEY DO NOT OWN. Everything above is scoped to products
  // this founder owns; a member of somebody else's company leaves their id,
  // their email and their words behind in it.
  await erasePersonAcrossCompanies(founderId);

  await query(
    // DRIVEN BY THE STATED FIELD LIST, not by a hand-written column list that
    // drifts from it. `email` and `clerk_user_id` are markers rather than
    // NULLs — both are unique, and a row of NULLs collides with the next
    // erased account. Everything else in `clears` goes to NULL.
    `UPDATE founders SET
       email = 'erased+' || id || '@invalid',
       -- The identity-provider handle is how this person could be recognised
       -- again. It is the one field that must not survive.
       clerk_user_id = 'erased:' || id,
       ${founderRedactionSql()}
     WHERE id = ?`, [founderId]);
  return { productsErased, failed, founderRedacted: true };
}

/**
 * ERASING A PERSON IN COMPANIES THEY DO NOT OWN.
 *
 * `eraseFounderAccount` starts from `SELECT id FROM products WHERE owner_id = ?`
 * and everything after that is scoped to those companies. Team membership is
 * not vestigial — `getVisibleProducts` unions owned products with
 * `team_members`, so a member works inside a company somebody else owns, and
 * everything they do there carries their founder id.
 *
 * So an account erasure left the person's id, their email, their written words
 * and their conversations sitting in other people's companies. The end-to-end
 * sweep could not see it: every row it seeds belongs to a product the erased
 * founder owns, which is the one case the by-product plan already handles.
 *
 * Forty tables carry an actor-shaped column beside a `product_id`. They fall
 * into three kinds, and only two of them can be settled here:
 *
 *   DELETE  the row is wholly the person's own activity inside that company —
 *           their conversations, their journal, their notifications, their
 *           consents. The company authored none of it and loses nothing.
 *   SEVER   the row is the COMPANY'S record that happens to name a person —
 *           its audit trail, its decisions, who invited whom. The record stays
 *           and stops naming them. Only possible where the column is nullable.
 *   OWNER   the row is a company asset the company still depends on, on a NOT
 *           NULL column: an API key, an MCP grant, a webhook the departing
 *           member configured. Deleting it takes a working capability away
 *           from a company that did nothing wrong; keeping it keeps the
 *           person. That is a product decision, not an engineering one, and it
 *           is queued rather than guessed.
 */
type PersonInOthersCompany =
  | { op: 'delete'; columns: string[]; reason: string; byEmail?: string[] }
  | { op: 'sever'; columns: string[]; reason: string }
  | { op: 'owner_decision'; columns: string[]; reason: string };

const PERSON_ACROSS_COMPANIES: Record<string, PersonInOthersCompany> = {
  // ── theirs, wholly ────────────────────────────────────────────────────────
  chat_sessions: { op: 'delete', columns: ['founder_id'], reason: 'conversations they had inside this company' },
  conversation_threads: { op: 'delete', columns: ['founder_id'], reason: 'threads they opened inside this company' },
  founder_journal_entries: { op: 'delete', columns: ['founder_id'], reason: 'their own journal entries' },
  founder_feedback: { op: 'delete', columns: ['founder_id'], reason: 'feedback they wrote themselves' },
  founder_psychology_insights: { op: 'delete', columns: ['founder_id'], reason: 'inferences about them' },
  voice_memos: { op: 'delete', columns: ['founder_id'], reason: 'voice recordings of the person' },
  voice_sessions: { op: 'delete', columns: ['founder_id'], reason: 'voice sessions the person held' },
  notifications: { op: 'delete', columns: ['founder_id'], reason: 'messages addressed to them' },
  notification_preferences: { op: 'delete', columns: ['founder_id'], reason: 'how they wanted to be reached' },
  push_log: { op: 'delete', columns: ['founder_id'], reason: 'what was pushed to their devices' },
  onboarding_checklist: { op: 'delete', columns: ['founder_id'], reason: 'their own onboarding progress' },
  onboarding_sessions: { op: 'delete', columns: ['founder_id'], reason: 'their own onboarding progress' },
  onboarding_tour: { op: 'delete', columns: ['founder_id'], reason: 'their own onboarding progress' },
  saved_insights: { op: 'delete', columns: ['founder_id'], reason: 'insights this person bookmarked' },
  operator_attention: { op: 'delete', columns: ['founder_id'], reason: 'what was competing for their attention' },
  rejection_streaks: { op: 'delete', columns: ['founder_id'], reason: 'a behavioural counter about them' },
  cofounder_dna_responses: { op: 'delete', columns: ['founder_id'], reason: 'their own questionnaire answers' },
  cofounder_profiles: { op: 'delete', columns: ['founder_id'], reason: 'their own co-founder profile' },
  privacy_consents: { op: 'delete', columns: ['founder_id'], reason: 'consents that can no longer be given or withdrawn' },
  autonomy_consents: { op: 'delete', columns: ['founder_id'], reason: 'authority they granted, which must not outlive them' },
  oauth_states: { op: 'delete', columns: ['founder_id'], reason: 'in-flight authorisation for a person who is gone' },
  briefing_shares: { op: 'delete', columns: ['founder_id'], reason: 'share links this person created' },
  briefing_decision_links: { op: 'delete', columns: ['founder_id'], reason: 'what they read before deciding' },
  portfolio_memberships: { op: 'delete', columns: ['founder_id'], reason: 'their own portfolio membership' },
  team_members: { op: 'delete', columns: ['founder_id'], reason: 'their access to a live company, which must not survive them' },
  execution_queue: { op: 'delete', columns: ['founder_id'], reason: 'work queued for them personally' },
  funnel_events: { op: 'delete', columns: ['founder_id'], reason: 'product analytics about this person' },
  milestone_events: { op: 'delete', columns: ['founder_id'], reason: 'milestones recorded against the person' },
  runway_models: { op: 'delete', columns: ['founder_id'], reason: 'runway models this person built' },

  // ── the company's, naming a person ────────────────────────────────────────
  agent_audit_log: { op: 'sever', columns: ['actor_id'], reason: 'the company\'s audit trail; the entry stays and stops naming them' },
  integration_events: { op: 'sever', columns: ['actor_id'], reason: 'the company\'s integration history' },
  decisions: { op: 'sever', columns: ['decided_by_founder_id'], reason: 'the company\'s decision; that it was made is the company\'s record' },
  lifecycle_rules: { op: 'sever', columns: ['created_by'], reason: 'a rule the company still runs on' },
  ai_spend_reservations: { op: 'sever', columns: ['founder_id'], reason: 'accounting that does not need to say whose it was' },
  team_invitations: {
    op: 'delete',
    columns: ['invited_by'],
    // THE PERSON IS NAMED HERE BY ADDRESS, NOT BY ID. An invitation identifies
    // its recipient by `email` — they may not even have had an account when it
    // was sent — so matching on founder ids alone leaves their email address
    // sitting verbatim in a company they never joined or have since left.
    byEmail: ['email'],
    reason: 'carries a person\'s email verbatim; a spent invitation is nobody\'s asset',
  },

  // ── genuinely the owner's call ────────────────────────────────────────────
  api_keys: { op: 'owner_decision', columns: ['founder_id', 'created_by'], reason: 'a credential the company may be running on' },
  mcp_grants: { op: 'owner_decision', columns: ['created_by'], reason: 'an authority grant the company may depend on' },
  webhooks: { op: 'owner_decision', columns: ['founder_id', 'created_by'], reason: 'an integration the company may depend on' },
  deal_rooms: { op: 'owner_decision', columns: ['created_by'], reason: 'a shared artefact other people are using' },
  decision_votes: { op: 'owner_decision', columns: ['founder_id'], reason: 'part of the company\'s decision record, on a NOT NULL column, with the person\'s own words in it' },
};

/** Exported so a test can prove the map is TOTAL against the live schema. */
export const PERSON_ACROSS_COMPANIES_DISPOSITIONS = PERSON_ACROSS_COMPANIES;

/**
 * Run those dispositions for every company — including the ones this founder
 * does not own, which is the whole point.
 */
async function erasePersonAcrossCompanies(founderId: string): Promise<void> {
  // Their address, read before the founders row is redacted — after that it is
  // `erased+<id>@invalid` and matches nothing.
  const who = (await query('SELECT email FROM founders WHERE id = ?', [founderId]))
    .rows[0] as Record<string, unknown> | undefined;
  const email = who?.email == null ? null : String(who.email);

  for (const [table, d] of Object.entries(PERSON_ACROSS_COMPANIES)) {
    if (d.op === 'owner_decision') continue;          // queued, not guessed
    for (const column of d.columns) {
      if (d.op === 'sever') {
        await query(`UPDATE ${table} SET ${column} = NULL WHERE ${column} = ?`, [founderId]);
        continue;
      }
      // CHILDREN FIRST, for the same reason the by-product plan orders itself:
      // foreign keys are ON, and deleting a chat session whose messages still
      // reference it raises — which would abort the erasure rather than leave
      // a little behind. Descending here rather than hand-listing the children
      // means a table added later is carried without anyone remembering to.
      for (const child of await childrenOf(table)) {
        await query(
          `DELETE FROM ${child.table} WHERE ${child.column} IN`
          + ` (SELECT ${child.parentColumn} FROM ${table} WHERE ${column} = ?)`,
          [founderId]);
      }
      await query(`DELETE FROM ${table} WHERE ${column} = ?`, [founderId]);
    }
    if (d.op === 'delete' && d.byEmail && email !== null) {
      for (const column of d.byEmail) {
        await query(`DELETE FROM ${table} WHERE ${column} = ?`, [email]);
      }
    }
  }
}

/** Tables with a foreign key into `parent`, so they can be cleared first. */
async function childrenOf(
  parent: string,
): Promise<Array<{ table: string; column: string; parentColumn: string }>> {
  const all = (await query(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`, []))
    .rows as unknown as Array<Record<string, unknown>>;
  const out: Array<{ table: string; column: string; parentColumn: string }> = [];
  for (const row of all) {
    const table = String(row.name);
    if (table === parent) continue;
    const fks = (await query(
      `SELECT "table" AS p, "from" AS col, "to" AS pcol FROM pragma_foreign_key_list(?)`,
      [table])).rows as unknown as Array<Record<string, unknown>>;
    for (const fk of fks) {
      if (String(fk.p) !== parent) continue;
      out.push({
        table,
        column: String(fk.col),
        // A foreign key with no explicit target references the parent's key.
        parentColumn: fk.pcol == null ? 'id' : String(fk.pcol),
      });
    }
  }
  return out;
}

/** The `founders` clears, as SQL, minus the two that carry unique markers
 *  rather than NULL. Derived from the disposition so the two cannot drift. */
function founderRedactionSql(): string {
  const d = FOUNDER_SCOPED.founders.onAccountErasure;
  if (d.op !== 'redact') throw new Error('founders must be redacted, not deleted');
  return [
    ...d.clears
      .filter((c) => c !== 'email' && c !== 'clerk_user_id')
      .map((c) => `${c} = NULL`),
    ...Object.entries(d.resets).map(([c, v]) => `${c} = ${v}`),
  ].join(',\n       ');
}

/**
 * Run each founder-scoped table's stated account-erasure op.
 *
 * Severs run before deletes: a sever touches rows on somebody else's parent
 * row, and doing it first means a cascade cannot take a second person's record
 * with it on the way past.
 */
async function runFounderScopedErasure(founderId: string): Promise<void> {
  const entries = Object.entries(FOUNDER_SCOPED);
  const order = (op: AccountErasure) => (op.op === 'sever' ? 0 : 1);
  for (const [table, disposition] of entries
    .sort((a, b) => order(a[1].onAccountErasure) - order(b[1].onAccountErasure))) {
    const op = disposition.onAccountErasure;
    // The founders row is redacted by the caller, which is the only op here
    // that must leave a row behind.
    if (op.op === 'redact') continue;

    if (op.op === 'sever') {
      for (const party of op.parties) {
        const sets = [`${party.column} = ${op.marker === null ? 'NULL' : '?'}`,
          ...(party.alsoClear ?? []).map((c) => `${c} = NULL`)];
        const args = op.marker === null ? [founderId] : [op.marker, founderId];
        await query(
          `UPDATE ${table} SET ${sets.join(', ')} WHERE ${party.column} = ?`, args);
      }
      continue;
    }

    const column = op.by ?? 'founder_id';
    // `suffix` is for a composite key whose LAST component is the founder —
    // `audit:founder:<id>`. Anchored at the end for the same reason the
    // by-product prefix match is anchored at the start: an unanchored match
    // would let one person's erasure delete another's rows.
    const subject = op.match === 'suffix' ? `${column} LIKE '%:' || ?` : `${column} = ?`;
    const where = op.where ? `${subject} AND ${op.where}` : subject;
    await query(`DELETE FROM ${table} WHERE ${where}`, [founderId]);
  }
}
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
  deleteAfterDays: number,
  requestedBy?: string,
): Promise<void> {
  await query(
    `INSERT INTO agent_audit_log
       (id, product_id, event_type, actor_type, actor_id, target_type, target_id,
        description, metadata_json, created_at)
     VALUES (?, ?, 'data_deletion_scheduled', ?, ?, 'product', ?,
             ?, ?, datetime('now'))`,
    [
      nanoid(),
      productId,
      // A person asked for this, and until now the record said 'system'. The
      // erasure trail is the one place where "who asked" is the whole point.
      requestedBy ? 'founder' : 'system',
      requestedBy ?? 'system',
      productId,
      `Data deletion scheduled. Product data will be deleted after ${deleteAfterDays} days.`,
      JSON.stringify({ delete_after_days: deleteAfterDays, scheduled_at: new Date().toISOString() }),
    ]
  );
  // A company on its way out stops acting: no outward effects, no spend, no
  // autonomous work. `operatingProduct()` and the kill switch both read this,
  // so the pause lands everywhere at once rather than in the dozen selectors
  // that would otherwise each have to remember. The event log stays the record
  // of what was asked for; this column is what the hot paths read.
  await query(
    `UPDATE products SET erasure_scheduled_at = datetime('now') WHERE id = ?`, [productId]);
}

/** What is pending for this company, or null. The privacy page had no way to
 *  show it: a founder who clicked Delete saw a banner once and then nothing,
 *  for thirty days, with no sign anything was coming. */
export async function pendingDeletion(productId: string): Promise<{
  scheduledAt: string; deleteAfterDays: number; deletesOn: string; requestedBy: string | null;
} | null> {
  const res = await query(
    `SELECT metadata_json, actor_id, actor_type, created_at FROM agent_audit_log
      WHERE event_type = 'data_deletion_scheduled' AND target_id = ?
      ORDER BY created_at DESC LIMIT 1`, [productId]);
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  const cancelled = await query(
    `SELECT 1 FROM agent_audit_log
      WHERE event_type = 'data_deletion_cancelled' AND target_id = ?
        AND created_at >= ? LIMIT 1`, [productId, String(row.created_at)]);
  if (cancelled.rows.length > 0) return null;

  const done = await query(
    `SELECT 1 FROM agent_audit_log
      WHERE event_type = 'data_deletion_completed' AND target_id = ? LIMIT 1`, [productId]);
  if (done.rows.length > 0) return null;

  const metadata = JSON.parse(String(row.metadata_json ?? '{}')) as Record<string, unknown>;
  const scheduledAt = String(metadata.scheduled_at ?? row.created_at);
  const days = Number(metadata.delete_after_days ?? 30);
  return {
    scheduledAt,
    deleteAfterDays: days,
    deletesOn: new Date(new Date(scheduledAt).getTime() + days * 86_400_000).toISOString(),
    requestedBy: row.actor_type === 'founder' ? String(row.actor_id) : null,
  };
}

/**
 * Change your mind, within the window the product promises you.
 *
 * THE WINDOW EXISTED AND HAD NO DOOR. The page says "data will be removed after
 * 30 days", which is a promise that those thirty days mean something — and
 * there was no way to use them. A founder who clicked by accident, or whose
 * co-founder clicked, could do nothing but watch, and nothing on the page even
 * told them it was coming. A grace period nobody can act in is a countdown.
 *
 * Recorded as an event rather than by deleting the schedule row: the request
 * happened, and an erasure trail that erases its own history is not a trail.
 */
export async function cancelDataDeletion(
  productId: string, cancelledBy: string,
): Promise<boolean> {
  if (!(await pendingDeletion(productId))) return false;
  await query(
    `INSERT INTO agent_audit_log
       (id, product_id, event_type, actor_type, actor_id, target_type, target_id,
        description, metadata_json, created_at)
     VALUES (?, ?, 'data_deletion_cancelled', 'founder', ?, 'product', ?,
             'Scheduled data deletion cancelled.', '{}', datetime('now'))`,
    [nanoid(), productId, cancelledBy, productId]);
  // Cancelling restores everything. It does not reach the founder's OWN pause
  // or an unpaid subscription — those are different axes and each is cleared
  // by whatever set it.
  await query(
    `UPDATE products SET erasure_scheduled_at = NULL WHERE id = ?`, [productId]);
  return true;
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
  //
  // NOT EXISTS rather than NOT IN, which sidesteps that trap by construction
  // instead of by remembering to guard it — and it has to be a correlated test
  // now anyway, because a cancellation only annuls the schedule it FOLLOWS. A
  // founder who cancels and later schedules again means it, and a blanket
  // "has ever cancelled" exclusion would ignore the second request forever.
  const pending = await query(
    `SELECT s.target_id AS product_id, s.metadata_json, s.created_at
       FROM agent_audit_log s
      WHERE s.event_type = 'data_deletion_scheduled'
        AND s.target_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM agent_audit_log d
           WHERE d.event_type = 'data_deletion_completed' AND d.target_id = s.target_id)
        AND NOT EXISTS (
          SELECT 1 FROM agent_audit_log x
           WHERE x.event_type = 'data_deletion_cancelled' AND x.target_id = s.target_id
             AND x.created_at >= s.created_at)
      ORDER BY s.created_at DESC`,
    []
  );

  const result: ErasureRunOutcome = { completed: 0, failed: [] };

  // One company, one live request: the rows are newest-first, so the first one
  // seen for a product is the request that stands.
  const seen = new Set<string>();
  for (const row of pending.rows) {
    const r = row as Record<string, unknown>;
    const productId = r.product_id as string;
    if (seen.has(productId)) continue;
    seen.add(productId);
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
