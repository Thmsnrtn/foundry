# Foundry

Autonomous AI operations layer for solo SaaS founders running 1-5 products.

Connect your GitHub repo, get a 10-dimension audit, and let 12 specialized AI agents monitor, analyze, and advise on your business — while you focus on building product.

## Who It's For

Solo SaaS founders who are good at building product but need operational support without hiring a team. Ideal for 1-5 products per account.

## What It Does

1. **Audit** — Connect a GitHub repo. Foundry analyzes code structure, configuration, billing, trust signals, error handling, analytics, and dependencies across 10 dimensions. Produces a composite score and blocking issues.

2. **Signal Score** — A single 0-100 number representing business health, updated from metrics, stressor activity, and agent observations.

3. **12 AI Agents** — Each product gets 12 specialized agents (Atlas/Engineering, Compass/Product, Oracle/Analytics, Beacon/Marketing, Harbor/Customer Success, Sentinel/DevOps, Ledger/Finance, Shield/Compliance, Scribe/Content, Forge/Revenue, Prism/UX, Crucible/QA). They run on configurable cadences (6h to 168h) and propose actions via a gate-controlled decision queue.

4. **Risk State** — Green/Yellow/Red adaptive system. Yellow triggers elevated monitoring. Red suspends autonomous actions and generates recovery protocols.

5. **Daily Briefing** — Synthesized intelligence from all 12 agents in a 90-second-read format: headline → the number that matters → the one thing to decide today → folded sections below.

6. **Decisions Inbox** — Gate 0 (autonomous) through Gate 4 (human-only). Scenario modeling for strategic decisions. Cross-product pattern matching from anonymized outcomes.

7. **Multi-Product** — Growth tier supports up to 3 products, Investor-Ready supports up to 5. Portfolio view shows Signal scores and risk states across products. Per-product pause/resume and export/delete.

## V3.1 — The Discipline Layer

A thin set of operating disciplines on top of the agent runtime, all
shipped 2026-05-08. Migrations 060–068; see
`docs/architecture/FOUNDRY_V3_1_STATUS.md` for the full inventory.

- **North Star + outcome trees** — every product has a 12-month
  destination and a tree of measurable outcomes with required
  kill-criteria. Surfaces in the briefing.
- **Architecture freeze period** — gates the SCP evolution engine so
  expansion-class changes route to a phase-beta proposal queue
  during freeze. Tightening (golden lessons, constraint additions,
  founder corrections) always passes.
- **Team health metrics** — Ambros's six metrics computed weekly per
  product (critique pass rate, override rate, recursive critique
  yield, etc.).
- **Voice fingerprint + gate** — per-product writing voice signature.
  Voice-bearing artifact drafts (emails, landing copy, blog posts)
  pass through the gate; warn/block verdicts force manual review.
- **Tool gateway** — every outbound call goes through a single
  invoke() with kill-switch / classification / communication-budget /
  idempotency / audit. Resend's `send_email` is migrated; Stripe and
  GitHub follow per `src/services/outbound/README.md`.
- **Founder-facing weekly outcome** — one number on the dashboard
  ('decisions you handled / surfaced this week') so the operator can
  judge whether Foundry is earning its keep.

## What It Does NOT (Yet) Do

- **Fleet-level meta-agents** — FleetOracle, FleetSentinel, PortfolioLedger, FleetObservatory are specified in `docs/scp/fleet-agents/` but not implemented
- **Cross-company intelligence** — The `decision_patterns` table collects anonymized data but no service generates insights from it for users
- **Multi-organization** — Single-founder-per-account. No organization entity, no team roles across companies
- **Validated lifecycle transitions** — Lifecycle stages exist but transitions aren't enforced
- **Stripe + GitHub through the gateway** — Resend is migrated; the other two adapters are next per the documented order

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
├── index.ts              # Hono server, route mounting, 70+ cron jobs
├── db/                   # Turso client, ~104 migrations
├── lib/                  # Logger (trace-aware), error reporter, crypto, validation
├── middleware/            # Auth, tenant, CSRF, security headers, rate limit, RBAC, tier gate, requestId/trace
├── services/
│   ├── ai/               # OpenRouter client (retry+timeout, structured logs), prompt composer, safety gates
│   ├── audit/            # 8-step GitHub analysis, 10-dimension scoring, remediation
│   ├── scp/              # 12 per-product agents, provisioner, scheduler, evolution, briefings
│   ├── intelligence/     # Stressor, risk state, revenue, cohort, weekly outcome
│   ├── decisions/        # Queue, patterns, action execution (voice-gate wired in)
│   ├── outbound/         # V3.1 tool gateway: invoke(), kill-switch, classification, budget, idempotency, audit
│   ├── destination/      # V3.1 North Star + outcome trees + briefing context
│   ├── discipline/       # V3.1 freeze periods + phase-beta proposals + team health
│   ├── calibration/      # V3.1 voice fingerprint + taste journal + voice gate
│   └── billing/          # Stripe integration, dunning
├── routes/
│   ├── public/           # Landing, pricing, legal pages
│   ├── auth/             # Clerk signup/login (HMAC-verified webhook)
│   ├── dashboard/        # 67 authenticated page routes
│   └── api/              # JSON API routes
└── views/                # Server-rendered HTML layouts + components

tests/
├── unit/                 # 36 files, ~570 tests
└── evals/                # Golden-case suites (LLM-adjacent regression)
```

**Tests:** 578 across 37 files. Typecheck strict. CI gate runs both
unit and eval suites.

**Observability:** AsyncLocalStorage trace IDs flow request → service →
AI call → DB. Structured logger picks them up automatically. Error
reporter is a Sentry-shaped seam (default writes structured stderr;
register a real reporter at boot via `setReporter`).

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

Start here:

- `docs/CONTRIBUTING.md` — One-page on-ramp for the next engineer
- `docs/audits/reality-check.md` — Honest assessment of what's built vs documented
- `docs/audits/elite-persona-review-2026-05-08.md` — 18-persona push-forward review with prioritized actions
- `docs/architecture/FOUNDRY_V3_1_STATUS.md` — V3.1 inventory + recommended next moves
- `docs/design/surface-collapse-proposal.md` — UI hierarchy proposal (briefing contract shipped; dashboard collapse pending)

Operations:

- `docs/operations/runbook.md` — Deployment, key rotation, backup
- `docs/operations/runbooks/` — Incident-specific runbooks (AI bill spike, Stripe webhook backlog, agent silently failing)
- `src/services/outbound/README.md` — Tool gateway usage + adapter migration order

For context on the heavier audit trail:

- `docs/audits/00-README-FIRST.md` — Guide to the 859 prior audit docs
- `docs/scp/cross-company-contract.md` — Data flow boundaries (for future fleet layer)

## Dogfood

Once you've onboarded a product, seed your own North Star and voice
fingerprint so the V3.1 disciplines have something to operate on:

```bash
npm run cli -- seed:dogfood <productId>
```

Then run a briefing to see the destination block render:

```bash
npm run cli -- job:run scp_daily_briefing
```
