# Lens 120 — SSRF Around Agent Tools + GitHub PR Tools

**Auditor Persona:** Security Depth (Tier 3)
**Date:** 2026-04-16
**Scope:** Can the Remediation Engine be tricked into fetching internal URLs or writing to unexpected repos?

---

## Executive Summary

Foundry's Remediation Engine generates code fixes via Claude Opus and commits them to the founder's GitHub repository via the GitHub API. The SSRF risk surface has two components: (1) the AI could generate file paths that write outside the expected repository tree, and (2) the GitHub API calls use the founder's stored access token to target `repos/{owner}/{repo}`, where `owner` and `repo` come from the database. A compromised product record (via SQL injection or admin access) could redirect PR creation to a different repository. Additionally, the Remediation Engine's prompt includes repository file contents fetched from GitHub — there is no validation that the fetched URLs are actually GitHub API URLs, though they are constructed from hardcoded base URLs.

---

## Findings

### SSRF-01 — GitHub API URLs are safely constructed from hardcoded base (Severity: Low)

**Description:** All GitHub API calls use a hardcoded base URL (`https://api.github.com`) concatenated with path parameters from the database (`owner`, `repo`, branch names). There is no user-supplied URL passed directly to `fetch()`.

**Evidence:**
- `src/services/audit/github.ts:34`: `const GITHUB_API = 'https://api.github.com'`.
- `src/services/audit/github.ts:46`: `fetch(url, ...)` where `url` is always `${GITHUB_API}/repos/${owner}/${repo}/...`.
- `owner` and `repo` come from `products.github_repo_owner` and `products.github_repo_name` — set during onboarding via GitHub API response, not directly by user input.

**Remediation:** Validate that `owner` and `repo` match the expected pattern (`/^[a-zA-Z0-9._-]+$/`) before constructing URLs. This prevents path traversal in the URL.

---

### SSRF-02 — Remediation Engine writes to founder's repo only (Severity: Low)

**Description:** The PR creation flow uses `owner`, `repo`, and `token` from the product record. These are set during GitHub OAuth onboarding and cannot be changed by the founder through the UI (only via direct database access). The Remediation Engine cannot be redirected to write to an arbitrary repository through normal application usage.

**Evidence:**
- `src/services/audit/remediation.ts:100-180`: `generateFix` receives `productId` and looks up the product's GitHub credentials from the database.
- `src/services/audit/engine.ts:22`: `const { github_repo_owner: owner, github_repo_name: repo, github_access_token: token } = product`.
- The token is scoped to the founder's GitHub account permissions.

**Remediation:** Low priority. The current design is safe against SSRF because the target is always the founder's own repository with their own token.

---

### SSRF-03 — AI-generated file paths in PR not validated (Severity: Medium)

**Description:** The Remediation Engine asks Claude Opus to generate file changes with `{ path: "src/example.ts", full_content: "..." }`. The `path` in the AI response is used directly in the GitHub commit API (`commitFiles`). Claude could theoretically generate a path like `../../.github/workflows/malicious.yml` that writes a GitHub Actions workflow to the repository, which would execute arbitrary code on the next push.

**Evidence:**
- `src/services/audit/remediation.ts:156-163`: AI prompt asks for `"files": [{"path": "src/example.ts", "full_content": "..."}]`.
- `src/services/audit/github.ts:289`: `treeItems.push({ path: file.path, mode: '100644', type: 'blob', sha: blobData.sha })` — `file.path` is the AI-supplied path, used directly in the Git tree.
- No path validation or sanitization between AI output and GitHub commit.

**Remediation:** Validate AI-generated file paths:
1. Reject paths containing `..` segments.
2. Reject paths starting with `.github/workflows/` unless explicitly allowed.
3. Reject paths outside the repository root.
4. Whitelist allowed file extensions (`.ts`, `.js`, `.json`, `.md`, `.yml` for configs).

---

### SSRF-04 — Integration fetch calls use URLs from credentials (Severity: Medium)

**Description:** Some integration services construct fetch URLs using data from the `credentials_json` or `config_json` columns. If an attacker gains access to update integration configuration (e.g., via XSS or CSRF), they could set a `host` or `url` field pointing to an internal service.

**Evidence:**
- `src/services/integrations/sync.ts:106`: `credentials as { api_key: string; project_id: string; host?: string }` — PostHog integration uses a `host` field from credentials.
- `src/services/integrations/posthog.ts:12`: PostHog credentials include `api_key` and potentially a custom `host`.
- `src/services/api/webhooks.ts:188`: `fetch(url, ...)` — webhook URLs are founder-configured.

**Remediation:** Validate integration URLs:
1. Reject URLs with private IP ranges (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16).
2. Reject URLs with `localhost` or `internal` hostnames.
3. Only allow HTTPS URLs for webhook destinations.

---

### SSRF-05 — Webhook bridge allows founder-configured URLs (Severity: Medium)

**Description:** The webhook bridge service allows founders to configure outbound webhooks with custom URLs. These URLs are fetched by the server when events trigger, creating a direct SSRF vector if the URL points to internal services.

**Evidence:**
- `src/services/integration/webhook-bridge.ts:193`: Field mappings parsed from database, webhook URLs fetched by the server.
- `src/services/notifications/push.ts:248`: `fetch(webhook.url, ...)` — user-configured webhook URL.
- `src/services/chat/coo.ts:220`: `fetch(wh.webhook_url, ...)` — another user-configured URL.

**Remediation:** Implement a URL validation function that blocks internal/private URLs. Apply it to all user-configured webhook URLs before saving and before fetching.

---

## Embarrassment Test

A founder configures a webhook URL pointing to `http://169.254.169.254/latest/meta-data/` (AWS metadata endpoint). Foundry's server fetches this URL, retrieves the Fly.io machine's metadata (or equivalent), and returns it in the webhook response. The founder now has access to internal infrastructure metadata. **Likelihood: Medium. This is a classic SSRF pattern that many web applications have fallen prey to.**

## Pride Test

The GitHub API integration constructs all URLs from a hardcoded base URL, which is the correct pattern for preventing SSRF. The use of founder's own OAuth token limits the blast radius — even if the API URL were manipulated, the token only has the founder's own permissions.

## Distinct-Value Declaration

This lens identifies two distinct SSRF surfaces: (1) AI-generated file paths in the Remediation Engine that could write malicious GitHub Actions workflows, and (2) founder-configured webhook/integration URLs that can target internal services. The file path vector is unique to Foundry's autonomous PR generation architecture.

## Tenancy-Critical Flag

**Yes, partially.** SSRF via webhook URLs could access Fly.io internal services or metadata endpoints. While the Turso database is accessed via authenticated URL (not internal network), other internal services or cloud metadata could be exposed. The AI-generated file path vector is scoped to the founder's own repository and does not cross tenants.
