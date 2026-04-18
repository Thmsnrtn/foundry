# Lens 098 — Multi-Step Agent Failure Mode

**Distinct value:** Analyzes what happens when an agent run fails mid-way through its multi-step execution: partial DB writes, orphaned session records, inconsistent agent state, lost cost data, and the downstream effects on briefings, decisions, and health scores. Specifically examines the gap between "agent started" and "agent completed cleanly."

**Tenancy-critical:** No. Agent failure is per-product. One product's failed agent does not affect another product's agents (they run in separate `SCPInstance.runAgent()` calls with independent try/catch).

## Executive Summary

The BaseAgent `run()` method (`src/services/scp/agents/base.ts:36-389`) is a 17-step sequential process. If it fails at any step, the failure handling varies: steps 1-11 (context loading) have individual try/catch that silently return empty data. Step 12 (the core `analyzeAndAct()` call) has a try/catch that marks the session as `'failed'` and the agent instance as `'error'`. Steps 13-17 (post-analysis: session update, agent update, cost logging, signal processing, evolution) are sequential with no transaction. A failure at step 13 (session update SQL fails) leaves the session in `'running'` state forever, the agent instance never gets its `next_run_at` updated (so it runs again immediately on the next cycle), and cost data is lost. The fundamental problem is that **there is no transaction wrapping the multi-step process** — each step is an independent SQL statement.

## Findings

### MSF-01 Session Left in 'running' State on Post-Analysis Failure
- **Severity:** P0
- **Description:** After `analyzeAndAct()` succeeds (step 12), the session update (step 13) writes observations, actions, and cost to the `agent_sessions` row. If this UPDATE fails (e.g., Turso connection error, SQL error from malformed JSON), the session remains in `status='running'` with `completed_at=NULL`. There is no cleanup mechanism, no timeout that marks running sessions as failed, and no retry. The agent instance update (step 14) also will not execute, leaving `next_run_at` stale, which causes the agent to run again immediately on the next scheduler cycle.
- **Evidence:** `src/services/scp/agents/base.ts:181-206` — step 13 UPDATE has no try/catch. If it throws, execution jumps to... nothing. The outer scope of `run()` does not catch post-analyzeAndAct errors. The error propagates to the caller (`SCPInstance.runAgent()`), which catches it and returns a failure output, but the session row is never cleaned up.
- **Remediation:** Wrap steps 13-17 in a try/catch. On failure, mark the session as `'failed'` with the error message. Even if the agent analysis succeeded, a failure to record results should be treated as a session failure. Add a cron job that finds sessions stuck in `'running'` for more than 30 minutes and marks them as `'failed_stale'`.

### MSF-02 Agent Instance Status Stuck in 'error' After Single Failure
- **Severity:** P1
- **Description:** When `analyzeAndAct()` throws (step 12 error handler), the agent instance status is set to `'error'` via `UPDATE agent_instances SET status='error'`. The scheduler's `getDueAgents()` query filters on `status='active'`, so an agent in 'error' state will never be picked up for execution again. There is no automatic recovery, no retry counter, and no mechanism to transition back to 'active'. The agent is permanently disabled until a manual database update.
- **Evidence:** `src/services/scp/agents/base.ts:148-149` — `UPDATE agent_instances SET status='error'`. `src/services/scp/scheduler.ts:78-82` — `getDueAgents()` filters `WHERE status='active'`. `src/services/scp/instance.ts:143-146` — `runAllDueAgents()` only runs agents returned by the due query.
- **Remediation:** Implement a retry mechanism: instead of immediately setting status to 'error', increment a `consecutive_failures` counter. After 3 consecutive failures, set status to 'error'. After each successful run, reset the counter. Add a recovery cron job that attempts to resume 'error' agents every 6 hours (set status back to 'active', clear the counter, try one run).

### MSF-03 Fire-and-Forget Signal Processing Can Lose Data
- **Severity:** P1
- **Description:** Steps 15-17 in the base agent run include 7 fire-and-forget operations: customer signal processing, agent message delivery, outbound action proposals, hypothesis proposals, event marking, prediction extraction, and evolution checking. Each uses the pattern `import('...').then(fn => fn().catch(() => {})).catch(() => {})`. If any of these fails, the data is silently lost. The `catch(() => {})` swallows all errors with no logging, no retry, and no record of the failure.
  
  Most critically: **outbound action proposals** (the mechanism by which agents propose actions for founder approval) are fire-and-forget. If `proposeAction()` fails, the agent's recommended action is silently dropped. The agent's briefing contribution may reference the action, but the action itself never appears in the founder's decision queue.
- **Evidence:** `src/services/scp/agents/base.ts:312-329` — outbound actions via `proposeAction` inside `import(...).then(...).catch(() => {})`. `src/services/scp/agents/base.ts:258-288` — customer signals, agent messages all fire-and-forget.
- **Remediation:** Replace fire-and-forget with a lightweight queue: write signal data to a `pending_signals` table with the session ID, then process it asynchronously via a dedicated cron job. If immediate processing fails, the data persists and can be retried. At minimum, add logging to the catch blocks so failures are visible.

### MSF-04 Cost Logging Failure Breaks P&L Accuracy
- **Severity:** P1
- **Description:** Step 15 logs cost data to both `agent_cost_log` and the P&L `cost_events` table. The P&L logging is fire-and-forget (`import('../../financial/economics.js').then(({ logCost }) => { logCost(...).catch(() => {}); }).catch(() => {})`). If cost logging fails, the product's AI cost tracking becomes inaccurate. The `ai_cost_trailing_30d_usd` column on the products table will undercount actual AI spend. This also affects the daily cost ceiling check, which uses in-memory tracking (the `dailySpend` Map in `client.ts`), not the database — so the ceiling still works, but the reporting is wrong.
- **Evidence:** `src/services/scp/agents/base.ts:242-253` — cost logging with double fire-and-forget. `src/services/ai/client.ts:22-34` — daily spend tracked in memory, not from DB.
- **Remediation:** Make cost logging synchronous (not fire-and-forget). Cost is a financial record — it should be treated with the same reliability as the session update. If the cost log INSERT fails, the session should still succeed but log a warning.

### MSF-05 Scratchpad Write Failure Silently Degrades Collaboration
- **Severity:** P2
- **Description:** When an agent completes its analysis, it writes a finding to the shared scratchpad (`writeAgentFinding`). This is also fire-and-forget (`import(...).then(({ writeAgentFinding }) => { writeAgentFinding(...).catch(() => {}); }).catch(() => {})`). If it fails, subsequent agents running on the same day will not see this agent's findings and may duplicate analysis or miss consensus opportunities. The scratchpad's `detectConsensusAndConflicts()` also runs fire-and-forget.
- **Evidence:** `src/services/scp/agents/base.ts:172-178` — scratchpad write fire-and-forget. `src/services/scp/coordination/scratchpad.ts:84-86` — consensus detection fire-and-forget.
- **Remediation:** Make scratchpad writes synchronous but non-fatal (wrap in try/catch with warning-level logging rather than swallowing silently). The scratchpad is important for agent coordination quality but should not block the session from completing.

### MSF-06 No Transaction Semantics Across Multi-Step Updates
- **Severity:** P1
- **Description:** The base agent's run method performs 5-7 SQL writes across different tables in steps 13-15: (1) UPDATE agent_sessions, (2) UPDATE agent_instances, (3) UPDATE agent_sessions (cost), (4) INSERT agent_cost_log, (5) INSERT cost_events. None of these are wrapped in a transaction. If the process crashes between step (1) and step (2), the session is marked complete but the agent instance has stale `next_run_at`, `total_sessions`, and `successful_sessions` counts.
- **Evidence:** `src/services/scp/agents/base.ts:181-253` — 5 sequential SQL operations with no BEGIN/COMMIT. `src/db/client.ts` — the `query()` function executes individual statements; there is no transaction helper.
- **Remediation:** Implement a transaction wrapper in the DB client. Wrap steps 13-15 in a single transaction. If any step fails, roll back all changes and mark the session as failed. This is the single most important reliability improvement for the agent system.

## Failure Mode State Diagram

```
Agent Run Start
  |
  v
[Step 1-11: Context Loading] --failure--> Silently returns empty context
  |                                        (agent runs with partial context)
  v
[Step 12: analyzeAndAct()] --failure--> Session='failed', Instance='error'
  |                                      (AGENT PERMANENTLY DISABLED - MSF-02)
  v
[Step 13: Update Session] --failure--> Session stuck in 'running' (MSF-01)
  |                                     Agent re-runs immediately next cycle
  v
[Step 14: Update Instance] --failure--> Instance has stale next_run_at
  |                                      (agent re-runs immediately)
  v
[Step 15: Log Cost] --failure--> Cost data lost (MSF-04)
  |
  v
[Steps 16-17: Signal Processing] --failure--> Signals silently lost (MSF-03)
  |
  v
Agent Run Complete
```

## Positive Findings

- The per-agent isolation in `SCPInstance.runAllDueAgents()` is correct: each agent runs in its own try/catch, and one failure does not stop others.
- The `analyzeAndAct()` error handler correctly marks the session as failed and generates a degraded briefing contribution.
- The `_buildSkippedOutput()` helper generates a clean "not due yet" or "paused" response without touching the database.
- Context loading (steps 1-11) is defensively coded with individual try/catch blocks returning empty defaults on failure.
