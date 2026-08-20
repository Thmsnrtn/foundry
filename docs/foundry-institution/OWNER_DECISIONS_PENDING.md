# OWNER DECISIONS PENDING

Genuinely owner-level decisions only: company purpose, constitutional authority
semantics, irreversible external consequence, real money, legal or compliance
commitment, communication to real users, pilot activation, production
credentials, destructive production-data mutation, or product policy with
several materially different legitimate readings.

Ordinary technical decisions are not queued here — they are made and recorded in
git history. Nothing below blocks all high-value work; the campaign continues
around each item.

---

# EIGHT ANSWERED, SIX PENDING

The owner answered the first eight queued decisions; those are recorded below as
settled, with the record of what was asked and why in git history. Six items
are pending at the end of this file — §§9, 10, 11, 12, 13 and 14 — and none
blocks the campaign.

Three of the five need counsel rather than the owner alone (§9 retention
periods, §11 the audit-log window, §13 the benchmark aggregation threshold);
§10 has a recommended answer and a stated live gap while it waits; §12 needs a
deployment fact from the owner before it is even a decision.

§14 is a product and legal position rather than an engineering mechanism, which
is why it is here rather than decided in git history.

**Counsel debt is a kind of proof debt** (`PROOF_PROGRAM.md`): a conclusion
software cannot responsibly draw. Each item below states the question, what
depends on it, and what Foundry does meanwhile. None of them is answered by a
model's recollection of law, and none is quietly resolved by an implementation.

---

## RESOLVED 1 — Real bounded support pilot: **HOLD for adapter breadth**

`support-pilot-readiness-v1` stays green and keeps meaning only *READY TO
ATTEMPT*. E4 remains unclaimed and external. Revisit when integration breadth
catches up with the architecture — the remaining gap is adapters, not kernel.

## RESOLVED 2 — Recursive Foundry: **REPORT ONLY, NOT THE GRANT**

The owner will report the schema-snapshot obligation in the deployed
environment. The bounded regeneration grant is deliberately NOT performed yet,
so Foundry may not mutate its own repository outside a test.

**What this means for the campaign:** the recursive vertical stays proven
locally. Do not simulate the report, and do not treat a local run as the
deployed one. `recursive-institution-v1` continues to report ordinary on the
dimensions it exercises, and production recursion remains external proof debt
until the owner's action lands.

## RESOLVED 3 — `challenger` and `synthesizer`: **THEY SHOULD BE LIVE**

The owner was right, and my classification was wrong. Both are already
production-reachable and always were:

- Neither is an agent. Both say so in their own first lines — *"NOT a BaseAgent
  subclass — runs on demand during debate orchestration"* — and both export
  standalone functions with no `run(productId)`, so no loader could instantiate
  them even if the vocabulary named them.
- `debate/orchestrator.ts` statically imports both, and the orchestrator is
  called from the scheduler and from a dashboard route.

I had classified them `evidence-insufficient` on the reasoning "outside
ALL_AGENTS, so no loader can select it". True, and irrelevant: it inferred
deadness from the DIRECTORY rather than from reachability — the same category
error that once made the orphan report name ~160KB of live dynamically-loaded
code as dead. **Being in `agents/` is not what makes something an agent.**

Reclassified as production-reachable, and the gate now checks the distinction
directly: a module in that directory is an agent only if the vocabulary names
it, and anything else there must have a real importer or it really is dead.
Mutation-tested with a stray module claiming reachability it did not have.

## RESOLVED 4 — Effect kinds stay **CONSTITUTIONAL**

A company may declare what it counts, because reading a number is harmless. It
may never declare a new irreversible way to reach the outside world. Every new
effect kind is a migration and a review — that cost is small and visible, and
the cost of the alternative is a company inventing an irreversible action for
itself.

**Standing rule for future work:** do not add a mechanism that lets effect
kinds be created at runtime, by a company, an integration, or a model.

---

## RESOLVED 5 — The public API: **MAKE IT LIVE**

`/api/v1` and the Fathom/Fireflies transcript webhooks were mounted,
authenticated, and unreachable by anyone — nothing could issue a key, and the
endpoint the dashboard advertised did not exist and could not have.

The owner chose to make it live rather than leave it dormant or delete it.

**What this meant in practice.** Turning it on required first fixing what would
otherwise have shipped with it: three write routes gated by `agents:read`, and
an MCP transport with no scope check at all. Issuance is built like the scoped
ingest credentials — explicit scopes from a closed set, mandatory expiry,
revocable, evidence-recorded, hash-only storage.

**Standing consequence:** the API is now a real external surface. Every new v1
route needs a scope that a founder can actually grant, and the bidirectional
gate enforces that in both directions. Transcript ingestion is reachable, which
means real customer call content can now arrive and be analysed — that path is
customer data and untrusted external content, and must be treated as both.

---

## RESOLVED 6 — An unpaid account is **READ-ONLY**

A founder who never subscribed, or whose trial expired without converting, was
indistinguishable from a paying customer to every capability gate: `scp_status`
stayed 'active' from onboarding, `tier` stayed NULL, and nothing read trial
expiry. Agents kept running, governed effects kept sending, AI spend kept
accruing — indefinitely, for an account that would never pay.

The owner chose: **data and history stay readable; Foundry stops spending money
and stops reaching outward.**

**How it is enforced, and why that way.** The hourly `entitlement_sweep` writes
the same `products.scp_status = 'paused'` that `customer.subscription.deleted`
already writes, so every check that honours a cancellation honours a lapsed
trial too. No second mechanism to keep in agreement.

**Standing consequences:**

- Entitlement to act = a paid tier OR a live trial **OR a period already paid
  for** (amended by decision 7). Nothing else.
- The sweep resumes as well as pauses. Do not make it one-way.
- It is **not a revocation**: consents are untouched and nothing is demoted, so
  subscribing restores the permission the founder already gave.
- Any NEW capability that spends money or reaches outward must be reachable only
  through a path that already honours `scp_status`, or it will silently be free.

**Correction, one batch later.** The sentence above about "every check that
honours a cancellation" was an assumption about the rest of the codebase, and it
was false in three places: the outbound gateway's kill-switch read
`products.status` (the archive axis) and never `scp_status`; thirty-four
background jobs chose their work through a helper that did the same; and the
data-deletion path wrote `status='archived'` without touching the acting axis,
so a company whose founder had withdrawn consent stayed on every agent's work
list. Both axes are now read through one exported predicate,
`operatingProduct()`. **Reusing an existing mechanism does not mean the
mechanism was already total.**

## RESOLVED 7 — Follow **ordinary SaaS convention** for access and communication

Asked whether a paused account should be reachable at all, the owner answered a
larger question: *"People should be able to use their accounts until their
subscription period is ended even if they cancel like most apps do.
Communication between foundry and customers should be typical and consistent
with SaaS convention."*

**Standing consequences:**

- **Cancelling ends the plan, not the period.** `cancelSubscription` sets
  `cancel_at_period_end`; it must never call `subscriptions.cancel()`, which
  forfeits time already paid for. `founders.paid_through` records the period
  Stripe reports, and it survives cancellation on purpose.
- **The billing webhook records facts and asks the rule.** It must not decide a
  pause itself — that was how service came to end mid-period. One rule,
  `entitledToAct`, used by both the webhook and the hourly sweep.
- **Dunning is a grace period, not a cut-off.** A past-due account keeps working
  through Stripe's retries, which falls out of `paid_through` rather than being
  a second mechanism.
- **Account mail always reaches the customer; operational mail does not.**
  `send_account_notice` is the ONLY capability exempt from the pause, its body
  is rendered server-side from five fixed kinds, and it covers `paused` but not
  `archived`. A second exempt capability is a decision, not a copy-paste — a
  test asserts exactly one exists.
- Lifecycle mail that must exist: trial ending (3 days out), trial ended /
  read-only started, cancellation confirmed with the date access stops, payment
  failed.

## RESOLVED 8 — Push notifications: **WIRE THEM THROUGH THE GATEWAY**

`POST /api/push/register` and `/api/push/preferences` had been live since the
mobile API shipped, and nothing had ever sent a push. The owner chose to build
the channel rather than remove the surface.

**Standing consequences:**

- Push is the `send_push` gateway capability. It inherits the kill-switch, the
  entitlement pause, dedup and audit; it must never reach the network directly.
- A push with no `productId` has no authority context and fails closed.
- The notification type names a database COLUMN. It is resolved through a frozen
  map, never interpolated from an argument.

---

# NEWLY PENDING

## PENDING 9 — Retention periods for what survives an erasure: **COUNSEL**

Foundry now states, for every table that survives a company's erasure, what is
kept, on what basis, what may be done with it while it is kept, and when the
decision should be looked at again. Those `reviewAfterDays` values are
ENGINEERING ESTIMATES. They are not legal conclusions and this campaign will
not turn them into any:

| what survives | basis recorded | review after |
|---|---|---|
| `ai_spend_reservations` | cost accounting; live ceilings | 365 days |
| `idempotency_keys` | at-most-once records for effects already sent | 30 days |
| `products` (redacted shell) | referential integrity; the id must not be reissued | never |
| `founders` (redacted shell) | same, plus retained financial records reference it | never |
| `agent_audit_log` (two event types) | the record that the erasure happened | never |

**What is actually being asked.** Three things, and only counsel can answer
them:

1. **Are the periods right for the jurisdictions Foundry operates in?** A
   financial record retained 365 days is a guess at the shortest defensible
   period. Several regimes require longer for accounting records and shorter
   for anything identifying a person, and those two pull in opposite directions
   on the same row.
2. **Is a redacted shell erasure?** `products` and `founders` survive with the
   id and nothing else — every describing column cleared, the email replaced
   with `erased+<id>@invalid`, the identity-provider handle severed. The
   engineering claim is that what remains identifies nobody. Whether that
   satisfies a deletion request is a legal question about the row, not an
   engineering one about the columns.
3. **Does keeping the erasure trail itself need its own basis?** Two
   `agent_audit_log` event types are kept forever as evidence the erasure
   happened. That is self-evidently useful and not self-evidently lawful.

**Until it is answered.** The dispositions stand as written and the erasure
runs on them — this is proof debt, not a blocker. Nothing in the code claims
these periods are legally required; each says only what purpose it serves. If
counsel changes a period, the change is one number in `RETAINED_ON_ERASURE`
and the tests that pin the basis strings will catch anything that drifts from
what was decided.

**Not asked here:** whether to retain more. The campaign's answer to every
"could we keep this" has been no unless a stated purpose needs it, and that is
an engineering decision already made.

**Amended — the founder's own retention dropdowns now do half of what they
said.** The privacy page offers "Data Retention Period" and "Agent Log
Retention", and until now `data_residency_settings` was written by that form,
read back by the same page, and consulted by no job. The retention sweep
honours both settings where they are **shorter** than Foundry's own horizon,
and the copy now says which half is in force.

Longer is deliberately not honoured, and that is this section's question rather
than an engineering one: a company asking Foundry to keep data for ten years
may be asking for something a jurisdiction forbids, and a dropdown is not the
place to answer it. Two boundaries were drawn by hand and are worth counsel's
eye:

- `ai_cost_log` is exempt entirely. It carries no `product_id`, and a financial
  record is also where a company's shorter preference should not silently win —
  it is the same 13-month accounting need that pulls against §9's first
  question.
- The agent-log setting reaches agent-to-agent chatter and deliberately **not**
  `agent_audit_log`, two of whose event types are the record that an erasure
  happened. Whether a founder may shorten that record is precisely §9's third
  question, so it is not offered.

---

## PENDING 11 — Should the audit log be kept for 180 days or 365?

Found while removing a duplication, not while asking about retention — which is
why it is worth the owner's attention.

**There were two retention implementations, both scheduled daily.** One deleted
from `agent_messages` and `audit_log` on a single 180-day window; the other had
per-table horizons and said `audit_log` should be kept 365 days,
"compliance-relevant; keep longer". The shorter one wins every time, so the
audit log has always been kept 180 days while the code stating the policy said
365 and nothing behaved that way.

The duplication is fixed: one implementation, and `audit_log` stays at **180**,
which is what has actually been happening. Removing a duplication must not
quietly change what happens to anybody's data, and lengthening retention of
records that may name people is the wrong direction to take by accident.

**The question for the owner and counsel:** which was right? The audit log is
what answers "why didn't you show me X?", and it backs the erasure trail. 365
was somebody's stated intent and it has never been in force. This belongs
alongside §9, which is already with counsel on retention lawfulness.

Nothing is blocked either way — the system is consistent at 180 today.

---

## PENDING 10 — When a member erases their account, what happens to the company assets they configured?

**The situation.** A person can be a member of a company they do not own.
Erasing their account now reaches those companies: their conversations,
journal, notifications, consents and membership are deleted, and the company's
own records — its audit trail, its decisions, its integration history — are
severed so they stay and stop naming the person.

Five tables cannot be settled that way, because the row is a **company asset
the company is still running on**, on a NOT NULL column:

| Table | What it is |
|---|---|
| `api_keys` | a credential the company may currently be authenticating with |
| `mcp_grants` | an authority grant the company may depend on |
| `webhooks` | an integration that may be delivering right now |
| `deal_rooms` | a shared artefact other people are using |
| `decision_votes` | part of the company's decision record — and the person's own written rationale is inside it |

**The tension, plainly.** Deleting these takes a working capability away from a
company that did nothing wrong — a webhook stops delivering, an API key stops
authenticating, a decision loses a vote that was genuinely cast. Keeping them
keeps the erased person's identity in a live company, which is the thing an
erasure exists to remove. The columns are NOT NULL, so severing to nothing is
not available without a schema change and a marker value.

**Three legitimate readings, all defensible:**

1. **The person wins.** Delete. An erasure means erasure; a company that relied
   on a departing member's credential should re-establish it. Cost: silent
   breakage in a company with no warning.
2. **The company wins.** Keep the row, transfer ownership to the company owner,
   and record the transfer. Cost: the erased person's id survives until the
   transfer runs, and somebody must decide who inherits.
3. **Split by kind.** Revoke the credentials (`api_keys`, `mcp_grants`) because
   an authority held by a person who no longer exists should not act, and
   transfer or anonymise the artefacts (`webhooks`, `deal_rooms`,
   `decision_votes`) because they are the company's work.

**Recommendation: 3.** It is the only one that distinguishes *authority* from
*artefact*, which is a distinction the constitution already makes everywhere
else — authority held by a principal that no longer exists should not survive
the principal, while a record the company authored should. It needs a schema
change to make the artefact columns nullable, or a company-owned marker
principal, which is why it is not simply done.

**Until it is answered.** These five tables are marked `owner_decision` in
`PERSON_ACROSS_COMPANIES` and are deliberately NOT touched by the erasure. A
test asserts every table in that surface carries a disposition, so the deferral
is visible rather than an omission — but it IS a live gap: an erased person's
id remains in those five tables in companies they did not own.

---

## PENDING 12 — One shared key reads any company's whole picture: **DEPLOYMENT FACT, THEN COUNSEL**

`GET /internal/operator/dashboard-data?product_id=…`
(`src/routes/internal/ecosystem.ts:42`) returns a named company's risk state and
its reason, its active stressors, its MRR decomposition by new/expansion/
contraction/churn, its signups, active users, activation, retention, support
volume, NPS and churn rate, its latest cohort summary, and how many decisions
are pending. Its own comment says who it is for: *"used by Apex Micro, other
ecosystem products."*

The only thing between that and the internet is `internalMiddleware`
(`src/middleware/internal.ts`): one process-wide `ECOSYSTEM_SERVICE_KEY`,
compared timing-safely, and **nothing else**. There is no owner check, no tenant
binding, and no per-caller identity — the key is not issued to anybody, so
holding it is indistinguishable from being every company at once. The
`product_id` is a query parameter, so a holder reads any company by id.

**What is actually being asked, and it is a fact before it is a decision:**

1. **Who holds that key today?** If it lives only in the owner's own
   deployment and is used by the owner's own products, this is one owner
   reading their own portfolio and the exposure is bounded by that fact. If it
   has ever been given to a party outside the owner's control, then one
   company's full operating picture has been readable by another, and the
   companies whose numbers those are never agreed to it.
2. **If it is shared, what is owed?** That is the cross-company frontier the
   owner's direction names as distinct and high-risk. Consent, disclosure and
   whatever notice applies are counsel questions, not engineering ones.

**Why this is queued rather than fixed.** The correction depends entirely on
answer 1, and the two answers want opposite changes: a private-portfolio key
wants per-company scoping it does not have, while a shared key wants
withdrawal, not scoping. Guessing would either break a working ecosystem
integration or leave a disclosure standing under a scope check that looks like
a control.

**What holds meanwhile.** Nothing has been relaxed and nothing new was opened.
The route is read-only — it writes nothing and reaches nothing outward. The
`/internal` surface is deliberately outside the member-capability ratchet
(`scripts/check-route-guards.mjs`, `NOT_A_MEMBER_SURFACE`) because no member is
present on it, which is correct and is also why this went unexamined by that
gate.

---

## PENDING 13 — Cross-company benchmarks: is aggregation with k = 5 enough? **COUNSEL**

A company's metrics are pooled and returned to other companies as percentiles.
Two present-tense engineering corrections were made this cycle and both hold:

- Contribution now requires the company's own recorded consent —
  `submitBenchmark` returns without writing unless
  `hasConsent(productId, 'benchmark_contribution')`
  (`src/services/benchmarking/pool.ts:60`). Before that, the privacy toggle a
  founder could switch governed nothing.
- A percentile is published only above **five distinct contributing companies**,
  counted as companies rather than rows — `MIN_CONTRIBUTORS = 5`
  (`pool.ts:37`, applied at `pool.ts:223`). Before that, one company reporting
  the same metric five times was a "sample of five", and the number a founder
  read as peer comparison could be their own data reflected back.
  `PEER_SIGNAL_MIN_SAMPLE = 5` (`src/services/decisions/patterns.ts:73`) is the
  same floor on the peer-signal path, likewise now counting distinct
  contributors.

**What only counsel can answer.** Five is an engineering estimate, chosen
because it is the smallest number at which one contributor cannot dominate an
aggregate. It is not a legal conclusion and this campaign will not turn it into
one:

1. **Is k = 5 a defensible threshold for the jurisdictions Foundry operates
   in?** Several regimes have expectations about small-cell aggregation, and
   some of them are higher than five for data that can be re-identified from
   context — a category with four peers and one obvious outlier is a
   worked example, not a hypothetical.
2. **Is a recorded consent toggle the right basis at all** for using one
   company's operating data to serve another, or does this need something
   stronger — and does the company understand what it agreed to when the toggle
   says "benchmark contribution"?
3. **Is the aggregate still that company's data?** Whether a percentile derived
   from a company's numbers must be withdrawn when that company erases itself
   is a legal question about the aggregate, not an engineering one about the
   rows. Today an erasure does not recompute published percentiles.

**Until it is answered.** The floor stands at five and the consent gate stands.
Nothing in the code claims either is legally sufficient; each says only what it
does. If counsel changes the threshold it is one exported constant and the
tests that pin it will catch anything that drifts. This belongs alongside §9
and §11, which are already with counsel on data lawfulness.


---

## PENDING 14 — Should Foundry's own funnel analytics be consent-gated?

**The situation.** `telemetry/funnel.ts` records a NAMED founder's progression
through signup → repo connected → audit done → briefing viewed → decision
approved → trial started → paid. It is Foundry's own first-party product
analytics: `founder_id`, the step, the timestamp. It is not anonymised, and it
runs whether or not the founder has switched anything on.

The privacy page offered a toggle called **Help Improve Foundry**, described as
*"Allow Foundry to use your anonymized usage patterns to improve the product
for everyone"*, covering *"feature usage, navigation patterns, and error
rates"*. Nothing read it. So a founder who left it off was told their usage
patterns were not being used, while their named progression was recorded
anyway.

**What has been done meanwhile, and it is only half.** The copy now says what
actually happens: the account and subscription progression is recorded either
way because it is how the service is run and billed, and the toggle covers
anything beyond that. The consent type is listed in `RECORDED_PREFERENCE_ONLY`
with that reason, and a test holds every consent type against either a reader
or that register — so this cannot quietly become a toggle nobody notices again.

**What is actually being asked.** Three readings, all defensible, and the
answer is a position rather than a mechanism:

1. **First-party analytics need no consent.** Recording how a customer moves
   through your own product's setup is ordinary service operation. The toggle
   then governs only optional detail beyond it, which is what the corrected
   copy already describes.
2. **The toggle should govern all of it.** A founder who says no should mean
   no, and Foundry losing its own conversion data by default is the cost of
   that. `recordFunnelStep` gains a consent check and the default is off.
3. **Split it.** Keep the billing-and-lifecycle steps ungated as service
   operation; gate feature-level and navigation detail — which is roughly the
   line the corrected copy draws, made real rather than described.

**No recommendation is offered on 1 vs 2**, because the choice is about what
Foundry is willing to say to its own customers rather than about how to build
it. If 2 or 3 is chosen, the change is one call site and a consent check.

**Related, and separate:** whether this data is subject to the retention
questions already with counsel in §9 and §11. `funnel_events` was not in that
table.
