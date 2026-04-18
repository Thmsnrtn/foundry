# Lens 129 — Webhook Replay Attack Adversary

**Auditor perspective:** Edge-case hunter / domain adversary — replay a Stripe webhook, a Clerk webhook, a voice transcript. What breaks?
**Distinct-value declaration:** Tests each webhook endpoint for replay protection (timestamp validation, idempotency keys, deduplication) and documents the exact damage of successful replays. No prior lens tested replay scenarios.
**Tenancy-critical:** Yes. Webhook replays can affect billing state, founder provisioning, and company data across tenants.

**Date:** 2026-04-16
**Repo:** foundry (Hono + Turso + Clerk + Anthropic)

---

## Summary

| Severity | Count |
|----------|-------|
| P1 | 2 |
| P2 | 3 |

---

## Webhook Endpoints Inventory

| Endpoint | Signature Verification | Timestamp Check | Idempotency |
|----------|----------------------|-----------------|-------------|
| `POST /webhooks/stripe` | Yes (Stripe SDK `constructEvent`) | Yes (Stripe SDK, 5 min tolerance) | No |
| `POST /webhooks/stripe/:productId` | Yes (Stripe SDK) | Yes (Stripe SDK) | No |
| `POST /auth/webhook` (Clerk) | Yes (Svix HMAC) | Yes (5 min manual check) | No |
| `POST /webhooks/transcripts/fathom` | API key only | No | No |
| `POST /webhooks/transcripts/fireflies` | API key only | No | No |
| `POST /api/voice/session/:id/end` | Auth + ownership | No | No |

---

## WR-01. Stripe webhook replay: tier change applied twice

**Severity: P1**
**Files:** `src/services/billing/stripe.ts:66-103`

Stripe's `constructEvent` validates the signature and includes timestamp checking (default 300 seconds tolerance). This prevents replays outside the 5-minute window. However, within the 5-minute window, replaying a valid signed webhook is possible if an attacker captures the raw payload and signature.

**Replay impact (within window):**
- `customer.subscription.created/updated`: Re-runs `UPDATE founders SET tier = ? WHERE stripe_customer_id = ?`. Idempotent -- same tier is set again. **Safe.**
- `customer.subscription.deleted`: Re-runs `UPDATE founders SET tier = NULL` and pauses SCP instances. If the founder has since resubscribed (within 5 minutes), the replay would cancel their active subscription state. **Dangerous.**

The `subscription.deleted` handler also queries for the founder's products and pauses all SCP instances (`UPDATE scp_instances SET status = 'paused'`). A replay would re-pause instances that may have been manually resumed.

**Evidence:**
- `src/services/billing/stripe.ts:87-99`: No deduplication by event ID
- Stripe events have a unique `event.id` that could be used for deduplication but is not checked
- No `processed_webhooks` or `webhook_events` deduplication table

---

## WR-02. Clerk webhook replay: duplicate founder creation possible

**Severity: P1**
**Files:** `src/routes/auth/clerk.ts:100-197`

The Clerk webhook handler verifies the Svix signature and checks the timestamp (5-minute window). Within the window, a replayed `user.created` event would:

1. Check if founder exists by `clerk_user_id` -- if it does, the INSERT is skipped (idempotent). **Safe for existing founders.**
2. But a replayed `user.deleted` event would DELETE the founder and all their products. If the user account still exists in Clerk, the next login would auto-provision a new founder record -- but all historical data (products, agents, decisions, briefings) would be permanently lost.

**Replay attack scenario:** An attacker captures a `user.deleted` webhook payload during the 5-minute window. They replay it. The founder's data is deleted. The founder logs in again and gets a fresh, empty account.

**Evidence:**
- `src/routes/auth/clerk.ts:144-157`: `user.deleted` handler deletes products and founder rows with no soft-delete or deduplication
- No `DELETE` cascade protection -- products are deleted in a loop, then the founder is deleted
- No `processed_webhook_ids` table to prevent replay

**Mitigating factor:** The timestamp check at line 118 (`Math.abs(now - timestampSeconds) > 300`) limits the replay window to 5 minutes. Outside this window, the webhook is rejected.

---

## WR-03. Transcript webhooks have no replay protection at all

**Severity: P2**
**Files:** `src/routes/api/webhooks/transcripts.ts`

The Fathom and Fireflies transcript webhook endpoints authenticate via API key only (`x-api-key` header). There is no:
- Signature verification (the API key is a shared secret, not a per-request signature)
- Timestamp validation
- Deduplication by transcript ID or event ID

**Replay impact:** Replaying a transcript webhook creates a duplicate `call_transcripts` row and triggers a duplicate `analyzeTranscript` AI call (fire-and-forget). At ~$0.01-0.05 per analysis, repeated replays could accumulate cost.

**Evidence:**
- `src/routes/api/webhooks/transcripts.ts:25-57`: No timestamp or deduplication check
- `analyzeTranscript(id).catch(() => {})` -- fire-and-forget, so duplicate analyses run concurrently

---

## WR-04. Per-product Stripe webhook has no deduplication

**Severity: P2**
**Files:** `src/index.ts:245-259`, `src/services/integrations/stripe-webhook.ts`

The per-product Stripe webhook (`/webhooks/stripe/:productId`) processes Stripe events through the full intelligence chain (`processStripeEventChain`). This may trigger customer intelligence updates, event bus ingestion, and agent signals. A replayed event would process the entire chain again.

**Evidence:**
- `src/index.ts:252-254`: `verifyStripeWebhook` validates signature, then `processStripeEventChain` runs
- No event ID deduplication in `processStripeEventChain`
- The event bus (`ingestEvent`) does not check for duplicate events

---

## WR-05. Voice session end has no idempotency

**Severity: P2**
**Files:** `src/routes/api/platform.ts:284-298`

`POST /api/voice/session/:id/end` accepts a transcript and duration. If called twice for the same session, it would overwrite the first transcript with the second. There is no check for `session.status === 'completed'` before processing.

**Evidence:**
- `src/routes/api/platform.ts:296`: `endVoiceSession(sessionId, transcript, duration)` called without checking current session status

---

## Recommendations

1. **Add webhook event deduplication table** -- Create a `processed_webhook_events` table with `event_id TEXT PRIMARY KEY, processed_at DATETIME`. Check before processing any Stripe or Clerk webhook.
2. **Soft-delete founders** -- Replace `DELETE FROM founders` with `UPDATE founders SET status='deleted'`. Allow recovery within 30 days.
3. **Add transcript deduplication** -- Hash the transcript content and reject duplicates within a time window.
4. **Add session state check** -- Before ending a voice session, verify it is in 'active' state.
5. **Log all webhook events** -- Insert every received webhook into an audit table regardless of processing outcome, for forensic analysis.
