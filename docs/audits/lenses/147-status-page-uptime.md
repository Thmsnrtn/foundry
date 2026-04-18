# Lens 147 — Status Page / Uptime Communication

**Distinct value:** Evaluates whether Foundry has a public-facing status page, whether the health check system can power it, and whether uptime monitoring is configured. Traces the full path from health check endpoint to public communication.

**Tenancy-critical:** No. A status page is a global resource, not per-tenant. However, the absence of a status page affects all tenants equally and erodes trust during outages.

## Executive Summary

Foundry has a health check endpoint at `/internal/health` that checks database connectivity and Anthropic/Clerk configuration. This endpoint is functional but insufficient to power a status page: it does not check all critical services (Stripe, Resend, GitHub), does not track historical uptime, and is gated behind internal authentication. There is no public `/status` route, no external status page service, and no uptime monitoring configured. The terms of service promise 99.9% uptime as a target but there is no mechanism to measure, report, or enforce this.

## Health Check Analysis

### Current Implementation (`src/routes/internal/health.ts`)

```
GET /internal/health
```

**Checks performed:**
| Check | Method | What It Detects | What It Misses |
|-------|--------|----------------|----------------|
| Database | `SELECT 1` | Total DB failure | Slow queries, connection pool exhaustion, read replica lag |
| Anthropic | `process.env.ANTHROPIC_API_KEY` present | Missing env var | API outage, rate limiting, key revocation |
| Clerk | `process.env.CLERK_SECRET_KEY` present | Missing env var | API outage, key revocation |

**Not checked:**
| Service | Why It Matters | Impact if Down |
|---------|---------------|----------------|
| Stripe | Billing operations | Subscription changes fail, checkout broken |
| Resend | Email delivery | Digests, behavioral triggers, deletion confirmations fail |
| GitHub API | Audit engine, PR generation | Onboarding audit blocked, remediation broken |
| Turso replication | Data freshness | Stale reads in multi-region setup |
| Cron job health | Background processing | Missed agent runs, missed digests, missed scans |

**Response format:**
```json
{
  "status": "ok" | "degraded",
  "timestamp": "2026-04-16T...",
  "version": "0.1.0",
  "checks": {
    "database": "ok" | "error",
    "anthropic_configured": "ok" | "error",
    "clerk_configured": "ok" | "error"
  }
}
```

The response is minimal but well-structured. It returns 200 for healthy and 503 for degraded, which Fly.io uses for routing decisions.

### Fly.io Health Check Configuration (`fly.toml`)

```toml
[[http_service.checks]]
  interval = "30s"
  timeout = "10s"
  grace_period = "30s"
  method = "GET"
  path = "/internal/health"
```

This is correctly configured. Fly.io checks every 30 seconds and will stop routing to an unhealthy instance after the grace period. But this only affects Fly.io's load balancer -- there is no external visibility.

## Public Status Page — Does Not Exist

### What Was Searched

- No `/status` route in any route file
- No integration with Instatus, Statuspage.io, Cachet, or any status page provider
- No static status page in the public routes
- No reference to a status page URL in any documentation or UI

### What the Terms of Service Promise

From `src/routes/public/landing.ts:353-354`:
> "We target 99.9% uptime but do not guarantee it. Scheduled maintenance will be announced in advance."

This creates a communication obligation with no delivery mechanism.

### What Founders See During Outages

| Outage Type | What Founders See |
|-------------|------------------|
| Full outage (DB) | Browser timeout or Fly.io default error page |
| Partial outage (AI) | Dashboard renders normally, AI Ask returns error JSON, no explanation |
| Deploy in progress | Brief 502 from Fly.io during restart (rolling deploy mitigates) |
| Migration error | 500 errors on affected routes, no explanation |

## Uptime Monitoring — Not Configured

### External Monitoring

There is no evidence of any external uptime monitoring service:
- No Pingdom, UptimeRobot, Better Uptime, or similar integration
- No alerting webhook configured in Fly.io metrics
- No synthetic monitoring (periodic requests to verify end-to-end functionality)

### Internal Monitoring

The Fly.io metrics dashboard provides basic infrastructure metrics (CPU, memory, network) but:
- These are not accessible to founders
- They do not measure application-level health (response times, error rates, AI call success rates)
- There is no alerting configured on any metric

### Historical Uptime Tracking

There is no mechanism to track or report historical uptime:
- No uptime percentage calculation
- No incident log (when was the system last down, for how long)
- No SLA tracking against the 99.9% target
- Process uptime is tracked (`process.uptime()` in `src/services/founder/intelligence.ts:102`) but this is per-process uptime (time since last restart), not service availability

## What a Minimal Status Page Needs

| Requirement | Status |
|-------------|--------|
| Public URL (e.g., status.foundry.so) | Does not exist |
| Current system status (operational/degraded/outage) | Health check exists but is internal-only |
| Per-component status (Database, AI, Billing, Email) | Health check only covers 3 of 6 components |
| Historical uptime percentage | Not tracked |
| Incident timeline (current and past) | Not tracked |
| Subscription for updates (email, webhook, RSS) | Does not exist |
| Scheduled maintenance announcements | Does not exist |
| Independent of main infrastructure | N/A (no status page at all) |

## Findings Summary

| # | Finding | Severity | Description |
|---|---------|----------|-------------|
| 1 | No public status page | P1 | Founders have no visibility into service health |
| 2 | Health check is incomplete | P1 | Only checks 3 of 6 critical services |
| 3 | No external uptime monitoring | P1 | Outages detected only by founder complaints |
| 4 | No historical uptime tracking | P2 | Cannot report against the 99.9% target in ToS |
| 5 | No alerting on any metric | P1 | Team not notified of outages automatically |
| 6 | Health check gated behind internal auth | P2 | Cannot be used as a public status endpoint without modification |
| 7 | ToS promises uptime communication with no delivery mechanism | P2 | Legal/trust risk |
| 8 | No component-level degradation reporting | P2 | "AI is down but dashboard works" is not communicable |

## Priority Remediation

1. **P1:** Set up external uptime monitoring (UptimeRobot free tier or similar) pointing at `/internal/health` with alerts to email/Slack
2. **P1:** Expand health check to include Stripe, Resend, and GitHub API connectivity (lightweight pings with caching)
3. **P1:** Create a public status page on an independent domain (Instatus or Statuspage.io have free tiers, or deploy a static page to a separate service)
4. **P2:** Add historical uptime tracking by logging health check results to a time-series table or external service
5. **P2:** Add founder-facing system status to the dashboard layout (subtle indicator in the header powered by the health check)
6. **P2:** Implement scheduled maintenance mode that updates the status page and returns a friendly maintenance page to users
