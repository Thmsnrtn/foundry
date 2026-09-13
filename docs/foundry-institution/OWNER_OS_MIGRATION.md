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
