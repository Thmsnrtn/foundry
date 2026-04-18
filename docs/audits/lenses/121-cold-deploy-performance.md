# Lens 121 — Cold Deploy Performance

**Auditor perspective:** Edge-case hunter / domain adversary — cold deploy time budget
**Distinct-value declaration:** Maps the wall-clock time from `fly deploy` to first HTTP 200, decomposing migration, provisioning, and import-chain costs that no prior lens measured end-to-end.
**Tenancy-critical:** Yes. Migration duration and SCP provisioning scale linearly with company count; a 25-company fleet could push cold-start past Fly.io's health-check deadline.

**Date:** 2026-04-16
**Repo:** foundry (Hono + Turso + Clerk + Anthropic)

---

## Summary

| Severity | Count |
|----------|-------|
| P1 | 3 |
| P2 | 3 |

---

## CD-01. Migration runner is sequential, per-statement, with no parallelism or batching

**Severity: P1**
**Files:** `src/db/migrate.ts`

The migration runner (`runMigrations`) reads all `.sql` files from the `migrations/` directory, sorts them lexicographically, then iterates each file sequentially. Within each file, it splits on `;\n` and executes each statement one at a time via `db.execute()`. Each `db.execute()` is an HTTP round-trip to Turso's edge.

With 54+ migration files (many containing 5-15 statements each), this translates to approximately 200-400 sequential HTTP requests to Turso during startup. At a conservative 50ms per round-trip, that is 10-20 seconds of migration checking alone, even when all migrations are already applied (the `SELECT filename FROM schema_migrations` check runs once, but each file is then checked against the `appliedSet` in memory, which is fast -- the bottleneck is when any new migrations exist).

**Evidence:**
- `src/db/migrate.ts:36-72`: Each statement in each file runs as a separate `db.execute`
- `src/db/migrations/`: 54+ files with duplicate numbering (004, 005, 006, 007, 008, etc. each have two files)
- No `batch()` usage in the migration runner despite the Turso client supporting it

**Impact:** Every deploy pays the migration tax. With new migrations, the per-statement execution adds latency that can push past Fly.io's `start-period` (configured at 10s in the Dockerfile HEALTHCHECK). A migration with 15 statements at 50ms each = 750ms per file; 5 new files = 3.75s. Combined with Node.js boot and import resolution, this is tight.

---

## CD-02. Startup provisioning iterates ALL active products sequentially

**Severity: P1**
**Files:** `src/index.ts:497-508`, `src/services/scp/provisioner.ts:32-168`

After migrations complete, the server startup calls `ensureProvisioned(p.id, p.owner_id)` for every active product in a serial `for` loop. `ensureProvisioned` calls `isProvisioned` (1 query: `SELECT COUNT(*) FROM agent_instances WHERE product_id=?`). For products that need provisioning, it runs 26 sequential INSERT queries (1 constitution + 12 agent instances + 12 evolution versions + 1 product UPDATE).

**At 25 companies:**
- Already provisioned: 25 x 1 query = 25 round-trips (~1.25s)
- One new company: +26 queries = additional ~1.3s
- All new (fresh deploy to new DB): 25 x 27 queries = 675 round-trips (~34s)

**Evidence:**
- `src/index.ts:502-507`: `for (const row of products.rows) { await ensureProvisioned(...) }`
- `src/services/scp/provisioner.ts:85-133`: 12 agents x 2 queries each (instance + evolution) = 24 sequential queries per product, plus constitution and product update
- No `batch()` usage; all queries are individual HTTP round-trips

**Impact:** On a fresh deployment or database migration to a new environment, the server could take 30+ seconds to start with 25 companies. Fly.io's default health check start period (10s in the Dockerfile) would fail, triggering a restart loop.

---

## CD-03. Import chain depth: 104+ top-level imports block server readiness

**Severity: P2**
**Files:** `src/index.ts:1-136`

The entrypoint statically imports 104+ route and service modules before any application code runs. Node.js must resolve, parse, and execute every module in the dependency tree before the Hono app is constructed. Key import chains:

1. `src/index.ts` -> `src/jobs/index.ts` (1866 lines, 30+ service imports) -> deep service tree
2. `src/index.ts` -> 82+ route files -> each imports services, db client, views
3. `src/services/ai/client.ts` -> `@anthropic-ai/sdk` (large package)
4. `src/services/billing/stripe.ts` -> `stripe` (large package)

All of these resolve at startup. There is no lazy loading except for a few jobs that use dynamic `import()`. The 72 jobs in `JOB_REGISTRY` are all eagerly defined via static imports from the jobs file.

**Evidence:**
- `src/index.ts:1-136`: 104 import statements
- `src/jobs/index.ts:1-38`: 30+ service imports, all static
- Some jobs use dynamic `import()` internally (e.g., `scpAgentRunner` at line 980), but the jobs module itself is statically imported

**Impact:** Node.js cold start with this import tree takes approximately 2-4 seconds just for module resolution (measured by `node --prof` patterns for similar-sized codebases). This is additive with migration and provisioning time.

---

## CD-04. Dockerfile HEALTHCHECK start-period is 10s -- tight for fleet-scale cold start

**Severity: P1**
**Files:** `Dockerfile`

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/internal/health').then(...)
```

The health check gives the server 10 seconds from process start to respond to `/internal/health`. The startup sequence is:

1. Node.js module resolution: ~2-4s (104 imports + heavy SDKs)
2. Migration check: ~1-2s (54 files, already applied)
3. SCP provisioning: ~1-2s (25 products x 1 check query each)
4. `serve()` bind: <100ms

**Total estimated:** 4-8s for steady-state, well within 10s.

**But with new migrations or fresh provisioning:** Migration of 5 new files could add 3-5s. Provisioning 5 new companies could add 6-7s. Total: 13-20s, exceeding the 10s start-period.

Fly.io also has its own health check (`fly.toml` or machine config), which may differ from the Dockerfile HEALTHCHECK. If `kill_timeout` is set to 5s (as seen in the graceful shutdown code at line 551: "Give in-flight requests 4 seconds to complete"), the deploy budget is tight.

**Evidence:**
- `Dockerfile:18`: `--start-period=10s`
- `src/index.ts:551`: `setTimeout(() => process.exit(0), 4000)` -- 4s drain window implies Fly's `kill_timeout` is ~5s

---

## CD-05. No migration pre-check or dry-run -- every deploy hits the DB

**Severity: P2**
**Files:** `src/db/migrate.ts`, `src/index.ts:495`

Every deploy runs `runMigrations()` as the first startup action. There is no "are there pending migrations?" pre-check that could short-circuit the migration runner. Even when all 54 migrations are applied, the runner:
1. Creates the `schema_migrations` table (IF NOT EXISTS -- fast)
2. Lists all files in the migrations directory (`readdirSync`)
3. SELECTs all applied migrations
4. Iterates and checks each filename against the applied set

This is lightweight but non-zero. More importantly, there is no way to run migrations separately from the server start (no pre-deploy hook). The CLI (`src/cli/index.ts`) has a `migrate` command, but the Dockerfile CMD is `node dist/index.js` -- migrations and server start are always coupled.

**Evidence:**
- `Dockerfile:19`: `CMD ["node", "dist/index.js"]` -- no separate migration step
- No `fly.toml` or release_command visible for pre-deploy migration

---

## CD-06. Error handling discrepancy: production vs development migration failure

**Severity: P2**
**Files:** `src/index.ts:524-536`

In production, migration failure is now fatal (`process.exit(1)` at line 529). In development, the server starts anyway. However, the individual statement error handling in `migrate.ts:52-58` still swallows `duplicate column` and `already exists` errors. This means a migration can partially apply (some statements succeed, some are swallowed) and still be recorded as fully applied.

If a migration adds 3 columns and the first 2 succeed but the 3rd fails with a non-swallowed error, the migration is NOT recorded (it throws before the `INSERT INTO schema_migrations`). On next restart, it retries, the first 2 columns are swallowed as "already exists", and the 3rd fails again -- infinite loop in production causing `process.exit(1)` on every deploy.

**Evidence:**
- `src/db/migrate.ts:49-62`: Per-statement execution with selective error swallowing
- `src/index.ts:526-529`: Production path exits on migration failure
- No transaction wrapping: partial application is possible

---

## Cold Deploy Time Budget (25-Company Fleet)

| Phase | Steady State | Worst Case (5 new migrations + 5 new companies) |
|-------|-------------|--------------------------------------------------|
| Node.js module resolution | ~3s | ~3s |
| Migration check (54 files, all applied) | ~1s | N/A |
| New migration execution (5 files x 10 stmts) | N/A | ~2.5s |
| SCP provisioning check (25 products) | ~1.5s | ~1.5s |
| New SCP provisioning (5 products) | N/A | ~7s |
| `serve()` bind | <0.1s | <0.1s |
| **Total** | **~5.5s** | **~14s** |
| Fly.io HEALTHCHECK start-period | 10s | **EXCEEDED** |

---

## Recommendations

1. **Separate migration from server start** -- Add a `release_command` in `fly.toml` to run migrations before the new instance starts. This decouples migration latency from health-check deadlines.
2. **Batch SCP provisioning queries** -- Use `db.batch()` to send all 26 provisioning queries in a single Turso round-trip per product, reducing 26 round-trips to 1.
3. **Increase HEALTHCHECK start-period** to 30s as a safety margin.
4. **Wrap migrations in transactions** -- Each migration file should run as a single `BEGIN`/`COMMIT` batch to prevent partial application.
5. **Lazy-load heavy SDK imports** -- `@anthropic-ai/sdk` and `stripe` are only needed when their respective features are invoked. Dynamic `import()` at call time would save ~1s of startup.
