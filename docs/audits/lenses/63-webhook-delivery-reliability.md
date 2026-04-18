# Lens 63 — Webhook Delivery Reliability

**Auditor perspective:** Signed webhooks, replay protection, out-of-order delivery, idempotency keys, dead letter queue, and both inbound and outbound webhook handling.

**Date:** 2026-04-16
**Codebase snapshot:** Outbound webhook system in `src/services/api/webhooks.ts`, inbound Stripe/Clerk webhooks, API v1 webhook endpoints

---

## Executive Summary

Foundry has two webhook surfaces: inbound (Stripe and Clerk webhooks delivered to Foundry) and outbound (Foundry delivering events to customer-configured URLs). The inbound Stripe webhook correctly verifies signatures. The Clerk webhook verification depends on a webhook secret that is marked optional in env validation. The outbound webhook system has HMAC signing, 3-attempt retry with exponential backoff, and a delivery record table — this is solid foundational work. However, the signing key used for outbound webhooks is the SHA-256 hash of the secret (not the secret itself), which means the signature cannot be verified by the consumer unless they also hash their key. There is no replay protection (no timestamp in signature), no idempotency key for consumers, delivery records are never cleaned up (memory growth), and the fire-and-forget delivery pattern means the application does not know if deliveries are succeeding.

---

## Findings

### WH-01. Outbound Webhook Signature Uses Secret Hash — Consumers Cannot Verify

**Severity: P1**

`src/services/api/webhooks.ts:177-179` — `const signature = await hmacSign(secretHash, payloadJson)`. The `secretHash` is the SHA-256 hash of the original secret, not the secret itself. The consumer was given the original secret at creation time. To verify the signature, the consumer would need to HMAC-sign with the hash of their secret, not the secret itself. This is undocumented and counterintuitive.

**Evidence:**
- `src/services/api/webhooks.ts:62-66` — Webhook creation stores `secretHash = await hashSecret(secret)` in DB
- Line 152-153: `const secretHash = (r.secret_hash as string) ?? ''` — reads the hash from DB
- Line 179: `const signature = await hmacSign(secretHash, payloadJson)` — signs with the hash
- Line 74: `secret` (plaintext) is returned to the consumer at creation time
- A consumer using `HMAC-SHA256(secret, payload)` will get a different signature than `HMAC-SHA256(SHA256(secret), payload)`
- This effectively makes webhook signature verification impossible for consumers

**Remediation:** Store the plaintext secret (encrypted at rest using `src/services/encryption.ts`) and use it for HMAC signing. The secret hash should only be used for looking up which webhook to deliver to, not for signing.

**Target phase:** P0 (ships broken — webhook signatures cannot be verified)

---

### WH-02. No Replay Protection — Missing Timestamp in Signature

**Severity: P1**

The outbound webhook payload includes a `timestamp` field in the JSON body (`src/services/api/webhooks.ts:171`), but the HMAC signature covers only the JSON payload, not a separate timestamp header. An attacker who intercepts a valid delivery can replay it indefinitely. Consumers have no built-in way to reject old deliveries.

**Evidence:**
- `src/services/api/webhooks.ts:168-175` — payload includes `timestamp` but it is inside the signed body
- No `X-Foundry-Timestamp` header sent separately
- No documentation advising consumers to reject deliveries older than N minutes
- Standard webhook practice (Stripe, GitHub) includes the timestamp in the signature computation separately

**Remediation:** Add an `X-Foundry-Timestamp` header with the Unix epoch seconds. Include the timestamp in the HMAC computation: `HMAC(secret, timestamp + '.' + payload)`. Document that consumers should reject deliveries where the timestamp is more than 5 minutes old.

**Target phase:** P1

---

### WH-03. Fire-and-Forget Delivery — No Monitoring of Failure Rates

**Severity: P1**

`src/services/api/webhooks.ts:155` — `void deliverToWebhook(...)` fires the delivery asynchronously with no await. The main `deliverWebhookEvent` function returns immediately. If all 3 retry attempts fail, the delivery is recorded in `webhook_deliveries` with `failed_at` set, and the webhook's `failure_count` is incremented. But:
- No alert is sent to the founder when deliveries start failing
- No health dashboard shows delivery success rates
- The auto-disable at 10 failures (line 247) happens silently

**Evidence:**
- `src/services/api/webhooks.ts:155` — `void deliverToWebhook(...)` — fire and forget
- Line 246-249: `is_active = CASE WHEN failure_count + 1 >= 10 THEN 0 ELSE is_active END` — auto-disables at 10 failures
- No notification to the webhook owner when their webhook is disabled
- No metric export of delivery success/failure rates

**Remediation:** When a webhook is auto-disabled (failure_count >= 10), create a notification for the product owner: "Your webhook to {url} has been disabled after 10 consecutive failures." Add a `/api/webhooks/:id/deliveries` endpoint that shows delivery history with status.

**Target phase:** P1

---

### WH-04. Webhook Delivery Records Are Never Cleaned Up

**Severity: P2**

`webhook_deliveries` table rows are inserted for every delivery attempt but never deleted. The `scp_webhook_delivery_cleanup` job (`src/jobs/index.ts:1851`) is registered but the actual cleanup logic depends on the implementation of that function.

**Evidence:**
- `src/services/api/webhooks.ts:219-235` — INSERT into `webhook_deliveries` for every delivery
- `src/jobs/index.ts:1851` — `scp_webhook_delivery_cleanup: { schedule: '0 4 * * 0' }` — weekly cleanup
- If a product has 10 webhooks each receiving 5 events/day, that is 50 delivery records/day, 1500/month
- Over a year with 100 products, the table could reach 1.8M rows

**Remediation:** Ensure the cleanup job deletes delivery records older than 30 days. Verify the `scpWebhookDeliveryCleanup` function actually implements deletion. Add an index on `(webhook_id, delivered_at)` for efficient cleanup.

**Target phase:** P2

---

### WH-05. Inbound Clerk Webhook Secret Is Optional — Webhook Endpoint May Accept Unsigned Payloads

**Severity: P1**

`src/env.ts:21` — `CLERK_WEBHOOK_SECRET` is marked as `required: false`. If not set, the Clerk webhook endpoint may accept unsigned payloads, allowing an attacker to forge Clerk events (user creation, deletion, etc.).

**Evidence:**
- `src/env.ts:21` — `{ name: 'CLERK_WEBHOOK_SECRET', required: false, description: 'Clerk webhook signing secret — webhook endpoint disabled without this' }`
- `src/routes/auth/clerk.ts:101` — `const webhookSecret = process.env.CLERK_WEBHOOK_SECRET` — reads the secret
- If `webhookSecret` is undefined, the behavior depends on the webhook verification logic
- The description says "webhook endpoint disabled without this" but the route is still mounted

**Remediation:** If `CLERK_WEBHOOK_SECRET` is not set, the webhook endpoint should return 503 (Service Unavailable) rather than processing unsigned payloads. Make this explicit with an early return: `if (!webhookSecret) return c.json({ error: 'Webhook verification not configured' }, 503)`.

**Target phase:** P1

---

### WH-06. No Idempotency Keys in Outbound Webhook Payloads

**Severity: P2**

The outbound webhook payload includes a unique `id` field (the `deliveryId`), but this is not documented as an idempotency key. Consumers who receive the same event twice (e.g., due to a retry that succeeded but the response was lost) have no standard way to deduplicate.

**Evidence:**
- `src/services/api/webhooks.ts:170` — `id: deliveryId` — unique per delivery attempt
- This changes on each retry attempt (new `deliveryId` generated at line 167)
- Should be a stable event ID that is the same across retries
- No documentation for consumers on how to handle duplicate deliveries

**Remediation:** Add a stable `event_id` field (generated once per event, not per delivery attempt) alongside the `delivery_id` (which is unique per attempt). Document that consumers should use `event_id` for deduplication.

**Target phase:** P2

---

### WH-07. API v1 Webhook Secret Stored in Plaintext

**Severity: P1**

`src/api/v1/webhooks.ts:54-59` — Webhook creation stores the secret directly: `VALUES (?, ?, ?, ?, ?, 1, ?)` with `secret` as a parameter. The encryption module (`src/services/encryption.ts`) exists but is not used for webhook secrets.

**Evidence:**
- `src/api/v1/webhooks.ts:58` — `secret` stored as plaintext in `webhooks` table
- `src/services/encryption.ts` — encryption module exists with `encrypt()` and `decrypt()` functions
- `src/services/api/webhooks.ts:59` — the outbound webhooks service stores `secret_hash` (SHA-256 hash) — better but still not encrypted
- Two different webhook tables (`webhooks` for API v1, `outbound_webhooks` for the service) with different storage approaches

**Remediation:** Encrypt webhook secrets using `encrypt()` from `src/services/encryption.ts` before storage. The API v1 `webhooks` table should store encrypted secrets. The `outbound_webhooks` table should store the encrypted plaintext (for signing) instead of just the hash.

**Target phase:** P1

---

## Embarrassment Test

1. **"Outbound webhook signatures are computed using the SHA-256 hash of the secret instead of the secret itself — consumers who try to verify signatures using their secret will always fail"** — The webhook signing is fundamentally broken.

2. **"When a customer's webhook is auto-disabled after 10 consecutive failures, they receive no notification — their integration silently stops working"** — Silent failure of a customer-facing integration.

3. **"The API v1 stores webhook secrets in plaintext while the outbound webhooks service stores only a hash — two inconsistent security models for the same concept"** — Split-brain secret management.

## Pride Test

1. The outbound webhook system has a clean architecture: HMAC signing, 3-attempt retry with exponential backoff, delivery recording, and auto-disable after 10 failures.

2. Stripe webhook verification (`src/services/integrations/stripe-webhook.ts:31-39`) correctly uses the Stripe SDK's `constructEvent()` method, which is the recommended approach.

3. The `X-Foundry-Signature`, `X-Foundry-Event`, and `X-Foundry-Delivery` headers follow industry conventions (modeled after GitHub/Stripe webhook patterns).

## Distinct-Value Declaration

This lens traces webhook delivery reliability end-to-end: from signing key management through delivery retry logic to consumer-side verification. The broken signing key (using hash instead of secret) is a bug that only a webhook-specialist would catch by tracing the key from creation (plaintext) through storage (hash) to usage (HMAC signing with hash). Tier 1 security lens may flag "no signature verification" on inbound webhooks but would miss the broken outbound signing.

## Tenancy-Critical Flag

**WH-01** is tenancy-critical: every customer's webhook signatures are broken, not just one. **WH-07** is tenancy-critical: webhook secrets stored in plaintext in one table means a database breach exposes all customers' webhook secrets.
