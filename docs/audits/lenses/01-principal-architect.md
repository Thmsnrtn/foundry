# Lens 01 — Principal Architect Audit

**Auditor perspective:** System architecture — modularity, coupling, cohesion, scalability, separation of concerns, dependency direction, and evolution toward a multi-company fleet control plane.

**Date:** 2026-04-16
**Codebase snapshot:** ~288 TypeScript files, 176 services, 84 routes, 54+ migrations, 26+ scheduled jobs (registry shows 72 entries)

---

## Executive Summary

Foundry has reasonable vertical layering (middleware -> routes -> services -> db) and the dependency arrows generally point inward. The SCP agent system is a well-conceived abstraction with a clean `BaseAgent` contract. However, the architecture has accumulated significant structural debt through rapid feature accretion: a 512-line god entrypoint, an 1865-line monolithic jobs file, duplicate migration prefixes, 1528-line monotype barrel, and a single-process in-memory scheduler that cannot survive restarts or horizontal scaling. The multi-product fleet ambition is blocked by fundamental single-process assumptions and the absence of cross-SCP coordination primitives. The codebase is at the "one more feature breaks the dam" stage — still functional but increasingly fragile as surface area grows.

---

## Findings

### F-01. God Entrypoint — `src/index.ts` (512 lines)

**Severity: P1**
**Category:** Modularity / Separation of concerns

`src/index.ts` manually imports and mounts 80+ route modules, configures 60+ `app.use()` auth middleware bindings, defines inline Stripe webhook handlers, manages static file serving, runs database migrations, provisions SCP instances, and starts the cron scheduler — all in a single file.

**Evidence:**
- Lines 1-136: 104 route/service imports
- Lines 214-333: 60+ repetitive `app.use('/path/*', authMiddleware)` calls
- Lines 225-255: Inline Stripe webhook handler with `console.error`
- Lines 474-510: Startup orchestration mixing migration, provisioning, and server boot

**Impact:** Any new feature requires modifying this file. Auth middleware bindings are maintained manually and are easy to miss (a route added without a matching `app.use` becomes unauthenticated). Startup logic is untestable.

**Recommendation:** Extract route registration into a `routes/registry.ts` that auto-discovers and mounts routes. Replace the per-path auth middleware repetition with a route-group pattern (Hono supports `app.basePath()` groups). Move startup orchestration into a `bootstrap.ts` module.

---

### F-02. Monolithic Job Registry — `src/jobs/index.ts` (1865 lines, 72 registered jobs)

**Severity: P1**
**Category:** Modularity / Single Responsibility

All 72 scheduled jobs are defined as top-level functions in a single file, interleaving business logic with scheduling metadata. The file directly imports from 30+ service modules, making it the highest fan-out module in the codebase.

**Evidence:**
- Lines 1-36: 30+ service imports
- The file contains 72 `JOB_REGISTRY` entries but the header comment says "All 14 Scheduled Jobs" — documentation is stale
- Job numbering is inconsistent: two jobs are both labeled "23" (lines 797 and 1774)
- Each job follows the same `getAllActiveProducts` -> iterate -> try/catch pattern with copy-pasted error handling

**Impact:** Adding a new job requires editing a nearly 2000-line file. The identical iteration pattern across jobs indicates missing abstraction. The stale header comment signals that the file has outgrown its original design.

**Recommendation:** Each job should be its own file under `src/jobs/` exporting a standard interface `{ fn, schedule, description }`. The registry becomes a directory scan. Extract the `forEachActiveProduct(callback)` pattern into a shared utility.

---

### F-03. In-Process Cron Scheduler Cannot Scale Horizontally

**Severity: P1**
**Category:** Scalability / Operational architecture

The cron scheduler (`node-cron` library, started in `startScheduler()`) runs in the same process as the HTTP server. There is no distributed lock, no leader election, and no deduplication mechanism.

**Evidence:**
- `src/index.ts` line 438-455: `CronJob` instances created in-process
- `src/index.ts` line 493: `startScheduler()` called only in production
- 72 jobs run on a single Fly.io machine — any horizontal scaling causes double-execution

**Impact:** Running 2+ Fly.io instances (which Fly does during deploys by default) causes all jobs to execute twice. Jobs that call the Anthropic API (at least 15 of the 72 jobs) would double AI spend. Jobs that write database records (most of them) would create duplicates, though some have `ON CONFLICT DO NOTHING` guards.

**Recommendation:** Move job scheduling to an external mechanism (Fly.io scheduled machines, or a Postgres/Turso-based queue with `SELECT FOR UPDATE` locking). At minimum, add an `advisory_lock` table and a "am I the leader?" check before each job runs.

---

### F-04. Duplicate Migration Prefixes — Schema Integrity Risk

**Severity: P1**
**Category:** Database design / Migration safety

Multiple migration files share the same numeric prefix:
- `004_sector_profiles.sql` and `004_signal_wisdom.sql`
- `005_growth_stages.sql` and `005_signal_history.sql`
- `006_founder_health.sql` and `006_intelligence_layer.sql`
- `007_lifestyle_mode.sql` and `007_operating_plan.sql`
- `008_integrations.sql` and `008_non_code_track.sql`
- And similar duplicates through `015`, `030`, `031`, `032`, `033`

**Evidence:** `ls src/db/migrations/` shows pairs with identical numeric prefixes, e.g., `004_sector_profiles.sql` and `004_signal_wisdom.sql`.

The migration runner (`src/db/migrate.ts`) sorts by filename and applies in lexicographic order. When two files share a prefix, their relative order depends on the alphabetic sort of the suffix, which is fragile and non-deterministic across environments if the filesystem sort order differs.

**Impact:** Migrations that depend on columns created by a peer same-numbered migration may fail on some systems. The `duplicate column` / `already exists` error swallowing (line 56) masks real migration ordering bugs. The schema state is not guaranteed to be consistent across environments.

**Recommendation:** Re-number all migrations to have unique sequential prefixes. Add a CI check that rejects duplicate prefixes.

---

### F-05. Migration Failure Swallowed at Startup — Server Runs with Inconsistent Schema

**Severity: P1**
**Category:** Operational safety

When migrations fail, the server starts anyway with a warning.

**Evidence:**
- `src/index.ts` lines 503-509: `.catch()` handler logs "Migration error (non-fatal)" and starts the server anyway
- `src/db/migrate.ts` lines 52-58: Individual ALTER TABLE errors (`duplicate column`, `already exists`) are silently swallowed

**Impact:** If a migration partially applies (e.g., 3 of 5 statements succeed before an error), the `schema_migrations` table never records it as applied. On next restart, it tries again, hits the same error, and the server starts with a partially-applied migration — but some statements may have been applied while others were not. Queries against missing columns or tables will fail at runtime with cryptic errors.

**Recommendation:** Wrap each migration in a transaction (Turso supports `BEGIN`/`COMMIT`). If any statement fails, roll back the entire migration. Do not start the server if a migration fails — fail fast.

---

### F-06. No Transaction Support Anywhere in the Codebase

**Severity: P1**
**Category:** Data integrity

The database client (`src/db/client.ts`) exposes a `batch()` function that uses Turso's batch mode with `'write'` consistency, but no service code uses it. All multi-step database operations use sequential `query()` calls without atomicity guarantees.

**Evidence:**
- `src/services/scp/provisioner.ts` lines 64-148: Creates a constitution, then 12 agent instances and 12 evolution versions (26 separate INSERT queries) with no transaction — a failure at agent #7 leaves a partially-provisioned product
- `src/services/intelligence/risk-state.ts`: Risk state transition updates lifecycle_state, inserts audit_log, and may trigger recovery protocol — all as separate queries
- `src/db/client.ts` line 35-44: `batch()` exists but grep shows zero callers outside the client itself

**Impact:** Any multi-step operation can leave the database in an inconsistent state on partial failure. The SCP provisioning path is especially dangerous: a partially-provisioned product with 7 of 12 agents will behave unpredictably.

**Recommendation:** Use `batch()` for all multi-row writes. For provisioning, wrap the entire 26-query sequence in a single batch. Consider adding a `transaction()` helper that provides a cleaner API.

---

### F-07. Single Monotype Barrel — `src/types/index.ts` (1528 lines)

**Severity: P2**
**Category:** Modularity / Cohesion

All domain types are defined in a single 1528-line file. This includes types for gates, risk states, billing tiers, decisions, stressors, audits, sectors, growth stages, founder health, metrics, competitive intelligence, portfolios, team alignment, playbooks, voice, notifications, and more.

**Evidence:**
- The file starts with Gate types, then moves through 15+ unrelated domains
- `src/services/scp/types.ts` (477 lines) is a separate types file for SCP, demonstrating that domain-scoped types files are possible — the main barrel just never adopted this pattern

**Impact:** Every service that needs any type imports the full barrel, creating unnecessary coupling. The file is difficult to navigate and maintain. It encourages adding "just one more type" rather than creating proper domain boundaries.

**Recommendation:** Split into domain-scoped type files: `types/billing.ts`, `types/intelligence.ts`, `types/decisions.ts`, etc. Keep `types/index.ts` as a re-export barrel only.

---

### F-08. No Multi-Product Isolation Boundary — Fleet Ambition Blocked

**Severity: P1**
**Category:** Architecture / Multi-tenancy

The product directive positions Foundry as a "multi-company autonomous control plane" but the architecture has no abstraction for fleet-level operations. Every service function takes a `productId` parameter and operates on one product at a time. Cross-product operations exist only in the jobs file, implemented as `for (const product of products) { ... }` loops.

**Evidence:**
- `src/services/scp/scheduler.ts` lines 28-57: `runDueAgentsForAllProducts()` iterates products in a serial `for` loop — one slow product blocks all subsequent products
- No `Fleet` or `Orchestrator` abstraction exists
- `src/services/scp/instance.ts`: `SCPInstance` is per-product only; there is no `SCPFleet` or `SCPCluster`
- The portfolio layer (`src/services/portfolio/manager.ts`) is a reporting aggregator, not an orchestration layer — it reads data but does not coordinate agent execution across products
- `decision_patterns` table is the only cross-product data structure, and it has no access controls (noted in the orientation doc)

**Impact:** Scaling to 100 products with 12 agents each (1200 agent sessions) in serial `for` loops will exhaust the cron window. There is no mechanism for cross-product intelligence (e.g., "your churn spike matches a pattern we see across 40 products in your sector"). Fleet-level meta-agents (fleet Sentinel, fleet Oracle) have no architectural home.

**Recommendation:** Introduce a `Fleet` service that wraps product-level operations with concurrency control, priority ordering, and cross-product event emission. Use a work queue (not serial iteration) for multi-product jobs. Define cross-product data-flow contracts as explicit types.

---

### F-09. SCP Agent Dynamic Import Anti-Pattern

**Severity: P2**
**Category:** Coupling / Testability

The `SCPInstance.runAgent()` method uses dynamic `import()` to load agent modules at runtime:

```typescript
const module = await import(`./agents/${agentName}.js`);
const AgentClass = module.default ?? module[Object.keys(module)[0]];
```

**Evidence:** `src/services/scp/instance.ts` lines 133-138

**Impact:** This pattern:
1. Defeats TypeScript's type checking — the agent class is `any`
2. Makes it impossible to unit test `SCPInstance` without the full agent tree
3. Relies on file system convention rather than an explicit registry
4. The fallback `module[Object.keys(module)[0]]` is fragile — export order is not guaranteed

**Recommendation:** Create an explicit agent registry: `const AGENT_REGISTRY: Record<AgentName, typeof BaseAgent> = { atlas: AtlasAgent, ... }`. This enables type checking, makes dependencies explicit, and supports dependency injection for testing.

---

### F-10. In-Memory Rate Limiting — Does Not Work with Multiple Instances

**Severity: P2**
**Category:** Scalability / Security

Rate limiting uses an in-memory `Map` with no shared state.

**Evidence:** `src/middleware/rate-limit.ts` lines 13-21: `const store = new Map<string, RateLimitEntry>()` with a `setInterval` cleanup.

**Impact:** Each Fly.io instance maintains its own rate limit counters. An attacker sending requests that load-balance across N instances gets N times the configured rate limit. This is especially problematic for the auth rate limit (10 req/min) — with 2 instances it becomes 20 req/min.

**Recommendation:** Use Turso (or Redis/Upstash) as a shared rate limit store. Alternatively, rate limiting can be handled at the Fly.io edge (Fly Proxy) or Cloudflare level.

---

### F-11. No Structured Logging — 422 `console.log/error/warn` Calls

**Severity: P2**
**Category:** Operational observability

The entire codebase uses raw `console.log`, `console.error`, and `console.warn` with ad-hoc string formatting.

**Evidence:**
- Orientation doc: 422 occurrences across 40 files
- `src/index.ts` line 439: `console.log('Starting job scheduler...')`
- `src/jobs/index.ts`: Every job has `console.log('[JOB] X starting')` / `console.error('[JOB] X error:')` patterns
- `src/services/scp/scheduler.ts`: `console.log` / `console.error` throughout

**Impact:** No JSON-structured output means no programmatic parsing by log aggregators. No request IDs or correlation tokens mean cross-service traces are impossible. No log levels mean you cannot filter noise in production.

**Recommendation:** Introduce a structured logger (pino or winston) with JSON output. Add a request-scoped correlation ID via middleware. Replace all 422 `console.*` calls.

---

### F-12. `db/client.ts` Mixes Data Access with Business Queries

**Severity: P2**
**Category:** Separation of concerns / Cohesion

The database client file (`src/db/client.ts`, 320 lines) mixes low-level data access primitives (`query()`, `batch()`, `executeRaw()`) with business-domain query functions (`getPendingDecisions()`, `getRelevantPatterns()`, `countGate0DecisionsWithOutcomes()`).

**Evidence:**
- Lines 1-62: Database primitives (good)
- Lines 64-320: 20+ domain-specific query functions that embed business logic (SQL ordering by category urgency, multi-dimension pattern matching, etc.)

**Impact:** As the schema grows, this file becomes another god file. Services that need custom queries bypass the helper functions and call `query()` directly with raw SQL anyway (visible throughout the jobs file). The helper functions create a false abstraction — they don't fully encapsulate data access.

**Recommendation:** Move domain query functions into their respective service modules (e.g., `getPendingDecisions` belongs in `services/decisions/`). Keep `db/client.ts` as a pure data access layer: `query()`, `batch()`, `executeRaw()`, and connection management only.

---

### F-13. No External Call Resilience — Zero Retry, Timeout, or Circuit Breaker

**Severity: P1**
**Category:** Reliability / Fault tolerance

No external API call (Anthropic, GitHub, Stripe, Clerk, Resend) has retry logic, explicit timeouts, or circuit breaking.

**Evidence:**
- `src/services/ai/client.ts`: Raw `client.messages.create()` call with no timeout or retry
- `src/services/scp/scheduler.ts`: If Anthropic is down, all 12 agent runs for a product fail serially, each waiting for the default HTTP timeout
- `src/services/scp/agents/base.ts`: Agent `run()` catches errors but has no retry — a transient API failure marks the session as failed permanently
- Orientation doc table confirms: all 6 external dependencies have no retry, no circuit breaker, no timeout

**Impact:** A 30-second Anthropic timeout during the hourly SCP run (12 agents x N products) could block the scheduler for 30 * 12 * N seconds. A Stripe API outage during webhook processing would cause Hono's default error handler to fire. GitHub API rate limiting (5000 req/hr) is not tracked or respected.

**Recommendation:** Create a `resilient-client` wrapper with configurable retry (exponential backoff), explicit timeout (10s default), and circuit breaker (3 failures in 5 min = skip). Apply it to all external calls.

---

### F-14. Views Layer Scales Linearly with Features

**Severity: P2**
**Category:** Modularity / Maintainability

The HTML view layer consists of two files: `views/layout.ts` (394 lines) and `views/components.ts` (1269 lines). Every new UI component is added to `components.ts`. Every layout variation is added to `layout.ts`.

**Evidence:**
- `views/components.ts` at 1269 lines is the second-largest non-type file
- Route files generate HTML inline via Hono's `html` template literals, mixing business logic with presentation

**Impact:** As the dashboard grows (currently 59 authenticated routes), the views layer becomes a bottleneck. Components have no encapsulation — they're just exported functions in a single file. There is no component discovery or reuse mechanism.

**Recommendation:** Adopt a component-per-file pattern under `views/components/`. Consider HTMX partial responses to reduce full-page rendering.

---

### F-15. Tenant Middleware Creates Default Lifecycle State In-Memory Only

**Severity: P2**
**Category:** Data integrity

When `tenantMiddleware` encounters a product without a lifecycle_state row, it creates a default object in memory but does not persist it to the database.

**Evidence:** `src/middleware/tenant.ts` lines 66-95: The default lifecycle state is constructed but never written back via `INSERT`.

**Impact:** Every request for that product re-creates the default in memory. If a service later tries to `UPDATE lifecycle_state WHERE product_id = ?`, the update affects zero rows because the row does not exist. This could silently prevent lifecycle transitions.

**Recommendation:** Insert the default lifecycle_state row when it's missing (idempotent `INSERT ... ON CONFLICT DO NOTHING`).

---

### F-16. Auth Middleware Cookie Parsing Is Regex-Based

**Severity: P2**
**Category:** Security / Correctness

Cookie extraction uses manual string splitting rather than a proper cookie parser.

**Evidence:** `src/middleware/auth.ts` lines 44-52: `cookie.split(';').map(c => c.trim()).find(c => c.startsWith('__session='))` followed by `.split('=')[1]`.

**Impact:** If the session token contains an `=` character (possible in base64-encoded JWTs), the split will truncate it. Hono provides `getCookie()` from `hono/cookie` which handles edge cases — the import is even visible in `routes/dashboard/index.ts` but not used in the middleware.

**Recommendation:** Replace manual cookie parsing with Hono's `getCookie(c, '__session')`.

---

## Architecture Dependency Map

```
src/index.ts (GOD FILE: 104 imports, 60+ middleware bindings)
  |
  +-- middleware/ (6 files, clean internal deps)
  |     auth.ts -> db/client
  |     tenant.ts -> db/client, types
  |     tier-gate.ts -> db/client, types
  |     rate-limit.ts -> (standalone, in-memory)
  |
  +-- routes/ (84 files)
  |     Each route -> middleware, services, views, db/client
  |     Some routes import services directly (tight coupling)
  |
  +-- services/ (176 files across ~40 directories)
  |     services -> db/client (direct SQL), ../ai/client, types
  |     NO service imports from routes (good)
  |     Cross-service calls: intelligence -> wisdom, scp -> ai, briefing
  |     Jobs file (1865 lines) imports 30+ services (highest fan-out)
  |
  +-- db/
  |     client.ts: primitives + 20 business queries (mixed concerns)
  |     schema.sql: 16 core tables
  |     migrations/: 54+ files with duplicate prefixes
  |
  +-- views/ (2 files, growing linearly)
  +-- types/ (4 files, 1528-line barrel)
```

**Dependency direction:** Generally correct (routes -> services -> db). No reverse dependencies (services importing routes). Cross-service coupling exists but is limited to related domains (e.g., intelligence <-> wisdom).

---

## Scaling Analysis: 100 Products x 12 Agents

| Concern | Current State | At 100 Products |
|---------|--------------|-----------------|
| Hourly agent run | Serial loop, ~12 agents/product | 1200 serial agent sessions, likely >1 hour |
| Daily briefing generation | Serial loop | 100 Anthropic API calls in sequence |
| Cron scheduler | Single process, in-memory | Double-execution on any deploy |
| Rate limiting | In-memory per-process | Ineffective across instances |
| Database | Single Turso instance | ~10K queries/hour from agents alone |
| Anthropic API spend | No cost controls | Unbounded at $0.50-2.00 per agent session |
| Job failure isolation | One product failure logged, loop continues | 1 failure cascading delay to 99 other products |

**Verdict:** The current architecture will struggle past ~20 active products. The serial execution model, in-process scheduling, and lack of concurrency control are the primary limiters.

---

## Positive Architectural Decisions

1. **Clean agent abstraction:** `BaseAgent` with `analyzeAndAct()` contract is well-designed. The 12 agents follow a consistent pattern.
2. **Correct dependency direction:** Services never import routes. The layering is sound.
3. **Tenant isolation at query layer:** Every query scopes by `owner_id`, and non-owned products return 404 (not 403).
4. **Tier gating as preview, not wall:** The gate page HTML approach is product-thoughtful.
5. **Constitution and safety gates:** The 5-gate evolution validation pipeline is architecturally sound for AI safety.
6. **Env validation at startup:** `src/env.ts` fails fast on missing required vars.
7. **SCP lifecycle state machine:** setup -> learning -> operating -> optimizing -> scaling is a well-modeled progression.

---

## Priority Summary

| ID | Severity | Finding |
|----|----------|---------|
| F-01 | P1 | God entrypoint `index.ts` — 512 lines, 104 imports, 60+ manual auth bindings |
| F-02 | P1 | Monolithic jobs file — 1865 lines, 72 jobs, highest fan-out module |
| F-03 | P1 | In-process cron scheduler — no distributed lock, double-execution on scale |
| F-04 | P1 | Duplicate migration prefixes — non-deterministic schema application order |
| F-05 | P1 | Migration failures swallowed — server runs with inconsistent schema |
| F-06 | P1 | No transaction support — partial writes corrupt state |
| F-08 | P1 | No multi-product isolation boundary — fleet ambition architecturally blocked |
| F-13 | P1 | Zero resilience on external calls — no retry, timeout, or circuit breaker |
| F-07 | P2 | 1528-line monotype barrel — all domains in one file |
| F-09 | P2 | SCP agent dynamic import — defeats type checking, untestable |
| F-10 | P2 | In-memory rate limiting — ineffective across instances |
| F-11 | P2 | 422 console.log calls — no structured logging |
| F-12 | P2 | db/client.ts mixes primitives with business queries |
| F-14 | P2 | Views layer scales linearly — 2 files for all UI |
| F-15 | P2 | Tenant middleware default lifecycle state not persisted |
| F-16 | P2 | Auth cookie parsing is regex-based, not using Hono's built-in parser |

**P0 count:** 0 (no finding prevents core features from working today)
**P1 count:** 8 (these create scaling/evolution problems that will block growth)
**P2 count:** 8 (structural debt that increases maintenance cost)
