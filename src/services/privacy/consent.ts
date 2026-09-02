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

/**
 * A CONSENT THAT NOTHING READS IS NOT A CONTROL.
 *
 * Four of these five once governed nothing: a founder could switch off
 * benchmark contribution and keep contributing, switch off cross-company
 * patterns and keep supplying them, switch off aggregate insights and keep
 * receiving them. Each was found separately, which is why the rule is stated
 * here rather than in any one of them.
 *
 * Every consent type is either CONSULTED — some production path calls
 * `hasConsent` with it and behaves differently — or listed below as a recorded
 * preference with a reason. The list is short on purpose and the test
 * `a-privacy-toggle-that-governs-nothing` holds it against the vocabulary, so
 * a new toggle cannot be added to the privacy page without one or the other.
 *
 * IT IS DOWN TO ONE. `product_improvement` sat here while the owner's §14
 * decision was pending; it now gates the telemetry half of the funnel, and
 * nothing is recorded at all without it.
 */
export const RECORDED_PREFERENCE_ONLY: Partial<Record<ConsentType, string>> = {
  // There is no training pipeline. Nothing in this repository trains a model on
  // anything, so there is no path to gate — the toggle is what the privacy page
  // says it is: a formal, auditable record of the founder's preference, kept so
  // that if a training path is ever proposed it meets an existing answer.
  ai_training_opt_out:
    'no training path exists to gate; the row is the auditable preference itself',
};

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
  /** INERT. Stored, defaulted, selected and upserted here — and read by
   *  nothing, offered by nothing. No page sets it and no path anonymises on it.
   *  Left in place rather than deleted because dropping a column is a migration
   *  and the row is harmless; named here so nobody wires a toggle to it
   *  believing it already means something. Making it mean something is a
   *  decision about customer data, not a UI change. */
  anonymize_customer_data: boolean;
  /** INERT, same shape: the data export does not consult it. */
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
  // Everything keyed on `product_id`, including the tables an ERASURE keeps:
  // data retained on a stated basis is still the company's while it exists, and
  // an access request is about what is held, not about what would survive.
  const byProductId = (await tablesWithProductId())
    .filter((t) => !(t in EXCLUDED_FROM_EXPORT))
    .map((table) => ({ table, predicate: 'product_id = ?', subject: 'product_id' as const }));

  // AND THE TABLES THAT DO NOT SAY WHOSE THEY ARE. This is the half the export
  // could not see: the children hanging off erased parents, and the tables
  // naming their subject as a contributor hash, a scope id, or the first
  // component of a composite key. The erasure had to go and find them, and its
  // section header explains why they are company data. Answering an access
  // request without them contradicts that finding.
  const byOtherKey = (await companyDataSources())
    .filter((s) => s.predicate !== 'product_id = ?')
    .filter((s) => !(s.table in EXCLUDED_FROM_EXPORT))
    .map((s) => ({ table: s.table, predicate: s.predicate, subject: s.subject }));

  const contributor = (await import('../wisdom/network.js')).contributorHash(productId);

  const out: Record<string, unknown[]> = {};
  for (const source of [...byProductId, ...byOtherKey]) {
    const table = source.table;
    try {
      const res = await query(
        `SELECT * FROM ${table} WHERE ${source.predicate}`,
        [source.subject === 'contributor_hash' ? contributor : productId]);
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
  // Product-improvement telemetry, recorded only with consent and keyed by
  // contributor hash so the table names nobody. Erased by the same route
  // `decision_patterns` is: a pseudonym is not anonymity, and an account that
  // goes must take its linkage with it rather than leaving rows nobody can
  // find. Added with migration 176, in the same commit that created the table —
  // a table that can be written before the erasure knows about it is how
  // `network_contributions` came to survive erasures for months.
  product_telemetry_events: { column: 'contributor_hash', subject: 'contributor_hash' },
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
  // A SEARCH FOR A BUSINESS BELONGS TO THE PERSON, NOT TO A COMPANY — that is
  // the whole point of it: there is no company yet, and there may never be one.
  // So it is founder-scoped rather than product-scoped, and the two tables
  // hanging off it go the same way. Their `by` names the route back to the
  // person, because neither carries a founder id of its own.
  venture_mandates: {
    reason: 'a search for a business, which belongs to the person who asked for it',
    onAccountErasure: { op: 'delete' },
  },
  venture_guidance: {
    reason: 'what the founder said while a search was running, in their own words',
    onAccountErasure: { op: 'delete' },
  },
  venture_opportunities: {
    reason: 'candidates found for one person\'s search, including what was rejected',
    onAccountErasure: { op: 'delete' },
  },
  // HOW HIS BUSINESSES MAKE MONEY IS A FACT ABOUT HIM. It describes companies
  // and candidates alike, so it cannot be reached by walking products — which
  // is exactly why the table carries a founder id of its own.
  portfolio_exposures: {
    reason: 'how one person\'s companies and candidates make money, and what they '
      + 'therefore share',
    onAccountErasure: { op: 'delete' },
  },
  // WHAT WAS LEARNED WHILE LOOKING FOR A BUSINESS FOR THIS PERSON. Claims and
  // the observations under them go together: an observation surviving its claim
  // would be a dated note about a market, still attached to the person who
  // asked. Deleted rather than kept as anonymous market knowledge, because
  // "anonymous" here would mean "knowledge somebody once paid attention to for
  // a reason nobody records", which is not anonymity.
  market_claims: {
    reason: 'claims about the world formed while searching for one person\'s business',
    onAccountErasure: { op: 'delete' },
  },
  market_observations: {
    reason: 'what was seen, where and when, in the course of one person\'s search',
    onAccountErasure: { op: 'delete' },
  },
  market_unknowns: {
    reason: 'the open questions on one person\'s candidates',
    onAccountErasure: { op: 'delete' },
  },
  // WHAT WAS TRIED, WHAT WAS PREDICTED, AND WHETHER IT WAS A SURPRISE. Kept
  // with the person because there is no company here — that is the point of the
  // stage — and deleted rather than kept as anonymous learning, because a
  // prediction and its result are a record of somebody's judgement.
  venture_experiments: {
    reason: 'tests designed against one person\'s candidates, with what was '
      + 'predicted before each one ran',
    onAccountErasure: { op: 'delete' },
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
  ecosystem_principals: {
    reason: 'a portfolio credential this person issued over companies they own',
    // AUTHORITY, BY THE RULE JUST SETTLED IN §10. A principal issued by somebody
    // who no longer exists must not keep reading their portfolio, and there is
    // nobody to transfer it to — the companies it was scoped to are being erased
    // in the same pass, since it may only ever name companies its issuer owns.
    // `ecosystem_principal_companies` cascades on this delete.
    //
    // Found by the erasure classification gate rather than by remembering: a
    // table added without a disposition is one the erasure steps around in
    // silence, which is how `network_contributions` survived erasures for
    // months.
    onAccountErasure: { op: 'delete', by: 'created_by' },
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
  benchmark_percentiles: 'percentiles over a cohort, naming no member',
  cohort_groups: 'the groups themselves, not who is in them',
  cohort_patterns: 'patterns across a cohort, naming no member',
  cross_product_insights: 'aggregate claims that name no contributor; the rows behind them are erased via decision_patterns',
  failure_patterns: 'a library of known failure shapes, written by the institution',
  governed_effect_kinds: 'the effect vocabulary',
  owner_boundary_subjects: 'the vocabulary of things a boundary can be about, constitutional and the same for every owner; the boundaries themselves are erased with their company',
  senses: 'the vocabulary of what Foundry can learn about any company and what that never grants; constitutional and the same for every owner',
  exposure_dimensions: 'the axes a portfolio can be concentrated on and what each failure would cost; constitutional and the same for every owner, naming no company',
  market_source_types: 'the kinds of source market evidence can come from and whether each is self-reported, observed or solicited; constitutional, naming nobody',
  sense_providers: 'which provider could supply which sense, and what the credential hands over; constitutional, naming no company',
  sense_provider_scopes: 'the exact minimum scopes each provider may be asked for, constitutional and the same for every owner; the credentials themselves are erased with their company',
  job_health: 'whether Foundry\'s own scheduled work is running; job names and error class names, no company in it',
  intelligence_benchmarks: 'benchmarks over a cohort, naming no member',
  job_locks: 'scheduler leases',
  leading_indicators: 'indicator definitions per sector',
  network_benchmarks: 'benchmark aggregates, naming no contributor',
  portfolios: 'an investor organisation, not a founder\'s company',
  portfolio_snapshots: 'that organisation\'s own aggregates',
  schema_migrations: 'which migrations have run',
  support_channel_feeds: 'the closed list of providers an adapter exists for',
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

/** Where a company's rows live and how to select them. */
export interface CompanyDataSource {
  table: string;
  /** A WHERE clause with one placeholder, bound to `subject`. */
  predicate: string;
  /** Which value the placeholder takes: the product id, or the contributor
   *  hash for the one table that names its subject that way. */
  subject: 'product_id' | 'contributor_hash';
  /** How far down the parent chain this table sits. Deletes go deepest-first. */
  depth: number;
}

/**
 * EVERY PLACE A COMPANY'S DATA SITS, DERIVED ONCE.
 *
 * This was inside `erasurePlan`, which meant the export could not see it. The
 * export swept `tablesWithProductId()` and nothing else, so an access request
 * was answered without the fifty-five tables that do not carry the column —
 * the eleven children hanging off erased parents, and the ones naming their
 * subject as `contributor_hash`, `scope_id` or a composite id prefix. Those
 * are the exact tables the erasure had to go and find, and the comment above
 * this section explains at length why they are company data.
 *
 * "This is yours and goes when you go" and "this is not yours to receive" are
 * the same claim read two ways. One derivation, two consumers.
 */
export async function companyDataSources(): Promise<CompanyDataSource[]> {
  const sources: CompanyDataSource[] = [];

  for (const table of await tablesToErase()) {
    sources.push({ table, predicate: 'product_id = ?', subject: 'product_id', depth: 0 });
  }
  for (const [table, key] of Object.entries(ERASE_BY_NAMED_KEY)) {
    sources.push({ table, predicate: namedKeyPredicate(key), subject: key.subject, depth: 0 });
  }

  // A child is reached through its parent's own predicate, nested as deep as
  // the descent goes. For a delete the parent rows still exist at that point
  // precisely because children run first.
  const predicates = new Map(sources.map((s) => [s.table, s.predicate]));
  const subjects = new Map(sources.map((s) => [s.table, s.subject]));
  const depthOf = new Map<string, number>();
  for (const c of await childTablesOfErasure()) {
    const parentPredicate = predicates.get(c.parent);
    if (!parentPredicate) continue;                       // parent is retained, not erased
    const predicate =
      `${c.column} IN (SELECT ${c.parentColumn} FROM ${c.parent} WHERE ${parentPredicate})`;
    predicates.set(c.table, predicate);
    const depth = (depthOf.get(c.parent) ?? 0) + 1;
    depthOf.set(c.table, depth);
    sources.push({
      table: c.table, predicate, depth,
      subject: subjects.get(c.parent) ?? 'product_id',
    });
  }

  return sources;
}

export async function erasurePlan(): Promise<ErasureStep[]> {
  return (await companyDataSources())
    .map((s) => ({ table: s.table, sql: `DELETE FROM ${s.table} WHERE ${s.predicate}`, depth: s.depth }))
    .sort((a, b) => b.depth - a.depth);
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
  /**
   * AUTHORITY HELD BY A PRINCIPAL THAT NO LONGER EXISTS.
   *
   * Revoked, never transferred. The owner's §10 decision is that authority and
   * artefact are different things: a credential or a grant must stop acting,
   * and handing it to the company owner would be inventing a grant nobody
   * made. `revokedColumn` is set if the row has one, then the row goes.
   *
   * NOT SILENT. Deleting a working credential takes a capability away from a
   * company that did nothing wrong, and the cost of that choice was named when
   * it was made. Each revocation writes a record into the company's own audit
   * trail, so the founder can see what stopped and why.
   */
  | { op: 'revoke'; columns: string[]; reason: string; revokedColumn?: string };

const PERSON_ACROSS_COMPANIES: Record<string, PersonInOthersCompany> = {
  // ── theirs, wholly ────────────────────────────────────────────────────────
  chat_sessions: { op: 'delete', columns: ['founder_id'], reason: 'conversations they had inside this company' },
  conversation_threads: { op: 'delete', columns: ['founder_id'], reason: 'threads they opened inside this company' },
  founder_journal_entries: { op: 'delete', columns: ['founder_id'], reason: 'their own journal entries' },
  founder_feedback: { op: 'delete', columns: ['founder_id'], reason: 'feedback they wrote themselves' },
  founder_psychology_insights: { op: 'delete', columns: ['founder_id'], reason: 'inferences about them' },
  voice_memos: { op: 'delete', columns: ['founder_id'], reason: 'voice recordings of the person' },
  voice_sessions: { op: 'delete', columns: ['founder_id'], reason: 'daily voice briefings prepared for the person' },
  voice_conversations: { op: 'delete', columns: ['founder_id'], reason: 'voice conversations the person held' },
  notifications: { op: 'delete', columns: ['founder_id'], reason: 'messages addressed to them' },
  // Same kind as `notifications`: something Foundry decided to tell this person
  // and how loudly. It is addressed to them and it goes with them.
  quieted_events: { op: 'delete', columns: ['founder_id'], reason: 'what Foundry chose not to interrupt them for' },
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
  sense_authorizations: { op: 'delete', columns: ['founder_id'], reason: 'a half-finished request to let Foundry see something, for a person who is gone' },
  venture_mandates: { op: 'delete', columns: ['founder_id'], reason: 'a search for a business, run on behalf of a person who is gone' },
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

  // ── AUTHORITY: revoked, never transferred (owner decision §10) ────────────
  api_keys: {
    op: 'revoke', revokedColumn: 'revoked_at', columns: ['founder_id', 'created_by'],
    reason: 'a credential issued to this person; it must not keep authenticating for them',
  },
  mcp_grants: {
    op: 'revoke', revokedColumn: 'revoked_at', columns: ['created_by'],
    reason: 'an authority this person granted; it must not keep acting on their say-so',
  },

  // ── ARTEFACT: preserved, and the author severed (owner decision §10) ──────
  //
  // Migration 175 made these three identity columns nullable, which is the
  // whole reason they sat undecided: not indecision, an absent column state.
  // NULL says NOBODY. Another founder's id would say somebody who did not do
  // it, and the owner's decision is explicit that authorship is not reassigned.
  webhooks: {
    op: 'sever', columns: ['founder_id', 'created_by'],
    reason: 'an integration the company may be delivering through; it keeps working and stops naming them',
  },
  deal_rooms: {
    op: 'sever', columns: ['created_by'],
    reason: 'a shared artefact other people are using; it stays open and stops naming them',
  },
  decision_votes: {
    op: 'sever', columns: ['founder_id'],
    // The free text stays: `rationale` and `concerns` are the reasoning behind
    // a company decision, and a decision record stripped of why is not a
    // truthful record. They are also the person's own words. That tension is
    // irreducible in engineering and is queued for counsel (§9) rather than
    // resolved by deleting on a guess or keeping without one.
    reason: 'a vote genuinely cast; the record stays truthful and stops naming who cast it',
  },
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
    for (const column of d.columns) {
      if (d.op === 'sever') {
        await query(`UPDATE ${table} SET ${column} = NULL WHERE ${column} = ?`, [founderId]);
        continue;
      }
      if (d.op === 'revoke') {
        // REVOKE, THEN REMOVE, AND SAY SO WHERE THE COMPANY READS IT.
        //
        // Setting the revocation column first means that if anything below
        // fails, what is left behind is a DEAD credential rather than a live
        // one — the safe direction for a partial erasure. The record is written
        // before the row goes, because after it there is nothing to describe.
        await recordCredentialRevocation(table, column, founderId, d.reason);
        if (d.revokedColumn) {
          await query(
            `UPDATE ${table} SET ${d.revokedColumn} = datetime('now')
              WHERE ${column} = ? AND ${d.revokedColumn} IS NULL`, [founderId]);
        }
        for (const child of await childrenOf(table)) {
          await query(
            `DELETE FROM ${child.table} WHERE ${child.column} IN`
            + ` (SELECT ${child.parentColumn} FROM ${table} WHERE ${column} = ?)`,
            [founderId]);
        }
        await query(`DELETE FROM ${table} WHERE ${column} = ?`, [founderId]);
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

/**
 * Tell the company that a credential stopped working, and why.
 *
 * The cost of revoking rather than transferring was named when the decision was
 * made: a webhook stops delivering, an API key stops authenticating, and the
 * company did nothing wrong. What makes that acceptable rather than careless is
 * that it is VISIBLE. A capability disappearing with no explanation is the
 * silent-breakage failure this campaign keeps finding; the founder's audit page
 * reads `agent_audit_log`, so this lands where they will see it.
 *
 * It names no person. That would defeat the erasure that caused it.
 */
async function recordCredentialRevocation(
  table: string, column: string, founderId: string, reason: string,
): Promise<void> {
  const affected = (await query(
    `SELECT product_id, COUNT(*) AS n FROM ${table}
      WHERE ${column} = ? AND product_id IS NOT NULL GROUP BY product_id`,
    [founderId])).rows as unknown as Array<Record<string, unknown>>;

  const { logAudit } = await import('../audit/log.js');
  for (const row of affected) {
    await logAudit({
      product_id: String(row.product_id),
      actor_type: 'system',
      actor_id: 'account_erasure',
      action: 'credential.revoked_on_erasure',
      resource_type: table,
      details: {
        count: Number(row.n),
        reason,
        // Deliberately no principal: the account this belonged to has been
        // erased, and naming it here would undo that.
        note: 'the account this was issued to was erased; re-establish it if the company still needs it',
      },
    });
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
/** Where a person's own rows live, and how to select them. */
export interface FounderDataSource {
  table: string;
  /** A WHERE clause; `binds` placeholders, all bound to the founder id, then
   *  `emailBinds` bound to their email address. */
  predicate: string;
  binds: number;
  emailBinds: number;
}

/**
 * A PERSON COULD BE ERASED AND COULD NOT ASK WHAT WAS HELD.
 *
 * `exportProductData` answers for a COMPANY. There was no counterpart for the
 * person: `FOUNDER_SCOPED` names twelve tables that are theirs rather than any
 * company's — their voice, their health circumstances, their devices, their
 * peer profile, their referral history — and `PERSON_ACROSS_COMPANIES` names
 * the rows that are their own activity inside companies they do not own. Both
 * maps existed only so an erasure could clear them. Nothing read either to
 * answer "what do you have about me?"
 *
 * The erasure itself fires from the identity provider's `user.deleted` webhook,
 * so there is no Foundry surface where a person asks to be erased and therefore
 * no moment at which Foundry could have offered them their data first. The
 * product-deletion modal recommends exporting beforehand; the account path had
 * nothing to offer.
 *
 * Derived from the same two maps the erasure runs on, so a table cannot be
 * erasable and unaskable at once.
 */
export function founderDataSources(): FounderDataSource[] {
  const out: FounderDataSource[] = [];

  for (const [table, disposition] of Object.entries(FOUNDER_SCOPED)) {
    const op = disposition.onAccountErasure;
    if (op.op === 'redact') {
      // The account row itself. Redaction is what happens to it on erasure;
      // for an export it is simply theirs.
      out.push({ table, predicate: 'id = ?', binds: 1, emailBinds: 0 });
      continue;
    }
    if (op.op === 'sever') {
      out.push({
        table,
        predicate: op.parties.map((party) => `${party.column} = ?`).join(' OR '),
        binds: op.parties.length,
        emailBinds: 0,
      });
      continue;
    }
    const column = op.by ?? 'founder_id';
    const subject = op.match === 'suffix' ? `${column} LIKE '%:' || ?` : `${column} = ?`;
    out.push({
      table,
      predicate: op.where ? `${subject} AND ${op.where}` : subject,
      binds: 1,
      emailBinds: 0,
    });
  }

  // Their own activity inside companies they do not own. Only the rows an
  // erasure would DELETE — those are wholly the person's. A row the erasure
  // SEVERS is the company's record that happens to name them, and a row marked
  // for an owner decision is a company asset; neither is theirs to receive.
  for (const [table, spec] of Object.entries(PERSON_ACROSS_COMPANIES)) {
    if (spec.op !== 'delete') continue;
    const byId = spec.columns.map((column) => `${column} = ?`);
    const byEmail = (spec.byEmail ?? []).map((column) => `${column} = ?`);
    out.push({
      table,
      predicate: [...byId, ...byEmail].join(' OR '),
      binds: spec.columns.length,
      emailBinds: (spec.byEmail ?? []).length,
    });
  }

  return out;
}

/**
 * Everything Foundry holds about a PERSON, as opposed to about a company.
 *
 * Same redaction as the company export: a subject access request is a right to
 * one's own data, not a way to extract a live credential.
 */
export async function exportFounderData(founderId: string): Promise<Record<string, unknown[]>> {
  const emailRow = (await query('SELECT email FROM founders WHERE id = ?', [founderId]))
    .rows[0] as Record<string, unknown> | undefined;
  const email = emailRow ? String(emailRow.email) : '';

  const out: Record<string, unknown[]> = {};
  for (const source of founderDataSources()) {
    if (source.table in EXCLUDED_FROM_EXPORT) continue;
    if (!source.predicate) continue;
    try {
      const args = [
        ...Array<string>(source.binds).fill(founderId),
        ...Array<string>(source.emailBinds).fill(email),
      ];
      const res = await query(
        `SELECT * FROM ${source.table} WHERE ${source.predicate}`, args);
      if (res.rows.length === 0) continue;
      const rows = (res.rows as unknown as Array<Record<string, unknown>>).map((row) => {
        const clean: Record<string, unknown> = {};
        for (const [col, value] of Object.entries(row)) {
          clean[col] = SECRET_COLUMN.test(col) && value != null ? '[redacted]' : value;
        }
        return clean;
      });
      // A table can appear twice — once founder-scoped and once as activity in
      // somebody else's company — so rows are merged rather than overwritten.
      out[source.table] = [...(out[source.table] ?? []), ...rows];
    } catch {
      // Same posture as the company export: a table that cannot be read is
      // omitted rather than failing the file.
      continue;
    }
  }
  return out;
}

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
export async function pendingDeletion(productId: string, now: Date = new Date()): Promise<{
  scheduledAt: string; deleteAfterDays: number; deletesOn: string; requestedBy: string | null;
  /**
   * The day has come and the erasure has not been recorded as done.
   *
   * The Letter says "everything in it will be removed on <date>" in the future
   * tense, and the privacy page says the same. Neither compared that date to
   * today, so when `data_deletion_processor` stops — a daily job outside the
   * two loops the "part of me has stopped" card watches — the sentence goes on
   * promising a removal that is not happening, in the past.
   *
   * A FACT, NOT A DIAGNOSIS. This says the date has passed and the completion is
   * not recorded. It does not say why, because nothing here knows: the job may
   * have stopped, or failed on this company, or be minutes from running.
   */
  overdue: boolean;
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

  // THIS MUST NOT THROW. It is the only reader that tells a founder a deletion
  // is coming, and the page carrying it is the only place they can stop it — so
  // an unparseable record used to remove their exit rather than degrade the
  // display. `Number(metadata.delete_after_days)` on a malformed row is NaN,
  // and `new Date(NaN).toISOString()` throws a RangeError.
  //
  // The fallbacks are the documented promise, not invented numbers: the page
  // says thirty days, and the row's own `created_at` is when it was written.
  let metadata: Record<string, unknown> = {};
  try { metadata = JSON.parse(String(row.metadata_json ?? '{}')) as Record<string, unknown>; } catch { /* keep {} */ }

  const claimedAt = String(metadata.scheduled_at ?? row.created_at);
  const scheduledAt = Number.isFinite(Date.parse(claimedAt)) ? claimedAt : String(row.created_at);
  const claimedDays = Number(metadata.delete_after_days);
  const days = Number.isFinite(claimedDays) && claimedDays > 0 ? claimedDays : 30;
  const base = Date.parse(scheduledAt);
  const deletesOn = new Date((Number.isFinite(base) ? base : Date.now()) + days * 86_400_000).toISOString();
  return {
    scheduledAt,
    deleteAfterDays: days,
    // If even `created_at` will not parse there is no honest date to give, and
    // the caller gets the day it is read rather than an exception: the founder
    // needs to be told this is happening far more than they need the date.
    deletesOn,
    requestedBy: row.actor_type === 'founder' ? String(row.actor_id) : null,
    // `done` is already known to be absent — this function returns null when the
    // completion is recorded — so a passed date is all that remains to check.
    overdue: Date.parse(deletesOn) < now.getTime(),
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
