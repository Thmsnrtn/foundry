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

# THIRTEEN ANSWERED, FIVE PENDING

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

**PENDING 22 was answered on 2026-09-21** and is recorded as RESOLVED at the end
of this file, with the authorisation quoted. **Two more were added the same day**
(PENDING 23, the repository's visibility; PENDING 24, the development-instance
Clerk key running in production). Both came
out of verifying an independent review's claims against the live deployment
rather than accepting them, and both are external or account decisions rather
than engineering ones. Neither blocks anything.

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

## PENDING 14 — May Foundry send because nobody answered? **OWNER**

`outbound_actions.authority_level` has three values. Level 0 executes on a
standing grant written into the code. Level 2 waits for the founder. Level 1 was
meant to be the middle: notify, wait an hour, then act unless someone objects.

**What was there.** `proposeAction` stamped `approved_by = 'auto'` and
`approved_at` one hour in the FUTURE the moment a level-1 action was proposed,
left `status` at 'pending_approval', and returned. No scheduler existed to
execute it, nothing counted the hour, and the only notice was a dashboard the
founder might not open. The action history rendered that value as
"automatically, after the notice window". The Pending Actions page badged every
level-1 action "1-hour window" — a promise, to the founder, about what the
system would do by itself.

So the record asserted an approval that had not happened, at a time that had not
arrived, by a mechanism that did not exist. All of it is now removed: a level-1
action is pending approval, the row says nothing about who approved it, the
badge says "Your approval", and migration 201 refuses any `approved_at` more
than five minutes ahead of the database's clock so the next version of that code
cannot write a deadline into a past participle.

**What only the owner can answer.** A working version of level 1 is Foundry
sending something to a customer BECAUSE A PERSON DID NOT ANSWER IN TIME. That is
a different kind of authority from a standing grant the founder configured, and
it is not an engineering choice:

1. **Is silence consent, at this company, for this class of action?** An hour is
   an hour of a founder's day; it can be a flight, a meeting, or a night's
   sleep.
2. **What has to reach the founder for the window to start?** A window that
   begins when a row is inserted, and a window that begins when a notification
   is delivered and shown to have arrived, are different promises. Only the
   second can honestly be called notice.
3. **Which action types, if any?** The same door serves an internal note and an
   email to a paying customer, and the case for a timer is not the same for
   both.
4. **Who is on the record afterwards?** `acting-principal.ts` keeps 'auto' for
   "reached its notice window without anybody objecting" and nothing writes it
   any more. If level 1 comes back, that value comes back with it — and it has
   to remain distinguishable from "somebody chose this".

**Until it is answered.** Level 1 behaves exactly as level 2: it waits for a
person. The distinction survives in `authority_level`, where a future
implementation can find it, rather than in a claim about what has been
authorised. Nothing in the product tells a founder an action will go out on its
own.

*What this forbids:* building the sweep, the timer, or the notice as an
engineering convenience, and stamping any approval that has not happened.

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

---

## PENDING 15 — The AI sub-processor disclosure was wrong, and what replaces it is yours: **COUNSEL**

**What was true.** The public privacy copy said "Foundry sends prompts to
Anthropic (Claude) under the standard API terms, which contractually forbid
using prompt content for model training", and listed Anthropic as the only AI
entry under Third-Party Processors.

`api.anthropic.com` appears nowhere in this repository. `src/services/ai/client.ts`
pins `https://openrouter.ai/api/v1` and `getBaseUrl()` returns it
unconditionally — the comment beside it says a direct Anthropic key "still
routes through OpenRouter for consistency". Voice replies go to OpenAI
(`src/services/scp/briefing/voice-reply.ts`). So every prompt containing a
customer's business context has been received by services the disclosure did not
name, and the one it did name was not in the path.

**What was changed, and why only this much.** The false statements are gone: the
copy now names OpenRouter and OpenAI as the services that receive prompt
content, and `audit-public-claims.mjs` pins those names to the endpoints the
code actually calls, so the disclosure cannot drift from the product again.

The assertion about contractual terms was REMOVED rather than rewritten. Foundry
sends no data-policy header — the only headers on a model request are
`Content-Type`, `Authorization`, `HTTP-Referer` and `X-Title` — so it holds no
evidence of any no-training term with either vendor. Restating that promise
under a different vendor's name would have repeated the original defect at a
higher cost: a legal claim with nothing behind it.

**What is yours to decide.**
1. Whether OpenRouter and OpenAI are acceptable sub-processors for customer
   business context, or whether prompts should go direct to a named provider.
2. Whether to obtain and then state a no-training term — and, if so, to
   configure whatever opt-out each vendor offers, so the claim has a mechanism
   behind it rather than a sentence.
3. Whether existing customers must be told. The copy promised a 30-day notice
   before a change affecting this; the disclosure was wrong rather than changed,
   which is a different obligation and a question for counsel.
4. Whether the DPA offered "on request" matches what the corrected list says.

Foundry has not written to any customer about this and will not: telling people
their data went somewhere they were not told about is an owner's decision, not
an institution's.

---

## PENDING 16 — Twelve agents propose actions nothing can carry out: **OWNER**

Each of the twelve agents can emit `outboundActions`, which become rows in
`outbound_actions`. None of those rows has ever been executed by anything, and
until now every one of them was recorded as though it had been.

**What was there.** `executeAction` dispatches on `integration_name`, and
`base.ts` fills that field with the AGENT's name — 'atlas', 'beacon' — never a
provider. Only `'resend'` has a case, so every agent-originated action fell to a
default branch that set `status = 'executed'`, stamped `executed_at`, and
returned success, while the message it stored beside them read "no executor
registered yet". The founder's inbox, the actions page and the Letter all read
`status`. That branch now refuses, and both callers write `status = 'failed'`
with the reason, so these actions report what actually happened to them.

A second defect sat on the same path: the authority level came from the language
model. Every agent prompt asks for `"authority_level": 0 | 1 | 2` without saying
what the numbers mean, and level 0 executes immediately. `proposeAction` now
binds a proposed level to the founder-set level on `agent_instances` and takes
the stricter, so a model can ask to be more careful and can no longer ask to be
less. That part needed no decision — it is the difference between competence and
authority — and it is done.

**What only the owner can answer.** Whether these actions should be able to
execute at all is about widening Foundry's hands, which is not an engineering
call:

1. **Should an agent's proposal reach a provider?** Pointing `integration_name`
   at 'resend' instead of the agent's name is a small edit, and it would connect
   twelve language models to a live email door. The gateway's kill-switch,
   budget and audit would apply; the question of whether they SHOULD be sending
   is upstream of all of that.

   It would also be the first time that door opened. `case 'resend'` in
   `executeAction` has no production caller: the only rows carrying that
   integration name are written by `planAssistedSupportEmail` already
   `approved`, and dispatched by `executeAssistedSupportEmail` across the
   gateway directly — so they never pass through `executeAction`, and
   `getPendingApprovals` (which filters `pending_approval`) never offers them
   to `approveAction` either. `executeEmailSend` is thoroughly tested and
   nothing live calls it. The default branch was not an edge case; it was the
   only branch anything reached.
2. **Against what vocabulary?** The action types are largely model-invented —
   `write_${proposal.type}`, `revenue_${action.type}`, `publish_content`. An
   open vocabulary cannot be mapped to handlers, so making these executable
   means first deciding the closed set an agent may ask for. That is the same
   shape as `ALL_AGENTS`, and for the same reason.
3. **Or should agents stop proposing what nothing can do?** The honest
   alternative is that these are proposals FOR A PERSON and were never meant to
   execute — in which case the queue should say so, rather than accumulating
   failures. Today a founder approving one gets a failure, which is true but
   reads like a malfunction rather than a design.
4. **Does level 0 belong to any agent?** Oracle ships configured at 0, "fully
   autonomous". Nothing has tested what that means when the door on the far side
   is real.

**Until it is answered.** Agent-originated actions are proposed, bound to the
founder's configured authority, and refused at the dispatch with the reason
recorded. Nothing reaches a provider. No row claims an execution that did not
happen.

*What this forbids:* repointing `integration_name` at a provider as a wiring
fix, and restoring any success status for an action nothing carried out.

**A CLOSED VOCABULARY, DRAFTED SO POINT 2 IS A YES OR A NO RATHER THAN A
PROJECT.** Eleven `outboundActions.push` sites exist across the twelve agents
(Oracle emits none). Six name a literal; five build the string from the model's
own words, which is the open half:

| emitted by | action type | reaches |
|---|---|---|
| atlas | `architecture_proposal` | nobody — a proposal for a person |
| compass | `strategic_proposal` | nobody — a proposal for a person |
| ledger, prism | `budget_alert` | the founder |
| crucible | `quality_improvement_${…}` | nobody — a proposal for a person |
| scribe | `write_${…}` | content, unpublished |
| beacon | `action.action_type ?? 'publish_content'` | content, possibly outward |
| forge | `revenue_expansion_outreach` | **a customer** |
| harbor | `cs_retention_outreach` | **a customer** |
| sentinel, shield | `action.type` | unknown — the model names it |

The shape of the decision falls out of the table. **Only two of the eleven
reach a customer**, and they are the only ones for which "should an agent's
proposal reach a provider" is really being asked. Six are proposals for a
person and need no executor at all — they need a queue that says so, rather
than one that records them as failed actions. The four model-named sites
(beacon, scribe, sentinel, shield) cannot be mapped to any handler while the
model supplies the noun, so closing the vocabulary is a precondition for
answering point 2 at all, not a separate cleanup.

A minimal accept/reject: close the set to the six literals; make the five
model-named sites choose from that set or be refused, exactly as `configType`
now is; and split the queue so a proposal-for-a-person is not an action at all.
Nothing here reaches a provider — that stays point 1, and stays yours.

---

## §15 RESOLVED — The Workshop is live at apexmicro.ai (2026-09-09)

The third token (`hidden-wave-924d`), confirmed and then widened to Edit at the
zone level, did the work. **Pressing Confirm was the missing step all along.**

**What now exists in the world**, every change through the governed door with a
receipt and a recorded way back:

| | |
|---|---|
| Page store | `apexmicro-pages` |
| Program | `apexmicro`, digest matching the reviewed source |
| Hostnames | `apexmicro.ai` and `www.apexmicro.ai` attached; www 301s to the apex |
| Retired | four stale records pointing at a Fly address that served nothing |
| Preserved | the Google site-verification TXT, and four unrelated Workers on the account |
| Sender | `Thomas Norton — Apex Micro <thomas@apexmicro.ai>`, DKIM/SPF/DMARC written and verified |
| Reply inbox | `thomas@apexmicro.ai` → the owner's address, routing enabled |
| Pages | 14, each read back over public HTTPS |
| Experiment 002 | published, updated, concluded, closed, page preserved — the full cycle against the real edge |

**Four defects surfaced, all of the same family.** Every one was a check that
answered a convenient question instead of the true one, and no stub had an
opinion about any of them:

1. Health verified the token at `/user/tokens/verify`, which reports on *user*
   tokens. An account-owned token answers it 401 while working everywhere it is
   used — so a working credential was reported invalid, and this document said
   so. Health now asks what the token can reach.
2. Mail routing was enabled by `POST /email/routing/dns`, which is for routing a
   *subdomain* and refuses the zone apex. `/email/routing/enable` is the one.
3. A route that could not route was recorded as `applied`, and the door's
   at-most-once key then refused every retry — a rule existed that could never
   receive mail, and the act that would have fixed it was deduped away
   permanently. The handler now refuses when the routing it was asked for is not
   enabled, and the key names the effect wanted rather than the call made.
4. Forwarding rules were read only when routing already reported enabled, so a
   half-configured zone looked empty and the retry tried to create a rule that
   already existed. Rules are now read either way.

**A fifth, and the one that would have mattered most.** The page store is
eventually consistent: a write is not readable at the edge the instant it
returns. Verifying once, immediately, turned a normal few-second delay into
"the world does not carry this page" — which stops publication and stops
outbound. A mismatch is now retried for a bounded window before it is believed.
The standard is unchanged; the world simply gets the seconds it needs to answer.

**Readiness for Experiment 001, checked against the world: 0 blocked**, 6
surfaces verified over public HTTPS, 7 ready, 3 waiting. The three waiting all
resolve at Allow: the experiment's own page, its payment link, and outbound
eligibility.

**Two things are still owed by you, and Foundry will invent neither.**

**One: the twenty-three recipients have not been reviewed — and the screening
under that review is Foundry's, not yet done.** Reconstructing production
corrected a note this document had carried: the twenty-two *approved*
recipients belong to the ORIGINAL probe, the one that was declined. Experiment
001 carries twenty-three of its own and every one of them is still `pending`.
Approval is the owner's act alone and no part of it can be delegated, so Allow
cannot clear until they are reviewed at `/foundry/experiments`.

But the completion audit found that his act, as it stood, was *uninformed*. His
approval was never twenty-three decisions — "the rest are fine" was always one
gesture — yet the sealed design says this test is for shops with observed
public-bid activity, and nothing checked that. The design named a population
and the hand would have written to whoever was approved. That is now enforced:
no business can be written to without a recorded, sourced reason it belongs to
the population, readiness says so before Allow rather than after, and the review
page shows the reason and the record on every line. **None of the twenty-three
carries that screening yet**, and Foundry will not invent it — the evidence is
the COMMBUYS award and vendor record, which is public, free, and costs nobody
any attention to read. Doing that screening is the next action, and it involves
contacting no one.

**Two: a postal address for commercial mail** — a business or PO box address,
not his home address, which Foundry will not publish by default and will not
invent. Recorded at `/foundry/public-workshop`.

Neither is a blocker to the token, and neither is something the readiness chain
can retire on its own. Everything else that Allow needs, Allow supplies.

---

## PENDING 17 — Sign the charter (the postal half is settled): **OWNER** (2026-09-18, postal settled 2026-09-19)

Two things only you can supply, and Foundry will invent neither. The charter
has its own place, `/foundry/charter`, one tap from Home's Autonomy tile and
from the More sheet, and Home asks for it as its one thing once a test is
ready; the postal line is on `/foundry/public-workshop`. Nothing else is asked.

**One: the charter.** Migration 319 and the constitution's amended "Ask me
first" section give the institution standing authority to act inside an
envelope you sign once. Amended 18 September by migration 324: what you set is
a **total for the whole charter**, not a monthly figure. Four numbers — the
term in days, the money for tests across all of it, the thinking a day, and how
many tests may run at once — plus the sealed contact rules, withdrawable at any
moment with a reason.

The calendar no longer moves the ceiling. A carve may never take the charter's
total past what you signed, whatever month it falls in, so the most it can ever
cost you is that total plus the day's thinking across the term, and the page
shows exactly that figure before you sign: for a thirty-day charter at $100 for
tests and $3 a day of thinking, **$190**. Until you sign, everything
built this month runs up to the seal and stops there: the eyes look, seeds are
promoted, the forge writes and attacks designs, and each design it would have
sealed is left unsealed on its experiment's page with every reason, "no
charter" among them, costing you nothing until you look — the old world, one
experiment at a time, decided by hand. After you sign, a probe inside the envelope is sealed, made, placed on
the Workshop's page and settled with no tap from you; a probe outside it still
queues; legal and destructive acts still queue; "Stop everything" still halts
all. The numbers are yours to choose and nothing picks them for you; the form
leads with a thirty-day proving window rather than the longest term the row
admits, and the plan you approved named about $100 and three tests at once.

Before you sign, Foundry is not idle: it looks, reads, questions, buries,
promotes what two independent ways of knowing support, designs a probe through
five disciplines and attacks its own draft. It stops at sealing, and its own
thinking is bounded at $1 a day until you set a figure.

**Two: the postal address. SETTLED 19 September — nothing is waiting on you.**
The Workshop is the only public voice, by gate, but the postal address you typed
at stand-up began with your name, and it was going out in the footer of all
fifteen published pages and every commercial email. You asked for it corrected
and chose to drop the name line rather than replace it.

What was done: the public reading of the address has a leading line equal to
your name removed, at the projection, so no renderer downstream can put it back.
Nothing stands in its place — every one of those surfaces already says "Apex
Micro is a small digital workshop" in the line above. The street address is
untouched and still on every page, because commercial mail must carry one. Your
stored address is exactly as you typed it and your own Workshop page still shows
it whole: Foundry did not rewrite what you gave it, it declined to put your name
on pages that are not yours to be named on. A fourth clause in the gate keeps it
from returning.

Two surfaces still name you, deliberately: the terms page and the Etsy privacy
policy — the disclosures the law asks for. Experiment 001's page also says "I'm
Thomas Norton, and Apex Micro is my workshop" in its sealed offer text. That is
a record rather than a surface and it is not rewritten; if you would rather it
did not, say so and it becomes a decision about amending a sealed record.

**What happens if neither is done:** nothing breaks, nothing is spent beyond
today's ceilings, and the River of Nickels does not start flowing. Each
design the forge finishes waits, unsealed, on its experiment's page.

---

## PENDING 18 — Does "send me more of this kind of thing" reach past the page it was said on? **OWNER**

Every experiment page carries a form, and one of its answers is "send me more
of this kind of thing" (`continuation_kinds.more_like_this`, permits more).
The constitution's rule that consent has scope is applied literally in
`suppression.ts`: an answer given about one experiment is not permission for
the next, so a continuation that permits more lifts nothing, and only a
refusal binds. Nothing in the institution therefore ever acts on that answer:
the people who asked for more are the one consented audience the Workshop
has, and they hear nothing.

The smallest decision: **may the Workshop write once to a person who answered
"more of this kind" or "would pay regularly", when the next thing of that kind
is placed on its page?** Under the sealed contact rules that is still one
message, with a postal address and a way to stop, and a "never" still binds
forever. If yes, Foundry adds that audience to the venue hand's one delivery
act and proves it on rows; if no, the answer stays a record and the form's
wording is changed so it does not promise what the Workshop will not do. If
neither, the form keeps promising and the record keeps silent, which is the
one state that should not last.

## PENDING 19 — Your name on Experiment 001's public page, against your own rule: **OWNER** (2026-09-21)

Two of your rules conflict and only you can settle it. The standing
constraint says your name appears on the public site only on the terms page
and in the Etsy privacy policy. Experiment 001's sealed public copy — the
page at apexmicro.ai/experiments/ma-millwork-bid-brief — carries "I'm Thomas
Norton, and Apex Micro is my workshop" under "Who I am", and it is indexable
and in the sitemap. The institution's other rule is that a sealed record is
not rewritten. A compliance reader found it on 21 September; until then the
owner surface told you your name was on no public surface, which was false
and now says exactly where it is.

Your options: (1) leave the sealed page as it is and amend the rule to say
"the terms page, the Etsy policy, and Experiment 001's sealed record"; (2)
ask for the public copy to be amended, which the institution treats as an
owner act on a record (it is recorded as an amendment with your reason, not
silently rewritten); (3) take the page down, which the public site's own
promise ("every page stays up, whatever happened to it") argues against.
Neighbours of the same decision: the contact mailbox thomas@apexmicro.ai puts
your first name on /contact and on every From line; and the public site
discloses that software does "the research and the day-to-day running" but
not that its prose is written by software. Nothing here changes until you
say.

## PENDING 20 — Whether Foundry may test a free resource, or something licensed in: **OWNER** (2026-09-21)

The economic forms now include *a free resource that supports a paid
product* and *something licensed in and resold* (`ECONOMICS.md` §
Mechanisms with sources). Each names the exchange it would need —
`free_with_role` and `license` — and neither is available today: the
exchange vocabulary is constitutional and only `upfront_price` can be run.
A candidate of either form is shelved and the shelf says the hands cannot
test it yet. Widening the exchanges Foundry may run is a change to what it
may do with strangers and with your money, and it is yours: say which, and
under what limit, and the migration that makes it available is written with
your words as its reason.

## PENDING 21 — Whether Experiment 001's null stands, or is void and re-run: **OWNER** (2026-09-21)

Twenty-one businesses were written to in the Workshop's name, each message
inviting a reply. The Workshop's reply path was not routed. Seven days later
the sealed rule settled the test **surprised** — nobody bought — and the
institution recorded that as evidence about a market.

The institution has taken the narrow position on its own: **the verdict
stands**, because the rule counted exactly what it said it would and a sealed
result is not rewritten to suit a later discovery; and **what the result is
claimed to establish is corrected**, because that claim is the institution's
own. Every surface that shows the outcome now shows, beside it, that the reply
path was not working on every day of the window, and that a silence on a
channel that may not have carried a reply is not the same evidence as a
silence on one that did.

A design reviewer reading the product took the wider position: *a test run on
a broken instrument is void, not surprising; recording it as evidence misleads
the owner about what he now knows.* That is a judgment about your own record,
and it is yours.

Your options: (1) leave it as it stands — the verdict recorded, the caveat
beside it everywhere; (2) mark Experiment 001 **void for its instrument** and
re-run the same question once the reply path is working, which the precedent
reader would otherwise refuse as a question already asked; (3) treat the null
as sound, on the grounds that a purchase needed no reply — the payment link
carried the answer the rule actually counted, and the dead reply path cost
only the replies, not the sales.

### The factual account, for each of the three

Not advice. What each option would and would not establish, what it costs, and
what it requires — so the judgment is made against facts rather than against a
feeling about a defect.

**What is not in dispute, under any of them.** Twenty-one businesses were
written to; nineteen were delivered and two bounced; nobody paid; the sealed
rule counted confirmed deliveries and payments and settled on the day it said
it would. Those rows are immutable and none of the options touches them. The
receipts, the timestamps, the sealed prediction and the settlement stay
exactly as they are, and remain readable on the test's own page whichever way
you decide.

**(1) Leave it as it stands — the verdict recorded, the limit beside it.**

- Establishes: nobody bought, in that window, on that channel, from those
  twenty-one. Nothing about whether anybody would have.
- Costs: nothing, and the precedent reader keeps treating the question as
  asked, so a second run of the same question would be refused as a duplicate
  until you overrode it.
- Requires: nothing.
- Risk: the weakest form of the wrong lesson — "cold email to millwork shops
  does not work" is not what this measured, and the caveat is a sentence a
  tired owner can skim past.

**(2) Void for its instrument, and re-run when the path is working.**

- Establishes: nothing yet. It reopens the market question, which is the
  honest state of a question that was asked into a void.
- Costs: the second run's money and days, and it re-spends the attention of
  people who were already written to once — unless the re-run addresses a
  fresh cohort, which changes the population and therefore the comparison.
- Requires: the reply path working first (it is, now, and the institution
  refuses to write through it otherwise); your instruction to mark it void.
  The institution will not mark it void by itself: the second door into
  invalidity (`invalidateByObservation`) reads the day-by-day channel record,
  and Experiment 001 has no such record because migration 327 did not exist
  while it ran. It refuses to invalidate on an absence of evidence, which is
  the rule you would want it to follow.
- What it does not do: erase anything. An invalid test keeps its page, its
  receipts and its prediction; it stops being read as an answer.

**(3) Sound — the null stands on its own terms.**

- The argument: the rule counted payments, and a payment needed no reply. The
  payment link carried the answer the rule actually asked for; the dead reply
  path cost the replies, not the sales.
- Establishes: as (1), and additionally lets the result stand as a precedent
  the forge may bind the next design against.
- Costs: nothing now. The exposure is that the strongest signal a cold
  approach produces at this size is usually a reply, not a sale, so a design
  that treats "no sales" as the whole answer may be tuned against the wrong
  variable.
- Requires: nothing — this is the position the institution already takes
  operationally, minus the caveat.

**Where each fact lives, so a later reading can find both.** The original
outcome is on `venture_experiments` (verdict, ran_at, the sealed rule) and on
the test's public page, unchanged. The correction is computed, never stored
over it: `venture/the-instrument.ts` reads the offers, the channel record and
the Workshop's receipts and says what the result does not establish, wherever
the outcome is shown. Reading one has never required believing the other.

**And what can now be said about the window that could not be said before.**
The day-by-day channel record begins at migration 327, after Experiment 001
closed, so its days are unrecorded and are reported as unrecorded — an absence
of record is not a record of health. But the route that carries a reply is made
through the governed door, and the door keeps a receipt with a date. Where that
receipt is dated after a test's window closed, the institution now says so as a
fact: *that path was not made until <date>, after this test had already closed,
so nothing it invited could have arrived.* For Experiment 001 that receipt is
the one written when the Workshop was given ears — read it on
`/foundry/public-workshop` under the mutation receipts, and it will name the
day the reply route first existed.

Nothing here changes until you say. The reply path itself is fixable from
`/foundry/public-workshop`, and the institution now keeps a day-by-day record
of it, so a second run would know what its instrument was doing.


## PENDING 22 — Whether the public record of a settled test carries its limit: **OWNER** (2026-09-21)

An adversarial review of the observation-integrity work found one surface the
correction does not reach, and it is the one strangers read.

`what-happened.ts` now derives what a result does not establish in the same
place it derives the result's word, so no owner-facing surface can print a
verdict without its limit. The **public** page does not go through it. At
`apexmicro.ai/experiments/<slug>`, a closed test's status line is computed
from the row alone and says, in your name:

> Closed — the pilot ran and the thesis did not hold.

Nineteen of the people who read that line are the people who were written to.
The institution's own position on this result is that the reply path they were
invited to use was not routed, and that a silence on a channel that may not
have carried a reply is not the same evidence as a silence on one that did.
The page says none of that.

**Why this was not simply fixed.** The Workshop is your only public voice and
its copy is yours. Adding a sentence to a published page is publishing, in
your name, to people you already wrote to once. The institution will not do
that on its own authority, and the standing rule that Experiment 001's sealed
text is never disturbed is the reason the rule exists.

**What is actually being asked.** Three options, none of them touching the
sealed body copy:

1. **Leave it.** The public line stays a plain statement of the outcome. Its
   cost: the strongest claim the institution makes in public about this result
   is the one claim it has since qualified everywhere else.
2. **Qualify the status line** for any test whose instrument raised a doubt —
   one computed sentence, the same one the owner reads, appended where the
   verdict is printed. Nothing sealed changes; the public page stops asserting
   more than the record supports.
3. **Say nothing publicly and withdraw the line**, leaving only "Closed" with
   the date. Least said, and also the least useful to a reader who is deciding
   whether to trust the next thing you publish.

This is adjacent to PENDING 21: if the result is treated as void, the public
line is wrong rather than merely unqualified, and option 1 stops being
available.

---

## PENDING 23 — The repository that holds all of this is public: **OWNER** (2026-09-21)

An independent review asserted it, and I checked rather than repeating it. The
GitHub API reports `"private": false, "visibility": "public"` for the
repository this institution is built in. Anyone who finds it can read every
line of it.

**What is not true, and I checked that too.** No secret is committed. The only
tracked files whose names mention credentials are `.env.example`, migrations and
source modules; `.env`, `.env.local` and `.env.production` are all gitignored.
I make **no claim about the repository's history** — I did not walk it, and a
statement that nothing was ever committed and removed is not one I am in a
position to make.

**What being public actually exposes.** Not keys. It exposes the institution's
reasoning: every gate and exactly how it is enforced, the shape of the charter
and what it refuses, the contents of Experiment 001 including which businesses
were written to and the exact words used, the economic projections and their
assumptions, and this file — which is a running record of decisions you have
not yet made. Somebody deciding whether to buy from the Workshop could read the
argument the Workshop had with itself about whether to sell to them.

**Two things it is worth being precise about.**

1. **Changing the setting does not undo disclosure.** Anything already cloned,
   forked, cached by a search engine or read by a model stays read. Making the
   repository private from here stops future reading; it does not retract past
   reading, and nobody can tell you how much of either has happened.
2. **The reasoning being public is not obviously a cost.** A workshop whose
   public voice is "I try small things and tell you how they went" is a
   workshop whose open record is an asset, not a leak. The argument for closing
   it is about the outreach records and about this file, not about the code.

**What I will not do.** I will not change the visibility. It is not a technical
decision and the review directive is explicit that it is not mine to take. If
you want it private, that is one setting in GitHub and I can tell you exactly
what breaks (nothing — the deploy uses a token that works either way).

---

## PENDING 24 — Production signs people in with a development-instance key: **OWNER** (2026-09-21)

The live sign-in page at `foundry-intel.fly.dev` serves a Clerk **publishable**
key beginning `pk_test_`. That is a development instance running in production.

**What this is not.** It is not an authentication bypass, and I want to be
exact because a `test` prefix invites the inference: `/foundry` on the live
deployment returns **401** to an unauthenticated request. The door is shut. A
publishable key is also not a secret — it is meant to be in the page.

**What it actually costs.** Clerk's development instances are built for
development: they carry lower rate limits, shorter session lifetimes, a
development-mode banner in some flows, and — the one that matters — Clerk does
not guarantee their durability the way it does a production instance's. A
development instance can be reset. If it were, you would be locked out of your
own institution until a new one was provisioned, and the machine would keep
running unattended with obligations on it and nobody able to open the door.

**Why this is yours and not mine.** Provisioning a production Clerk instance
means an account action on a third-party service, a new secret key in Fly's
secrets, and a domain configuration. Each of those is an external dependency,
and none is something I may do on my own authority. The code change on this
side is nil: the keys are read from the environment already.

**What I would do if you asked.** Nothing until you have created the production
instance and set `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` in Fly. After
that it is a deploy and a read-back.

---

## RESOLVED — `apexmicro.ai/foundry` returns 404, and that is correct (2026-09-21)

Recorded because an independent review reported it as a defect, and it is worth
having the answer written down rather than re-derived by the next reviewer.

The public Workshop serves exactly nine paths and `/foundry` is not one of them.
`the-workshop-has-one-public-face` asserts the 404 directly. The owner's
surface lives on the private deployment, behind authentication, and the
standing rule is that the Workshop is the only public voice — so a Foundry
entry point on the public domain would be the rule being broken, not a missing
feature.

The owner's entry point is `foundry-intel.fly.dev/foundry`, which returns 401
until Clerk has signed you in. Nothing to fix.


---

## §22 RESOLVED — A narrow, dated public clarification, and what it does not authorise (2026-09-21)

Recorded here because an adversarial review found the one record that was
missing: the repository contained the mechanism, the wording and the proofs, and
nowhere the **permission**. An institution whose thesis is that the record is the
truth cannot have the authorisation for a public act live only in a conversation.

PENDING 22 asked whether the public record of a settled test carries its limit,
and offered three options about the status line: leave it, qualify it, or
withdraw it. The owner answered with a fourth, narrower thing:

> *"I authorize a narrow, clearly dated public clarification of Experiment 001's
> findings. Preserve the original sealed prediction, settlement, receipts, and
> historical record exactly as they are. Do not rewrite the original experiment
> or present it as successful... Keep the clarification factual, concise, and
> clearly identified as a later finding. Do not use this authorization to change
> the experiment's offer, restart outreach, contact previous recipients, or
> publish additional personal information about me. Verify the exact public
> wording and its relationship to the sealed historical record before
> publication."*

**What was built to that.** An additive column beside the sealed copy, never an
edit to it; a dated footnote rendered beneath "Who I am", which is what makes its
last sentence — "The text above is unchanged" — a true description of the page.
Migration 334 makes that sentence a rule rather than a claim: once a footnote is
published the record beneath it is frozen against every statement, the row cannot
be deleted, a clarification cannot arrive on a new row, and a date cannot move on
its own. The status line was **not** touched, so option 2 remains open to the
owner separately.

**One word was changed after review, and the reason is worth keeping.** The
footnote said "the recorded result stands" and now says "the recorded result is
unchanged". "Unchanged" is a statement about the record. "Stands" would have been
a statement about the result's validity — which is PENDING 21, which is open, and
which is his. Publishing it would have settled his question in public, on his own
page, inside a footnote authorised for something else.

**What it does not authorise, restated because the authorisation says so.** No
change to the offer. No outreach. No contact with the nineteen. Nothing further
published about the owner. And nothing about the repair: the reply route has been
proven since, and a stranger reading a public record needs to know what that
record can support, not the institution's account of its own recovery.

**Relationship to PENDING 21.** The footnote is publishable while PENDING 21 is
open because it asserts nothing about whether the null stands. If the owner later
decides the result is void, that is a second dated footnote — which the mechanism
allows, with new words and a new date together, and which no rule here prevents.


---

## §25 RESOLVED — Apex Micro is the portfolio home, not the storefront (2026-09-21)

The owner clarified the relationship between the three layers, and two of the
consequences were his to decide rather than mine to infer. Both were asked and
both were answered before anything was built.

**The shape of the clarification.** Private Foundry carries the intelligence and
the operating work and stays private. Apex Micro is the public business identity
and the portfolio home — credible enough that somebody can tell who is
responsible for an offer — and is **not** required to be the purchasing or
delivery platform for anything. Each asset reaches customers through whatever
channel suits its actual economic mechanism, with Apex Micro named as the
responsible business. The presentation patterns — business identity alone, a
portfolio entry, a product page, its own presence — are **possible shapes chosen
for a reason, not stages and not a score.**

### The first decision: Experiment 002's boundary

When the Etsy listing was approved, `approveListing` set a standing boundary at
mode `never` on the subject `publish`: *"Foundry publishes nothing for this test;
the listing is my own act on the venue."* That is an owner boundary, and the
institution's own rule is that an owner's `never` is never reasoned around — so
rather than reading the clarification as implicitly lifting it, it was put back
to him.

**Answered: narrow it.** Foundry may publish a portfolio entry for the Etsy
asset — what the workbook is, who it is for, that Apex Micro is responsible, and
a link to the listing. It still publishes **no offer, no price and no checkout**;
that half of the boundary stands and is what the original sentence was for.

### The second decision: the legal copy

`/privacy` and `/refunds` assert, as universal facts, that *"Stripe handles the
payment and passes me your email address"* and that *"Stripe refunds it in
full"*. Both are true today, because everything sold so far went through a Stripe
link. Both become false the moment a venue-sold asset is represented on the site,
and a false statement about who takes the money and who returns it is exactly the
kind of thing the clarification says must not happen.

**Answered: scope them per channel.** The existing pages keep their promises and
say plainly that they cover what is bought directly through Apex Micro. A
venue-sold entry carries its own short customer-information block, naming the
venue's policy alongside the operator's own contact and remedy. Additive; the
live pages keep their meaning for what they actually cover.

### What still needs your hand, once

`approveListing` writes the narrowed wording for any listing approved from here
on. Experiment 002's boundary row already exists in production at mode `never`,
and a boundary the owner set is not something code rewrites behind him — so the
live row stays as it is until you narrow it through the door, in your own words.
Until then the reader answers `not_public` for that asset and the entry does not
go up, which is the correct behaviour for a boundary that has not actually been
changed yet.

**A correction, because the first version of this section promised you
something the code could not do.** It said the narrowed mode was `ask_first`
and that "the entry is proposed to you and waits, every time". Two review cells
took that apart. `publish` is the one boundary subject with no door behind it,
so nothing enforced it; the attempt to enforce it in the publishing pass then
made things worse in four ways at once, and the sentence stayed false
throughout, because nothing anywhere proposes a publishing act for a listing.
There was no question to answer and no way to answer it.

What is true now, and enforced:

- **`never` is decisive and it takes the page down.** Not just "stops
  republishing" — a page already in the store is replaced with a short notice
  that says it is no longer offered, keeps Apex Micro named, keeps a person
  reachable and repeats the refund promise. The one exception is a page
  carrying a sealed record or a dated clarification: replacing that would
  destroy the account the seal exists to keep, so it stays up and the conflict
  between your two words is put to you rather than settled by a routine.
- **`ask_first` on `publish` is not a rule about pages, and the code no longer
  pretends it is.** In this codebase that subject means *placing an offer*
  — `approveExperiment` writes exactly that sentence — and it is enforced where
  offers are placed. Reading it as a page rule meant a Stripe catalog
  approval, whose whole disclosure to you is "a product, a price and a payment
  link exist; no money moves", being taken as your consent to publish a web
  page in your name. That is authority inferred from an adjacent capability,
  which this institution does not do.
- **The offer half of your word is enforced structurally, not by the boundary
  row.** A portfolio entry cannot carry a price or a checkout because the
  projection nulls both before the page is rendered, and the gate re-reads the
  rendered bytes for a currency figure or a Stripe address. That holds whatever
  any boundary row says.

So once you narrow the live row, the entry goes up. It does not ask again each
time, and this section no longer claims it will.

### What neither decision authorises

No public-site redesign, no commerce platform, no parallel publication system. No
change to Experiment 001's sealed record or its dated clarification. No offer,
price or checkout published for the Etsy asset. And no entry for anything that
never reached a prospective customer — internal research stays internal.

---

## PENDING 25 — Register an Etsy app and connect the shop, at read scope: **OWNER** (2026-09-22)

Everything that can be built without your account is built and proven. This is
the one piece that cannot be, and it is deliberately the last thing asked
rather than the first.

### What you would do

*Revised twice on 22 September 2026. The original draft asked for a deployment
secret set with `flyctl`; you asked instead to place it from inside Foundry.
Then you placed the redirect at Etsy, looked for where to put the pair, and
said: "the setting page it's kinda too complicated in foundry. Have no idea how
to do that." That was a fair report of a real defect, and the sequence below is
the repaired one — it is now three steps rather than four, and two of them are
already done.*

1. ~~**Register an Etsy app** at `developer.etsy.com`~~ — **done.**
   `private-foundry`, approved, 10 QPS / 10K QPD. Etsy issued a **keystring and
   a shared secret**, and **both are needed**: every v3 request carries them
   joined by a colon in the `x-api-key` header. That is not optional
   configuration — an earlier draft of the adapter sent the keystring alone and
   every call would have been refused.
2. ~~**Register the redirect**~~ — **done**, 22 September:
   `https://foundry-intel.fly.dev/foundry/senses/callback`. This was the one
   step nothing here could do for you, because it is a change to your Etsy app.

   One caveat worth knowing rather than discovering: that address is built from
   the host your request actually arrives on, never from configuration — which
   is deliberate, because a redirect target taken from a parameter is how an
   attacker sends the code somewhere else. The practical consequence is that
   you must be on `foundry-intel.fly.dev` when you tap connect. From any other
   host Etsy is handed a redirect it was never given, and refuses.
3. **Go to the Apex Micro company page and tap the sentence about what Foundry
   cannot see.** Everything left happens on that one page, in order:

   - It asks for the **keystring** and the **shared secret**, in two boxes,
     right there. The keystring box is readable so you can see a long paste
     arrived whole; it is an identifier that travels in the open as `client_id`
     on the consent screen you are about to look at, so hiding it protects
     nothing. The shared secret is the half that authenticates, and it stays
     hidden.
   - Foundry asks Etsy whether the pair works **before keeping it** —
     `openapi-ping`, which takes no OAuth token, costs nothing and causes
     nothing. A mistyped pair is refused on that same page while you still have
     it in front of you, rather than three screens later at Etsy's consent
     screen. It is stored encrypted and never shown again.
   - The page then comes back to itself with the connect button where the form
     was. **Tap connect, once.** Etsy shows you its own consent screen naming
     the three scopes. Foundry shows you the same three first, each with the
     reason it is asked for, assembled from the rows rather than written into a
     template.

   *The settings page still holds the same key, for replacing or forgetting it
   later. It is no longer the place you have to find in order to start.*

### What it permits

`shops_r`, `listings_r`, `transactions_r`. Reading which shop the credential
opens, what is listed in it, and the paid receipts — order number, date, amount,
and the fee Etsy kept on each. That is the entire request; the scope table is
constitutional and nothing in the code can widen it.

### What it cannot do, structurally rather than by promise

Create, publish, modify or withdraw a listing. Upload a file. Spend a cent.
Contact a buyer. Not because this document says so, but because:

- `listings_w` appears in no adapter, no scope row and no request;
- `sense_provider_scopes` is closed by constitutional triggers, so no runtime
  path can add a scope;
- `draft_on_marketplace`, `upload_product_file` and `list_on_marketplace` carry
  `tool = NULL` in the capability registry, which in this schema means they
  have no door to arrive at — `consequenceAllows` refuses a tool bound to
  nothing;
- no Etsy write tool is registered on the outbound gateway, and a test asserts
  it.

### What it would change, honestly

**One condition on the tap, and a second after the first read.** An earlier
draft of this entry said "two of five", and a review found both halves
overstated.

- **`the shop it would act on is confirmed`** becomes met the moment the
  credential exists — the shop's id and name read back from the account rather
  than remembered. You renamed this shop once already, which is exactly the
  event a remembered name gets wrong. This is the only one the tap itself
  changes.
- **`what the venue reports can be read`** becomes `unproven` on connecting,
  not met. It becomes met after the hourly pass has actually read the shop once
  — because the condition counts readings taken from Etsy, and connecting is
  not a reading.

Unchanged, because they need a publication and a fee: `Etsy can be operated`,
`the listing is live and its address is recorded`, and `a refund can be carried
out`.

And "five" was the listing-specific block only. Experiment 002 also carries the
conditions every mechanism owes — something to deliver, the offer written, the
prediction sealed, your approval, a bounded amount to spend, what it must not
do. Connecting leaves most of the list where it was; it moves the two that are
about whether this institution can see the venue at all.

### What it will never buy, however it is connected

Etsy exposes no shop-statistics endpoint to anybody. No daily views, visits,
favourites, impressions, search queries or traffic sources — withdrawn
deliberately, after the data was used to infer Etsy's own financials ahead of
its announcements. Those stay yours to enter by hand, permanently, and are
recorded as an operating limitation rather than a gap someone will close later.

Nor can anything here see Etsy Messages, which is where a buyer asks for a
refund. That remains you relaying it, and the record says `owner_entered` when
you do.

### How you undo it

Disconnect on the company page forgets it here. Etsy publishes no revocation
endpoint this deployment could call, so **removing the app in your Etsy account
settings is the act that actually kills it** — the institution says that
plainly rather than reporting a revocation it could not confirm.

### One operating limitation worth knowing before you agree

Etsy's refresh token lasts **90 days**. Without a successful refresh inside that
window the grant dies and you would have to consent again. A liveness probe
exists so a grant that dies quietly is noticed rather than discovered at the
worst moment; it is named here because it is a commitment, not a detail.

### Two things that were wrong, found before you acted

Reading Etsy's published contract to write this entry found two defects in the
adapter that would have made the first connection fail. Both are fixed, and
they are recorded here because the adapter's own header promised that "the day
the owner connects a shop should be a day nothing new is discovered about how
the system should work" — this is that promise being kept, not broken.

- **`x-api-key` needed both halves**, joined by a colon. It sent the keystring
  alone. Every request would have been refused, and the failure would have
  looked like a bad key rather than a bad header.
- **The token exchange had to be form-encoded.** It posted JSON.

And one thing it had right: no `client_secret` in the exchange. PKCE stands in
for one, which is why Etsy requires PKCE on every authorization.

### The likeliest way this fails, named in advance

If Etsy's token response does not state which scopes it granted, the connection
is **refused outright** and nothing is stored. That is deliberate: the adapter
used to fill in the three scopes it asked for when the provider said nothing,
which made the "what was granted is not what was asked" guard pass by
construction and recorded a permission Etsy never confirmed. Silence is now an
empty grant, and an empty grant fails closed.

Whether Etsy states the scope on that response is not known here — no request
in this codebase has ever had a reply from Etsy. If your tap ends with "Etsy
granted less than I need", that is this, and it is the guard working rather
than something broken. Tell me and I will read what Etsy actually returned.

### Not asked, and deliberately

No write scope. No draft listing. No fee. No publication. When those are worth
asking for, they will be separate questions with their own consequences, which
is the entire reason the four acts are four rows rather than one.


---

## RESOLVED 11 — The Etsy application key was shared in chat, and he chose not to rotate it (2026-09-22)

He pasted the `private-foundry` keystring and shared secret into a Foundry chat
session, saying: *"I'm not worried about it being in this chat and will take
precautions. Nobody else will have access to private foundry or my Etsy
account."*

**What was put to him.** That the pair now sits in a session transcript stored
on disk outside both his control and Foundry's, that this repository is public
(PENDING 23), and that Etsy allows a keystring to be regenerated from the same
Seller Apps page at no cost. Rotation was recommended.

**What he decided.** Use this pair, with no rotation planned.

**Why this is written down rather than left as a footnote.** An accepted risk
that is recorded is a decision; the same risk unrecorded is indistinguishable
from an oversight six months later, and the person reading the incident would
have no way to tell which it was. The decision is his to make — it is his
account, his key, and his assessment of who can reach that transcript.

**What follows from it.**

- The key is never written to this repository, a log, an error message, a
  retrieval row or an observation. `setAppCredential` takes it, verifies it,
  encrypts it, and the plaintext does not outlive the request.
- What it can do if it ever leaks is bounded by what it is: an application key
  identifies the application. It grants access to no shop. Reading his shop
  needs the OAuth grant as well, which is a separate secret, separately
  encrypted, and revocable by removing the app in his Etsy settings.
- **The trigger for revisiting this**: any change in who can reach that
  transcript, or any sign of Etsy API use this institution did not make. The
  application id Etsy returned is recorded against the key, so a key swapped
  for a different application is a fact the institution notices.

### Later the same day: the first of those bullets was false when it was written

*Added 22 September 2026, after checking rather than assuming.*

"The key is never written to this repository" was written into this record in
commit `31661438`. The keystring was in that same commit, in a test fixture,
followed by a call replacing every character with an `x`. At runtime it was
twenty-four x's, which was all the test needed. In the file, and in every clone
of the history, it was the real value.

**Masking a value you have already written down is not redaction.** It is worse
than not trying, because it looks handled and so stops anyone looking again. It
is the same failure as the four false claims two review cells found in this
wave: a sentence asserting a property nothing checked.

**And the premise underneath was wrong too.** He said, correcting a claim made
to him: *"Well the repo is private not public."* It is not. An unauthenticated
request to `api.github.com/repos/Thmsnrtn/foundry` — no token, nothing from any
session — returns `200` with `"private": false`. Both parties were operating on
a belief neither had checked, in opposite directions, and only one of those
errors put a real value in a world-readable place.

**Scope, established rather than assumed.**

- The **shared secret was never committed**: zero occurrences in the working
  tree and zero across all history. That half exists only in the chat
  transcript this record already describes.
- The **keystring appears in one commit, one line**, now a synthetic literal.
- It **cannot authenticate alone**. Etsy joins both halves in `x-api-key`, and
  an OAuth authorization additionally needs PKCE and a redirect URI registered
  to one host, which is his.

**What he decided, asked directly on 22 September:** leave the history as it
stands. The options put to him were making the repository private, rewriting
the commit and force-pushing, registering a replacement Etsy app, or accepting
it. He chose to accept it.

**On the repository's visibility**, asked at the same time: private *"only if
you are able to stay connected to it and continue working on it. If making it
private changes that then keep it public."* Established since: the GitHub
connection this institution's sessions use already lists two private
repositories under the same account with push rights, so visibility does not
gate access; nothing in the repository depends on being public — no Pages, no
raw-content fetches, no badge URLs, no git-URL dependencies, and a Fly deploy
that builds on the runner with a repo-scoped token. The one real cost is
Actions minutes, unlimited while public and capped at 2,000/month on the
GitHub Free plan, against a CI that fans five jobs out per push and a deploy
chain measured at 37 and 44 minutes. **That decision is open**, and it turns on
a plan tier only he can see.

**What now enforces the bullet that was false.** `check-no-masked-literals`, in
`lint:columns`, refuses a string literal with a whole-string masking call
applied to it, with planted-defect tests in both directions. A comment saying
"do not do this" did not stop it; the comment and the defect were written by
the same hand in the same hour.
