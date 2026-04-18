# Lens 150 — Post-Mortem Framework Readiness

**Distinct value:** Evaluates whether Foundry has a structured process for learning from incidents: Is there a post-mortem template? Where are post-mortems stored? Who reviews them? Are action items tracked to completion? Is there a blameless culture encoded in the process? This is about organizational learning infrastructure, not about any specific incident.

**Tenancy-critical:** No. Post-mortem processes are internal engineering practices. However, the absence of a learning framework means tenant-impacting incidents recur, which makes this indirectly tenancy-relevant.

## Executive Summary

Foundry has no post-mortem framework. There is no template, no storage location, no review process, no action item tracking, and no evidence of any past incident being formally documented. The audits directory contains extensive pre-launch analysis but zero post-mortem documents. The codebase has no incident or post-mortem related types, routes, or services. This is expected for a pre-launch product, but the framework should exist before the first incident, not after.

## Assessment Areas

### 1. Post-Mortem Template — Does Not Exist

No file matching `*post-mortem*`, `*postmortem*`, `*incident-report*`, or `*incident-template*` exists anywhere in the repository. No template document in `docs/operations/`, `docs/`, or project root.

**What a good template includes:**

| Section | Purpose | Status |
|---------|---------|--------|
| Incident title and date | Identification | Not defined |
| Severity level (P0-P3) | Prioritization | P0-P3 used in audits but not defined for incidents |
| Duration (detection to resolution) | Measuring response effectiveness | Not defined |
| Impact (users affected, data loss, revenue loss) | Quantifying damage | Not defined |
| Timeline (chronological events) | Reconstructing what happened | Not defined |
| Root cause analysis | Understanding the failure | Not defined |
| Contributing factors | Understanding the environment | Not defined |
| What went well | Reinforcing good practices | Not defined |
| What went poorly | Identifying gaps | Not defined |
| Action items (owner, due date, status) | Driving improvement | Not defined |
| Lessons learned | Knowledge transfer | Not defined |
| Detection method | Improving monitoring | Not defined |

### 2. Post-Mortem Storage — No Location Defined

**Candidate locations examined:**
- `docs/operations/` — Contains only `runbook.md`
- `docs/` — No `incidents/` or `post-mortems/` directory
- No database table for incident records
- No external tool integration (PagerDuty, Rootly, incident.io, etc.)

**The audit log table** (`agent_audit_log`) records agent activities but not operational incidents. It has fields for `event_type`, `description`, and `metadata_json` which could theoretically store incident records, but this is not its purpose and it lacks the structure needed for post-mortems.

### 3. Review Process — Not Defined

There is no documented process for:
- When a post-mortem should be written (after every P0? Every customer-visible incident?)
- Who writes the post-mortem (incident responder? team lead?)
- Who reviews it (engineering team? founder? affected customers?)
- When the review happens (within 48 hours? weekly meeting?)
- Whether the post-mortem is shared externally (with affected founders, publicly)

### 4. Action Item Tracking — Not Implemented

Post-mortem action items need to be tracked to completion. Currently:
- No issue tracker integration (Linear, GitHub Issues, Jira)
- No action item table in the database
- The `docs/backlog/` directory exists but is empty
- The `docs/blockers/` directory exists but is empty
- Audit findings have "Priority Remediation" sections but no tracking mechanism

### 5. Blameless Culture Encoding — Not Present

A blameless post-mortem culture is typically encoded through:
- A written statement in the template ("This post-mortem is blameless. We focus on systems, not individuals.")
- Facilitator guidelines that redirect blame to systemic factors
- Separation of the timeline (what happened) from the analysis (why it happened)

None of this exists because no template or process exists.

### 6. Recurring Issue Detection — Not Possible

Without post-mortem records, it is impossible to detect recurring issues. If the same failure (e.g., Anthropic rate limiting during high-agent-run periods) happens three times, there is no record of the first two occurrences to pattern-match against.

**What would enable recurring issue detection:**
- A structured post-mortem database (tags, root cause categories, affected components)
- Periodic review of post-mortem trends (quarterly)
- Integration with monitoring to correlate alerts with past incidents

## Comparison with Industry Practices

| Practice | Google SRE | Foundry |
|----------|-----------|---------|
| Post-mortem template | Standardized, blameless | Does not exist |
| Trigger criteria | Any user-visible downtime, data loss, or on-call escalation | Not defined |
| Writing deadline | Within 1-2 business days | Not defined |
| Review meeting | Scheduled review with stakeholders | Not defined |
| Action item tracking | Bug tracker integration, follow-up reviews | Not implemented |
| Public post-mortems | Published for major incidents | Not considered |
| Trend analysis | Quarterly review of post-mortem themes | Not possible |

## Related Infrastructure Gaps

The post-mortem framework depends on other infrastructure that is also missing:

| Dependency | Status | Impact on Post-Mortems |
|-----------|--------|----------------------|
| Structured logging | Exists (`src/services/logger.ts`) but most code still uses `console.log` | Cannot reconstruct timeline from logs |
| Request tracing / correlation IDs | Does not exist | Cannot trace a specific request's path through the system |
| Error tracking (Sentry/similar) | Not configured | Cannot aggregate errors or detect patterns |
| Uptime monitoring | Not configured | Cannot determine exact incident duration |
| Alerting | Not configured | Cannot document "how was the incident detected" |
| Runbook | Exists but incomplete | Post-mortem action items may reference runbook procedures that do not exist |

## Findings Summary

| # | Finding | Severity | Description |
|---|---------|----------|-------------|
| 1 | No post-mortem template | P1 | No structured format for incident documentation |
| 2 | No storage location for post-mortems | P1 | No directory, database table, or external tool |
| 3 | No review process defined | P1 | No trigger criteria, writing deadline, or review meeting |
| 4 | No action item tracking | P1 | Post-mortem findings have no path to resolution |
| 5 | No blameless culture encoding | P2 | No written principles or facilitator guidelines |
| 6 | No recurring issue detection | P2 | Without records, patterns cannot be identified |
| 7 | Supporting infrastructure gaps | P1 | Logging, tracing, error tracking, and alerting are insufficient to support post-mortem reconstruction |
| 8 | No public post-mortem capability | P3 | No process for sharing learnings with affected founders |

## Priority Remediation

1. **P1:** Create `docs/operations/post-mortem-template.md` with all standard sections (title, severity, duration, impact, timeline, root cause, contributing factors, what went well, what went poorly, action items, lessons learned)
2. **P1:** Create `docs/post-mortems/` directory and define the naming convention (e.g., `YYYY-MM-DD-short-description.md`)
3. **P1:** Define trigger criteria: when is a post-mortem required? Recommended: any P0 or P1 incident, any data loss, any security event, any incident lasting > 30 minutes
4. **P1:** Define the review process: post-mortem written within 48 hours, reviewed within 1 week, action items tracked in a dedicated `docs/post-mortems/action-items.md` until a proper issue tracker is in place
5. **P2:** Add structured logging adoption as a prerequisite (replace remaining 422 `console.log/error/warn` calls)
6. **P2:** Implement request correlation IDs to enable timeline reconstruction during post-mortem analysis
7. **P3:** Define a process for sharing post-mortems with affected founders (for major incidents)
