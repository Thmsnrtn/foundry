# Sweep 1 — Lens 136
## Prior findings status
- PI-01: IMPROVED — sanitizeForPrompt() now strips XML tags, injection patterns, and redacts PII before AI calls (DEFECT-0024); decision pattern fields still contain free-text from other products
- PI-02: STILL OPEN — network insights cross-company data fed to AI
- PI-03: IMPROVED — DNA free-text now sanitized before prompt injection
- PI-04: N/A (Low)
## New findings
- None
## Verdict: OPEN P0-P1 (PI-01 improved from P1 but cross-company free-text still enters prompts after consent gate; risk reduced)
