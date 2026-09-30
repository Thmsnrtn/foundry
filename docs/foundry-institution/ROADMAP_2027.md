# Roadmap 2027: from an institution to a livelihood

*Written 30 September 2026, at the owner's request: "formulate a new roadmap to
take this work even further… think about my daily use as the owner and sole
operator of Foundry looking to have this sustain my livelihood financially as
successfully and intelligently as possible." Approved the same day ("Continue
through everything").*

**Where it sits.** `STRATEGY.md` is doctrine (S1–S100, what Foundry should
become and what would show it wrong). `ROADMAP.md` is the execution list, with
a commit for every closed row. This file sits between them: the milestones,
lenses and horizons that decide which `STRATEGY.md` items become `ROADMAP.md`
rows, and when. It grants nothing: no item here authorises spending,
publishing, messaging, contacting a buyer or changing an account.

The draft was reviewed adversarially from five seats (CFO, the owner as a daily
phone user, security, doctrine, engineering) and corrected before it was
approved; the corrections are folded in, not appended. The previous plan
(Mission Control M1–M7, then `INSTITUTION_MODEL.md` V1–V7) closed at
`7925d7a2`.

## Context: what is true on 30 September 2026

**What exists.** In twelve weeks: 1,352 commits, ~147,000 lines of TypeScript in 472 files, 347 tables, 72 scheduled jobs on one always-on Fly machine, 692 test files of which ~350 are named as laws (`a-mission-grants-nothing`, `a-week-away-widens-nothing`, `trading-is-paper-and-simulation-only`…), 43 static gates in `npm run check`. Authority is enforced by code at the doors, never by a model. Every consequential act is audited, idempotent, kill-switchable, reversible where reversal exists. Payment plumbing is complete end to end (Stripe link → webhook → `economic_events`; Etsy read → `venue_orders` → the same ledger). Etsy is connected at read scope. Grading of sealed predictions exists (`validation.ts`, `calibration.ts howOftenRight`). "While you were away" is on Home. The owner surface is four doors and a composer, phone-first, with a Mandate that can only narrow.

**What has not happened.** By the ledger, no external buyer has ever paid. Experiment 001 (a $29 brief, 21 businesses written to) settled at 0. Experiment 002 (a $14 Bid Decision Workbook on Etsy, listed by hand) has been hidden from Etsy search since 25 September because the shop is in Developer Mode; Etsy has not yet confirmed the restore. The charter (PENDING 17) is unsigned, so thinking is capped at $1/day and no test can seal. The owner has never used the current surface on their phone. λ (value per owner-minute) has never been stated; recurring owner-minutes cannot be recorded (the `owner_minutes` trigger binds every row to a test). Concentration reports `null`. Nothing reaches the owner's phone; email arrives only when a routine stops, plus three legacy letter/digest jobs from the multi-user era. `master` is 1,288 commits behind, so the GitHub witness does not run. The calibration share is hidden below eight graded predictions. Tax reserve returns "unavailable" the moment a dollar is earned with no policy entered.

**The doctrine's own verdicts, which this roadmap obeys.**
- `OBJECTIVE.md` §2(b): *"Does this reduce recurring owner-minutes for an asset that exists? Almost nothing built so far passes it, because no asset exists."*
- `OBJECTIVE.md` §4: *"Defend the river before extending it… the institution is currently built almost entirely the other way round."*
- `OBJECTIVE.md` §6: nothing counts unless it moves **recurring owner-minutes per asset ↓ (A)**, **calibration ↑ (C)**, or **cost per decision ↓ (D)**, or holds a **bound (B)**. Everything else is machinery.
- `EXECUTIVE_REVIEW.md` C-1: the objective is *first external payment plus delivery*; until then no new product types, venues, or governance subsystems. C-2: no external payment by **29 March 2027** → the thesis is reviewed from the top. Top risks: *"thesis fails slowly"* and *"engineering keeps growing governance."*
- `STRATEGY.md`: six months with no external event means the strategy was machinery.

**The diagnosis.** Foundry is a superb institution for governing an economy that does not yet exist. The binding constraint is not software, and not "the world" in general: it is **four owner acts on Etsy's clock** (findability restored, a charter with a named minimal envelope, one week on the phone, the two-minute stats habit) **plus deletion**. So this roadmap runs the other way from every one before it: **the world first; software rationed to what lets the owner read the first real result truthfully; and something deleted for everything added.**

**The intended outcome.** By the falsifier date the owner has a dated answer to "is this a livelihood component?" from actuals; and Foundry's own cost, the owner's own minutes, and the portfolio's contribution sit on one monthly line read in under a minute.

---

## Part I: The spine, five milestones (from `STRATEGY.md` S92), each with a denominator and a way to fail

Horizons are gated by events, never dates. The only date is the falsifier. **Tags:** `M*` = after that milestone's event has happened; `H0`/`H1` = before any event, allowed only because it is what reading the event needs.

| # | Milestone | Denominator | How it fails | Unblocks |
|---|---|---|---|---|
| **M0** | **The unblocking fortnight**: the owner's acts (Part III-H0), ~6–8 owner-hours in total | Each act read back from production state where readable | Any act still open after 14 days is recorded as "deferred, because…" | Everything below |
| **M1** | **First findable 30 days, and the first external payment and delivery** (Proof 3, C-1) | Proof 2's own sealed prediction (`proof-2.ts`): 30 eligible listing days with Etsy readable; *views in the tens, at least one favourite, zero to three orders*; one natural order settled through the ledger, delivered, no remedy owed | 30 findable days with views in the tens and 0 orders → the **offer** failed (a real result, the binding-constraint question follows); views not in the tens → **reachability** failed; < 30 findable days → nothing was tested | M2; PENDING 27 with evidence; H2's branch |
| **M2** | **A second independent customer, and `v > λ·a` for two months** | Two buyers with no shared referrer; contribution after ledger (3) (care and owner minutes × λ), not merely after fees, positive in two consecutive months | One buyer only; or contribution after care ≤ 0 in month two | The harvest question; the second recipe |
| **M3** | **Covered care and a real absence**: 7 days with a live asset and no owner act | The absence test HOLDS on real rows for 7 consecutive days while a listing is live; message coverage stated and honoured; Etsy token refreshed without the owner | Any buyer owed a reply or remedy in the window with no arrangement | Autonomy rungs 4–5 (S95); M4 |
| **M4** | **One proven adjacent product, and one independent acquisition path** | A second product whose buyer evidence came from the first (S30); a sale whose acquisition-source label is not `venue_search` on the same venue | Product count rises without an independent source | The diversity target (S39); the portfolio at 3–5 |
| **M5** | **A livelihood component**: a draw rule the owner ratified, and a distribution recorded from a surplus with tax held | Four ledgers across ≥ 3 months; contribution per owner-hour and per dollar at risk; `owner_distribution` recorded from `distributableSurplus` with the tax reserve applied | No ratified draw rule, or no distribution ever recorded from a real surplus | Foundry as allocator (opportunity cost, INSTITUTION_MODEL §14) |

**The $1,000-a-week instrument** (S93) is not a milestone's test. Recomputed from actuals, it feeds the owner's S6 choice (*operate and allocate, or originate*) and nothing else.

**Falsifier (C-2, 29 March 2027).** If M1's payment has not arrived: cut to the smallest thing that reaches the world, and put S6 to the owner as a dated decision.

---

## Part II: Thirteen lenses, each with what is true, what "further" looks like, its gate, and the measure it moves

**[owner]** a decision or account act only the owner can take · **[world]** a real buyer or real time · **[code]** buildable against doubles, only at or after its tag · **[think]** settled in writing.

### Lens 1: The owner's day (daily use, on the phone)

*True now.* Home answers the 30-second test from the readers the doors use. "While you were away" is on Home but reads only `standing='earned'` assets, so the experimental one is invisible to it. No push exists. Three legacy email jobs run (`fleet_letter_notify` daily, `digest_generate` Monday, `weekly_synthesis` Friday), none of which says the five things that matter. No ritual is defined anywhere. No PWA install path or honest offline state.

*Further.*
1. **[owner, H0] One week on the phone** before anything below is built. Record tap counts and where it lied. (ROADMAP A11, F1.)
2. **[code, H1] One weekly email worth reading**, in S60's five sets (earned and settled; buyer obligations; marketplace visibility; work deliberately stopped; one decision that would change the economics), sent through the gateway via `sendAccountNotice`, idempotent per ISO week, **sent only when the five sets changed** (else one line: "Quiet"), with the stats-entry form one tap away, and "check Etsy messages" present only when an order exists. **It replaces the three legacy jobs, which are deleted in the same slice.** The check-in style (`involvement` Mandate statement) sets `setMaxChannel`, so Away/Quiet quietens it. Measure A.
3. **[code, H1] Away reads the experimental asset**: widen `a-week-away.ts` from `standing='earned'` to include experimental assets, so the return surface covers the one thing that exists. Measure A.
4. **[code, M1] Web push through the gateway** (RESOLVED 8) for Urgent only: buyer owed a remedy, routine stopped, kill-switch tripped. One owner-only device route, one more secret (VAPID). SMS stays absent. Measure A, B.
5. **[code, M1] PWA install and an honest offline "last known state"** (ROADMAP F6): a Fly restart shows a phone user nothing today. Measure A.
6. **[think] The owner's rhythm** (Part IV), enforced by what each surface shows at that cadence, never by reminders.

### Lens 2: Money and livelihood

*True now.* `/foundry/money` reads held, charged, contribution, refund exposure (100% reserve until 10 sales; the revisit at the tenth sale is already wired), tax reserve (unavailable until a `tax_reserve` policy exists), distributable surplus, carrying cost (models measured; hosting "not stated"; a cost-line form exists). `moneyBanked` is unavailable because the Stripe account is shared. `moneyHeld` goes unavailable on the first non-USD sale. Owner draw exists as `owner_distribution`. λ never stated; recurring minutes unrecordable.

*Further.*
1. **[owner, H0] Enter the cost lines** (Fly, Cloudflare, domains, Clerk, Etsy, OpenRouter, from the accounts), **a tax-reserve policy** (rate and basis; without it the first dollar reads "I cannot say what is yours"), and **a λ range**. S2 says derive λ from behaviour, not by asking; this departs from S2 deliberately: with no assets, there is no behaviour to derive from, so ask once and revise from behaviour later.
2. **[code, H1] λ and recurring minutes**: λ as a third `economic_policies` kind through `policyInForce`; relax the `owner_minutes` trigger so minutes can be scoped to an asset or to Foundry itself, not only a test. Then `v > λ·a` is computable. Measure A.
3. **[code, H1] Foundry's own monthly line** (S13): hosting + models + owner-minutes × λ against the portfolio's contribution, on Money and in the weekly sets; `carryingCost.ownerMinutes30d` already exists. **The frozen baseline** (ROADMAP D7): a bare Etsy listing plus a spreadsheet, costed as the way to earn the same $12.22 with zero Foundry cost; shown beside Foundry's line so "livelihood component" can tell Foundry from overhead. Measure D, B.
4. **[code, M1] Payout reconciliation**: Etsy from its payment-account ledger (`transactions_r` scope, on the seller's own payout schedule with new-seller holds, never an assumed 14 days); Stripe read-only via `balance_transactions?payout=` filtered on `app=foundry` metadata, saying plainly that it reads the other apps' rows to do so. Currency: a non-USD sale is recorded in its currency and converted only at payout. Measure C.
5. **[code, M2] The four ledgers** (S14): settled receipts; variable costs and refunds; maintenance and owner attention; shared infrastructure. Contribution after (2) for marginal decisions; the draw after (3), (4), tax and cash timing. **Contribution per owner-hour and per dollar at risk** as the portfolio metric. Measure A, D.
6. **[code, M2] The $1,000-a-week instrument** (S93) from actuals nightly, as a sensitivity feeding S6, never a forecast. Measure C.
7. **[owner+code, M2] A harvest policy** (S11) ratified by the owner; **the kill question that raises itself** (S12), never an automatic kill. Measure A.
8. **[code, M5] The draw**: `owner_distribution` proposed monthly from the ledgers with tax held; the owner confirms; nothing moves money (Foundry has no bank access and this roadmap gives it none). Measure A.

### Lens 3: Distribution and reachability ("a store without traffic is infrastructure, not evidence", S45)

*True now.* One venue, Etsy, read-only, hidden in Developer Mode. Acquisition-source labels are doctrine (S46), not rows. The Workshop at apexmicro.ai is an owned channel whose audience question is open (PENDING 18). No ad path, by choice. Experiment 002 is a sealed **untouched** test: its title, tags and price may not change during the window (P-1).

*Further.*
1. **[owner, H0] Restore findability and tell Foundry the date** (ROADMAP B11), on Etsy's clock. **[owner] The two-minute weekly Etsy Stats entry** using the form that exists (`experiments-place.ts` C3), so "no sale" has a denominator.
2. **[code, M1, branch "visits but no purchase"] The listing review** (C1) and **a sealed price test** (S15, C2): only after the untouched window closes, one variable per test, never two prices at once. Measure C.
3. **[code, M2] Acquisition-source labels from provider evidence only** (S46) and **a channel scorecard** (S48). Measure C.
4. **[owner, M1] PENDING 18**: the Workshop is the only consented audience Foundry has; what it may say to them decides whether an owned channel exists at all.
5. **[owner+world, M2→M4] The second channel, chosen to lower correlation** (S43): the owned channel, a direct Stripe checkout on an owned page, or a partner/licensing path if M1 names one. No second marketplace before the first result.
6. **[think] Search has a landlord** (S49).

### Lens 4: Products and forms

*True now.* One recipe (A03 job-review XLSX, hand oracle, LibreOffice recalculation). Forms as sourced decision knowledge (D1). The asset state machine's witnesses exist; the *page* that shows them is what is missing (INSTITUTION_MODEL §5.9: no new column). PENDING 27 and 20 are the owner's.

*Further.*
1. **[owner, H0] PENDING 27**: the dossier's advice is *wait for Experiment 002's first result*. **[owner] The A03 self-test** (two or three real finished jobs; if none has actual hours on paper, A03 stops there).
2. **[code, M1, on the first order] Help page inside the file and the version policy** (C4, C5): a correction makes a new version and finds the buyers of the old one. Measure B.
3. **[think, M1] The binding-constraint question** after every result (S96): no qualified arrival / unconvincing offer / unhelpful product / incomplete stewardship. **The next engineering unit answers that constraint before the product count grows.**
4. **[code, M2] The asset's transitions on one page** (S89) composed from the witnesses that exist (sealed design, B3 file readback, A3 sold version, pause, retire). No new column. Measure C.
5. **[code, M2] The originality ladder** (S53) as a field on every design; the forge refuses to seal below "role-specific instrument". Measure C.
6. **[owner+think, M2] The first coherent line** (S91), a bundle only after each part is useful alone.
7. **[think, M4] Acquisition as a form** (S57) and licensing (S55), compared, not built.

### Lens 5: Stewardship and care (defend before extend)

*True now.* Obligations know their channel; the absence test counts owed buyer duties. Etsy refunds are issued by the seller in Etsy Payments; Foundry has no write scope and needs none. `FOUNDRY_ENABLE_MONEY_TOOLS` is Stripe-only and off; no Stripe product is live. Etsy messages cannot be read; the human route is stated on the asset page. The Etsy refresh token lasts 90 days.

*Further.*
1. **[owner, H0] Record the Etsy refund habit** (who refunds, within what window) the way `sayHowMessagesAreChecked` records messages. Money tools stay off. PENDING 26 (refund reserve in cash) is ≤ $140 at ten $14 sales and its revisit is wired; it waits for the tenth sale.
2. **[code, M1] Message coverage as a stated arrangement** with the deadline and the last safe time to act, on Home when a buyer might be waiting. Measure B.
3. **[code, M2] Real recovery states** for refund, delivery and reads (A7); the seven operating-contract questions answered for every live asset (A6). Measure C.
4. **[code, M2] Defend-before-extend as a scheduler rule** (S41): threats to live assets ordered ahead of origination in every tick, the order shown on Explore. Measure A.
5. **[world, M3] The real 7-day absence** with a live asset, once; then 30 and 90 (S62). **The 90-day token** must refresh unattended before the 90-day rung is claimed.

### Lens 6: Learning and calibration (the sensor everything else needs)

*True now.* Settlement grades predictions; `howOftenRight` aggregates; the share is hidden below `ENOUGH_TO_HAVE_A_RATE = 8`, which contradicts S24 ("even at n = 1"). Lessons have lifecycle but no expiry. Two nulls are the only settlements.

*Further.*
1. **[code, H1] Calibration on Home at any n**: the share with its count from n = 1, worded as "1 of 1" rather than a rate. **The follow-up sealed with the test** (S22) as a field on `probe_designs`; **"did this test change a decision?"** (S21) as a Needs-you the owner answers at settlement, recorded on the test. Measure C.
2. **[code, M2] Reference-class forecasting** (S27) before sealing; **lesson expiry** (S25). Measure C.
3. **[code, M2] Which model made which judgement**, on every sealed reading (S71). Measure C.
4. **[owner+code, M4] Consolidation** (S26): N episodes → a proposed rule; the owner ratifies; unwindable. Never a rule a model wrote into force. Measure D.
5. **[owner, when funded] E1** on frozen cases (S29).

### Lens 7: Elastic operation and cost per decision

*True now.* Fixed crons. Cognition routing exists; `cognition.ts` skips calls when the digest is unchanged. Spend $14.88 per fortnight, 70% untagged Sonnet. Caps $2/$5/$5 per day; $1/day until the charter. The Etsy reader runs hourly inside `experiment_hand_tick` on public GETs well under the 10K daily quota, so "elastic Etsy" would move no measure: dropped.

*Further.*
1. **[code, H1] The decision a call could change, declared statically**: `WORK_THE_MODEL_DOES` in `what-it-is-for.ts` gains `couldChange`, a closed vocabulary set by code, never by model output; a purpose that could change nothing is skipped and counted. **Cost per decision** on Money. Measure D.
2. **[code, M2] Loops follow prediction error** (S32) for discovery and the forge, once there are settlements to diverge from. Measure D.
3. **[code, M2] Pruning** (S34): search terms that retrieve nothing retire; capabilities that stop working degrade. Measure D.
4. **[code, M2] Set points** (S33) regulated toward, distance shown. Measure A, D.
5. **[code, M4] Budget elasticity within the charter** (S37), said aloud.

### Lens 8: Autonomy and authority (per task, never per portfolio)

*True now.* Consequence rungs sealed by trigger; financial needs an allowance; legal/destructive exact approval every time. Mission budgets are tripwires; allocation bands unread by the forge; no policy preview; the reader explains and the doors enforce, held equal by a test. All three of these are governance and wait behind C-1.

*Further.*
1. **[code, M2] The policy preview**: "with this rule, these N acts of the last 30 days would have been refused / asked / allowed", computed by the reader, never a door. Measure C, B.
2. **[code, M2] Mission budgets enforce by narrowing** (INSTITUTION_MODEL §11 "later"). Measure B.
3. **[code, M3] Allocation bands read by the forge**, steering only. Measure A.
4. **[code, M3] The autonomy ladder per task** (S95), shown per asset on Control with what earned each rung and what would lose it; recurring approvals never become standing authority. **Evidence threshold scaled by consequence** (V6 debt). Measure A, C.
5. **Never**: a model-proposed reading that binds; a confidence score that earns a rung; a Mission, Mandate, mode, absence or sentence that widens anything. These remain the law tests they are.

### Lens 9: Capital research (a side lane, never income)

*True now.* Kalshi and Polymarket 15-minute BTC contracts, public GETs every 5 minutes; forecasts sealed and scored; paper fills `provenance='simulated'` by CHECK; no order/account/balance table. Not started in production. C-3 stop rule: `market_is_better` or `no_net_edge` twice at ≥ 200 markets.

*Further.*
1. **[owner] PENDING 28 acts** (revoke the old key), **PENDING 29** (read-only own-account key).
2. **[world] Let the 200-market falsifier run** (S97), verdict on Explore's three worlds. If it stops, delete the loop; if it survives holdout, nothing changes: an edge authorises nothing (S99).
3. **[think] Trading products as ordinary ventures** (S98), on the same funnel as everything else.
4. **Never in this roadmap**: an order path, an execution service, a venue mandate.

### Lens 10: Resilience, continuity and the solo operator

*True now.* One machine, one volume; nightly copy on the same volume; R2 "not configured"; witness not running (`master` behind; and GitHub pauses schedules after 60 idle days); Sentry DSN unset; Clerk dev instance in production; keys pasted in chat not rotated; Node 20 past EOL; `npm audit || true`; 17 POST routes on the unguarded baseline including `/autopilot/panic`, `/connections/:name/disconnect`, `/connections/grants/:id/revoke`; migrations run at boot, fail-closed; rollback manual; the intermittent libsql panic (D-9) has no root cause and qualifies every green claim. D-1 (SSRF) and the literal HMAC fallback are already closed. Health deliberately does not 503 on logical faults (Fly would restart the machine and the copy would never be made); the witness already parses the body for `copies`/`scheduler`.

*Further.*
1. **[owner, H0] The acts** (Part III-H0), credentials first (a GET once started a live bot).
2. **[code, H0] The unguarded POST baseline to zero.** An anonymous `disconnect` during the window blinds the Etsy reader and turns findable days into "not read". Panic stays reachable from the composer, behind CSRF and the owner gate. `npm audit || true` dropped; Node 22 in the Dockerfile, the seven workflow pins and `engines`. Job failures reach the owner by email at most once a day through `institution_pulse_tick`, message-free (migration 172's rule kept). Measure B.
3. **[code, H0] The libsql panic**: capture, reproduce under `load:crons`, root-cause or pin; **auto-rollback** (R-2): deploy-private rolls back to the previous image when health does not report the new SHA within its window. The tranche's own verification chain depends on both.
4. **[owner, M1] The first production restore rehearsal by hand** (S73), from R2, once. **The witness keepalive**: any push resets GitHub's 60-day pause; the quarterly cadence would kill it, so the monthly review includes one commit to `master` (the maturity-map entry).
5. **[code, M2] A chaos calendar** (S77), one dependency outage rehearsed monthly in the laboratory (model provider, Etsy, Resend, Clerk, Fly volume), the runbook (S40) as the test. **Pre-deploy migration dry-run** against a restored copy (G5 exists); boot stays fail-closed. Measure B.
6. **[think, M3] Provider exit plans** (S76); **succession at 90 days** (S75): what a named person may read, stop and refund, nothing else. Counsel debt.

### Lens 11: Architecture, a simpler equivalent (delete > simplify > add)

*True now.* 31 retired loops with code kept; 43 model call sites, most in retired SCP agents; twelve named agents propose acts nothing carries out (PENDING 16); **two** legacy execute paths beside the gateway (`scp/actions/executor.ts` with two live callers in `departments/`, and `outbound/executor.ts`); orphaned commercial-era services; dormant tables kept until erasure into `retired_rows` is designed; the undertaking → Mission cutover (M11) not done; `.git` 561 MB of 640 MB; `npm run check` ~10 minutes.

*Further.*
1. **[code, H0] Deletion tranche 1, no decision needed** (D-8): the retired SCP jobs and their call sites, orphaned commercial services, the legacy LLM-estimated P&L, the three legacy letter jobs (with Lens 1.2). Each deletion carries a test that what it governed is *refused*, not merely absent. The biggest check-time win available. Measure D.
2. **[owner → code, H1] Deletion tranche 2 after PENDING 16**: the twelve agents and both legacy executors once every caller is on the gateway.
3. **[code, M2] The undertaking → Mission cutover** (M11), shadow → compare → cutover → delete; undertaking tables into `retired_rows`.
4. **[code, M2] The check under budget** (S82); dormant surfaces inventoried (S79) and deleted after one release.
5. **[think, standing] "What to delete?"** at every quarterly review (S83), with the count of tables read by nothing. **The ratio rule** (Lens 13) starts paying on the first slice.

### Lens 12: Legal, identity and reputation (bounds, never traded)

*True now.* Counsel owed on PENDING 9, 13 (largely moot), 15 (disclosure should name OpenRouter and OpenAI). Public identity PENDING 19; the repo is public (PENDING 23). The charter is per portfolio.

*Further.*
1. **[owner, H0] PENDING 15 interim**: correct the disclosure to name the real sub-processors now; counsel later. **PENDING 19.**
2. **[owner, M1] The counsel batch at the first sale** (L-2): retention after erasure, the sub-processor disclosure, the refund promise's wording, and the entity question, in one sitting rather than four.
3. **[code, M2] Charter per product** (S66) capped by the portfolio charter: maintaining one workbook authorises no ads, no new listing, no bulk email. Measure B.
4. **[think, M2] The consequence ladder as a public promise** (S68); **consent never carries** (S70) as a law test.
5. **[owner, M5] Tax and entity** recorded; the reserve is a number Foundry holds back, not advice.

### Lens 13: Foundry developing Foundry (rationing the engineering)

A standing rule for every slice from here on:
- **It names the measure it moves (A, C, D) or the bound it holds (B), the external event that earned it, and the condition under which it is deleted** (ROADMAP D8, S87), in the maturity-map entry, before the red test.
- **The ratio rule**: for every slice that adds a table or a job, one deletes one; the quarterly review reports both counts.
- **No slice ahead of its tag.** A `M2` item does not start because it is well understood; it starts because M1's event happened and the binding-constraint question pointed at it.
- **The quarterly review** (S88): Is the thesis holding (S1)? Did calibration rise (S24)? Did `a` fall (S59)? What came from the world rather than from inside? What was deleted?

---

## Part III: Horizons, in order, gated by events

### H0: The unblocking fortnight (owner acts, ~6–8 hours; four code slices)

Ordered by the executive review (credentials first), then by what each unblocks. Each is read back from production state where the state is readable.

| # | Act | Ref | Unblocks |
|---|---|---|---|
| 1 | Revoke the old Kalshi key; rotate the pasted Fly token and the Anthropic key; rotate `ECOSYSTEM_SERVICE_KEY` | PENDING 28, 12 | credentials clean |
| 2 | Switch Clerk to the production instance (7 steps, ~1 h with DNS) | PENDING 24 | sign-in not on a dev key |
| 3 | Set the five R2 secrets | PENDING 30 | the copy leaves the machine |
| 4 | Merge to `master`; push the archive tag | ROADMAP Next | the witness runs |
| 5 | Enter the cost lines, a tax-reserve policy (rate, basis), and a λ range | Lens 2.1 | Foundry's own line; `v > λ·a`; the first dollar is readable |
| 6 | Set `SENTRY_DSN`, or decide not to | review | errors seen off-machine |
| 7 | One week on the phone; report where it lied | ROADMAP A11, F1 | every phone item |
| 8 | PENDING 21 (Experiment 001's null), 16 (retire the twelve agents), 20, 27 (wait), 15 interim, 19 | Lenses 4, 11, 12 | deletion tranche 2; the record |
| 9 | Record the Etsy refund habit; money tools stay off | Lens 5.1 | the public promise is honourable |
| 10 | Sign the charter with the **smallest envelope that lets tests seal**, named on the form (e.g. $0 for tests, $3/day thinking, 30 days); signing lets the hand place approved probes without a further tap, so the envelope is the authority | PENDING 17 | thinking above $1/day; sealing |
| 11 | Restore findability (on Etsy's clock); tell Foundry the date; start the weekly two-minute Stats entry | ROADMAP B11, C3 | the 30-day window |

*Code allowed in H0, all in service of the acts:* **R1** the "Your decisions" sheet; **R2** the POST baseline to zero, Node 22, `npm audit`, failure email; **R3** the libsql panic and auto-rollback; **R4** deletion tranche 1. Nothing else.

### H1: The first findable 30 days (before M1's event; only what reading it needs)

*Entry:* acts 10–11 done. *Exit:* 30 eligible listing days read from Etsy, and either a settled natural order or a graded null with its denominator.

Code: **R5** the weekly five sets (replacing the three legacy jobs) and Away reading the experimental asset; **R6** λ, recurring minutes, Foundry's own line, the frozen baseline; **R7** calibration at any n, the sealed follow-up, the counterfactual question; **R8** `couldChange` and cost per decision; **R9** deletion tranche 2 after PENDING 16. *Not allowed:* a second venue, a second product, ads, any change to the untouched listing, any governance subsystem (policy preview, enforcing Mission budgets, charter per product all wait for M2).

### H2: After the first result (M1 → M2), branch by the binding constraint

| M1 said | Then |
|---|---|
| Views not in the tens (no qualified arrival) | Reachability: PENDING 18 and the owned channel; channel scorecard; acquisition labels. **Not** a second workbook. |
| Views in the tens, no purchase | The offer: listing review (C1), then one sealed price test (C2), one variable at a time. |
| Buyers use a free tool | Move cluster; PENDING 20 (free-with-a-role) becomes live; do not bundle weak products. |
| One sale, obligation started | Care first (help page, version policy, message coverage, payout reconciliation, the counsel batch); then the second buyer; PENDING 27 with evidence. |
| A partner or licensing contact | Compare licensing with marketplace listing; counsel on the agreement. |

Plus, once M1's event exists: the four ledgers, the $1,000/week instrument from actuals, harvest and kill questions, reference-class forecasting, lesson expiry, pruning, set points, defend-before-extend in the scheduler, the policy preview, Mission budgets that narrow, charter per product, the chaos calendar, undertakings → Missions.

### H3: Covered care and a real absence (M3)

The 7-day absence with a live asset and the token refreshing unattended; the autonomy ladder per task on Control; allocation bands read by the forge; evidence threshold by consequence; provider exit plans; succession at 90 days; then the 30-day absence.

### H4: The second asset on an independent channel, and the portfolio at 3–5 (M4)

A diversity target set *before* the second asset (S39); concentration fed by real rows (venue, buyer segment, recipe, traffic source); consolidation of lessons into rules the owner ratifies; the originality ladder as a refusal; what transferred (S30); when two assets are worth more as one (S44).

### H5: A livelihood component (M5)

Four ledgers across ≥ 3 months; contribution per owner-hour and per dollar at risk; the draw proposed monthly and confirmed; tax and entity recorded; Foundry as allocator with "distribute to the owner" as a compared alternative (OBJECTIVE §9); the 90-day absence; "does owning Foundry make the owner a better allocator?" (S65).

---

## Part IV: The owner's rhythm (what daily use should feel like, after H0)

| Cadence | Where | Minutes | What they see, and only that |
|---|---|---|---|
| **Morning** | Home on the phone | ≤ 1 | The seven answers. "Quiet" as one line when nothing diverges. The one thing that needs them, with its six answers, or nothing. |
| **Weekly** | One email (only when the sets changed) + the Stats form one tap away | ≤ 10 | Earned and settled; buyer obligations; marketplace visibility; work deliberately stopped; one decision that would change the economics. Two minutes of Etsy Stats until reads replace it. |
| **Monthly** | Money | ≤ 20 | Foundry's own line against contribution and against the frozen baseline; the $1,000/week instrument from actuals; harvest or kill questions raised; the draw proposed; one chaos rehearsal's result; one commit to `master` (the witness keepalive). |
| **Quarterly** | Control → Record | ≤ 60 | S88's fixed questions; the thesis check; calibration and `a` over the quarter; what was deleted; the decisions sheet. |
| **On return** | Home | ≤ 3 | HANDLED · CHANGED · NEEDS YOU · DELIBERATELY NOT DONE · STILL OPEN, including the experimental asset. |

Total recurring owner-minutes has a set point written on Control, regulated toward, its distance shown. A month in which revenue rose and minutes rose past the ceiling is reported as a failure of the institution (OBJECTIVE §1). H0 itself is the exception: ~6–8 hours once, named here so it is not mistaken for the steady state.

---

## Part V: What this roadmap refuses

- No new factories, venues, product types or governance subsystems before M1 (C-1); no change to the untouched listing during its window (P-1).
- No live trading, no order path, no venue mandate; an edge authorises nothing.
- No paid acquisition; no page made to rank; no mass scraping; no Etsy write scope; no Stripe money tools while no Stripe product is live.
- No model that decides permission, proposes a binding reading, decides whether it runs, or earns a rung by confidence.
- No Mission, Mandate, mode, absence or sentence that widens authority. Ever.
- No multi-user, no selling Foundry, no second economic system, no treasury, no bank access.
- No forecast presented as a plan; no trajectory called proven from one month, one listing, or a model's estimate; no open-tracking of the owner's own email.
- No slice ahead of its tag, and none without its measure, its event, and its deletion condition; nothing added without something deleted.

---

## Part VI: What would show this roadmap wrong

- **29 March 2027, no external payment**: the thesis is reviewed from the top; S6 put to the owner as a dated choice.
- **`a` does not fall as the second asset is added**: the threshold thesis is wrong for this owner.
- **Calibration does not rise across ten graded tests**: the learning apparatus is prose; delete it.
- **Tables and jobs grow faster than the S92 milestones**: the ratio rule was ignored; stop adding.
- **The owner's weekly minutes exceed the set point in two consecutive months at constant revenue**: the institution is making the owner operate it.
- **The owner does not tap through from the weekly email three weeks running, or says so when asked**: they are the wrong five sets; ask, do not add.
- **Foundry's own line is never below the frozen baseline's**: Foundry is overhead on a spreadsheet business, and the honest move is the spreadsheet.

---

## Part VII: The first tranche (nine code slices, all inside H0/H1)

Each slice: red test → full `npm run check` (to a scratchpad log, `CHECK_EXIT`) → commit `[deploy-private]` → push to `claude/foundry-v3-north-star-finish-vxq2ea` → health reads back the SHA → maturity-map entry naming measure, event and deletion condition. R1–R4 need no owner act. R5–R8 are built during H0 so they are live when act 11 starts the window, in the order the phone week (act 7) shows was missing. R9 waits on PENDING 16.

| # | Slice | Reuses (real files) | Deletes | Test (red first) | Measure |
|---|---|---|---|---|---|
| **R0** | This roadmap into the repo as `docs/foundry-institution/ROADMAP_2027.md` (Parts I–VI), indexed in `README.md`; the maturity-map template gains measure / event / deletion-condition fields and the ratio counts | `check-record-matches-code` | — | `the-record-names-the-measure` | — |
| **R1** | **"Your decisions" sheet** on Control: the eleven acts and the open PENDING items, each read from production where readable (charter: `charter.ts`; Clerk key prefix; R2: `sending-away.ts` configured; Etsy: `company_senses` and `findability.ts`; cost lines: `foundry_cost_lines`; tax policy: `economic_policies`). No outbound calls (witness state is not read). | `OWNER_DECISIONS_PENDING.md` gate; `effectiveAuthority` reader pattern | — | `an-open-decision-is-read-not-typed` | A |
| **R2** | **The unguarded POST baseline to zero** (`docs/db/unguarded-route-baseline.txt` → empty; panic reachable from the composer behind CSRF and the owner gate); `npm audit` without `\|\| true`; Node 22 (Dockerfile, seven workflow pins, `engines`); job failures emailed once a day via `institution_pulse_tick`, message-free | `check-route-guards.mjs`, `csrf.ts`, `institution_pulse_tick` | the baseline file's 17 lines | `no-post-is-unguarded`, `a-stopped-loop-reaches-the-owner-once` | B |
| **R3** | **The libsql panic and auto-rollback**: reproduce under `load:crons`, root-cause or pin; `deploy-private.yml` rolls back to the previous image when health does not report the SHA in its window | `deploy-private.yml`, `health.ts`, `load:crons` | — | `a-deploy-that-never-reports-rolls-back` | B |
| **R4** | **Deletion tranche 1**: retired SCP jobs and call sites (`RETIRED_LOOPS`, 31 entries), orphaned commercial services, the LLM-estimated P&L (`financial/economics.ts`); each with a refusal test | `RETIRED_LOOPS`, `retired_rows` | ≥ 31 jobs' code, their call sites | `what-was-retired-is-refused-not-absent` | D |
| **R5** | **The weekly five sets**: one reader `services/week/sets.ts` over `distributableSurplus`, obligations, `findabilityOf`, the stopped record, `whatNeedsHim`; shown on Money; sent via `sendAccountNotice` only when `digestOf` changed, idempotent per ISO week; `involvement` → `setMaxChannel`; the Stats form one tap away; **`a-week-away.ts` widened from `standing='earned'` to experimental** | `projection.ts`, `findability.ts`, `stop.ts`, `foundry-shell.ts whatNeedsHim`, `cognition.ts digestOf`, `interruption.ts`, `settings.ts` (the only `setMaxChannel` caller) | `fleet_letter_notify`, `digest_generate`, `weekly_synthesis` | `the-week-in-five-sets`, `a-quiet-style-quietens`, `coming-back-reads-the-experimental-asset` | A |
| **R6** | **λ, recurring minutes, Foundry's own line, the frozen baseline**: λ as an `economic_policies` kind via `policyInForce`; the `owner_minutes` trigger relaxed to asset/institution scope; the line on Money and in the sets; the baseline (Etsy + spreadsheet) costed beside it; currency recorded per sale, converted at payout | `ledger.ts economic_policies`, migration 360, `projection.ts carryingCost/taxReserve/distributableSurplus`, `money-place.ts` cost-line form | — | `what-foundry-costs-to-carry-is-one-line`, `a-minute-on-an-asset-has-somewhere-to-go` | D, B |
| **R7** | **Calibration at any n; the sealed follow-up; the counterfactual question**: `ENOUGH_TO_HAVE_A_RATE` → show share + count from n = 1 worded as a count; S22 field on `probe_designs`; S21 as a Needs-you at settlement | `calibration.ts howOftenRight`, `validation.ts`, `probe-design.ts`, `attention.ts waitingOn` | — | `one-of-one-is-shown`, `a-test-that-changed-nothing-was-machinery` | C |
| **R8** | **`couldChange` and cost per decision**: `WORK_THE_MODEL_DOES` gains a static `couldChange`; purposes that could change nothing are skipped and counted; cost per decision on Money | `what-it-is-for.ts`, `cognition.ts`, `spend-ledger.ts`, `check-ai-attribution.mjs` | — | `a-call-that-changes-nothing-is-skipped`, `the-model-never-decides-whether-it-runs` | D |
| **R9** | **Deletion tranche 2** (after PENDING 16): the twelve agents; `scp/actions/executor.ts` (two callers in `departments/`) and `outbound/executor.ts` once every caller is on `gateway.ts invoke` | `gateway.ts`, `CONSEQUENTIAL_EFFECTS.json`, `effects:audit` | agents, both executors | `there-is-one-door-to-the-world` | D |

**Ratio for the tranche:** adds ≤ 2 tables (none planned; λ is a policy kind, minutes a trigger change), 0 jobs; deletes ≥ 34 jobs' code, two execute paths, twelve agents, one P&L. The rule is paid on the first slice.

**Verification for the tranche.** Each law test red then green; `npm run check` `CHECK_EXIT=0`; `/internal/health` reports the SHA with status and schema ok; `scripts/measure-mobile.mts` at 375/390/430 for any Home or Money change; the weekly email received once by the owner (R5) and not again in a week with no change; R3's rollback exercised once against a deliberately failing health read in the laboratory; the maturity-map entries name measure, event and deletion condition, checked by `check-record-matches-code`.

**Evidence maturity of this roadmap itself:** E1 (written). E2 when R0–R4 are live. Anything above that comes only from the world.

---

**PENDING 16, decided by the owner on 30 September 2026: retire the twelve
agents** (R9). Recorded in `OWNER_DECISIONS_PENDING.md`.

**Each tranche row, when it closes, is recorded in `ROADMAP.md`'s Done table
with its measure (A, B, C or D), the event that earned it, and the condition
under which it is deleted.** `the-record-names-the-measure` holds that.
