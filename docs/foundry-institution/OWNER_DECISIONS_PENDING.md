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

# ALL EIGHT DECISIONS ANSWERED

The owner answered every queued decision. Nothing is pending. Recorded here as
settled; the record of what was asked and why is in git history.

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
