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
| J18 | **Keep going through a provider outage** without losing anyone or paying twice | works *(since 21 Sep)* | natural | protects | Scenario 10 on the world: the mail provider down the morning the hand writes — nothing sent, the morning says so once naming the provider's answer, the page says who could not be reached and that it will try again; the next morning the same offers go out once each under the same idempotency key. Before: a failed offer counted its recipient as done, and one bad morning dropped those people for good. A payment provider down when a refund is owed: the refund waits, the page says it needs him, and issues once when the provider returns. |
| J19 | **Own more than one company and still run a test** | works *(since 21 Sep)* | natural | reachable | Scenario 10: naming a second company made the sender "ambiguous" and no test could write to anyone; under a Workshop the sender is the Workshop (`senderCompanyOf`). Home watches the companies; "can I step away" lists the ones nothing reports on as ones Foundry cannot see. |
| J20 | **Know what a buyer is owed, and what only he can do about it** | works *(since 21 Sep)* | natural | protects | One reader (`obligations.ts`): owed, sent-unconfirmed, failed-refund-pending, refund-requested, disputed, uncovered — each with the action and whether it is his. Home's one thing when it needs him, the queue, Economics ("Owed to buyers"), the test's page, the Workshop page and the door's ranking all read it. The obligation outlives the acts' expiry, the test's settlement and a stop (the refund act survives a stop; the asset retires when the last buyer is square), and closes only when the goods are confirmed delivered or the money has gone back. Proved in the hand's suite under out-of-order, late and post-closure events and in the portfolio month. Unobserved in production: no real purchase yet. |
| J22 | **Trust that a result means what it says** | works *(since 21 Sep)* | natural | **pending reality** | `the-instrument.ts`: what an offer invited, whether that path can carry it, and what a silence on a doubtful channel does not establish — on the settled page, in the outcome's limits and in the Inbox. The proof debt this row carried for one wave is paid: `public_channel_days` (migration 327) keeps the worst reading of each path on each day, written by the pass that already reads the health, so the sentence says *on how many of the test's own days the path was not working* rather than "I cannot say". A day never gets better after the fact (a message sent in the hour it was down was not carried), a day with no row is never counted as a day that was well, and the verdict is never touched. On the world's own run of Experiment 001 the reply path was down every day of the window, which is what production's null was taken on. |
| J21 | **Know the most Foundry can spend today, and why that number** | works *(since 21 Sep)* | natural | measures | One reader (`spending.ts`): the ceiling that binds, its source, what is spent against it, every other ceiling standing. The same number is handed to the door that buys thinking, so what Controls, the Ask answer, the charter page and the absence reading say is what refuses the call — the pre-charter dollar until he signs, the charter's rate after, the deployment's founder cap if lower. The monthly budget is shown as a note, not a limit; the thirty-day figure is the enforced ledger. Before: five ceilings, one enforced, two tables. In production this now binds all thinking at $1 a day until a charter is signed, as Controls has said since 21 Sep. |
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
| L7 | Customer behaviour → purchase / non-purchase → fulfilment → refund | **verified in the laboratory under out-of-order, late and post-closure events** *(21 Sep)*; **observed in production only as non-purchase** | Stripe webhook (claim released on a throw) → `settlement-intake.ts` (by reference: `settles_ref`) → `experiment_fulfilments` (closed at birth by a prior refund; disputed; failed after seven unconfirmed days) → `obligations.ts` (one reading for Home, the queue, Economics, the test's page, the door) | The first real payment; and six facts only real Stripe can establish (the tag reaching intent, session and charge and not the dispute; `payment_failed` at a link; the link parameters; refund idempotency and refusal on a disputed charge; redelivery after a 400), written as an unrun procedure in `scripts/stripe-test-mode-run.mts`. |
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

**And the null is narrower still than that.** Nineteen of the twenty-one
messages were delivered, every one of them inviting a reply, and the
Workshop's reply path was not routed. The verdict stands — the sealed rule
counted confirmed deliveries and payments, there were none, and a settled
result is not rewritten to suit a later discovery. What is corrected is the
institution's own claim about what the result *establishes*: a silence on a
channel that may not have carried a reply is not the same evidence as a
silence on one that did. `venture/the-instrument.ts` says so wherever the
outcome is said, and `public_channel_days` now keeps the worst reading of each
public path on each day, so for days it covers that correction is a fact
rather than a caveat — and a day with no row is reported as unwatched, never
counted as a day that was well.

Whether that makes the null void, sound, or sound-for-payments-and-void-for-
replies is a judgment about his own experiment and is his: **PENDING 21**.

## Testing the product as a person

`tests/helpers/world.ts` is the one seed: production's shape (owner,
company, Workshop stood up, Experiment 001 deliberated, approved and settled,
routines run, public sources proven; `charter`, `searching`, `eyes`,
`unsettled` vary it). `advanceDays(n)` moves every timestamp the live schema
has by n days, in the format its writer used — the SQL is the clock, so time
passes by moving rows, and the one guard that refuses a uniform translation
is lifted and put back verbatim. `runMorning()` drives the economic loop
through the registry as the scheduler does. Two months of ownership run on it
(`tests/simulation/07-thirty-days-of-a-search`, `08-a-test-through-thirty-days`,
`09-what-was-learned-changes-the-next-design`, `10-thirty-days-of-a-portfolio`):
a direction given, steered and asked about over thirty mornings that find
nothing, honestly; a test allowed, written, delivered, unanswered, settled,
learned from and retired over forty-one; a settled test binding the next
design appropriately; and a portfolio with the world going wrong — provider
outages as a world state (`outage`), companies added through the owner's own
door (`addCompanies`). `the-owner-surface-fits-a-phone` reads the surfaces
that changed on a 390px phone in a real browser. The suite itself costs what
it is worth: the schema is migrated once into a template and restored per
file (`src/test/template-db.ts`, proven equal by `the-template-is-the-schema`),
and `scripts/measure-suite-cost.mjs` reads the figures from a run that
already happened — before: 583 files, 2634s, 450 of them replaying 361
migrations. `seedProductionShape({ settledBy: 'the world' })` settles Experiment 001 as
production did — the cohort of twenty-one with their grounds, the Workshop on
stubbed providers, the owner's one act, the hand's mornings, 19 delivered and
2 bounced — and running it found the sealed rule's own sentence unreadable
("deliverys", "offer_delivereds"), which the ledger-written result had never
shown. `scripts/owner-review-harness.mts`
serves that world (`--day N` to return to it later; `--world` for the
hand-settled test; `--owed` for a buyer owed a refund with money tools off;
without `--world` it refuses to start when a provider credential is set) so
a reviewer who has not
seen the code is given an objective
in the owner's words, drives the real pages in a real browser, and reports
achieved / partial / failed with the moments of doubt, before reading any
source to name the cause. Findings become regression proofs or map rows; the
harness itself is a stage, not a gate.

**Review cell F, 21 September** (a sceptical accountant; an
ownership-protection reviewer), on the world in `--world --owed` mode: a buyer
owed $29 that Foundry may not refund. Five release-blocking findings, every
one a sentence contradicting a fact the same product held, all repaired:
Economics said "nobody has paid for anything" beside "$29 paid, not
delivered" (the sale ledger and the money ledger are written by different
events; the page says which is which now); Controls' health and the absence
reading said "customer effect: none · money at risk: none" beside an unpaid
buyer (both read the obligations, and what only he can do outranks a
nuisance in the Workshop's plumbing); the experiment page said "a fulfilment
row is written when money arrives, and none has" above "paid 1"; the
Workshop's pause promised "refunds still go out" with the deployment's
money-tools switch off; and the owner could not tell whether the refund he
had approved was authorised. Activity had no row for a payment, a failed
delivery or a refund — the obligation existed only as a status — and now
carries them under *Obligations*. What they left: the buyer is invisible to
him (no name, no note that nobody has told them) and there is no "deliver
instead of refund" path, both future frontier; the provider's fee on a
refunded sale is an external-evidence boundary.

**Review cell G, 21 September** (a returning owner after a fortnight; an
operational-reliability reviewer; an adversarial systems reviewer; the phone at
390px in both schemes), on the world in `--world --day 15`.

The worst defect this campaign has found came from the returning owner, and it
is not a bug in any component: **nineteen cold emails went to strangers
inviting a reply, the Workshop's reply path was not routed, and seven days
later the sealed rule settled the test *surprised* — and the institution filed
that as evidence about a market.** No rule was broken; the rule counts
confirmed deliveries and payments, and there were none. The failure is upstream
of every safeguard: a null result is only evidence about the world if the world
could have answered. `venture/the-instrument.ts` reads what an offer invited
and whether that path can carry it, and the settled page, the outcome's limits
and the Inbox say so. **The verdict is never touched** — a sealed rule counted
what it said it would, and rewriting a settled result to suit a later discovery
is the thing the seal prevents. What changes is what the institution CLAIMS the
result establishes, which is its own claim and its to correct. Proof debt: the
Workshop's health is a snapshot, so the sentence says it cannot know whether
the path was down while the test ran; a per-day record of the reply path would
let it say more.

Four more release-blocking, all repaired: Home printed "Everything is fine.
Nothing needs you." above a health reading that said otherwise, and above a
queue that had one thing in it; "Last healthy" was asserted at the same instant
as "Recovering: stuck", because it measured a job returning rather than the
day's work being done; the Inbox said "Nothing has been sent, so nothing has
come back" a fortnight after nineteen went out; and the Workshop promised
"refunds still go out" and "replies are forwarded to your own inbox" directly
beneath the reading that said neither was true. Activity's new obligation rows
called a bounced *offer* "a delivery to a buyer did not arrive" — a defect
introduced by the previous wave and caught here, since both are written under
the same event kind.

The adversarial lens could not bypass authority: no email, publication, money
movement or cross-owner act, and no way to make an obligation disappear. It
found one integrity defect, now repaired: the owner's own "money moved" form
read any unrecognised direction as *took out* and accepted any amount, writing
a permanent row into the one figure he trusts. It refuses a direction it does
not know, bounds a single entry, and says that a wrong row is corrected by a
second row rather than erased. Carried, not repaired: a refused route is a
transient banner and is not recorded where he would later see it.

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

**Review E, 21 September, four lenses at day 15 of the world** — the
returning owner on a laptop (seven sentences and the settled test's page),
the sceptical accountant (every money figure on every page), the first-time
reader on a 390px phone, and the compliance reader (the live public site and
the owner surface). Repaired the same day (`the-owner-surface-fits-a-phone`,
`the-owners-sentences-land`, `what-happened-has-one-name`): **every page was
unreadable in light mode** — the v3 layer painted a dark ground whatever the
theme said, so on a light-mode phone or laptop every headline, figure and
answer was near-black on near-black; the ground now follows the theme and the
proof reads the headline's contrast against it in light mode. The settled
test's page showed live steps ("What happens next 3 of 4 done") and
present-tense permissions after settlement; a settled test with no offer ever
placed said "nobody bought" as if people had been asked (it now says nothing
was sent); the money fold's "Set aside $100" on a settled test was read as
still earmarked (now "Was set aside … ended with its answer"); "$100 to run"
on the why page read as spend (now "a ceiling, not spend"); the harness
answered "what happened while I was away" for seven days because it never
marked his leaving (it does); the Ask pill needed two taps (one, with the
cursor in the box); breadcrumbs were 32px (44); a title was cut mid-word;
"I don't like this direction" never said which direction or what would be
passed over (it names the search and the standing candidates and is headed
"Change course?"); "clear the messages" with no mail ever said he had put
things away (it says nobody has written); a double full stop; "What it does
not" is "What it does not establish". **The compliance reader found the
owner surface telling him his name is on no public surface while Experiment
001's sealed public copy names him** on an indexable page — the sealed
record is not rewritten; the assurances on Controls, the Workshop page and
the charter now say exactly where his name is. Left, with the reason:
- *The public experiment page names him* (Experiment 001's sealed copy, a
  record by the institution's own rule; the owner's standing constraint says
  terms and the Etsy policy only). The two rules conflict and only he can
  settle it: `OWNER_DECISIONS_PENDING.md`. The first-name mailbox
  (thomas@) and the site's disclosure that its prose is machine-written are
  the same decision's neighbours.
- *Five thinking ceilings on Controls* ($1, $3, $25, $500 a day; $50 a month):
  the binding one is now said beside them; unifying them into one reading is
  a design, not a repair. The charter form's defaults print as figures on an
  unsigned charter; "price cents: not recorded" beside a $29 offer; "$0.00 in
  Stripe" does not distinguish a read of zero from no read.
- *The laboratory's settled test never placed an offer* (the world settles
  Experiment 001 by the owner's own settlement, not the hand's); the page now
  tells that truth, and a world that runs the hand to settlement is scenario
  08's, not the harness's default.
- *Vocabulary the phone reader did not understand* — "Estate", "Autonomy",
  "candidate standing", "sealed", "from canonical state", "Every figure is a
  row" — is the same vocabulary pass as before, unchanged.

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

---

## The independent review, reconciled (21 September 2026)

An independent strategic review ("Astra") examined the institution from
outside: its economic objective, its opportunity selection, the facts its safety
rests on, its owner-authority semantics, its recovery posture and its private
boundary. It is recorded **here**, in the map, rather than in a document of its
own — a second governing document to store a reconciliation would be a second
place for the institution's account of itself to drift from this one.

Each finding carries a classification, where it lives in the code, and the
smallest thing that would falsify the resolution. **Five findings were rejected
or found already answered**, which is the part of a reconciliation most worth
writing down: a review that is accepted wholesale has not been read.

### Already resolved, with evidence

| Finding | Where | The proof |
|---|---|---|
| Backups exist but a restore is unproven | `keeping.ts:208` | `restoreTheInstitution` gunzips into a named path, opens it as a separate client and refuses the live database. It was already exercised; what it verified was shallow, and **that** was the real finding — see below. |
| Nothing preserves obligations in a degraded mode | `hand.ts:1407-1411`, `:1503`, `:1555` | `mayWrite` gates only new exposure. `carryWhatIsOwed` runs unconditionally on both passes and provider reconciliation runs before any pause check. Proven end to end in `stopping-is-not-abandoning`: a paused morning places nothing and refunds the buyer anyway. |
| Authority is one global verdict | `consequence.ts:53-186` | The seven-rung ladder binds to the capability and the act, per act, with `absorbable = 0` on the two rungs no policy may ever pre-authorise. What was global was the owner-facing *rollup*, and that is a real gap — see "accepted narrow". |
| The owner's entry point is missing (`apexmicro.ai/foundry` → 404) | `the-workshop-has-one-public-face` | Correct by design. The Workshop is the only public voice; a Foundry door on the public domain would be the rule broken, not a feature added. The owner's entry is `foundry-intel.fly.dev/foundry`, which answers 401. Recorded in OWNER_DECISIONS_PENDING as resolved so the next reviewer reads the answer. |
| The same-volume backup limitation is hidden | `keeping.ts:51-56`, `fly.private.toml:100-105` | Stated in the source and in the deploy config, in both places, before anybody asked. |

### Rejected, with a reason

| Finding | Why it is wrong |
|---|---|
| The order record holds the buyer's email, so `persistent_personal_data` is present | It does not. `buyerAddressFor` (`payment-link.ts:183`) reads `receipt_email` / `billing_details.email` from Stripe **at delivery**; what persists is a keyed HMAC of the counterparty and nothing else. I had already set the fact to `present: 1` on the reviewer's reasoning before checking, and reverted it. This is the single most important correction of the reconciliation: an inference from a plausible model of the system nearly became a recorded observation about it. |

### Accepted, and narrow

| Finding | What was actually wrong | Where |
|---|---|---|
| MRR is treated as the definition of success | The ownership verdict read MRR minus the AI bill and could not see a one-time sale, an experimental asset, or the institution's own ledger. Rebuilt on `economic_events`; money and owner time are separate judgements; `OBJECTIVE.md` reconciled to RIVER. | `burden.ts`, `OBJECTIVE.md` (`bcdf3cee`) |
| A polite question can be executed as an instruction | It was ordering, not parsing: `isAsking` ran before the reader that recognises an instruction inside a question. A genuine enquiry naming a consequential act now asks one clarification. | `the-door.ts` (`ad8a78c2`) |
| A recipe's intention is recorded as an observed fact | `basis` now gates binding policy; a structural fact that is `assumed` cannot satisfy a requirement, and `enforced` must name what enforces it. One of the three examples given was wrong (above). | migration 332, `offer-composition.ts` (`cbec68c1`, `d9942979`) |
| Shared exposure is read as economic inferiority | `makesItWorse` meant "shared, therefore worse". It is now deepening a way to FAIL with no new ground; shared reach reports as reuse, with the concentration still named. | `resilience.ts` (`4d08e54e`) |
| The factory defines the opportunity space | True, and now stated rather than fixed: `theAperture()` derives what could not have come through — the five effort seeds, the ten markers, the one makeable form of five, the $5–49 single payment — from the live facts. The coverage exercise finds that not one of seven forms outside the recipe was rejected on economic grounds. | `the-aperture.ts` (`4d08e54e`) |
| Distribution has no economic role | It entered one step too late, as free text on the experiment design after a candidate had won. A candidate can no longer earn a company with nothing on record about how its buyers would be reached. | `validation.ts` (`4d08e54e`) |
| A backup is not a recovery | The restore verified a table count and a founder count. It now reconstructs what is owed, money taken and returned, live spending authority and live assets, compared against the live database — and the test that matters requires it to report a **difference**. | `keeping.ts` (`34fd213a`) |
| Autonomy is reported as one estate-wide verdict | Added the reading by kind of act, on the door's own seven rungs. | `autonomy-map.ts` (`34fd213a`) |
| A learning claim has no denominator | A null result now carries how many people received it and what a silence that size could not have detected. | `what-happened.ts` (`d07ce02e`) |

### Accepted as a failure class, not an example

- **Two readings of one fact disagree unless one is derived from the other.**
  Every repair above that could be derived was derived: the aperture reads the
  live seeds and the registry's own `needs` strings; the restore comparison is
  one statement run against two connections; the autonomy rungs are read from
  the constitutional table. A hand-kept list is accurate the day it is written.
- **A filter right on one side of a comparison and absent on the other does not
  fail loudly — it agrees, silently, about the wrong world.** Found in
  `portfolioFitOf`, one query below a file header forbidding exactly that.
- **A rebuild takes its guards with it.** Migration 332 dropped and recreated
  `structural_facts` and silently lost two inherited triggers.

### Deferred, on a named trigger

| What | The trigger |
|---|---|
| An external liveness witness | Needs a third party, an account and a bill. Recorded as the owner's decision. Until then the absence page states the undetectable-outage window beside what is owed. |
| A production Clerk instance | PENDING 24. Needs an account action and a new secret; the code reads both from the environment already. |
| Repository visibility | PENDING 23. Not an engineering decision, and changing it would not undo any disclosure already made. |
| Buying any unmakeable product form | A capability is bought by a specific evidenced opportunity, never by an empty slot in a registry. The trigger is an opportunity that justifies it, not the gap itself. |

### The institution's own development economics, after this wave

**What it can now do safely that it could not.** Judge a candidate without
mistaking a shared channel for a shared fault. Say out loud what it could not
have found. Refuse to take a candidate forward with nothing on record about how
its buyers would be reached. Tell its owner what stopping would leave on his
desk before he stops. Demonstrate that a copy reconstructs what is owed rather
than that a file opens. State how long it could be dead before anybody noticed.
Publish a dated correction without a sealed byte moving.

**What is blocked by remaining work.** Nothing in the opportunity space is
blocked by *code*; it is blocked by the aperture, and the aperture is now
visible rather than repaired — deliberately, because widening it means buying a
capability, and that needs an opportunity that justifies it. The two external
dependencies (PENDING 23, 24) block nothing operational.

**Would a simpler implementation have been equivalent?** For three of these,
yes and it was taken: no new tables for distribution, no `if_it_works` column on
a constitutional vocabulary, no new document for this register. For the
clarification, no — the additive column with its three refusals is the smallest
thing that can publish a correction and still prove the record did not move. The
one place complexity was genuinely added is `winding-down.ts`, and it earns its
place by answering a question no existing surface could.


### What two review cells found in the reconciliation itself (21 September 2026)

The register above was written before the changed institution had been reviewed.
Two independent cells then read only this wave's diff — one on owner protection,
one on the public record — and between them found **fourteen** defects, of which
three would have caused real harm and two were regressions introduced by the
repairs themselves. That is the finding worth recording: a wave of corrections
is not safer than the code it corrects, and a reconciliation that is not itself
reviewed is a longer way of being confident.

**The three that would have caused harm.**

1. *The distribution gate was unsatisfiable.* Requiring a candidate to declare
   how its buyers would be reached is right; nothing on the real path writes
   that row, so an unconditional gate would have held every real candidate for
   ever behind a sentence that reads like an action item, with no control
   anywhere that performs it. A gate nobody can satisfy is not a standard; it is
   an outage with a principled explanation. It now asks only of a candidate that
   has already said how it earns, and the gap is recorded here instead.
2. *"The text above is unchanged" was enforced by nothing.* The rule fired only
   on the statement that wrote the footnote, so the record beneath it was frozen
   for one statement and free for every statement afterwards — and two exported
   functions do exactly that in the ordinary course of business. It also missed
   three columns, one of which (`graduated_to_url`) would have presented the
   failed experiment as a success inside the statement the rule existed to
   police, and it treated DELETE as not a write. Migration 334 replaces the
   enumeration with one rule: once a footnote exists, the record beneath it is
   frozen against every statement and the row cannot be deleted.
3. *The zero-events bound was printed on results that were not zero.* A test
   that delivered nineteen briefs and took three purchases read "the prediction
   held … would still have produced this silence". There was no silence. Both
   cells found it independently.

**The two regressions the repairs introduced**, both caught here rather than in
production: the shared-reach rule was widened until a candidate identical to the
portfolio on channel, buyer and industry was told "nothing about it fails at the
same moment as something you own" — contradicted by the rows it was holding; and
the aperture, put on the first screen, broke the standing invariant that the
first screen is not a filing cabinet. The first is corrected to report reuse
without excusing it; the second moved to the search's own page.

**And the record of the authorisation was the one record missing.** The
repository held the mechanism, the wording and the proofs for the public
clarification, and nowhere the permission. It is now recorded as §22 RESOLVED in
`OWNER_DECISIONS_PENDING.md` with the owner's words quoted. One word of the
footnote changed with it: "the recorded result stands" became "is unchanged",
because whether the null stands is PENDING 21, which is open and is his.

**Deferred, on a named trigger.** The forge's five-lens deliberation has a
structural stopping condition — five disciplines, one pass, one attacker — so
there is no unbounded loop to bound. Whether five lenses beat one is an
empirical question with no ground truth available: one real experiment has
settled, and answering it means running designs both ways and paying for both.
The trigger is a second settled real result, not a harness built in advance.


### And what a third cell found in the repairs of the repairs (21 September 2026)

Eight more, six confirmed, two severe — in the commit that fixed the previous
fourteen. The pattern is now established well enough to be written down as a
rule rather than an observation: **a correction is code, and code gets the same
adversarial reading or it gets none.** Three rounds, and each round found real
defects in the round before it.

- *The permanence broke erasure.* Making a published record undeletable gave the
  founder-erasure sweep an abort it cannot retry past, so a person asking to be
  forgotten would have been half-forgotten and the founders row never redacted.
  The file that runs that sweep documents this exact failure class in a comment
  about another table. Migration 335 exempts a scheduled erasure, the way
  migration 331 already did. A record is permanent against its keeper, not
  against the person it is about.
- *The rule watched the wrong door.* SQLite resolves `INSERT OR REPLACE` by
  deleting the conflicting row **without firing BEFORE DELETE triggers**, and
  `INSERT OR REPLACE` is an ordinary idiom here. The reviewer executed it: the
  footnote gone, every sealed column rewritten. Closed on the insert side, which
  is the only side that can close it.
- *"Surprised" is not a zero-purchase verdict.* Gating the zero-events bound on
  the word narrowed the defect the previous round found and did not close it: a
  test disproved by one extra delivery can take a sale and still settle
  surprised. It is gated on the purchase count now.
- *The restore's repair made a reading vanish.* `OPEN_OBLIGATION` names columns
  added in migration 326, and the loop's `catch` dropped any reading the copy
  could not answer — so restoring a sixty-day-old copy silently removed all
  three buyer-obligation readings and reported seven greens. An unaskable
  reading is now reported as unaskable, which is what it is.
- *And two smaller ones*: the wind-down's money-tools caveat missed a delivery
  seventy-one hours old and caught one seventy-three hours old; a verdict said
  "everything about how this makes money is new" in the same breath as naming
  what was reused.

**Accepted narrow, and stated rather than fixed.** The public status line is
computed from the asset's standing and the experiment's verdict, neither of
which the record's freeze covers — so an owner marking an asset earned still
changes what the page calls itself. That transition is his. What was fixed is
the part that was not: a clarified record no longer DISCARDS its recorded
outcome when that happens. And the channel gate, as rewritten, decides nothing
on the real path today and can be evaded by retiring a true statement; it is
satisfiable and inert, which is better than unsatisfiable and blocking, and the
gap is the one recorded above.


### The portfolio, and the four limits waiting on a second earned asset (21 September 2026)

Reconciling the owner's clarification — Apex Micro as the portfolio home rather
than the storefront — turned up four real limits. None blocks anything today,
because there is at most one earned asset. All four bite on the second, and the
trigger is exactly that: **the second earned asset**, not a date and not a
tidiness pass.

| What | Where | Why it waits |
|---|---|---|
| The Workshop assumes exactly one earned company | `settings.ts:87` `earnedCompanyOf`, `hand.ts:690` `senderCompanyOf` | Both require a single row and return null for two. The Workshop would lose the identity it acts as, on the day the portfolio becomes a portfolio. |
| An earned asset has nowhere to hang a sale | `experiment_exposures.experiment_id` is `NOT NULL` | Every sale is recorded against an *experiment*. An earned, non-experimental asset selling on a venue cannot record one at all. |
| Obligation remedies are Stripe-shaped | `obligations.ts:84-91` | "Refund it yourself in Stripe" is wrong for a venue sale, and no venue obligation has ever actually been carried — proof-2 delivers and refunds in the same breath, so `OPEN_OBLIGATION` has never been true for one. |
| Nothing records the venue or the responsible seller as a fact | `structural_fact_kinds` is closed by a constitutional trigger | Venue lives in prose — `grounds` strings, `deliversBy`, `chargesHow` — and in `OfferShapePlan.listing`, which is not persisted as a fact. A new kind cannot be added; it would need another table or an `origination_policy` requirement. |

**What was built instead, because a real asset bought it.** Experiment 002 sells
a workbook on Etsy today and had no presence on the site at all — the only shape
available was the full product page, and the owner's boundary rightly forbade
publishing the offer. The portfolio entry is the missing shape: what it is, who
it is for, who is responsible, and a link to where it actually lives. Two things
stood in its way and both were specific rather than architectural: the listing
address was classed with the Stripe payment-link ids as a secret, and the
publication gate demanded a price and a way to pay.

### A guarantee that lives in one function nobody calls (21 September 2026)

Two adversarial cells read the portfolio-entry diff independently and found the
same severe defect, in the same words. `how-it-should-show.ts` opens by
asserting that **an owner's `never` is decisive and is never reasoned around**.
That rule was implemented — correctly, in the one function that computed it —
and the only consumer of the answer was a renderer branch choosing between two
page layouts. `publishSite` filtered on `status` and on approval and read no
boundary at all. An owner tightening `publish` to `never` would have watched the
full product page republish, unchanged, on the next hourly pass.

Compounding it, `owner_boundary_subjects.publish` carries a **NULL door**, so
`boundaryStandingInTheWay` — which selects on `s.door IN ('outbound','spend')` —
never sees that subject. `ask_first` on publishing was therefore enforced by
nothing anywhere in the institution, and the sentence in §25 promising the owner
that the entry "waits, every time" was false as implemented.

**The repair then broke the thing it was protecting, which is the part worth
recording.** Filtering the publishing pass on the reader's whole verdict looked
obviously right and was wrong: `shape` answers `not_public` both for "he
forbade it" and for "nothing has reached anybody yet", and the asset whose own
page is the venue has no exposure until an offer is placed and no offer until
the gate sees a published page. `seedProductionShape` failed outright — the
world would not start. The second attempt, holding on the boundary row alone,
failed the same way for a different reason: `approveExperiment` writes
`publish: ask_first` for *every* approved test and approves the placement act
two lines later, so reading the boundary without asking whether he had answered
it held every Workshop-carried page forever.

Three separate conflations, one shape:

| Conflated | Kept apart by |
|---|---|
| A reading of how public a thing should be, and permission to publish it | `shape` versus `yourWord` — only the second holds a page |
| A boundary that stands, and one he has already answered | An approved, unrevoked act under subject `publish` for that product |
| An approval bounded to one effect, and an asset's standing public record | Reading `decision`/`revoked_at` and deliberately not `consumed_at`/`expires_at` |

The doctrine this campaign wrote after the A-series — *a correction is code, and
gets the same adversarial reading or it gets none* — earned its keep twice in
one afternoon. Both regressions were introduced by repairs, both were caught by
the world fixture rather than by any assertion aimed at them, and both are now
pinned: `seedProductionShape` cannot complete unless Experiment 001's page
publishes before its offer is placed, and a test asserts no page is ever held
for a reason other than the owner's own word.

**And then two cells took the repair apart, and the repair was wrong at the
root.** The `ask_first`-is-answered rule — which the section above presented as
the elegant resolution — was an over-reach that produced four defects from one
mistake. `owner_boundary_subjects.publish` is not the subject of *publishing a
page*. It is the subject of **placing an offer**, and `approveExperiment`
writes that sentence verbatim before proposing the placement and recording the
owner's answer. Reading it as a page rule meant:

1. The page pass inventing a question the owner was never asked.
2. A `stripe_create_payment_link` approval — disclosed to him as "a product, a
   one-time price and a payment link exist on the shared account; no money
   moves" — being consumed as his consent to put a web page in his name and
   re-put it hourly. **Authority inferred from an adjacent capability**, which
   is the single thing this institution's constitution forbids, committed by
   the very function whose header claims to protect his word.
3. `stopExperiment` revoking that act and then calling `republishRecord`, so a
   stopped test's page would be held for ever with "Open now" and a Buy button
   over a payment link the same function had just deactivated.
4. A listing's boundary becoming unanswerable, because nothing anywhere
   proposes a publishing act for a listing — making §25's promise that "the
   entry is proposed to you and waits, every time" false in both halves.

The rule is gone. `yourWord` is `'never' | null`. Whether an offer may be
placed belongs to the door that places offers.

**The harder half: a `never` did not take anything down.** Both cells found it
independently, and it is the case the guarantee exists for — the owner reads a
complaint and says "take it down". Dropping the page from the hourly pass does
nothing to bytes already in the store: the Worker serves `page:<path>` from KV
and `cloudflare_kv_delete` refuses any key beginning `page:`
(`pages_are_never_deleted`), correctly, because a URL a customer holds is not
something to break. So withdrawal is a **replacement**: the address keeps
answering and says the thing is no longer offered, with the responsible
business named, a person reachable and the refund promise repeated rather than
linked away.

One case is deliberately not resolved by code. Where the page carries a
published outcome or a dated clarification, two of the owner's words meet —
`never` is decisive, and truthful historical records are preserved when an
offering closes — and replacing it would destroy the account the seal exists to
keep. Which he meant is not a routine's to decide, so the page stays and the
conflict is reported to him by name. An institution that resolves a conflict
between two owner instructions silently, in either direction, is worse than one
that asks.

**Also closed this round, all from the two cells:** three callers reported a
held page as a success (`prepareExposure` returned `published: true` with a
404-ing URL and the owner's screen said "placed"; `standUpWorkshop` dropped
`held` entirely; the owner's own Publish button said "published" when every
page was held); the renderer branched on one shape of five, so `identity_only`
— the shape that exists *because* the rows could not settle the channel —
published the most, inverting the reader's own rule 2; the publication gate's
new comment claimed all its checks read the bytes that would go up while the
render used `replyRouteProven: false` and the staleness check used the real
value; `/about` and `/privacy` asserted unconditionally that a marketplace
product *has* an entry here when none is published; a closed entry showed a
"Closed" pill with no note of why, and could not carry a dated clarification at
all; and a delisted entry rendered a sentence beginning "— or" with nothing to
be an alternative to.

**Proof debt, stated plainly.** The marketplace refund promise on `/refunds`
— "the promise is the same one … no form, no time limit … mine is not limited
by it" — is *supported* by a recorded source observation (Etsy's own help page:
the seller may refund at any time through Etsy Payments) and is consistent with
the live listing. But no machinery stands behind it: nothing reads the venue,
`recordVenueOrder` marks a fulfilment `delivered` on insert so no refund
obligation can ever be raised for a venue sale, and the only refund executor is
Stripe. It is an honest promise the owner keeps by hand, published in the same
voice as one the institution enforces, and nothing would detect it being
broken. Evidence maturity: **asserted, not observed.** It is recorded here
rather than built around, and it moves on the same trigger as the four limits
above — the second earned asset.

### Stripe as a financial hub: investigated, and the answer is mostly no (22 September 2026)

The owner asked whether Stripe could serve as a central financial hub for the
private portfolio — specifically "whether an eligible Stripe financial account
could serve as a suitable receiving and operating account" — while recognising
that marketplaces run their own payment systems. He authorised no change to
payout destinations, no account creation and no money movement.

**The answer, from Stripe's own documentation.** A Stripe *financial account*
is a Treasury product, and Treasury is sold to **platforms**, not to sellers.
Its stated requirements: available only to platforms and connected accounts in
the United States; **available only to platforms with B2B use cases**, with
Stripe explicitly not offering financial accounts to consumers or for consumer
purposes; supported only for connected accounts that do not use a Stripe-hosted
dashboard, where the platform carries requirements collection and loss
liability; and the platform must maintain a fraud risk management process.
Prebuilt embedded finance additionally requires Accounts v2 and API version
2026-04-22.

Apex Micro is a sole operator selling downloads. It is not a platform with
connected accounts, it carries no third party's loss liability, and it has no
B2B platform use case. **It does not qualify, and pursuing it would mean
becoming a different kind of business in order to get a bank account.** That is
a larger change than the problem justifies, and it is the sort of turn worth
refusing early rather than discovering late.

**What is true instead, and already built.** Stripe can be the hub for
*reconciliation* without being the hub for *money*. Etsy pays its proceeds to
the owner's own bank account under its own schedule; Stripe pays its own
balance to the owner's own bank account; neither needs to pass through the
other. What the institution needs is not a routing change but an accurate
account, and `economy/ledger.ts` already holds one — `recordVenueOrder` writes
the gross charge and the venue's fee against the same fulfilment, each measured
from the statement rather than estimated.

**What is missing, stated as debt rather than built.** The ledger records a
sale and a fee. It does not yet distinguish *pending payout* from *deposited*,
does not model a reserve, and has no notion of available cash as against
recognised revenue. The owner named exactly this: "Distinguish gross sales,
platform fees, pending payouts, actual deposits, refunds, reserves, outstanding
obligations and available cash." Those are four distinct observations of one
economic activity, and recording a payout today would double-count against the
charge already recorded.

That work waits on a trigger, and the trigger is real rather than tidy: **the
first venue payout actually observed.** Until money has moved once, a payout
model is a guess about a schedule nobody has seen, and Etsy's own deposit
timing (roughly 14 days for a new seller, weekly on Mondays by default, with a
5-day hold after a bank change) is documented but unexercised. Building it
before then would be the speculative infrastructure the owner told this
campaign not to build.

**Authority, kept separate as he asked.** Observing financial activity,
authorising an operating expense, issuing a refund, changing a payout
destination and transferring money are five different permissions. Today the
institution holds only the first two in any real sense: it can read what it is
told, and an allowance bounds what it may spend. It cannot change a payout
destination or move money, and nothing in this wave moved it closer to either.
The "limited financial allowance without exposing the whole balance" he wants
is `owner_allowances` — which already bounds a test rather than an account, and
is the right shape for it.

### Two review cells, and the difference between a word and a mechanism (22 September 2026)

Sixteen findings across two independent read-only cells. All repaired; the
maturity claims that move are recorded here.

**Readiness enforcement: `declared` → `controlled_proven`.** The reading is now
refused at the outbound door on the act rather than on the capability's family,
which is the discriminator the owner's standard actually requires — "the actual
action must be refused when a required condition is missing", regardless of
entry point. Evidence mode: simulated. It has never refused a real offer,
because no real offer has been planned since it landed.

**And the reading itself moved the other way, briefly.** Enforcing it revealed
that `qualificationOf` classified outreach — the mechanism of the only
experiment this institution has run — as `unknown`, and therefore blocked it.
That is now three named mechanisms. The episode is the map's clearest instance
of a general risk it should carry: **a reading nothing enforces is a reading
nobody checks.** Any verdict this document grades as `reality_proven` on the
strength of a screen rather than a refusal should be re-read with that in mind.

**Customer obligations on a marketplace: `declared`, not `available`.** The
previous wave graded the channel-aware obligation vocabulary as built. It was
built and unreachable: `requestVenueRefund` had no caller, so the state
`/refunds` promises to honour could not be entered by any means. It has a route
and a form now, which makes it `available` — reachable, exercised only in test.
Nothing here has yet recorded a real marketplace buyer asking for money back,
because there has been no listing and no buyer.

**Proof debt, restated and not paid.** Foundry still cannot DETECT a marketplace
refund being owed. Nothing reads Etsy, and the buyer's request arrives in Etsy
Messages, which nothing here can see. The owner relaying it is the only path,
and the record says `owner_entered` rather than `foundry_observed` — migration
341 now makes that impossible to misstate, at insert and for ever after.
Trigger for revisiting: an authorized Etsy connection at read scope.

**A structural gap named before it is reached.** `business_outcome_events`
carries `settles_ref` so a refund can name the payment it returns.
`economic_events` has no equivalent, so the ledger cannot express "this payout
settles these charges" or "this deposit is these orders". The owner's direction —
"A marketplace sale, its eventual payout and the receiving-account deposit may
be different observations of one economic activity. Do not duplicate revenue" —
is therefore currently unrepresentable in the money ledger. It is contained only
because no reader exists for payouts, which is containment by absence rather
than by rule. This must be built before any real financial data is read.

**The effects audit's own blind spot, recorded where it happened.** It keys on
`file|detector`, so it sees effect SITES and never CALLERS: a second, ungoverned
caller of a sender already listed once is invisible to it. That is how an hourly
Slack push into a room of real people stayed outside the door after the commit
that claimed to close it. `GUARD_IN_CALLERS` is empty now, and a new entry in it
should be argued rather than added.

### The first external operating capability, and what two reviews cost it (22 September 2026)

**Reading a marketplace account: `declared`.** Not `available`. The capability
exists, is proven end to end against a double playing Etsy's part, and has never
touched a real account — and `available` in this ladder means exercised, which a
double does not settle. It moves on the first real read and not before.

**What is now qualified, and what is not.** Etsy is askable (a
`sense_providers` row; the scopes were declared four migrations earlier and
nothing could offer them). The read capability is declared with `tool = NULL`,
so it reaches no door. The credential lifecycle was already
`controlled_proven` against the reference world and needed nothing. What remains
unqualified is everything that publishes: the three write acts keep no tool, and
`Etsy can be operated` stays `waits_for_you` because it reads the maturity of
the capability that would PLACE a listing, which nothing here touches.

**An operating limitation that no integration will ever close.** Etsy exposes no
shop-statistics endpoint to anybody — no daily views, visits, favourites,
impressions, search queries or traffic sources — withdrawn deliberately after
the data was used to infer Etsy's own financials ahead of its announcements. A
listing's LIFETIME view and favourite counts are readable and are read; the
daily series is not and will not be. Recorded in the retrieval's own
`cannot_see`, so it travels with every observation drawn from the read. Trigger
for revisiting: Etsy publishing such an endpoint, which is not expected.

**The 90-day refresh window** is an operating limitation, named in PENDING 25
before the owner agrees rather than in a comment afterwards. `sense_credential_tick`
renews within 24 hours of expiry and `renewCredentials` does not overwrite the
stored grant, so a scope-silent refresh cannot blank it.

### What two adversarial cells cost this wave, and what that says

Thirteen findings on a wave whose own tests passed. Four of them were false
claims in code comments and commit messages — statements about the system that
the system itself disproved. The pattern is worth carrying:

- **A test can pin a false sentence in place.** `saw` asserted Etsy reports no
  views to anyone; the retrieval it was written into contained view counts; and
  an assertion matched the false string. The suite made the error durable.
- **An overclaim of ignorance is as dishonest as an overclaim of knowledge**,
  and much easier to miss, because it reads as caution.
- **A guard that screens one property is not a guard for another.** `safeFetch`
  screened every redirect for SSRF and was cited, in a header I wrote, as the
  reason carrying a bearer token through it was safe. Screening an address does
  not decide who may hold a credential.
- **A silence is only evidence when the instrument knows it saw everything.**
  A truncated read and a parse failure both produced an empty list, and an
  empty list became an affirmative finding about the world.
