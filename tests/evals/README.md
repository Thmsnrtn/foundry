# Foundry — Evals

Golden-case suites for AI-adjacent code paths. They run alongside unit
tests in `npm run test:ci` (vitest picks up `*.test.ts` recursively).

## Why a separate `tests/evals/` directory

Unit tests verify code does what the test author thinks it does. **Evals
verify code does what the founder thinks it does** when an LLM, prompt,
or threshold is in the loop. Karpathy in the elite persona review:

> AI features that aren't evaluated drift silently. By the time a
> founder notices, you've lost their trust on a problem you can't
> reproduce.

The two suites live next to each other because the runner (vitest) is
the same. They're separated by directory because the *intent* is
different: a unit-test failure usually means new code broke old code; an
eval failure means a prompt, model, or threshold change moved a
classifiable output, which may or may not be intentional.

## Pattern

Each eval is a `*.eval.test.ts` file that:

1. Mocks the LLM client so judgments are deterministic in CI.
2. Loads cases from `cases/<suite>.json`.
3. Calls `defineEval(...)` from `_framework.ts`. Each case becomes its
   own `it(...)` with the case name and notes inline.

A case is:

```json
{
  "name": "short-id",
  "notes": "what behavior this pins down",
  "input":   { ... },
  "expected": { ... }
}
```

When a case fails, the test name surfaces the case + notes so you can
tell whether the new behavior is a regression or a deliberate
recalibration.

## Adding a new eval suite

1. Pick a deterministic surface that an LLM affects. Good targets:
   verdict thresholds, classification rules, parsed output shapes,
   prompt-derived rule sets.
2. Write 5–10 cases in `tests/evals/cases/<suite>.json`.
3. Write `tests/evals/<suite>.eval.test.ts` that loads the JSON and
   calls `defineEval`. Mock the LLM client at module level (see
   `voice-gate.eval.test.ts` for the canonical pattern).
4. Run locally: `npx vitest run tests/evals/<suite>.eval.test.ts`.
5. CI picks it up automatically.

## Per-agent evals

The 12 SCP agents (atlas, compass, prism, beacon, scribe, forge,
harbor, sentinel, ledger, shield, oracle, crucible) each have an
`analyzeAndAct` method that calls `callSonnet` with structured JSON
outputs. To eval an agent:

1. Pick 5–10 representative scenarios from `agent_messages` /
   `agent_predictions` history.
2. Capture the input context (snapshot of metric_snapshots, customer
   data, recent stressors at that point in time).
3. Capture the agent's output (signals, decisions, briefing
   contribution).
4. Mock `callSonnet` to return the captured JSON, run the agent, assert
   the deterministic mapping (signal severity, decision gate, message
   routing) is unchanged.

The point is to catch silent regressions in how the agent's *scaffold*
processes a stable LLM response — not to evaluate the LLM itself, which
requires real calls and is out of scope for CI.

## What this suite is **not**

- Not a production accuracy benchmark. Real LLM accuracy needs real
  calls, which cost money per run and don't belong in CI.
- Not a substitute for unit tests. Unit tests own correctness; evals
  own *expected behavior under change*.
- Not exhaustive. Five cases that catch real regressions beat fifty
  cases that look thorough on paper.
