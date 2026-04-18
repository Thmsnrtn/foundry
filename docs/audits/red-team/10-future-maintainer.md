# Red Team 10 — Future Maintainer

**Persona:** Senior engineer joining the project 2 years from now. The original author is gone. No Slack history, no tribal knowledge. Opens the repo cold and needs to: (1) understand the architecture, (2) make a meaningful change, (3) upgrade dependencies without breaking production.

## Attack Surface / Review Scope

- README.md completeness and accuracy
- docs/ directory: architecture documentation quality
- Code comments and JSDoc coverage
- SCP agent system comprehensibility from code alone
- Dependency upgrade safety
- Onboarding-to-productive-contribution time

## Findings

### RT-10-01 README Is Solid but Contains Stale Data and Missing Operational Essentials

- **Severity:** P2
- **Description:** The README is above average for a project this size. It has a quick start, architecture tree, stack table, schema listing, gate system, risk states, intelligence layers, scheduled jobs, CLI commands, and deployment instructions. However:
  - **Stale pricing:** README says "Founding Cohort $99, Growth $199, Scale $399" but the actual code uses "Solo $79, Growth $199, Investor-Ready $399" (see `src/routes/public/landing.ts:159-200`).
  - **Stale job count:** README says "14 Scheduled Jobs" but the orientation doc counts 26 jobs. The `JOB_REGISTRY` in `src/jobs/index.ts` is the source of truth.
  - **Missing: how to run tests.** The README lists `npm run dev`, `npm run cli`, and `fly deploy` but not `npm test` or `npm run typecheck`.
  - **Missing: environment variable documentation.** The quick start says "Fill in all values (Turso, Clerk, Stripe, Anthropic, Resend, GitHub)" but does not list the specific variable names. The actual required vars are enumerated in `src/index.ts:144-153` and `src/env.ts`.
  - **Missing: architecture decision records.** No ADRs explaining why Hono over Express, why Turso over Postgres, why server-rendered HTML over React, why 12 agents instead of N, etc.
  - **Missing: contribution guide.** No CONTRIBUTING.md, no PR template, no code style guide.
- **Evidence:** `README.md:170-174` (stale pricing). `README.md:138-155` (14 jobs listed vs 26+ actual). `README.md:7-23` (quick start omits test/typecheck). `src/index.ts:144-153` (required env vars not documented in README).
- **Remediation:** (1) Update pricing and job count to match code. (2) Add a "Testing" section: `npm test`, `npm run typecheck`. (3) Add a `.env.example` file (may already exist) and document all required env vars with descriptions. (4) Create a `docs/adr/` directory with records for the 5 biggest architectural decisions. (5) Add a CONTRIBUTING.md with code style expectations.

### RT-10-02 docs/ Directory Is Strategy-Heavy, Architecture-Light

- **Severity:** P1
- **Description:** The `docs/` directory contains: `audits/`, `backlog/`, `blockers/`, `design/`, `features/`, `operations/`, `scp/`, `security/`, `strategy/`. Of these:
  - `docs/operations/runbook.md` -- exists but is a single file for the entire ops surface.
  - `docs/security/tenant-isolation-proof.md` -- exists, good.
  - `docs/scp/cross-company-contract.md` -- exists, covers cross-company data flow.
  - `docs/design/` -- empty directory.
  - `docs/features/` -- empty directory.
  - **Missing: System architecture document.** No file explains how requests flow from Hono through middleware to routes to services to the database. No diagram of the SCP lifecycle. No explanation of the relationship between `SCPInstance`, `BaseAgent`, agent subclasses, the scheduler, evolution engine, briefing system, and constitution.
  - **Missing: Data model documentation.** 54 migrations, 16+ core tables, ~40 additional tables. No ER diagram. No explanation of which tables relate to which subsystem.
  - **Missing: Integration map.** 8+ external services (Anthropic, GitHub, Stripe, Clerk, Resend, Turso, PostHog, Intercom) with no document mapping which services call which APIs, what credentials are needed, and what happens when each fails.
- **Evidence:** `docs/` directory listing shows strategy and audit focus, not engineering reference. `docs/design/` is empty. No `ARCHITECTURE.md` or equivalent.
- **Remediation:** Create three documents: (1) `docs/ARCHITECTURE.md` -- request lifecycle, subsystem boundaries, data flow diagram (text-based mermaid is fine). (2) `docs/DATA_MODEL.md` -- ER diagram (mermaid), table-to-subsystem mapping, key relationships. (3) `docs/INTEGRATIONS.md` -- service map, credentials required, failure modes, retry behavior (or lack thereof).

### RT-10-03 SCP Agent System Is Comprehensible from Code but Requires Significant Archaeology

- **Severity:** P2
- **Description:** The SCP agent system spans ~27,000 lines across 40+ files in `src/services/scp/`. A future maintainer trying to understand "how does an agent run?" would need to trace:
  1. `src/jobs/index.ts` -- finds the cron job that calls `runDueAgentsForAllProducts()`
  2. `src/services/scp/scheduler.ts` -- discovers the product iteration loop
  3. `src/services/scp/instance.ts` -- finds `SCPInstance.runAllDueAgents()` and `runAgent()`
  4. `src/services/scp/agents/base.ts` -- finds the 757-line `BaseAgent` class with 12-step `run()` method
  5. `src/services/scp/agents/atlas.ts` (or any subclass) -- finds the `analyzeAndAct()` implementation
  6. `src/services/scp/types.ts` -- finds all the type definitions

  This is actually a *reasonable* trace -- the abstractions are well-named and the file organization is logical. The code reads well. But:
  - `BaseAgent.run()` is a 12-step method with no step-level comments explaining the *why* behind each step. Steps 7-11 load agent config, integration events, unread messages, pending initiatives, and scratchpad context -- but there is no overview comment explaining what "v2 enrichment" means or why it was added.
  - JSDoc coverage across the SCP directory is sparse: 115 JSDoc-style comments across 25 files (out of 40+ files and 27,000 lines). Many public functions have no documentation.
  - The `types.ts` file (478 lines) is the best-documented file in the SCP system, with clear comments on every type. This is good. But `instance.ts`, `scheduler.ts`, and most agent subclasses have minimal comments.
  - The evolution engine (`evolution.ts`) has good function-level JSDoc but no overview explaining the 5-gate validation pipeline or how golden lessons accumulate.
- **Evidence:** `src/services/scp/agents/base.ts:106-136` -- steps 7-11 of `run()` load context enrichment with inline comments but no architectural rationale. JSDoc grep: 115 occurrences across 25 files in `src/services/scp/`. `src/services/scp/types.ts` -- well-documented (23 JSDoc comments). `src/services/scp/instance.ts` -- no JSDoc on public methods.
- **Remediation:** (1) Add a `src/services/scp/README.md` (or `docs/scp/ARCHITECTURE.md`) with: agent lifecycle diagram, run sequence, evolution pipeline, briefing assembly, constitution role. (2) Add JSDoc to all public methods in `instance.ts`, `scheduler.ts`, `provisioner.ts`, and `briefing.ts`. (3) Add a module-level comment in `agents/base.ts` explaining the 12-step run sequence and why each step exists. (4) Add `@see` links between related files (e.g., `base.ts` should reference `evolution.ts`, `types.ts`).

### RT-10-04 148 console.log/error/warn Calls Across 20 Files -- Structured Logging Is Partially Adopted

- **Severity:** P2
- **Description:** The orientation doc reported 422 `console.*` calls. Current count is 148 across 20 files (significant progress). However, production code still uses `console.error` in critical paths: `src/services/scp/provisioner.ts:159` uses `console.error` instead of the structured `logger`. The `logger` from `src/services/logger.ts` exists and is used in most service files, but adoption is incomplete. A future maintainer would find two logging systems and not know which to use.
- **Evidence:** 148 `console.*` calls across 20 files (grep count). `src/services/scp/provisioner.ts:159` -- `console.error('[provisioner] ...')`. The `logger` is imported in `scheduler.ts`, `instance.ts`, and most jobs, but not in `provisioner.ts`.
- **Remediation:** (1) Replace all remaining `console.*` calls with structured `logger.*` calls. (2) Add an ESLint rule: `no-console: error` (with exceptions for CLI scripts in `src/cli/`). (3) Document the logging convention in CONTRIBUTING.md or the README.

### RT-10-05 38 `as any` Casts Across 17 Files -- Type Safety Holes for Future Maintenance

- **Severity:** P2
- **Description:** 38 `as any` casts exist across 17 files. These are time bombs for a future maintainer: they suppress TypeScript errors at the cost of runtime safety. Key offenders:
  - `src/routes/dashboard/onboarding.ts` (5 casts) -- `dashboardLayout(ctx, ...)` uses `as any` because the layout context type does not match.
  - `src/middleware/auth.ts` (3 casts) -- auth middleware uses `as any` for Clerk types.
  - `src/services/integrations/stripe-webhook.ts` (4 casts) -- Stripe event handling.
  - `src/routes/api/platform.ts` (7 casts) -- the most type-unsafe file.
  A maintainer changing the layout context type would get no compiler warnings for the 5 onboarding casts.
- **Evidence:** 38 `as any` occurrences across 17 files (grep count). `src/routes/dashboard/onboarding.ts:70` -- `dashboardLayout({ ...ctx, showNav: false } as any, content)`.
- **Remediation:** (1) Fix the top 5 offending files by adding proper type overloads or extending interfaces. (2) For the layout context: add a `showNav` property to the layout context type. (3) Add a TypeScript ESLint rule: `@typescript-eslint/no-explicit-any` as a warning, then ratchet to error. (4) Track `as any` count as a code health metric.

### RT-10-06 Only 13 Unit Test Files -- Dependency Upgrades Cannot Be Verified

- **Severity:** P1
- **Description:** The test suite contains 13 unit test files in `tests/unit/`: `ai-calibration`, `ai-client`, `csrf`, `customer-health`, `encryption`, `experiment-stats`, `financial`, `risk-state`, `sanitize`, `sector-profiles`, `stage-detection`, `tenancy-isolation`, `tier-gate`. This covers some critical paths (encryption, auth, tier gating) but leaves vast surfaces untested:
  - Zero tests for any of the 12 agent subclasses
  - Zero tests for the scheduler, provisioner, or instance orchestration
  - Zero tests for any route handler
  - Zero tests for the briefing/digest pipeline
  - Zero tests for the audit engine
  - Zero integration or e2e tests
  
  A future maintainer asked to "upgrade Hono from v4 to v5" or "upgrade the Anthropic SDK from v0.20 to v1.0" has no test harness to verify that the upgrade does not break agent execution, briefing generation, or onboarding flows. The only safety net is `npm run typecheck`.
- **Evidence:** `tests/unit/` -- 13 files. No `tests/integration/`, no `tests/e2e/`, no Playwright config. `vitest.config.ts` exists but covers only unit tests.
- **Remediation:** (1) Add integration tests for the critical path: onboarding -> product creation -> SCP provisioning -> agent run (mocked AI). (2) Add smoke tests for the top 5 route handlers (landing, dashboard, portfolio, agents, briefing). (3) Before any major dependency upgrade, add a "golden output" test: run an agent with a mocked AI response and snapshot the output. (4) Target 40% line coverage within 6 months as a minimum safety net.

### RT-10-07 54 Database Migrations with No Rollback Support and Duplicate Numbering

- **Severity:** P1
- **Description:** The `src/db/migrations/` directory contains 54 SQL migration files. Two issues:
  1. **Duplicate numbering:** Files `004_sector_profiles.sql` and `004_signal_wisdom.sql` share the `004` prefix. Similarly `005_growth_stages.sql` and `005_signal_history.sql`, and `006_founder_health.sql` and `006_intelligence_layer.sql`. The migration runner presumably sorts by filename -- the execution order of duplicate-numbered migrations is filesystem-dependent (alphabetical), which means it could vary between macOS (case-insensitive) and Linux (case-sensitive) production environments.
  2. **No rollback mechanism:** The orientation doc notes "Migration failures don't stop server -- can run with inconsistent schema." There is no `down` migration or rollback function. A future maintainer who needs to roll back a migration must write the rollback SQL manually with no tooling support.
  This means a dependency upgrade that requires a schema change (e.g., a new column for a library) is high-risk with no safety net.
- **Evidence:** `src/db/migrations/` -- `004_*.sql` (2 files), `005_*.sql` (2 files), `006_*.sql` (2 files). `src/db/migrate.ts` -- migration runner (no rollback function observed).
- **Remediation:** (1) Re-number migrations to eliminate duplicates (e.g., `004a`, `004b` or sequential `004`, `005`). (2) Add rollback support: either `down` SQL files or a migration framework that supports it. (3) Make migration failures fatal in production: if a migration fails, stop the server. (4) Add a migration test that applies all migrations to an in-memory SQLite database.

### RT-10-08 Monolith Entry Point Imports 60+ Route Modules -- No Lazy Loading or Module Boundaries

- **Severity:** P2
- **Description:** `src/index.ts` imports 60+ route modules at the top level. Every route file, every service, and every dependency is loaded at startup. This is a monolith with no module boundaries. For a future maintainer, this means:
  - Changing any service file requires understanding its transitive import graph
  - No way to test a subsystem in isolation without importing the entire app
  - Startup time will grow linearly with codebase size
  - Circular dependency risk increases with each new import
  The SCP subsystem alone (`src/services/scp/`) has 40+ files that are transitively imported at startup even if no SCP features are used in a given request.
- **Evidence:** `src/index.ts:1-137` -- 60+ import statements. No dynamic imports for route groups. No module federation or lazy loading.
- **Remediation:** (1) Group routes into sub-apps that can be mounted lazily: `app.route('/dashboard', () => import('./routes/dashboard/index.js'))`. (2) Create clear subsystem boundaries: SCP, Billing, Intelligence, UX should each have an entry point that can be tested independently. (3) Consider a monorepo structure with `packages/scp`, `packages/billing`, etc. for strict dependency boundaries. (4) At minimum, add a dependency graph visualization to docs so maintainers can see the import tree.

### RT-10-09 No Dependency Pinning -- Major Version Ranges in package.json

- **Severity:** P2
- **Description:** `package.json` uses caret ranges for all dependencies: `"hono": "^4.0.0"`, `"@anthropic-ai/sdk": "^0.20.0"`, `"stripe": "^14.0.0"`, etc. While `package-lock.json` pins exact versions, a `npm install` on a fresh clone could pull Hono 4.x.y (latest minor/patch) which may have breaking changes in template literal handling or middleware behavior. Two years from now, running `npm install` will resolve to whatever the latest ^4 version is, which could be 4.12.0 with subtle behavioral changes.
  
  More critically, the Anthropic SDK `^0.20.0` is a pre-1.0 semver range. By convention, `^0.20.0` allows `>=0.20.0 <0.21.0`, but the Anthropic SDK has historically had breaking changes in minor versions. Two years from now, the SDK may be at v2.0+ and `^0.20.0` will no longer resolve.
- **Evidence:** `package.json:17-27` -- all dependencies use `^` ranges. `@anthropic-ai/sdk: "^0.20.0"` is pre-1.0 semver.
- **Remediation:** (1) Pin exact versions for critical dependencies: `"@anthropic-ai/sdk": "0.20.0"`, `"hono": "4.0.0"`. (2) Use `npm ci` in production (which respects lockfile exactly) and document this in the README. (3) Add Renovate or Dependabot for controlled dependency updates with PR review. (4) Add the lockfile to `.gitignore` exclusion list (ensure it IS committed).

### RT-10-10 No Architecture Decision Records -- "Why" Is Lost

- **Severity:** P2
- **Description:** The codebase makes several non-obvious architectural choices:
  - **Hono over Express/Fastify:** Why a less common framework?
  - **Server-rendered HTML over React/Vue:** Why no frontend framework for a complex dashboard?
  - **Turso/libSQL over PostgreSQL:** Why SQLite-based for a multi-tenant SaaS?
  - **12 fixed agents instead of configurable N:** Why these 12 specifically? Why not let founders enable/disable agents?
  - **HTMX for interactivity:** Why not a full SPA?
  - **Single-file cron scheduler instead of a job queue:** Why not Bull/BullMQ?
  
  None of these decisions are documented. A future maintainer will not know if these were deliberate trade-offs or expedient choices. They will not know which decisions are load-bearing (cannot change without major rework) and which are incidental (can be swapped).
- **Evidence:** No `docs/adr/` directory. No `DECISIONS.md`. No architectural rationale in code comments beyond occasional inline notes.
- **Remediation:** Retroactively document the top 10 architectural decisions as ADRs (Architecture Decision Records). Use the standard ADR format: Context, Decision, Status, Consequences. Priority: (1) Why Hono, (2) Why server-rendered HTML, (3) Why Turso, (4) Why 12 fixed agents, (5) Why single-process cron.

## Status: HAS P0-P1

Two P1 findings (sparse test coverage making upgrades unsafe, migration system with duplicate numbering and no rollbacks) and one P1 (docs are strategy-heavy but architecture-light) create serious onboarding risk for a future maintainer. The codebase is well-organized and the naming conventions are strong, but the documentation gap means a new engineer would need 2-3 weeks of archaeology to become productive. The test gap means any meaningful change is a leap of faith. Priority: add architecture docs, integration tests for the critical path, and proper migration tooling.
