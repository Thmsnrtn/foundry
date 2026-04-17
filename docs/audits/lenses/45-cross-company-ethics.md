# Lens 45 — Cross-Company Intelligence Ethics/Consent Reviewer Audit

**Auditor perspective:** Ethics and consent reviewer evaluating cross-product data sharing, anonymization rigor, de-anonymization risk, consent model, transparency, and regulatory compliance for the `decision_patterns` table and related cross-product intelligence features

**Date:** 2026-04-16
**Scope:** `src/db/schema.sql` (decision_patterns table), `src/services/decisions/patterns.ts`, `src/services/privacy/consent.ts`, `src/routes/dashboard/privacy.ts`, `src/services/network/benchmarks.ts`, `src/services/benchmarking/pool.ts`, `src/db/migrations/041_privacy_consent.sql`, `src/services/wisdom/network.ts`

---

## Executive Summary

Foundry has built a meaningful privacy consent infrastructure -- the `privacy_consents` table with explicit opt-in/out for benchmark contribution, aggregate insights, product improvement, and AI training, plus a well-designed privacy settings UI with data export and deletion capabilities. This is significantly more than most early-stage products build. However, the **`decision_patterns` table is fundamentally unconsented** -- it collects cross-product decision data with no consent check at write time, no opt-out mechanism, and is populated before the privacy consent system was even built (migration 001 vs. migration 041). The anonymization is **structurally incomplete** -- while no `product_id` or `founder_id` column exists, the combination of `market_category`, `product_lifecycle_stage`, `risk_state_at_decision`, and `key_metrics_context` creates a realistic de-anonymization surface. The consent model defaults to **opt-in for data sharing** (benchmark_contribution and aggregate_insights default to `true` if no explicit consent record exists), which inverts the GDPR default.

**Verdict:** Good privacy infrastructure that does not actually govern the most sensitive cross-product data flow. The decision_patterns table operates outside the consent system entirely.

---

## Findings

### 1. The decision_patterns Table: Consent Gap

**Severity: P0 -- Cross-product data collection without consent**

**Evidence:**

The `decision_patterns` table is created in migration 001 (the initial schema) with the comment: "This table is intentionally NOT scoped by founder or product. No founder-identifiable or product-identifiable data exists here."

The privacy consent system is created in migration 041 -- 40 migrations later. Between these two points, the system was collecting cross-product decision data with no consent mechanism.

`generatePatternFromOutcome()` in `patterns.ts` inserts into `decision_patterns` without any consent check:

```typescript
export async function generatePatternFromOutcome(input: {
  decisionType: string;
  lifecycleStage: string;
  riskState: RiskStateValue;
  metricsContext: Record<string, unknown>;
  optionChosen: string;
  ...
}): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO decision_patterns (id, decision_type, ...)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.decisionType, ...]
  );
  return id;
}
```

| ID | Severity | Finding |
|----|----------|---------|
| ETH-01 | **P0** | **`generatePatternFromOutcome()` does not check consent before inserting into `decision_patterns`.** The privacy consent system has `benchmark_contribution` and `aggregate_insights` consent types, but the `patterns.ts` module does not call `hasConsent()` before writing. A founder who explicitly disables "Anonymized Benchmarking" in the privacy settings still has their decision patterns collected and made available cross-product. The consent system and the pattern system are completely disconnected. |
| ETH-02 | **P1** | **No opt-out mechanism for decision_patterns specifically.** The privacy consent toggles cover `benchmark_contribution` (benchmarking pool), `aggregate_insights` (receiving cross-product insights), `product_improvement` (usage patterns), and `ai_training_opt_out`. None of these specifically map to "my decision outcomes are recorded in a cross-product table." Even if consent checks were added, the consent types do not precisely describe the data flow. |
| ETH-03 | **P1** | **No retroactive purge mechanism.** If a founder opts out of benchmarking after patterns have been collected, there is no mechanism to identify and delete their contributions from `decision_patterns`. The table has no `product_id` or `founder_id` column, so it is technically impossible to remove a specific founder's records without correlating against the `decisions` table. |

### 2. Anonymization Quality

**Severity: P1 -- Structurally incomplete**

**Evidence:**

The `decision_patterns` schema contains:
- `decision_type` (text) -- e.g., "pricing_change", "feature_launch"
- `product_lifecycle_stage` (text) -- e.g., "growth", "scaling"
- `risk_state_at_decision` (text) -- "green", "yellow", "red"
- `key_metrics_context` (JSON) -- "anonymized metric ranges"
- `option_chosen_category` (text)
- `outcome_direction` / `outcome_magnitude` / `outcome_timeframe_days`
- `market_category` (text) -- e.g., "edtech", "fintech"
- `contributing_factors` (JSON)
- `scenario_accuracy_score` (real)

No `product_id`, `founder_id`, or `owner_id` exists. The comment claims "No founder-identifiable or product-identifiable data exists here."

| ID | Severity | Finding |
|----|----------|---------|
| ETH-04 | **P1** | **De-anonymization is feasible via quasi-identifiers.** The combination of `market_category` + `product_lifecycle_stage` + `decision_type` + `key_metrics_context` creates a quasi-identifier set. In a niche market category (e.g., "veterinary_saas") with few products in the "scaling" stage, a pattern record with specific metric ranges (e.g., "mrr: 45000-50000") could be linked back to a specific product by anyone with knowledge of the market. The smaller the Foundry user base, the higher the de-anonymization risk. At launch with 30 founding cohort members, many market categories will have only 1-2 products, making every pattern record effectively identified. |
| ETH-05 | **P1** | **`key_metrics_context` is stored as raw JSON with no anonymization enforcement.** The `metricsContext` parameter is `Record<string, unknown>` and is stored as `JSON.stringify(input.metricsContext)`. The caller determines what goes in this field. If a caller passes `{ mrr: 47523, churn_rate: 0.034, customer_count: 127 }`, these exact values are stored. There is no range bucketing, no noise injection, no k-anonymity enforcement. The schema comment says "anonymized metric ranges" but the code does not enforce ranges. |
| ETH-06 | **P2** | **`contributing_factors` is a free-form JSON field.** The caller can pass any data as contributing factors. If a caller includes product-specific details (e.g., `{ "trigger": "customer X churned after price increase" }`), this identifying information is stored in the cross-product table. There is no schema validation or content filtering. |
| ETH-07 | **P2** | **Temporal correlation enables de-anonymization.** `decision_patterns` has a `created_at` timestamp. Combined with `decision_type` and `market_category`, an observer who knows when a specific company made a specific type of decision could match it to a pattern record. The timestamp should be bucketed (e.g., month-level) to reduce temporal precision. |

### 3. Consent Model Design

**Severity: P1 -- Defaults invert GDPR expectations**

**Evidence:**

The `getOrInitConsents()` function in `consent.ts` returns defaults when no explicit consent record exists:

```typescript
if (result.rows.length === 0) {
  return {
    benchmark_contribution: true,   // DEFAULT: sharing enabled
    aggregate_insights: true,        // DEFAULT: receiving enabled
    product_improvement: true,       // DEFAULT: usage data shared
    ai_training_opt_out: false,      // DEFAULT: opted IN to training
  };
}
```

| ID | Severity | Finding |
|----|----------|---------|
| ETH-08 | **P1** | **Default consent is opt-in for data sharing, not opt-out.** Under GDPR, processing beyond contract necessity requires explicit consent. Default-on for `benchmark_contribution` and `product_improvement` means founders are sharing data before they have ever seen the privacy settings page. The EU GDPR and UK Data Protection Act require affirmative consent for non-essential data processing. Even for US users, this default may violate state privacy laws (CCPA, Colorado Privacy Act). |
| ETH-09 | **P1** | **`ai_training_opt_out: false` default means users are opted IN to AI training.** The UI label says "By default, Foundry does not use your data for AI training. This toggle is a formal, auditable record of your preference." But the code default is `false` (not opted out), which means the system treats the absence of an explicit opt-out as permission. If Foundry ever does use data for training, this default would be the legal basis. The UI text and the code behavior are contradictory. |
| ETH-10 | **P2** | **Consent is recorded at the product level, not the founder level.** A founder with 3 products must configure privacy settings for each product independently. There is no founder-level consent that propagates to all products. If a founder opts out of benchmarking on Product A but forgets Product B, Product B continues contributing data. |
| ETH-11 | **P2** | **No consent versioning.** When a consent record is updated, the previous state is overwritten (`INSERT OR REPLACE`). There is no history of consent changes. If a regulatory inquiry asks "when did founder X consent to benchmarking?", the system only knows the most recent consent timestamp, not the full timeline of consent grants and revocations. |

### 4. Transparency About Cross-Product Data Sharing

**Severity: P2 -- Present but incomplete**

**Evidence:**

The privacy settings page (`routes/dashboard/privacy.ts`) provides clear descriptions:

- "Anonymized Benchmarking": "Share your anonymized metrics to the Foundry benchmarking pool. You'll get industry percentile comparisons in return."
- "Aggregate Insights": "Receive insights derived from anonymized data across all Foundry products in your category."
- "Learn more" expandable sections explain what data is shared.

| ID | Severity | Finding |
|----|----------|---------|
| ETH-12 | **P2** | **Privacy page does not mention `decision_patterns` specifically.** The "Anonymized Benchmarking" toggle controls the `benchmark_contribution` consent type, which maps to the `benchmark_contributions` table (from the benchmarking pool). The `decision_patterns` table is a separate data flow that is never mentioned in the UI. A founder who reads the privacy page has no way to know that their decision outcomes are being collected cross-product in a separate table. |
| ETH-13 | **P2** | **No transparency about what data consumers see.** The privacy page describes what data you contribute but not what other founders can see. "Only aggregated statistics are ever accessible to other founders" -- but the `decision_patterns` table contains individual decision records (not aggregated). Anyone querying the table via the intelligence system sees individual patterns, not just aggregates. |
| ETH-14 | **P2** | **No data processing agreement or privacy policy link.** The privacy settings page has no link to a formal privacy policy, data processing agreement, or terms of service that govern cross-product data sharing. The in-page descriptions are informal. |

### 5. Benchmarking Pool vs. Decision Patterns: Two Uncorrelated Systems

**Severity: P2 -- Architectural inconsistency**

**Evidence:**

There are two separate cross-product data systems:

1. **`benchmark_contributions` + `benchmark_percentiles`** (migration 030): The benchmarking pool. Accepts metrics with `product_id`, computes percentiles. `submitBenchmark()` in `pool.ts` does not check consent either, but at least maps to the `benchmark_contribution` consent type conceptually.

2. **`decision_patterns`** (migration 001): Cross-product decision outcomes. No product ID. No consent mapping. Consumed by `intelligence/predictive.ts`, `wisdom/network.ts`, `network/benchmarks.ts`.

| ID | Severity | Finding |
|----|----------|---------|
| ETH-15 | **P2** | **Two cross-product data systems with different anonymization models.** `benchmark_contributions` retains `product_id` (allowing per-product percentile comparison but also enabling data deletion on opt-out). `decision_patterns` has no `product_id` (preventing data deletion but also preventing consent enforcement). The architectures are inconsistent: one is reversible, the other is not. |
| ETH-16 | **P2** | **`benchmark_contributions` also lacks consent checking.** `submitBenchmark()` in `pool.ts` writes to `benchmark_contributions` without calling `hasConsent(productId, 'benchmark_contribution')`. Both cross-product data systems bypass the consent system. |
| ETH-17 | **P3** | **`network/benchmarks.ts` comments reference `decision_patterns` as a data source.** Line 26: "Uses the anonymized decision_patterns table + aggregated metric data." This confirms that the network benchmarks feature surfaces decision pattern data to users, but the privacy page only mentions "anonymized metrics." |

### 6. Data Deletion and GDPR Compliance

**Severity: P2 -- Partially implemented**

**Evidence:**

The privacy system provides:
- Data export (`exportProductData`) covering metrics, briefings, decisions, customers, and agent config
- Data deletion scheduling (`scheduleDataDeletion`) that logs a deletion job to the audit log
- Agent log retention settings (`delete_agent_logs_after_days`)

| ID | Severity | Finding |
|----|----------|---------|
| ETH-18 | **P2** | **Data deletion is scheduled but never executed.** `scheduleDataDeletion()` inserts a record into `agent_audit_log` with `event_type: 'data_deletion_scheduled'`. The comment says "actual deletion is handled by a cron job." But a grep for `data_deletion` in `jobs/index.ts` returns zero results. The cron job does not exist. Deletion requests are logged but never processed. |
| ETH-19 | **P2** | **Data export does not include `decision_patterns` contributions.** A GDPR subject access request should include all data derived from the requester. Since `decision_patterns` has no `product_id`, the export function cannot identify which pattern records belong to a given product. The founder's data is in the cross-product table but inaccessible for export. |
| ETH-20 | **P2** | **Data export omits agent session data.** `exportProductData()` exports metrics, briefings, decisions, customers, and agent config -- but not `agent_sessions` (which contain AI-generated analysis with potential PII references) or `agent_cost_log`. This is an incomplete GDPR response. |

---

## Embarrassment Test

**Would you be embarrassed if a privacy regulator reviewed this system?**

Yes. The privacy settings UI looks professional and suggests the company takes privacy seriously. But a regulator would quickly discover that: (1) the main cross-product data table (`decision_patterns`) operates entirely outside the consent system, (2) default consent is opt-in rather than opt-out, (3) the UI description contradicts the code behavior for AI training, (4) data deletion is promised but never executed, and (5) de-anonymization is feasible in small market categories. The gap between the privacy UI's promises and the system's actual behavior would be the primary concern.

---

## Pride Test

**What would you show off to a privacy-focused colleague?**

1. **The privacy settings page.** The UI with toggle switches, "Learn more" expandable sections, data residency configuration, data export, and deletion request is well-designed and more comprehensive than most B2B SaaS products.
2. **Explicit consent types.** Four distinct consent types (`benchmark_contribution`, `aggregate_insights`, `product_improvement`, `ai_training_opt_out`) with individual toggle controls is granular and respectful.
3. **IP address recording on consent changes.** The consent system records `ip_address` and `granted_at` timestamp, providing an audit trail for regulatory compliance.
4. **Data export functionality.** The JSON export with structured sections for metrics, briefings, decisions, customers, and agent config is a real GDPR-style data portability feature.
5. **Data residency settings.** The ability to configure preferred region, retention periods, and agent log retention shows forward-thinking about data governance, even though enforcement is not yet implemented.
