# Foundry — Operations Runbook

## Deployment

### Production (Fly.io)
```bash
fly deploy                    # Standard deploy
fly deploy --strategy rolling # Zero-downtime deploy
fly status                    # Check deployment health
fly logs                      # Tail production logs
```

### Fresh Deploy Checklist
1. Copy `.env.example` to Fly secrets: `fly secrets import < .env`
2. Ensure all required secrets are set:
   - `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`
   - `CLERK_SECRET_KEY` + `CLERK_PUBLISHABLE_KEY`
   - `ANTHROPIC_API_KEY`
   - `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` + price IDs
   - `RESEND_API_KEY` + `RESEND_FROM_ADDRESS`
   - `ENCRYPTION_KEY` (32-byte hex: `openssl rand -hex 32`)
   - `ECOSYSTEM_SERVICE_KEY`
3. Deploy: `fly deploy`
4. Verify health: `curl https://foundry-intel.fly.dev/internal/health`
5. Run migrations verify: check logs for `[MIGRATIONS]` output

## Common Operations

### Check System Health
```bash
curl https://foundry-intel.fly.dev/internal/health
# Returns: { status: "ok"|"degraded", checks: { database, anthropic_configured, clerk_configured } }
```

### Database Operations
```bash
npm run cli -- db:migrate     # Run pending migrations
npm run cli -- db:status      # Table row counts
npm run cli -- db:seed        # Seed demo data (dev only)
```

### Job Operations
```bash
npm run cli -- job:list       # List all registered jobs with schedules
npm run cli -- job:run <name> # Manually run a specific job
```

### Product Status
```bash
npm run cli -- product:status <product_id>  # Full product health report
```

## Key Rotation

### Anthropic API Key
1. Generate new key at console.anthropic.com
2. `fly secrets set ANTHROPIC_API_KEY=sk-ant-new-key`
3. Fly auto-restarts the app — no code change needed

### Stripe Secret Key
1. Generate new key in Stripe Dashboard → Developers → API Keys
2. `fly secrets set STRIPE_SECRET_KEY=sk_live_new-key`
3. Update webhook endpoint secret if rotating webhook key

### Clerk Secret Key
1. Generate in Clerk Dashboard → API Keys
2. `fly secrets set CLERK_SECRET_KEY=sk_live_new-key CLERK_PUBLISHABLE_KEY=pk_live_new-key`

### Encryption Key
**CRITICAL:** Rotating the encryption key requires re-encrypting all stored tokens.
1. Generate new key: `openssl rand -hex 32`
2. Run migration script to re-encrypt (not yet implemented)
3. `fly secrets set ENCRYPTION_KEY=new-hex-key`

### Ecosystem Service Key
1. Generate: `openssl rand -hex 32`
2. `fly secrets set ECOSYSTEM_SERVICE_KEY=new-key`
3. Update the same key in Koldly, AcreOS, and Apex Micro deployments

## Backup/Restore

### Database Backup
```bash
# Turso manages replication and backups automatically
# For manual backup:
turso db shell foundry-intel ".dump" > backup-$(date +%Y%m%d).sql
```

### Restore from Backup
```bash
turso db create foundry-restore --from-dump backup.sql
# Update TURSO_DATABASE_URL to point to restored database
fly secrets set TURSO_DATABASE_URL=libsql://foundry-restore.turso.io
```

## Incident Response

### AI Outage (Anthropic Down)
- **Impact:** All agent runs fail, AI Ask unavailable, no briefings generated
- **Detection:** Health check returns `anthropic_configured: "ok"` but agent runs fail with timeout
- **Mitigation:** System degrades gracefully (dashboard still works, historical data available)
- **Recovery:** Automatic once Anthropic resumes; missed agent runs execute on next cycle

### Database Issues (Turso)
- **Impact:** All routes return 500
- **Detection:** Health check returns `database: "error"`, HTTP 503
- **Mitigation:** Fly.io stops routing to unhealthy instances
- **Recovery:** Check Turso status page; contact Turso support

### Billing Webhook Failure (Stripe)
- **Impact:** Subscription changes not reflected, tier gates may be stale
- **Detection:** Stripe Dashboard → Webhooks → check for failed deliveries
- **Mitigation:** Manually resend failed webhooks from Stripe Dashboard
- **Recovery:** Stripe retries automatically (up to 3 days)

### Runaway AI Costs
- **Detection:** Per-product daily cost ceiling ($25/day) triggers and blocks further AI calls
- **Mitigation:** Ceiling is automatic; check `getDailySpend()` for affected products
- **Adjustment:** `fly secrets set AI_DAILY_COST_CEILING_CENTS=5000` (increase to $50/day)

## Tenant Offboarding

When a founder requests full data deletion:
1. Export their data via Settings → Privacy → Data Export
2. Delete their Stripe subscription (if active)
3. Remove their Clerk user account
4. Run: `npm run cli -- founder:delete <founder_id>` (cascade deletes all products, agents, data)
5. Verify deletion: `npm run cli -- product:status` should return not found
6. Log the deletion in compliance records

## Monitoring

### Key Metrics to Watch
- Response times (Fly.io metrics dashboard)
- Agent run success rate (check `agent_run_details` table)
- Daily AI spend per product (check `agent_cost_log` table)
- Webhook delivery success (Stripe Dashboard + Clerk Dashboard)
- Migration status on deploy (check startup logs)
