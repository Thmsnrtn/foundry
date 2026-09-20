# The owner operating system — canonical migration state

This file is the durable progress state for the Owner OS tranche. It exists so
that a context which has lost the conversation can reconstruct where the work
is from the repository alone. Read this first, then `git log`, then production.

Nothing in here is true because it is written here. Every claim names how it was
checked, and anything not yet checked says so.

---

## Section 0 — the execution gate

The directive forbids beginning this tranche until Experiment 001 has genuinely
crossed its first external execution boundary — not "a job returned success",
but the governed effect path proven in production.

**Verified 2026-09-13 against the production volume, link by link.** Each line
was read from `/data/foundry.db` on `foundry-intel`, and the capability check
was made through the institution's own registry rather than a provider call.

| Link | Result |
|---|---|
| Owner authorization, unrevoked, bound to the act | PASS — approved 2026-09-12 18:33:40, expires 2026-10-03 |
| Governed payment capability reachable | PASS — `stripe_create_payment_link`, `stripe_deactivate_payment_link`, `stripe_create_refund` all registered in the outbound gateway |
| Payment link created | PASS — `stripe:plink_1UEzzERx25BFZ1Jm18HWosen`, placed by `institution:hand` |
| Public offer placed | PASS — same exposure, 2026-09-12 23:05:32 |
| Public page published | PASS — #1 `/experiments/ma-millwork-bid-brief`, listed |
| Stage messages sent through the governed path | PASS — 21 offers executed via `outbound_actions` |
| Provider receipts reconciled | PASS — 15 verified_success, 1 verified_failure, 5 unresolved |
| Experiment state reflects reality | PASS — run state `success`; 15 `offer_delivered`, 1 `delivery_failed` |

**The gate is open.** Experiment 001 continues autonomously under its existing
authority while this tranche proceeds. It is not to be redesigned, repopulated,
repriced, rebroadened, or re-authorized by this work.

A note on how that check itself failed once: the first run reported the payment
capability unreachable. That was wrong — the probe asked for a tool named
`stripe.payment_link.create`, which does not exist; the real name is
`stripe_create_payment_link`. A gate that names the wrong thing reports a
failure that is its own. Worth remembering: a red light must be read before it
is believed, exactly as a green one must.

---

## What Experiment 001 actually is, so the UI does not invent it

The renderings show a mature estate — six figures of cash, a tax reserve, a
revenue trend. **Foundry has none of that.** As of 2026-09-13 the canonical
truth is:

- 21 of 21 approved businesses contacted, one offer each, $29, one-time
- 15 delivered, 1 undeliverable, 5 not yet resolved
- **0 purchases. 0 revenue. 0 replies. 0 complaints. 0 opt-outs.**
- no settled cash, no tax reserve, no distributable surplus
- no owner action required

The Cockpit must be able to say that truthfully and still feel like the
renderings. An interface that only looks right when the numbers are large is
not an interface, it is a poster. **The empty state is the first state to
build, not the last.**

---

## Decisions I own, and why

The handoff is design direction, not specification, and in two places it
contradicts itself. Recording the resolutions here so they are not relitigated.

**1. Nine bottom tabs do not fit a phone.** The direction board's mobile view
shows nine (Home, Decisions, Portfolio, Experiments, Inbox, Activity,
Economics, Controls, Ask). At 375px that is ~41px per tab, which the same
directive forbids: "no clipped tab bars", "thumb-accessible controls". The
handoff's own decisions render uses **six**. Resolution: the phone carries a
small number of tabs; the desktop left rail carries the full canonical set.
Navigation breadth is a desktop affordance, not a phone one.

**2. Names in the renderings are not our names.** The decision card says "Acme
Millwork — our institution". Our public identity is **Apex Micro**. Every
company name, dollar figure, address, date and quote in the images is
illustrative and must not reach production.

**3. Whether DECISIONS is its own route** is deferred until the surface
inventory says whether a lived owner-attention queue already exists. The
directive's constraint is the binding one: no duplicate owner queues.

---

## Phases

Sequenced per the directive. A phase is not done because code exists; it is
done when the acceptance line beside it is true.

| # | Phase | State |
|---|---|---|
| 0 | Execution gate — Experiment 001 across the boundary | **DONE**, verified above |
| 1 | Reconstruct the lived owner surface; classify every route | **DONE** |
| 2 | One shell, one nav, WATCH/INSPECT/INTERVENE; migrate Home | **DONE** — and System B retired: one stylesheet, one layout, 14 Sept |
| 3 | Founder Cockpit: health, owner action, Now/Next, live experiment, mobile proof | **DONE** |
| 4 | Economic nervous system: events, accounting, reconciliation, reserves, tax | **DONE**, 14 Sept — see "the economic nervous system, built" below |
| 5 | Portfolio / Discover / Autonomy / Roadmap | **DONE**, 14 Sept |
| 6 | Experiment Forge, and Experiment 001 as curriculum | **DONE**, 14 Sept |
| 7 | Quiet maturity, absence tests, cognition economics | not started |

---

## Standing constraints carried into this tranche

- Experiment 001's cohort, price, message, strata, staged rollout, stop
  envelope and owner exclusions are untouchable by UI work.
- The Nirvana Upfitters exclusion is a durable entity-level boundary. Its
  reason is private and must not surface publicly.
- Owner exclusion outranks qualification, score and expected value.
- `$0` is not `internal`, and `internal` is not `safe`.
- A beautiful control surface must not weaken backend enforcement. The pause
  lever is the owner's: `public_workshop` requires `economic_pause_by` to be
  `founder:<id>`, and the institution may not forge it.
- Success means the state transition actually happened, proven by readback.

---

## Phase 1 — what the owner can actually reach, and what only the tests can

Reconstructed 2026-09-13 by reading `src/index.ts` (the mount table is a single
top-level `if (!isPrivateOwnerInstance())` at lines 542–630 with no other
branch), the router-of-routers in `letter.ts:2766–2788`, every navigation
definition, and every test that imports a route module.

### The live surface — 12 modules, 13,453 lines

| Path | Module | Class | Because |
|---|---|---|---|
| `/foundry` | `foundry-shell.ts` (5,975) | **KEEP** | the first screen; `readOwnerState` + `whatNeedsHim` + `theOneThing` are the real Cockpit substrate |
| `/foundry/companies`, `/:id`, `/:id/see/:sense` | `foundry-shell.ts` | **KEEP** | portfolio and the company place |
| `/foundry/controls` | `foundry-shell.ts` | **KEEP** | what Foundry may do, what it costs, how to stop it |
| `/foundry/workshop` | `foundry-shell.ts` | **CONSOLIDATE → Controls** | substrate standing; reached only from a `next.href`, never from nav |
| `/foundry/companies/:id/{authority,work,economics,customers,experiments,evidence}` | `places.ts` (643) | **KEEP** | zero inline styles; the cleanest consumer of the shell contract |
| `/foundry/decisions` | `places.ts` | **KEEP** — this is DECISIONS | every decision across the institution, one queue (`waitingOn`) |
| `/foundry/searching` | `places.ts` | **KEEP** → becomes DISCOVER | the venture search state |
| `/foundry/why/:kind/:id` | `places.ts` | **KEEP** | provenance for any claim — the institution's distinguishing feature; this is INSPECT |
| `/foundry/experiments`, `/:id`, `/:id/decide`, `/:id/recipients` | `experiments-place.ts` (520) | **KEEP** | no nav entry today — reached only via a company dimension |
| `/foundry/public-workshop`, `/preview/:id` | `workshop-place.ts` (207) | **KEEP** | the public face |
| `/foundry/inbox`, `/:thread` | `inbox-place.ts` (160) | **KEEP** | the membrane |
| `/letter` | `letter.ts` (2,788; 396 inline styles) | **REBUILD → absorb into `/foundry`** | its own header says so: "the mount that leaves is this one" |
| `/talk` | `letter.ts` | **DELETE** | duplicates Ask; zero inbound links |
| `/autopilot` | `letter.ts` | **DELETE** | duplicates `/foundry/controls`; zero inbound links |
| `/letter/responsibilities/:id/understanding` | `letter.ts` | **CONSOLIDATE → `/foundry/why`** | |
| 33 `POST /letter/*` | `letter.ts` | **BRIDGE** | the real write paths; re-pointed, never dropped |
| `/connections` | `connections.ts` (311) | **BRIDGE → Controls** | live logic, orphaned nav |
| `/settings` | `settings.ts` (1,043; 94 inline styles) | **REBUILD → Controls** | half its surface is commercial (checkout, tiers) |
| `/settings/add-product`, `/checkout` | `settings.ts` | **DELETE** | commercial |
| `/privacy` (+ exports) | `privacy.ts` (789; 109 inline styles) | **CONSOLIDATE → Controls** | consent, residency, export, erasure |
| `/onboarding/*` | `onboarding.ts` (697) | **REBUILD / DEFER** | commercial wizard chrome reached by an owner-instance redirect; `POST /onboarding/establish` stays |
| `decision-control.ts` (96) | shared | **KEEP** | `renderDecision()` is the enforced single writer of every consequential button |
| `views/layout.ts` (453), `views/components.ts` (1,329), `src/public/styles.css` (1,728) | System B | **DELETE once `/letter` is absorbed** | 42 of 44 component exports never reach production |

### The dead surface — 72 modules, 22,463 lines

Imported, type-checked, tested, never served. The `agents-*` family is 18 files /
6,362 lines (7,449 with `agents.ts` and `agent-intelligence.ts`). Twenty-six of
the 72 are referenced by exactly one thing in the repository:
`tests/simulation/crawl.ts`, a hand-maintained mirror of the mount table with
no posture gate. **The dead code was load-bearing for CI, not for the owner.**

Two tests kept it alive: `every-declared-route-is-registered` (runs in
commercial posture, asserts the >400-route table) and `crawl.ts` (83
`mounts.push`). Both get rewritten in the deletion. The routes are preserved on
`archive/commercial-foundry` at `9049f60e`; the services beneath them stay,
exactly as the old `index.ts` comment reasoned.

### Two shells, five navigations

Production renders **two** shells that share nothing — not a document, not a
token, not a typeface — joined by one link (`foundry-shell.ts:1604 → /letter`):

- **System A**, `/foundry/*`: warm light palette with correct three-state dark
  mode, a `Where`/`page()` contract that renders the same five slots on every
  screen, serif display / system sans, 24 inline styles in 5,975 lines, one
  hash-pinned script so CSP can drop `unsafe-inline`. **It is already a design
  system in everything but packaging.**
- **System B**, everything else: dark indigo `styles.css`, header-only on the
  private instance (its sidebar, tab bar and ⌘K palette are all gated off),
  supplemented by 599 inline `style=""` attributes across three files.

Three further navigations exist in code and never render (25-item sidebar,
5-tab bar, ⌘K palette). So the phone he holds shows System A's three doors —
Foundry / Portfolio / Controls — and the desktop shows the same plus a rail.

### Four live dead-ends, closed

Every one of these was a control the owner could press in production that led
nowhere: the header logo → `/dashboard` (unmounted); a banner on every System B
page that fetched `/api/priority/one-thing` on load (unmounted); a pageview
beacon to `/api/analytics/pageview` (exists nowhere); and the Letter's primary
**"Decide"** button → `/decisions` (the commercial page). The gate written to
catch exactly this — `nothing-the-owner-can-press-dead-ends` — filtered its
crawl to `/foundry*` and `/letter`, so it was blind at precisely the boundary
the dead-ends crossed. Widening it found a fifth on the first run: the product
switcher posted to `/switch-product`, another commercial route. All five are
closed and the gate now crawls everything the owner can reach.

### Resolved: DECISIONS is `/foundry/decisions`

It already exists, already reads the one queue, and Home already projects the
top of that queue as "the one thing". No second queue is created. The
navigation gives it a door; that is the whole change.

### Phase 2 seam

Extract System A's tokens and the `Where`/`page()` contract out of
`foundry-shell.ts:970–1632` into a shell module every place consumes. Re-skin it
dark-first to the direction board. Give the canonical set its doors. Then absorb
`/letter` and delete System B. The one-script CSP invariant survives untouched.

---

## Phase 2 — one shell (in progress)

**Done, browser-verified at 390px and 1280px in dark mode:**

- The shell is a module: `src/views/owner/shell.ts` carries `page()`, `Where`,
  `placeHead`, `frameFor`, the doors and the Ask composer. The 443-line inline
  `<style>` is `src/public/owner.css`, served once and cached. The route file
  re-exports the contract so its five consumers did not churn; the removal path
  is to point them at the shell and delete the re-export.
- Dark is the ground. Newsreader for the sentences that matter, Inter for the
  operational text, both bundled under the OFL (licences ship beside the files).
  Mint is state; gold is owner attention and nothing else. Light is the
  alternate and the toggle wins both ways.
- The doors are the canonical set that actually opens: Home, Decisions,
  Experiments, Inbox, Controls under the thumb; Portfolio, Discover and Workshop
  on the desk rail. Activity and Economics get doors when their surfaces exist.
  Each place lights its own door — Decisions, Experiments and Inbox were all
  lighting "Home".
- The one-script CSP invariant is untouched. The manifest's shortcut pointed at
  the commercial `/decisions`; now `/foundry/decisions`, and its colours agree
  with the ground.
- The geometry test serves the stylesheet the way `index.ts` does. A browser
  test that measured an unstyled page would have passed on nothing.

**Home, migrated.** The first screen now opens with a glance: six tiles of
state, each from a reader the institution already keeps, each a door —
Estate (loop health and blocked passes), Needs you (the one queue), the live
Experiment (written to / delivered / paid), Settled (what has actually been
paid), Watching, and Since you looked. None is prose and none is invented: on
the current estate they read Healthy · None · 21 of 21 written to · $0 ·
1 company · Nothing, and that is the truth. The search block — Discover's
content — folds to one line with a gist. The one thing sits directly under
the glance, still in the first viewport on a 390px phone (the geometry test
holds it there).

**One queue, one derivation.** `/foundry/decisions` computed its own list of
what waits (acts + advice + candidates) while Home computed another; on the
same rows Home said "one thing needs you" and Decisions said "nothing is
waiting on you." Decisions now renders exactly what Home renders — the one
thing through `whatNeedsHim`, the rest through `waitingOn`, both through one
`waitingList` — and every queue item links to where its answer lives (the
act's `#decide` section, the advice, the notice, the test). The company-scoped
view keeps its per-company list.

**The button names the consequence.** The act card's primary said "Yes — go
ahead" — the label that approved nine things in 137 seconds. It now reads
`Approve — <the act> · <the cost>`. Two generic labels remain and are Phase
3's: "Approve this one thing" on the company page and in the attention queue.

**Carried into Phase 3:**

- On the desk, the local row under the greeting duplicates the rail. The rail
  is the navigation there; the local row should carry only what is *inside*
  the object underfoot.
- The one-thing card body is still prose-heavy; the Consequence descriptor
  (what / effect / touches / cost / reversibility / does-not-authorise) exists
  in `what-it-would-do.ts` and the card should render it as rows.
- Three tests that pinned the old shape were corrected with their intent kept:
  the accent-border test reads the stylesheet file and asserts gold on `.one`
  and `--line` on everything that merely contains information; the "not a
  dossier" prose count excludes the glance and the doors, because state tiles
  and navigation are not prose; the geometry test serves the stylesheet.

---

## Phase 3 — plan (written before the work, so it can be checked against it)

1. **A consequence for every act.** `what-it-would-do.ts` derives a
   `Consequence` for a test (`consequenceOfApproving`) and for first contact
   (`firstContactDecision`) but not for a `proposed_act`. Add
   `consequenceOfAct(actId)`: effect class from the constitutional rung
   (observe/prepare/reversible → internal; public → person when the subject
   names someone, else public; financial → provider; legal → account;
   destructive → account) and the act's own `subject`; reversibility from the
   rung with `putting_it_back`; cost from the ladder; `expires` from the act.
   `cannotSay` where the rung is missing — no button on a blank page.
2. **The one-thing card renders the consequence.** Route the `spend` and
   `acquire` kinds through `renderDecision` (effect pill, where it lands, cash,
   afterwards, does-not-authorise, `labelFor` on the button). Retire the two
   remaining generic labels ("Approve this one thing").
3. **System health as state, not prose.** A `healthOf(founderId)` reader over
   `getFailingInstitutionLoops` + `whatIsBlocked` + workshop health, returning
   `{ state: ok|degraded|blocked, failed, recovering, dataLoss, customerEffect,
   moneyAtRisk, ownerAction, lastHealthy }`; the Estate tile and Controls read
   it; the "stopped" attention card renders its rows.
4. **Now / Next.** Now = the live experiment's `stateDetail`; Next = the next
   hand pass (cron `20 * * * *` against `job_health.last_success_at`). One
   strip under the glance. No invented "results in ~18 hours".
5. **The desk's local row** carries only what is inside the object underfoot.
6. **Twelve journeys** from directive §44, as browser tests at 390 and 1280 —
   at least: healthy/no action; degraded/recovering; one consequential
   decision waiting; experiment running; experiment blocked; experiment
   stopped by a condition; owner returns after absence; WATCH → INSPECT →
   INTERVENE without losing place. Sale/refund/tax journeys wait for Phase 4's
   substrate rather than being faked.

### Phase 3 — progress

- **A consequence for every act** (`consequenceOfAct`): where it lands comes
  from the subject the owner asked to be consulted on — the constitutional
  boundary vocabulary (contact people, publish, set prices, spend money, move
  money, change software, commit on his behalf) — and how far it can be undone
  from the rung. An act never placed on the ladder gets `cannotSay` and no
  button. Proven on every rung.
- **The card renders it.** The one-thing card for an act shows Where it lands
  (with the effect pill), Afterwards, Cost, Putting it back and Does not
  authorise as rows, and its button is `labelFor(consequence)`. The queue's
  act items carry the pill and the same label; "Approve this one thing" is
  gone from the queue.
- **Needs-nothing no longer outranks needs-him.** Only a blocking acquisition
  counted as "stuck on him", so a stopped routine — whose card says nothing
  needs him — stood in front of a company asking to write to six customers.
  An act waiting, or a test owed an answer, now counts.
- **Health as state** (`healthOf`): ok / degraded / blocked with what failed,
  whether it recovers on its own, customer effect, money at risk, owner action,
  last healthy, next pass. The Estate tile reads it; the healthy line is about
  the estate, never about routines. Proven across all three states.
- **Now / Next** under the glance when a test is live: what it is doing, and
  when the hand next passes — from its schedule, not a forecast.

- **The card has a door to its own provenance.** Every queue item offered
  "Show your work"; the one decision the owner is most likely to interrogate
  offered none. INSPECT now opens from the card.
- **Deciding no longer loses his place.** The decision form posts `return_to`
  and the handler ignored it, so deciding from the first screen dropped him on
  a company page he had not asked to visit — context lost at the moment he had
  just used it. It now returns him where he decided.

**The journeys, proven in a browser at 390px in dark mode** (§44), eight of
twelve: healthy with nothing to do; degraded and recovering on its own, with
the rows he can check; one consequential decision waiting, which stays the one
thing with a stopped routine beside it, says where it lands, and carries a
button naming the act; a test running with Now and Next from the records; a
test blocked on a real dependency, naming what only he can do; a test stopped
by its own rule, naming the rule; back after a day away; and WATCH → INSPECT →
INTERVENE, ending with the decision recorded against the act and the owner
back on the screen he decided from. Sale, refund and tax-reserve journeys wait
for Phase 4's substrate rather than being faked.

Three of those journeys failed first on my own assertions rather than on the
product: the stylesheet uppercases a label and `innerText` returns it that
way, and the sixth glance tile legitimately sits below the fold on a phone. A
test that pins the casing a stylesheet chose is testing the stylesheet.

Both cards that report trouble — a stopped routine and a drifted check — now
carry the same rows, because they ask the same question: is anything of his
affected, and is he needed. Controls carries the full health block, so the
Estate tile shows the word and the place he goes when something is wrong shows
the rows.

**Phase 3 is done.** What remains of the Cockpit is content that needs Phase
4's substrate: money that has actually moved.

---

## Deploying Phases 2 and 3

The shell, the glance, the one queue, the consequence on every act, health as
state, Now/Next, and the eight browser journeys go to production together.

No migrations are added by this tranche, so Experiment 001's rows are
untouched by it. The hand runs on its own cron and does not depend on the
owner surface; the only write path this changes is the proposal decision
handler, which now honours the `return_to` its own form has always posted.

Live at the time of this deploy, read from the production volume: 21 of 21
written to, **19 delivered**, 1 undeliverable (RGC), 1 unresolved, 0 purchases,
0 opt-outs, no stop condition triggered, run state `noop_expected` — which is
the correct state for an experiment that has written to everybody it was
authorised to write to and is now waiting on the world.

---

## Phase 4 — the economic nervous system, designed against what exists

### What the institution already has

A constitutional vocabulary of what the world does with an offer
(`business_outcome_event_kinds`, immutable): `arrival`, `offer_viewed`,
`checkout_started`, `payment` (the only `is_payment`), `delivery` (the only
`is_delivery`), `delivery_failed`, `refund`, `dispute`, `complaint`,
`declined_value`, `continuation_requested`, `offer_delivered`. Every event
carries an amount, a currency, a provider, a provider event reference and an
evidence mode, and arrives through `settlement-intake` from a Stripe webhook —
so payment is already source-event-backed and idempotent.

Obligations exist as `experiment_fulfilments`: `owed → sent → delivered`, with
`failed` and `refunded`, bound to the payment event that created them by a row
guard. Spend exists in three places: `asset_money_spent` (per act, per tool,
with a provider reference), `cost_events` and `ai_daily_spend` (model and API
cost), and `probe_costs` (what a test was budgeted).

### What is missing, and is therefore Phase 4

Nothing between a payment and what the owner may actually take out:

1. **Provider fees.** A `payment` of $29 is not $29 of cash. Stripe's fee is
   on the balance transaction and is never read, so gross is being treated as
   net at the only point where the difference is the whole margin.
2. **Cash.** No table says what has actually settled into an account, as
   distinct from what was charged. `payout` and `balance_transaction` are the
   source events and neither is ingested.
3. **Refund exposure.** A delivered brief inside its refund window is a
   liability, not surplus. Nothing models the window.
4. **Tax reserve.** Nothing. This must be an estimate that says it is an
   estimate, with its assumptions and their provenance on the row, and it must
   never present itself as a filing.
5. **Contribution.** Revenue minus the variable cost of the thing sold —
   provider fee, fulfilment cost, the model spend attributable to that unit.
   The parts exist; nothing joins them to a unit.
6. **Owner-distributable surplus.** Settled cash, less obligations, less tax
   reserve, less refund exposure, less a minimum operating reserve, less
   already-authorised capital. The directive is explicit that this is not a
   bank balance and not revenue.
7. **Distributions.** Owner contributions and owner distributions, so basis
   and what has actually been taken out are both recorded.

### The shape it will take

One **economic event ledger**, append-only, every row carrying its source
event and provider reference, with a deterministic projection over it — never
an LLM in the ledger. The projections are read the way `healthOf` is read:
plain functions over canonical rows, cheap enough for WATCH.

Deliberately **not** double-entry with debits and credits: this is a
single-owner institution with one Stripe account and no payroll, and the
rigour that matters here is source-event provenance and reconciliation against
the provider, not a general accounting engine. If a second account or an
entity change ever makes that false, the ledger's shape is what changes.

Every economic figure the owner sees will carry its claim quality —
**measured** (a provider event), **estimated** (a tax reserve), or
**unavailable** — because the directive forbids hiding uncertainty behind
precision, and because $0 measured and $0 unknown are different facts.

### What will not be built on speculation

Foundry has taken no money. The ledger, the projections and their tests are
built now because they must exist before the first payment, not after; but no
figure will be invented to populate a screen. Until a payment settles, the
economic surfaces say what is true: nothing has been paid, and here is what
would be shown when it is.

---

## The ghosts, deleted

Seventy-two route modules and **22,463 lines** the owner could never reach,
removed on 2026-09-13: the whole `agents-*` family (18 files, 6,362 lines),
`agents.ts`, `agent-intelligence.ts`, the fleet, board, playbook, ROI,
investor, ambient and network surfaces, and thirteen `routes/api/*` routers.
Derived mechanically — every identifier mounted inside the
`!isPrivateOwnerInstance()` block and nowhere else — so the list is the mount
table's own answer, not a judgement call. Preserved on
`archive/commercial-foundry` at `9049f60e`.

`src/index.ts` compiles with the block and all seventy-two imports gone.

**What kept them alive was CI, not the owner.** Two files:
`tests/simulation/crawl.ts` hand-mirrored all eighty-three mounts with no
posture gate and was the only importer of twenty-six of them, and
`every-declared-route-is-registered` booted the app in the *commercial*
posture, so unmounting a router without deleting its file failed there. The
crawl's table now mirrors what `index.ts` actually serves, and the route gate
asks its question about the instance that exists.

**The cost, recorded rather than hidden.** Forty-eight services are now
orphaned, because the only things that imported them were the deleted routes.
The unreachable baseline goes from 21 to 69 — a worse number, deliberately.
Deleting a service is a different decision from deleting a route, and the two
halves of the old system share files. None of the forty-eight registers
anything at import time; that was checked after the deletion, because it is
the exact class the gate refuses to baseline and the exact way
`stripe-gateway.ts` once hid. **Next pass: choose those forty-eight file by
file.**

### The ratchets, retightened — and what the deletion loosened

Five baselines had to be rewritten because the code they described is gone.
Four of the five are the honest kind of rewrite and one class is not, so they
are separated here rather than run through `--write` in one go.

**Tightened, no new debt:**

- `unguarded-route-baseline`: **113 → 20**. Ninety-three routes that had been
  permitted to go unguarded were commercial and no longer exist. The ratchet
  is now ninety-three notches tighter and cannot slip back.
- `tenant-scope-baseline`: **2 → 1**. `POST /api/webhooks/stripe/:productId`
  lived in the deleted `api/supercharge.ts`. Only `GET /case-studies/:id`
  remains, with its written reason.

**Loosened, because the deletion orphaned data the deleted surface read.**
These are recorded rather than buried, because a `--write` that silently adds
entries is exactly how a ratchet stops being one:

- `unread-tables-baseline`: 2 → 5. Newly written-but-never-read:
  `alignment_snapshots`, `founder_behavioral_signals`, `geopolitical_signals`.
- `unreferenced-tables-baseline`: 1 → 2, net. Added `funding_readiness` and
  `okr_progress_updates`.
- `write-only-columns-baseline`: 63 → 80. Seventeen columns whose only reader
  was a deleted page — the call-transcript analysis fields, the business-model
  seasonality pair, several `processed_at` stamps, `weekly_plans.items_json`.

One of those seventeen was checked by hand rather than trusted, because it
looked alive: `stripe_webhook_events.processed_at`, on a table the live
billing path still writes. It is genuinely write-only — the at-most-once check
reads `event_id` and never the timestamp — so the column records when
something happened and nothing has ever asked. That is true now and was true
before; the deletion only removed whatever used to read it.

**These twenty-two tables and columns are the data-side ghosts of the
commercial product, and they belong with the forty-eight orphaned services in
one pass.** Dropping a column is a migration against a production database
holding a live experiment, which is not a thing to do in the same breath as
deleting a route file.

---

## The data-side ghosts, dropped

The section above ends by saying the data-side ghosts "belong with the
forty-eight orphaned services in one pass." Running the gates after the route
deletion made the first part of that pass compulsory rather than optional:
`check-writerless-tables` went red on **eight tables read by live code and
written by nothing**. Their only writers had been among the 72 deleted routes.

The gate's own words are the standard applied here:

> Either give it a writer, or remove the half that reads it. A surface showing
> permanent emptiness is worse than an absent one — an integrator builds
> against it, and a founder believes it.

### What the reading halves were actually doing

Nine modules read those eight tables. Seven were already unreachable from
production. The other two, and one live call path, were doing real damage:

- **`ux/milestones.ts`** offered a badge, *First Beta Intake Submitted*, whose
  check counted rows of `beta_intake`. No founder could ever earn it.
- **`lifecycle/monitor.ts`** gated phase `prompt_3` on ten processed
  `beta_intake` rows. That is not a strict threshold, it is a lock: the phase
  could never open however well a product did. Removing it leaves `prompt_3`
  gated on `first_cohort_day_30`, which reads a table that is written.
- **`notifications/push.ts`** looked the founder's devices up in
  `push_subscriptions`. The only thing that could ever have registered a device
  was a deleted route, so every call resolved to zero devices. Both callers —
  `ux/interruption.ts` and `intelligence/risk-state.ts` — wrapped that in a
  swallowed failure and reported `pushed: false`. `risk-state.ts` was the worse
  of the two: it read the founder's `max_channel` ceiling and asked `mayPush`
  whether Foundry was permitted to interrupt this person, all to guard a send
  that could not happen. Careful governance over an impossible effect is the
  most expensive kind of nothing — it reads as a kept promise both in the code
  and on the founder's settings screen.

In every case the in-app record was already written before the push was
attempted, so removing the push half loses no delivery that was ever occurring.

### Migration 309 — fourteen tables, in two rings

The first ring is the eight the gate named, plus three tables that exist only
to hang off them (`push_log`, `investor_annotations`, `key_results` — dropped
children-first so the foreign keys never dangle).

The second ring was **found by re-running the gates, not by guessing**.
Dropping a table makes its siblings visible: `agent_wiki_entries`,
`cofounder_alignment_scores`, `investor_updates` and `marketplace_trust_audit`
were reachable only through the code in the first ring, so deleting it left
them with neither a reader nor a writer. `check-unreferenced-tables` caught
all four, and `check-reachability` caught `services/scp/wiki.ts` becoming
unreachable the moment `scp/agents/scribe.ts` went — the wiki had frozen on
its first five articles because nothing had been able to add a sixth since the
route that called it was deleted. The cascade terminated after that ring.

### Nine modules deleted, 3,494 lines

`wisdom/cofounder.ts`, `scp/agents/compass.ts`, `scp/forecasting/targets.ts`,
`scp/investor/investor-update.ts`, `intelligence/marketplace.ts`,
`scp/agents/prism.ts`, `scp/agents/scribe.ts`, `notifications/push.ts`,
`scp/wiki.ts`.

### The ratchets, this time all tightened

Unlike the route deletion, every baseline movement here is a removal:

- `unreachable-modules-baseline`: **four entries removed** — the modules were
  deleted, not made reachable.
- `write-only-columns-baseline`: **one entry removed**,
  `cofounder_alignment_scores.score_date`, whose table is gone.
- `schema.snapshot.sql`: **232 lines removed, none added.** Verified as a pure
  deletion before committing, because a snapshot regeneration is exactly where
  an unnoticed addition would hide.
- `writerless-tables`, `unread-tables`, `unreferenced-tables`: all now green
  with **no baseline at all** — these gates are pinned at zero and stayed
  there.

The erasure graph lost the three rules that named dropped tables
(`push_subscriptions`, `push_log`, `cofounder_dna_responses`). Its worked
example in `childTablesOfErasure` had been the genuine three-level chain
`okr_progress_updates → key_results → company_okrs`, and all three are now
gone. The comment now states the rule without an example rather than inventing
one, because a false worked example is worse than none.

### What this pass deliberately did not do

`unreachable-modules-baseline` still lists **78 production-dead modules,
roughly 20,000 lines** — the rest of the orphaned service estate, of which 49
are kept alive only by a test that proves a property of code nothing runs.
That is the next deletion tranche, and it is a file-by-file judgement, not a
sweep. It was not bundled into this one because this one had to ship: Phases 2
and 3 and the route deletion were sitting unpushed behind a red gate, and a
20,000-line deletion is not a rider on an overdue deploy.

### One recorded owner decision this reverses

`CONSEQUENTIAL_EFFECTS.json` carried this line against
`src/services/notifications/push.ts`:

> It was classified unreachable — registration routes live, no sender anywhere
> — and the owner chose to wire it rather than remove the surface.

That choice was made on a premise that no longer holds. The reason wiring was
the better answer then is that the *registration* half was live: a founder
could register a device, and only the sending half was missing. The device
registration route was among the 72 deleted with Commercial Foundry, so the
half the owner was preserving is gone and cannot be reached from his instance.
Removing the sender now follows the owner's own reasoning rather than
contradicting it — he wanted the promise kept, and the thing that made it
keepable is what was deleted. It is recorded here, and reported to him,
because a decision he made explicitly should not be undone silently.

### One public claim the deletion made false

`truth:audit` caught `All plans include 12 AI agents` on the landing and
pricing copy. The gate derives that number from the agent roster on disk, and
deleting `compass.ts`, `prism.ts` and `scribe.ts` took it to nine. The copy and
the claims list both now say nine, in this commit, as the gate's contract
requires.

**This is the narrow fix, and the wider question is an owner question.** The
public landing page still sells Commercial Foundry — plans, tiers, founding
slots, an agent roster — and the product behind it has been unmounted and
deleted from his instance. Nine is a true count of files; it is not evidence
that a customer would get nine working agents, because all nine are in the
unreachable-modules baseline. Correcting a number was in scope. Deciding what,
if anything, `/` should offer the public now is not, and is flagged rather than
answered.

### The one that would have broken production, and the gate that now catches it

The three table gates all agreed `agent_wiki_entries` could be dropped, and all
three were right about what they measure. They read TypeScript.
**`reconstruction_claim_guard` is not TypeScript.**

Migration 106's trigger validates an evidence reference by UNIONing one arm per
evidence kind, and one arm reads `agent_wiki_entries`. SQLite resolves a trigger
body when the statement that fires it is **prepared**, not when the branch is
taken — so after migration 309, *every* INSERT into `reconstruction_claims`
would have failed with

```
no such table: main.agent_wiki_entries
```

whether or not the claim cited a wiki entry. `reconstruction_claims` is how the
institution records what it believes about a company and on what evidence; ten
modules under `services/institution/` write to it and it is on the live path.
This would have taken production's reconstruction machinery down at the first
claim after deploy, with an error naming a table the caller never mentioned.

Migration 310 recreates the guard without the wiki arm and drops `'wiki_entry'`
from the allowed-kinds vocabulary — an evidence kind whose backing table does
not exist can only ever ABORT, which is a trap rather than a permission. The
`ReconstructionEvidenceKind` union in `services/institution/reconstruction.ts`
is the other half of that vocabulary and was narrowed in the same commit.

**Then the general form of it.** Every trigger and view in the schema was
checked for the same defect; this was the only one. But "checked once" is not a
property, so `scripts/check-schema-object-references.mjs` now asserts that every
table named by a trigger or view is a table the snapshot creates, and runs in
`lint:columns` beside its siblings.

Two things about that gate are worth recording:

- **Its first version reported 130 tables that do not exist, all false.**
  `UPDATE OF col ON tbl` is a trigger *header*, so a bare `/UPDATE\s+(\w+)/`
  reports a table called `OF`; and these trigger bodies carry long English
  comments in which "on", "from" and "a" appear. It now strips comments and
  reads the header separately from the body. A gate that cries wolf on the whole
  schema is one a future reader deletes rather than reads.
- **It was watched failing on the real defect before being trusted.** The
  pre-fix snapshot with the `CREATE TABLE agent_wiki_entries` removed — exactly
  what would have shipped — makes it exit 1 naming `reconstruction_claim_guard`.
  `check-gates-are-tested` then required the two cases now in
  `gates-fail-when-they-should`: one that it fires, one that it does not fire on
  a well-formed `UPDATE OF … ON …` header.

### The agent registry, twelve to nine

`compass`, `prism` and `scribe` were not only modules. `ALL_AGENTS` in
`services/scp/types.ts` is the closed vocabulary that three dynamic `import()`
loaders narrow through, and one of those names arrives from an `agent_instances`
ROW. Leaving the three in the vocabulary would have meant a stored row naming a
deleted agent passing the guard and then importing a module that is not on disk,
at runtime, in production. The union, all five maps keyed by it, and the six
`EVENT_AGENT_MAP` rows that routed to them were reduced together. Every event
type still routes to at least one agent; `activation_failure` lost its
first-listed agent and is now led by `harbor`, which is a change in who looks
first, not a gap.

---

## The public face — answered by the owner

The section above flagged a question rather than answering it: the landing page
still sold Commercial Foundry, and deciding what `/` should offer the public was
not mine to make. The owner answered it the same day:

> "The 'landing page' shouldn't be selling anything as the only applicable
> landing page here is apex Micro for anyone that wants to learn more about
> myself or private foundry. The only landing page private foundry should have
> should be the whole public facing apex micro site."

### What was there

`routes/public/landing.ts`, 646 lines across six mounts: a hero, three pricing
tiers, thirty founding-rate slots, case studies, a manifesto, a help page, and a
privacy policy and terms describing a SaaS with Clerk sign-in, GitHub
repositories and a team of twelve AI agents. The product was unmounted and then
deleted; the page kept selling it.

It was also a **duplicate of a site that already works**. apexmicro.ai is live,
served by the Cloudflare Worker from `services/public-workshop/site.ts`, and
already carries Home, About, What I've made, Contact, and its own Privacy,
Terms, Refunds and email opt-out pages. Two public faces for one person is one
too many, and the one that was lying had no customers.

### What replaced it

`routes/public/door.ts`. One route: `GET /` redirects to `/foundry`, and
`authMiddleware` sends a visitor who is not signed in to `/auth/login`. One rule
in one place, rather than a session check duplicated into a public route — and a
stranger who finds the hostname sees a sign-in form and learns nothing, which is
correct. What there is for them is at apexmicro.ai.

Deleted with it: `/pricing`, `/case-studies`, `/case-studies/:id`, `/manifesto`,
`/help`, and the public `/privacy-policy` and `/terms` — legal pages for a
product that no longer operates, referenced by nothing in this codebase, and
superseded by Apex Micro's, which cover the business that actually has
customers. The **authenticated** `/privacy` dashboard — consent, export,
deletion — is a different thing and stays. The `?ref=` referral capture went too;
`distribution/referrals.ts` survives because `middleware/auth.ts` and
`billing/stripe.ts` still call it, but nothing captures a click now, which is
honest while there is nothing to refer anyone to.

`route-count` fell **16 → 11** and is locked there.

### The truth gate had to be rebuilt, and caught itself lying

`audit-public-claims` verified landing copy — prices, trial length, founding
slots, the agent roster. With the page gone it crashed on a missing file, so it
was repointed at the copy that actually ships.

The claims are now a **different kind**. The old page *typed* its facts: `$79`
was a string that had to be kept in step with a constant. Apex Micro renders
from the experiment record, so a price cannot drift from what is charged without
the data itself being wrong. What can still drift is a **promise**, and the
About page makes three in the owner's own words:

> "If you buy something and it's no use to you, you can have your money back."
> "If you hear from me and would rather not, one line tells me so and I won't
> write again."
> "Every page stays up, whatever happened to it."

Each is pinned to the **last step** of its pipeline — the refunds page actually
being routed, `isSuppressed` actually being called in the send path, the closed
registry actually being served — plus a fourth claim that the page and the
payment link read one `amountCents`. The failure mode these guard against is a
capability fully built except for the part that makes it happen.

**And the first version of that rewrite was green and vacuous.** Rewriting the
stop-word list for prose instead of pricing copy grew it to forty words, which
is most of an English sentence: all four claims tokenized to the **empty list**,
so each was "verified" by matching nothing. It was caught by deleting the
`isSuppressed` call from the send path and watching the gate still pass. A gate
that cannot go red is worse than no gate, because it is believed.

Fixed by cutting the stop list back to connectives and rewriting each failure
string so it does not contain the words of the claim it denies. Then proved:
each of the four capabilities was broken in turn and each claim went red. Two of
those four break-tests were themselves wrong on the first attempt — `isSuppressed`
occurs twice in the send path and only one was removed, and `amountCentsRenamed`
still contains `amountCents` as a substring — which is the same lesson twice: a
gate has not been watched fail until the thing you broke was actually broken.

`gates-fail-when-they-should` now carries three cases for it: one per capability
break, and one asserting directly that no claim survives the stop list as
nothing at all.

---

## Deployed and verified — 13 September 2026

Production (`foundry-intel`) serves commit `2eaeac1f`. `/internal/health`:
database ok, ai ok, clerk ok, scheduler ok, storage volume.

### What CI caught that I had not

The first push went red on two tests my own full chain had passed — 4,994
passing locally, every gate green. The cause is worth keeping:

`src/routes/api` held eighty-one routes until the commercial surface was
deleted. **Git does not track empty directories.** The folder survives on the
machine that did the deleting and is ABSENT from a fresh checkout. Two tests
plant a fixture into it; `writeFileSync` had nowhere to write, and the runner
answered with an ENOENT naming a FILE when the thing missing was the FOLDER.

So the local run was against a tree no other machine has. **After a deletion,
nothing local is evidence about the runner until the difference is named.** The
fix is in `plant`, which now creates any missing parent directory and removes it
with the file — so a fixture may name any path the gate walks whether or not the
tree happens to have code there, and planting never leaves the untracked empty
folder that hid this. Every other fixture directory was checked against the git
index; `src/routes/api` was the only one.

It was then verified the way it should have been the first time: a fresh
`git clone --depth 1` of the pushed branch, `npm ci`, both files run there —
75 tests passing, no directory left behind.

The deploy job behaved correctly on the red run: the chain runs first, it
failed, and the deploy was **skipped**. Nothing shipped on a red tree.

### Verified against production, not inferred

- **The door.** `/` → 302 `/foundry`; `/pricing`, `/case-studies`,
  `/manifesto`, `/help`, `/privacy-policy`, `/terms` all **404**;
  `/auth/login` 200.
- **The fourteen tables are gone** from the production volume — all thirteen
  checked by name return absent (the fourteenth, `investor_annotations`, was
  never created).
- **The trigger hazard is fixed, proven by doing it.**
  `reconstruction_claim_guard` no longer names `agent_wiki_entries`, and an
  INSERT into `reconstruction_claims` with a real `product_id` **succeeds**.
  Before migration 310 that statement could not have been PREPARED at all.
  (A first probe used a fake product id and failed on the FOREIGN KEY — the
  right failure, but not proof, so it was repeated properly.)

### Experiment 001, read from the volume — and one correction

| | |
|---|---|
| Recipients screened | **34** — 21 approved, 10 pending, 3 struck |
| Written to | **21**, all executed |
| Delivered | **19** |
| Bounced | **2** |
| Purchases (`experiment_fulfilments`) | **0** |
| Suppressions | **2, both `bounced`** |
| Stop conditions | bounces, complaints, declined_value, opt_outs, unfulfillable — **none triggered** |

**Two corrections to how this has been reported.** The cohort figure "21 of 21"
is right, but it was drawn from **34 screened**, and saying only 21 hid the
population the strata were cut from. And the two non-deliveries were described
as "1 undeliverable, 1 unresolved"; the second has since resolved, and both are
**bounces**.

That second point is the earlier bounce/opt-out fix working in production
exactly as intended: two dead mailboxes are recorded with reason `bounced`, the
`opt_outs` stop condition counts only `they_asked`, and it therefore reads
**zero**. Nobody has asked Thomas to stop writing. A dead mailbox is not a
person saying no, and the stop envelope now agrees.

---

## The estate, deleted — and the baseline that is now zero

The previous section ends by naming what was left: 78 production-dead modules,
about 20,000 lines. This is that pass. `check-reachability` now reports

```
✓ unreachable modules: 0 (baseline 0), 399 reached from 3 entry points,
  3 reached by a declared mechanism
```

The baseline was 65 when this began. **It is empty, and pinned at zero.**

### My own analysis was wrong, and the institution's gate caught it

An ad-hoc import-graph script said 79 modules were production-dead. Fifteen of
those were false positives, and ten of the fifteen were **the SCP agents** —
`atlas`, `beacon`, `crucible`, `forge`, `harbor`, `ledger`, `oracle`,
`sentinel`, `shield` and `base`. They are loaded by a **computed** specifier:

```ts
await import(`./agents/${agentName}.js`)   // scp/instance.ts
await import(`../agents/${agentName}.js`)  // scp/events/dispatcher.ts
```

Both loaders are live. Deleting those modules would have broken production the
first time an agent ran — the same failure that narrowing `ALL_AGENTS` was
written to prevent, arrived at from the other direction.

`check-reachability` already knew. It carries a `REACHED_BY` map declaring that
directory reached by computed dynamic import, with a note that a previous run
"named ~160KB of running agents as unreachable and would have been believed."
So the deletion set was taken from **the gate's baseline, not my script**. The
lesson is the gate's own: a declaration that something is reached by a
mechanism the walker cannot follow is a different statement from "unreachable
but allowed," and conflating them is how a gate starts lying in the reassuring
direction.

One entry was moved the other way for the same reason. `src/mcp/cli.ts` sat in
the baseline — which asserts *nobody can run this* — while four npm scripts
(`mcp:context`, `mcp:audit`, `mcp:issues`, `mcp:dna`) invoke it through `tsx`.
A deletion pass reading the baseline as a to-do list would have taken it. It is
now declared reached, with those scripts as the mechanism.

### Eleven contracts moved, not deleted

`tests/contracts/` now holds the frozen prospective specifications: the
development, institutional-judgment, production-reachability, reconstruction and
four responsibility benchmarks, the support-drafting benchmark, support-pilot
readiness, and the recursive-institution contract.

These are **not** production code and never were. Each was frozen *before* the
behaviour it scores, so thresholds could not be tuned to whatever the
implementation happened to do; each is consumed only by a test. The reachability
gate's own words decide it — "a module that only its own test reaches is not
covered by that test in any sense the evidence ladder recognises." Moving them
makes the classification true rather than baselined, and deleting them would
have destroyed the one property that gives them value.

### Fifty-three modules, 13,843 lines

The commercial estate: the investor and exit suites, the intelligence
modules, the briefing and memory and coordination services, the fleet
observatory, the truth engine, the demo composer. Every one of them
unreachable from `src/index.ts`, the four doors, the CLI or the test runner.

### Three live modules were still reading tables nothing could write

These could not simply be deleted, because production reached them:

- **`ai/calibration.ts`** read `founder_psychology_insights` to shape the
  founder's system prompt. Its writer was `intelligence/psychology.ts`, so the
  query returned nothing on every call and assigned an empty list over the
  default — the same value, reached by a round-trip. Auto-calibration now
  derives only the sector agreement, which it can observe. The field stays,
  because `updateProfile` writes it directly and a genuinely known pattern can
  still be recorded. What is gone is the pretence that Foundry *infers* it.

- **`network/failure-library.ts`** — **the sharp one.** It counted
  `fundraising_scores` rows to decide `no_fundraising_activity`, a criterion of
  the **critical** Runway Crisis pattern. With no writer the count was
  permanently zero, so the criterion permanently MATCHED, and the founder was
  shown *"No fundraising activity recorded in the last 90 days"* as a warning
  signal. **An absence of measurement reported as an absence of activity.** The
  institution cannot see whether this founder is raising money, so it may not
  say anything about it. The pattern now matches on runway alone and the
  description no longer claims otherwise.

- **`scp/roi/calculator.ts`** aggregated `recommendation_outcomes`, whose
  writers were exported and called from nowhere, into `roi_monthly_summaries`,
  whose only reader was the `/roi` page deleted with the commercial product.
  The monthly job `scp_roi_monthly` ran it over every operating product. Both
  ends gone: a round-trip per company per month to record that nothing had been
  measured. Job and calculator removed; an epitaph stands where the job was.

### Thirty-one tables (migration 311), in two rings

The first ring is the twenty-nine the gates named, children first —
`playbook_exports` holds the only foreign key into the set. The second ring was
found by **running the gates again** rather than by guessing: `memory_nodes`
was held up only by `memory_edges` and `decision_counterfactuals`, and became
unreachable in both directions the moment they went.

`business_model_profile` was the mirror image of the writerless case — written
only by the demo seeder, read by a deleted module. The seed write went with it.

### A fabrication found on the way past

`benchmark_contributions.team_size_bucket` and `.mrr_bucket` are `NOT NULL`
with CHECK lists of five values each, **neither of which has an "unknown"
member**. No caller supplies the real figures, so the writer fills them with
constants: every contribution is filed as a one-person company earning under
$1k, including this one.

It is harmless *only* because nothing reads them — `refreshPercentiles`
segments strictly by `(lifecycle_state, company_category)`, and their previous
reader was deleted here. They are in the write-only baseline deliberately, and
the reason is now written at the write site, including the warning that
anything which starts segmenting on them is wrong until a caller passes real
values. If that day comes the honest first step is a migration adding
`'unknown'` to both CHECK lists, so not-measured stops having to masquerade as
measured.

### The ratchets

Almost entirely tightening. `write-only-columns` **net −17** (three deliberate
additions, each with its reason written where the column is written; seventeen
removals). `unread-tables` −2. `unreferenced-tables`, `writerless-tables`,
`unreachable-modules` all at **zero with no baseline at all**. `console-in-src`
187 → 183. `schema.snapshot.sql` **−471 lines, none added**.
`CONSEQUENTIAL_EFFECTS.json` −14 lines, none added.

## System B, retired — 14 September 2026

The second visual system is gone. Until this tranche the application shipped
**two** of them: `views/layout.ts` served `public/styles.css` — 1,728 lines, a
twenty-five item sidebar, a five-tab bar, a command palette — to Commercial
Foundry's pages, and `views/owner/shell.ts` served `public/owner.css` to the
owner's six doors. The commercial pages were deleted in the previous tranche.
The stylesheet, the layout, the component library and the markup that named
them survived it by a week.

### What moved, and onto what

- **`/settings` and `/privacy` are Controls now.** Both rendered through
  `settingsPage`/`dashboardLayout`; both now render through `page()` under the
  Controls door, with a breadcrumb that says where they are. Four sections of
  `/settings` were deleted rather than moved — Profile, Repositories,
  Competitors and Beta (all `settingsPage`, all reading tables empty in this
  instance), **Subscription** (three plan tiers and a card), the **Wisdom
  Network** framing (an offer to contribute anonymised patterns to a network of
  one — the two benchmark tables are empty and the percentile floor needs five
  contributors), and **Investor/Advisor Access** (a share link for people this
  institution does not have; zero of thirteen products had ever generated one).
  The pace control inside the Wisdom card was real and kept, under its own name.
- **`/letter` became a place.** Five renders moved to `page(..., 'advanced')`,
  a depth the shell now knows about: it draws no lit door and no footer link
  back to itself, because it is not one of the six.
- **`views/layout.ts` and `views/components.ts` are deleted.** `LayoutOptions`
  moved to `routes/dashboard/_shared.ts`, trimmed to the fields the context
  actually carries.
- **`views/error-page.ts` is self-contained.** It deliberately does not use
  `page()`: a 404 is not a place, half the people seeing it are not signed in,
  and offering the estate's navigation would be offering doors that refuse them.
- **The auth pages** (`routes/auth/clerk.ts`) came off `styles.css` and off
  `#0f172a`, Commercial Foundry's slate, which had been hard-coded in three
  inline style blocks. Signing out now lands on `/auth/login` rather than
  bouncing through `/` to a protected route.
- **The service worker** had two offline pages: the owner's, and a second one
  built on the deleted stylesheet with two custom properties nothing declares.
  One surface, so one page — and it carries its own style rather than linking
  one, because a cached stylesheet is exactly the asset most likely to be
  missing at the moment that page is needed.

### The vocabulary the markup was still speaking

Deleting a stylesheet does not fail loudly. A class that matches no rule draws
unstyled; an undefined custom property makes the **whole declaration invalid**,
so the property is dropped and the value inherits. `--text-primary` was used
fifty-five times and declared in neither sheet — every one of those
declarations had always done nothing, and it looked right because what it
inherited was the body colour.

So: an alias layer in `owner.css` (each alias resolving through a real token, so
the light block and the explicit toggle carry them for free), the switch moved
into the stylesheet as one rule instead of forty inline declarations carrying a
green (`#4ecca3`) from no palette this deployment ships, `<pre>` and `<code>`
given rules at last, and **56 hard-coded colours** across the Letter, Controls,
Privacy and Connections replaced with palette tokens.

`tests/unit/one-stylesheet-one-vocabulary.test.ts` holds all three claims and
was watched failing on each: a planted class, a planted property, a planted hex.

### The button that could be wider than the phone

`a-button-wider-than-the-phone.test.ts` measured the OTHER stylesheet — `.btn`
carried `white-space:nowrap`, so a 468px call to action sat in a 390px phone.
That sheet is gone; the invariant is not, because `owner.css` has three rules
that set `width:auto` on a button inside a flex row, which is the same shape.
The test moved rather than being deleted, rewritten for a mobile-first sheet:
`.btn` is now bounded by `max-width:100%`, the pair's `nowrap` moved to the desk
where there is room for it, and the only elements left refusing to wrap on a
phone are two that sit inside `overflow-x:auto` rows that scroll themselves.

### Eighty-nine middleware mounts that guarded nothing

`src/index.ts` registered auth, CSRF and rate-limit middleware on **fifty-nine
path prefixes with no route behind any of them**: `/investors`, `/board`,
`/benchmarks`, `/playbooks`, `/roi`, `/team`, `/memory`, `/network`, `/exit`,
`/scenarios`, `/ambient`, `/integrations`, `/agents`, `/dashboard`, `/plan`,
`/checkout`. Harmless at runtime and misleading to read: a reader checking
whether a surface is protected finds a mount and stops there.

**The one thing in that list that was not dead** was the per-user AI rate limit,
mounted on `/api/ask`, `/api/chat`, `/decisions`, `/validate` and `/plan` — all
deleted — which left the two paths that actually call a model from a user's
request (`POST /foundry/ask`, `POST /talk/message`) with no cap but the AI
client's per-product daily ceiling. They are named directly now.

The crawl checks the other direction on every run — a route with no auth in
front of it is a defect there — so the two halves are held from both ends. It
reports 188 mounted routes, 0 findings.

### What else the deletion orphaned

`check-reachability` named them as their callers went; each was deleted rather
than re-wired, and the tables underneath went with them (migration 312):

- **`middleware/tier-gate.ts`** — sixteen feature gates at three subscription
  prices ($79/$199/$399), most naming features whose tables were dropped in
  migrations 309 and 311. With it went `requireTier`, its upgrade page, the
  `ux:gate` CLI command, `FeatureGateConfig`, and `canAccess` from the page
  context, where nothing had read it. `services/billing/entitlement.ts` is the
  live mechanism and is a different question: whether a commercial instance has
  lapsed into read-only, which is about payment rather than plan.
- **`services/wisdom/dna-autofill.ts`** — read a founder's README, landing page
  and Stripe descriptions and asked a model to extract an ICP. Its only caller
  was the onboarding wizard's audit step.
- **`lib/validation.ts`, `middleware/validate.ts`** — body schemas and the
  validator for the nine deleted wizard routes.
- **`services/audit/progress.ts`** (+ `onboarding_audit_progress`) — the
  step counter behind "Analyzing your product… step 4 of 9". The page polling it
  was still in the tree after its route was deleted, HTMX-refreshing a 404 four
  times a minute for as long as anyone left it open.
- **`services/ux/hints.ts`** (+ `dimension_hints`) — a model-written tooltip per
  audit dimension, generated at the end of that same first audit.
- **`auditRateLimit`** — six an hour on the most expensive thing a stranger
  could make this deployment do. There is no longer a route that does it.
- **`gate_events`** — which feature a founder hit a paywall on, and which plan
  they were on when they hit it. Written only by `requireTier`; never read. It
  survived `check-unreferenced-tables` because the privacy erasure map named
  it, which is a promise to delete on request rather than a use — and with the
  writer gone there is nothing left to delete. Its erasure entry went with it.

`routes/dashboard/onboarding.ts` is 697 → 148 lines and holds one act: naming
the first company and binding it to the `foundry` identity.

### And the page whose token nothing could mint

`GET /share/:token` showed a company's Signal score, its latest metrics and its
last five approved decisions to anyone holding the token — the read-only view an
Investor-Ready subscriber gave to investors and advisors. The control that
generated and rotated that token was the Investor/Advisor Access section of
`/settings`, deleted above. With nothing left writing `products.share_token` the
page could only answer 404: a public, unauthenticated surface reading a
company's decisions, standing open for a credential that can no longer exist.
Deleting the control and keeping the page would have been the worse half to
keep. `/share/refund/:fulfilmentId/:token` stays and is a different thing
entirely — its token is minted per fulfilment when an Apex Micro buyer is sent
their delivery, and the page is how they get their money back without writing to
anyone.

### One defect found by the tests rather than by reading

`services/privacy/consent.ts` erased rate-limit buckets matching
`audit:founder:%` and nothing else. `ai:founder:<id>` has existed exactly as
long, and an erasure deleted the audit bucket while leaving a bucket with the
same person's id in it. The written reason named only the one prefix, which is
how it survived: **a reason nobody can check is how a misclassification lasts.**
Both prefixes are now matched — the old one because rows written before this
deletion are still in production, and are exactly what an erasure has to reach.
The clause is parenthesised because the executor composes it as
`<subject> AND <where>`, and an unbracketed OR would bind the founder-id match
to only the first arm. Watched failing with the new arm removed.

## Phase 4 — the economic nervous system, built — 14 September 2026

The plan above was written before the work. What follows is what the work found,
which differs from the plan in three places, each because reality did.

### What was built

**One append-only ledger** (`economic_events`, migration 313) with a closed
vocabulary of twelve kinds, each row carrying the provider statement it came
from, a `claim_quality` of measured or estimated, and a sentence saying why it
exists. Append-only in the SCHEMA — two triggers refuse UPDATE and DELETE — so a
correction is a new row that says what it corrects, the way a provider's own
ledger works.

Four guards at the write site, each watched failing:

- an estimate cannot exist without the assumption that produced it;
- a measured figure cannot quietly name one (the moment an assumption touches
  it, it is an estimate, and the column must say so);
- a cost that belongs to one unit must name the unit, or it silently vanishes
  from contribution;
- a `charge` must point at the outcome event that recorded it, so gross can
  never be asserted without the provider's own statement behind it.

**One assumptions table** (`economic_policies`), scoped to a founder, holding
the tax rate and the operating floor. Supersession rather than update: what the
institution believed in March is part of why it held back what it held back.
Every policy must say where the number came from, in the owner's words.

**Deterministic projections** (`services/economy/projection.ts`): money held,
obligations outstanding, refund exposure, the tax reserve, the operating floor,
already-authorised capital, per-unit contribution, the ledger itself, and what
running this has cost. Plain functions over canonical rows, no model anywhere
near them, cheap enough to run on the Home screen — which they now do.

**One place** (`/foundry/money`, in "Also here" beside Discover and the
Workshop, not a seventh door) that shows the whole subtraction and offers
exactly the three things that turn a "not known" into a number: record what you
assume about tax, set the floor you want kept, record money you actually moved.

### The first finding: the Stripe account is shared, so "cash" is two questions

`docs/stripe-shared-account.md` is explicit — one live account serves the
personal land sales, AcreOS and Foundry, and the land sales are "the only live
money in the account". A charge is attributable because it carries an `app`
tag. **A payout is not**: it is a lump of the shared balance moving to a bank,
mixed by construction.

So the plan's "Cash — no table says what has actually settled into an account"
could not be answered the way it was framed. Reading `payout.paid` as Foundry's
cash would report somebody else's money as this institution's, which is the
worst error available on this surface. The projection splits the question:

- **Held** — what is ours inside the provider's balance, measured.
- **Banked** — NOT KNOWN, and the page says why in one sentence. The owner can
  record what he actually moves, and then it is measured.

Surplus is computed from HELD, which is the conservative choice: it treats money
as available before it has cleared, so every deduction comes off the larger of
the two numbers.

### The second finding: the refund promise has no time limit

The plan said "a delivered brief inside its refund window is a liability" and
"nothing models the window". **There is no window.** Apex Micro's refunds page
says, in these words: *"No form, no time limit, and you don't have to explain."*

So refund exposure does not decay. Every delivered unit that has not been
refunded stays a liability for as long as the promise stands, and the projection
is written that way — with a test that ages a sale eight hundred days and
asserts it is still fully exposed. A ninety-day tail would have made surplus look
larger on the strength of a promise nobody made. Changing that means changing a
public page, which is the owner's to do and not something to assume in a query.

### The third finding: the fee is not in the webhook

Stripe sends `balance_transaction` as an id, not as an object, so what the
provider took requires one API read. When that read is unavailable — no key, an
outage, a refusal — **no fee row is written**, and the unit's contribution reports
itself as not known. It does not assume 2.9% + 30¢.

That choice is the whole discipline of this phase in miniature: on a $29 sale
the fee is the largest single deduction, so a guessed fee reports almost the
whole price as margin. "$0.00" and "not known" are different facts, they are
drawn differently on the page, and the not-known spreads — a unit with no fee has
no contribution, a total with one such unit has no total, and a tax reserve whose
basis is unknown is unavailable rather than zero.

**One refinement in the other direction**, found by a test: a fraction of nothing
is nothing whatever the rate, and an unset floor keeps back nothing. So an
institution that has earned nothing knows exactly what is the owner's: none of
it. Answering "not known" there was a shrug dressed as rigour.

### Two boundaries the gates found

- `owner_allowances` joined `products` with no reality boundary, so an allowance
  standing against a **reference** company would have quietly reduced the surplus
  the owner is told is his, on the strength of a company that does not exist.
  `realCompany` now scopes it.
- The **existence** boundary deliberately does not apply: an allowance against an
  experimental asset is money the institution may spend today, and most of this
  owner's money is authorised for experiments. Scoping it away would report a
  surplus that is already committed. Recorded in the baseline with that reason.

### One layer moved

The economic ledger has to ask Stripe what it took, and `services/billing/
stripe.ts` is classified `commercial`. A kernel importing it would be the shared
institution assuming there is something to sell — the assumption
`instance-posture` exists to undo. The Stripe CLIENT moved to
`services/economy/provider-stripe.ts` (kernel) and billing borrows it, which is
the direction the boundary allows. One client, one key, a dependency pointing
the way it is permitted to point.

### What was not built on speculation

Foundry has taken no money. Every surface above says so in words rather than in
zeros, and the Home tile that used to read "Settled — $0" now reads "Yours",
which is a different question and the one that was always being asked.

## Phase 5 — Portfolio, Discover, the autonomy map, the roadmap — 14 September 2026

Portfolio (`/foundry/companies`) and Discover (`/foundry/searching`) already
existed and were built in earlier phases. What was missing was the pair of
questions an owner of several things actually asks, neither of which had a
surface: **what can this thing do without me**, and **what is it carrying**.

### The autonomy map — and the section that vanished when it mattered

Controls is titled *"What I'm allowed to do"*. Its Permissions section was
written `s.permissions.length === 0 ? html\`…\` : ''` — so it rendered the words
"**None.** I can look at things and tell you what I find" when nothing was
granted, and **rendered nothing at all the moment anything was**. The one screen
whose job is to answer that question went silent in exactly the state where the
answer matters.

`services/founder/autonomy-map.ts` reads the estate through the per-company
`authorityOf` that already existed, and adds the thing a per-company reading
cannot have: **an estate's autonomy is its loosest point, not an average**. One
company set to carry with money left is the answer to "what can it do without
me", whatever the other four say — so the list sorts by reach and the sentence
leads with it.

Money is counted as what is LEFT rather than what was granted, the doors the
owner shut are shown in his own words, and every widening or narrowing still
happens on the company's own page, one sentence at a time, because that is where
the confirmation and the fingerprint live. Reading the map changes nothing, and
a test asserts that by reading it twice and comparing the rows.

A reference company never appears. Telling the owner that the institution may
act on its own somewhere, on the strength of a company that does not exist, is
the one answer this page must never give — and the test plants exactly that.

The **existence** boundary deliberately does not apply here, which is the
opposite call from the usual one: an experimental asset is where this
institution's authority actually bites — the money is authorised for experiments
and the acts that reach strangers are placed from them. A map that showed only
earned companies would omit the companies things happen at.

### The roadmap, which is a record rather than a plan

Every product has a roadmap page and almost all of them are the same lie: a list
somebody typed once, never closed, true only on the day it was written.

`/foundry/roadmap` has **no table of its own**. It reads `undertakings` — what
the institution took on for a company, the owner's words kept verbatim where he
said them, what it was understood as before anything bound, and the steps
recorded against each — plus what has actually been spent through the acts
proposed inside each thread. So it shows: what is under way, what was last done
about each, what it cost, what it is waiting on, and what was dropped and why.

**It has no writer, and that is the design.** No route under it opens an
undertaking; the only form it offers stops one. Taking something on binds what a
sentence was understood as, and that belongs where the owner says it — in Ask or
on a company page, with the understanding shown before it holds. A roadmap you
can type into is a wish list; this is a record of load. The test asserts the
absence: no POST, no `openUndertaking`, no INSERT, and every form action ending
in `/stop`.

Home's Now/Next strip gains a third line — *Carrying: n things · what they are*
— because "what are you doing" means both the live test's state and everything
else, and only one of them was answerable.

### Still six doors

Money and the Roadmap sit in "Also here" beside Discover and the Workshop. Nine
tabs at 375px is forty pixels a tab, which is not a door; a test now pins the
six by name so a seventh cannot arrive quietly.

## Phase 6 — the forge, and what Experiment 001 taught — 14 September 2026

### The forge reads rather than invents

An experiment is the most expensive thing this institution does: it reaches
strangers, spends money, and produces a claim the rest of the estate leans on.
"What should we test next" is therefore the question where a fabricated answer
costs the most — so `/foundry/experiments/next` does not answer it. It reads:

- **The questions nobody has answered**, from `market_unknowns`, blocking
  before untidy and oldest first — the only ordering the institution has
  honestly written down. A question with no cheapest test says so, because a
  question nobody knows how to settle is not yet a test.
- **What earlier tests established, and what they explicitly did not.** The
  second half is the useful one: `cannot_prove` is recorded at DESIGN time,
  before the test runs, which is what makes it evidence rather than a
  rationalisation composed afterwards.

**There is no button that composes a design**, and a test asserts the absence:
no form, no `recordDesign`, no `designExperiment` in that section. Designing a
test means saying what it decides, what it would prove, what it would not, what
would stop it and what each answer would mean. Those sentences are the owner's
or they are nobody's — a design the institution composed would be it marking its
own homework, and the deliberation is the only thing standing between a test and
an expensive opinion.

### What production showed: a table holding two different kinds of thing

Reading the live `market_unknowns` while building this surface found it holding
questions and **readings of a source** under one column, told apart only by a
prefix the writer happened to use:

```
whether anybody would pay for it, which nothing read so far can answer
unclear from the source: It's unclear whether this is a one-off annoyance …
it could instead mean: This could just be a passing technical question …
```

The first is a question you can put to the world. The other two are what a text
might have meant and how it might have been misread — they belong in the record,
because a candidate built on a reading should carry the ways that reading could
be wrong, and **no amount of contacting strangers settles either of them**.

It was not merely untidy. `matchRealityOnly` marks an unknown BLOCKING by
phrase, and several source notes in production were marked blocking because the
ambiguity they describe happens to be about whether somebody would pay. A forge
that ranked by blocking would have put *"it could instead mean: this could just
be a passing technical question"* at the top of what to test next.

**Migration 314** gives them their own kind (`question`, `source_ambiguity`,
`alternative_reading`), backfills by exactly reversing the one writer that
composes those two prefixes, and clears `blocking` on the notes — a note that no
test can settle cannot be what stops a decision. `discovery.ts` now records the
kind rather than leaving it to a prefix somebody might grep, and a row matching
neither prefix stays a question, which is the safe direction.

### Experiment 001 as curriculum

Its design carries the limit that makes it teachable, written before it ran:

> *"Twenty-five hand-picked shops reached by cold email inside seven days cannot
> establish a market, a price, a channel that repeats, or a second purchase —
> and at one payment I cannot tell a buyer from a well-wisher."*

That sentence is what the next design has to answer to, and the forge puts it in
front of whoever writes one. Nothing about Experiment 001's cohort, price,
message, strata, rollout or stop envelope is touched by any of this.

## Phase 7 — quiet maturity, absence, and what thinking costs — 14 September 2026

### The measurement that started it

Nothing in this repository asked whether a model call was worth making. A loop
was scheduled, the loop ran, the bill arrived. Reading `ai_spend_reservations`
in production for the fortnight to 14 September 2026:

| model | calls | cost |
|---|---|---|
| sonnet | 1,030 | $14.53 |
| opus (the frontier) | 16 | $0.31 |
| haiku | 53 | $0.04 |

Two facts in that table are worth more than the total. **The frontier model is
not where the money goes** — sixteen calls, two per cent — so the optimisation
everyone reaches for first was not available here, and saying so is more useful
than inventing one. And **878 of the 1,099 calls carry no purpose at all**: the
institution spent $10.10 of $14.88 without being able to say what it was
thinking about.

Daily spend over the same fortnight: 21¢ on 1 September, 169¢ on 14 September.
**Eight times, in fourteen days.** A healthy mature Engine is supposed to get
quieter.

### Where it actually went

752 of the 878 anonymous calls land in the 04:00 hour, scoped to one company.
`job_health` puts `scp_evolution_cycle` at 04:00:00 to 04:06:47, and the
arithmetic closes exactly: three operating companies × nine agents × two calls
per synthesis = 54 a night, which is what the timeline shows.

What eleven nights of it produced:

- `agent_evolution_versions` — 36 rows, **every one** `initial_provision`, all
  dated 3 September 2026, the day the agents were created.
- `evolved_prompts` — **empty**.

About six hundred calls, roughly $8.30, and not one of them changed anything.
Most nights it re-read *the same five sessions*, because no new session had
completed since the night before. The institution was paying to re-read an
unchanged document and ask an unchanged question.

### Three reasons to sleep

`src/services/ai/cognition.ts` and **migration 315** (`cognition_occasions`) let
a loop answer, before it spends anything:

1. **There is nothing to consider** — no material at all.
2. **Nothing has changed** — the input digest is identical to last time, so the
   answer would be too, and paying for it again buys a copy.
3. **It has never once mattered** — the question has been asked five times over
   *changing* material and has not once changed anything.

The third is the crystallisation: a question asked repeatedly with the same
answer has become a fact, and a fact is cheaper than a question. It is
deliberately a **backoff to weekly, not a deletion** — a question that has never
mattered may come to matter, and an institution that can never be surprised is
not cheap, it is blind.

Two failures are guarded by name, because they are how a sleeping institution
lies to itself:

- **A sleep is never evidence that thinking would have been fruitless.** Only
  occasions that actually thought can testify. Otherwise a loop that slept five
  nights for want of new material concludes the question never mattered — from
  five nights in which it never asked it. `changed_something` is NULL on a
  slept occasion rather than 0, in the schema, for exactly this reason.
- **An occasion that DID change something outvotes any run of fruitless ones.**

A third failure was found by reading the code back rather than by a test: the
counts were first taken from a window of the last fifteen rows. Once the backoff
engages the rows are mostly *sleeps* — six a week against one thought — so within
a fortnight the thoughts scroll out of any fixed window, the fruitless count
collapses below the threshold, and **the settled question quietly resumes asking
itself every night**. A settled question that un-settles itself on a technicality
is worse than one that never settled, because nobody would ever notice. The
counts are now two indexed aggregates over the whole history, and a test walks a
fortnight of the settled rhythm and asserts it stays settled.

Wired at the one site the evidence points at: `runEvolutionSynthesis` digests
the five sessions it would read, by identity and completion time, and puts the
question to `shouldThink`. The loop is not deleted and the agents are not
disbanded — cheapening a loop is a decision the evidence supports; deciding
whether the agents should exist is the owner's.

The erasure classifier caught it, as it caught the economic ledger in Phase 4:
`cognition_occasions` was the single UNCLASSIFIED table in a schema whose
classification is meant to be total. It is `not_company_data`, and the tension
is written down rather than glossed — `about` is an opaque key the caller
chooses, and today's one caller composes it from a product id, so a company's id
can appear in it. Nothing else about the company does: no content, no numbers,
no person, only whether a question was asked and whether asking changed
anything. That is a fact about what this institution chose to spend money
thinking about.

The retention gate caught a second thing on the way. `cognitionEconomics` read
`ai_spend_reservations` directly, and that table survives an erasure **for
accounting and ceiling enforcement only** — a disposition that lets a table
outlive an erasure is a promise about what will be done with it afterwards, and
a reader somewhere else is exactly the later use the promise excludes. The
reader moved into `spend-ledger.ts`, where the promise is kept, rather than the
promise being widened to reach it.

### What the most expensive model has to say for itself

`src/lib/frontier-warrant.ts` names every file that reaches the frontier model,
what it asks, and why. The test has two halves and **both must hold**:

1. **Being wrong is expensive** — the output changes what the institution does
   or what it tells the owner about money, law, or a company in trouble. Not
   "the answer is better": better answers are always available for more money,
   and that is not an argument for anything.
2. **The occasion is rare** — a thing that happens nightly has, by the end of a
   year, spent 365 times whatever it costs.

Most frontier use fails the second half, and it is the half nobody checks.
Twelve call sites were audited; eleven kept their warrant, two of those are
marked `watched` because they run on a cadence rather than an occasion and
survive on the first half alone. One failed outright and was moved to the
operational model: `dailyInsightGenerate` asked for 120 characters of
already-gathered context, 400 tokens, every company every day — and it was
essentially the whole of this institution's frontier spending.

`scripts/check-frontier-warrant.mjs` runs in `npm run check` and fails four
ways: a file at the frontier with no entry, more call sites than the entry
claims, an entry for code that no longer reaches it, and a warrant too short to
be an argument. Two tests deliberately break the table and assert the gate
fails — a gate nobody has watched fail is a gate nobody has tested.

### If you stepped away — seven, thirty, ninety days

`src/services/institution/absence-test.ts` and `/foundry/absence`. Five
properties, three horizons, and **no number that averages them**: an institution
that is truthful and unrecoverable is not seventy per cent fine.

- **TRUTHFUL** — would silence be mistaken for calm? A company with nothing
  connected and a routine that has stopped both produce a screen saying nothing
  is wrong, from an institution that would say the same if everything were.
  Built first on the two named `INSTITUTION_LOOPS`, and that was not enough:
  production had `behavioral_triggers` failing **forty-nine times in a row**
  since 1 September with nothing the owner could open saying so. It fails
  closed — no mail is sent — which is the right failure and is exactly why
  nobody noticed. The reading now names any routine that has failed three
  consecutive times.
- **BOUNDED** — a ceiling per day is a *rate*, not a ceiling, so it is
  multiplied out to the horizon. Any authority with no end date fails outright,
  whatever its size: the question is not how much, it is whether it stops on
  its own.
- **UNDERSTANDABLE** — every step from a payment to what is his, each carrying
  how it was arrived at, and the chain is never stronger than its worst link.
- **RECOVERABLE** — copies are kept for fourteen days, read from the volume
  rather than from the policy constant. That covers a week. It does **not**
  cover ninety days: a bad migration on the second day of a three-month absence
  would have had its last clean copy deleted seventy-six days before he opened
  his laptop.
- **ONLY GENUINE DECISIONS** — will what is waiting still be waiting? A
  proposal that lapses on day twenty of a ninety-day absence was not deferred to
  him; it was **decided by the calendar**, and he comes back to a screen showing
  nothing waiting because everything waiting already timed out.

The point of the whole file is that the answer is allowed to change with the
length of the absence, and where the horizon outruns the evidence the finding is
**CANNOT ESTABLISH** rather than a pass by default. One row, two horizons, two
answers — and the longer one is the truthful one.

The reading is a read. Nothing in it schedules, alerts, acts or spends: the test
for a quiet institution must itself be quiet.

### What running it against production said, and the defect that found

Deployed and run against the live estate, the three horizons answer:

| | 7 days | 30 days | 90 days |
|---|---|---|---|
| truthful | does not hold | does not hold | does not hold |
| bounded | holds | holds | holds |
| understandable | holds | holds | holds |
| recoverable | **holds** | **does not hold** | **does not hold** |
| only genuine decisions | holds | holds | holds |

Two things are quiet for a reason that is not calm: **Foundry itself has nothing
connected to it**, so silence from the one real earned company means nothing;
and `behavioral_triggers` has failed forty-nine times in a row. Bounded is a
real number — at most $35 over a week and $450 over ninety days, every
permission ending by itself. Recoverable changes with the horizon exactly as
designed: eleven copies reaching back ten days covers a week, and a fault in the
first eighty days of a ninety-day absence would have no clean copy left.

And it exposed a defect in this tranche's own work. `only genuine decisions`
printed the *same sentence twenty-two times* — twenty-two `venture_experiments`
rows, one per person the offer would be shown to, all carrying the identical
question. A property whose whole job is to say whether what is waiting is
genuinely his cannot itself be the noise that teaches him to stop reading it.
They are grouped by what the test actually does, with the count kept: twenty-two
people is a fact about the size of one decision, not twenty-two decisions.

### The gate that had only been measuring the front page

`measure-mobile.mts` covered Home, Portfolio, a company, Controls, the
experiments and the Workshop — and not Money, the Roadmap, Decisions, the Inbox,
Discover, the Forge or this new page. A gate that measures only the pages
designed most carefully measures the wrong thing: lists, tables and nested
details are where a phone layout actually breaks. All seven are in it now, and
the desktop screenshots with them.

Adding their paths was not enough, and the gate said so. The harness mounted
only three routers, so the seven new paths returned clean-looking **404s** —
scrollWidth equal to innerWidth on a bare error page, which overflows nothing
because there is nothing on it. It failed anyway, because it checks the status
as well as the width: **a page that did not render is not a page that fits.**
With the routers mounted: 299 measurements, every one 200 and inside its
viewport, at 375/390/393/414/430 px at 100% and 200% text and at 1024/1280/1440
on a desktop.

## Closeout — truth, owner burden, recoverability — 14 September 2026

The tranche was substantially complete and several things in the final proof
were wrong. This closes them rather than opening anything.

### Experiment 001, reconciled from the rows

The report said "21 of 25 written to, 4 questions back, 1 opt-out", and
separately "11 pending". Every number was a real count of a real table.
Together they described an experiment that does not exist.

| | | |
|---|---|---|
| authorised cohort | **21** | one act, `AEk3lSzEsRiJBCz1ggwk2`, decided by the founder 12 Sep 18:33, consumed 23:20 |
| sent / provider-accepted | **21 / 21** | every one carries a Resend receipt |
| delivered | **19** | verified afterwards |
| bounced | **2** | both real, both suppressed |
| **replies from the 21** | **0** | no mail from any approved recipient |
| opted out | **0** | the one suppression is a `.test` address, two days *before* the send |
| purchased | **0** | no fulfilment, no economic event |
| proposed, never approved | **10** | candidates; no act, nothing sent, nothing may be |
| struck | **3** | with reasons on the rows |
| **remaining authority** | **none** | the act is consumed |

The act never grew: every approval predates it, there is exactly one, and its
own summary names the number. The "four questions" were rehearsal traffic —
`.test` addresses, the SES simulator, a DMARC report, the owner's own mailbox.
The "eleven pending" were internal agent proposals belonging to no experiment.

`reconcileExperiment` computes all of it from source rows, each count carrying
what it is and what it excludes, and it immediately caught a defect in itself:
replies were matched on address across *all* mail rather than scoped to the
founder.

### An undesigned test is not a decision

Twenty-two rows sat in the owner's queue across twenty unrelated opportunities,
each the identical boilerplate stamped once per opportunity by a scheduled job.
None said who, at what price, through which channel, or what would stop it. A
`probe_designs` row is now the line — its columns *are* the design, and all of
them are NOT NULL.

### The society is no longer on a timer

Twelve agents, twenty-seven scheduled loops, a fortnight: ninety sessions,
thirty-six briefings, eighteen messages to each other, **eleven proposals and
not one ever approved** — ten already expired unread. Every row in
`agent_evolution_versions` is an initial provision; `evolved_prompts`,
`agent_accuracy_scores`, `agent_remediations` and `agent_audit_log` are empty.
**Nothing behind the six doors reads any of it.**

They assess MRR, OKRs, churn and the sales/product/CS functions of a SaaS
company — Commercial Foundry's shape, describing the absence of a business that
does not exist here. The schedules are retired into `RETIRED_LOOPS`, each with
what it used to do; the code is preserved, because it is reached at boot and by
two live routes and deleting thirty-nine modules to stop a cron is a larger
change than the noise it removes. Two hygiene loops stay: expiring overdue
decisions, which the Decisions door reads, and webhook retention.

### Recoverability, with restoration evidence

Fourteen flat days answered the seven-day question and none of the others. Now
a ladder — dailies for a fortnight, Mondays for three months, firsts for a year
— compressed, about 95 MB of a 974 MB volume, no new provider and no owner
decision. Thinned by the **date in the name**, because a restore or volume move
touches every mtime at once. `restoreTheInstitution` refuses to write over the
live database, and a test restores a real compressed copy and reads the
institution out of it. Until that passed, no horizon was a claim worth making.

### And the codebase corrected me

Self-observability was first built inside `services/institution`, resolving
which product row is Foundry so the estate reading could exempt it from being
called blind. `recursive-institution` refused it: the kernel must not be *able*
to ask whether it is operating Foundry, because a kernel that can ask will
eventually answer by shortening a ladder or widening a grant. Rebuilt as
`deployment/self-check` — five readings, no product id resolved anywhere,
asserted from the source, each able to say "I cannot tell". Foundry stays an
ordinary company with nothing connected to it.

## The clean cutover — what the owner's surface runs, and where

The doors went in around three surfaces during the phases and nothing ever
pointed at them again. Closing them out is the last of the cutover.

### The conversational surface is retired

`/talk` was a free-form chat: the owner typed prose, a model read the ledgers
and replied, and a claim it recognised became a monitored premise. **No
navigation anywhere linked to it** — the only way in was to type the URL.

What stands in its place is the composer at the foot of every page, and the
difference is the doctrine: it matches what was typed against questions this
institution can answer FROM ROWS, and answers on the page where the subject
already is. A model that reads the ledgers and writes a paragraph is the
deepest interface and the shallowest institution — the one surface where being
wrong costs nothing to produce and everything to trust.

The service is deleted rather than kept dormant: nothing else reached it, so
keeping it meant an unreachable module and a baseline growing to accommodate a
page nobody could find. Its dependencies all have other callers.

It cost two things, both recorded rather than absorbed. The self-audit for
over-deference sampled chat turns and notifications; it now has one source, and
says how narrow the sample is. And `conversation_messages` became a table read
by live code and written by nothing, which the gate caught in the same run.

### The autonomy ladder governed nothing

`/autopilot` offered per-category promotion — watching, then suggesting, then
acting on an explicit grant — over marketing, outreach, product evolution and
customer success. Every one of the twelve policy rows in production sits at
`shadow`, each written by a seed at a round hour on consecutive days. `decisions`,
the table it counts clean cycles from, is empty. The tables its evidence would
live in do not exist in this schema. And the only code that reads a grant is the
SCP playbook engine, whose loop is retired.

Granting `act` there would have authorised nothing, on the page whose whole job
is to say truthfully what Foundry may do. **A control that does nothing is worse
than an absent one: it is a promise about autonomy nobody can check.** The page
redirects to Controls, which states the position from the same table — every
kind of work at watching only, and no button, because the part that would act on
such a grant is not running.

### A correction belongs beside the thing corrected

"What I understand about this" — what Foundry believes a responsibility to be,
and the owner's correction of a fact that has stopped being true — lived at
`/letter/responsibilities/:id/understanding`, one of thirty-odd endpoints behind
a door labelled *inspect the system*. It is now inside the company, under the
list of what Foundry looks after. The old address 308s, resolving the company
from the responsibility, because it never carried one.

It printed the same sentence nine times: a fact nobody had stated got its own
paragraph saying so, so one answer sat buried among eleven near-identical
refusals. The gaps are one fact — which things I do not know — and read as one
sentence now. The same defect as a queue asking one question twenty-two times.

### `'unsafe-inline'` now covers only the sign-in pages

The private surface renders text written by strangers, and a quoted comment once
reached the owner's first screen as live markup. The policy could not help
because `script-src` carried `'unsafe-inline'`, which permits exactly the inline
handler an injected tag uses.

When that was written there were fourteen inline script blocks and thirty-seven
handlers. The cutover removed most as a side effect; what remained — a retired
chat, a hand-rolled modal, and fifteen `on…=` attributes across Controls,
privacy, connections and the Letter — is migrated into the one hashed script as
a delegated vocabulary: `data-confirm`, `data-submits`, `data-select`,
`data-copy`, `data-open`, `data-close`. Intent in the markup, behaviour in one
hashed place.

So every path the owner signs in to is strict, held to the mount list by a test
so a new surface cannot be added to one and forgotten in the other. Three blocks
remain, all on the Clerk pages, which load a vendor SDK and render nothing a
stranger wrote.

Two real defects fell out of doing it rather than describing it. The deletion
confirmation announced `role="dialog" aria-modal="true"` and behaved as neither
— the page behind stayed focusable, so a keyboard user could tab past Cancel to
the delete button they had just been warned about; it is a `<dialog>` now, and
the Escape handler is the browser's. And the "Decide" button fired a POST from
an inline handler and then navigated away, which a browser may cancel — on a
slow connection, the one case where the ranking most wants to learn he acted, it
usually did. It is a form; the server records and then redirects.

### And the visual gate had never loaded the stylesheet

Every screenshot this harness had produced was of an unstyled document, and
every "no horizontal overflow" it had reported was measured on one — which is
close to vacuous, since an unstyled page is a column of block elements, the one
layout that cannot overflow sideways. Everything that *does* overflow is created
by the stylesheet that was missing.

Serving it, from the same handler the application uses, immediately found real
failures at 200% text on the company page — a defect that predates this work and
that three hundred passing measurements had never seen.

## What the thinking was for

The spend ledger recorded who pays for every model call — product, founder,
model, cents. Read against production it said:

| | calls | spend |
|---|---|---|
| naming no purpose | 947 | **$10.45** |
| `candidate` | 113 | $3.74 |
| `observation` | 39 | $0.68 |
| | **1,099** | **$14.88** |

Seventy per cent of the money said nothing about what it was for. "What is
Foundry thinking about, and is it worth it" is the question the whole
cognition-economics discipline exists to answer, and the ledger could answer it
for fourteen per cent of the calls.

`purpose_kind`/`purpose_id` were never meant to be that answer: they link a call
to an OBJECT, so what an opportunity cost to reason about can sit beside what it
cost to test. Most calls have no such object, and forcing a made-up one onto
them would add nothing over `product_id` while looking like it had solved
something.

So one column, `work`, from a closed vocabulary of thirty-one kinds — each
carrying the sentence a person reads rather than a slug to decode. **Closed**,
because a free string drifts into six spellings of the same work and the
grouping that was the point stops grouping; and because a closed set means
adding a model call does not compile until somebody says what it is for. All
fifty-one call sites now do, and the build refuses a name the vocabulary does
not define.

Not derived from the call stack, though a stack frame is cheap next to a model
call: the module a call sits in is not what it is FOR, it renames itself when a
file moves, and it would make the ledger's vocabulary an accident of the
directory tree.

**No new instrumentation.** The row was already being written; it gains a field.

### Two things doing it found

Declaring a subject had lived in the module that makes the call. Eighteen test
files replace that module wholesale with a stub of `callSonnet`, so a call site
importing its own declaration helper got `undefined` and threw *inside the thing
under test* — which surfaced as "unscored" voice-gate verdicts four screens from
the cause. Declaring who pays and what for is not making a call; it lives in
`what-it-is-for.ts`, which has no network, no database and no side effects, so
nothing has a reason to mock it.

And all three windowed readings asked `created_at >= datetime('now', ?)`.
`created_at` is an ISO instant — `2026-09-14T04:00:00.000Z` — while `datetime()`
returns `2026-08-15 04:00:00` with a space. SQLite compares them as text, and at
position eleven `T` (0x54) sorts above ` ` (0x20): every row on the boundary day
passed regardless of its hour, so the window was hours wider at one end than it
claimed. It never produced a wild number, which is exactly why it survived — **an
accounting reading that is quietly a little wrong is worse than one that is
obviously broken, because the first gets quoted.** They compare `date` now, the
column that exists for it, which is also the leading column of the index.

### And the society is quiet, in production

The twenty-seven retired loops were verified stopped rather than assumed. Five
of them had run every hour; their last run is 21:00 on 14 September, the deploy
landed at 21:29, and 22:00, 23:00 and 00:00 passed with none of them running —
while `nav_badge_refresh`, `signal_alert_check`, `integration_sync` and
`welcome_sequence_tick` all ran at 00:00. The scheduler is alive; it is
specifically the society that is quiet.

---

## The V3 North Star, finished and shipped — 17 September 2026

### What blocked the release, and what it was

The private deploy of the North Star branch stopped at `npm run check` with
three failing tests. None was a defect in the reconstruction; each was a test
holding a fact the world or the handoff had moved.

| Test | What it held | What was true |
|---|---|---|
| `a-roadmap-nobody-can-wish-into` | the owner map at the six doors of the pre-handoff shell | the handoff fixes it at nine; the hashed script narrows by context on a phone |
| `the-deliberation-is-recorded-before-the-answer` | the whole external chain unblocked, with the real pilot edition's pull date measured against the clock | seven days after that pull it went red on every branch, about a calendar |
| `the-owner-can-reach-the-one-thing` | more than 100px reserved under the fixed bars | Ask is a door on a phone now; one bar, and the honest reserve is what it covers |

The first now holds the V3 canonical set and still refuses a Roadmap door. The
second records an edition pulled today before reading the chain, so it proves
the mechanism rather than the date. The third makes the measurement the
invariant. **None of the gates was weakened**; each says what it meant.

**A fact for the owner, surfaced by the second:** the real pilot edition of
the Massachusetts brief was pulled on 10 September, and delivery refuses
anything older than seven days. Readiness reports it on the experiment's own
page, which is where a stale brief belongs. Re-pulling it is an Experiment 001
act and was not taken by this work.

### The reconstruction, board by board

Every surface below renders through the one shell, the one stylesheet and the
one hashed script, from the readers it already had. No board value was copied
in; where a reader has nothing yet the surface says so as a state.

| Board | Surface | What changed |
|---|---|---|
| 01, 11 | Home | six instruments three across (Estate, Autonomy, Needs you, Experiment, Yours, Watching); the cockpit row — decision, cash movement from the ledger, live activity from the stream; Now / Next / Carrying as a strip with a bounded bar; the quiet state said as a state |
| 02, 16 | Decisions | ranked and counted: needs a decision now, can wait, already handled; the card's facts first, on the phone too |
| 04, 05 | Experiments | the live test as a hero with a bound, four numbers, stop conditions with counts and the thesis; the detail ordered as what needs him, where it stands, what happens next, then everything it rests on one fold down |
| 08, 13 | Economics | five figures as instruments with their quality, the subtraction, movement from the ledger, the ledger as events |
| 10 | Ask | an exchange: his words, the answer from canonical state, what else it can answer, the composer on the screen |
| 06 | Inbox | mode as a state changed with a reason; needs-you filter; rows that say what was read and done |
| 07 | Activity | health above the stream, no count of events; rows as time, mark, sentence, ground |
| 09, 15 | Controls | Stop everything first, then the envelope as cards, with the owner's exclusions |

Mobile navigation stays contextual and semantic: nine doors at Home, the core
five on leaf pages, a sixth for the secondary place he is standing in, Ask
through `/foundry#ask-foundry`. Discover stays desktop-oriented and reachable
from Home's "Also here" row on a phone.

### Proof

- every owner route photographed at 375, 390, 430, 820, 1280 and 1680 with no
  horizontal overflow at any width (`docs/design/mobile`, `docs/design/desktop`)
- the twelve-journeys browser test, the reach test, the first-screen prose
  budget, the stylesheet vocabulary, the button-width contract and the
  contextual-navigation invariant all pass
- a new invariant, `the-north-star-composition-holds`, holds the compositions
  as structure and what the surface refuses: an inline `<style>` on an owner
  page, a second stylesheet or script, navigation meaning as DOM position

### What remains a genuine gap against the boards

- **Charts need rows.** Cash movement draws only from ledger rows, and the
  ledger is empty until Stripe writes the first one. The board's bars are a
  promise about what the panel becomes, not what it shows today.
- **Stages.** The board draws Stage 1 / Stage 2 boxes; the institution records
  a cohort, a kill threshold and a window, and the page shows those. A staged
  plan is a design fact the schema does not yet carry, so it is not drawn.
- **Reserve allocation and a tax centre.** The board's donut and checklist
  rest on tax facts the institution does not have. The tax reserve is a figure
  with its quality; nothing more is claimed.
- **Provider status cards** on the desktop governance board (Stripe, Cloudflare,
  Resend as live probes) are not drawn: what is connected is listed, and the
  Workshop card says what may be touched, but no per-provider health probe
  exists to read.

## The charter the owner signs once — 17 September 2026

### Why

Every real experiment so far was allowed by the owner pressing a button on its
own page, and every act it needed was proposed and approved in that one press,
as `founder:<id>`. That is the right shape for a first test and the wrong shape
for a studio. The owner's brief for what Foundry is to become — a river of
nickels, dozens of small sturdy things, none of which makes a new job for him —
needs standing authority that is his, bounded, and ends on a date he can see.

### What was built (Tranche 1 of the River of Nickels plan)

- **`portfolio_envelopes`** (migration 319). One live charter per owner, signed
  `founder:<id>` and refused for any other principal at the row; a month's
  money, probes in flight (1–12), thinking a day, the sealed contact rules, the
  public voice, his words, and an expiry no later than 92 days out. Immutable
  once signed; withdrawn one way with a reason; never deleted.
- **`portfolio_envelope_carves`**. A probe let in is a row: the envelope's
  remainder is arithmetic over carves this calendar month plus thinking bought
  at his scope, and the row guard refuses the carve over the month, the probe
  beyond the places in flight, a second carve for the same test, and any carve
  under a charter that has ended.
- **The act-decision guard, widened by one clause.** `proposed_acts` may now be
  decided by `charter:<envelope id>` at a company the envelope's owner owns,
  only while the envelope is live. Migration 228's guard is rewritten in full
  with the clause; the proposer still cannot approve its own proposal; the
  legal and destructive rungs are untouched, on purpose — `chartered()` refuses
  them before anything is decided, and `consequenceAllows` never consulted an
  allowance for them.
- **The hand.** `allowExperiment({ under: 'the charter' })` reads the charter
  before the decision, decides the test and its three acts as the charter's
  principal, and carves the test's cost from the envelope. Nothing calls it
  under the charter yet: the Forge that will (Tranche 4) does not exist, and
  the owner's own button still decides as `founder:<id>`.
- **Controls: "The charter" card.** Sign with three numbers and a sentence;
  renew as it stands; withdraw with the reason on record. The card says who
  signed it and reads the envelope back as facts. **Home's Autonomy tile** says
  "Chartered" with what is left while one stands. **The queue** asks once, from
  the front page, when the charter is seven days from ending.
- **The owner is not a public figure.** The Workshop is the only public voice:
  the sender line is the Workshop's name; the site's tagline, home page,
  experiment pages, contact page and the Workshop's own statement speak as the
  Workshop (migration 320 brings the founding statement in production into
  line); the hand's footer and the correspondence sign-off name nobody; the
  Etsy listing copy names nobody. His name stays on exactly two surfaces where
  the law wants to know who is behind a trading name — the terms page and the
  listing's privacy policy. `scripts/check-the-owner-is-not-a-public-figure.mjs`
  holds it and has a planted-defect test. Experiment 001's sealed offer
  template is a record and is not rewritten.

### What is deliberately not here

- Production cognition ceilings are unchanged ($2 per company, $5 per owner,
  $5 global a day): the charter's "thinking a day" is his number and the
  environment's ceilings remain the hard stop beneath it.
- No autopilot category moves to `act`; no boundary is opened. The charter
  widens who may say yes to a proposed act, and nothing else.

## More ways of looking — 17 September 2026

### Why

Two real eyes (a package registry and one forum) and no real candidate ever
survived: a candidate takes two genuinely different ways of knowing, and a
registry read fifteen times is one. The Forge (Tranche 4) has nothing to
deliberate on until the frontier holds candidates with independent evidence.

### What was built (Tranche 3 of the River of Nickels plan)

- **Six public eyes**, none needing a credential, an account or money, each
  in the shape the first two set (`safeFetch` through the SSRF door, a named
  user agent, what it can and cannot see, an address for every item, failure
  thrown rather than hidden): Apple's App Store search (`app_store`,
  substitute), App Store reviews (`review`, satisfaction), DuckDuckGo
  autocomplete (`search_evidence`, demand signal), Remotive's jobs feed
  (`job_posting`, procurement labour), GitHub's public issue search
  (`community`, problem pain) and Wikipedia pageviews (`public_dataset`,
  usage). Migration 321 registers them declared, adds the two capabilities the
  constitution did not yet name, and says on what basis each is looked
  through.
- **Askers.** `sources/askers.ts` is the registry: each eye asks its source the
  question that source can answer, forms a claim for that question, keeps what
  came back whole (`market_retrievals`), writes observations under its own
  source type, raises what it cannot see, and says what it found in a
  sentence. What a finding bears on a seed is still read from the
  constitutional bearings table, and a missing row still means the source
  says nothing. Seven bearings are added for the three stances that had none.
- **Weeding asks every reachable stance.** After the registry, the first two
  stances not yet asked that could settle what the seed asserts, so a day's
  pass is bounded and the next day asks the next. A contradiction buries;
  support or narrowing survives; an eye that does not answer is said so and
  the seed lives.
- **Discovery sows from issue trackers too**, and passes a silent tracker
  over out loud rather than letting it end the pass.
- **The sense check asks each provider its own dull question** and opens the
  eyes it has just proven the same day.
- Proven in miniature by `more-ways-of-looking.test.ts`: one seed, five
  stances, promoted on rows rather than a story.

### Not here, and why

Reddit refuses unauthenticated search; Gumroad and Etsy have no public search
without a key; SAM.gov needs a key; the Wikimedia API rate-limits an
unnamed caller. Solicited eyes (owner-stated ideas, an ask-you page) belong
with the owner surface. Each will be proposed as a capability acquisition when
its key or page exists.

### The world says what the record says — 18 September 2026

The identity rule changed the Workshop's founding statement by migration and
the public site kept serving the page as it was the day somebody pressed
publish: the site was only re-rendered when the owner stood the Workshop up.
The hourly Workshop tick now re-renders every page of a Workshop that is
already standing and puts up only what differs, by digest, under the keeper
principal it already publishes with. An unchanged page is a no-op; every
change leaves the receipt it always did; a Workshop never published is not
put up behind the owner's back.

## The forge deliberates — 18 September 2026

### Why

The forge deliberately had no button: the sentences that decide an
experiment were the owner's or nobody's, and every real design was written
by hand. The owner asked not to be the job. The forge now composes designs
under a discipline stricter than a person's, not looser.

### What was built (Tranche 4 of the River of Nickels plan)

- **Five lenses, written first.** Market reality, experimental design,
  commercial operations, risk/ethics/compliance and economics/portfolio each
  read the record — the candidate, its evidence with addresses and stances,
  its unknowns, the legal picture, the lessons of settled tests, the charter,
  the executable exchanges — on the operational model, and each finding is
  written to `probe_lens_findings` with the rows it rests on before anything
  is composed. A finding with no grounds is thrown away. Migration 322
  refuses a forge design with fewer than five findings behind it.
- **One composer.** The design is composed on the frontier model from the
  findings, validated against the vocabularies (an executable exchange, two
  readings the test cannot tell apart, cost on three dimensions, two stop
  conditions), and recorded as `designed_by = 'forge'`. The warrant is in
  the frontier table: being wrong here costs a probe.
- **A separate attacker.** Given only the draft and the record, told to break
  it. An attack that names an amendable sentence and a better one becomes an
  amendment in the ledger signed `forge:adversary`; the rest are recorded in
  `probe_attacks` with the attacker's verdict. The composer cannot attack its
  own draft, and nothing can be attacked or found after the seal — at the row.
- **The rule that seals is neither.** A design is sealed only when it
  recommends running, the attacker agrees, nothing the design names stands
  in the way, and the probe is inside the charter. Otherwise it stays
  unsealed for the owner with every reason on the decide page. A test both
  the composer and the adversary recommend against is retired with both
  reasons. `scripts/check-forge-seals-only-inside-the-charter.mjs` holds
  that any file sealing a design outside the owner's own hands asks the
  charter first, with a planted-defect test.
- **The daily pass** (`forge_tick`, 07:00): proposes tests from what only
  reality can settle, designs at most two a day, and lets a sealed, ready test
  in as the charter's principal — or says why it is not ready. It designs
  nothing once the day's thinking under the charter is spent, read from the
  same ledger the model door writes.
- **The decide page** shows what each discipline said and what the adversary
  argued, so the owner can play when he wants to and never has to.

### Model calls, and what they may not do

The prompts carry the same rule the reader carries: readings, questions and
designs may be created; pain, demand, willingness to pay, counts, prices and
names may not. The owner is not a public figure and the legal and destructive
rungs are never inside a charter, said in every prompt.

## The hands make a brief from rows — 18 September 2026

### Why

Two real deliverables, and a person made both. A studio that must have its
products made by hand cannot grow a river of nickels, and a product nobody
checked is how a small workshop's name is spent.

### What was built (Tranche 5 of the River of Nickels plan, first recipe)

- **A product registry** (`products/registry.ts`) that says which kinds the
  hands can make today and, for each they cannot, what would have to exist
  first: a tool page needs a page recipe with a readback and an exchange for a
  free thing; a template file needs a generator whose formulas are checked
  mechanically; a directory needs a steward that refreshes it; an alert needs
  subscribers the Workshop has gathered. The forge designs only for what the
  hands can make.
- **The brief made of rows.** The eyes keep what they returned, item by item,
  with an address and a date. A data brief is a shortlist of those items for
  one question: every item cites its row, the counts are the retrievals' own,
  and not a sentence of it is composed by a model. Its gate reads the text
  back against the rows: an item citing an address that is not a retrieval
  row is invented and the brief is refused; so is a stale pull, a placeholder,
  a banned claim, or a named person. A brief that fails its gate is never
  recorded as a deliverable a later hand could send.
- **The forge shapes the offer** for a sealed design whose exchange a brief
  can carry: the six sentences an asset states of itself, a one-time price
  between five and forty-nine dollars, the search words and sources the brief
  is built from, and what it covers. The structural facts the legal pass
  reads are properties of the recipe, filled by it, never opinions. Then the
  hands make the brief and the offer text in the Workshop's voice, and the
  daily pass does this before it reads readiness.
- **Refresh.** A brief going stale is re-pulled from the same rows the eyes
  keep pulling, through the same gate.

### What still stands between a sealed design and the world

Readiness now wants only people to write to and a way to send. The first is
the channels tranche: a population with recorded grounds, approved under the
charter's contact rules rather than one by one, or a venue where buyers come
to the offer. The second is the Workshop's sending, connected once.

## The Workshop is the first venue — 18 September 2026

### Why

Every real test so far reached the world by writing to people the owner
reviewed one by one, and a studio cannot run on that: a population must be
found, screened and approved for every probe. A venue where buyers come to
the offer needs none of it. The Workshop's own page is that venue.

### What was built (Tranche 6 of the River of Nickels plan, first venue)

- **The offer shape may name the Workshop as the venue.** The forge does,
  for the briefs the hands make: the hand places the payment link and
  publishes the page (as it did for the first experiment), nobody is written
  to, a buyer arrives on their own, and the deliverable is sent by email
  under an act that covers exactly that — one message per buyer the provider
  reports at the page, once. The campaign act does not exist for a venue
  test, so the hand that plans an offer to a stranger finds nothing that
  covers one.
- **Readiness for a venue test** wants the thing, its words, its design, its
  page, the Workshop's postal line and a way to send. Never a list of people.
- **The page's public copy** is composed with the offer, in the Workshop's
  voice, and says plainly that nobody was written to. The experiment gets its
  number and slug when the hands make it.
- **Settled by payment.** A venue test without a sealed settlement rule is
  given one at approval — at least one payment within thirty days of
  placement — so it settles itself, as a studio test must.
- The charter lets a venue test in as it lets any other: placement, refund and
  delivery decided as `charter:<id>`, the cost carved from the envelope, the
  design sealed.

### What still stands between a sealed design and a sale

The Workshop's sending, connected once, and a payment provider configured
for the deployment. Reach beyond the Workshop's own visitors — community
posts, directories, small paid tests — is the rest of this tranche. The
postal address the owner typed names him on every public page; the Workshop
page now says so and where to change it. Foundry does not rewrite an address
he typed.

### The steward keeps a brief fresh — 18 September 2026

A brief that is live, or about to be, and older than the freshness rule
allows is re-pulled at the head of the hand's hourly pass from the rows the
eyes keep pulling, through the same gate, and only when newer rows exist:
re-rendering the same pull is not freshness and would put a new date on an
old edition. A refresh that fails its gate is said so and the old edition
stands until the rule stops it being sent. Retirement by rule already runs
on its own schedule; this is the other half of stewardship for the first
kind of thing the hands make.

## The Workshop can be found (18 September 2026)

A page nobody can find is silence with a receipt. The eyes hear what people
search for, the forge composes an offer on those words, and the Workshop's own
page is the one place a stranger could pay — but until now no crawler could
have kept it: no page named its canonical address, no sitemap existed, the row
guard refused any path with a dot in it, and the program served everything as
HTML.

What changed, and only this:

- **Two files beside the pages** (migration 323): `/robots.txt` and
  `/sitemap.xml` are the only paths with a dot the row guard admits; every
  other rule of the guard stands as it was. The program (`worker-source.ts`)
  serves those two with their own content types and refuses every other dot
  exactly as before.
- **One address per page.** Every indexable page carries a canonical link to
  its own address at the Workshop's origin. The pages that are for the person
  in front of them — the opt-out form, its receipt, the answer receipt, not
  found — say `noindex` and carry no canonical. The sitemap announces exactly
  the indexable pages and the *listed* experiments; an unlisted page still
  resolves and is not announced.
- **What is for sale, in the form an index reads.** An experiment page carries
  a Product record with its price only while the thing is actually offered
  (testing or operating, with a price). A closed page carries none: saying
  otherwise in machine words would be the one lie on the page.
- **The program is kept like the pages.** The hourly `public_workshop_tick`
  brings a running program that differs from the reviewed text current, through
  the door, with the receipt stand-up leaves, keyed on the change itself so the
  same replacement is never applied twice. A Workshop that has never been
  stood up is not put up behind the owner's back. The health card's "the
  running program differs from the reviewed one" is now a state that lasts at
  most an hour.

Held by `the-workshop-can-be-found` (renderer, program, row guard) and the
program-keeping case in `the-workshop-has-one-public-face`. What this does
not do: it does not make a stranger arrive. A new domain with no inbound links
is found slowly, on the long tail, which is where the eyes' terms live.
Reach beyond search remains the next frontier, and its first move — a listing
on a marketplace, a post in a community, a paid placement — is a new channel
class the charter queues for the owner once.

## The owner surface, made worthy of the institution beneath it (18 September 2026)

The institution advanced faster than the product the owner meets. On his
phone he found the charter hard to locate, old experiments accumulating in
the active list, prose everywhere, a congested bottom bar with colliding
labels, and internal concerns outranking economic ones. The code agreed with
him, and this tranche reconstructs the surface — information architecture,
hierarchy and copy — without touching the institution's evidence, authority,
provenance or history, which become reachable in depth instead of visible at
the surface. The visual North Star is unchanged.

**Five doors under the thumb.** The bar rendered nine doors plus Ask; the
stylesheet drew nine columns at half a rem for every phone, and the hashed
script then forced all nine on Home, which is exactly what collided. The
phone bar is now five doors in markup — Home, Portfolio, Experiments, Inbox,
More — styled by the stylesheet alone, the label sized to the viewport so
doubled text still fits its track, clipped rather than laid over a neighbour.
The rest of the places sit in a sheet the More door opens with a fragment,
the page underfoot marked; More lights when the page is one it holds; the
Letter lights nothing. Ask is a button in the head. The desk rail keeps the
whole set. No script decides membership any more, so a script that fails to
run leaves the bar the stylesheet drew.

**The charter has a place.** `/foundry/charter` is a projection the owner
can read before granting standing authority: the status word, the limits,
the most it can cost from the guards that hold it (the month's ceiling in
every calendar month the period touches, the day's thinking on every day,
two months inside any thirty days), what Foundry may and may never do inside
it, the one rule about writing to people, and the action. The canonical
text, the writing rules, what remains his and the history are one fold down.
"Recalculate the ceiling" is a GET of the same page: the figure he reads is
the server's arithmetic, the same function that reads the active charter.
Controls keeps one card that points there; Home's Autonomy tile opens it.

**The charter is the one thing when the rest is ready.** With a Workshop to
speak as and a real test ready or a design sealed, and no charter standing,
Home says "Foundry is ready to begin testing — needs your operating charter"
as its one thing, above the institution widening its own authority, and the
button opens the place rather than posting a decision. An unsigned charter
used to produce no attention anywhere.

**Now is not history.** The experiment row carries how a test ended;
retired and superseded are states of their own, read before declined, so a
forge-killed design no longer reappears as "Needs you". One settled
predicate serves the charter's arithmetic, the owner's queue and the list.
The Experiments page shows the working set, the few that finished in the
last fortnight, and a counted door to History, where every concluded test is
kept whole and filtered by how it ended. Home hydrates only what can still
move.

**Text earns its space.** Tiles say a state in four words or fewer; the
search on Home is one line and a fold; Controls keeps every fact and folds
every explanation; the thinking ceilings read the deployment; Portfolio's
invented companies are a closed fold; the Workshop's name is read from its
row; the commercial-era words are gone from the settings, privacy and the
Letter's first-run card. The isolated workshop (compute) is reachable from
the rest of the controls; the dead Workshop block on Controls is deleted.

**Proof.** `five-doors-under-the-thumb` holds the structure; `five-doors-
do-not-collide` measures, in Chromium at 375, 390 and 430 and at normal and
doubled text, that there are at most five doors, none clipped, none
overlapping, every target at least 44px, exactly one lit, and that the sheet
opens with thumb-sized rows. `scripts/measure-mobile.mts` now measures the
doors on every page it photographs and fails the run as it does for overflow
and coverage; it seeds concluded tests and a signed charter so the pictures
in `docs/design` show history beside the working set and the chartered
estate. `the-charter-the-owner-signs-once` holds the exposure arithmetic on
fixed dates; `the-charter-is-the-one-thing-when-the-rest-is-ready` and
`history-is-not-the-active-list` hold the rest.

**What remains, honestly.** The owner surface sits behind sign-in, so the
phone-width read-back of production is the measurement above run on the
deployed commit's tree, plus the health check; nobody here can open the
signed-in app on the deployed host. Cards still carry a little more than a
glance on the company pages and the Letter, which are contextual and
inspection depths and were not the owner's complaint.

## The charter has one total, and the calendar cannot move it (18 September 2026)

Migration 319 bounded the studio's money per calendar month and its thinking
per calendar day. Both are enforceable and honest, and together they are not
what a person reads: ninety days signed mid-month touch four calendar months,
so "a hundred dollars a month" authorised four hundred on tests, and some
thirty-day window could hold two months' ceilings. The page said so truthfully
and the truth was unintuitive, which in an owner-protection surface is a
defect.

What he signs now is a **total for the whole charter**: the term in days, the
money for tests across all of it, the thinking a day, and how many tests may
run at once. Migration 324 adds `tests_total_cents` and a carve clause with no
calendar in it — every carve ever made under this charter, summed, may never
exceed the total. `monthly_cents` is written equal to the total, so 319's month
clause is subsumed and can never bind first. The reading now computes exactly
what the guard would admit, so what the page says is left is what the database
would still allow.

The signing surface separates **component ceilings** from **total exposure**.
The components are labelled as parts: tests over the charter, thinking each
day, tests at once, the term. The total stands alone in the serif —
`$100 + $3 × 30 days = $190` — with the sentence that no day, month or window
can exceed it. The old "Any one day — $3 thinking" tile is gone: it read as a
day's whole downside when test money could be set aside the same day.

The term is his: 30, 60 or 90 days, with **thirty preselected** until he has
signed one, because a first charter should be a proving window rather than the
longest thing the row admits. Renewing "as it stands" keeps the term he chose.

**And an unsigned charter no longer means a dormant institution.** Everything
except sealing already ran charter-free — the eyes look, seeds are sown,
questioned and buried, candidates are promoted on two independent stances, five
disciplines read a design and an adversary attacks it — but nothing said so on
the surface, and the daily thinking cap read the charter that did not exist, so
an uncharterd Foundry thought without any ceiling while asking for authority to
spend. The charter page now has a "Before you sign" block saying what it does
anyway and the one line it stops at, and `forgePass` bounds pre-charter
thinking at $1 a day.

## The first screen ranks by consequence, not by storage type (18 September 2026)

`whatNeedsHim` decided what Home says first by asking which table a thing came
from. Every `proposed_act` ranked as one class, above the charter and below
nothing, so an act that reverses itself in a minute and costs nothing stood in
front of the one signature that starts money moving — not because it mattered
more, but because it was a row in `proposed_acts`. Underneath, the acts ranked
among themselves by rung, money and expiry, which put an act that owes a buyer
a refund beside one that merely posts a page.

Acts now carry a **tier**, derived in `whatIsBeingAskedOf` from columns that
already exist and nothing else:

- **obligation** — a `legal` or `destructive` rung, a subject that promises
  something (`commit_on_my_behalf`, `move_money`), or a buyer already owed
  delivery or a refund behind the same experiment. That last is the
  `outstandingObligations` predicate the Workshop already reads, which is the
  one class of work ECONOMICS.md says survives an owner pause.
- **external** — a `public` or `financial` rung: something published, somebody
  written to, money spent.
- **internal** — everything reversible.

Three words over existing columns. No score, no rating, no ranking number
anywhere near a surface. Within a tier the old order stands: rung, then money,
then how soon it expires.

The first screen's order is now OBJECTIVE.md §4's: a bound or a promise, then a
commitment already made and unaccounted for, then an act that reaches the
world, then the charter, then a blocking acquisition, then everything
reversible, then what Foundry is merely offering to notice. The charter moved
above the blocking acquisition for the same reason: money beginning to move is
the thing this institution exists to do, and it should not wait behind a tool
Foundry cannot buy.

**Ranking decides what is said first, never what is said at all.** Everything
waiting still appears under "Also waiting on you", and the proof asserts it:
with the charter as the one thing, a reversible act is still on the screen.

## The door hears a direction, and steering steers (18 September 2026)

"Explore API opportunities" is the sentence that exposed both halves of this.
It names a direction and leaves the mechanics to the institution, which is the
division of labour autonomy is meant to buy — and it landed in "I did not
follow that", because every phrase the mandate reader knew named a new company
to add and none of them meant go and look.

The reader now knows exploration words on their own terms (`explore`, `look
for`, `look into`, `see if there`, `see whether`, `find something`, `hunt
for`), and knows the economic forms as things that earn: API, calculator,
generator, utility, plugin, extension, monitoring, marketplace, licensing,
dataset, directory, acquisition. Both halves are required, so "explore the
inbox" is still not a mandate. `SHAPES` gained calculator, utility, plugin,
monitoring and acquisition, and `api` gained the bare word with spaces around
it, because a bare `api` substring lives inside `capital` and `rapid`. A shape
named is a preference on the record and never the space the search may look in;
nothing downstream filters by it.

**One search at a time is still the rule, and it is now the institution's job
to carry it.** A direction given while a search is running used to come back as
"you already have a search running — steer it instead", which is the product
telling him to do the translation himself. It is now absorbed as `favour`
guidance on the search he already has, in his own words, and Home says
"Pointed that way" rather than "Already looking".

**And steering reaches the work.** Of the eight kinds of guidance, only `avoid`
and `prefer` were read anywhere: `favour`, `deeper` and `industry` were
recorded, shown back to him, and changed nothing the search did the next
morning. Each now contributes its subject as a search term in his own words,
beside the portfolio's own terms rather than instead of them, with "he said:"
and his sentence as the reason on the brief. `scepticismLevel` — correct since
the day it was written, called from nowhere — now sets the belief bar in
`promote`: each "be more sceptical" raises the number of genuinely different
ways of knowing a candidate must survive before it may reach him, and the
refusal says the bar it was held to.

## The studio: Now, and what has been found (18 September 2026)

Experiments answered "what is running". Nothing answered "what have you
found" — everything the institution had ever found and believed lived inside
whichever search happened to be open, on a screen about searching, so an owner
with no search open was shown nothing at all about it.

`/foundry/experiments` and `/foundry/experiments/explore` are the two
questions, as two tabs. Now is unchanged. Explore arranges every open, real
candidate on shelves by economic form: software people subscribe to, something
other software calls, a small tool, a calculator or generator, assembled data,
watching and telling, a part of something bigger, a place two sides meet,
letting somebody else use it, buying something that already earns, and
everything else.

**A shelf sorts; it never creates.** `economic-forms.ts` is presentation, in
exactly the relationship `SHAPES` has to `venture_mandates.shape`. A candidate
reaches a shelf only through a sentence somebody actually wrote — its own
headline, the problem it names, why it might work, or the words that started
the seed — and the card says which word, in which sentence, filed it there.
Every candidate on a shelf already survived promotion, which needs genuinely
different ways of knowing. An empty shelf says "nothing found so far looks like
this" and offers one thing: to point the search that way, through the mandate,
in his words.

`shelfCandidates` reads in three queries and never `candidatesFor`'s loop:
the open real candidates with their seeds, one grouped count of independent
stances, one pass of blocking unknowns. The card shows the headline, who has
the problem, the evidence in plain language, what is in the way or the
strongest reason it fails, and one door to the candidate's own page. Burden is
absent rather than guessed: `probe_costs` exists only after a design.

One quiet line says what is alive, from row counts alone — possibilities being
looked through, how many were set aside, candidates standing, tests running —
and when the pipeline is genuinely empty it says that instead of dressing a
zero up. Evidence is words, never a score: the only number on a candidate is
how many different ways of knowing said something.

## Steering the thing he is looking at (18 September 2026)

He could always steer a search by typing a sentence. What he could not do was
steer the candidate in front of him without describing it back to Foundry in
prose, which is the owner doing the institution's clerical work.

A candidate card now carries one primary action and one compact fold holding
**at most four** nudges, chosen for that candidate: more of its kind, less of
its kind, stay on this one, and a fourth read from the card itself — a cheaper
test when a money question stands in the way, a different economic form when
the hands cannot run that form's way of getting paid, otherwise the standing
preference for things that do not need looking after. Never ten buttons: a row
of controls under a candidate makes the decision harder, not the steering
easier. Each button says what it will do before it is pressed.

**Nothing new is written underneath.** Each nudge produces exactly the
`venture_guidance` row the sentence-reader would have produced from the
equivalent sentence, with its subject taken from the candidate's own recorded
words — the economic form its own sentences put it under, never a category
Foundry invented for it. So a nudge appears on Discover among the sentences he
typed, and is readable, supersedable and arguable the same way. There is no
hidden preference model and no second vocabulary.

The route re-derives everything from the candidate and the open search: the
form posts a candidate and a nudge key and nothing else. A nudge with no search
running steers nothing and says so, rather than starting real work because a
button was pressed under an old candidate.

## An inbox the owner can clear, and one object per row (18 September 2026)

`workshop_mail.handling` has five states and every one is a judgement about the
message: Foundry is reading it, waiting on them, needs him, resolved, nothing
to do. There was no way to say the thing a person says most often about a
message they have finished with — take this off my screen. So the working
inbox could only grow, and the only way to shrink it was to assert something
false.

Migration 325 adds `archived_at` and `archived_because`. **Archiving is a view
state, not a verdict.** It says nothing about the message, changes no reading,
no grounds and no reply, and is the one state in this family that is
reversible — every verdict here is immutable on purpose, and a view state that
could not be undone would make tidying a screen into a decision. Two triggers
hold it: a message cannot arrive already put away, and putting one away says
why. Clearing the owner's view is not deleting institutional evidence.

**And the object is the conversation.** The list showed messages while the row
opened a thread and the button settled a message: three objects wearing one
row. `theThreads` groups by `thread_key` in one query and returns the newest
message, the count, and whether anything in it still needs him. Done and
Archive act on the whole conversation.

The default view is **what is in flight** — needs you, Foundry reading it,
waiting on them — so the two states that matched neither old chip stop being
visible only under "All". The chips are In flight, Needs you, Handled and Put
away, each counted from an unbounded reader rather than filtered out of a page
of a hundred. An archived message stops counting as waiting on him and stops
nagging as unread; the total heard is the record and still counts everything.

Discover's "Decided in this search", "Buried" and "Earlier searches" are now
folds with their counts in the gist, the idiom a situation's history already
used. He should not have to scroll past everything he has ever turned down to
reach the thing standing in front of him.

## The address he typed stops naming him on every page (19 September 2026)

The doctrine is that the owner is not a public figure: the Workshop is the only
public voice, and his name stays on exactly two surfaces where the law wants to
know who is behind a trading name — the terms page and the listing's privacy
policy. `scripts/check-the-owner-is-not-a-public-figure.mjs` has held that since
it was written.

It could not hold it, because the breach was not in the code. He typed the
postal address at stand-up beginning with his own name, which is the ordinary
way to write one, and `postal_address` is a row value the gate never sees. That
line then went out in the footer of all fifteen published pages and in every
commercial email — read back live on 19 September on `/`, `/about`, `/terms`,
`/privacy`, `/contact`, `/email`, `/refunds` and `/experiments`, and twice on
the contact page. A rule enforced everywhere except on the one string a person
actually typed is not enforced.

**The name line is dropped, and nothing stands in its place.** Both surfaces
that render the address have just said "Apex Micro is a small digital workshop"
in the line above it, so a name line would only repeat it. `publicPostalLines`
(`settings.ts`) returns the address with a leading line equal to the operator's
name removed; `postalLines` is untouched and still serves the owner's own view.

The correction happens at the **projection** — `workshopFacts` builds the public
`postalAddress` from `publicPostalLines` — so `site.ts` needs no rule of its
own: by the time an address reaches a template the name is already off it. The
hand reads the record directly rather than the projection, so its
commercial-email footer asks for the public reading itself.

**The street address is never touched**, and an address that does not begin with
his name passes through unchanged. This is not Foundry rewriting what he gave
it; it is Foundry declining to put his name on a page that is not his to be
named on. The stored value stays exactly as he typed it, and the Workshop page
still shows it in full. If an address were only his name the result is empty,
and `publication.ts` already refuses to send without one — loud, rather than a
page quietly losing its notice.

A fourth clause in the gate keeps it: the projection must build the public
address through `publicPostalLines`, and no file on a public path may reach for
the raw lines, except `settings.ts`, which defines both readings, and `site.ts`,
which renders the projection. It has a planted-defect test beside the three that
were already there.

**Two surfaces still name him, deliberately.** The terms page (`site.ts`) and the
Etsy privacy policy (`proof-2-content.ts`) — the two disclosures the doctrine
names. And Experiment 001's sealed text says "I'm Thomas Norton, and Apex Micro
is my workshop" on its own public page. That is a record, not a surface, and it
is not rewritten.

## Foundry knows whether Foundry ran (20 September 2026)

"Foundry has nothing connected to it, so silence from it means nothing." That
was the one open owner item on the 15 September closeout, and it is the gap an
autonomous institution cannot leave: the page could say "everything I run is
running" with the forge silent for a week, because the two loops it watched
were about companies he does not yet have and the seven that carry a sentence
to a priced offer were watched by nothing. "Nothing found" and "nothing looked"
were one sentence.

Nothing new is recorded. The scheduler already writes every routine's success
and failure to `job_health`; the loop list already knows a routine's cadence;
the rows already say whether a search is open, what was found, what was
designed, and what is running. Four things read them:

- **The economic loop is named.** `INSTITUTION_LOOPS` gains the seven routines
  of the economic loop, each against its own cadence plus a margin (daily: 30
  hours, hourly: 6), marked `economic`. The estate reader, the absence test
  and the loops-stopped card pick them up with no further change.
- **One sentence, the first true thing.** `howFoundryIsRunning` says
  *stopped* (a routine failed or did not succeed within its cadence; said
  first because everything below it is stale), *blocked* (the routines ran and
  something outside stands in the way: a stuck live test, the Workshop needing
  attention, a search with no way of looking), *working* (tests running or
  being designed), or *waiting* (the routines ran and decided on the rows that
  nothing deserves action — no search open, nothing found has earned a
  candidate, no candidate deserves a test, or a sealed test waits for the
  charter). A fresh institution says it has not completed a pass yet rather
  than reading an empty ledger as calm. Never an error message: which routine,
  and since when.
- **Home shows it**, one line under the first section, with the last completed
  pass beside it; "Are you okay?" gives the same sentence. `/internal/health`
  carries the same reading as `checks.loops` and `loops.stopped`, and turns the
  status word to `degraded` without turning the response into a 503 — a stalled
  loop is not a reason to restart the machine.
- **He is told once.** `institution_pulse_tick`, hourly at :50, sends one
  account notice of the deliberate sixth kind, `institution_stopped`, through
  the door billing notices already use, keyed on the stopped routine and its
  last success, so a stoppage is one message and an hourly re-check cannot
  become a feed. Recovery is read on Home, not mailed. Nothing here is a
  monitoring system: no thresholds beyond the cadence the loop list states,
  no preferences, no queue, no new service.

**What it cannot see, and says so:** a process that is not running writes
nothing, so no sentence this process produces can report its own death. That
is what the deployment's health check is for, and the endpoint now carries this
reading for whatever probes it.

## Experiment 001, settled by the ledger (19 September 2026)

The prediction sealed on 12 September: *at least one business pays $29 and
receives the brief before 25 have received the offer, within seven days of the
offer being placed.* What was recorded: 21 businesses written to, 19 delivered,
2 bounced, 0 replies, 0 payments, 0 deliveries.

On 19 September the hourly `business_outcome_tick` applied the sealed rule to
what the providers reported, exactly as `settleFromTheWorld` was written to:
the window closed with nothing, so the verdict is **surprised** — not as
predicted — written to the row with the counts as its reason, the market
unknown answered, an observation recorded contradicting the claim, and the
prediction graded by `business_outcome` rather than by anybody's opinion. The
public page reads "Closed — the pilot ran and the thesis did not hold." Nothing
was reinterpreted and nothing was asked of the owner; no independent verdict
was needed because the rule was sealed with the prediction and the events came
from a provider.

What follows on its own: the experimental asset retires after the grace the
owner's policy gives a failed test (`failed_test_grace_days`, 30 by default)
unless a re-run is designed. No re-run is created merely to show progress.

## Ask connects the owner to the institution (20 September 2026)

The owner typed his first direction into the box on Home — "Find and
investigate low-maintenance digital income opportunities, explore different
economic forms, evaluate evidence, reject weak candidates, and develop
justified experiments within my authority and spending limits" — and was told
"I don't know yet", followed by a list of the questions Foundry could answer.
The search machinery existed, steering existed, the door that hears both
existed. None of it was behind the box he used.

What happened, exactly: the composer on every page was a GET to `/foundry?q=`,
which reaches the *question* path and nothing else. `matchQuestion` read the
word "reject" in his sentence as "what was turned down", found nothing turned
down, and fell through to the honest-sounding fallback. The door
(`whichDoor`) — which reads that same sentence as a venture direction — sat
behind a second form he was never shown. So a legitimate instruction was
answered as a question nobody asked, and nothing was recorded.

The repair, with nothing new invented:

- **One entrance.** The composer posts to `/foundry/ask`, the door route. A
  question is handed on to the answer path it always had, with its scope, so
  nothing that worked is lost; a direction comes back as "Go and look?", steering
  as "Hold the search to this?", stopping as "Stop looking?", and a sentence the
  door cannot place comes back with his words kept and a list of what it can
  act on. The old `?q=` entrance consults the door first as well, so a bookmark
  or a back button cannot reopen the defect.
- **The reader hears the plain forms.** "Find …", "look for …", "explore …",
  "investigate …" at the head of a sentence, and *income*, *revenue*,
  *earnings* among the things that earn. "Find out how much we made" stays a
  question. "Focus more on APIs and calculators" is heard as steering, one
  guidance row per thing. A constraint said inside a direction ("low-
  maintenance", "hands-off", "passive income") is absorbed beside the mandate
  as a preference on the record, rather than left on the statement — read
  apart from the rest of the steering, because guidance is read before
  mandate and the preference would otherwise swallow the direction whole.
- **The boundary is said, not hidden.** A sentence asking Foundry to write
  to people or spend money is answered with what does not happen on a sentence,
  what the charter is and what is currently in flight under it — the same
  authority system, not a new one.
- **Nothing is claimed that does not exist.** Saying yes writes the mandate
  row the discovery pass iterates; the acknowledgement is the row read back;
  Home shows "What I am looking for" and the search page shows the guidance in
  his words. The proof (`ask-connects-the-owner-to-the-institution.test.ts`)
  drives the real composer and asserts on rows, and fails on a plausible
  acknowledgement that wrote nothing.

What still requires the charter is unchanged: a search opens and runs on his
sentence; a test is designed, attacked and sealed inside the charter; nothing
is sent or spent without it.

## The first direction lands, and the answers agree with the record (20 September 2026)

The owner's standing instruction is that he should not be Foundry's
integration tester. So before the next tranche, three reviewers who had not
seen the code were given ordinary owner objectives and the product on a
390-pixel phone (`scripts/owner-review-harness.mts`, production's shape:
Experiment 001 run and settled, its search still open, no charter). Twelve
objectives; one achieved outright. The failures were not wording. They were
the same class as the Ask defect: capability behind a door the sentence never
reached, and answers composed from a narrower record than the one that
existed.

What was repaired, each with a proof from the real entrance
(`the-first-direction-lands.test.ts`) and a read-back in a real browser:

- **A direction while a search is running is his call.** Experiment 001's
  search is still open in production, so his first direction would have been
  folded into it as a preference with a line saying "Pointed that way". The
  confirmation now names the running search and offers both: keep it, pointed
  this way, or close it — with the reason on the row, what it found kept under
  Searching — and look for this. Closing and opening is one transaction.
- **A search can look from the moment it opens.** The proven public sources
  were opened for a searcher only by the next morning's sense check, so a
  direction given at noon read *Blocked: nowhere to look* until 05:40.
  `openMandate` opens them; Home reads *Waiting — Foundry is working* at once.
- **Steering in his words.** "Avoid anything that needs customer support"
  fell through to "which company do you mean". A generic *avoid X* is heard
  last, after the named rules; support in it is the support-burden
  preference. "Subscriptions" matches as well as "subscription". The search
  page reads steering back in plain words, his sentence beside it, from the
  one helper the confirmation uses (`guidanceInPlainWords`).
- **A negated stop is not a stop.** "…but don't cancel the search" was read
  as *cancel the search*.
- **A hold on sending is an act.** "Hold off sending anything to anyone for
  now" is heard at the door before the venture reader and offered as the one
  thing that does it — the Workshop's pause on new economic activity: offers,
  placements and new tests stop; deliveries, refunds, the public record and
  the search carry on. "Are you allowed to contact anyone" answers that the
  hold is in force, since when, and where to lift it.
- **The money answer reads the charter and the tests.** "What can you spend"
  was composed from code-change consents and model spend, and said "I cannot
  contact anyone" a week after 21 businesses were written to. It now says the
  charter's envelope (or that none is signed and what that means), what tests
  were approved at, what was sent under them, what is running, whether sending
  is on hold — and, separately, what thinking cost.
- **"Why did it fail" has an answer.** The last settled test: what was
  predicted, what would have disproved it, what happened, what that
  establishes (this offer, that population, that channel, that window) and
  does not (the category, other channels), what the design could not
  establish, and what the next design is written against.
- **"Is Foundry healthy" is about Foundry.** It went to the company reader.
- **The week-away letter carries the venture.** Scoped to owned companies, it
  said "nothing left the building" and "nothing you set changed". Sends under
  tests, searches opened and closed, steering and settled tests are his rows
  whether or not he owns a company.
- **A budget ends with its answer.** The allowance granted with an approved
  test ran to the day it owed an answer, so a test that settled early left
  "may spend up to $100 more without asking" standing on Controls. Withdrawn
  on settlement, and on retirement as the backstop.
- **Last healthy is a date the estate has.** It was read off the failing
  loops, so a healthy estate showed "not recorded" beside "Healthy".
- **The Decisions tile points at a section that is on the page.** The anchor
  was chosen by the count of things waiting; the section is rendered by the
  one thing.
- **No page ships its own development notes.** Thirty-six HTML comments in
  the owner templates went to the phone on every request; one carried the
  phrase "I don't know yet" after the sentence itself was gone. All are
  TypeScript comments now, and a proof reads ten pages for either marker.

What the reviewers found and was left, with the reason, is in
`MATURITY_MAP.md` § *Testing the product as a person*. The map itself is
new: one row per owner journey and per transition of the economic loop, three
verdicts each — works, usable, earns — with what proves them.

## The world, the working set, and one reading of money (21 September 2026)

Three tranches, one discipline: the laboratory stands where the owner stands,
and what it finds is repaired at the root.

**The world.** `tests/helpers/world.ts` carries production's shape once, for
the proofs and the review harness alike. Time is the binding constraint on any
simulation of ownership — four hundred and sixty-seven `datetime('now')` in the
services and nullary routines in the registry leave no seam for a clock — so
time passes the way the house has always made it pass: every timestamp the
live schema has is moved N days into the past, in the format its writer used.
The rows the clock most needs (a mandate, an allowance, a sealed envelope, a
settled prediction) are exactly the ones the constitution makes immutable to
application code; passing time is not an edit, so the guard that refuses is
lifted for one uniform translation and put back verbatim, and the helper says
which. `runMorning()` drives the economic loop through the registry the way the
scheduler does. The harness takes `--day N`.

**The working set stays true.** An object's end was written on one row and
read by nothing else. A closed search now takes its debris with it: open
candidates are buried with the reason and a way back ("worth another look if a
search opens that this fits"), undecided designs are retired, and a candidate
buried because its search closed is not held against the next search that
finds the same thing. A test the owner stops is written as stopped on the
test, so the attention queue no longer asks him to list the test he just
stopped. A thread he put away that a reply reopened says when he put it away.
Activity carries the search — started, steered, stopped — in his words.
History names a retired asset. "Recently finished" ages out by the ledger's
date.

**One reading of money.** One approved $100 test read as $-100 on Home, "$100
more without asking" on Controls, "Spent $0.00" on its page, "$100 on a test"
in the week-away letter and "$800 over 7 days" on the absence test — each
correct about a different quantity, none reconciled, one printing the ceiling
as spend. `moneyOfExperiment` reads authorised, carved, allowance standing,
spent, paid and refunded side by side with one word for where the money
stands, and every surface renders it with its own label. A settled test still
reads what it spent. The absence test bounds thinking by the charter the owner
signed, not the provider's ceiling.

Proofs: `the-world-can-be-moved-through-time`, `the-working-set-stays-true`,
`a-test-he-stopped-stays-stopped`, `one-reading-of-a-tests-money`.

## Thirty days of ownership, twice (21 September 2026)

The owner does not use Foundry in one sitting, and a proof that runs in one
second sees the day he gave a direction and never the day he came back. Two
scenarios now run a month over the shared world, through the real entrance,
with the routines run against providers that answer as the real ones do:

- **A search that finds nothing, honestly** (`07-thirty-days-of-a-search`). Day
  1 he replaces the finished search with his direction; day 2 the morning runs
  and every public source answers nothing; day 4 he steers; day 8 he asks what
  he missed; day 30 the search is still open and the month's letter is a dozen
  lines. No candidate is invented to fill the silence.
- **A test through its life** (`08-a-test-through-thirty-days`). Day 1 he
  allows it; day 2 the hand writes; day 3 the receipts arrive; day 8 the letter
  says what was sent, and the charter has expired around a running test without
  touching it; day 10 the sealed rule settles it, the budget ends with the
  answer, the working set lets it go; day 25 the next design under the same
  candidate is written against what this one could not establish; day 30 the
  reading, the letter and Home agree; day 41 the asset retires.

What running the months found, each repaired at the root and kept as a proof:

- **One silent source ended the whole day's discovery.** The issue tracker
  beside the forum was guarded; the forum was read bare, so an unreachable
  `hn.algolia.com` failed the pass for every search and Home read *Stopped*
  the next morning. The forum is passed over out loud now.
- **The world's settlement did not end the test's budget.** The owner's own
  settlement withdrew the allowance; the sealed rule's did not, so a test
  settled by the world kept "may spend $100 more" standing for the rest of its
  horizon.
- **A refund owed by a settled test was refused once its budget ended.** The
  consequence door accepted a refund on the standing allowance or on an exact
  approval whose fingerprint the refund never matched. What is owed outlives
  the test: the refund act the owner approved with it now carries the refund
  after the allowance is gone, and only that — a delivery, a refund, a
  take-down the gateway resolved from the test's own rows.
- **The clock did not move `reconcile_after`**, so receipts stayed forever in
  the future in the laboratory. A clock that moves `_at` and not `_after` is
  not a clock.

## The owner returns after a fortnight (21 September 2026)

A reviewer drove the world at day fifteen as the owner coming back. "What
happened while I was away" answered for seven days by default and called the
rest nothing; it reads the visit marker now and covers the days he was away,
and the letter says the search ran each morning and what it looked at. "Can I
afford to let Foundry run another test?" was routed to the company that
carries Foundry's name and answered from its boundaries — the institution's
own identity product is never "a company he named", and *afford* is a money
question. "Stop pursuing this direction" is a stop. Explore, empty because he
closed the search, said "that is an answer about the world"; it says the
search closed, when and why. A buried candidate's reason was printed twice;
once now. The same steering sentence, absorbed twice, showed twice on
Activity; once now. "What are you working on" names the search before saying
nobody has asked it to look after a company. Proof: `the-owner-returns.test.ts`.


## One word for what happened, the sentences that land, and a settled test that changes the next design (21 September 2026)

Three tranches on the world, each proven from the real entrance.

**What happened has one name.** One settled test read "Stopped by its own
rule" on its page, "Stopped" in History, "settled against its prediction" on
Activity, "not what I expected" in the letter, "It did not hold" in the Ask
answer and "The world said: surprised" — the raw column — on the next-test
page. `what-happened.ts` is the one reader: the word (*as predicted*,
*partly*, *surprised*, *stopped by you*, *closed with its search*, *retired*,
*declined*, *invalid*, *superseded*, *running*, *proposed*), its meaning, the
recorded reason, and what the result does and does not establish. The
experiment page carries "What happened and why"; Home shows the last test's
word when nothing is live; *partly* reaches the owner from the grade the
world wrote beside the two-valued column. Proof:
`what-happened-has-one-name.test.ts`.

**The owner's sentences land.** Six sentences traced through the classifier:
"Is anything making money yet?" had reached the permissions answer because
the word *money* sits in that rule — it is answered from real payments,
refunds, the last settlement and what is set aside. "Show me what you've
found" names the search and the candidates standing. "I don't like this
direction" and "look more closely at calculators" are steering. "Find
something with less legal exposure" with no search open is a direction to
open, held to its constraint, after one confirmation. "Clear the messages
I've already dealt with" is a housekeeping destination at the door: the
count, what moves and what does not, one tap, reversible; the Inbox's Handled
view has the same control. Proof: `the-owners-sentences-land.test.ts`.

**A settled test changes the next design.** `precedent.ts` answers, for a
candidate and a proposed design, whether a settled test on the same candidate
already asked this question by this mechanism: *asked_before* (refused, the
precedent named, the way through stated — say what it changes, or re-run on
the record through the schema's own door), *narrowed* (allowed, with the scope
of what was established beside it), or *clear*. It bites in the proposer, in
the sealing rule (`designStandsInTheWay`) and in the forge's recorded input;
the Explore card says what was tested before; `likeness` compares only within
the candidate. Appropriately, not universally: a different candidate is
untouched and no sealed record moves. The comparison is deterministic — the
carrying words of the question and of the mechanism, thresholds written into
the reason — so the owner can disagree with a reading rather than guess it.
Proofs: `tests/simulation/09-what-was-learned-changes-the-next-design.test.ts`,
`precedent-is-scoped.test.ts`.

## The laboratory grows; the forms follow the evidence; the suite costs what it is worth (21 September 2026)

**A month of a portfolio, with the world going wrong** (scenario 10). Two
companies he named through the Portfolio's own form, a search open, a test
allowed under a charter. The mail provider is down the morning the hand
writes: nothing is sent, the morning says so once, naming the provider's
answer, the experiment page says who could not be reached and that it will
try again, and the next morning the same offers go out once each under the
same idempotency key. Before this month, a failed offer counted its recipient
as done and one bad morning dropped those people from the test for good. A
buyer pays, the delivery bounces, and the payment provider is down when the
refund is owed: the refund waits, the page says it needs him, and issues once
when the provider returns. Naming a second company had made the sender
"ambiguous" so no test could write to anyone; under a Workshop the sender is
the Workshop, as the doctrine already said. On day 30 the letter, Home and
the money reading agree; the companies nothing reports on are listed as ones
Foundry cannot see, never as quiet ones.

**The forms follow the evidence** (`ECONOMICS.md` § *Mechanisms with
sources*). Two forms join the shelf, a free resource that supports a paid
product and something licensed in and resold, each naming the exchange it
would need, which the shelf says is not available today rather than running a
different test. Every open unknown is filed under demand, distribution,
conversion or fulfilment from its own words, and the forge's record says
which, so the cheapest test is for the question actually open.

**The suite costs what it is worth.** Every test file replayed the migrations
into its own database; the first now dumps a template keyed to the migration
files and the rest restore it in one call: tables, then the seed rows, then
the guards. The restored database is proven equal to the migrated one: the
same objects with the same SQL, the same rows in every table, the same guards
refusing the same writes with the same words. One file: 7.8s to 4.3s.
`FOUNDRY_MIGRATION_TEMPLATE=off` is the honest way to compare against.

## Somebody is owed something; the most it can spend today (21 September 2026)

Home's one thing, when a buyer is owed something Foundry cannot carry alone: the sentence, the amount, the payment reference, since when, what only he can do (a refund with money tools off, a dispute only he can answer, a purchase reported after the acts lapsed) and what happens if he does nothing. Economics lists "Owed to buyers" under the subtraction; the test's page carries the same sentence; the queue carries it as "somebody owed something". Controls' Money card leads with today's binding ceiling and why, lists the others as also standing, and calls the monthly budget a note. The Ask answer to "what are you allowed to spend" says today's bound in the same words. The charter page says what also stands beside the charter's rate.

