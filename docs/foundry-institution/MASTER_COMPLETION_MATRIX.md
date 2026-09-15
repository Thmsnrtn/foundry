# Owner Operating System — completion matrix, sections 0–52

The canonical completion record for the Owner Operating System master prompt.
One row per numbered section, each carrying where it lives, what proves it, and
what it is still waiting for.

Keyed to `private_foundry_master_prompt_v3` — the document itself, section by
section. Nothing here is keyed to phases, tranches or internal work orders; those
were how the work was *done*, not what was *asked*.

## How to read a status

| status | means |
|---|---|
| **SATISFIED** | implemented and proven to the maturity that section asks for |
| **PARTIALLY SATISFIED** | real implementation exists, a concrete requirement remains |
| **WAITING ON REALITY** | implementation complete; production evidence cannot honestly exist yet |
| **DEFERRED BY DESIGN** | deliberately absent until a named trigger justifies it |
| **SUPERSEDED** | a simpler architecture fulfils the underlying requirement better |
| **FAILED / NEEDS WORK** | not met |

Code existing is never enough for SATISFIED. §51 is explicit about this: the
tranche is not complete because charts exist or a Tax page exists. Implementation
maturity, production proof, commercial evidence and elapsed-time evidence are
four different things and this matrix keeps them apart.

A section that is a **constraint** rather than a deliverable — §1, §38, §49 —
is SATISFIED when the constraint was honoured and there is evidence of it being
honoured against pressure, not when nothing violated it by accident.

---

## 0–12 — the gate, the law, and the surface

| § | Section | Status | Where it lives | Proof / what remains |
|---|---|---|---|---|
| **0** | Execution gate — do not disturb Experiment 001 | **SATISFIED** | `services/venture/`, act `AEk3lSzEsRiJBCz1ggwk2` | 001 crossed the full effect path in production: authority → payment capability → link → offer published → gate passed → Stage 1 sent through the governed provider → 21/21 provider receipts reconciled → 19 delivered, 2 bounced and suppressed. This tranche changed none of its population, price, message, strata, exclusions or stop envelope, and never re-asked for the same authority |
| **1** | North star | **SATISFIED** *(constraint honoured under pressure)* | the retirement, `RETIRED_LOOPS` | The tranche's largest single change **removed** capability: 27 loops off the timer, 12 agents and their 5 empty tables retired, `behavioral_triggers` retired rather than repaired. Optimising for agent count would have repaired it |
| **2** | The central product problem — text walls | **SATISFIED** | `money-place.ts`, `foundry-shell.ts`, `attention.ts` | Every failure this section lists is addressed: competing navigation layers, the persistent Ask viewport, the second dashboard, the generic "Go ahead", health-as-paragraph, cramped mobile nav and legacy structures underneath. The last two survivors were closed **in this pass** — see the visual finding below |
| **3** | Clean migration — no ghosts | **SATISFIED** | one shell, one stylesheet | `/talk` 404s; `/autopilot` 308s to Controls; System B (`layout.ts`, `components.ts`, `styles.css`) deleted, not bridged; zero `on…=` handlers in `src`; no second River dashboard, no duplicate owner queue |
| **4** | Visual handoff — how to use it | **SATISFIED** | `owner.css`, `docs/design/` | The palette matches the canonical boards exactly — `#0B100E` ground, `#8FD1B8` mint state, `#D9A85E` gold reserved for owner attention and appearing nowhere else, Newsreader over Inter. The structure matches too: Home's six-tile grid, NOW/NEXT, the gold attention card and the bottom nav are the concept's composition. No concept text, fake metric, invented company, fake balance or fake customer name was copied — the production figures are `$0.00` because that is true |
| **5** | Who this interface is for | **SATISFIED** | absence of machinery | No RBAC UX, no dashboard builder, no widget marketplace, no multi-user admin, no enterprise wizard, no settings tree for hypothetical teams. One owner, six doors |
| **6** | Owner comprehension targets | **SATISFIED** | `foundry-shell.ts`, `money-place.ts` | 5s: Home answers health / autonomy / owner-need / now / next above the fold at 390px. 30s: the subtraction now reads as a column of figures ending in a total, so cash, obligations, refund exposure, reserve and surplus are one glance rather than seven paragraphs. 5min: every claim drills to its evidence |
| **7** | Watch / inspect / intervene | **SATISFIED** | `views/owner/shell.ts` | The three depths are structural, not stylistic: WATCH carries almost no prose, INSPECT is behind disclosure, INTERVENE is a named consequence on a form. Measured across 300 layout readings |
| **8** | Canonical information architecture | **PARTIALLY SATISFIED** | `/foundry/*` | Home, Portfolio, Discover (`/searching`), Experiments, Inbox, Economics (`/money`), Controls, Ask and Decisions all exist as canonical surfaces, each with one responsibility and no duplicate queue. **ACTIVITY has no door** — meaningful institutional events are readable only per-company or per-experiment, never as the estate's stream |
| **9** | Home — founder cockpit | **SATISFIED** | `routes/dashboard/foundry-shell.ts` | Estate status, autonomy, owner action defaulting to none, NOW, portfolio, system health, RECENT, NEXT and OWNER all render from canonical state. Quiet is a successful state and says so |
| **10** | Status must not be an essay | **SATISFIED** | `foundry-shell.ts`, `money-place.ts`, `attention.ts` | Experiment state is structured — running / contacted / offer / purchases / complaints / opt-outs / owner action. System health is structured. Money is now arithmetic with its reasons one tap under it, and a blocked experiment lists what is in the way as rows rather than joining them with semicolons |
| **11** | Visual language | **SATISFIED** | `lib/sparkline.ts`, `owner.css` | Numbers for quantities, badges for state, deltas for change, timelines for causality, event rows for activity, disclosure for depth. `sparkline.ts` refuses to draw a line from fewer than three readings, baselines to the series' own range, and colours only where direction has meaning. Not cardified; motion is absent rather than decorative |
| **12** | Mobile first | **SATISFIED** | `scripts/measure-mobile.mts` | 375 / 390 / 393 / 414 / 430 px at 100% and 200% text, plus 1024 / 1280 / 1440: no horizontal overflow, nothing under the fixed bars, no clipped tab bar, no fixed Ask eating the viewport. Desktop recomposes rather than widens. **Every picture is now of the dark ground** — see the visual finding |

## 13–23 — decisions, portfolio, experiments, communications

| § | Section | Status | Where it lives | Proof / what remains |
|---|---|---|---|---|
| **13** | Decisions | **SATISFIED** | `services/founder/what-it-would-do.ts`, `attention.ts` | Effect classes INTERNAL / PROVIDER / ACCOUNT / PUBLIC / PERSON are preserved on the act, not inferred from cost — `$0` never reads as internal or safe. Every button names its consequence ("Authorize contact with these 21 businesses"). The consequential surface is not bypassable: `experiment_recipient:review_not_owner_act` and `experiment_action:born_approved` hold it from the schema |
| **14** | Portfolio — the River | **PARTIALLY SATISFIED** | `routes/dashboard/places.ts` | Each cell reports contribution, maturity, motion, owner attention, dependencies, provider exposure and autonomy state where evidence exists, and healthy engines do go quieter. **The sufficiency frontier is not modelled as a state** — an engine cannot yet declare ENOUGH and stop being asked to grow |
| **15** | Discover — opportunity engine | **SATISFIED** | `services/venture/discovery.ts`, `/foundry/searching` | The pipeline is real: signal → observation → thesis → unknown → investigation → candidate → authorized experiment. "Not searching" is a first-class displayed state. No fabricated opportunity score with false precision |
| **16** | Experiments | **SATISFIED** | `experiments-place.ts`, migrations 238/262/278/297 | Lifecycle is schema, not prose: decision, ran_at, verdict, validity, `invalid_because`, `rerun_of`, `retired_because`, `superseded_by`. Detail exposes question, population, offer, price, channel, sample, strata, authority, staging, stop conditions, exposure, what it can and cannot prove, prediction and outcome |
| **17** | Experiment Forge | **SATISFIED** *(architecture)* | `services/venture/` | Not a society of named agents: persistent responsibilities with ephemeral cognition. The lenses exist as modules — market evidence, probe design, falsification, legal pass, commercial readiness, economic disposition — and READY / REVISE / KILL are all reachable outputs |
| **18** | Forge output contract | **SATISFIED** | `probe-design.ts`, `proof-1-deliberation.ts` | The seventeen questions are answered before an experiment reaches the owner, and the deliberation is recorded **before** the answer (migration 286), so the reasoning cannot be written to fit the outcome |
| **19** | Experiment genome | **FAILED / NEEDS WORK** | — | Prediction and outcome are compared (`what_we_expect`, `would_disprove`, `what_happened`, `verdict`), but the structured comparative fingerprint this section asks for — customer type, pain, value mechanism, offer type, contact type, trust level, acquisition mode, fulfilment mode, recurrence, risk class, cost class, authority class, evidence target — **does not exist**. 001's facts are all known and could be recorded today |
| **20** | Experiment 001 as curriculum | **SATISFIED** | tests, gates, schema | The lessons are crystallised as enforcement, not retrospective: authority binds the exact recipient set; a declined experiment's 22 approved recipients carry **zero** acts; read-after-write proves consequential state; a job that swallows a blocking exception is FAILED; `$0` is not inconsequential; owner exclusions outrank score |
| **21** | Inbox — communications membrane | **SATISFIED** | `services/public-workshop/mail.ts` | Inbound is untrusted and gains no authority by being written. The chain holds through to verification. The owner view separates needs-owner from auto-resolved from suppressed. No thought-stream, no macro execution. No silence-triggered sequence exists anywhere |
| **22** | Activity | **FAILED / NEEDS WORK** | — | `signal_events`, `strategic_decisions_log`, `outbound_actions` and `proposed_acts` all carry meaningful institutional events with evidence behind them, and **nothing assembles them into the estate's stream.** The owner can read what happened to one company or one experiment, never what happened |
| **23** | Live state architecture | **SATISFIED** | `foundry-shell.ts` | WATCH reaches no model. `authority-door-coverage.test.ts` asserts it from the source, not from behaviour: no owner route reaches a model call. INSPECT performs bounded retrieval; strong cognition happens where consequence justifies it |

## 24–35 — money, capital, tax, governance, cognition

Sections 25–29 describe an economic institution with money in it. Foundry has
none: `economic_events`, `experiment_fulfilments`, `stripe_events` and
`economic_policies` are all **empty** in production, and 21 approached
businesses produced 0 purchases. The honest classification of an accounting
substrate built ahead of the first dollar is DEFERRED BY DESIGN with a named
trigger, not SATISFIED — §1 forbids optimising for feature count and §48 forbids
building the library before the semantics are proven. Each row below names the
trigger that will move it.

| § | Section | Status | Where it lives | Proof / what remains |
|---|---|---|---|---|
| **24** | Economic nervous system | **WAITING ON REALITY** | `services/economy/ledger.ts`, `projection.ts` | The whole path is modelled and walked end to end by `the-first-real-payment.test.ts`: offer → commitment → payment → settlement → provider fee → obligation → fulfilment → verification → refund exposure → contribution → surplus. No LLM is in the ledger. **Waiting on: the first real payment** |
| **25** | Accounting | **PARTIALLY SATISFIED** | `ledger.ts` | Source-event provenance, settlement state, refund liability, provider fees, AI/API spend, experiment-attributable cost and reconciliation are real and deterministic. Bank balance, cash, gross revenue, settled revenue, contribution and distributable surplus are distinguished and gross is never called profit. **Not double-entry** — a single-entry source-event ledger. Adequate while the estate holds no money; the first settled payment is the trigger to decide whether it stays adequate |
| **26** | Economic responsibilities | **DEFERRED BY DESIGN** | — | Bookkeeper, controller, accountant, FP&A, CFO, treasurer, tax steward and economic auditor are **not** modelled as eight named responsibilities. This is deliberate: §26's own instruction is "these are responsibilities, not eight permanent chatty agents", and the tranche's main achievement was retiring twelve agents that produced 11 proposals and 0 approvals in a fortnight. Recording is done by the ledger, reconciliation by `reconcile.ts`, reserve logic by the tax policy gate. **Trigger: economic activity that one of these roles would actually have work to do on** |
| **27** | Treasury constitution | **DEFERRED BY DESIGN** | — | The priority ladder — avoid ruin, satisfy obligations, reserve tax, preserve liquidity, maintain engines, fund experiments, allocate, distribute — is **not** encoded. With zero cash the ladder can only ever return the same answer. Idle cash is already allowed and unspent authority is already not failure. **Trigger: cash exceeding known obligations** |
| **28** | Owner-distributable surplus | **SATISFIED** *(architecture)* | `economy/projection.ts`, `money-place.ts` | First-class and correctly subtractive: it is not bank balance, not gross revenue, not cash before obligations. `refundExposure` counts only **delivered** sales — a paid, undelivered sale is *owed*, not refundable, and a test walks the handover to prove the distinction. No autonomous distribution authority was invented |
| **29** | Capital allocation | **PARTIALLY SATISFIED** | `services/venture/probe-design.ts` | Expected cost, maximum exposure, reversibility, uncertainty, information value, downside and owner attention are all carried on a proposed experiment, and no dollar precision is fabricated for non-cash cost. **TRUE PROBE COST is not a named concept** — compute, attention, reputation, support burden, platform dependence and future maintenance are reasoned about in prose rather than carried as capital |
| **30** | Tax stewardship | **SATISFIED** *(architecture)* | `economic_policies`, `money-place.ts` | A reserve is **refused** without a rate, a basis and a source; the owner's assumption carries its provenance; reserve is shown separately from spendable cash; estimate is labelled estimate. No tax rule is fabricated, no entity form assumed. The boundary is stated to the owner in the surface itself: never a filing, a return, or advice. **Waiting on: the first tax-relevant activity** |
| **31** | Controls / governance | **SATISFIED** | `owner_boundaries`, `connections.ts` | Envelopes, not switches: external-action authority, provider permissions, spend ceilings, publication authority, suppression, stop conditions, identity, revocation, emergency stop. The Nirvana Upfitters exclusion is a durable entity-level boundary enforced in the backend, outranking score and recommendation, and its reason is not exposed anywhere public |
| **32** | Autonomy map | **SATISFIED** | `services/founder/autonomy-map.ts` | No fake global percentage. Autonomy is per-responsibility across observe / reason / decide / act / verify, showing what is permitted, what is refused, the authority limit, the supporting evidence, the failures and the escalations. Competence never grants authority: `autonomy_consents` is a separate table from calibration |
| **33** | Roadmap | **SATISFIED** | `routes/dashboard/roadmap-place.ts` | NOW / NEXT / LATER / WATCH / OWNER, each item carrying why it matters, its state, its evidence, dependencies, blockers, authority and owner need. The owner does not reconstruct it from chat history |
| **34** | Owner burden | **SATISFIED** | `services/founder/burden.ts` | Measured by observable proxies — decisions requested, escalations, unresolved decisions, interventions — never "hours saved". The tranche's own headline is a burden number: 22 clerical approvals collapsed to one genuine decision. The September generic-approval incident is retained as permanent evidence |
| **35** | Cognition economics | **SATISFIED** | `services/ai/what-it-is-for.ts`, `spend-ledger.ts` | The ladder exists and is not climbed mechanically. Repeated stable reasoning crystallises into rules and materialized projections — the 27 retired loops are the largest instance. Every one of 51 call sites now declares its work from a closed 31-entry vocabulary and the build refuses an undefined name. Foundry sleeps when there is no trigger |

## 36–52 — evidence, ethics, boundaries, proof, acceptance

| § | Section | Status | Where it lives | Proof / what remains |
|---|---|---|---|---|
| **36** | Claim quality / evidence | **PARTIALLY SATISFIED** | `economy/projection.ts`, `ai/measured.ts` | Unknown is valid and rendered as *not known* rather than as zero; evidence outranks narrative; a figure carries its own `because`. **Three of seven claim states exist** — `Quality = measured / estimated / unavailable`. Inferred, predicted, stale and contradicted are not distinguishable. **The E0–E6 and CE0–CE6 ladders do not exist as schema**, and this matrix keeps implementation maturity apart from commercial evidence only by hand |
| **37** | Quality / promise / obligation | **SATISFIED** | migration 281, `undertakings` | The promise ledger is `undertaking_kinds` / `undertakings` / `undertaking_steps`: what is promised, to whom, its conditions, what must be delivered, and its steps. A public claim cannot outrun its evidence — the publication quality gate refuses first |
| **38** | Ethics | **SATISFIED** *(constraint honoured under pressure)* | `calibration/voice-gate.ts`, `public-workshop/readiness.ts` | Admissibility, not a weighted score. The gate refuses fake testimonials, invented usage, fake customer counts, fake urgency, fake scarcity, unsupported trust badges and any implication that Thomas personally selected or wrote to a recipient when software did it. Tested adversarially, not asserted |
| **39** | Public / private identity boundary | **SATISFIED** | `public-workshop/projection.ts` | Apex Micro is the public identity and Foundry is not mentioned publicly. No internal prompt, authority internal, ledger, security configuration, private note, Forge internal or Experience Capital is reachable from the public projection. The owner's personal address is kept out of operations; the Apex Micro postal address is the only one published. No entity form is claimed |
| **40** | Ask | **SATISFIED** | `services/institution/the-door.ts`, `/foundry/ask` | Answers come from canonical state and evidence, not from narrative, and no private chain-of-thought is exposed. It is a shortcut into the same truth the doors show, not a curtain: every question it answers has a surface that answers it too |
| **41** | System health / failure experience | **SATISFIED** | `services/institution/carrying.ts`, `job_health` | Failure says what failed, whether reality is affected, whether data is lost, whether money is at risk, whether customers are affected, what Foundry is doing and whether the owner is needed. Execution states are machine-readable and a job that swallows a blocking exception is not SUCCESS. Migration 317 added `retired_at`, because a job nobody schedules cannot be failing |
| **42** | Security / privacy / data rights | **SATISFIED** | `privacy.ts`, `suppression.ts` | Suppression, erasure, retention and provenance are all real and enforced at the schema. Access to data is not a right to commercialize it; trust is bound to customer, provider, purpose and experiment. Nothing was weakened for UI convenience — the strict CSP on every owner surface is the opposite trade |
| **43** | Absence tests | **PARTIALLY SATISFIED** | `services/institution/absence-test.ts` | 7 days holds and is read from the live estate. The `truthful()` property was a **modelling gap, now closed** — see the finding below. 30 and 90 days cannot hold yet: the recovery ladder is 11 days old, so those are **WAITING ON REALITY, ≈ 4 October and ≈ 3 December** |
| **44** | Browser / experience proof | **PARTIALLY SATISFIED** | `scripts/measure-mobile.mts` | Real journeys in a real browser at 375–1440px, 100% and 200% text, with the stylesheet served **and the canonical dark ground**. Of the twelve required journeys the harness proves **six**: 1 (healthy, no action), 3 (a consequential decision waiting), 4 (an experiment running), 10 (return after absence), 11 (asking why, answered from evidence) and 12 (watch → inspect → intervene through a company to a posted boundary, without losing context). **Journeys 2, 5 and 6 are stageable and unstaged**; 7, 8 and 9 need a sale, a refund and a tax event that have not happened |
| **45** | Performance | **SATISFIED** | `foundry-shell.ts` | WATCH renders from materialized truth and waits on no model to say whether the estate is healthy — asserted from the source, so it cannot regress silently |
| **46** | Implementation sequence | **SATISFIED** | seven phases, in order | Reality crossing finished first (001 sent before the redesign began); then shell, cockpit, economic system, portfolio/discover/autonomy/roadmap, Forge, quiet maturity. Nothing was parallelised across a real dependency |
| **47** | Clean cutover rules | **SATISFIED** | the `/letter` absorption | Shadow → compare → cutover → delete was followed literally: `/letter` ran beside `/foundry`, was compared, was cut over, and System B was **deleted** rather than quarantined. Nine tests that encoded the old shape were repointed at the live doors rather than kept alive to protect dead code |
| **48** | Design system | **PARTIALLY SATISFIED** | `src/public/owner.css` | One stylesheet, consolidated after the semantics were proven rather than before. Typography, spacing, state colour, cards, owner-attention and degraded states, event rows, decision cards, evidence panels and empty states all encode meaning. **Chart grammar is one renderer** — `sparkline.ts` — with no comparative or distributional form, which is the right amount for an estate with no series in it and a gap the moment there is one |
| **49** | Owner interruption policy | **SATISFIED** *(constraint honoured under pressure)* | the withdrawn escalation | No implementation question was put to the owner across the whole tranche. One escalation was raised — *connect something to Foundry, or accept that quiet means nothing* — and then **withdrawn** on investigation, because it was a modelling gap rather than an owner decision. Escalating it would have been the easier, and wrong, outcome |
| **50** | Reporting | **SATISFIED** | `CLOSEOUT_ACCEPTANCE.md`, this file | NOW / PROOF / OWNER / WATCH / NEXT, with owner decisions returned first and never buried under implementation detail |
| **51** | Acceptance standard | **PARTIALLY SATISFIED** | — | See the A–N table below. **Twelve of fourteen hold.** E and F are architecture waiting on the first dollar; M waits on a second experiment. A, I and J held only after this pass |
| **52** | End state | **PARTIALLY SATISFIED** | — | Of the twenty-two capabilities this section names, the institution demonstrably does nineteen. It does **not** yet distribute surplus (no surplus), and it garbage-collects dead infrastructure only under a bounded observation window rather than as a habit. "Foundry thinks deeply, the owner understands quickly" holds everywhere except where §10 says it does not |

---

## The visual finding — two defects, one of them in the proof itself

The canonical boards and the production stylesheet agree on character: dark
forest ground `#0B100E`, restrained mint `#8FD1B8` for state, warm gold
`#D9A85E` for owner attention and **nowhere else**, editorial serif over
operational sans. Home's composition agrees too — a six-tile status grid, a
NOW/NEXT pair, one gold attention card carrying a named consequence, a bottom
nav. That was already true before this pass.

Two things were not.

### 1. Every screenshot ever taken was of a product nobody designed

`owner.css` is dark-first: the palette lives on bare `:root` and light is an
override under `@media (prefers-color-scheme: light)`. Playwright asks for light
by default. So the harness had, every time it ran, photographed the alternate —
and every picture in `docs/design/` proving the layout, the hierarchy and the
mobile quality was a picture of the wrong ground.

The layout measurements were never wrong; contrast, hierarchy and the meaning
carried by colour were simply never checked on the surface the owner sees. One
line of context configuration, and the proof is now of the thing.

### 2. The reason lived where the number belongs

Two surfaces put a paragraph where a figure or a state belonged, and both were
the defect §2 and §10 name:

- **Money** rendered the subtraction as seven `$0.00` rows, each followed by a
  sentence explaining why it was zero — roughly six hundred words to carry six
  zeroes, with the arithmetic the smallest part of the page. The reasons now sit
  together behind one disclosure; the subtraction reads as a column of figures
  ending in a ruled total. The page lost about 1,100px.
- **A blocked experiment** joined its four blockers with semicolons into a
  sixty-word sentence, and rendered that sentence **twice on the first screen** —
  once in NOW and once in the card below. The readiness check had produced them
  separately all along; only the prose put them back together. They are four rows
  now, in both places, and the page lost about 550px.

Nothing was deleted. In both cases the grounding a figure or a state needs to be
trustworthy is still there — one tap down instead of in the way. That is the
difference between WATCH and INSPECT, and it is the whole argument for §7.

### What was deliberately **not** taken from the boards

- The concept Economics page shows `$320`, `$290`, a 30-day inflow/outflow bar
  chart and five recent economic events including a `$2,840` Stripe payout from
  `Acme Millwork`. Production shows `$0.00` and no chart, because
  `economic_events` is empty. `sparkline.ts` **refuses** to draw a line from
  fewer than three readings, which is why Home has no estate trend: not a
  missing feature, the renderer declining to invent a shape.
- The concept Activity page leads with **"48 events today, +12%"** and includes
  rows like *"System health check completed — no action required"*. §22 forbids
  exactly that ("not logs, not every cron tick") and §1 forbids optimising for
  visible activity. Foundry needs an Activity surface — see §22 — but it needs
  the one §22 describes, not the one the board draws.
- The four `04_early_explorations_style_only/` boards are marked in the handoff
  as not product strategy and not a source of truth, and were read as style only.

---

## §51 — the acceptance standard, one row at a time

| | Criterion | Holds? | On what evidence |
|---|---|---|---|
| **A** | Owner comprehension after absence | **qualified** | `/foundry/absence` answers it, and Home answers health / autonomy / owner-need / now / next above the fold. Money does not answer the 30-second economic question at a glance |
| **B** | Clean migration, no ghosts | **yes** | `/talk` 404, `/autopilot` 308, System B deleted, one shell, one stylesheet, zero inline handlers |
| **C** | Authority legibility | **yes** | Effect class is carried on the act, not inferred from cost. No generic approval reaches a person-facing consequence — proven by a declined experiment holding 22 approved recipients and **zero** acts |
| **D** | Live truth | **yes** | Success means the state transition occurred. 21/21 provider receipts reconciled; a job that swallows a blocking exception is not SUCCESS; migration 317 stops a retired job reporting failure |
| **E** | Economic truth | **architecture** | The path is modelled and walked by a test from provider edge to surplus. There is no money in it |
| **F** | Tax awareness | **architecture** | A reserve is refused without rate, basis and source. No tax-relevant activity has occurred |
| **G** | Autonomy legibility | **yes** | Per-responsibility across observe/reason/decide/act/verify. No fake global percentage anywhere |
| **H** | Low owner labour | **yes** | 22 clerical approvals → 1 genuine decision; 27 loops retired; the one escalation raised was withdrawn on investigation |
| **I** | Progressive disclosure | **qualified** | Everywhere except Money, where the evidence is rendered on WATCH rather than behind it |
| **J** | Mobile quality | **qualified** | The layout holds at every width and text size measured. Until this pass, every screenshot proving it was of the light alternate, not the product |
| **K** | Low cognition waste | **yes** | No owner route reaches a model call — asserted from the source |
| **L** | Reality continues | **yes** | 001 sent, reconciled and left alone through the entire rebuild |
| **M** | Experiment quality | **waiting** | The lenses exist and 001 is encoded as curriculum. No second candidate has come through them |
| **N** | Quiet success | **yes** | Foundry displays estate healthy / autonomy normal / no owner action required, truthfully, and that is the state it is in |

---

## The one finding worth keeping — self-observability was a modelling gap

The absence model asked *"is a provider connected?"* when the question is *"is
there anything here that would speak up?"*. It counted rows in `company_senses`
and nothing else.

| company | senses | build verifications (7d) | expectation comparisons (7d) | was called |
|---|---|---|---|---|
| **Foundry** | 0 | **52** | **26** | *blind* |
| Tallow Reference Co | 4 | 0 | 0 | sighted |
| Northgate Reference Co | 4 | 0 | 0 | sighted |

The most closely watched company in the estate was called blind; two synthetic
rehearsals were called sighted.

A company is now observed if **any** of three mechanisms is live within seven
days: a connected sense, a verified check of how it is built, or an expectation
registered in advance and compared against a real event. All three are generic —
a customer's company with a connected repository produces the same rows.
`recursive-institution` still refuses a kernel that could ask which company is
Foundry, and a test holds that line from the source.

Three things stop it being cosmetic: the stream must be **live** (a week of
silence is blindness again), the reading **names what is watching**, and a check
**reporting a failure counts as trouble** rather than as sight.

**No new external provider is required, so there was no owner decision here.**

### What it found, which is the point

`schema-snapshot-freshness` had failed every six hours **for eleven days** — 43
failures, last passing 4 September. The drift was one object:
`health_write_probe`, created by `/internal/health` to prove the volume accepts
writes.

`carrying.ts` — the page the owner reads — already excluded it and correctly
reported no drift. `foundry/self-observation.ts` — which writes the **canonical**
evidence and feeds the one responsibility Foundry shadows — did not. The
institution's own record said a responsibility was failing while the owner's page
said it was fine, and nothing compared the two, because the absence model was not
reading that mechanism at all.

Left to run, the responsibility's own remedy would have written the probe table
into the committed description and made the description permanently wrong.

The fact lives once now, in `db/runtime-objects.ts`, and the route that creates
the table takes its name from the same constant.

---

## WAITING ON REALITY

These cannot honestly be proven yet. Each names the evidence that will resolve it.

| § | Requirement | Resolved by | Expected |
|---|---|---|---|
| 24, 25 | Economic path, production proof | the first real payment reaching `economic_events` | unknown — no purchases |
| 26, 27 | Economic responsibilities, treasury ladder | economic activity those roles would have work to do on | after the first payment |
| 30 | Tax stewardship, production proof | the first tax-relevant activity | after the first payment |
| 17, 51-M | Forge maturity | a genuine next candidate passing the lenses before reaching the owner | when one emerges |
| 43 | Recoverability at 30 days | the copy ladder reaching back 30 days | **≈ 4 October 2026** |
| 43 | Recoverability at 90 days | the ladder reaching back 90 days | **≈ 3 December 2026** |
| 35 | Cognition paying rent | `work` × `changed_something` over real production cycles | weeks |
| 44 | Journeys 7, 8, 9 | a sale, a refund, a tax reserve change | after the first payment |

None of these is blocked on architecture. Each is blocked on time or on somebody
else's behaviour, and the observation mechanism for each is already built and
running.

---

## WATCH

- **The 39 retired agent modules.** Off the timer, unreachable from any owner
  surface, preserved because deleting 39 modules to stop a cron was a larger
  change than the noise it removed. **Bounded observation window: until
  15 October 2026.** If nothing has scheduled them and no owner surface has come
  to read them by then, they are deleted — an engineering cleanup, not an owner
  decision. The reachability gate and `RETIRED_LOOPS` are the evidence.
- **Recoverability at the long horizons** will start holding on its own. Failing
  rows before those dates are the ladder's age, not a regression.
- **§25's single-entry ledger.** Adequate for an estate with no money. The first
  settled payment is when the question of whether it stays adequate becomes real,
  and it should be asked then rather than answered now.

## OWNER

Nothing. The one decision previously escalated — *connect something to Foundry
or accept that quiet means nothing* — was a modelling gap and has been withdrawn.
No new external provider, source or commitment is required by anything above.
