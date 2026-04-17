# Foundry — Architecture Orientation (Phase 0)

Generated: 2026-04-17 | Session: 1

## Product Identity

Foundry is an autonomous business intelligence platform for SaaS founders. It runs a 12-agent Sovereign Company Protocol (SCP) per product, providing autonomous monitoring, decision support, risk management, and remediation. The directive positions it as a **multi-company autonomous control plane** — a fleet-management layer for running multiple SCP instances from a single founder-facing interface.

**Current state:** Single-company SCP is implemented. Multi-company fleet orchestration is aspirational — a portfolio/investor layer exists but there is no SCP-to-SCP coordination, cross-company intelligence extraction, or fleet-level meta-agents.

## Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 20+, TypeScript (strict mode) |
| Framework | Hono (server-rendered HTML, no frontend framework) |
| Database | Turso (libSQL/SQLite) |
| Auth | Clerk (JWT from cookie/header) |
| AI | Anthropic Claude Opus 4.6 (strategic) + Sonnet 4.5 (operational) |
| Email | Resend |
| Payments | Stripe (3 tiers: Solo $79, Growth $199, Investor-Ready $399) |
| Deployment | Fly.io (Dockerfile) |
| UI | Server-rendered HTML via Hono `html` template literals + HTMX |
| Mobile | Native iOS app (SwiftUI) + mobile API endpoints |

## Codebase Metrics

| Metric | Count |
|--------|-------|
| TypeScript source files | ~288 |
| Database migrations | 54 |
| Core schema tables | 16 (plus ~40 from later migrations) |
| Route files | 82 |
| Service modules | ~176 |
| Scheduled jobs | 26 |
| Middleware layers | 6 |
| SCP agents | 12 |
| Unit tests | 7 files |
| `console.log/error/warn` occurrences | 422 across 40 files |
| `as any` casts | 36 across 15 files |

## Directory Structure

```
src/
  index.ts              # Hono server, route mounting, 26 cron jobs
  env.ts                # Environment validation (fail-fast on required vars)
  db/
    client.ts           # Turso wrapper, multi-tenant query helpers
    schema.sql          # 16-table core schema
    migrations/         # 54 SQL migrations
    migrate.ts          # Migration runner
    seed.ts / seed-demo.ts
  types/
    index.ts            # Core domain types (gates, risk states, tiers)
    database.ts         # Raw SQL row types
    ai.ts               # AI pipeline types
    api.ts              # Request/response types
  middleware/
    auth.ts             # Clerk JWT → founder resolution
    tenant.ts           # Product ownership validation (404 not 403)
    tier-gate.ts        # Subscription tier access control
    rate-limit.ts       # Token bucket rate limiting
    rbac.ts             # Role-based access control
    internal.ts         # Ecosystem service key validation
  services/             # ~176 files across domains:
    ai/                 # Anthropic client, prompt composer, safety gates
    audit/              # 8-step GitHub analysis, 10-dim scoring, remediation
    intelligence/       # Stressor, risk-state, revenue, cohort, competitive (17 services)
    scp/                # 12 agents + provisioner, scheduler, evolution, briefings (40+ files)
    decisions/          # Queue, patterns, action execution
    lifecycle/          # Monitor, stage detection, conditions
    billing/            # Stripe integration, cohort enforcement
    digest/             # Weekly/yellow/red digest generation + delivery
    integration/        # GitHub, Slack, Stripe, Sentry, Resend, PostHog, Linear, Intercom
    integrations/       # Sync framework, health monitor, job signals
    portfolio/          # Multi-product portfolio manager (investor layer)
    financial/          # Economics, simulator
    customers/          # Customer intelligence, lifecycle
    wisdom/             # DNA, patterns, network, failures, cofounder
    ux/                 # Milestones, hints, notifications, tour, next-action
    + 15 more domain dirs
  routes/
    public/             # Landing, pricing, case studies (no auth)
    auth/               # Clerk signup/login/webhook
    dashboard/          # 59 authenticated page routes (server-rendered HTML)
    api/                # 14 JSON API routes
    internal/           # Ecosystem health (service key auth)
    ingest/             # Metric ingestion webhook
    signal/             # Signal timeline
    share/              # Public sharing links
  views/
    layout.ts           # HTML layouts (public, dashboard, chamber)
    components.ts       # Reusable HTML component functions
  jobs/
    index.ts            # 26 scheduled jobs with cron expressions
  cli/
    index.ts            # CLI: migrate, seed, job runner, status checks
tests/
  unit/                 # 7 test files (minimal coverage)
ios/                    # Native iOS app (SwiftUI)
packages/
  foundry-sdk/          # SDK package for external integrations
```

## Subsystem Boundaries

### 1. Authentication & Multi-Tenancy
- Clerk JWT validation (cookie `__session` or Bearer header)
- Auto-provisioning if webhook hasn't fired (race condition handling)
- Product ownership: every query scopes by `owner_id`
- Returns 404 (not 403) for non-owned products

### 2. SCP Agent System (12 agents)
- **Atlas** (CTO), **Compass** (PM), **Prism** (UX), **Beacon** (CMO), **Scribe** (Content), **Forge** (Revenue), **Harbor** (CS), **Sentinel** (DevOps), **Ledger** (Finance), **Shield** (Legal), **Oracle** (Analytics), **Crucible** (QA)
- BaseAgent v2: load context → check cadence → call `analyzeAndAct()` → process signals → update health
- Authority: Gate 0 (autonomous) → Gate 1 (notify) → Gate 2 (recommend & wait)
- Lifecycle: setup → learning → operating → optimizing → scaling
- Golden lessons injected into prompts; constitution governs behavior
- Hourly execution via SCP scheduler job

### 3. Audit & Remediation
- 8-step GitHub analysis pipeline (stack detection, config, routes, billing, trust, errors, analytics, deps)
- Claude Opus 10-dimension scoring with blocking issue classification
- Remediation: AUTO / WISDOM_REQUIRED / HUMAN_ONLY classification
- PR generation via GitHub API (branch → commit → PR)

### 4. Intelligence Layer
- Risk state machine: Green → Yellow → Red with stressor-based transitions
- MRR decomposition: new + expansion - contraction - churned
- Cohort retention analysis
- Weekly competitive scan via Claude Sonnet
- Scenario modeling (best/base/stress) for Gate 3 decisions
- Recovery protocol generation in Red state

### 5. Decision System
- 5 gate levels (0=autonomous through 4=human-only)
- Risk-state-aware thresholds (Red: suspend Gate 0/1)
- Cross-product decision patterns (anonymized, global)
- Action drafts generated but require approval for execution

### 6. Billing & Tiers
- Stripe: Solo ($79), Growth ($199), Investor-Ready ($399)
- Founding cohort: 30 slots at locked rate
- Tier gates enforce feature access
- Multi-product is Investor-Ready tier only

### 7. Portfolio/Investor Layer
- Portfolio creation (VC, accelerator, incubator, angel)
- Product → portfolio membership
- Cross-portfolio benchmarking
- Board packet generation
- API key auth (`pfk_*` format)

### 8. Communication
- Resend email delivery (digests, behavioral triggers)
- Push notifications (APNS)
- Voice briefings (mobile)
- Conversation threads (AI chat with context)

## External Dependencies (Integration Points)

| Service | Purpose | Retry? | Circuit Breaker? | Timeout? |
|---------|---------|--------|-------------------|----------|
| Anthropic (Claude) | AI analysis, scoring, generation | No | No | No |
| GitHub API | Repo analysis, PR creation | No | No | No |
| Stripe | Billing, webhooks | No | No | No |
| Clerk | Auth, user management | No | No | No |
| Resend | Email delivery | No | No | No |
| Turso | Database | No | No | No |

**Critical gap: Zero external calls have retry logic, circuit breakers, or explicit timeouts.**

## Top 20 Suspected Problems

1. **No retry/timeout/circuit-breaker on ANY external call** (Anthropic, GitHub, Stripe, Clerk, Resend, Turso)
2. **422 console.log/error/warn calls** — no structured logging
3. **GitHub access tokens stored in plaintext** (schema says "Encrypted" but no encryption code)
4. **Integration credentials (credentials_json) stored in plaintext** (schema says "encrypted at rest")
5. **36 `as any` casts** — type safety holes
6. **Only 7 unit tests** — near-zero test coverage
7. **No e2e tests** — zero Playwright/Cypress
8. **No request validation** (Zod) at HTTP boundaries — trusts all input
9. **Migration failures don't stop server** — can run with inconsistent schema
10. **SCP provisioning failures silently swallowed** — products may lack agents
11. **Lifecycle state defaults not persisted to DB** — created in memory only
12. **No transaction support** — multi-step operations not atomic
13. **Auth token extraction is regex-based** — no cookie library
14. **No request tracing** — no correlation IDs across service calls
15. **No rate limiting on AI calls** — cost attack vector
16. **No webhook signature verification** (except Stripe)
17. **Cross-product decision_patterns table has no access controls** — any founder can influence
18. **No idempotency keys** on retryable mutations
19. **CORS defaults to localhost:8080** if APP_URL not set
20. **No secrets rotation mechanism** — env vars are only config surface

## Dependency Graph (Simplified)

```
Request → Middleware (auth → tenant → tier-gate → rate-limit)
       → Route Handler
           → Service Layer (intelligence, scp, audit, decisions)
               → AI Client (Anthropic) ← No retry
               → Database (Turso) ← No transactions
               → External APIs (GitHub, Stripe, Resend) ← No retry
           → Views (layout.ts, components.ts) → HTML response
```

## Critical Paths

1. **Founder onboarding:** Clerk auth → founder provision → product creation → GitHub OAuth → repo analysis → first audit → tour start
2. **Daily operation:** Login → Signal dashboard → triage decisions → review briefing → approve/reject actions
3. **SCP execution:** Hourly job → iterate products → per-agent: load context → AI analysis → signal processing → briefing assembly
4. **Audit & remediation:** Trigger audit → GitHub analysis → 10-dim scoring → remediation classification → PR generation
5. **Billing:** Stripe checkout → webhook → tier update → feature gate enforcement

## Fleet/Multi-Company Gap Analysis

The directive positions Foundry as a **multi-company autonomous control plane**. Current state vs. target:

| Capability | Current | Target |
|-----------|---------|--------|
| Multiple products per founder | Yes (tier-gated) | Yes |
| Portfolio dashboard | Basic (investor layer) | Full fleet view |
| Per-product SCP instance | Yes | Yes |
| Cross-company intelligence | No | Yes (pattern extraction, fleet insights) |
| Fleet-level meta-agents | No | Yes (fleet Oracle, fleet Sentinel, etc.) |
| SCP instance lifecycle (provision/pause/retire/migrate) | Basic provision only | Full lifecycle |
| Five-stage company lifecycle board | No (lifecycle exists but different) | Yes |
| Cross-company data-flow contract | No | Yes (consent model, isolation proof) |
| Fleet Observatory | No | Yes (real-time agent activity across companies) |
