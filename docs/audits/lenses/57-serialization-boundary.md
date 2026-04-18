# Lens 57 — Serialization Boundary Reviewer

**Auditor perspective:** JSON shape drift between SCP agent instances, API responses, webhook payloads, AI prompt/response parsing, and database TEXT columns storing JSON. Schema validation at serialization boundaries.

**Date:** 2026-04-16
**Codebase snapshot:** ~176 services, 14+ API routes, webhook delivery system, AI response parsing via `parseJSONResponse`

---

## Executive Summary

Foundry has at least 30 database columns storing JSON as TEXT with no schema validation on read or write. The `parseJSONResponse<T>()` function that parses AI responses does an unchecked type assertion (`JSON.parse(cleaned) as T`), meaning any malformed Claude response silently produces an object with wrong or missing fields. Webhook payloads are constructed ad-hoc with no schema, meaning the shape can drift between versions. The API v1 responses use no DTO layer — raw database rows are sent directly to clients, exposing internal column names and potentially sensitive fields. The `as unknown as Type` pattern is used pervasively (36+ occurrences) to cast database `ResultSet` rows to TypeScript types, with no runtime validation that the row actually matches the expected shape.

---

## Findings

### SER-01. `parseJSONResponse<T>()` Performs Unchecked Type Assertion on AI Output

**Severity: P1**

`src/services/ai/client.ts:197-209` — `parseJSONResponse<T>()` strips markdown fences and calls `JSON.parse(cleaned) as T`. The `as T` assertion provides zero runtime validation. If Claude returns a response with missing fields, extra fields, or wrong types, the caller receives a malformed object that passes TypeScript's compile-time checks but fails at runtime.

**Evidence:**
- `src/services/ai/client.ts:208` — `return JSON.parse(cleaned.trim()) as T`
- Called in 15+ locations, each expecting a specific JSON shape:
  - `src/jobs/index.ts:278` — expects `{ predicted_direction, actual_direction, accuracy_score }`
  - `src/jobs/index.ts:779` — expects `{ headline, context, action }`
  - `src/jobs/index.ts:853` — expects `{ synthesis, items: [...] }`
  - `src/services/scp/agents/atlas.ts` — expects `AtlasClaudeResponse` (complex nested object)
- If Claude returns `{ "headline": null }` instead of `{ "headline": "..." }`, the caller silently uses `null` as a string, potentially inserting NULL into a NOT NULL column

**Remediation:** Add runtime validation using Zod schemas. Create a `parseAIResponse<T>(content: string, schema: ZodSchema<T>): T` function that validates the parsed JSON against the expected schema. On validation failure, log the raw response and return a typed error.

**Target phase:** P1

---

### SER-02. 30+ Database Columns Store JSON as TEXT with No Read Validation

**Severity: P1**

The schema uses TEXT columns for JSON storage (e.g., `preferences TEXT`, `findings TEXT`, `blocking_issues TEXT`, `key_quotes TEXT`, `options TEXT`, `context TEXT`). When read back, these are cast with `JSON.parse(row.column)` inside a try/catch or with no error handling at all. Corrupted JSON in these columns causes runtime crashes.

**Evidence:**
- `src/db/migrations/001_initial.sql:17` — `preferences TEXT -- JSON: digest time, notification channels`
- `src/db/migrations/001_initial.sql:93` — `findings TEXT, -- JSON: array of finding objects`
- `src/db/migrations/001_initial.sql:94` — `blocking_issues TEXT, -- JSON: array of BLOCK objects`
- `src/db/migrations/001_initial.sql:111` — `options TEXT, -- JSON: array of {label, description, trade_offs}`
- `src/middleware/auth.ts:120` — `JSON.parse(row.preferences) as FounderPreferences` — crashes if preferences column contains invalid JSON
- `src/routes/dashboard/decisions.ts:82-88` — `JSON.parse(decision.options)` inside a try/catch (correct) but returns empty array on failure (data loss)

**Remediation:** Create a `safeParseJSON<T>(value: string | null, schema: ZodSchema<T>, fallback: T): T` utility. Use it everywhere JSON TEXT columns are read. This provides both null-safety and schema validation. For write paths, validate JSON before INSERT.

**Target phase:** P1

---

### SER-03. API v1 Returns Raw Database Rows — No DTO Layer

**Severity: P1**

API endpoints return `result.rows` directly to clients with no transformation:

**Evidence:**
- `src/api/v1/webhooks.ts:25` — `return c.json({ data: result.rows, meta: { total: result.rows.length } })`
- `src/routes/api/metrics.ts` — returns raw rows from `metric_snapshots`, `stressor_history`, `cohorts`
- This exposes internal column names (e.g., `new_mrr_cents` instead of a documented API field name like `newMrr`)
- If a column is renamed in a migration, all API clients break
- Sensitive columns (e.g., `github_access_token`) could be accidentally included if a SELECT * is used

**Remediation:** Create DTO transformation functions for each API response type. Map internal column names to stable, documented API field names. Explicitly select columns in queries rather than using `SELECT *`. Add an API response schema (OpenAPI or Zod) and validate responses in development.

**Target phase:** P1

---

### SER-04. Webhook Payload Shape Is Ad-Hoc with No Schema Contract

**Severity: P2**

Outbound webhook payloads (`src/services/api/webhooks.ts:168-175`) are constructed inline:
```typescript
const fullPayload = { id, event, product_id, timestamp, data: payload };
```
The `payload` parameter is `Record<string, unknown>` — there is no schema defining what `data` contains for each event type. Webhook consumers have no contract to code against, and the shape can change silently with any code change.

**Evidence:**
- `src/services/api/webhooks.ts:168-175` — payload construction with untyped `data`
- `deliverWebhookEvent()` at line 122-157 — called from various service files, each passing a different `payload` shape
- No webhook event schema documentation
- No versioning mechanism (e.g., `/v1/` prefix or `api_version` field in payload)

**Remediation:** Define a Zod schema for each webhook event type (e.g., `BriefingPublishedEvent`, `DecisionCreatedEvent`). Validate payloads against the schema before delivery. Include an `api_version: '2026-04-16'` field in the payload envelope for future backward compatibility.

**Target phase:** P2

---

### SER-05. `as unknown as Type` Pattern Bypasses Runtime Type Safety

**Severity: P2**

The codebase uses `as unknown as Type` in 36+ locations to cast `ResultSet` rows to TypeScript types. This is a compile-time-only assertion that provides zero runtime safety.

**Evidence:**
- `src/db/client.ts:248` — `(result.rows[0] as Record<string, unknown>)?.count as number ?? 0`
- `src/services/signal.ts:67-71` — `stressorResult.rows as Array<Record<string, string>>` — assumes all values are strings
- `src/jobs/index.ts:106-107` — `latestMetrics.rows[0] as unknown as StressorInputs['currentMetrics']` — blindly casts entire row
- `src/middleware/auth.ts:110` — `const row = result.rows[0] as unknown as FounderRow`
- If a migration adds/removes/renames a column, these casts silently produce objects with undefined properties

**Remediation:** Create typed query wrappers that validate results against Zod schemas: `queryTyped<T>(sql, args, schema: ZodSchema<T>): Promise<T[]>`. This catches schema drift at runtime with clear error messages instead of silent `undefined` propagation.

**Target phase:** P2

---

### SER-06. Inconsistent Date Serialization Across Boundaries

**Severity: P2**

Dates are serialized inconsistently: some locations use `new Date().toISOString()` (full ISO with 'Z' timezone), others use `new Date().toISOString().split('T')[0]` (date-only), and SQLite stores dates from `CURRENT_TIMESTAMP` and `datetime('now')` in a different format.

**Evidence:**
- `src/jobs/index.ts:200` — `new Date().toISOString().split('T')[0]` — date-only, no timezone
- `src/services/integrations/stripe-webhook.ts:181` — `new Date().toISOString().split('T')[0]!` — same pattern
- SQLite `CURRENT_TIMESTAMP` returns `YYYY-MM-DD HH:MM:SS` (no timezone, no milliseconds)
- `datetime('now')` in SQL returns the same format
- These different formats can cause date comparison bugs (covered more in Lens 58)

**Remediation:** Standardize on ISO 8601 with UTC timezone for all datetime columns. For date-only columns, use `YYYY-MM-DD`. Create utility functions `toISODate()` and `toISODatetime()` and use them everywhere.

**Target phase:** P2

---

## Embarrassment Test

1. **"Claude returns malformed JSON and the application silently inserts garbage into the database because `parseJSONResponse` does an unchecked `as T` cast"** — The AI response parsing trusts an LLM to produce perfect JSON every time.

2. **"API v1 returns raw database rows including internal column names, so a database migration that renames a column breaks every API consumer"** — No DTO layer means the API contract is the database schema.

3. **"30+ database columns store JSON as TEXT with no validation on read — corrupted JSON crashes the request handler"** — `JSON.parse` on unvalidated TEXT columns is a ticking time bomb.

## Pride Test

1. The `parseJSONResponse` function correctly handles markdown code fences (` ```json `) which Claude sometimes wraps around JSON output.

2. The webhook delivery system correctly includes `X-Foundry-Signature`, `X-Foundry-Event`, and `X-Foundry-Delivery` headers, following industry-standard webhook practices.

3. The `batch()` function in `db/client.ts` correctly types its input as `Array<{ sql: string; args?: unknown[] }>`, providing type safety for multi-statement operations.

## Distinct-Value Declaration

This lens traces data shapes across serialization boundaries (AI -> app -> DB -> API -> webhook) and identifies where unchecked type assertions create silent data corruption. Tier 1 lenses identify "no input validation" at the HTTP boundary; this lens identifies the same problem at the AI response boundary, the database read boundary, and the webhook output boundary — three boundaries that are invisible to traditional API design reviews.

## Tenancy-Critical Flag

**SER-03** is tenancy-critical: if API v1 returns raw database rows and a SELECT joins across tables without proper tenant scoping, sensitive data from one product could leak to another's API consumer. The current queries appear to scope by `product_id`, but the absence of a DTO layer means there is no defense-in-depth.
