# Lens 142 — Runbook Completeness Adversary

**Distinct value:** Stress-tests `docs/operations/runbook.md` against every incident type the system can produce, every secret that needs rotation, every backup scenario that needs testing, and every tenant lifecycle event that needs a procedure. The question is not "does a runbook exist" but "can an on-call engineer execute it at 3 AM without asking anyone?"

**Tenancy-critical:** Yes. The runbook covers tenant offboarding, and an incomplete offboarding procedure leaves orphaned data, running agents consuming AI credits, and potential GDPR violations.

## Executive Summary

The runbook at `docs/operations/runbook.md` covers 4 operational areas: deployment, common operations, key rotation, and incident response. It is a solid starting point but has critical gaps: ENCRYPTION_KEY rotation is documented as unimplemented, 3 of 8 secret types have no rotation procedure, the backup restore procedure has never been verified, and the incident response section covers only 4 of at least 10 plausible incident types. The tenant offboarding procedure references a CLI command whose behavior is unverified against the actual deletion code path.

## Section-by-Section Analysis

### 1. Deployment Section — Grade: B

**What exists:**
- `fly deploy` and `fly deploy --strategy rolling` commands
- Fresh deploy checklist with 5 steps including all required secrets
- Health check verification command

**What is missing:**
- No rollback procedure. If a deploy introduces a regression, there is no documented `fly releases rollback` or equivalent.
- No pre-deploy checklist (run migrations locally first? check migration compatibility? verify env vars match?)
- No blue-green or canary deployment guidance despite `--strategy rolling` being documented
- No procedure for deploying with pending migrations that require downtime (e.g., table renames)
- No mention of the 54 migration files or what happens if a migration fails mid-deploy (orientation doc flags this: "Migration failures don't stop server")

### 2. Key Rotation — Grade: C

**Covered (4 of 7+ secrets):**

| Secret | Documented | Procedure Complete |
|--------|-----------|-------------------|
| ANTHROPIC_API_KEY | Yes | Yes -- simple env var swap, auto-restart |
| STRIPE_SECRET_KEY | Yes | Partial -- says "update webhook endpoint secret if rotating webhook key" but does not give the command |
| CLERK_SECRET_KEY | Yes | Yes -- both secret and publishable key in one command |
| ENCRYPTION_KEY | Yes | **No** -- says "Run migration script to re-encrypt (not yet implemented)" |
| ECOSYSTEM_SERVICE_KEY | Yes | Partial -- says "Update the same key in Koldly, AcreOS, and Apex Micro deployments" but no commands or order-of-operations |

**Not covered (3+ secrets):**

| Secret | Risk if Leaked |
|--------|---------------|
| RESEND_API_KEY | Attacker sends emails as Foundry |
| GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET | Attacker impersonates Foundry's OAuth app, captures GitHub tokens |
| GITHUB_WEBHOOK_SECRET | Attacker forges GitHub webhook events |
| STRIPE_WEBHOOK_SECRET | Attacker forges Stripe subscription events (documented only as a footnote under STRIPE_SECRET_KEY) |
| CLERK_WEBHOOK_SECRET | Attacker forges Clerk user lifecycle events (user.deleted, user.created) |
| TURSO_AUTH_TOKEN | Attacker reads/writes entire database |

**ENCRYPTION_KEY rotation is the most critical gap.** The runbook explicitly acknowledges the re-encryption migration does not exist. If this key is rotated without re-encrypting existing tokens, all stored GitHub access tokens become permanently unreadable. The `isEncrypted()` function in `src/services/encryption.ts` can detect the format, but there is no script to read-decrypt-reencrypt all rows in `products.github_access_token` or `integrations.credentials_json`.

### 3. Backup / Restore — Grade: D

**What exists:**
- Backup command: `turso db shell foundry-intel ".dump" > backup-$(date +%Y%m%d).sql`
- Restore command: `turso db create foundry-restore --from-dump backup.sql` + update URL

**What is missing:**
- No automated backup schedule. The command is manual. Turso provides automatic replication, but the runbook says "Turso manages replication and backups automatically" without verifying this is configured or what the RPO/RTO is.
- No backup verification step. After creating a backup, there is no `turso db shell foundry-restore "SELECT COUNT(*) FROM founders"` or similar integrity check.
- No restore testing procedure. The restore has never been tested. There is no record of a restore drill.
- No point-in-time recovery guidance. Turso supports it, but the runbook does not document how to request it.
- No multi-database backup consideration. If the system ever uses multiple Turso databases (e.g., per-region), the single-database dump is insufficient.
- No backup storage location or retention policy. Where do backups go? How long are they kept? Who has access?

### 4. Incident Response — Grade: D+

**Covered (4 scenarios):**

| Incident | Detection | Mitigation | Recovery |
|----------|-----------|------------|----------|
| AI Outage (Anthropic) | Noted but incomplete | "System degrades gracefully" | "Automatic once Anthropic resumes" |
| Database Issues (Turso) | Health check returns error | Fly.io stops routing | "Contact Turso support" |
| Billing Webhook (Stripe) | Check Stripe Dashboard | Manually resend | Stripe retries 3 days |
| Runaway AI Costs | Daily cost ceiling | Automatic block | Adjust ceiling via env var |

**Not covered (6+ scenarios):**

| Incident | Impact | Why It Needs a Procedure |
|----------|--------|------------------------|
| Clerk outage | All users locked out, no new signups, no webhook events | Auth is single point of failure; no session cache or fallback |
| Resend outage | No digests, no behavioral trigger emails, no deletion confirmations | Founders receive no communication; Red state daily briefings silently fail |
| GitHub API outage | Audits fail, no PR generation, no repo analysis | Onboarding blocked for GitHub path; no fallback documented |
| Region outage (Fly.io iad) | Total downtime (single region) | No multi-region failover; the runbook does not document how to fail over to another region |
| Memory exhaustion | Server OOM kill (1GB limit on shared-cpu-2x) | 30 in-process cron jobs + concurrent requests; no guidance on identifying the cause |
| Certificate expiry | HTTPS fails | Fly.io auto-renews but custom domains may not; no monitoring documented |
| Migration failure | Inconsistent schema, potential data corruption | Server continues running with partial schema (orientation doc item #9) |
| Webhook replay attack | Forged subscription events if STRIPE_WEBHOOK_SECRET is compromised | Only Stripe webhooks have signature verification; Clerk webhook verification exists but GitHub does not |
| DDoS / rate limit exhaustion | Service degradation | Rate limiting exists but no runbook for responding to sustained attacks |
| Data corruption | Bad agent writes, migration errors | No procedure for identifying and reverting corrupted rows |

### 5. Tenant Offboarding — Grade: C+

**What exists (6 steps):**
1. Export data via Settings -> Privacy -> Data Export
2. Delete Stripe subscription
3. Remove Clerk user account
4. Run `npm run cli -- founder:delete <founder_id>`
5. Verify deletion
6. Log in compliance records

**What is missing:**
- Step 1 exports only the current product's data. If the founder has multiple products, the export must be repeated per product. The runbook does not mention this.
- The CLI `founder:delete` command's behavior is unverified. The actual deletion code in `src/routes/auth/clerk.ts:149-155` deletes products and founder via direct SQL, but it does not delete: agent configs, SCP briefings, metric snapshots, stressor history, scenario models, cohorts, competitors, competitive signals, lifecycle state, decisions, audit scores, founding story artifacts, privacy consents, or data residency settings. The `DELETE FROM products WHERE id = ?` relies on CASCADE constraints, but SQLite does not enforce CASCADE by default unless `PRAGMA foreign_keys = ON` is set. There is no evidence this pragma is set in the Turso client configuration.
- No step to cancel running SCP agents. If the scheduler picks up the product between step 2 and step 4, agents will attempt to run and fail (or succeed and waste AI credits).
- No step to revoke the founder's GitHub OAuth token.
- No step to dequeue pending webhooks or cancel scheduled emails.
- The "compliance records" in step 6 have no defined format, location, or retention period.

## Findings Summary

| # | Section | Grade | Critical Gap |
|---|---------|-------|-------------|
| 1 | Deployment | B | No rollback procedure |
| 2 | Key Rotation | C | ENCRYPTION_KEY unimplemented; 3 secrets undocumented |
| 3 | Backup/Restore | D | Never tested; no automated schedule; no verification |
| 4 | Incident Response | D+ | 4 of 10+ scenarios covered; no escalation path |
| 5 | Tenant Offboarding | C+ | CASCADE not verified; incomplete data deletion |

## Overall Runbook Grade: C-

The runbook exists and covers the happy path. It does not survive contact with a real incident. An on-call engineer at 3 AM would be blocked on ENCRYPTION_KEY rotation, unable to roll back a bad deploy, and unsure how to handle 6 of 10 plausible incident types.

## Priority Remediation

1. **P0:** Implement ENCRYPTION_KEY re-encryption migration script and update the runbook
2. **P0:** Add rollback procedure (`fly releases list` + `fly deploy --image <previous>`)
3. **P0:** Verify CASCADE behavior with Turso and document the complete deletion cascade
4. **P1:** Add rotation procedures for RESEND_API_KEY, GITHUB_CLIENT_SECRET, CLERK_WEBHOOK_SECRET, TURSO_AUTH_TOKEN
5. **P1:** Add incident response procedures for Clerk outage, region outage, migration failure, and memory exhaustion
6. **P1:** Implement and document automated backup schedule with verification
7. **P2:** Add escalation path, on-call rotation, and severity classification to incident procedures
