# Lens 42 — SCP Fleet Orchestration Expert Audit

**Auditor perspective:** SCP fleet orchestration expert
**Scope:** SCP provisioning, scheduling, lifecycle management, instance pause/resume/retire/migrate, cross-instance signaling, fleet resource management
**Date:** 2026-04-16

---

## Executive Summary

The SCP fleet layer is functional for single-company operations but lacks the orchestration primitives required for fleet-scale management. Provisioning is solid -- 12 agents are created atomically with staggered cadences, a constitution is installed, and evolution tracking begins from version 1. The scheduler runs all due agents for all active products but does so sequentially with no concurrency control, priority ordering, or resource budgeting. Instance-level pause/resume exists for individual agents but not for entire SCP instances. There is no instance migration, no cross-instance signaling, and no fleet-level meta-agents. Deprovision marks agents as paused rather than deleting them, which is the right approach but leaves orphaned data. The system is a well-typed, well-structured single-tenant SCP with fleet-level aspirations that have not been implemented.

**P0 findings:** 1
**P1 findings:** 4
**P2 findings:** 5
**P3 findings:** 3

---

## Finding 01 — Sequential scheduler will time out at fleet scale

**Severity: P0**
**File:** `src/services/scp/scheduler.ts` (lines 28-57)

`runDueAgentsForAllProducts` iterates all active products sequentially. For each product, `runAllDueAgents` iterates all due agents sequentially. Each agent run involves an Anthropic API call (30-60s for Opus). With 50 active products and 12 agents each:

- Worst case: 50 x 12 x 60s = 36,000 seconds = 10 hours
- Typical case: 50 x 4 due agents x 45s = 9,000 seconds = 2.5 hours

This runs as a single cron job. If the cron fires hourly (as described in orientation), the second tick will overlap with the first. There is no lock, no concurrency limit, and no deduplication.

**Impact:** At fleet scale, agent runs will cascade, overlap, and produce unpredictable cost and timing. Products at the end of the list may never get serviced within their cadence window.

**Remediation:**
1. Add a distributed lock (or simple DB-based mutex) to prevent overlapping scheduler runs.
2. Parallelize with a concurrency limit (e.g., 5 products simultaneously using a semaphore).
3. Sort by priority: Red-state products first, then products with the oldest `next_run_at`.
4. Add a wall-clock timeout for the entire scheduler run (e.g., 55 minutes for an hourly cron).

---

## Finding 02 — No instance-level pause/resume (only agent-level)

**Severity: P1**
**File:** `src/services/scp/instance.ts` (lines 256-270)

`SCPInstance` has `pauseAgent(agentName)` and `resumeAgent(agentName)` that update individual agent status. But there is no `pauseInstance()` or `resumeInstance()` method to freeze/unfreeze an entire SCP instance as a unit. To pause all 12 agents, the caller must invoke `pauseAgent` 12 times in a loop.

The `deprovisionSCP` in `provisioner.ts` does bulk-pause all agents (`UPDATE agent_instances SET status='paused' WHERE product_id=?`) and sets `scp_status='archived'`, but there is no corresponding `reprovisionSCP` or `unarchive` to bring it back.

**Impact:** Operators cannot cleanly pause and resume a company's AI operations (e.g., during a billing delinquency, planned maintenance, or founder vacation).

**Remediation:** Add `pauseInstance()` and `resumeInstance()` methods on `SCPInstance` that atomically update all agents and the product's `scp_status` field. Add an `unarchive` flow to `provisioner.ts`.

---

## Finding 03 — No cross-instance signaling or fleet intelligence

**Severity: P1**
**File:** `src/services/scp/scheduler.ts`, `src/services/scp/instance.ts`

Each SCP instance runs in complete isolation. There is no mechanism for:
- Cross-company pattern extraction after a scheduler run
- Fleet-level anomaly detection (e.g., "3 of 5 products entered Yellow state this week")
- Shared competitive intelligence (e.g., two products in the same sector both detecting the same competitor move)
- Fleet-level cost optimization (e.g., batching similar Anthropic calls across products)

The `decision_patterns` table exists for cross-product learning, but it is populated per-product and queried at decision time -- not as a fleet-level synthesis step.

**Impact:** Multi-company operators get N independent views instead of a coordinated fleet perspective. The fleet is a bag of instances, not an orchestrated system.

**Remediation:**
1. Add a post-run fleet synthesis step to the scheduler that aggregates signals across products.
2. Create fleet-level meta-agents (Fleet Oracle, Fleet Sentinel) that operate on aggregate data.
3. Add cross-instance signal forwarding for shared stressors.

---

## Finding 04 — Provisioning failures are silently swallowed

**Severity: P1**
**File:** `src/services/scp/provisioner.ts` (lines 157-167)

The `provisionSCP` function catches all errors and returns `{ success: false, error }` without propagating the exception. The caller (`ensureProvisioned`) does throw, but the direct callers of `provisionSCP` in onboarding routes may not check the `success` field:

```typescript
// provisioner.ts:159
console.error(`[provisioner] provisionSCP(${productId}) failed: ${error}`);
return { success: false, productId, agentsCreated: 0, constitutionCreated: false, error };
```

If provisioning fails midway (e.g., 6 of 12 agents created before a DB error), the product is left in a partially provisioned state. The `isProvisioned` check requires count >= 12 agents, so a partial provision will be retried on next `ensureProvisioned` call, but each retry uses `ON CONFLICT DO NOTHING` which means the existing 6 agents will be skipped and only the remaining 6 attempted.

**Impact:** Partial provisioning is recoverable but silently. The founder sees no error. The product may operate with fewer than 12 agents until the next implicit retry.

**Remediation:**
1. Wrap the agent creation loop in a transaction (or implement compensating cleanup on failure).
2. Log provisioning failures as audit_log entries visible to the founder.
3. Add a health check that verifies all 12 agents exist and are active.

---

## Finding 05 — No instance migration between tiers

**Severity: P2**
**File:** `src/services/scp/provisioner.ts`

When a founder upgrades from Solo to Growth or Investor-Ready, there is no mechanism to adjust the SCP instance. The same 12 agents with the same cadences and authority levels continue running. There is no:
- Cadence upgrade (e.g., Growth tier gets 6-hour sentinel instead of daily)
- Additional agent capabilities unlocked by tier
- Constitution adjustment on tier change
- Migration path from one billing plan's agent configuration to another

**Impact:** Tier upgrades are billing events only. The SCP instance does not adapt to the new tier's capabilities.

**Remediation:** Add a `migrateSCPToTier(productId, newTier)` function that adjusts cadences, authority levels, and enabled features based on the new tier.

---

## Finding 06 — Agent error state is set but never recovered

**Severity: P2**
**File:** `src/services/scp/instance.ts` (lines 100, 153-175)

Agent instances can have status `'active' | 'paused' | 'error'`. When an agent fails during `runAllDueAgents`, the session output records `success: false`, but the agent's status is NOT updated to 'error' -- the failure is captured in the session output only. Conversely, if an agent's status IS 'error' (perhaps set manually or by another code path), there is no automatic recovery mechanism to retry and reset to 'active'.

**Impact:** The 'error' status is defined in types but has no automated entry or exit conditions. Agents in 'error' state are effectively dead until manually reset.

**Remediation:** After N consecutive session failures, set agent status to 'error'. After a configurable cool-down period, automatically retry and reset to 'active' if successful.

---

## Finding 07 — Deprovision does not clean up orphaned data

**Severity: P2**
**File:** `src/services/scp/provisioner.ts` (lines 184-193)

`deprovisionSCP` sets `scp_status='archived'` and pauses all agents but does not:
- Cancel pending decisions
- Stop scheduled jobs from querying this product
- Clean up briefing generation
- Remove the product from the scheduler's active product query

The scheduler filters by `scp_status='active'` (line 30), so archived products are excluded. But other code paths (e.g., `generateBriefingsForAllProducts` at line 117) filter only by `scp_status='active'`, which correctly excludes archived products. This works but is implicit -- the deprovisioning contract is not documented.

**Impact:** Low risk currently, but if any new feature queries products without checking scp_status, archived products could be accidentally processed.

**Remediation:** Add explicit cleanup steps to deprovision: cancel pending decisions, mark active stressors as resolved, and add an audit log entry.

---

## Finding 08 — No agent health degradation tracking

**Severity: P2**
**File:** `src/services/scp/instance.ts` (lines 274-302)

`computeHealthScore()` calculates a weighted average of agent domain health scores and writes it to the products table. But there is no tracking of health score trends over time. The system knows the current health but not whether health is improving or degrading.

**Impact:** Fleet operators cannot identify which companies or agents are trending negatively. Health degradation must be detected by comparing today's score to yesterday's manually.

**Remediation:** Store health score snapshots (daily) and compute a 7-day trend. Surface degradation in the fleet dashboard and trigger alerts when health drops more than 15 points in 7 days.

---

## Finding 09 — Evolution runs for ALL agents on ALL products sequentially

**Severity: P2**
**File:** `src/services/scp/scheduler.ts` (lines 91-113)

`runEvolutionForAllProducts` iterates all active products with `evolution_enabled=1`, then for each product iterates ALL 12 agents, calling `runEvolutionSynthesis` on each. Evolution synthesis involves an Anthropic API call. With 20 products and 12 agents each: 240 sequential AI calls.

**Impact:** Evolution runs will take hours at modest scale. No concurrency, no priority, no budget cap.

**Remediation:** Only run evolution on agents that have new sessions since the last evolution check. Parallelize across products with a concurrency limit.

---

## Finding 10 — SCPInstance has no introspection API for fleet dashboards

**Severity: P3**
**File:** `src/services/scp/instance.ts`

The `getStatus()` method returns a comprehensive single-instance view, but there is no fleet-level introspection: no `getFleetStatus()`, no `getAgentStatusAcrossProducts()`, no `getFleetCost()`. Building a fleet dashboard requires N individual `getStatus()` calls.

**Impact:** Fleet-level views will be slow (N database round-trips) and fragmented.

**Remediation:** Add a `getFleetStatus(ownerId)` function that queries all products and their agent instances in 2-3 bulk queries rather than N individual ones.

---

## Finding 11 — Briefing generation has no deduplication

**Severity: P3**
**File:** `src/services/scp/scheduler.ts` (lines 117-139)

`generateBriefingsForAllProducts` generates a briefing for every active product every time it runs. There is no check for whether a briefing has already been generated today. If the cron fires twice, two briefings are created for the same date.

**Impact:** Duplicate briefings waste AI tokens and may confuse the founder.

**Remediation:** Add a deduplication check: skip if a briefing already exists for today's date for this product.

---

## Finding 12 — Staggered provisioning offset is index-based, not randomized

**Severity: P3**
**File:** `src/services/scp/provisioner.ts` (line 88)

Agent staggering is `i * 30 * 60 * 1000` (30 minutes per agent index). This means every product has the exact same stagger pattern: atlas always runs first, then compass 30 minutes later, etc. If 10 products are provisioned at the same time, all 10 atlas agents will run simultaneously.

**Impact:** At fleet scale, agent-name-correlated bursts will hit the Anthropic API simultaneously.

**Remediation:** Add a random jitter (0-15 minutes) to the stagger offset, or hash the product ID to distribute agents across the hour.

---

## Embarrassment Test

**Would a fleet orchestration expert be embarrassed by this?** Yes, at the fleet layer. The sequential scheduler with no concurrency control is the critical gap -- it will not survive 20+ active products. The single-instance SCP is well-structured (clear types, proper status tracking, weighted health scores), but the fleet orchestration is essentially absent.

## Pride Test

**What would make an SCP fleet expert proud?** The type system is excellent -- `CompanyLifecycleState`, `SCPStatus`, `AgentAuthorityLevel`, `AgentSessionOutput` with evolution candidates and briefing contributions form a coherent domain model. The staggered provisioning, `ON CONFLICT DO NOTHING` idempotency, and weighted health score computation all show thoughtful single-instance design. The base agent's `analyzeAndAct()` pattern with cadence checks and golden lesson injection is the right architecture for autonomous agents.
