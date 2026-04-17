# Lens 37 — Prompt Engineer Audit

**Auditor perspective:** Prompt engineer evaluating prompt quality, structure, best practices, versioning, testability, and consistency across the AI-powered codebase

**Date:** 2026-04-16
**Scope:** `src/services/ai/composer.ts`, `src/services/ai/client.ts`, `src/services/audit/scorer.ts`, `src/services/scp/agents/` (atlas, beacon, harbor, oracle examined in depth), `src/services/scp/evolution.ts`, `src/services/scp/gates.ts`, `src/services/scp/accuracy/prompt-evolver.ts`

---

## Executive Summary

Foundry's prompt engineering is among the best I have seen in a production agent system. The system prompts demonstrate genuine craft: they establish judgment frameworks rather than task checklists, use domain-specific personas with calibrated authority, and enforce a consistent analytical output structure (the C-Suite Output Standard). The `composer.ts` priority-based context assembly with XML tag wrapping is architecturally sound. However, the codebase has **zero prompt versioning**, **no A/B testing infrastructure for prompts**, **prompts embedded as string literals across 15+ files** with no centralized registry, and **inconsistent structural discipline** between the well-designed `composeSystemPrompt()` path and the ad-hoc `BaseAgent.buildSystemPrompt()` path. Prompts are excellent as written prose; they are poor as managed software artifacts.

**Verdict:** Exceptional prompt writing, inadequate prompt engineering infrastructure. The prompts work well today but are unmaintainable, untestable, and unversioned.

---

## Findings

### 1. Prompt Quality and Persona Design

**Severity: Strength (with caveats)**

**Evidence:**

The agent system prompts are genuinely well-written. They follow several best practices that many production systems miss:

- **Judgment frameworks over task lists.** Atlas: "You translate technical reality into business risk -- in language a CEO understands." Oracle: "Your first question is not 'is this good or bad?' -- it's 'what will this number cause in 30 days?'" These establish how the agent thinks, not just what it does.
- **Anti-pattern inoculation.** Harbor: "You do not say 'retention is at risk' -- you say 'Account TechCorp ($1,200 MRR) has been silent for 23 days...'" This is excellent prompt engineering: showing the model what not to do, then the correct alternative.
- **Calibrated skepticism.** Beacon: "You are deeply skeptical of vanity metrics. You care about: ICP match rate of new signups, time-to-value of cohorts by acquisition channel." This prevents the model's tendency to generate optimistic analysis.
- **C-Suite Output Standard** injected by `BaseAgent.buildSystemPrompt()` enforces POSITION/CONFIDENCE/STAKES/ACTION/SIGNAL structure across all 12 agents. This is a strong forcing function for analytical rigor.

**Caveats:**

| ID | Severity | Finding |
|----|----------|---------|
| PE-01 | **P2** | **Persona prompts are duplicated across agents with slight variations rather than composed from shared building blocks.** Each agent file contains a unique multi-paragraph system prompt as a string literal. There is no shared "voice" module or reusable instruction fragments. When you want to change the output standard, you must edit `BaseAgent.buildSystemPrompt()` and hope all 12 agents' prompts remain compatible with it. |
| PE-02 | **P2** | **Some agent prompts are weaker than others.** The Atlas, Oracle, Harbor, and Beacon prompts are excellent. The `SCORING_SYSTEM_PROMPT` in `scorer.ts` is adequate but relies heavily on "Respond in JSON format only" without structured output mode. The evolution engine prompts (`evolution.ts`, `gates.ts`) are functional but generic -- "You are an AI agent behavior analyst" lacks the specificity and anti-pattern inoculation of the main agent prompts. |

### 2. Prompt Structure and XML Tags

**Severity: P2 -- Inconsistent**

**Evidence:**

The codebase uses two different prompt assembly strategies that are not reconciled:

1. `composeSystemPrompt()` in `composer.ts` wraps every context component in XML tags (`<methodology>`, `<productContext>`, `<riskContext>`, etc.) and uses priority-based trimming. This is the correct approach -- it gives Claude clear boundaries between instruction and data.

2. `BaseAgent.buildSystemPrompt()` concatenates sections with `\n\n` separators and uses plain-text headers ("GOLDEN LESSONS:", "OPERATING PRINCIPLES:", "INTEGRATION SIGNALS:", "MESSAGES FROM AGENT NETWORK:", "REQUIRED OUTPUT FORMAT"). No XML tags.

3. `composeOperationalPrompt()` and `composeWeeklySynthesisPrompt()` use XML tags correctly.

4. Individual agent `analyzeAndAct()` methods pass their domain prompt through `this.buildSystemPrompt()` (the non-XML path), not through `composeSystemPrompt()` (the XML path).

| ID | Severity | Finding |
|----|----------|---------|
| PE-03 | **P2** | **`composeSystemPrompt()` is never called by agents.** The well-designed XML-tagged, priority-trimmed system prompt composer in `composer.ts` is used for the weekly synthesis and operational intelligence paths, but the 12 SCP agents all bypass it via `BaseAgent.buildSystemPrompt()`. The agents use a simpler, unstructured concatenation. This means the token budget management, priority trimming, and XML tagging are absent from the most frequent AI call path (hourly agent runs). |
| PE-04 | **P2** | **Context sections in `BaseAgent.buildSystemPrompt()` lack XML tag isolation.** Integration events, agent messages, golden lessons, and the C-Suite output standard are concatenated with plain-text headers. When data from external systems (GitHub events, Stripe signals) is injected between these sections, there is no structural boundary that prevents the model from conflating injected data with instructions. This is both a prompt quality issue and a prompt injection surface. |
| PE-05 | **P3** | **`composeWeeklySynthesisPrompt()` generates XML tags dynamically from object keys.** The function iterates `Object.entries(config)` and wraps each value in `<${k}>` tags. This means tag names are camelCase JavaScript identifiers (`featureUsage`, `mrrDecomposition`), not human-readable. While functional, it reduces prompt readability in Claude's context window. |

### 3. JSON Output Schema Specification

**Severity: P1 -- No validation, inconsistent specification**

**Evidence:**

Every agent and every scoring/evolution call asks Claude to "Return JSON only (no markdown fences)" and then specifies the expected schema inline in the user prompt as a JSON example with TypeScript-style type annotations (`"score": number (0-100)`).

| ID | Severity | Finding |
|----|----------|---------|
| PE-06 | **P1** | **JSON schemas are specified as human-readable examples, not machine-enforceable contracts.** Every agent prompt contains something like `"observations": ["string", ...]`. This relies on Claude's instruction-following to produce valid output. There is no use of Claude's `tool_use` or structured output mode, which would guarantee schema conformance. The `parseJSONResponse<T>()` function in `client.ts` does `JSON.parse()` with a bare `as T` cast -- zero runtime validation. |
| PE-07 | **P2** | **Schema definitions are duplicated between TypeScript interfaces and prompt text.** `AtlasClaudeResponse` interface in `atlas.ts` defines the expected shape, and the user prompt also specifies the same shape as a JSON example. These can drift. If you add a field to the interface but not the prompt, the model will not return it. If you change the prompt schema but not the interface, TypeScript will not catch the mismatch. |
| PE-08 | **P2** | **TypeScript union types in prompts are confusing.** Prompts contain: `"security_risk_level": "low" | "medium" | "high" | "critical"`. While Claude handles this, it is a TypeScript syntax convention, not a JSON convention. Using XML-tagged enum lists or prose descriptions would be more robust. |

### 4. Prompt Versioning and Management

**Severity: P1 -- Absent**

| ID | Severity | Finding |
|----|----------|---------|
| PE-09 | **P1** | **Zero prompt versioning.** There is no version identifier, hash, or changelog for any system prompt. The `evolved_prompts` table tracks prompt mutations for the accuracy-driven evolution path (prompt-evolver.ts), but the base system prompts -- the ones that define each agent's identity -- have no version tracking whatsoever. If an Atlas prompt change degrades output quality, there is no way to identify which commit changed it, compare before/after, or roll back to a known-good version. |
| PE-10 | **P1** | **Prompts are scattered across 15+ files as string literals.** Atlas prompt in `atlas.ts`, Beacon in `beacon.ts`, scorer prompt in `scorer.ts`, evolution prompts in `evolution.ts` and `gates.ts`, calibration prompts in `calibration.ts`, ethics prompts in `ethics.ts`. There is no centralized prompt registry, no `prompts/` directory, no prompt configuration file. Auditing all prompts requires grepping the entire codebase. |
| PE-11 | **P2** | **No A/B testing infrastructure for prompts.** The prompt-evolver (`accuracy/prompt-evolver.ts`) generates delta instructions appended to prompts based on accuracy data, which is a form of automated prompt optimization. But there is no mechanism to test two prompt variants simultaneously against the same inputs. The evolver activates a mutation globally and measures before/after, but this conflates temporal changes with prompt changes. |

### 5. Prompt Testability

**Severity: P1 -- Near zero**

| ID | Severity | Finding |
|----|----------|---------|
| PE-12 | **P1** | **Zero unit tests for prompts.** There are no tests that verify prompt assembly produces expected output, that context trimming works correctly, that XML tags are properly closed, or that prompt mutations are correctly appended. The `composeSystemPrompt()` function with its priority-based trimming is a pure function ideal for unit testing, but has zero tests. |
| PE-13 | **P2** | **No golden input/output pairs for prompt regression testing.** The golden_suite table stores behavioral lessons for agents, but there are no golden prompt test cases -- saved (input, expected_output) pairs that can detect when a prompt change causes regression. The accuracy tracker measures prediction outcomes over days/weeks, but there is no fast feedback loop for prompt changes. |
| PE-14 | **P2** | **No prompt linting or static analysis.** No checks that prompts contain required sections (e.g., output format specification), that XML tags are balanced, that JSON schema examples parse correctly, or that persona descriptions do not conflict with the C-Suite standard. |

### 6. Prompt Composition Architecture

**Severity: P2 -- Good foundation, incomplete execution**

**Evidence:**

The `composer.ts` priority system is well-designed:
- 12 priority levels from `PRIOR_OUTPUTS (5)` to `METHODOLOGY (10)`
- Lowest-priority components trimmed first when exceeding token budget
- XML tag wrapping for structural clarity
- Token estimation at 4 chars/token

But:

| ID | Severity | Finding |
|----|----------|---------|
| PE-15 | **P2** | **Token estimation is rough.** `CHARS_PER_TOKEN = 4` is a reasonable average for English prose but underestimates token count for JSON (lots of punctuation = more tokens per character) and code snippets. A prompt with heavy JSON examples could exceed the budget by 20-30%. |
| PE-16 | **P3** | **No token tracking across the full prompt.** The composer tracks system prompt tokens but does not account for user prompt tokens. Since the API call in `callClaude()` has a separate `maxTokens` for output, the total context window usage (system + user + output reservation) is never computed or validated against the model's actual context limit. |

---

## Embarrassment Test

**Would you be embarrassed if a prompt engineering expert reviewed this codebase?**

Mixed. The prompt writing itself would impress -- the personas, the anti-pattern inoculation, the C-Suite standard, the calibration system. But the infrastructure around prompts would draw criticism: prompts scattered as string literals, no versioning, no testing, no centralized registry, inconsistent use of the XML-tagged composer vs. plain-text concatenation. An expert would say: "Someone who clearly understands prompt engineering wrote these prompts, but someone who does not understand prompt ops deployed them."

---

## Pride Test

**What would you show off to a prompt engineering colleague?**

1. **The C-Suite Output Standard.** The POSITION/CONFIDENCE/STAKES/ACTION/SIGNAL framework injected into every agent is a genuinely good forcing function. It produces consistently actionable output.
2. **Anti-pattern inoculation in agent personas.** Harbor's "You do not say 'retention is at risk'" pattern is a technique many teams miss.
3. **Calibration-aware prompt adaptation.** The `ai/calibration.ts` system that adjusts tone, directness, length, and jargon based on founder psychology profiles is a differentiating feature.
4. **Priority-based context trimming** in `composer.ts` with 12 priority levels. The design is correct even if underutilized.
5. **Accuracy-driven prompt evolution.** The `prompt-evolver.ts` system that generates focused delta instructions based on prediction accuracy gaps is an advanced capability most agent systems lack.
