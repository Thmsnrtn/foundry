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

**FIRST, CHECK THE REMOTE — AND CHECK WHICH WAY THE GAP RUNS.** The seventh
container restart of this campaign came back the OTHER WAY: HEAD was three
commits AHEAD of `origin/<branch>`, tree clean, nothing lost — the restart had
simply landed between a commit and its push. `git merge-base --is-ancestor
origin/<branch> HEAD` answers which case you are in, and it is the first thing
to run. If the remote is an ancestor, push; if HEAD is, reset. The rest of this
note is the other case, which has happened SIX TIMES: this working directory
came up rolled back — by fourteen, twenty,
thirty-eight, fifty-two, eighty-one and ninety-four commits — with `origin/<branch>`, the
LOCAL TRACKING REF, agreeing with the stale HEAD, so `git status` said "up to
date" and a whole cycle of work looked lost. It was not: it was on the remote
the whole time. **The fifth time it followed a container restart mid-suite**,
which is the closest thing to a cause anyone has seen: the restart notice and
the rollback are worth treating as the same event.

**THE SIGNATURE IS IDENTICAL EVERY TIME**, which is worth knowing before you
start diagnosing: HEAD lands on `0e85a11` ("The level was computed, and thrown
away") and the tree carries one modified file, `integrations/framework.ts`, with
the same two added lines. That is a fixed older snapshot being restored, not
work being lost — so the recovery below is mechanical, and the growing gap is
just how long the session has run since.

```
git ls-remote origin claude/foundry-autonomous-continuation-0gents   # the truth
git fetch origin claude/foundry-autonomous-continuation-0gents
git merge-base --is-ancestor HEAD origin/claude/...   # prove nothing local is unique
git reset --hard origin/claude/...
```

Do the ancestor check before the reset, every time. If HEAD is NOT an ancestor,
something local is unique and a reset would destroy it — inspect `git reflog`
first. A modified file in the tree after a rollback is usually the uncommitted
half of work already committed on the remote; diff it against the remote version
before discarding it, and do not re-apply it by hand. **On the third rollback
that diff was the argument for discarding:** the modified file added a
`customerCount` that the finished version on the remote had DELIBERATELY
removed, under a comment explaining that it counted subscriptions and was being
written into `active_users`. The stray edit is not always the unfinished half of
something still wanted; sometimes it is the thing a later commit deleted on
purpose. Read the remote version, not just the diff's shape.

Then run the loop in `DEVELOPMENT_INSTITUTION.md` §2: orient, verify, locate
the frontier from **current repository truth**, and act. Do not resume an
inherited list because it was inherited.

---

## Verified checkpoint

- **Branch:** `claude/foundry-autonomous-continuation-0gents`. Never merged to master.
- **Head:** `f670bef`, pushed. Verify against `git log -1` before trusting this
  line; it is the one thing here that goes stale fastest.
- **Migrations:** 252 files, highest **216**. Ordering gated. Snapshot current —
  and regenerate it AFTER the last migration of a batch, not in the middle of
  one. It was regenerated between 215 and 216 this cycle, and
  `foundry-self-observation` caught the result: 685 objects recorded against 684
  live. That check is Foundry comparing its own schema to its record of it,
  which is the one place a stale snapshot has to be caught, and it was.
- **Validation:** `npm run check` green end to end — **427 files / 3,693 tests**,
  `CHECK_EXIT=0`, read from the run that wrote the log.
  **`tests/unit` IS NOT THE SUITE.** `test:ci` is a bare `vitest --run`, which
  also runs `tests/simulation` and `tests/evals`. Checkpoints before this
  campaign recorded the unit count and called it "full suite green" while
  `tests/simulation` had three failures standing. A validation claim is a claim
  like any other. **Run `npm run check`, not `vitest run tests/unit`.** That one
  command IS the gate chain — typecheck, ratchets, kernel boundary, NULL-safety,
  truth audit, effects audit, `lint:columns`, AI attribution, then every test.
  **READ THE EXIT CODE FROM THE RUN THAT PRODUCED THE LOG, AND FROM THE RIGHT
  COMMAND IN IT.** Twice now this has bitten differently. Piping vitest through
  `grep` returns grep's status. And this cycle the HARNESS reported "exit code 0"
  for a run that failed, because the backgrounded command ended with
  `echo "CHECK_EXIT=$?" | tee` — the pipeline's status, not npm's. Write the
  code INTO the log with `>>` and read it from there; 50 red test files were
  reported as a pass for about a minute on the strength of a wrapper.
  **Qualified:** the suite aborted natively about one run in three *before*
  `closeDb` landed; many consecutive clean runs since. See item 2.
- **Ratchets:** unguarded mutating routes **112** · fabricated test schemas **4** ·
  writer-less tables **0** · SELECT drift **0** · untraced consequential
  effects **0** · statically unreachable modules **24** ·
  write-only columns **64** · unscoped product-shaped routes **2** ·
  id tiebreaks **18** · backticks in embedded comments **0** ·
  query-argument mismatches **0** · INSERT value-list mismatches **0** ·
  tables written and never read **2** · raw control bytes **0** ·
  **tables no code can reach 0** (was 11; migration 215 dropped them and 216
  finished the job) · permitted `'connected'` literals **1** ·
  star-select phantom columns **0**.

## Active work

None in flight. Everything below is unstarted or blocked.

## What this cycle established

**The cycle before this one read the exit surface end to end and built the
phantom-column gate.** Its narrative is in `history/SEAM_CAMPAIGN_HISTORY.md`
under "The exit surface, the cadence lens, and the phantom-column gate"; the
durable rules are in `IMPLEMENTATION_STATE.md`. In one line each: a quarter of
the M&A readiness score that was a constant; a liquidation preference treated as
a ceiling; a column that said dilution and meant proceeds; a "market standard"
nobody measured; twenty-two health scores of fifty from runs that scored
nothing; a profit half of which was an opinion; a date compared in two formats;
four badges nobody could see; a lifecycle that never advanced; a retention
nobody measured and sold on the pricing page; whichever company sorted first
deciding real actions; a growth rate whose period was the reporting cadence; ten
columns that do not exist in five founder-facing documents; and a valence
outside its vocabulary.

**THIS CYCLE'S SUBJECT IS THE HALF-BUILT MECHANISM — and the finding that
matters is that one of them was being TESTED.**

- **A tenancy control that was tested and never mounted.**
  `src/middleware/tenant.ts` stated the rule properly and was mounted on no
  router. Ten assertions in `tests/unit/tenancy-isolation.test.ts` and two in
  `tests/simulation/05-tenancy-integrity.test.ts` read its SOURCE TEXT and
  confirmed each property. A suite named for the control could not have failed
  whatever the live routes did. The module is gone; those tests now request
  another founder's company and read the answer — 404, byte-identical to a
  company that does not exist, with neither the name nor the numbers in the
  body — and the archived and paused rules are pinned in `kill-switch.ts` where
  they run, INCLUDING an active company that is not blocked, because a guard
  that always refuses measures nothing.
- **An event was part of the baseline it was measured against.** `ingestEvent`
  writes to `event_stream` and then asks how far the event sits from the last
  hundred events of its type — a window that included it. For n values where one
  differs from the rest, the largest deviation that arithmetic can report is
  √(n − 1): at the ten-observation floor, 3.0σ, so `deviation_sigma > 3` — the
  branch that escalates to critical and notifies the founder — was unreachable,
  and a metric that went to infinity scored 3.0. Two more in the same lines: the
  spread divided by n on a sample, and history rows never checked for being
  numbers, so one string made every deviation `NaN`, `NaN > 2.5` false, and
  detection silently off.
- **Two tables written every week that nothing could read.**
  `portfolio_snapshots` had a weekly job and a POST endpoint and no reader; it
  has an owner-verified GET now. `cofounder_alignment_scores` was worse than
  unread — `getAlignmentScore` ran Opus and appended a row on every call, so a
  page load cost a model call and two looks at unchanged responses could
  disagree, into a table nothing read. It serves the stored score when no
  response is newer, strictly `>` because both clocks are whole seconds and a
  tie is not evidence of order.
- **Eleven tables nothing ever wrote.** Not written-and-unread — never written.
  Created by a migration, referenced by nothing in `src/`. Migration 215 drops
  them. **The useful half of that change was a fixture:** the planted-defect
  test for `check-unread-tables` BORROWED `sector_remediation_templates`
  because it qualified as a real unreferenced table, and a fixture that depends
  on a real defect surviving rots every time one is cleaned up. It plants its
  own table now.
- **One prompt, two copies, and the golden cases scoring the wrong one.**
  `src/prompts/voice-judge.ts` said it was "extracted from"
  `voice-fingerprint.ts`, which had kept its copy; nothing imported the
  extracted one. They had drifted, and materially — the live copy fenced the
  draft, text Foundry did not write, in triple quotes, and the extracted one
  interpolated it bare. `src/prompts/README.md` claimed the eval framework
  imports the same builder production uses; nothing outside `src/prompts/`
  referenced `GOLDEN_CASES` at all.

**The rule this cycle adds, and it is about evidence rather than code: A TEST
MAY ASSERT ON A DORMANT MODULE'S SOURCE WHEN IT SAYS THE MODULE IS DORMANT.**
`stripe-sync.ts` has two such tests, named "the dormant path no longer discards
it either", and they are honest — they claim a defect stays fixed in a file that
does not run, and they say so. A test named for a live control that reads a file
which never executes is the defect. **The difference is what the test's name
promises a reader, not whether the file runs.**

**The recurring method note.** Seven times this campaign, and twice more in the
cycle before this one, a test failed after a repair because the test had encoded
the defect as its premise. The repair is never to relax the assertion: it is to
make the fixture STATE what it was assuming, and to say so in the comment.

## Earlier cycles

Narrative in `history/SEAM_CAMPAIGN_HISTORY.md` — the fixes live in the
migrations and tests that implement them, and the durable rules in
`IMPLEMENTATION_STATE.md`:

- **"The rest of the 32-agent sweep"** — twelve batches; summarised at the top
  of this cycle's section because several of its shapes recurred here.
- **A fan-out sweep across the unread service areas** — twenty-two findings, all
  closed: the LEVEL and the MOVEMENT confused in both runway forecasters, so a
  company reporting through the documented door was modelled at zero; one
  absence substituted in opposite directions inside a single function; a 0–1
  churn fraction compared against thresholds in percentage points; and a
  composite that rested on components it had not measured.
- **"Twelve tables that nothing read"** — followed one at a time; eight of the
  twelve led somewhere worse than the table itself.
- **"One page, read line by line"** — eleven consecutive findings on
  `founder/intelligence.ts`, from the plainest lens available: read the number,
  then find the query that produced it.
- **"The owner answered §10, §14 and §12"** — the decisions are load-bearing and
  are recorded in the migrations that implement them and in **Blocked — owner**
  below.
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
- **`middleware/tenant.ts` — THIS ENTRY WAS WRONG AND THE MODULE IS GONE.** It
  said "specification, not dead code". What it actually was: a control that TWO
  TEST SUITES ASSERTED ON. Ten assertions in `tests/unit/tenancy-isolation.test.ts`
  and two in `tests/simulation/05-tenancy-integrity.test.ts` read its source text
  — that it calls `getProductByOwner`, answers 404 rather than 403, treats an
  archived company as absent — and `tenantMiddleware` was mounted on no router.
  A suite named for the control could not have failed whatever the live routes
  did. Deleted; the tests now request another founder's company and read the
  answer. Ownership is enforced inline on every route and ratcheted by
  `check-tenant-scope.mjs`; archived and paused are enforced by
  `outbound/kill-switch.ts` at the effect boundary, which is the place that
  matters. The module also fabricated `sector_profile: 'b2b_saas'` and
  `growth_stage: 'pre_launch'` into every `Product` it built, from no reading —
  mounting it would have introduced that claim.

  **THE RULE THIS PRODUCES, and it decides the next case as well as this one: a
  test may assert on a dormant module's source when it SAYS the module is
  dormant. `stripe-sync.ts` has two such tests — "the dormant path no longer
  discards it either" — and they are honest: they claim a defect stays fixed in
  a file that does not run, and they name it as such. A test named for a live
  control that reads a file which never executes is the defect. The difference
  is what the test's name promises a reader, not whether the file runs.**
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
- **The nine that were unexamined, now read.** Three had answers, not questions:

  - **`prompts/voice-judge.ts` was `truth/engine.ts` again**, and it is fixed.
    Its header said "extracted from `services/calibration/voice-fingerprint.ts`"
    and that module had KEPT ITS COPY; nothing imported the extracted one. The
    two had drifted, and not cosmetically: the live copy fenced the draft — text
    Foundry did not write — in triple quotes, and the extracted copy interpolated
    it bare. The `GOLDEN_CASES` beside it were scoring a prompt the product does
    not send. One builder now, carrying the live wording including the fence.
  - **`src/prompts/README.md` claimed coverage that did not exist.** "Every
    prompt that touches an LLM must have a typed builder + golden cases mounted
    in the eval framework", and "the eval framework imports the same builder used
    in production, so eval coverage is real". NOTHING outside `src/prompts/`
    referenced `GOLDEN_CASES` — neither module's cases had ever been run by
    anything. `tests/evals/prompt-golden-cases.eval.test.ts` mounts both, without
    a model call: a case declaring `max_chars: 120` against a prompt that asks
    for 140 is a case measuring nothing, and that is what an eval can honestly
    check here.
  - **`mcp/cli.ts` is an entrypoint, not dead code.** `npx tsx src/mcp/cli.ts`
    is how it is invoked; nothing imports an entrypoint. Correctly baselined.

  Still open, each a product question of the same kind as item 2 rather than a
  defect — a feature whose reading half exists and whose calling half does not:
  **`briefing-share.ts`**, **`ai/composer.ts`**,
  **`intelligence/{benchmarks,shippability}.ts`**, **`support-pilot-readiness.ts`**
  (which says in its own header it may never be reported as pilot evidence).

  **`lib/env.ts` IS NOT ONE OF THOSE AND IS THE NEXT THING TO LOOK AT.** It
  validates every required environment variable and calls itself "fails fast
  with actionable error messages" at startup, and nothing calls it — so the
  process boots with a missing variable and fails somewhere else, later, in
  whatever code first needed it. That is a control that does not run, not a
  feature without a caller. Wiring it into boot is the obvious answer and needs
  care: the schema must be checked against what each deployment actually sets
  before it becomes the thing that refuses to start.

  **`lib/request.ts`** is a body parser no route uses; routes parse inline.
  Dead helper, removable.

- **The two Stripe modules, and why only one of them is a duplicate.**
  `integration/` (singular) is outbound — gateway adapters Foundry CALLS.
  `integrations/` (plural) is inbound — sync adapters that PULL metrics, reached
  through `sync.ts`. Four provider names appear in both directories and none of
  those pairs is a duplicate; they are the two halves of a provider relationship.
  `integrations/stripe-sync.ts` is the odd one: a second inbound Stripe path
  with its own Connect OAuth flow whose callback route does not exist. It stays
  by a decision recorded in an earlier cycle — its defects were fixed before
  anybody wires it up — and its tests name it as dormant, which is what makes
  them honest.

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

1. **~1,600 LOC of clientless API** (`founder-intelligence`, `mobile` serving an
   archived unbuildable client, most of `tier1-4`). Deletion adds no capability
   but makes the route count honest. Mounted, so a founder could in principle
   POST to it — which makes this a product decision rather than dead-code
   removal, and it is why it has not been taken.

2. **The suite aborts natively, and the cause is not established.** A Rust panic
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

3. **4 tables written and never read** — `check-unread-tables.mjs`, the mirror
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

4. **69 write-only columns — a question-asker, not a work queue.** `check-write-only-columns.mjs` holds the count;
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

5. **One concept, two canonical truths: `customers` and
   `customer_intelligence`** — now in the COMPARE stage, with the live harm
   fixed and a measurable cutover criterion.

   **Two defects on the two sides were fixed since, and both bear on the
   cutover count.** On the legacy side, `upsertCustomer` never upserted — an
   unconditional INSERT with a fresh id, on a table with no uniqueness
   constraint — so re-reporting a customer created a second row and the cutover
   criterion counted them twice. It matches on `(product_id, external_id)` now;
   NO unique index was added, because rows already written may contain
   duplicates and a migration creating one would either fail on live data or
   delete a founder's customers to succeed. **That constraint is the decision
   this entry should carry to the cutover, with the data in front of it.** On
   the documented side, `addAgentNote` stamped `last_contacted_at` and
   `last_contacted_by` for a purely internal note, so `GET /api/v1/customers/
   :customerId` told an integrator syncing into a CRM that a customer had been
   written to when nobody had.

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

6. **The transcript sense: NOT a gap. Corrected before it was built on.**

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

7. **Adapters for the existing intakes.** The shape is proven; breadth is
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

8. **CLOSED — the four MRR movement columns can say "not reported".** Kept
   here for one cycle because the caveat outlives the fix.

   `new_/expansion_/contraction_/churned_mrr_cents` were `INTEGER DEFAULT 0`, so
   a reported zero and an unreported movement were the same value. Migration 202
   rebuilt the table without the defaults; the three steps were (1) the two
   ingest paths that wrote with a bare `UPDATE ... WHERE snapshot_date = today`
   now upsert, (2) the job that inserted an empty row per company per day is
   deleted, (3) the columns are nullable and seven surfaces say "not reported".
   `NULL + 5` is NULL, so the webhook's five accumulate-in-place increments read
   `COALESCE(col, 0) + ?` — the only place a zero may be substituted.

   **THE CAVEAT THAT DOES NOT EXPIRE:** rows written before migration 202 keep
   their stored zeros, and nothing can tell those from reported zeros — the
   information was never recorded. Any surface showing a historical
   decomposition is showing numbers whose provenance it cannot establish. If
   that ever matters, the honest move is a per-row era marker, not a guess.

9. **CLOSED — `integrations.type` is retired.** One column meant a PROVIDER
   KEY, a DIRECTION or a CATEGORY depending on which of five writers made the
   row, and every reader had to guess which. Three live defects came out of the
   guessing and were fixed one at a time; none of them was the fix.

   Migration 203 gave direction its own column, backfilled it from what each
   row actually meant, and put the vocabulary in a database trigger. Migration
   204 backfilled `provider` for the fabric-written rows — whose provider was in
   `name` — and dropped `type`. Every writer sets both columns; `directionOf`
   has one home.

   **Three readers were answering the wrong question and nobody had noticed:**
   the Integrations page keyed its connected-cards map on `type`, so an
   integration connected through another door never matched a card and its
   Disconnect button did nothing; Shield's credential-expiry query named a
   DIRECTION as the source of a credential; and the chat context told the model
   a company had connected "inbound".

10. **Three writers to `experiments`, and three vocabularies for "who won".**
   The table carries both migration 023's schema and migration 028's — 028's
   `CREATE TABLE IF NOT EXISTS` was a no-op and migration 056 reconciled the
   columns by ALTER, so the live table is the union of two designs. Three paths
   write it: `scp/experiments.ts` (hypothesis-driven), `experiments/engine.ts`
   (variant-driven A/B), and `POST /v1/experiments` (the documented external
   surface).

   **The engine's crash is fixed** — it wrote a variant name into
   `winner`, whose CHECK admits only `control`, `treatment`, `inconclusive`, so
   the success path threw. **The remaining divergence is the documented one:**
   `POST /v1/experiments/:id/conclude` writes `outcome` and
   `winning_variant_id` and leaves `winner` NULL, and every institutional
   reader — the board packet's `experimentOutcome`, the accuracy tracker, and
   `WHERE e.winner = 'treatment'` — reads `winner`. **A company that concludes
   an experiment the documented way is invisible to the surfaces that report
   experiments**, which is the same shape as the customer-store split in item 5.

   **THE HALF THAT NEEDED NO INVENTION IS DONE.** The documented door now
   ACCEPTS `winner`, validated against the column's own vocabulary and refused
   with a 400 rather than stored and dropped — so a caller can state the one
   thing every institutional reader consults, and `outcome` and
   `winning_variant_id` stay theirs. And "completed" is a STATE: the board
   packet used to fall through to it, printing "completed" in the outcome column
   of an investor document, so a conclusion whose winner nobody recorded read
   like a result. It says what it is now.

   **STILL NOT INFERRED, with the reason:** `experiment_variants` carries no
   control/treatment marker, so `winning_variant_id` cannot be MAPPED to the
   vocabulary without inventing a convention, and inventing one on a documented
   external contract is a product decision. **The trigger that makes that
   buildable is a control marker on the variant** — at which point conclude can
   derive what the caller did not say.

   `experiments.holdout_id` (migration 035) and `experiment_holdouts` are both
   dead: an experiments system with a holdout column nothing writes. On the
   unreferenced-tables baseline in item 8.

11. **Eleven tables no code can reach, one at a time against their successor.**
   `check-unreferenced-tables.mjs` is the third side of the triangle the other
   two table gates leave open, and it is a RATCHET, not a work queue. The
   pattern in the eleven is a superseded store left behind after its
   replacement arrived — `strategic_plans` beside `strategic_syntheses`,
   `competitor_pricing_snapshots` and `competitor_feature_tracking` beside the
   live competitive path.

   **Two more went this cycle, and both taught something on the way out.**
   `leading_indicators` held `confidence`, `sample_size` and `lead_time_days` —
   the columns that would have made the failure-pattern library evidential —
   and reading it is what surfaced that the library was stating four
   frequencies nothing had counted, on a card headed by the founder's own match
   score. `outbound_webhooks` was a third table for a concept the product
   implements twice, and reading it surfaced that TEN `CREATE TABLE IF NOT
   EXISTS` statements across seven migrations never ran — three of which have
   cost this campaign real time. **Both times the table was the smaller half of
   what the reading found**, which is the argument for the selection rule below
   rather than for sweeping the list.

   **Two were already removed rather than baselined, and the reason is the
   selection rule for the rest:** `audit_trail` carried the header "Every
   mutation in the system should be traceable to a person or job" over a table
   that had never held a row, and `autopilot_config` was an untyped
   `preferences` blob sitting beside the authority ladder that actually records
   what Foundry may do. An empty table named for a control is a claim of a
   control. Take the next one when its name makes a claim, or when reading it
   teaches something about the successor; do not sweep the list to get the
   number down.

12. **Three things the security ledger left, each a whole feature rather than a
    fix.** None is blocked; each is stated so that the next person does not
    reach for a guard that looks like the thing and is not.

    **A per-tenant Stripe binding.** One webhook secret serves every company, so
    anyone holding it can mint an event for any of them. The replay is closed
    (globally unique event ids) and the route now refuses a product that is not
    operating, but the BINDING needs the company's own Stripe account id on the
    product row, captured in the connect flow, plus a per-account secret. It
    cannot be verified against real Stripe from here, which is the reason it is
    not half-built. **Trigger:** the first company connecting its own Stripe
    account through a Connect flow.

    **A nonce-based CSP.** `script-src` still carries `'unsafe-inline'`. Doing
    it properly means a per-request nonce on 14 inline `<script>` blocks AND
    rewriting 37 inline event handlers, which nonces do not cover. Half of it is
    worse than none: a policy that looks strict and still admits the sink.
    **Trigger:** do it as one piece, with a test that fails on a new inline
    handler.

    **A consent that cannot be granted.** `cross_company_patterns` gates the
    write to `decision_patterns` and is in the TypeScript union but NOT in
    migration 041's CHECK, so `recordConsent` throws for it and nothing has
    written that table since the gate landed. Making it grantable OPENS A
    CROSS-COMPANY DATA FLOW, and the owner's answer on §13 keeps cross-company
    contribution explicitly opt-in with broad release as counsel debt. **This is
    an owner decision, not a repair** — and until it is taken, the readers are
    correct to find an empty table.

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

### Cohort analysis has no producing half, and it was being sold

**What exists:** the `cohorts` table, the cohorts page, `GET
/api/products/:id/cohorts`, a per-channel breakdown, a latest-cohort summary and
a retention-deviation stressor. All of it reads.

**What does not:** anything that WRITES a cohort's activation or retention for a
customer company. The table's only production writer is Foundry's own signup
webhook, writing Foundry's own product's `founder_count`. Ten outcome columns
have no writer anywhere.

**What was claimed:** the Investor-Ready upgrade page promised "Retention Curves
— Day 7, 14, 30, 60, 90 retention by acquisition period and channel", "Channel
Attribution" and "Historical Comparison … Deviations trigger stressors
automatically", and the pricing page listed "Cohort analysis" as a capability of
a $399/month tier. Both are corrected: the upgrade page now says what exists and
says plainly that there is no path for reporting cohort retention today, and the
pricing bullet no longer lists it.

**The decision, which is the owner's:** either an ingestion path is built — the
obvious one derives cohorts from the customers a company already reports through
`POST /api/v1/customers`, grouping by `signed_up_at` and reading `last_active_at`
for retention, which invents nothing — or the surfaces come out. What must not
happen is a third cycle of readers rendering a `DEFAULT 0` as a measurement.

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
