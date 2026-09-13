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
| 1 | Reconstruct the lived owner surface; classify every route | in progress |
| 2 | One shell, one nav, WATCH/INSPECT/INTERVENE; migrate Home | not started |
| 3 | Founder Cockpit: health, owner action, Now/Next, live experiment, mobile proof | not started |
| 4 | Economic nervous system: events, accounting, reconciliation, reserves, tax | not started |
| 5 | Portfolio / Discover / Autonomy / Roadmap | not started |
| 6 | Experiment Forge, and Experiment 001 as curriculum | not started |
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
