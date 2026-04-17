# Foundry — Prior Audit Debt Roll-Forward

Generated: 2026-04-17 | Session: 1

The prior remediation report (~early March 2026) identified issues across ~68 files. Git history shows partial fixes in commits `47dfd72` ("Fix all pre-launch blockers identified in app audit") and `2c6a5cb` ("Fix remaining launch blockers: schema mismatches, security tokens, cascade delete"). This document reconstructs the remaining debt by auditing the current codebase for the same issue classes.

## Debt Class 1: Plaintext Token Storage

**Prior finding:** GitHub access tokens and integration credentials stored in plaintext.
**Status:** OPEN

**Evidence:**
- `src/db/schema.sql` line ~50: `github_access_token TEXT` — plaintext column, comment says "Encrypted" but no encryption code exists
- `src/db/migrations/008_integrations.sql` line 20: `credentials_json TEXT` — integration OAuth tokens stored as plain JSON
- `src/db/migrations/011_investor.sql`: `api_key TEXT` — investor API keys in plaintext
- `src/db/migrations/021_integration_fabric.sql`: `access_token TEXT` — fabric tokens in plaintext

**Occurrences:** 33 references to token/credential columns across 17 files.

**Remediation required:** Implement envelope encryption (AES-256-GCM) for all token/credential columns. Encrypt on write, decrypt on read. Key management via environment variable or KMS.

---

## Debt Class 2: Missing Webhook Signature Verification

**Prior finding:** Inbound webhooks not verified.
**Status:** PARTIALLY RESOLVED (Stripe only)

**Evidence:**
- `src/services/integrations/stripe-webhook.ts`: Stripe webhook signature verification present
- `src/routes/auth/clerk.ts`: Clerk webhook — need to verify `CLERK_WEBHOOK_SECRET` is actually validated (not just checked for presence)
- `src/routes/ingest/index.ts`: Metric ingestion webhook uses token-based auth (basic, no signature)
- `src/routes/api/webhooks`: Voice transcript and reply webhooks — no signature verification visible
- GitHub webhooks: `GITHUB_WEBHOOK_SECRET` referenced in .env.example but verification code not confirmed

**Remediation required:** Verify HMAC signature on every inbound webhook. Reject with 401 and log if invalid.

---

## Debt Class 3: Missing Request Validation

**Prior finding:** No input validation at HTTP boundaries.
**Status:** OPEN

**Evidence:**
- Zod is in dependencies (`^3.22.0`) but search reveals minimal usage at route level
- Route handlers access `req.body`, `req.params`, `req.query` without schema validation
- `src/routes/api/ask.ts`: User input goes directly to AI with no validation beyond prompt injection check
- `src/routes/dashboard/settings.ts`: Settings updates trust client input
- `src/routes/api/products.ts`: Product creation trusts all fields
- `src/routes/ingest/index.ts`: Metric values accepted without range validation

**Occurrences:** Effectively all 82 route files lack input validation.

**Remediation required:** Zod schema at every POST/PUT/PATCH handler. Validate params, query, and body. Return 422 with structured errors on failure.

---

## Debt Class 4: Insufficient Test Coverage

**Prior finding:** No tests.
**Status:** PARTIALLY RESOLVED (7 unit tests)

**Evidence:**
- `tests/unit/` contains 7 files:
  - `ai-calibration.test.ts`
  - `customer-health.test.ts`
  - `experiment-stats.test.ts`
  - `financial.test.ts`
  - `risk-state.test.ts`
  - `sector-profiles.test.ts`
  - `stage-detection.test.ts`
- Zero integration tests
- Zero e2e tests (no Playwright/Cypress)
- Zero tests for: auth, tenancy, billing, SCP agents, audit engine, remediation, decisions, digest, any route handler

**Remediation required:** 80%+ line coverage. 100% of critical paths tested. Integration tests for multi-tenant isolation. E2e tests for: signup → first audit → first SCP briefing → billing upgrade.

---

## Debt Class 5: Missing Retry Logic on External Calls

**Prior finding:** No retry logic on external API calls.
**Status:** OPEN

**Evidence:**
- `src/services/ai/client.ts`: Anthropic API calls — no retry, no timeout, no circuit breaker
- `src/services/audit/github.ts`: GitHub API calls — no retry
- `src/services/billing/stripe.ts`: Stripe API calls — no retry
- `src/services/integration/resend.ts`: Email delivery — no retry
- `src/services/notifications/push.ts`: APNS — no retry
- `src/db/client.ts`: Database queries — no retry

**Occurrences:** Every external integration (6 services) lacks retry logic.

**Remediation required:** Jittered exponential backoff on all external calls. Circuit breaker (3 failures in 5 min = skip). Budget caps (max retries per minute). Explicit timeouts on every HTTP call.

---

## Debt Class 6: console.log Usage

**Prior finding:** console.log/error/warn used instead of structured logging.
**Status:** OPEN

**Evidence:**
- 422 occurrences of `console.log`, `console.error`, or `console.warn` across 40 files
- Heaviest offenders:
  - `src/cli/index.ts`: 82 occurrences (CLI expected, lower priority)
  - `src/jobs/index.ts`: 205 occurrences (production job scheduler — high priority)
  - `src/index.ts`: 16 occurrences
  - `src/db/seed.ts`: 16 occurrences
  - `src/services/scp/evolution.ts`: 8 occurrences
  - `src/services/scp/events/dispatcher.ts`: 9 occurrences
  - `src/services/scp/scheduler.ts`: 8 occurrences

**Remediation required:** Replace all `console.*` in app code (not CLI) with structured logger (Pino or similar). Include trace IDs, timestamps, severity levels. JSON format for production.

---

## Debt Class 7: Type Safety (`as any` casts)

**Prior finding:** Implicit any usage throughout.
**Status:** PARTIALLY RESOLVED (strict mode on, but 36 explicit casts remain)

**Evidence:**
- 36 `as any` casts across 15 files
- Key locations:
  - `src/middleware/auth.ts`: 3 casts (Clerk token verification)
  - `src/routes/api/platform.ts`: 7 casts
  - `src/routes/dashboard/onboarding.ts`: 5 casts
  - `src/services/integrations/stripe-webhook.ts`: 4 casts
  - `src/routes/api/supercharge.ts`: 4 casts
  - `src/db/client.ts`: 2 casts (query args)

**Remediation required:** Eliminate all `as any`. Use proper types for Clerk SDK, database results, and webhook payloads.

---

## Summary

| Debt Class | Status | Severity | Files Affected |
|-----------|--------|----------|----------------|
| 1. Plaintext tokens | OPEN | P0 | 17 files, 33 refs |
| 2. Webhook verification | PARTIAL | P0 | 4-5 webhook endpoints |
| 3. Request validation | OPEN | P0 | ~82 route files |
| 4. Test coverage | PARTIAL (7/target 80%+) | P1 | entire codebase |
| 5. Retry logic | OPEN | P1 | 6 integration services |
| 6. console.log | OPEN | P1 | 40 files, 422 occurrences |
| 7. Type safety | PARTIAL (36 casts) | P1 | 15 files |

**Total open P0 debts: 3 classes**
**Total open P1 debts: 4 classes**
