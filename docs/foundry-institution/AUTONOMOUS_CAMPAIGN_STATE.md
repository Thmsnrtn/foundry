# Live frontier

**Operational state, not a specification and not a diary.** Git history is the
diary; `history/SEAM_CAMPAIGN_HISTORY.md` is the narrative record. This file is
what a steward needs to start working today, and it is trimmed as it ages. If
it grows into a backlog, it has stopped doing its job.

How development operates is `DEVELOPMENT_INSTITUTION.md`. What is currently
true is `IMPLEMENTATION_STATE.md`.

---

## NEXT SESSION START HERE

Bootstrap from disk: verify the branch and a clean tree, read
`DEVELOPMENT_INSTITUTION.md` and this file, skim `IMPLEMENTATION_STATE.md` and
recent git history, then work. No chat history is required.

Then run the loop in `DEVELOPMENT_INSTITUTION.md` §2: orient, verify, locate
the frontier from **current repository truth**, and act. Do not resume an
inherited list because it was inherited.

---

## Verified checkpoint

- **Branch:** `claude/foundry-autonomous-continuation-0gents`. Never merged to master.
- **Head:** `f72f731`, pushed. Verify against `git log -1` before trusting this
  line; it is the one thing here that goes stale fastest.
  **Migrations:** 218 files, highest **182**. Ordering gated. Snapshot current.
- **Validation:** full suite green at `f72f731` — **315 files / 2,742 tests**,
  `npm run check` EXIT=0, every gate chained and running in CI on this branch.
  **Qualified:** the suite aborts natively about one run in three *before*
  `closeDb` landed; over 30 consecutive clean runs since. See item 4.
  **Read the exit code from the run that produced the log** — a commit went out
  with five red tests this cycle because it was read from a wrapper.
- **Ratchets:** unguarded mutating routes **114** · fabricated test schemas **4**
  · writer-less tables **0** · SELECT drift **0** · untraced consequential
  effects **0** · statically unreachable modules **28** · write-only columns
  **82** · id tiebreaks **18** · backticks in embedded comments **0** ·
  query-argument mismatches **0** (1,886 statements) · INSERT value-list
  mismatches **0** (377).

## Active work

None in flight. Everything below is unstarted or blocked.

## What the last cycle established

**One page, read line by line, and almost every number on it was a claim
nothing measured.** `founder/intelligence.ts` is what the operator of Foundry
looks at. The lens was the plainest available — read the number, then find the
query that produced it — and it held for eleven consecutive findings. They are
worth listing together because the SHAPES repeat, and a steward who recognises
the shapes will find them faster elsewhere than by reading files.

**The constant wearing a measurement's name.** `total_jobs: 30, jobs_healthy:
30` under the comment "From job registry", when the registry has ninety and
nothing was read. `runway_months: 999` under "SaaS with low burn" —
eighty-three years, asserted by a comment, where nothing records burn at all.
`churned_this_month: 0`, `expansion_revenue: 0`, `override_count_7d: 0`,
`days_since_break: 0` under "Would track from activity gaps",
`top_acquisition_channels: []`. Each read as a measured absence.

**The quotient with an empty denominator, answered anyway.** The same mistake
twice over, and worth seeing in both directions: `auto_execute_rate` fell back
to **100** — the most reassuring number on the automation panel, printed
precisely when no decision had been made — and `avg_health_score` fell to **0**,
the worst possible score, printed for having scored nobody. Whether the fallback
flatters or alarms is an accident of which digit was typed. The same shape wrote
`?? 1` as a denominator, turning "no founders" into a real division.

**The default that makes an unobserved subject scoreable.** The Founder
Wellbeing card is colour-coded green above 60. A founder with no health record
took `motivation ?? 50` and `engagement ?? 'stable'` and scored **70** — a green
card about a person Foundry had never observed once. This is the one to
remember: it is about a person, a person reads it, and the reassurance is the
harm. Note the second-order trap found while fixing it — `engagement_trend`
carries `DEFAULT 'stable'` in migration 006, so a row written for any other
reason *looks* like an observation. A written default is not evidence.

**The page limit that became the measurement.** At-risk companies were read with
`LIMIT 20` and then every number derived from `rows.length`. The headline card
read "At Risk: 20" for any portfolio with twenty or more, and the rate divided
that capped numerator by an uncapped denominator, so it FELL as the real problem
grew.

**Two labels over one expression.** "Activation Rate" and "Trial → Paid" sat
side by side on the growth card as two measurements; they were the same line of
code twice. Two numbers that can never disagree are one number, and a reader
comparing them believes they have corroborated something.

**The name that belongs to someone else's money.** `PulseData.mrr` summed
`metric_snapshots` across all products — the operated COMPANIES' reported MRR
movement — and went out of the executive dashboard beside `mrr.current_mrr`,
Foundry's own subscription revenue. An alert read "MRR declined 14% this month"
about whichever the reader assumed. `mrr_history` was the same portfolio series
plotted as Foundry's own history. Not the same quantity, not the same company,
not even the same KIND: one a level, one a sum of movements.

**Revenue counted before anyone paid.** The Stripe webhook sets `founders.tier`
on `customer.subscription.created` *including* while status is `trialing` — that
is the branch that records `trial_ends_at`. Every trialist counted at full list
price in `current_mrr`, `arr`, `by_tier` and every forecast compounded from them.

**The label that is not the thing.** `churn_rate_30d` had no 30-day window and
was computed entirely from companies that were still active. `churn_this_month`
counted founders who signed up over a week ago and never subscribed — they never
paid, so they cannot have left. `activation_rate` rated an activation event that
does not exist.

**And the mirror image, which is the one a steward will miss.**
`last_audit_run: null` was hardcoded while `audit_scores` has a real writer and a
`created_at`. The fact existed and was thrown away, leaving the operator unable
to tell "never audited" from "not looked up". Discarding a fact is the same
failure as inventing one, and it does not look like a defect on the page.

**What could NOT be fixed, and why that matters more than what could.** Several
of these are null now rather than computed, and each null carries its reason in
the type: no tier-change history exists, so Foundry's own expansion revenue
cannot be derived; nothing records when a company churns, and the only archive
path that leaves a timestamp is ERASURE — a person exercising a deletion right
is not a customer leaving, and counting the first as the second would have been
the worst guess available; nothing records burn; nothing records founder
activity gaps. `override_count_7d` would still be null if it were wired up,
because `decision_quality_scores` has no writer at all —
`recordDecisionContext` is exported from `scp/founder/decision-tracker.ts` and
called from nowhere, which is why the override rates over there are permanently
zero too. A test now watches for a caller appearing.

**Then the same lens on the surfaces beyond it, where the stakes are higher.**
The operator page was read first because it was there; nothing about it was
special. Carrying the lens outward found the same shapes pointed at people
making bigger decisions, and one shape that had nothing to do with numbers.

**Fabricated numbers handed to a model told not to hedge.** Five agents read a
company's `metric_snapshots` into a prompt through
`(Number(x) || 0) * 100`, so a company that had reported nothing produced
`Churn rate: 0.0%. NPS: 0.0.` — a claim of excellent retention. Harbor's system
prompt then says, in these words, *"You do not hedge when customer data is
clear"*, and asks for named accounts and dollar amounts. The output reaches a
founder as advice about their own company. It crossed thresholds too:
`if (activationRate < 30)` fired a "Low activation rate (0.0%) — acquisition
quality concern" message at companies with no metrics at all.

Forge was the sharpest. `mrr_health_ratio` is defined by migration 001 as
churned/new, *"null if new is 0"* — the null is documented as meaning the
division could not be done — and the prompt explains the scale as
`>1.0 = churn exceeds new MRR — critical`. So `|| 0` mapped "no new MRR at all"
to the single most favourable value available.

The rule already existed: `jobs/index.ts` writes `!= null ? … : 'unknown'` for
the same columns from the same table. `ai/measured.ts` states it once, and a
zero reaching a prompt through it means a snapshot really recorded zero.

**The same defect inverted, condemning instead of flattering.**
`computeFundingReadiness` has a neutral 50 branch for every null input, and it
never ran: the row is read as `rows[0] ?? {}`, so a company with no snapshot
produced `undefined`, the `=== null` check missed, and every comparison fell
through to the final `: 10` / `: 20`. Then the gap list tested those against
thresholds of 60, and told a company that had reported NOTHING — in a document
it would fundraise on — that its churn was above threshold, its activation below
benchmarks, its MRR health indicating churn exceeds new revenue, and its
technical audit below threshold. Four findings about numbers that did not exist.

Which direction a fabricated unknown lands is an accident of where somebody put
a threshold. That is the transferable point: it is not that fallbacks flatter,
it is that they *decide*, and nobody chose.

**Statistics applied to an invented input.** `/scenarios` renders a Monte Carlo
runway — median, P10–P90 band, probability of surviving eighteen months — and
cash on hand was defined as `monthlyBurnCents * 12`, where burn was
`products.operating_budget_monthly_usd`: the AI SPEND CAP, defaulting to fifty
dollars a month. A founder who never touched it was modelled as a business
burning $50 against $600 of cash, with the identity making base runway exactly
twelve months. A second implementation in `financial/simulator.ts` invented cash
as `revenue * 6`, so a company got two different runways depending which page it
opened.

This is worse than the bare `runway_months: 999` on the operator page, and the
reason is worth carrying: **nobody mistakes a constant for a finding, and
everybody reads a confidence interval as one.** Statistical machinery over a
guess does not report uncertainty — it disguises the guess as measurement.

Migration 181 lets the founder state cash, burn and the date they were true;
`financial/position.ts` is the only way either path may learn it and has no
default anywhere; both return null until a position exists, and the page asks
in the founder's own terms. **Do not add a default here.** A default cash
balance is a claim about a bank account, and no amount of modelling downstream
makes it less of one.

**And a statement that had never once run.** `forecast_scenarios` was written
with seven placeholders and six arguments. `generated_by` is NOT NULL, so every
insert raised — since it was written. Both callers swallow it: the refresh job
catches per product, the route logs and redirects. So the page never showed a
scenario that function produced, the nightly log read "Generated scenarios for
0 products", and nobody found out. Every gate here passed it: the SQL is valid,
the columns exist, the types check. It surfaced only when a test called the
function for the first time.

`check-query-arity.mjs` now counts placeholders against arguments (1,886
statements) and INSERT columns against values (377), chained into
`lint:columns`. Writing it taught the same lesson twice: the first counter
toggled string state on every apostrophe, so a SQL comment reading "Migration
178's trigger" opened a string that never closed — five false positives against
correct code. The same bug in the argument splitter, on a TypeScript comment
containing `'system'`, inflated a count by one. Both are tests now. **A noisy
gate gets baselined, and a baseline is where a gate goes to stop working.**

**And the mirror image, which is where the reading went next.** Every finding
above is a claim made without a source. Turning the lens around — a fact
RECORDED and read by nobody — found four more, and the last of them was the
most valuable of the whole cycle.

**Foundry's own AI spend, from two ledgers, both wrong.** The founder-ops badge
read `cost_events`, under a comment written earlier in this same campaign
calling it "the canonical spend ledger: real amounts, every cost type". It is
not: `cost_events` has one writer, `scp/agents/base.ts`, fire-and-forget, agent
sessions only. `ai/client.ts` reserves and settles EVERY call into
`ai_daily_spend`, which is also the ledger the daily ceiling is enforced
against — the one that decides whether Foundry may act. Meanwhile the Letter
read that ledger and summed it across all scopes, and migration 099's finish
trigger writes the same amount to the global, product and founder rows, so "AI
spend today is X USD" counted every call up to three times.

Correcting my own comment is the part to carry: **a wrong claim about which
store is canonical outlives the number it justified**, and the next person to
touch it would have believed it.

**Quiet is not broken.** `integration_health.last_successful_sync` was written
on every successful event and selected by nothing. The page showed
`last_event_at` — when data last ARRIVED — so for a webhook source a quiet
fortnight and a dead connection produced the identical line, "No data in 14
days". `institution/loop-health.ts` already says exactly this about the
scheduler: *"Nothing happened" and "nothing ran" are different facts.* One rule,
stated in one place and not the other, over a column that had held the answer.

**A forecast nobody ever scored, with three broken links in one loop.** The
checkpoint was dated TODAY holding today's prediction, so the only actual it
could match was one recorded the same day — the prediction compared against
itself. `recordCheckpointActual` had no caller anywhere. And `variance_pct` was
read by nothing. On top of which the insert creating the rows had never run at
all. Predictions are now dated when they come due (1, 3, 6 months, base case
only — scoring a bear case scores a question rather than an answer), reconciled
in the ingest path where a company's real MRR arrives, and the founder is told
the median variance AND ITS DIRECTION above the forecasts it judges.

This one is worth the work rather than a curiosity for a specific reason:
**Foundry asks companies to state what they expect and compares it against
reality, and its own forecasts were exempt from that.**

**Then the same reading found the two things underneath every number on those
surfaces: what the words mean, and what the units are.**

**MRR the level and MRR the movement, under one name.** The founder's own
ingest endpoint mapped the field `mrr` to the column `new_mrr_cents`. A company
POSTing `{"mrr": 50000}` — meaning "our MRR is fifty thousand dollars", which is
what the word means — had that recorded as NEW BUSINESS WON THIS PERIOD,
alongside its real expansion, contraction and churn. `mrr_health_ratio` is
computed at ingest as churned/new, so a level in the denominator made the
company look healthy; the operator's portfolio figure was adding a level to a
sum of movements; Forge and Oracle put `new=$50,000.00` into their prompts.

Meanwhile `metric_snapshots.mrr_cents` — the column that MEANS the level, and
the one every investor-facing surface reads — had no writer on that door at all,
so those companies read "N/A" for MRR everywhere. `POST /api/v1/metrics`, the
public API, has always written the level correctly. **The same company got a
different answer depending which door it used.**

**A fraction compared against a percentage.** `activation_rate`, `churn_rate`,
`day_30_retention` and `mrr_health_ratio` are stored as 0–1 fractions — the
ingest validates that range and `ux/fluency.ts` says so in words. Five readers
treated them as percentage points, and the failure mode is the thing to
remember: **every "higher is better" test fails (`0.68 >= 40`) and every "lower
is better" test passes (`0.02 <= 3`)**. A company scored zero for excellent
retention and full marks for catastrophic churn, and nothing looked broken from
either side.

In `fundraising-readiness.ts` six of the ten points in `scoreTraction` were
unreachable by anybody. Two of those were unreachable twice over:
`mrr_growth_pct` and `customer_count` are NOT COLUMNS on `metric_snapshots`,
read off a `SELECT *` row and `undefined` forever, and `d30_retention` is not
one either — the real column is `day_30_retention`, sitting there with the data
in it. In `network/failure-library.ts`, `{ churn_rate_gt: 8 }` means eight per
cent, so no failure pattern keyed on churn could match for any company; the
library kept matching on its other criteria and simply never fired on that one.
And both briefings and the investor update told a company churning 2% a month
that its churn was 0.0%.

`ratePoints()` states the conversion once. It converts the VALUE, not the
threshold: `>= 40` reads as forty per cent to a person and `>= 0.4` reads as a
bug waiting to be "fixed". `nps_score` is left alone — already on its own
-100..100 scale, and scaling it would be this same mistake reversed.

**A product telling its customer it delivered nothing.** `/roi` is mounted and
authenticated and headlined "Value Delivered This Month". It reported **$0** and
a 0% action rate for every company, always, because `recommendation_outcomes`
has no writer — `recordRecommendation` and `markActedOn` are exported from
`roi/outcome-tracker.ts` and called from nowhere. The line underneath read
"Foundry is tracking recommendations — value will appear as outcomes are
measured", and nothing was tracking anything.

**It is deliberately still not wired, and that is the interesting part.** The
obvious move is to call `recordRecommendation` from every agent run. It would be
worse than doing nothing: recommendations would accumulate while `markActedOn`
still had no caller, turning an UNMEASURED action rate into a MEASURED 0%. **A
loop that records its denominator and never its numerator produces a confident
wrong answer, which is harder to notice than an honest blank.** Wiring the other
half needs a real answer to "what counts as acting on a recommendation"; a test
now fails if a caller appears for one without the other.

**And the sharpest instance of all of it: a rule Foundry had already written
down, and obeyed once.** `SignalResult.hasData` is declared in
`services/signal.ts` with the Honesty Law and this sentence: *"the score is a
default, not a measurement. First-run surfaces must say 'not enough data yet'
rather than present a falsely-confident number."*

Ten places compute a Signal. **One honoured it.** The other nine printed the
default, so a company Foundry had never measured appeared as a confident 85 out
of 100: on a public share link under a badge reading "LIVE SIGNAL"; spoken aloud
in the voice briefing, where there is no colour and no second glance; twice into
a model, which reasons from it and repeats it back; in Fleet Triage, where it
sorted among real companies and pulled the fleet average on a page whose whole
purpose is choosing what to look at first; over the mobile API; and as the
baseline for a drop alert.

That last one had teeth. The default was written into `signal_history` like any
other score, so the first day a company actually reported something, the real
score landed against a default baseline and the founder was told their Signal
had fallen thirty points **from a number their company was never at**. The same
history feeds the share page's sparkline and the 7-day trend in conversation
context.

**A default no longer enters the record at all**, and not-writing beats writing
a flag: every reader of `signal_history` gets the guarantee for free instead of
having to remember it, and a gap means nothing was known that day, which is what
a gap should mean.

**The lesson is about instruments, not about Signal.** The rule did not need to
be discovered — it was already written, in the codebase's own words, in the type
itself. What was missing was ONE WAY TO OBEY IT and something that notices when
a caller does not. Writing a rule into a comment protects the file it is in.
`signalText`/`signalNumber` plus a test that enumerates every caller of
`computeSignal` protects the other nine. **When a doctrine sentence appears in a
type, check every consumer before believing it.**

**The same shape on a consent boundary, which is where it bites hardest.**
`preferences.max_channel` is declared as *"Interruption ceiling: the loudest
channel Foundry may ever use. The policy can only quiet below this, never exceed
it"*, and `ux/interruption.ts` opens with *"this module alone decides HOW LOUDLY
to deliver"*. `intelligence/risk-state.ts` called `notifyFounder` directly,
consulting none of it: a founder who set `letter` — do not interrupt my life —
got a push on every risk-state change.

Its comment said the send was "governed like every other outward effect", and
that was TRUE AND BESIDE THE POINT. **The gateway governs whether an effect may
LEAVE; the ceiling governs how loudly Foundry may interrupt THIS PERSON.**
Passing the first says nothing about the second — and the comment treating them
as one thing is how a control that WAS working became the reason nobody looked
for the one that wasn't. Worth watching for generally: a satisfied guard cited
in place of an absent one.

**And then the same lens on sentences I had written myself.** Two commits after
wiring the forecast reconciliation into the ingest route, under a comment of
mine reading *"This is the only path by which a company's real MRR reaches
Foundry"*, it turned out not to be: `POST /api/v1/metrics` — the documented
public API with issued scoped credentials, the path this very file calls the one
a real company integrates against — also writes `mrr_cents`. So a company
integrating the DOCUMENTED way had forecasts recorded and never scored. Same
shape as the customer-store split, introduced while closing that very loop.

**And on the interruption module's own justification**, after using it to find
the module's bypass. Its quiet rungs write nothing, excused by *"the Letter
composes from the ledgers, so the event will appear there"*. The Letter composes
from a SPECIFIC LIST — completed executions, gate-0 decisions, the top pending
decision, falsified premises, the memory digest, peer-radar warnings, the trust
ledger, dissent. An event in that list survives being quieted; one outside it
(a Signal drop, a wellbeing pulse, drafts awaiting approval, a milestone, a
billing failure) would be **dropped silently by a founder setting a lower
ceiling than they realised they were setting**.

That is why the eleven direct notification calls were not converted wholesale,
and the rule now sits where somebody would read it before doing exactly that:
route through `deliver()` only when the Letter already carries the fact. The
peer-radar bell is converted as proof and as the unambiguous case —
`letter/composer.ts` calls `scanForWarnings` itself.

**The rule for the whole cycle, stated plainly:** a claim in a comment is
evidence of what somebody believed when they wrote it, and nothing else — and
that includes claims written five minutes ago by whoever is reading. Three of
this cycle's findings came from checking such sentences against their consumers;
one of them was mine.

**A gate that was measured and rejected.** The ghost-column class —
`mrr_growth_pct` read off a `SELECT *` — is invisible to every column gate here,
and looked like the next ratchet. Two attempts were measured: matching property
casts against the file's single starred table gave 48 findings, mostly
properties belonging to other queries in the same file; binding variables to
their query through `.rows[0]` gave 108, still leaky because generic names like
`r` and `row` are reused across queries. **Real scope analysis is the price of
this one**, and a gate that cries wolf gets baselined into uselessness. Not
built. The specific findings were verified by hand against the built schema
instead.

**The write-only list is a question-asker, not a work queue** — measured, not
asserted. Of the 84 entries, 47 are reachable by a mechanism that ratchet
cannot see: 22 through a literal `SELECT *`, 16 through a SQL trigger, 9
through the export's dynamic `SELECT * FROM ${table}`. `ai_spend_reservations`,
`gate_events` and `anomalies` each looked like findings and each turned out
reachable by a different one of those three. The gate's own header says it is a
false positive in the safe direction; believe it. **35 entries remain genuinely
unread**, and the two taken from them this cycle were both real.

**Checked and found correct — worth as much as the findings.**
`scp/investor/fundraising-readiness.ts` awards no points for unknowns and prints
`N/A`. `scp/investor/investor-update.ts` handles every null. Both briefing
surfaces already say "unknown" — though both used truthiness, so a company
recording exactly $0 of MRR, which is most pre-revenue companies, reported as
unmeasured. Read the code before writing the finding: this cycle's frontier
entry named five suspect files and two of them were already right.

**Method note that paid for itself twice.** Two findings were wrong on first
read and were caught by checking rather than by writing them down. The tier
price map `{solo: 79, growth: 199, investor_ready: 399}` looked like it could
never match migration 001's `('founding_cohort','growth','scale')` CHECK —
migration 080 had already fixed that, and the map is correct. And a wellbeing
test failed on the `DEFAULT 'stable'` column rather than on the code, which is
what surfaced the second-order trap above. Read the migration before writing the
finding.

## What the cycle before that established

**The owner answered §10, §14 and §12, and all three are implemented.**

**§10 — split by kind.** Five tables sat marked `owner_decision`, holding an
erased person's identity inside companies they did not own. The answer:
authority and artefact are different things. `api_keys` and `mcp_grants` are
**revoked and removed** — an authority held by a principal that no longer exists
must not act, and handing it to the company owner would be inventing a grant
nobody made. `webhooks`, `deal_rooms` and `decision_votes` are **preserved and
their author severed**: the integration keeps delivering, the room stays open,
the vote still says which way it went, and NULL says NOBODY rather than naming
somebody who did not do it. Migration 175 made those three columns nullable,
which is the whole reason this was stuck — not indecision, an absent column
state. Revocation is not silent: each one writes into the company's own audit
trail, naming no person, because naming one would undo the erasure that caused
it. The disposition `owner_decision` no longer exists and a test asserts it
cannot return.

**§14 — split analytics.** The funnel recorded a NAMED founder's whole
progression whether "Help Improve Foundry" was on or off. It is two paths now:
service state (signup, repo connected, trial, paid) stays ungated and is
**disclosed in those words**, and the usage half is recorded **only with
consent** and then against a contributor hash. Minimisation first — no consent
means no row, not a row filtered out at read time, which would make the toggle a
display preference rather than a control. A step in neither list fails closed to
telemetry. The readout carries which population each count is over, because the
telemetry half is a smaller denominator by construction and a rate crossing that
boundary compares two different groups — the same provenance error the wisdom
network made. `product_telemetry_events` entered the erasure map in the commit
that created it: a pseudonym is not anonymity, and a table the erasure has never
heard of survives forever.

**§12 — a portfolio principal, not a global secret.** Possession of one
process-wide key read any company's entire operating picture by arbitrary
`product_id`. The two `/internal` routes that touch company data now resolve the
credential to a **principal with enumerated company membership** — no wildcard,
so a company outside the scope is a row that does not exist rather than a check
that could be written wrong. A principal may only be scoped to companies its
issuer OWNS, enforced at issuance and again by a database trigger, which is what
keeps a private portfolio principal from becoming a route into a commercial
customer's data. It fails closed today: until one is issued, those routes serve
nobody. **Rotating the deployed secret is the owner's own act and is recorded as
outstanding rather than reported as done.**

**Three interim positions are now in force** pending counsel, and they bind like
decisions: keep the shorter retention rather than lengthening by guess and never
call a redacted shell proven anonymous (a test holds that claim out of the
disposition strings); audit logs stay at 180 days as the interim default; and
**k = 5 is not a safe harbour** — cross-company benchmarking is counsel debt and
external proof debt before broad release, not something the local floor
demonstrates.



*One paragraph, deliberately. The narrative record is
`history/SEAM_CAMPAIGN_HISTORY.md`; this file is what a steward needs today.*

**The owner's direction on ethics, legitimacy and the private frontier landed
and was implemented rather than filed** — into the existing canonical artifacts,
no second ethics universe. The repository was then read for where the doctrine
had outrun the code. `ARCHITECTURE.md` names seven terms of the legitimate
action envelope; the **external-permission term is deliberately still absent**,
because it is counsel debt rather than a mechanism, and naming it before it
exists would be the claim this institution refuses to make.

**One vocabulary for who allowed it**, closing the two-ledger seam: four
spellings of `approved_by` became one principal reference
(`outbound/acting-principal.ts`), so a founder, a voice session, autopilot, the
institution and the system are told apart by kind rather than by string.

**A company that integrated properly was invisible to the departments that act
on customers.** `POST /api/v1/customers` — the documented external surface —
writes `customer_intelligence`, while success and outreach read `customers`.
`institution/company-customers.ts` is now the one accessor over both, and it is
the ONE place the at-risk and champion predicates are stated. See opportunity 5
for the cutover criterion.

**A failed reading looked exactly like a calm one.** `analyzeTranscript` ended
in a `catch` that logged and returned, so a week where every transcript failed
to parse rendered as a week with nothing to say. Migration 178 gives the failure
a durable place and the page renders it.

**One rule, two implementations, one enforced.** Contact refusal lived in the
outreach department only, while the governed email path — the one that actually
reaches a customer — never consulted it, and nothing could get onto the list.
It is now checked at the boundary where every outward effect converges;
migration 179 retired the third, inert do-not-contact column.

**A process failure worth keeping.** A commit went out with five red tests
because the exit code was read from a wrapper rather than from the run that
produced the log. And a killed validation run left `_gate_fixture_agent.ts` in
the working tree, where it was committed and then caught by the public-claims
audit as a thirteenth AI agent against "All plans include 12 AI agents".
`.gitignore` and a `beforeAll` sweep now handle the fixture; nothing but
discipline handles the exit code.

## Highest-value current opportunities

Provisional, recomputed each cycle. Not a backlog — if something better is
found, this list loses. **Closed items are not kept here**; the git history is
the record and `history/SEAM_CAMPAIGN_HISTORY.md` is the narrative.

0. **The same lens, further out.** `founder/intelligence.ts`, the five SCP
   agents, `investor/board_packet.ts` and both runway implementations have been
   read this way and are done. Two files this entry previously named as suspects
   — `scp/investor/fundraising-readiness.ts` and the briefing surfaces — were
   already correct, which is the reason to read before writing a finding.

   **What to look for, in the order it paid:** a fallback (`?? 0`, `|| 0`,
   `: 0`, `?? 50`) standing where the absence of data should be; a denominator
   that cannot be empty because somebody substituted 1; a count taken from
   `rows.length` where the query carries a LIMIT; two fields whose expressions
   are identical; a field name naming a window or a subject the query does not
   touch; a hardcoded null where a writer actually exists; and a `=== null`
   check against a row read as `rows[0] ?? {}`, which yields `undefined` and
   never matches.

   **Where it has not been run.** `scp/agents/{compass,shield,sentinel,ledger,
   scribe}.ts` and the remaining `routes/dashboard/*` pages. Lower expected
   yield than what has been done — those five agents were picked first because
   they read `metric_snapshots` — but the shape is not confined to metrics, and
   the wellbeing card proves it: that one was three `??` defaults about a
   person, with no metric in sight.

1. **CLOSED: the ceiling now costs the founder nothing.** Eleven
   in-app bells bypassed `ux/interruption.ts`, and the reason turned out not to
   be laziness — the policy's two quietest rungs WROTE NOTHING, excused by "the
   Letter composes from the ledgers, so the event will appear there". It
   composes from a specific list, so obeying a founder's ceiling would have
   dropped any event outside it. **The code chose the fact and ignored the
   ceiling; both halves were defensible alone, and together they told the
   founder their preference was respected when it was not.**

   Migration 182 (`quieted_events`) gives the quiet rungs somewhere to put the
   event; the Letter reads the last day's back as a `noted` section, on the same
   24-hour window as its other sources, and it counts toward whether the day was
   genuinely quiet. The `log` rung records too — that is the audit trail behind
   "why didn't you tell me?", which the module's header already promised.

   All eight bells in `jobs/index.ts` route through the policy now, each with an
   importance chosen for what it means to a founder, and milestones with them —
   a celebration is the most optional thing Foundry ever says.

   **`billing/stripe.ts` stays direct, and that is the right answer, not the
   leftover.** `max_channel` is an ATTENTION preference; the owner's §14
   decision draws the line — necessary service, billing, security and
   configuration state stays ungated and disclosed, optional telemetry and
   celebration honour the preference. A founder whose card is failing is told
   their service is about to lapse whatever they set about notification volume.
   Those notices are founder-scoped with no product id, which a company-scoped
   policy cannot anchor anyway. **Anything ADDED to the pinned list is a claim
   that some message outranks a founder's stated wishes; the test exists to make
   somebody write that claim down.**

   Deliberately no delivered/undelivered flag on `quieted_events`: a quieted
   event is a fact about a moment, and a lifecycle would invent a second place
   for "did the founder see this" to be wrong.

2. **~1,600 LOC of clientless API** (`founder-intelligence`, `mobile` serving an
   archived unbuildable client, most of `tier1-4`). Deletion adds no capability
   but makes the route count honest. Mounted, so a founder could in principle
   POST to it — which makes this a product decision rather than dead-code
   removal, and it is why it has not been taken.

3. **Readers whose writers can never run.** Two remain, same shape:
   `/agents/okr` renders from `company_okrs`, `scribe.ts` reads
   `agent_wiki_entries`, and in both cases the only writer is a module nothing
   can reach. ~769 LOC. Deleting a mounted page is a product decision, so it is
   recorded rather than taken as collateral.

4. **The suite aborts natively, and the cause is not established.** A Rust panic
   out of the libsql binding (`PendingException` where `Ok` was expected) that
   takes the whole run with it. An abort is worse than a failure: "validation
   green" becomes a claim about a process that survived.

   - **Eliminated by measurement:** the uncleared query-timeout timer (real
     defect, fixed, abort recurred with the fix in place); the old 1-in-64
     fixture collision (a different intermittent, resolved earlier).
   - **Live hypothesis:** nothing ever closed a database connection, so a run
     left hundreds of native handles to the garbage collector — including
     collection during the next file's queries, which is where both observed
     aborts landed. `closeDb()` exists and the suite closes after every file.
   - **Evidence: over 30 consecutive clean runs since.** Against the prior rate
     that is a vanishing coincidence. Strong, still not a diagnosis — a
     recurrence eliminates this hypothesis the way the last one was eliminated.
   - **Method note:** never run two suites at once.
     `gates-fail-when-they-should` plants real files into the working tree, so
     concurrent runs collide and produce failures that look like defects.

     **What the collision looks like from the outside, so it is recognised
     rather than investigated:** `npm run check` runs `ratchet` BEFORE
     `test:ci`, so a fixture planted by a concurrent suite is read by the
     reachability gate and reported as *"New modules nothing can reach:
     src/services/_gate_fixture_b.ts"*. That reads as an architectural
     regression, not as a collision. The `afterEach` cleanup then removes the
     file, so by the time anybody looks it is gone and the tree is clean.
     Check `ps aux | grep vitest` before believing it.

     **Do NOT teach the reachability gate to ignore `_gate_fixture_*`.** Its own
     planted-defect test works by planting exactly such a file and requiring the
     gate to flag it; excluding them would blunt a gate to avoid an operational
     annoyance of my own making. The discipline is the fix.

5. **82 write-only columns — a question-asker, not a work queue.** `check-write-only-columns.mjs` holds the count;
   read it rather than this line. Prose drifts from the ratchet — this entry has
   said 92 and 85 while the ratchet said otherwise, which is exactly the drift
   the ratchet exists to prevent in code and evidently not here.

   **MEASURED, NOT ASSERTED: 47 of the 84 were reachable by a mechanism the
   ratchet cannot see** — 22 through a literal `SELECT *`, 16 through a SQL
   trigger, 9 through the export's dynamic `SELECT * FROM ${table}`.
   `ai_spend_reservations`, `gate_events` and `anomalies` each looked like
   findings and each turned out reachable by a different one of those three.
   The gate's own header says it is a false positive in the safe direction;
   believe it, and check before building. **35 remain genuinely unread.** Two
   were taken this cycle — `integration_health.last_successful_sync` and
   `forecast_checkpoints.variance_pct` — and both were real.

   The remaining attribution by writing area, which stands:

   - **20 are written by `services/institution`**, and those are the ones worth
     reading. The claim that they were all "answered where they are written"
     did not survive checking: `outbound_actions.outcome_evidence_ref` was one
     of them, and reading it turned out to be the fix for an outcome that could
     never be reopened once settled. Remaining institution ones include
     `provider_receipt_json` (the founder cannot see what the provider actually
     said), `autonomy_consents.from_mode`, and
     `responsibility_shadow_expectations.observation_source_evidence_ref` (the
     letter says what differed, never where it was watching).
   - **22 are `services/scp`** and most of the rest are legacy verticals.
   - **Two are a company's SEASONALITY** (`business_model_profile.seasonal_*`),
     and the earlier note here overstated them: the only writer is
     `routes/api/tier3.ts`, part of the clientless API in item 2. Nothing
     *records* the shape of a company's year — an unreachable endpoint could,
     and nothing would read it. That makes them item 2's problem, not their own.

   `signal_events.processing_session_id` accounts for eleven of the institution
   rows on its own and is one column, not eleven findings.

6. **One concept, two canonical truths: `customers` and
   `customer_intelligence`** — now in the COMPARE stage, with the live harm
   fixed and a measurable cutover criterion.

   The split ran exactly along the line between where a real company's data
   ENTERS and where the institution LOOKS. `POST /api/v1/customers` — the
   documented external surface with issued scoped credentials, the path a real
   company integrates against — writes `customer_intelligence`. The customer
   success and outreach departments read `customers`, whose only writers are a
   session-authenticated route no client calls and the demo seed. **A company
   that reported its customers the documented way was invisible to the
   departments that act on customers**, and the outcome verifier's
   `customer_health_not_worse` looked such a customer up in the wrong table and
   abstained — a vacuous pass, forever, for exactly those customers.

   `institution/company-customers.ts` is the one accessor: both stores read,
   every record says which it came from, one at-risk predicate and one champion
   predicate stated once. `customerStoreSplit(productId).onlyLegacy` reaching
   zero is the criterion that says the legacy read can go — the *compare* stage
   made measurable rather than asserted.

   **Converged since:** `north-star` (its gap was computed from the legacy store
   under a comment calling it canonical — a company that integrated properly
   read `arr_current_dollars = 0`) and `graph/engine` (a company's own knowledge
   graph contained none of its reported customers).

   **What is left.** `customers/intelligence.ts` legitimately owns the legacy
   table — it computes health and marks champions there, and is that store's
   service. Everything else has converged: `founder/intelligence.ts` aggregates
   platform-wide through `getAllCustomers`, which deduplicates across both
   stores rather than UNIONing them (a UNION would double-count anyone in both,
   and overstating is the error that flatters).

   **The cutover criterion is `customerStoreSplit(productId).onlyLegacy`
   reaching zero**, which says the legacy read can go. Nothing else is waiting
   on a judgment; it is waiting on data.

   `customer_events` has one writer, `routes/api/platform.ts`, part of the
   clientless API in item 2 — where that API is unused, `customers.churn_risk`
   reduces to `last_active_at` recency.

   **Closed:** `customer_intelligence.do_not_contact_until` was a third,
   inert contact control beside the canonical one consulted at the boundary.
   Migration 179 dropped it.

7. **The transcript sense: NOT a gap. Corrected before it was built on.**

   This list said a company's customer calls "reach one dashboard page and
   nothing else", and proposed wiring extracted commitments into responsibility
   discovery through a founder question. **Both halves were wrong**, and the
   check that found it was reading the code rather than trusting the note.

   `/signals/multimodal` is mounted (`index.ts:516`) and its transcript detail
   page renders the extracted commitments, objections and competitor mentions
   (`signals-multimodal.ts:295-297`). The sense reaches a person.

   And it must not reach further by extraction. Migration 126 states the
   boundary in the words that settle it: *"nothing inferred from free-form
   chat: the founder states the kind explicitly, and ambiguity stays
   conversation."* A transcript is free-form speech. Proposing a responsibility
   from a model's reading of it — even for confirmation — is the thing that
   sentence forbids, and it is the same reason the candidate-recognition chain
   is deliberately unwired.

   **The correct shape, if this is ever taken further:** the founder reports the
   obligation through the existing explicit intake, choosing the kind from the
   closed set themselves. Foundry may show them what it heard. It may not
   choose the kind for them, and it may not pre-fill one.

   What is genuinely worth checking here, and has not been: whether a founder is
   told a transcript arrived at all, or must navigate to the page to find out.
   That is a "where does a person read this" question about NOTICE, and it can
   be answered without inferring anything.

8. **Two unread outcome predicates.** `shadow_expectation` and
   `shadow_comparison` (`external-shadowing.ts`). Their table side IS consumed —
   `assisting-admission` reads the comparison rows — so these are redundant
   claims rather than lost learning. The resolution is to say so where they are
   written, or stop writing them.

   `development_shadow_comparison` turned out to be something else entirely:
   pulling on it found that **nothing in production ever resolved a development
   shadow expectation**. The Letter lets a founder open one — Foundry asks what
   they would expect a check to report and records their answer — and
   `resolveDevelopmentShadowing` had no caller outside its own tests. The
   institution asked a person a question and never compared the answer with what
   the check said. Now resolved by the judgment tick, in the same loop as its
   external-metric twin, because having them wired in two places is how one of
   them came to be wired in none.

9. **Adapters for the existing intakes.** The shape is proven; breadth is
   missing and the owner's pilot decision gates on it.

   Related, and now decided rather than open: the same obligation reported
   twice converges — within a reporting source. Across sources it does not, and
   that is the engineering call, not indecision. A responsibility carries one
   `discovery_evidence_ref`, so merging a founder's report onto a rota system's
   would make the second witness invisible, where today it is visible as its
   own item. Merging becomes right the moment a responsibility can hold more
   than one witness; until then the duplicate is the lesser loss. Both halves
   of the rule are asserted, and each clause of the convergence predicate has
   been mutated and shown load-bearing.

10. **CLOSED: the uncalled-export sweep.** 32 of the institution's exported
   functions had no caller anywhere in `src/`. They have been read. What is
   left is 26, and every one of them is accounted for:

   - the frozen benchmark scorers (`*-benchmark.ts`, `support-pilot-readiness`),
     legitimately test-driven;
   - the development-change vertical — `enterDevelopmentAssisting`,
     `planDevelopmentChange`, `executeDevelopmentChange`,
     `verifyDevelopmentChange`, `rollbackDevelopmentChange`,
     `grantDevelopmentAuthority`, `revokeDevelopmentAuthority`. **Do not wire
     this.** It is not an oversight: `OWNER_DECISIONS_PENDING` RESOLVED 2 says
     the bounded regeneration grant is deliberately not performed, so Foundry
     may not mutate its own repository outside a test. Uncalled is the correct
     state, and giving the founder a door to grant it is the same act as
     wiring it;
   - `reconstructCompany` and the candidate chain
     (`discoverCandidatesFromReconstruction`, `supersedeResponsibilityCandidate`),
     both examined below.

   Six defects came out of the sweep, each in git history: a founder question
   nobody compared against reality; an authority a founder could not withdraw;
   a number a founder could start watching but never stop; a bounded-help line
   that called a founder's own notice a support reply to a customer who does
   not exist; a pilot-readiness criterion proved on a query production never
   runs; and a responsibility that could be created with nothing to point at.
   The seventh, and the largest, came from pulling on the last of them: a
   question the founder skipped could never afterwards be answered, which
   foreclosed a responsibility permanently and silently (migration 169).

   **Do not build a gate for this.** Reachability at function granularity needs
   a real call graph — a first attempt that excluded a function's own file
   called `evaluateInstitutionalJudgment` unreachable when a production entry
   point in the same module calls it — and even the honest rule cannot tell a
   test-only benchmark from a defect. The list was worth reading once. It is
   read.

   **Candidate recognition stays, unreachable and asserted.**
   `discovery.ts:discoverCandidatesFromReconstruction` ->
   `proposeResponsibilityCandidate` -> `responsibility_candidates` -> The
   Letter's "Possible responsibilities requiring your judgment" is a four-layer
   chain with no production supply: nothing in `src/` writes an
   `operational_responsibility` reconstruction claim. It was not deleted — it
   carries an E3 claim the recognition benchmark scores, and wiring it would
   require Foundry *inferring* responsibilities, which migrations 126 and
   135-138 forbid. The section renders only when non-empty, so no false promise
   reaches a founder. All of that is asserted in
   `candidate-recognition-has-no-production-supply.test.ts`.

   **`reconstructCompany` is a benchmark-only projection, and its `unknowns`
   are production-constant.** It assembles identity, systems, responsibilities,
   claims and unknowns; only the reconstruction benchmark consumes it. System
   staleness is already surfaced on the integration-health page, and unknown
   FACTS are surfaced through founder evidence requests — so the projection is
   not a missing founder surface. But `unknowns` is computed from
   `subject='company' AND predicate='purpose'`, and nothing in `src/` can write
   that claim: company-scope founder evidence is recorded under
   `subject='product:<id>'`, and `purpose` is only ever asked at responsibility
   scope. In production `unknowns` is permanently `['company_purpose']`.

   **Named trap: two spellings for one subject.** `company-observation.ts`
   writes `subject='company'`; `founder-evidence.ts` writes
   `subject='product:<id>'` for the same company scope, and `readCapacityView`
   reads the latter. Whoever wires a company-level fact next will pick one and
   be silently invisible to the reader using the other. Left alone rather than
   normalised on a guess: the `observation_channel` claim written under
   `'company'` has no reader at all today, so the fix is to decide the spelling
   when there is a second reader to be consistent with.

## What keeps working, for whoever comes next

These lenses produced almost everything found in the last two cycles. They are
worth trying before inventing a new one:

- **"Read the number, then find the query behind it."** The one that produced
  the last cycle, eleven times in one file. It is narrower than the lens below
  and that is why it works: it does not ask whether a claim is supportable, it
  asks what SQL ran. A constant, a fallback, or a `rows.length` off a limited
  query answers instantly and unambiguously.

- **"What does this claim that its execution path cannot support?"** The one
  that produced the cycle before. A `success: true` from a function that contacted
  nobody; "No product or founder ID stored" above a primary key containing the
  product id; "anonymized usage patterns" over a named founder's funnel;
  "statistical patterns across hundreds of products" over an eligibility floor
  of five. Read the sentence, then read the line under it — the sentence was
  often true when it was written and nobody re-read it after the code moved.
- **"Who is this control for, and can they reach it?"** A suppression list with
  no way in. Four privacy toggles nothing read. A control that cannot be
  populated or is not consulted is a sentence in a migration, and it will be
  believed by the next person who greps for it.

- **"Where does a person read this?"** The institution knew three large facts
  about a company — that it was being deleted, that it had stopped, and how its
  own judgments had held up — and said none of them on the page a founder opens
  daily. Computing a thing is not telling anybody.
- **"What happens when this fails, and who finds out?"** A credential that
  authenticated and then had every request thrown away looked healthy:
  `last_used_at` recorded being let in, and nothing recorded not being
  understood. The same on a support channel, where the thing thrown away was a
  customer's message and the founder read the silence as nobody having written.
  Foundry knows both facts and said neither.
- **"One rule, two implementations."** Two retention jobs deleting from the same
  table on different horizons; a live-grant predicate hand-copied seven times
  and drifted; a type protecting a SQL identifier that does not exist at
  runtime. Ask which one is in force, not which one is written down.
- **"What does the offer promise that the guard will refuse?"** Permission
  offered that the database would not honour; a refusal swallowed on the one
  surface that grants authority.

## Blocked — needs a design decision, not effort

- **Named-agent retirement.** The twelve live agents are model-driven; the institution is deliberately model-free. They are Class C, not B: cutting them over would LOSE capability rather than preserve it. Blocked on executive-cognition design, itself blocked on a consumed task with a baseline. Do not force it.
- **`challenger` and `synthesizer` are NOT part of that.** They are not agents at all — standalone debate functions reached by static import. Classifying them from the directory nearly justified deleting live code; the gate now checks reachability instead of location.

## Blocked — owner

**Six items pending.** §9 retention lawfulness, §11 the audit-log horizon and
§13 the cross-company aggregation threshold need counsel rather than the owner
alone; §10 (the five erasure tables) has a recommended answer and waits; §12
needs a deployment FACT before it is a decision; §14 is a product and legal
position rather than a mechanism.

§11: two retention implementations disagreed about `audit_log` — 365 days
written down, 180 actually in force. Fixed at 180, which is what has been
happening; which figure is right is the owner's.

**§12 — one shared key reads any company's whole picture.**
`GET /internal/operator/dashboard-data?product_id=…` returns a named company's
risk state, stressors, MRR decomposition, retention, NPS, churn and cohort
summary, behind a single process-wide `ECOSYSTEM_SERVICE_KEY` with no owner
check and no tenant binding. Its own comment says it is "used by Apex Micro,
other ecosystem products". Whether that key has ever left the owner's control
is a fact only the owner has, and the two answers want opposite changes —
per-company scoping, or withdrawal — which is why it is not guessed at. The
route is read-only and nothing was relaxed; `/internal` is deliberately outside
the member-capability ratchet because no member is present on it, which is also
why this went unexamined.

**§13 — is k = 5 defensible?** Cross-company aggregation now has one floor at
five distinct contributing companies, and contribution requires consent. Five
is the smallest count at which no single contributor dominates an aggregate.
Whether it is sufficient for the jurisdictions Foundry operates in, whether a
consent toggle is the right basis at all, and whether a published percentile
must be recomputed when a contributing company erases itself, are counsel
questions. The floor stands meanwhile and nothing claims it is legally
sufficient.

**§14 — should Foundry's own funnel analytics be consent-gated?** They record a
NAMED founder's progression regardless of the Help Improve Foundry toggle. The
copy has been corrected to say so and the consent type is registered as a
recorded preference with that reason; whether the toggle should govern all of
it, none of it, or the detail beyond billing lifecycle is a position rather
than a mechanism.

**§9, as before: retention lawfulness (counsel, not the owner alone).**
`OWNER_DECISIONS_PENDING.md` §9 asks whether the retention periods for what
survives an erasure are right for the jurisdictions Foundry operates in,
whether a redacted shell satisfies a deletion request, and whether keeping the
erasure trail needs its own basis. Proof debt, not a blocker — the dispositions
stand and the erasure runs on them.

The first eight decisions are answered and recorded there as settled. Standing
consequences:

- The public API is **live**. Every new v1 route needs a scope a founder can
  actually grant; the bidirectional gate enforces both directions. Transcript
  ingestion is reachable, so real customer call content can arrive — it is
  customer data AND untrusted external content, and is treated as both.
- Support pilot: **hold for adapter breadth.** E4 stays unclaimed.
- Recursive Foundry: the owner performs the **report only, not the grant** —
  Foundry still may not mutate its own repository outside a test. Do not
  simulate the report; do not treat a local run as the deployed one.
- Effect kinds stay **constitutional**. Never add a mechanism that lets them be
  created at runtime, by a company, an integration, or a model. Gated
  structurally, not just documented.
- Peer review is **retired** rather than given a reader (§16 decision).
- Push notifications are wired through the gateway as `send_push`.

## Blocked — external

- **Real bounded support pilot (E4).** `support-pilot-readiness-v1` is green and means only *ready to attempt*.
- **Deployed recursive operation.** Requires a genuine owner-authenticated report and grant performed outside the coding environment. Must not be fabricated.
- **Judgment calibration.** Requires real later-outcome evidence reaching the evaluation path.
- **Business outcomes.** Provider acknowledgement is not resolution; `unresolved` is preserved deliberately.

## Worth an owner's attention, not a decision

- **Any integration configured through `/agents/integrations` before this
  session stored its provider secret in a plaintext column.** Reads fall back
  to it so nothing breaks, and `plaintextCredentialKeys(productId)` names
  exactly which keys to rotate. **No real credentials are affected** — nothing
  has met reality, so there are no production integrations. Recorded here so
  the rotation step is not forgotten if that changes.

## Proof debt

- Everything wired in sessions 4–10 is **E2** — local runtime through production-facing services. A production-facing code path is not production evidence.
- E3 claims cover **only the synthetic dimensions their corpora actually exercise**.
- The institution DARK list now contains **only frozen benchmark gates**, which is what it was always supposed to mean. `development-shadowing.ts` left it when the owner gained a way to state what they expect a check to report.
- ~~Open nondeterminism evidence debt~~ — **RESOLVED**. A near-miss key fixture built as `key.slice(0,-1) + 'X'` collided with the real key whenever it ended in `X` (1 in 64). Not a database, scheduling, or concurrency problem. See IMPLEMENTATION_STATE for the full record.
- The foreign-key PRAGMA defect fixed during that investigation is **latent, not the cause**.

## Deferred

- **Real AcreOS** — owner deferral, unchanged.
- **Quality/cost comparator** — trigger: a real decision between two candidate methods for a consumed capability.
- **Founder-attention measurement** — trigger: a real founder-facing or economic decision consuming it.
- **Assisting → Operating** — frozen; must be designed prospectively from real E4/E5 evidence.
