# Sweep 1 — Lens 036 (AI Systems Architect)
## Prior findings status
- AI-01 (P0): No prompt injection defense — RESOLVED (DEFECT-0024, sanitizeForPrompt + XML wrapping + PII redaction in sanitize.ts)
- AI-02 (P1): No structured output validation — IMPROVED (DEFECT-0059, optional Zod schema param added to parseJSONResponse)
- AI-03 (P1): JSON parsing strips fences but model ignores "no fences" instruction — STILL OPEN (tool_use mode not adopted)
- AI-06 (P2): Model routing hardcoded per-agent — STILL OPEN
- AI-07 (P2): Only two models defined, no Haiku for cheap ops — STILL OPEN
- AI-08 (P3): Model versions hardcoded strings — STILL OPEN
## New findings
- None
## Verdict: OPEN P0-P1
