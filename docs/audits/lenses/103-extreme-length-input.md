# Lens 103 — Extreme-Length Input Handling

**Auditor Persona:** Edge-Case Hunter / Adversary (Tier 3)
**Date:** 2026-04-16
**Scope:** Input length validation, DB column limits, UI breakage, memory exhaustion, AI prompt injection via length

---

## Executive Summary

Foundry has dangerously inconsistent input length validation. Only 3 of ~82 route files use the `validateBody` middleware with Zod schemas. The vast majority of routes parse request bodies with `c.req.json()` or `c.req.parseBody()` and cast directly to `Record<string, unknown>` with zero validation. SQLite TEXT columns have no inherent length limit, meaning a 100MB product description would be accepted and stored. The 1GB RAM Fly.io machine makes memory exhaustion via oversized inputs a realistic denial-of-service vector.

---

## Findings

### LEN-01 — Majority of routes have zero input validation (Severity: Critical)

**Description:** Only 3 route files (`onboarding.ts`, `metrics.ts`, `ask.ts`) use Zod validation via `validateBody`. All other routes accept arbitrary-length input and pass it directly to SQL queries or AI prompts.

**Evidence:**
- Grep for `validateBody|zod|z\.` in `src/routes` returned only 3 files.
- `src/routes/api/supercharge.ts`: 15+ endpoints all use `await c.req.json() as Record<string, unknown>` with zero validation.
- `src/routes/api/tier2.ts`: 8+ endpoints, same pattern.
- `src/routes/api/tier3.ts`: 3+ endpoints, same pattern.
- `src/routes/api/tier4.ts`: 3+ endpoints, same pattern.
- `src/routes/api/mobile.ts`: Uses typed `c.req.json<{...}>()` but this is only TypeScript — no runtime validation.

**Remediation:** Add Zod schemas and `validateBody` middleware to every POST/PUT/PATCH route. Set `.max()` limits on all string fields. Priority: API routes and any route accepting product names, descriptions, or free text.

---

### LEN-02 — SQLite TEXT columns have no length constraints (Severity: High)

**Description:** No column in `schema.sql` has a length CHECK constraint. A product name, competitor positioning, decision `what` field, or any TEXT column can store arbitrarily large values. SQLite does not enforce VARCHAR lengths.

**Evidence:**
- `src/db/schema.sql`: `name TEXT NOT NULL` (products), `what TEXT NOT NULL` (decisions), `interview_summary TEXT` (beta_intake), `content TEXT NOT NULL` (founding_story_artifacts) — all unbounded.
- Only the `createProductSchema` in onboarding enforces `.max(100)` on the product name — but this is only used on the onboarding route, not on product update routes.

**Remediation:** Add CHECK constraints in a migration: `CHECK(length(name) <= 200)` for product names, `CHECK(length(what) <= 5000)` for decisions, etc. Also enforce in Zod schemas at the application layer.

---

### LEN-03 — AI prompts constructed with unbounded user content (Severity: High)

**Description:** AI system and user prompts are built by string concatenation with user-supplied content (product names, DNA text, decision text, competitor descriptions). A 1MB product description would create a multi-megabyte prompt, exhausting the Anthropic token limit and potentially the 1GB server memory.

**Evidence:**
- `src/services/audit/remediation.ts:165-172`: User prompt includes `fileContext` (all relevant file contents concatenated) with no size limit.
- `src/services/ai/client.ts`: No input length check before API call. The `maxTokens` parameter only limits output, not input.
- AI cost ceiling tracks output cost but not input token cost as a limiting factor for prompt size.

**Remediation:** Truncate all user-supplied content before prompt construction. Add a maximum prompt length constant (e.g., 100KB) and reject or truncate inputs that exceed it.

---

### LEN-04 — Request body size not limited at framework level (Severity: High)

**Description:** There is no global body size limit configured in Hono or the Node.js HTTP server. The default Node.js HTTP server will buffer the entire request body in memory.

**Evidence:**
- `src/index.ts`: No body parser limit configuration.
- No `c.req.raw.headers['content-length']` check in any middleware.
- Hono does not impose body size limits by default.

**Remediation:** Add a global middleware that checks `Content-Length` and rejects requests larger than a reasonable limit (e.g., 1MB). Alternatively, configure the body parser with a size limit.

---

### LEN-05 — URL parameter length not validated (Severity: Medium)

**Description:** Route parameters like `:id` and `:productId` are passed directly to SQL queries without length validation. While parameterized queries prevent SQL injection, a 100KB ID string would be passed through the full middleware chain and database lookup.

**Evidence:**
- `src/middleware/tenant.ts:31`: `const productId = c.req.param('id') || c.req.param('productId');` — no length check.
- All route handlers use `c.req.param()` without length validation.

**Remediation:** Add a quick length check: `if (productId.length > 30) return c.json({ error: 'Invalid ID' }, 400);`. NanoID generates 21-character IDs.

---

## Embarrassment Test

An attacker sends a 50MB JSON body to `/api/decisions` with a decision `what` field containing 50MB of text. The single-instance Fly.io machine runs out of memory, crashes, and takes 30+ seconds to restart. All 26 cron jobs miss their windows. Every active founder sees a blank page. **Likelihood: High. This is a trivial DoS vector.**

## Pride Test

The onboarding flow does validate product names with `z.string().max(100)`, showing the team knows how to do this — it just has not been applied systematically.

## Distinct-Value Declaration

This lens quantifies the validation gap: 3 out of 82+ route files validate input. The remaining 79 accept arbitrary-length input with zero guards, creating both DoS and cost-amplification (AI billing) attack surfaces.

## Tenancy-Critical Flag

**Yes.** A memory exhaustion DoS affects all tenants because there is a single shared Fly.io instance. One attacker with oversized requests can crash the service for all founders.
