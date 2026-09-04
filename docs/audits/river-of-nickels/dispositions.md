# The river-of-nickels audit — every finding, and what was decided

Fifteen lenses, 45 proposals, each checked twice: once against the repository
(does this already exist), once against the constitution (what would this need
at runtime, and does it survive). 108 agents.

This document is the disposition of all 45. Nothing is left without a decision.

## The frame this was decided against

The objective is DURABLE, RISK-ADJUSTED, **OWNER-ADJUSTED** digital cash flow.
Owner-adjusted is the constraint that does the work here: cash that costs
attention is worth less than cash that does not, and the mature institution is
one whose non-delegable share is spent ONCE per asset, at its birth, and whose
attention curve decays to nothing.

That distinction — one-time attention versus recurring attention — is what
separates an institution that runs a portfolio from a job its owner built for
himself. Two assets can cost the same hours in year one and be opposites: a
marketplace listing costs twenty hours once and distributes forever; a channel
that needs a weekly post costs two hours a week, which is trivial at one asset
and eighteen hours a week at nine.

So every proposal below was judged on three things, in this order:

1. Does it move the institution toward a first real nickel?
2. What does it cost him **every week, forever**, once built?
3. Is it a severed connection (machinery that exists and does not reach) or a
   new subsystem? Severed connections are cheap and were preferred.

## The one thing the audit established

The institution is a sensing organ with no hands and no return leg. Eleven of
the fifteen lenses found a version of the same fact from different angles:

- `settleClaim`, `recordResult`, `reviseClaim`, `cheapestWayForward` — zero
  production callers. Nothing it predicts is ever resolved.
- `promote()` wrote its unknowns as a JSON string, so `contested_evidence_tick`
  matched zero real candidates, forever. Real discovery could never advance.
- Seven distribution capabilities declared, zero providers. `refund` and
  `change_subscription` have Stripe; `accept_payment` does not. **The
  institution could give money back and could not take any.**
- `createWorkshop` has no production caller and `fly_machines.run()` throws by
  design. It cannot build anything — a plugin no more than a SaaS.
- `allowanceFor()` metered real-dollar authority against Anthropic token spend.
- No table anywhere recorded what an asset costs to run, so `burden.ts` decided
  whether an asset "earns its keep" by comparing its revenue to Foundry's own
  model bill.

A 66:1 ratio of governance code to code that touches the outside world. The
correct response to that is not more governance.

---

# BUILT (this session)

## 31 + 19 — the severed wire
`promote()` now raises each unknown as a real `market_unknowns` row against the
candidate. Whether a question BLOCKS is derived, never asserted: a question only
behaviour can settle is blocking by definition (constitutional
`reality_only_questions`), and its `only_settled_by` becomes the cheapest test —
the field an experiment cannot be proposed without. The matcher was extracted so
the asking half and the answering half cannot drift.

Test asserts the exact `contested_evidence_tick` selection now matches a real
candidate. Before this, it matched zero and logged itself busy doing so.

## 45 — provenance that is not severed at the candidate
`products.from_opportunity_id`, write-once, with a reality-boundary trigger so a
rehearsal candidate can never father a real company. `whyWeOwnThis(productId)`
walks asset → candidate → seed → interpretation → the verbatim sentence somebody
wrote. Cheap now, impossible to reconstruct later.

## 25 — a meter that measures the right money
`asset_money_spent`, append-only, reversals as rows. `allowanceFor()` is now one
meter with two sources — what the institution costs to think, and real money
leaving. A financial-rung act must declare what it will cost and is refused if
it exceeds what remains, instead of passing on "is anything left?".

*Known limit, stated rather than hidden:* the amount is a declaration, not a
quote. Nothing can check it until a provider exists to quote against.

## 30 — a hand in a browser is not a public act
Consequence belongs to the ACT, not only to the capability. `act_in_a_browser`
sat at `public` and was waved through — and pressing a button is how one accepts
terms or creates an account in the institution's name. `browser_act_kinds` is
constitutional; the higher of the two rungs governs; an act that will not say
what it is gets refused rather than read as the cheapest thing it could be.

## 34 + 41 — a company of his outranks the institution's housekeeping
The first screen ranked what needs him by KIND — a hardcoded if-chain over seven
types, with a question about one of his actual businesses last — and read
`proposed_acts` nowhere at all. They were rendered in exactly one place, inside
a company's own page. On the day an asset asked him for $400, the home screen
would have shown him a schema-snapshot permission instead.

`whatIsBeingAskedOf(founderId)` reads across the portfolio and ranks by
CONSEQUENCE: the rung first (what an act commits him to matters more than what
it costs), then the money, then what expires soonest. Real companies only — a
rehearsal may not ask him for anything. Rendered through the existing
`decisionCard` with the two facts the ladder already stored and the first screen
never showed: the rung, and what it would take to put it back.

*Found while building it:* the database already refuses to let Foundry
manufacture a question he never asked to be consulted about
(`proposed_act:nothing_asked_for_this`). Part of finding 37's discipline is
enforced at the source already.

---

# MERGED (several lenses, one capability)

Where lenses converged, they are built once. The convergence is the strongest
signal in the audit and the merge is the point.

- **06 + 13 + 24 → one obligations register.** Three lenses independently
  proposed the same `asset_obligations` table. It is the cost side of an asset,
  it feeds concentration, and it is what makes "earns its keep" mean anything.
- **09 + 17 → one per-asset cash ledger.** Cumulative, so payback, lifetime
  profit and a sale price exist at all. `asset_money_spent` is its first half.
- **01 + 04 → one acquisition origination path.** Both propose reading listings
  and filing a seller's numbers as claims a stance can carry.
- **34 + 41 → one attention ranker.** Both find that `whatNeedsHim` never reads
  `proposed_acts`, so on the day an asset asks for $400 the home screen shows a
  schema-snapshot permission instead.
- **05 + 35 → one summons.** Vital signs are worthless if nothing can reach him.
- **40 + 44 → one return leg.** Grading a decision and resolving a sealed
  reading are the same mechanism pointed at two tables.
- **08 + 07 → the economic thesis and its settlement** are one loop.

---

# GATED (built when a named thing becomes true, not on a date)

These are real and premature. Each carries the condition that makes it due.
A roadmap whose items are gated on an event that has never occurred is a wish
list; these are gated on events that are the point.

| # | Finding | Gate |
|---|---|---|
| 26 | Per-asset circuit breaker | **Before any asset takes its first payment.** Non-negotiable: unbounded real-dollar acts under a ceiling that never depletes is what "away for a month" means without it. |
| 28 | Seller-of-record decided before the first charge | **Before `accept_payment` gets a provider.** Cheap before the first sale, expensive forever after. |
| 21 | A cash register | **When one asset has something to sell.** |
| 12 | One place a stranger can land | **When one offer exists to put there.** |
| 22 | The isolated computer | **When a build is actually attempted.** Venture code must never execute in the trusted core, so this is the gate on building anything. |
| 27 | Counterparty door for notices | First live asset with a platform dependency. |
| 29 | Register of legal instruments | First live asset. |
| 02, 03 | Diligence senses, governed purchase | First acquisition seriously considered. |
| 15, 18, 42 | Kill covenants, winding, the KILL decision | First asset worth keeping — a kill decision with nothing to kill is theatre. |
| 16 | What would change hands | First asset's first day. Retrofitting is what makes an asset unsellable. |
| 23 | Liveness witness outside the failure domain | First asset whose downtime costs money. |
| 36, 39 | Away-summary about the river; attention changing posture | Three or more assets. |
| 08, 09 | Economic settlement, cash ledger | First revenue. |

---

# NEXT (queued, in this order, for the autonomy objective)

1. **40 + 44 — the return leg.** Nothing grades a decision against the
   prediction it was sold on. Until it does, every card he sees is the first
   card he has ever seen, and rubber-stamping is the mathematically correct
   response.
2. **37 — the enforced attention budget.** "Owner-adjusted" is currently a
   readout with no actuator. This is the actuator, and it is the single change
   most aligned with the stated objective.
3. **43 — the discovery pass remembers itself.** It computes the most valuable
   institutional fact it will ever produce — which way of knowing could have
   settled a hypothesis and cannot be reached — and writes it to a log.
4. **05 + 35 — vital signs and the summons.** Nine situations and none of them
   is "it is broken"; a product down three weeks reads as `steady` while Stripe
   bills. And nothing can reach him, so the only way to learn whether the
   institution needs him is to open it every morning, forever — the exact
   opposite of the product getting smaller as it gets stronger.
5. **33 — retrieval with a moving frontier.** Four of five fixed search phrases
   are literally the triage regexes, so the filter tests for what the query
   guaranteed. No paging, no date window: it re-reads the same ≤50 comments
   daily.
6. **32 — one stance that can observe money.** Today the strongest available
   conclusion about willingness to pay is "an npm package exists."

---

# DECLINED, AND WHY

- **07 (as proposed) — a full typed economic model on every seed.** The
  arithmetic is right and the placement is wrong: a steady-state kill threshold
  on a seed prices a business that does not exist from numbers nobody observed,
  which is model reasoning manufacturing an external fact. **Reframed and kept:**
  the economic thesis attaches at CANDIDATE, carries its assumptions as sealed
  predictions, and is settled against observed revenue — never used to kill a
  seed before anything has been read.
- **10, 11 (partially) — the shelf and the beachhead.** Reading marketplace
  listings is correct and gated above. Choosing Shopify as the beachhead is a
  decision that requires a real mandate and a legal identity; it is his, and
  naming it here would be the institution choosing its own strategy from a lens
  report.
- **20 — the build lane.** Correct that no BUILD stage exists. Declined as
  written because it depends on 22 (the isolated computer) and on the PR-only
  posture, and building the table before the substrate produces another declared
  capability with no provider — which is the exact debt class this audit found
  seven of.

---

# WHAT THE AUDIT SAID ABOUT ITSELF

The completeness critic's finding, verified and recorded because it is the most
important sentence in the whole exercise:

> The repository contains thirty prior audit documents and four launched
> products with zero customers. Each audit produced real findings; each was
> implemented; cumulative revenue is nothing. If this roadmap is adopted as
> written, in ninety days there will be roughly twenty new tables, all more
> correct than what exists, and the same zero dollars.

Its falsifier, adopted as the only test that matters:

> **By 2026-10-04, has one human being who is not the owner paid one dollar for
> anything? If the answer requires a subsystem, the answer is no.**

Two corrections to that critique, both verified:

1. It claimed the constitution made selling un-seeable, quoting the halt on
   "design-partner acquisition, customer pricing… marketing." The sentence ends
   "— **unless** the shared institutional kernel or **a real portfolio business**
   genuinely requires the capability." Pricing and marketing are halted for
   Commercial Foundry. A real portfolio business needing them is carved out.
   The door it called locked is open.
2. The brief given to all fifteen lenses said "zero real assets exist." That was
   false — AcreOS, Koldly, Apex Micro and SCP exist and are deployed. Every lens
   was steered by it, and four of them (operator, unit economics, reliability,
   acquisition) specified a better cupboard on the assumption the cupboard was
   bare. Their findings survive that error because what they found is
   substrate-level and asset-class-agnostic; their proposed METRICS do not, and
   were generalised rather than adopted.
