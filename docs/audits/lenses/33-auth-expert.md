# Lens 33 — Authentication / Authorization Expert (Multi-Org, Multi-Company)

**Auditor perspective:** Auth flows, session management, role-based access, multi-org support, API key management, token lifecycle, and whether the auth system supports the multi-company fleet model.

**Date:** 2026-04-16

---

## Executive Summary

Foundry has a reasonable auth foundation (Clerk JWT, product-ownership scoping, 404-not-403 pattern), but the authorization layer has **multiple P0 and P1 issues** that could enable privilege escalation, data leakage across tenants, and authentication bypass on several routes. The RBAC system exists in schema and service code but is **never actually enforced on any route**. Portfolio API keys are stored in plaintext. Several webhook endpoints have broken authentication. The multi-org/multi-company model is founder-scoped only; there is no true organization entity, making team-based multi-company management structurally impossible.

---

## Findings

### P0 — Critical (Auth Bypass / Privilege Escalation)

#### P0-01: Portfolio API routes have no ownership validation

**Files:** `src/routes/api/platform.ts` (lines 305-337)

The portfolio endpoints (`POST /api/portfolios/:id/companies`, `GET /api/portfolios/:id/overview`, `GET /api/portfolios/:id/benchmark/:productId`, `POST /api/portfolios/:id/snapshot`) accept an arbitrary portfolio ID from the URL and operate on it without checking that the authenticated founder owns or has access to that portfolio.

Any authenticated founder can:
- Add their own products to any portfolio
- View the complete overview of any portfolio (MRR, company count, risk states)
- Run benchmarks against any portfolio's products
- Trigger snapshot generation for any portfolio

The `addToPortfolio` endpoint is especially dangerous: it accepts `founder_id` from the request body, meaning an attacker can add any product to any portfolio while impersonating any founder.

```typescript
// No ownership check at all:
platformApiRoutes.post('/api/portfolios/:id/companies', async (c) => {
  const body = await c.req.json();
  await addToPortfolio(c.req.param('id'), body.product_id, body.founder_id, ...);
});
```

#### P0-02: Transcript webhook authentication is completely broken

**File:** `src/routes/api/webhooks/transcripts.ts` (lines 14-21)

The `getProductIdForApiKey` function has two fatal bugs:
1. It passes the **raw API key** directly as the `key_hash` query parameter. The `api_keys` table stores SHA-256 hashes, so this will **never match** a legitimately created key. The correct flow (used by `validateApiKey` in `rbac/permissions.ts`) hashes the key first.
2. It checks `is_active = 1`, but the `api_keys` table has no `is_active` column; it uses `revoked_at IS NULL` for active keys.

This means: (a) legitimate transcript webhooks will always fail auth, and (b) if an attacker finds a way to insert a row where `key_hash` matches a raw token literal, they bypass auth. In practice this is a broken endpoint, not a live exploit, but it demonstrates a dangerous pattern of ad-hoc auth bypass.

#### P0-03: Internal ecosystem routes lack access control on sensitive operations

**File:** `src/routes/internal/ecosystem.ts`

The `/internal/operator/dashboard-data` endpoint accepts `product_id` as a query parameter and returns the full operational state (risk state, stressors, MRR decomposition, metrics, decisions count) for **any product**. The only protection is the ecosystem service key, which is a single shared secret. If leaked, every product's data is exposed.

The `/internal/conversion-signal` endpoint writes to the `audit_log` table for **any product_id** without verifying the product exists or the caller has access to it.

#### P0-04: RBAC middleware exists but is never applied to any route

**Files:** `src/middleware/rbac.ts`, all files in `src/routes/`

The `requirePermission()` and `requireRole()` middleware functions are fully implemented but **zero routes** use them (confirmed by grep). This means:
- The `account_roles` table and role system defined in migration 024 are dead code
- Any authenticated founder with team access can perform all operations regardless of their role
- The viewer/analyst/admin/owner distinction in the RBAC system provides no actual enforcement
- The `team` feature (inviting co-founders with roles) is security theater: role assignment works, but the roles grant no differential access

#### P0-05: Voice session endpoint lacks product ownership validation

**File:** `src/routes/api/platform.ts` (lines 253-264)

The `POST /api/voice/session/:id/end` endpoint accepts a session ID and body data but never validates that the authenticated founder owns the voice session. Any authenticated user who can guess or enumerate session IDs can inject transcript data into another founder's voice sessions.

Similarly, `POST /api/voice/memo` accepts `product_id` from the body but the ownership check only happens against the founder context, not the specific product_id (which could belong to another founder).

---

### P1 — High (Weak Session Management / Missing Enforcement)

#### P1-01: Cookie parsing is naive and fragile

**File:** `src/middleware/auth.ts` (lines 43-53)

Session token extraction from cookies uses manual string splitting:
```typescript
const sessionCookie = cookie.split(';').map(c => c.trim()).find(c => c.startsWith('__session='));
token = sessionCookie.split('=')[1] ?? null;
```

If the JWT token itself contains an `=` character (which base64url can produce in some edge cases, and which is common in cookie values with encoding), this `split('=')[1]` truncates the token. The Hono framework has built-in cookie parsing (`getCookie`) that should be used instead.

#### P1-02: `foundry_product` cookie lacks `Secure` flag

**File:** `src/routes/dashboard/index.ts` (lines 111-116)

The product-selection cookie is set with `httpOnly: true` and `sameSite: 'Lax'` but **no `Secure` flag**. On HTTP connections (including development or misconfigured production), this cookie is transmitted in cleartext, enabling product ID interception. More critically, the `maxAge` is one year, creating a very long window for this exposure.

#### P1-03: Portfolio API keys stored in plaintext

**Files:** `src/db/migrations/033_portfolio_mode.sql`, `src/services/portfolio/manager.ts`

Portfolio API keys (`pfk_*` format) are stored directly in the `portfolios.api_key` column as plaintext. Unlike the `api_keys` table (which properly stores SHA-256 hashes), portfolio keys can be read directly from the database. The `authenticatePortfolioKey` function does a direct plaintext comparison:
```typescript
const result = await query('SELECT id FROM portfolios WHERE api_key = ?', [apiKey]);
```

This is inconsistent with the proper key management in `rbac/permissions.ts` and means a database dump exposes all portfolio API keys.

#### P1-04: GitHub access tokens stored in plaintext

**File:** `src/db/schema.sql` (line 32)

The schema comments say `-- Encrypted` for `github_access_token`, but there is no encryption anywhere in the codebase (confirmed by grep: no `encrypt`/`decrypt`/`cipher` functions exist in any source file). Tokens are stored and read as raw strings throughout the codebase. A database compromise exposes every connected GitHub repository.

#### P1-05: Integration credentials stored in plaintext

**Files:** `src/db/migrations/008_integrations.sql`, `src/services/integrations/sync.ts`

The migration comments say `credentials_json is encrypted at rest in production`, but no encryption code exists. Credentials (Stripe API keys, PostHog keys, Intercom tokens, Linear tokens) are stored as raw JSON. The sync service reads them with a simple `JSON.parse`.

#### P1-06: No CSRF protection on state-changing forms

**Files:** All dashboard routes with `method="POST"` forms

The application renders server-side HTML with POST forms (product switching, checkout, share token generation, ingest token generation, wisdom toggle, team invitations, decision approval) but implements **no CSRF protection** whatsoever. No CSRF tokens are generated, embedded in forms, or validated on submission. The `sameSite: 'Lax'` on the product cookie provides partial browser-level protection for cross-origin form submissions, but same-site attacks and older browsers remain vulnerable.

#### P1-07: Ecosystem service key is optional — internal routes silently exposed

**File:** `src/env.ts` (line 32), `src/middleware/internal.ts`

`ECOSYSTEM_SERVICE_KEY` is marked as `required: false` in environment validation. If not set, the internal middleware returns a 500 error, but this is fragile: an operator might assume the routes simply won't be available rather than returning 500s that leak the existence of internal endpoints. The key should be required if the routes are mounted.

#### P1-08: Ingest and share tokens are not rate-limited per-token

**Files:** `src/routes/ingest/index.ts`, `src/routes/share/index.ts`

The ingest endpoint (`POST /ingest/:token`) accepts arbitrary metric data for any product with a valid token. There is no per-token rate limit; a leaked ingest token allows unlimited metric injection (data poisoning). The share endpoint has no abuse protection either; an attacker with a share token can scrape product data continuously.

#### P1-09: Clerk `verifyToken` called with `as any` cast

**File:** `src/middleware/auth.ts` (line 67)

The Clerk token verification options are cast to `as any`, suppressing TypeScript's type checking on the verification parameters. If the Clerk SDK changes its API or the `issuer` callback format changes, this will fail silently rather than at compile time.

#### P1-10: Auto-provisioning race condition on failed Clerk webhook

**File:** `src/middleware/auth.ts` (lines 82-101)

If the Clerk webhook fails and a user logs in, the auth middleware auto-provisions a founder record by calling Clerk's `getUser` API. However:
1. If auto-provisioning fails (line 99), the error is swallowed with `console.error` and the user gets a generic 401 redirect to login, creating a login loop
2. There is no deduplication lock; concurrent requests can trigger multiple Clerk API calls and INSERT attempts
3. The `ON CONFLICT DO NOTHING` prevents duplicate inserts but still wastes Clerk API quota

---

### P2 — Medium

#### P2-01: `decision_patterns` table has no access control boundary

**Files:** `src/db/schema.sql` (lines 265-287), `src/services/decisions/patterns.ts`

The `decision_patterns` table is deliberately cross-product and "anonymized," but any founder can query aggregated decision patterns for market categories they don't belong to. While the data is intended to be anonymized, the `market_category` field plus `key_metrics_context` JSON could enable de-anonymization for small market segments. There is no opt-out mechanism at the pattern contribution level (the wisdom toggle only controls a boolean on the founder record, but the `recordPattern` function does not check it).

#### P2-02: API key creation always assigns `viewer` role regardless of request

**File:** `src/services/rbac/permissions.ts` (line 120)

The `createApiKey` function hardcodes `role: 'viewer'` for all API keys. The caller passes `scopes`, but the stored `role` is always `viewer`. If RBAC enforcement is ever enabled, all API keys will have the wrong role. The disconnect between `scopes` (which are checked) and `role` (which is stored but ignored) creates confusion.

#### P2-03: Webhook creation uses `agents:read` scope for a write operation

**File:** `src/api/v1/webhooks.ts` (line 33)

`POST /api/v1/webhooks` (creating a webhook) and `DELETE /api/v1/webhooks/:webhookId` both require only `agents:read` scope. Creating and deleting webhooks are write operations and should require a write-level scope like `agents:write` or a dedicated `webhooks:manage` scope.

#### P2-04: CORS origin defaults to `localhost:8080`

**File:** `src/index.ts` (line 168)

If `APP_URL` is not set, CORS allows `http://localhost:8080`. In production, if `APP_URL` is accidentally unset, this would block legitimate requests from the real domain while leaving localhost origins open.

#### P2-05: Role definitions inconsistent between migration and service code

**Files:** `src/db/migrations/024_rbac.sql`, `src/services/rbac/permissions.ts`

The migration defines roles as: `owner`, `operator`, `investor`, `advisor`, `viewer` (with a CHECK constraint on the database column). The permissions service defines: `owner`, `admin`, `analyst`, `viewer`. The `requireRole` middleware uses: `viewer`, `analyst`, `admin`, `owner`. The database will reject `admin` or `analyst` role assignments because the CHECK constraint only allows the migration's set. This mismatch means the RBAC system is fundamentally broken even if it were enabled.

#### P2-06: No session revocation mechanism

There is no way to revoke all sessions for a founder. Clerk handles session management, but the app has no endpoint to trigger forced session invalidation. If a founder's account is compromised, there is no admin action to terminate active sessions beyond waiting for JWT expiry.

#### P2-07: `webhook` routes under `/webhooks/*` are public but alongside authenticated routes

**File:** `src/index.ts` (lines 222-255)

The `/webhooks/stripe/:productId` route accepts a product ID from the URL path and processes Stripe events for that product. The Stripe signature verification provides authentication, but the route structure exposes which product IDs exist (a 400 for bad signature vs. silent failure for nonexistent products).

---

### P3 — Low / Informational

#### P3-01: No multi-organization entity

The system has `founders` and `products` with a direct `owner_id` foreign key. There is no `organization` table. Multi-company is modeled as "one founder, many products." This means:
- A co-founder invited via the team system can see the product but cannot independently own it
- If a founder leaves, ownership transfer requires manual database intervention
- The portfolio system is a separate entity with its own API key, not connected to the founder/product ownership graph
- True multi-org (founder belongs to multiple organizations, each with multiple products) is architecturally impossible without a schema redesign

#### P3-02: Token format inconsistency

Three different token formats exist:
- API keys: `fnd_` prefix + 40 char nanoid, stored as SHA-256 hash
- Portfolio keys: `pfk_` prefix + 32 char nanoid, stored as plaintext
- Ingest/share tokens: 24 random bytes hex-encoded, stored as plaintext

There is no unified token management, rotation, or audit trail across these three systems.

#### P3-03: Clerk `issuer` validation is permissive

**File:** `src/middleware/auth.ts` (line 66)

The issuer callback `(iss: string) => iss.includes('clerk')` accepts any issuer string containing "clerk." A more restrictive check would validate the full Clerk instance URL (e.g., `https://INSTANCE_ID.clerk.accounts.dev`).

#### P3-04: `last_seen_at` update is fire-and-forget with no error handling

**File:** `src/middleware/auth.ts` (line 128)

The `.catch(() => {})` swallows all errors from the last-seen update. A persistent database error here would go completely undetected.

#### P3-05: Rate limiter is in-memory only

**File:** `src/middleware/rate-limit.ts`

The rate limiter uses a process-local `Map`. In a multi-instance deployment on Fly.io, each instance maintains independent counters, making rate limits effectively multiplied by instance count. An attacker can also target different instances to bypass limits entirely.

---

## Multi-Company / Fleet Model Assessment

| Requirement | Status | Gap |
|---|---|---|
| Founder owns multiple products | Implemented | Tier-gated to Investor-Ready |
| Product-level isolation | Implemented | Owner-scoped queries throughout |
| Team access to products | Partially implemented | Team invitations work, RBAC not enforced |
| Portfolio grouping | Schema exists | No ownership validation on API |
| Cross-product intelligence | Schema exists (`decision_patterns`) | No access control, no opt-out enforcement |
| Organization entity | Missing | No org table, no org-level roles |
| Product ownership transfer | Missing | No endpoint or mechanism |
| Fleet-level admin view | Missing | Portfolio overview exists but unauthenticated |
| Per-product API key scoping | Implemented | Scope enforcement works via `requireScope` |
| Session management across orgs | Not applicable | Single Clerk session, product selected via cookie |

---

## Recommended Fix Priority

1. **Immediately:** Add ownership validation to all portfolio API routes (P0-01)
2. **Immediately:** Fix transcript webhook auth to hash keys and check `revoked_at` (P0-02)
3. **Immediately:** Apply RBAC middleware to routes or remove the feature to avoid false security confidence (P0-04)
4. **This sprint:** Add CSRF tokens to all POST forms (P1-06)
5. **This sprint:** Implement credential encryption for GitHub tokens and integration credentials (P1-04, P1-05)
6. **This sprint:** Hash portfolio API keys like `api_keys` (P1-03)
7. **This sprint:** Add `Secure` flag to cookies in production (P1-02)
8. **This sprint:** Add per-token rate limiting on ingest endpoint (P1-08)
9. **Next sprint:** Reconcile RBAC role definitions between migration and service code (P2-05)
10. **Next sprint:** Introduce an `organizations` table to support true multi-org (P3-01)

---

## Files Audited

- `src/middleware/auth.ts` — Clerk JWT validation, auto-provisioning
- `src/middleware/tenant.ts` — Product ownership checks
- `src/middleware/rbac.ts` — Role-based access control middleware (unused)
- `src/middleware/tier-gate.ts` — Subscription tier enforcement
- `src/middleware/internal.ts` — Ecosystem service key auth
- `src/middleware/rate-limit.ts` — In-memory rate limiter
- `src/routes/auth/clerk.ts` — Signup/login/webhook
- `src/routes/ingest/index.ts` — Token-based metric ingestion
- `src/routes/share/index.ts` — Share token read-only view
- `src/routes/internal/ecosystem.ts` — Internal ecosystem routes
- `src/routes/internal/health.ts` — Health check
- `src/routes/dashboard/index.ts` — Dashboard with product switcher
- `src/routes/dashboard/settings.ts` — Token generation, billing
- `src/routes/dashboard/portfolio.ts` — Portfolio view
- `src/routes/dashboard/investors.ts` — Investor dashboard
- `src/routes/dashboard/team.ts` — Team management
- `src/routes/api/platform.ts` — Platform API (portfolio, voice, graph)
- `src/routes/api/webhooks/transcripts.ts` — Transcript webhook (broken auth)
- `src/routes/api/webhooks/voice-reply.ts` — Voice reply webhook
- `src/api/v1/index.ts` — REST API v1 router
- `src/api/v1/agents.ts` — Agent API with scope enforcement
- `src/api/v1/webhooks.ts` — Webhook management API
- `src/api/middleware/auth.ts` — API key auth middleware
- `src/services/rbac/permissions.ts` — RBAC permissions service + API key management
- `src/services/api/keys.ts` — API key extraction helper
- `src/services/portfolio/manager.ts` — Portfolio service (plaintext key storage)
- `src/db/schema.sql` — Core schema (16 tables)
- `src/db/migrations/005_signal_history.sql` — Share token column
- `src/db/migrations/007_operating_plan.sql` — Ingest token column
- `src/db/migrations/024_rbac.sql` — RBAC tables + seed
- `src/db/migrations/033_portfolio_mode.sql` — Portfolio tables
- `src/env.ts` — Environment validation
- `src/index.ts` — Route mounting, middleware chain
