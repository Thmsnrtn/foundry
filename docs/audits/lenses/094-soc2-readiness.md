# Lens 094 — SOC2-Readiness Reviewer

**Distinct value:** Evaluates Foundry against SOC2 Type II Trust Service Criteria (Security, Availability, Processing Integrity, Confidentiality, Privacy). Focuses on the control gaps that would block certification and the evidence gaps that would prevent an audit.

**Tenancy-critical:** Yes. SOC2 requires demonstrable tenant isolation, access controls per customer, and data handling documentation. Multi-product founders with cross-company data access are the most scrutinized tenant boundary.

## Executive Summary

Foundry is **12-18 months from SOC2 readiness**. The product has no formal access controls beyond Clerk authentication, no encryption at rest (database-level), minimal audit logging (see Lens 093), no change management process, no vendor risk management, no incident response plan, no business continuity documentation, and no security monitoring. The positive foundations are: Clerk for authentication (delegated identity provider), AES-256-GCM encryption module (exists but underused), Svix webhook signature verification, CORS configuration, and rate limiting. The most critical gaps are: (1) audit log completeness (0% of founder actions logged), (2) no role-based access control enforcement (RBAC middleware exists but is not applied to any route), (3) credentials stored in plaintext, and (4) no change management documentation.

## Findings by SOC2 Trust Service Criteria

### CC6.1 — Logical Access Controls

**Status: Failing**

- **Authentication:** Clerk handles identity, JWT validation, and session management. This is a strong foundation — delegating auth to a SOC2-compliant provider (Clerk is SOC2 Type II certified) satisfies the identity management control.
- **Authorization:** The RBAC middleware (`src/middleware/rbac.ts`) exists but is not applied to any route. There is no evidence of role-based restrictions. All authenticated founders have identical access to all features within their tier. There are no admin roles, no read-only roles, and no team member access levels.
- **Multi-tenancy:** Product ownership is enforced by `WHERE owner_id = ?` in queries. The tenant middleware returns 404 (not 403) for non-owned products, which is correct for preventing enumeration. However, the `decision_patterns` table is cross-product with no access controls (any founder can influence pattern matching).
- **Gap:** RBAC is not enforced. No MFA requirement. No session timeout configuration. No IP allowlisting option.

### CC6.6 — System Operations / Change Management

**Status: Failing**

- **Deployment:** Fly.io Dockerfile deployment. No evidence of CI/CD pipeline, no PR review requirements, no deployment approval process, no rollback procedure documented.
- **Code changes:** No git hooks, no required code review, no automated testing in CI (only 7 unit test files, no CI configuration).
- **Database migrations:** 54 migrations exist but `src/db/migrate.ts` runs them sequentially with no rollback support. The orientation document notes "Migration failures don't stop server — can run with inconsistent schema."
- **Gap:** No change management documentation, no deployment checklist, no rollback runbook, no post-deployment verification.

### CC7.2 — Monitoring and Detection

**Status: Failing**

- **Security monitoring:** No intrusion detection, no anomaly detection, no failed login alerting, no unusual access pattern detection.
- **Audit logging:** The audit log system exists but has zero effective call sites (Lens 093). There is no real-time alerting on audit events.
- **Error monitoring:** The Sentry integration exists for the founder's product. No evidence of Sentry (or equivalent) for Foundry itself.
- **Gap:** No security information and event management (SIEM). No alerting on suspicious activity. No log aggregation service.

### CC7.3 — Incident Response

**Status: Failing**

- **Incident response plan:** None exists. No documented procedure for security incidents, data breaches, or service outages.
- **Escalation path:** No on-call rotation, no PagerDuty/OpsGenie integration, no emergency contact list.
- **Communication plan:** No status page, no customer notification template, no internal escalation chain.
- **Gap:** See Lens 095 for detailed incident framework assessment.

### CC6.7 — Data Encryption

**Status: Partial**

- **In transit:** HTTPS enforced by Fly.io + Cloudflare. TLS termination at the edge. This satisfies transit encryption.
- **At rest (database):** Turso (libSQL) does not provide transparent encryption at rest by default. The data files on Fly.io's volume are not encrypted at the filesystem level (no evidence of dm-crypt or LUKS). Database-level encryption would require Turso's enterprise features or an encryption wrapper.
- **At rest (application):** AES-256-GCM encryption module exists (`src/services/encryption.ts`) but is used in only one code path. GitHub tokens, integration credentials, and customer data are stored in plaintext.
- **Gap:** No database-level encryption. Application-layer encryption exists but is not applied to sensitive columns.

### CC6.8 — Vendor Management

**Status: Failing**

- **Third-party services:** Foundry depends on 6 external services (Anthropic, GitHub, Stripe, Clerk, Resend, Turso). None have documented vendor risk assessments, SLA monitoring, or contractual data processing agreements.
- **Data processing agreements:** No DPA with Anthropic (customer PII is sent to Claude in agent prompts — Lens 092 PII-01). No evidence of Anthropic's data handling terms being reviewed for SOC2 implications.
- **Gap:** No vendor inventory, no risk assessments, no DPA documentation, no annual vendor review process.

### CC8.1 — Privacy

**Status: Partial**

- **Consent management:** The privacy consent service (`src/services/privacy/consent.ts`) is well-designed with explicit consent recording, consent types (benchmark_contribution, aggregate_insights, product_improvement, ai_training_opt_out), and data residency settings.
- **Data export:** GDPR-style export exists (`exportProductData`).
- **Data deletion:** Scheduling exists but no execution job.
- **Privacy policy:** No `/privacy` route or privacy policy page exists.
- **Gap:** Consent preferences are not enforced in data flows. No privacy policy. Data deletion is not implemented. No data processing inventory.

## SOC2 Readiness Scorecard

| Trust Service Criteria | Score | Key Gap |
|---|---|---|
| CC6.1 Logical Access | 30% | RBAC exists but unenforced |
| CC6.2 System Communications | 70% | HTTPS + CORS + rate limiting |
| CC6.3 Change Management | 10% | No CI/CD, no review process |
| CC6.6 System Operations | 20% | No monitoring, no alerting |
| CC6.7 Encryption | 40% | Transit yes, at rest no |
| CC6.8 Vendor Management | 5% | No vendor assessments |
| CC7.1 Vulnerability Management | 10% | No scanning, no patching process |
| CC7.2 Monitoring | 15% | Audit log dead code |
| CC7.3 Incident Response | 0% | No plan exists |
| CC8.1 Privacy | 40% | Consent system exists, not enforced |
| **Overall** | **~24%** | |

## Priority Remediation Path

1. **Month 1-2:** Activate audit logging (logAudit everywhere), enforce RBAC on routes, encrypt credentials at rest, implement data deletion cron
2. **Month 3-4:** Set up CI/CD with required reviews, add security monitoring (Sentry for errors, log aggregation), write incident response plan
3. **Month 5-6:** Vendor risk assessments and DPAs, privacy policy, database encryption evaluation
4. **Month 7-9:** Penetration test, gap assessment with SOC2 auditor, evidence collection
5. **Month 10-12:** SOC2 Type I audit, remediation of findings
6. **Month 13-18:** SOC2 Type II observation period (6 months minimum)
