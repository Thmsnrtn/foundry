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

# TEN ANSWERED, FOUR PENDING

The owner answered the first eight queued decisions; those are recorded below as
settled, with the record of what was asked and why in git history. **§10 and §14 are now answered and implemented** — see RESOLVED 9 and RESOLVED
10 below. Four items remain pending — §§9, 11, 12 and 13 — and none blocks the
campaign.

Three need counsel rather than the owner alone (§9 retention periods, §11 the
audit-log window, §13 the benchmark aggregation threshold). §12 is an owner
instruction that is partly an operational act only the owner can perform.

**The owner's interim positions on the three counsel questions are recorded at
the end of this file and are in force now.**

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

## RESOLVED 9 — Member erasure and company assets: **SPLIT BY KIND**

The owner's answer: *"Adopt split by kind, with authority versus artifact as the
governing distinction. Revoke `api_keys` and `mcp_grants`; do not transfer
personal authority. Preserve genuinely company-owned integrations/artifacts
while severing the erased person's identity. Do not falsely reassign
authorship."*

**Implemented.** Migration 175 made the three artefact identity columns
nullable, which is the whole reason these five tables sat undecided — not
indecision, an absent column state.

- **AUTHORITY — `api_keys`, `mcp_grants` — is revoked and removed.** An
  authority held by a principal that no longer exists must not act, and handing
  it to the company owner would be inventing a grant nobody made. The
  revocation column is set before the row goes, so a partial failure leaves a
  DEAD credential rather than a live one.
- **ARTEFACT — `webhooks`, `deal_rooms`, `decision_votes` — is preserved and its
  author severed.** The integration keeps delivering, the room stays open, the
  vote still says which way it went. `NULL` says NOBODY; another founder's id
  would say somebody who did not do it. A test asserts the company owner is
  never written into these columns.
- **Revocation is not silent.** Each one writes into the company's own audit
  trail — what stopped, how many, and that the account it was issued to was
  erased — naming no person, because naming one would undo the erasure that
  caused it. Losing a capability with no explanation was the named cost of this
  choice; this is what makes it acceptable rather than careless.

**Standing consequences:**

- The disposition `owner_decision` no longer exists in
  `PERSON_ACROSS_COMPANIES`, and a test asserts it cannot return. Every table
  holding a person inside a company they do not own is `delete`, `sever` or
  `revoke`.
- **A severed vote is not an unauthorized one.** `audit-unauthorized-votes.mjs`
  now excludes `founder_id IS NULL`, or every erasure would manufacture a
  finding: the person was entitled at the time, and the audit asks who voted
  *without the right to*.
- **The free text stays, and is counsel's question.** `decision_votes.rationale`
  and `.concerns` are the reasoning behind a company decision — a decision
  record stripped of *why* is not a truthful record — and they are also the
  erased person's own words. The attribution goes now; whether the words may be
  retained is queued with §9 rather than deleted on a guess or kept without one.

---

## PENDING 12 — Rotate `ECOSYSTEM_SERVICE_KEY`: **OWNER ACTION, CODE SIDE DONE**

The owner's instruction: *"Do not assume who holds ECOSYSTEM_SERVICE_KEY. If
current evidence cannot positively establish that it has remained solely within
owner-controlled infrastructure, treat distribution as unknown and rotate it.
Long term, private owner-portfolio access may exist, but it must be represented
as an explicit service/portfolio principal with scoped company membership rather
than possession of one global secret plus arbitrary product_id. Commercial
customer access must remain isolated."*

**What the code now does.** The two `/internal` routes that touch a company's
data — the operator dashboard read and the conversion-signal write — resolve the
presented credential to a **principal** and require that company to be in its
scope. Possession of the global key is no longer sufficient for either.

- **Scope is enumerated membership, not a flag.** There is no wildcard and no
  "all companies" option, deliberately: reaching a company outside the scope is
  not a permission check that could be written wrong, it is a row that does not
  exist (migration 177).
- **Isolation is structural.** A principal may only be scoped to companies its
  issuer OWNS — checked at issuance, and again by a database trigger, because
  the first is a property of one function and the second is a property of the
  table. Ownership can change after issuance; the trigger makes that a refusal
  rather than a silent inheritance. One owner therefore cannot scope a principal
  into another owner's company at all.
- **A credential, not a password.** Issued to a named party, mandatory expiry,
  revocable, hash-only storage, last-used recorded — the same shape as ingest
  credentials and API keys.
- **Issuance exists.** `POST /settings/portfolio-principals`, behind
  `requireOwner()`, because a credential reading several companies at once is
  the exceptional boundary rather than ordinary company work. A control with no
  way in is a sentence in a migration, and this campaign has found that shape
  four times.
- **It fails closed today.** Until a principal is issued, those two routes serve
  nobody. That is the correct state for a surface whose key distribution the
  owner has instructed us to treat as unknown.

**WHAT REMAINS, AND IT IS YOURS.** Rotating the deployed
`ECOSYSTEM_SERVICE_KEY` is an operational act on the environment that no code
change performs, and it is recorded here rather than reported as done. The key
still guards the two `/internal` routes that carry no company data
(`/internal/icp`, `/internal/campaign/receive`); rotating it costs nothing and
removes the standing question.

If any ecosystem product currently calls the operator endpoint, it will now
receive 404 until a portfolio principal is issued to it and scoped to the
companies it should see. That is the intended behaviour of this change, not a
regression — the old answer was that it could see all of them.

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

## RESOLVED 10 — Foundry's own analytics: **SPLIT ANALYTICS**

The owner's answer: *"Adopt split analytics. Necessary
service/billing/security/configuration state remains ungated and disclosed.
Optional feature/navigation/product-improvement telemetry must actually honor
the Help Improve Foundry preference. Prefer minimization and de-identification
where practical. Separate operational state from analytics rather than treating
everything as one funnel."*

**Implemented.** The funnel is two paths rather than one table with a rule
applied to some of its rows — because a rule applied to some rows is a rule
somebody eventually forgets.

| Step | Kind | Recorded |
|---|---|---|
| `signup`, `repo_connected`, `trial_started`, `paid` | service | always, against the account, **disclosed on the privacy page in those words** |
| `audit_done`, `briefing_viewed`, `decision_approved` | telemetry | only with `product_improvement` consent, against a contributor hash |

**Minimisation first, de-identification second**, in that order. Without consent
**nothing is recorded** — not a row filtered out at read time, which would make
the toggle a display preference rather than a control. With consent, the row
carries a hash and no founder id, no product id and no free text (migration
176).

**Standing consequences:**

- **A step in neither list fails closed to telemetry.** The mistake that costs
  somebody something is recording without consent.
- **The readout says which population each count is over.** The telemetry half
  counts consenting people only — a smaller denominator by construction — so a
  conversion rate crossing the boundary compares two different groups. Each row
  carries its `kind` rather than leaving a reader to infer it from a dip. This
  is the same provenance error the wisdom network made when a cohort count was
  published as a contributor count.
- **The erasure reaches it.** `product_telemetry_events` is in the named-key
  erasure map from the same commit that created it. A pseudonym is not
  anonymity, and a table the erasure has never heard of survives forever —
  which is how `network_contributions` outlived erasures for months.
- **The page no longer claims more than the code does.** It says what is always
  recorded and why, and that off means not written.
- `RECORDED_PREFERENCE_ONLY` is down to one entry (`ai_training_opt_out`, which
  has no path to gate because no training pipeline exists).

---


# OWNER INTERIM POSITIONS — in force now, pending counsel

These are not answers to the counsel questions. They are the owner's standing
instruction for how Foundry behaves **while** those questions are open, and they
bind the campaign the same way a resolved decision does.

**Retention (§9).** Keep the current shorter, general behaviour rather than
lengthening retention by guess. **Do not call redacted id shells proven
anonymous** — they are *tombstoned and redacted*, and their identifiability and
legal status are externally unconfirmed. Prefer purpose-specific retention over
one global period.

*What this forbids:* any code comment, surface, or document asserting that a
redacted `products` or `founders` row identifies nobody. What is true is what
was done to it — every describing column cleared, the email replaced, the
identity-provider handle severed — and whether that suffices is not ours to
state.

**Audit logs (§11).** Retain **180 days** as the interim general default,
because that is current actual behaviour. If counsel establishes a different
basis or period for narrowly necessary erasure and accountability evidence,
separate that from the general default rather than moving the default to meet
it.

**Cross-company benchmarking (§13).** **Do not treat k = 5 as a safe harbour.**
Contribution stays explicitly opt-in. Commercial cross-company benchmarking is
**external proof debt** and counsel debt before broad release — it is not
demonstrated by the floor holding locally. Future safeguards must consider
re-identification, contributor dominance and competition sensitivity, not count
alone.

*What this forbids:* promoting cross-company benchmarking toward commercial
maturity on the strength of the threshold, or describing five as sufficient
anywhere a customer reads it.

**And the standing instruction over all of them:** *"Do not let these external
questions block unrelated development."* Preserve the questions, implement the
safest locally resolvable structural corrections, and resume autonomous
stewardship.
