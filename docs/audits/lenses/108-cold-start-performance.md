# Lens 108 — Cold-Start Performance

**Auditor Persona:** Edge-Case Hunter / Adversary (Tier 3)
**Date:** 2026-04-16
**Scope:** First request after deploy, import chain, migration run, SCP provisioning, time to ready

---

## Executive Summary

Foundry's startup sequence is serial and potentially slow: (1) environment validation, (2) module imports (~100+ TypeScript files), (3) database migration execution (54 migration files, each checked against `schema_migrations`), (4) SCP provisioning for all active products (one Turso query per product, plus agent instance checks), (5) cron scheduler registration (26 jobs), (6) HTTP server binding. The Fly.io health check has a 30-second grace period. A cold start with many products and pending migrations could exceed this, causing the health check to fail and the machine to be marked unhealthy.

---

## Findings

### COLD-01 — Serial migration execution on every startup (Severity: Medium)

**Description:** `runMigrations()` checks every migration file against the `schema_migrations` table, one at a time. With 54 migrations, this is 54 round-trips to Turso even when all are already applied. On cold start with a remote Turso database, latency adds up.

**Evidence:**
- `src/db/migrate.ts:32-33`: Loads all applied migrations, then iterates each file. The check itself is a single query, but each pending migration is applied statement-by-statement.
- `src/db/migrate.ts:36-72`: For each file not in `appliedSet`, splits on semicolons and executes each statement individually.

**Remediation:** Batch the "already applied" check into a single Set lookup (already done). For pending migrations, consider using `db.batch()` for multi-statement execution. Add timing logs to measure actual startup latency.

---

### COLD-02 — SCP provisioning iterates all active products on startup (Severity: Medium)

**Description:** On every server start, the code calls `ensureProvisioned` for every active product. Each call checks agent count (1 Turso query) and potentially inserts 12 agent records. For 100+ products, this is 100+ sequential Turso queries before the server is ready.

**Evidence:**
- `src/index.ts:498-510`: `for (const row of products.rows) { await ensureProvisioned(p.id, p.owner_id) }` — sequential loop.
- `src/services/scp/provisioner.ts:22-28`: `isProvisioned` makes a COUNT query for each product.

**Remediation:** Use `Promise.allSettled()` to parallelize provisioning checks. Or skip provisioning on startup and make it lazy (provision on first access). Add a `provisioned_at` column to `products` to avoid checking every time.

---

### COLD-03 — 30-second health check grace period may be tight (Severity: Medium)

**Description:** The Fly.io health check at `/internal/health` has a 30-second grace period after deploy. The startup sequence (migrations + provisioning + cron setup) must complete within this window.

**Evidence:**
- `fly.toml:28-32`: `grace_period = "30s"`, `interval = "30s"`, `timeout = "10s"`.
- The health endpoint is registered as a public route, so it is available as soon as the HTTP server binds — but the server does not bind until after migrations and provisioning complete.

**Remediation:** Separate the HTTP server binding from the background startup tasks. Bind the server immediately, respond to health checks with `starting` status, and run migrations + provisioning in the background. Switch to `healthy` status when initialization is complete.

---

### COLD-04 — Large import chain loaded synchronously (Severity: Low)

**Description:** `src/index.ts` statically imports ~80+ route and service modules. Each import triggers module evaluation, which may include database client initialization, environment variable reads, and other side effects. This is standard Node.js behavior but contributes to cold-start time.

**Evidence:**
- `src/index.ts:1-134`: ~80 import statements, many importing heavy service modules that themselves import the AI client, database client, etc.

**Remediation:** Consider lazy-loading rarely-accessed routes (e.g., portfolio, investors, exit) using dynamic `import()` in the route handler. This is a micro-optimization and likely not necessary unless cold start exceeds 30 seconds.

---

### COLD-05 — In-memory caches are empty on cold start (Severity: Low)

**Description:** The rate limiter, AI cost tracker, and daily spend tracker are all in-memory Maps. After a restart, all are empty. This means: (1) rate limits are reset (could allow burst), (2) the AI cost ceiling tracker shows $0 spend for the day even if money was spent before restart.

**Evidence:**
- `src/middleware/rate-limit.ts:8`: `const store = new Map<string, RateLimitEntry>()`.
- `src/services/ai/client.ts:21`: `const dailySpend = new Map<string, { cents: number; date: string }>()`.

**Remediation:** For rate limiting: accept the reset (transient burst is unlikely to cause damage). For AI cost tracking: persist daily spend to the database on each AI call, and load on startup. This prevents a deploy from resetting the cost ceiling.

---

## Embarrassment Test

A deploy during peak hours triggers migration check (54 files against remote Turso), SCP provisioning (100+ products), and cron setup. It takes 45 seconds. The Fly.io health check fails after 30 seconds grace period, marks the machine unhealthy, and starts a new one — which also takes 45 seconds. The app is down for 90 seconds. **Likelihood: Low today (few products), High as usage grows.**

## Pride Test

The startup code is well-organized with clear comments. Migration idempotency (swallowing duplicate column errors) is pragmatic. The cron scheduler registration with error handling per job is robust.

## Distinct-Value Declaration

This lens provides a specific startup timeline analysis and identifies the "migrations + provisioning before HTTP binding" pattern as the primary cold-start bottleneck, with a concrete fix: bind HTTP first, initialize in background.

## Tenancy-Critical Flag

**Yes.** Cold start affects all tenants equally — no one can access the application during startup. With a single Fly.io machine, a slow cold start means total downtime.
