# The Protective Wrapper — autonomy = min(setting, platform cap, earned trust)

**Date:** 2026-07-14 · **Source:** AcreOS `docs/company/three-level-boundary.md`
+ `pax-jarvis.md` (read directly, 2026-07-14). **Ties to:** LIABILITY-AUDIT.md
(this is the code realization of the clean-hands posture), the Jarvis slices,
and the trust ladder.

## The insight AcreOS crystallized

AcreOS split its Jarvis into **two brains with an enforced data boundary**:
- **Solene** — the *platform* chief-of-staff (runs the SaaS company itself:
  MRR, churn, billing, deploys, support). Sees tenants **only as aggregates and
  machine outcomes** — never customer PII, never their business judgment.
- **Pax** — each *customer's* in-product copilot (runs their business). Full
  per-org world-model, bounded by the platform.

Foundry already has both, unnamed:
- **Foundry's operator pack** (the "Your machine" letter for Thomas) = Solene.
  It was already built aggregate-only (spend anomalies, verifier drops, failed
  counts) — but by *convention*, not structural guarantee.
- **Foundry's per-founder autopilot + departments** = Pax.

The three governance primitives AcreOS wraps around Pax are exactly what
Foundry's liability audit said it needs next. This wave builds them.

## Primitive 1 — Autonomy is a lattice, not a ladder

> "A customer's autonomy setting is a **ceiling request, not a grant**.
> Autonomy = min(customer setting, platform cap, earned trust)." — pax-jarvis.md

Foundry today resolves autonomy from **earned trust only** (the shadow→
suggest→act ladder in `autopilot/policy.ts`). Missing: the **platform cap** —
an operator-controlled ceiling per capability that no customer setting can
exceed. This is the single most important governance decision in the Pax doc,
and it's the enforcement arm of the liability posture:
- **Money capabilities cap at (at most) act-and-confirm, permanently** — and in
  Foundry today, money is disabled entirely (clean-hands default). The cap
  makes that structural, not incidental.
- **Outreach caps at Suggest** until compliance (suppression, sender-of-record)
  is configured — no customer setting can raise it.
- A brand-new capability caps low regardless of what a founder configures.

**Build:** `effectiveMode(productId, category) = min(policy.mode, platformCap(category))`.
Departments call `effectiveMode`, never `policy.mode`, so the cap is enforced
in the one place every act flows through. The cap table is operator-owned.

## Primitive 2 — The consent ledger (the founder's shield)

> "Raising any capability above Suggest requires an explicit in-product
> acknowledgment … and the acceptance is RECORDED: who, what, which capability,
> when, disclosure version. The consent ledger is the founder's shield." — pax-jarvis.md

The liability audit flagged Foundry's enforceability gap (no recorded
acceptance of terms/disclosures). This is the fix, scoped to the highest-risk
moment: granting autonomy. When a founder raises a capability to act, record
`(founder_id, product_id, capability, from_mode, to_mode, disclosure_version,
accepted_at)`. The disclosure text says, verbatim from the audit: *the AI acts
on your instructions; you remain responsible for your business's actions; this
is not investment, legal, or tax advice.* No grant to `act` without a recorded
acceptance — structurally.

## Primitive 3 — Per-action attribution

> "Every autonomous/confirmed action is labeled: 'Pax did X under your
> [capability] setting Y at time Z' — never ambient, never deniable-by-us." — pax-jarvis.md

Foundry already stamps `approved_by = 'autopilot:<category>'` on autonomous
executions. Extend it: each such execution also records the **effective mode**
it acted under and the **consent record** that licensed it. This is the
disclosed-agent paper trail — the thing that makes "the user authorized this,
we're just software" *provable*, and the precursor to full ProofReceipts.

## Primitive 4 — The data boundary, enforced (not conventional)

> "Solene's view of tenants is landlord-shaped … aggregates and machine
> outcomes only. Boundary changes are Class A." — three-level-boundary.md

Foundry's operator pack must be *structurally* unable to surface a customer's
PII to the operator — today it's just written carefully. **Build:** the
operator pack reads through an aggregate-only helper that returns counts/rates/
verdicts and is incapable of returning row-level customer content; a test
asserts no PII-bearing column is ever selected into an operator line. Document
that widening the boundary is a Class-A (founder) decision.

## Why this is the right next wave (finish-line discipline)

- It is the **code realization of the liability work Thomas just approved** —
  turning the clean-hands posture from prose into enforced invariants.
- It is **safety-before-growth**: exactly what a pre-revenue product should
  build before external users touch autonomy (self-check #4 — this is not
  fleet-scale machinery; it's guardrails).
- Every piece **extends an existing Foundry system** on the same governance
  (the ladder, the gateway, the audit log), never a parallel stack.
- It makes **dogfooding honest**: the operator/customer boundary is the same
  one that keeps Thomas's own product-in-Foundry "just another tenant."

## Build order (gated checkpoints)
1. Platform cap + `effectiveMode`; departments route through it. (test: money/
   outreach caps hold regardless of setting)
2. Consent ledger + disclosure gate on promotion-to-act. (test: no act without
   recorded consent; disclosure version captured)
3. Per-action attribution on autonomous executions. (test: mode + consent ref
   stamped)
4. Aggregate-only operator boundary + PII-leak guard test.

## Deferred (still on their triggers, from ACREOS-PORT-MAP.md)
Full per-org Pax world-model, ProofReceipt hash-chains, learned gates, the
Bridge deck, embedding memory — unchanged. This wave is the wrapper that makes
all of them safe to grant when they arrive.
