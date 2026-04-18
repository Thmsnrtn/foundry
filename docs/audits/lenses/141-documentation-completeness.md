# Lens 141 — Documentation Completeness Adversary

**Distinct value:** Evaluates whether a new engineer, given only the repository and its docs, can understand the system end-to-end without oral tradition. Grades each documentation artifact class independently: README, architecture doc, ADRs, API docs, runbook, and onboarding guide.

**Tenancy-critical:** Yes. Undocumented multi-tenancy scoping rules, SCP provisioning lifecycle, and cross-company data-flow contracts mean a new engineer could introduce a tenant isolation breach through ignorance.

## Executive Summary

Foundry's documentation is concentrated in two artifacts: the `README.md` (quick-start and structural overview) and `docs/operations/runbook.md` (deploy, incidents, key rotation). Everything else is either absent (ADRs, API reference, architecture deep-dive, contribution guide) or exists only as audit artifacts that were never intended as developer documentation. A new engineer can start the dev server and understand the directory layout within an hour. They cannot understand the SCP agent execution lifecycle, the intelligence pipeline data flow, the 54-migration schema evolution, or the 30 scheduled jobs without reverse-engineering the code. The type files (`src/services/scp/types.ts`, `src/types/index.ts`) are the strongest documentation asset, functioning as de facto architecture documents, but they are not discoverable as such.

## Artifact Grades

### 1. README.md — Grade: C+

**Strengths:**
- Quick-start instructions are functional (5 steps to running server)
- Stack table is clear and accurate
- Directory tree gives structural orientation
- Gate system and risk state tables are genuinely useful reference material
- CLI commands documented with examples

**Weaknesses:**
- Documents 14 scheduled jobs; the codebase has 30. The README is stale by 16 jobs.
- Pricing tiers in README (Founding $99 / Growth $199 / Scale $399) differ from `env.ts` labels (Solo / Growth / Investor-Ready) and from `.env.example` (Solo $79 / Growth $199 / Investor-Ready $399). Three sources, three different names and prices.
- No mention of the middleware stack order or how auth flows work
- No mention of SCP provisioning (happens at server startup, not during onboarding)
- No mention of the privacy/consent system or data export capability
- "16 Tables" in the schema section is stale; 54 migrations have added many more tables
- No link to runbook, feature catalog, or any other docs

**What a new engineer misses:** The agent execution lifecycle, how signals flow from metrics to stressors to risk state to digests, and why SCP provisioning happens at startup instead of during onboarding.

### 2. Architecture Document — Grade: F (Does Not Exist)

There is no `docs/architecture.md` or equivalent. The `00-orientation.md` in the audits directory is the closest thing, but it was generated as an audit artifact, not as a developer-facing architecture reference.

**What a new engineer misses:**
- Request lifecycle: how a request flows through auth -> tenant -> tier-gate -> rate-limit -> rbac -> route handler -> service -> AI/DB -> view
- SCP execution model: hourly scheduler -> iterate products -> per-agent: load context -> check cadence -> call `analyzeAndAct()` -> process signals -> update health
- Intelligence pipeline: metric ingestion -> snapshot -> stressor evaluation -> risk state machine -> recovery protocol -> digest generation
- Data isolation model: owner_id scoping, 404-not-403 for non-owned products, the intentionally cross-tenant `decision_patterns` table
- The relationship between `products.status` and `scp_status` (they are independent, not synchronized)

### 3. Architecture Decision Records (ADRs) ��� Grade: F (None Exist)

Zero ADRs anywhere in the repository. Key decisions that need recorded rationale:

- Why server-rendered HTML with HTMX instead of a frontend framework
- Why Turso/SQLite instead of PostgreSQL for a multi-tenant SaaS
- Why in-process cron jobs instead of a separate job runner
- Why 12 specific agents with these specific cadences and authority levels
- Why Gate 0/1 suspension in Red state with two exceptions (behavioral triggers, critical support routing)
- Why `decision_patterns` is intentionally cross-tenant and anonymized
- Why SCP provisioning happens at server startup instead of during onboarding
- Why ENCRYPTION_KEY is not validated at startup (it is not in the required vars list)

### 4. API Documentation — Grade: F (None Exist)

No OpenAPI/Swagger spec. No API reference document. The codebase has:
- 14+ JSON API routes under `/api/`
- Internal ecosystem routes under `/internal/`
- A mobile API under `/api/mobile/`
- An SDK package under `packages/foundry-sdk/`
- A v1 API under `src/api/v1/`

None of these have documented request/response schemas, error codes, authentication requirements, or rate limits. The only documentation is inline code comments. An SDK consumer has zero reference material.

### 5. Operations Runbook — Grade: B-

**Strengths:**
- Deployment commands documented (Fly.io standard and rolling)
- Fresh deploy checklist with all required secrets
- Health check endpoint documented with expected response
- CLI operations documented (migrate, seed, status, job run)
- Key rotation procedures for all 5 service keys
- Backup/restore commands documented
- Incident response for 4 scenarios (AI outage, DB issues, billing webhook, runaway costs)
- Tenant offboarding step-by-step (6 steps)

**Weaknesses:**
- ENCRYPTION_KEY rotation says "Run migration script to re-encrypt (not yet implemented)" -- the critical step is missing
- Backup restore has never been tested (the runbook shows the commands but no verification step for data integrity)
- No Resend key rotation procedure (it is the only service key without rotation docs)
- No GitHub OAuth credential rotation procedure
- Incident response does not cover Clerk outage (auth system down = all users locked out)
- No escalation path or on-call rotation documented
- No rollback procedure for failed deployments
- "Monitoring" section lists metrics to watch but not how to set up alerts
- Tenant offboarding says "Run: `npm run cli -- founder:delete <founder_id>`" but this CLI command's behavior is not verified against the actual code (the Clerk webhook handles deletion via direct SQL, the CLI path may differ)

### 6. Feature Catalog — Grade: B

`docs/features/README.md` is well-structured, listing every user-facing feature with purpose, route, tier gate, and brief description. It covers the SCP agents, intelligence layers, wisdom layer, billing, communication, and fleet intelligence. This is the second-best documentation artifact after the runbook.

**Weaknesses:**
- Does not document the privacy/consent system
- Does not document the team/RBAC system
- Fleet Intelligence section describes aspirational features as if they exist
- No links to the relevant source files

### 7. Onboarding Guide for New Engineers — Grade: F (Does Not Exist)

No `CONTRIBUTING.md`, no `docs/onboarding.md`, no `docs/getting-started.md`. A new engineer has only the README quick-start. There is no explanation of:
- How to run tests (7 unit test files exist but no test command in the README)
- How to create a new route or service
- Code style conventions or patterns to follow
- How to add a new SCP agent
- How to add a new scheduled job
- How to test multi-tenant isolation

## Findings Summary

| # | Artifact | Grade | Impact |
|---|----------|-------|--------|
| 1 | README.md | C+ | Functional quick-start but stale and shallow |
| 2 | Architecture doc | F | Does not exist; system is too complex for README alone |
| 3 | ADRs | F | Zero decision records; critical design rationale is oral tradition |
| 4 | API docs | F | Zero reference for 14+ API routes, SDK, or mobile API |
| 5 | Operations runbook | B- | Solid base but missing critical rotation steps and rollback |
| 6 | Feature catalog | B | Good structure but incomplete coverage |
| 7 | Onboarding guide | F | Does not exist |

## Overall Documentation Grade: D

A new engineer can start the server. They cannot understand the system. The type files and code comments are strong, but discoverable documentation is absent for architecture, API contracts, and engineering onboarding. The system's complexity (12 agents, 30 jobs, 54 migrations, 6 middleware layers, 5 gate levels, 3 risk states) demands more than a README.

## Priority Remediation

1. **P0:** Create `docs/architecture.md` covering request lifecycle, SCP execution model, intelligence pipeline, and data isolation model
2. **P0:** Create `docs/api.md` or generate OpenAPI spec from route definitions
3. **P1:** Create ADRs for the 8 critical decisions listed above
4. **P1:** Add CONTRIBUTING.md with code patterns, test commands, and new-feature guides
5. **P2:** Update README to reflect current job count, correct pricing, and link to other docs
