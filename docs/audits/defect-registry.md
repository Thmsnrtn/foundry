# Foundry — Defect Registry

Tracking all open P0/P1/P2 findings for convergence loop (Phase 9).
Updated: 2026-04-18

## Open P0 Findings

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| ~~SEC-01~~ | Lens 07 | Plaintext token storage | CLOSED (b0b24da) |
| ~~SEC-02~~ | Lens 07 | GitHub OAuth missing state | CLOSED (7c4beef) |
| ~~SEC-03~~ | Lens 07 | No CSRF protection | CLOSED (e392202) |
| ~~SEC-04~~ | Lens 07 | Stored XSS on share page | CLOSED (a3ff527) |
| ~~SEC-07~~ | Lens 07 | Zero input validation | CLOSED (c4aafb4) |
| ~~SEC-10~~ | Lens 07 | GitHub token in browser DOM | CLOSED (1ae62cc) |
| ~~MTI-01~~ | Lens 44 | Portfolio API no ownership | CLOSED (2f8b14d) |
| ~~MTI-02~~ | Lens 44 | Experiment routes no tenant scope | CLOSED (2f8b14d) |
| ~~REL-04~~ | Lens 06 | Static health check | CLOSED (a3ff527) |
| ~~REL-05~~ | Lens 06 | No SIGTERM handler | CLOSED (f4581ec) |
| ~~AI-01~~ | Lens 36 | No prompt injection defense | CLOSED (2f8706b) |
| ~~AI-12~~ | Lens 36 | No AI cost ceiling | CLOSED (d07b078) |
| ~~PRI-01~~ | Lens 28 | MRR uses dead tier names | CLOSED (c343f7d) |
| ~~PRI-03~~ | Lens 28 | No-code bypasses product limits | CLOSED (01b1075) |
| ~~PM-01~~ | Lens 26 | "Get Started Free" false advertising | CLOSED (3096df4) |
| ~~EDGE-01~~ | Lens 50 | Archived products accessible | CLOSED (b8bffbf) |
| ~~EDGE-02~~ | Lens 50 | Cancelled founders burn AI credits | CLOSED (fad14ea) |
| ~~DB-01~~ | Lens 04 | Foreign keys never enforced | CLOSED (3ac3666) |
| ~~DEVOPS-01~~ | Lens 10 | SQLite DB in git | CLOSED (082e5b5) |
| ~~LEGAL-01~~ | Lens 31 | No Privacy Policy or TOS | CLOSED (13d5666) |
| A11Y-05 | Lens 08 | Command palette inaccessible to SR | OPEN |
| PERF-01 | Lens 05 | Serial job execution blocks at scale | OPEN (P1 at current product count) |
| DB-02 | Lens 04 | 30 duplicate migration prefixes | OPEN (risk: non-deterministic schema) |

## Open P1 Findings (Prioritized)

| ID | Source | Description | Status |
|----|--------|-------------|--------|
| ~~SEC-06~~ | Lens 07 | Timing-unsafe key comparison | CLOSED (a3ff527) |
| ~~SEC-09~~ | Lens 07 | No security headers | CLOSED (3096df4) |
| ~~AI-25~~ | Lens 36 | No timeout on LLM calls | CLOSED (d07b078) |
| ~~AI-26~~ | Lens 36 | No retry on LLM calls | CLOSED (d07b078) |
| ~~REL-06~~ | Lens 06 | Migration failures don't halt prod | CLOSED (0e06ab3) |
| ~~DEVOPS-04~~ | Lens 10 | No .dockerignore | CLOSED (0e06ab3) |
| ~~A11Y-04~~ | Lens 08 | Risk state color-only | CLOSED (5fd1844) |
| ~~PM-02~~ | Lens 26 | SCP not provisioned in onboarding | CLOSED (da9cc9a) |
| DESIGN-01 | Lens 16 | 2,900+ inline styles bypass design system | OPEN (partially addressed with tokens) |
| DESIGN-02 | Lens 25 | Light-mode hex colors on dark bg | OPEN |
| DESIGN-03 | Lens 16 | No loading states | OPEN (skeleton CSS added, not yet applied to templates) |
| OBS-01 | Lens 11 | 180+ remaining console.log | OPEN (top 5 files done) |
| TYPE-01 | Lens 13 | 36 as-any casts | OPEN |
| TEST-01 | Lens 14 | Coverage below 80% target | OPEN (220 tests, improved from 75) |
| COPY-01 | Lens 46 | Inconsistent voice/terminology | OPEN |
| AUTH-01 | Lens 33 | RBAC middleware applied to 0 routes | OPEN |
| AUTH-02 | Lens 33 | Voice transcript webhook auth broken | OPEN |
| BILL-01 | Lens 32 | No dunning/failed payment recovery | OPEN |

## Closed Finding Count
- P0 closed: 20
- P1 closed: 8
- Total fixes committed: ~35

## Convergence Loop Status
- Sweeps completed: 0
- Consecutive clean sweeps: 0
- Target: 3 consecutive clean sweeps with 0 new P0/P1
