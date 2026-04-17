# Lens 39 — LLM Cost/Ops Reviewer Audit

**Auditor perspective:** LLM cost and operations reviewer evaluating cost tracking, budget enforcement, model routing efficiency, token usage optimization, and operational cost projections

**Date:** 2026-04-16
**Scope:** `src/services/ai/client.ts`, `src/services/scp/agents/base.ts` (cost logging), `src/services/financial/economics.ts`, `src/services/scp/agents/` (all 12 + synthesizer + challenger), `src/services/scp/evolution.ts`, `src/services/scp/gates.ts`, `src/services/scp/accuracy/prompt-evolver.ts`, `src/jobs/index.ts`

---

## Executive Summary

Foundry tracks AI costs at the agent session level and has a budget utilization dashboard -- this is better than most early-stage AI products. However, the system has **no cost ceiling or circuit breaker**, **no hard budget enforcement** (the budget is informational only), **hardcoded per-token cost calculations that are already wrong**, and **significant cost multiplication from the evolution pipeline** (up to 5 additional LLM calls per evolution cycle per agent). The estimated monthly cost per product is **$45-180/month at current scale** (12 agents, daily cadence), which is sustainable at the Growth tier ($199/month) but would be margin-destroying at Solo ($79/month). Cost is tracked after the fact but never prevented proactively.

**Verdict:** Good cost observability, zero cost control. The system will run up unbounded costs if any loop misfires or if product count scales.

---

## Findings

### 1. Cost Tracking Infrastructure

**Severity: P2 -- Present but flawed**

**Evidence:**

Cost tracking exists at multiple levels:

- **Agent session level:** `BaseAgent` logs `cost_usd` and `tokens_used` to `agent_sessions` table (line 233-240) and to `agent_cost_log` table with action type.
- **P&L system:** `financial/economics.ts` provides `logCost()` to record costs in `cost_events` table, and `getAICompanyPL()` computes 30-day P&L by agent and cost type.
- **Budget utilization:** `getBudgetUtilization()` in `economics.ts` compares actual spend against `operating_budget_monthly_usd` from the products table (default: $50).
- **Dashboard:** `agents-strategy.ts` renders a budget utilization bar with color coding (green/warning/critical).

| ID | Severity | Finding |
|----|----------|---------|
| COST-01 | **P1** | **Per-token cost calculations are hardcoded and already incorrect.** Atlas (Sonnet): `costUsd = tokensUsed * 0.000003`. Oracle (Opus): `costUsd = (input_tokens * 0.000015) + (output_tokens * 0.000075)`. The Sonnet calculation uses a single rate for both input and output tokens, but Sonnet input costs $3/MTok and output costs $15/MTok -- a 5x difference. Atlas is **underestimating its cost by approximately 3x** because most tokens are output. The fallback in `BaseAgent` (line 230): `costUsd = result.tokensUsed * 0.000015` conflates input and output tokens at the Opus input rate. |
| COST-02 | **P1** | **Cost rates are not centralized.** Each agent file independently calculates cost with different formulas. Atlas uses `0.000003`, Oracle uses `0.000015`/`0.000075`, and `BaseAgent` falls back to `0.000015`. When Anthropic changes pricing (which happens regularly), every agent file must be updated. There should be a single `calculateCost(model, inputTokens, outputTokens)` function in `client.ts`. |
| COST-03 | **P2** | **Evolution pipeline costs are not attributed.** The evolution engine (`evolution.ts`) makes 2 Sonnet calls (observation extraction + self-critique). The 5-gate pipeline (`gates.ts`) makes up to 3 additional Sonnet calls (constitution gate + regression gate + safety gate). These calls do not go through `BaseAgent` and do not log to `agent_cost_log` or `cost_events`. Evolution costs are invisible to the P&L system. |
| COST-04 | **P2** | **Fire-and-forget cost logging.** `BaseAgent` line 242: `import('../../financial/economics.js').then(({ logCost }) => { logCost({...}).catch(() => {}); }).catch(() => {});`. If the dynamic import fails, the cost log fails, or the DB write fails, the cost is silently lost. There is no reconciliation mechanism to detect missing cost records. |

### 2. Budget Enforcement

**Severity: P0 -- No hard enforcement**

| ID | Severity | Finding |
|----|----------|---------|
| COST-05 | **P0** | **Budget is informational only. There is no mechanism to stop AI calls when budget is exceeded.** The `operating_budget_monthly_usd` field (default $50) is read by `getBudgetUtilization()` for dashboard display and by Ledger agent for alerting, but no code path checks the budget before making an API call. An agent will continue making Opus calls even if the product has already spent 500% of its budget. |
| COST-06 | **P1** | **No per-call cost estimation before execution.** `callClaude()` does not estimate the cost of a call before making it. With the system prompt token count available from `composer.ts` and the user prompt length known, a pre-call cost estimate could gate expensive calls. An Opus call with 80K input tokens costs ~$1.20 for input alone -- this should be a conscious decision, not an unconditional API call. |
| COST-07 | **P1** | **No cost alerting at the platform level.** Ledger agent alerts the founder when budget utilization exceeds 80%, but there is no platform-level alerting that Foundry ops would see. If a bug causes 100 products to each run 50 Opus calls in a loop, the only signal would be the Anthropic invoice. |
| COST-08 | **P2** | **Default budget of $50/month is likely too low for the system's actual cost.** With 12 agents running daily, plus evolution, plus competitive scans, plus weekly synthesis (all Opus), a single product easily generates $45-180/month in AI costs. The default budget would be exceeded within the first week, generating permanent "critical" budget status on the dashboard. |

### 3. Model Routing Efficiency

**Severity: P2 -- Static routing, missed optimization opportunities**

**Evidence:**

Model routing is hardcoded per-agent:
- **Opus callers:** Oracle, audit scorer, competitive scan, weekly synthesis, ethics assessment, recovery protocol, predictive intelligence, digest generation
- **Sonnet callers:** Atlas, Beacon, Harbor, Forge, Compass, Prism, Scribe, Sentinel, Ledger, Shield, Crucible, all evolution/gates calls, prompt-evolver

| ID | Severity | Finding |
|----|----------|---------|
| COST-09 | **P2** | **No dynamic model downgrade for low-value calls.** All Sonnet-designated agents call Sonnet even when the run has no data ("No technical data available yet -- Atlas will assess code quality and architecture as data accumulates"). These no-data runs should use a cheaper model (if available) or skip the LLM call entirely. Several agents already return early without an AI call in the no-data case, which is good, but this is inconsistent across agents. |
| COST-10 | **P2** | **Oracle uses Opus for every daily run regardless of data richness.** Oracle is the most expensive regular agent because it uses Opus. On days with no new metrics, no new stressors, and no competitive signals, it should either skip the call or use Sonnet. The no-data early return exists but only triggers when all three data sources are empty simultaneously. |
| COST-11 | **P2** | **Evolution pipeline makes up to 5 LLM calls per cycle.** For each evolution: (1) observation extraction (Sonnet), (2) self-critique (Sonnet), then per proposed change: (3) constitution gate (Sonnet), (4) regression gate (Sonnet), (5) safety gate (Sonnet). With 2-3 proposed changes, this could be 9 Sonnet calls. Evolution is gated by adaptive cadence (less frequent as session count grows), but in the first 10 sessions it runs every time. |
| COST-12 | **P3** | **No Haiku/fast model tier.** The system defines only Opus and Sonnet. Several low-stakes tasks could use a faster, cheaper model: scratchpad consensus detection, simple event classification, JSON format validation, and the deterministic-seeming parts of evolution (the regex patterns already handle the simple cases -- the LLM is only needed for semantic analysis). |

### 4. Token Usage Optimization

**Severity: P2 -- Reasonable but not optimized**

| ID | Severity | Finding |
|----|----------|---------|
| COST-13 | **P2** | **maxTokens output budget is generous.** Most agents request `maxTokens: 3000`. Oracle requests 4096. Audit scorer requests 8192. For agents that return structured JSON with 3-5 observations and a few actions, 3000 output tokens is generous. Actual usage is likely 500-1500 tokens for most runs. Since output tokens cost 5x input tokens for Sonnet and Opus, over-provisioning output capacity wastes money when the model generates to the limit. |
| COST-14 | **P2** | **No caching of repeated context.** The same product context, DNA, golden lessons, and constitution are fetched and included in prompts across all 12 agents every run cycle. If Anthropic's prompt caching is available, these stable context blocks could be cached. The XML-tagged structure from `composeSystemPrompt()` would be ideal for caching, but agents do not use it. |
| COST-15 | **P3** | **System prompts are large.** `BaseAgent.buildSystemPrompt()` concatenates: domain prompt (300-500 tokens) + persona config + domain knowledge + task patterns + golden lessons (up to 30) + constitution principles + integration events (up to 15) + unread messages (up to 10) + scratchpad context + date + C-Suite output standard (200 tokens). A typical system prompt is likely 2000-4000 tokens. At Sonnet input pricing ($3/MTok), this is ~$0.006-0.012 per call, which is fine individually but adds up across 12 agents x daily x multiple products. |

### 5. Monthly Cost Estimation Per Product

**Severity: Informational**

Estimated monthly AI cost per active product (12 agents, daily cadence, single product):

| Component | Model | Calls/Month | Est. Input Tokens | Est. Output Tokens | Est. Cost/Month |
|-----------|-------|-------------|--------------------|--------------------|-----------------|
| 11 Sonnet agents (daily) | Sonnet 4.5 | 330 | ~3K each | ~1.5K each | $18.50 |
| Oracle (daily) | Opus 4.6 | 30 | ~4K each | ~2K each | $6.30 |
| Weekly synthesis | Opus 4.6 | 4 | ~8K each | ~4K each | $1.68 |
| Competitive scan (weekly) | Sonnet 4.5 | 4 | ~5K each | ~2K each | $0.18 |
| Digest generation | Opus 4.6 | 4-30 | ~6K each | ~3K each | $1.26-$9.45 |
| Evolution (first 10 sessions) | Sonnet 4.5 | ~50 | ~3K each | ~1K each | $3.00 |
| Evolution (steady state) | Sonnet 4.5 | ~10 | ~3K each | ~1K each | $0.60 |
| Behavioral triggers (6-hourly) | Sonnet 4.5 | ~120 | ~2K each | ~1K each | $6.84 |
| **Total (steady state)** | | | | | **$35-55** |
| **Total (with active evolution)** | | | | | **$45-80** |
| **Total (multi-product, 3 products)** | | | | | **$105-240** |

**Analysis:**
- At Solo tier ($79/month), AI costs alone consume 44-100% of revenue per product. **Solo tier is unprofitable.**
- At Growth tier ($199/month), AI costs are 18-40% of revenue. Viable but thin margins.
- At Investor-Ready tier ($399/month) with multiple products, costs scale linearly. 3 products = $105-240/month in AI costs (26-60% of revenue).

| ID | Severity | Finding |
|----|----------|---------|
| COST-16 | **P1** | **Solo tier ($79/month) is likely unprofitable due to AI costs.** With estimated $35-80/month in AI costs per product, plus infrastructure (Fly.io, Turso, Clerk, Resend), the fully-loaded cost per Solo product likely exceeds revenue. This is a pricing/cost alignment problem. |
| COST-17 | **P2** | **No tier-based AI cost controls.** Solo, Growth, and Investor-Ready products all run the same 12 agents at the same cadence with the same models. There is no mechanism to reduce AI usage for lower tiers (e.g., fewer agents, longer cadence, Sonnet-only for Solo, reduced evolution frequency). |

### 6. Cost-Relevant Jobs

**Severity: P2 -- Jobs multiply cost without controls**

| ID | Severity | Finding |
|----|----------|---------|
| COST-18 | **P2** | **SCP scheduler iterates all active products.** The hourly SCP job runs all 12 agents across all active products. With 100 products, this is 1,200 potential LLM calls per hour. There is no concurrency control, rate limiting against the Anthropic API, or staggering to spread load. |
| COST-19 | **P2** | **No dead-product detection.** Products that have not received new metrics in 90 days still run all 12 agents daily. Each agent returns "no data available -- calibrating" after a database query, which wastes agent session overhead even though no LLM call is made. But evolution might still fire, and the scheduler still processes all products. |
| COST-20 | **P3** | **Prediction measurement job makes no LLM calls but triggers accuracy score recomputation.** The `measurePendingPredictions` function in `tracker.ts` queries the database to measure outcomes. This is cheap, but it triggers `updateAccuracyScores()` which can trigger `generatePromptMutations()` via the daily cron, which makes Sonnet calls. The chain from measurement to mutation to LLM cost is not obvious from reading the job scheduler. |

---

## Embarrassment Test

**Would you be embarrassed if a cost-conscious CTO reviewed the AI spending?**

Yes. The cost tracking dashboard is professional and the P&L system is a genuine differentiator. But a CTO would immediately ask: "What happens when we hit budget?" and the answer is "Nothing -- we keep spending." They would also ask about the Solo tier economics and discover it is likely unprofitable. The hardcoded cost rates that are already wrong would undermine trust in the cost reporting.

---

## Pride Test

**What would you show off to an LLM ops colleague?**

1. **AI Company P&L.** The `financial/economics.ts` module that tracks costs by agent, attributes revenue to agent actions, and computes ROI per agent is sophisticated. Most agent systems have no concept of agent-level P&L.
2. **Budget utilization dashboard.** The `agents-strategy.ts` page with budget bars, projected month-end spend, and color-coded status is a good founder-facing feature.
3. **Cost logging at session level.** Every agent session records tokens used and cost, enabling trend analysis and per-agent cost attribution.
4. **Ledger agent as cost watchdog.** Having a dedicated financial agent that broadcasts budget warnings to the agent network when utilization exceeds 80% is a creative approach to self-regulating AI costs.
