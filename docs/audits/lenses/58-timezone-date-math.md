# Lens 58 — Time Zone / Date-Math Reviewer

**Auditor perspective:** Cron schedules (UTC?), date comparisons, snapshot dates, ISO vs local, SQLite `datetime()`, and the interaction between JavaScript `Date`, SQLite datetime functions, and founder timezones.

**Date:** 2026-04-16
**Codebase snapshot:** 72 cron jobs all configured in UTC, date-based queries using `datetime('now')` and `new Date().toISOString()`

---

## Executive Summary

All 72 cron jobs run in UTC, which is correct. However, the application treats all founders as if they are in UTC, with no timezone awareness for digest delivery, morning briefings, or "daily" metrics. The digest job (`digest_generate`) fires at Monday 7:00 UTC — a founder in San Francisco receives their "Monday morning" digest at 11 PM Sunday night. The metric snapshot job uses `new Date().toISOString().split('T')[0]` for the date, which is correct for UTC but means a founder ingesting metrics at 11 PM EST gets them attributed to the next day's UTC date. The `isoWeek()` function in the weekly plan generator has a subtle off-by-one bug for weeks crossing year boundaries. Date comparisons between JavaScript-generated ISO strings and SQLite's `datetime('now')` format can produce incorrect results due to format differences.

---

## Findings

### TZ-01. Digest and Briefing Delivery Ignores Founder Timezone

**Severity: P1**

The digest job comment says "Monday 7:00 AM per founder timezone" (`src/jobs/index.ts:157`), but the cron schedule is `0 7 * * 1` (UTC). There is no timezone-aware scheduling. A founder in UTC+9 (Tokyo) receives their "Monday morning" digest at 4 PM Monday. A founder in UTC-8 (San Francisco) receives it at 11 PM Sunday.

**Evidence:**
- `src/jobs/index.ts:1799` — `digest_generate: { schedule: '0 7 * * 1' }` — Monday 7:00 UTC
- `src/jobs/index.ts:1820` — `morning_briefings: { schedule: '30 6 * * *' }` — daily 6:30 UTC
- `src/db/migrations/001_initial.sql:17` — `preferences TEXT -- JSON: digest time, notification channels` — the schema stores preferences but the job ignores them
- The `founders` table has a `preferences` column that could store timezone, but no timezone field is defined
- All 72 jobs use UTC cron expressions with no per-founder adjustment

**Remediation:** Add a `timezone` field to the `founders` table (default `UTC`). For time-sensitive jobs (digest, morning briefing), group founders by timezone and schedule delivery windows. Alternatively, compute per-founder delivery times in the job: `if (currentHourInFounderTZ !== 7) continue;`.

**Target phase:** P1

---

### TZ-02. Metric Snapshot Date Attribution Depends on UTC Clock

**Severity: P1**

`src/jobs/index.ts:200` — `const today = new Date().toISOString().split('T')[0]` creates the metric snapshot date in UTC. The ingest endpoint (`src/routes/ingest/index.ts:118`) uses the same pattern. A founder pushing metrics via the ingest API at 11 PM EST (4 AM UTC next day) gets those metrics attributed to the next UTC day, not "today" in their timezone.

**Evidence:**
- `src/jobs/index.ts:200` — `new Date().toISOString().split('T')[0]` — UTC date
- `src/routes/ingest/index.ts:118` — same pattern
- `src/services/integrations/stripe-webhook.ts:181` — `new Date().toISOString().split('T')[0]!` — same pattern
- The Signal dashboard shows metrics by date, but dates are UTC-relative
- No documentation warns API consumers that dates are UTC

**Remediation:** Document that all dates in the system are UTC. In the ingest API docs, note that `snapshot_date` is UTC. Optionally, allow the ingest API to accept an explicit `date` parameter.

**Target phase:** P2

---

### TZ-03. `isoWeek()` Function Off-by-One for Year-Boundary Weeks

**Severity: P2**

`src/jobs/index.ts:800-807` — the `isoWeek()` function computes ISO week numbers. The algorithm has a known edge case: days in early January can belong to week 52/53 of the previous year, and days in late December can belong to week 1 of the next year. The function returns `${d.getUTCFullYear()}-W${weekNo}` which uses the adjusted year for the week calculation but the original year for the prefix.

**Evidence:**
- `src/jobs/index.ts:800-807`:
  ```typescript
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  ```
- Line 806 correctly uses `d.getUTCFullYear()` after the Thursday adjustment, which handles the year-boundary case correctly
- However, the `weekNo` calculation can produce 53 for some years but the function does not validate this
- The `weekly_plans` table uses `week_of` as a UNIQUE constraint with product_id, so a week-53 week in one year that should be week-1 of the next year would create a duplicate key if the formula is wrong

**Remediation:** Use a well-tested ISO week library (e.g., `date-fns/getISOWeek`) instead of hand-rolling the calculation. Add unit tests for year-boundary dates (Dec 31 2026, Jan 1 2027).

**Target phase:** P2

---

### TZ-04. Date Format Mismatch Between JavaScript and SQLite

**Severity: P2**

JavaScript `new Date().toISOString()` produces `2026-04-16T14:30:00.000Z`. SQLite `CURRENT_TIMESTAMP` produces `2026-04-16 14:30:00`. SQLite `datetime('now')` produces the same format. These formats differ in the `T` separator and the `Z` suffix. Most SQLite date comparisons work because SQLite's `datetime()` function parses both formats, but string comparisons (used in some queries) can produce incorrect results.

**Evidence:**
- `src/jobs/index.ts:387` — `datetime('now', '-1 day')` in SQL — produces `2026-04-15 14:30:00`
- `src/middleware/auth.ts:128` — `CURRENT_TIMESTAMP` in UPDATE
- `src/jobs/index.ts:241` — `new Date().toISOString()` written to `prompt_9_started_at`
- `src/routes/dashboard/audit-log.ts:73` — `AND created_at >= ?` with a user-provided `since` parameter — the comparison works if both sides use the same format, but if one is ISO and the other is SQLite format, string comparison may fail
- The `stressor_history.identified_at` column uses `DEFAULT CURRENT_TIMESTAMP` (SQLite format) but jobs write `new Date().toISOString()` (ISO format)

**Remediation:** Standardize: always write dates using `CURRENT_TIMESTAMP` or `datetime('now')` in SQL, and `new Date().toISOString()` in JavaScript. For date comparisons, always use SQLite's `datetime()` function to normalize both sides: `datetime(created_at) >= datetime(?)`.

**Target phase:** P2

---

### TZ-05. Day-of-Week Check for Yellow Pulse Uses Local Server Day

**Severity: P2**

`src/jobs/index.ts:173` — `else if (riskState === 'yellow' && new Date().getDay() === 4)` checks if today is Thursday using JavaScript's `getDay()` (0=Sunday, 4=Thursday). The cron job runs at UTC 7:00, so `new Date()` at that moment is in UTC. This is correct. However, `getDay()` returns the day in the server's local timezone, not UTC. On a Fly.io instance with a non-UTC system clock, this could return the wrong day.

**Evidence:**
- `src/jobs/index.ts:173` — `new Date().getDay() === 4` — uses local timezone
- Should be `new Date().getUTCDay() === 4` to ensure UTC consistency
- Fly.io instances typically use UTC, but this is not guaranteed

**Remediation:** Change `getDay()` to `getUTCDay()`. This is a one-character fix that prevents a subtle bug if the server ever runs in a non-UTC timezone.

**Target phase:** P2

---

### TZ-06. Cold Start Check Uses `Date.now()` for Day Calculation Without UTC Normalization

**Severity: P3**

`src/jobs/index.ts:232` — `const daysSinceCreation = Math.floor((Date.now() - createdAt.getTime()) / 86400000)`. This calculation is correct since both `Date.now()` and `getTime()` return UTC milliseconds. However, `p.created_at` was stored by SQLite's `DEFAULT CURRENT_TIMESTAMP` which may not include timezone info. `new Date(p.created_at)` parses the SQLite format as local time, not UTC, introducing a timezone-dependent error.

**Evidence:**
- `src/jobs/index.ts:231` — `const createdAt = new Date(p.created_at)` — parses SQLite datetime as local time
- SQLite `CURRENT_TIMESTAMP` produces `2026-04-16 14:30:00` — no timezone indicator
- JavaScript `new Date('2026-04-16 14:30:00')` parses this as local time on the server
- On a UTC server, this is correct. On a non-UTC server, the parsed time differs by the timezone offset

**Remediation:** Append `Z` when parsing SQLite datetimes: `new Date(p.created_at + 'Z')`. Or standardize all writes to use ISO format with `Z` suffix.

**Target phase:** P3

---

## Embarrassment Test

1. **"A founder in San Francisco receives their 'Monday morning' digest at 11 PM Sunday night because the system has zero timezone awareness"** — The comment says "per founder timezone" but the code uses fixed UTC.

2. **"Metric snapshots are attributed to UTC dates, so a founder pushing metrics at 11 PM EST sees them appear on 'tomorrow's' dashboard"** — Confusing date attribution with no documentation.

3. **"`new Date().getDay()` instead of `getUTCDay()` means the Yellow Pulse Thursday check could fire on the wrong day on a non-UTC server"** — A one-character bug that changes behavior based on server timezone.

## Pride Test

1. All 72 cron jobs use UTC timezone strings (`'UTC'` parameter to `CronJob`), which is the correct practice for server-side scheduling.

2. The Signal history uses `date('now')` consistently for snapshot dates, ensuring all signal readings for a product use the same UTC-relative date.

3. The `isoWeek()` function correctly handles the ISO 8601 week-year boundary by adjusting to the nearest Thursday before computing the year.

## Distinct-Value Declaration

This lens traces date/time handling across the JavaScript/SQLite/cron boundary — a three-way interaction that no single Tier 1 lens covers. The backend lens may note "no timezone support" but cannot trace the specific code path from `getDay()` vs `getUTCDay()` or the format mismatch between JavaScript's ISO strings and SQLite's `CURRENT_TIMESTAMP`. The date-math implications of the `isoWeek` function's year-boundary behavior are unique to this specialty.

## Tenancy-Critical Flag

**TZ-01** is tenancy-critical: all founders share the same UTC-fixed schedule regardless of their timezone, meaning the product's value proposition ("Monday morning briefing") fails for any founder not in a UTC-compatible timezone.
