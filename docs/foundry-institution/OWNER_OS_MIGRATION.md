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
