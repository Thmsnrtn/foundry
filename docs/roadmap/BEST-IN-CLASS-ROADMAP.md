# Foundry — Best-in-Class Roadmap (Execution Brief)

> **How to use this document:** Paste it whole into a Claude Code session pointed at the Foundry repo. It is written as a self-contained brief for the executing model. Recommended executor: **Claude Opus 4.8** for Phases 0–2 (subtle cross-cutting bugs, AI-core surgery, prompt work), **Sonnet 5** is fine for Phases 3–5 (mechanical infra, wiring, copy). If running one model for everything, use Opus 4.8.
>
> Ground rules for the executor: work phase by phase in order; run `npm ci && npm run check` before starting and after every phase; follow existing patterns (structured logger, Turso batch queries, tenant scoping by `owner_id`, gate system 0–4); commit per work item with descriptive messages; do not start a later phase while a Phase 0 item is unfinished.

---

## Context — where Foundry actually stands (verified 2026-07-08)

Foundry is an autonomous AI-operations layer for solo SaaS founders: connect a GitHub repo → 10-dimension audit → 12 persona agents (Atlas/CTO, Forge/Revenue, etc.) run on cadences, propose gate-controlled decisions, and synthesize a daily briefing. Stack: Hono + HTMX server-rendered UI, Turso (libSQL), Clerk, Stripe, Resend, OpenRouter (Claude), Fly.io. ~590–660 passing unit tests, real CI, an unusually honest internal audit trail (`docs/audits/`, `docs/roadmap/documented-but-not-built.md`). The prior 300-persona review's Waves 1–4 have already been executed (see git log: "Wave 1"–"Wave 4", "Step in as operator" commits).

A fresh three-way deep audit (product surface, AI core, production posture) found that the architecture and prompt quality are genuinely strong — the base-agent pipeline, debate layer, voice fingerprint, wisdom/DNA layer, and tool gateway are real, sophisticated code. What stands between this and a best-in-class, sellable product is **not more features**. It is five specific things:

1. **The agents are running blind.** A confirmed status-string bug (`'active'` written vs `'connected'` checked) silently no-ops every integration sync, so agents reason over empty telemetry and fall back to generic MBA advice — the exact failure mode a savvy founder detects in one briefing.
2. **The first ten minutes are fragile.** The flagship onboarding audit is a blocking 2–5 minute POST with zero progress UI; the first briefing often renders empty; the written Day-1/Day-3 activation emails are dead code that never fires.
3. **There is no path to revenue.** No trial, no paywall, checkout buried in Settings — the app is de facto free.
4. **Operations are near-blind and cost-exposed.** 73 AI cron jobs run in-process on one shared-cpu-2x/1GB machine; the $25/day AI cost ceiling lives in an in-memory Map that resets on every deploy; Sentry seam exists but `@sentry/node` isn't installed.
5. **The product runs a model generation behind** (Opus 4.6 / Sonnet 4.5 via raw OpenRouter fetch) with **no prompt caching** despite re-sending large identical system prompts on every hourly agent run.

The roadmap below fixes those in order of leverage, then builds the moat and the launch. Estimated total: ~6–8 focused weeks. Phases 0–1 alone make the product alpha-sellable.

---

## Phase 0 — Stop the bleeding (1–2 days, do first, no exceptions)

**0.1 Fix the integration status bug (highest single ROI in the codebase).**
`src/services/integration/fabric.ts:147` (and the INSERT at :159) writes `status = 'active'`, but all six sync adapters guard on `status === 'connected'` — 20 guard sites across `posthog.ts`, `sentry.ts`, `linear.ts`, `slack.ts`, `intercom.ts`, `github.ts` (e.g. `posthog.ts:40`). Nothing anywhere writes `'connected'`, so the hourly `scpIntegrationFabricSync` and 2-hourly extended sync are no-ops and `integration_events` stays empty. Fix: standardize on one value (recommend `'connected'` written by `connectIntegration`, plus a one-line data migration `UPDATE integrations SET status='connected' WHERE status='active'`). Add a regression test that connects a fabric integration and asserts the sync guard passes. This one fix is the difference between agents having real product/error/support telemetry and hallucinating plausible advice.

**0.2 Persist the AI cost ceiling.**
`src/services/ai/client.ts:25` — `dailySpend` is an in-process `Map`; every deploy resets the daily counter and it isn't shared across machines. Move daily spend accounting to a small DB table (product_id, date, spent_cents), keep the Map as a read-through cache. Add a fleet-level (per-founder and global) daily cap with env override. While in this file: replace the magic cost multipliers (`tokensUsed * 0.000003` in `atlas.ts:216`, `* 0.000015` in `base.ts:232`) with the existing `computeCostCents`.

**0.3 Turn on error tracking.**
Add `@sentry/node` to dependencies (the reporter seam in `src/lib/error-reporter.ts` already auto-activates on `SENTRY_DSN`). Remove the phantom `@anthropic-ai/sdk ^0.20.0` dependency — it is never imported (only a string literal in `audit/engine.ts:252`).

**0.4 Wire the dead activation emails.**
`src/lib/onboarding-emails.ts` defines `sendAuditResultsEmail` (Day-1) and `evaluateOnboardingSequence`/`sendMetricsGuideEmail` (Day-3) — **never called anywhere**. Wire Day-1 to fire after `runAudit` completes in `src/routes/dashboard/onboarding.ts` (~:406), Day-3 via the existing job registry in `src/jobs/index.ts`, and add a welcome email on founder provisioning (`src/middleware/auth.ts:83` / Clerk webhook). Route all three through the V3.1 tool gateway like the digest does.

**0.5 Verify GitHub webhook signatures.**
`GITHUB_WEBHOOK_SECRET` exists in `.env.example` but no `x-hub-signature-256` HMAC verification exists in `src/`. If a GitHub webhook ingress is mounted, verify it (timingSafeEqual, same pattern as the Clerk handler in `src/routes/auth/clerk.ts:100`); if none is mounted, delete the env var to remove the illusion.

**0.6 Operator checklist (human, not code — surface this to the founder in the final report):** set Fly secrets per `docs/blockers/BLOCKER-FLY-TOKEN.md` (`ENCRYPTION_KEY`, `STRIPE_WEBHOOK_SECRET`, `ECOSYSTEM_SERVICE_KEY`, Clerk/GitHub OAuth), sign up for Sentry + set `SENTRY_DSN`, run `npm run cli -- seed:dogfood <productId>` against the real Foundry product, run the Turso backup-restore drill. The app has crash-looped on a missing secret before.

---

## Phase 1 — First ten minutes + first dollar (week 1)

The dashboard is genuinely strong; the road to it is not. Goal: a stranger signs up, watches the audit happen, lands on a live briefing, and hits a natural payment moment.

**1.1 Audit progress experience.**
`POST /onboarding/run-audit` (`src/routes/dashboard/onboarding.ts`) blocks 2–5 minutes with no feedback — it looks hung at the single most important moment. Convert to: kick off audit async, return immediately to a progress page that polls an audit-status endpoint via HTMX (the 8-step pipeline in `src/services/audit/engine.ts` gives natural step boundaries — persist current step to the audit row and render "Analyzing error handling… step 4/8"). On completion, redirect to `/dashboard?tour=1`.

**1.2 First briefing on arrival.**
The post-onboarding briefing is fire-and-forget, so the CEO-briefing card often renders empty on first load. Either await it as the final visible "step 9" of the progress page ("Your agents are writing your first briefing…"), or give the card a live "being written now" state that HTMX-polls until content exists. Never show an empty flagship card on first login.

**1.3 Trial + paywall.**
There is currently no conversion mechanism: `founder.tier` defaults NULL and the full product works unpaid; checkout is buried in `src/routes/dashboard/settings.ts`. Implement a 14-day trial: add `trial_period_days: 14` to `createCheckoutSession` in `src/services/billing/stripe.ts`, handle the `trialing` subscription status in the webhook, and make onboarding end at a "start your trial" moment (card-upfront trial recommended for this ICP — decisive founders, $79+ price point). Show trial-days-remaining in the header; on expiry, gate the dashboard behind the existing `tier-gate` preview pattern (`src/middleware/tier-gate.ts`) rather than hard-locking data.

**1.4 Kill the orphaned second onboarding.**
`src/routes/dashboard/onboarding-chat.ts` (`/setup`) is a complete conversational onboarding that nothing links to. Delete it (keep the wizard). Two parallel onboardings is maintenance debt and a coherence smell. (Salvage its best copy for the wizard if any.)

**1.5 HTML error pages.**
`app.onError` / `notFound` in `src/index.ts:487` return raw JSON to browsers. Return branded HTML (reuse `src/views/layout.ts`) for `Accept: text/html`, JSON for API paths.

**1.6 DNA auto-fill.**
The Wisdom/DNA layer (`src/services/wisdom/dna.ts`) is the biggest personalization lever but requires manual entry of 10 fields. Auto-draft them at onboarding from already-available assets (GitHub README, landing-page URL fetch, Stripe product descriptions) with one Sonnet call; founder accepts/edits instead of typing. This simultaneously reduces onboarding friction and attacks the "generic advice" problem.

**1.7 Fix the iOS marketing claim.**
`ios/Foundry/` is ~6.5k lines of SwiftUI with **no Xcode project** — not buildable, not installable — while the pricing page (`src/routes/public/landing.ts:267`) sells "iOS native app + voice briefings + Watch complication" on every tier. Remove the claim from the pricing page now (the PWA + mobile bottom nav is real and can be marketed as "installable mobile app"). Shipping actual iOS is Phase 5's decision.

---

## Phase 2 — Make the intelligence actually intelligent (weeks 2–3)

Prompt quality is already excellent; the inputs and the model layer are the gap.

**2.1 Model generation upgrade.**
`src/services/ai/client.ts:14-19` pins `anthropic/claude-opus-4-6` and `anthropic/claude-sonnet-4-5-20250929`. Upgrade: OPUS → `claude-opus-4-8`, SONNET → `claude-sonnet-5`, and add a HAIKU tier (`claude-haiku-4-5`) for cheap classification work (scratchpad analysis, relevance scoring, injection screening). Update the pricing tables in `client.ts:28` and `src/lib/usage-tracking.ts:13`, and the hardcoded model strings in `src/services/founder/intelligence.ts:528` and `src/services/voice/briefing.ts:130`. Re-run the eval suites (`tests/evals/`) after the swap and eyeball a generated briefing before committing.

**2.2 Prompt caching — the biggest cost lever in the app.**
Every agent run re-sends a large identical prefix (C-Suite Output Standard from `base.ts:549-565` + persona prompt + constitution + golden lessons) with no `cache_control` anywhere, across 73 AI cron jobs. Options: (a) keep OpenRouter and add `cache_control` breakpoints on the stable system-prompt blocks (OpenRouter passes Anthropic caching through), or (b) migrate `client.ts` to the official Anthropic SDK/Messages API. Recommend (a) now — it's a small change to the existing fetch payload — and note (b) as future work. Order prompt assembly stable-first (standard → persona → constitution → lessons → volatile context) so the cache prefix holds. Expect a 60–90% input-cost reduction on agent runs.

**2.3 Give the audit engine real code visibility.**
Today the LLM never sees source code — `buildScoringPrompt` (`src/services/audit/scorer.ts:108`) passes only counts and booleans derived from regex heuristics over ≤50 files (`src/services/audit/github.ts:198`). Ship: for the 3–4 highest-stakes dimensions (error handling, billing, security/trust, config), include the actual content of the most relevant files (auth middleware, billing service, error paths — already identified by `getKeyFiles`) in the scoring prompt, budget-capped. Run repo content through the existing prompt-injection sanitizer first. This moves the audit from "checklist" to "review" — it is the product's first impression and currently its shallowest layer.

**2.4 Unify the two integration subsystems.**
`src/services/integration/` (event fabric → `integration_events`) and `src/services/integrations/` (framework → `metric_snapshots`) both write to a table named `integrations` with incompatible column expectations. Consolidate on the fabric as the single subsystem: port the framework's working Stripe/GitHub metric pulls into fabric adapters, implement the stubbed analytics adapter (`src/services/integrations/framework.ts:287` returns zero records for PostHog/GA/Mixpanel/Plausible — "behavioral analytics" is advertised but never ingested), migrate callers, delete the loser. Also delete the duplicate job-lock at `src/lib/job-lock.ts` (keep `src/services/job-lock.ts`).

**2.5 Feed the self-improvement loop real data.**
The evolution engine (`src/services/scp/evolution.ts`) is sophisticated (self-critique, 5-gate validation, auto-rollback) but 2 of its 3 entry points feed it synthetic one-liners: `checkEvolutionCandidates` (:597) and `runEvolutionSynthesis` (:642). Pass actual session observations/proposals/outcomes from `agent_sessions` rows. Same class of fix: replace the bag-of-words scratchpad consensus/conflict detection (`src/services/scp/coordination/scratchpad.ts` — flags "consensus" on any shared 5-char token) with a single cheap Haiku classification call, or drop the feature; the current heuristic will eventually surface an embarrassing "consensus" note in a founder-visible briefing.

**2.6 Calibrated confidence.**
Gate escalation (`src/services/ai/gates.ts`) keys on confidence values that are hardcoded constants (`0.8` in `base.ts:328`, `0.75` in `debate/orchestrator.ts:107`). Have agents emit a self-assessed confidence in their JSON contract (schema already strict per-agent, e.g. `AtlasClaudeResponse`), validate range, and track calibration against decision outcomes in the existing accuracy tables so the number becomes meaningful over time.

**2.7 Wire per-agent evals into CI.**
Golden eval cases already exist in the fleet-agent specs (`docs/scp/fleet-agents/*.md`) and the framework runs in `tests/evals/`. Add 5 cases per production agent (seed from `npm run cli -- capture:fixtures <productId>` output), run them in CI on the eval framework. This is the safety net that makes the model upgrade in 2.1 and all future prompt evolution safe.

---

## Phase 3 — Survive real users (week 4, parallelizable with Phase 2)

**3.1 Split web from worker.**
73 in-process cron jobs (`src/jobs/index.ts` JOB_REGISTRY; the "30 jobs" comment in `fly.toml` is stale) share one shared-cpu-2x/1GB machine with the HTTP server. Use Fly process groups: `web` (HTTP, no scheduler) and `worker` (scheduler only, no public traffic) — gate `startScheduler()` (`src/index.ts:500`) on a `PROCESS_ROLE` env var. The DB-backed job locks (`src/services/job-lock.ts`) already make this safe. Scale web to 2 machines for deploy overlap.

**3.2 Migration hygiene.**
109 migration files, only 72 distinct numeric prefixes — 004–033 and 056 are duplicated (three different `007_*.sql`). The filename-sorted runner is deterministic, but the next author is one bad sort away from an out-of-order migration. Renumber duplicates with a mapping migration in `migrations_applied` (rename tracked filenames in one transaction), document the rule in `docs/db/`, and fix the fragile `;\n` regex statement-splitter in `src/db/migrate.ts` (breaks on semicolons inside string literals/triggers).

**3.3 Basic SLO alerting.**
SLOs are documented (`docs/operations/slos.md`); nothing alerts. Add a lightweight internal check job: dashboard p95, job-runner lag, webhook backlog, daily AI spend vs cap — Resend email to the operator on breach (route through the gateway). Sentry (0.3) covers exceptions; this covers degradation.

**3.4 Finish the gateway migration.**
Per `src/services/outbound/README.md` order: migrate Stripe and GitHub adapters through the V3.1 gateway (Resend + remediation PRs already done). Then the kill-switch/budget/idempotency story is true for every outbound side effect — a marketable trust claim ("every action your agents take passes a kill-switch, budget, and audit trail").

**3.5 Data retention.**
Archive `agent_messages` + `audit_log` rows >180 days (documented-but-not-built list) — one cron + one test.

---

## Phase 4 — Build the visible moat (weeks 5–6)

The competitive doc (`docs/strategy/competitive-landscape.md`) is right: cross-company intelligence is the differentiation, and today it's mostly a label. Build the two highest-value fleet surfaces, not all four specs.

**4.1 Cross-product intelligence reader.**
`decision_patterns` collects consent-gated anonymized outcomes; the peer-signal card on the dashboard reads a first slice of it. Extend into a real reader service: "founders at your stage who approved X saw Y" with sample sizes and abstention below n=5, surfaced in the briefing and decision queue (not just a dashboard card). This makes the compounding-data moat visible in the daily loop — lead with it in marketing copy too.

**4.2 FleetObservatory (the "control room").**
Spec + golden evals at `docs/scp/fleet-agents/fleet-observatory.md`. For multi-product founders: one screen showing every agent's last run, next run, current focus, and pending decisions across products. Mostly reads existing tables (`agent_sessions`, `decisions`, `products`) — closer to 1 week than the spec's estimate. Skip FleetOracle/FleetSentinel/PortfolioLedger for now; revisit after paying multi-product customers exist.

**4.3 Show up where founders already live.**
Outbound webhooks (Slack first, then Linear/Notion): Foundry posts briefing headlines and Gate-3 decisions into the founder's Slack via the gateway. Highest-retention integration for this ICP; the event dispatch plumbing from the Wave-3 work (`dispatchEvent` wiring) already exists.

**4.4 Surface collapse.**
~70 dashboard routes contradict the "one number, three sentences" promise. Implement the already-designed three-tab IA (`docs/audits/` surface-collapse proposal: Today / Stats / History), fold long-tail routes into progressive disclosure, keep deep links working via redirects. This is the single biggest approachability win for the solo-founder ICP.

---

## Phase 5 — Launch (weeks 6–8)

**5.1 Publish the category manifesto.** `docs/strategy/category-manifesto.md` is written and good. Ship it at `/manifesto`, link from landing, distribute (HN, Indie Hackers, Twitter). Founding-Cohort scarcity and annual toggle are already live on the pricing page.

**5.2 Activation funnel instrumentation.** Define the funnel (signup → repo connected → audit done → first briefing viewed → decision approved → trial → paid) and record each step (telemetry tables from Wave 1 exist; extend). Weekly cohort readout on the founder-ops dashboard. Gate all copy/pricing iteration on this data.

**5.3 Alpha cohort of 10 → paid.** Invite 10 founders on Founding-Cohort pricing with the 14-day trial. The 3-stage welcome sequence (0.4) + NPS prompt (already live) + rejection-streak calibration (already live) carry the feedback loop.

**5.4 iOS decision.** After web activation is proven: either commit ~2 weeks to make `ios/Foundry/` buildable (Xcode project, API config, TestFlight) or archive the directory. Don't let 6.5k lines of unshippable Swift rot ambiguously. The PWA covers mobile until then.

**5.5 Support surface.** A `/help` page with FAQ + the operator email, linked from the footer and error pages. Alpha-adequate.

### Explicitly deferred (don't build now)
- **Multi-organization/teams** (1–2 month rework; wrong stage — README already descopes it)
- **FleetOracle / FleetSentinel / PortfolioLedger** (wait for paying multi-product customers)
- **UI framework rewrite / light mode** (dark HTMX design system is a strength, not debt)
- **Voice briefings as a marketed feature** (until iOS ships)

---

## Verification (run per phase; full pass at the end)

1. `npm ci && npm run check` (typecheck + full vitest suite) — must stay green every phase.
2. Targeted suites: `tests/unit/tenancy-isolation.test.ts`, `tier-gate`, `gateway`, `idempotency` after Phases 1/3; `tests/evals/` after every prompt/model change (Phase 2).
3. `npm run cli -- chaos:drill <productId>` and `npm run cli -- foundry preflight` (pre-deploy readiness) before any deploy.
4. Manual first-run walkthrough after Phase 1: fresh Clerk user → onboarding → watch audit progress render → land on dashboard with a non-empty briefing → confirm welcome email queued through the gateway → confirm trial state in header. Repeat the no-code path.
5. After 0.1: connect a fabric integration in the UI, run the sync job manually, assert `integration_events` rows land and the next agent run's prompt includes them (check `agent_sessions` context).
6. After 2.1/2.2: diff one generated briefing before/after model swap; confirm cache hits in OpenRouter usage (input-token drop on repeated agent runs); confirm cost tables record real (not estimated) cents.
7. After 3.1: deploy web+worker groups to staging (`fly.staging.toml`), confirm scheduler runs only on worker and job locks prevent double-runs.

## Reporting back
At the end of each phase, write a short summary to `docs/roadmap/EXECUTION-LOG.md`: what shipped, test counts, anything deferred and why, operator actions still needed (Fly secrets, Sentry DSN, Turso backup drill, dogfood seed run — from 0.6). The founder reads this file, not the commit log.
