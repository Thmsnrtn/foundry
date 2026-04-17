# Lens 31 — Legal / Compliance Audit

**Auditor perspective:** GDPR compliance, data retention, privacy policy, terms of service, data export/deletion, cookie consent, third-party data processing, lawful handling of personal data.

**Date:** 2026-04-16
**Codebase snapshot:** Foundry main branch

---

## Executive Summary

Foundry collects and processes extensive personal and business data (founder PII, GitHub access tokens, financial metrics, customer data, voice transcripts, device tokens, IP addresses) across six third-party processors (Anthropic, Clerk, Stripe, Turso, Resend, GitHub). Despite having a Privacy & Data settings page with consent toggles and a data export feature, the product has **critical GDPR violations**: no published privacy policy, no terms of service, no cookie consent mechanism, cross-company data sharing without consent, incomplete data deletion, and credentials stored in plaintext despite schema comments claiming encryption.

---

## Findings

### P0 — Critical (GDPR Violation / Immediate Legal Risk)

#### P0-01: No Privacy Policy or Terms of Service Exist

**Files:** All public routes in `src/routes/public/landing.ts`; layout in `src/views/layout.ts`

No `/privacy-policy`, `/terms`, `/legal`, or equivalent route exists anywhere in the codebase. The public layout has no footer with legal links. The landing page, pricing page, and signup flow contain zero references to legal documents.

Under GDPR Article 13/14, data controllers must provide detailed information about data processing *before* collecting personal data. Under ePrivacy and most national laws, terms of service must be presented and accepted before account creation.

**Impact:** Every single user account was created without informed consent. No lawful basis for processing has been communicated. This is a fundamental Article 13 violation that exposes Foundry to regulatory enforcement.

**Evidence:**
- `grep` for `/terms`, `/privacy-policy`, `/legal`, `/tos` across all route files: zero matches
- `src/views/layout.ts` `publicLayout()` function: no footer, no legal links
- `src/routes/auth/clerk.ts` signup page: no "I agree to terms" checkbox, no link to any legal document

---

#### P0-02: No Consent Collected at Signup for Core Data Processing

**Files:** `src/routes/auth/clerk.ts` (lines 12-52), `src/middleware/auth.ts` (lines 82-96)

Users sign up via Clerk's embedded widget with zero consent checkboxes or legal acknowledgments. The auto-provisioning path (lines 82-96 of auth middleware) creates founder records without any consent interaction whatsoever.

GDPR Article 6 requires a lawful basis for processing. For a SaaS product that sends business data to AI models (Anthropic), integrates with GitHub repos, processes financial metrics, and shares anonymized data cross-company, "legitimate interest" alone is insufficient -- explicit consent or contractual necessity must be established.

**Impact:** No lawful basis for any processing has been obtained from any user.

---

#### P0-03: Cross-Company Decision Patterns Written Without Consent

**Files:** `src/services/decisions/patterns.ts`, `src/jobs/index.ts` (lines 286-298), `src/db/schema.sql` (lines 265-287)

The `decision_patterns` table is explicitly documented as "intentionally NOT scoped by founder or product" and "intentionally cross-product." The `scenarioAccuracy` cron job (weekly, Friday) calls `generatePatternFromOutcome()` for every decision with an outcome -- with **no consent check whatsoever**.

Compare with `contributeToNetwork()` in `src/services/network/benchmarks.ts` (line 149), which correctly checks `network_opt_in` before contributing. The decision patterns path has no equivalent gate.

The privacy consent toggles (`benchmark_contribution`, `aggregate_insights`) exist in the UI but the `hasConsent()` function (defined at `src/services/privacy/consent.ts` line 56) is **never imported or called** anywhere outside its own file. Consent is recorded but never enforced.

**Impact:** Every founder's decision outcomes are silently fed into a cross-company pool regardless of their consent preferences. This is a GDPR Article 6(1)(a) violation (processing without consent) and potentially Article 22 (automated decision-making affecting individuals).

**Evidence:**
- `hasConsent` is exported but grep finds zero imports outside `consent.ts`
- `generatePatternFromOutcome` has no consent parameter and performs no consent check
- The `scenarioAccuracy` job queries all decisions globally with no founder/consent filtering

---

#### P0-04: Data Deletion Is Theatrical -- No Actual Deletion Occurs

**Files:** `src/services/privacy/consent.ts` (lines 285-303), `src/jobs/index.ts` (full JOB_REGISTRY at line 1794+)

The "Delete My Data" button on the privacy page calls `scheduleDataDeletion()`, which inserts a row into `agent_audit_log` with event type `data_deletion_scheduled`. That is all it does -- it logs the *intent* to delete.

There is **no cron job, background worker, or any code path** that reads `data_deletion_scheduled` events and actually performs deletion. The JOB_REGISTRY (55 jobs) contains no deletion job. Searching the entire codebase for `data_deletion` yields only the scheduling function and the route that calls it.

Under GDPR Article 17 (Right to Erasure), data subjects have the right to have their personal data erased "without undue delay." The current implementation promises deletion after 30 days but never delivers it.

**Impact:** Founders who request deletion have their data retained indefinitely. This is a direct Article 17 violation.

**Evidence:**
- `scheduleDataDeletion()` only inserts an audit log entry
- `grep -r "data_deletion" src/jobs/` returns zero matches
- No cron job in JOB_REGISTRY references deletion, purge, or cleanup of product data

---

#### P0-05: Credentials Stored in Plaintext Despite Schema Claims

**Files:** `src/db/schema.sql` (line 32), `src/db/migrations/008_integrations.sql` (line 9), `src/db/migrations/021_integration_fabric.sql` (lines 8-9)

Schema comments state `github_access_token TEXT, -- Encrypted` and `credentials_json is encrypted at rest in production`. However, there is **no encryption code** anywhere in the codebase. Searching for `encrypt`, `decrypt`, `cipher`, `aes`, `crypto` (excluding HMAC signature verification) finds zero encryption/decryption functions for stored credentials.

GitHub OAuth tokens, integration API keys, refresh tokens, Slack bot tokens, and webhook secrets are stored as plaintext in the database.

**Impact:** A database breach exposes all connected GitHub repositories, Stripe accounts, PostHog instances, Intercom accounts, Linear projects, Slack workspaces, and other integrated services for every Foundry customer. Under GDPR Article 32, appropriate technical measures must be implemented to ensure data security.

---

### P1 — High (Significant Compliance Gap)

#### P1-01: No Cookie Consent Banner or Mechanism

**Files:** `src/views/layout.ts`, `src/middleware/auth.ts`

Foundry uses the `__session` cookie set by Clerk for authentication. The HTMX library and Clerk JS SDK are loaded on every page. No cookie consent banner, cookie policy, or consent mechanism exists anywhere in the codebase.

Under the ePrivacy Directive (and GDPR where cookies constitute personal data processing), non-essential cookies require informed consent before being set. While strictly-necessary authentication cookies may be exempt, the absence of any cookie disclosure or policy is itself a compliance failure.

---

#### P1-02: Data Export Is Incomplete

**Files:** `src/services/privacy/consent.ts` (lines 232-277)

The `exportProductData()` function exports 5 data categories: metrics, briefings, decisions, customers, and agent_config. The database contains 56+ tables including:

- `voice_sessions` (voice transcripts, STT data)
- `conversation_threads` / `conversation_messages` (AI chat history)
- `founder_journal_entries` (personal wellbeing journal)
- `push_subscriptions` (device tokens)
- `agent_sessions` / `agent_audit_log` (all AI agent activity)
- `privacy_consents` (consent records themselves)
- `beta_intake` (participant names, interview summaries, quotes)
- `integrations` (which services are connected, credentials)
- `remediation_prs` (GitHub PRs created on user's behalf)
- `founding_story_artifacts` (published case studies)
- `competitive_signals`, `competitors` (business intelligence)
- `stressor_history`, `lifecycle_conditions` (business state data)
- `cohorts` (customer cohort data)
- `founder_judgment_patterns` (behavioral analysis)
- `ethical_assessment` (AI ethics evaluation data)

Under GDPR Article 20 (Right to Data Portability), the data subject has the right to receive personal data in a structured, commonly used format. The current export covers roughly 10% of stored data.

---

#### P1-03: No Data Processing Agreements (DPAs) Referenced or Linked

**Files:** `src/env.ts` (third-party service configuration)

Foundry transmits personal data to six third-party processors:

| Processor | Data Sent | DPA Required | DPA Referenced |
|-----------|-----------|--------------|----------------|
| **Anthropic** (Claude API) | Founder business data, metrics, GitHub code, competitive intel, customer data, decision history -- all sent in AI prompts | Yes | No |
| **Clerk** | Email, name, auth sessions, IP address | Yes | No |
| **Stripe** | Email, name, payment method, billing history | Yes | No |
| **Turso** | All data (database host) | Yes | No |
| **Resend** | Email addresses, digest content | Yes | No |
| **GitHub** | OAuth tokens, repo access, code analysis | Yes | No |

Under GDPR Article 28, data controllers must have DPAs with all processors. None are referenced, linked, or mentioned anywhere in the codebase, documentation, or UI.

Of particular concern: **Anthropic receives the most sensitive data** -- business metrics, customer information, competitive intelligence, founder journal entries, and GitHub code -- through AI prompts. The AI training opt-out toggle exists in the privacy settings but is never checked before AI calls (`src/services/ai/client.ts` has no consent verification).

---

#### P1-04: IP Addresses Collected Without Disclosure

**Files:** `src/routes/dashboard/privacy.ts` (line 339), `src/services/audit/log.ts` (line 20), `src/middleware/rate-limit.ts` (line 33), `src/db/migrations/025_audit_log.sql` (line 20)

IP addresses are collected in at least three contexts:
1. Consent records (`privacy_consents.ip_address`)
2. Audit log entries (`agent_audit_log.ip_address`)
3. Rate limiting (`x-forwarded-for` / `cf-connecting-ip`)

No privacy notice discloses this collection. IP addresses are personal data under GDPR.

---

#### P1-05: Wisdom Network Default Opt-In

**Files:** `src/db/migrations/018_wisdom_network.sql` (line 7), `src/services/privacy/consent.ts` (lines 99-126)

Migration 018 sets `wisdom_network_opted_in INTEGER DEFAULT 0` (opt-out by default) -- this is correct. However, the privacy consent service `getOrInitConsents()` returns **opt-in defaults** for `benchmark_contribution`, `aggregate_insights`, and `product_improvement` when no consent records exist (lines 106-110).

This means: before a founder ever visits the Privacy page, the system treats them as having consented to data sharing. Under GDPR, consent must be freely given, specific, informed, and unambiguous -- silence or pre-ticked boxes do not constitute consent (Recital 32).

---

#### P1-06: AI Training Opt-Out Is Not Enforced

**Files:** `src/services/privacy/consent.ts` (line 13: `ai_training_opt_out` type), `src/services/ai/client.ts`

The privacy page presents an "Opt Out of AI Training" toggle with the text: "By default, Foundry does not use your data for AI training. This toggle is a formal, auditable record of your preference."

However:
1. The `callClaude()` / `callOpus()` / `callSonnet()` functions in `src/services/ai/client.ts` send no metadata about training opt-out preferences
2. No `hasConsent('ai_training_opt_out')` check exists before any AI API call
3. Whether Anthropic uses API data for training depends on their API terms, not a toggle in Foundry's UI
4. The toggle's representation may be misleading if Anthropic's terms permit training on API data

---

#### P1-07: Founder Account Deletion Incomplete Across Processors

**Files:** `src/routes/auth/clerk.ts` (lines 144-157)

The Clerk `user.deleted` webhook handler deletes products and the founder row from the local database. However:
1. No call is made to delete the Stripe customer record
2. No call is made to revoke GitHub OAuth tokens
3. No call is made to delete data from Resend
4. Decision patterns already written to `decision_patterns` (cross-company table) are not removed
5. Benchmark contributions are not removed
6. `cross_product_insights` derived from the founder's data persist

This means deletion from the local DB does not constitute full erasure across all processors where personal data was sent.

---

### P2 — Medium (Compliance Improvement Needed)

#### P2-01: Data Residency Settings Are Decorative

**File:** `src/routes/dashboard/privacy.ts` (line 219)

The UI itself acknowledges this: "Data residency enforcement coming soon." The preferred region setting is stored but has no effect -- all data is stored in a single Turso database (likely US-based given Fly.io deployment). EU users selecting "EU West (Ireland)" receive no actual data residency guarantee.

This could constitute a misleading practice under GDPR Article 5(1)(a) (transparency principle) if users rely on the setting for compliance purposes.

---

#### P2-02: Data Retention Settings Not Enforced

**Files:** `src/services/privacy/consent.ts` (data residency settings), `src/jobs/index.ts` (JOB_REGISTRY)

The privacy page allows setting data retention periods (1, 2, 5 years, or forever) and agent log retention (30, 90, or 365 days). No cron job or background process exists to enforce these retention limits. Data accumulates indefinitely regardless of the configured retention period.

---

#### P2-03: Share Links Expose Business Data Without Access Controls

**Files:** `src/routes/share/index.ts`, `src/routes/dashboard/settings.ts` (lines 260-270)

The investor share link exposes Signal score, MRR, retention metrics, and recent decisions via a URL token with no:
- Expiration date
- Access logging
- IP restriction
- Rate limiting
- Revocation notification

Anyone with the URL has perpetual read access to sensitive business metrics. The token is a 48-character hex string with no TTL.

---

#### P2-04: No Audit Trail for Third-Party Data Transfers

No logging exists for when data is sent to Anthropic (AI calls), Resend (emails), or GitHub (PR creation). GDPR Article 30 requires records of processing activities, including transfers to third parties.

---

#### P2-05: Voice Transcripts and Founder Journal Entries Stored Without Special Protections

**Files:** `src/db/migrations/013_voice_push.sql`, `src/db/migrations/036_founder_wellbeing.sql`

Voice transcripts (`voice_sessions.transcript`) and founder journal entries (`founder_journal_entries`) contain potentially sensitive personal information. These are:
- Not encrypted at rest (beyond Turso's default)
- Not included in the data export
- Not subject to separate consent
- Potentially sent to Anthropic for AI processing

---

#### P2-06: Push Notification Device Tokens and APNS Data

**Files:** `src/db/migrations/013_voice_push.sql` (push_subscriptions table)

Device tokens (APNS tokens) are personal data under GDPR. They are stored without disclosure, not included in data export, and not deleted when a founder requests deletion.

---

### P3 — Low (Best Practice Gap)

#### P3-01: `decision_patterns` Anonymization Claim Is Untested

The schema comment says "No founder-identifiable or product-identifiable data exists here." The table stores `decision_type`, `product_lifecycle_stage`, `risk_state_at_decision`, `key_metrics_context` (JSON), `option_chosen_category`, `market_category`, and `contributing_factors` (JSON).

With a small user base (founding cohort of 30), the combination of `market_category` + `product_lifecycle_stage` + `key_metrics_context` ranges could potentially re-identify a product. No formal k-anonymity, l-diversity, or differential privacy analysis has been performed.

---

#### P3-02: No Data Protection Impact Assessment (DPIA)

GDPR Article 35 requires a DPIA for processing that is "likely to result in a high risk to the rights and freedoms of natural persons." Foundry's AI-powered autonomous business analysis, cross-company data aggregation, and automated decision-making clearly meet this threshold. No DPIA exists.

---

#### P3-03: No Data Protection Officer (DPO) Designation

For a product processing business data at this scale with automated profiling and cross-company data sharing, a DPO designation (GDPR Article 37) should at minimum be evaluated.

---

## Personal Data Inventory

| Data Category | Collection Point | Storage | Shared With | Consent Obtained |
|---|---|---|---|---|
| Email, name | Clerk signup | `founders` table | Clerk, Stripe, Resend | No |
| GitHub OAuth token | Onboarding | `products.github_access_token` (plaintext) | GitHub API | No |
| GitHub source code | Audit pipeline | Sent to Anthropic for analysis | Anthropic | No |
| Business metrics (MRR, churn, NPS) | Manual entry / Stripe integration | `metric_snapshots` | Anthropic (via AI prompts), cross-company pool | No |
| Customer data | Integration sync | `customers` table | Anthropic (via agent prompts) | No |
| IP addresses | HTTP headers | `privacy_consents`, `agent_audit_log` | None | No |
| Voice transcripts | Mobile app | `voice_sessions` | Anthropic | No |
| Journal entries | Dashboard | `founder_journal_entries` | Anthropic | No |
| Device tokens (APNS) | Mobile app | `push_subscriptions` | Apple (APNS) | No |
| Decision outcomes | Autonomous | `decision_patterns` (cross-company) | All founders (anonymized) | No |
| Payment data | Stripe Checkout | Stripe-hosted | Stripe | Via Stripe's own flow |
| Integration credentials | Dashboard setup | `integrations.credentials_json` (plaintext) | Target service | No |

---

## Recommendations (Priority Order)

1. **Publish a Privacy Policy and Terms of Service immediately.** These are legal prerequisites to operating. Link them from signup, landing page footer, and dashboard.
2. **Add a consent checkbox to signup** requiring acceptance of terms and privacy policy before account creation.
3. **Implement actual data deletion.** Create a cron job that processes `data_deletion_scheduled` events, deletes all product and founder data across local DB and third-party processors (Clerk, Stripe), and confirms completion.
4. **Gate `generatePatternFromOutcome()` on consent.** Check `benchmark_contribution` consent before writing to `decision_patterns`. Backfill: delete existing patterns for non-consenting founders.
5. **Implement credential encryption.** Use envelope encryption (e.g., `FOUNDRY_ENCRYPTION_KEY` env var with AES-256-GCM) for `github_access_token`, `credentials_json`, and `bot_token` columns.
6. **Enforce consent defaults as opt-out.** Change `getOrInitConsents()` to return `false` for all sharing consents when no records exist.
7. **Enforce AI training opt-out.** Pass metadata to Anthropic API calls or use their training opt-out mechanisms; verify Anthropic's API terms regarding training on API data.
8. **Complete the data export** to include all 56+ tables with personal data.
9. **Execute DPAs with all six processors** (Anthropic, Clerk, Stripe, Turso, Resend, GitHub).
10. **Add cookie consent** mechanism for non-essential cookies/scripts.
11. **Implement data retention enforcement** via a daily cron job that respects the configured retention periods.
12. **Add third-party transfer logging** for GDPR Article 30 compliance.
13. **Conduct a DPIA** given the automated profiling and cross-company data sharing.

---

## File Reference

| File | Relevance |
|------|-----------|
| `src/routes/dashboard/privacy.ts` | Privacy settings page (consent toggles, export, deletion) |
| `src/services/privacy/consent.ts` | Consent service (recording, querying, export, deletion scheduling) |
| `src/db/migrations/041_privacy_consent.sql` | Consent and data residency schema |
| `src/services/decisions/patterns.ts` | Cross-company decision patterns (no consent check) |
| `src/jobs/index.ts` | 55 cron jobs (no deletion job, scenario_accuracy bypasses consent) |
| `src/services/wisdom/network.ts` | Wisdom network aggregation (checks opt-in correctly) |
| `src/services/network/benchmarks.ts` | Benchmark contribution (checks opt-in correctly) |
| `src/routes/auth/clerk.ts` | Signup/login (no consent), webhook deletion handler (incomplete) |
| `src/middleware/auth.ts` | Auto-provisioning (no consent) |
| `src/services/ai/client.ts` | AI calls to Anthropic (no consent/opt-out enforcement) |
| `src/db/schema.sql` | Core schema (plaintext credentials, cross-company table) |
| `src/views/layout.ts` | Layout (no footer, no legal links, no cookie banner) |
| `src/routes/dashboard/settings.ts` | Wisdom network toggle, share links |
