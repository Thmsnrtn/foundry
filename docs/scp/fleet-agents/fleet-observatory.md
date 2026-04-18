# Fleet Agent: Fleet Observatory (Real-Time Activity Dashboard)

Version: 1.0 | Phase: 6 | Date: 2026-04-16

## Purpose

The Fleet Observatory provides real-time visibility into all SCP agent activity across all companies owned by a founder. It aggregates agent run logs, session summaries, health scores, pending actions, and cost burn rate into a single activity feed. It is a pure data aggregation layer with zero LLM calls.

The Fleet Observatory does NOT analyze or interpret agent behavior (that is the Fleet Oracle's job). It simply provides a structured, real-time view of what is happening across the fleet right now.

## Data Classification (per cross-company contract)

| Level | Access | Usage |
|-------|--------|-------|
| Level 1 (Strictly Isolated) | READ (founder's own companies only) | Agent session details are Level 1 but the founder owns all companies |
| Level 2 (Anonymized Decision Patterns) | Not used | Observatory does not consume anonymized patterns |
| Level 3 (Aggregated Fleet Intelligence) | READ/WRITE | Fleet health score, fleet activity metrics |
| Level 4 (Benchmarking Pool) | Not used | Observatory does not consume benchmarks |

**Key distinction:** The Fleet Observatory reads Level 1 data (agent sessions, run logs) but ONLY from companies owned by the requesting founder. This is permitted because the founder is the data owner of all companies. No data crosses founder boundaries.

## Inputs

All inputs are from the founder's own companies.

| Input | Source | Granularity | Freshness |
|-------|--------|-------------|-----------|
| Agent session logs | `agent_sessions` table | Per-session (all 12 agents x all companies) | Real-time |
| Agent instance status | `agent_instances` table | Per-agent, per-company | Real-time |
| Agent health scores | `agent_instances.domain_health_score` | Per-agent, per-company | Updated per session |
| Pending decisions | `decision_queue` | Per-company | Real-time |
| Pending outbound actions | `outbound_actions` (status=pending) | Per-company | Real-time |
| AI cost log | `agent_cost_log` | Per-session | Real-time |
| SCP briefing timestamps | `scp_briefings` | Per-company | Daily |
| SCP status | `products.scp_status` | Per-company | Real-time |
| Agent error logs | `agent_sessions` (status=failed) | Per-session | Real-time |

## Outputs (with schema)

### 1. Fleet Activity Feed

```typescript
interface FleetActivityFeed {
  founder_id: string;
  generated_at: string;              // ISO 8601
  model_used: 'none';               // Zero LLM calls

  fleet_health: {
    overall_score: number;           // 0-100, weighted average across companies
    companies_count: number;
    agents_active: number;           // Total agents with status='active'
    agents_paused: number;
    agents_error: number;
    sessions_today: number;
    sessions_successful_today: number;
    sessions_failed_today: number;
    success_rate_today_pct: number;
  };

  cost_burn_rate: {
    today_usd: number;
    trailing_7d_usd: number;
    trailing_30d_usd: number;
    daily_average_usd: number;       // trailing_30d / 30
    projected_monthly_usd: number;   // daily_average * 30
    top_cost_agents: Array<{
      agent_name: string;
      cost_today_usd: number;
      sessions_today: number;
    }>;
  };

  activity_feed: Array<{
    timestamp: string;               // ISO 8601
    event_type: 'session_completed' | 'session_failed' | 'decision_proposed'
              | 'decision_approved' | 'decision_rejected' | 'decision_expired'
              | 'action_executed' | 'action_pending' | 'agent_evolved'
              | 'agent_error' | 'agent_recovered' | 'briefing_generated'
              | 'risk_state_changed' | 'scp_status_changed';
    company_id: string;
    company_name: string;
    agent_name: string | null;       // null for company-level events
    summary: string;                 // Human-readable, max 200 chars
    severity: 'critical' | 'warning' | 'info';
    session_id: string | null;
  }>;

  per_company_status: Array<{
    product_id: string;
    company_name: string;
    scp_status: 'provisioning' | 'active' | 'paused' | 'archived';
    health_score: number;
    agents_summary: {
      active: number;
      paused: number;
      error: number;
      last_session_at: string | null;
      next_session_at: string | null;
    };
    pending_decisions_count: number;
    pending_actions_count: number;
    sessions_today: number;
    cost_today_usd: number;
    last_briefing_at: string | null;
  }>;

  agent_performance_comparison: Array<{
    agent_name: string;
    display_name: string;
    role: string;
    across_companies: {
      total_instances: number;
      active_instances: number;
      avg_health_score: number;
      avg_success_rate_pct: number;
      total_sessions_30d: number;
      total_cost_30d_usd: number;
      avg_cost_per_session_usd: number;
      total_decisions_proposed_30d: number;
      total_decisions_approved_30d: number;
      approval_rate_pct: number | null;
    };
  }>;
}
```

### 2. Fleet Health Score

A single composite number for the fleet, computed without LLM.

```typescript
interface FleetHealthScore {
  score: number;                     // 0-100
  computed_at: string;
  components: {
    avg_company_health: number;      // Weighted average of per-company health scores
    agent_availability_pct: number;  // (active agents) / (total agents) * 100
    session_success_rate_pct: number;
    decision_throughput_pct: number; // (approved + rejected) / (total proposed) in 7 days
    cost_efficiency_score: number;   // Based on ROI if available, else based on cost trend
  };
  weights: {
    avg_company_health: 0.40;
    agent_availability: 0.20;
    session_success_rate: 0.20;
    decision_throughput: 0.10;
    cost_efficiency: 0.10;
  };
}
```

### 3. Real-Time Alert Stream

Events that should trigger push notifications or dashboard highlights.

```typescript
interface FleetAlert {
  id: string;
  founder_id: string;
  triggered_at: string;
  alert_type: 'agent_down' | 'session_failure_spike' | 'cost_anomaly'
            | 'decision_backlog' | 'scp_paused' | 'health_drop';
  severity: 'critical' | 'warning';
  company_id: string;
  summary: string;
  threshold_breached: string;        // e.g., "3 consecutive failures" or "cost 2x daily average"
}
```

## Tools

| Tool | Purpose | Side Effects |
|------|---------|-------------|
| `session_aggregator` | Queries `agent_sessions` across founder's companies | None (read-only) |
| `instance_aggregator` | Queries `agent_instances` across founder's companies | None (read-only) |
| `cost_aggregator` | Queries `agent_cost_log` across founder's companies | None (read-only) |
| `decision_aggregator` | Queries `decision_queue` across founder's companies | None (read-only) |
| `action_aggregator` | Queries `outbound_actions` across founder's companies | None (read-only) |
| `health_scorer` | Computes fleet health score from component metrics | None (pure computation) |
| `alert_evaluator` | Evaluates alert thresholds against current metrics | None (pure computation) |
| `feed_assembler` | Assembles activity feed from all sources, sorts by timestamp | None (pure computation) |
| `alert_emitter` | Emits FleetAlerts via notification system | Notification side effect |

No tool makes LLM calls. No tool modifies any data.

## Guardrails

1. **Display only:** The Fleet Observatory has zero autonomous actions. It cannot modify agent states, approve decisions, pause SCP instances, or execute any mutations.
2. **Zero LLM calls:** All computation is pure data aggregation — SQL queries, arithmetic, sorting. No Claude calls of any kind. Cost is zero LLM spend.
3. **Founder boundary:** Every query scoped to `owner_id = ?`. No cross-founder data visible.
4. **No interpretation:** The Observatory reports what happened (facts), not why it happened (analysis). Interpretation is the Fleet Oracle's domain.
5. **Activity feed ordering:** Feed entries sorted by timestamp descending. Maximum 100 entries in a single feed response.
6. **Alert threshold safety:** Alert thresholds are configurable per founder but have hardcoded minimums to prevent alert flooding:
   - `agent_down`: minimum 1 (cannot disable)
   - `session_failure_spike`: minimum 3 consecutive failures
   - `cost_anomaly`: minimum 1.5x daily average
   - `decision_backlog`: minimum 5 pending, oldest > 3 days
   - `health_drop`: minimum 15-point drop in 24 hours
7. **No PII in activity feed:** Session summaries are agent-authored briefing contributions (sanitized). No customer names, emails, or Level 1 business details in feed entries.
8. **Rate limiting:** Activity feed can be polled at most every 30 seconds per founder. Fleet health score cached for 5 minutes.
9. **Audit logging:** Fleet Observatory does not generate audit log entries for reads (it would flood the audit log). Alert emissions are logged.
10. **Data freshness labeling:** Every data point in the output includes a timestamp so the UI can show staleness indicators.

## Cost Bounds

| Constraint | Limit |
|-----------|-------|
| Model | None (zero LLM calls) |
| Frequency | Real-time (on-demand, cached) |
| LLM cost | $0.00 |
| Compute cost | SQL queries only; bounded by query complexity |
| Cache TTL | Activity feed: 30 seconds; Health score: 5 minutes; Cost burn rate: 5 minutes |
| Alert evaluation | Runs on each activity feed refresh (piggybacks on queries) |
| Maximum query scope | 100 most recent sessions per company; 30-day lookback for aggregates |

## Eval Criteria (pass/fail)

| Criterion | Pass | Fail |
|-----------|------|------|
| Zero LLM calls | `model_used` is `'none'`, cost is $0.00 | Any LLM call made |
| Display only | No data mutations of any kind | Any write to per-company tables |
| Founder boundary | All data from founder's own companies only | Any cross-founder data |
| Arithmetic accuracy | Health score, success rates, costs computed correctly | Off-by-one or rounding errors |
| Feed completeness | All event types represented when they occur | Missing event types |
| Alert threshold compliance | Alerts only fire above configured thresholds | Alerts below threshold (flooding) |
| Latency | Activity feed within 2 seconds; health score within 500ms | Exceeds latency bounds |
| No interpretation | Feed contains facts (what happened, when) | Feed contains analysis (why, recommendations) |
| Cache compliance | Cached results returned within TTL | Stale data served beyond TTL |

## Golden Eval Cases (20+)

### Typical Cases (10)

```json
[
  {
    "id": "observatory-typical-01",
    "name": "Normal fleet activity day",
    "scenario": "2 companies, 24 total agents, all healthy. 18 sessions completed today, 0 failures. 2 pending decisions.",
    "input": {
      "founder_id": "fnd_ot01",
      "companies": [
        { "product_id": "prod_a", "scp_status": "active", "agents_active": 12, "sessions_today": 10, "failures_today": 0, "pending_decisions": 1 },
        { "product_id": "prod_b", "scp_status": "active", "agents_active": 12, "sessions_today": 8, "failures_today": 0, "pending_decisions": 1 }
      ]
    },
    "expected_output": {
      "fleet_health_above_80": true,
      "sessions_today": 18,
      "success_rate_100": true,
      "no_alerts_fired": true,
      "activity_feed_has_18_entries": true,
      "zero_llm_calls": true
    },
    "pass_criteria": "Correctly aggregates sessions. 100% success rate. No alerts. Activity feed contains 18 session entries. Zero LLM cost."
  },
  {
    "id": "observatory-typical-02",
    "name": "Agent failure in one company",
    "scenario": "Company A's Atlas agent failed 3 consecutive sessions. All other agents healthy.",
    "input": {
      "founder_id": "fnd_ot02",
      "companies": [
        { "product_id": "prod_a", "agents_in_error": ["atlas"], "consecutive_atlas_failures": 3 },
        { "product_id": "prod_b", "agents_active": 12, "agents_in_error": [] }
      ]
    },
    "expected_output": {
      "agent_down_alert_fired": true,
      "alert_severity": "warning",
      "alert_company": "prod_a",
      "alert_agent": "atlas",
      "activity_feed_includes_failures": true,
      "fleet_health_decreased": true
    },
    "pass_criteria": "Fires agent_down alert for Atlas in Company A. Activity feed includes 3 failure entries. Fleet health score reflects the error."
  },
  {
    "id": "observatory-typical-03",
    "name": "Cost anomaly detection",
    "scenario": "Today's AI cost is $45. Daily average for past 30 days is $18. Threshold is 2x.",
    "input": {
      "founder_id": "fnd_ot03",
      "cost_today_usd": 45.00,
      "daily_average_30d_usd": 18.00,
      "anomaly_threshold_multiplier": 2.0
    },
    "expected_output": {
      "cost_anomaly_alert_fired": true,
      "alert_threshold_breached": "cost 2.5x daily average",
      "cost_burn_rate_today": 45.00,
      "projected_monthly_higher_than_normal": true
    },
    "pass_criteria": "Fires cost_anomaly alert (45/18 = 2.5x, above 2x threshold). Cost burn rate correctly computed. Projected monthly reflects elevated spend."
  },
  {
    "id": "observatory-typical-04",
    "name": "Decision backlog accumulation",
    "scenario": "Company A has 7 pending decisions, oldest is 5 days. Threshold is 5 pending, oldest > 3 days.",
    "input": {
      "founder_id": "fnd_ot04",
      "companies": [
        { "product_id": "prod_a", "pending_decisions": 7, "oldest_decision_days": 5 },
        { "product_id": "prod_b", "pending_decisions": 1, "oldest_decision_days": 0 }
      ]
    },
    "expected_output": {
      "decision_backlog_alert_fired": true,
      "alert_company": "prod_a",
      "per_company_pending_decisions_correct": true,
      "activity_feed_shows_decision_events": true
    },
    "pass_criteria": "Fires decision_backlog alert for Company A (7 pending, oldest 5 days). Company B not flagged (1 pending, 0 days old)."
  },
  {
    "id": "observatory-typical-05",
    "name": "Agent performance comparison across fleet",
    "scenario": "Oracle agent has 95% success rate across 3 companies. Beacon has 68% success rate. All other agents 85%+.",
    "input": {
      "founder_id": "fnd_ot05",
      "agent_performance": {
        "oracle": { "success_rate": 95, "instances": 3, "total_sessions_30d": 90 },
        "beacon": { "success_rate": 68, "instances": 3, "total_sessions_30d": 87 },
        "atlas": { "success_rate": 88, "instances": 3, "total_sessions_30d": 45 }
      }
    },
    "expected_output": {
      "comparison_includes_all_agents": true,
      "beacon_lowest_success_rate": true,
      "oracle_highest_success_rate": true,
      "avg_cost_per_session_computed": true
    },
    "pass_criteria": "Agent performance comparison shows all agents. Beacon clearly lowest. Oracle clearly highest. Cost per session computed for each."
  },
  {
    "id": "observatory-typical-06",
    "name": "Briefing generation tracking",
    "scenario": "Company A's briefing generated at 6:00 AM today. Company B's briefing is pending (last was yesterday).",
    "input": {
      "founder_id": "fnd_ot06",
      "companies": [
        { "product_id": "prod_a", "last_briefing_at": "2026-04-16T06:00:00Z" },
        { "product_id": "prod_b", "last_briefing_at": "2026-04-15T06:00:00Z" }
      ]
    },
    "expected_output": {
      "per_company_briefing_timestamps": true,
      "activity_feed_includes_briefing_event_for_a": true,
      "company_b_shows_yesterday_briefing": true
    },
    "pass_criteria": "Per-company status shows correct last briefing timestamps. Activity feed includes briefing generation event for Company A."
  },
  {
    "id": "observatory-typical-07",
    "name": "Health score computation",
    "scenario": "3 companies with health scores 90, 70, 50. MRR weights: $10k, $5k, $2k. Agent availability 92%. Session success 88%. Decision throughput 75%.",
    "input": {
      "founder_id": "fnd_ot07",
      "company_health_scores": [
        { "product_id": "prod_a", "health": 90, "mrr_cents": 1000000 },
        { "product_id": "prod_b", "health": 70, "mrr_cents": 500000 },
        { "product_id": "prod_c", "health": 50, "mrr_cents": 200000 }
      ],
      "agent_availability_pct": 92,
      "session_success_rate_pct": 88,
      "decision_throughput_pct": 75
    },
    "expected_output": {
      "fleet_health_score_computed": true,
      "weighted_avg_company_health_correct": true,
      "all_components_present": true,
      "score_between_0_and_100": true
    },
    "pass_criteria": "Fleet health computed with correct weights. Weighted avg company health = (90*10k + 70*5k + 50*2k) / 17k = 78.8. Combined with other components per weight formula."
  },
  {
    "id": "observatory-typical-08",
    "name": "Action execution tracking",
    "scenario": "3 outbound actions executed today across 2 companies. 2 more are pending approval.",
    "input": {
      "founder_id": "fnd_ot08",
      "actions": [
        { "product_id": "prod_a", "action_type": "send_email", "status": "executed", "agent": "harbor" },
        { "product_id": "prod_a", "action_type": "create_pr", "status": "executed", "agent": "atlas" },
        { "product_id": "prod_b", "action_type": "update_config", "status": "executed", "agent": "sentinel" },
        { "product_id": "prod_a", "action_type": "pricing_experiment", "status": "pending", "agent": "forge" },
        { "product_id": "prod_b", "action_type": "content_publish", "status": "pending", "agent": "scribe" }
      ]
    },
    "expected_output": {
      "activity_feed_includes_action_events": true,
      "executed_count": 3,
      "pending_count": 2,
      "per_company_pending_actions_correct": true
    },
    "pass_criteria": "Activity feed includes all 5 action events. Per-company status shows correct pending action counts."
  },
  {
    "id": "observatory-typical-09",
    "name": "SCP status change event",
    "scenario": "Company C's SCP just transitioned from 'active' to 'paused' by founder action.",
    "input": {
      "founder_id": "fnd_ot09",
      "status_change": {
        "product_id": "prod_c",
        "from": "active",
        "to": "paused",
        "timestamp": "2026-04-16T14:30:00Z"
      }
    },
    "expected_output": {
      "activity_feed_includes_status_change": true,
      "event_type": "scp_status_changed",
      "severity": "warning",
      "per_company_shows_paused": true
    },
    "pass_criteria": "Activity feed includes SCP status change event at correct timestamp. Per-company status updated to 'paused'. Severity is warning."
  },
  {
    "id": "observatory-typical-10",
    "name": "Mixed session results across fleet",
    "scenario": "12 sessions completed today: 10 successful, 2 failed. Failures in different companies by different agents.",
    "input": {
      "founder_id": "fnd_ot10",
      "sessions_today": [
        { "product_id": "prod_a", "agent": "atlas", "status": "completed" },
        { "product_id": "prod_a", "agent": "harbor", "status": "completed" },
        { "product_id": "prod_a", "agent": "oracle", "status": "failed", "error": "timeout" },
        { "product_id": "prod_b", "agent": "atlas", "status": "completed" },
        { "product_id": "prod_b", "agent": "beacon", "status": "failed", "error": "api_error" },
        { "product_id": "prod_b", "agent": "harbor", "status": "completed" }
      ]
    },
    "expected_output": {
      "success_rate_83_pct": true,
      "activity_feed_includes_all_sessions": true,
      "failure_entries_have_severity_warning": true,
      "no_agent_down_alert_single_failures": true
    },
    "pass_criteria": "Success rate ~83% (10/12). Both failures in feed with warning severity. No agent_down alert (not consecutive failures). Correct per-company breakdown."
  }
]
```

### Edge Cases (5)

```json
[
  {
    "id": "observatory-edge-01",
    "name": "Single company founder",
    "scenario": "Founder has only 1 company. Fleet view is a single-company view.",
    "input": {
      "founder_id": "fnd_oe01",
      "companies": [
        { "product_id": "prod_solo", "scp_status": "active", "agents_active": 12 }
      ]
    },
    "expected_output": {
      "fleet_health_equals_company_health": true,
      "agent_comparison_shows_single_instances": true,
      "still_provides_full_output_structure": true,
      "cost_burn_rate_computed": true
    },
    "pass_criteria": "Full output structure provided even for single company. Fleet health equals company health. Agent comparison shows 1 instance per agent."
  },
  {
    "id": "observatory-edge-02",
    "name": "25+ company fleet performance",
    "scenario": "Founder has 28 companies. Activity feed could have hundreds of entries today.",
    "input": {
      "founder_id": "fnd_oe02",
      "companies_count": 28,
      "total_sessions_today": 312,
      "total_agents": 336
    },
    "expected_output": {
      "activity_feed_capped_at_100": true,
      "feed_sorted_by_timestamp_desc": true,
      "per_company_status_all_28": true,
      "responds_within_2_seconds": true,
      "health_score_aggregates_all": true
    },
    "pass_criteria": "Activity feed capped at 100 most recent entries. Per-company status includes all 28 companies. Response within 2 seconds. Fleet health aggregates all 28."
  },
  {
    "id": "observatory-edge-03",
    "name": "All agents in error state",
    "scenario": "Due to an Anthropic API outage, all agents across all companies have failed in the last cycle.",
    "input": {
      "founder_id": "fnd_oe03",
      "companies": [
        { "product_id": "prod_a", "agents_in_error": 12, "sessions_failed_today": 12, "sessions_successful_today": 0 },
        { "product_id": "prod_b", "agents_in_error": 12, "sessions_failed_today": 12, "sessions_successful_today": 0 }
      ]
    },
    "expected_output": {
      "fleet_health_very_low": true,
      "success_rate_0_pct": true,
      "multiple_agent_down_alerts": true,
      "session_failure_spike_alert": true,
      "activity_feed_shows_all_failures": true
    },
    "pass_criteria": "Fleet health very low. 0% success rate. Agent down alerts for each failed agent (or consolidated fleet-wide alert). Session failure spike alert fired."
  },
  {
    "id": "observatory-edge-04",
    "name": "No sessions today (early morning)",
    "scenario": "It is 12:01 AM. No sessions have run yet today. All data is from yesterday.",
    "input": {
      "founder_id": "fnd_oe04",
      "sessions_today": 0,
      "last_session_timestamp": "2026-04-15T23:45:00Z"
    },
    "expected_output": {
      "sessions_today_zero": true,
      "cost_today_zero": true,
      "success_rate_today_null_or_na": true,
      "activity_feed_shows_recent_yesterday_events": true,
      "no_false_alerts": true
    },
    "pass_criteria": "Zero sessions today. Cost today $0. Success rate N/A (not 0%). Activity feed shows recent events from yesterday. No false alerts triggered by empty data."
  },
  {
    "id": "observatory-edge-05",
    "name": "Company with all agents paused",
    "scenario": "Company B has all 12 agents paused by founder. SCP status is still 'active' but no agents run.",
    "input": {
      "founder_id": "fnd_oe05",
      "companies": [
        { "product_id": "prod_a", "scp_status": "active", "agents_active": 12, "agents_paused": 0 },
        { "product_id": "prod_b", "scp_status": "active", "agents_active": 0, "agents_paused": 12 }
      ]
    },
    "expected_output": {
      "shows_all_agents_paused_for_b": true,
      "agent_availability_reflects_paused": true,
      "no_agent_down_alert_for_paused": true,
      "per_company_status_shows_12_paused": true
    },
    "pass_criteria": "Company B shows 0 active, 12 paused. Agent availability reflects this. No agent_down alerts (paused is intentional, not an error). Fleet health accounts for reduced agent pool."
  }
]
```

### Adversarial Cases (5)

```json
[
  {
    "id": "observatory-adversarial-01",
    "name": "Cross-founder session data access",
    "scenario": "Query attempts to include agent sessions from a company owned by another founder.",
    "input": {
      "founder_id": "fnd_legit",
      "query_includes_product_id": "prod_FOREIGN_OWNER"
    },
    "expected_output": {
      "foreign_sessions_excluded": true,
      "only_founder_companies_in_feed": true,
      "logs_security_event": true,
      "no_foreign_data_in_any_output_field": true
    },
    "pass_criteria": "Session aggregator rejects foreign product_id. Activity feed contains only founder's own data. Security event logged."
  },
  {
    "id": "observatory-adversarial-02",
    "name": "Attempt to trigger action via observatory",
    "scenario": "Request includes a parameter attempting to pause an SCP instance through the observatory.",
    "input": {
      "founder_id": "fnd_action",
      "malicious_param": { "action": "pause_scp", "product_id": "prod_a" }
    },
    "expected_output": {
      "ignores_action_parameter": true,
      "no_scp_instances_modified": true,
      "returns_normal_display_data": true,
      "display_only_enforced": true
    },
    "pass_criteria": "Observatory ignores action parameter. No SCP instances modified. Returns normal activity feed. Display-only constraint enforced."
  },
  {
    "id": "observatory-adversarial-03",
    "name": "Alert flooding via rapid state changes",
    "scenario": "A buggy integration causes 50 risk state changes in 1 minute for one company, potentially flooding alerts.",
    "input": {
      "founder_id": "fnd_flood",
      "risk_state_changes_per_minute": 50,
      "company_id": "prod_a"
    },
    "expected_output": {
      "alert_deduplication_active": true,
      "max_alerts_per_company_per_hour": true,
      "activity_feed_shows_changes_but_capped": true,
      "no_notification_flood": true
    },
    "pass_criteria": "Alert deduplication prevents flooding. Maximum alerts per company per hour enforced. Activity feed capped at 100 entries. Notification system not overwhelmed."
  },
  {
    "id": "observatory-adversarial-04",
    "name": "PII leakage via session summary",
    "scenario": "An agent session's briefing contribution contains customer PII that should not appear in the fleet activity feed.",
    "input": {
      "founder_id": "fnd_pii",
      "session_summary_contains": "Customer john.doe@acme.com is churning, revenue impact $45,000"
    },
    "expected_output": {
      "pii_not_in_activity_feed": true,
      "summary_sanitized_or_truncated": true,
      "email_not_in_fleet_view": true
    },
    "pass_criteria": "Activity feed summary does not contain customer email. PII is sanitized or replaced with generic text. Revenue details may appear (they are Level 1 but founder-owned)."
  },
  {
    "id": "observatory-adversarial-05",
    "name": "Cache poisoning attempt",
    "scenario": "Attacker attempts to pollute the cached activity feed with fabricated events.",
    "input": {
      "founder_id": "fnd_cache",
      "fabricated_events": [
        { "event_type": "session_completed", "product_id": "prod_a", "agent": "atlas", "summary": "Fabricated event" }
      ]
    },
    "expected_output": {
      "rejects_fabricated_events": true,
      "cache_populated_from_db_only": true,
      "no_external_event_injection": true,
      "activity_feed_from_trusted_sources_only": true
    },
    "pass_criteria": "Cache populated exclusively from database queries. Fabricated events rejected. Activity feed contains only events from trusted database tables."
  }
]
```
