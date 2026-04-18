# Lens 130 — SCP Instance Migration Edge Cases

**Auditor perspective:** Edge-case hunter / domain adversary — moving a company's SCP from one state to another
**Distinct-value declaration:** Traces what happens to in-flight agent runs, pending decisions, and cached state when a company's SCP lifecycle state changes mid-cycle. No prior lens examined state transition timing hazards.
**Tenancy-critical:** Yes. State transitions affect agent behavior, gate levels, and cost for individual companies within the fleet.

**Date:** 2026-04-16
**Repo:** foundry (Hono + Turso + Clerk + Anthropic)

---

## Summary

| Severity | Count |
|----------|-------|
| P1 | 2 |
| P2 | 3 |

---

## SM-01. Lifecycle state transition during hourly agent run -- agents see inconsistent state

**Severity: P1**
**Files:** `src/services/scp/instance.ts:306-357`, `src/services/scp/scheduler.ts:29-58`

The hourly `scp_agent_runner` iterates all products and runs due agents sequentially. The `scp_lifecycle_transition` job runs daily at 6:00 UTC. If both jobs overlap (agent runner is still processing product #15 when lifecycle transition starts), agents for the same product could see different lifecycle states:

1. Agent Atlas runs at 5:58 UTC, reads `company_lifecycle_state = 'operating'`
2. `scp_lifecycle_transition` runs at 6:00 UTC, updates product to `company_lifecycle_state = 'optimizing'`
3. Agent Compass runs at 6:02 UTC, reads `company_lifecycle_state = 'optimizing'`

Atlas and Compass produce analysis based on different lifecycle contexts for the same day. The briefing aggregates both contributions without noting the mid-run state change.

**Evidence:**
- `src/services/scp/agents/base.ts`: No lifecycle state snapshot at the start of a product's agent run
- `src/services/scp/instance.ts:307-312`: `updateLifecycleState` directly updates the products table
- No locking or versioning on lifecycle state reads

---

## SM-02. Risk state transition to Red suspends Gate 0/1 -- but in-flight autonomous actions may already be executing

**Severity: P1**
**Files:** `src/services/ai/gates.ts:39-53`, `src/services/scp/agents/base.ts`

When the `weeklySynthesis` job transitions a product to Red risk state, the `evaluateGate` function escalates Gate 0/1 actions to Gate 2. However, if an agent is mid-run and has already passed the gate check (or if the gate check is not consulted -- see lens 50 finding 10b), the agent may execute autonomous actions that should have been suspended.

The risk state change and agent execution are not transactional. There is no mechanism to:
- Abort in-flight agent runs when risk state changes
- Roll back actions taken before the risk state change was visible
- Re-evaluate pending decisions against the new risk state

**Evidence:**
- `src/services/ai/gates.ts:39-53`: Gate evaluation is a pure function called at decision time
- No evidence that `evaluateGate` is called before agent action execution in `base.ts`
- `src/services/intelligence/risk-state.ts:70-74`: `transitionRiskState` writes to DB but does not signal running agents

---

## SM-03. SCP provisioning sets `company_lifecycle_state = 'learning'` -- but agent scheduler filters on `!= 'setup'`

**Severity: P2**
**Files:** `src/services/scp/provisioner.ts:138-149`, `src/services/scp/scheduler.ts:31-33`

When a product is provisioned, the provisioner sets `company_lifecycle_state` to 'learning' (or keeps current if not 'setup'). The scheduler query filters: `WHERE scp_status='active' AND company_lifecycle_state != 'setup'`.

Edge case: If provisioning fails midway (e.g., after creating 7 of 12 agents but before updating `company_lifecycle_state`), the product remains in 'setup' state. The scheduler will never pick it up. The 7 created agents will never run. The product appears stuck.

**Evidence:**
- `src/services/scp/provisioner.ts:141-149`: Lifecycle state update is the last step; if earlier steps fail, it never executes
- No rollback of partially created agents on provisioning failure

---

## SM-04. No state machine validation on lifecycle transitions

**Severity: P2**
**Files:** `src/services/scp/instance.ts:338-354`

The `updateLifecycleState` method checks conditions and may transition:
- `setup` -> `learning` (if any sessions exist)
- `learning` -> `operating` (if 50+ sessions with 85% success)
- `operating` -> `optimizing` (if 20+ evolution cycles and health >= 75)

But there is no validation that transitions only move forward. Nothing prevents a manual UPDATE that sets `company_lifecycle_state = 'setup'` from the database or a future admin API. If a product regresses from 'operating' to 'learning', agents would re-enter the learning behavior mode, potentially re-running cold-start analysis.

Additionally, `company_lifecycle_state = 'scaling'` appears in the types (`CompanyLifecycleState`) but there is no transition logic to reach it.

---

## SM-05. Pausing an SCP instance leaves stale `next_run_at` timestamps

**Severity: P2**
**Files:** `src/services/scp/instance.ts:256-270`, `src/services/scp/provisioner.ts:184-193`

When agents are paused (via `pauseAgent` or `deprovisionSCP`), their status changes to 'paused' but `next_run_at` is not cleared. When resumed later, the `next_run_at` may be days or weeks in the past. The scheduler query (`WHERE next_run_at IS NULL OR next_run_at <= CURRENT_TIMESTAMP`) will immediately mark all agents as "due", causing all 12 to run simultaneously in the next cycle.

For a product paused for 30 days and then resumed: all 12 agents fire at once, consuming 12 AI calls. This is correct behavior but may surprise the founder with a burst of activity and cost.

---

## Recommendations

1. **Snapshot lifecycle state at the start of each product's agent cycle** -- Load state once, pass to all agents. Prevents mid-run inconsistency.
2. **Add a state transition event bus** -- When risk state changes, emit an event that the scheduler can check. Mark in-flight sessions as "risk_state_changed" for briefing context.
3. **Validate lifecycle state transitions** -- Only allow forward transitions (setup -> learning -> operating -> optimizing -> scaling). Reject regressions.
4. **Clear `next_run_at` on pause** -- Or set it to NULL. On resume, recalculate based on cadence hours from the resume time.
5. **Add a provisioning transaction** -- Wrap all 26 provisioning queries in a `batch()` call so partial provisioning cannot occur.
