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

**From Roadmap 2027 on (30 September 2026),** each slice's row in `ROADMAP.md` also names the measure it moves (A: recurring owner-minutes down; C: calibration up; D: cost per decision down; B: a bound held), the external event that earned it, and the condition under which it is deleted. The ratio of tables and jobs added to those deleted is read from `IMPLEMENTATION_STATE.md`'s generated facts at each quarterly review. `the-record-names-the-measure` holds the rows to it.

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

### A listing outlives its experiment: contained, not yet completed (25 September 2026)

The owner's intelligence-and-stewardship directive named this the decisive
lifecycle seam: `settleListings` withdraws the Foundry exposure the moment a
test settles — correctly, because the sealed prediction is done — but that
withdrawal does not take the listing down at Etsy. `listingExperimentsToRead`
selects on `ran_at IS NULL`, so the settled experiment drops out of the hourly
read for ever, and `recordVenueOrder`'s `not_listed` refusal for any order
after that was caught and logged beside routine noise. A real paid order and a
bug in this institution read identically in the operator log, which nobody
reads.

**What was built: containment, the smaller of two halves.** `settledListingsStillLive`
(migration 350) keeps a settled experiment in the hourly read while its asset
is still `active` — stopping on its own the day the owner retires it, since
`retireExperimentalAsset` already refuses to retire an asset with an open
buyer obligation. A `not_listed` refusal at that point is no longer a log line:
`venue_orders_after_settlement` is a durable, deduplicated, owner-visible fact
(one row per venue order number, resolved once with a reason), surfaced in the
attention queue (`founder/attention.ts`) and — the part the directive's own
acceptance line asked for — in the absence horizon's `truthful` property: a
paid order at a venue nothing has reconciled is exactly the silence that
property exists to catch, and it now fails the horizon rather than reading as
calm.

**What was deliberately not built: the asset-scoped intake.** This table is
not a ledger row. No charge, no fee, no fulfilment and no obligation is
written for the order it names — folding it into the concluded experiment's
own counts would be fabricating economic evidence (`reached` and `purchases`
are sealed with the prediction), and recording it as a real transaction under
the *continuing* asset runs straight into the structural gap this document
already named at line 508: `experiment_exposures.experiment_id` is `NOT NULL`,
so an earned, non-experimental asset has nowhere to hang a sale today. A fee
correction or a refund on the second order has nothing to attach to for the
same reason. **Reading a post-settlement venue order: `declared`.** Recording
one under the continuing asset: not built. Trigger for the next slice: the
same one already on file for the payout work — the first real Etsy order,
which requires PENDING 25 (an owner act at Etsy, still open).

**Proved against a double, not witnessed at the venue.** The controlled
sequence — order A settles the test, order B arrives on the same still-live
listing, two repeated reads surface B once and not twice, A's `ran_at`,
verdict and fulfilment count are byte-identical before and after, and the
absence reading's evidence names the order and the fix — runs in
`the-venue-is-read-not-typed.test.ts` against the file's existing Etsy double,
proved red against the prior code before the repair. No shop is connected in
production; whether Etsy's real receipts arrive in a shape this reader has not
seen remains unverified until PENDING 25 closes. *(Superseded 22–25 September:
the owner registered the app and connected the shop at read scope; see "Proof 1,
continued" below. Real receipts are still unseen, because no order has arrived.)*

### A minute of reading is not a sign-out; the connection page is the task (25 September 2026)

The owner placed his Etsy keystring and shared secret, pressed save, and the
page "just reloads back to the Home Screen and it doesn't say Etsy is
connected". Two defects, one report.

**The save never ran.** Clerk's `__session` token lives sixty seconds and is
renewed only by Clerk's browser SDK, which the owner's surface deliberately
does not load (strict hashed CSP, no CDN). A form that took more than a minute
to fill reached the server with a lapsed token, was sent to `/auth/login`,
and sign-in, finding him signed in at Clerk, sent him to `/foundry`. Nothing
was said and nothing was saved. `session-lapse.ts` keeps the last verified
token in an HttpOnly cookie of Foundry's own and, when `__session` has
lapsed, admits the request only on Clerk's live word (`sessions.getSession`:
status `active`, same user as the token's `sub`), cached for thirty seconds,
never more than twelve hours past expiry. Sign-out and revocation end it at
once; the script-readable `__session` is never exchanged under the grace;
Bearer clients keep Clerk's sixty seconds. Where it cannot be honoured, a
navigation returns to the page it was for and a lost POST returns to the page
it came from with `lapsed=1`, which the page states in words ("…so it was not
saved. Please send it again.") — the body is not carried through sign-in,
because it may hold a secret. `safeNext` refuses `//host`, backslashes,
foreign referers and the sign-in pages. **Maturity: `tested` against a Clerk
double (13 cases, 5 red against the old middleware); not yet witnessed
against real Clerk on the owner's phone.** Proof debt: one real save after
more than a minute on the page.

**The page answered with an essay.** Four stacked cards of explanation came
before the first box; after a save the acknowledgement rendered inside the
key fold, which a placed key closes; and the next step, connecting the shop,
was a sentence and a link to the revenue page whose button began the
authorisation. Rebuilt task-first: a three-mark progress trail (app key,
connect shop, confirm it's yours), the one current action as a card, flashes
in view, and every explanation (the key on file, the five-step record, the
four facts, what connecting reads, what it cannot do, disconnecting) folded
below. The Connect button posts the same two fields to the same route the
revenue page's button does, so the disclosure stored with the grant, the
constitutional scopes and the callback state stay server-derived; the form
carries a choice, not a request. The key form itself lost three paragraphs
for one line, gained labels, and shows the callback address as a copyable
field. **Maturity: `tested` (8 new cases, 6 red against the old page; 390px
screenshots, no horizontal overflow, no CSP violations).** Not yet seen on
the owner's phone.

### Eventide, as the owner's boards draw it (25 September 2026)

The owner sent the Eventide boards (light, green, dark; phone and desktop;
component sheet) with "this is what we were going for, but also with the
light/green/dark mode toggling". Against them, the palettes were already
right and the three modes already worked; what was missing was the identity
layer. Built, as one component system across all three modes:

- **The mark and name.** A half-sun over three horizon lines in gold beside a
  serif "Foundry", with "Ideas to income. Privately." It replaces the forge
  glyph and "Private Lab for Digital Income Streams", which came from the
  commercial product.
- **The switch on every screen.** Three icon buttons (light, green, dark) in
  the phone header and under the name on the desktop rail. They post to the
  existing appearance route (one writer for one column) and return to the
  page they were pressed on. That return address is the Referer, followed
  only when it is a path on this host, checked by the same `safeNext` rule
  sign-in uses. `//host`, foreign referers and sign-in paths all land
  elsewhere, and there is a test for each.
- **The horizon.** A gold glow and the faint edge of a planet at the top of
  the ground: strongest in green, quieter in dark, a wash in light. The old
  fixed 25rem band that drew a seam across wide screens is retired.
- **Home.** The greeting is in the wordmark's serif. Four square ways in sit
  under it (Ask, Decisions, Searching, Connectors), each an existing place.
  The four readings carry gold icons.
- **Connectors as tiles.** Two or three to a row, each with a monogram, the
  one line of where it is, and a dot that never says more than the line.
- **The stepper, joined.** Circles on a line (done green with a tick,
  current gold), used by the Etsy connection page.

No capability, permission or wording of a fact changed. The three-mode words
test still holds: the switch is labelled, not worded. Two rules were
honoured rather than loosened: new colours come from palette tokens, and the
first-screen line budget treats the four tiles as doors, like the navigation
it already exempts. **Maturity: `tested`** (screens at 390 and 1280 in all
three modes, no overflow, no CSP violations; 8 new cases). Not yet seen on
the owner's phone.

### Connect could not reach Etsy (25 September 2026)

After the save fix the owner placed his key ("it's actually worked") and was
then "stuck on step 2": Connect did nothing. The owner surface's policy said
`form-action 'self'`, and a browser applies form-action to every hop of a
form's redirect chain. Connect's whole job is one such hop, to the provider's
consent screen, so the browser refused it silently. Reproduced in Chromium
against the full app; the console said "Refused to send form data … form-action
'self'". The policy now names exactly the provider consent screens
(`https://www.etsy.com`, `https://connect.stripe.com`) and nothing else. A test
holds that list to each adapter's own `AUTHORIZE` address, so a later provider
cannot be silently unreachable the same way. **Maturity: `tested`** (3 cases,
2 red before; the browser reproduction now reaches `www.etsy.com/oauth/connect`).
The consent screen itself and the callback remain unwitnessed until the owner
connects his real shop, which also needs the callback address registered at
Etsy.

### Proof 1, continued: the first asset's care and truth (25 September 2026)

Three slices from the integrated plan, each proved red first against a
controlled case and then green. None is an external observation: the Etsy
shop is connected and has been read, but no natural paid order has occurred,
so every sentence below is **`tested`**, not witnessed.

**Slice B: a later order is the asset's (migration 351).** The containment
(migration 350) made a paid order on a settled listing visible and recorded
nothing, because every canonical sale record hangs off an experiment's
exposure. Research across the schema found three constraints that settle the
design:
- no table can hold a charge, fee or fulfilment without an exposure;
- the listing's exposure address is unique, so a second exposure is
  impossible;
- nearly every reader of a test's evidence counts by experiment with no time
  bound.

So order B is recorded on the same exposure (it is the same listing),
flagged `after_settlement`. The database admits that flag only after a real
settlement, keeps a fulfilment on the same side as its payment, and never
lets it move. The readers that say what the test observed exclude it: reached,
purchases, first closure, the genome. The readers that protect a buyer keep
counting it: obligations, refunds, the Workshop's refund-route rule, and the
strings that must never be published. The timeline test runs A read → settle →
B read twice with its fee unpublished → the fee arrives and converges once →
a venue refund requested and recorded twice → absence read. The sealed
prediction, verdict, explanation and the test's counts are byte-identical
throughout. The incident closes on intake, with the rows that replaced it and
a plain statement that the file's availability is Etsy's and not observed
here. The test's own page gains "After the test settled". A post-settlement
order on a retired asset is still refused and raised.

**A latent defect this found.** Etsy's receipts come back shop-wide with no
date filter, and the withdrawn-exposure refusal ran before the dedupe. So
every read after settlement would have filed the test's own earlier orders as
"unrecorded sales after settlement". This became live when the owner's shop
connected. Fixed: an order already on the record converges as it always did.

**Cases 7 and 9: a waiting buyer is not a quiet absence.** A buyer owed
something only the owner can give now makes `only_real_decisions` DOES_NOT_HOLD
instead of "all of them would still be there when you got back". The evidence
says when the duty opened and that no deadline is on record; it does not
invent one. The wind-down reading answers a dispute where it was opened: an
Etsy case on Etsy, a chargeback in Stripe, and always as the owner's. It never
says "the buyer's bank".

**Cases 2 and 8: settlement finishes what it starts, and a failing pass says
so.**
- The answer, the budget's withdrawal and the unknown's answer are now one
  transaction.
- The claim's observation, the grade and the earning are done only if
  missing. The observation is looked for first; the grade and the earning
  already refuse a repeat.
- The hourly work-list now includes answered-but-unfinished world
  settlements.
- `business_outcome_tick` throws when any due test could not settle, as its
  sibling already did.

The tests inject the failure for real, with a trigger that makes one write
fail and is then removed. **Deployment note:** the first pass after this ships
will finish any world settlement production left half-done. A grade may appear
for such a test, computed from the words it sealed; its sealed text is never
touched.

**Cases 3, 4, 5 and 6: one exchange, correctly described.** All four are
**`tested`**.
- **Case 3.** "Paid and received" now means one buyer's exchange: a payment,
  its own fulfilment, and that fulfilment delivered. It used to be two unrelated
  tallies on the exposure, so one person's payment beside somebody else's
  delivery earned the asset.
- **Case 4 (migration 352).** A venue order no longer writes "delivery — what
  they paid for reached them" at the payment's own time. It writes
  `made_available`: the venue's rule makes the file available on payment, and
  nobody here saw it collected. By the owner's decision of 25 September 2026
  ("yes, labelled"), it still completes the exchange for earning. The closure
  sentence says "Etsy makes the file available on payment, and the download
  itself is not observed".
- **Case 5.** "Reached" counts distinct people, by the address each delivered
  offer went to, not delivery receipts. The sealed rule's own sentence still
  counts offers delivered, which is its unit.
- **Case 6.** A surprised result with a purchase no longer says "did not sell".
  The test that pinned that sentence was changed.

**Cases 10, 11 and 12: money and resilience words that match their evidence.**
All three are **`tested`**.
- **Case 10.**
  - An asset's sales are now read over the same thirty days as its cost.
  - A subscription reading is shown beside ledger sales, not stacked on them.
  - A charge whose fee has not been read is said to be before that fee, and can
    no longer produce "earning its keep". A loss still stands, since a missing
    fee only makes it worse.
- **Case 11.** The surplus no longer says "$X is yours to take" of a ledger
  sum. It says the amount of recorded sales not spoken for is "not money seen
  in a bank", because no payout or deposit has been reconciled. It grants
  nothing.
- **Case 12.** Reuse of a proven channel, buyer or industry "might make the
  selling cheaper (inferred from the labels, not measured …; what a buyer
  actually cost to reach would show it)". It also names when a label was itself
  guessed.

**What Proof 1 still owes.** Every case above is controlled. The first real
observation is still external: the Etsy shop is connected and read, but no
natural order has occurred. When one does, it is reported as witnessed only
then. Proofs 2–5 need real buyers, real periods and a second asset; code
cannot supply them.

### A hidden shop is not a quiet market (25 September 2026)

**What happened.** After connecting, the owner found Etsy's notice on ApexMicro:
the shop was in Developer Mode, which "makes your shop's listings not
discoverable via search". Nothing in Foundry could have seen it. The reader
asks Etsy which shop, what is listed and what was paid. It never asks whether a
buyer can find any of it, and Etsy is not known to tell an app. A listing test
in that shop would have closed its window with no sale, and the settlement
would have written "Not as predicted" about a market nobody could reach.

**The repair (migration 353, `findability.ts`).** The fact is asked of the one
person who can see it and held to three things:

- **Readiness.** A listing test gains the condition "buyers can find the shop".
  It waits for him until he has said so, and again whenever he says the shop is
  hidden. It reads as an external-account state, like the listing not being
  live yet.
- **Evidence.** `invalidateByObservation` now also asks `shopHiddenDuring`. A
  silent window that overlaps anything he said was hidden is invalid, with the
  kind that already existed for it (`offer_not_published`: the offer never
  appeared where people could see it). A test with a sale in it is never
  invalidated this way. Nothing said at all is not "hidden", because an absence
  of record is not a record of failure; that is why readiness asks first.
- **Record.** `venue_findability` is append-only. Each row is one thing he
  said, with its time, and `said_by` must be the founder the row belongs to.
  The service refuses anybody but the company's owner. The Etsy page asks the
  question once the shop is confirmed as his, with two answers, and shows what
  he last said.

**Maturity.** **`tested`** (`a-hidden-shop-is-not-a-quiet-market`, 13;
`the-connection-page-is-the-task`, 5 more). The settlement test was proven red
against the previous settlement code, which wrote a verdict.

**Proof debt.**
- The fact rests on the owner's word, because nothing reads it. If Etsy's API
  is found to report Developer Mode or vacation (`is_vacation` exists on the
  shop resource), reading it becomes the stronger evidence, and his word should
  then be checked against it rather than replaced by it.
- ApexMicro is hidden today. Restoration was requested from Etsy on
  25 September 2026 and has not been confirmed. The owner still has to answer
  the question on the Etsy page himself; no statement was written for him.

### Each live asset answers seven questions (25 September 2026)

**Governing requirement.** Integrated plan §5: for each live asset the
institution must answer seven questions:
- who the customer is and what was promised;
- where buyers can actually meet it;
- which provider operations have been shown to work for this account;
- what money was charged, deducted, refunded, paid out and seen in a bank;
- what is owed, by whom and by when;
- what may be done, and what happens if it is interrupted;
- what the owner decides versus what Foundry carries.

**Before.** The answers existed in seven readers keyed by experiment or by
founder, across four pages. Several were silently absent: buyer rights, a due
date, per-asset fees and payouts, and what the account had been shown to do.

**The repair (`operating-contract.ts`, no schema change).**
`operatingContractOf(productId, founderId)` asks the readers that already decide
each fact and marks each answer `known`, `partly` or `unknown`. Where nothing
can answer, it says so in a sentence rather than leaving a blank:
- No buyer licence is recorded.
- No payout is attributable to one asset, and payouts are not read.
- No deadline is on record for a duty.
- Etsy messages are not read.
- An unread venue is not evidence that nobody bought.

Real money only. A rehearsal charge cannot even be written against a real sale;
the database refuses it, and the test asserts the refusal. It is shown on the
company page as a fold, "What it owes and holds", with "N of 7 known". It adds
no record, decides nothing and grants nothing.

**Maturity.** **`tested`** (`each-asset-answers-seven-questions`, 15).

**Proof debt.**
- Every answer is controlled. The first real answer comes when ApexMicro's
  listing is live, the shop is findable, and Etsy has been read for it.
- Question 3 is assessed for Etsy listings only. Workshop and outreach assets
  say it is not assessed yet.
- Question 6's recoverability is assessed only where Foundry holds no write
  access, which makes the answer trivially "nothing to recover".

### An unreadable venue is not a quiet one (25 September 2026)

**Governing requirement.** Integrated plan §9 asks for three degraded conditions
to be rehearsed. This is the first: Etsy becomes unreadable. While it is,
duties continue, "no sales" and "all clear" claims are suppressed, and the
point where a human must look is named.

**Before, reproduced in a test.**
- A 401, 429 or 503 from Etsy, or a dropped connection, threw out of
  `readTheShop`, past the only place that writes a sense's `last_error`, into
  a job loop that logged a warning.
- Readiness kept "what the venue reports can be read" as met on past readings.
- The absence reading looked only at earned companies, so a listing asset
  (still `experimental`) was invisible to it.
- A listing test whose window closed while Etsy was failing settled "Not as
  predicted".

**The repair (no schema change).**
- **Recording.** `bringTheVenueUpToDate` catches a thrown read and writes it to
  the connection as "Etsy could not be read: …", returning a refusal instead of
  a throw. A successful read clears it.
- **Readiness.** The readability condition fails while the sense's last word is
  an error, and says when and why.
- **Settlement.** `settleFromTheWorld` does not conclude a silent window while
  the exposure's venue sense is failing. It waits, and writes nothing, so the
  first pass after recovery settles by the sealed rule as it would have. Events
  that were observed still settle as before.
- **The asset's record.** Question 3 names the failure and the human backstop:
  "check orders and messages on Etsy yourself — nothing here is seeing them".
  Question 4 does not call that silence evidence.
- **Absence.** The truthful property counts a failing venue on any listed
  asset, of any standing, as something quiet for a reason that is not calm.

**Maturity.** **`tested`** (`an-unreadable-venue-is-not-a-quiet-one`, 8:
healthy, 503, network error, readiness, record, absence, settlement withheld,
recovery that clears everything and then settles). Red before the repair on all
seven degraded assertions.

**Proof debt.**
- An outage that outlasts a window leaves the test unsettled for as long as it
  lasts. That is the chosen trade: waiting over concluding. Nothing yet tells
  the owner that a closed window is waiting on a reader.
- Rehearsals B (the model provider unavailable) and C (the owner away while a
  buyer needs a remedy, with new commitments paused) are still owed.
- Not observed against real Etsy failures.

### No new promise while a buyer waits on the owner (26 September 2026)

**Governing requirement.** Integrated plan §9 lists three rehearsals; this
covers the second and third, "the model provider is unavailable" and "the
owner is away while a buyer needs a remedy". Existing care continues, unsafe
new commitments stop first, and no "all clear" is given.

**Before, reproduced in tests.**
- The hand sent five offers to strangers while a buyer was waiting on
  something only the owner could give. `mayWrite` stopped only for his pause, a
  failed placement, a broken instrument path, stop conditions or the fulfilment
  cap, and every offer carries a money-back promise.
- The absence reading's "only real decisions" held with a buyer's refund
  request sitting in the Workshop's mail, because it never read the mail. On a
  day the model is down, a message nobody could interpret is escalated to him,
  and it was invisible to the absence reading.

**The repair.**
- **One reader for both places a wait can be recorded.**
  `buyersWaitingOnHim(founderId)` covers obligations whose `asksHim` is set,
  and Workshop mail routed to him (`needs_owner`, not archived) whose reading
  is `wants_money_back` or `owed_something`. That mail reading is by keyword and
  needs no model, so a refund request is recognised with the model down.
- **The hand holds new offers.** While anyone is waiting, it holds the offers
  and says so in its report ("holding new offers: 1 buyer is waiting on you —
  …"). Deliveries, the refunds Foundry can issue, and the verdict all run as
  before. The hold lifts by itself once the wait is answered.
- **Absence counts it.** A buyer who wrote makes "only real decisions" DOES_NOT
  HOLD, with the same no-deadline wording as an owed obligation.

**Maturity.** **`tested`**. Red before on both:
- the hand sent 5 offers where it now sends 0;
- the absence reading held where it now does not.

The model-down path uses the Workshop's own intake (`hearMail`), whose reading
needs no model.

**Proof debt.**
- There is still no marker distinguishing "escalated because the model was
  down" from "escalated because it was genuinely unclear". Both reach him the
  same way, which is safe but less informative.
- Only Workshop mail is read. Etsy messages are not read at all (stated on
  every listing asset), so a buyer who writes on Etsy is his to see there.
  *Narrowed 4 October 2026 (Roadmap 2027 R14):* Etsy's own "a buyer wrote"
  email, once he forwards it to the Workshop's address, is heard as a buyer
  waiting, with the saved reply that fits. The message itself is still read
  and answered on Etsy, by him.
- Not observed with a real buyer.

### A post is evidence, not an instruction (26 September 2026)

**Governing requirement.** Integrated plan §7: source text from listings,
reviews, messages or web pages is evidence to assess, not authority. The plan
asks for a test of one attempted contamination of a persistent lesson.

**The open path, found by tracing every place untrusted text is stored.**
1. A community post is stored verbatim in `market_observations.saw`.
2. `theRecordOf` hands it to the forge's five lenses and its composer inside a
   `<record>` block built with `JSON.stringify`, which does not escape angle
   brackets. A post containing `</record>` closed the fence, and no shield was
   applied.
3. The composed design's `cannot_prove` is read back by `lessonsFor` as a
   "LESSON OF SETTLED TESTS" into every later deliberation for that founder.

With a model that obeys an unfenced instruction, one post wrote a sentence the
institution would go on teaching itself. Reproduced exactly in the test.

**Other paths were already guarded:**
- `interpretation.ts` shields, abstains, escapes and requires a quoted span.
- `legal-pass.ts` shields and abstains, and requires quoted grounds.
- Workshop correspondence shields, and its decision is deterministic.
- The owner's Ask composes answers from rows, with no model call in the route.

**The repair (`forge-deliberation.ts`).**
- **The fence.** Everything inside `<record>` is escaped (`&`, `<`, `>`), as
  `wrapDataBlock` does, so nothing inside the fence can close it.
- **The shield.** Each post passes through `shieldUntrustedContent` before any
  model sees it. What is stored is unchanged, because the world said what it
  said.

**Maturity.** **`tested`** (`a-post-is-evidence-not-an-instruction`, 3). The test
uses a deliberately obedient model double. On the previous code, the fence broke
and the poisoned sentence reached `lessonsFor`. With the repair, the fence holds,
the instruction arrives redacted, the post's substance still arrives as
evidence, and the lesson is clean.

**Proof debt.**
- The shield is a pattern list and is not complete. The escaping is what
  structurally prevents the fence breaking; a clever instruction written as
  plain prose inside the fence is still only defended by the system prompt's
  data-block instruction.
- Retrievals' `said` text reaches the record through `theRecordOf`'s retrieval
  rows only as terms and counts, and is escaped by the same fence.

### The first screen does not call an unreadable shop healthy (26 September 2026)

**Governing requirement.** Integrated plan §8: the Brief answers condition →
change → decision → evidence, and "a failed reader or overdue buyer remedy
outranks research activity". One of the three journeys the plan names is "a
stale Etsy read with a known buyer remedy".

**Found by rendering that journey.** Home was given a listing, a paid order, a
refund the owner must make on Etsy, and an Etsy connection that had been
failing for three days. It led correctly with the refund ("One thing needs
you"). Its Health reading said **"Healthy — nothing to watch yet"**. `healthOf`
read loops, blocked passes, the Workshop's channels and the day's undone work,
and nothing about a failing venue reader on a listing asset.

**The repair (`founder/health.ts`).**
- A failing sense on any listed real asset, of any standing, is the day's
  undone work, said first: "Etsy could not be read since YYYY-MM-DD — check its
  orders and messages on Etsy yourself".
- The estate reads "degraded", the count includes it, and it does not claim to
  have last been right today.
- It clears when a read succeeds.

**Maturity.** **`tested`** (`an-unreadable-venue-is-not-a-quiet-one`, +1: the
health reading and Home's own HTML). Red before: the state was `ok`.

**Proof debt.** The journey was rendered as HTML through the owner's real
route, not measured in a phone browser; the 390px browser suite still covers
the other journeys. The other two named journeys have not been built here:
- a quiet return after a week (partly covered by "back after a day away");
- a new direction followed by a binding Controls change.

### A failed change keeps the old rule (26 September 2026)

**Governing requirement.** Integrated plan §8, Controls: "Preview a changed rule
and confirm the durable effective value. An insert failure must retain the prior
enforceable rule."

**Before, reproduced.** Every standing rule the owner changes was replaced in
two statements: retire the live one, then write the new one. When the write was
refused, the retirement had already happened, and he was left with no rule at
all. Four cases were each shown in a test:
- a boundary with no words: "ask me before contacting anyone" was gone, and
  nothing stood in its place;
- a budget of nothing: the $40 ceiling was withdrawn, and none replaced it;
- a direction with nothing in it: the live direction was retired;
- a charter the row refused: the signed charter was ended.

A stricter rule failing to save must never become a looser one than before.

**The repair.** `setBoundary`, `setAllowance` and `setObjective` in
`standing-intent.ts`, and `signCharter`, each run the retirement and the write as
one transaction (`batch`). Either both happen or neither does. `setPolicy` in the
ledger was already safe: it writes the new policy before superseding the old.

**Maturity.** **`tested`** (`a-failed-change-keeps-the-old-rule`, 6). Red before
on all four; 22 files that set rules still pass.

**Proof debt.** The read-back after a successful change is shown on the pages
that make it, but "preview a changed rule before it binds" is not built. A change
binds when he submits it, as it did before.

### The decision record the plan asks for already exists, and is not duplicated (26 September 2026)

**Governing requirement.** Integrated plan §7: for a consequential new
allocation, keep a compact decision record, and "never fill in the unchosen
alternative's result". The record holds:
- the options;
- source-backed observations and their freshness;
- the binding limit;
- the expected result as a range or scenarios;
- the rejected alternative;
- the stopping rule;
- what would reverse the choice.

**Finding, from reading the schema (no code changed).** Each part is already a
row of the sealed test design:

| The plan asks for | Where it already lives |
|---|---|
| Options | `probe_designs.exchange`, with the exchanges not chosen in `probe_alternatives` |
| Expected result | `what_we_expect`, with scenarios in `probe_interpretations` |
| What would reverse it | `would_disprove` |
| Stopping rule | `probe_stop_conditions` |
| Binding limit | the allowance, and the charter carve |
| Evidence with dates | the forge's point-in-time record (Wave 3) |

A rejected alternative has only `not_chosen_because`: there is no column in
which a result could be written for it. Nothing can be added once the design is
sealed. The plan's "prefer simpler equivalent architecture" is honoured by not
building a second record.

**Proof debt.** "Freshness" of each observation is its `observed_at`, shown
beside it. No rule refuses a seal on evidence older than some age; none has
been asked for.

### The three journeys the plan names, walked (26 September 2026)

**Governing requirement.** Integrated plan §8 asks for three journeys:
- a quiet return after a week;
- a stale Etsy read with a known buyer remedy;
- a new direction followed by a binding Controls change.

"A shorter page that yields a wrong answer fails."

**Walked** (`the-three-journeys-the-plan-names`, 4) through the owner's real
routes. The first two were read from the first viewport of a 390px browser.

1. **Quiet week: found a wrong answer.** Home's Health read "Healthy · 1 company
   watched" for a company with nothing connected to it. "Watched" counted the
   companies he owns, not the ones anything could see, while the absence reading
   called the same company blind. Fixed: watched now means a connected sense
   whose last word was not an error. The cell says "nothing connected can see
   your company", or "N of M companies watched".
2. **Stale Etsy with a refund owed.** Leads with "One thing needs you" and the
   exact refund to make on Etsy, and says "Etsy could not be read since …". It
   never says Healthy. No horizontal scroll at 390px. The Health half of this
   was the repair shipped earlier today.
3. **Direction, then a spending limit.**
   - A spoken direction is shown before it binds, binds only on confirm, and
     grants no money.
   - A spending limit then binds on confirm, reads back on the company page
     ("Up to $30"), and leaves the direction as it was.
   - The preview the plan asks for already existed: the confirm step re-reads
     his sentence and refuses if the reading has moved since he was shown it.

**Maturity.** **`tested`** in a browser and through routes. Not yet walked by
him, on his phone, signed in; that is the plan's own final proof and it is his.

### Settings shorter; no door into a wall (26 September 2026)

**Settings (task S2).** Measured at 390px through the real route: 3,739px
before, 2,955px after (−21%). No control was removed.
- Products is one row and a door to Portfolio, where the per-product list
  already lives.
- The two sections that moved elsewhere (who customers hear from, the Etsy
  application key) are one short "Moved to where they belong" panel with state
  and door. The pinned phrases are kept.
- The explanatory paragraphs for the metric URL, reporting systems and API keys
  fold under the rare act they explain. What stands (the credentials and keys
  that exist) stays in view.
- The section index names only sections that exist.

**No door leads to an address nobody serves.** `/dashboard` is not mounted,
and production answers it 404. Thirteen places still sent the owner there:
- the redirect when no company is selected, on six Connections and Letter
  routes;
- two notification buttons ("View Signal", "See the week");
- the page a member sees when their access does not include something.

All now go to Home. A source test
(`no-door-leads-to-an-address-nobody-serves`) keeps it so, and was red before.

**Brief hierarchy (task "say each fact once"), reviewed, not changed.** The
remaining repeats on Home are either different facts or doors:
- The local Decisions count is the Decisions page's own list. "Needs you" also
  counts buyer duties.
- The obligation card's "N more buyers" points to where each is listed.
- The Health detail's "watched" count was the one real overclaim, fixed earlier
  today.

The existing `the-brief-says-each-thing-once` gate still holds.

**Eventide wave 3, found nearly done.** Every owner GET renders through the
shell. What does not is the 403 guard page, the auth pages and the error page
for non-owner paths; the guard page's dead link is now fixed. The auth pages sit
before a session exists and are deliberately plain.

### A message the reader could not read says so (26 September 2026)

Closes the proof debt left by "No new promise while a buyer waits on the owner".
When the model that interprets Workshop mail could not be reached, or answered
with nothing the schema accepts, the message still went to the owner — safe.
But it went with the same reason as a message nobody could make sense of, so a
day the reader was down read as a day strangers turned vague.

`interpret` now marks the reading `unread`, and the model can never set it.
Only the function sets it, and only on those two paths:
- `unreachable`: the model call failed;
- `unusable`: its answer failed the schema.

`decide` gives him the true reason:
- "the model that reads messages could not be reached, so nothing here was read
  — it is yours to read, and nothing was guessed";
- or "… answered with nothing usable …".

A reading the model did make carries no mark.

**Maturity.** **`tested`** (`the-workshop-answers-for-itself`, +1). Red before:
there was no such field. The 19 files that read Workshop mail still pass.

### The shelves can say "a workbook" (27 September 2026)

The owner shared a promotional list, *20 Digital Products That Sell in 2026*.
Its figures are the seller's own and are not evidence; ECONOMICS.md grades it D
and repeats none of them. What it did show was a gap in the words: the one
real test on Etsy is a workbook, and no economic form could name a download.
A bid-decision workbook read as "other".

Five forms are added before the software forms, each with `upfront_price` as
its only exchange (the exchange a listing runs):
- `template_pack`: Notion, Canva and spreadsheet templates, SOPs, swipe files,
  email sequences, content calendars;
- `guide`: workbooks, ebooks, guides, cheatsheets, playbooks, checklists;
- `printable`: planners, trackers, journals, worksheets;
- `course`: short courses and lessons;
- `asset_pack`: icons, fonts, UI kits, illustrations.

A form recognises and presents; it never causes a candidate to exist. Every
form that was already right still wins its own words: "a free calculator" is a
free resource, "a bid calculator" a calculator, "a subscription dashboard"
software.

**Maturity.** **`tested`** (`economic-forms-name-the-four-questions`, +4). Red
before: the workbook read as `other`. The shelf tests still pass. **Proof
debt:** whether a download shelf sells is exactly what the Etsy test exists to
find out. Nothing here says it does.

### Etsy says when the shop is on vacation, and that is read (27 September 2026)

Pays part of the proof debt in "A hidden shop is not a quiet market". Etsy's
shop resource carries `is_vacation`, and a shop on vacation takes no orders.
The reader fetched that resource on every read and dropped the field.

Now each read keeps what Etsy said, in `venue_visibility_readings`
(migration 354). Only a change is a new row, and nothing rewrites one. A field
Etsy did not send is no reading at all, never "open". A vacation Etsy reports:
- stops a listing test being ready, whatever the owner last said, with the
  reason naming Etsy as the one saying it;
- voids a silent window it overlapped;
- is shown on the connection page above his own answer.

When Etsy reports the vacation over, his word decides again. Developer Mode,
which is what actually hid ApexMicro, is still not reported to apps. His word
stays the only witness of it, and a reading of "open" never overrides his
"hidden".

**Maturity.** **`tested`** (`etsy-says-when-the-shop-is-on-vacation`, 8;
`the-connection-page-is-the-task`, +1). Both were red first. **Proof debt:**
the field's presence and meaning on the real ApexMicro shop are unobserved.
That the Etsy v3 shop resource includes `is_vacation` is documented, but not
yet seen in a real read here.

### The shop is read the moment he says it is back, and a waiting test says what it waits on (27 September 2026)

Two gaps around the moment ApexMicro returns to search.

**Read at once.** When the owner taps "Buyers can find it again", the shop was
not read until the next scheduled pass, so the page he was looking at had not
checked. Now the same read runs straight away, over the same two work lists,
for his tests only. It is read-only and publishes nothing. The page says either
"Read Etsy just now" or "Could not read Etsy just now", with Etsy's own error
and who has to look in the meantime. A failure is kept against the connection,
exactly as on a scheduled pass.

**Waiting, said as waiting.** A test whose window closed while Etsy could not
be read is correctly left unsettled. The Brief used to count it among tests
that "have not been settled", which reads as the institution's own lapse. Now
it says "1 test's window has closed and it waits on Etsy, which could not be
read since DATE — nothing is concluded from its silence until it reads again".
A test that is overdue for any other reason is still counted as before.

**Maturity.** **`tested`** (`an-unreadable-venue-is-not-a-quiet-one`, +3,
red first). **Proof debt:** the read-on-restore has not run against the real
shop. Its first real run is the owner's tap when Etsy confirms the restore.

### Etsy says when it must be connected again, before it happens (27 September 2026)

Roadmap B4. **What was already right:**
- The hour-long access token is renewed every hour (`sense_credential_tick`,
  at :25).
- A failed renewal writes `last_error` against the connection, so the shop
  reads as unreadable and the Brief says so.
- `the-life-of-a-credential` proves this.

**What was missing** was the refresh token's own life. Etsy gives it ninety
days. If Etsy hands back a fresh one on each renewal, the connection lives as
long as it is used. If it does not, the connection ends on a date fixed at the
moment he connected, and the first sign would have been the shop going dark.

`sense_credentials.refresh_expires_at` (migration 355) records that date. It is
set at the grant, moved only when Etsy actually hands back a *different*
refresh token, and kept when Etsy hands back the same one or none. Nothing
assumes which of the two Etsy does. Fourteen days before the date, the Brief
says "Etsy's permission to read ApexMicro ends on DATE — connect it again
before then, from Connectors, or it goes dark". A connection he has ended says
nothing.

**Maturity.** **`tested`** (`etsy-says-when-it-must-be-connected-again`, 7, red
first). **Proof debt:** whether Etsy rotates the refresh token is unobserved.
The first real renewal after he connects will show it, and the date follows
whatever it shows. A connection made before this change has no date recorded
until Etsy next rotates the token. If Etsy never rotates, that connection
shows no warning and still ends. Reconnecting once records the date.

### The two remaining rehearsals: the model down, and the owner away (27 September 2026)

Integrated plan §9 names three degraded conditions. Etsy unreadable was
rehearsed on 26 September. These are the other two. Both are timelines built
from pieces that were already proved one at a time. Neither needed a code
change. Each was checked against a seeded fault it had to catch.

**B: the model provider unavailable** (`when-the-model-is-down`, 5). With every
model call failing:
- deliberation throws, leaving no design, no lens findings and no decision;
- the design loop records itself failing, and the Brief reads "degraded", with
  "designing and attacking tests … failed 2 times running";
- a listing with a sale still settles by its sealed rule;
- a buyer waiting on the owner is still named.

When the model answers again, the next pass designs the test and the loop
clears. Seeded fault: a `recordJobFailure` that records nothing. The test went
red.

**C: the owner away while a buyer waits** (`the-owner-away-while-a-buyer-waits`,
8). A buyer asks for a refund on Etsy the day he leaves:
- on days 1, 7 and 30 the buyer is still named to him, with the order and
  where to act;
- the absence reading never says all clear;
- no deadline is invented;
- the wait ends only when the refund is actually recorded.

Holding new offers meanwhile is `the-first-real-experiment-runs-by-hand`.
Seeded fault: a waiting-buyer reader that drops buyers after five days. The
test went red.

**Maturity.** **`tested`**, as rehearsals, not repairs. **Proof debt:**
controlled only. No real outage or real absence has been observed. Workshop
mail during an outage is covered by `the-workshop-answers-for-itself`, not by
this timeline.

### The check costs a third of what it did (27 September 2026)

Roadmap G6. Every slice waits on `npm run check`, which took about twenty
minutes. Of the 868 seconds of test time, 365 were a single file,
`gates-fail-when-they-should`. Since 21 September it plants its defects into a
throwaway copy of the tree, so the reason it shared one serial queue with
everything else was already gone.

`npm run test:ci` is now `scripts/run-suite.mjs`, in two phases:
1. Three processes run at once: the gates file, and every other file in two
   `--shard`s. Each process is still serial inside.
2. The four files that briefly write into the real tree then run alone. They
   are listed in `scripts/suite-plan.mjs`.

The script fails if any process fails, and it calls vitest with no shell in
between.

**Measured:**
- serial: 1157 s;
- the gates file beside one other process: 783 s;
- beside two shards: 441 s.

Every run had the same 655 files and 5790 tests. The whole check, including
typecheck and lints, dropped from about 22 minutes to 630 s (10.5 minutes)
wall time on its first real run.

**Guarded.** `the-suite-runs-in-parallel-safely` fails when a test writes a
file without making a temporary directory first, unless it is listed. It was
red when a listed file was removed. The runner is itself a gate chained into
the check, so `gates-fail-when-they-should` plants a failing test and asserts
the runner exits 1 (and 0 for a passing one). The runner is narrowed to that
one file by `FOUNDRY_SUITE_ONLY` and goes through the same verdict. `npm run
test:serial` keeps the old single queue.

**Maturity.** **`measured`**. **Proof debt:** the "writes into the real tree"
check is a heuristic: `writeFileSync` without `mkdtempSync`. A test that
writes some other way, or through a helper, would not be caught. Shards are
split by file, not by time, so a slow file added to one shard lengthens it.

### What each product type takes, as far as anyone has shown it (27 September 2026)

Roadmap D1, and plan §6's "economic-forms library as decision knowledge". The
owner prompted it with a vendor's list of digital products. The list stays
grade D and contributes no facts.

`src/services/venture/form-knowledge.ts` holds sourced facts per form in six
aspects: buyers, pricing, rights, channels, burden and exit. Each fact carries
a source, the day it was read and a grade. Grade D is refused. Nothing
unsourced is written down, so an aspect with no fact is returned as unknown.
`whatAFormTakes` also says what could serve a test of the form today, read
live:
- whether Foundry can take the payment it needs;
- for downloads, whether an Etsy shop he has confirmed is connected, and that
  the connection is read-only.

It is read in two places, and causes nothing in either:
- **On the Explore page**, "What this kind of thing takes" appears only on a
  shelf that already has a candidate.
- **In the design deliberation's record**, the same content sits inside the
  escaped fence, labelled as not evidence of demand.

The facts are Etsy's own pages from 15 September for the download forms, and
the 21 September ECONOMICS rows where they apply. Every other aspect is
unknown, including who buys a workbook.

**Maturity.** **`tested`**:
- `a-form-is-known-only-as-far-as-it-is-sourced`, 9: red first. A planted
  grade-D demand claim turned it red.
- `the-shelves-are-evidence-not-ideation`, +2: red without the change.
- `a-post-is-evidence-not-an-instruction`, +2 assertions.
- `the-owner-surface-fits-a-phone`, +1.

**Proof debt:**
- Platform rules change. Each fact carries its read date, and nothing re-reads
  it: Etsy refuses automated fetches (HTTP 403), so re-reading is by hand.
- None of this is market evidence. That remains Experiment 001's null and
  whatever the Etsy listing yields.
- The demand guard is a word pattern. A demand claim in other words would
  pass it.

### The listing Etsy shows is the offer that was sealed, or the test says not (27 September 2026)

Roadmap B2. A listing test seals a prediction about one offer at one price,
and the owner places the listing by hand. Nothing checked that what Etsy then
shows is that offer. A workbook listed at $19 instead of $14, or a listing that
expired out of the shop, tests something else or nothing, and a silent window
would still have been read as the market's answer.

Each read now keeps what Etsy shows for the test's own listing in
`venue_listing_readings` (migration 356): whether it is among the shop's
active listings, and at what price. Only a change is a new row, and nothing
rewrites one. "Not shown" is written only from a read that reached every
listing Etsy said it had. A truncated read concludes nothing.

Readiness gains "the listing Etsy shows is the offer that was sealed":
- **met** when Etsy shows the listing active at the sealed price;
- **waits on the owner** when Etsy shows a different price (naming both) or no
  longer shows the listing, with what to do in each case.

It is said only once Etsy has been read for the listing. Before that, "can be
read" is the open condition.

**Maturity.** **`tested`** (`the-listing-etsy-shows-is-the-offer-sealed`, 8,
red first). **Proof debt:**
- Not observed against the real listing.
- The title is not compared: he may word the listing differently from the
  sealed offer, and a wording is not a different offer. The file is not
  checked either; that is roadmap B3.
- A price change during a running window is recorded but does not yet void
  the window's silence the way a hidden shop does. That is the next piece of
  this seam.

### The file on the listing is the one Foundry built (28 September 2026)

Roadmap B3. A download listing delivers whatever file the owner uploaded by
hand. The wrong file, an older version, or none would mean a buyer pays and
gets the wrong thing or nothing, and the test measures a different product.

Each read of a test's listing now also asks Etsy for its files:
`getAllListingFiles`, which is covered by the `listings_r` scope already
granted. Name and size are kept in `venue_listing_readings.files_json`
(migration 357) as part of the same change log:
- a new row only when the files change;
- nothing rewrites a row;
- a refused or failed file read is "not read", and never the same as "no
  file".

The file Foundry built is taken from the experiment's own deliverable line,
`File: NAME (N bytes, …)`, which only the institution writes.

Readiness gains "the file on the listing is the one Foundry built", stated
once the files have been read:
- **met** when a file of the built size is attached;
- **waits on the owner** when no file is attached ("a buyer would pay and get
  nothing") or the file is a different size (naming both).

**Checked against Etsy's own specification (28 September 2026).** Etsy's
published OpenAPI 3.0.0 document was read directly. It confirms the fields
three slices rely on:
- `Shop.is_vacation` (A1);
- `ShopListing.price` as Money (B2);
- `getListingsByShop` defaulting to active listings (B2's "not among active
  listings").

This moves those from assumed to documented. They are still not observed on
the real shop. One caveat it adds: for a listing with variations, `price` is
the minimum, so a varied listing's price check compares against its cheapest
option.

**Maturity.** **`tested`** (`the-listing-etsy-shows-is-the-offer-sealed`, +6,
red first). **Proof debt:**
- The API gives no hash, so a file of the same size with different contents
  passes.
- A wrong file does not void a window's verdict. It is a care failure for a
  buyer and a readiness failure, not a demand verdict.
- Not observed on the real listing.

### Every loop the Brief watches says when its work failed (28 September 2026)

Roadmap G3. This extends Gate 1's case 8, where a job whose every settlement
failed was recorded as a healthy pass, to all nine loops in
`INSTITUTION_LOOPS`. Six already told the truth:
- the forge and the sense check throw;
- settlement and the hand throw after finishing the pass;
- reconciliation and judgment record each company's failure.

Three caught each subject's failure, logged it and returned normally, so the
scheduler recorded success and the Brief called the day healthy:
- `venture_discovery_tick`: a search that could not run;
- `real_market_evidence_tick`: a claim that could not be looked at;
- `public_workshop_tick`: a page that could not be republished, a reply-route
  check that could not run, and, the one that matters most, opt-outs that
  could not be kept. Those were a count in a log line. An opt-out is a promise
  to stop writing to somebody.

Each now finishes the pass for every other subject, then throws with what
failed. `job_health` records it, and the Brief names the loop. A pass with
nothing wrong still resolves.

**Maturity.** **`tested`** (`every-watched-loop-says-when-it-failed`, 6). Red
first: four of the five failure cases resolved as healthy. **Proof debt:** a
source that is down for one claim now marks the whole evidence loop failing
for that pass. That is honest, but it may be noisy. The Brief names a loop only
after consecutive failures, which is the existing damping.

### The reserve question comes back at the tenth settled sale (28 September 2026)

Roadmap C6. PENDING 26 recommended holding all of the refund promise in cash
"until there is something to measure", and revisiting it at the first ten
settled sales. Nothing brought it back.

The reserve's own sentence (`distributableSurplus().refundReserve.because`)
now adds, once ten sales have settled, how many there are, how many were
refunded, and that the choice is his. A settled sale is a fulfilment delivered
or refunded, the same rows the exposure counts. The reserve stays all of it,
and the buyer's promise is not touched.

**Maturity.** **`tested`** (`the-reserve-question-returns-at-ten-sales`, 2, red
first). **Proof debt:** the sentence appears where the reserve is shown, the
money page. It is not a Brief item, because at ten sales it is a question worth
reading, not a duty that is due.

B6 (an unread fee is unknown, never zero) was found already done. The reader
keeps `feeCents: null`, and no fee event is written for it (P1-F, case 10).

### What Etsy last showed, in one place (28 September 2026)

Roadmap B1. The venue checks built in the last three slices, and the ones
before them, were each visible only on a test's own readiness list:
- the shop can be found, by his word or Etsy's vacation flag;
- Etsy can be read;
- the listing is the sealed offer;
- the file is the one built.

The connection page, where he will be when he taps "Buyers can find it again",
showed none of them.

`whatTheVenueLastShowed(founder, provider)` gathers, for every listing test
on the reader's own work list, the readiness conditions that are about the
venue. It reports each one word for word as readiness says it, so the two
pages cannot disagree. It also reports when the permission to read ends. The
connection page shows these as "What Etsy last showed" once the shop is
confirmed as his.

**Maturity.** **`tested`** (`the-listing-etsy-shows-is-the-offer-sealed`, +2,
red first). **Proof debt:** the panel is only as current as the last read.
Each line carries the date its reading was taken. It refreshes on the hourly
read, or at once when he taps "Buyers can find it again". There is no
general read-now control.

A5 (preview a Controls change before it binds) was found largely done:
- a company's authority move and the typed "say it" route both preview and
  confirm;
- the charter page recomputes the ceiling ("Recalculate the ceiling") and
  shows the full charter text before signing.

What binds on one tap is renewing the charter as it stands, with no numbers
changed.

### A lesson knows which later designs read it (28 September 2026)

Roadmap E2, integrated plan §7: "A lesson keeps its source, context, contrary
evidence, expiry or invalidator, and past decisions that used it." Lessons
already carried their source (the settled test) and their invalidator (that
test's own outcome: invalid, superseded or retired). What nothing kept was
the other direction: which later designs had the lesson in front of them. A
lesson that turned out wrong could not say what it had already influenced.

The deliberation record's lessons now carry the test each came from. When a
design is composed, one row per lesson it carried is written to `lessons_read`
(migration 358). A design never reads itself, and nothing rewrites a row. A
test's page gains "Read by N later designs", with each design linked, and
reads: "If this test's outcome changes, these are what it already
influenced."

**Maturity.** **`tested`** (`a-lesson-knows-who-read-it`, 3, red first).
**Proof debt:**
- A lesson has no expiry. None has been asked for, and no evidence says how
  long a lesson stays true.
- "Read" means it was in the record, not that the design relied on it. The
  design's own words are where reliance shows.
- Nothing yet alerts the later designs when an earlier lesson is invalidated.
  The link now exists for that to be built on.

### A design says when a lesson it read has since stopped standing (28 September 2026)

This closes the proof debt E2 left. `lessonsThatChanged(design)` returns the
lessons a design read whose test was invalidated or retired after the design
read it, or has been superseded. The design's page then opens with "This
design read a lesson that has since changed", naming each lesson and what
happened to it. It adds: "Whether that matters here is yours to judge;
nothing has been changed." A lesson that changed before the design read it
was read as it then stood, and is not news to that design.

**Maturity.** **`tested`** (`a-lesson-knows-who-read-it`, +2, red first).
**Proof debt:**
- Supersession carries no date, so a superseded lesson is flagged whenever it
  was superseded.
- The notice is on the design's own page, not the Brief. A changed lesson is
  something to read when he looks at that test, not a duty due today.

### A past qualification is not inherited by another shop or a new grant (28 September 2026)

Roadmap G4. Three things readiness rested on outlived the connection that
produced them:

- **His word that buyers can find the shop** was kept per company and venue.
  An answer about ApexMicro would have counted for a different Etsy shop
  connected later. Each answer now records the shop confirmed as his when he
  gave it (migration 359, `venue_findability.account_ref`). `findabilityOf`
  reads only answers about the shop connected now, so connecting another shop
  asks again. Answers that named no shop, including every one given before
  this change, still count as they did. A "hidden" answer still voids an
  overlapping window whichever shop it named: it only ever refuses a
  conclusion.
- **What Etsy showed for the listing, and the files on it.** Readiness now
  reads only readings taken since the current credential was granted
  (`connectionSince`). Every grant, whether for another shop or for other
  permissions, is a new credential. The first read after a grant is always
  written, even when it sees exactly what the last connection saw.
- **"What the venue reports can be read"** passed on any past reading. It now
  also needs the connection to have been read since it was granted, and says
  "connected again on DATE and has not been read through that connection yet"
  until then.

**Maturity.** **`tested`** (`a-hidden-shop-is-not-a-quiet-market` +1,
`the-listing-etsy-shows-is-the-offer-sealed` +2, red first).
**Proof debt:**
- A token refresh is not a new grant and does not reset anything; only a new
  authorisation does.
- The vacation reading is not scoped. It only refuses, and the next read of
  the new shop replaces it, but until then it names the old shop.
- Never exercised against a real second shop.

### Each day's copy is restored the day it is made (28 September 2026)

Roadmap G5. The daily copy (`copyTheInstitution`) and a verifying restore
(`restoreTheInstitution`) already existed, but nothing called the restore. So
"backups are real; restore is unproven" stayed true every day.

- **Daily.** `keep_a_copy_of_everything` now restores the copy it has just
  written, beside the backups and never over the live database, and reads it.
  The job fails, so job health and the Brief name it, when the copy does not
  open, holds nobody, or cannot answer one of the recovery questions (what
  buyers are owed, money taken and returned, what may be spent, live assets,
  who must never be written to…). A difference from the live database is
  logged, not failed: anything written since the copy was taken is one.
- **By hand.** `node dist/cli/index.js rehearse-restore [copy]`, run inside
  `fly ssh console`, does the same for the newest copy or one he names. It
  prints what came back beside what is true now, and exits 1 when the copy
  would not serve a recovery. It is his to run; I do not read production.
- Nothing is left behind: the scratch restore is removed whatever happened.

**Maturity.** **`tested`** (`a-copy-is-restored-the-day-it-is-made`, 6, red
first), and the CLI was run end to end against a file database: a good copy
exits 0, and a corrupt one exits 1 with "file is not a database".
**Proof debt:**
- Never run on production. The first nightly run after this deploy is the
  first evidence there.
- Every copy is still on the same volume as the database. The volume's own
  snapshots (five days) are the only defence against losing the volume, and
  this cannot read them.
- It proves that a copy opens and holds the liabilities. A full recovery
  (stop the app, swap the file, start again) has never been rehearsed.

### The owner's own minutes on a test (28 September 2026)

Roadmap D6. Proof 3 asks what a findable listing cost the owner in his own
time, and nothing recorded it. A listing test's page now has "Your time on
this": he enters the minutes he spent on a day already lived, with an optional
note on what they went on. The page gives the total and the number of days,
and says that a day without an entry is unknown, not zero. Before anything is
entered it says so, never "0 minutes".

- Kept as entered (migration 360, `owner_minutes`). A mistaken entry is
  withdrawn once, stops counting, and stays on record.
- Only the person whose test it is can enter time on it. The service checks
  this, and so does a table trigger, so no caller can write an entry for
  somebody else's test.
- Refused: a future day, a non-date, and minutes that are not a whole number
  from 1 to 1440.
- Nothing is inferred from activity. A page he opened is not a minute he
  spent.
- Erasure: FOUNDER_SCOPED, deleted with his account.

**Maturity.** **`tested`** (`his-minutes-are-his-to-enter`, 7, red first).
**Proof debt:**
- Never used by the owner. Proof 3's figure is only as complete as his
  entries, and the page says so.
- Only on listing tests' pages. Time spent on the institution itself, outside
  any test, has nowhere to go yet.
- Proof 3's report does not read it yet, because that report does not exist
  until there are 30 findable days.

### The prompt shield, measured (28 September 2026)

Roadmap A9. `prompt-shield.ts` removes instruction-shaped text from what
Foundry reads before a model sees it. It was a list of known shapes, never
counted against the way instructions actually arrive: as plain prose inside a
scraped page, a review or a buyer's email.

**Measured.** A corpus of 24 prose attacks and 20 honest sentences from the
same world (`tests/fixtures/prompt-shield-corpus.ts`), written before any
pattern changed:

- **Before:** 1 of 24 attacks caught; 1 of 20 honest sentences flagged.
- **A broad first repair:** 21 of 24 caught. But on 15 honest sentences
  written afterwards it flagged 9. A false positive is not free here:
  `legal-pass` and `interpretation` do not read a record that triggers, so a
  flagged honest sentence is evidence silently unread.
- **After pruning:** every shape that flagged an honest sentence was dropped,
  or narrowed on a stated principle (for example, "your instructions" rather
  than "the instructions"). The result is **14 of 24 caught** and 0 of those
  15 flagged.
- **Real prose:** 0 of 6,476 paragraphs from 365 package READMEs, text nobody
  wrote against the shield. The original shapes also flagged 0.
- **Aimed collisions:** 15 honest sentences written knowing the shapes, one
  aimed at each. 13 were flagged. This shows every shape *can* collide; it
  does not say how often.

`the-shield-is-measured-not-assumed` asserts this record. Each attack is caught
or a named known miss with its reason, and each honest sentence passes or is a
named false positive. A change that moves any sample fails until the record is
updated.

**The ten misses are left on purpose.** Each is either something no pattern
can catch (spaced-out letters, a payment request) or something whose only
catching shape flagged honest text. None matters on its own: no text Foundry
reads can grant authority, spend, publish or move money. Those are gated on
the owner's own acts. The shield only makes an attempt visible.

**Maturity.** **`tested`** (75 cases; red without the change).
**Proof debt:**
- No natural corpus from this domain: no real buyer mail, no contractor
  forums. The README prose is real, but technical.
- The pre-existing "from now on, you will…" shape still flags an honest
  sentence about invoices. It was left as it was and is recorded.
- A regular expression cannot tell an instruction from a description of one.
  The durable defence is the data-block framing (`sanitize.ts`) and the gates,
  not this list.

### An outreach asset answers the seven questions too (28 September 2026)

Roadmap A6 and A7. The seven answers (`operating-contract.ts`) were written for
a listing on a venue. For an asset that writes to people and takes payment by
link, two of them said nothing true:

- **"What has the account been shown to do?"** answered "not assessed here".
  It now says three things, each from the reader that decides it: whether
  sending is set up, and whether the provider has accepted mail from it
  (`sendingReadiness`); whether payment has come through, a link is recorded,
  or no way to pay exists; and, when the last pass was not clean, what it was
  attempting and why it stopped (`runStateOf`). It is `known` only when
  sending has been accepted, payment has come through, and the last pass was
  clean.
- **"What if it is interrupted?"** answered "not assessed here yet". It now
  says what Foundry does for the asset (write approved offers, deliver what
  was bought, issue a refund it owes) and how each act is recovered: a failed
  offer is kept and goes out once, so nobody is written to twice; a failed
  delivery means a refund is owed; a refused refund stays owed and is issued
  once. It then says what is waiting now. It is `partly`, and says why: those
  rules were shown in the laboratory's month of a portfolio (simulation 10,
  days 2–6), not yet on a real interruption.

**Maturity.** **`tested`** (`an-outreach-asset-answers-too`, 2, red first;
the listing answers are unchanged, held by their own tests).
**Proof debt:**
- No real interruption has happened to an outreach asset.
- A payment counted here is a real charge recorded by the webhook. A payout,
  and the bank, stay unread, as question 4 already says.

### When Etsy asks Foundry to wait (28 September 2026)

Roadmap B5. A 429 is Etsy saying "not so often". It was handled exactly like a
broken connection ("Etsy could not be read: Etsy answered 429"), and every
later pass asked again at once.

- The reader raises a typed `EtsyAskedToWait` carrying Etsy's own
  `Retry-After`, in seconds or as a date. It waits a minute when Etsy gives
  none, and never more than a day, whatever it says.
- The wait is kept (migration 361, `company_senses.read_not_before`). Until it
  passes, no read is attempted and nothing is written.
- The owner reads "Etsy asked Foundry to wait until HH:MM UTC before reading
  again (too many requests), so it has not been read; nothing is concluded
  from its silence meanwhile."
- **The silence is still not evidence.** The read is still recorded as failed
  (`last_error`), so readiness says "cannot be read" and settlement waits,
  exactly as for any other failed read. That is deliberate: settlement's
  refusal to conclude rests on that column.
- A good read clears both the wait and the error.

**Maturity.** **`tested`** (`etsy-asks-foundry-to-wait`, 4, red first).
**Proof debt:**
- Etsy's real rate-limit responses have not been seen. The header's name and
  format are the HTTP standard's, not observed from Etsy.
- Only the shop reader backs off. The identity probe and token refresh do not
  share the wait.

### Ask answers the five questions, and agrees with the screens (28 September 2026)

Roadmap F4, and preparation for F1. The comprehension test the owner is to
take on his phone asks five questions. Typed into Ask on 28 September, before
this change:

| Question | Read as | Answer |
|---|---|---|
| What is owed? | nothing | "I don't know yet" |
| What reached the bank? | nothing | "I don't know yet" |
| What may Foundry spend? | what is allowed | correct |
| What is Foundry doing? | how a company is doing | the wrong question |
| What must I do? | nothing | "I don't know yet" |
| How much can you spend? | a company's metrics | the wrong question |

Now:

- **"What is owed?"** is answered from `obligationsFor`, the reader behind the
  money page's "Owed to buyers", in the same sentences. It adds the Etsy
  caveat (messages there are not read here) when an Etsy listing is live.
- **"What reached the bank?"** is answered from `moneyBanked`: not known, for
  the page's own reason. The held figure sits beside it with the page's label,
  "In Stripe, ours … not a bank balance". A sale is not a deposit.
- **"What must I do?"** goes to the existing "what you need to do" answer.
  **"What is Foundry doing?"** goes to "what I am working on". **"How much
  can you spend?"** goes to the charter answer.

`ask-answers-the-five-questions` fails if Ask and the money page disagree:
every obligation sentence and the bank reason must appear in both, as must
the held figure. It reads only Ask's answer block, because the first screen
carries every figure anyway.

**Maturity.** **`tested`** (12, red first; the 28 files that touch Ask's
classifier still pass).
**Proof debt:**
- F1 itself, the owner taking the test on his phone, is still his to do.
- A regular-expression classifier. Wording outside what has been tried may
  still land on "I don't know yet", which is at least honest.

### Each sale names who took its fee, and what its margin leaves out (28 September 2026)

Roadmap D4. The money page listed every sale as "Stripe took …", with the gross
line "before Stripe took anything" and the tile "In Stripe, ours". All three
were written when Stripe was the only way anything was paid. The first real
venue is Etsy, so the first real sale would have shown Etsy's fee as Stripe's.
The same held figure appeared in Ask's bank answer.

- Each sale names its own provider, from the fulfilment's `provider`: "Etsy
  took $1.58".
- The gross line and the tile now say "the providers" ("Held by the providers,
  ours"), on the money page and in Ask.
- The per-sale margin (`unitContribution`) already showed an unread fee as
  unknown, never zero. The page now also says what the margin does not
  subtract: what it cost to be found beyond the provider's own fees, and the
  owner's time. His time is "not entered" until he enters minutes on a test's
  page (D6), then "N minutes entered", with no price put on it.

**Maturity.** **`tested`** (`a-sale-names-who-took-the-fee`, 3, red first; the
12 files that render the money page still pass).
**Proof debt:**
- Etsy's listing-renewal fee and Offsite Ads are not read per sale. They are
  named as not counted, not estimated.
- No hourly value is put on his time, deliberately. That would be a number
  nobody has given.

### J1 and J3, walked on a phone and counted (28 September 2026)

Roadmap A8. J1 (start an investigation, and find it later) and J3 (stop a
search, and still find the record) had only been proved through HTTP
requests: the rows, not the walk. `scripts/measure-journeys.mts` drives the
real pages in Chromium at 390 × 844, taps only what is visible, counts taps
and screens, and fails on horizontal overflow. It is not part of `npm run
check`, because it needs the browser binary.

| Journey | Taps | Screens | Path |
|---|---|---|---|
| J1 | 4: open Ask, tap the box, Ask, confirm | 4 | Home → Ask → Home (looking) → Home shows "What I am looking for" |
| J3 | 5: open Ask, tap the box, Ask, confirm, then More → Activity | 5 | Home → Ask → Home (stopped) → Home → Activity shows "Stopped looking" |

**What the walk found.** The first direction typed, "Look for small digital
tools that contractors would pay for once", was answered **"I did not follow
that"**. The reader of directions needs a word for something that earns, and
"tools", "templates" and "would pay for" were not among them. Those words are
now included, with bounds: "tools" counts only when followed by "that", "for"
or "which", so "the tools page" stays a page. A test holds four natural
directions that must be heard, and four look-alikes ("Find the invoice I
sent", "Explore the inbox", "Find the tools page") that must not.

**And two sentences that assumed Stripe**, found by the audit that followed D4.
Ask said a refund "waits for you to issue it in Stripe" whatever the channel;
it now adds that a sale made on Etsy is refunded on Etsy, by the owner. The
empty ledger said "the first row will be written by Stripe"; it now says "from
the provider's own record".

**Maturity.** J1 and J3 **`measured`** on a simulated 390px phone.
Recognition **`tested`** (`an-entrepreneurial-mandate` +2, red first).
**Proof debt:**
- A simulated phone, not his. F1's test on his own device is still his to do.
- Typing is not counted as taps. On a real keyboard it is most of the effort.

### The handoff of 28 September: the record reconciled, and who checks the messages

The owner's handoff on digital products asks that the record be reconciled
first, then that the first buyer relationship be closed before any new
product. Two findings from checking it against the code:

**The record said something false.** `OBJECTIVE.md` read "the first real thing
this institution ever sold was a $29 one-time brief". Experiment 001 wrote to
21 businesses and settled on 19 September with 0 payments. It now reads
"offered for sale", with a dated amendment note. The argument it made about
the MRR rule never depended on a sale.

**A week away could certify care nobody was giving.** Etsy lets no app read a
shop's messages. The absence reading named that only when a read had
*failed*. For a live listing on a shop that read perfectly well, seven days
away read as covered while every buyer who wrote on Etsy waited unseen. The
handoff: *"the owner-facing obligation and seven-day absence reading must say
exactly who checks it and when. Do not silently certify unattended care."*

- The owner says, once, how often he checks Etsy messages and whether he does
  while away (migration 362, `venue_care_checks`). It follows the findability
  rules: only the company's owner, as himself; about the shop confirmed now
  (G4); from 1 to 30 days; kept as said.
- The absence reading (`only_real_decisions`) holds for a live Etsy listing
  only when what he said covers the absence (while away, and at least once
  within it). Otherwise it says exactly what is missing: "nobody has said who
  checks them", "not while you are away", or "every 10 days", and the fix.
- The asset's record says it in "what is owed" and in "what is yours".
- The Etsy connection page asks it, in view, once the shop is his.

**Maturity.** **`tested`** (`who-checks-the-messages`, 8;
`the-connection-page-is-the-task` +3; red first).
**Commercial maturity** of the Etsy test is unchanged: CE0 for Proof 2, since
no buyer has arrived.
**Proof debt:**
- What he says is a statement, not an observation. Nothing here can tell
  whether he actually looked.
- Messages are one channel. A buyer who opens an Etsy case instead is covered
  only by the obligations reader, and only once an order exists.

### The buyer can get the file, and each order keeps which file it was (handoff A2, A3)

**A2.** The handoff cites Etsy's help: the Etsy app does not download digital
purchases, so a buyer is sent to a browser or a computer. On an iPhone, "I
can't find my file" is the most likely first help request this listing will
get, and the owner's acts said nothing about it. They now carry the exact
reply (etsy.com in a browser → You → Purchases → Download Files), its source,
its date, and who read it: the handoff's research, since this environment
cannot open Etsy's pages. It is for replies to buyers. The listing's own text
stays as sealed, because changing it during the test would change what the
test measures.

**A3.** An order did not record which file its listing held when it sold, so
a later change of file could not be traced to the buyers it affected. Each
venue order now keeps the files from the last reading at or before its payment
(migration 363, `delivered_files_json` and `delivered_files_seen_at` on
`experiment_fulfilments`). It is written once, at intake. A replay never
rebinds, and a later file change never rewrites an earlier buyer's record. With
no reading before the sale, the page says "which file this buyer received is
not known". The money page shows it under each venue sale.

**Maturity.** **`tested`**: `the-buyer-can-get-the-file` (3) and
`what-was-sold-is-what-was-delivered` (5), both red first. The 27 files that
record orders or render the money page still pass.
**Proof debt:**
- Etsy's download help page has not been read from here, only through the
  handoff.
- The binding is by filename and size, as Etsy reports them. There is no hash,
  so two different files of the same size would look the same.
- Readings happen when the shop is read. A file changed and changed back
  between two reads leaves no trace.

### The next product is a decision, not a build (handoff A4)

`river/proof-3-candidates/DOSSIER.md` compares A03 (a margin postmortem), A05
(a supplier quote normaliser), B01 revised (a lumber-yard purchase planner),
improving A01, a licensing path, holding the money, and building none. It
uses the handoff's fields. Observed, inferred, assumed and unknown are kept in
separate columns, and marketplace listings are graded as supply only. It names
no personal brand, because the repository is public. It records why no second
product should be built before the first buyer relationship has run end to
end.


### One file recipe, checked by hand and by a real spreadsheet (handoff A5)

The handoff says the owner should decide on the next product only after
seeing a completed file. So the leading candidate was built, as a prototype
for that decision: the A03 job review, estimate against actual for one
finished job (`products/recipes/job-review.ts`). It is written by a
dependency-free XLSX writer (`recipes/xlsx.ts`) that stores its parts with
fixed timestamps, so the same inputs always give the same bytes and the digest
binds the file. The recipe's rules:
- A blank cell is "unknown", never zero.
- At zero revenue, the margin says "undefined".
- A loss stays visible.
- Approved changes are judged apart from the quote.
- Other currencies and units, negative amounts and absurd amounts are refused
  before a file is built.
- Formulas are locked, and only the yellow input cells are open.

**The oracle is not the generator.** Nine cases were worked on paper, with
the working written beside each figure (`tests/fixtures/job-review-by-hand.ts`):
- normal;
- a loss;
- an approved change;
- missing hours;
- a supplier credit;
- zero revenue;
- rounding (12.5 × $47.33 is $591.63);
- a blank credit;
- the shipped example.

The test unzips each built file and executes the formulas **as written in it**
with an evaluator of its own, which rounds at 15 significant digits as a
spreadsheet does. The builder does not compute these answers. Two deliberate
formula mutations were caught:
- dropping the supplier credit;
- breaking the zero-revenue guard.

**LibreOffice agrees.** LibreOffice Calc 24.2 was installed in this container
for the purpose. It opened each case, calculated it from nothing (the files
carry no cached values), and all 85 compared cells agreed with the hand
figures (`river/proof-3-candidates/a03/RECALCULATED.md`, from
`scripts/recalculate-job-review.mts`). The number formats held too ($9,985.00,
28.9%). The first attempt failed because Calc was not installed, not because
of the file. That is recorded so nobody takes it as a finding about the file.

**Maturity.** **`tested`**, plus one independent engine observed: 16 tests in
`the-job-review-file-is-checked-by-hand`, red first (the module did not
exist). `template_file` stays `canMake: false`, and its reason now names what
is missing: a buyer who used it, and the spreadsheets buyers use.
**Proof debt:**
- Excel, Numbers and Google Sheets are unchecked.
- So is whether sheet protection and the "0 or more" validation behave in
  them.
- So is opening on a phone.
- The buyer-use test has not been run: whether a small shop has actual hours
  on paper at all.
- The recalculation script is not part of `npm run check`, because the image
  has no LibreOffice. It records what it saw when it is run.

### The owner's one decision, made reviewable (handoff A6)

The dossier now carries the decision packet:
- the file and its SHA-256;
- what he is asked to do first: two or three of his own finished jobs,
  without help, with minutes and difficulties noted;
- a draft listing written only from what was checked. It names LibreOffice
  and not Excel, and carries the browser-download line;
- the support envelope: messages at his stated frequency, a correction as a
  new version traced to buyers of the old one, and refunds through Etsy by
  him;
- the rivals as they stand.

It is recorded as **PENDING 27** in `OWNER_DECISIONS_PENDING.md`. The number
is the first that neither of the record's colliding series has used, and the
collision is named beside it. Nothing was listed, uploaded, priced or granted.
**Maturity:** documentation. **Proof debt:** the decision itself.

### How far the world has answered, on every test (handoff A7)

RIVER.md keeps commercial evidence (CE0–CE6) apart from implementation proof
(E0–E6). Until now the commercial ladder was graded by hand in this file.
`commercialMaturityOf` reads it from rows that already exist:
- **CE1**: a real, direct, supporting observation behind the test's claim.
- **CE2**: somebody the provider could not match to the owner began to pay,
  asked to hear more, or paid.
- **CE3**: a payment still paid, with no refund and no open dispute.
- **CE4**: that payment delivered. For a venue, the reader says the venue made
  the file available and that the download itself is not observed.

It stops at CE4. Repeat and sustained contribution are judgements no row
makes, and the sentence says so. The owner's own purchase, sandbox and
reference rows, a refund and an open dispute never raise a rung. A dispute the
seller won restores it. One sentence appears on each test's page and at the
end of the operating contract's first answer, in the same words.

**Maturity.** **`tested`**: `how-far-the-world-has-answered` (11), red first; the eleventh was added after a self-review found the CE4 sentence could describe the owner's own earlier delivery, and went red before the fix.
The 15 files that render the test page or the contract still pass.
**Commercial maturity of Experiment 002, as the reader would state it:** CE1,
if its seeded direct observations are real rows in production. That was not
read from production here.
**Proof debt:** no real row has yet exercised CE2 or above.

### The strategy, written as doctrine (`STRATEGY.md`)

The owner asked for a 50–100 item roadmap for Foundry's concepts. The handoff
then asked that it not become a product backlog. `STRATEGY.md` holds both:
- the 88 items first drafted, sharpened by the handoff (the four ledgers, the
  demand-reading table, concentration at four levels, acquisition-source
  labels, six mechanisms and the originality ladder, the weekly five sets, and
  a charter per product);
- eight items from the handoff itself (S89–S96).

Each item has a tag and a falsifier. Nothing in it is built because it is
listed. **Maturity:** doctrine, with no code maturity.

### Trading research: one question, asked honestly, with no way to trade (capital C0–C5)

The owner asked for his two earlier trading projects to become one of Foundry's tools.

**C0: the legacy code as evidence (`capital/LEGACY_TRADING_AUDIT.md`).**
- All ten handoff findings in kalshi-genius hold on master. Two are new:
  - its normal CDF overstates probabilities by 2.8–3.7 points where it traded;
  - its Binance feed returns HTTP 451 from here.
- Two were reproduced against its own source, under Bun:
  - the object comparison is false in both directions;
  - its sizer bets $30 of $100 at p = 0.50, 0.53 and 0.70 alike.
- In the legacy Apex Micro code, the reachable order doors were traced. The boot
  loop's direct exchange path remains open, and the draft PR does not touch it.
- Both draft PRs' tests were run:
  - kalshi-genius: 4 of 4 pass;
  - Apex focused: 8 of 8 pass;
  - Apex full: 475/9/38 against main's 468/8/38, and the one new failure asserts the
    old behaviour.

**C1–C3: the loop (`src/services/capital/`, migration 364).**
- The series rules are archived by digest, and the settlement source is read from the
  venue: CF Benchmarks.
- One point-in-time snapshot per window is taken four minutes in, with the book
  parsed as the venue publishes it (bids only, asks derived).
- A public spot price is kept and labelled a proxy.
- Two forecasts are sealed before the window closes, by triggers that also refuse a
  forecast once the answer is on record:
  - the market's own price;
  - a proxy-drift model on the official reference level.
- A simulated fill is taken against the displayed book, whole contracts only, with the
  venue's quadratic fee, only when the net edge clears 2¢. The schema admits no
  provenance but `simulated`, and the evaluation excludes any fill that does not
  reproduce from its stored book.
- Official results are imported from the venue's own record, falling back to the
  historical endpoint (verified: a July market is 404 live and 200 historical). One
  missing market no longer blinds the others; a test caught that.
- The evaluation compares the model and the market on paired Brier scores and shows the
  simulated result with one adverse cent. The verdict ladder has no "trade" rung.
- The capability is `observe`, bound to no tool and needing no credential. No table can
  hold an order, an account or a mandate.

**C4–C5.**
- `/foundry/money/research` is one reading under Economics, adding no door and
  counting nothing.
- ECONOMICS.md was amended: research is inside the scope, execution stays outside.
- PENDING 28 was raised.

**Maturity: `tested`, and one real-world observation.**
- Tests: `the-market-is-read-as-published` (15), `research-is-sealed-before-the-answer`
  (20), `research-cannot-reach-an-order` (6), `the-owner-reads-trading-research` (7).
  Three reintroduced legacy behaviours were caught: the old CDF, a NO bid read as a YES
  ask, and a flat fee.
- **Real world, 29 September 00:39 UTC, in a throwaway local database:**
  - Window `KXBTC15M-26SEP282045-45`; reference level 83,504.45; YES 0.44/0.45.
  - Proxy 83,492.54, σ₁ₘ 0.00038.
  - The model said P(YES) 0.4332 against the market's 0.445, and skipped: its best net
    edge after the fee was −1.3¢.
  - Two official results were read correctly.
- **Commercial maturity: CE0.** There is no edge, no trade, and no product.

**Proof debt:**
- The research has not run in production until the owner begins it.
- The fee coefficient is not read from Kalshi's schedule (HTTP 429 here).
- BRTI is unobservable, and the proxy's basis is uncorrected.
- The simulated fills ignore queue, latency and impact.
- 200 markets is one regime.
- The owner's accounts were never read, so whether either old bot traded real money is
  unknown.
- Whether the old `kalshi-genius` Fly app is running is unknown here, and it is urgent
  (PENDING 28).
  *(Answered 29 September: it had one machine, which a GET started LIVE; it was destroyed. See C6.)*

### Trading research across venues (capital C7)

The owner asked for Foundry to "work across all trading platforms simultaneously".

**What is true now (migration 365, `src/services/capital/`).**
- Venues are a vocabulary (`capital_venues`: Kalshi, Polymarket), and each is one reader
  in `VENUE_READERS`. Everything after the read is shared code: the sealed forecasts,
  simulated fills, official results and evaluation.
- The rebuild of the seven tables was proved on a populated 364 database. Every row
  survived, `foreign_key_check` is clean, and sealed stays sealed.
- Polymarket is read from its public event list and book only. Its order, trade, auth
  and data-API paths are refused before the network and banned from the source.
- Its fee is the venue's own, at the rate each market states.
- Up is YES only when the outcomes are exactly `["Up","Down"]`.
- A result counts only when the oracle has resolved it, at exactly 1 and 0.
- No reference level is invented, so the proxy model says why it does not run there.
- One run observes every venue with a question open. A venue that asks to wait
  concludes nothing, and the others carry on.
- A forecast cannot be filed under another venue's question.
- The page has a section per venue and one reading of both side by side.

**Maturity: `tested`, plus two real-world observations.**
- Tests: `one-question-many-venues` (15). The existing capital suites were updated:
  62 tests in all.
- **Real world, 96 windows, 28–29 September.** The two venues' official results agreed
  96 times out of 96 (`river/capital/cross-venue/`). They are one exposure, not two.
- **Real world, 29 September 02:51 UTC, throwaway database.** Both venues were
  observed in one pass on the window closing at 03:00Z. The prices were 1¢ apart
  (0.535 against 0.525). The Kalshi model skipped at a net edge of +0.1¢. The
  Polymarket model did not run, and recorded why.
- **Commercial maturity: CE0.**

**Proof debt:**
- The cross-venue reading has one live window, and no resolved pair in production.
- Polymarket's fee rounding direction is inferred ("rounded to 5 decimals"); the code
  rounds up, which never undercharges the simulation.
- Polymarket's reference level is unobservable here.
- Whether the owner may trade on Polymarket is not established.
- The owner has not begun either question in production.

### The record, reconciled (Private S6, 29 September 2026)

The executive review's business digest listed fourteen places where the record
contradicted itself. This is what became of each.

**Settled from the evidence:**
1. **The decisions file's header and numbering.** It is generated and gated now,
   and renumbered as described in ROADMAP Private S6.
2. **Experiment 002: CE0 or CE1?** Both lines are true about different things.
   CE0 is what has been observed: no buyer. CE1 is what the reader would compute
   *if* its seeded direct observations exist in production, which was never read
   from production. **The recorded level is CE0** until production is read.
3. **Etsy connected or not.** It is connected at read scope: PENDING 25 steps
   1–2, 22–25 September. The earlier "no shop is connected" line carries a dated
   correction.
4. **IMPLEMENTATION_STATE's "Verified now".** Its counts are generated and gated.
5. **ROADMAP "Next" named finished work.** It is rewritten.
6. **"PENDING 22 open" in ROADMAP H1.** It was answered on 21 September
   (RESOLVED 13, formerly §22).
7. **The live-frontier file stopped on 25 September.** The work since then is
   recorded in ROADMAP's Done table (Capital C0–C7, Review R1, Private S1–S6),
   which is the authoritative list.
8. **The vacation flag against Developer Mode.** Both statements are true. Foundry
   reads Etsy's `is_vacation` (A1). Developer Mode is not known to be reported to
   an app, so whether the shop is hidden still rests on the owner's word.

**Waiting on the owner, because only the owner can settle them:**
9. Whether the $14 listing was ever published, and on what date. No dated record
   of publication was found.
10. When the Etsy shop becomes findable again (ROADMAP B11).
11. Whether the charter (PENDING 17) is signed. That is in production data.

**Left as they are, with the reason:**
12. **Workshop page counts** (9, 14 or 15, by date). Each was true when written,
    and the site's own inventory is the current answer.
13. **Reply-path dates** (routed on 9–10 September; unrouted during Experiment
    001's window of 12–19 September). Both are recorded with their evidence in
    PENDING 21, and that ruling is the owner's.
14. **AcreOS**: the Constitution's "likely first external company", while
    implementation is "owner deferred". Both are true: one is a priority, the
    other a schedule.

### The multi-user machinery, first half removed (Private S7a, 29 September 2026)

**Evidence maturity.** E3 for the removal: the gate chain proves that nothing
reads, writes or reaches what was removed; the job registry pin moved 78 to 73
with each reason written beside it; and migration 368's test proves one row kept
for every row dropped, on a database that had rows. E1 for production: until the
deploy reports this commit, production still runs the five jobs.

**Proof debt.**
- How many rows production held in the three retired tables is not known here.
  Production data was not read from this session. The migration keeps them all
  whatever the number, and `retired_rows` can be counted after the deploy.
- The archive tag is not on GitHub (the proxy drops tag pushes). Until the owner
  pushes it, commit `7d3129af` on this branch is the recoverable point.
- `team_members`, `team_invitations`, `decision_votes`, `referral_links`,
  `referral_conversions`, `network_contributions`, `network_benchmarks` and
  `onboarding_tour` remain as tables, and billing, trials and `/api/v1` remain as
  code. They are S7b.

### A buyer on Etsy is heard, and answered by a person (Roadmap 2027 R14, 4 October 2026)

**What changed.** Etsy's notification emails, forwarded by the owner to the
Workshop's address, are recognised at the one mail door (`ingestEdgeRecord`)
before the Workshop's correspondence can see them, and kept in
`etsy_mail_heard` (migration 378) as that a buyer wrote, when, and which of
seven saved replies the rules suggest. A buyer waiting is an urgent Needs-you
item that cannot be snoozed; the owner marks it answered. The saved replies
each quote the published passage they restate, and a test holds the quote to
the listing, how-to or owner's acts. Nothing is sent by Foundry.

**Evidence maturity.** E1: law test `a-buyer-on-etsy-is-heard-not-answered`
over the real public route, with a stubbed Etsy email. No real Etsy
notification has been seen by this environment.

**Proof debt.**
- Etsy's real template is unknown here. The footer filter and the rules were
  written against an assumed shape; the first real notification is the proof,
  and a wrong suggestion shows its grounds.
- The forwarded email is still kept whole in the Workshop's mail store at
  Cloudflare (the edge writes every message there before Foundry sees it).
  Foundry's own record keeps no name or words; the store does. The page says
  so and offers the owner a privacy-policy sentence; nothing deletes it yet.
- Recognition is not authentication: anyone who knows the address could send
  a look-alike. It costs the owner one look on Etsy, and grants nothing.
- "Answered" is the owner's word. Foundry cannot see Etsy's side.
- The parser change (a part ends at its own MIME boundary; `<address>` kept
  as text) applies to all Workshop mail. Workshop tests pass; not yet seen on
  real multi-part mail from a provider other than the stubs.

### A free tool beside a paid thing (Roadmap 2027 R15, 4 October 2026)

**What changed.** The owner decided Foundry may act on what it finds (PENDING
31). Launching inside the charter was already autonomous: the daily forge pass
seals a design both sides recommend, inside the charter, and the hands allow it
under the charter and carry it. What it could launch was one thing — a sourced
brief at a fixed price. Now a design may give a free calculator away beside
the brief (`free_with_role`, migration 379; `static_tool` makeable). The tool
is a specification, not code: one reviewed program, carried in the Workshop
worker's own text and served at /tool.js, computes it in the reader's browser;
the site's policy admits same-origin script and still no connection. The gate
runs the same arithmetic text in an isolated context against every worked
example and across the input range. The page renders the tool above the paid
offer; the projection re-checks it; the publication gate refuses any other
script.

**Evidence maturity.** E1: law test `a-free-tool-computes-what-it-says`
(arithmetic shared word for word, precedence, refusals, no reach beyond its
inputs, the worker serving its own program over a hostile store value, the CSP,
escaping against a composition that tries to close the data block).

**Proof debt.**
- No free tool has yet been composed by the model, sealed, published or seen
  in a real browser. The first one through the forge is the proof.
- The gate proves a tool says what its examples say. Whether the formula is
  the right one for the reader's world is argued only by the forge's adversary.
- The tool's use is not measured (the site has no analytics, by design); the
  test settles on payment for the brief beside it, so a tool that helps people
  and sells nothing reads as failure.
- The DOM half of /tool.js (reading the form, writing answers) is not exercised
  by a test here; only its arithmetic is.
- The worker is replaced by `keepTheProgramCurrent` through the door when its
  digest changes; until that runs, a published tool page would show its worked
  examples only (the old policy blocks the script).

### Pay what it was worth (Roadmap 2027 R16, 4 October 2026)

**What changed.** `value_first` became available (migration 380). A design that
gives first publishes the whole brief on its page while the offer stands, and
a Stripe price with `custom_unit_amount` lets the reader pay what it was worth
between $1 and $100, a suggestion preset. The link validator, the act's
parameters (what is approved is what is created), the gateway handler and the
publication gate all treat a chosen amount as its own shape and refuse it in
place of a fixed one, or the reverse. Payment, delivery of a copy by email,
refunds and settlement run on the existing paths.

**Evidence maturity.** E1: law test `pay-what-it-was-worth` (validation both
ways, bounds, the request actually sent to the provider with a stubbed fetch,
the page's words).

**Proof debt.**
- No chosen-amount link has been created at Stripe; the request shape is
  tested against a stub, not the provider. The first live one is the proof,
  and `validateExperimentPaymentLink` refuses it if Stripe returns anything
  else.
- The projection's `freeToRead` (given only while testing, only for a chosen
  amount) is exercised through rendering, not through a database fixture.
- The test settles on any payment; how much people chose is in the ledger but
  not yet summarised on the owner's page.

### A week of a subscription is one delivery (Roadmap 2027 R18, 4 October 2026)

**What changed.** The Stripe half of subscriptions, inert until the exchange
is made available and the owner lifts the first-proof rule. Weekly links with
the tag on the subscription; `invoice.paid` taken in as a payment in both of
the provider's shapes, with a by-name lookup when the invoice carries no tag;
untagged refunds found by their invoice; the ledger keyed per invoice with the
fee read from the charge; the provider poll covering paid subscription
invoices; the buyer's address and the charge read from the invoice.

**Evidence maturity.** E1: `a-week-of-a-subscription-is-one-delivery`, with
the provider stubbed in both shapes; the fifteen existing money-path suites
pass unchanged.

**Proof debt.**
- Nothing here has met the real provider. Which shape the webhook delivers
  depends on the endpoint's API version in the owner's Stripe account, so both
  are read; the first real week is the proof.
- The webhook endpoint must be subscribed to `invoice.paid`. Until it is, the
  provider poll (hourly, within 45 days) is what finds a paid week.
- A refund the owner makes themselves in Stripe on a subscription charge is
  found only if the charge names its invoice (older shape); Foundry's own
  refunds update the row directly.


### A subscription can always be stopped (Roadmap 2027 R19, 4 October 2026)

**What changed.** `subscription` became available (migration 381) with its end
built first. It is offered only when the owner's own row has lifted the rule
against recurring billing and Foundry's money switch is on; the forge sees it
as available only then, and the composition and the allowance refuse it
otherwise. The stop is an act approved with the test (`stripe_update_subscription`,
financial), found by the door only from a `subscription_cancellations` row and
only for `cancel_at_period_end`. Each paid week records its subscription; each
week's email carries a signed cancel link beside the refund link; the hand
stops every subscription when the test is stopped or retired or its delivery
act nears its end (`STOP_AHEAD_DAYS`, 9), retries a refused stop every pass,
keeps the asset from retiring while one still charges, and records a
subscription the provider already ended as stopped. A second week is sent only
once a newer edition exists. The page, the gate and readiness read one
renewal promise (`renewalPromiseMissing`).

**Evidence maturity.** E1: law test `a-subscription-can-always-be-stopped`
(15 cases, world harness, providers stubbed: the two refusals, the buyer's
link and a forged one, the door refusing a price change and an unrecorded ask,
the money switch off then on, a provider-ended subscription, the act nearing
its end, the owner's stop, the page and the gate).

**Proof debt.**
- No subscription has existed at Stripe. `cancel_at_period_end` and the
  ended-subscription read are tested against a stub.
- In production the money switch is off, so the forge will not design a
  subscription until the owner turns it on and allows subscriptions.
- A subscription the buyer cancels in Stripe's own portal is read as stopped
  only when Foundry next tries to stop it; nothing listens for
  `customer.subscription.deleted`.
- Subscribers of a test that settled are delivered to until nine days before
  the delivery act lapses, then stopped; there is no path yet for a settled
  subscription test to become a lasting product that keeps its subscribers.
- A week that waits for a newer edition waits as an owed obligation; if the
  brief cannot be re-pulled, the existing freshness rule makes it the owner's.

### What a buyer pays for can go out (Roadmap 2027 R20, 4 October 2026)

**What changed.** A defect, found independently by three readers of the code
in the toolbox review: the delivery gate counted only Experiment 001's
COMMBUYS links, so every brief the hands made would have been refused at
delivery after payment, silently. `deliverableGate` chooses the gate by what
made the goods and is read at launch, delivery, page readiness, the experiment
view and the obligation.

**Evidence maturity.** E1: three law cases in `the-workshop-is-the-first-venue`
(a hands-made brief passes and is planned for delivery to a paying buyer; a
citation nobody retrieved is refused at launch and named to the owner).

**Proof debt.**
- No hands-made brief has been bought yet; the first sale is the proof.
- A delivery refused for any reason still waits on the owner rather than being
  refunded automatically; with the money switch off, a refund is theirs anyway.
