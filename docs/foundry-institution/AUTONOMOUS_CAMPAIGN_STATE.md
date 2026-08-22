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
- **Head:** `cb7fbeb`, pushed. Verify against `git log -1` before trusting this
  line; it is the one thing here that goes stale fastest.
  **Migrations:** 228 files, highest **192**. Ordering gated. Snapshot current.
- **Validation:** full suite green at `cb7fbeb` — **347 files / 3,060 tests**,
  `npm run check` EXIT=0, every gate chained and running in CI on this branch.
  **Read the exit code from the run that produced the log.**
  **Read the exit code from the run that produced the log**, and do not write
  "green at <sha>" for a run that was not: a commit went out with five red tests
  in an earlier cycle because the code was read from a wrapper, and this line
  said "green at f8a1581" for about a minute before being corrected on the same
  rule the rest of this file is about.
  **Qualified:** the suite aborts natively about one run in three *before*
  `closeDb` landed; over 30 consecutive clean runs since. See item 4.
  **Read the exit code from the run that produced the log** — a commit went out
  with five red tests this cycle because it was read from a wrapper.
- **Ratchets:** unguarded mutating routes **114** · fabricated test schemas **4**
  · writer-less tables **0** · SELECT drift **0** · untraced consequential
  effects **0** · statically unreachable modules **26** · write-only columns
  **69** · **unscoped product-shaped routes 2** (new gate) · id tiebreaks **18** · backticks in embedded comments **0** ·
  query-argument mismatches **0** · INSERT value-list mismatches **0** ·
  tables written and never read **4** (220 written tables checked).

## Active work

None in flight. Everything below is unstarted or blocked.

## What the last cycle established

**Twelve tables that nothing read, followed one at a time, and eight of the
twelve led somewhere worse than the table.** The unread-tables gate is a
starting point, not a verdict: in every case the row itself was the least of it.

**The shape that repeated most: a shadow copy that was wrong, and could not be
found to be wrong because nothing read it.** `auto_execution_log` duplicated
`action_drafts`. `agent_positions` duplicated `debate_sessions.positions_json`,
and duplicated it badly — the challenger inserted a SECOND row carrying the
challenged assertion instead of marking the original, so the columns the schema
existed for were never once populated. A copy nobody reads cannot be caught
drifting; both were wrong for as long as they existed.

**A word that outranked the execution path.** A debate that THREW was stored
`status = 'complete'`, and the page paints 'complete' green beside a conflict
count that a crashed run leaves at zero — the same row a debate where everyone
agreed produces. The failure text existed; it was rendered as the executive
summary inside the card headed "Unified Synthesis".

**An estimate with no company in it.** Four investor-tier functions were given a
product's NAME and SECTOR, asked a model for numbers, and returned them as
analysis: a moat strength, an erosion rate, a switching-cost ratio. The numbers
stay — an estimate is a legitimate thing to offer — and now carry
`estimated_from`, the same shape and the same word as `Forecast.projected_from`.
**The not-found branches were the worst of it**: `risk_score: 0` (no risk),
`probability: 0` (the incumbent will certainly not respond), a switching-cost
ratio of exactly 1, portability and depth of 50. Reassurance and midpoints
invented about nothing.

**And the same absence scoring as opposite extremes.** One co-founder
respondent returned alignment 100/100/100/100; none returned 0/0/0/0. A
portfolio company with no lifecycle state was counted GREEN. A benchmark metric
the company had not reported was read as 0 — for churn the best possible value,
for NPS among the worst.

**The single sharpest finding was a direction, not a number.** Portfolio
benchmarking scored `product_percentile` as the share of peers with a LOWER
value and read a low percentile as poor performance. For churn that is exactly
backwards: the company with the least churn in the portfolio scored 0 and was
told to prioritise retention. Each metric declares its own direction now, in one
place, instead of the direction living implicitly in whoever reads the number.

**Two operational findings worth more than the tables that led to them.** A
failed integration sync set `status = 'error'` and the hourly job selected
`status = 'active'`, so ONE failure removed an integration from sync
permanently — no retry, no limit, no notice; the stop was a side effect of a
WHERE clause. And `graph_rebuild` paid Opus weekly for causal chains it used for
a log line, while the route that serves chains paid Opus again on every request.

**METHOD NOTE THAT NEARLY COST A COMMIT.** The first causal-chains test asserted
the SHAPE OF THE INSERT and the ORDER OF TWO CALLS in the route source. Both
mutations survived it. **A test that reads code rather than running it will
believe anything the code says about itself** — including the comments I had
just written explaining what the code now does. Rewritten to stub the model and
exercise the write path and the route for real, it caught three mutations.
Prefer behaviour; use source assertions only for absence (a name that must not
come back), and strip comments before asserting absence, because the explanation
of the old name contains the old name.

**A boundary I crossed, caught by a gate rather than by me.** The
stopped-integration notice was first announced through `emitSignalEvent` — the
single door into responsibility discovery, which has exactly one caller by
design: the company reporting something about itself.
`discovery-is-not-reachable-from-integrations.test.ts` failed on the first full
run. The test was right; the code was wrong. It goes through the interruption
ladder now.

**THE SHARPEST FINDING OF THE CYCLE CAME FROM A COLUMN NOBODY READ.**
`responsibility_shadow_expectations.observation_source_evidence_ref` was on the
write-only list. Entering Shadowing writes a transition whose reason is "A
current independent observation channel can test a bounded expectation" — the
entire justification for the state — and that rule was enforced three times,
each keyed on the SHAPE OF THE EXPECTATION: two triggers matching
`expected_event_type LIKE 'development_verified:%'` and `'external_metric:%'`
with the source hardcoded, plus each caller filtering its own query.
`beginResponsibilityShadowing` accepts any event type. **A rule enforced N times
by special case has no floor: the (N+1)th case has nothing at all.** FOUR places
in this repository — including the fixture fourteen test files reach Shadowing
through — created expectations that neither trigger would match. Migration 191
makes the caller name the channel and enforces it generically.

**AND THE OBVIOUS FORM OF THAT FIX WAS WRONG, which is the part to carry.** The
natural rule is "the observation must come from the same source as the signal in
`observation_source_evidence_ref`". That column does not mean one thing: in
external shadowing it holds a signal FROM the ingest channel, in development
shadowing a `repository` signal recording the NEED. The first version refused
every development comparison. **Before generalising a rule from a column, check
that the column means the same thing at every writer.**

**Fifty was in the schema, not only in the code.** Four agents wrote
`parsed.domain_health_score ?? 50` into a field their own type declares optional;
six layers read it; and underneath all of them
`agent_instances.domain_health_score INTEGER DEFAULT 50`, with the provisioner
writing the literal 50 for twelve agents of every company at creation.
`products.health_score INTEGER DEFAULT 0` started every company at the worst
health there is. **When one substitution appears in several files at once, read
the schema before fixing any of them** — the application code was keeping faith
with a column that already lied.

**And the same silence scored twice, differently, in one file.** The Value
Delivery Index substituted 0 for four components and 100 for the fifth, so a
company reporting nothing scored 15/100; eighty lines away the same missing
breadth was read as 100 and could never raise a stressor. `if (!m) return 0` gave
a company with no snapshot a flat zero on "how effectively the product delivers
value", and `assessTimeToFirstValue` read a missing measurement as 0 hours,
which falls in its first branch: "Excellent — users get value within minutes."

**AND THE SAME LENS, ONE LAYER UP, FOUND THE MOST SERIOUS DEFECT OF THE
CYCLE.** `middleware/tenant.ts` was on the unreachable-modules baseline: the
module that states tenant ownership ONCE, including the deliberate 404-rather-
than-403, mounted nowhere. Eight idioms are in use instead. A rule with eight
implementations has no floor, and `GET /packet/:id` was the route with nothing —
**any authenticated founder could read any company's board packet**, the most
sensitive document Foundry produces, while three of its neighbours in the same
file scoped correctly and one carried a comment saying why. On the same surface
sweep, two operator routes resolved a company's decisions and recorded
`decided_by = 'founder'` about somebody else.

**`check-tenant-scope.mjs` is the floor**, baseline 2, both entries earned. The
body-and-query door was checked in the same pass and holds — recorded because a
sweep that reports only what it broke tells the next reader nothing about where
not to look.

**A THIRD KIND OF SELF-INFLICTED SCANNER CONFUSION, and the pattern is now
clear enough to name: PROSE THAT QUOTES CODE IS READ AS CODE.** Earlier this
campaign my own scanners read SQL comments and TS comments as statements. This
time it was the repository's scanner reading MY comment: a note explaining the
statement it had just removed, quoted verbatim, was extracted by
`sql-prepares-against-schema` and failed to prepare. Describe the statement, or
expect the tools to believe you.

**A flake that read as a security regression.** `encryption.test.ts` overwrote
the first two hex characters of a ciphertext with the constant `'ff'`. One
ciphertext in 256 already starts with `ff`, so one run in 256 tampered with
nothing, decrypted cleanly, and failed. Both tamper tests flip a bit now and
assert the tampering landed. Same discipline as mutation testing, applied to a
test that was itself the mutant.

## The cycle before this one

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

Moved to `history/SEAM_CAMPAIGN_HISTORY.md` — "The owner answered §10, §14 and
§12". The decisions themselves are load-bearing and are recorded in the
migrations that implement them and in **Blocked — owner** below; only the
narrative moved.

## The unreachable-modules list, read module by module

**26 entries, and the list is not a work queue — it is a set of questions with
different answers.** Read end to end this cycle so nobody re-reads it:

- **Nine `*-benchmark.ts` files** are reached only from tests, which is what a
  held-out benchmark is. Correctly baselined; leave them.
- **`truth/engine.ts` was the one that mattered**, and the finding was not that
  it is unreachable. `scripts/audit-public-claims.mjs` — a gate that runs on
  every `npm run check` — carried an INLINE COPY of it, and the two had drifted:
  no quoted-phrase handling on the gate's side and a different stop-word list.
  The gate enforcing the honesty law and the module documenting it disagreed
  about what a claim says. Now one implementation in
  `scripts/lib/claim-tokenizer.mjs`, pinned by a test that runs both.
  **Two copies are fine when they are pinned; two copies nobody compares are one
  rule with two answers.**
- **`middleware/tenant.ts`** is the written statement of a rule now enforced by
  `check-tenant-scope.mjs`. Specification, not dead code.
- **`foundry/recursive-institution-contract.ts`** says in its own header that it
  is a prospective contract frozen before the behaviour it governs. Deliberate.
- **`financial/institutional-economics.ts` is the best-written cost accounting
  in the repository and runs nowhere** — it names its unmeasured components
  rather than zeroing them, which is the doctrine the rest of this cycle spent
  its time enforcing elsewhere.

  **Following migration 134's attribution to its end is worth doing once and not
  again.** The migration added `responsibility_id` and `capability` to
  `cost_events` so cost could be attributed to a responsibility. The only writer
  is `base.ts`'s agent-session logging, which passes neither — deliberately, and
  its comment says why: "booking their spend against an invented responsibility
  would be worse than leaving it unattributed."

  **THE GAP IS PRINCIPLED, NOT AN OVERSIGHT.** Every path that knows a
  responsibility does not know a price — the module's own
  `UNMEASURED_COMPONENTS` lists `provider_send_price` as unobserved, because the
  email provider bills out of band. The one path that knows a price, LLM spend,
  is a per-agent-session cost and an agent persona is not a responsibility.
  Attributing in either direction would manufacture the number. **Do not "fix"
  this by wiring an attribution; it is open because closing it honestly needs a
  price nobody records.**
- **`views/numbers.ts` was worth reading even though it stays unreachable.** It
  calls itself the contract for how every number on the dashboard is rendered,
  and it ENCODED THE TWO AMBIGUITIES this cycle spent its time removing:
  `formatPct(n)` would have rendered a 0–1 rate as "0.05%", and
  `formatUsdK(amount)` would have rendered `mrr_cents` as "$5000K". Fixed before
  it has a caller, which is the cheapest that fix will ever be. **The unit
  belongs in the name, because the name is the only thing that survives a
  copy-paste.**
- **`taste-journal.ts` is a whole feature, not a missing wire.** Both halves —
  the founder rating and the agent reading it as ground truth — live inside the
  one unreachable module; no route writes and no agent reads. Unlike the OKR
  form and the Scribe wiki, there is nothing here to connect. Owner's call.
- **`briefing-share.ts`, `ai/composer.ts`, `lib/{env,request}.ts`, `mcp/cli.ts`,
  `prompts/voice-judge.ts`, `support-pilot-readiness.ts`,
  `intelligence/{benchmarks,shippability}.ts`** are unexamined. Each is a
  product question of the same kind as item 2, not a defect: a feature whose
  reading half exists and whose calling half does not.

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

   **The last five agents have now been read, and the yield was not lower — it
   was structural.** `parsed.domain_health_score ?? 50` appeared in four of
   them, and following it down found the same substitution at six layers and,
   underneath all of them, `agent_instances.domain_health_score INTEGER DEFAULT
   50` with the provisioner writing the literal 50 for twelve agents of every
   company at creation. **The `??` in the application code was keeping faith
   with a column that already lied.** When a substitution appears in several
   files at once, look at the schema before fixing any of them.

   `ledger.ts` also invented a $50/month operating budget for a company that had
   set none, and divided real AI spend by it.

   **`routes/dashboard/*` swept for the same shape and it is thin there** — the
   remaining `?? 0` occurrences are counts, where zero is the truth. The two
   that were not (`agents.ts`) belonged to the health-score chain above.

   **THEN THE SAME LENS AT THE INTEGRATION LAYER, which turned out to be where
   it paid most, because that is where a company's numbers ENTER.** Four
   consecutive findings, each depending on the one before it:

   - **`metric_snapshots.mrr_cents` — the LEVEL — had no integration writing
     it.** Two writers in the whole system, both the company reporting its own
     numbers. `stripe.ts` computed the level on one line and left it out of the
     column list twenty lines later. A company that connected Stripe left the
     level permanently null while Foundry synced its subscriptions hourly.
   - **`framework.ts`'s Stripe adapter put three quantities in three wrong
     columns**: the level into `new_mrr_cents`, refunds into
     `churned_mrr_cents`, and a subscription count into `active_users`.
   - **`activation_rate` was a rate made of two windows** — thirty-day
     activations over seven-day signups — with a `Math.max` in the denominator
     that pinned it to exactly 1.0000 for every growing company.
   - **ARPU was `new_mrr_cents / max(1, active_users)`**, so a flat month gave
     $0 and a company with no user count had an ARPU equal to its whole revenue.

   **The order matters and is the transferable part.** ARPU could not be fixed
   until the level had a writer; the level's absence was invisible until the
   readers stopped substituting fallbacks. **Follow a missing writer to its end
   rather than patching each reader where it shows.**

   **AND THEN THE OBSERVATION SIDE OF THE SAME LAYER, which was a different
   shape: not a substituted value but a TRUNCATED one wearing the name of a
   total.** Four summaries reported the length of a capped fetch as a count —
   GitHub pull requests at `per_page=20`, GitHub issues at 50, Sentry unresolved
   issues at `limit=25`, Intercom's `opened_today` within 50 — and these rows are
   read by Atlas, Crucible and Sentinel. A repository with two hundred open pull
   requests told the agent reasoning about engineering load that the backlog was
   twenty.

   Two more came out of the same reading: a value taken from a POSITION in a
   response that specified no sort (`openPRs[length - 1]` as "the oldest"), and
   an average over values that were never reported (`pr.additions || 0`, where
   every absent size counted as a real zero).

   **The half of that fix which is easy to miss: FOLLOW THE READERS.**
   `getSentrySummary` read `data.open_count`, so naming the truncated case
   honestly upstream would have made it read null and thrown the number away.
   The truth arriving as an absence is its own defect.

   **Where the right pattern already was:** `intercom.ts` reads Intercom's own
   `total_count` and only falls back to a page length. Read it before inventing
   a fifth truncation idiom.

   **AND THE READERS OF THE LEVEL, once it had a writer.** Five so far, and the
   pattern held every time: the level was absent, so every reader reached for a
   movement that was present. `business-model.ts` divided net-new MRR by active
   users to get ARPU and built LTV, CAC payback and the LTV:CAC ratio on it;
   `expansion.ts` summed new + expansion and called it revenue, and answered 99
   years to saturation for a company with fewer than two snapshots and 0 years
   for one whose TAM could not be estimated.

   **The sharpest single defect of the whole cycle came out of that reading, and
   its tell is worth more than the fix.** `computeUnitEconomics` divided
   `churn_rate` — a 0–1 fraction — by 100, inflating customer lifetime a
   hundredfold. Its `?? 5` DEFAULT was written in percent and divided correctly,
   so a company that reported its churn got a worse answer than one that
   reported nothing. **When a fallback and the measurement it replaces disagree
   about the arithmetic that follows, one of them is in the wrong unit.**

   **Swept afterwards and clean:** every other reader of `churn_rate`,
   `activation_rate`, `day_30_retention` and `mrr_health_ratio`. An earlier
   cycle had already been through them — `failure-library.ts` carries the
   comment. This was the survivor.

   **AND THE COMPOSITES, which is where the shape does the most damage.** Four
   of them were built by substituting a number for every component that had
   none — the Value Delivery Index, the product health score, the marketplace
   health score and unit economics — and in three of the four the substitutions
   DISAGREED, so one absence read as excellent in one component and
   catastrophic in the next. The product health score gave a brand-new company a
   grade of C with a headline about "mixed signals"; the marketplace score told
   a company that had reported nothing it had liquidity collapse, a trust
   deficit and a supply imbalance at once.

   **The pattern that fixes all four, and should be reached for on the fifth:** a
   component contributes only when measured, weights renormalise over those that
   did, `coverage` says what share of the full weighting the number rests on,
   and the score is null when nothing was measured. A threshold is a FINDING, so
   it fires only on a measured value.

   **A gate was measured and deliberately NOT built.** The syntactic form
   (`(x ?? 0) < threshold`) appears in 16 files and all but two are
   `rowsAffected ?? 0 > 0`, where zero genuinely means none. It would be mostly
   baseline. This stays a reading habit.

   **A SECOND gate was measured and also not built** — the mirror of
   `check-write-only-columns`: columns that are READ and written by nothing,
   which is what `local_currency_mrr` was. A rough scan returns **347**, and the
   list is swamped by columns written by SQL triggers, by `ON CONFLICT … DO
   UPDATE SET`, and by column DEFAULTs — none of which an INSERT/UPDATE regex
   sees. Making it precise is real work for a signal that reading already
   finds. **Both measurements are recorded so the next steward does not
   re-derive them**, and the instructive part is that the one real instance was
   found by reading a file, not by either scanner.

   **`services/intelligence/` IS NOW DONE, and `global.ts` held the last
   finding — a new shape worth naming: A COLUMN NOTHING CAN WRITE, WITH A READER
   THAT FALLS BACK.** `GET /api/currency-health` reported FX erosion from
   `local_currency_mrr` and `exchange_rate`, two columns migration 011 added and
   nothing has ever filled — no ingest field, no integration, no route, no job.
   The `?? 0` on both sides was therefore the ENTIRE input, and zero-minus-zero
   reads as a flat local trend, which against a declining USD one IS the erosion
   condition. It fired whenever the other series fell, and that series was
   `new_mrr_cents` — a movement compared against what would have been a level.
   Retired with both columns in migration 193.

   **`{peer-signal,shippability,briefing-telemetry,cohort,regulatory}.ts` are
   clean:** their `?? 0` are on SQL COUNT aggregates, where zero rows genuinely
   is zero. `integration/slack.ts` stores no counts.
   **Checked and clean, recorded so nobody re-reads them:** `risk-state.ts`
   (every input explicitly null-guarded before it contributes),
   `scp/investor/fundraising-readiness.ts` (uses `ratePoints`, and its `?? 0`
   is intended — not having measured activation genuinely is not being ready),
   `stressor.ts`, `recovery.ts`, `scenario.ts`, `competitive.ts` and
   `benchmarks.ts` (no substitutions at all).

   **A map worth having before starting there.** There are TWO integration
   directories, `services/integration/` and `services/integrations/`, each with
   its own stripe/posthog/intercom/linear. They are not duplicates in the
   dead-code sense: the plural set is reached by the scheduled hourly
   `integration_sync` job, the singular set by dashboard and webhook routes.
   Both are live. Whether they should be one set is an engineering decision
   nobody has taken, and taking it needs a reading of both, not a rename.

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

3. **CLOSED: readers whose writers can never run.** Both halves are done, and
   neither was closed by deleting the reader.

   **The wiki was three halves and no wire.** Scribe's prompt has always asked
   the model for `wiki_contributions` and its response type has always declared
   them; nothing read the field, so the agent paid for those tokens every week
   and threw the articles away. It also READS `agent_wiki_entries` to see what
   the company knows, and the only module that could write that table was
   imported by nothing. A producer, a store and a reader, all present, with no
   wire between them — so the fix was the wire, not a feature.

   **The lesson for the next one of these:** before deleting a reader whose
   writer cannot run, check whether the writer's INPUT is already being produced
   and discarded. Twice this cycle it was, and in both cases (this and the OKR
   create form) connecting cost less than deleting and left more behind.

   **The OKR half is CLOSED, and how it closed is the useful part.** The
   unreachable module was `services/scp/okr.ts`, and deleting it made the
   writer-less-table gate fire on `company_okrs` and `key_results` — the gate
   had been counting the INSERT *inside* the unreachable module as a writer,
   because a text scanner cannot see reachability. So the third option turned
   out to be neither "delete the page" nor "leave it": build the missing half.
   `/agents/okr` has a create form now, guarded by `requireOwner()`, and the
   page tells the founder who moved each key result and when.

   **Read that as a caution about the gate, not only as a fix.** Any table
   whose only writer sits in a statically unreachable module currently looks
   written to the writer-less gate. The unreachable-modules baseline is the
   list of places where that can be true; 27 entries remain.

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
   - **Evidence: 60 completed runs in this session's scratchpad, zero abort
     signatures** (`grep -lEi "PendingException|rust panic|SIGABRT|Aborted"` over
     every log), on top of the 39 counted before it and the 30+ when `closeDb`
     landed. Against the prior rate of roughly one in three, that is a vanishing
     coincidence.

     **Still not a diagnosis, and the distinction is not pedantry.** What is
     established is that the abort has not recurred since a specific change; the
     mechanism was never observed. A recurrence eliminates this hypothesis the
     way the uncleared-timer one was eliminated — by measurement, not argument.
     Do not promote this to "fixed" without a mechanism, and do not spend more
     runs accumulating the same evidence: it is already strong, and more of it
     answers no question that is open.
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

5. **4 tables written and never read** — `check-unread-tables.mjs`, the mirror
   of `check-writerless-tables`. That one found tables live code SELECTs from
   and nothing fills; this finds tables live code FILLS and nothing SELECTs
   from. A write on every path, an erasure obligation carried and schema
   surface maintained, for a record nobody looks at.

   **A sharper instrument than the column list**, because a whole table nobody
   reads is unambiguous. Three exclusions, each a real reader the scan cannot
   otherwise see: a SQL trigger body (`ai_spend_reservations` is consumed
   entirely by migration 099's triggers), the erasure map (`exportFounderData`
   reads those through a dynamic `SELECT * FROM ${table}` — `gate_events` and
   `referral_conversions` reach a person that way), and a plain `FROM`.

   **`customer_health_snapshots` is DONE and is the argument for the gate.**
   Every health refresh had written the score, the churn risk and the four
   components behind them since migration 027, and nothing read a row.
   `customers.health_score` holds only where a customer IS, so a customer
   sliding 90 → 70 → 55 looked identical, at 55, to one that had sat there all
   year. Harbor's own prompt claims churn "is always telegraphed 30-60 days in
   advance by behavioral signals that nobody watched" — the watching was being
   recorded and discarded, so the one thing that agent is for was the one thing
   it could not see. `getFallingCustomers` reads it now, the founder's page shows
   it and Harbor is told. **Not folded into `getCustomersAtRisk`:** a customer at
   78 falling ten points a month is not at risk by the threshold, and adding
   them to the set the outbound departments act on would widen who Foundry
   writes to with nobody deciding it should.

   **`web_audit_results` was the second one followed, and the finding was next
   door rather than in the table.** Onboarding asks a founder for their website
   and wrote the answer here as a bare row — url plus ids, every analysis column
   NULL — while `products` had no website column at all. So the founder answered
   a plain question about their own company and Foundry could not afterwards say
   what the answer was. Migration 184 gives the company a `website_url`, the
   settings page shows it, and the table keeps its real purpose. **It stays on
   this baseline:** whether actual audit output should have a reader is item 2's
   decision, since `runWebAudit` only runs through the clientless API.

   The lesson generalises: an unread table is a place to start looking, not
   necessarily the thing that is wrong. Here the table was fine and the fact was
   being filed in the wrong drawer.

   **`board_decks` was the third followed, and the worst finding of the cycle.**
   `POST /api/products/:id/board-deck` is mounted and authenticated. It asked a
   model for eight slides including "Key Metrics (MRR, growth, churn, NPS)",
   "Customer Health" and "Financial Overview (runway, unit economics)" — and
   passed it the company's NAME, SECTOR AND STAGE. Nothing else. **Every number
   on those slides was invented, in a document a founder takes to their
   investors.**

   Of every claim-without-evidence in this campaign that one has the furthest
   reach: the others mislead the founder, and this one is handed onward BY the
   founder to people deciding whether to fund them. The company's real figures
   are passed now through `ai/measured.ts`, and the system prompt says unknown
   must survive to the slide, with the reason attached so it is not trimmed as
   boilerplate. The unread row stays on this baseline — the route returns the
   deck to its caller, so retrievability is a product question, and the two
   sibling functions retired from that file (migrations 164, 165) show what
   happens when it is answered by writing a row and hoping.

   **And a sweep it prompted.** Every prompt asking for facts about a company
   was checked against what data it carries. `scp/agents/crucible.ts` had the
   `|| 0` defect the earlier agent sweep missed because it reads `audit_scores`
   rather than `metric_snapshots` — a never-audited company was shown to the QA
   agent as 0/10 on three readiness dimensions. **Checked and already correct:**
   `redteam/council.ts` filters null telemetry keys and says "no telemetry yet";
   `scp/investor/investor-update.ts` handles every null. Recording those matters
   as much as the fixes — a sweep that reports only what it broke tells the next
   reader nothing about where not to look. **`portfolio_snapshots` stays, deliberately.** The
   weekly job writes it and nothing reads it; the whole value of a weekly
   snapshot is the series, so retiring the writer would destroy the history
   that any future reader would need. Building an investor-facing reader over
   several companies' aggregates is a §12 portfolio-isolation question and an
   owner decision, not a steward's. **Its content was the fixable part and is
   fixed** — `median_mrr` was the literal 0 and `avg_mrr` divided by every
   member including the ones that never reported.

   **Eight of the remaining twelve were followed to the end this cycle, and
   every one held a finding.** They are listed with the SHAPE first, because
   the shapes are what transfer:

   - **A shadow copy that was wrong, and could not be found to be wrong because
     nothing read it.** `auto_execution_log` duplicated `action_drafts` field
     for field; `agent_positions` duplicated `debate_sessions.positions_json`
     and `conflicts_json`, and duplicated them BADLY — the challenger inserted a
     second row carrying the challenged assertion instead of marking the
     original, so a challenged assertion appeared twice, once reading as
     unchallenged, and the `challenged_by` / `challenge_response` columns the
     schema was built around were never once populated. Migrations 185 and 186.

   - **A word that outranked the execution path.** Beside `agent_positions`, a
     debate that THREW was stored `status = 'complete'` and painted green
     beside a conflict count of zero — indistinguishable from a debate where
     the agents agreed. The synthesizer had a second route to the same place: a
     parse failure returned a well-formed object with an apologetic summary and
     never threw at all, so the failure text reached the founder's daily
     briefing under "[AGENT SYNTHESIS]".

   - **Two payments for one answer.** `causal_chains` was written weekly by
     `graph_rebuild` and used for a log line, while the route that serves
     chains called Opus AGAIN on every request. The stored rows also lost the
     cause and the effect: the model returns entity LABELS and the INSERT wrote
     literal NULL into both id columns. Migration 188 stores the labels,
     resolves ids against the entities the prompt actually showed the model,
     and the route reads what the job produced.

   - **An estimate with no company in it.** `switching_cost_analysis` and
     `expansion_analysis` both stored model output derived from a product's
     NAME and SECTOR. Both retired (migrations 187, 189); the estimates stay
     and now carry `estimated_from` — same shape and same word as
     `Forecast.projected_from`. `expansion_analysis.tam_penetration_rate` held
     the literal 0 the INSERT typed into it.

   - **Both halves absent.** `portfolio_alerts`: its writer had no caller and
     the table had no reader. Migration 189.

   - **A record that answers "who did this", filed where nobody looks.**
     `integration_sync_log` and `okr_progress_updates`, both now read at the
     surface that needs them. The integration one uncovered the sharper defect
     next door: a failed sync set `status = 'error'` and the hourly job
     selected `status = 'active'`, so ONE failure removed an integration from
     sync permanently, with no retry, no limit, no notice — the stop was a side
     effect of a WHERE clause.

   - **A hundred where nothing was known.** `cofounder_alignment_scores`:
     one respondent returned alignment 100/100/100/100 and none returned
     0/0/0/0 — opposite extremes of the same absence. Beside it,
     `DecisionAttribution.by_founder` was keyed on `decisions.decided_by`,
     which holds `'founder' | 'second_self'` and not a person, so the
     "co-founder imbalance" finding was a comparison between the founder and
     Foundry. The row is still unread and stays on this baseline: the tier2
     route returns the score to its caller, and whether a founder should see
     an alignment trend is the same product question as `board_decks`.

   **Measured while building it:** every table holding a write-only column has a
   writer, so `founder_focus_settings` was the only case of its kind and that
   shape is exhausted. Do not go looking for more.

6. **69 write-only columns — a question-asker, not a work queue.** `check-write-only-columns.mjs` holds the count;
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

   **A third kind, found by mining it further: a column whose whole TABLE is
   unreachable.** `founder_focus_settings.focus_area` was on the list; the table
   holding it had no writer at all — no settings page, no route, no API — and a
   nightly job dutifully expiring values nobody could set. Migration 183 dropped
   it, applying the owner decision recorded in 157 ("remove the consuming halves
   rather than build the producing ones") to a case that sweep missed. **The
   sibling table was removed then and this one was left standing next to the
   comment explaining why it should not be** — so when reading this list, check
   whether the TABLE is reachable before asking about the column.

   Also taken from it: `integration_health.last_successful_sync` (real, fixed),
   `forecast_checkpoints.variance_pct` (real, fixed) and
   `institutional_judgment_evaluations.economic_result_json` (documented rather
   than fixed — an unfilled inbound slot, not a control that does nothing).

   The remaining attribution by writing area, which stands:

   - **20 are written by `services/institution`**, and those are the ones worth
     reading. The claim that they were all "answered where they are written"
     did not survive checking: `outbound_actions.outcome_evidence_ref` was one
     of them, and reading it turned out to be the fix for an outcome that could
     could never be reopened once settled.

     **Two of the three this entry used to name are closed, and one of them was
     already closed when it was written — check before believing this list.**
     `provider_receipt_json` is read by `refusalSentence` in
     `responsibility-assisted-email.ts`; the claim here was stale.
     `observation_source_evidence_ref` now reaches the founder in the material
     shadowing exceptions, and following it produced the largest finding of the
     cycle (see the narrative above).

     **`autonomy_consents.from_mode` stays, deliberately, as provenance.** An
     earlier cycle found three writers putting three different things in it and
     fixed the fiction; `the-consent-ledger-records-what-actually-changed`
     pins the correctness. It is a field in a proof record, not an input to
     code, which is the case the gate's own header says to baseline on purpose.
     A founder-facing consent history — "you moved billing from observe to act
     on 12 August, having read disclosure v3" — would give it a reader and does
     not exist. That is a product question, not a defect: `disclosure_version`
     IS read, and reaches audit reasoning, so the proof chain is live.
   - **22 are `services/scp`** and most of the rest are legacy verticals.
   - **Two are a company's SEASONALITY** (`business_model_profile.seasonal_*`),
     and the earlier note here overstated them: the only writer is
     `routes/api/tier3.ts`, part of the clientless API in item 2. Nothing
     *records* the shape of a company's year — an unreachable endpoint could,
     and nothing would read it. That makes them item 2's problem, not their own.

   `signal_events.processing_session_id` accounts for eleven of the institution
   rows on its own and is one column, not eleven findings.

7. **One concept, two canonical truths: `customers` and
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

   **Which makes this a DEPLOYMENT FACT, in the same class as §12, and it should
   be read that way rather than as work sitting undone.** The legacy writer is
   not dead code: `POST /api/products/:id/customers` is mounted and
   session-authenticated, so a founder can populate `customers` today. Whether
   any has is not observable from this repository. A steward cannot close this
   by effort; someone who can see production can close it in a minute.

   Checked while here: `legacy` and `onlyLegacy` really are the same number, and
   correctly so — `readCustomers` deduplicates, so a legacy row with a reported
   counterpart never appears with source 'legacy'. Two names for one number is
   an invitation to believe they differ, and the only reason to keep both is
   that the criterion reads better under its own name.

   `customer_events` has one writer, `routes/api/platform.ts`, part of the
   clientless API in item 2 — where that API is unused, `customers.churn_risk`
   reduces to `last_active_at` recency.

   **Closed:** `customer_intelligence.do_not_contact_until` was a third,
   inert contact control beside the canonical one consulted at the boundary.
   Migration 179 dropped it.

8. **The transcript sense: NOT a gap. Corrected before it was built on.**

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

   **ANSWERED: the founder was not told.** A call arrived by webhook, was
   stored, analysed and rendered — and nothing said so. They had to navigate to
   `/signals/multimodal` and think to look. `analyzeTranscript` now delivers a
   notice at `attention`, which the policy puts in the Letter unless the founder
   raises it: a call came in, here is what was heard, read it tomorrow. Not for
   a transcript the founder pasted in — they already know, and reporting
   somebody's own action back to them as news is how a notification stream
   becomes something people stop reading.

   **Why it sat open for several cycles is the transferable part.** Telling the
   founder meant choosing how loudly, and until migration 182 the quiet rungs of
   `ux/interruption.ts` wrote nothing — so a founder who preferred to read it
   tomorrow would have lost it entirely. The question was never hard. It was
   blocked by something two frontier items away that nobody had connected to it.
   **When an easy question stays open, look for what it is waiting on rather
   than for what makes it hard.**

9. **CLOSED: two unread claim predicates, and why they stay written.**
   `shadow_expectation` and `shadow_comparison` go into `reconstruction_claims`
   and no consumer filters on either — every reader selects by predicate, and
   neither name is in `UNDERSTANDING_FACTS`, `later_reality_comparison` or
   `development_need`.

   They stay, and the distinction is now written where they are written: the
   OPERATIONAL copy of each fact is a dedicated row
   (`responsibility_shadow_expectations`, `responsibility_shadow_comparisons`)
   that the comparison and `assisting-admission` really do read; the claim is
   the PROVENANCE copy, carrying evidence refs back to the founder's
   authenticated statement and to the independent observations. **One is acted
   on, one is accounted for.** Deleting them would also have put an E3
   benchmark's evidence at risk to save nothing.

   Two records of one fact is a shape this campaign normally treats as a defect,
   so a test holds the premise the comment rests on — that nothing reads them.
   If that stops being true, the comment explaining why it does not matter fails
   with it.

   `development_shadow_comparison` was something else entirely and is resolved:
   pulling on it found that **nothing in production ever resolved a development
   shadow expectation**. The Letter lets a founder open one — Foundry asks what
   they would expect a check to report and records their answer — and
   `resolveDevelopmentShadowing` had no caller outside its own tests. The
   institution asked a person a question and never compared the answer with what
   the check said. Now resolved by the judgment tick, in the same loop as its
   external-metric twin, because having them wired in two places is how one of
   them came to be wired in none.

10. **Adapters for the existing intakes.** The shape is proven; breadth is
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

11. **CLOSED: the uncalled-export sweep.** 32 of the institution's exported
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
