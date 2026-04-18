# BLOCKER: Fly.io Authentication Required for Deploy

**Status:** BLOCKING Phase 4 (production deploy) only
**Impact:** Phases 1-3 and Phase 5 are unblocked

## Issue
The Fly CLI is installed (`/Users/user/.fly/bin/fly`) but not authenticated. `fly auth whoami` returns "no access token available."

## Resolution
The founder needs to authenticate the Fly CLI:

```bash
fly auth login
```

Or provide a deploy token:
```bash
export FLY_API_TOKEN=<token>
```

Once authenticated, deploy with:
```bash
cd /Users/user/foundry && fly deploy
```

## Post-Deploy Smoke Tests
After deploy completes, run:
1. `curl https://foundry-intel.fly.dev/internal/health` — expect 200 with `status: "ok"`
2. Visit `https://foundry-intel.fly.dev/` — landing page should render
3. Visit `https://foundry-intel.fly.dev/auth/signup` — Clerk auth screen should load
4. Check `fly logs` for any startup errors (migrations, SCP provisioning)
