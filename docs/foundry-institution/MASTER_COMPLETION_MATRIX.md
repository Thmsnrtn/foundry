# Master directive — completion matrix

The canonical completion record. One row per requirement, each carrying where it
lives, what proves it, and what it is still waiting for.

## How to read a status

| status | means |
|---|---|
| **SATISFIED** | implemented and proven to the maturity that requirement asks for |
| **PARTIALLY SATISFIED** | real implementation exists, a concrete requirement remains |
| **WAITING ON REALITY** | implementation complete; production evidence cannot honestly exist yet |
| **DEFERRED BY DESIGN** | deliberately absent until justified |
| **SUPERSEDED** | a simpler architecture fulfils the underlying requirement better |
| **FAILED / NEEDS WORK** | not met |

Code existing is never enough for SATISFIED. Implementation maturity, production
proof, commercial evidence and elapsed-time evidence are four different things
and this matrix keeps them apart.

> **A NOTE ON NUMBERING, so nobody mistakes this for something it is not.**
> The completion pass asked for sections 0–52 of the Owner Operating System
> master prompt. That document is not in this repository and was not available
> to the session that wrote this file — `docs/`, the institution corpus and its
> history were searched. Rather than invent fifty-three classifications, this
> matrix is keyed to the requirement sets that ARE canonical here: the seven
> execution phases, the post-tranche closeout, and the completion pass. When the
> master prompt is available, each row re-keys to its section number; nothing in
> the content changes.

---

## The execution phases

| # | Requirement | Status | Where it lives | Proof | Waiting on |
|---|---|---|---|---|---|
| P1 | Reconstruct and classify the lived owner surface | SATISFIED | `docs/.../OWNER_OS_MIGRATION.md` | the classification drove phases 2–7 | — |
| P2 | One shell, one nav, WATCH / INSPECT / INTERVENE | SATISFIED | `views/owner/shell.ts` | 300 measurements, styled, no overflow 375–1440px at 100% and 200% | — |
| P3 | Founder Cockpit — health, owner action, Now/Next | SATISFIED | `routes/dashboard/foundry-shell.ts` | `docs/design/mobile/foundry-390.png` — watch→inspect→intervene on one screen | — |
| P4 | Economic nervous system | SATISFIED *(architecture)* | `services/economy/` | `the-first-real-payment.test.ts` walks provider edge → surplus | a real payment |
| P5 | Portfolio / Discover / Autonomy map / Roadmap | SATISFIED | `places.ts`, `roadmap-place.ts` | measured and screenshotted | — |
| P6 | Experiment Forge, Experiment 001 as curriculum | PARTIALLY SATISFIED | `services/venture/` | 001 encoded; lenses exist | a genuine next candidate to run through them |
| P7 | Quiet maturity, absence tests, cognition economics | SATISFIED | `absence-test.ts`, `cognition.ts` | 7/30/90 read from the live estate | 30- and 90-day horizons |

## The post-tranche closeout

| § | Requirement | Status | Proof |
|---|---|---|---|
| 1 | Reconcile Experiment 001 from canonical rows | SATISFIED | 21 authorised under one consumed act, 19 delivered, 0 replies, 0 opt-outs, 0 purchases |
| 2 | Reclassify the owner queue | SATISFIED | 27 loops retired and **proven stopped in production**; `behavioral_triggers` retired; self-check built; warrants removed from the queue |
| 3 | Consolidate real owner decisions | SATISFIED | 22 clerical approvals → one genuine decision |
| 4 | Finish the clean UI cutover | SATISFIED | `/talk` 404; `/autopilot` 308; zero inline handlers in `src`; strict CSP on all seven authenticated paths, verified in production |
| 5 | Visual proof from production truth | SATISFIED | `docs/design/` — and the gate now serves the stylesheet, which it never had |
| 6 | Economic system, honest maturity | SATISFIED | `economic_events`, `experiment_fulfilments`, `stripe_events` all empty. Nothing manufactured |
| 7 | Tax stewardship without invention | SATISFIED | `economic_policies` empty; a reserve is refused without a rate, a basis and a source |
| 8 | Per-call purpose attribution | SATISFIED | 51/51 call sites name their work from a closed vocabulary; the build refuses an undefined name |
| 9 | Re-run 7/30/90 | SATISFIED | read from the live estate, reported separately, never averaged |
| 10 | Final acceptance report | SATISFIED | `CLOSEOUT_ACCEPTANCE.md` |

## The completion pass

| # | Requirement | Status | Detail |
|---|---|---|---|
| 1 | Continue all actionable work | SATISFIED | nothing actionable was returned to the owner |
| 2 | Do not manufacture proof | SATISFIED | four requirements sit in WAITING ON REALITY below, unproven and labelled |
| 3 | Owner UI against the visual brief | PARTIALLY SATISFIED | judged against the master brief's principles — density, hierarchy, text walls, progressive disclosure. **The supplied visual direction was not available to this session**, so the acceptance target is incomplete |
| 4 | Self-observability | SATISFIED | a modelling gap, now closed — see below |
| 5 | Economic path ready end to end | SATISFIED | `the-first-real-payment.test.ts` |
| 6 | Tax ready to absorb, fact classes distinguished | SATISFIED | `Quality` = measured / estimated / unavailable; owner assumptions carry a source; the boundary is stated to the owner: *"never a filing, a return, or advice"* |
| 7 | Forge proves itself on the next candidate | WAITING ON REALITY | no genuine candidate has emerged; forcing one would be manufacturing proof |
| 8 | Cognition measured by outcome, not label | PARTIALLY SATISFIED | `work` says what a call was for; `changed_something` says whether it mattered. Joining the two needs production cycles |
| 9 | Delete or crystallise unnecessary machinery | PARTIALLY SATISFIED | 27 loops off the timer. The 39 modules are under a bounded observation window — see WATCH |
| 10 | Recoverability 7/30/90 | WAITING ON REALITY | holds at 7; 30 and 90 need elapsed time, not architecture |
| 11 | This matrix | SATISFIED | this file |
| 12 | Continue past "Phase 7 complete" | SATISFIED | four further commits after the phases closed |

---

## Item 4 in full — self-observability was a modelling gap

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

**No new external provider is required, so there is no owner decision here.**

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

| Requirement | Resolved by | Expected |
|---|---|---|
| Economic path, production proof | the first real payment reaching `economic_events` | unknown — no purchases |
| Tax stewardship, production proof | the first tax-relevant activity | after the first payment |
| Experiment Forge maturity | a genuine next candidate passing the lenses before reaching the owner | when one emerges |
| Recoverability at 30 days | the copy ladder reaching back 30 days | **≈ 4 October 2026** |
| Recoverability at 90 days | the ladder reaching back 90 days | **≈ 3 December 2026** |
| Cognition paying rent | `work` × `changed_something` over real production cycles | weeks |

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
- **The visual direction** was not available to this session, so the UI
  acceptance target is incomplete rather than met.

## OWNER

Nothing. The one decision previously escalated — *connect something to Foundry
or accept that quiet means nothing* — was a modelling gap and has been withdrawn.
No new external provider, source or commitment is required by anything above.
