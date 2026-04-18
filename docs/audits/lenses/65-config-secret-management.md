# Lens 65 — Config / Secret Management

**Auditor perspective:** Environment variables — validation, rotation, missing var handling, default fallbacks, secret exposure risks, and the interaction between env vars and the runtime.

**Date:** 2026-04-16
**Codebase snapshot:** `src/env.ts` validation, 25+ env vars referenced across the codebase, Fly.io deployment

---

## Executive Summary

Foundry has a structured environment validation system (`src/env.ts`) that runs at startup, but it validates only 16 of the 25+ environment variables actually used by the codebase. Critical secrets like `ENCRYPTION_KEY`, `APNS_KEY`, `VAPID_PUBLIC_KEY`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, and `SENDGRID_API_KEY` are used in service code but not listed in the validation. The validation classifies `ANTHROPIC_API_KEY` as optional (non-required), meaning the server starts without AI capability — but 15+ cron jobs and all SCP agents will fail at runtime. The `index.ts` has a separate `REQUIRED_ENV_VARS` list that partially overlaps with `env.ts` but treats all vars as merely "optional" (logging a warning, not exiting). There is no secret rotation mechanism, no detection of stale/expired credentials, and several env vars have insecure default fallbacks (e.g., CORS origin defaults to `localhost:8080`).

---

## Findings

### CFG-01. Two Conflicting Environment Validation Systems

**Severity: P1**

`src/env.ts` defines 16 variables with `required: true/false` semantics and calls `process.exit(1)` on missing required vars. `src/index.ts:144-158` defines a separate `REQUIRED_ENV_VARS` list of 9 variables that overlap with `env.ts` but are only logged as warnings, never causing exit.

**Evidence:**
- `src/env.ts:12-33` — 16 variables, 3 required: `TURSO_DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`
- `src/index.ts:144-153` — 9 variables listed as "required": `TURSO_DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SOLO_PRICE_ID`, `STRIPE_GROWTH_PRICE_ID`, `STRIPE_INVESTOR_READY_PRICE_ID`, `ANTHROPIC_API_KEY`
- `src/index.ts:157` — `logger.warn(...)` — these 9 vars are treated as optional warnings despite the list name
- `env.ts` considers `STRIPE_SECRET_KEY` optional; `index.ts` considers it "required" but only warns
- Both run at startup — `validateEnvironment()` runs first (line 10), then the inline check (line 156)
- A developer reading `index.ts` thinks `ANTHROPIC_API_KEY` is required; reading `env.ts` shows it is optional

**Remediation:** Delete the `REQUIRED_ENV_VARS` list in `index.ts` and consolidate all validation into `env.ts`. Make `ANTHROPIC_API_KEY` and `STRIPE_SECRET_KEY` required in production (they can be optional in development). Use `process.env.NODE_ENV === 'production'` to enforce stricter requirements.

**Target phase:** P1

---

### CFG-02. 10+ Environment Variables Used but Not Validated

**Severity: P1**

The codebase references environment variables that are not listed in either `env.ts` or the `index.ts` required list:

**Evidence:**
- `src/services/encryption.ts:16` — `ENCRYPTION_KEY` — critical for encrypting GitHub tokens and integration credentials
- `src/services/notifications/push.ts:278-280` — `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- `src/services/notifications/push.ts:309-311` — `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`
- `src/services/scp/briefing/voice-reply.ts:36` — `OPENAI_API_KEY`
- `src/services/scp/briefing/audio.ts:211-212` — `ELEVENLABS_API_KEY`, `OPENAI_API_KEY`
- `src/services/scp/briefing/email-digest.ts:371` — `SENDGRID_API_KEY`
- `src/services/ai/client.ts:19` — `AI_DAILY_COST_CEILING_CENTS`
- `src/services/ai/client.ts:48` — `AI_TIMEOUT_MS`
- None of these appear in `env.ts` or the startup validation
- Missing `ENCRYPTION_KEY` means GitHub tokens cannot be encrypted/decrypted — a hard failure at runtime

**Remediation:** Add all referenced env vars to `env.ts`. For `ENCRYPTION_KEY`, make it required in production. For API keys that enable optional features, mark them as optional with descriptive warnings.

**Target phase:** P1

---

### CFG-03. CORS Origin Defaults to `localhost:8080`

**Severity: P1**

`src/index.ts:170` — `origin: process.env.APP_URL ?? 'http://localhost:8080'`. If `APP_URL` is not set in production, the CORS policy allows `http://localhost:8080` — which is incorrect and may block legitimate requests from the production domain. Conversely, if the production domain is set but a developer forgets to update it after a domain change, the old domain is allowed.

**Evidence:**
- `src/index.ts:170` — `origin: process.env.APP_URL ?? 'http://localhost:8080'`
- `APP_URL` is marked as optional in `env.ts` (line 29)
- In production, this default is wrong — it should be the production URL
- No validation that `APP_URL` is a valid URL

**Remediation:** Make `APP_URL` required in production. Validate it as a URL (starts with `https://`). Remove the localhost fallback for production; keep it only for development.

**Target phase:** P1

---

### CFG-04. `ECOSYSTEM_SERVICE_KEY` Has No Format Validation

**Severity: P2**

`src/middleware/internal.ts:16` — `const serviceKey = process.env.ECOSYSTEM_SERVICE_KEY`. The internal API endpoints are protected by this key, but there is no validation of its strength, format, or minimum length. A developer could set it to `password123` and the system would accept it.

**Evidence:**
- `src/middleware/internal.ts:16` — reads env var with no format check
- `src/env.ts:32` — listed as optional with no format validation
- No minimum length requirement
- No check for known-weak values
- Internal endpoints expose sensitive product data and health information

**Remediation:** Validate the service key is at least 32 characters and matches a cryptographic format (hex or base64). Log a warning if the key appears weak.

**Target phase:** P2

---

### CFG-05. No Secret Rotation Mechanism

**Severity: P2**

All secrets are stored as Fly.io environment variables set at deploy time. There is no mechanism to rotate secrets without downtime. The `ENCRYPTION_KEY` cannot be rotated without first decrypting all data with the old key and re-encrypting with the new key. The `TURSO_AUTH_TOKEN` cannot be rotated without a redeploy.

**Evidence:**
- All secrets are read from `process.env` once at initialization
- `src/db/client.ts:13` — `TURSO_AUTH_TOKEN` read once at client creation
- `src/services/ai/client.ts:55` — `ANTHROPIC_API_KEY` read once at client creation
- `src/services/billing/stripe.ts:14` — `STRIPE_SECRET_KEY` read once at Stripe client creation
- No "re-read env vars" mechanism
- No dual-key support for gradual rotation

**Remediation:** For database and API clients, add a `refreshCredentials()` function that re-reads env vars and recreates the client. For the encryption key, implement key versioning: store the key version with each encrypted value, support decrypting with old keys, and encrypt with the new key.

**Target phase:** P2

---

### CFG-06. `env.ts` Uses `console.error/warn` Instead of Structured Logger

**Severity: P3**

`src/env.ts:49-55` uses `console.warn` and `console.error` for validation output. The structured logger (`src/services/logger.ts`) is not available at this point because environment validation runs before any imports.

**Evidence:**
- `src/env.ts:49` — `console.warn('Optional environment variables not set:')`
- `src/env.ts:54` — `console.error('Missing required environment variables:')`
- `src/env.ts:60` — `console.log('Environment validated')`
- The logger module depends on `NODE_ENV` being set, which is an env var itself
- This is a chicken-and-egg problem: can't use logger to validate env vars that logger depends on

**Remediation:** Acceptable as-is since validation runs before logger initialization. Consider structuring the output as JSON: `console.error(JSON.stringify({ level: 'error', message: '...', missing: [...] }))` for log aggregator compatibility.

**Target phase:** P3

---

### CFG-07. Stripe Price IDs Are Optional — Checkout Fails Silently

**Severity: P1**

`src/services/billing/stripe.ts:108-110` — price IDs are read from env vars at checkout time. If any are missing, the `createCheckoutSession` function returns a null price ID, which causes the Stripe API call to fail with an unhelpful error.

**Evidence:**
- `src/services/billing/stripe.ts:108` — `case 'solo': priceId = process.env.STRIPE_SOLO_PRICE_ID; break;`
- If `STRIPE_SOLO_PRICE_ID` is not set, `priceId` is undefined
- The Stripe SDK throws with "price is required" — not a helpful error for the founder
- `env.ts` marks all Stripe price IDs as optional
- `index.ts` lists them as "required" but only warns

**Remediation:** Make Stripe price IDs required in production (fatal on startup if missing). Add a runtime check before calling Stripe: if the price ID is missing for the requested tier, return a clear error: "Billing is not configured for this tier."

**Target phase:** P1

---

## Embarrassment Test

1. **"Two conflicting environment validation systems disagree on which variables are required — `env.ts` says ANTHROPIC_API_KEY is optional, `index.ts` calls it required but only logs a warning"** — Contradictory validation that confuses developers.

2. **"The ENCRYPTION_KEY used to encrypt GitHub tokens and integration credentials is not listed in any validation — if missing, the server starts fine but crashes at runtime when trying to encrypt/decrypt"** — The most security-critical secret has no startup validation.

3. **"CORS origin defaults to `http://localhost:8080` in production if APP_URL is not set — this is wrong and was likely never tested in a misconfigured production deployment"** — Insecure default that is invisible until a production incident.

## Pride Test

1. The `env.ts` validation system correctly distinguishes between required (app won't function) and optional (features degraded) variables, with clear descriptions for each.

2. The `validateEnvironment()` function runs before any other imports, ensuring that missing required vars cause an immediate exit rather than a delayed runtime crash.

3. The `ENCRYPTION_KEY` validation in `encryption.ts` correctly validates both the key length (64 hex chars = 32 bytes) and format (hex characters only), providing a clear error message with generation instructions.

## Distinct-Value Declaration

This lens examines the configuration lifecycle: from validation at startup, through runtime usage, to rotation and expiration. Tier 1 lenses note "no retry on external calls" and "env vars missing" but do not trace the specific disconnects between two validation systems, catalog all unvalidated env vars, or analyze the secret rotation implications for `ENCRYPTION_KEY`. The interaction between env var presence and feature availability is a configuration-management concern unique to this specialty.

## Tenancy-Critical Flag

**CFG-02** is tenancy-critical: missing `ENCRYPTION_KEY` means GitHub tokens for ALL tenants cannot be decrypted, causing all audit/remediation features to fail. **CFG-03** is tenancy-critical: wrong CORS origin blocks all API requests from the production frontend for all tenants.
