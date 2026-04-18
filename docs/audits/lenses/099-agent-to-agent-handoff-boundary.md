# Lens 099 — Agent-to-Agent Handoff Boundary

**Distinct value:** Evaluates the quality of boundaries between agents within a single SCP instance and across the fleet. Examines: the agent message bus, the shared scratchpad, briefing contribution aggregation, decision ownership, evolution independence, and whether agents can interfere with each other's state. Tests for clean handoff contracts versus implicit coupling.

**Tenancy-critical:** Yes. Within an SCP instance, agents share a product context and coordinate via scratchpad and messages. Across the fleet, the `decision_patterns` table allows indirect data flow between products. The boundary between "Agent A's findings for Product X" and "Agent B's findings for Product Y" must be airtight.

## Executive Summary

The agent-to-agent boundary within a single SCP instance is **well-designed with clear handoff mechanisms**: the message bus, the shared scratchpad, and the briefing aggregation system. However, the boundaries have 4 gaps: (1) agents can send messages to any other agent with no validation that the target agent exists or is active, (2) the scratchpad conflict detection is heuristic-based (keyword matching) rather than semantic, creating false positives and missed conflicts, (3) there is no handoff protocol for multi-agent workflows (e.g., Atlas detects a technical issue -> Crucible should verify -> Sentinel should monitor, but there is no workflow engine tracking this chain), and (4) agent evolution is independent per-agent with no coordination, so one agent can evolve its behavior in a way that conflicts with another agent's expectations.

## Findings

### AAH-01 No Validation of Target Agent in Message Bus
- **Severity:** P2
- **Description:** The `sendMessage()` function in `src/services/scp/messages.ts` accepts a `toAgent` string and inserts a row into `agent_messages`. There is no validation that `toAgent` is a valid agent name from the `ALL_AGENTS` list, that the target agent is active (not paused or in error state), or that the target agent exists for this product. A message sent to `toAgent: "nonexistent_agent"` is silently stored and never read. A message sent to a paused agent is stored but the agent will never process it (paused agents are excluded from `getDueAgents()`).
- **Evidence:** `src/services/scp/agents/base.ts:291-309` — messages sent with `msg.to_agent` directly from Claude's output. No validation against `ALL_AGENTS`. `src/services/scp/messages.ts` (inferred) — INSERT without agent name validation.
- **Remediation:** Validate `toAgent` against the `ALL_AGENTS` enum. If the target agent is paused, either queue the message (deliver when resumed) or bounce it back to the sender agent with a notification. Log messages to non-existent agents as errors.

### AAH-02 Scratchpad Consensus Detection Is Keyword-Based, Not Semantic
- **Severity:** P2
- **Description:** The `detectConsensusAndConflicts()` function in `src/services/scp/coordination/scratchpad.ts:153-239` detects consensus by checking if the same keyword (5+ chars, excluding stopwords) appears in 2+ agents' findings. It detects conflicts by checking if some agents use "positive" words (strong, growing, opportunity) while others use "negative" words (weak, declining, risk). This is crude: Atlas saying "infrastructure is strong" and Harbor saying "customer retention is strong" would register as consensus on "strong" when they are discussing completely different topics.
- **Evidence:** `src/services/scp/coordination/scratchpad.ts:171-227` — keyword extraction and positive/negative word matching. The consensus check at line 196 flags any shared keyword as consensus.
- **Remediation:** Use Claude (Sonnet, cheap call) to perform semantic consensus/conflict detection instead of keyword matching. Send the agent findings to Claude with the prompt: "Do these agents agree or disagree on any substantive point? Identify genuine consensus and genuine conflicts." This is a single short API call per day per product (only when 3+ agents have written findings).

### AAH-03 No Multi-Agent Workflow Tracking
- **Severity:** P2
- **Description:** Agents frequently initiate workflows that require handoff. For example, Atlas detects a security vulnerability (PIH-01: `agentMessages.push({ to_agent: 'crucible', message_type: 'alert', priority: 'high', subject: 'Security risk level: high' })`). Crucible should receive this, investigate, and potentially message Sentinel about monitoring. But there is no workflow state machine tracking this chain. Each message is independent. There is no "Atlas initiated security review -> Crucible acknowledged -> Crucible investigated -> Sentinel notified" audit trail. If Crucible is paused or fails, the chain silently breaks.
- **Evidence:** `src/services/scp/agents/atlas.ts:275-283` — Atlas sends alert to Crucible. No tracking of whether Crucible processes it. `src/services/scp/agents/base.ts:615-629` — messages loaded and processed with no acknowledgment mechanism.
- **Remediation:** Add a message acknowledgment system: when an agent loads unread messages, mark them as `status: 'delivered'`. After processing, mark as `status: 'processed'`. Add a query for the briefing generator: "Are there unprocessed high-priority messages?" to surface dropped handoffs.

### AAH-04 Agent Evolution Is Uncoordinated
- **Severity:** P2
- **Description:** The evolution system (`src/services/scp/evolution.ts`) can modify an agent's behavioral constraints, system prompt enrichments, and authority levels based on session history. Each agent evolves independently. There is no mechanism to ensure that Agent A's evolution does not conflict with Agent B's expectations. For example, if Harbor evolves to escalate all churn signals to priority 'critical', and Forge evolves to only process 'critical' churn signals that exceed $1K MRR, the two agents could create a feedback loop where Harbor floods Forge with escalated signals.
- **Evidence:** `src/services/scp/scheduler.ts:92-114` — `runEvolutionForAllProducts()` runs evolution for each agent independently. `src/services/scp/evolution.ts` — evolution synthesis is per-agent, no cross-agent consistency check.
- **Remediation:** Add a cross-agent evolution consistency check. Before promoting an evolution change, run a validation step that checks: (1) does this change conflict with any other agent's current behavioral constraints? (2) does this change affect the message contract between agents? (3) does this change affect the authority level balance across the team? Log the check result in the evolution version record.

### AAH-05 Briefing Contribution Aggregation Has No Deduplication
- **Severity:** P3
- **Description:** Each agent produces a `briefingContribution` string (2-3 sentences) that is aggregated into the daily briefing. If two agents report on the same issue (e.g., both Atlas and Sentinel flag a deployment that caused errors), the briefing will contain both contributions without any deduplication or synthesis. The briefing generator (`src/services/scp/briefing.ts`) uses Claude to synthesize, which may naturally deduplicate, but there is no explicit deduplication step before the synthesis call, increasing token usage.
- **Evidence:** `src/services/scp/agents/base.ts:199` — briefing contribution stored per session. `src/services/scp/briefing.ts` — loads all agent contributions for the day. No pre-synthesis deduplication.
- **Remediation:** Before calling Claude for briefing synthesis, group contributions by topic (using the scratchpad's consensus detection). Pass grouped contributions with a note: "These agents reported on the same topic. Synthesize into one finding." This reduces token usage and improves briefing quality.

### AAH-06 Fleet-Level Agent Boundaries Are Non-Existent
- **Severity:** P1 (for fleet future)
- **Description:** The orientation document describes a future state where fleet-level meta-agents coordinate across SCP instances. Currently, the only cross-product data flow is the `decision_patterns` table and the portfolio benchmarking layer. There is no cross-product agent message bus, no fleet-level scratchpad, and no mechanism for one product's agent to influence another product's agent except through the anonymized pattern table. This is actually a security benefit (strong isolation) but represents a capability gap for the fleet vision.
- **Evidence:** `src/services/scp/coordination/scratchpad.ts` — scratchpad is per-product (`WHERE product_id = ?`). `src/services/scp/messages.ts` — messages are per-product. `src/services/portfolio/manager.ts` — portfolio aggregates read-only metrics but does not issue agent commands.
- **Remediation:** For the fleet vision, design the cross-product coordination system with explicit boundaries: (1) fleet-level findings must be anonymized before injection into a product's agent context, (2) no fleet agent can directly modify another product's agent state, (3) fleet insights should be treated as advisory signals, not commands.

## Handoff Mechanism Inventory

| Mechanism | Scope | State Tracking | Error Handling |
|---|---|---|---|
| Agent Messages | Intra-product | No acknowledgment | Messages silently lost if agent paused |
| Shared Scratchpad | Intra-product, daily | Keyword consensus | Write failures swallowed |
| Briefing Contributions | Intra-product, daily | Aggregated by synthesizer | No deduplication |
| Decision Queue | Intra-product | Status (pending/approved/denied) | Decisions expire after 72h |
| Evolution | Per-agent | Version tracked | No cross-agent coordination |
| Decision Patterns | Cross-product | Anonymized (claimed) | No write validation |
| Portfolio | Cross-product, read-only | Snapshot-based | Read failures handled |

## Positive Findings

- The agent isolation model (each agent runs independently in its own `try/catch`) is fundamentally sound. One agent's failure does not cascade.
- The scratchpad concept (agents reading each other's findings before their own run) is a good coordination primitive that avoids the complexity of real-time agent-to-agent communication.
- The `C-Suite Output Standard` injected into every agent's prompt enforces a consistent output structure that makes briefing aggregation reliable.
- The message bus design (stored in DB, loaded at next run) is appropriate for hourly-cadence agents. It avoids the complexity of real-time message routing while ensuring delivery.
- Agent authority levels (0-2) provide a structural boundary on what actions agents can take autonomously versus what requires human approval.
