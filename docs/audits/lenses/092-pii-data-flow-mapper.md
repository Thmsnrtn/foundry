# Lens 092 — PII Data Flow Mapper

**Distinct value:** Traces every piece of personally identifiable information through the system: where it enters, where it is stored, where it flows between services, where it is included in AI prompts, and where it exits (emails, exports, APIs). Maps the PII surface area for privacy compliance.

**Tenancy-critical:** Yes. PII from one founder's customers (names, emails, MRR) is stored in the same database as other founders' customer data. The `decision_patterns` table is explicitly cross-product and "anonymized" but the anonymization is not verified. Customer data from company A could leak into company B's agent prompts via the pattern context.

## Executive Summary

Foundry collects and processes 7 categories of PII: (1) founder identity (email, name, Clerk ID), (2) founder payment (Stripe customer ID), (3) GitHub credentials (OAuth access tokens), (4) customer identity (from founder's product: names, emails, external IDs), (5) customer financial data (MRR per customer), (6) integration credentials (API keys for PostHog, Slack, Resend, etc.), and (7) behavioral data (onboarding chat transcripts, decision history). The most concerning data flows are: GitHub tokens stored with encryption but only in one code path, customer PII flowing into agent prompts without anonymization, and the `decision_patterns` table containing cross-product data with no verified anonymization. The privacy consent system exists and is well-designed, but the actual data flows do not enforce the consent preferences.

## Findings

### PII-01 Customer PII Flows Directly Into Agent Prompts
- **Severity:** P0
- **Description:** The Harbor agent (customer success) loads at-risk customers including their names, emails, and health scores, and injects this data into the Claude prompt. The `sanitizeForPrompt()` function strips injection patterns but does not redact PII. This means customer names and emails are sent to Anthropic's API as part of the prompt. Similarly, integration events from Stripe (containing customer email, payment amount, plan) and Intercom (containing customer name, conversation text) flow into agent prompts via the integration event summary mechanism.
- **Evidence:** `src/services/scp/agents/harbor.ts:100-160` — loads customer rows with names and emails, formats them into the user prompt. `src/services/scp/agents/base.ts:606-612` — `_summariseEvent()` includes `customer_email` from integration event data in the prompt. `src/services/ai/sanitize.ts` — sanitizes for injection, not for PII.
- **Remediation:** Implement PII redaction before prompt injection. Replace email addresses with hashed identifiers (e.g., `customer_abc123`), replace names with anonymized labels (`Customer A`, `Customer B`). The agent's output should use the same anonymized labels, which are de-anonymized only in the founder-facing UI. Anthropic's API should never see raw customer PII.

### PII-02 GitHub Access Tokens Encryption Is Inconsistently Applied
- **Severity:** P1
- **Description:** The encryption module (`src/services/encryption.ts`) implements AES-256-GCM encryption with a proper key derivation from `ENCRYPTION_KEY` env var. The `isEncrypted()` helper detects whether a value is already encrypted. However, encryption is only used in one code path: the dashboard onboarding route (`src/routes/dashboard/onboarding.ts:22`) imports encrypt/decrypt. The GitHub token storage in the schema (`products.github_access_token TEXT -- Encrypted`) is a comment, not an enforcement. If the token is stored without going through the onboarding route's encrypt call, it is stored in plaintext.
- **Evidence:** `src/db/schema.sql:32` — `github_access_token TEXT, -- Encrypted` (comment only). `src/routes/dashboard/onboarding.ts:22` — imports encrypt/decrypt. Grep for `import.*encrypt` only returns this one file. Any other code path that writes `github_access_token` directly (e.g., a migration, a seed, or a different route) would store plaintext.
- **Remediation:** Move encryption to the data access layer. Create `setGitHubToken(productId, token)` and `getGitHubToken(productId)` functions that always encrypt/decrypt. Replace all direct column access with these functions. Add a migration check that verifies all existing tokens are encrypted.

### PII-03 Integration Credentials Stored With No Verified Encryption
- **Severity:** P1
- **Description:** The integrations table (`src/db/migrations/008_integrations.sql`) has `credentials_json` with a comment "encrypted at rest in production." The fabric integration module (`src/db/migrations/021_integration_fabric.sql`) has a similar comment: "Credentials stored as JSON, encrypted at app layer." However, there is no evidence that the encryption module is used when writing integration credentials. The `credentials_json` column likely contains raw API keys for PostHog, Slack, Sentry, Linear, and Intercom.
- **Evidence:** `src/db/migrations/008_integrations.sql:9` — "credentials_json is encrypted at rest in production" (comment). `src/db/migrations/021_integration_fabric.sql:8` — "Credentials stored as JSON, encrypted at app layer" (comment). No import of encrypt/decrypt in any integration service file.
- **Remediation:** Apply the same pattern as PII-02: create `setCredentials()` and `getCredentials()` accessor functions that encrypt/decrypt the JSON blob. Audit all existing credentials in the database. If any are plaintext, encrypt them in a migration.

### PII-04 Decision Patterns Table Is Cross-Product With No Verified Anonymization
- **Severity:** P1
- **Description:** The `decision_patterns` table (`src/db/schema.sql:268`) is explicitly described as "intentionally cross-product and anonymized" in the schema comment. However, the `generatePatternFromOutcome()` function (`src/services/decisions/patterns.ts:24`) inserts records with `key_metrics_context` which is a text field derived from the product's actual metrics. There is no anonymization step — the function stores whatever context was provided. If the context contains product names, revenue figures, or other identifying information, it is available to any founder via the wisdom network pattern matching.
- **Evidence:** `src/db/schema.sql:4` — "decision_patterns is intentionally cross-product and anonymized." `src/services/decisions/patterns.ts:24` — INSERT into decision_patterns with no anonymization of `key_metrics_context`. `src/services/wisdom/network.ts:50` — reads from decision_patterns for cross-product insights.
- **Remediation:** Implement actual anonymization in `generatePatternFromOutcome()`: replace specific revenue numbers with ranges (e.g., "$1K-5K MRR"), replace product names with generic labels, remove any customer-specific identifiers. Add a CHECK constraint or validation that the `key_metrics_context` does not contain email addresses or product names.

### PII-05 Data Export Includes Raw Customer Records
- **Severity:** P2
- **Description:** The GDPR-style data export (`src/services/privacy/consent.ts:232-277`) exports raw customer records including `segment`, `acquisition_channel`, `mrr_cents`, and `status`. If the `anonymize_customer_data` residency setting is true, it should redact customer-level PII from the export. The export function does not check this setting.
- **Evidence:** `src/services/privacy/consent.ts:258-262` — customer query exports raw rows. Does not check `getDataResidencySettings()` for `anonymize_customer_data`.
- **Remediation:** Before exporting, check the `anonymize_customer_data` setting. If true, redact customer names, emails, and external IDs from the export. Keep aggregate data (counts, revenue totals) but remove individually identifiable records.

### PII-06 Onboarding Chat Transcripts Stored Indefinitely
- **Severity:** P2
- **Description:** The onboarding chat stores the full conversation transcript in `onboarding_sessions.messages_json`. This includes whatever the founder typed — potentially including business plans, financial details, or other sensitive information they share in a conversational context. There is no retention policy, no auto-deletion after a period, and no ability for the founder to delete their chat history.
- **Evidence:** `src/services/scp/onboarding/chat.ts:162` — `messages_json` stored as full conversation. No retention or deletion mechanism. `src/services/privacy/consent.ts:23-25` — `data_retention_days` setting exists but no cron job enforces it.
- **Remediation:** Implement the data retention cron job that enforces `delete_agent_logs_after_days` and `data_retention_days`. Include onboarding_sessions in the deletion scope. Allow founders to delete their chat history via a privacy settings action.

## PII Flow Map

```
ENTRY POINTS:
  Clerk signup     -> founders.email, founders.name, founders.clerk_user_id
  Stripe checkout  -> founders.stripe_customer_id
  GitHub OAuth     -> products.github_access_token [should be encrypted]
  Integration setup -> integrations.credentials_json [should be encrypted]
  Onboarding chat  -> onboarding_sessions.messages_json [plain text]
  Metric ingestion -> metric_snapshots (aggregate, no PII)
  Customer import  -> customers.email, customers.account_name, customers.external_customer_id

STORAGE:
  founders table   -> email, name, clerk_user_id, stripe_customer_id
  products table   -> github_access_token, github_owner, github_repo
  customers table  -> email, account_name, external_customer_id, mrr_cents
  integrations     -> credentials_json (API keys)
  onboarding_sessions -> messages_json (conversation)
  agent_sessions   -> observations, actions_taken (may contain customer references)
  decision_patterns -> key_metrics_context (cross-product, should be anonymized)

FLOWS TO EXTERNAL SERVICES:
  -> Anthropic API: customer names, emails in agent prompts (PII-01)
  -> Resend API:    founder email as recipient
  -> GitHub API:    access token as auth, repo content as context
  -> Stripe API:    customer ID for billing operations
  -> PostHog API:   API key for data pull (no PII sent)

EXIT POINTS:
  -> Email digests:  sent to founder email
  -> Data export:    includes raw customer records (PII-05)
  -> Public share links: audit scores (no PII)
  -> Portfolio API:  investor-facing metrics (no customer PII)
```
