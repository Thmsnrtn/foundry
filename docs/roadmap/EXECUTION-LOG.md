# Foundry — Roadmap Execution Log

The founder reads this file, not the commit log. Each phase appends a short
summary: what shipped, test counts, anything deferred and why, and operator
actions still required.

---

## Phase 0 — Stop the bleeding

**Status:** complete. **Tests:** 663 → 676 passing (45 files), `npm run check` green.

### What shipped

- **0.1 — Integration status bug (highest ROI).** `connectIntegration` and the
  OAuth connect route wrote `status = 'active'`, but all six sync adapters
  (posthog/sentry/linear/slack/intercom/github) guard on `status === 'connected'`.
  Nothing wrote `'connected'`, so the hourly fabric sync and 2-hourly extended
  sync were silent no-ops — `integration_events` stayed empty and every agent
  reasoned over zero telemetry. Standardized on `'connected'` everywhere
  (writers, health aggregation, UI reads, resend check). Migration `074` repairs
  existing rows (`active → connected`). Regression test pins that the value the
  connect paths write equals the value the adapters guard on.

- **0.2 — Persisted AI cost ceiling.** Daily spend moved from an in-process Map
  (reset on every deploy, not shared across machines) to the new `ai_daily_spend`
  table (migration `075`); the Map is now a 60s read-through cache. Added
  fleet-level caps: per-founder (`$100/day`) and global (`$500/day`) alongside
  per-product (`$25/day`), all env-overridable. Spend accounting and ceiling
  checks fail-open. Replaced magic cost multipliers in `atlas.ts`/`base.ts` with
  `computeCostCents`.

- **0.3 — Error tracking on.** Added `@sentry/node` so the existing
  auto-activating reporter seam can turn on when `SENTRY_DSN` is set. Removed the
  phantom `@anthropic-ai/sdk` dependency (never imported — only a string literal
  in the audit engine's service-detection map).

- **0.4 — Activation emails wired.** `sendAuditResultsEmail` (Day-1),
  `evaluateOnboardingSequence` (Day-3) and a founder welcome were dead code.
  All now route through the V3.1 tool gateway (`send_email`) with per-key
  idempotency: Day-1 fires after `runAudit`, Day-3 from the `behavioral_triggers`
  cron, and the welcome fires on provisioning (Clerk webhook + auth fallback,
  scoped to the Foundry dogfood product, idempotent with the `welcome_sequence_tick`
  day_0 cron).

- **0.5 — Phantom webhook secret removed.** `GITHUB_WEBHOOK_SECRET` was declared
  but never read (GitHub is poll-based; no inbound webhook route exists). Removed
  from `.env.example` with a note on how to add signature verification if an
  inbound GitHub webhook is ever mounted.

### Deferred / not done

- Prompt-caching, model upgrade, and the deeper cost-accuracy sweep across the
  other ~8 agents' magic multipliers are Phase 2 work; 0.2 converted only the
  two named in the brief (`atlas.ts`, `base.ts`).

### ⚠️ Operator actions still required (0.6 — human, not code)

These cannot be done from the codebase and gate a real deploy:

1. **Set Fly secrets** per `docs/blockers/BLOCKER-FLY-TOKEN.md`:
   `ENCRYPTION_KEY`, `STRIPE_WEBHOOK_SECRET`, `ECOSYSTEM_SERVICE_KEY`, and the
   Clerk/GitHub OAuth credentials. The app has crash-looped on a missing secret
   before.
2. **Sentry:** sign up, create a project, set `SENTRY_DSN` as a Fly secret. Until
   then, error tracking falls back to structured stderr (recoverable from Fly
   logs) — the reporter seam auto-activates the moment the DSN is present.
3. **Run the dogfood seed:** `npm run cli -- seed:dogfood <productId>` against the
   real Foundry product. The founder welcome email (0.4) routes through the
   Foundry product's kill-switch scope; if that product row is absent the welcome
   is skipped (the cron retries) — seed it so welcomes send.
4. **Turso backup-restore drill:** confirm you can restore from backup.
5. **Optional cost caps:** override `AI_DAILY_COST_CEILING_CENTS` (product,
   default 2500), `AI_DAILY_COST_CEILING_FOUNDER_CENTS` (default 10000), and
   `AI_DAILY_COST_CEILING_GLOBAL_CENTS` (default 50000) if the defaults don't fit
   your risk tolerance.

### Migration note

Migrations `074` (integration status repair) and `075` (`ai_daily_spend`) run on
next `npm run migrate` / boot. Both are idempotent.

---

## Phase 1 — First ten minutes + first dollar

**Status:** complete. **Tests:** 676 → 700 passing (50 files), `npm run check` green.

### What shipped

- **1.1 + 1.2 — Async audit with live progress + first briefing on arrival.**
  The onboarding audit was a blocking 2–5 minute POST that redirected to an
  often-empty dashboard. `runAudit` now takes an `onProgress` reporter; the POST
  kicks the audit off asynchronously, persists progress to
  `onboarding_audit_progress` (migration `076`), and returns a progress page that
  HTMX-polls `/onboarding/audit-status` (tenant-scoped). The first briefing is
  now **awaited as step 9** before the poll redirects to `/dashboard?tour=1`, so
  the flagship card is never empty on first login.

- **1.3 — 14-day card-upfront trial + conversion surfaces.** `createCheckoutSession`
  starts a `trial_period_days: 14` trial; the webhook persists/clears
  `trial_ends_at` (migration `077`). New pure `getTrialStatus` drives a header
  "N days left · Upgrade" badge, an expiry banner, and a "Start your 14-day free
  trial" CTA on every dashboard page — checkout is no longer buried in Settings.
  Expiry is a preview/nudge (existing null-tier gates already gate paid features),
  not a hard data lock, per the brief.

- **1.4 — Removed the orphaned `/setup` conversational onboarding** (route +
  exclusively-backing service + wiring). One onboarding path now.

- **1.5 — Branded HTML error pages.** `onError`/`notFound` content-negotiate:
  browsers get a branded 404/500 (reusing `publicLayout`), API paths get JSON.

- **1.6 — DNA auto-fill wired.** The Wave-2 extractor was never called. Now
  onboarding auto-drafts DNA from the repo README after the audit, and the DNA
  page has a "Draft with AI" button. A pure clobber-guard fills only empty fields.

- **1.7 — Honest mobile claim.** Replaced the unbuildable "iOS app + voice
  briefings + Watch complication" pricing claim with "installable mobile app (PWA)".

### Deferred / notes

- Trial enforcement is intentionally soft (preview banner + existing feature
  gates), not a hard dashboard lock — matches the brief's "rather than
  hard-locking data." If a harder gate is wanted post-alpha, add a
  trial-expired middleware in front of `/dashboard`.
- DNA auto-fill uses README + product metadata; the landing-page/Stripe-catalog
  sources are supported by the extractor but not yet gathered server-side
  (arbitrary-URL fetch deferred for SSRF safety).

### Operator notes

- Set `STRIPE_*_PRICE_ID` env vars so `getTierFromPrice` resolves; otherwise the
  webhook logs "Unrecognised price ID" and tier/trial won't update.
- `TRIAL_PERIOD_DAYS` (default 14) overrides the trial length everywhere.

---

## Phase 2 — Make the intelligence actually intelligent (in progress)

**Status:** 2.1–2.3 complete; 2.4/2.5 partial; 2.6/2.7 deferred.
**Tests:** 700 → 704 passing (51 files), `npm run check` green and now
deterministic (see test-infra note).

### What shipped

- **2.1 — Model generation upgrade.** OPUS → `anthropic/claude-opus-4-8`,
  SONNET → `anthropic/claude-sonnet-5`; added a HAIKU tier
  (`anthropic/claude-haiku-4-5`) + `callHaiku()` for cheap classification.
  Updated the `AIModel` union, `COST_PER_1M`, and `usage-tracking` PRICING
  (whose keys were bare and never matched `response.model` — a latent
  cost-tracking miss, now fixed) plus the two hardcoded model strings.

- **2.2 — Prompt caching (biggest cost lever).** Added a `CACHE_BREAKPOINT`
  sentinel: the client marks the stable system-prompt prefix with Anthropic
  prompt caching (`cache_control: ephemeral`, passed through by OpenRouter).
  Reordered `base.ts buildSystemPrompt` stable-first so the cached prefix is
  byte-identical across runs. Expected 60–90% input-cost cut on repeat agent
  runs. Non-agent callers (no sentinel) are unaffected.

- **2.3 — Audit gets real code visibility.** New `selectReviewFiles` picks a
  budget-capped set (≤8 files / ≤14KB) of the most decision-relevant files
  (auth/security, billing, error handling, config) from the already-fetched key
  files; the scorer now includes those excerpts (sanitized, framed as untrusted
  data). Moves the audit from checklist-over-counts to review-over-code.

- **2.4 (partial) — Deleted the duplicate `src/lib/job-lock.ts`** (zero
  importers; `src/services/job-lock.ts` is canonical).

- **2.5 (partial) — Scratchpad consensus/conflict now uses a Haiku classifier**
  instead of the bag-of-words heuristic that flagged "consensus" on any shared
  5-char token. Fails closed (empty) rather than emitting nonsense into a
  founder-visible briefing.

- **Test infra — fixed a pre-existing flake.** Many suites share one in-process
  `file::memory:` DB; running test files concurrently let them clobber each
  other's tables (intermittent, varying failures). Set `fileParallelism: false`
  — deterministic green, ~15s.

### Deferred (with rationale)

- **2.4 (full) — Unify the two integration subsystems.** Porting the framework's
  Stripe/GitHub pulls into the fabric, implementing the stubbed analytics
  adapter, migrating callers, and deleting the loser is a large, high-blast-
  radius refactor touching the `integrations` table's dual schema. Left for a
  dedicated pass so it gets its own test/rollback cycle rather than being
  rushed. The status-string fix (0.1) already restored the fabric's sync path.
- **2.5 (evolution engine) — Feed real session data** to
  `checkEvolutionCandidates` / `runEvolutionSynthesis` (currently synthetic
  one-liners). Bounded but needs care around the 5-gate validation; deferred.
- **2.6 — Calibrated confidence** (agents emit self-assessed confidence in their
  JSON contract; track calibration vs outcomes). Touches every agent's strict
  schema + the gate system; deferred to a focused pass.
- **2.7 — Per-agent evals in CI.** Depends on `capture:fixtures` output; deferred.

### Operator notes

- Optional model-cost overrides: `AI_COST_HAIKU_INPUT_PER_1M` /
  `AI_COST_HAIKU_OUTPUT_PER_1M` (defaults 1.00 / 5.00).
- After deploy, confirm prompt-cache hits in OpenRouter usage (input-token drop
  on repeated agent runs) and eyeball one generated briefing before/after the
  model swap, per the roadmap's verification step 6.
