# Lens 55 — Connection Pool Reviewer

**Auditor perspective:** Turso client connection management, connection limits, timeouts, stale connections, and connection lifecycle in a long-running single-process server.

**Date:** 2026-04-16
**Codebase snapshot:** `@libsql/client` singleton in `src/db/client.ts`, used by ~176 service files

---

## Executive Summary

Foundry uses a single Turso client singleton (`_client`) created lazily on first use and never refreshed, closed, or health-checked for the lifetime of the process. The `@libsql/client` library manages its own HTTP connection pooling internally (Turso uses HTTP/WebSocket transport, not traditional TCP connection pools), but the application makes no attempt to configure connection limits, timeouts, or keep-alive behavior. There is no connection health check, no reconnection logic, and no handling of Turso service disruptions. The singleton pattern means all 72 cron jobs and all HTTP request handlers share a single client instance with no backpressure ��� a burst of concurrent AI agent runs (each making multiple DB queries) competes with user-facing HTTP requests for the same connection resources.

---

## Findings

### CONN-01. Single Client Singleton with No Health Check

**Severity: P1**

`src/db/client.ts:8-28` creates a single `_client` instance that lives for the entire process lifetime. If the underlying connection to Turso becomes stale (network hiccup, Turso restart, token expiration), all subsequent queries fail with connection errors. There is no health check, no reconnection mechanism, and no way to recover without restarting the process.

**Evidence:**
- `src/db/client.ts:8` — `let _client: Client | null = null`
- `getDb()` at line 10-28 — creates client once, returns same instance forever
- No periodic health check (e.g., `SELECT 1` every 30 seconds)
- No error handling that recreates the client on connection failure
- The `PRAGMA foreign_keys = ON` at line 22 is the only query run at initialization

**Remediation:** Add a `healthCheck()` function that runs `SELECT 1` and recreates the client if it fails. Call this from the `/internal/health` endpoint. Add a `reconnect()` function that sets `_client = null` and triggers re-creation on next call. Consider a wrapper that catches connection errors and retries with a fresh client.

**Target phase:** P1

---

### CONN-02. No Configuration of Turso Client Timeout or Concurrency

**Severity: P1**

The `createClient()` call at line 16-18 passes only `url` and `authToken`. The `@libsql/client` library accepts additional options like `concurrency` (max concurrent requests), `fetch` (custom fetch implementation with timeout), and `intMode` (integer handling). None are configured.

**Evidence:**
- `src/db/client.ts:16-18` — `createClient({ url, authToken: authToken || undefined })`
- No `concurrency` limit — defaults to unlimited concurrent requests
- No request timeout — a slow Turso response can hang indefinitely
- No `fetch` override for custom timeout/retry behavior
- Turso's default behavior under load is undocumented for the specific client version in use

**Remediation:** Configure the client with explicit options: `createClient({ url, authToken, concurrency: 50 })`. Add a fetch wrapper with a timeout: `fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) })`. This prevents a single slow query from blocking the entire application.

**Target phase:** P1

---

### CONN-03. Auth Token Never Refreshed — Expiration Causes Full Outage

**Severity: P1**

Turso auth tokens have an expiration time. The application reads `TURSO_AUTH_TOKEN` from the environment once at process start (`src/db/client.ts:13`) and never refreshes it. If the token expires while the process is running, all database operations fail.

**Evidence:**
- `src/db/client.ts:13` — `const authToken = process.env.TURSO_AUTH_TOKEN`
- The token is passed to `createClient()` once
- No token refresh mechanism
- No detection of auth token expiration errors
- Fly.io secrets are set at deploy time; if the token is rotated, a redeploy is required

**Remediation:** Catch authentication errors from Turso (HTTP 401/403) and attempt to read a fresh token from the environment or a secrets manager. At minimum, log a specific error message when auth token expiration is detected so operators know to redeploy.

**Target phase:** P1

---

### CONN-04. No Backpressure Between Cron Jobs and HTTP Handlers

**Severity: P2**

All 72 cron jobs and all HTTP request handlers share the single Turso client. When the hourly `scp_agent_runner` fires and iterates all products (each agent making 5-10 DB queries), it competes with user-facing dashboard requests for the same connection resources. A burst of AI agent runs can starve the dashboard of database connections.

**Evidence:**
- `src/services/scp/scheduler.ts:29-58` — `runDueAgentsForAllProducts` iterates all products sequentially
- Each product's agent run makes multiple `query()` calls through the shared `getDb()` singleton
- HTTP handlers like `src/routes/dashboard/index.ts` also call `query()` through the same singleton
- No priority mechanism, no separate client for background jobs vs. interactive requests
- The `scp_playbook_eval` job runs every hour and the `scp_priority_rebuild` runs every 30 minutes

**Remediation:** Create two client instances: one for interactive HTTP requests (`getInteractiveDb()`) and one for background jobs (`getBackgroundDb()`). Configure the interactive client with higher concurrency and lower timeout. Alternatively, implement a simple priority queue wrapper.

**Target phase:** P2

---

### CONN-05. Graceful Shutdown Does Not Close Database Client

**Severity: P2**

The graceful shutdown handler (`src/index.ts:542-555`) sets a 4-second drain timer and calls `process.exit(0)`. It does not call `_client.close()` (or equivalent) to properly close the Turso client connection. While Node.js will close connections on exit, not calling `close()` may leave server-side resources allocated.

**Evidence:**
- `src/index.ts:542-555` — `gracefulShutdown` function
- No `getDb().close()` call anywhere in the codebase
- The `@libsql/client` `Client` interface has a `close()` method
- During the 4-second drain window, in-flight queries may complete, but the connection is not explicitly closed

**Remediation:** Add `getDb().close()` to the graceful shutdown handler before `process.exit(0)`. Reset `_client = null` to prevent any post-shutdown queries from attempting to use a closed client.

**Target phase:** P2

---

## Embarrassment Test

1. **"A single Turso client singleton serves all 72 cron jobs and all HTTP requests with no concurrency limit, timeout, or health check"** — A Turso service hiccup permanently breaks the server until it is restarted.

2. **"Turso auth token expiration causes a full database outage with no detection, logging, or recovery mechanism"** — The process keeps running and serving 500 errors until someone manually redeploys.

3. **"The hourly SCP agent runner (making hundreds of DB queries) competes with user-facing dashboard requests through the same connection, with no backpressure or priority"** — Founders trying to view their dashboard during agent run time get slow or failed responses.

## Pride Test

1. The `batch()` function correctly uses Turso's `'write'` transaction mode, which is the recommended way to handle multi-statement writes with the `@libsql/client`.

2. The PRAGMA `foreign_keys = ON` attempt shows awareness that SQLite defaults to FK enforcement off, and the intent to enable it is correct even if the implementation is fragile.

3. The lazy initialization pattern in `getDb()` avoids creating a connection during module import, which is correct for environments where `TURSO_DATABASE_URL` may not be set (e.g., tests).

## Distinct-Value Declaration

This lens analyzes the Turso-specific connection management model, which differs fundamentally from traditional SQL connection pooling. Turso uses HTTP transport, not persistent TCP connections, so the usual "pool size" concerns don't apply ��� instead, the concerns are about HTTP concurrency limits, request timeouts, and auth token lifecycle. No Tier 1 lens examines these Turso-specific semantics.

## Tenancy-Critical Flag

**CONN-01** and **CONN-03** are tenancy-critical. A stale connection or expired auth token causes a complete outage for all tenants simultaneously. **CONN-04** affects quality of service: background jobs for one tenant's product can degrade interactive response times for all other tenants.
