# Lens 35 — Fraud / Abuse Reviewer Audit

**Auditor perspective:** Fraud and abuse reviewer
**Scope:** Rate limiting effectiveness, credential stuffing protection, AI cost attacks, share link abuse, ingest token abuse
**Date:** 2026-04-16

---

## Executive Summary

Foundry has **basic rate limiting** (in-memory token bucket) on HTTP routes but **no protection against targeted abuse vectors**. The most critical gap is unbounded AI cost exposure: there is no per-founder or per-product AI token budget, and the conversation endpoint allows repeated expensive Claude Opus calls within the generic HTTP rate limit. The ingest token and share token are bearer tokens with no rotation enforcement, no IP restriction, and no abuse detection. The auth layer delegates to Clerk (which provides credential stuffing protection), but the rate limit on auth endpoints is per-IP with no account lockout. There is no CAPTCHA, no bot detection, and no anomaly detection on any endpoint.

**P0 findings:** 1
**P1 findings:** 4
**P2 findings:** 3

---

## Finding 01 — Unbounded AI cost exposure via conversation endpoint

**Severity: P0**
**Files:** `src/middleware/rate-limit.ts`, `src/services/ai/client.ts`

The `/api/ask` endpoint (conversation with Claude) is protected by `apiRateLimit` (120 requests/minute). Each request can trigger a Claude Opus call with up to 8192 output tokens. At Anthropic's pricing, 120 Opus calls per minute could cost roughly $50-100/minute in token usage.

There is no:
- **Per-founder AI token budget**: A founder on the $79 Solo plan can consume unlimited AI tokens.
- **Per-product daily AI call limit**: SCP agent runs (12 agents per product per hour) are not rate-limited at all (they run via cron).
- **Cost ceiling per billing cycle**: No maximum spend cap per founder.
- **Token usage tracking**: No table or metric records how many tokens each founder has consumed.

A malicious or careless founder could:
1. Script 120 complex questions per minute against `/api/ask`.
2. Each question generates a Claude Opus call with full product context.
3. Cost: potentially thousands of dollars per day in Anthropic API charges.

**Impact:** A single founder's abuse can exhaust the entire Anthropic API budget. This is not theoretical -- automated testing tools, browser extensions, or a disgruntled founder could trigger this.

**Remediation:**
1. Track token usage per founder per day in a `founder_ai_usage` table.
2. Enforce a daily token budget per tier: Solo: 50K tokens, Growth: 150K tokens, Investor-Ready: 500K tokens.
3. Return 429 with a clear message when the budget is exhausted.
4. Add a per-product daily AI call cap for cron-triggered operations.
5. Consider using Claude Sonnet (cheaper) for conversation by default, with Opus only for strategic analysis.

---

## Finding 02 — Ingest token abuse: no rate limit, no payload size limit, no IP restriction

**Severity: P1**
**Files:** `src/routes/ingest/index.ts`

The ingest endpoint (`POST /ingest/:token`) accepts any JSON payload with a valid token. The token is a 48-character hex string (24 random bytes) -- cryptographically strong. However:

- **No rate limit**: The ingest route is not wrapped in any rate limit middleware. An attacker with a leaked token can flood the endpoint with millions of requests.
- **No payload size limit**: The body is parsed with `c.req.json()` with no size constraint. A 100MB JSON payload will be parsed into memory.
- **No IP restriction**: Any IP can use the token. There is no allowlist or geofence.
- **No token rotation enforcement**: Once generated, a token lives forever. There is no expiry or automatic rotation.
- **No abuse detection**: No monitoring for unusual ingest patterns (e.g., 1000 requests in a minute from a new IP).

An attacker with a leaked ingest token could:
1. Overwrite metric snapshots with garbage data, corrupting the founder's Signal score and stressor detection.
2. Flood the endpoint, causing database load and potentially affecting other founders (single Turso instance).
3. Inject misleading metrics to manipulate risk state transitions.

**Impact:** A leaked ingest token grants unauthenticated write access to a founder's metrics. No rate limiting means the damage is unbounded.

**Remediation:**
1. Apply `webhookRateLimit` (300/min) to the ingest route.
2. Add a payload size limit (e.g., 10KB max body for metric ingestion).
3. Add token expiry (e.g., 90 days) with automatic rotation reminder.
4. Log source IP per ingest request and alert on anomalous patterns.
5. Validate that metric values are within reasonable bounds (e.g., MRR between $0 and $10M, rates between 0 and 1).

---

## Finding 03 — Share token grants permanent unauthenticated read access

**Severity: P1**
**Files:** `src/routes/share/index.ts`, `src/routes/dashboard/settings.ts`

The share token (`/share/:token`) provides a read-only view of Signal score, metrics, recent decisions, and lifecycle state. The token:
- Never expires
- Has no access logging (who viewed, when, from where)
- Has no view count limit
- Cannot be temporarily disabled (only regenerated, which invalidates the old URL)
- Is validated only by `!/^[\w-]{8,64}$/.test(token)` (regex check) and database lookup

The share page exposes potentially sensitive business data:
- Current MRR (revenue)
- Churn rate
- Activation rate
- NPS score
- Recent strategic decisions
- Risk state and reason

If a share link is leaked (email forwarded, Slack channel screenshot, bookmarked on a shared computer), anyone with the URL has permanent read access to the founder's business metrics.

**Impact:** Permanent unauthenticated access to sensitive business intelligence. A leaked share link is irrevocable without regeneration (which breaks all previously shared URLs).

**Remediation:**
1. Add an optional expiry date to share tokens (e.g., 30 days default, configurable).
2. Log access to share pages (IP, timestamp, user-agent) so the founder can see who viewed their data.
3. Add a "disable sharing" toggle that suspends the token without deleting it.
4. Add a view count and optionally cap views (e.g., 100 views before requiring regeneration).

---

## Finding 04 — Auth rate limiting is per-IP only, no account-level protection

**Severity: P1**
**Files:** `src/middleware/rate-limit.ts`

The auth rate limit is 10 requests/minute per IP. Authentication is handled by Clerk (which has its own protections), so the direct credential stuffing risk is mitigated. However:

- **No CAPTCHA**: No Turnstile, reCAPTCHA, or hCaptcha on signup or login.
- **No account lockout**: If Clerk allows password-based auth, there is no Foundry-side lockout after failed attempts.
- **No bot detection**: No User-Agent analysis, no JavaScript challenge, no fingerprinting.
- **Rate limit is in-memory**: Restarting the server (every deployment on Fly.io) resets all rate limit state.

The in-memory rate limiter using a `Map` does not survive deployments and does not scale across multiple Fly.io instances (if the app scales to multiple machines, each has its own rate limit state).

**Impact:** The rate limiter is a speed bump, not a wall. Distributed attacks across IPs bypass it entirely. Server restarts reset it.

**Remediation:**
1. Clerk provides bot protection and brute force detection -- verify these are enabled in the Clerk dashboard.
2. Move rate limiting to a persistent store (Redis, or Turso-backed) that survives restarts and works across instances.
3. Add Cloudflare Turnstile or equivalent on signup/login pages.
4. Add monitoring for unusual auth patterns (many signups from one IP range).

---

## Finding 05 — Rate limit state is in-memory and lost on deploy

**Severity: P1**
**Files:** `src/middleware/rate-limit.ts`

The rate limiter stores state in a JavaScript `Map`:

```typescript
const store = new Map<string, RateLimitEntry>();
```

This means:
- Every deployment (Fly.io restarts) resets all rate limit counters.
- If the app runs on multiple instances, each has independent counters. A request to instance A does not count against instance B.
- A 60-second cleanup interval removes expired entries, but the interval itself does not survive restarts.

For a single-instance Fly.io deployment, the multi-instance issue does not apply today, but the deployment reset issue is immediate: during a rolling deployment, the new instance starts with zero counters.

**Impact:** Rate limiting provides inconsistent protection. A dedicated attacker can time attacks around deployments (which are visible via response timing) or distribute across instances.

**Remediation:**
1. For the current single-instance setup: accept the deployment reset as a known limitation but document it.
2. For production: use a persistent rate limit store (Turso with a TTL-based cleanup, or an edge-deployed Redis/Valkey instance).
3. Add Cloudflare rate limiting at the CDN edge as a defense-in-depth layer.

---

## Finding 06 — No abuse detection on public endpoints

**Severity: P2**
**Files:** `src/routes/public/landing.ts` (pricing and case-study routes are exported from it)

Public routes have a `publicRateLimit` of 60 requests/minute per IP. There is no:
- Scraping detection (no check for aggressive crawling patterns)
- Bot identification (no robots.txt, no honeypot endpoints)
- DDoS mitigation beyond Fly.io's built-in protections
- Content enumeration protection (the share route could be brute-forced by iterating token values, though the 48-character hex space makes this impractical)

**Impact:** Low immediate risk due to Fly.io's infrastructure protections, but no application-layer defense if those fail.

**Remediation:**
1. Add `robots.txt` to control crawler behavior.
2. Consider Cloudflare in front of Fly.io for DDoS protection and bot management.

---

## Finding 07 — GitHub access tokens stored in plaintext

**Severity: P2**
**Files:** `src/db/schema.sql`, `src/routes/dashboard/onboarding.ts`

The schema comments say `github_access_token TEXT, -- Encrypted` but the token is stored as plaintext:

```typescript
await query('INSERT INTO products (..., github_access_token, ...) VALUES (..., ?, ...)',
  [..., body.access_token, ...]);
```

No encryption or hashing is applied. A database breach exposes GitHub OAuth tokens for all connected repositories.

This was flagged in the orientation document (item #3) but is relevant to the fraud/abuse lens because a stolen token grants full `repo` scope access to the founder's GitHub repositories. An attacker could:
1. Read private source code
2. Push malicious code
3. Delete branches or repositories
4. Create credential-stealing webhooks

**Impact:** Database compromise = full GitHub access for all connected repositories.

**Remediation:**
1. Encrypt GitHub tokens at rest using an application-level encryption key (AES-256-GCM with a key from environment variables).
2. Decrypt only when making GitHub API calls.
3. Consider using GitHub App tokens (which are shorter-lived) instead of OAuth tokens.

---

## Finding 08 — No abuse detection on AI conversation endpoint

**Severity: P2**
**Files:** `src/routes/api/ask.ts`

Beyond the rate limit (Finding 01), the conversation endpoint has no:
- Prompt injection detection (the founder's query is injected into a prompt with product context)
- Content moderation on responses (AI could generate harmful content if manipulated)
- Query logging for forensic analysis
- Anomaly detection (sudden spike in queries from one founder)

While Anthropic's API has built-in content filtering, the prompt injection risk is Foundry-specific: a founder could craft queries designed to extract system prompts, other founders' anonymized data (from decision_patterns), or internal operational details.

**Impact:** Prompt injection could expose system internals or cross-tenant data from the anonymized decision patterns table.

**Remediation:**
1. Sanitize user queries before injecting into prompts (strip instruction-like patterns).
2. Ensure the conversation context loader does not include data from other founders.
3. Log all conversation queries for forensic analysis.
4. Add anomaly detection: alert if a founder sends more than 50 queries in an hour.

---

## Summary Table

| # | Finding | Severity | File(s) |
|---|---------|----------|---------|
| 01 | Unbounded AI cost exposure via conversation endpoint | P0 | `middleware/rate-limit.ts`, `services/ai/client.ts` |
| 02 | Ingest token abuse: no rate limit, no size limit | P1 | `routes/ingest/index.ts` |
| 03 | Share token grants permanent unauthenticated read access | P1 | `routes/share/index.ts` |
| 04 | Auth rate limiting is per-IP only, no account-level protection | P1 | `middleware/rate-limit.ts` |
| 05 | Rate limit state is in-memory and lost on deploy | P1 | `middleware/rate-limit.ts` |
| 06 | No abuse detection on public endpoints | P2 | `routes/public/*.ts` |
| 07 | GitHub access tokens stored in plaintext | P2 | `db/schema.sql` |
| 08 | No abuse detection on AI conversation endpoint | P2 | `routes/api/ask.ts` |

---

## Cross-References

- **Lens 06 (Reliability/SRE):** Finding 01 here (AI cost) was flagged in Lens 06 Finding 21.
- **Lens 07 (Security):** Finding 07 (plaintext tokens) was flagged in Lens 07 and orientation item #3.
- **Lens 32 (Billing ops):** AI cost exposure (Finding 01) is also a billing operations concern.
- **Orientation doc items #3, #4, #15:** Plaintext tokens, no rate limiting on AI calls.
