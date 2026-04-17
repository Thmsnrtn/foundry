# Lens 14 -- Test Engineer Audit

**Auditor perspective:** Test engineer -- coverage, quality, infrastructure, CI pipeline, flaky tests, missing critical path coverage, testing strategy.
**Date:** 2026-04-16
**Codebase:** 288 TypeScript source files, 176 service modules, 84 route files, 54 migrations.

---

## Executive Summary

Foundry has **near-zero effective test coverage**. Of 288 source files, only 7 test files exist (737 total lines of test code). Worse, 4 of the 7 tests re-implement production logic locally instead of importing from source -- they test *copies* of the code, not the actual production code. There is no CI pipeline, no integration test infrastructure, no e2e test infrastructure, and no test database seeding or fixture system. Every critical path (auth, tenant isolation, billing, SCP agent execution, audit engine, decision approval/rejection) ships with zero automated verification.

---

## 1. Test Infrastructure Assessment

### 1.1 Test Runner Configuration

**File:** `vitest.config.ts`

```typescript
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 10000,
  },
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
});
```

**Findings:**
- Basic Vitest setup, adequate for unit tests.
- No coverage configuration (`coverage` key missing) -- no coverage thresholds enforced.
- No setup files (`setupFiles`, `globalSetup`) -- no shared test utilities, no database mocking, no auth mocking.
- No test environment for integration tests (no test database, no HTTP test client).
- `testTimeout` of 10s is fine for unit tests but there is no separate config for integration/e2e.

### 1.2 CI Pipeline

**Status: DOES NOT EXIST** -- **P0**

- No `.github/workflows/` directory in the repo (only in node_modules).
- No `Makefile`, `Justfile`, or `Taskfile` for CI.
- The `Dockerfile` runs `npm run build` but never runs `npm test`.
- The `package.json` `test` script is just `vitest` (no `--run` flag, so it starts in watch mode by default if invoked interactively).

**Impact:** Tests can silently break. Deployments proceed without any verification. There is no gate between code change and production deployment.

### 1.3 Integration Test Infrastructure

**Status: DOES NOT EXIST** -- **P0**

- No test database setup (no in-memory SQLite or Turso test instance).
- No HTTP request test helpers (no `supertest`, no Hono test client usage).
- No mock/stub infrastructure for external services (Anthropic, GitHub, Stripe, Clerk, Resend).
- No factory functions for creating test data (founders, products, decisions, etc.).
- No transaction rollback or database cleanup between tests.

### 1.4 E2E Test Infrastructure

**Status: DOES NOT EXIST** -- **P1**

- No Playwright, Cypress, or any browser automation tool.
- No smoke test scripts.
- No API contract tests.

---

## 2. Existing Test Quality Analysis

### 2.1 Tests That Import From Source (3 of 7) -- Genuine Tests

| File | Imports From | What It Tests | Quality |
|------|-------------|---------------|---------|
| `risk-state.test.ts` | `src/services/intelligence/risk-state.js` | `assessRiskState()` -- risk state transitions, severity scoring, pre-launch caps, founder motivation | **Good** -- 11 test cases, covers edge cases, tests the actual production function |
| `sector-profiles.test.ts` | `src/services/audit/sector-profiles.js` + `src/types/index.js` | Sector validation, finding relevance, weight building, remediation tone | **Good** -- 14 test cases across 4 describe blocks, tests actual exports |
| `stage-detection.test.ts` | `src/services/lifecycle/stage-detection.js` | Stage config retrieval, stressor threshold computation | **Adequate** -- 8 test cases, straightforward but covers the critical stage configurations |

### 2.2 Tests That Re-Implement Logic (4 of 7) -- Illusory Coverage

| File | Re-Implements | Problem |
|------|--------------|---------|
| `ai-calibration.test.ts` | `buildCalibrationBlock()` function | Defines its own copy of `FounderAIProfile` type and `buildCalibrationBlock()` function. If the production code diverges, these tests still pass. **Does not test production code.** |
| `customer-health.test.ts` | `computeConcentration()`, `computeHealthScore()` | Re-implements revenue concentration and health scoring logic locally. Production implementations could have bugs these tests would never catch. |
| `experiment-stats.test.ts` | `computeSignificance()` z-test logic | Re-implements the statistical significance calculation. Tests verify the local copy, not whatever the production experiment service uses. |
| `financial.test.ts` | `computeRunway()`, `computeBreakEvenMonths()`, `computeRunwayGap()`, `estimateGrowthRate()` | Re-implements 4 financial calculation functions. If the production `src/services/financial/` implementations differ, these tests provide false confidence. |

**Severity: P1** -- These 4 files give the appearance of test coverage while testing nothing that actually ships. They must be refactored to import from the real source modules.

### 2.3 Overall Test Quality Summary

- **Total test cases:** ~60 across 7 files
- **Tests that verify production code:** ~33 (from 3 files)
- **Tests that verify local copies:** ~27 (from 4 files)
- **Effective coverage:** 3 out of 288 source files = **~1%**
- **Critical paths with any test:** 1 (risk-state, partially)
- **No mocking, no async testing, no error path testing, no database interaction testing**

---

## 3. Critical Path Coverage Gaps

### 3.1 Authentication Flow -- ZERO TESTS -- P0

**Files at risk:** `src/middleware/auth.ts`, `src/routes/auth/clerk.ts`

What must be tested:
- JWT extraction from `Authorization` header and `__session` cookie
- Clerk `verifyToken` call success and failure paths
- Auto-provisioning when webhook hasn't fired (race condition handling)
- Redirect to `/auth/login` for browser requests vs. JSON 401 for API requests
- `last_seen_at` fire-and-forget update
- Webhook HMAC signature verification (Svix)
- `user.created` event handler -- founder provisioning + Stripe customer creation
- `user.deleted` event handler -- cascade delete of products and founder
- Replay attack prevention (timestamp > 5 min = reject)

**Risk if untested:** Authentication bypass could ship to production undetected. The regex-based cookie parsing (line 47 of auth.ts: `cookie.split(';').map(...).find(...)`) is fragile and has no edge case testing.

### 3.2 Multi-Tenant Isolation -- ZERO TESTS -- P0

**Files at risk:** `src/middleware/tenant.ts`

What must be tested:
- Product ownership check: founder A cannot access founder B's product
- 404 (not 403) response for non-owned products -- information leak prevention
- Missing `productId` param handling
- Default lifecycle state creation when none exists in DB
- Lifecycle state parsing from database rows

**Risk if untested:** A tenant isolation failure means one founder can read or modify another founder's data. This is the most dangerous class of bug in a multi-tenant SaaS.

### 3.3 Billing / Subscription Tier Enforcement -- ZERO TESTS -- P0

**Files at risk:** `src/services/billing/stripe.ts`, `src/middleware/tier-gate.ts`

What must be tested:
- `canAccess()` function: tier-to-feature mapping for all 3 tiers + null tier
- `requireTier()` middleware: gate page rendering vs. pass-through
- Stripe webhook handler: subscription created/updated/deleted events correctly update founder tier
- `getTierFromPrice()`: price ID to tier mapping (returns null for unknown prices)
- `getPriceId()`: tier to price ID mapping (throws for missing env vars)
- `getTierCapabilities()`: returns correct feature list per tier

**Risk if untested:** A billing bug could grant paying features to free users, or worse, could lock paying customers out of features they're paying for. The `canAccess()` function has a subtle behavior: unknown features are allowed (`return true`), which could be exploited.

### 3.4 SCP Agent Execution -- ZERO TESTS -- P0

**Files at risk:** `src/services/scp/agents/base.ts`, all 12 agent subclasses, `src/services/scp/gates.ts`

What must be tested:
- BaseAgent `run()` lifecycle: instance lookup, cadence check, session creation, context loading, `analyzeAndAct()`, signal processing
- Paused agent skipping
- Cadence enforcement (next_run_at check)
- 5-gate validation pipeline (`runAllGates`): constitution, regression, size, drift, safety
- Constitution gate regex patterns (currently only tested by pattern, not by the actual gate function)
- Safety gate fail-closed behavior (LLM error = reject)
- Regression gate fail-open behavior (LLM error = pass) -- asymmetric failure modes need explicit testing
- Size gate: MAX_CONFIG_LINES enforcement
- Drift gate: Jaccard similarity threshold
- Gate short-circuiting: early gates failing should prevent later gates from running

**Risk if untested:** SCP agents are the core product. A broken agent could generate harmful recommendations, bypass safety gates, or fail silently. The `jaccardSimilarity()` function in gates.ts is a deterministic pure function that is trivially testable but has zero tests.

### 3.5 Audit Engine -- ZERO TESTS -- P1

**Files at risk:** `src/services/audit/engine.ts`, `src/services/audit/scorer.ts`, `src/services/audit/remediation.ts`

What must be tested:
- 8-step analysis pipeline orchestration
- Score calculation and dimension weighting
- Remediation classification (AUTO / WISDOM_REQUIRED / HUMAN_ONLY)
- Prior audit comparison context
- Error handling when GitHub repo is not connected

### 3.6 Decision Queue and Action Execution -- ZERO TESTS -- P0

**Files at risk:** `src/services/decisions/queue.ts`, `src/services/decisions/actions.ts`

What must be tested:
- Decision creation with proper field serialization
- Decision resolution (approve/reject) with audit trail
- Risk-state-aware queue ordering (red = urgent only, yellow = retention-first, green = priority-ordered)
- Gate 0 auto-execution: `generateActionDraft()` with `auto_executable = true` triggers `executeAction()`
- Action draft approval: ownership check (`owner_id` match)
- Action draft rejection: reason recording
- `determineArtifactType()` classification logic
- Linked decision status update after execution

**Risk if untested:** The action execution engine auto-executes Gate 0 decisions. A bug here could auto-execute incorrect or harmful actions without founder approval.

### 3.7 RBAC and Rate Limiting -- ZERO TESTS -- P1

**Files at risk:** `src/middleware/rbac.ts`, `src/middleware/rate-limit.ts`

What must be tested:
- Permission check: owner bypass, role hierarchy (viewer < analyst < admin < owner)
- Rate limit: window expiry, counter increment, 429 response, header values
- Rate limit key extraction (IP-based for public, founder-based for auth)

---

## 4. Findings Summary

| # | Finding | Severity | Category |
|---|---------|----------|----------|
| F1 | No CI pipeline -- tests never run automatically, deployments have no quality gate | P0 | Infrastructure |
| F2 | Zero tests for authentication middleware (JWT validation, cookie parsing, auto-provisioning) | P0 | Critical path |
| F3 | Zero tests for multi-tenant isolation (product ownership check, 404-not-403 pattern) | P0 | Critical path |
| F4 | Zero tests for billing/subscription (Stripe webhooks, tier updates, feature gating) | P0 | Critical path |
| F5 | Zero tests for SCP agent execution (BaseAgent lifecycle, 12 agent subclasses) | P0 | Critical path |
| F6 | Zero tests for decision queue and action execution (Gate 0 auto-execution is completely untested) | P0 | Critical path |
| F7 | Zero tests for 5-gate validation pipeline (constitution, regression, size, drift, safety gates) | P0 | Critical path |
| F8 | 4 of 7 test files re-implement logic locally instead of importing from source -- illusory coverage | P1 | Test quality |
| F9 | No integration test infrastructure (no test database, no HTTP client, no mocks/stubs, no factories) | P1 | Infrastructure |
| F10 | No coverage configuration or thresholds in vitest.config.ts | P1 | Infrastructure |
| F11 | No e2e test infrastructure (no Playwright/Cypress) | P1 | Infrastructure |
| F12 | Zero tests for RBAC middleware (permission checks, role hierarchy) | P1 | Security |
| F13 | Zero tests for rate limiting middleware | P2 | Defense |
| F14 | Zero tests for audit engine (8-step pipeline, scoring, remediation classification) | P1 | Critical path |
| F15 | Zero tests for webhook signature verification (Clerk Svix HMAC validation) | P0 | Security |
| F16 | Dockerfile does not run tests during build | P1 | Infrastructure |
| F17 | `npm test` runs vitest in watch mode (no `--run` flag) -- not suitable for CI | P2 | Configuration |
| F18 | No test data factories or fixtures for founders, products, decisions, agents | P2 | Infrastructure |
| F19 | Zero tests for any of the 84 route handlers | P1 | Coverage |
| F20 | `jaccardSimilarity()` in gates.ts is a pure function with zero tests -- trivial to test | P2 | Low-hanging fruit |

---

## 5. Recommended Remediation Priority

### Phase 1: Foundation (must complete before any feature work)

1. **Set up CI pipeline** (F1) -- GitHub Actions workflow: `npm run typecheck && npx vitest run --coverage`. Block merges on failure.
2. **Add coverage configuration** (F10) -- Add `coverage: { provider: 'v8', thresholds: { lines: 80 }, reporter: ['text', 'lcov'] }` to vitest.config.ts.
3. **Fix the 4 illusory test files** (F8) -- Refactor ai-calibration, customer-health, experiment-stats, and financial tests to import from their actual source modules.
4. **Create test infrastructure** (F9):
   - In-memory SQLite test database with migration runner
   - Factory functions for founders, products, decisions, agent instances
   - Mock/stub wrappers for Anthropic, GitHub, Stripe, Clerk, Resend clients
   - Hono test client helper for route handler testing

### Phase 2: Critical Path Tests (P0 findings)

5. **Auth middleware tests** (F2, F15) -- JWT extraction, cookie parsing edge cases, auto-provisioning, webhook HMAC verification, replay attack prevention.
6. **Tenant isolation tests** (F3) -- Founder A cannot access founder B's product. 404 not 403. Missing product ID.
7. **Billing tests** (F4) -- `canAccess()` for all tier/feature combinations. Stripe webhook tier update. Null tier blocks gated features.
8. **SCP gate tests** (F7) -- Constitution regex patterns, safety fail-closed, regression fail-open, size limits, drift threshold, Jaccard similarity.
9. **Decision/action tests** (F6) -- Gate 0 auto-execution, decision resolution, risk-state queue ordering, draft approval ownership check.
10. **SCP BaseAgent tests** (F5) -- Paused agent skip, cadence enforcement, session creation, error handling.

### Phase 3: Breadth (P1 findings)

11. **RBAC tests** (F12) -- Owner bypass, role hierarchy, permission check.
12. **Route handler tests** (F19) -- At minimum: product CRUD, decision CRUD, settings update, metric ingestion.
13. **Audit engine tests** (F14) -- Pipeline orchestration, scoring, remediation classification.
14. **Add test step to Dockerfile** (F16).
15. **E2E smoke test** (F11) -- Playwright: signup, product creation, first audit trigger, dashboard renders.

### Phase 4: Hardening (P2/P3)

16. Rate limit tests (F13).
17. Test data factories and fixtures (F18).
18. Fix `npm test` to use `--run` for CI (F17).
19. Add `jaccardSimilarity()` unit tests (F20).
20. Property-based testing for financial calculations and statistical functions.

---

## 6. Quantitative Summary

| Metric | Current | Target |
|--------|---------|--------|
| Source files | 288 | 288 |
| Test files | 7 | 50+ |
| Test files testing actual source | 3 | All |
| Test cases | ~60 | 500+ |
| Effective source file coverage | ~1% | 80%+ |
| Critical paths with tests | 0 of 6 | 6 of 6 |
| CI pipeline | None | GitHub Actions, required for merge |
| Integration test infra | None | In-memory DB + mocked externals |
| E2E test infra | None | Playwright smoke suite |
| Coverage thresholds enforced | No | Yes (80% lines) |

---

## 7. Risk Assessment

The current test state means **any code change to auth, billing, tenancy, or SCP execution ships to production with zero automated verification**. The absence of a CI pipeline compounds this -- even the existing 7 tests (3 of which are genuine) never run automatically.

The most dangerous specific scenario: a change to `src/middleware/tenant.ts` that breaks the ownership check could allow cross-tenant data access. There is no test, no CI, and no e2e check that would catch this before it reaches production.

Second most dangerous: the Stripe webhook handler in `src/services/billing/stripe.ts` maps price IDs to tiers via environment variables. A misconfiguration or code change could silently set all founders to `null` tier (revoking access) or grant `investor_ready` access to `solo` subscribers. Zero tests exist for this mapping.
