# Lens 128 — GitHub API Rate Limit Adversary

**Auditor perspective:** Edge-case hunter / domain adversary — Remediation Engine under fleet load
**Distinct-value declaration:** Quantifies GitHub API consumption across all fleet operations (audit, remediation PR check, integration sync, PR generation) and determines when rate limits become a bottleneck. No prior lens computed the aggregate API budget.
**Tenancy-critical:** Yes. GitHub tokens may be per-product (OAuth) or shared. Rate limits are per-token. Fleet-scale operations can exhaust a single token's budget.

**Date:** 2026-04-16
**Repo:** foundry (Hono + Turso + Clerk + Anthropic)

---

## Summary

| Severity | Count |
|----------|-------|
| P1 | 2 |
| P2 | 2 |

---

## GitHub API Budget Analysis

GitHub REST API rate limit: **5,000 requests/hour per token** (authenticated).

### Operations That Consume GitHub API Calls

| Operation | Frequency | API Calls per Product | At 25 Products |
|-----------|-----------|----------------------|-----------------|
| 8-step audit analysis | On demand | 10-50 calls (tree listing, file fetches) | Burst |
| `remediationOutcomeCheck` | Daily | 1-2 per open PR | 25-150 |
| `scpIntegrationFabricSync` (GitHub events) | Hourly | 1-5 calls | 25-125 |
| PR generation (remediation) | On demand | 4 calls (create branch, commit, create PR, verify) | Burst |
| `scpExtendedIntegrationsSync` | Every 2h | 0 (GitHub not in this sync) | 0 |

### Steady-State Daily Budget (25 Products)

| Operation | Daily Calls |
|-----------|-------------|
| Integration fabric sync (24 runs x 25 products x ~3 calls) | ~1,800 |
| Remediation outcome check (1 run x 25 products x ~2 PRs x 2 calls) | ~100 |
| **Total steady-state** | **~1,900/day** |
| **Per hour (average)** | **~80/hour** |

This is well within the 5,000/hour limit under steady state.

### Burst Scenario: Fleet-Wide Audit + Remediation

If all 25 products trigger a full audit simultaneously (e.g., after onboarding or a "re-audit all" action):

| Operation | Calls |
|-----------|-------|
| 25 audits x 30 API calls each | 750 |
| 25 remediation PRs generated | 100 |
| **Burst total** | **850** |

Still within limits, but combined with the hourly integration sync (~125), the hour's total reaches ~975 -- still safe but approaching 20% of the budget.

---

## GH-01. GitHub tokens are per-product but stored in plaintext

**Severity: P1**
**Files:** `src/services/audit/github.ts`, `src/db/client.ts`, `src/routes/dashboard/onboarding.ts`

Each product stores its own GitHub OAuth access token in `products.github_access_token`. This means rate limits are per-product (good for isolation), but:

1. **Tokens are stored in plaintext** -- The schema comments say "Encrypted" but no encryption code exists (flagged in orientation doc item #3).
2. **Token expiration is not tracked** -- GitHub OAuth tokens can expire or be revoked. No refresh mechanism exists.
3. **No rate limit tracking per token** -- The `githubFetch` function handles 403/429 responses reactively (sleep and retry) but does not proactively track remaining requests per token.

**Evidence:**
- `src/services/audit/github.ts:39-80`: `githubFetch` handles rate limits reactively
- `src/services/audit/github.ts:57-61`: On 403 with `X-RateLimit-Remaining: 0`, waits until reset time (max 60s)
- `src/jobs/index.ts:480-493`: `remediationOutcomeCheck` reads `github_access_token` from products table directly

---

## GH-02. Integration fabric sync does not respect per-token rate limit state

**Severity: P1**
**Files:** `src/services/integration/github.ts`

The `scpIntegrationFabricSync` job iterates all 25 products and calls `syncGitHubEvents(productId)` for each. Each sync uses that product's GitHub token. If a product's token is near its rate limit (e.g., 10 remaining), the sync will consume those remaining calls and trigger a 403.

There is no pre-check of `X-RateLimit-Remaining` before starting a sync. The sync is fire-and-forget per product -- if it hits a rate limit, it fails silently (`catch { /* non-fatal per product */ }` at line 1224).

**Evidence:**
- `src/jobs/index.ts:1219-1229`: Per-product sync with silent catch
- No `X-RateLimit-Remaining` pre-check before starting sync
- No backoff coordination between products sharing the same GitHub org/token

---

## GH-03. Remediation PR generation has no idempotency guard

**Severity: P2**
**Files:** `src/services/audit/remediation.ts`

When the remediation engine generates a PR, it creates a branch, commits files, and opens a PR via the GitHub API. If the process fails midway (e.g., branch created but PR creation fails due to rate limit), the next retry will attempt to create the same branch again, potentially hitting a "branch already exists" error.

There is no idempotency key or "check if branch/PR already exists" guard before creating resources.

**Evidence:**
- `src/services/audit/remediation.ts`: PR generation flow with no pre-existence check
- `src/services/audit/github.ts`: Branch/commit/PR creation as separate API calls with no rollback

---

## GH-04. All products in the same GitHub org share one rate limit budget

**Severity: P2**

If a founder's 5 products all live in the same GitHub organization and use the same OAuth token (because the founder authorized once), all 5 products share the 5,000/hour budget. The system treats each product's token independently but doesn't know they are the same underlying token.

With 5 products sharing one token:
- Integration sync: 5 x 3 x 24 = 360 calls/day
- Remediation checks: 5 x 2 x 2 = 20 calls/day
- Burst audit: 5 x 30 = 150 calls (one-time)

Still within limits, but with no coordination between products sharing a token, concurrent requests could exceed per-second limits (even if hourly budget is fine).

---

## Recommendations

1. **Track rate limit state per token** -- After each GitHub API response, store `X-RateLimit-Remaining` and `X-RateLimit-Reset` in memory. Skip or defer operations when remaining < 100.
2. **Encrypt GitHub access tokens** -- Implement the encryption that the schema claims exists.
3. **Add token refresh logic** -- GitHub OAuth tokens should be refreshed before expiration.
4. **Add pre-existence checks to PR generation** -- Check if the branch or PR already exists before creating.
5. **Detect shared tokens across products** -- Hash the token and group products by token hash. Coordinate rate limit budgets for shared-token groups.
