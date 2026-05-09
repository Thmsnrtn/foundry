# Foundry — Prompts

Centralized prompt templates. Per Council 6 (AI engineers): a change to
one agent's prompt must be diffable against the rest, and every prompt
that touches an LLM must have a typed builder + golden cases mounted in
the eval framework.

## Conventions

Each prompt module exports:

1. **A typed builder function** — pure; takes structured input, returns
   `{ system: string; user: string }`.
2. **A `GOLDEN_CASES` array** — input/expected JSON pairs the eval
   framework can run against the builder.
3. **No LLM calls** — this directory is for the strings, not the
   inference. The caller (e.g. `services/scp/agents/atlas.ts`) imports
   the builder and dispatches via `callSonnet`/`callOpus`.

## Why centralized

- A diff to one agent's prompt is reviewable as code, not as a
  refactor of a 300-line agent file.
- The eval framework (`tests/evals/`) imports the same builder used
  in production, so eval coverage is real.
- Future "prompt versioning" (rollback, A/B) gets a single place to
  hook in.

## Migration policy

Existing inline prompts (in `src/services/scp/agents/*.ts`,
`src/services/scp/briefing.ts`, `src/services/calibration/*.ts`,
`src/services/audit/*.ts`) move here as touched. Don't bulk-migrate —
each move should pair with new evals and a typecheck.

This directory currently includes:

- `briefing-headline.ts` — Sonnet-driven daily briefing headline
  generator (extracted from `services/scp/briefing.ts`).
- `voice-judge.ts` — voice-fingerprint scorer (extracted from
  `services/calibration/voice-fingerprint.ts`).

The next migrations (per the V3.1 roadmap) would be: each of the 12 SCP
agents' system prompts. Prioritize by how often the agent runs
(harbor, oracle, beacon are highest-traffic).
