# Lens 43 — GitHub Integration Expert Audit

**Auditor perspective:** GitHub integration / developer platform expert
**Scope:** Remediation Engine PR generation, GitHub API auth, rate limiting, signed commits, branch protection interaction, error handling, token management, write operations safety
**Date:** 2026-04-16

---

## Executive Summary

The GitHub integration is split cleanly between read operations (audit/analysis) in `github.ts` and write operations (remediation) in `remediation.ts`. Read operations have solid retry logic with exponential backoff and rate-limit-aware waiting. Write operations also have retry logic via `githubFetchMutate`. The remediation engine implements a thoughtful AUTO / WISDOM_REQUIRED / HUMAN_ONLY classification system with a 0.7 confidence threshold that prevents low-quality PRs. However, the integration has critical gaps: access tokens are stored in plaintext (the schema says "encrypted" but no encryption exists), there is no token refresh mechanism for OAuth tokens, commits are not signed, branch protection rules are not checked before pushing, and the PR body includes no CI/test validation instructions. The `getKeyFiles` function serially fetches up to 50 files with no parallelization, making audits unnecessarily slow.

**P0 findings:** 1
**P1 findings:** 4
**P2 findings:** 4
**P3 findings:** 3

---

## Finding 01 — GitHub access tokens stored in plaintext

**Severity: P0**
**File:** `src/routes/dashboard/onboarding.ts` (line 158), `src/db/schema.sql`

GitHub OAuth access tokens are stored directly in the `products.github_access_token` column as plaintext:

```typescript
// onboarding.ts line 158
await query(
  `INSERT INTO products (..., github_access_token, ...) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  [productId, body.repo_name, founder.id, repoUrl, body.repo_owner, body.repo_name, body.access_token, ...]
);
```

The orientation document confirms: "GitHub access tokens stored in plaintext (schema says 'Encrypted' but no encryption code)." These tokens grant repo-level read/write access to the user's GitHub repositories.

**Impact:** A database breach exposes every connected founder's GitHub access, enabling code theft, malicious commits, and supply chain attacks.

**Remediation:**
1. Encrypt tokens at rest using AES-256-GCM with a key derived from an environment variable.
2. Add a `decryptGitHubToken(productId)` helper that decrypts on use.
3. Audit all locations where `github_access_token` is read from the database.

---

## Finding 02 — No OAuth token refresh mechanism

**Severity: P1**
**File:** `src/routes/dashboard/onboarding.ts` (lines 96-117)

The GitHub OAuth flow exchanges an authorization code for an access token during onboarding, stores it, and never refreshes it. GitHub OAuth tokens (classic) do not expire, but GitHub App installation tokens expire after 1 hour. If Foundry ever migrates to a GitHub App (recommended for production), all stored tokens will expire with no refresh mechanism.

Even with classic OAuth tokens, GitHub can revoke tokens if the user changes their password, the OAuth app credentials are rotated, or GitHub detects suspicious activity. There is no detection of token revocation and no re-authorization flow.

**Impact:** Token revocation results in silent audit and remediation failures with no user-facing indication that re-authorization is needed.

**Remediation:**
1. Add a token validity check before each API call (or on a periodic schedule).
2. On 401 response, mark the product's GitHub connection as "needs reauthorization" and surface this in the UI.
3. Implement a re-authorization flow (redirect to GitHub OAuth, update stored token).

---

## Finding 03 — No branch protection awareness

**Severity: P1**
**File:** `src/services/audit/github.ts` (lines 235-253)

The `createBranch` and `commitFiles` functions push directly to the new branch without checking the repository's branch protection rules. If the base branch (typically `main`) has:
- Required status checks: the PR will be unmergeable until checks pass, but the founder is not told which checks are required.
- Required reviews: the PR body does not request specific reviewers.
- Signed commits required: the commits are unsigned (Finding 04), so the PR will show as "unverified."
- Branch name restrictions: the `foundry/fix-*` branch pattern may be blocked.

The code does not check if the user's token has `write` permission on the repository before attempting to push.

**Impact:** Remediation PRs may be created in a state that cannot be merged, with no diagnosis of why.

**Remediation:**
1. Before creating a branch, check the repository's branch protection rules via `GET /repos/{owner}/{repo}/branches/{branch}/protection`.
2. If signed commits are required, either sign commits (see Finding 04) or warn the founder in the PR body.
3. If status checks are required, mention them in the PR body so the founder knows what needs to pass.

---

## Finding 04 — Commits are not signed (GPG/SSH)

**Severity: P1**
**File:** `src/services/audit/github.ts` (lines 258-327)

The `commitFiles` function creates commits via the Git Data API (POST `/git/commits`) without a `signature` field. These commits will show as "Unverified" on GitHub. For repositories with "Require signed commits" branch protection, the PR will be blocked.

**Impact:** Remediation PRs may appear untrustworthy ("Unverified" badge) or fail to merge on repositories with strict signing policies.

**Remediation:**
1. Generate a GPG key for the Foundry bot and sign commits using the `signature` field in the Git Data API.
2. Alternatively, use the GitHub App bot identity which GitHub automatically marks as "Verified."
3. At minimum, document in the PR body that commits are from the Foundry automation system.

---

## Finding 05 — No concurrency control on GitHub API calls

**Severity: P1**
**File:** `src/services/audit/github.ts` (lines 154-207)

`getKeyFiles` fetches up to 50 files sequentially, one `getFileContent` call at a time. Each call includes retry logic with backoff, so a single file that hits rate limits can stall the entire audit. There is no parallelization (e.g., `Promise.allSettled` with a concurrency limit).

The GitHub REST API allows 5,000 requests per hour for authenticated users. A single audit of 50 files uses ~52 requests (1 for tree + 1 for branch ref + 50 for files). This is fine for one audit, but if 20 products run periodic audits in the same hour, that is ~1,040 requests -- approaching the rate limit.

**Impact:** Audits are slower than necessary and multiple concurrent audits may exhaust the rate limit.

**Remediation:**
1. Parallelize file fetches with a concurrency limit of 5-10.
2. Track rate limit remaining across all calls and pause globally when approaching the limit.
3. Consider using the GraphQL API for batch file content retrieval.

---

## Finding 06 — Rate limit handling assumes reset header is always present

**Severity: P2**
**File:** `src/services/audit/github.ts` (lines 51-59)

The 403 handler checks `X-RateLimit-Remaining === '0'` and reads `X-RateLimit-Reset` to compute wait time. If the header is missing or malformed, `parseInt` returns `NaN`, and the wait time becomes negative + 1000ms. The `Math.min(waitMs, 60000)` clamp handles this accidentally (NaN comparisons return false, so `Math.min(NaN, 60000)` returns `NaN`, then `sleep(NaN)` resolves immediately), but the code continues retrying immediately instead of backing off.

Also, 403 responses can indicate permission denied (not just rate limits). The code only checks `X-RateLimit-Remaining` to distinguish, but a permission-denied 403 will have different headers, and the code will sleep and retry 3 times before failing.

**Impact:** Permission-denied errors waste retry attempts. Malformed rate limit headers cause immediate (unbacked-off) retries.

**Remediation:**
1. Distinguish between rate-limit 403 and permission-denied 403 by checking the response body or `X-RateLimit-*` header presence.
2. Default to exponential backoff if rate limit headers are absent.
3. Return a clear error for permission-denied responses.

---

## Finding 07 — Remediation PR generation has no idempotency

**Severity: P2**
**File:** `src/services/audit/remediation.ts` (lines 215-285)

`openRemediationPR` creates a branch, commits files, and opens a PR. If any step fails midway (e.g., branch created but commit fails), the branch is orphaned on GitHub. If the function is retried, it will attempt to create the same branch name (which includes a timestamp, so the name changes) but will not clean up the previous orphaned branch.

There is also no check for whether a remediation PR already exists for the same blocking issue. If the remediation engine runs twice for the same issue, two PRs will be created.

**Impact:** Orphaned branches and duplicate PRs clutter the repository.

**Remediation:**
1. Before creating a branch, check if a `foundry/fix-{issue_id}-*` branch already exists.
2. Before opening a PR, check if an open PR already exists for this blocking issue.
3. On failure, attempt to delete the orphaned branch.

---

## Finding 08 — PR body does not include test instructions

**Severity: P2**
**File:** `src/services/audit/remediation.ts` (lines 373-411)

The `buildPRBody` function generates a well-structured PR description with the blocking issue, fix summary, definition of done, files changed, and wisdom context. However, it does not include:
- How to test the fix
- Which automated tests should pass
- Any manual verification steps
- CI status expectations

**Impact:** Founders may merge the PR without verifying the fix actually resolves the blocking issue.

**Remediation:** Add a "How to verify" section to the PR body. At minimum, include the `definition_of_done` as a checklist. If the fix touches test files, mention which test suite to run.

---

## Finding 09 — File content fetch does not handle large files

**Severity: P2**
**File:** `src/services/audit/github.ts` (lines 127-149)

`getFileContent` uses the Contents API (`/repos/.../contents/...`) which has a 1MB file size limit. Files larger than 1MB will return a 403 or require the Blob API instead. The code does not check `data.size` or handle this error case.

Additionally, the `encodeURIComponent(path)` encoding of the path at line 135 will double-encode paths that already contain encoded characters (e.g., files with spaces or special characters).

**Impact:** Analysis of large configuration files or bundled assets will fail silently (caught by the empty `catch` in `getKeyFiles`).

**Remediation:** Check `entry.size` in the tree before attempting to fetch. For files > 1MB, use the Blob API or skip with a note in the analysis.

---

## Finding 10 — Re-audit after PR merge is deferred, not triggered

**Severity: P3**
**File:** `src/services/audit/remediation.ts` (lines 290-328)

`triggerDimensionReAudit` records timestamps and logs but does not actually trigger a re-audit. The comment says: "A full re-audit would call runAudit with run_type 'post_remediation'. For targeted dimension re-audit, we log and let the next periodic audit capture it."

**Impact:** After a founder merges a remediation PR, they must wait for the next periodic audit to see the score improvement. This breaks the fix-measure feedback loop that makes the remediation system compelling.

**Remediation:** Actually trigger a targeted re-audit (even if it is a full audit with `run_type: 'post_remediation'`) when a PR merge is detected.

---

## Finding 11 — No webhook for PR merge detection

**Severity: P3**
**File:** `src/services/audit/remediation.ts`

The system has `isPRMerged` and `isPROpen` check functions but no GitHub webhook handler to detect PR merges in real time. The only way to detect a merge is by polling, which is not implemented as a scheduled job.

**Impact:** The re-audit trigger (Finding 10) cannot fire because PR merges are never detected.

**Remediation:** Add a GitHub webhook endpoint for `pull_request` events with `action: 'closed'` and `merged: true`. On receipt, call `triggerDimensionReAudit`.

---

## Finding 12 — getKeyFiles target patterns may miss framework-specific files

**Severity: P3**
**File:** `src/services/audit/github.ts` (lines 162-183)

The `targetPatterns` array covers common patterns (package.json, Dockerfile, routes/, middleware/) but misses framework-specific files for non-Node.js stacks: `Gemfile`, `requirements.txt`, `go.mod`, `Cargo.toml`, `build.gradle`, `pom.xml`, etc. Since Foundry's audit is positioned as stack-agnostic, missing these files means incomplete analysis for non-TypeScript products.

**Impact:** Audits of Python, Ruby, Go, or Java products will miss dependency and configuration files.

**Remediation:** Expand target patterns to include common dependency manifests across major ecosystems.

---

## Embarrassment Test

**Would a GitHub integration expert be embarrassed by this?** The plaintext token storage is the critical embarrassment. Everything else is defensible as "early-stage but functional." The rate-limit-aware retry logic, the proper use of the Git Data API (blobs -> trees -> commits -> ref update), and the confidence-gated remediation classification are all solid engineering.

## Pride Test

**What would make a GitHub expert proud?** The remediation classification system (AUTO / WISDOM_REQUIRED / HUMAN_ONLY) with the 0.7 confidence threshold is genuinely thoughtful. The PR body generation with blocking issue context, definition of done, and wisdom-layer attribution is professional-grade. The main/master fallback for branch detection shows practical awareness. The `githubFetchMutate` wrapper with separate retry logic for write operations is the right pattern.
