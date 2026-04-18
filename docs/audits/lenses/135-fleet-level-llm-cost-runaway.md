# Lens 135 — Fleet-Level LLM Cost Runaway Adversary

**Auditor perspective:** Edge-case hunter / domain adversary — worst-case daily AI cost for 25 products x 12 agents
**Distinct-value declaration:** Computes the maximum possible daily Anthropic bill by tracing every AI call path, multiplying by fleet size, and identifying which cost controls actually work vs. which can be bypassed. No prior lens computed the aggregate worst-case cost.
**Tenancy-critical:** Yes. AI cost is the primary variable expense. A fleet-level runaway could generate thousands of dollars in daily charges.

**Date:** 2026-04-16
**Repo:** foundry (Hono + Turso + Clerk + Anthropic)

---

## Summary

| Severity | Count |
|----------|-------|
| P0 | 1 |
| P1 | 2 |

---

## Cost Model

| Model | Input Cost | Output Cost | Typical Call |
|-------|-----------|-------------|-------------|
| Claude Opus 4.6 | $15/M tokens | $75/M tokens | ~2K input, ~2K output = $0.18 |
| Claude Sonnet 4.5 | $3/M tokens | $15/M tokens | ~2K input, ~1K output = $0.02 |

---

## AI Call Inventory (Per Product Per Day)

| Job / Path | Model | Frequency | Calls/Day | Cost/Day |
|-----------|-------|-----------|-----------|----------|
| `scp_agent_runner` (12 agents) | Sonnet | Hourly | 288 (12 x 24) | $5.76 |
| `scp_evolution_cycle` (12 agents) | Opus | Daily | 12 | $2.16 |
| `scp_daily_briefing` | Opus | Daily | 1 | $0.18 |
| `daily_insight_generate` | Opus | Daily | 1 | $0.18 |
| `weekly_plan_generate` | Opus | Weekly (1/7) | 0.14 | $0.03 |
| `competitive_scan` | Sonnet | Weekly (1/7) | 0.14 | $0.003 |
| `weekly_synthesis` (stressor ID) | Sonnet | Weekly (1/7) | 0.14 | $0.003 |
| `weekly_synthesis` (recovery protocol) | Opus | Conditional (Red) | 0-1 | $0-0.18 |
| `scenario_accuracy` | Opus | Weekly (1/7) | 0-3 | $0-0.54 |
| `morning_briefings` | Sonnet | Daily | 1 | $0.02 |
| `scp_debate_run` | Opus | Daily | 2-4 | $0.36-0.72 |
| `scp_compressed_brief` | Opus | Weekly (1/7) | 0.14 | $0.03 |
| `scp_strategy_synthesis` | Opus | Monthly (1/30) | 0.03 | $0.005 |
| `scp_failure_pattern_scan` | Sonnet | Daily | 1 | $0.02 |
| `scp_prompt_evolution` | Opus | Weekly (1/7) | 0.14 | $0.03 |
| `computeSignal` (prose, on cache miss) | Sonnet | Every 2h + page loads | 12 | $0.24 |
| `predictive_intelligence` | Opus | Weekly (1/7) | 0.14 | $0.03 |
| `action_draft_generation` | Opus | Daily | 1-5 | $0.18-0.90 |
| `scp_wisdom_synthesis` | Opus | Weekly (1/7) | 0.14 | $0.03 |
| Founder Ask (query bar) | Opus | On demand | 0-10 | $0-1.80 |
| Transcript analysis | Sonnet | On demand | 0-5 | $0-0.10 |
| **TOTAL PER PRODUCT** | | | **~320-340** | **$9-13** |

---

## Fleet Worst-Case Daily Cost (25 Products)

| Scenario | Cost |
|----------|------|
| All products green, minimal founder interaction | 25 x $9 = **$225/day** |
| All products green, active founders (10 Ask queries/day) | 25 x $13 = **$325/day** |
| 5 products in Red (recovery protocols, extra digests) | + 5 x $1.50 = $7.50 = **$333/day** |
| Hourly agent runner overflows + double execution | x2 for agent costs = **$370/day** |
| Deploy resets AI spend ceiling + full re-execution | Up to **$625/day** (25 x $25 ceiling) |

**Monthly cost range: $6,750 - $18,750/month** for 25 products.

---

## CR-01. Per-product daily cost ceiling ($25) is the ONLY cost control -- and it resets on deploy

**Severity: P0**
**Files:** `src/services/ai/client.ts:17-44`

The `DAILY_COST_CEILING_CENTS` (default 2500, configurable via env var) is enforced in `callClaude()` before each AI call. This is the only cost control in the system.

**Bypass vectors:**
1. **Deploy resets the ceiling** -- The `dailySpend` Map is in-memory. Every deploy resets all counters to zero. A product that spent $24.99 before deploy gets a fresh $25 budget.
2. **`callClaudeMultiTurn` bypasses the ceiling** -- The multi-turn conversation function (line 161-192) does NOT call `callClaude()` -- it calls `client.messages.create()` directly. No cost tracking, no ceiling check. Every "Ask" conversation bypasses cost controls.
3. **Not all callers pass `productId`** -- The ceiling check requires `config.productId` to be set. Some callers (e.g., `callOpus` and `callSonnet` with no productId argument) bypass the check because `productId` is optional.

**Evidence:**
- `src/services/ai/client.ts:67-68`: `if (config.productId && isCostCeilingReached(config.productId))` -- skipped when productId is undefined
- `src/services/ai/client.ts:161-192`: `callClaudeMultiTurn` has no cost tracking or ceiling check
- `src/services/ai/client.ts:123-136`: `callOpus` has `productId?: string` as optional parameter
- `src/jobs/index.ts:273`: `callOpus(...)` called without productId in `scenarioAccuracy`

---

## CR-02. No fleet-level cost ceiling -- 25 products x $25 = $625/day maximum with no aggregate control

**Severity: P1**
**Files:** `src/services/ai/client.ts`

Even if the per-product ceiling works perfectly, the aggregate fleet cost is unbounded at 25 x $25 = $625/day = $18,750/month. For a SaaS product with $399/mo pricing, this means a founder paying $399/mo could cost Foundry $625/day in AI spend.

There is no:
- Fleet-level daily cost ceiling
- Per-founder daily cost ceiling
- Monthly cost ceiling with automatic tier throttling
- Cost-proportional feature degradation (e.g., switch from Opus to Sonnet when 80% of ceiling reached)

---

## CR-03. Evolution cycle uses Opus for all 12 agents -- most expensive per-product job

**Severity: P1**
**Files:** `src/services/scp/evolution.ts`, `src/services/scp/scheduler.ts:92-114`

The daily evolution cycle calls `runEvolutionSynthesis` for each of the 12 agents. Evolution synthesis likely uses Opus (strategic analysis). At $0.18 per Opus call x 12 agents x 25 products = $54/day just for evolution.

Many agents may not need evolution on any given day (no new data, no behavioral drift). But the cycle runs for ALL agents regardless.

**Evidence:**
- `src/services/scp/scheduler.ts:100-113`: Iterates ALL_AGENTS (12) for every active product with `evolution_enabled=1`
- No "skip if no new sessions since last evolution" check

---

## Recommendations

1. **Move AI spend tracking to the database** -- Use `agent_cost_log` to compute daily spend. Query on ceiling check: `SELECT SUM(cost_usd) FROM agent_cost_log WHERE product_id=? AND logged_at >= date('now')`.
2. **Add cost tracking to `callClaudeMultiTurn`** -- Record spend and check ceiling, same as `callClaude`.
3. **Make `productId` required in `callOpus` and `callSonnet`** -- Remove the optional parameter to ensure all calls are tracked.
4. **Add a fleet-level daily ceiling** -- `FLEET_DAILY_COST_CEILING_CENTS` env var. When reached, switch all calls from Opus to Sonnet, or pause non-critical jobs.
5. **Skip evolution for agents with no new sessions** -- Check `last_evolution_at` and `total_sessions` delta before running evolution synthesis.
6. **Implement cost-proportional model selection** -- When a product reaches 50% of its daily ceiling, switch from Opus to Sonnet for non-critical operations (insights, plans, briefings).
