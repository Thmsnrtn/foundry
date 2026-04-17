# Lens 07 — Security Engineer

## Executive Summary

Foundry has a functional authentication layer (Clerk JWT + ownership-scoped queries) and correct Stripe/Clerk webhook signature verification. However, the security posture has multiple P0 gaps that would be exploitable in production: all OAuth tokens and integration credentials are stored in plaintext despite schema comments claiming encryption, GitHub OAuth lacks CSRF protection (no `state` parameter), there is zero CSRF protection on state-mutating POST forms, the share page has stored XSS via unescaped database content in raw template strings, and the internal service key comparison is vulnerable to timing attacks. Input validation is absent across all 82+ route files. These findings represent material risk for a multi-tenant SaaS handling financial data and third-party API credentials.

## Findings

### SEC-01 Plaintext Token Storage (All OAuth & Integration Credentials)
- **Severity:** P0
- **Description:** GitHub access tokens, integration credentials (Stripe, PostHog, Intercom, Linear, Slack, Sentry), investor access tokens, deal room tokens, portfolio API keys, and Slack bot tokens are all stored as plaintext TEXT columns in the database. Schema comments say "Encrypted" and "encrypted at rest in production" but no encryption/decryption code exists anywhere in the codebase. A single database compromise (SQL injection, backup leak, Turso admin access) exposes every customer's GitHub repo access, Stripe API keys, and all other third-party credentials.
- **Evidence:**
  - `src/db/schema.sql` line 32: `github_access_token TEXT, -- Encrypted` (comment is a lie)
  - `src/db/migrations/008_integrations.sql` line 9: `-- credentials_json is encrypted at rest in production.` (no encryption code)
  - `src/db/migrations/008_integrations.sql` line 20: `credentials_json TEXT`
  - `src/db/migrations/011_investor.sql` line 18: `access_token TEXT UNIQUE NOT NULL`
  - `src/db/migrations/011_investor.sql` line 109: `access_token TEXT UNIQUE NOT NULL` (deal rooms)
  - `src/db/migrations/021_integration_fabric.sql` line 8-9: `-- Credentials stored as JSON, encrypted at app layer` / `credentials_json TEXT`
  - `src/db/migrations/013_voice_push.sql` line 94: `bot_token TEXT, -- encrypted`
  - `src/db/migrations/033_portfolio_mode.sql` line 13: `api_key TEXT UNIQUE`
  - `src/routes/dashboard/onboarding.ts` line 159: token stored directly via `body.access_token`
  - Zero occurrences of `encrypt`, `decrypt`, `cipher`, `AES`, or `GCM` in any source file
- **Remediation:** Implement envelope encryption (AES-256-GCM) with a per-row random IV. Encryption key from environment variable or KMS. Encrypt on write, decrypt on read. Add a `token_encrypted` boolean migration column to support rolling migration.
- **Target Phase:** Phase 3 (hardening)

### SEC-02 GitHub OAuth CSRF — Missing `state` Parameter
- **Severity:** P0
- **Description:** The GitHub OAuth authorization flow does not include a `state` parameter. An attacker can craft a malicious link that, when clicked by an authenticated Foundry user, completes the OAuth flow with the attacker's GitHub code, linking the attacker's GitHub account/repo to the victim's Foundry product. The `oauth_states` table exists in migration 008 but is never populated or checked for GitHub OAuth.
- **Evidence:**
  - `src/routes/dashboard/onboarding.ts` line 37: `const githubUrl = \`https://github.com/login/oauth/authorize?client_id=${ghClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo\`;` — no `state=` parameter
  - `src/routes/dashboard/onboarding.ts` lines 96-117: callback handler has no state validation
  - `src/db/migrations/008_integrations.sql` lines 53-63: `oauth_states` table exists but is unused
  - Zero matches for `state.*github` or `GITHUB_OAUTH_STATE` in codebase
- **Remediation:** Generate a cryptographic random `state` value, store it in `oauth_states` table (or signed cookie) before redirect, validate it on callback. Reject the callback if state does not match.
- **Target Phase:** Phase 3

### SEC-03 No CSRF Protection on State-Mutating Forms
- **Severity:** P0
- **Description:** The application uses server-rendered HTML forms with POST actions (checkout, share token generation, ingest token generation, wisdom toggle, subscription management, product switching, product creation, competitor addition, etc.) but has zero CSRF protection. No CSRF tokens, no `SameSite=Strict` cookies, no double-submit cookie pattern. The Clerk session cookie is set by Clerk (not the app), and the app's own `foundry_product` cookie uses `SameSite=Lax` which does not protect against top-level navigation POST attacks.
- **Evidence:**
  - Zero matches for `csrf`, `CSRF`, `csrfToken`, or `csrf_token` across the entire `src/` directory
  - `src/routes/dashboard/settings.ts` line 21: `settingsRoutes.post('/checkout', ...)` — no CSRF token
  - `src/routes/dashboard/settings.ts` line 260: `settingsRoutes.post('/settings/generate-share', ...)` — no CSRF token
  - `src/routes/dashboard/settings.ts` line 274: `settingsRoutes.post('/settings/generate-ingest', ...)` — no CSRF token
  - `src/routes/dashboard/settings.ts` line 318: `settingsRoutes.post('/settings/wisdom-toggle', ...)` — no CSRF token
  - `src/routes/dashboard/index.ts` line 103: `dashboardRoutes.post('/switch-product', ...)` — no CSRF token
  - `src/routes/dashboard/onboarding.ts` line 76: product creation — no CSRF token
- **Remediation:** Implement a double-submit cookie or synchronizer token pattern. Generate a per-session CSRF token, embed it as a hidden field in every form, validate on every POST/PUT/PATCH/DELETE handler. Consider Hono's CSRF middleware.
- **Target Phase:** Phase 3

### SEC-04 Stored XSS in Public Share Page
- **Severity:** P0
- **Description:** The share route renders a public-facing HTML page using raw JavaScript template literals (backtick strings) instead of Hono's `html` tagged template literal. User-controlled database values (product name, decision text, chosen option, outcome text, signal prose) are interpolated directly without HTML escaping. An attacker who controls a product name or decision text can inject arbitrary JavaScript that executes for any investor/advisor viewing the share link.
- **Evidence:**
  - `src/routes/share/index.ts` line 331: `<div class="share-product-name">${product.name as string}</div>` — unescaped
  - `src/routes/share/index.ts` line 116: `<title>${product.name as string} — Foundry Signal</title>` — unescaped in `<title>`
  - `src/routes/share/index.ts` line 345: `<div class="share-prose">${signal.prose}</div>` — AI-generated but may contain user input
  - `src/routes/share/index.ts` line 375: `<div class="share-decision-what">${d.what as string}</div>` — unescaped
  - `src/routes/share/index.ts` line 376: `${d.chosen_option ...}` ��� unescaped
  - `src/routes/share/index.ts` line 377: `${d.outcome ...}` — unescaped
  - The entire page (lines 111-388) is a raw backtick template string, not using Hono's `html` tagged template which auto-escapes
- **Remediation:** Rewrite the share page using Hono's `html` tagged template literal, which auto-escapes interpolated values. Alternatively, apply a `escapeHtml()` function (like the one in `src/routes/dashboard/onboarding-chat.ts` line 23) to every database value before interpolation.
- **Target Phase:** Phase 3

### SEC-05 XSS via Template Injection in Auth Pages
- **Severity:** P1
- **Description:** The Clerk publishable key is interpolated into a raw template string inside a `<script>` tag without escaping. While the publishable key is server-controlled, the pattern of using `${publishableKey}` inside inline JavaScript within a backtick HTML string creates a template injection risk if any server-side value is ever user-influenced. More critically, the error handler on lines 48-49 uses string concatenation with `e.message` which could contain attacker-controlled content if the Clerk JS load fails with a crafted error.
- **Evidence:**
  - `src/routes/auth/clerk.ts` line 36: `const pk = "${publishableKey}";` — inside inline script
  - `src/routes/auth/clerk.ts` line 48-49: `+ e.message +` — error message interpolated into HTML without escaping
  - `src/routes/auth/clerk.ts` line 79: same pattern for login page
- **Remediation:** Use Hono's `html` tagged template and move the publishable key to a `data-` attribute read by JavaScript. Escape error messages before DOM insertion.
- **Target Phase:** Phase 3

### SEC-06 Timing-Unsafe Service Key Comparison
- **Severity:** P1
- **Description:** The internal middleware compares the ecosystem service key using JavaScript `!==` which is vulnerable to timing attacks. An attacker can iteratively guess the key by measuring response time differences for each character position.
- **Evidence:**
  - `src/middleware/internal.ts` line 23: `if (!providedKey || providedKey !== serviceKey)` — uses strict equality, not timing-safe comparison
  - Zero occurrences of `timingSafeEqual` in the codebase
- **Remediation:** Use `crypto.timingSafeEqual(Buffer.from(providedKey), Buffer.from(serviceKey))` with a length check beforehand.
- **Target Phase:** Phase 3

### SEC-07 No Input Validation on Any Route
- **Severity:** P0
- **Description:** Despite Zod being in `package.json` dependencies, there is effectively zero input validation at HTTP boundaries. All 82+ route files trust `req.body`, `req.params`, and `req.query` without schema validation. This enables type confusion, unexpected field injection, and makes every endpoint a potential vector for business logic abuse.
- **Evidence:**
  - `src/routes/api/ask.ts` line 30: `const body = await c.req.json() as { question?: string; product_id?: string }` — type assertion only, no runtime validation
  - `src/routes/dashboard/onboarding.ts` line 78: `const body = await parseBody(c) as Record<string, string>` — no validation
  - `src/routes/dashboard/onboarding.ts` line 122: `const body = await parseBody(c) as { repo_owner: string; ... }` — type assertion only
  - `src/routes/dashboard/settings.ts` line 24: `const body = await c.req.parseBody() as Record<string, string>` — no validation of tier value beyond array inclusion check
  - `src/routes/ingest/index.ts` line 65: `body = await c.req.json() as Record<string, unknown>` — accepts arbitrary keys; unrecognized fields go to `custom_metrics` JSON
  - Prior audit debt document confirms: "Effectively all 82 route files lack input validation"
- **Remediation:** Add Zod schemas to every POST/PUT/PATCH handler. Validate params, query, and body. Return 422 with structured errors on failure. Create reusable validation middleware.
- **Target Phase:** Phase 3

### SEC-08 Transcript Webhook Auth Bypass — Raw Key vs Hash Comparison
- **Severity:** P1
- **Description:** The transcript webhook endpoint compares the raw API key directly against the `key_hash` column, while all other API key validation uses SHA-256 hashing before comparison. This means the transcript webhook auth will never successfully authenticate a legitimate API key (functional bug), but if an attacker could somehow insert a raw key value into the `key_hash` column, they could authenticate. More importantly, the inconsistency suggests the webhook was written without understanding the auth model.
- **Evidence:**
  - `src/routes/api/webhooks/transcripts.ts` lines 14-21: `getProductIdForApiKey` queries `WHERE key_hash = ?` with raw `apiKey` value
  - `src/services/rbac/permissions.ts` lines 42-48: `hashKey()` uses SHA-256 before comparison
  - `src/services/rbac/permissions.ts` lines 130-139: `validateApiKey()` correctly hashes before lookup
- **Remediation:** Use `validateApiKey()` from `src/services/rbac/permissions.ts` instead of the custom `getProductIdForApiKey` function in the transcript webhook.
- **Target Phase:** Phase 3

### SEC-09 No Security Headers
- **Severity:** P1
- **Description:** The application sets zero security headers. No `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, `Referrer-Policy`, or `Permissions-Policy`. The share pages are publicly accessible and render user-controlled content, making the lack of CSP especially dangerous in combination with SEC-04.
- **Evidence:**
  - Zero matches for `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, `helmet` across `src/`
  - `src/index.ts`: no security header middleware registered
- **Remediation:** Add a security headers middleware. At minimum: `Content-Security-Policy` with script-src/style-src nonces, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `Referrer-Policy: strict-origin-when-cross-origin`.
- **Target Phase:** Phase 3

### SEC-10 GitHub Access Token Leaked to Client via Hidden Form Field
- **Severity:** P0
- **Description:** After the GitHub OAuth callback, the access token is passed to the client via the `onboardingWizard` component as `_token: tokenData.access_token` and rendered in the HTML. The user then submits this token back via a POST form to `/onboarding/select-repo`. This means the GitHub access token is present in the browser DOM, visible in page source, and transmitted as a form field. Any XSS on the onboarding page leaks the token. The token should never leave the server.
- **Evidence:**
  - `src/routes/dashboard/onboarding.ts` line 115: `const content = onboardingWizard('select_repo', { repos, _token: tokenData.access_token });`
  - `src/routes/dashboard/onboarding.ts` line 122: `body.access_token` received from client POST
  - `src/routes/dashboard/onboarding.ts` line 159: token stored directly from client-submitted value
- **Remediation:** Store the GitHub access token in a server-side session or encrypted cookie immediately upon receipt from GitHub. Never render it in HTML. On repo selection POST, retrieve the token from the server-side store.
- **Target Phase:** Phase 3

### SEC-11 Rate Limiting Bypassable via Header Spoofing
- **Severity:** P1
- **Description:** The rate limiter uses `x-forwarded-for` or `cf-connecting-ip` headers as the rate limit key. These headers can be spoofed by an attacker if the app is not behind a trusted reverse proxy that strips/overwrites them. On Fly.io, `Fly-Client-IP` is the trusted header. An attacker can rotate their `x-forwarded-for` value to bypass rate limits entirely.
- **Evidence:**
  - `src/middleware/rate-limit.ts` line 33: `c.req.header('x-forwarded-for') ?? c.req.header('cf-connecting-ip') ?? 'unknown'`
  - No verification that proxy headers are from a trusted source
  - Falls back to `'unknown'` which means all requests without these headers share one bucket
- **Remediation:** Use `Fly-Client-IP` on Fly.io. Configure trusted proxy list. Never trust `x-forwarded-for` without proxy validation.
- **Target Phase:** Phase 4

### SEC-12 Cross-Tenant Intelligence Leakage via decision_patterns
- **Severity:** P1
- **Description:** The `decision_patterns` table is intentionally cross-product/cross-tenant. While the schema claims it contains only anonymized data, the `market_category` field combined with `key_metrics_context` (JSON metric ranges), `decision_type`, and `product_lifecycle_stage` could allow a sophisticated attacker to fingerprint and de-anonymize competitors. There is no access control on who can read from this table and no differential privacy mechanism.
- **Evidence:**
  - `src/db/schema.sql` lines 268-287: `decision_patterns` table with `market_category`, `key_metrics_context` JSON
  - `src/db/client.ts` lines 216-230: `getRelevantPatterns()` — no tenant scoping, returns data from all products
  - `src/services/decisions/patterns.ts` line 24: patterns are inserted from individual product decisions
  - `src/services/wisdom/network.ts` line 50: wisdom network reads from `decision_patterns`
  - No differential privacy, no k-anonymity checks, no minimum pool size before returning results
- **Remediation:** Add k-anonymity enforcement (minimum 5 products in a category before returning patterns). Strip or generalize `market_category` to broader buckets. Add noise to `key_metrics_context` ranges. Implement opt-out per the existing wisdom toggle, but also enforce it at the query layer.
- **Target Phase:** Phase 4

### SEC-13 No Rate Limiting on AI API Calls — Cost Attack Vector
- **Severity:** P1
- **Description:** The `/api/ask` and `/api/threads/*/messages` endpoints call Claude Opus/Sonnet with no per-founder rate limiting on AI usage. An authenticated user could spam these endpoints to generate massive Anthropic API bills. The general API rate limit (120 req/min) provides some protection, but each request can trigger a multi-turn AI call costing $0.05-0.50+.
- **Evidence:**
  - `src/routes/api/ask.ts` lines 28-67: no AI-specific rate limiting
  - `src/routes/api/ask.ts` lines 190-235: thread messages also trigger AI calls
  - `src/middleware/rate-limit.ts` line 60: `apiRateLimit` = 120 req/min (120 * $0.10 = $12/min = $720/hr potential)
  - No per-founder AI budget tracking or daily caps
- **Remediation:** Add per-founder daily AI call limits. Track token usage per founder. Implement a cost budget system with hard caps. Reduce the API rate limit for AI-triggering endpoints specifically.
- **Target Phase:** Phase 3

### SEC-14 CORS Defaults to localhost
- **Severity:** P2
- **Description:** If `APP_URL` is not set, CORS defaults to `http://localhost:8080`. In production if the env var is accidentally unset, this would block legitimate cross-origin requests but is not a direct security vulnerability. However, the CORS configuration allows credentials (`credentials: true`) which means any origin that matches can send authenticated requests.
- **Evidence:**
  - `src/index.ts` line 167: `origin: process.env.APP_URL ?? 'http://localhost:8080'`
  - `src/index.ts` line 168: `credentials: true`
- **Remediation:** Fail-fast in production if `APP_URL` is not set. Validate the origin is an HTTPS URL in production.
- **Target Phase:** Phase 4

### SEC-15 Migration Failures Don't Stop Server
- **Severity:** P1
- **Description:** If database migrations fail, the server starts anyway with potentially inconsistent schema. This could lead to missing tables, missing columns, or constraint violations that manifest as data corruption or silent data loss during normal operation.
- **Evidence:**
  - `src/index.ts` lines 503-510: `.catch((err) => { console.error('...non-fatal...'); ... serve({ fetch: app.fetch, port }); })`
- **Remediation:** In production, fail-fast on migration errors. Do not start serving requests if the database schema is inconsistent. Add a health check that verifies schema version.
- **Target Phase:** Phase 3

### SEC-16 Ingest Webhook Token as URL Path Segment
- **Severity:** P2
- **Description:** The ingest webhook uses the token as a URL path segment (`POST /ingest/:token`). URL paths are routinely logged by load balancers, CDNs, application logs, and browser history. This means the secret ingest token will appear in Fly.io access logs, any monitoring tool, and potentially error reporting services.
- **Evidence:**
  - `src/routes/ingest/index.ts` line 46: `ingestRoutes.post('/ingest/:token', ...)`
  - `src/index.ts` line 165: `app.use('*', logger())` — Hono logger logs every request path
- **Remediation:** Move the token to an `Authorization` header or `X-Ingest-Token` header instead of the URL path.
- **Target Phase:** Phase 4

### SEC-17 Share Token and Ingest Token Lack Expiry
- **Severity:** P2
- **Description:** Share tokens and ingest tokens never expire. Once generated, they remain valid indefinitely. A leaked share link or ingest URL provides permanent access to business metrics with no revocation mechanism other than regenerating (which is manual).
- **Evidence:**
  - `src/routes/dashboard/settings.ts` lines 260-269: share token generation — no expiry column
  - `src/routes/dashboard/settings.ts` lines 274-283: ingest token generation — no expiry column
  - `src/db/schema.sql`: no `share_token_expires_at` or `ingest_token_expires_at` columns
- **Remediation:** Add optional expiry to share and ingest tokens. Default share tokens to 90 days. Add a last-used-at tracking column for security auditing.
- **Target Phase:** Phase 4

### SEC-18 GitHub Access Token Passed in Hidden Form Field Has No Timeout
- **Severity:** P2
- **Description:** The GitHub access token, after being received via OAuth callback, is held in a hidden form field in the browser until the user submits the repo selection form. There is no server-side timeout. If the user leaves the page open, the token sits in the DOM indefinitely.
- **Evidence:**
  - `src/routes/dashboard/onboarding.ts` line 115: token passed to template
  - No timeout or expiry validation on the subsequent POST at line 120
- **Remediation:** (Subsumed by SEC-10 fix — store token server-side, not in DOM)
- **Target Phase:** Phase 3

### SEC-19 Unbounded JSON Body Size on Public Endpoints
- **Severity:** P2
- **Description:** Public-facing endpoints (ingest webhook, Clerk webhook, Stripe webhook, transcript webhooks) do not enforce request body size limits. An attacker could send multi-GB payloads to exhaust server memory.
- **Evidence:**
  - `src/routes/ingest/index.ts` line 65: `body = await c.req.json()` — no size limit
  - `src/routes/auth/clerk.ts` line 113: `const rawBody = await c.req.text()` — no size limit
  - No body size middleware configured in `src/index.ts`
- **Remediation:** Add a body size limit middleware (e.g., 1MB for webhooks, 256KB for API endpoints).
- **Target Phase:** Phase 4

### SEC-20 User Deletion Does Not Cascade Through All Tables
- **Severity:** P2
- **Description:** The Clerk `user.deleted` webhook handler manually deletes products and the founder record but relies on SQL CASCADE for child rows. However, not all related tables have CASCADE constraints (e.g., conversation_threads, saved_insights, api_keys may reference founder_id without CASCADE). This could leave orphaned sensitive data.
- **Evidence:**
  - `src/routes/auth/clerk.ts` lines 144-157: manual deletion loop for products, then founder
  - No verification that all tables with `founder_id` references have `ON DELETE CASCADE`
  - No deletion of `conversation_threads`, `saved_insights`, `api_keys`, `gate_events` explicitly
- **Remediation:** Audit all tables referencing `founder_id` or `product_id` to ensure CASCADE. Add explicit deletion for tables that lack it. Log the deletion for compliance.
- **Target Phase:** Phase 4

## Embarrassment Test
Three things about the current security posture that would embarrass a senior security engineer:

1. **Schema comments lie about encryption.** Four separate SQL files contain comments claiming tokens are "Encrypted" or "encrypted at rest" when zero encryption code exists. This is not just a missing feature -- it is active misrepresentation that could mislead security reviewers and auditors into believing credentials are protected when they are stored in plaintext.

2. **GitHub OAuth has no state parameter.** This is OAuth Security 101, explicitly documented in RFC 6749 Section 10.12 as a MUST requirement. The `oauth_states` table was even created in migration 008, suggesting someone knew this was needed and then never implemented it. A first-year security student would flag this.

3. **A public-facing page (share) renders user-controlled database content in raw template strings without any HTML escaping.** The share page is designed to be shown to investors and advisors. A stored XSS on this page means a founder could inject malicious scripts that execute in the browser of every investor who views their share link -- or worse, an attacker who compromises a founder's account could use the share page to pivot to investor targets.

## Pride Test
Three things that would make a senior security engineer proud (if any):

1. **Clerk webhook signature verification is implemented correctly.** The Svix HMAC-SHA256 verification in `src/routes/auth/clerk.ts` (lines 105-139) properly validates the signature, checks timestamp freshness (5-minute window to prevent replay attacks), and handles the multi-signature format correctly. This is one of the few security mechanisms done right.

2. **Tenant isolation at the query layer is consistent.** The `getProductByOwner()` pattern properly scopes all product queries by `owner_id`, and the tenant middleware returns 404 (not 403) for non-owned products, preventing enumeration. The pattern is applied consistently across the codebase.

3. **API keys are properly hashed with SHA-256 before storage** (in `src/services/rbac/permissions.ts`). The `createApiKey` and `validateApiKey` functions correctly hash the raw key, store only the hash, and compare hashes on validation. Only the prefix is stored for identification. This is the correct pattern (though the transcript webhook breaks it per SEC-08).
