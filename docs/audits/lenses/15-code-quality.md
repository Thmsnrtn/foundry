# Lens 15 — Code Quality Engineer

## Executive Summary

Foundry's codebase shows strong architectural intent — clean file headers, consistent module structure, domain-driven service organization, and well-separated concerns at the directory level. However, execution has accumulated significant quality debt: a 1,865-line god file (`jobs/index.ts`) containing all 26 scheduled jobs, 6 duplicate implementations of `timeAgo()` and 3 of `formatDate()`, 422 `console.log/warn/error` calls instead of structured logging, helper functions redefined in every route file rather than shared, and route files that mix data fetching, business logic, and HTML rendering in single functions averaging 80-150 lines. The code is consistent enough to be fixable with systematic refactoring rather than a rewrite.

## Findings

### CQ-01 God File: `jobs/index.ts` at 1,865 Lines
- **Severity:** P1
- **Description:** All 26 scheduled jobs are defined in a single file. Each job is 40-80 lines of orchestration code. The file has 37 imports and handles lifecycle checks, competitive scans, stressor analysis, risk state transitions, digest generation, billing enforcement, PR monitoring, growth stage detection, geopolitical scanning, and more. Modifying one job risks breaking others. The file is impossible to review in a single screen.
- **Evidence:** `src/jobs/index.ts` (1,865 lines, 37 imports, 26 exported async functions)
- **Remediation:** Split into `jobs/lifecycle.ts`, `jobs/intelligence.ts`, `jobs/billing.ts`, `jobs/audit.ts`, `jobs/digest.ts`, etc. Keep `jobs/index.ts` as a registry that imports and re-exports.
- **Target Phase:** 3

### CQ-02 Duplicate Utility Functions Across Route Files
- **Severity:** P1
- **Description:** Common formatting functions are reimplemented in multiple files instead of being shared: `timeAgo()` appears in 6 files, `formatDate()` in 3 files, `fmtCents()`/`formatCents()` in 2 files, `fmtCost()` in 2 files, `fmtRelTime()` in at least 2 files, and color/badge helper functions (`healthColor()`, `statusBadge()`, `severityBadge()`) are redefined in nearly every dashboard route file.
- **Evidence:** `timeAgo`: `agents.ts`, `agents-messages.ts`, `agents-actions.ts`, `agents-inbox.ts`, `agents-customers.ts`, `execution-playbooks.ts`. `formatDate`: `components.ts`, `agents-wisdom.ts`, `agents-remediations.ts`. `fmtCents`/`formatCents`: `components.ts`, `scenarios.ts`.
- **Remediation:** Create `src/views/helpers.ts` for formatting functions (timeAgo, formatDate, fmtCents, fmtCost, fmtTokens, fmtRelTime) and `src/views/badges.ts` for badge/color helpers. Import everywhere.
- **Target Phase:** 2

### CQ-03 422 `console.log/warn/error` Calls — No Structured Logging
- **Severity:** P1
- **Description:** There are 422 `console.log/error/warn` occurrences across 40 files. The worst offender is `jobs/index.ts` with 205 console calls (every job start, iteration, and completion is logged via console). This produces unstructured, unparseable logs in production with no log levels, no correlation IDs, and no JSON formatting for log aggregation.
- **Evidence:** `src/jobs/index.ts:41,48-50,54` (pattern: `console.log('[JOB] lifecycle_check starting')` repeated for all 26 jobs), 422 total across 40 files per orientation doc
- **Remediation:** Introduce a structured logger (pino or winston) with JSON output. Replace `console.log('[JOB]')` with `logger.info({ job: 'lifecycle_check', productId }, 'job started')`. Can be done incrementally — start with `jobs/index.ts` (205 occurrences = 49% of total).
- **Target Phase:** 2

### CQ-04 Route Files Mix Three Concerns in Single Functions
- **Severity:** P2
- **Description:** Dashboard route handlers typically do all of: (1) fetch data from multiple DB queries, (2) transform/compute derived values, (3) construct HTML template literals — all in a single `async (c) => { ... }` function body. This makes routes untestable (can't test data logic without HTTP context), hard to read (80-150 lines per handler), and impossible to reuse the data layer.
- **Evidence:** `src/routes/dashboard/decisions.ts:22-42` (fetches layout context + lifecycle state + decision queue + constructs HTML in one handler), `src/routes/dashboard/agents.ts` (747 lines with helpers interspersed between route handlers)
- **Remediation:** Extract data fetching into service functions that return typed DTOs. Route handlers become: `const data = await getDecisionPageData(founder, productId); return c.html(renderDecisionPage(ctx, data))`. Not urgent but dramatically improves testability.
- **Target Phase:** 3

### CQ-05 Large Route Files (Multiple >500 Lines)
- **Severity:** P2
- **Description:** Many dashboard route files exceed 500 lines: `agents.ts` (747), `exit.ts` (619), `signals-multimodal.ts` (602), `decisions.ts` (588), `agents-integrations.ts` (583), `memory.ts` (574), `board-packet.ts` (561), `agents-transparency.ts` (518), `ambient.ts` (509). The entrypoint `index.ts` is 512 lines with all route mounting and 26 cron job registrations.
- **Evidence:** File sizes listed above (measured via `wc -l`)
- **Remediation:** Split route files that exceed 300 lines. For example, `agents.ts` can split into `agents-roster.ts` (list view) and `agents-detail.ts` (detail view). Extract cron registration from `index.ts` into `jobs/scheduler.ts`.
- **Target Phase:** 3

### CQ-06 Inline Style Strings Returned from Helper Functions
- **Severity:** P2
- **Description:** Several route-level helper functions return raw HTML strings with inline styles rather than using CSS classes. For example, `ambient.ts:20-31` defines a `card()` function that returns a template string with 8 inline style declarations. `agents-transparency.ts:52-55` defines `statusBadge()` returning inline-styled HTML strings. This pattern bypasses the CSS design system and creates style inconsistency.
- **Evidence:** `src/routes/dashboard/ambient.ts:20-31` (card function with inline styles), `src/routes/dashboard/agents-transparency.ts:52-55` (statusBadge with inline styles), `src/routes/dashboard/agents.ts:69-79` (lessonTypeBadge, statusDot with inline styles)
- **Remediation:** Move these patterns into `views/components.ts` using CSS classes from the design system. Inline styles should be reserved for truly dynamic values (widths from data).
- **Target Phase:** 3

### CQ-07 Inconsistent Naming Conventions
- **Severity:** P2
- **Description:** File and export naming is inconsistent across the codebase: route files use kebab-case with varying prefixes (`agents-evolve.ts`, `agents-transparency.ts`, `agent-intelligence.ts` — note singular vs plural). Export names mix styles: `agentRoutes` vs `agentsTransparency` vs `ambientRoutes`. Service directories have both `customer/` (singular) and `customers/` (plural) with overlapping functionality. Function prefixes vary: `fmt` vs `format` for the same concept.
- **Evidence:** `src/routes/dashboard/agent-intelligence.ts` (singular) vs `src/routes/dashboard/agents-accuracy.ts` (plural), `src/services/customer/intelligence.ts` vs `src/services/customers/intelligence.ts` (both exist), `fmtCents` vs `formatCents`, `fmtCost` vs `fmtRelTime` vs `formatDate`
- **Remediation:** Establish and document naming conventions: plural for route groups (`agents-*.ts`), singular for service domains (`customer/`). Standardize on `format*` prefix for all formatting functions.
- **Target Phase:** 4

### CQ-08 Hardcoded Founder Email Check for Admin Features
- **Severity:** P2
- **Description:** Admin-only features (Founder Ops) are gated by a hardcoded email check: `founderEmail?.toLowerCase() === 'thmsnrtn@gmail.com'`. This is fragile (email changes break it), not scalable (can't add admins), and leaks the founder's personal email into source code.
- **Evidence:** `src/views/layout.ts:316`
- **Remediation:** Add an `is_admin` boolean to the `founders` table or use Clerk organization roles. Check `founder.is_admin` instead of comparing email strings.
- **Target Phase:** 2

### CQ-09 Comment Quality is Strong but Sections Rely on Banner Comments
- **Severity:** P3
- **Description:** The codebase has excellent section header comments (`// === FOUNDRY --- ...`, `// --- Section Name ---`) and file-level docstrings explaining purpose. However, complex business logic within functions lacks explanatory comments. The banner comment style is consistent and helps navigation but sometimes substitutes for proper function extraction.
- **Evidence:** `src/jobs/index.ts:1-4` (good file header), `src/views/layout.ts:1-4` (good file header), `src/db/client.ts:64-66` (good section headers with docstrings)
- **Remediation:** Low priority. Add inline comments for non-obvious business logic (risk state transitions, signal score calculation, gate level decisions).
- **Target Phase:** 4

### CQ-10 Dead/Vestigial Service Directories
- **Severity:** P3
- **Description:** The services directory contains both `customer/` and `customers/` with overlapping intelligence modules. The `services/chat/coo.ts` has a `return result.rows as any` suggesting it may be a quick prototype. Without a service registry or documentation of which modules are active vs. deprecated, maintainability suffers.
- **Evidence:** `src/services/customer/intelligence.ts` and `src/services/customers/intelligence.ts` (both exist), `src/services/chat/coo.ts:181` (`return result.rows as any`)
- **Remediation:** Audit service directories, merge duplicates, archive deprecated modules. Add a brief `README.md` or index comment to each service directory.
- **Target Phase:** 4

## Embarrassment Test
1. A new developer is asked to "fix the time formatting" and finds 6 different `timeAgo()` implementations across route files — fixes one, misses five, ships inconsistent time display.
2. A production incident requires log analysis but all 422 logging calls are unstructured `console.log` strings — no way to filter by job name, product ID, or severity without regex-parsing raw text.
3. The entire scheduled job system lives in one 1,865-line file — a merge conflict on line 400 of `jobs/index.ts` requires understanding the context of all 26 jobs to resolve safely.

## Pride Test
1. File headers are consistently formatted across the entire codebase — every file has a `// === FOUNDRY --- [Purpose]` header and section dividers. This is rare discipline for a fast-moving startup codebase.
2. The `_shared.ts` pattern for dashboard routes (`getLayoutContext`) is a well-executed shared data loader that eliminates duplication of auth/product/UX context fetching across 59 route files.
3. The service layer organization by domain (`intelligence/`, `scp/`, `audit/`, `billing/`, `digest/`, `integration/`) reflects genuine domain-driven design thinking. Each directory has clear bounded context even if internal quality varies.
