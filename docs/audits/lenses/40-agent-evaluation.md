# Lens 40 — Agent Evaluation Expert Audit

**Auditor perspective:** Agent evaluation expert assessing accuracy tracking, golden evals, regression detection, feedback loops between outcomes and agent behavior, calibration, and evaluation rigor

**Date:** 2026-04-16
**Scope:** `src/services/scp/accuracy/tracker.ts`, `src/services/scp/accuracy/calibrator.ts`, `src/services/scp/accuracy/prompt-evolver.ts`, `src/services/scp/evolution.ts`, `src/services/scp/gates.ts`, `src/services/scp/agents/base.ts`, `src/jobs/index.ts`

---

## Executive Summary

Foundry has built a remarkably complete agent evaluation loop for an early-stage product. The system includes **prediction recording**, **automated outcome measurement**, **rolling 30-day accuracy scores with calibration error tracking**, **accuracy-driven prompt evolution**, and a **feedback loop that injects calibration context into agent prompts** ("You tend to be overconfident -- when you say 80% confidence, you're right 62% of the time"). This is genuinely advanced. However, the system has **no golden eval suite** (distinct from the golden lessons system, which tracks behavioral norms, not evaluation benchmarks), **no offline evaluation capability**, **no inter-rater reliability checks**, **regression detection that operates on a 30-60 day timescale** (too slow to catch prompt regressions from code changes), and **prediction extraction that is limited to three narrow types** (churn risk, expansion opportunity, experiment outcome). The evaluation infrastructure is strong in concept but narrow in coverage.

**Verdict:** Impressive closed-loop evaluation system. Needs broader prediction coverage, faster regression detection, and a true golden eval suite to reach production-grade evaluation rigor.

---

## Findings

### 1. Prediction Recording and Accuracy Tracking

**Severity: Strength with gaps**

**Evidence:**

The `accuracy/tracker.ts` module implements a structured prediction tracking system:

- **Prediction types:** `churn_risk`, `expansion_opportunity`, `metric_target`, `experiment_outcome`, `risk_escalation`
- **Each prediction records:** text, confidence (0-1), measure-by date, outcome criteria string
- **Automated measurement:** `measurePendingPredictions()` queries the database to determine if predictions came true
- **Outcome classification:** `correct`, `incorrect`, `partial`, `unmeasurable` with accuracy scores (1.0, 0.0, 0.5, null)
- **Rolling scores:** `updateAccuracyScores()` computes 30-day rolling accuracy rates and calibration error per prediction type per agent
- **Trend detection:** Compares last 30 days vs. prior 30 days to classify trend as `improving`, `stable`, or `degrading`

| ID | Severity | Finding |
|----|----------|---------|
| EVAL-01 | **P1** | **Prediction extraction is narrow and heuristic.** `calibrator.ts:extractPredictionsFromAnalysis()` only extracts predictions from three specific signal types: (1) `customerSignals` with "churn" in the note become `churn_risk` predictions, (2) `outboundActions` with "expansion" in the action_type become `expansion_opportunity` predictions, (3) `hypotheses` become `experiment_outcome` predictions. This means the vast majority of agent analysis -- observations, briefing contributions, stressor risk assessments, metric insights -- generates **zero trackable predictions**. Oracle identifies stressor risks and metric trends but none are recorded as predictions. Atlas identifies security risks but these are never tracked for accuracy. |
| EVAL-02 | **P2** | **Prediction confidence is hardcoded or self-reported, not calibrated.** Churn risk predictions use `confidence: 0.7` (hardcoded in calibrator.ts:58). Expansion opportunities use `confidence: 0.65` (hardcoded). Experiment outcomes use `confidence: hyp.success_threshold` (which is the target improvement, not a probability -- conceptual mismatch). The calibration feedback loop exists but cannot correct confidence if the initial confidence is never derived from the model's actual assessment. |
| EVAL-03 | **P2** | **Outcome measurement for `expansion_opportunity` is crude.** It searches `outbound_actions` for completed actions matching the customer ID or containing "expansion" in parameters. This conflates "a completed expansion action exists" with "the expansion opportunity predicted by the agent was the one that succeeded." If any expansion action completes for any reason, all expansion predictions are marked correct. |
| EVAL-04 | **P2** | **`risk_escalation` prediction type is defined in the schema but never generated.** The `PredictionInput` interface includes `risk_escalation` as a valid prediction type, but `extractPredictionsFromAnalysis()` never generates predictions of this type. Oracle, which identifies stressor risks, does not feed into the prediction system. |
| EVAL-05 | **P3** | **Unmeasurable predictions dilute accuracy statistics.** When a prediction cannot be measured (e.g., customer not found in database), it receives `outcome: 'unmeasurable'` and `accuracy_score: null`. These are correctly excluded from accuracy rate calculations, but the `total_predictions` count includes them. An agent with 100 predictions, 80 unmeasurable, 15 correct, and 5 incorrect would show 75% accuracy -- but this is based on only 20 measurable predictions. The denominator is misleadingly precise. |

### 2. Calibration Feedback Loop

**Severity: Strength**

**Evidence:**

The calibration system in `calibrator.ts` and `tracker.ts` forms a closed loop:

1. Predictions are recorded with confidence scores
2. Outcomes are measured against database state
3. `getCalibrationContext()` computes the gap between stated confidence and actual accuracy
4. If the gap exceeds 10pp, a directional correction is generated: "You tend to be overconfident -- when you say 80% confidence, you're right 62% of the time (18pp gap). Calibrate accordingly."
5. This context string is injected into agent prompts via `getAccuracyPromptAddendum()`
6. The injection only activates after 5+ measured predictions (cold start protection)

| ID | Severity | Finding |
|----|----------|---------|
| EVAL-06 | **P2** | **Calibration addendum is generated but integration point is unclear.** `getAccuracyPromptAddendum()` returns a string, but a grep for calls to this function reveals it is only called from a few places. The `BaseAgent.buildSystemPrompt()` method does not call it -- meaning the calibration context may not actually be injected into all agent prompts. The infrastructure exists but the wiring may be incomplete. |
| EVAL-07 | **P3** | **Calibration feedback is text-based, not numerical.** The system tells the agent "you tend to be overconfident" but does not mechanically adjust the confidence values. The gate system in `ai/gates.ts` evaluates the raw confidence from the model, not a calibrated confidence. A separate calibration step that adjusts `decision.confidence *= calibration_factor` before gate evaluation would be more reliable than hoping the model self-corrects based on a text instruction. |

### 3. Golden Eval Suite (or Lack Thereof)

**Severity: P1 -- Absent**

**Evidence:**

The system has a `golden_suite` table that stores **golden lessons** -- behavioral norms learned from past agent sessions. These are distinct from golden evals. Golden lessons are injected into prompts as context ("GOLDEN LESSONS: 1. Always prioritize retention over acquisition"). Golden evals would be saved (input, expected_output) pairs used to evaluate agent quality deterministically.

| ID | Severity | Finding |
|----|----------|---------|
| EVAL-08 | **P1** | **No golden eval suite exists.** There are no saved test cases with known-good inputs and expected outputs for any agent. If an Atlas prompt is changed and the new version produces worse technical assessments, there is no fast way to detect this. The accuracy tracker operates on a 30-60 day timescale (predictions must mature and be measured). A golden eval suite would catch regressions in minutes. |
| EVAL-09 | **P1** | **No offline evaluation capability.** There is no way to run an agent against a saved context (metrics, stressors, competitive signals) and compare its output to a reference answer. Every agent evaluation requires a live database with real product data. This makes it impossible to: (a) evaluate prompt changes before deploying them, (b) compare two prompt versions on the same input, (c) regression-test after model upgrades. |
| EVAL-10 | **P2** | **Golden lessons are NOT golden evals.** The naming similarity is confusing. Golden lessons are behavioral instructions ("always recommend retention outreach before price cuts"). Golden evals would be concrete test cases ("Given these metrics and stressors, the expected output should identify churn risk for accounts A, B, C"). The golden_suite table serves lesson storage; there is no eval storage. |

### 4. Prompt Evolution and Its Evaluation

**Severity: Strength with evaluation gap**

**Evidence:**

The `accuracy/prompt-evolver.ts` module is a sophisticated accuracy-driven prompt evolution system:

1. Finds agents with rolling accuracy < 60% or calibration error > 30pp
2. Generates targeted "delta instructions" (emphasis shift, context addition, or framing change)
3. Stores mutations in `evolved_prompts` table with before/after accuracy tracking
4. Mutations are activated explicitly and their impact is measured over subsequent predictions
5. `recordMutationOutcome()` computes accuracy after activation for comparison

| ID | Severity | Finding |
|----|----------|---------|
| EVAL-11 | **P2** | **Prompt mutation evaluation lacks statistical rigor.** The before/after comparison compares average accuracy before activation vs. after activation. This does not control for: (a) temporal confounds (business conditions change over time), (b) sample size (3 predictions is the minimum, which is too few for statistical significance), (c) multiple mutations being active sequentially (prior mutation's effects may persist). A proper evaluation would use holdout groups or at minimum a larger sample requirement. |
| EVAL-12 | **P2** | **No automatic rollback of underperforming prompt mutations.** The evolution engine (`evolution.ts`) has auto-rollback when success rate drops below 50%, but the prompt-evolver has no equivalent. A prompt mutation that degrades accuracy from 60% to 30% would remain active until manually deactivated or replaced by a new mutation. |
| EVAL-13 | **P3** | **Prompt mutations are append-only deltas.** The evolver generates instructions to append to the system prompt, never to replace or remove existing instructions. Over time, an agent's prompt accumulates delta instructions like geological layers. There is no pruning mechanism to remove deltas that are no longer improving performance. |

### 5. Regression Detection

**Severity: P1 -- Too slow**

| ID | Severity | Finding |
|----|----------|---------|
| EVAL-14 | **P1** | **Regression detection operates on a 30-60 day timescale.** The accuracy tracker compares last-30-days vs. prior-30-days to detect trends. A prompt change that degrades agent quality would not be detected for 30+ days, during which the agent would be producing poor analysis for live products. For prompt changes, regression needs to be detected in minutes (via golden evals), not months. |
| EVAL-15 | **P2** | **No alerting on accuracy degradation.** The trend field (`improving`/`stable`/`degrading`) is computed and stored but no alert is generated when an agent's accuracy degrades. The Ledger agent monitors budget but no agent monitors accuracy. A "degrading" trend should trigger a notification to the founder and potentially pause the agent. |
| EVAL-16 | **P2** | **Evolution auto-rollback threshold (50% success rate) is too permissive.** The auto-rollback in `evolution.ts` triggers when success rate drops below 50% over 5 sessions. But "success" is defined by the `outcome` field in `audit_log`, which records whether the evolution session itself completed, not whether the agent's subsequent predictions were accurate. The rollback signal and the accuracy signal are disconnected. |

### 6. Inter-Agent Evaluation

**Severity: P2 -- No cross-agent evaluation**

| ID | Severity | Finding |
|----|----------|---------|
| EVAL-17 | **P2** | **No evaluation of agent coordination quality.** Agents send messages to each other (Harbor alerts Forge about churn, Oracle routes stressor intelligence to relevant agents). There is no tracking of whether these messages resulted in correct actions by the receiving agent. The agent messaging system is fire-and-forget with no outcome tracking. |
| EVAL-18 | **P2** | **No evaluation of briefing quality.** Agent briefing contributions are assembled into daily briefings for founders. There is no measurement of whether founders find briefings useful, act on recommendations, or whether briefing predictions come true. The briefing is the primary founder-facing output, yet it has zero quality evaluation. |
| EVAL-19 | **P3** | **No diversity-of-opinion evaluation.** When 12 agents analyze the same company, there is no check for whether they produce sufficiently diverse perspectives or just echo each other. The debate/orchestrator system exists for specific decisions, but routine agent runs have no consensus or divergence measurement. |

---

## Embarrassment Test

**Would you be embarrassed if an ML evaluation expert reviewed this system?**

Not entirely. The prediction tracking, calibration feedback loop, and prompt evolution system would earn genuine respect -- most agent systems have nothing comparable. But the expert would immediately ask "Where are your golden evals?" and "How fast can you detect a regression?" The answers (none, and 30-60 days) would be concerning. They would also flag the narrow prediction extraction (only 3 of 5 types ever generated), the lack of statistical rigor in mutation evaluation, and the absence of offline evaluation capability.

---

## Pride Test

**What would you show off to an agent evaluation colleague?**

1. **The closed-loop calibration system.** Predictions recorded, outcomes measured, calibration error computed, directional correction injected back into prompts. This is the textbook correct architecture for agent calibration.
2. **Accuracy-driven prompt evolution.** The `prompt-evolver.ts` that automatically generates targeted prompt mutations for underperforming agents, tracks before/after accuracy, and classifies mutation types (emphasis shift, context addition, framing change) is genuinely innovative.
3. **Per-agent, per-prediction-type accuracy breakdown.** The `agent_accuracy_scores` table provides granular accuracy reporting: an agent might be 80% accurate on churn predictions but 40% on expansion predictions. This enables targeted improvement.
4. **Adaptive evolution cadence.** The `shouldEvolveThisSession()` function that runs evolution aggressively in early sessions, moderately when observations are found, and conservatively at maturity is a well-thought-out lifecycle control.
5. **Auto-rollback on quality degradation.** The evolution engine's automatic rollback when success rate drops below 50% is a safety net that most agent systems lack.
