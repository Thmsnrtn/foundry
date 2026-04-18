# Lens 143 — Disaster Recovery Drill

**Distinct value:** Simulates three specific disaster scenarios -- Turso database goes down, Fly.io has a region outage, Anthropic is unavailable for 24 hours -- and traces the exact recovery path for each through the actual codebase. Not theoretical; each scenario is walked through the code to identify what breaks, what degrades gracefully, and what has no recovery path.

**Tenancy-critical:** Yes. A database outage affects all tenants simultaneously. The recovery path must restore every tenant's data without cross-contamination, and the single-region architecture means all tenants share the same failure domain.

## Scenario 1: Turso Database Goes Down

### What Breaks Immediately

Every route in Foundry queries the database. The health check at `src/routes/internal/health.ts:11-16` catches the error and returns `{ status: "degraded", checks: { database: "error" } }` with HTTP 503. Fly.io's health check (configured in `fly.toml` at 30-second intervals) will detect this and stop routing traffic to the instance.

**User impact:** Total outage. No dashboard, no API, no webhooks. Every route hits the database within its first few operations (auth middleware resolves the founder from DB, tenant middleware loads the product from DB).

**Background jobs:** All 30 scheduled jobs will fail. The job runner in `src/jobs/index.ts` wraps each job execution in a try-catch, so individual job failures are logged but do not crash the process. However, every job queries the database as its first operation, so all jobs fail immediately and silently for each cycle.

**Agent runs:** SCP scheduler queries `SELECT * FROM products WHERE scp_status = 'active'` as its first operation. This fails, is caught, and logged. No agents run.

### Recovery Path

1. **Detection:** Fly.io health check triggers within 30 seconds. The `/internal/health` endpoint returns 503.
2. **Diagnosis:** Check Turso status: `turso db show foundry-intel`. Check if the issue is Turso-wide or specific to this database.
3. **If Turso is down (provider outage):**
   - Wait for Turso to recover. There is no failover database.
   - Turso uses distributed SQLite with automatic replication. If the primary is down, Turso should failover to a replica. This is handled by Turso infrastructure, not by Foundry.
   - The runbook says "Contact Turso support" which is the correct step.
   - **RTO estimate:** Depends entirely on Turso. Foundry has zero influence over recovery time.
4. **If the database is corrupted:**
   - Restore from backup: `turso db create foundry-restore --from-dump backup.sql`
   - Update the database URL: `fly secrets set TURSO_DATABASE_URL=libsql://foundry-restore.turso.io`
   - Fly.io auto-restarts the app with the new URL.
   - **RPO:** Last manual backup. There is no automated backup schedule, so RPO could be days or weeks.
5. **If auth token expired:**
   - Regenerate: `turso db tokens create foundry-intel`
   - Update: `fly secrets set TURSO_AUTH_TOKEN=new-token`

### Gaps Identified

| Gap | Severity | Description |
|-----|----------|-------------|
| No automated backups | P0 | RPO depends on manual backup frequency. Could be days. |
| No connection retry | P1 | The Turso client in `src/db/client.ts` does not retry failed queries. A transient network blip fails the entire request. |
| No read replica configuration | P2 | Turso supports read replicas in multiple regions. Foundry uses a single database URL with no replica fallback. |
| No backup verification | P1 | The backup procedure creates a dump file but never verifies it can be restored. |
| No data integrity check post-restore | P1 | After restoring, there is no procedure to verify row counts, check referential integrity, or confirm all tenants' data is intact. |
| Health check does not distinguish transient vs. persistent DB failure | P2 | A single failed `SELECT 1` returns "degraded." There is no retry or consecutive-failure threshold. |

## Scenario 2: Fly.io Region Outage (iad)

### What Breaks Immediately

Foundry runs in a single region: `primary_region = "iad"` (US East, N. Virginia) with `min_machines_running = 1`. There is no multi-region deployment. A region outage means total downtime.

**User impact:** Total outage. DNS resolves to Fly.io's anycast, which routes to the iad region. If iad is down, there is no other machine to serve requests.

**Database:** Turso's database may be accessible from other regions (Turso uses a global network), but there is no Foundry instance to query it.

**Cron jobs:** All 30 in-process cron jobs stop. When the region recovers (or a new instance starts), jobs resume from their next scheduled time. Missed executions are lost -- there is no catch-up mechanism.

### Recovery Path

1. **Detection:** Fly.io status page shows iad region issues. Health checks stop responding. External uptime monitors (if configured) trigger alerts.
2. **If iad is temporarily degraded:**
   - Fly.io auto-starts machines. With `auto_start_machines = true`, the platform will attempt to restart.
   - Wait for Fly.io to recover the region. Foundry has no multi-region deployment to failover to.
3. **If iad is persistently down:**
   - **Manual failover to another region:** This requires changing `primary_region` in `fly.toml` and redeploying. But if the Fly.io control plane is also affected, `fly deploy` may not work.
   - Alternative: `fly machines clone <machine-id> --region ord` to clone the machine to Chicago. Then update DNS or rely on Fly.io's anycast routing.
   - The Turso database URL does not change (Turso is independent of Fly.io regions), so the cloned machine can connect to the same database.
4. **Post-recovery:**
   - No data loss expected (database is external to Fly.io).
   - Missed cron jobs do not auto-catch-up. The most impactful missed jobs: daily Signal computation, SCP agent runs (hourly), and digest generation (weekly Monday).

### Gaps Identified

| Gap | Severity | Description |
|-----|----------|-------------|
| Single-region deployment | P0 | Total outage if iad goes down. No failover. |
| No multi-region Fly.io configuration | P1 | `fly.toml` defines only `primary_region = "iad"`. No secondary region configured. |
| No cron job catch-up | P1 | Missed hourly agent runs and daily signal computations are lost, not replayed. |
| No external uptime monitoring | P1 | No Pingdom, UptimeRobot, or similar configured. Detection relies on founder complaints or manual checking. |
| No documented region failover procedure | P0 | The runbook does not mention region outages at all. |
| In-process cron jobs have no persistence | P2 | Jobs are in-memory only. No record of last execution time. After restart, all jobs start from scratch based on cron schedule. |

## Scenario 3: Anthropic Unavailable for 24 Hours

### What Breaks

**Immediately broken:**
- **AI Ask (query bar):** The dashboard AI query feature at `/api/ask` calls `callSonnet()`. Without Anthropic, this returns an error. The route has a try-catch that returns a JSON error to the frontend.
- **SCP agent runs:** All 12 agents call Claude for analysis. The per-agent try-catch in `src/services/scp/instance.ts:152-178` catches the failure. Each agent's run is recorded as failed in the output. The scheduler continues to the next agent/product, so the process does not crash. But zero agents produce analysis for 24 hours.
- **Audit engine:** The 10-dimension scoring at `src/services/audit/scorer.ts` calls Claude Opus. New onboarding audits are completely blocked. The onboarding route has no try-catch around `runAudit`, so the founder gets a 500 error.
- **Competitive scans:** Weekly Sunday scan calls Claude Sonnet. If the outage falls on Sunday, the scan fails silently.
- **Digest generation:** Weekly and risk-state digests call Claude for narrative generation. Digests fail to generate.
- **Remediation PR generation:** Cannot generate code fixes.
- **Evolution gate:** The constitution and safety gates call Claude. Evolution is blocked.

**Partially degraded:**
- **Signal score:** `src/services/signal.ts:209-217` wraps the prose generation in try-catch and falls back to `buildFallbackProse()`. The numeric Signal score computes from database data without AI. The dashboard shows a score with generic prose.
- **Dashboard rendering:** All dashboard routes render from database data. The dashboard is fully functional minus the AI Ask feature. Historical briefings, decisions, stressors, and audit results are all served from the database.

**Unaffected:**
- Authentication (Clerk)
- Billing (Stripe)
- Data export (Privacy)
- All non-AI database reads and writes
- Metric ingestion

### Recovery Path

1. **Detection:** The health check at `/internal/health` checks `process.env.ANTHROPIC_API_KEY` presence, not API reachability. An Anthropic outage is NOT detected by the health check. Detection depends on noticing failed agent runs in logs or founder reports that AI Ask is broken.
2. **During the outage:**
   - The system degrades gracefully for dashboard viewing. Founders can see historical data, make decisions, and use non-AI features.
   - Onboarding is blocked for the GitHub path (audit requires AI). The no-code path may also be blocked if it triggers an audit.
   - Agent runs fail every hour but do not crash the system. The cost ceiling is not consumed. When Anthropic returns, the next hourly cycle picks up normally.
3. **After recovery:**
   - Agent runs resume on the next scheduled cycle. There is no catch-up for the 24 missed hourly cycles.
   - If the weekly synthesis, competitive scan, or digest generation was missed, there is no automatic retry. The jobs must be manually triggered: `npm run cli -- job:run weekly_synthesis`.
   - Signal prose regenerates on the next signal computation.

### Gaps Identified

| Gap | Severity | Description |
|-----|----------|-------------|
| Health check does not detect Anthropic outage | P1 | Only checks env var presence, not API reachability. A live ping would add cost but catch outages. |
| Onboarding audit has no AI fallback | P0 | New founder onboarding is completely blocked. No way to skip audit and provision the product. |
| No missed-job replay mechanism | P1 | 24 hours of missed agent analysis, missed digests, missed scans. No automatic catch-up. |
| No degraded-mode banner | P1 | Founders see no indication that AI features are unavailable. The query bar just returns an error. |
| No Anthropic status monitoring | P2 | No automated check of Anthropic's status page or API health. |
| Competitive scan and weekly synthesis are not idempotent | P2 | Manually re-running a missed job may produce duplicate entries if partial data was written before the failure. |

## Cross-Scenario Findings

| Finding | Scenarios | Severity |
|---------|-----------|----------|
| No automated backup schedule | Turso | P0 |
| Single region, no failover | Fly.io | P0 |
| No cron job catch-up mechanism | Fly.io, Anthropic | P1 |
| Health check has blind spots | Turso (no retry), Anthropic (not checked) | P1 |
| No external uptime monitoring | All scenarios | P1 |
| No degraded-mode user communication | Anthropic, Turso | P1 |
| Onboarding blocked without AI | Anthropic | P0 |
| No documented recovery procedures for 2 of 3 scenarios | Fly.io, Anthropic | P0 |

## Priority Remediation

1. **P0:** Implement automated daily backups with verification and define RPO/RTO targets
2. **P0:** Add multi-region Fly.io deployment (at minimum, a standby machine in `ord` or `lax`)
3. **P0:** Add AI fallback for onboarding (skip audit, provision product, run audit asynchronously when AI returns)
4. **P1:** Add Anthropic API reachability to health check (lightweight, cached, 5-minute TTL)
5. **P1:** Implement missed-job detection and catch-up (store last execution timestamp, replay on startup)
6. **P1:** Add external uptime monitoring with alerting (UptimeRobot, Pingdom, or similar)
7. **P1:** Add degraded-mode banner to dashboard when AI or DB health checks fail
