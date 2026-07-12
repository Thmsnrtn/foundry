# BLOCKER: Production app down — operator runbook to bring it up

**Status (2026-07-12):** `foundry-intel.fly.dev` times out on every path — no
healthy machine is serving. Root cause per the original deploy attempt:
required secrets were never set, the machine crashed on boot, Fly stopped it.
Everything below is verified against the current codebase (local staging
rehearsal passed 2026-07-12; boot fails fast and loud when misconfigured, so
a clean boot means a correct config).

## The runbook (operator, ~15 minutes)

### 1. Set the fatal secrets (app exits without these)

```bash
fly secrets set --app foundry-intel \
  TURSO_DATABASE_URL="libsql://<your-db>.turso.io" \
  TURSO_AUTH_TOKEN="<turso token>" \
  CLERK_SECRET_KEY="sk_live_..." \
  CLERK_PUBLISHABLE_KEY="pk_live_..." \
  OPENROUTER_API_KEY="sk-or-..."        # or ANTHROPIC_API_KEY
```

### 2. Set the degraded-feature secrets (app runs, features off without them)

```bash
fly secrets set --app foundry-intel \
  ENCRYPTION_KEY=$(openssl rand -hex 32) \
  STRIPE_SECRET_KEY="sk_live_..." \
  STRIPE_WEBHOOK_SECRET="whsec_..." \
  STRIPE_SOLO_PRICE_ID="price_1TrGcQRx25BFZ1JmKX8LLjUU" \
  STRIPE_GROWTH_PRICE_ID="price_1TMcZoRx25BFZ1JmvZC3Ebig" \
  STRIPE_INVESTOR_READY_PRICE_ID="price_1TMcZpRx25BFZ1JmZauYkItz" \
  RESEND_API_KEY="re_..." \
  ECOSYSTEM_SERVICE_KEY=$(openssl rand -hex 32)
# Optional but recommended: SENTRY_DSN, GITHUB_CLIENT_ID/SECRET, CLERK_WEBHOOK_SECRET
```

The three price IDs above are the verified LIVE prices on the shared account
(product `prod_ULJCAvVQCYi864`): Solo $79 / Growth $199 / Investor-Ready $399.

### 3. Deploy and verify

```bash
fly deploy --app foundry-intel
curl https://foundry-intel.fly.dev/internal/health
# expect: {"status":"ok","checks":{"database":"ok","ai_configured":"ok","clerk_configured":"ok"}}
fly logs --app foundry-intel | grep WARN
# every "[WARN] Config missing" line names a feature you left off — zero lines = fully configured
```

### 4. Stripe dashboard (2 minutes)

- **Archive the legacy $99 price**: Products → Foundry → "Founding Cohort"
  (`price_1TMcZoRx25BFZ1JmLSzy4AlJ`) → Archive. (Still active as of
  2026-07-12; archiving was permission-blocked from the remote session.)
- **Verify the webhook endpoint** exists for
  `https://foundry-intel.fly.dev/webhooks/stripe` with events
  `checkout.session.completed`, `customer.subscription.*`,
  `invoice.payment_failed` — and that its signing secret is the
  STRIPE_WEBHOOK_SECRET you set in step 2.

### 5. First-run walkthrough (the single most important pre-launch check)

Fresh Clerk user → onboarding (both the GitHub and no-code paths) → watch the
audit render → dashboard shows a non-empty briefing → welcome email queued →
trial state in the header. Then: `npm run cli -- seed:dogfood <productId>`.

## What is already verified (no operator action needed)

- Boot validation: missing fatal vars → exit 1 naming them; missing optional
  vars → loud per-feature WARN. Verified by running production boot locally.
- Fresh-DB migration chain (130 migrations) applies clean; all public pages
  200; all authenticated surfaces 401 unauthenticated; /internal/health ok.
- Worker/web split: PROCESS_ROLE=worker boots, scheduler gated to production.
- Money idempotency, rate limits, legal pages, health-check wiring: green in
  code (see GO-LIVE-CHECKLIST §2–§6).
