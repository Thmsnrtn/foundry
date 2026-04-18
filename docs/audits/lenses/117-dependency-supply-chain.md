# Lens 117 — Dependency Supply Chain

**Auditor Persona:** Security Depth (Tier 3)
**Date:** 2026-04-16
**Scope:** npm audit status, lockfile integrity, known vulnerable packages, dependency freshness

---

## Executive Summary

`npm audit` reports 7 vulnerabilities: 3 low, 4 moderate, 0 high, 0 critical. The vulnerabilities are in the `cookie` package (transitive dependency via `@clerk/backend`) and `esbuild` (build tool). The lockfile (`package-lock.json`) exists. No high or critical vulnerabilities are present, which is a clean state for a production application. However, there is no automated dependency scanning in CI/CD, no Dependabot or Renovate configuration, and no policy for addressing vulnerabilities.

---

## Findings

### DEP-01 — cookie package vulnerability in Clerk dependency (Severity: Low)

**Description:** The `cookie` npm package (version < 0.7.0) used by `@clerk/backend` accepts cookie names, paths, and domains with out-of-bounds characters (GHSA-pxg6-pf52-xh8x). This could allow cookie injection if an attacker controls cookie names.

**Evidence:**
- npm audit output: `cookie` < 0.7.0, severity: low, CWE-74.
- Fix requires upgrading `@clerk/clerk-sdk-node` to 5.1.6 (semver major).

**Remediation:** Upgrade `@clerk/clerk-sdk-node` to 5.x. This is a semver-major upgrade that may require API changes. Test Clerk integration thoroughly after upgrade.

---

### DEP-02 — esbuild moderate vulnerability (Severity: Low)

**Description:** esbuild has 4 moderate-severity vulnerabilities. Since esbuild is a build tool and does not execute in production, these are development-only concerns.

**Evidence:**
- npm audit output: `esbuild` — 4 moderate vulnerabilities.
- esbuild is listed as a devDependency (or transitive build dependency).

**Remediation:** Update esbuild to the latest version. Low urgency since it is build-time only.

---

### DEP-03 — No automated dependency scanning (Severity: Medium)

**Description:** There is no Dependabot, Renovate, or GitHub Actions workflow for automated dependency scanning. Vulnerabilities are only discovered when someone manually runs `npm audit`.

**Evidence:**
- No `.github/dependabot.yml` or `renovate.json` in the repository.
- No CI/CD configuration visible.
- Only 7 unit test files suggest minimal CI infrastructure.

**Remediation:** Add a Dependabot configuration: `.github/dependabot.yml` with weekly npm updates. Alternatively, add `npm audit --audit-level=high` as a CI step that fails on high/critical vulnerabilities.

---

### DEP-04 — lockfile exists and should be verified (Severity: Low)

**Description:** `package-lock.json` exists, which pins exact versions of all transitive dependencies. However, there is no lockfile integrity verification in the build process (e.g., `npm ci` vs `npm install`).

**Evidence:**
- `package-lock.json` exists in repository root.
- Without seeing the Dockerfile build step, it is unclear whether `npm ci` (strict lockfile) or `npm install` (potentially updates) is used.

**Remediation:** Verify the Dockerfile uses `npm ci` (not `npm install`) for production builds. This ensures the lockfile is the single source of truth for dependency versions.

---

### DEP-05 — 422 console.log calls suggest unaudited debug code (Severity: Low)

**Description:** The orientation document reports 422 `console.log/error/warn` occurrences across 40 files. While not directly a supply chain issue, this volume of unstructured logging suggests code that has not been through security review, increasing the risk of accidental secret or sensitive data logging.

**Evidence:**
- Orientation document: "422 console.log/error/warn occurrences across 40 files."
- Structured logger exists (`src/services/logger.ts`) but is not used consistently.

**Remediation:** Migrate all console.log/warn/error calls to the structured logger. This makes it easier to audit what data flows through logs.

---

## Embarrassment Test

A dependency of a dependency (4 levels deep) is compromised via a typosquat attack. Because there is no automated scanning, the compromised package sits in node_modules for months. A security researcher finds it and publicly discloses that Foundry ships a compromised dependency. **Likelihood: Low but industry-standard risk. Dependabot eliminates this.**

## Pride Test

Zero high or critical vulnerabilities in `npm audit` is a strong baseline. The presence of a lockfile ensures reproducible builds. The low/moderate vulnerabilities are in non-critical paths (build tools, transitive auth library dependencies).

## Distinct-Value Declaration

This lens provides the exact vulnerability count (7 total: 3 low, 4 moderate) with specific package names and remediation paths. The primary gap is not the current vulnerability state (which is clean) but the lack of automation to maintain this state.

## Tenancy-Critical Flag

**No.** Dependency vulnerabilities affect the application as a whole, not individual tenants. However, a compromised dependency that enables RCE would affect all tenants.
