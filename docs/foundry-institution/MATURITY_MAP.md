# Maturity map — technical, product, economic, together

The smallest evidence-linked record of whether Private Foundry is *finished*
in the only sense that matters: the machinery works end to end, the owner can
use it without learning it, and it creates and keeps economic value. One row
per owner journey and per transition of the economic loop; three verdicts per
row; a link to what proves each verdict. Kept current when evidence changes,
never appended to.

It is not a backlog and not a strategy. `AUTONOMOUS_CAMPAIGN_STATE.md` names
the next start; `MASTER_COMPLETION_MATRIX.md` records the master prompt
section by section; `PROOF_PROGRAM.md` defines the E-levels used here. This
document answers one question the others do not: **for each thing the owner
comes here to do, does it work, can he do it, and does it earn?**

## How to read a row

| column | asks | verdicts |
|---|---|---|
| **T** technical | does the whole mechanism work, safely, through the complete path? | `works` · `works, gap` · `broken` · `unknown` |
| **P** product | can the owner initiate, understand, steer and find it later, through the app, without knowing the architecture? | `natural` · `findable, rough` · `hidden` · `broken` |
| **E** economic | does this create, protect, measure or improve real value, or reduce the burden of doing so — and what has reality said? | `earned` · `reachable` · `severed` · `pending reality` · `n/a` |

"Works" is never inferred from a unit test of a component; it needs the path
proven in one piece (a test that drives the real entrance and asserts on rows)
or an external observation. "Natural" is decided by a reviewer who was given
the objective and not the path (`scripts/owner-review-harness.mts`, below).
"Earned" needs an unmatched external counterparty to have done something.

## Owner journeys

| # | The owner wants to… | T | P | E | Evidence |
|---|---|---|---|---|---|
| J1 | **Start an investigation** in ordinary English, and find it later | works | natural *(since 20 Sep)* | reachable | `ask-connects-the-owner-to-the-institution.test.ts` drives the real composer: mandate row, Home "What I am looking for", `/foundry/searching`. Before 20 Sep: **broken** — the composer reached only the question path. Review B/C found a second break: with Experiment 001's search still open (as in production), a new direction was silently folded into it as a preference. Now the confirmation names the running search and he chooses — point it, or close it and start this — and the proven eyes open the moment a search opens (`the-first-direction-lands.test.ts`; browser read-back 20 Sep). |
| J2 | **Steer** a running search (favour, avoid, budget, posture, constraint inside a direction) | works | natural | reachable | same proof, "one row per thing"; `an-entrepreneurial-mandate.test.ts`; guidance is held against every candidate in `discovery.ts`. Review A: "avoid anything that needs customer support" fell to "which company do you mean" — a generic *avoid X* is now heard, support in it is the support-burden preference, and steering reads back in plain words with his sentence beside it. |
| J3 | **Stop** or **replace** a search, and still find the record | works *(since 21 Sep)* | natural | n/a | `the-working-set-stays-true.test.ts`: a closed search takes its debris with it — open candidates buried with the reason and a way back, undecided designs retired, Explore and its count empty, the attention queue clear, Discover honest, Activity carrying *Started / Steered / Stopped looking* in his words. Before: `stopMandate` was one UPDATE and the candidates stood on Explore forever (reviews B, C). A candidate buried because its search closed is not held against the next search that finds it. |
| J4 | **Ask a factual question** (how am I, what are you doing, what did you spend, what happened today) | works | natural | n/a | `matchQuestion` path with scope preserved; the pulse answers "okay". Reviews A/B/C: "what can you spend" was answered from code-change consents ("I cannot contact anyone" after 21 were written to); "is Foundry healthy" went to a company; "why did it fail" was "I don't know yet". All three now answer from the record (charter envelope, tests, sends, pause; the pulse; the settled test's prediction, outcome, limit and what changes). |
| J5 | **Ask for something outside authority** (write to people, spend) and be told the exact boundary and the next act | works | natural | protects | `authorityBoundary` page: what does not happen on a sentence, the charter, what is in flight; `whichDoor` → `authority`. |
| J6 | **See what happened while away** | works | natural *(since 21 Sep)* | n/a | `/foundry/absence`, Activity, the week-away letter. Review A: the letter was scoped to owned companies and said "nothing left the building" a week after 21 businesses were written to; it now carries the venture (sends under tests, searches opened and closed, steering, settled tests), and Activity carries the search lifecycle under its own filter. |
| J7 | **Understand why an experiment failed and what was learned** | works, gap | findable, rough | reachable | Settlement by sealed rule, verdict + `cannot_prove` on the design; `lessonsFor` reaches the next design's deliberation. The answer to "why did it fail" now says prediction, outcome, what that establishes and does not, and what the next design is written against. Gap: the lesson is *context* for the next design, not a recorded change in what is selected — unobserved until a second real design exists (E1). Review A: the experiment page states the outcome in six places and the reason in none; the jargon ("surprised", act ids) stands. |
| J8 | **Know whether Foundry itself ran** — and be told when it stops without opening the app | works | natural | protects | `foundry-knows-whether-foundry-ran.test.ts`; pulse on Home; `/internal/health` `loops`; one account notice per stoppage. Production: `loops.stopped: []`, last pass within the hour (20 Sep). |
| J9 | **Sign, read and withdraw the charter**; know what runs on its own and what still asks | works | natural | protects | `charter.ts`, `/foundry/charter`, `/foundry/controls/charter`; tests sealed only inside it; forge lets a sealed test in as the charter's principal. Review C: the Autonomy tile → `/foundry/charter` answers on its own / asks me / spend / ends in two taps; the Ask answer contradicted it ("Nothing…") and now reads the envelope. |
| J10 | **See the next test, why, and challenge it** | works | findable | reachable | `/foundry/experiments/next`, `/explore`; adversary attack recorded before the seal (`proof-1-deliberation`, migration 286). Since 21 Sep a candidate's card on Explore says what was tested before on it — the word, what it established and did not — and a design that would ask the same question by the same mechanism does not seal (`precedent.ts`; scenario 09). Review C: with nothing designed, "What to test next" is empty and points at Ask, which cannot answer "what is the next experiment"; "Show your work" gives the why and what would kill it but no control to challenge. The loop closes only when a candidate stands; the empty state now says so in one sentence, and whether a search is open. |
| J11 | **Hold sending without cancelling the search** | works | natural *(since 20 Sep)* | protects | Review C: **failed** — six phrasings, one of which ("…don't cancel the search") was read as *cancel the search*. The stop rule is negation-aware now; "hold off sending / pause outreach / don't email anyone" is heard at the door and offered as the one act that does it, the Workshop's pause on new economic activity (offers, placements and new tests stop; deliveries, refunds and the search carry on); "are you allowed to contact anyone" says the hold is in force. |
| J12 | **Know what was spent, what may be spent, what needs permission** | works *(since 21 Sep)* | natural | measures | `/foundry/charter` in two taps; the Ask answer reads the charter and the tests. `one-reading-of-a-tests-money.test.ts`: one reader (`moneyOfExperiment`) holds authorised, carved, allowance standing, spent, paid and refunded apart, and every surface renders it with its own label — the page names each quantity, the letter says *set aside* and how much went (never the ceiling as spend), Home says what is set aside when nothing is paid, the absence test bounds thinking by the charter he signed. Before: five figures on five surfaces (reviews A/B/C). An allowance ends with its test. |
| J13 | **Clear the inbox and have it stay cleared** | works | natural *(since 21 Sep)* | n/a | Per-thread archive / done / unarchive on the Inbox, proven. A thread he put away that a reply reopened says when he put it away and why (`the-working-set-stays-true`). "Clear the messages I've already dealt with" typed into Ask is a housekeeping destination at the door: one confirmation with the count, then every handled conversation put away with his reason, reversibly; the Handled view carries the same control (`the-owners-sentences-land`). |
| J14 | **Watch an experiment reach customers and see what they did** | works | natural | **pending reality** | Experiment 001: 21 written to, 19 delivered, 2 bounced, 0 replies, 0 purchases; settled *surprised* by the sealed rule on 19 Sep with the prediction preserved. That is one external observation of one channel; it establishes the null of that offer to that population in that window and nothing wider. |
| J16 | **Understand what happened to a test, in one word, with the reason** | works *(since 21 Sep)* | natural | reachable | One reader (`what-happened.ts`) turns a test's rows into one word, its meaning, the recorded reason and what it does and does not establish; the page, Recently finished, History, Activity, the letter, Home and the Ask answer render it (`what-happened-has-one-name`). Before: six labels for one outcome, two of them the raw column, and the page repeated the verdict without the reason (reviews A–D). *Partly* — some paid, fewer than the rule asked — reaches him from the grade. |
| J17 | **Ask the first commercial questions and be answered from the rows** | works *(since 21 Sep)* | natural | measures | "Is anything making money yet?" is answered from real payments, refunds, the last settlement and what is set aside (it reached the permissions answer before); "show me what you've found" names the search and the candidates standing; "I don't like this direction" and "look more closely at X" steer; a steering sentence that asks to look opens the search it steers (`the-owners-sentences-land`). |
| J15 | **Own an asset**: see its state, obligations, costs and whether it is worth keeping | works, gap | findable, rough | **pending reality** | Experimental assets are kept outside operating paths until reality earns them (`asset.ts`); a failed test's asset retires after `failed_test_grace_days`. Owner-adjusted value (support, owner minutes, entropy, dependency, reversibility) is doctrine (`OBJECTIVE.md`, `RIVER.md`) and partly columns; no asset has earned, so nothing has been valued. |

## The economic loop, transition by transition

The loop as the routines run it (`src/jobs/index.ts`): `sense_check_tick` 05:40
· `real_market_evidence_tick` 05:15 · `venture_discovery_tick` 06:00 ·
`forge_tick` 07:00 · `experiment_hand_tick` :20 · `business_outcome_tick` :35 ·
`public_workshop_tick` :40 · `institution_pulse_tick` :50.

| # | Transition | Status | Where | What would move it |
|---|---|---|---|---|
| L1 | Owner intention → open search | **end-to-end verified, deployed** *(20 Sep)* | `the-door.ts`, `mandate.ts`, `/foundry/ask` | — |
| L2 | Search → ways of looking connected | **end-to-end verified** *(20 Sep)* | `research-sources.ts`, `openMandate`, `sense_check_tick` | The proven public sources open the moment a real search opens (`the-first-direction-lands`, browser read-back: Home reads *Waiting — Foundry is working* right after the direction, not *Blocked: nowhere to look*). |
| L3 | Ways of looking → real market evidence (retrievals, observations, unknowns) | **end-to-end verified, deployed; externally observed in the reference world only** | `sources/*`, `market-evidence.ts`, `real_market_evidence_tick` | The eleven public sources need no credential (`321_more_ways_of_looking.sql`). A month over a world where every source answers nothing (`07-thirty-days-of-a-search`) found that one unreachable forum ended the whole day's pass for every search — the forum read is guarded now, like the tracker beside it, and the pass says which source did not answer. |
| L4 | Evidence → seeds → candidates (and burials) | **end-to-end verified locally** | `discovery.ts` (`discover`, `weedOut`, `promoteWhatEarnedIt`) | A real search has not yet run a full day in production with eyes open. |
| L5 | Candidate → design, adversary, seal | **end-to-end verified locally; deployed** | `forge-deliberation.ts`, `probe-design.ts`, charter | Needs a live charter: nothing is sealed outside one. Production has none signed yet. |
| L6 | Sealed test → authority → offer → distribution | **externally observed once** (Experiment 001) | `hand.ts`, outbound door, Workshop pages, `payment-link.ts` | One channel (email to a screened population) observed; the Workshop page and the Etsy listing exist as channels, unobserved commercially. |
| L7 | Customer behaviour → purchase / non-purchase → fulfilment → refund | **implemented; observed only as non-purchase** | Stripe webhook → `economic_events`; deliveries; buyer's own refund link | The first real payment. |
| L8 | Costs and revenue reconciled | **implemented; near-vacuous** | `probe_costs`, `cost_events`, `economic_events`, `reconcile.ts` | Real spend under a live charter; the first payment. |
| L9 | Outcome settled against the sealed rule | **externally observed once; end-to-end verified over thirty days** | `settleFromTheWorld`, `business_outcome_tick` | Experiment 001 settled itself; the owner was asked nothing. `08-a-test-through-thirty-days` runs a test from the owner's tap through sends, receipts, the window, settlement, the lesson and retirement over the world's clock, and found two gaps on the way: the world's settlement did not end the test's budget (the owner's did), and a refund owed by a settled test was refused once its budget ended — a test's own approved act carries the refund now. |
| L10 | Learning returns to the next decision | **verified in the laboratory** *(21 Sep)* | `precedent.ts` in the proposer, the sealing rule and the forge's recorded input; `lessonsFor` as context | Scenario 09 on the world after Experiment 001: the same question by the same mechanism in new words is not proposed and does not seal, with the precedent named; the same question by a different mechanism is deliberated with the precedent in its recorded input and seals; a different candidate is untouched; a re-run goes through the schema's own door. Unobserved in production until a second real design exists. |
| L11 | Portfolio disposition (keep, retire) | **implemented, unobserved** | `outcome.ts` retirement after grace; `asset.ts` | The first earned asset. |

**Severed today:** none in code. **Thin today:** everything after L6 waits on an
unmatched counterparty; L10 is proven in the laboratory and unobserved in
production.

## What reality has said so far

One offer, one channel, one population, one window: nobody bought. That is a
true null for *that* offer and no evidence about the category, the Workshop
page as a channel, or any other population. It is recorded that way
(`OWNER_OS_MIGRATION.md` § *Experiment 001, settled by the ledger*) and the
forge reads it that way.

## Testing the product as a person

`tests/helpers/world.ts` is the one seed: production's shape (owner,
company, Workshop stood up, Experiment 001 deliberated, approved and settled,
routines run, public sources proven; `charter`, `searching`, `eyes`,
`unsettled` vary it). `advanceDays(n)` moves every timestamp the live schema
has by n days, in the format its writer used — the SQL is the clock, so time
passes by moving rows, and the one guard that refuses a uniform translation
is lifted and put back verbatim. `runMorning()` drives the economic loop
through the registry as the scheduler does. Two months of ownership run on it
(`tests/simulation/07-thirty-days-of-a-search`, `08-a-test-through-thirty-days`):
a direction given, steered and asked about over thirty mornings that find
nothing, honestly; and a test allowed, written, delivered, unanswered, settled,
learned from and retired over forty-one. `scripts/owner-review-harness.mts`
serves that world (`--day N` to return to it later) so a reviewer who has not
seen the code is given an objective
in the owner's words, drives the real pages in a real browser, and reports
achieved / partial / failed with the moments of doubt, before reading any
source to name the cause. Findings become regression proofs or map rows; the
harness itself is a stage, not a gate.

**Reviews on 20 September** — A (steer, absence, why it failed, health), B
(initiate, spend, inbox, stop), C (explore, charter, next test, hold sending):
twelve objectives, one achieved outright, eight partial, three failed. What
they found is folded into the rows above; what was repaired that day is in
`OWNER_OS_MIGRATION.md` § *The first direction lands*. What they found and
was **not** repaired, by choice, with the reason:

**Review D, 21 September, at day 15 of the world** (away a fortnight; can I
afford another test; clear what I dealt with; stop this direction; why did it
fail): 0 achieved, 4 partial, 1 failed. Repaired the same day
(`the-owner-returns.test.ts`): the week-away answer covers the days he was
actually away, not seven by default, and says the search ran each morning; a
sentence with "Foundry" in it is about the institution, not the company that
carries its name (it was answered from that company's boundaries, silently);
"can I afford another test" is a money question; "stop pursuing this
direction" is a stop; Explore, empty because he closed the search, says so
rather than calling it an answer about the world; a buried candidate's reason
is printed once; one steering row per sentence; "what are you working on"
names the search. Left that day and repaired on 21 Sep in the next tranche:
"clear what I have dealt with" (a housekeeping destination at the door, J13);
six labels for one outcome (one reader, J16).

- *The composer is hidden on the phone until the Ask pill is tapped.* All
  three reviewers tripped on it. It is the North Star's decision — no fixed
  composer eating the viewport — and stays until the owner says otherwise.
- *Internal words* (act, seal, bury, `founder:<id>`) reach owner copy on the
  experiment page and History. A vocabulary pass, not a repair; the facts are
  right. (The raw source names on Searching are plain names now; the outcome
  words are one vocabulary since 21 Sep, J16.)
- *Four money figures for one test* across Home, Controls, the experiment page
  and the letter. Real, and the one that needs a design: one reading of a
  test's money (allowed, carved, spent, settled) that every surface renders.
- *Activity carries no search events* (opened, steered, stopped). The letter
  and Searching's history do; Activity's kinds are fixed and adding one is a
  small change with a vocabulary question attached.
- *"Clear my inbox" typed into Ask* — repaired 21 Sep (J13).
- *The experiment page states the outcome six times and the reason nowhere* —
  repaired 21 Sep: "What happened and why" on the page (J16).

## Selecting the next tranche

By consequence, from this map: unsafe or unauthorised behaviour; failure to
protect obligations, capital or cash flow; a broken owner journey; a severed
loop transition; a missing capability blocking a justified opportunity; a
repeated owner intervention that could safely go; a major usability defect in
an important workflow; a demonstrable reduction of future burden. A future
ambition is not on the list. A tranche is done when the row it touches carries
new evidence in every dimension it claims — not when its tests pass.
