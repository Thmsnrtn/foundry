# Foundry — Autonomous Business Intelligence Platform

**Architecture C → D**: Web application evolving to AI agent. Built for SaaS founders who are good at building product but need an autonomous operational layer.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy environment variables
cp .env.example .env
# Fill in all values (Turso, Clerk, Stripe, Anthropic, Resend, GitHub)

# 3. Run database migrations
npm run cli -- db:migrate

# 4. Seed development data
npm run cli -- db:seed

# 5. Start development server
npm run dev
# → http://localhost:8080
```

## Architecture

```
src/
├── index.ts                 # Hono server entry point, route mounting, cron scheduler
├── db/
│   ├── client.ts            # Turso client, multi-tenant query helpers
│   ├── schema.sql           # Complete 16-table schema
│   └── migrations/          # SQL migration files
├── types/
│   ├── index.ts             # Core domain types (gates, risk states, entities)
│   ├── database.ts          # Raw SQL row types
│   ├── ai.ts                # AI pipeline types (analysis, scoring, scenarios)
│   └── api.ts               # Request/response types
├── middleware/
│   ├── auth.ts              # Clerk JWT validation → founder resolution
│   ├── tenant.ts            # Product ownership validation (404, not 403)
│   └── internal.ts          # Ecosystem service key for /internal/* routes
├── services/
│   ├── ai/
│   │   ├── client.ts        # Anthropic SDK wrapper (Opus + Sonnet)
│   │   ├── composer.ts      # Context-window-aware system prompt assembly
│   │   └── gates.ts         # Safety gate logic with risk-state thresholds
│   ├── audit/
│   │   ├── engine.ts        # 8-step GitHub analysis pipeline
│   │   ├── github.ts        # GitHub REST API integration
│   │   ├── scorer.ts        # Claude Opus 10-dimension scoring
│   │   └── comparator.ts    # Pre/post audit comparison
│   ├── intelligence/
│   │   ├── stressor.ts      # Forward-looking risk identification
│   │   ├── risk-state.ts    # Green/Yellow/Red calculation + transitions
│   │   ├── scenario.ts      # Best/base/stress scenario generation
│   │   ├── recovery.ts      # Red state recovery protocol
│   │   ├── revenue.ts       # MRR decomposition + health ratio
│   │   ├── cohort.ts        # Cohort retention analysis
│   │   └── competitive.ts   # Weekly competitive scan via Claude Sonnet
│   ├── decisions/
│   │   ├── queue.ts         # Decision queue management
│   │   └── patterns.ts      # Cross-product learning loop
│   ├── lifecycle/
│   │   ├── monitor.ts       # Lifecycle condition evaluation
│   │   └── conditions.ts    # Activation condition definitions
│   ├── digest/
│   │   ├── generator.ts     # Digest assembly (weekly, yellow pulse, red daily)
│   │   ├── narrative.ts     # AI narrative generation
│   │   └── delivery.ts      # Resend email delivery
│   ├── story/
│   │   ├── engine.ts        # Founding story artifact capture
│   │   └── publisher.ts     # Case study publishing
│   ├── billing/
│   │   ├── stripe.ts        # Stripe integration (3 tiers)
│   │   └── cohort.ts        # Founding cohort slot enforcement
│   └── triggers/
│       └── behavioral.ts    # Gate 0 behavioral trigger emails
├── routes/
│   ├── public/              # No auth: landing, pricing, case studies
│   ├── auth/                # Clerk signup/login, webhooks
│   ├── dashboard/           # Authenticated: operator dashboard, onboarding, all views
│   ├── api/                 # Authenticated: products, metrics, audit log
│   └── internal/            # Ecosystem key: health, ICP, conversions, dashboard data
├── jobs/
│   └── index.ts             # All 14 scheduled jobs with cron expressions
└── cli/
    └── index.ts             # CLI: migrate, seed, run jobs, status checks
```

## Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 20+ TypeScript |
| Framework | Hono |
| Database | Turso (libSQL) |
| Auth | Clerk |
| AI | Claude Opus 4.6 (strategic) + Claude Sonnet 4.5 (operational) |
| Email | Resend |
| Payments | Stripe (3 tiers) |
| Deployment | Fly.io |

## Database Schema (16 Tables)

`founders` · `products` · `lifecycle_state` · `audit_scores` · `decisions` · `audit_log` · `beta_intake` · `lifecycle_conditions` · `founding_story_artifacts` · `metric_snapshots` · `stressor_history` · `scenario_models` · `decision_patterns` · `cohorts` · `competitors` · `competitive_signals`

Multi-tenant by design. Every query scopes by `owner_id`. Exception: `decision_patterns` is intentionally cross-product and anonymized.

## Gate System

| Gate | Behavior | Examples |
|------|----------|---------|
| 0 | Fully autonomous — acts immediately | Behavioral trigger emails, metric snapshots |
| 1 | Notify and proceed — acts, notifies after | Stressor identification, competitive signals |
| 2 | Recommend and wait — suggests, waits for approval | Risk state transitions, weekly synthesis |
| 3 | Human decision required — presents options with scenarios | Pricing changes, pivots, feature kills |
| 4 | Human only — system never acts | Live trading, risk limit changes |

Thresholds adjust by risk state. In Red: Gate 0/1 suspended except behavioral triggers.

## Risk State System

- **Green**: Normal operations. All gates active.
- **Yellow**: Elevated monitoring. Thursday pulse digest. Retention-relevant decisions prioritized.
- **Red**: Recovery mode. Daily briefings. Gate 0/1 suspended. Recovery protocol generated.

## Intelligence Layers

1. **Stressor Identification**: Forward-looking risks from MRR health ratio, cohort deviation, competitive signals
2. **MRR Decomposition**: New + Expansion − Contraction − Churned. Health ratio = churned/new (lower is better)
3. **Cohort Intelligence**: Retention curves, channel analysis, historical comparison
4. **Competitive Monitoring**: Weekly Claude Sonnet scan. High-significance signals auto-create stressors
5. **Scenario Modeling**: Best/base/stress for Gate 3 decisions. Uses cross-product decision patterns
6. **Recovery Protocol**: Red state only. Diagnosis → root variable → stabilization plan

## 14 Scheduled Jobs

```
lifecycle_check       0 6 * * *       Daily lifecycle condition evaluation
competitive_scan      0 6 * * 0       Sunday competitive scan
weekly_synthesis      0 6 * * 5       Friday intelligence synthesis
digest_generate       0 7 * * 1       Monday weekly digests
behavioral_triggers   0 */6 * * *     Behavioral trigger emails
metric_snapshot       0 0 * * *       Daily metric snapshot placeholder
slot_enforcement      0 9 * * *       Founding cohort activation window
cold_start_check      0 5 * * *       Cold start exit evaluation
scenario_accuracy     0 8 * * 5       Friday scenario prediction accuracy
yellow_pulse          0 7 * * 4       Thursday Yellow state pulse
red_daily             0 7 * * *       Daily Red state briefing
stressor_cleanup      0 4 * * *       Auto-escalate expired stressors
pattern_aggregation   0 9 * * 0       Sunday pattern stats
story_capture         0 23 * * *      Daily milestone capture
```

## CLI Commands

```bash
npm run cli -- db:migrate              # Run migrations
npm run cli -- db:seed                 # Seed dev data
npm run cli -- db:status               # Table row counts
npm run cli -- job:list                # List all jobs
npm run cli -- job:run weekly_synthesis # Run a specific job
npm run cli -- product:status <id>     # Full product status
```

## Pricing Tiers

| Tier | Price | Features |
|------|-------|----------|
| Founding Cohort | $99/mo | Full methodology. Rate locked permanently. 30 slots. 7-day activation window. |
| Growth | $199/mo | Full methodology + dashboard. |
| Scale | $399/mo | Multi-product management. Priority support. |

## Ecosystem Integration

Internal API routes (`/internal/*`) enable communication between Foundry, Koldly (outbound), AcreOS, and Apex Micro. Authenticated via `X-Ecosystem-Key` header.

## Deployment

```bash
# Fly.io
fly deploy

# Or Docker
docker build -t foundry .
docker run -p 8080:8080 --env-file .env foundry
```

## Week 0 Self-Audit Protocol

Before shipping to any founder, Foundry runs its own ten-dimension audit against itself. The acceptance criterion: Foundry must score READY_WITH_CONDITIONS or higher on its own audit engine. This is encoded in the lifecycle system — Foundry is Product #1.
