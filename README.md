# Foundry

Autonomous AI operations layer for solo SaaS founders running 1-5 products.

Connect your GitHub repo, get a 10-dimension audit, and let 12 specialized AI agents monitor, analyze, and advise on your business — while you focus on building product.

## Who It's For

Solo SaaS founders who are good at building product but need operational support without hiring a team. Ideal for 1-5 products per account.

## What It Does

1. **Audit** — Connect a GitHub repo. Foundry analyzes code structure, configuration, billing, trust signals, error handling, analytics, and dependencies across 10 dimensions. Produces a composite score and blocking issues.

2. **Signal Score** — A single 0-100 number representing business health, updated from metrics, stressor activity, and agent observations.

3. **12 AI Agents** — Each product gets 12 specialized agents (Atlas/CTO, Compass/PM, Oracle/Analytics, Beacon/CMO, Harbor/CS, Sentinel/DevOps, Ledger/Finance, Shield/Legal, Scribe/Content, Forge/Revenue, Prism/UX, Crucible/QA). They run on configurable cadences (6h to 168h) and propose actions via a gate-controlled decision queue.

4. **Risk State** — Green/Yellow/Red adaptive system. Yellow triggers elevated monitoring. Red suspends autonomous actions and generates recovery protocols.

5. **Briefings** — Daily/weekly synthesized intelligence from all 12 agents. Delivered in-app and via email digest.

6. **Decisions Inbox** — Gate 0 (autonomous) through Gate 4 (human-only). Scenario modeling for strategic decisions. Cross-product pattern matching from anonymized outcomes.

7. **Multi-Product** — Growth tier supports up to 3 products, Investor-Ready supports up to 5. Portfolio view shows Signal scores and risk states across products. Per-product pause/resume and export/delete.

## What It Does NOT (Yet) Do

- **Fleet-level meta-agents** — FleetOracle, FleetSentinel, PortfolioLedger, FleetObservatory are specified in `docs/scp/fleet-agents/` but not implemented
- **Cross-company intelligence** — The `decision_patterns` table collects anonymized data but no service generates insights from it for users
- **Multi-organization** — Single-founder-per-account. No organization entity, no team roles across companies
- **Validated lifecycle transitions** — Lifecycle stages exist but transitions aren't enforced

See `docs/roadmap/documented-but-not-built.md` for the full list.

## Quick Start

```bash
npm install
cp .env.example .env   # Fill in: Turso, Clerk, OpenRouter, Stripe, Resend, Encryption key
npm run cli -- db:migrate
npm run cli -- db:seed  # Optional: demo data
npm run dev             # → http://localhost:8080
```

## Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 20+, TypeScript (strict) |
| Framework | Hono (server-rendered HTML + HTMX) |
| Database | Turso (libSQL) |
| Auth | Clerk |
| AI | OpenRouter (Claude Opus + Sonnet via single API key) |
| Email | Resend |
| Payments | Stripe |
| Deployment | Fly.io |

## Pricing

| Tier | Price | Products | Key Features |
|------|-------|----------|-------------|
| Solo | $79/mo | 1 | 12 agents, Signal score, briefings, decision queue, audit engine |
| Growth | $199/mo | Up to 3 | + Integrations, Wisdom Layer, Remediation Engine, team mode |
| Investor-Ready | $399/mo | Up to 5 | + Investor layer, competitive intelligence, playbooks, temporal |

## Architecture

```
src/
├── index.ts              # Hono server, route mounting, 26+ cron jobs
├── db/                   # Turso client, 16-table schema, 59 migrations
├── middleware/            # Auth, tenant, CSRF, security headers, rate limit, RBAC, tier gate
├── services/
│   ├── ai/               # OpenRouter client, prompt composer, safety gates, sanitizer
│   ├── audit/            # 8-step GitHub analysis, 10-dimension scoring, remediation
│   ├── scp/              # 12 per-product agents, provisioner, scheduler, evolution, briefings
│   ├── intelligence/     # Stressor, risk state, revenue, cohort, competitive
│   ├── decisions/        # Queue, patterns, action execution
│   └── billing/          # Stripe integration, dunning
├── routes/
│   ├── public/           # Landing, pricing, legal pages
│   ├── auth/             # Clerk signup/login
│   ├── dashboard/        # 67 authenticated page routes
│   └── api/              # JSON API routes
└── views/                # Server-rendered HTML layouts + components
```

## Deployment

```bash
fly deploy                # Fly.io (see fly.toml)
# Or:
docker build -t foundry . && docker run -p 8080:8080 --env-file .env foundry
```

## Limitations

- **Scale ceiling:** Current architecture processes products sequentially in cron jobs. Works well for <25 products per instance. Beyond that, a job queue (BullMQ) would be needed.
- **Single-founder model:** No organization entity. Each Clerk user is one founder. Multi-seat/team features exist (Growth+) but are scoped to one founder's account.
- **In-memory state:** AI cost ceiling and rate limiting are per-instance. Deploy resets the cost ceiling counter.

## Documentation

- `docs/audits/reality-check.md` — Honest assessment of what's built vs documented
- `docs/audits/00-README-FIRST.md` — Guide to the 859 audit docs and what they describe
- `docs/operations/runbook.md` — Deployment, incidents, key rotation, backup
- `docs/features/README.md` — Feature catalog
- `docs/scp/cross-company-contract.md` — Data flow boundaries (for future fleet layer)
