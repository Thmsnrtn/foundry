# The Foundry Autopilot — converged on AcreOS's mature autonomy kernel

AcreOS's founder-side autopilot matured into exactly what Foundry was meant to
be. This doc records the study, the honest comparison, and what Foundry now
implements. (Mechanism study: AcreOS `autopilot/domainAutonomy.ts`,
`autopilot/act.ts`, `autopilot/experienceLog.ts`, `decisionAutopilot.ts`,
`ceoAbsenceMode.ts`, the four founder doors.)

## What AcreOS's mature autopilot actually does

1. **A per-domain trust ladder** (observe → draft → execute-gated → autonomous),
   promoted by **10 clean cycles of REAL outcomes** — with a *calibration hold*
   (don't widen autonomy while over-confident) and a *quality hold* (earn
   autonomy by deciding WELL, not often). Demotion is an instant one-rung
   circuit-breaker with the reason stamped.
2. **Shadow measurement**: on every real founder decision, record what the
   system WOULD have done and whether it matched — trust accrues at zero risk.
3. **One act choke-point** with mandatory guards: policy gates, deterministic
   risk assessment (novel/irreversible/expensive → escalate to a human even in
   a trusted domain), an adversarial premortem veto, cost caps, idempotency.
4. **Outcomes vote with strict honesty**: founder verdict > real consequence >
   eval > mechanical success; *pending banks nothing*.
5. **Plain-language Controls**: postures, per-domain dials ("Watching only" /
   "Drafts — you approve" / "Acts — safety-checked"), a panic stop, step-away
   readiness, bounded/expiring delegation grants.
6. **The undo teaches**: founder corrections feed straight back into autonomy.

## Where Foundry stood before this convergence

Foundry had the *ingredients* — gates 0–4 per decision, agent recommendations,
outcome valences, a trust ledger that PROPOSED graduations, Red Team, Letter —
but **no autonomy state**: nothing above gate 0 was ever acted on, founder
agreement was never measured, and there was no cockpit. An advisor, not an
autopilot.

## What Foundry now implements (migration 090 + `services/autopilot/policy.ts`)

| AcreOS mechanism | Foundry implementation |
|---|---|
| Trust ladder | `autopilot_policies` per **decision category**: `shadow → suggest → act` |
| Shadow measurement | computed from data already recorded: `decisions.recommendation` vs `chosen_option` on founder-resolved decisions (`getShadowStats`) |
| Clean cycles + promotion | `processOutcomeFeedback`: positive `outcome_valence` → clean cycle; **10 → shadow→suggest auto-promotes ('earned')**, held if category positive-rate < 0.6 (**quality hold**) |
| Consent boundary | the step INTO `act` is **founder-only** (constitutional Trust Law) — the ladder earns *suggest*; the founder grants *act* |
| Act guardrails | gate ≤ 1 only · recommendation must exist · 12h grace window · company kill-switch (`scp_status`) · notified with **24h undo** |
| Circuit breaker | negative outcome on a `second_self` decision → `recordAnomaly`: one rung down, counter reset, reason stamped |
| Undo teaches | `undoAutopilotAction`: decision → pending AND category demoted (`undo_demotion`) |
| Panic stop | `panicStop`: all categories → shadow, records kept, one red button on Controls |
| Controls door | `/autopilot` (behind the Letter mount — route-count ratchet honored): plain labels, shadow record + clean-cycle evidence per category, Grant/Pause, panic stop |
| The Letter | Second Self actions appear in "What I handled" with the undo note |
| Outcome honesty | pending outcomes bank nothing; feedback is exactly-once (`autopilot_counted`) |

## Deliberate differences (Foundry's context, not omissions)

- **Category ladder, not domain packs**: Foundry is single-vertical (SaaS
  founders); its "domains" are decision categories. The kernel/pack seam
  becomes relevant only if Foundry ever platformizes.
- **Consent at the act boundary**: AcreOS auto-applies all four rungs; Foundry's
  constitution requires explicit founder consent to cross into `act`. Everything
  below is earned automatically, everything above is guarded identically.
- **Risk guard via gates**: AcreOS's per-move risk assessor maps to Foundry's
  existing gate system — gate ≥ 2 is definitionally "novel/expensive/
  irreversible" and never auto-acts; the Red Team premortem covers gate 3+.

## Deferred (specs live in FOUNDRY-ASCENT.md)

- **Step-away readiness + absence mode** (AcreOS `ceoAbsenceMode`): batch
  non-critical, break through only on critical, return briefing.
- **Calibration hold** alongside the quality hold once `agent_predictions`
  accumulates real (predicted, actual) pairs.
- **Story door**: the decision chamber is already glass-box per decision; a
  timeline view over `second_self` history is a natural addition.
