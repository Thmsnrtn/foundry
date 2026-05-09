# Foundry — Service Level Objectives

> Date: 2026-05-08 (initial). Reviewed quarterly.

## Why SLOs

A service without an SLO has no signal to alert on. Even loose
objectives ("dashboard p95 under 800ms") give the operator something
to compare against; deviations become incidents instead of vibes.
This document names the three SLOs Foundry runs against pre-alpha;
each grows tighter with measurement evidence.

## SLO 1 — Dashboard render p95 latency

**Target:** p95 latency from `GET /dashboard` to fully-rendered HTML
under **1500ms** (1500ms includes the cold-cache case where Signal
score, weekly outcome, briefing context, and pending decisions are
all fetched in parallel).

**Why 1500ms:** the dashboard is the most-touched authenticated
surface. Above 2 seconds, a daily-driver founder feels the lag;
under 1500ms, it reads as instant. The current implementation
parallel-fetches via Promise.all, so the bound is determined by the
slowest of the parallel calls (typically the Signal computation or
the SCP briefing fetch).

**Measurement:** trace logs for every `GET /dashboard` carry a
`duration_ms`. Aggregate p95 over a 5-minute rolling window. To
implement: process Fly logs into a structured store (Honeycomb,
Datadog, or even a daily roll-up to S3/Turso). Until then, manual
spot-check via fly logs.

**Alert threshold:** p95 above **2500ms** for two consecutive
5-minute windows. Trigger: email to thomas@foundry.so via the
existing Resend integration.

**Common breakers:** slow database (Turso region change), slow AI
calls in the daily insight path, agent-message backlog inflating
the briefing assembly.

## SLO 2 — `scp_agent_runner` job completion time

**Target:** the hourly `scp_agent_runner` cron completes in under
**30 minutes**, regardless of product count (up to 100 active
products).

**Why 30 minutes:** the cron is scheduled hourly. Job duration
exceeding cadence cascades — runs back up, the next run starts
late, briefings drift. 30 minutes leaves 30 minutes of headroom and
flags a real scaling concern before it cascades.

**Measurement:** the existing job logger emits a `complete` line
per run. Capture `duration_ms` from start log to complete log;
aggregate per-run.

**Alert threshold:** any single run exceeding **45 minutes**, or
two consecutive runs above **30 minutes**. Email alert via Resend.

**Common breakers:** AI provider latency spike, runaway agent prompt
inflation, a single product with many integrations consuming most
of the runner's time.

**Scale ceiling:** the current single-process runner caps roughly
at 100 active products before per-product time × product count
exceeds 30 minutes. Past 100 products, the runner needs to either
parallelize or shard.

## SLO 3 — Stripe webhook end-to-end processing

**Target:** Stripe webhook delivery → Foundry tier update visible
in `founders.tier` under **5 seconds** at p99.

**Why 5 seconds:** founders refreshing their billing page after
signup expect to see the new tier within a few seconds. Beyond 5
seconds, support tickets follow.

**Measurement:** the Stripe webhook handler timestamps receipt and
the founders-table UPDATE timestamp. Difference is the SLI.

**Alert threshold:** any webhook processing exceeding **15 seconds**
or any failed webhook delivery (Stripe Dashboard reports failed
events). Email alert via Resend.

**Common breakers:** signature verification failure (rotation
mishap), database lock contention, missing handler for a new event
type Stripe added.

## How alerts fire

Until a real observability vendor is wired up (`SENTRY_DSN` env
activates the Sentry path; see CONTRIBUTING.md), alerting is
shape-of-thing rather than implementation. The pattern below is
what each SLO above assumes.

```ts
// Pseudocode for the alert pattern.
async function checkSLOs(): Promise<void> {
  const dashboardP95 = await computeDashboardP95Last5min();
  if (dashboardP95 > 2500) {
    await sendOperatorAlert(
      `Dashboard p95 = ${dashboardP95}ms (threshold 2500ms)`,
      { source: 'slo:dashboard_p95', metric: dashboardP95 }
    );
  }
  // Similar for the other two SLOs.
}
```

A `slo_check` cron registered at `*/5 * * * *` (every 5 minutes)
runs `checkSLOs()`. Implement when a real observability vendor is
chosen; until then, these are documented expectations.

## SLO review cadence

- **Monthly:** review SLI vs SLO for each. Note breaches; postmortem
  any incident that crossed an alert threshold.
- **Quarterly:** revise targets. Tighten when consistently exceeded;
  loosen when consistently violated and product realities make the
  target unreasonable.
- **Annually:** revisit SLO list. Add new ones for surfaces that
  reach load-bearing status (e.g., the AI provider call latency once
  Sentry data shows the distribution).

## What this list is NOT

- Not exhaustive — only the three highest-value SLOs are named here.
  Adding more before measuring the first three is premature.
- Not error budgets — at one operator, error-budget math doesn't
  buy enough to be worth the formalism. Add when the team grows.
- Not customer-facing — these are operational targets, not contractual
  SLAs. The Terms specify "we target 99.9% uptime"; that's the
  customer-facing line.
