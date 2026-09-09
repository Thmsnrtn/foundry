# The quiet economic estate — baseline against the frontier (2026-09-09)

Owner direction *Foundry — The Quiet Economic Estate* (125 sections) asks first
for inspection: what does production already support, and what does operational
pressure actually prove is missing? This is that pass. It classifies the
direction rather than implementing it, so the tranche that follows can be the
smallest one that makes Foundry reason better about the next real Probe.

The buckets are the direction's own (§CXXII).

---

## Already embodied

These are live in the frontier today and need no new machinery.

| Direction | Where it already lives |
|---|---|
| Owner sovereignty; nothing external without an approved act (§III.3) | `proposed_acts` + ask-first `owner_boundaries`, resolved at the door by `experimentActFor` |
| Bounded cash exposure (§XLII, §III.6) | `owner_allowances` set from `cost_cents` at Allow; the door refuses the spend |
| Falsifiability sealed before the run (§LXXXVI) | `venture_experiments.what_we_expect` / `would_disprove` / `settles_when`, sealed at approval by trigger |
| Observation before story (§LXXXVII) | `business_outcome_events` are provider facts; `settleFromTheWorld` reads them; the verdict is derived, never asserted |
| Provider success is not business success (§LXXXII) | `effect_certainty`, `outcome_status`, reconciliation against the provider's own report; publication verified by fetching the public address |
| Customer obligations outlive probes and pauses (§LXXXI) | `experiment_fulfilments` carried by the aftermath loop; the Workshop pause stops offers only; refunds run while paused |
| Silence is not permission; one message, no chase (§XXVII) | The hand plans one offer per recipient, keyed by effect id; there is no follow-up path |
| Workshop-wide contact memory and suppression (§XXVIII) | `public_suppressions`, `public_contacts`, `contactFrequencyRefusal`, and the plan guard's `recipient_suppressed` |
| Public explainability gate (§XLV) | The publication gate: a verified public page stating price, recurrence, limits, contact, refund and opt-out, or no outbound |
| No spam optimisation, no identity rotation (§XLIX) | One durable sender bound to the Workshop's own zone; `sendingReadiness` refuses anything else |
| Reputation as a shared asset with a blast radius (§XLIV, §XCII) | Bounce and complaint land on the Workshop-wide list; frequency ceilings across experiments |
| Kill / pause / conclude / graduate are distinct (§LXXXIV) | `decision`, the Workshop pause, `ran_at` + `verdict`, `validity`, asset `standing`, `graduated_to_url` |
| A stopped probe can be successful learning (§LXXXV) | Proof 1's pre-Workshop design is declined as superseded with the contradiction recorded, not deleted |
| Lineage without silent rewriting (§XXII, §XXIII) | `rerun_of`, `public_experiments.supersedes_experiment_id`, and the successor's `what_we_do` naming what it supersedes |
| Experiment 2 costs no new infrastructure (§CI) | Apex Micro: one store, one program, one sender, one legal surface; publication is a KV write |
| True probe cost beyond cash (§L) | Recorded as doctrine in `ECONOMICS.md` in the Workshop tranche |
| Evidence freshness (§LVI) | `checkDeliverableQuality` refuses a brief older than its window; `market_observations.observed_at` |
| Small samples, honest language (§XIII) | `settleFromTheWorld` counts what the world did and says so; no confidence numbers are invented anywhere |

## Doctrinal clarification — text, not machinery

The institution behaves correctly already; what is missing is the written
statement that makes the behaviour deliberate rather than incidental.
§I, §II, §III, §V, §VI, §VII, §XLVI, §XLVII, §LX, §LXI, §LXIII, §LXIV, §LXV,
§LXVI, §LXVII, §LXVIII, §LXIX, §LXX, §LXXI, §LXXII, §LXXIII, §LXXIV, §LXXV,
§LXXVI, §LXXVII, §LXXVIII, §XCVII, §XCVIII, §XCIX, §CXVII, §CXVIII, §CXIX, §CXX.

These belong in `ECONOMICS.md` and `RIVER.md` at the doctrine level, not in the
constitutional ring, and not as tables.

## Missing judgment behaviour — the centre of this tranche

The frontier can *record* a prediction. It cannot record the **deliberation that
produced it**, and the codebase already says so. From `services/founder/why.ts`:

> "A page whose whole purpose is showing its work may not manufacture a thought
> process after the fact. The honest names are what the claim rests on, what
> else is genuinely recorded, and what is still unknown — and **a later
> deliberation trace can persist the real thing prospectively, at judgement
> time, where it would actually be evidence.**"

`otherRecordedPaths` is returned empty for every experiment today, because
nothing writes it. That is the operational pressure that earns new semantics
(§CVIII), and it is exactly what §CXXIII demands the institution carry:

- the decision-critical uncertainty, chosen over the alternatives (§X)
- competing interpretations preserved so a null result cannot collapse to
  "no value" (§XI)
- how the design could produce false learning (§XII)
- what it can and cannot prove (§DoD 5)
- the exchange mechanism, chosen against named alternatives, and why (§XV)
- the do-nothing baseline (§VII)
- true cost across the dimensions that are material (§L, §XLIII)
- distribution cleanliness (§XLVII)
- the capacity response if it succeeds unexpectedly (§XLI)
- the recommendation, in the owner's language (§CVI)

## Missing evidence semantics

1. **Exchange context on commercial evidence** (§XX, DoD 11). `business_outcome_events`
   records that money moved, not the exchange that produced it. "Paid before
   delivery" and "paid voluntarily after experiencing it" are different facts
   about willingness to pay, and today they are the same row.
2. **Negative observations are not interchangeable** (§XIV, DoD 7). The kinds
   ladder ends at `delivery_failed` and `complaint`. "Experienced it and said it
   was not useful" is much stronger product evidence than a bounce, and cannot
   be recorded.
3. **Continuation preference** (§XXXI, §XXX, DoD 18/22). A participant can be
   suppressed or not. There is no way to record what relationship they asked
   for, so consent cannot be scoped to what was actually requested.

## Missing operational capability

1. **Stop conditions beyond the settlement rule** (§LIII, DoD 15/29). `settles_when`
   stops a probe when the world proves or disproves the prediction. Nothing
   stops it when the decision is already clear for another reason — convergent
   negative evidence, complaints, or a reputation cost the cash ceiling does not
   see. Budgets are ceilings, not targets.
2. **A success circuit breaker** (§XLI, DoD 28). Unexpected demand has no bounded
   response; the offer stays up until the rule settles it.

## Missing owner surface

Only one thing, and it is small (§CVI, §CIX, DoD 64): the compressed
recommendation on the experiment page, and `otherRecordedPaths` / `uncertainty`
in Show your work reading the recorded deliberation instead of returning
nothing. No new screens.

## Not yet earned

Named in the direction, deliberately not built now. Each would be ontology
without operational pressure (§CVIII), and each has a cheaper current home.

| Concept | Why not yet | Where it lives meanwhile |
|---|---|---|
| `EconomicTerritory` (§LIX) | One territory, one probe. A table for a population of one is a guess | `venture_opportunities` under a mandate |
| Sufficiency Frontier as an object (§LXIV) | No engine earns yet; nothing to refuse to scale | Doctrine, and the judgment's own reasoning |
| Venture Species / Stewardship Floor (§CXV) | Needs several ventures to compare | Doctrine |
| Portfolio correlation model (§XCI, §LXX) | One asset. Correlation across one thing is not a measurement | Doctrine |
| National procurement sensorium (§XXXIV) | Source rights and comparability must be established per jurisdiction before ingestion; sensing breadth is a separate tranche from contact breadth (§XXXIII) | Judgment records it as an open question |
| Owner distribution / harvest modes (§LXVIII, §XCIX) | No surplus exists | Doctrine |
| Experiment-portfolio allocation (§XC) | One experiment | Doctrine |

---

## What this tranche therefore builds

The deliberation, recorded prospectively at judgement time; the three evidence
distinctions it needs to stay honest afterwards; stop conditions and a capacity
cap the hand obeys; the continuation a participant can ask for; and the
compressed recommendation with the deep record behind it. Then Proof 1 is
reconsidered through that machinery rather than argued in prose.

Everything else in the direction is doctrine or is not yet earned.
