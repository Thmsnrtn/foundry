# Phase 9 -- Agent Surface Tests

Generated: 2026-04-16 | Auditor: v5 automated audit | Session: v5-phase-9

Sources reviewed:
- `src/services/scp/agents/base.ts` -- BaseAgent v2 (12-agent execution framework)
- `docs/scp/fleet-agents/fleet-observatory.md` -- Fleet Observatory spec
- `docs/scp/fleet-agents/fleet-oracle.md` -- Fleet Oracle spec
- `docs/scp/fleet-agents/fleet-sentinel.md` -- Fleet Sentinel spec
- `docs/scp/fleet-agents/portfolio-ledger.md` -- Portfolio Ledger spec
- `src/routes/dashboard/agents-transparency.ts` -- Agent transparency UI
- `src/routes/dashboard/agents.ts` -- Agent roster and controls

---

## Role 1: Suspicious User -- "Can I see exactly what each agent did and why?"

**Assessment:**

The transparency layer is well-implemented for per-company agents. The `agents-transparency.ts` route provides:
- Per-agent cost breakdown (30-day window) with token counts and USD cost
- Recent run history with status (completed/failed), latency, and token usage
- Individual run detail pages showing observations, actions taken, and briefing contributions

The BaseAgent v2 (`base.ts`) records extensive audit data per session:
- `observations`, `actions_taken`, `pending_decisions` (JSON arrays, lines 183-186)
- `briefing_contribution`, `briefing_priority` (lines 187-188)
- `evolution_candidates`, `tokens_used`, `cost_usd` (lines 189-191)
- Failed sessions record `error_message` (line 146)

**Gap:** For fleet-level meta-agents (Fleet Oracle, Fleet Sentinel, Portfolio Ledger), there is no UI yet. The specs mandate audit logging (`fleet_oracle_run`, `fleet_sentinel_run`, `portfolio_ledger_run`), but these agents are aspirational -- no implementation exists. A suspicious user cannot see what fleet-level agents are doing because they do not exist yet.

**Verdict:** PASS for per-company agents. NOT APPLICABLE for fleet agents (unimplemented).

---

## Role 2: Impatient User -- "How long do agent runs take? Any progress indication?"

**Assessment:**

Agent runs are background hourly cron jobs, not user-triggered interactive operations. The BaseAgent `run()` method records `durationMs` (line 374) and session timestamps (`started_at`, `completed_at`). The transparency UI shows latency per run via `fmtLatency()`.

**No real-time progress indicator exists.** The agent execution model is:
1. Cron triggers hourly
2. BaseAgent checks cadence, loads context, calls `analyzeAndAct()`, records results
3. User sees results on next page load

The transparency page shows the most recent runs and their durations, so a user can see historical latency. But there is no "agent is running now" indicator, no progress bar, and no WebSocket/SSE push for in-progress sessions.

The Fleet Observatory spec defines a real-time activity feed with 30-second cache TTL, which would provide near-real-time visibility. However, this is unimplemented.

**Verdict:** PARTIAL. Historical latency visible. No real-time progress indicator during execution. Fleet Observatory (unbuilt) would address this.

---

## Role 3: Stopper -- "Can I stop an agent mid-run? Pause all agents?"

**Assessment:**

**Per-agent pause:** The `agent_instances` table has a `status` field with values `active`, `paused`, `error`. The BaseAgent `run()` method checks this at line 45:
```typescript
if (agentInstance.status === 'paused') {
  return this._buildSkippedOutput(agentName, productId, 'agent is paused', startTime);
}
```

The agents roster UI (`agents.ts`) provides controls to change agent status. A paused agent is skipped on the next cron cycle.

**Mid-run cancellation:** There is NO mechanism to abort an agent that is already executing its `analyzeAndAct()` call. Once the Claude API call is in flight, it runs to completion. The only timeout is the DB query timeout (10s per query), but the LLM call itself has no timeout or cancellation token. This is consistent with orientation finding #1 (no timeouts on Anthropic calls).

**Pause all agents:** No fleet-wide pause button exists. The Fleet Observatory spec explicitly states it has "zero autonomous actions" and "cannot pause SCP instances." To pause all agents across all companies, a user would need to pause each company's SCP individually.

**Verdict:** PARTIAL. Individual agent pause works (pre-run check). No mid-run abort. No fleet-wide pause mechanism.

---

## Role 4: Confused User -- "Do I understand what 12 agents are doing for my company?"

**Assessment:**

Agent discoverability is good. The agent roster page shows all 12 agents with:
- Display names (Atlas=CTO, Compass=PM, Prism=UX, etc.) via `AGENT_DISPLAY_NAMES`
- Role descriptions via `AGENT_ROLES`
- Status dot (active/paused/error)
- Health score with color coding
- Success rate percentage
- Last run time
- Authority level label (autonomous / notify+override / require approval)

The CEO Briefing aggregates all agents' `briefingContribution` fields into a single daily narrative. The C-Suite Output Standard (injected into every agent prompt at base.ts lines 549-565) requires agents to produce structured findings: POSITION, CONFIDENCE, STAKES, ACTION, SIGNAL.

**Gap:** The 12-agent model is inherently complex. While each agent has a name and role, the navigation labels are abstract (Atlas, Compass, Prism) rather than functional. A first-time user seeing "Atlas" would not immediately know this is the CTO agent. The roster page mitigates this by showing role descriptions, but the sidebar navigation uses agent names without roles.

**Gap:** No "what are agents doing right now" summary exists on the main dashboard. The signal dashboard shows metrics, but a confused user must navigate to Agents > Roster, then Agents > Transparency to piece together current state.

**Verdict:** PARTIAL. Good per-agent documentation. Missing high-level "what's happening" summary and functional (not persona) labels in navigation.

---

## Role 5: Surprised User -- "Did any agent take an action I didn't expect?"

**Assessment:**

The authority gate system provides structured control:
- **Gate 0 (autonomous):** Agent acts without asking. Only Oracle defaults to this level.
- **Gate 1 (notify+override):** Agent acts and notifies. Scribe, Harbor, Sentinel, Crucible, Ledger.
- **Gate 2 (require approval):** Agent proposes, human approves. Atlas, Compass, Prism, Beacon, Forge, Shield.

The BaseAgent records all actions in `agent_sessions.actions_taken` (JSON). Outbound actions from `result.outboundActions` are routed through `proposeAction()` in the outbound executor (base.ts lines 314-331), which enforces the authority level.

**Surprise-prevention mechanisms:**
1. Risk-state-aware thresholds: In Red state, Gate 0 and Gate 1 actions are suspended (per orientation).
2. Initiative queue items always require approval (authority_level = 2, base.ts line 676).
3. Evolution candidates go through `checkEvolutionCandidates()` validation.
4. The transparency page shows exactly what happened per session.

**Remaining surprise vectors:**
- Gate 0 (Oracle) and Gate 1 agents CAN act without pre-approval. If Oracle generates an unexpected insight or Harbor sends an unexpected customer communication, the founder learns after the fact.
- The `agentMessages` inter-agent bus (base.ts lines 292-310) allows agents to message each other without founder visibility, potentially coordinating actions the founder did not anticipate.
- Fire-and-forget patterns throughout base.ts (customer signals, outbound actions, hypotheses) mean actions are dispatched without confirmation. Errors in dispatch are logged but not surfaced to the user.

**Verdict:** PARTIAL. Good structural controls via gate system. Gate 0/1 agents can still surprise. Inter-agent messages lack founder visibility.

---

## Role 6: Cross-Company Skeptic -- "Do fleet-meta agents respect company boundaries?"

**Assessment:**

The fleet agent specs define a rigorous data classification system with 4 levels:

| Level | Description | Cross-Company? |
|-------|-------------|----------------|
| Level 1 | Strictly Isolated (raw business data) | NEVER crosses boundaries |
| Level 2 | Anonymized Decision Patterns | Read-only, min-5 cohort filter |
| Level 3 | Aggregated Fleet Intelligence | Founder's own companies only |
| Level 4 | Benchmarking Pool | Opt-in only |

**Fleet Oracle** (fleet-oracle.md):
- Hard rule: "NEVER reads Level 1 data from companies other than the one being analyzed"
- Receives pre-aggregated Level 3 data only
- All queries include `WHERE owner_id = ?`
- Level 2 patterns enforce `COUNT(*) >= 5` cohort filter
- Sanitizes all company names via `sanitizeForPrompt()` before Opus prompt
- Output validation ensures `affected_companies` contains only founder's product_ids

**Fleet Sentinel** (fleet-sentinel.md):
- Sees stressor *types* and *durations* across companies but NEVER stressor *reasons* or *details*
- Cannot trigger Gate 0/1 actions on any company
- Maximum 2 cascade warnings per run (alert fatigue prevention)
- Correlation confidence threshold >= 0.5

**Portfolio Ledger** (portfolio-ledger.md):
- Sees aggregate metrics (total MRR, customer count) per company
- Never accesses individual customer records or invoices across boundaries
- Cannot modify pricing, tiers, or billing
- All monetary values in cents (no floating-point drift)

**Fleet Observatory** (fleet-observatory.md):
- Pure data aggregation, zero LLM calls
- Display only, zero autonomous actions
- All queries scoped to `owner_id = ?`
- Activity feed capped at 100 entries

**Critical assessment:** These specs are thorough in design but ENTIRELY UNIMPLEMENTED. The orientation document confirms: "Multi-company fleet orchestration is aspirational -- there is no SCP-to-SCP coordination, cross-company intelligence extraction, or fleet-level meta-agents." The specs exist only as documentation. No code implements them.

**Verdict:** SPEC PASS (well-designed boundaries). IMPLEMENTATION N/A (not built). The existing per-company BaseAgent (`base.ts`) is strictly single-company scoped -- it takes `productId` as input and all queries scope to that product. There is zero cross-company data flow in the current codebase.

---

## Role 7: Fleet Activity Auditor -- "Can I see what ALL agents are doing across ALL companies right now?"

**Assessment:**

**Current state:** No fleet-wide agent activity view exists in the implemented codebase. The transparency page (`agents-transparency.ts`) is per-product only -- it shows agent runs for the currently selected product via the `foundry_product` cookie.

To see agent activity across all companies, a founder would need to:
1. Switch to Company A via product switcher
2. Navigate to Agents > Transparency
3. Review runs
4. Switch to Company B
5. Repeat

**Designed solution:** The Fleet Observatory spec defines exactly this view:
- `FleetActivityFeed` with per-company status, agent performance comparison, cost burn rate
- Real-time activity feed sorted by timestamp with 30-second cache TTL
- Fleet health score (composite, no LLM)
- Alert stream for anomalies (agent_down, cost_anomaly, decision_backlog, etc.)
- Per-company status with agent breakdown, pending decisions, costs

The spec is comprehensive and production-grade in its design. It addresses:
- 25+ company fleet performance (capped at 100 feed entries)
- All-agents-down scenarios
- Zero-sessions-today edge case
- Cross-founder data access (rejected)
- Alert flooding prevention (deduplication)
- PII sanitization in feed entries

**But none of it is built.**

**Verdict:** FAIL (no fleet activity view exists). SPEC PASS (Fleet Observatory design is thorough and would solve the problem completely).

---

## Summary

| Role | Verdict | Key Finding |
|------|---------|-------------|
| Suspicious User | PASS (per-company) | Transparency UI shows agent inputs, outputs, costs. Fleet agents unbuilt. |
| Impatient User | PARTIAL | Historical latency visible. No real-time progress during execution. |
| Stopper | PARTIAL | Per-agent pause works. No mid-run abort. No fleet-wide pause. |
| Confused User | PARTIAL | Good per-agent docs. Missing high-level summary and functional nav labels. |
| Surprised User | PARTIAL | Gate system prevents most surprises. Gate 0/1 and inter-agent messages can surprise. |
| Cross-Company Skeptic | SPEC PASS / IMPL N/A | Fleet agent specs have rigorous boundaries. None implemented. |
| Fleet Activity Auditor | FAIL (current) / SPEC PASS | No fleet activity view exists. Fleet Observatory spec is comprehensive. |

### Defects Found

**DEFECT-P9-01: No mid-run agent cancellation (Medium)**
- **Location:** `src/services/scp/agents/base.ts` `run()` method
- **Issue:** Once `analyzeAndAct()` is called, there is no abort mechanism. The Anthropic API call runs to completion with no timeout.
- **Fix:** Add an `AbortController` signal to the Anthropic client call. Check a "cancel requested" flag in the DB between pipeline stages.

**DEFECT-P9-02: No fleet-wide agent pause (Medium)**
- **Location:** No implementation exists
- **Issue:** A founder with 10+ companies cannot pause all agents in an emergency without visiting each company's settings individually.
- **Fix:** Add a fleet-level "pause all SCP" endpoint that sets `status='paused'` on all `agent_instances` where the product is owned by the founder.

**DEFECT-P9-03: Inter-agent messages invisible to founder (Low)**
- **Location:** `src/services/scp/agents/base.ts` lines 292-310
- **Issue:** Agents send messages to each other via `sendMessage()`. These messages influence agent behavior (injected into prompts at lines 534-539) but are not surfaced in the founder's UI.
- **Fix:** Add an "Agent Communications" view showing inter-agent message traffic, or include message summaries in the transparency page.

**DEFECT-P9-04: Fleet agents entirely unimplemented (High -- roadmap item)**
- **Location:** `docs/scp/fleet-agents/` (specs only, no corresponding `src/` code)
- **Issue:** The four fleet meta-agents (Observatory, Oracle, Sentinel, Portfolio Ledger) exist only as specs. No fleet-level intelligence, risk correlation, financial aggregation, or activity monitoring is available.
- **Impact:** Founders with multiple companies have no unified view of their fleet. The product positions itself as a "multi-company autonomous control plane" but delivers only per-company SCP instances with manual switching between them.
