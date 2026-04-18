# Lens 137 — Agent Handoff Across SCP Instances

**Auditor perspective:** Edge-case hunter / domain adversary — when Fleet-Oracle queries a company's Sentinel, is the boundary clean?
**Distinct-value declaration:** Examines every inter-instance communication path: scratchpad, agent messages, cross-product pattern queries, and fleet-level meta-agent aspirations. Determines whether the data boundary between SCP instances is clean.
**Tenancy-critical:** Yes. Cross-instance data flow is the defining challenge of fleet-scale SCP.

**Date:** 2026-04-16
**Repo:** foundry (Hono + Turso + Clerk + Anthropic)

---

## Summary

| Severity | Count |
|----------|-------|
| P1 | 1 |
| P2 | 2 |
| P3 | 1 |

---

## Current Inter-Instance Communication Paths

### Path 1: Scratchpad (Intra-Instance Only)

**Files:** `src/services/scp/coordination/scratchpad.ts`

The scratchpad allows agents within a single product to share observations. `getScratchpadContext(productId)` loads scratchpad entries for one product. This is strictly per-product -- no cross-product scratchpad access.

**Boundary:** Clean. Product-scoped by design.

### Path 2: Agent Messages (Intra-Instance Only)

**Files:** `src/services/scp/messages.ts`, `src/services/scp/agents/base.ts:113`

`_loadUnreadMessages(productId, agentName)` queries `agent_messages WHERE target_agent=? AND product_id=?`. Messages are scoped by product ID.

**Boundary:** Clean. Product-scoped by design.

### Path 3: Decision Patterns (Cross-Instance, Uncontrolled)

**Files:** `src/db/client.ts:210-250`, `src/services/decisions/patterns.ts`

This is the only production cross-instance data flow. When any product's decision is resolved, the outcome is written to the global `decision_patterns` table. When any product's agent proposes a decision, the pattern table is queried for similar historical decisions across ALL products.

**Boundary:** Intentionally cross-product but with no access controls, no anonymization, and no consent model.

### Path 4: Portfolio Layer (Cross-Instance, Controlled)

**Files:** `src/services/portfolio/manager.ts`

The portfolio layer aggregates metrics across products that are explicitly added to a portfolio. This is a controlled cross-instance view with explicit membership.

**Boundary:** Clean. Portfolio membership is explicit. Ownership verified.

---

## AH-01. No Fleet-Level Meta-Agents Exist -- The "Fleet-Oracle queries Sentinel" Scenario is Aspirational

**Severity: P1**
**Files:** `src/services/scp/` (entire directory)

The product directive describes Fleet-Oracle, Fleet-Sentinel, and other fleet-level meta-agents that operate across SCP instances. These do not exist in the codebase. There is:
- No `FleetOracle` class or service
- No fleet-level agent scheduler
- No cross-instance query API
- No mechanism for one SCP instance to invoke another's agent

The "fleet" is a bag of independent SCP instances that share a database but have no coordination layer.

**Impact:** The fleet intelligence vision (cross-company anomaly detection, pattern extraction, coordinated response) is architecturally blocked. Building fleet meta-agents would require:
1. A cross-instance query API with explicit data consent
2. A fleet scheduler that orchestrates meta-agents after per-company agents complete
3. An isolation boundary that prevents meta-agents from accessing raw per-company data

None of these primitives exist.

---

## AH-02. Decision patterns are the only cross-instance intelligence -- and they are ungoverned

**Severity: P2**
**Files:** `src/db/client.ts:210-250`

The `decision_patterns` table is the closest thing to fleet intelligence. It aggregates decision outcomes across all companies. However:
- No consent model: companies auto-contribute without opt-out
- No anonymization: `market_category` and `lifecycle_stage` may be identifying
- No quality gates: any decision outcome is accepted regardless of data quality
- No access controls: all patterns are visible to all products

The privacy settings page (`src/routes/dashboard/privacy.ts`) may offer opt-out controls, but the contribution mechanism in `generatePatternFromOutcome` does not check privacy preferences.

---

## AH-03. Scratchpad context could leak between products if productId is wrong

**Severity: P2**
**Files:** `src/services/scp/coordination/scratchpad.ts`

The scratchpad is loaded with `getScratchpadContext(productId)`. The `productId` comes from the agent's `run(productId)` parameter, which comes from the scheduler's product iteration. If a bug in the scheduler causes `productId` to be incorrect (e.g., a race condition or stale variable), one product's agents could read another product's scratchpad.

This is theoretical -- the current sequential loop makes this unlikely. But if concurrency is added (as recommended in many lenses), the risk increases.

**Evidence:**
- `src/services/scp/agents/base.ts:123`: `getScratchpadContext(productId)` -- productId from function parameter
- No secondary validation that the scratchpad entries belong to the agent's product

---

## AH-04. Agent sessions store cross-product data in `pending_decisions` JSON

**Severity: P3**

`pending_decisions` in `agent_sessions` is JSON that includes the decision context. If the context includes cross-product pattern data (from `getRelevantPatterns`), the session record stores cross-product intelligence within a single product's session. This is not a leak (the session belongs to the product) but means the decision patterns data is duplicated into per-product storage, complicating data deletion requests.

---

## Recommendations

1. **Design the fleet-level agent architecture** before implementing meta-agents. Define:
   - Data consent model (opt-in per company)
   - Isolation contract (meta-agents see aggregates, not raw data)
   - Scheduling contract (meta-agents run after per-company cycles complete)
2. **Add opt-out to decision pattern contribution** -- Check privacy preferences in `generatePatternFromOutcome`.
3. **Add productId validation in scratchpad reads** -- Verify returned entries match the requesting product.
4. **Create a formal cross-instance API** -- A `FleetQuery` interface that explicitly defines what data can cross instance boundaries, with typed requests and responses.
