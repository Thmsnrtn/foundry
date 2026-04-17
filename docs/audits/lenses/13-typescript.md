# Lens 13 — TypeScript Expert

## Executive Summary

Foundry's tsconfig.json is commendably strict (`strict: true`, `noImplicitAny: true`, `strictNullChecks: true`). The type system has a well-structured foundation with four type files covering domain entities, database rows, API contracts, and AI types. However, the strict config is systematically subverted by 36 `as any` casts and 30+ `as unknown` casts that short-circuit type safety at critical boundaries: database query results, API request bodies, and service-layer returns. The core architectural issue is that `db/client.ts` returns untyped `ResultSet` objects, forcing every consumer to cast `result.rows[0] as Record<string, unknown>` — a pattern repeated hundreds of times across the codebase with zero compile-time guarantees.

## Findings

### TS-01 Database Client Returns Untyped ResultSets
- **Severity:** P1
- **Description:** All database queries return `Promise<ResultSet>` from libSQL, where `ResultSet.rows` is typed as `Array<Row>` (essentially `Array<Record<string, Value>>`). Every consumer must manually cast: `const p = result.rows[0] as Record<string, unknown>`. There are 1,038 occurrences of `Record<string, unknown>` or `Record<string, any>` across the codebase, the majority being database row casts. The carefully defined types in `types/database.ts` (FounderRow, ProductRow, etc.) are rarely used at the query boundary.
- **Evidence:** `src/db/client.ts:27-29` (returns `Promise<ResultSet>`), `src/routes/dashboard/_shared.ts:58-60` (`products.rows.map((p) => { const r = p as Record<string, unknown> })`), 1,038 total `Record<string, unknown|any>` occurrences across 207 files
- **Remediation:** Create typed query helpers: `queryOne<T>(sql, args): Promise<T | null>` and `queryMany<T>(sql, args): Promise<T[]>` that map `ResultSet.rows` to the target type. Migrate callers incrementally starting with the most-used queries.
- **Target Phase:** 3

### TS-02 36 `as any` Casts Subvert Strict Mode
- **Severity:** P1
- **Description:** Despite `strict: true` in tsconfig, there are 36 `as any` casts across 15 files. Many are in critical paths: `args as any[]` in the database client (every query), `verifyToken(..., { } as any)` in auth middleware, `body as any` in multiple API routes accepting unvalidated user input, and `digests as any` in view rendering.
- **Evidence:** `src/db/client.ts:29` (`args as any[]` — every single query), `src/middleware/auth.ts:67` (`as any` on Clerk verify options), `src/routes/api/platform.ts:32,111,155,188,309,310,319` (7 `as any` in one file for request bodies), `src/routes/dashboard/onboarding.ts:40,73,116,181,222` (5 casts for layout options)
- **Remediation:** For `db/client.ts`: change `args` parameter to `InValue[]` from libSQL types. For auth: define a proper type for the Clerk verify options. For API routes: add Zod validation schemas that produce typed outputs. For onboarding: fix the `LayoutOptions` type to accept the actual shape being passed.
- **Target Phase:** 2

### TS-03 30+ `as unknown as T` Double Casts
- **Severity:** P1
- **Description:** There are 30+ `as unknown as T` double casts, primarily for database rows. This pattern (`result.rows as unknown as Array<Record<string, unknown>>`) is TypeScript's "I give up on type safety" escape hatch. It appears extensively in services like `customer/intelligence.ts`, `events/bus.ts`, `scp/messages.ts`, `investor/board_packet.ts`, and `digest/generator.ts`.
- **Evidence:** `src/services/customer/intelligence.ts:285,297,329`, `src/services/events/bus.ts:56,134,235,246`, `src/services/scp/messages.ts:121,140,245,247`, `src/services/investor/board_packet.ts:316-319`
- **Remediation:** Same as TS-01 — typed query helpers eliminate the need for double casts at the database boundary.
- **Target Phase:** 3

### TS-04 No Request Body Validation (Missing Zod)
- **Severity:** P1
- **Description:** API route handlers access `req.body` fields directly with type assertions (`body.provider as any`, `body.type as any`, `body.severity as any`) rather than validating with Zod or similar. This means invalid payloads pass TypeScript compilation but crash at runtime or corrupt data. The orientation doc confirms: "No request validation (Zod) at HTTP boundaries — trusts all input."
- **Evidence:** `src/routes/api/supercharge.ts:86,215,293,335` (`body.provider as any`, `body.outcome as any`, `body as any`, `body.type as any`), `src/routes/api/platform.ts:32,111,309,310,319` (5 separate `as any` on body fields), `src/routes/api/tier1.ts:57,118` (`stage as any`, `key_persons as any`)
- **Remediation:** Define Zod schemas for each API endpoint's request body. Use a `validateBody<T>(schema)` middleware that returns typed `T` or 422. This eliminates `as any` casts and provides runtime validation simultaneously.
- **Target Phase:** 2

### TS-05 Auth Middleware Uses `as any` for Clerk Integration
- **Severity:** P2
- **Description:** The auth middleware casts the Clerk `verifyToken` options as `any` and uses `as any` to access `lifestyle_mode` and `lifestyle_target_mrr` from the founder row — suggesting the `FounderRow` type in `types/database.ts` may be incomplete or the actual schema has columns not yet reflected in the type.
- **Evidence:** `src/middleware/auth.ts:67` (`} as any`), `src/middleware/auth.ts:121-122` (`(row as any).lifestyle_mode`, `(row as any).lifestyle_target_mrr`)
- **Remediation:** Update `FounderRow` in `types/database.ts` to include `lifestyle_mode` and `lifestyle_target_mrr` (they are already defined there but the cast suggests a mismatch in how the row is typed at the call site — the row comes via `as unknown as FounderRow` on line 110 but lines 121-122 cast back to `any`). Fix the Clerk types by declaring a proper interface for verify options.
- **Target Phase:** 2

### TS-06 Domain Types Are Well-Defined but Not Enforced at Boundaries
- **Severity:** P2
- **Description:** The types in `types/index.ts` are comprehensive — proper union types for gates, risk states, tiers, decision categories, statuses. `types/database.ts` maps SQL rows. `types/api.ts` defines API response shapes. `types/ai.ts` covers AI call contracts. But these types only flow through functions that explicitly import and use them. The database boundary (TS-01) and HTTP boundary (TS-04) break the type chain.
- **Evidence:** `src/types/index.ts` (1,528 lines of well-structured domain types), `src/types/database.ts` (324 lines of row types), `src/types/api.ts` (152 lines of API types), `src/types/ai.ts` (202 lines of AI types) — all carefully defined but poorly connected to the query and route layers
- **Remediation:** Create mapping functions: `rowToFounder(row: FounderRow): Founder`, `rowToProduct(row: ProductRow): Product`, etc. Use these as the single conversion point between database and domain types.
- **Target Phase:** 3

### TS-07 Loose Generic Usage in View Components
- **Severity:** P2
- **Description:** View component functions accept `Record<string, unknown>` parameters and then cast individual fields: `metrics.signups_7d as number | null`, `metrics.activation_rate as number | null`. The `metricsGrid` function in `components.ts` takes `Record<string, unknown>` instead of `MetricSnapshot`.
- **Evidence:** `src/views/components.ts:138-149` (`metricsGrid(metrics: Record<string, unknown>)` with 7 field casts)
- **Remediation:** Change parameter types to use the domain types from `types/index.ts`: `metricsGrid(metrics: MetricSnapshot)`.
- **Target Phase:** 3

### TS-08 Missing Return Type Annotations on Route Handlers
- **Severity:** P3
- **Description:** Route handler callbacks rely on inference for return types. While Hono's framework types provide some safety, the actual return types of `async (c) => { ... }` handlers are not annotated, making it harder to catch missing returns or wrong response shapes.
- **Evidence:** `src/routes/dashboard/decisions.ts:22` (`decisionRoutes.get('/decisions', async (c) => {`), pattern is universal across all 82 route files
- **Remediation:** This is low priority — Hono's framework types handle most of this. Consider adding return type annotations only to API routes that return JSON.
- **Target Phase:** 4

### TS-09 `tsconfig.json` Missing `noUncheckedIndexedAccess`
- **Severity:** P3
- **Description:** The tsconfig does not enable `noUncheckedIndexedAccess`, which means `result.rows[0]` is typed as `Row` rather than `Row | undefined`. This is particularly dangerous with database queries that may return empty results — accessing `.rows[0].field` on an empty result causes a runtime crash.
- **Evidence:** `src/tsconfig.json` (missing flag), `src/routes/dashboard/_shared.ts:107` (`lsResult.rows[0] as Record<string, unknown> | undefined` — manually added `| undefined` showing awareness of the issue), but many other call sites do not: `src/routes/dashboard/decisions.ts:59` (`result.rows[0] as Record<string, unknown>` without undefined check)
- **Remediation:** Enable `noUncheckedIndexedAccess: true` in tsconfig. This will surface dozens of potential null-access bugs but requires fixing each call site.
- **Target Phase:** 4

## Embarrassment Test
1. A crafted API request to `/api/platform` with a malformed body passes TypeScript compilation, bypasses nonexistent validation, hits a `body as any` cast, and either crashes the server or writes garbage to the database.
2. The `db/client.ts` `args as any[]` cast means every single database query in the entire application (hundreds of calls) loses type safety on parameters — a string passed where a number is expected won't be caught.
3. The `FounderRow` type includes `lifestyle_mode` and `lifestyle_target_mrr`, yet the auth middleware accesses them via `(row as any).lifestyle_mode`, suggesting the type isn't being used correctly at the most critical code path in the application.

## Pride Test
1. The `tsconfig.json` has `strict: true`, `strictNullChecks: true`, `noImplicitAny: true`, `forceConsistentCasingInFileNames: true` — this is a strictness configuration many production codebases never achieve.
2. The type definitions in `types/index.ts` are genuinely excellent — proper union types for every enumeration (`Gate = 0|1|2|3|4`, `RiskStateValue = 'green'|'yellow'|'red'`), structured interfaces for every entity, and clean separation between domain types, database rows, API contracts, and AI types.
3. The `AuthEnv` type pattern for Hono middleware (`Variables: { founder: Founder }`) ensures type-safe access to `c.get('founder')` across all authenticated routes — a clean, framework-idiomatic approach.
