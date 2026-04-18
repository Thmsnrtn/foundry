# Lens 097 — LLM Output Validation Specialist

**Distinct value:** Audits whether every Claude response is validated against its expected schema before being used. Evaluates `parseJSONResponse`, type assertions, fallback handling, and the gap between "Claude returned text" and "the system acts on structured data." Per-agent analysis of validation quality.

**Tenancy-critical:** No. Output validation is per-agent, per-product. An invalid output from one product's agent does not affect another product.

## Executive Summary

Every agent in the SCP system calls `parseJSONResponse<T>()` which does `JSON.parse()` and casts the result to type `T` via TypeScript's `as T`. There is **zero runtime schema validation**. If Claude returns JSON that parses successfully but has wrong field names, missing fields, wrong types, or extra fields, the system silently accepts it. Each agent defines a TypeScript interface for its expected response (e.g., `AtlasClaudeResponse`, `ForgeClaudeResponse`), but these are compile-time types erased at runtime. The `parseJSONResponse` function strips markdown code fences and parses JSON — that is the entire validation. When parsing fails, every agent returns a graceful fallback ("encountered a parsing error — will retry next cycle") with a health score of 50, which is the correct pattern. The problem is what happens when parsing succeeds but the data is structurally wrong.

## Findings

### LOV-01 parseJSONResponse Has No Schema Validation
- **Severity:** P0
- **Description:** The `parseJSONResponse<T>()` function in `src/services/ai/client.ts:197-209` does three things: (1) trims whitespace, (2) strips markdown code fences, (3) calls `JSON.parse()`. The generic type `T` is a TypeScript-only construct erased at compile time. At runtime, `JSON.parse()` returns `any`, and the `as T` cast provides zero guarantees. If Claude returns `{"briefing_contribution": 42}` instead of `{"briefing_contribution": "some text"}`, the parse succeeds, the cast succeeds, and the string `42` (now a number) propagates through the system until something breaks downstream (or silently produces wrong data).
- **Evidence:** `src/services/ai/client.ts:197-209` — `return JSON.parse(cleaned.trim()) as T`. No Zod, no ajv, no runtime type checking. All 13 agents use this function.
- **Remediation:** Add Zod schemas for each agent's expected response type. Validate with `schema.safeParse(parsed)` after JSON.parse. On validation failure, treat it the same as a parse error (return fallback, health score 50). This catches: wrong types, missing required fields, unexpected values, and out-of-range numbers.

### LOV-02 No Validation of Numeric Ranges in Agent Output
- **Severity:** P1
- **Description:** Multiple agent response types include numeric fields with implicit ranges that are never validated:
  - `domain_health_score`: expected 0-100, used to weight the overall product health score
  - `confidence`: expected 0-1, used in gate evaluation thresholds
  - `success_threshold`: expected 0-1, used in experiment evaluation
  - `estimated_impact_usd`: expected positive, used in decision prioritization
  
  Claude could return `domain_health_score: 500` or `confidence: -3` or `estimated_impact_usd: NaN`. These values would flow through to health score computation, gate evaluation, and decision ranking without any bounds checking.
- **Evidence:** `src/services/scp/agents/atlas.ts:209` — `"domain_health_score": number (0-100)` in the prompt but no runtime validation. `src/services/scp/instance.ts:284-292` — `computeHealthScore()` uses `domain_health_score` directly in weighted sum. A score of 500 from one agent would skew the entire product health score.
- **Remediation:** Clamp numeric values at the point of use: `Math.max(0, Math.min(100, parsed.domain_health_score ?? 50))`. Better: validate in the Zod schema with `.min(0).max(100)`.

### LOV-03 Array Fields Default to Undefined, Not Empty Arrays
- **Severity:** P1
- **Description:** When Claude omits an array field from its JSON response (e.g., `architecture_proposals`, `revenue_actions`, `customer_signals`), `JSON.parse` returns an object without that key. The agent code accesses these with optional chaining or nullish coalescing, but the pattern is inconsistent. Atlas uses `(parsed.architecture_proposals ?? [])` which is correct. But if any agent forgets the `?? []` fallback and iterates over `undefined`, it crashes.
- **Evidence:** `src/services/scp/agents/atlas.ts:237` — `for (const proposal of (parsed.architecture_proposals ?? []))` (correct). `src/services/scp/agents/forge.ts:238` — `for (const action of (parsed.revenue_actions ?? []))` (correct). The pattern is consistent across agents but relies on every developer remembering `?? []`. A Zod schema with `.default([])` would guarantee this.
- **Remediation:** Define Zod schemas with `.array().default([])` for all array fields. This eliminates the need for `?? []` at every access point and prevents crashes if a developer forgets.

### LOV-04 Briefing Priority String Is Unvalidated
- **Severity:** P2
- **Description:** Every agent returns `briefingPriority` which is expected to be `"high" | "normal" | "low"`. Claude could return any string (e.g., `"critical"`, `"URGENT"`, `"1"`). The briefing generator likely sorts by priority, so an unexpected value could cause incorrect ordering or undefined behavior in comparisons.
- **Evidence:** `src/services/scp/agents/atlas.ts:212` — prompt says `"briefing_priority": "high" | "normal" | "low"` but no runtime validation. `src/services/scp/agents/base.ts:199` — stored directly from `result.briefingPriority`.
- **Remediation:** Validate against an allowed set: `const validPriorities = new Set(['high', 'normal', 'low']); const priority = validPriorities.has(parsed.briefing_priority) ? parsed.briefing_priority : 'normal'`.

### LOV-05 Agent Message Types Are Partially Validated
- **Severity:** P2 (positive partial)
- **Description:** The base agent does validate agent message types: `const validTypes = new Set(['insight', 'request', 'alert', 'handoff', 'question', 'report']); const msgType = validTypes.has(msg.message_type) ? msg.message_type : 'report'`. This is the correct pattern — validate against an allowed set and fall back to a safe default. However, `msg.priority` is not validated the same way. It is cast as `'low' | 'medium' | 'high' | 'critical'` with no runtime check.
- **Evidence:** `src/services/scp/agents/base.ts:294-302` — message type validated, priority not validated.
- **Remediation:** Apply the same validation pattern to `msg.priority`: validate against allowed values, default to 'medium'.

### LOV-06 Multi-Turn Chat Response Has No Structure Validation
- **Severity:** P2
- **Description:** The `callClaudeMultiTurn()` function (`src/services/ai/client.ts:161-192`) returns raw text content without any parsing or validation. The caller (e.g., onboarding chat) is responsible for parsing `CONTEXT_JSON:` and `READY_TO_BRIEF:` markers from the response. If Claude's response format drifts (e.g., it outputs `context_json:` in lowercase, or puts the JSON on the next line), the parsing silently fails and no context is extracted, making the onboarding stall without progress.
- **Evidence:** `src/services/scp/onboarding/chat.ts:79-92` — `parseContextJSON()` looks for exact string `'CONTEXT_JSON:'` (case-sensitive). `isReadyToBrief()` looks for exact string `'READY_TO_BRIEF: true'`. No fallback if Claude uses a slightly different format.
- **Remediation:** Make the markers case-insensitive and whitespace-tolerant. Better: use Claude's tool use / function calling to enforce structured output alongside conversational text, eliminating the need to parse markers from free-form text.

### LOV-07 Synthesizer Agent Has No Type Safety on Aggregated Output
- **Severity:** P2
- **Description:** The Synthesizer agent (`src/services/scp/agents/synthesizer.ts`) aggregates outputs from other agents. It parses Claude's response via `parseJSONResponse<SynthesizerResponse>`, but the `SynthesizerResponse` type likely includes fields derived from other agents' outputs. If the aggregation prompt produces a malformed response, the synthesizer has no validation of the sub-fields and may propagate errors from multiple agents.
- **Evidence:** `src/services/scp/agents/synthesizer.ts:105` — `parseJSONResponse<SynthesizerResponse>(response.content)`. The synthesizer processes 128 lines of code, suggesting a complex response structure.
- **Remediation:** Add Zod validation with detailed field-level schemas. The synthesizer is the single point where all agent outputs are combined, making it the highest-leverage place to add validation.

## Validation Coverage Matrix

| Agent | Uses parseJSONResponse | Has Fallback on Parse Error | Has Runtime Schema Validation | Has Numeric Range Checks |
|---|---|---|---|---|
| Atlas | Yes | Yes (health=50 fallback) | No | No |
| Compass | Yes | Yes | No | No |
| Prism | Yes | Yes | No | No |
| Beacon | Yes | Yes | No | No |
| Scribe | Yes | Yes | No | No |
| Forge | Yes | Yes | No | No |
| Harbor | Yes | Yes | No | No |
| Sentinel | Yes | Yes | No | No |
| Ledger | Yes | Yes | No | No |
| Shield | Yes | Yes | No | No |
| Oracle | Yes (Opus) | Yes | No | No |
| Crucible | Yes | Yes | No | No |
| Challenger | Yes | Yes | No | No |
| Synthesizer | Yes | Yes | No | No |

**Every agent has correct parse-error fallback. Zero agents have runtime schema validation.**

## Positive Findings

- The consistent fallback pattern across all 14 agents (parse error -> observations: ["error message"], healthScore: 50, briefingPriority: 'low') is well-designed. An agent that cannot parse Claude's response degrades gracefully without affecting other agents.
- The prompt specifications (included as string literals in each agent) clearly describe the expected JSON schema. Claude reliably produces conforming JSON from well-specified prompts, so the actual failure rate from schema mismatch is likely low in practice.
- Agent message type validation (`validTypes` set check) in the base agent is the correct runtime validation pattern that should be extended to all output fields.
