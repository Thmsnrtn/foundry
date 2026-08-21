# Implementation State

**Current verified reality.** What exists, what is reachable, what is proven,
what is not, and the debt that matters. This is the document a steward reads to
know what is true today.

It is deliberately short. The record of *how* each thing came to be — every
completed slice, cutover, benchmark and deletion, and the Tranche-0 baseline
manifest — is `history/IMPLEMENTATION_SLICES.md`. What to do next is
`AUTONOMOUS_CAMPAIGN_STATE.md`. How development operates is
`DEVELOPMENT_INSTITUTION.md`.

**Replace claims here when they become false. Do not append beneath them.**

---

## Verified now

Measured at `0ee876e` on `claude/foundry-autonomous-continuation-0gents`.

| | |
|---|---|
| Stack | Node 20, TypeScript, Hono, libSQL/Turso, Vitest. Fly.io. |
| Migrations | **228 files**, highest number **192**. Applied lexically at startup, which equals numeric order because `check-migration-order.mjs` enforces fixed-width numbering; 31 numbers are duplicated from early parallel development and are baselined. Schema snapshot current and gated. |
| Validation | Full suite green: **339 files / 2,989 tests**. `npm run check` green — and `check` now actually runs every gate, including the thirteen it used to omit. **It also aborts intermittently** — roughly one run in three — with a native libsql panic that takes the whole run with it. See the live frontier: a green run is currently a claim about a process that survived. |
| CI | Runs on `master`, `main` and `claude/**`. It triggered on master alone until now, so **no gate in this repository had ever run in CI** for the branch all the work is on. |
| Ratchets | Unguarded mutating routes **114** · fabricated test schemas **4** · writer-less tables **0** · SELECT drift **0** · untraced consequential effects **0** · statically unreachable modules **26** · write-only columns **69** · tables written and never read **4** · **unscoped product-shaped routes 2** (new). |
| Composition root | `src/index.ts`. Static/public, signed webhooks, internal service-key, Clerk-authenticated founder, and API-key `/api/v1` route groups coexist. |
| Public API | **Live.** Scoped, expiring, revocable keys issued from settings. Every v1 route needs a scope a founder can grant; the bidirectional gate enforces both directions. |
| Consequential effects | Converge through `services/outbound/gateway.ts` — kill switch, classification, budget, idempotency, audit. Inventory in `CONSEQUENTIAL_EFFECTS.json`; untraced count ratcheted to zero. |
| AI spend | Central OpenRouter client. Atomic reserve → dispatch → settle across global/product/founder scopes. Refuses spend for a company that is not operating, naming which axis stopped it. |
| Erasure | One implementation. Every table classified with a written reason, on two axes: by product, and — since an adversarial review found the gap — by PERSON across companies they do not own. An end-to-end sweep seeds every table and matches by containment, so an id inside a composite key is visible; only survivors with stated retention dispositions are allowed. Deletes where the row is wholly the person's, severs where it is the company's record naming a person. **Five tables are deliberately untouched pending an owner decision** (`OWNER_DECISIONS_PENDING` §10) — company assets on NOT NULL columns — which is a live gap, not a footnote. |

## The institution's senses

- **Time.** A responsibility can carry a due date the COMPANY stated, with who
  stated it; triggers refuse a date with no author and refuse one authored by
  the owner of the product `system_identities` names as Foundry. `overdue` is
  the first reason a responsibility needs the founder, and the only one that is
  a fact about the company rather than about where Foundry has got to. Prose is
  never turned into a date. Reachable from The Letter's report form.
- **A passed deadline can falsify a judgment.** `contradicted` was recorded as
  proof debt because "contradiction needs an observer that can see a deadline
  pass". It has one now, and only that: a conflict still standing after a date
  the company gave. An absent deadline is not a met one.
- **Outcomes now reach the authority request.** `getAssistingCandidates`
  counted matched and deviated comparisons equally and ignored whether previous
  assisted actions had failed. Both are separated and surfaced to the founder
  at the moment they decide whether to grant more. It also counted comparisons
  the database would refuse as entry evidence, so a founder could be asked to
  grant a permission that could not then be used; the offer applies the entry
  guard's own condition now.
- **Foundry can say how it has done.** Two track records, both read back from
  learning it had been recording and never once consulting: how its changes to
  the founder's systems have held up, and how its judgments about the company
  have. Counts, never a rate. Staleness is asymmetric in both — read-time
  expiry retires a positive claim and never a negative one, so Foundry cannot
  improve its own record by waiting.
- **The owner sees what a judgment was computed from.** The scarcity itself
  ("you have 2 work blocks; these need 3"), what each side loses, what else was
  weighed, and whether Foundry can order the alternatives on money — reported
  as itself in all four states, including "I cannot tell you".
- Everything else a company can tell Foundry arrives through the four ingest
  routes, twelve integration adapters, two webhooks, and the founder typing
  into The Letter.

## Reachability caveats that still hold

**THE UNREACHABLE-MODULES BASELINE IS PER MODULE, AND CANNOT TELL YOU WHICH
FUNCTION.** `framework.ts` is not on it, and its `runAllDueSyncs` is imported by
nothing — but `runSync` in the same file is called by the supercharge route.
`integration/stripe.ts` is not on it either, and its `getStripeMRRSummary` has no
caller. Do not read "not on the unreachable list" as "all of this runs", and do
not read "on the list" as "none of this matters": both files held real defects,
one live and one latent.

- ~~The reachability gate scans `src/services/institution` only~~ — **CLOSED.**
  `check-reachability.mjs` walks all of `src/` from the real entry points as a
  ratchet (29 unreachable, may only fall), declares modules reached by a
  computed dynamic import with the mechanism that reaches them, and walks from
  those too.

- **Nothing has met reality.** No real founder, outside tool, or provider.
- Production reachability is proven against **synthetic** companies. A
  production-facing code path is not production evidence.
- `support-pilot-readiness-v1` green means **ready to attempt** a bounded
  pilot. No pilot has occurred.
- Recursive Foundry operation is local only. The owner performs the **report,
  not the grant** — Foundry may not mutate its own repository outside a test.

## Running it, and where things live

A fresh steward needs this before anything else, and it was missing.

```bash
npm install
npx tsc --noEmit                  # typecheck — seconds
npm run lint:columns              # the SQL/schema/authority gates — seconds
npx vitest run tests/unit/<file>  # one test file — seconds
npm run check                     # composite: typecheck + ratchets + full suite (~10 min)
bash scripts/schema-snapshot.sh   # regenerate docs/db/schema.snapshot.sql after a migration
```

Tests need **no external services**. They set `TURSO_DATABASE_URL=file::memory:`
and `ENCRYPTION_KEY` themselves and run migrations into a fresh in-memory
database. Clerk, OpenRouter, Resend and Stripe keys are only needed to run the
server, not the suite.

**Concept → code.** The vocabulary in these documents is load-bearing; this is
where it lives.

| Concept | Where |
|---|---|
| Composition root, route mounting | `src/index.ts` |
| Governed consequential effects | `src/services/outbound/gateway.ts`, inventory in `CONSEQUENTIAL_EFFECTS.json` |
| Kill switch | `src/services/outbound/kill-switch.ts` |
| Migrations, and the SQL splitter | `src/db/migrations/`, `src/db/migrate.ts` |
| Canonical predicates (`operatingProduct`, `visibleProductIds`) | `src/db/client.ts` |
| Authority: capabilities, membership | `src/middleware/rbac.ts`, `src/services/team/members.ts` |
| Principal discrimination | `principalOf` in `src/middleware/` |
| Entitlement / erasure / pause axes | `src/api/middleware/entitlement.ts` |
| Erasure, consent, retention dispositions | `src/services/privacy/consent.ts` |
| Responsibility ladder (Visible→Understood→Shadowing→Assisting) | `src/services/institution/`, `institutional_responsibilities` |
| AI spend reserve/settle | `src/services/ai/client.ts` |
| Scheduled jobs and the registry | `src/jobs/index.ts` |
| CI gates ("ratchets") | `scripts/check-*.mjs`, chained by `npm run lint:columns` |
| Gate baselines | `docs/db/*-baseline.txt` |
| Gate self-tests (planted defects) | `tests/unit/gates-fail-when-they-should.test.ts` |

**Evidence levels (E0–E6) are defined in `PROOF_PROGRAM.md`.** Every maturity
claim below uses them; read that file before trusting a level here.

## Environment facts worth not re-discovering

- **`sqlite3` IS available** (`/usr/bin/sqlite3`), so `bash scripts/schema-snapshot.sh`
  runs directly. Earlier records said otherwise.
- The branch is never merged to master — standing owner instruction.
- Vitest full runs take roughly ten minutes here. **Do not start a second one
  concurrently**: `gates-fail-when-they-should` plants fixture files in the
  working tree, and two runs collide into a false failure. This is written down
  because it has now cost time twice — the second time to somebody who had this
  document open and had not read this line.

## The ladder in production-facing code

```
outside tool → POST /ingest/:token → external observation ──────────┐
founder reports an obligation → discovery → Visible                 │
  → founder answers/volunteers what Foundry cannot observe → Understood
    → founder states a bounded expectation → Shadowing ─────────────┘
      → external reading → matched / deviated / unresolved
        → founder grants exact bounded authority → Assisting admission
          → customer message on the responsibility's channel
            → founder authors a reply → bounded plan → revalidation
              → governed send_email → receipt → outcome UNRESOLVED

provider adapter → POST /ingest/customer-message/:channelKey
  → canonical message evidence, attributed by channel binding
```

**The chain is complete and closed.** What remains unproven is autonomous reply
generation: the founder writes the reply, and that is now the deterministic
human baseline (§10) any model-generated proposal must beat on a frozen
contract.

All of it is **E2 — local runtime**. Nothing has been exercised by a real founder, a real outside system, or a real provider.

## The legitimate action envelope, term by term

`ARCHITECTURE.md` states that a consequential action is legitimate only inside
the intersection of seven terms. This is what each term is actually made of in
this repository today, and where it is not made of anything. **It is a report
on code, not an aspiration**; the two absent terms are named as absent.

| Term | What enforces it | Level |
|---|---|---|
| demonstrated capability | Assisting admission requires real shadow comparisons against founder-stated expectations — the SQL counts them, and migration 115 keeps Operating frozen (`assisting-admission.ts:111`) | structural |
| owner/company authority | the consent ledger, plus one company authorization model: `memberMay` / `requireCompanyCapability` / `requireOwner`, with the unguarded-route ratchet holding the line | structural |
| sufficient evidence | provenance-bearing claims and their freshness; a responsibility cannot be created with nothing to point at | structural |
| applicable external permission | **nothing** | absent — see below |
| Foundry constitutional permission | the closed effect-kind vocabulary (`CONSEQUENTIAL_EFFECTS.json`, gated by `audit-consequential-effects.mjs`) and the consequence boundary; RESOLVED 4 forbids runtime creation of effect kinds | structural |
| recorded constraints of affected parties | **one kind**, checked at the boundary — see below | E2 |
| proportionate safeguards and accountability | the governed boundary's receipts, effect certainty, and outcome reconciliation | structural, with a named defect |

**Recorded constraints of affected parties — now real, and narrow.** The
governed execution boundary can refuse on behalf of somebody who is not the
owner. `gateway.ts:167` consults `contactIsRefused` before classification and
returns phase `contact_refused`, so no caller has to remember it; the founder
records and reads the list on The Letter, gated on `can_manage_company` because
the list is append-only and writing to it silently stops the company writing to
whoever is on it.

State the limits plainly:

- **It is one constraint kind — do not contact — and nothing else.** This is
  not a rights engine. A second kind is a second recorded fact, not a policy
  language.
- **It is consulted only where `requireCustomerExternalId` is true**, which
  today is `send_email` and `send_account_notice`. That now covers both action
  regimes: `action_executions` had its own `send_email` arm and it has been
  routed into the gateway, so there is one place where a send is decided. `send_push`, `mcp_call` and
  outbound webhooks do not consult it, correctly: none of them is addressed to
  an identified outside person by address. A new capability that IS so
  addressed inherits the check by setting that flag, and gets no check if it
  does not — that is the coupling to watch.
- **It interacts with RESOLVED 7 and the interaction is deliberate.**
  `send_account_notice` requires a customer external id, so an address on the
  list stops receiving account mail — the one capability that otherwise
  survives an entitlement pause. Fail-closed was chosen over an exemption:
  an address is on that list because somebody said stop or because mail to it
  does not arrive, and unknown is not permission. If that is ever the wrong
  answer it is one condition at `gateway.ts:167`, and it should be an owner
  decision rather than a convenience.
- **It is a recorded fact, never an inferred one.** Nothing reads a customer's
  reply and concludes they meant stop.
- **Access is now answered from the same derivation as erasure, at both
  scopes.** The company export read only the tables carrying `product_id`,
  while the erasure had established that fifty-five others hold company data;
  both consume `companyDataSources()` now. And there was no PERSON-scoped
  export at all: `FOUNDER_SCOPED` and `PERSON_ACROSS_COMPANIES` existed only so
  an erasure could clear them. `exportFounderData` is derived from the same two
  maps. A table cannot be erasable and unaskable at once, at either scope.
  Credentials appear as present, never as their value, on both paths.
- **Notice, explanation, correction and redress: one of four exists.**
  `EXPERIENCE.md` states these as an obligation the architecture must be able to
  meet, and that is a design rule rather than a description. Today: a
  **correction** an affected person makes is exactly the contact constraint
  above. **Notice** could be carried — the governed boundary can reach a person
  and record that it did — but nothing composes one. **Explanation** and
  **redress** have no record type at all. That is the honest state, and it is
  deliberately not filled with a general appeals bureaucracy; a second kind is
  a recorded fact, added when a real obligation needs it.

**Applicable external permission — absent, and deliberately not simulated.**
Foundry does not evaluate law and nothing in this repository pretends to. Where
an action depends on a legal conclusion, the dependence is counsel debt in
`OWNER_DECISIONS_PENDING.md` — §9 retention periods, §11 the audit-log window,
§13 the benchmark aggregation threshold — and a remembered legal conclusion is
not a permission. **No legal-knowledge store exists and building one on a
model's recollection would be the exact failure this term names.**

**Accountability — the role-label defect is closed; the spelling is not
uniform.** `approved_by` used to be written as the literal `'ceo'` on both the
approve and the reject paths, so every decision by every founder of every
company recorded the same approver, and the surface rendered it. A role label
is not a responsible identity. Both writers now record the acting principal
(`agents-integrations.ts:568`, `executor.ts:270`) and the surface translates a
principal reference back into a sentence a person can read
(`agents-integrations.ts:293`).

The two action regimes are no longer two EXECUTION paths — `action_executions`
sends through the gateway — and no longer two vocabularies:
`services/outbound/acting-principal.ts` holds the closed set of principal kinds,
both approval doors refuse a value that names no kind, and one function turns a
reference into a sentence for both ledgers' surfaces. They remain two LEDGERS,
which is a schema question rather than a semantic one.
`outbound_actions.approved_by` takes `founder:<id>`, while
`action_executions.approved_by` takes `voice:<id>`, `system:playbook`,
`autopilot:<category>` — and, from the dashboard approval, a **bare** founder
id (`agents-actions.ts:258`). Both readers that interpret the field key on the
`autopilot:` prefix, so nothing misreads a founder as an autopilot today. It is
one vocabulary written two ways, which is the shape that eventually produces a
reader agreeing with only one of them.

**Do not turn this table into a policy engine.** Five of the seven terms are
already structural and are enforced by machinery that exists for its own
reasons. The value of the table is that it says which two were not, and it
stops being useful the moment it becomes a compliance surface with rows for
hypothetical futures.

## What Foundry can sense about a company

A company's customers are the sense with the sharpest consequence — the
departments that write to people read them — and it was the one with two
answers. `POST /api/v1/customers` (documented, scoped credentials) writes
`customer_intelligence`; the departments read `customers`, written only by a
session-authenticated route no client calls and by the demo seed. A company
that integrated the documented way was invisible to them.

One accessor now answers it — `services/institution/company-customers.ts` —
reading both stores, reporting which one each record came from, and stating the
at-risk and champion predicates once each. This is the **compare** stage of a
shadow → compare → cutover → delete, not the end of it:
`customerStoreSplit(productId).onlyLegacy` reaching zero is what says the
legacy read can be deleted. Four read-only readers still query `customers`
directly and are the remaining cutover work.

**What this does not claim.** Nothing here is E2-and-above evidence about a
REAL company: no real company has reported customers through that API. What is
proven is that the path now connects, and that the outcome verifier no longer
abstains on a customer it could not find — the latter mutation-tested, since
its failure mode was a silent pass rather than an error.

**Calls.** Transcript ingestion is live (RESOLVED 5), `/signals/multimodal` is
mounted, and its detail page renders the extracted summary, objections,
competitor mentions and commitments. That sense reaches a PERSON and must not
reach the institution by extraction: migration 126 forbids inferring an
obligation from free-form chat, which is what a model reading commitments out
of a call would be. If it is ever taken further, the founder reports the
obligation through the existing explicit intake and chooses the kind from the
closed set themselves.

A failed analysis is now a state of its own (migration 178) rather than being
indistinguishable from one that has not run. The reason is a closed vocabulary
enforced by CHECK, for the same reason migration 170 gave: a transcript is
customer speech and an error message may quote it.

## The operator boundary

Foundry's owner reaches two operator surfaces, both gated on `isFounder`:
`letter/operator-pack.ts` and `founder/intelligence.ts` (feeding `/founder-ops`
and `/api/founder-intelligence`). The stated rule is that the operator brain
sees aggregates only — the Level-1/Level-2 boundary — and it was enforced
structurally on the first and not the second.

**The distinction, now stated where it is enforced:** the operator administers
the COMPANIES and bills them, so a company may be named; a company's customers
belong to that company. Both surfaces are held to it by
`protective-wrapper.test.ts`, which reads the projection of every operator
select over `customers` and requires each column to be an aggregate or to come
from the joined `products` table.

This is separate from `OWNER_DECISIONS_PENDING` §12, which asks who holds the
ecosystem key. That one is about a surface outside the member model; this is
about Foundry's own operator view of its paying customers.

**AND WHAT THE OPERATOR MAY NOT DO.** Two routes on this surface resolved a
company's decisions — approve and reject — keyed on the decision id alone, with
`decided_by` set to `'founder'`. `isFounder` is FOUNDRY'S OWNER, so the operator
could close any company's decision and the ledger recorded it as the act of the
person whose company it was. `decisions.decided_by` admits `'founder'` or
`'second_self'` and nothing else, because the operator resolving a company's
decisions is not something this boundary describes: the operator administers the
COMPANIES and bills them. The routes were removed rather than given a new
vocabulary — adding an authority quietly is the one thing the constitutional
invariant names. If it is ever wanted it comes back whole, with a value that
says who acted and an owner decision behind it.

**What the operator surface now says when it does not know.** Every number on
`/founder-ops` was read against the query behind it, and most of them turned out
to be constants, fallbacks, or a different quantity than the label claimed. The
standing rule that came out of it, and which any future field on this surface
must follow: **an absent input is null and the page says why, never a digit.**
Concretely, and each with its reason in the type — Foundry's own expansion
revenue (no tier-change history exists), when a company churned (no archive path
records it, and the one that leaves a timestamp is erasure, which is not a
churn), Foundry's burn and therefore its runway (nothing records it), a
founder's activity gaps, and the 7-day override count (`decision_quality_scores`
has no writer — `recordDecisionContext` is exported and called from nowhere,
which is also why the override rates in `scp/founder/decision-tracker.ts` are
permanently zero; a test watches for a caller appearing).

Two rules worth carrying to any other surface. A rate over an empty denominator
is null, not a digit — `auto_execute_rate` fell back to 100 and
`avg_health_score` to 0, and which way a fallback flatters is an accident of
typing. And **a column default is not an observation**: `founder_health.
engagement_trend` carries `DEFAULT 'stable'`, so a row written for any other
reason looked like a judgment that a person was doing fine.

## Whose company is this

**The rule:** a route that takes a company's id must establish that the id
belongs to the caller, and answer 404 rather than 403 when it does not, so
nothing leaks about a company the caller may not see. `middleware/tenant.ts`
states it, including that choice, and is mounted NOWHERE — it sits on the
unreachable-modules baseline while every route re-implements it inline.

**Eight idioms are in use** for "is this company theirs": `getProductByOwner`,
`hasProductAccess`, `requireOwner`, `requireCompanyCapability`,
`verifyPortfolioOwnership`, `scopedTo` (the §12 portfolio principal),
`validateApiKey` (a key acts as its issuer, bounded by scopes), and a plain
WHERE on `products.owner_id` or the session's `ctx.product.id`.

**A rule with eight implementations has no floor, and one route had nothing.**
`GET /packet/:id` read any company's board packet by id — the executive summary,
metrics, wins, risks, asks, next-quarter goals — with the founder loaded and
unused, while three of its neighbours in the same file scoped correctly and one
of them carried a comment saying why. Fixed, and `check-tenant-scope.mjs` is the
floor: every handler whose path takes `:id` or `:productId` shows a recognised
idiom or is baselined with a reason written on the route. **Baseline 2**, both
earned — a published case study, and a Stripe webhook that has no founder
session because Stripe authenticates by signature.

**The body-and-query door was checked and holds.** Ten routes take a product id
from a body or query string; the two that are not session-scoped —
`/webhooks/voice-reply` and `/internal/conversion-signal` — are guarded by
`validateApiKey` and `scopedTo` respectively, both added deliberately by earlier
work. The remaining eight are founder-scoped writes where the product id is a
label on the row. **The gate does not cover that door**, and the reason it does
not is that there was nothing to catch, not that it was skipped.

## What a company's own surfaces may say about its money

The same reading was carried outward to the surfaces that speak to founders and
investors, and it holds there with higher stakes. Three standing rules came out
of it, and each is enforced rather than described.

**A metric that reaches a model says `unknown`, not a number.**
`ai/measured.ts` is the only place that decides, and a `0` passing through it
means a snapshot really recorded zero. Five agents wrote
`(Number(x) || 0) * 100` and put `Churn rate: 0.0%` into prompts for companies
that had reported nothing — under a system prompt reading "You do not hedge when
customer data is clear". Every threshold that a fabricated zero could cross is
now guarded on null: `if (activationRate < 30)` was firing a founder-facing
acquisition-quality warning at companies with no metrics.

**Not knowing is its own answer, kept apart from knowing and finding fault.**
`computeFundingReadiness` returns `unmeasured` beside `key_gaps` and
`measured_components` beside the score, because 62-of-seven-measured and
62-of-two read identically. It had been telling companies that had reported
nothing that their churn was above threshold and their activation below
benchmarks — findings about numbers that did not exist.

**A cash balance is stated by the person who has one, or runway is unknown.**
Migration 181 and `financial/position.ts`. **Do not add a default there**, and
do not let either runway path derive cash from anything else: both used to, by
two different formulas, and the results were rendered through a Monte Carlo with
a P10–P90 band and a survival probability. Nobody mistakes a constant for a
finding; everybody reads a confidence interval as one.

**And one gate.** `check-query-arity.mjs` counts placeholders against arguments
and INSERT columns against values. It exists because a statement written with
seven placeholders and six arguments had never once succeeded — valid SQL, real
columns, clean types, both callers swallowing the throw, the nightly log reading
"Generated scenarios for 0 products" and nobody finding out.

## What Foundry records about itself, and reads

The same reading turned around: a fact recorded and read by nobody. Three rules
came out of it, each enforced.

**One AI spend ledger, and it is `ai_daily_spend` at global scope.**
`cost_events` has a single fire-and-forget writer covering agent sessions only;
`ai/client.ts` reserves and settles every call into `ai_daily_spend`, which is
also what the daily ceiling is enforced against. Read it **scoped to
`'global'`** — migration 099's finish trigger writes the same amount to the
global, product and founder rows, so an unscoped `SUM` counts each call up to
three times.

**Quiet is not broken.** `integration_health.last_successful_sync` says when a
connection last WORKED; `last_event_at` says when data last ARRIVED. The status
message distinguishes them, because a webhook source that has gone quiet and one
that has died look identical otherwise. This is the same rule
`institution/loop-health.ts` states for the scheduler.

**Foundry's own forecasts are scored.** `forecast_checkpoints` are dated when
the prediction comes due — one, three and six months, base case only —
reconciled in the ingest path where a company's real MRR arrives, and the
median variance and its DIRECTION are shown to the founder above the forecasts
it judges. The institution asks companies to state what they expect and compares
it against reality; its own predictions were exempt until now, which is the
argument for keeping this wired.

**And a caution about the instrument.** `check-write-only-columns` reported 84
entries, of which 47 were reachable by a mechanism it cannot see — a literal
`SELECT *`, a SQL trigger, or the export's dynamic `SELECT * FROM ${table}`. It
is a question-asker, as its own header says. Check before building.

**What Foundry made, and whether it asked.** An executed `action_drafts` row —
pricing copy, landing copy, an onboarding flow, a remediation PR — appears in
the Letter's `handled` section, and says which the founder approved and which
Foundry did on its own. `approved_at IS NULL` is what "alone" means; it was the
only thing the retired `auto_execution_log.trigger` column recorded, and nobody
read that table.

**Who moved a key result.** `okr_progress_updates` is read on the OKR page: the
date, the movement, the note, and whether it was the founder or an agent. The
page can also CREATE an objective now, guarded by `requireOwner()` — until it
could, nothing anywhere in the running system could produce a row for that page
to render, and `compass.ts` and `forecasting/targets.ts` were reasoning about
objectives that could not exist.

**Whether an integration is still working, and whether Foundry gave up on it.**
`integration_sync_log` is read on the Integrations page as the trailing week of
attempts. It has two writers with disjoint column vocabularies — `sync.ts`
writes `status` and `error_message`, `framework.ts` writes `errors` and leaves
`status` NULL — so the reader DERIVES success rather than trusting either
spelling. Errored integrations are retried to a stated limit
(`MAX_CONSECUTIVE_SYNC_FAILURES`), and crossing that limit is announced once
through the interruption ladder. Before this, one failed sync set
`status = 'error'` and the hourly job selected `status = 'active'`: the
integration was never tried again, and nothing said so.

**A debate that crashed is not a debate.** `SynthesisOutput.failure_reason` is
null only when a synthesis really happened. A non-null reason ends the session
`'failed'`, keeps it out of the founder's daily briefing, and gives the page a
red badge instead of a green "Complete" beside a conflict count of zero.

**Causal chains are read, not recomputed.** `graph_rebuild` writes them weekly;
the route reads that batch and computes only when none has ever been stored. It
used to call Opus again on every request for an answer the job had already paid
for. The chains keep their cause and effect as labels, with ids resolved
against the entities the prompt actually showed the model and left NULL when the
model names something the graph does not contain.

## What a metric means, and what units it is in

Two conventions govern every company number in this system. Both were being
ignored by readers, and both are now stated in code rather than in prose.

**`mrr_cents` is the LEVEL; `new_mrr_cents` is new business won this period.**
The ingest field `mrr` maps to `mrr_cents` — it used to map to `new_mrr_cents`,
so a company reporting its total MRR had it recorded as new business, and every
investor-facing surface (which reads the level) showed N/A. `POST
/api/v1/metrics` always wrote the level correctly, so the same company got
different answers from the two doors. The settings page spells the difference
out to the founder, because that is what somebody sends wrong.

**Rates are stored as 0–1 fractions.** `activation_rate`, `churn_rate`,
`day_30_retention`, `mrr_health_ratio` — the ingest validates that range and
`ux/fluency.ts` names them. Use `ratePoints()` from `ai/measured.ts` to compare
against a percentage threshold, and convert the value rather than the threshold.

**THE LEVEL NOW HAS A WRITER THAT IS NOT THE COMPANY REPORTING IT.**
`metric_snapshots.mrr_cents` had exactly two writers — the v1 metrics API and the
ingest route — and both are the company stating its own numbers. Not one
integration wrote it. `stripe.ts` computed the level on one line and left it out
of the column list twenty lines later, so a company that connected Stripe left
the level permanently null while Foundry synced its subscriptions every hour.
Both Stripe paths and the framework adapter write it now.

**It was invisible for as long as the readers substituted a fallback**, which is
the argument for removing them: a zero looks like an answer, and a null asks a
question. Every fix in this area since has depended on the one before it — the
level had to be written before ARPU could be computed from it.

**A CLAMP CAN PIN A RATE TO ITS BOUND, and the bound is not evidence.**
`activation_rate` was activations over THIRTY days divided by signups over
SEVEN, with `Math.max(signups, activated)` in the denominator so it could not
exceed 1. For any growing company the max fired, the two cancelled, and the rate
was exactly 1.0000 — a hundred percent activation for essentially every healthy
company, read from there by the board deck, the value delivery index and the
benchmark percentiles. Without the clamp it would have read 3.2 and somebody
would have asked. **When a computed rate sits exactly on its bound, check the
windows before trusting it.**

**A percentile has a DIRECTION, and it belongs with the metric.** Portfolio
benchmarking now returns a `performance_percentile` — the share of peers this
company is doing better than — with each metric declaring `higherIsBetter` in
one list. It used to return the share of peers with a lower VALUE and let the
reader supply the direction, which meant the company with the least churn in a
portfolio scored 0 and was told to prioritise retention. If a percentile is
compared against a threshold anywhere, check which way it points.

**An estimate says what it was made from.** `EstimateBasis` — `{ inputs,
measured }` — travels with every model estimate in
`intelligence/competitive-v2.ts`, in the same shape and with the same word as
`Forecast.projected_from` in `founder/intelligence.ts`. `measured: false` means
no figure from this company reached the model. There is one vocabulary for this;
do not invent a second.
Watch for the asymmetry this failure has: **every "higher is better" test fails
and every "lower is better" test passes**, so a broken scorer awards full marks
for the worst possible number and nothing looks wrong. `nps_score` is on its own
-100..100 scale and must NOT be scaled.

**A Signal is not shown, spoken or prompted unless it was measured.**
`SignalResult.hasData` was already declared with the Honesty Law and honoured by
one of its ten consumers. Use `signalText()` / `signalNumber()` from
`services/signal.ts`; a test enumerates every caller of `computeSignal` and
fails when one neither reads `hasData` nor uses them. A default is NOT written
to `signal_history` — a gap there means nothing was known that day, which is
what the sparkline, the 7-day trend and the drop alert all need it to mean.

**Reaching a founder's phone asks the ceiling first.** `preferences.max_channel`
is what the founder said about how loudly Foundry may EVER interrupt them, and
`ux/interruption.ts` is the only thing that may decide. A caller with its own
legitimate push type calls `mayPush()` rather than coming through `deliver()`,
which flattens every type to `daily_briefing`; a test enumerates every caller of
`notifyFounder` and fails when one does neither.

**And the distinction that hid this one.** The outbound gateway governs whether
an effect may LEAVE — paused company, kill switch, dedup, audit. The ceiling
governs how loudly Foundry may interrupt THIS PERSON. `risk-state.ts` cited the
first in place of the second, in a comment, and was right about the first.
**Watch for a satisfied guard named where an absent one belongs.**

**Quieting an event now records it.** `deliver()`'s letter and log rungs used to
write nothing, so an event whose fact the Letter did not independently carry was
dropped by a founder lowering their ceiling — which is why eight scheduled bells
bypassed the policy rather than lose the fact. Migration 182 (`quieted_events`)
holds them and `letter/composer.ts` reads the last day's back as `noted`. Route
any founder-facing notification through `deliver()`; there is no longer a
condition to check first.

**One exception, and it is a decision rather than a gap.** `billing/stripe.ts`
notifies directly. `max_channel` is an attention preference, and the owner's §14
line keeps necessary service, billing, security and configuration state ungated
and disclosed while optional telemetry and celebration honour the preference. A
founder whose card is failing is told, whatever they set about volume. A test
pins that file; adding another is a claim that some message outranks a founder's
stated wishes, and the test is there to make somebody write it down.

**And a company's MRR reaches Foundry through TWO doors**, not one: the
founder's ingest token and `POST /api/v1/metrics`. Anything that must happen
when a company reports its numbers — forecast reconciliation is the first
example — belongs in a shared function both call.
`reconcileForecastsFromSnapshot` is that, and a test requires both doors to use
it.

**A prompt asking for facts about a company carries that company's figures.**
Every one now does, through `ai/measured.ts`. The board-deck route was the
extreme case: it asked for MRR, churn, NPS, cohort trends and runway while
passing the company's name, sector and stage — so a founder's investor document
was written from nothing. Where a figure is unknown the model is told, and told
that unknown must survive to the output, with the reason attached so the
instruction is not trimmed as boilerplate. Prose about plans stays free; the
constraint is on FACTS about the company.

**The general form, which is worth more than the instance:** when a doctrine
sentence is written into a type, check every consumer before believing it. A
rule in a comment protects the file it sits in; only a shared helper and an
enumerating test protect the callers.

**And one rule about outcome loops.** `/roi` reports "not measured" rather than
$0, because `recommendation_outcomes` has no writer. **Do not wire
`recordRecommendation` without `markActedOn`**: recording the denominator and
never the numerator turns an unmeasured rate into a measured 0%, which is a
confident wrong answer and harder to notice than a blank. A test fails if a
caller appears for one without the other. Wiring both needs a real answer to
"what counts as acting on a recommendation".

## Evidence frontier (do not inflate)

| Capability | Level | Scope |
|---|---|---|
| Reconstruction / recognition / understanding / Shadowing / judgment / development | E3 | prior exercised synthetic dimensions only |
| Assisting (support reply) | E3 | **prior synthetic dimensions only — unchanged for three sessions** |
| Production reachability | E3 | four synthetic non-software companies, each now entering through the ONE intake production has — they used to be admitted by SaaS event types nothing emits, so the benchmark answered "can a normal company enter the ladder?" through a door the running system does not have. Better founded, same level: still synthetic. |
| Everything wired through production-facing services | E2 | local runtime through production-facing services |
| Recursive Foundry operation | **E1** | `recursive-institution-contract.ts` has **zero importers in `src/`** — only its test reaches it. It was recorded as E2, which means "local runtime through production-facing services", and there is no production-facing service. `recursive-institution-v1` reporting ordinary on thirteen dimensions is a benchmark result, not a runtime one. Never run by a real owner in production. Corrected on evidence, not re-measured upward. |
| Institutional economics | **E1** | `institutional-economics.ts` also has zero importers in `src/`. Attribution is structural and the arithmetic is tested; nothing in production consumes it, so the same correction applies. Seven components remain named-unmeasured. |
| Assisting → Operating | frozen | migration 115; unchanged |
| Real founders, providers, pilots, production | unproven | E4/E5/E6 |

## Open proof debt

- **Nothing has met reality.** No real founder, outside tool, or provider.
- **Autonomous reply generation** is unbuilt and unclaimed; the founder-authored path is the baseline. Its contract is now frozen at E1 and nothing has ever been scored against it.
- **Pilot readiness is green, and that is a smaller claim than it sounds.** `support-pilot-readiness-v1` says *ready to attempt a bounded pilot*. No pilot has occurred; the six named items of outstanding external proof are all still outstanding.
- **Outcome (§12) remains untouched and must stay so:** provider acknowledgement, delivery, customer silence, and elapsed time are all *not* resolution. If a provider can emit an explicit case-status event, audit whether its contract genuinely establishes the outcome before believing it. Preserve `unresolved`.
- ~~Judgment observation cannot report `contradicted`~~ — **CLOSED.** It now
  does, and only against a date the COMPANY stated that has passed with the
  conflict still standing. Anything less is still `partially_observed`: an
  absent deadline is not a met one, and a conflict the owner has simply not
  got to yet has falsified nothing.
- Of the development paths, only `development-benchmark.ts` is still on the reachability gate's DARK list, and it is a frozen benchmark. The rest are statically reachable; what is missing is a caller for the change-execution chain (`plan` → `execute` → `verify` → `rollback`), which is a different gap and is recorded on the frontier.
- Executive cognition: no marginal-value comparison; the cognition gate forces one.
- Economics: near-vacuous while the institution is model-free.
- ~~Duplicate founder reports still create duplicate responsibilities~~ —
  **CLOSED within a source.** Discovery converges a repeat of the same
  obligation: same title, capability, stated deadline and reporting source, and
  only onto an active responsibility. Both reports are kept as evidence; what
  converges is the obligation. Still open across sources, deliberately: a
  founder and one of their own systems reporting the same thing produce two
  responsibilities, because a responsibility carries a single discovery
  reference and merging would make the second witness invisible where today it
  is visible as its own item. See `discovery.ts`.
- NULL-safety gate does not analyse nullable **columns**; trigger tests are the backstop.
- **The suite aborts intermittently and the cause is not known.** Roughly one
  run in three, a native libsql panic that takes the run with it rather than
  failing a test. Two candidates eliminated by measurement (a leaked query
  timeout; the old fixture collision), one live (nothing ever closed a database
  connection — `closeDb()` landed and the suite now closes after every file;
  over 30 consecutive clean runs since, against a prior rate near one in
  three). Until this is settled, "full
  suite green" carries an unstated qualifier: *this time the process survived*.
  Recorded here rather than in a comment because it qualifies every other
  evidence claim in this document.

## Master-audit reconciliation

*Reconciled against the repository rather than against memory. Where a line says "verified", it was checked in that pass; where it states a count, it names the command so the next steward can re-run it rather than believe it. The trigger counts below were last re-run at `c1c0976`.*

### Proven — E3, or structurally enforced and mutation-verified

| What | How it is proven |
|---|---|
| Reconstruction, recognition, understanding, Shadowing, Assisting, judgment, development | Executable benchmark gates, each with a running test. **Scope: the synthetic dimensions those corpora actually exercise — nothing wider.** |
| Production reachability | `production-reachability-v1` across four synthetic non-software companies, each admitted through the one intake production has |
| Unfamiliar-company generalization | Independently generated corpus against the frozen recognition gate |
| **Institutional invariants live in the database** | Not in application code, so a bug in a service cannot bypass them. Reproducible counts across `src/db/migrations/`: **87** `CREATE TRIGGER` statements carrying **74** distinct trigger names, and **222** `RAISE(ABORT, …)` guards — re-counted after migration 169. The name count did not move because 169 drops and recreates `founder_assertion_guard` rather than adding a guard; the statement and abort counts moved by exactly what it re-declares. A previous figure of "169 … verified by count" appeared here with no stated method and cannot be reproduced by any obvious one; these numbers name their own command so the next steward can check them. |
| The scheduled pass has no epistemic privilege | Four-part audit: structural, behavioural (four refusals + one advancing control), provenance, idempotency |
| Support-chain reachability | Sixteen named links, invocation-based, mutation-verified against a removed call |
| Institutional cognition is deterministic | Gate test; no model reachable from the kernel |
| NULL-semantics of every guard | Systematic audit (migration 130) plus a standing gate |
| Coverage integrity in both new gates | Dropping an observation reports *unexercised* rather than passing |

### Implemented but unproven — E2, real code path, local runtime only

Everything built in sessions four through seven: the founder evidence bridge, company-scoped facts, external metric observation, Shadowing resolution, the Assisting admission and its revocable authority, inbound customer message intake, the founder-authored reply proposal, bounded planning, execution-time revalidation, governed send, receipt, and the seven-day absence view. **None of it has been touched by a real founder, a real outside system, or a real provider.** A production-facing code path is not production evidence, and this table is the difference.

### Partially implemented

- ~~**Judgment observation cannot report `contradicted`**~~ — closed by migration 166's stated due dates; see above.
- **Duplicate founder reports still create duplicate responsibilities.**
- **The NULL-safety gate does not analyse nullable columns**, only guard predicates; trigger tests are the backstop.
- **Reachability is per module, not per behaviour.** A module counts as reachable when production imports it at all — including read-only. Several institution modules are reachable that way while their write paths stay undriven.

### Superseded

- The vertical support-chain test's caller assertions — replaced by the standing reachability gate, which cannot go stale.
- Earlier continuation records — this one supersedes all of them.
- Capability-level autonomy consent as a route to Assisting — superseded by responsibility-bound authority (migration 112) and kept structurally distinguishable so the legacy form cannot satisfy the new one.

### Owner deferred

- **Real AcreOS work.** Not inspected, accessed, ingested, modified, integrated, benchmarked against, simulated, special-cased, or used to derive architecture. Unchanged this session.
- **Merging to master.** The branch has never been merged and will not be without explicit instruction.
- **Assisting → Operating.** Frozen by migration 115. Pilot readiness being green is explicitly *not* a reason to design or enable it.

### External-only — cannot be established in this repository at any effort

- Whether a real founder understands and trusts the grant/revoke/re-grant surface.
- Whether a real customer's problem was actually solved (business outcome). Provider acknowledgement, delivery, silence, and elapsed time are all *not* resolution; `unresolved` is preserved deliberately.
- Whether founder attention actually decreases.
- Whether the support envelope survives contact with real message volume and variety.
- Model quality against `support-drafting-v1` — the contract is frozen, and no model has ever been scored against it.

### Still open

*Reconciled again at the close of the eleventh session.*

- **Recursive operation in production.** The vertical is proven locally and end
  to end, but it has only ever run in tests. **External proof debt, explicitly:**
  the deployed Foundry company still requires a genuine owner-authenticated
  report, performed outside the coding environment. The owner has decided on
  **report only, not the grant**, so Foundry still may not mutate its own
  repository outside a test. Neither may be fabricated.
- **Named-agent retirement.** Twelve implementations remain live and
  production-reachable. Retiring them is Class-C, not Class-B: they are
  model-driven and the institution is deliberately model-free, so cutting them
  over would LOSE capability rather than preserve it. Blocked on executive
  cognition, itself blocked on a consumed task with a real baseline.
- **Judgment calibration — still blocked on reality, but less so.** The
  observation pass writes `judgment_expected_supported` when the company
  resolves a conflict and `judgment_expected_contradicted` when a date the
  company itself gave passes with the conflict still standing, so evaluation
  can reach a real verdict rather than only `not_yet_observable`. What remains
  blocked is CALIBRATION: whether Foundry's confidence tracks its accuracy
  needs a run of real judgments against real later reality, and manufacturing
  longitudinal examples to improve that number would corrupt the one number
  that is supposed to be honest.
- **Quality/cost comparator.** Deferred with a stated trigger — buildable when a
  second candidate method exists for a consumed capability.
- **Architecture deletion.** Candidates remain, each needing per-module proof.
  The dynamic-loader blind spot is now closed and the classification gate is
  bidirectional, so the next sweep starts from a trustworthy report.
- **Founder attention** stays unbuilt until a real consumer needs it.

**Closed since the last reconciliation, and not to be re-listed:**

- ~~`challenger` and `synthesizer` are evidence-insufficient~~ — the owner
  answered, and the answer was that my classification was wrong. Both are
  standalone debate functions reached by ordinary static import from
  `debate/orchestrator.ts`. Being in `agents/` is not what makes something an
  agent; the gate now checks reachability rather than location.
- ~~`development-shadowing.ts` remains dark~~ — the owner can now open a
  development expectation, so the DARK list contains only frozen benchmark
  gates, which is what it was always supposed to mean.
- ~~The unreproduced `customer-message-intake` flake~~ — **RESOLVED.** A
  near-miss key fixture built as `key.slice(0,-1) + 'X'` collided with the real
  key whenever it ended in `X`, once in sixty-four. Every one of the six
  eliminated hypotheses was correctly eliminated, and none of them could have
  found it.

## Working rules that mattered most

- **Audit the writers, not just the modules.** Five sessions running, the biggest finding was something built and never called.
- **Attribution must be structural, not semantic.** The temptation this session was to infer which responsibility a customer message belongs to from its text. Binding the channel to the responsibility makes it a fact instead of a guess.
- **Identity comes from the credential, not the payload.** If the authentication channel can establish the source, the body must not be able to claim it.
- **When the honest path stops, stop and say why.** There is still no reply generator; inventing one to turn the pipeline green would have been the worst available outcome.
- **An audit that finds nothing is a result, not a failure to deliver.** Three slices this session ended in building nothing, because the structure already held. The instinct to add *something* so the work looks substantial is how privileged bypasses and second kill-switches get built.
- **Freeze the contract before the thing it judges exists.** Thresholds written after the first model are thresholds the first model passes.
- **A gate you have not mutated is a gate you are guessing about.** Every detector and classifier added this session was broken deliberately first, in both directions, before being trusted.
- **The same defect shape recurs at every layer.** A general mechanism bound to one SaaS-shaped special case: twelve metric columns for observation, one capability and one scope for effects. Finding it once teaches you where to look next.
- **Let reality reveal the missing primitive.** The effect-boundary gap was not designed into a roadmap; four fictional-but-honest businesses walked the ladder and stopped at the same wall.
- **Replacing a guard means reproducing ALL of it.** Migration 135's first draft recreated the vocabulary checks and silently dropped two independence guards. Widening a vocabulary must never quietly narrow anything else.
- **A test that only exercises the service has not tested the database.** Deleting the trigger's tenant binding passed every test until a forged insert named a channel that was live for another company.
- **Fix the fixture, never the feature.** The seven-day view failed against a hand-built stub that had drifted two migrations behind production. The stub was wrong; the query was right.
- **Check the observation against reality BEFORE building on it.** The recursive slice began by measuring the live schema against the committed snapshot — 698 objects each side, exact match — because an observer that reports drift where there is none is not a recursive proof, it is a fabricated fact about the company.
- **A tool's blind spot is more dangerous than its silence.** The orphan report confidently named 160KB of live, dynamically-loaded code as dead. Any analysis that resolves only static imports will do this, and the failure mode is a production outage rather than a test failure.
- **Latent is not the same as observed — say which one you fixed.** The foreign-key PRAGMA race was real in principle and unreproducible in practice. Recording it as "found and fixed, but not the cause" keeps the open flake open, which is where it belongs.
- **When guards keep refusing your fixture, stop hand-building rows.** Four consecutive triggers refused a hand-made economics fixture. Building it through the real services was less work and proved more.
- **Deferral with a stated trigger is a decision; deferral without one is drift.** Three things were deliberately not built this session, each recorded with the condition that would make it buildable.
- **When a guard refuses your fixture, the guard is usually right.** Five separate refusals this session — an ambiguous same-second observation, two competing proposals, a plan without Assisting, shadowing without Understanding, a weak intake key — were every one of them the system working. The fixture changed each time; no guard did.
- **A cast is a promise, not a check.** `agentName as AgentName` on a database row type-checks and validates nothing. Two of three dynamic loaders were secured by a type annotation that does not exist at runtime.
- **Verifying the thing you changed cannot see the thing you didn't.** The whole point of `verifyDiffScope`: every other check passes while the repository is unauthorised.
- **Being ready to learn beats continuing to look.** After nine full runs and twenty-five saturated ones, the honest move on the intermittent was forensics readiness, not more guessing.
- **A credential is an authority surface.** Whenever a route is added behind an existing token, ask what ELSE that token already opens. One secret authenticated posting numbers, raising work, and declaring that an effect succeeded — and the third walked straight through the guard built to stop exactly that.
- **Reading a subsystem's surfaces side by side beats extending it.** Two more companies through the ladder confirmed the generalization and found nothing. Stopping to reassess found a real defect within the hour.
- **Gate on reach, not on rendering.** "No secret is printed" passes right up until somebody prints one. A row that never arrives has nothing to print.
- **Commit before mutation-testing.** A `git checkout` to revert a mutant silently reverted real edits in the same file, and left mutants standing in the untracked ones. Second time this has happened; the fix is to commit first, not to be more careful.
- **A word boundary is not a boundary once you fold case.** `heatingHint` lowercases to `heatinghint`, and `\bheating\b` cannot see it. Two gates read as if they checked something they did not.
- **Read a subsystem's surfaces beside each other; do not extend it.** Nine reads, seven real defects, and none of them would have surfaced by building the next feature. Two more unfamiliar companies through the ladder confirmed the generalization and found nothing.
- **Ask what one surface assumes about another.** Every finding was an assumption that used to be true: one credential meant one consequence, CI's job matched `npm run check`, a detector saw every consequential call, a write chain implied someone could see the result.
- **A detector's blind spot is a claim you are making without evidence.** "0 direct effects" was true of what the regex could see and false of the codebase. The inventory read as reassurance for as long as nobody checked what it could not match.
- **A write chain is half a chain.** Four surfaces were unreachable by a human being while every write link had a production caller. Data moving is not a person seeing.
- **`unresolved` becomes permanent unless something makes it fail.** Four untraced consequential effects sat for a long time because the audit counted them instead of refusing them.
