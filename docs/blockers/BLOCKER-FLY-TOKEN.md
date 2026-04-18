# BLOCKER: Missing Fly.io Secrets for Deploy

**Status:** PARTIALLY RESOLVED — deploy attempted, machine crashed due to missing ENCRYPTION_KEY

## What Happened
Deploy built successfully (image 89MB) and pushed to registry. Machine started but stopped because required environment variables are missing.

## Missing Secrets (founder must set these)

```bash
# Generate and set ENCRYPTION_KEY (required for token encryption)
fly secrets set ENCRYPTION_KEY=$(openssl rand -hex 32) --app foundry-intel

# Set Stripe webhook secret (required for billing webhook verification)
fly secrets set STRIPE_WEBHOOK_SECRET=whsec_your_stripe_webhook_secret --app foundry-intel

# Set ecosystem service key (required for internal API routes)
fly secrets set ECOSYSTEM_SERVICE_KEY=$(openssl rand -hex 32) --app foundry-intel

# Optional but recommended:
fly secrets set CLERK_WEBHOOK_SECRET=whsec_your_clerk_webhook_secret --app foundry-intel
fly secrets set GITHUB_CLIENT_ID=your_github_client_id --app foundry-intel
fly secrets set GITHUB_CLIENT_SECRET=your_github_client_secret --app foundry-intel
```

## After Setting Secrets

The machine will auto-restart when secrets are updated. Or manually:
```bash
fly deploy --app foundry-intel
```

## Verification
```bash
curl https://foundry-intel.fly.dev/internal/health
# Expected: {"status":"ok","checks":{"database":"ok",...}}
```
