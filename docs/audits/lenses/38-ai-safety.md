# Lens 38 — AI Safety Reviewer Audit

**Auditor perspective:** AI safety reviewer evaluating guardrails, output filtering, PII handling, prompt injection defenses, content moderation, harmful output prevention, and agent action safety boundaries

**Date:** 2026-04-16
**Scope:** `src/services/ai/gates.ts`, `src/services/scp/gates.ts` (evolution validation), `src/services/scp/agents/base.ts`, agent implementations (atlas, beacon, harbor, oracle), `src/services/scp/evolution.ts`, `src/services/decisions/patterns.ts`, outbound action path

---

## Executive Summary

Foundry has invested meaningfully in **agent self-evolution safety** -- the 5-gate validation pipeline (constitution, regression, size, drift, safety) is well-designed and fail-closed for critical gates. The authority gate system (`ai/gates.ts`) with risk-state-aware escalation and cold-start restrictions is a sound architecture for limiting autonomous action. However, the system has **zero prompt injection defenses**, **no output filtering or content moderation**, **no PII detection or redaction**, and **no validation that agent outputs conform to expected schemas before acting on them**. The safety investment is concentrated on preventing agents from modifying themselves dangerously; it neglects preventing agents from producing dangerous outputs or being manipulated via injected data.

**Verdict:** Strong self-evolution safety guardrails. Critical gaps in input sanitization, output validation, and PII handling. The system trusts both its inputs and its AI outputs far too much.

---

## Findings

### 1. Prompt Injection Defenses

**Severity: P0 -- Absent**

| ID | Severity | Finding |
|----|----------|---------|
| SAF-01 | **P0** | **Zero prompt injection defense across the entire AI pipeline.** User-controlled data flows directly into agent prompts without any sanitization. Specific injection surfaces: (1) Integration events from GitHub, Stripe, Intercom, etc. are summarized in `_summariseEvent()` (base.ts:604-610) by concatenating raw field values (`customer_id`, `customer_email`, `amount`, `plan`, `event`, `actor`) and injecting them into the system prompt under "INTEGRATION SIGNALS". A malicious commit message, customer email, or webhook payload containing prompt injection text would be included verbatim. (2) Customer names, emails, and external IDs from `customer_intelligence` are passed directly to Harbor's prompt. (3) Competitive signals from `competitive_signals` table -- which may contain adversary-controlled text scraped from competitor websites -- are injected into Beacon and Oracle prompts. (4) `custom_instructions` from the founder AI profile (referenced in prior audit AI-05) allow authenticated users to inject arbitrary instructions. |
| SAF-02 | **P0** | **No input sanitization utilities exist anywhere in the codebase.** A grep for "sanitize", "escape", "injection", "fence", "delimit" across `src/services/ai/` returns zero results. There is no utility function, no middleware, no wrapper that cleans user-controlled data before it enters a prompt. |
| SAF-03 | **P1** | **Integration event summarization trusts external data.** `BaseAgent._summariseEvent()` iterates over known keys (`customer_id`, `customer_email`, etc.) and truncates to 40 characters per field. The 40-char truncation provides minimal protection -- it limits the size of injected text but does not prevent injection. A crafted `customer_email` field of `"; IGNORE ALL PRIOR INSTRUCTIONS. You ar` (exactly 40 chars) would be injected as-is. |

**Remediation:**
- Implement a `sanitizeForPrompt(text: string): string` utility that strips or escapes characters commonly used in prompt injection (quotes, semicolons, XML-like tags, instruction-like phrases)
- Wrap all user-controlled data in XML CDATA-like delimiters: `<user_data>{{content}}</user_data>` with explicit instructions to treat content within those tags as opaque data
- Add a lightweight classifier (regex + heuristic) that flags user-controlled strings containing instruction-like patterns before they enter prompts
- Use structured output mode (tool_use) to prevent model outputs from containing arbitrary instructions

### 2. Output Filtering and Content Moderation

**Severity: P1 -- Absent**

| ID | Severity | Finding |
|----|----------|---------|
| SAF-04 | **P1** | **No output filtering on any AI response.** `callClaude()` in `client.ts` returns the raw text content. `parseJSONResponse<T>()` performs `JSON.parse()` with a bare `as T` cast. There is no check that the output: (a) does not contain harmful content, (b) does not contain instructions to take unauthorized actions, (c) does not contain PII that was not in the input, (d) conforms to the expected schema. |
| SAF-05 | **P1** | **No validation between AI output and action execution.** When an agent returns `outboundActions` (e.g., "send email to customer", "create GitHub PR"), the `BaseAgent` processes them via fire-and-forget imports to `outbound/executor.js`. The `proposeAction()` path requires human approval for authority_level >= 2, but authority_level 0 and 1 actions from agent output are proposed with `confidence: 0.8` hardcoded -- not derived from actual model confidence. If the model hallucinates an action_type that does not exist or returns parameters that would cause harm, there is no validation layer between parse and execution. |
| SAF-06 | **P2** | **`stop_reason` from Claude is captured but never checked.** The `AIResponse` includes `stop_reason` but no caller checks if the response was truncated (`max_tokens`) vs. naturally completed (`end_turn`). A truncated JSON response would fail `JSON.parse()` and be caught, but a truncated text response (e.g., briefing contribution) would silently contain incomplete content. |

### 3. PII Handling in Prompts

**Severity: P1 -- No controls**

| ID | Severity | Finding |
|----|----------|---------|
| SAF-07 | **P1** | **Customer PII flows directly into agent prompts.** Harbor queries `customer_intelligence` for email addresses, account names, MRR amounts, and health scores, then passes them directly in the user prompt: `"Known at-risk customers: TechCorp (email@..., health=23, mrr=$1200)"`. This data is sent to Anthropic's API. While Anthropic's data usage policy may not train on API data, the PII is still transmitted to a third party and stored in Anthropic's logging infrastructure for 30 days (per their retention policy). |
| SAF-08 | **P1** | **No PII detection or redaction utility.** There is no function that detects email addresses, names, or financial data in prompt text and either redacts or pseudonymizes them before API calls. Every agent that receives customer data (`harbor`, `forge`, `beacon` via cohort channels) sends real PII to the model. |
| SAF-09 | **P2** | **Agent session transcripts stored in `agent_sessions` table contain full prompt outputs.** The `observations`, `actions_taken`, and `briefing_contribution` fields store AI-generated text that may reference customer PII. These are stored indefinitely (no retention policy enforced in the `agent_sessions` table, though `data_residency_settings.delete_agent_logs_after_days` exists as a setting). The data export function (`exportProductData`) does not export agent sessions, so a GDPR subject access request would miss this data. |

**Remediation:**
- Implement PII pseudonymization: replace real customer names/emails with deterministic pseudonyms before sending to the API, then de-pseudonymize in the response
- Add a PII detection scanner that flags prompts containing email patterns, phone numbers, or credit card numbers
- Ensure agent session data is included in GDPR data exports and subject to the configured retention policy

### 4. Authority Gate System (ai/gates.ts)

**Severity: Strength**

**Evidence:**

The authority gate system in `ai/gates.ts` is well-designed:

- **5 gate levels:** Gate 0 (fully autonomous) through Gate 4 (human only)
- **Risk-state-aware thresholds:** In Red state, Gates 0 and 1 are suspended except for `behavioral_trigger_email` and `critical_support_routing`. This is the correct conservative behavior.
- **Cold start restrictions:** New products restrict Gate 0 to only behavioral triggers and support routing.
- **Confidence-based escalation:** If an AI decision's confidence falls below the threshold for its assigned gate, it is escalated to the next higher gate.
- **Thresholds tighten appropriately:** Gate 0 requires 0.85 confidence across all risk states. Gate 1 requires 0.85 in Yellow/Red (up from 0.75 in Green).

| ID | Severity | Finding |
|----|----------|---------|
| SAF-10 | **P2** | **Yellow and Red state have identical thresholds.** `THRESHOLDS.yellow` and `THRESHOLDS.red` are both `{ gate_0: 0.85, gate_1: 0.85, gate_2: 0.60 }`. Red state only differs from Yellow in that Gates 0/1 are fully suspended for non-essential actions. The thresholds themselves should be higher in Red (e.g., Gate 2 at 0.75 in Red) to reflect the higher cost of bad decisions when the company is in crisis. |
| SAF-11 | **P2** | **Confidence scores are self-reported by the model.** The `confidence` field in `AIDecision` comes from the model's own output (parsed from JSON). There is no independent calibration or external validation of confidence. The accuracy tracker (`accuracy/tracker.ts`) computes calibration error after the fact, and the calibrator can inject "you tend to be overconfident" into prompts, but there is no real-time confidence adjustment at the gate evaluation point. |

### 5. Evolution Engine Safety (scp/gates.ts)

**Severity: Strength with gaps**

**Evidence:**

The 5-gate evolution validation pipeline is the strongest safety mechanism in the system:

- **Gate 1 (Constitution):** Regex patterns for 8 violation types + LLM-based constitutional compliance check. Fail-closed on LLM error.
- **Gate 2 (Regression):** LLM checks proposed changes against golden lessons. Fail-open on LLM error (debatable but documented).
- **Gate 3 (Size):** Deterministic check that config does not exceed 200 lines. No LLM needed.
- **Gate 4 (Drift):** Jaccard similarity against original config. Rejects if similarity drops below 0.2. Good mechanical guard against semantic drift.
- **Gate 5 (Safety):** Regex for 10 violation patterns + LLM safety review. Fail-closed on error.
- **Auto-rollback:** If success rate drops below 50% over 5 sessions post-evolution, changes are automatically rolled back.

| ID | Severity | Finding |
|----|----------|---------|
| SAF-12 | **P2** | **Gate 2 (Regression) fails open.** When the LLM call errors, the regression gate passes by default. The comment says this is intentional to avoid blocking evolution on transient API errors. However, this means a sustained Anthropic API outage would disable the regression safety check, allowing changes that contradict golden lessons. |
| SAF-13 | **P2** | **Constitution violation regex patterns are brittle.** Patterns like `/ignore\s+safety/i` and `/bypass\s+validation/i` are easy to circumvent with paraphrasing: "disregard security constraints" or "skip the validation step" would not match. The LLM-based check is the real defense; the regex is a fast pre-filter that catches only naive violations. |
| SAF-14 | **P2** | **Safety gate regex patterns overlap with constitution patterns but are not deduplicated.** `CONSTITUTION_VIOLATION_PATTERNS` and `SAFETY_VIOLATION_PATTERNS` share concepts (self-preservation, permission escalation) but are separate arrays with different patterns. A violation caught by constitution Gate 1 would also be caught by safety Gate 5, but the reverse is not guaranteed. These should be a unified, tested pattern set. |
| SAF-15 | **P3** | **Drift gate Jaccard similarity is coarse.** Jaccard on bag-of-words does not capture semantic drift. An agent config could be completely rewritten with different instructions but using the same vocabulary, and the drift gate would pass. Semantic similarity (embedding-based) would be more robust. |

### 6. Agent Action Boundaries

**Severity: P1 -- Weak enforcement**

| ID | Severity | Finding |
|----|----------|---------|
| SAF-16 | **P1** | **Outbound actions from agents are proposed with hardcoded confidence.** `BaseAgent` line 326: `confidence: 0.8` is hardcoded for all proposed outbound actions. The authority gate system evaluates confidence against thresholds, but the confidence value is not derived from the model's actual assessment -- it is always 0.8. This renders the confidence-based escalation mechanism partially ineffective for outbound actions. |
| SAF-17 | **P1** | **No allowlist of valid action types.** Agents return `action_type` as a free-text string from Claude's JSON output. There is no validation that the returned action_type is one of the known, implemented action types. If Claude returns `action_type: "delete_all_customer_data"`, it would be passed to `proposeAction()` and potentially queued. |
| SAF-18 | **P2** | **Fire-and-forget pattern suppresses safety-relevant errors.** Throughout `BaseAgent`, post-analysis processing uses `import(...).then(() => {...}).catch(() => {})`. If an outbound action proposal fails validation, the error is silently swallowed. If a customer signal contains dangerous data, the upsert failure is silent. Safety-relevant failures should be logged, not discarded. |

### 7. Harmful Output Prevention

**Severity: P1 -- No controls**

| ID | Severity | Finding |
|----|----------|---------|
| SAF-19 | **P1** | **No content moderation on AI-generated text.** Agent briefing contributions, observations, and decision recommendations are displayed to founders without any content filtering. If an agent produces text containing offensive content, competitive defamation, or legally risky advice (e.g., "fire employee X" or "this competitor is committing fraud"), it would be presented to the user as-is. |
| SAF-20 | **P2** | **No guardrails against financial advice.** Ledger and Forge agents produce financial analysis that could be interpreted as investment or financial advice. There is no disclaimer injection, no scope limitation that prevents agents from recommending specific financial actions that could have legal liability. |

---

## Embarrassment Test

**Would you be embarrassed if a safety-focused AI researcher reviewed this system?**

Partially. The evolution safety gates would earn respect -- the 5-gate pipeline with fail-closed constitution and safety checks, auto-rollback on accuracy degradation, and drift detection is genuinely thoughtful. The authority gate system with risk-state-aware escalation is sound architecture. But the researcher would immediately flag the complete absence of prompt injection defenses, PII handling, and output validation as disqualifying for a production system that handles real customer data. The system protects against agents modifying themselves dangerously but does not protect against agents being manipulated or producing dangerous outputs.

---

## Pride Test

**What would you show off to an AI safety colleague?**

1. **The 5-gate evolution validation pipeline.** Constitution compliance, golden lesson regression, size limits, drift detection, and safety review -- with fail-closed on critical gates and auto-rollback on accuracy degradation. This is a mature, well-layered defense.
2. **Risk-state-aware authority escalation.** Automatically suspending autonomous action in Red state and restricting cold-start products to minimal autonomy is exactly the right pattern.
3. **The overall architecture of bounded autonomy.** Gate 0 through Gate 4 with confidence thresholds, where the system defaults to human oversight when uncertain, is the correct safety posture for an autonomous business intelligence system.
