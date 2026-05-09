# Staging Environment — Plan

> Wave 4, action 29. Council 13 (DevOps). The 300-persona review
> flagged: today, `fly deploy` is the entire deploy pipeline. No
> staging. One slip and a founder sees a half-broken product. A
> staging Fly app + a CI step would catch most regressions.

> Status: plan, requires operator action (Fly account / Turso
> account setup). Implementation is operator-driven; this doc is
> the runbook for when it happens.

---

## 1. What "staging" means here

Not a duplicate production. A **disposable replica that runs
identical code against an identical schema with synthetic data**.

- Same Fly Docker image as prod.
- Same Turso schema as prod (migrations applied identically).
- Synthetic data only: seed-demo or one operator's dogfood
  product. No real customer data ever.
- Different secrets: Stripe test mode, Anthropic test key (or low
  spend ceiling), test Resend domain, separate Clerk app.

The point is to surface deploy-time bugs (broken migration, missing
secret, env-shaped panic) before they touch real founders.

## 2. Setup checklist

When the operator decides to ship this:

### 2.1 Fly app

```bash
# Create the staging app pointing at the same repo / Dockerfile.
fly launch --name foundry-intel-staging --no-deploy --copy-config
# Edit the staging fly.toml to point at staging-specific env / secrets.
```

### 2.2 Turso database

```bash
# Create a staging Turso DB.
turso db create foundry-staging
turso db tokens create foundry-staging --expiration none
# Note the URL and auth token; set them as Fly secrets:
fly secrets set TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... -a foundry-intel-staging
```

### 2.3 Auth (Clerk)

Either (a) a separate Clerk dev application, or (b) the same Clerk
prod app with a staging hostname configured. (a) is cleaner. Set
`CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` accordingly.

### 2.4 Stripe

Use Stripe test mode. Set `STRIPE_SECRET_KEY=sk_test_*` and
configure a test webhook endpoint pointed at
`https://foundry-intel-staging.fly.dev/webhooks/stripe`.

### 2.5 Anthropic / OpenRouter

Either (a) a low-spend-cap test API key, or (b) the prod key with a
runtime cost ceiling (existing `cost_ceiling` mechanism applies). (a)
preferred; isolates spend.

### 2.6 Resend

Test API key; configure a different `RESEND_FROM_ADDRESS` so test
emails are unmistakably staging-origin.

### 2.7 ENCRYPTION_KEY

`openssl rand -hex 32`. Different from prod. Loss of the staging key
is recoverable (data is synthetic).

## 3. CI integration

Add to `.github/workflows/ci.yml`:

```yaml
  deploy-staging:
    name: Deploy to staging on master push
    runs-on: ubuntu-latest
    needs: [check, schema-drift]
    if: github.ref == 'refs/heads/master' && github.event_name == 'push'
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --remote-only --app foundry-intel-staging
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN_STAGING }}
      - name: Smoke test
        run: |
          for i in 1 2 3 4 5; do
            if curl -fsS https://foundry-intel-staging.fly.dev/internal/health; then
              exit 0
            fi
            sleep 10
          done
          echo "Staging /internal/health failed after 5 attempts"
          exit 1
      - name: Run preflight against staging
        run: |
          flyctl ssh console --app foundry-intel-staging \
            --command 'npm run cli -- preflight' || exit 1
```

The `deploy-staging` job runs after `check` and `schema-drift` pass.
A staging-deploy failure (broken migration, missing secret, panic on
boot) blocks production deploy.

## 4. The promotion ritual

Once staging is healthy, prod deploy is:

```bash
# Operator confirms staging is green:
curl https://foundry-intel-staging.fly.dev/internal/health
# If healthy:
fly deploy --app foundry-intel
# Then preflight against prod:
flyctl ssh console --app foundry-intel --command 'npm run cli -- preflight'
```

This becomes a 2-minute promotion instead of a "ship and pray"
deploy. The CI pipeline can later automate this (deploy to prod on
manual approval after staging green) but that's a refinement.

## 5. What staging won't catch

- **Real-customer data shape edge cases.** Synthetic data has the
  schema right; rarely the distribution.
- **Production-only third-party rate limits.** Stripe live, GitHub
  prod, Anthropic prod — staging uses test keys.
- **Production traffic patterns.** Staging gets ~0 organic traffic;
  load issues only surface at scale.

These are post-deploy concerns the SLO alerts (`docs/operations/slos.md`)
catch. Staging closes the deploy-time-error window; SLOs catch the
runtime window.

## 6. Cost

- Fly: another small VM (~$10-30/mo idle).
- Turso: a free-tier instance covers staging usage.
- Stripe / Clerk / Anthropic / Resend: test/dev keys are free.

Total: under $30/mo. Roughly the cost of one prevented incident.

## 7. The smaller version (operator action only)

If the full staging setup is two-days-of-work-too-much: at minimum,
**run preflight against prod after every deploy**:

```bash
fly deploy && flyctl ssh console --app foundry-intel \
  --command 'npm run cli -- preflight'
```

Wraps existing tools; no new infrastructure. Catches missing-secret
and broken-migration cases on a real deploy, just after it's
already happened (not before). Better than nothing; worse than
staging.

— end —
