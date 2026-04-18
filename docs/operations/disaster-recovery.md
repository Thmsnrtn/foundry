# Foundry -- Disaster Recovery Plan

## Overview

Foundry runs on Fly.io (compute), Turso (database), Clerk (auth), Stripe (billing), Anthropic (AI), and Resend (email). This document defines the recovery point objective (RPO), recovery time objective (RTO), and recovery steps for each failure scenario.

---

## 1. Database (Turso)

### Built-in Protections

Turso automatically replicates data across its infrastructure. All writes go through a primary instance with durable WAL-based persistence. Turso maintains point-in-time recovery and automatic backups as part of the managed platform.

### Manual Backup Procedure

Run periodically (recommend: daily via cron or CI job):

```bash
turso db shell foundry-intel ".dump" > backup-$(date +%Y%m%d-%H%M%S).sql
```

Store the dump in a separate location (e.g., S3 bucket, local encrypted volume).

### Restore from Backup

```bash
# Create a new database from the dump
turso db create foundry-restore --from-dump backup.sql

# Point production at the restored database
fly secrets set TURSO_DATABASE_URL=libsql://foundry-restore-<org>.turso.io
```

### Failure Scenario: Turso Outage

| Metric | Value |
|--------|-------|
| **RPO** | Near-zero (Turso replication is continuous) |
| **RTO** | 5--30 minutes (restore from dump + secret update + deploy) |
| **Impact** | All API routes return 500; dashboard inaccessible |
| **Detection** | Health check returns `database: "error"`, HTTP 503 |

**Recovery steps:**
1. Check Turso status page for known incidents.
2. If prolonged outage (>15 min), restore from latest manual backup:
   - `turso db create foundry-restore --from-dump backup-YYYYMMDD.sql`
   - `fly secrets set TURSO_DATABASE_URL=libsql://foundry-restore-<org>.turso.io`
3. Verify: `curl https://foundry-intel.fly.dev/internal/health`
4. Once Turso recovers, migrate back to primary and reconcile any data gap.

---

## 2. AI Provider (Anthropic)

### Failure Scenario: Anthropic Outage

| Metric | Value |
|--------|-------|
| **RPO** | N/A (no data stored at Anthropic) |
| **RTO** | Automatic once Anthropic resumes |
| **Impact** | Agent runs fail, AI Ask unavailable, no briefings generated |
| **Detection** | Agent runs return timeout/5xx; health check `anthropic_configured: "ok"` but runs fail |

**Recovery steps:**
1. No action required -- system degrades gracefully.
2. Dashboard continues to work with all historical data.
3. No data loss occurs; AI-generated insights are simply paused.
4. Missed agent runs execute on the next scheduler cycle once Anthropic resumes.
5. If outage is extended (>2 hours), notify founders via system notification or email.

---

## 3. Compute (Fly.io)

### Failure Scenario: Fly.io Region Outage

| Metric | Value |
|--------|-------|
| **RPO** | Zero (application is stateless; all state is in Turso) |
| **RTO** | 10--20 minutes (re-deploy to a different region) |
| **Impact** | Application unreachable |
| **Detection** | External uptime monitor alerts; Fly status page |

**Recovery steps:**
1. Check `fly status` and Fly.io status page.
2. If the primary region is down, re-deploy to a different region:
   ```bash
   # Update fly.toml primary_region or use --region flag
   fly deploy --region ord   # e.g., switch from iad to ord
   ```
3. Update DNS if using custom domain (Cloudflare).
4. Verify health: `curl https://foundry-intel.fly.dev/internal/health`

**Note:** Foundry currently runs single-region. Multi-region would require Turso read replicas and Fly multi-region scaling (future enhancement).

---

## 4. Authentication (Clerk)

### Failure Scenario: Clerk Outage

| Metric | Value |
|--------|-------|
| **RPO** | N/A (Clerk is the source of truth for auth) |
| **RTO** | Dependent on Clerk's recovery |
| **Impact** | Users cannot log in; authenticated routes reject requests |
| **Detection** | Login failures; Clerk status page |

**Recovery steps:**
1. No self-service recovery -- Clerk manages auth infrastructure.
2. Monitor Clerk status page.
3. Existing sessions may continue to work if JWT validation is cached.
4. No data loss -- all Foundry business data is in Turso.

---

## 5. Billing (Stripe)

### Failure Scenario: Stripe Outage

| Metric | Value |
|--------|-------|
| **RPO** | N/A (subscription state is cached in `founders.tier`) |
| **RTO** | Automatic on Stripe recovery |
| **Impact** | Cannot create new subscriptions; webhook deliveries queue up |
| **Detection** | Stripe status page; checkout failures |

**Recovery steps:**
1. Existing subscribers continue to work (tier is stored locally).
2. Stripe automatically retries failed webhook deliveries for up to 3 days.
3. Manually resend failed webhooks from Stripe Dashboard if needed.

---

## 6. Email (Resend)

### Failure Scenario: Resend Outage

| Metric | Value |
|--------|-------|
| **RPO** | N/A (emails are transactional, not stored) |
| **RTO** | Automatic on Resend recovery |
| **Impact** | Invitation and notification emails fail to send |
| **Detection** | Resend status page; email delivery logs |

**Recovery steps:**
1. Non-critical -- dashboard and agents continue to function.
2. Failed emails can be retried once Resend recovers.

---

## Backup Schedule Recommendation

| Frequency | Action | Retention |
|-----------|--------|-----------|
| Daily | `turso db shell foundry-intel ".dump" > backup-$(date +%Y%m%d).sql` | 30 days |
| Weekly | Copy daily backup to offsite storage (S3/GCS) | 90 days |
| Pre-deploy | Manual backup before any migration | Until next successful backup |

---

## Testing the Recovery Plan

1. **Quarterly:** Restore a backup to a test database and verify data integrity.
2. **Quarterly:** Simulate Anthropic outage (unset API key in staging) and confirm graceful degradation.
3. **Annually:** Practice full region failover in staging environment.
