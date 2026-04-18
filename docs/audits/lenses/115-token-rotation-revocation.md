# Lens 115 — Token Rotation / Revocation

**Auditor Persona:** Security Depth (Tier 3)
**Date:** 2026-04-16
**Scope:** GitHub tokens, API keys, share tokens, portfolio keys — rotation, revocation, expiry

---

## Executive Summary

Foundry stores and manages multiple types of tokens: GitHub access tokens, product share tokens, metric ingest tokens, portfolio API keys (`pfk_*`), and integration credentials. None of these tokens have automatic expiry, rotation mechanisms, or revocation audit trails. GitHub tokens are now encrypted at rest (AES-256-GCM via `src/services/encryption.ts`), which is an improvement, but a compromised token remains valid indefinitely because there is no expiry or rotation schedule. Share tokens and ingest tokens are randomly generated but permanent — there is no way to invalidate them without manual database intervention.

---

## Findings

### TOK-01 — GitHub access tokens never expire or rotate (Severity: High)

**Description:** GitHub OAuth tokens are stored in the `products.github_access_token` column after OAuth flow. They are now encrypted at rest, but never rotated. A compromised token grants read access to the founder's repository indefinitely.

**Evidence:**
- `src/db/schema.sql:29`: `github_access_token TEXT, -- Encrypted`.
- `src/routes/dashboard/onboarding.ts:22`: Uses `encrypt()` and `decrypt()` from `src/services/encryption.ts`.
- No token refresh or rotation logic anywhere in the codebase.
- GitHub fine-grained tokens can have expiry, but the application does not check or handle token expiry errors.

**Remediation:** Implement token refresh using GitHub's OAuth token refresh flow. Add an `expires_at` column. Check expiry before use and refresh proactively. Log token rotation events.

---

### TOK-02 — Share tokens are permanent with no revocation mechanism (Severity: Medium)

**Description:** Product share tokens (for investor/advisor read-only access) are generated once and never expire. The only way to invalidate a share token is to generate a new one, which overwrites the old one in the database. There is no revocation log or notification.

**Evidence:**
- `src/routes/dashboard/settings.ts:268`: `UPDATE products SET share_token = ? WHERE id = ? AND owner_id = ?` — overwrites the existing token.
- `src/db/migrations/005_signal_history.sql:22`: `ALTER TABLE products ADD COLUMN share_token TEXT` — no `expires_at` column.
- No revocation audit trail.

**Remediation:** Add `share_token_expires_at` column. Default to 30-day expiry. Show expiry date in settings. Add a "Revoke" button that nulls the token and logs the revocation.

---

### TOK-03 — Portfolio API keys (pfk_*) never expire (Severity: Medium)

**Description:** Portfolio API keys are generated as `pfk_${nanoid(32)}` and stored in the `portfolios.api_key` column. There is no expiry, rotation, or revocation mechanism. A leaked portfolio key grants persistent access to all portfolio data.

**Evidence:**
- `src/services/portfolio/manager.ts:29`: `const apiKey = \`pfk_${nanoid(32)}\`` — generated once, stored permanently.
- `src/services/portfolio/manager.ts:237`: `SELECT id FROM portfolios WHERE api_key = ?` — validation by direct comparison.
- No `created_at`, `expires_at`, or `revoked_at` columns on the API key.

**Remediation:** Add a separate `api_keys` table with `created_at`, `expires_at`, `last_used_at`, `revoked_at` columns. Hash the key (store `sha256(key)`, compare hashes) to prevent plaintext key leaks from database dumps.

---

### TOK-04 — Ingest tokens have no rotation UI (Severity: Low)

**Description:** Metric ingest tokens allow external services to push metric data. They are generated and stored in the products table. The settings page displays them but there is no "Regenerate" button visible in the route code examined.

**Evidence:**
- `src/routes/dashboard/settings.ts:49`: Query selects `ingest_token` for display.
- No POST endpoint for regenerating ingest tokens found in the settings route.

**Remediation:** Add a "Regenerate" button for ingest tokens with a confirmation dialog (since regeneration invalidates all configured integrations).

---

### TOK-05 — Integration credentials stored without expiry tracking (Severity: Medium)

**Description:** Integration credentials (Stripe API keys, Linear API keys, PostHog keys, Intercom tokens) stored in `credentials_json` or `config_json` columns have no expiry tracking. Stale or compromised credentials remain active.

**Evidence:**
- `src/services/integration/fabric.ts:119`: `credentials_json?: string` — opaque JSON blob.
- `src/services/integrations/sync.ts:75`: `credentials = JSON.parse(integration.credentials_json)` — no expiry check.
- No health check for credential validity across integrations.

**Remediation:** Add `credentials_expires_at` column to integrations table. Implement a periodic job that tests credential validity and alerts founders to expired credentials.

---

## Embarrassment Test

A founder's GitHub token is compromised (laptop stolen, credentials leaked). The token has no expiry, so the attacker reads the founder's repository code indefinitely. The founder changes their GitHub password, but Foundry's stored OAuth token may still work (depends on GitHub's token invalidation behavior). The founder has no "Revoke GitHub access" button in Foundry. **Likelihood: Medium. This is a standard credential lifecycle gap.**

## Pride Test

The encryption at rest for GitHub tokens (AES-256-GCM) is properly implemented with strong cryptographic primitives. The `isEncrypted()` check allows backward-compatible migration from plaintext to encrypted storage.

## Distinct-Value Declaration

This lens provides a complete inventory of all token types in the system (5 categories) and maps each one's rotation, revocation, and expiry gaps. The key finding is that none of the 5 token types have any lifecycle management.

## Tenancy-Critical Flag

**No.** Token compromise affects a single founder's data. Cross-tenant access requires a different founder's token, which is independently generated and scoped.
