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
