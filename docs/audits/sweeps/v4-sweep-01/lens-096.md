# Sweep 1 — Lens 096
## Prior findings status
- PIH-01: RESOLVED — sanitizeForPrompt() now strips XML tags, expanded injection patterns, and redacts PII (DEFECT-0024)
- PIH-02: STILL OPEN — GitHub commit messages still flow through audit pipeline to AI prompts
- PIH-03: IMPROVED — decision patterns now gated by consent (DEFECT-0044); sanitizeForPrompt applied to prompt composition
- PIH-04: IMPROVED — sanitizeForPrompt applied; onboarding chat messages still pass through with sanitization
- PIH-05: IMPROVED — COO chat uses validateBody for input; sanitization applied
- PIH-06: STILL OPEN — agent-to-agent messages still a lateral injection vector
## New findings
- None
## Verdict: OPEN P0-P1 (PIH-01 P0 resolved; PIH-02 remains P1)
