# Red Team 01 -- Angry Enterprise Buyer

**Persona:** VP of Engineering / Head of Security at a 500-person company evaluating Foundry for adoption across a portfolio of 12 internal SaaS products. I have a 47-item procurement security questionnaire and a zero-tolerance policy for "we'll fix it later."

**Verdict: DISQUALIFIED.** Foundry fails enterprise procurement on at least 9 of 11 mandatory evaluation criteria. I would not allow this product past the vendor intake form.

---

## 1. SOC 2 Compliance

**Status: NO EVIDENCE. Immediate disqualification.**

There is no SOC 2 Type I or Type II report. There is no mention of SOC 2 certification, audit engagement, or even a SOC 2 readiness assessment anywhere in the codebase, documentation, or operational runbook. The word "SOC" appears exactly once in the entire codebase -- in a mockup document (`mockups/founder-intelligence-report.md`) describing a *hypothetical customer* who needs SOC 2 and "doesn't know what SOC 2 is." That is darkly ironic because Foundry itself is in the same position.

**What I need:** A SOC 2 Type II report from an accredited auditor (Drata, Vanta, or equivalent continuous compliance platform at minimum). Without this, my legal team will not sign a vendor agreement.

**Gap severity:** BLOCKING. No enterprise with a security program will adopt a SaaS product that handles proprietary business intelligence, source code access tokens, and financial metrics without SOC 2.

---

## 2. Data Residency

**Status: COSMETIC CONTROLS ONLY. Real data cannot be moved.**

Foundry has a `data_residency_settings` table (migration 041) with a `preferred_region` field accepting `us-east`, `us-west`, `eu-west`, and `ap-southeast`. There is a privacy settings UI that lets the user select a preferred region.

**The problem: this setting does nothing.** The entire application runs on a single Fly.io machine in the `iad` (US East) region (`fly.toml` line 2: `primary_region = "iad"`). The database is a single Turso instance with one URL (`TURSO_DATABASE_URL`). There is no multi-region Turso configuration, no data replication to EU or APAC regions, and no code that reads the `preferred_region` setting and routes data accordingly.

The `preferred_region` field is a database column that nobody reads. It is a checkbox for a feature that does not exist.

**What I need:** Contractual guarantees that data for EU entities stays within EU boundaries (GDPR Article 44+). Turso supports multi-region, but it is not configured. The `preferred_region` setting must actually control where data is stored, not just which radio button is selected.

**Gap severity:** BLOCKING for any customer with EU operations. This would also fail a GDPR adequacy assessment.

---

## 3. Audit Log Completeness

**Status: PARTIAL. Agent actions logged; user actions NOT logged.**

There are two audit log systems:
1. **`audit_log` table** (core schema) -- logs SCP agent autonomous actions (risk state transitions, competitive scans, remediation PRs, lifecycle transitions). This has good coverage: 11 service files call `insertAuditLog()`.
2. **`agent_audit_log` table** (migration 025) -- a more general event log with `actor_type` support for `agent`, `founder`, `system`, and `api`.

**Critical gap:** The `logAudit()` function in `src/services/audit/log.ts` is defined but **never called anywhere in the codebase**. Zero imports of `logAudit` exist outside its own file. This means:

- **User login/logout:** NOT logged. The auth middleware (`src/middleware/auth.ts`) updates `last_seen_at` but records no audit event.
- **Permission changes:** NOT logged. RBAC role assignments in `src/services/rbac/permissions.ts` have no audit trail.
- **Settings changes:** NOT logged. Privacy settings, consent changes, data residency changes -- no audit events.
- **API key creation/revocation:** NOT logged beyond the `created_at` timestamp on the key itself.
- **Data export requests:** NOT logged. The `exportProductData()` function has no audit call.
- **Data deletion requests:** Logged only as a side effect (insertion into `agent_audit_log` directly), not through the proper `logAudit()` interface.
- **Integration credential changes:** NOT logged. Adding/revoking GitHub, Stripe, Slack integrations leaves no audit trail.
- **Product creation/deletion:** NOT logged.

The agent audit log captures what the *robots* did. It does not capture what *humans* did. For SOC 2 CC6.1 and CC7.2, I need a complete audit trail of all user-initiated actions with IP address, timestamp, actor identity, and the before/after state of any changed resource.

**Gap severity:** BLOCKING. Incomplete audit logs are the single most common SOC 2 finding.

---

## 4. Encryption at Rest

**Status: PARTIALLY IMPLEMENTED. Critical gaps remain.**

An encryption module exists (`src/services/encryption.ts`) implementing AES-256-GCM with a 32-byte key from `ENCRYPTION_KEY` environment variable. It is used in exactly one place: the GitHub OAuth flow in `src/routes/dashboard/onboarding.ts` encrypts the GitHub access token before storing it in the `products` table.

**What is NOT encrypted:**
- `credentials_json` in the `integrations` table (Stripe, PostHog, Intercom, Linear, Slack, Sentry API keys) -- stored as plaintext JSON. The migration file (`008_integrations.sql` line 9) contains the comment `-- credentials_json is encrypted at rest in production` which is false.
- `bot_token` in the `slack_integrations` table (migration `013_voice_push.sql` line 94) -- comment says `-- encrypted`, which is false.
- `access_token` in the `investor_access` table (migration 011) -- plaintext.
- `access_token` in the `deal_rooms` table (migration 011) -- plaintext.
- `api_key` in the `portfolios` table (migration 033) -- plaintext.
- The `jobs/index.ts` file (line 491) reads `github_access_token` and passes it directly to service functions -- it calls `isEncrypted()`/`decrypt()` in the onboarding flow but the background jobs bypass this entirely.

The schema comments actively lie about encryption status. Four separate SQL migration files claim credentials are encrypted when they are not. This is not a missing feature; it is misrepresentation that would mislead an auditor.

**What I need:** All secrets encrypted at rest with AES-256-GCM (which they have the code for but do not use). Key management through a proper KMS, not an environment variable with no rotation tooling. The runbook acknowledges (line 72): "Run migration script to re-encrypt (not yet implemented)."

**Gap severity:** BLOCKING. Plaintext credential storage with false documentation is a material security deficiency.

---

## 5. Encryption in Transit

**Status: ACCEPTABLE with caveats.**

HTTPS is enforced at the infrastructure level:
- `fly.toml` line 16: `force_https = true` -- Fly.io's load balancer enforces TLS termination.
- `src/middleware/security-headers.ts` line 35: `Strict-Transport-Security: max-age=31536000; includeSubDomains` is set in production.
- CORS is configured with `credentials: true` scoped to `APP_URL`.

**Caveats:**
- The database connection to Turso uses `libsql://` which supports TLS, but there is no explicit TLS verification in the client configuration (`src/db/client.ts`). Turso's hosted service uses TLS by default, but the code does not enforce or verify it.
- The Anthropic API, GitHub API, Stripe API, Resend API, and Clerk API calls all use HTTPS by default through their SDK clients, but none of the external calls have explicit TLS certificate pinning or verification.
- No mTLS between services. The internal ecosystem endpoint uses a shared API key over HTTPS, which is acceptable for a single-service architecture but would not pass for a microservices deployment.

**Gap severity:** LOW. Transit encryption is handled by infrastructure, which is standard practice. Not a blocker.

---

## 6. Backup and Disaster Recovery

**Status: INFORMAL. No documented RPO/RTO. No tested recovery procedure.**

The runbook (`docs/operations/runbook.md`) contains a 4-line backup section:

```
# Turso manages replication and backups automatically
# For manual backup:
turso db shell foundry-intel ".dump" > backup-$(date +%Y%m%d).sql
```

And a 3-line restore section pointing to `turso db create --from-dump`.

**What is missing:**
- **No defined RPO (Recovery Point Objective).** How much data loss is acceptable? Is it 1 hour? 24 hours? There is no automated backup schedule.
- **No defined RTO (Recovery Time Objective).** How fast will the service be restored? There is no documented procedure, no runbook for total failure, no failover mechanism.
- **No backup testing.** Has the restore procedure ever been tested? No evidence of this.
- **No off-site backup.** Turso's "automatic replication" is vendor-managed and not independently verifiable. If Turso has a catastrophic failure, there is no independent backup.
- **Single Fly.io machine.** `fly.toml` specifies `min_machines_running = 1` with `shared-cpu-2x` and 1GB RAM. There is no multi-region failover. A single machine failure means total downtime.
- **Graceful shutdown window is 4 seconds.** In-flight requests get 4 seconds before hard kill (`kill_timeout = 5` in fly.toml, `setTimeout(() => process.exit(0), 4000)` in index.ts). Long-running AI analysis calls (which have no timeouts) will be killed mid-flight with no retry.
- **26 cron jobs run in-process.** All scheduled jobs run in the same Node.js process as the HTTP server. A single OOM or crash kills both the web server and all background processing simultaneously.
- **No automated health-based recovery.** The health check (`/internal/health` every 30s) will detect downtime, but Fly.io's auto-restart is the only recovery mechanism. There is no automated failover to a standby.

**What I need:** A documented DR plan with tested RPO <= 1 hour, RTO <= 15 minutes, automated backups with independent storage, and at least 2 machines in different regions.

**Gap severity:** BLOCKING. Any enterprise paying $399/month for business-critical intelligence expects better than "Turso manages it."

---

## 7. SLA / Uptime Guarantees

**Status: NONE. Zero contractual uptime commitment.**

There is no SLA document, no uptime guarantee, no service credit policy, and no status page referenced anywhere in the codebase or documentation. The terms of service / legal pages (`src/routes/public/landing.ts`) contain data retention language but no availability commitments.

The health check endpoint (`/internal/health`) returns `status: "ok"` or `status: "degraded"` but this is for internal monitoring only -- there is no public-facing status page or historical uptime tracking.

**Infrastructure reality:** Single machine, single region, shared CPU, 1GB RAM, in-process cron jobs. The architecture does not support even a 99% uptime target (3.65 days of downtime per year).

**What I need:** A contractual SLA with 99.9% uptime, defined maintenance windows, incident response SLAs (P1 < 1 hour, P2 < 4 hours), and service credits for breaches.

**Gap severity:** BLOCKING. Enterprise procurement requires contractual availability guarantees.

---

## 8. Vendor Sub-Processors

**Status: INCOMPLETE. Partial list exists but does not meet GDPR Article 28 requirements.**

The privacy/legal page (`src/routes/public/landing.ts` lines 283-290) lists sub-processors:

- Clerk (authentication)
- Turso (database)
- Anthropic (AI analysis)
- Stripe (payments)
- Resend (email)
- Fly.io (hosting)

**What is missing:**
- **No DPA (Data Processing Agreement)** with any of these vendors, or at least none referenced in the codebase.
- **GitHub** is not listed as a sub-processor despite Foundry accessing customer GitHub repositories, reading source code, creating branches, and generating pull requests. This is a significant data access relationship that must be disclosed.
- **PostHog, Intercom, Linear, Slack, Sentry** -- all of these are supported integrations that Foundry connects to on behalf of the customer. While the customer initiates the integration, Foundry acts as a data processor for data flowing through these connections. They should be listed.
- **No notification mechanism** for sub-processor changes. GDPR Article 28(2) requires prior notification when adding new sub-processors.
- **No sub-processor security assessment.** There is no evidence that the security posture of any sub-processor has been evaluated.

**Gap severity:** HIGH. Would fail GDPR procurement review for EU customers.

---

## 9. Data Deletion (Right to Erasure)

**Status: PARTIAL IMPLEMENTATION. Not verifiably complete.**

The system has:
- A `scheduleDataDeletion()` function (`src/services/privacy/consent.ts` lines 285-303) that writes a `data_deletion_scheduled` event to the audit log.
- A manual CLI command: `npm run cli -- founder:delete <founder_id>` mentioned in the runbook (line 127).
- A "Delete Account" UI in the privacy settings page (`src/routes/dashboard/privacy.ts` line 275).

**Critical problems:**
1. **`scheduleDataDeletion()` only logs an intent.** It does not actually delete anything. The comment says "actual deletion is handled by a cron job" -- but no such cron job exists in `src/jobs/index.ts`. The scheduled deletion is a promise that is never fulfilled.
2. **No cascade verification.** The runbook mentions cascade deletes, but as documented in the security audit (SEC-20), not all tables have CASCADE constraints. `conversation_threads`, `saved_insights`, `api_keys`, `gate_events`, and other tables may not cascade, leaving orphaned data.
3. **Cross-product `decision_patterns` data is not deleted.** Data contributed to the anonymized pattern table is never removed because there is no `product_id` to key on. Once your data enters the pattern pool, it stays forever.
4. **Turso backups retain deleted data.** Even after deletion, backup dumps contain the deleted records. There is no backup retention policy or backup scrubbing procedure.
5. **No deletion confirmation.** The user is not notified when deletion is complete. There is no certificate of destruction.
6. **30-day delay with no override.** The `scheduleDataDeletion(productId, 30)` call hardcodes a 30-day grace period. GDPR Article 17 requires erasure "without undue delay" (interpreted as within 30 days), so the grace period consumes the entire legal window before deletion even begins.

**What I need:** A verifiable deletion pipeline that (a) actually executes, (b) cascades through all tables, (c) removes data from backups within the retention window, (d) provides a deletion certificate, and (e) handles the cross-product pattern table.

**Gap severity:** BLOCKING. Inability to verifiably delete data is a GDPR Article 17 violation.

---

## 10. Access Controls (RBAC)

**Status: IMPLEMENTED but with critical bypass routes.**

RBAC exists in `src/middleware/rbac.ts` with four roles: `viewer < analyst < admin < owner`. The `requirePermission()` and `requireRole()` middleware functions correctly implement role hierarchy and permission checking. Product owners automatically have all permissions.

**Problems:**
1. **RBAC middleware is not applied to most routes.** Of the 82+ route files, RBAC checks are not visible in the main `src/index.ts` route mounting. Individual route files would need to apply `requirePermission()` per-handler, but a search for `requirePermission` shows limited adoption.
2. **Seven P0/P1 tenant isolation bypasses** documented in the multi-tenancy audit (lens 44): portfolio API routes, experiment routes, and voice session routes have zero ownership validation. Any authenticated user can read/write any portfolio's data.
3. **No role management UI.** While the database schema supports team members and roles (migration for `team_members`), the actual role assignment and management workflow is unclear.
4. **API key permissions are not RBAC-scoped.** API keys (`pfk_*`) grant access based on the key existing, not based on granular permissions.
5. **Internal ecosystem key grants god-mode access.** A single shared key (`ECOSYSTEM_SERVICE_KEY`) grants full read/write to any product's data via `/internal/*` routes with no per-product authorization.

**Gap severity:** HIGH. RBAC exists in code but is not comprehensively enforced.

---

## 11. Penetration Testing

**Status: NO EVIDENCE. Never performed.**

There is no penetration test report, no vulnerability scan results, no bug bounty program, and no security assessment referenced anywhere in the codebase or documentation. The `Dockerfile` does not include `npm audit` or any dependency vulnerability scanning. There is no Snyk, Trivy, or equivalent security scanning integration.

The codebase has known P0 vulnerabilities documented in its own security audit (`docs/audits/lenses/07-security.md`):
- Stored XSS in public share pages (SEC-04)
- No input validation on any route (SEC-07)
- Previously: GitHub OAuth CSRF, plaintext token storage, no CSRF protection, timing-unsafe comparisons (some subsequently fixed based on code changes since the audit)

These are the kinds of vulnerabilities a penetration test would find in the first hour.

**What I need:** Annual third-party penetration test from a reputable firm (NCC Group, Bishop Fox, Trail of Bits, etc.). Findings must be remediated within 30 days (critical) / 90 days (high).

**Gap severity:** BLOCKING. Enterprise procurement requires evidence of external security testing.

---

## Summary Scorecard

| # | Criterion | Status | Blocking? |
|---|-----------|--------|-----------|
| 1 | SOC 2 Compliance | No evidence | YES |
| 2 | Data Residency | Cosmetic UI, no enforcement | YES |
| 3 | Audit Log Completeness | Agent actions only; user actions missing | YES |
| 4 | Encryption at Rest | Partial; schema comments lie about coverage | YES |
| 5 | Encryption in Transit | Acceptable (Fly.io TLS + HSTS) | No |
| 6 | Backup / DR | Informal, untested, single-region | YES |
| 7 | SLA / Uptime Guarantees | None | YES |
| 8 | Vendor Sub-Processors | Incomplete list, no DPAs | HIGH |
| 9 | Data Deletion | Scheduled but never executed | YES |
| 10 | Access Controls (RBAC) | Implemented but not enforced on all routes | HIGH |
| 11 | Penetration Testing | Never performed | YES |

**Final count: 7 BLOCKING, 2 HIGH, 2 ACCEPTABLE.**

---

## What Would Change My Mind

I am not saying Foundry is a bad product. The SCP agent architecture is genuinely interesting, and the multi-tenant query isolation at the database layer is done correctly. But "interesting product" and "enterprise-ready" are different conversations.

To pass our procurement review, Foundry would need to:

1. Engage a SOC 2 Type II audit (6-12 month process).
2. Encrypt ALL credentials at rest using the existing AES-256-GCM module (the code exists -- use it).
3. Implement actual data residency with multi-region Turso, or remove the fake region selector.
4. Add comprehensive user-action audit logging by actually calling the `logAudit()` function.
5. Write a real DR plan with defined RPO/RTO, automated backups, and multi-region deployment.
6. Publish an SLA with contractual uptime guarantees and service credits.
7. Complete the sub-processor list and obtain DPAs.
8. Build and test the data deletion pipeline that actually deletes data.
9. Apply RBAC middleware to all routes, not just some.
10. Commission an annual third-party penetration test.
11. Remove the false encryption comments from the schema, or (preferably) make them true.

Until then: **REJECTED.**
