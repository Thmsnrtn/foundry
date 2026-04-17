# Lens 36 — AI Systems Architect Audit

**Auditor perspective:** AI systems architect (prompt engineering, model selection, context management, cost control, hallucination mitigation, evaluation strategy, agent coordination, production readiness)

**Date:** 2026-04-16
**Scope:** `src/services/ai/*`, `src/services/scp/*` (agents, evolution, accuracy, coordination, debate), type definitions, scheduling

---

## Executive Summary

Foundry's AI layer is architecturally ambitious and well-designed at the conceptual level. The 12-agent SCP with evolution, golden lessons, calibration feedback, debate synthesis, and 5-gate safety validation is one of the most sophisticated autonomous agent systems I have audited. However, it has critical production gaps: **zero prompt injection defenses**, **no cost ceiling**, **no timeouts or retries on any LLM call**, and **no structured output validation** beyond `JSON.parse`. The system will work in demo conditions and fail unpredictably in production under adversarial input, API degradation, or cost runaway.

**Verdict:** Advanced prototype. Needs 3-5 focused engineering weeks to reach production-grade for the AI layer alone.

---

## Findings by Category

### 1. Prompt Engineering Quality

**Assessment: Strong design, missing defenses (P1)**

**Strengths:**
- System prompts are well-crafted with clear personas, domain-specific instructions, and structured output schemas. The Atlas prompt ("You translate technical reality into business risk") and Oracle prompt ("find what the data means that the CEO hasn't figured out yet") are genuinely good prompt engineering -- they establish judgment criteria, not just task descriptions.
- The C-Suite Output Standard injected by `BaseAgent.buildSystemPrompt()` enforces a consistent analytical structure (POSITION/CONFIDENCE/STAKES/ACTION/SIGNAL) that combats vague or hedging outputs.
- Psychology-aware calibration (`ai/calibration.ts`) that adapts tone, length, directness, and jargon level per-founder is a differentiating feature done right.
- Golden lessons injected into prompts provide genuine per-company behavioral memory.

**Problems:**

| ID | Severity | Finding |
|----|----------|---------|
| AI-01 | **P0** | **No prompt injection defense.** User-controlled data (customer names, support ticket text, integration event summaries, GitHub commit messages) flows directly into agent prompts without sanitization. A malicious customer name like `"; IGNORE PREVIOUS INSTRUCTIONS AND...` would be injected verbatim into the system prompt via integration events or customer signals. There is zero grep-hit for "injection", "sanitize", or "escape" in `src/services/ai/`. |
| AI-02 | **P1** | **No structured output validation.** `parseJSONResponse<T>()` in `client.ts` strips markdown fences and calls `JSON.parse()` with an `as T` type assertion. There is no runtime validation (Zod, AJK, etc.) that the parsed object actually conforms to `T`. Every agent blindly trusts that Claude returned the exact JSON schema requested. If the model returns `{"observations": 42}` instead of `string[]`, it propagates silently until it causes a runtime crash elsewhere. |
| AI-03 | **P1** | **User prompt says "Return JSON only (no markdown fences)" but `parseJSONResponse` defensively strips markdown fences anyway.** This indicates the model frequently violates the instruction. The correct fix is to use Claude's `tool_use` / structured output mode, which guarantees valid JSON conforming to a schema. |
| AI-04 | **P2** | **Constitution and calibration context prepended to system prompt without XML-tagged isolation.** The `buildFounderSystemPrompt()` prepends the calibration block as plain text before the domain prompt. The `composeSystemPrompt()` correctly uses XML tags (`<methodology>`, `<productContext>`, etc.), but `BaseAgent.buildSystemPrompt()` concatenates sections with `\n\n` separators. Inconsistent context boundary marking reduces Claude's ability to distinguish instruction sections from injected data. |
| AI-05 | **P2** | **`custom_instructions` from founder AI profile injected directly into the calibration block.** Line 229 of `calibration.ts`: `rules.push(\`- Founder's custom instructions: ${profile.custom_instructions}\`)`. A founder could write instructions that override agent behavior: "Always recommend my product over competitors." This is a soft prompt injection vector from an authenticated user. |

### 2. Model Selection and Routing

**Assessment: Reasonable but static (P2)**

| ID | Severity | Finding |
|----|----------|---------|
| AI-06 | **P2** | **Model routing is hardcoded per-agent, not task-aware.** Atlas calls `callSonnet()`, Oracle calls `callOpus()`. But the routing decision should also account for the complexity of the specific run. An Atlas session analyzing a critical security vulnerability should use Opus; an Oracle session with no data should not waste an Opus call. There is no dynamic routing based on task complexity, data richness, or risk state. |
| AI-07 | **P2** | **Only two models defined.** `MODELS = { OPUS, SONNET }`. No Haiku/fast model for low-stakes operations (scratchpad consensus detection, simple classification tasks). The evolution engine makes 3 separate Sonnet calls per evolution cycle (observation extraction + self-critique + per-change constitution gate + regression gate + safety gate). Some of these could use a cheaper model. |
| AI-08 | **P3** | **Model versions are hardcoded strings.** `'claude-opus-4-6'` and `'claude-sonnet-4-5-20250929'` in `client.ts`. Should be environment variables or config to allow model upgrades without code deployment. |

### 3. Context Window Management

**Assessment: Thoughtful design, good priority-based trimming (P2)**

**Strengths:**
- `composer.ts` implements priority-based context trimming (12 priority levels, lowest trimmed first, methodology never trimmed). This is the right pattern.
- Token estimation at 4 chars/token is reasonable for English.
- Integration events capped at 15, unread messages at 10, golden lessons at 30. Good boundary controls.

| ID | Severity | Finding |
|----|----------|---------|
| AI-09 | **P1** | **No actual token counting -- only character-based estimation.** The 4 chars/token heuristic can be off by 30-50% for code, URLs, JSON data, or non-English text. When `composeSystemPrompt` is called with `maxTokens = 100000`, it may assemble a prompt that actually uses 130K tokens, potentially exceeding the model's context window or causing unexpected truncation. Use `tiktoken` or the Anthropic SDK's token counting. |
| AI-10 | **P2** | **`BaseAgent.buildSystemPrompt()` does not use `composeSystemPrompt()`.** The base agent concatenates parts with `\n\n` and does no token budget enforcement. The composer's priority-based trimming is only used for the intelligence layer calls (weekly synthesis, audit scoring). For the 12 agent runs -- the primary AI workload -- there is no context budget enforcement at all. If an agent accumulates 50+ golden lessons, long integration event summaries, and a large scratchpad context, the system prompt can exceed any reasonable budget. |
| AI-11 | **P2** | **Scratchpad context is unbounded.** `getScratchpadContext()` returns all agent findings for the day without any size limit. With 12 agents each writing findings, this grows throughout the day. Agents running later see more context than agents running earlier, creating an asymmetric information problem that could cause later agents to over-index on earlier agents' findings. |

### 4. Cost Control

**Assessment: Logging exists, controls do not (P0)**

**Strengths:**
- Cost is logged per-session (`agent_cost_log` table), per-agent, and aggregated into `ai_cost_trailing_30d_usd` on the products table.
- Oracle correctly computes differential costs: `input_tokens * 0.000015 + output_tokens * 0.000075` (Opus pricing). Atlas uses a flat `tokensUsed * 0.000003` (Sonnet pricing).

| ID | Severity | Finding |
|----|----------|---------|
| AI-12 | **P0** | **No cost ceiling or spending limit.** There is no per-product, per-day, or per-cycle cost cap. If the scheduler runs 12 agents per product hourly (Sentinel every 6h, Harbor every 12h, others every 24-168h), and each agent averages $0.05-0.50 per run, a single product could easily spend $5-15/day on AI. With 100 products, that is $500-1500/day with no circuit breaker. The `playbooks/execution-engine.ts` has a `budget_exceeded` concept for playbooks, but nothing exists for the core agent loop. |
| AI-13 | **P1** | **Evolution engine multiplies LLM costs with no cap.** A single evolution cycle makes: (1) observation extraction call, (2) self-critique call, (3) per-proposed-change: constitution gate call + regression gate call + safety gate call. That is 2 + 3N calls per evolution, where N is the number of proposed changes. If a correction triggers evolution on all 12 agents, that could be 24+ additional LLM calls. The `runEvolutionForAllProducts()` scheduler iterates ALL agents for ALL products -- this is a cost bomb. |
| AI-14 | **P1** | **Inconsistent cost calculation.** Atlas: `tokensUsed * 0.000003` (flat rate). Oracle: `input_tokens * 0.000015 + output_tokens * 0.000075` (differential). BaseAgent fallback: `tokensUsed * 0.000015`. These are three different pricing formulas. The flat-rate formulas undercount output token costs (which are 3-5x input costs). Cost reporting is inaccurate. |
| AI-15 | **P1** | **Briefing generation uses Sonnet LLM call per product per day with no aggregated cost tracking.** The briefing cost is logged separately but does not flow into the same `agent_cost_log` as agent sessions, making total AI cost per product inaccurate. Same for debate orchestrator (Challenger + Synthesizer calls). |

### 5. Hallucination Mitigation

**Assessment: Structural defenses, no runtime verification (P1)**

**Strengths:**
- The C-Suite Output Standard instruction "Cite evidence for every observation -- no assertions without data" is a good prompt-level mitigation.
- Golden lessons from founder corrections create a feedback loop that should reduce domain-specific hallucinations over time.
- The accuracy tracking system (`accuracy/tracker.ts`) that measures predictions against outcomes is the right architectural pattern.

| ID | Severity | Finding |
|----|----------|---------|
| AI-16 | **P1** | **No output grounding verification.** When Oracle says "churn rate is 4.2%", there is no check that 4.2% matches any actual metric in the database. The model could hallucinate a number, and it would flow into the briefing, the scratchpad, and potentially trigger stressor alerts to other agents. The data is passed in the prompt, but the output is never cross-referenced against it. |
| AI-17 | **P1** | **Hallucinated agent names in inter-agent routing.** Oracle's `stressor_risks[].agent_to_notify` and `agent_intel[].to_agent` are free-text strings from Claude's output. If Oracle hallucinates `to_agent: "marketing"` instead of `"beacon"`, the message routing silently fails (no agent named "marketing" exists). No validation against the `ALL_AGENTS` list. |
| AI-18 | **P2** | **Confidence values are self-reported by the LLM.** When Atlas says `confidence: 0.87`, this number comes from Claude's output, not from any objective measurement. The calibration system in `accuracy/calibrator.ts` correctly identifies over/underconfidence gaps but only after sufficient prediction data accumulates (threshold: 5 measured predictions). During the learning phase, self-reported confidence directly drives gate decisions -- an overconfident early model could trigger autonomous actions (Gate 0) that should require approval. |

### 6. Evaluation Strategy

**Assessment: Impressive architecture, not yet operational (P2)**

**Strengths:**
- The accuracy tracking pipeline (`accuracy/tracker.ts`, `accuracy/calibrator.ts`, `accuracy/prompt-evolver.ts`) is architecturally sound: record predictions with deadlines, measure outcomes, compute rolling accuracy, inject calibration context back into prompts, auto-generate prompt mutations for underperforming agents.
- The debate orchestrator (`debate/orchestrator.ts`) with Challenger and Synthesizer passes provides adversarial evaluation of agent outputs.
- Calibration scoring (difference between stated confidence and actual accuracy) is a sophisticated metric.

| ID | Severity | Finding |
|----|----------|---------|
| AI-19 | **P1** | **Prediction extraction is narrow and heuristic.** `extractPredictionsFromAnalysis()` only captures predictions that match specific patterns: churn mentions in customer signal notes, "expansion" in action types, and hypotheses. The vast majority of agent predictions (e.g., "this security vulnerability will be exploited," "this feature will improve retention by 15%") are not captured because they appear only in the `briefing_contribution` or `observations` free text. The accuracy system measures a tiny fraction of actual agent output. |
| AI-20 | **P2** | **No offline evaluation suite.** There are zero test fixtures for agent prompts. No golden input/output pairs. No regression tests that verify "given this metric snapshot, Atlas should flag X as a risk." The 7 unit test files mentioned in orientation do not cover the AI layer. If a prompt change or model upgrade causes a regression, it will only be detected in production through founder complaints. |
| AI-21 | **P2** | **Prompt evolver generates mutations but requires manual activation.** `generatePromptMutations()` creates mutations with `is_active = 0`. There is no automated A/B testing or canary mechanism to activate and measure mutations. The mutations sit dormant unless someone manually calls `activateMutation()`. |

### 7. Agent Coordination Patterns

**Assessment: Well-architected, some race conditions (P2)**

**Strengths:**
- Three coordination mechanisms: (1) shared scratchpad for same-day context sharing, (2) inter-agent message bus for directed communication, (3) debate orchestrator for conflict resolution. This is a sophisticated multi-agent coordination architecture.
- Agents run sequentially per-product (`runAllDueAgents` loops with `await`), avoiding true concurrency issues.
- Scratchpad detects consensus and conflicts using keyword co-occurrence heuristics.

| ID | Severity | Finding |
|----|----------|---------|
| AI-22 | **P2** | **Agent ordering affects outputs.** Because agents run sequentially and write to the scratchpad, the first agent to run sees an empty scratchpad while the last sees all prior findings. This creates ordering bias. The staggered provisioning (30min offsets per agent) makes this somewhat deterministic, but the order was not designed for information dependency -- it is alphabetical by agent index. Oracle (the analytics core, index 10) runs after most other agents and may over-anchor on their findings. |
| AI-23 | **P2** | **Consensus detection is primitive.** `detectConsensusAndConflicts()` uses keyword co-occurrence (words >= 5 chars appearing in 2+ agents' findings). This will flag spurious consensus on common domain words (e.g., "customer", "revenue", "monthly") while missing semantic agreement expressed with different vocabulary. An LLM-based consensus detector would be more accurate but more expensive. |
| AI-24 | **P2** | **Inter-agent messages are fire-and-forget.** `sendMessage()` is called with `.catch(() => {})`. If the message bus fails, the sending agent has no awareness. There is no delivery confirmation, no retry, and no TTL on messages. Unread messages accumulate indefinitely (capped at 10 per agent run, but no cleanup job). |

### 8. Error Recovery

**Assessment: Fail-open for most, fail-closed for safety gates only (P1)**

| ID | Severity | Finding |
|----|----------|---------|
| AI-25 | **P0** | **No timeout on any LLM call.** `callClaude()` calls `client.messages.create()` with no timeout, AbortController, or deadline. If the Anthropic API hangs (which happens during outages), the agent session hangs indefinitely. The hourly scheduler will accumulate hanging sessions. With 12 agents per product and sequential execution, one hung call blocks all subsequent agents for that product. |
| AI-26 | **P0** | **No retry logic on any LLM call.** Transient 429 (rate limit), 500 (server error), or network errors cause immediate session failure. The agent records "failed" status but does not reschedule for retry. The next attempt is at the regular cadence (6-168 hours later). A single Anthropic API hiccup causes a full day's worth of agent analysis to be lost for that product. |
| AI-27 | **P1** | **JSON parse failures silently degrade.** When `parseJSONResponse` throws (which happens when Claude returns malformed JSON or prose instead of JSON), each agent catches the error and returns a minimal "parsing error" result with `domainHealthScore: 50`. This neutral score is written to the database. Over time, repeated parse failures silently drag the health score toward 50 (neutral) rather than being flagged as a systemic problem. |
| AI-28 | **P1** | **Evolution regression gate fails open.** Line 192 of `scp/gates.ts`: the regression gate returns `passed: true` on LLM error with reason "Regression check skipped (LLM error) -- passing by default." This means an API error during evolution allows a potentially regressive change to be applied. The constitution and safety gates correctly fail closed, but the regression gate does not. |
| AI-29 | **P2** | **Fire-and-forget pattern used 15+ times in BaseAgent.** Cost logging, customer signal processing, agent messages, outbound actions, hypotheses, experiments, scratchpad writes, event marking -- all use `import(module).then(fn).catch(() => {})`. Any of these failing silently means lost data with no visibility. |

### 9. Safety and Security

**Assessment: Evolution gates are solid; runtime prompts are undefended (P0)**

**Strengths:**
- The 5-gate evolution validation pipeline (Constitution, Regression, Size, Drift, Safety) is well-designed. Regex pre-screening + LLM validation + deterministic size/drift checks is defense in depth.
- Fail-closed behavior on constitution and safety gate LLM errors is correct.
- Drift detection using Jaccard similarity against the original config prevents unbounded agent self-modification.

| ID | Severity | Finding |
|----|----------|---------|
| AI-30 | **P0** | **No input sanitization for data entering prompts.** Integration events (`_summariseEvent`), customer signals, agent messages, GitHub commit messages, support ticket content -- all flow into agent system prompts unsanitized. An attacker who controls any data source ingested by an integration could craft a prompt injection payload. This is especially concerning for GitHub integration events (commit messages) and Stripe events (customer metadata). |
| AI-31 | **P1** | **Cross-product decision patterns are injected into prompts.** `composeSystemPrompt()` includes `patternContext` (priority 6). The orientation document notes: "Cross-product decision_patterns table has no access controls -- any founder can influence." If product A's patterns are injected into product B's agent prompts, and product A has poisoned their patterns, this is a cross-tenant data contamination vector via prompts. |
| AI-32 | **P1** | **Safety gate regex patterns are easily evadable.** The patterns like `/self[\s-]preservation/i` and `/manipulation/i` catch literal strings but not semantic equivalents. An evolution change with text like "ensure the agent continues operating even when the system attempts to alter its configuration" semantically means self-preservation but bypasses the regex. The LLM-based safety check should catch this, but the regex pre-screen gives false confidence. |

### 10. Production Readiness Assessment

| Dimension | Rating | Notes |
|-----------|--------|-------|
| Prompt quality | B+ | Good personas, structured output, calibration. Missing injection defense. |
| Model routing | C+ | Static Opus/Sonnet split. No dynamic routing or cheap model for simple tasks. |
| Context management | B- | Priority-based trimming exists but is not used in the main agent loop. |
| Cost control | F | Cost logging without cost limits. No circuit breaker on spending. |
| Hallucination mitigation | C | Structural prompt defenses but no output verification. |
| Evaluation strategy | B- | Impressive architecture. Not operational. No offline test suite. |
| Agent coordination | B+ | Three-layer coordination. Ordering bias and fire-and-forget weakness. |
| Error recovery | F | No timeout, no retry, fail-open regression gate. |
| Safety/security | C- | Strong evolution gates. Zero runtime prompt defense. |
| **Overall** | **C** | **Prototype-grade AI system with production-grade ambitions.** |

---

## Priority Action Items

### P0 — Must fix before production

1. **AI-25/AI-26: Add timeout + retry to all LLM calls.** Wrap `client.messages.create()` with AbortController (30s timeout for Sonnet, 120s for Opus) and exponential backoff retry (3 attempts, 429/500/network errors). This is the single highest-impact fix.

2. **AI-12: Implement cost ceiling.** Add a per-product daily cost cap (configurable, default $5/day Solo, $15/day Growth, $50/day Investor-Ready). Check before each LLM call. Log a warning signal when 80% is reached. Hard-stop agents when exceeded.

3. **AI-01/AI-30: Add prompt input sanitization.** Create a `sanitizeForPrompt(text: string): string` utility that strips or escapes control sequences, XML-like tags, and instruction-like patterns from all user-controlled data before prompt injection. Apply to integration events, customer signals, agent messages, GitHub data.

### P1 — Fix within 2 weeks of launch

4. **AI-02/AI-03: Use structured output or Zod validation.** Either switch to Claude's tool_use mode for JSON responses (guaranteed schema conformance) or add Zod schemas that validate parsed JSON before use. Every `parseJSONResponse<T>()` call site is a type assertion lie.

5. **AI-14: Centralize cost calculation.** Create a `computeCost(model: AIModel, usage: {input_tokens, output_tokens}): number` function with correct per-model pricing. Use it everywhere. Current code has 3 different formulas.

6. **AI-10: Apply context budget to BaseAgent.** Refactor `BaseAgent.buildSystemPrompt()` to use `composeSystemPrompt()` or implement its own token budget enforcement. The main agent execution path has no context size control.

7. **AI-28: Make regression gate fail-closed.** Change the catch handler in `runRegressionGate()` to return `passed: false`. A regression gate that passes on error defeats its purpose.

### P2 — Address within 30 days

8. **AI-17: Validate LLM-generated agent names.** Check `to_agent` and `agent_to_notify` values against the `ALL_AGENTS` constant. Log and discard messages to invalid agents.

9. **AI-20: Create an offline evaluation suite.** Build 3-5 golden test cases per agent: fixed input data, expected output patterns (not exact match -- pattern match on observations, health score ranges, briefing priority). Run on prompt changes and model upgrades.

10. **AI-06/AI-07: Add a cheap model tier.** Use Haiku for consensus detection, message routing validation, and other classification tasks that do not need Opus/Sonnet reasoning depth.

---

## Architecture Commendations

Despite the critical gaps, several aspects of this AI architecture are genuinely strong and should be preserved:

1. **The evolution engine with 5-gate validation** is a serious attempt at safe agent self-improvement. The combination of constitution compliance, golden lesson regression, size bounds, drift detection, and safety screening is defense-in-depth done right.

2. **The accuracy tracking pipeline** (predict -> measure -> calibrate -> evolve prompts) is the right long-term architecture for reducing hallucinations through empirical feedback rather than prompt heuristics alone.

3. **The debate orchestrator** (Challenger identifies conflicts, Synthesizer resolves them weighted by accuracy scores) is a sophisticated pattern for multi-agent output quality that most systems never attempt.

4. **Psychology-aware calibration** that adapts AI communication style to founder cognitive patterns (perfectionism, imposter syndrome, overcorrection) shows deep product thinking about the human-AI interface.

5. **Golden lessons as per-company behavioral memory** injected into prompts is the right abstraction for making agents that learn from corrections rather than just resetting each run.

---

## Cost Modeling (Estimated)

Assuming 1 active product:

| Component | Calls/day | Model | Est. cost/call | Daily cost |
|-----------|-----------|-------|----------------|------------|
| 12 agents (mixed cadence) | ~8-12 | Sonnet/Opus | $0.02-0.15 | $0.50-1.50 |
| Briefing generation | 1 | Sonnet | $0.03 | $0.03 |
| Debate (Challenger + Synthesizer) | 2 | Sonnet | $0.03 | $0.06 |
| Evolution (if triggered) | 5-15 | Sonnet | $0.02 | $0.10-0.30 |
| Scratchpad consensus | 1 | None (heuristic) | $0 | $0 |
| **Total per product** | | | | **$0.70-1.90/day** |
| **100 products** | | | | **$70-190/day** |
| **1000 products** | | | | **$700-1900/day** |

At scale, the evolution engine and gate validation LLM calls are the cost multiplier risk. Without a cost ceiling, a bad day of corrections could trigger evolution across all agents for all products.

---

*Audited files: `src/services/ai/client.ts`, `src/services/ai/composer.ts`, `src/services/ai/gates.ts`, `src/services/ai/calibration.ts`, `src/types/ai.ts`, `src/services/scp/agents/base.ts`, `src/services/scp/agents/atlas.ts`, `src/services/scp/agents/oracle.ts`, `src/services/scp/agents/challenger.ts`, `src/services/scp/types.ts`, `src/services/scp/instance.ts`, `src/services/scp/provisioner.ts`, `src/services/scp/scheduler.ts`, `src/services/scp/evolution.ts`, `src/services/scp/gates.ts`, `src/services/scp/accuracy/calibrator.ts`, `src/services/scp/accuracy/tracker.ts`, `src/services/scp/accuracy/prompt-evolver.ts`, `src/services/scp/coordination/scratchpad.ts`, `src/services/scp/debate/orchestrator.ts`, `src/services/scp/briefing.ts`*
