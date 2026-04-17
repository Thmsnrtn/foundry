# Lens 47 — Documentation Writer Audit

**Auditor perspective:** Documentation writer / developer experience expert
**Scope:** README.md, .env.example, /docs/ files, code comments, JSDoc usage, architecture documentation, self-documenting code assessment
**Date:** 2026-04-16

---

## Executive Summary

Foundry's documentation is concentrated almost entirely in the README.md, which is comprehensive for a quick-start guide but inadequate as a sole reference for a new developer. The .env.example is well-commented and includes provisioning links for each service. Code files consistently use section-header comments (the `// === FOUNDRY ===` banner pattern) and meaningful function-level doc comments, but formal JSDoc with `@param`/`@returns`/`@throws` annotations is nearly absent (only 6 occurrences across 288 source files). The `/docs/` directory contains only audit artifacts and competitive strategy -- no architecture documents, API reference, deployment guide, onboarding guide, or contribution standards. The type system is the strongest documentation asset: `src/services/scp/types.ts` is effectively an architecture document, with every type, default, and constant annotated with purpose comments. A new developer can orient from README + types + code comments in a day, but they will have to reverse-engineer the scheduling system, middleware stack, and inter-service dependencies from code.

**P0 findings:** 0
**P1 findings:** 3
**P2 findings:** 5
**P3 findings:** 4

---

## Finding 01 — No architecture document beyond README

**Severity: P1**
**File:** `/docs/` directory

The `/docs/` directory contains only:
- `audits/` -- audit reports (not developer documentation)
- `strategy/` -- competitive landscape analysis (business documentation)

There is no:
- Architecture Decision Records (ADRs)
- System design document explaining the SCP model, agent lifecycle, or intelligence pipeline
- Data flow diagram showing how metrics flow from ingestion to stressors to risk state to digests
- Middleware stack explanation (auth -> tenant -> tier-gate -> rate-limit -> rbac)
- Database schema documentation beyond the 16-table list in the README
- Deployment guide for Fly.io (despite a Dockerfile and fly.toml existing)

The README covers the architecture in 50 lines but does not explain why decisions were made or how subsystems interact.

**Impact:** A new developer joining the project must reverse-engineer critical flows. The 26 cron jobs, 6 middleware layers, and 12-agent system are complex enough to require dedicated documentation.

**Remediation:**
1. Create `docs/architecture.md` covering: request lifecycle, SCP agent execution flow, intelligence pipeline (metrics -> stressors -> risk state -> digest), and billing/tier enforcement.
2. Create `docs/deployment.md` covering: Fly.io deployment, environment variable setup, migration process, and monitoring.
3. Create `docs/agents.md` explaining the 12 agents, their cadences, authority levels, and evolution process.

---

## Finding 02 — JSDoc is effectively absent

**Severity: P1**
**Files:** All `src/` files

Across 288 TypeScript source files, there are only 6 occurrences of formal JSDoc annotations (`@param`, `@returns`, `@throws`, `@example`). These are concentrated in 4 files (`rate-limit.ts`, `team.ts`, `signals-multimodal.ts`, `ambient.ts`).

The codebase uses informal doc comments extensively (e.g., `/** Get the current tour state for a founder. */` in `tour.ts`), which provide high-level intent but not parameter types, return types, error conditions, or usage examples. TypeScript provides type information, but JSDoc adds semantic context that types cannot express (e.g., "throws if product not found" vs. "returns undefined if not found").

**Impact:** IDE hover-docs show function signatures but not behavioral contracts. New developers must read implementation to understand error handling, side effects, and edge cases.

**Remediation:**
1. Add `@throws` annotations to all functions that can throw (especially service functions called from routes).
2. Add `@param` descriptions for non-obvious parameters (e.g., what format does `productId` take? Is it a nanoid?).
3. Add `@example` blocks to complex utility functions (e.g., `evaluateConditions`, `buildTourStepData`, `classifyRemediability`).

---

## Finding 03 — 339 console.log/error/warn calls replace structured documentation

**Severity: P1**
**Files:** 20+ files (heaviest: `src/jobs/index.ts` with 205 occurrences)

The codebase uses `console.log/error/warn` for operational logging instead of a structured logger. These calls serve as de facto documentation of what the system is doing, but they are:
- Not searchable by severity or category
- Not suppressible by environment (development vs. production)
- Not parseable by log aggregation tools
- Mixed with actual error handling (some `console.error` calls are followed by error recovery, some are not)

The `jobs/index.ts` file alone has 205 console statements, which means the scheduled job runner is the primary source of operational documentation -- via log output.

**Impact:** Operational behavior is documented in console statements that are invisible in code review and unsearchable in documentation.

**Remediation:** Replace all `console.*` calls with a structured logger (e.g., pino or winston) that includes context (productId, agentName, jobName) and severity levels. This is also an SRE concern (see Lens 06) but has documentation implications.

---

## Finding 04 — README describes 14 jobs but codebase has 26

**Severity: P2**
**File:** `README.md` (lines 139-155), `src/jobs/index.ts`

The README documents 14 scheduled jobs. The orientation document identifies 26 scheduled jobs. The README is stale by 12 jobs. New jobs (SCP agent execution, evolution, briefing generation, integration sync, etc.) were added without updating the README.

**Impact:** A developer relying on the README will be unaware of 12 scheduled processes that consume resources and affect system behavior.

**Remediation:** Either update the README with all 26 jobs or (better) generate the job list from `src/jobs/index.ts` programmatically.

---

## Finding 05 — .env.example is well-documented (positive finding)

**Severity: P2 (positive)**
**File:** `.env.example`

The .env.example file is one of the best-documented parts of the codebase:
- Each service section has a comment explaining where to provision (e.g., "Provision at https://turso.tech")
- API key formats are shown (e.g., `sk_test_...`, `re_...`, `phx_...`)
- The callback URL for GitHub OAuth is documented inline
- Stripe tier prices are annotated with dollar amounts
- Ecosystem integration keys are explained

**Impact:** Positive. A new developer can set up all external services by following the .env.example comments alone.

**Recommendation:** This is the documentation standard the rest of the codebase should aspire to.

---

## Finding 06 — Type files serve as architecture documentation

**Severity: P2 (positive)**
**File:** `src/services/scp/types.ts`, `src/types/index.ts`

The SCP types file is effectively an architecture document. It defines:
- All 12 agents with name, display name, role, default authority level, cadence, and health weight
- The company lifecycle states with inline comments explaining each stage
- The default constitution with core values and operating principles (readable by non-engineers)
- Agent session output with every field annotated
- Evolution version tracking with change types

A developer reading this single file understands the SCP system's design intent, default configuration, and data model.

**Impact:** Positive. The type system compensates for the lack of formal architecture documentation.

**Recommendation:** Reference this file prominently in any future architecture document. Consider adding a "start here" comment at the top of the file.

---

## Finding 07 — No API documentation

**Severity: P2**
**File:** `src/routes/api/`

There are 14+ JSON API routes (ask, supercharge, ux, tier2, tier3, platform, priority, mobile) with no API documentation:
- No OpenAPI/Swagger spec
- No request/response examples
- No authentication requirements documented
- No rate limit documentation
- No error response format documentation

The internal ecosystem routes (`/internal/*`) are also undocumented, which means integrating services (Koldly, AcreOS, Apex Micro) must reverse-engineer the API.

**Impact:** External integrators and the iOS app team must read source code to understand API contracts.

**Remediation:** Generate an OpenAPI spec from the route definitions. At minimum, document the `/api/` and `/internal/` route groups with request/response examples.

---

## Finding 08 — Section-header comments are consistent but shallow

**Severity: P2**
**Files:** All `src/` files

Every file starts with a banner comment:
```typescript
// =============================================================================
// FOUNDRY — Module Name
// Brief description of purpose.
// =============================================================================
```

This pattern is applied consistently across all 288 files. Within files, section separators (`// --- Section Name ---`) organize functions logically. Function-level comments describe intent in one sentence.

However, the comments describe "what" but rarely "why." For example, the provisioner comment says "Creates the 12 agent instances and constitution for a new company" but does not explain why 12 agents are created, why the stagger is 30 minutes, or why the constitution uses specific default values.

**Impact:** A developer can navigate the codebase efficiently but must infer design rationale from the code itself.

**Remediation:** Add "why" comments for non-obvious design decisions, especially: default cadence values, health weight allocations, authority level assignments, and evolution policy thresholds.

---

## Finding 09 — No contribution guide or coding standards document

**Severity: P3**
**File:** Root directory

There is no `CONTRIBUTING.md`, no `.editorconfig`, no documented coding standards. The codebase is internally consistent (the `CLAUDE.md` file in the AcreOS project defines standards, but no equivalent exists in the Foundry repo), but conventions like:
- Use `nanoid` for all IDs
- Use `Record<string, unknown>` for untyped DB rows
- Use `as any` minimally (36 instances)
- File naming conventions (kebab-case for routes, camelCase for services)

...are implied but not documented.

**Impact:** A new contributor may introduce inconsistent patterns (UUIDs instead of nanoids, different type assertion styles, etc.).

**Remediation:** Create a `CONTRIBUTING.md` or add a coding standards section to the README covering: ID generation, type assertion patterns, error handling conventions, and file naming.

---

## Finding 10 — Database migrations lack descriptions

**Severity: P3**
**File:** `src/db/migrations/` (54 files)

With 54 migration files, there is no index or changelog describing what each migration does. Migration files are SQL, which is self-documenting to a degree, but a developer cannot quickly determine when a specific table or column was added without reading all 54 files.

**Impact:** Schema archaeology is time-consuming. Understanding the evolution of the data model requires reading 54 migration files.

**Remediation:** Add a `MIGRATIONS.md` file that lists each migration with a one-line description and date, or add header comments to each migration file.

---

## Finding 11 — No troubleshooting guide

**Severity: P3**

There is no troubleshooting section in the README or a separate troubleshooting document. Common issues a new developer will encounter:
- Turso connection failures (auth token format, database URL format)
- Clerk webhook secret mismatch
- GitHub OAuth callback URL mismatch
- Migration failures (the orientation notes migrations do not stop the server)
- SCP provisioning failures (silently swallowed)

**Impact:** New developers will spend time debugging setup issues that could be resolved by a FAQ.

**Remediation:** Add a "Common Issues" section to the README or a `docs/troubleshooting.md` file.

---

## Finding 12 — iOS app has no documentation

**Severity: P3**
**File:** `ios/` directory

The iOS app directory exists with a SwiftUI codebase but no README, no setup instructions, no architecture explanation, and no documentation of which API endpoints it consumes.

**Impact:** A mobile developer cannot onboard to the iOS app without assistance from the original author.

**Remediation:** Add an `ios/README.md` with: Xcode version requirements, provisioning profile setup, API endpoint documentation, and push notification configuration.

---

## Embarrassment Test

**Would a documentation expert be embarrassed by this?** Not embarrassed, but concerned. The README and .env.example are above average for an early-stage project. The type system as documentation is excellent. But the total absence of architecture docs, API reference, and JSDoc in a 288-file codebase with 26 cron jobs and 12 AI agents is a documentation debt that compounds with every new contributor.

## Pride Test

**What would make a documentation writer proud?** The .env.example with provisioning links and format hints is best-in-class. The SCP types file reads like a design document. The consistent file-header comment pattern across all 288 files shows disciplined documentation habits. The code is more self-documenting than most projects at this stage -- functions are well-named, types are descriptive, and the file organization maps cleanly to domain concepts.
