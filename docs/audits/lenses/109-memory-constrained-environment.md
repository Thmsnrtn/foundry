# Lens 109 — Memory-Constrained Environment

**Auditor Persona:** Edge-Case Hunter / Adversary (Tier 3)
**Date:** 2026-04-16
**Scope:** Fly.io shared-cpu-2x with 1GB RAM, 26 cron jobs + web server + in-memory caches, memory budget

---

## Executive Summary

Foundry runs on a shared-cpu-2x Fly.io VM with 1024MB RAM. The application co-locates the HTTP server, 26 cron jobs, in-memory rate limit store, in-memory AI cost tracker, and potentially large AI response buffers — all in a single Node.js process. There is no memory budgeting, no memory pressure monitoring, and no limit on the number of concurrent AI calls. A single Claude Opus response can be 16KB+ of text; processing 50 products' audit pipelines concurrently during cron could consume hundreds of MB in request/response buffers alone.

---

## Findings

### MEM-01 — No Node.js heap size configuration (Severity: Medium)

**Description:** The Dockerfile and fly.toml do not set `--max-old-space-size`. Node.js defaults to approximately 75% of available memory (~768MB on 1GB). With the OS and other overhead, the actual available heap may be lower.

**Evidence:**
- `fly.toml:33-36`: `memory = "1024mb"`, `cpu_kind = "shared"`, `cpus = 1`.
- No `NODE_OPTIONS=--max-old-space-size=` in environment configuration.

**Remediation:** Explicitly set `NODE_OPTIONS=--max-old-space-size=768` in `fly.toml [env]` to leave headroom for the OS and non-heap memory.

---

### MEM-02 — In-memory rate limit store grows unbounded (Severity: Medium)

**Description:** The rate limit store is a `Map<string, RateLimitEntry>` that grows with every unique IP address. The cleanup interval (60 seconds) removes expired entries, but during a traffic spike or bot attack, thousands of entries can accumulate between cleanups.

**Evidence:**
- `src/middleware/rate-limit.ts:8`: `const store = new Map<string, RateLimitEntry>()`.
- Cleanup only runs every 60 seconds (line 14-18). Between cleanups, a botnet sending from 100,000 unique IPs creates 100,000 map entries.

**Remediation:** Add a maximum store size. When the limit is reached, reject new entries (fail-open for rate limiting) or evict oldest entries. Consider: `if (store.size > 100000) store.clear()`.

---

### MEM-03 — AI daily spend tracker is per-product, in-memory (Severity: Low)

**Description:** The `dailySpend` Map in `src/services/ai/client.ts` stores one entry per product. With 1000 products, this is trivial (~100KB). However, it is never persisted, so a restart resets all cost tracking.

**Evidence:**
- `src/services/ai/client.ts:21`: `const dailySpend = new Map<string, { cents: number; date: string }>()`.
- Not a memory concern at current scale, but the lack of persistence is a cost-control gap.

**Remediation:** Persist daily spend to DB. This solves both the memory concern (at scale) and the restart-reset problem.

---

### MEM-04 — Concurrent cron jobs can multiply memory usage (Severity: High)

**Description:** The 26 cron jobs run in-process. If multiple jobs fire simultaneously (e.g., the hourly SCP scheduler processes 100 products, each triggering an AI call), the combined in-flight request and response buffers can spike memory significantly. Each AI response is up to 16KB of text, but the full request context (file contents, prompt) can be much larger.

**Evidence:**
- `src/services/audit/remediation.ts:144`: `fileContext` is built by concatenating all relevant file contents — potentially megabytes per audit.
- `src/services/ai/client.ts:77-79`: AI response buffered in memory as `textContent`.
- No concurrency limit on AI calls within a single job run.

**Remediation:** Add a semaphore to limit concurrent AI calls (e.g., max 3 simultaneous calls). Use `p-limit` or a simple counter-based semaphore. This limits peak memory usage and also protects against Anthropic rate limits.

---

### MEM-05 — Static file serving reads files into memory on every request (Severity: Low)

**Description:** The static file handler uses `readFileSync` on every request, reading the entire file into a string buffer. For small CSS/JS files this is negligible, but there is no caching layer.

**Evidence:**
- `src/index.ts:185-193`: `const content = readFileSync(filePath, 'utf-8');` — synchronous read on every request, result not cached.

**Remediation:** Cache static file contents in memory at startup, or use Hono's `serveStatic` middleware which handles this automatically.

---

## Embarrassment Test

The SCP scheduler fires at the top of the hour, triggering AI analysis for 100 products simultaneously. Each analysis builds a multi-KB prompt and receives a multi-KB response. Total in-flight memory: ~500MB. The rate limit store has 50,000 entries from a bot scan. Node.js hits the heap limit, triggers a garbage collection storm, and the process becomes unresponsive. Fly.io's health check fails, kills the machine, and starts a new one — which immediately gets overwhelmed by the same workload. **Likelihood: Medium as product count grows.**

## Pride Test

The AI cost ceiling per product ($25/day) is a smart financial safeguard that indirectly limits memory usage. The Fly.io configuration with auto_start_machines = true ensures the machine restarts after OOM.

## Distinct-Value Declaration

This lens provides a concrete memory budget analysis: 1024MB total, ~768MB usable heap, with specific consumption sources (rate limiter, AI buffers, cron job concurrency) and their growth characteristics. The key finding is the missing concurrency limit on AI calls within cron jobs.

## Tenancy-Critical Flag

**Yes.** Memory exhaustion on the shared single-instance machine is a total outage affecting all tenants. There is no per-tenant memory isolation.
