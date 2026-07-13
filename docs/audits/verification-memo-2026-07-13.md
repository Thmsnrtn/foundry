# Verification Memo — Finish-Line Directive findings vs. live repo

**Date:** 2026-07-13 · **Verifier:** Claude (remote session) · **Rule applied:**
where the repo contradicts the directive, the repo wins. Verdicts below are
evidence-cited; stale directive numbers are corrected, not repeated.

## F1 — "Launch-ready but not launched" → CONFIRMED, numbers stale

- **Gate:** `npm run check` (typecheck + 4 ratchets + kernel-boundary +
  truth:audit + tests) is green on master. Test count is **897**, not 346 —
  the directive predates the Ascent phases (Memory Kernel, Red Team, Ghost,
  radar, trust ladder, Autopilot, Trust Plane, Fluency) and the Hands phases
  (connections/grants/envelopes/reserved powers, four departments), all
  merged since.
- **Deploy blocked: CONFIRMED and worse than stated** — `foundry-intel.fly.dev`
  times out on every path (probed 2026-07-12; egress from the probe
  environment was fine). No healthy machine is serving. Root cause per
  original deploy log: fatal secrets never set → boot crash → Fly stopped
  the machine. The 15-minute operator runbook with verified live Stripe
  price IDs is at `docs/blockers/BLOCKER-FLY-TOKEN.md`. A full local staging
  rehearsal passed 2026-07-12 (130 migrations on fresh DB, public pages 200,
  auth walls 401, health ok, fail-fast boot proven, worker role proven).
- **62 P0/P1 defects:** registry confirms the count
  (`docs/audits/defect-registry.md` line 13). Tenant isolation: exercised on
  every walkthrough sim run ("tenant isolation held").

## F2 — "The differentiator is unbuilt" → PARTIALLY STALE; needs reframing

- **FleetObservatory: BUILT**, contra the directive and contra
  `documented-but-not-built.md` — `src/services/fleet/observatory.ts` +
  `src/routes/dashboard/fleet.ts` (/fleet, in the command palette): all
  agents' status/last/next run/health + pending decisions across all the
  founder's products. The stale line in documented-but-not-built.md should
  be corrected (done in this commit).
- **FleetOracle, FleetSentinel, PortfolioLedger: CONFIRMED spec-only.**
  Zero implementation in src (grep-verified).
- **Cross-company intelligence: PARTIALLY built, differently than spec'd.**
  `decision_patterns` has consent-gated writes AND working readers —
  `services/intelligence/peer-signal.ts`, `services/network/benchmarks.ts`,
  and the network radar (B4) that feeds warnings into the Letter/briefings
  ("your churn is in the worst quartile of N peers"). What does NOT exist is
  the spec'd insight-generation reader surfaced as a portfolio card.
- **Reframe the finding:** the shipped differentiator today is not fleet
  scale — it is the institution loop (decisions with falsifiable premises,
  Red Team dissent with a track record, seeded Ghost simulation, the earned
  trust ladder, the Letter, and four governed departments). The positioning
  gap F2 identifies is real, but the honest v1 story is "an institution in a
  box for your company" (+ peer network effects), not "fleet control plane."
  This strengthens the directive's own Option A recommendation.

## F3 — "Residual security debt" → ONE CONFIRMED P1; one item already fixed

- **Transcript webhook auth (P1): CONFIRMED BROKEN — and the rot went
  deeper than the finding.** Two independent defects, both fixed:
  1. `transcripts.ts:14-21` compared the RAW header key against the stored
     `key_hash` (keys are written hashed) — and invited hash-as-credential
     misuse. Now routed through `validateApiKey`.
  2. Discovered while proving the fix: **`api_keys.expires_at` never existed.**
     Migration 006 created the table, 024's richer redefinition was a no-op
     (`IF NOT EXISTS`), and 085 back-filled four RBAC columns but missed
     `expires_at`. `validateApiKey` selects it → SQLITE_ERROR on every call →
     every consumer's catch returned null → **every legitimate API key 401'd
     across the entire surface** (voice-reply, transcripts, mobile, platform).
     One missing column, four dead endpoints, all fail-closed (no exposure).
     Fixed by migration 095; proven by an end-to-end test that authenticates
     with a real raw key and refuses the stored hash itself.
- **integrations.credentials_json plaintext: STALE — already fixed.** Both
  write paths encrypt (`routes/dashboard/integrations.ts:270`,
  `services/integration/fabric.ts` `connectIntegration`) via
  `encryptCredentialPayload`; readers decrypt with legacy-plaintext
  fallback. MCP connector tokens (Hands H1) are also encrypted at rest.
- **investors.access_token plaintext: CONFIRMED** —
  `routes/dashboard/investors.ts:397` stores a raw `nanoid(32)` capability
  token. Threat: DB read exposes live investor-room links. Fix: hash at
  rest (same discipline as api_keys). Fixed in this session's close-out.
- **Zod coverage: directive UNDERSTATES it.** 227 POST/PUT/PATCH handlers,
  10 `validateBody` usages. Context that changes the risk math: dashboard
  mutation routes sit behind Clerk auth + CSRF and coerce defensively; the
  genuinely external surface (webhooks, API-key routes, /api/v1, mobile/
  platform) is the priority slice and is being validated first. Full
  route-by-route Zod is tracked as a follow-up with the count as its ratchet.

## F4 — "Cross-repo persona entanglement" → NO CODE DEPENDENCY

Foundry contains **zero imports** from AcreOS persona files. All matches for
acreos/sovereign in src are comments: the protocol's own name ("Sovereign
Company Protocol") and provenance notes ("adapted from AcreOS"). Deleting
AcreOS's stub copies cannot break Foundry. Namespace ownership recorded in
`docs/architecture/AGENT-NAMESPACE.md` (this commit).

## Corrections applied with this memo

1. `documented-but-not-built.md`: FleetObservatory entry corrected to BUILT.
2. `docs/architecture/AGENT-NAMESPACE.md`: canonical roster ownership.
3. Security close-out (work order step 3) begins immediately after this memo.
