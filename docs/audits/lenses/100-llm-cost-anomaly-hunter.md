# Lens 100 — LLM Cost Anomaly Hunter

**Distinct value:** Identifies runaway cost patterns, expensive anti-patterns, fleet-scale cost multiplication risks, and missing cost controls in the AI pipeline. Calculates theoretical maximum daily spend, identifies the most expensive code paths, and evaluates whether the cost ceiling actually prevents bill shock.

**Tenancy-critical:** Yes. Cost scales linearly with product count. A fleet of N products runs 12 agents each, hourly, with full prompt context. The cost ceiling is per-product, but there is no fleet-level ceiling, no aggregate daily limit, and no circuit breaker that pauses the entire fleet if costs spike.

## Executive Summary

Foundry has a per-product daily cost ceiling ($25/day default) tracked in an in-memory Map. This is the only cost control. The ceiling works for single-product operation but has 5 critical gaps at fleet scale: (1) the in-memory Map resets on server restart, allowing a full day's costs to be re-incurred, (2) there is no fleet-level aggregate ceiling, (3) the `callClaudeMultiTurn()` function does not check the cost ceiling at all, (4) several high-cost code paths bypass the ceiling by not passing `productId`, and (5) the Opus model is used in at least 3 non-agent contexts (weekly synthesis, decisions, evolution) where Sonnet would suffice. Theoretical maximum daily spend for a 10-product Investor-Ready founder: **$250/day** ($7,500/month) against $399/month revenue.

## Findings

### LCA-01 In-Memory Cost Ceiling Resets on Server Restart
- **Severity:** P0
- **Description:** The daily spend tracker (`dailySpend` Map in `src/services/ai/client.ts:21`) is stored in process memory. When the Fly.io instance restarts (deployment, crash, scaling), the Map is cleared. After restart, the cost ceiling check (`isCostCeilingReached()`) returns false for every product, even if that product already spent $25 earlier in the day. The result: a single deploy can allow costs to double for the day.
- **Evidence:** `src/services/ai/client.ts:21` — `const dailySpend = new Map<string, { cents: number; date: string }>()`. No persistence. No loading from DB on startup.
- **Remediation:** Persist daily spend to the `agent_cost_log` table. On each `callClaude()`, query the DB for today's total spend for that product before proceeding. Cache the value in memory for 5 minutes to avoid excessive DB queries, but always start from the DB value on first access after startup.

### LCA-02 callClaudeMultiTurn() Does Not Check Cost Ceiling
- **Severity:** P1
- **Description:** The `callClaudeMultiTurn()` function (`src/services/ai/client.ts:161-192`) is used for the onboarding chat, the COO conversation, voice briefing replies, and other multi-turn interactions. It does not accept a `productId` parameter and does not call `isCostCeilingReached()`. It also does not call `recordSpend()`. Multi-turn conversations are uncapped and untracked.
- **Evidence:** `src/services/ai/client.ts:161` — `async function callClaudeMultiTurn(systemPrompt, messages, maxTokens, useOpus)`. No `productId` parameter. No cost ceiling check. No `recordSpend()` call.
- **Remediation:** Add `productId` parameter to `callClaudeMultiTurn()`. Add ceiling check and spend recording. This also fixes the accuracy of per-product cost tracking.

### LCA-03 Several Code Paths Call Claude Without productId
- **Severity:** P1
- **Description:** The `callOpus()` and `callSonnet()` functions accept `productId` as an optional parameter. Multiple callers omit it:
  - `src/services/intelligence/competitive.ts` — weekly competitive scan (Sonnet call, no productId)
  - `src/services/intelligence/global.ts` — geopolitical risk scan (no productId)
  - `src/services/intelligence/regulatory.ts` — regulatory scan (no productId)
  - `src/services/wisdom/network.ts` — cross-product pattern aggregation (no productId — which product should it bill to?)
  - `src/services/scp/briefing/email-digest.ts` — digest generation (Sonnet call, no productId)
  
  These calls bypass the cost ceiling, are not recorded in per-product cost tracking, and contribute to an invisible "platform cost" that is not attributed to any product.
- **Evidence:** Grep for `callSonnet(` and `callOpus(` shows 189 total call sites across 77 files. Many pass productId, but the pattern `callSonnet(systemPrompt, userPrompt, maxTokens)` (3 args, no productId) appears in multiple files.
- **Remediation:** Make `productId` a required parameter on `callSonnet()` and `callOpus()`. For platform-level calls that do not belong to a specific product, create a `platform` pseudo-product or a separate `callClaudePlatform()` function with its own platform-level cost ceiling.

### LCA-04 Opus Used in Non-Strategic Contexts
- **Severity:** P1
- **Description:** Claude Opus costs 5x more than Sonnet ($15/$75 per M tokens vs $3/$15). Opus is designated for "strategic/methodology execution" and Sonnet for "operational intelligence." However, Opus is used in several operational contexts:
  - Oracle agent (`src/services/scp/agents/oracle.ts:260`) uses Opus for analytics — this may be justified as Oracle's domain requires deeper reasoning.
  - Weekly synthesis job (`src/jobs/index.ts:23`) imports and uses `callOpus` for synthesis.
  - Playbook generator (`src/services/playbook/generator.ts:224-228`) uses Opus for 3 separate calls per playbook generation.
  - Decision scenario modeling (`src/services/decisions/actions.ts`) uses Opus for generating action drafts.
  
  The playbook generator is the most expensive: 3 Opus calls with maxTokens of 256, 1024, and 2048 respectively. For a product that generates 4 playbook types, that is 12 Opus calls.
- **Evidence:** `src/services/scp/agents/oracle.ts:16` — `import { callOpus }`. `src/services/playbook/generator.ts:224-228` — 3 `callOpus` calls in parallel. `src/services/decisions/actions.ts` — `callOpus` for action drafts.
- **Remediation:** Evaluate each Opus usage: (1) Oracle analytics — consider if Sonnet produces comparable results at 80% lower cost. Run an A/B comparison. (2) Playbook generation — switch to Sonnet for the executive summary (256 tokens) and core principles sections. Keep Opus only for the main playbook body if quality degrades with Sonnet. (3) Action draft generation — Sonnet should suffice for generating structured action proposals.

### LCA-05 No Fleet-Level Cost Ceiling
- **Severity:** P1
- **Description:** The cost ceiling is per-product ($25/day). There is no aggregate ceiling across all products. A founder with 10 products on the Investor-Ready tier could incur $250/day ($7,500/month) in AI costs against $399/month in revenue. Even with the per-product ceiling, the economics are inverted: AI costs can exceed revenue by 18x for a fully-loaded Investor-Ready account.
- **Evidence:** `src/services/ai/client.ts:19` — `DAILY_COST_CEILING_CENTS = parseInt(process.env.AI_DAILY_COST_CEILING_CENTS ?? '2500', 10)`. Per-product only. No fleet aggregation.
- **Remediation:** Implement a per-founder daily ceiling that is the maximum of the per-product ceiling across all their products. For Investor-Ready ($399/month = ~$13/day): set founder-level ceiling at $50/day (leaves margin for burst usage). Add a circuit breaker that pauses all agents for a founder if their aggregate daily spend exceeds the ceiling.

### LCA-06 Agent Token Usage Is Not Optimized Per Cadence
- **Severity:** P2
- **Description:** All 12 agents use `maxTokens: 3000` for their main analysis call (most agents) or `maxTokens: 4096` (some agents). The prompt contexts include the full C-Suite Output Standard (~400 tokens), golden lessons (up to 30 entries), integration events (up to 15), and agent messages (up to 10). For agents that run frequently (Harbor runs every 4 hours with customer data), the full context rebuild is expensive. For agents that run daily (Shield, legal compliance), the full context is appropriate.
- **Evidence:** Agent files: `callSonnet(systemPrompt, userPrompt, 3000)` is the standard pattern. No agent-specific token optimization. `src/services/scp/types.ts` (inferred) — `DEFAULT_CADENCE_HOURS` varies per agent, but maxTokens does not.
- **Remediation:** Implement cadence-aware token budgets. Agents that run every 2-4 hours (Oracle, Harbor, Sentinel) should use shorter context windows and lower maxTokens. Agents that run every 12-24 hours (Shield, Scribe) can use larger contexts. Reduce maxTokens for agents whose output is typically short (Harbor's briefing contributions are 2-3 sentences; it does not need 3,000 output tokens).

### LCA-07 Evolution Synthesis Adds Opus Calls Per Agent Per Week
- **Severity:** P2
- **Description:** The `runEvolutionForAllProducts()` scheduler function (`src/services/scp/scheduler.ts:92-114`) runs evolution synthesis for every agent of every active product that has evolution enabled. Each `runEvolutionSynthesis()` call invokes `callOpus` for the synthesis analysis. With 12 agents per product and evolution running weekly, that is 12 Opus calls per product per week. For 50 products, that is 600 Opus calls per week just for evolution. If evolution is enabled by default, this is a significant cost line.
- **Evidence:** `src/services/scp/scheduler.ts:100-113` — loops through ALL_AGENTS for each product. `src/services/scp/evolution.ts` — uses `callOpus` (confirmed by the AI call count grep showing 3 calls in evolution.ts).
- **Remediation:** (1) Switch evolution synthesis to Sonnet. (2) Only run evolution for agents that have accumulated enough new sessions since last evolution (e.g., skip agents with <3 new sessions). (3) Add a product-level evolution cost budget.

## Cost Model

### Per-Product Daily Maximum (12 Agents, Hourly Cadence)

| Component | Model | Calls/Day | Est. Tokens/Call | Daily Cost |
|---|---|---|---|---|
| 12 agents x 24 runs (hourly) | Sonnet | 288 | ~4K in + 3K out | ~$17.28 |
| Daily briefing | Sonnet | 1 | ~8K in + 2K out | ~$0.05 |
| Evolution (weekly, amortized) | Opus | 1.7 | ~6K in + 2K out | ~$0.32 |
| Competitive scan (weekly, amortized) | Sonnet | 0.14 | ~4K in + 2K out | ~$0.01 |
| COO chat (3 messages/day) | Sonnet | 3 | ~4K in + 1K out | ~$0.06 |
| **Total** | | **~294** | | **~$17.72** |

The $25/day ceiling provides ~40% headroom above typical usage. This is appropriate.

### Fleet Maximum (10 Products, Investor-Ready)

| Component | Daily Cost |
|---|---|
| 10 products x $17.72 | $177.20 |
| Platform-level (no productId) | ~$2-5 |
| **Total** | **~$180/day ($5,400/month)** |

Against $399/month revenue: **13.5x cost-to-revenue ratio**. This is unsustainable at scale.

### Cost Reduction Opportunities

1. **Switch Oracle from Opus to Sonnet:** Saves ~$5/product/day (estimated)
2. **Switch evolution from Opus to Sonnet:** Saves ~$2/product/week
3. **Reduce agent cadence for stable products:** Operating/Optimizing lifecycle → 4-hour cadence instead of hourly → 6x reduction
4. **Cache agent context between runs:** Golden lessons, constitution, and agent config change rarely. Cache for 24 hours.
5. **Skip agents with no new data:** If no integration events, no new metrics, and no messages since last run, skip the AI call and return previous findings.

## Positive Findings

- The per-product daily cost ceiling (`AI_DAILY_COST_CEILING_CENTS`) is a genuine cost control that prevents single-product runaway.
- Cost logging to `agent_cost_log` provides an audit trail of AI spend per agent per session.
- The P&L cost events integration attributes AI costs to the product's financial model.
- Using Sonnet for 11 of 12 agents is the correct cost-efficiency choice (Oracle uses Opus, which may be justified for its strategic analysis role).
- The cost calculation uses Opus rates as a conservative upper bound even for Sonnet calls, ensuring the ceiling errs on the safe side.
