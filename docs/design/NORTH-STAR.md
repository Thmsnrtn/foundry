# Where Foundry Evolves Next — the north-star map

**Date:** 2026-07-14 · **Purpose:** the honest answer to "where does this
platform go?" — written after v1 reached capability-completeness.

## The honest inflection point

Foundry is, as of this session, a **complete v1 product**: an
institution-in-a-box that senses, decides with falsifiable premises, dissents
(Red Team), remembers (the kernel), acts within governed autonomy (trust
ladder + gateway + envelopes + reserved powers + consent), and reports through
one Letter — with a two-brain architecture (operator/customer), a clean-hands
liability posture, and three standing validation harnesses. 964 tests.

**The binding constraint is no longer capability. It is usage.** Every recent
evolution (the taste check, the convergence sim, first-run honesty) exists
because there is nothing left to *build* that a zero-customer product needs.
The three grand arcs below are real and the seeds exist — but **each is
unlocked by data and feedback, not by more code.** Building them now would be
"fleet-scale machinery for a zero-customer product" (finish-line self-check
#4). They are sequenced AFTER the first users, deliberately.

So the truest answer to "where next": **the next evolution is the first real
founder** (AcreOS via dogfood, then 3–5 design partners). That is the gate to
all three arcs. Until then, the code is ready and waiting on the deploy.

---

## Arc 1 — From tool → network → market (where the VALUE compounds)

Today each founder's Foundry is nearly standalone; the cross-company insight
reader (`services/fleet/insights.ts`) and peer radar
(`services/network/radar.ts`, `network_benchmarks`, `decision_patterns`) are
the seeds. As customers accumulate, **the network becomes the product**:

- The **premise ledger across thousands of founders** is a proprietary dataset
  no one else has: "founders who bet X at your stage saw Y." Verified
  playbooks, calibration-as-signal, underwriting-grade priors.
- **Attention memory** (`operator_attention`) becomes ranking priors — a new
  founder's Jarvis starts warm ("founders like you act on churn within hours,
  defer pricing ~2 weeks") instead of cold.
- The **economic graph**: which decisions, made when, at what stage, produced
  what outcome — the compounding moat.

**Gate:** real customer scale (≥ dozens of founders with resolved outcomes).
Consent-gated and anonymized per the existing privacy posture (immutable #5).
**Do not build before the data exists** — it would be empty machinery.

## Arc 2 — From founder copilot → company operating system (where the SCOPE grows)

Today Foundry runs the *solo founder's* decision loop. As a company grows past
one person, the institution-in-a-box grows with the institution. Seeds:
`routes/dashboard/team.ts`, `services/wisdom/cofounder.ts` (alignment),
`board-packet.ts` (investor hub).

- **The shared institutional brain**: cofounder alignment, the first hires'
  onboarding into the company's memory, board/investor relations run from the
  same ledger, the org's decisions and their premises as shared truth.
- Autonomy grows a **role dimension**: who may grant what, delegated authority,
  the founder as board-member-with-vetoes over a team's Foundry.

**Gate:** customers who grow past solo. Premature while the ICP is the solo
founder — nail that first.

## Arc 3 — From product → autonomy engine others build on (where the IDENTITY evolves)

The governed-autonomy core (trust ladder + gateway + independent verifier +
consent ledger + reserved powers + kernel boundary) is **domain-agnostic** —
the kernel-boundary check (`docs/design/KERNEL.md`) already proves it, and
AcreOS runs on a Foundry-like spine. The MCP Trust Plane (`src/mcp/`) already
exposes the company's judgment as tools.

- Foundry's engine becomes **infrastructure other verticals adopt**: "the safe
  way to give an AI hands in any business." The departments, the verifier, the
  reserved powers — packaged.
- This is the biggest identity shift: from a SaaS-founder tool to a
  horizontal autonomy substrate. The AcreOS↔Foundry kernel-sharing option is
  held open at zero cost precisely for this.

**Gate:** the pattern proven in ONE place first (Foundry live + AcreOS
dogfood). You platformize what works, not what's theoretical.

---

## The sequence (why order matters)

1. **Deploy** (blocked on the Fly token — the one true gate).
2. **Dogfood AcreOS** as customer #1 for 14 days — the launch story + the
   first real data.
3. **3–5 design partners** — the first network nodes; validate the wedge.
4. **Then Arc 1 unlocks** (network effects need nodes), and the data-gated
   AcreOS ports (outcome ledger, EV loop, world-graph) finally have data.
5. **Arc 2** as customers grow past solo; **Arc 3** once the pattern is proven.

## What's honestly buildable *before* users (and what isn't)

- **Buildable now, valuable:** the deploy + dogfood prep; more validation
  harness depth; UX/first-run polish; the AI taste check (needs a key). All
  refinement, not new scope.
- **NOT buildable now (the trap):** the economic graph, network priors,
  outcome ledger, EV loop, company-scope, platformization. Each is empty
  without usage. Their designs are captured (here + ACREOS-PORT-MAP.md,
  JARVIS.md) so they execute fast the moment the data exists.

**The discipline:** the platform has evolved as far as it usefully can in
isolation. The next evolution is not a commit — it is a customer. Everything
after that is unlocked, in order, by what real founders do with it.
