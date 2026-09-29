# The executive review: Foundry and the private portfolio at their best

*29 September 2026. The owner asked for Foundry to be looked at "like an elite team of
C-suite executives [and] elite developers", with a plan to bring it "to the highest
level of functionality and ability to work this private portfolio to the very best it
can possibly be, meticulously and exhaustively". This is that review. It is a proposal:
it grants no authority, spends nothing, and builds nothing by itself. Each item says who
decides it, what it costs, and what would prove it wrong.*

**How it was made.**
- The evidence is the repository at `c5518c14` plus the multi-venue work of 29 September
  (capital C7). It covers every governing document in this directory, the code and its
  gates, and production facts already recorded here.
- Two independent read-only digests were taken: one of the business and portfolio
  record, one of the engineering state. Their claims were spot-checked against the
  source before use.
- No number below is estimated unless it says so. "Not recorded" means the record does
  not say.
- The seats are those the owner named:
  - the executives: CEO, CFO, COO, CPO, growth, general counsel and risk;
  - the developers: architecture, reliability, security, data, front end and quality.

---

## 1. The verdict, on one page

**What Foundry is today.** An unusually well-governed machine:
- about 146,000 lines of TypeScript in 462 files;
- 401 migrations (highest 365) and 340 tables;
- 78 scheduled jobs;
- about 5,800 tests in 678 files;
- 42 chained quality gates, each proven able to fail.

It can refuse unsafe acts, recover its own database copy every day, explain every figure
it shows, and prove that its trading research cannot place an order.

**What the portfolio is today.** Economically, almost nothing yet:
- **External payments ever: zero.** Experiment 001 wrote to 21 buyers, got 0 replies
  and 0 payments, and settled "surprised" on 19 September. Its reply path was not
  routed during the window, so even that null is narrower than it looks (PENDING 21).
- **Listed products: one.** The $14 Bid Decision Workbook on Etsy. It has been
  **hidden from Etsy search since 25 September** (Developer Mode), and no restore date is
  recorded.
- **Unlisted prototypes: one.** The A03 job review, whose arithmetic is proven and whose
  usefulness is not.
- **Trading:** research only, off until the owner begins it. Its first real finding is
  that Kalshi and Polymarket settled the same way in 96 of 96 windows: one exposure,
  not two.
- **Running cost:** model spend was $14.88 over the fortnight to 14 September, capped at
  $1 a day until a charter is signed. Hosting cost is **not recorded anywhere**.

**The diagnosis every seat agreed on.** The ratio of institution to economy is
inverted:
- The binding constraint is not engineering. It is **market contact** (one hidden
  listing, no traffic, no distribution path that Foundry controls) and **owner
  decisions** (about twenty open, several blocking).
- Every week spent adding governance before the first external payment makes the
  machine more expensive to carry and teaches it nothing about buyers.
- The handoff of 28 September said so ("do the engineering work this opportunity
  earns"). This review agrees, and goes one step further: **for the next phase,
  engineering should be subordinate to the first payment.** The exceptions are four
  kinds of work: safety, continuity, truth of the record, and removing drag.

**The one number to move.** First, *an unmatched external buyer pays and receives the
product*. After that, *contribution per hour of owner attention*. Everything below is
ranked by how directly it moves one of those two, or protects the ability to.

**What is genuinely excellent, and must be kept.**
- Refusal by construction: authority is never inferred from capability.
- Evidence discipline: sealed predictions, observed-versus-claimed, E0–E6 and CE0–CE6.
- Recoverability: a daily copy, restored the day it is made.
- Honesty on the owner's screens.

These are Foundry's moat as an instrument for a single owner. The plan below spends
them; it does not dilute them.

---

## 2. Ten decisions for the owner, in order

Each takes minutes to an hour. Together they unblock more than any code in this plan.

| # | Decision | Why now | Cost | Record |
|---|---|---|---|---|
| 1 | **Close the legacy exposure.** Revoke the old Kalshi key, revoke the temporary Fly token pasted in chat, rotate the Anthropic key that was stored on kalshi-genius, archive both repositories | A GET started a LIVE bot on 29 September. The key still exists as a secret, and the token sits in a transcript | 20 minutes | PENDING 28 |
| 2 | **Move sign-in off Clerk's development instance** | A reset of a dev instance locks the owner out while obligations run unattended | About 1 hour, plus DNS | PENDING 24 |
| 3 | **Get the Etsy shop findable, and record the date** | Every portfolio horizon waits on it. Proof 3's 30 findable days cannot start until it happens | Etsy's time; one message | PENDING 25, ROADMAP B11 |
| 4 | **Sign the charter, or say plainly that Foundry stays advisory** | Without it nothing seals, thinking is capped at $1 a day, and the River "does not start flowing" | 30 minutes of reading | PENDING 17 |
| 5 | **Rule on Experiment 001's null**: stands, void, or sound | The precedent reader refuses to re-ask the question until you do | 10 minutes | PENDING 21 |
| 6 | **Try the A03 file on two or three of your own finished jobs**, uncoached, and write down what it told you | This is the cheapest buyer-use evidence available, and it decides PENDING 27 on evidence rather than taste | 1 hour | PENDING 27 |
| 7 | **Begin both trading questions** (Kalshi and Polymarket) | Free and read-only; reaches 200 resolved windows in about two days; answers the old bots' claim once and for all | One button each | CAPITAL_RESEARCH |
| 8 | **Decide on reading your Kalshi account** with a new read-only key | The only way to know whether the old bots ever traded real money | 15 minutes, plus allowing one permission | PENDING 29 |
| 9 | **Decide whether the repository stays public** | It carries your name in 73 files, your address in 4, and an Etsy keystring in history. Making it private costs Actions minutes | 15 minutes | PENDING 23 |
| 10 | **Correct the AI sub-processor disclosure** to name OpenRouter, and OpenAI for voice | It is a factual error in a privacy statement; correcting a fact needs no legal theory | 10 minutes, then counsel later | PENDING 15 |

Everything else in the decisions file can wait for the events that make it matter. The
review recommends leaving the remaining items where they are, and **not** raising new
ones until these ten are closed.

---

## 3. The seats

Each seat gives findings (with where they come from), what it recommends, what it
refuses, and the measure it would be held to.

### 3.1 CEO: strategy and capital allocation

**Findings.**
- The priority order the owner set on 1 September (Constitution) was:
  1. a usable Private Foundry;
  2. Foundry operating itself;
  3. real owner-controlled companies;
  4. research and origination.

  The first is largely achieved. The second is blocked on the charter. The third has
  not started: AcreOS is "owner deferred".
- STRATEGY's horizons are event-gated, which is right. But **none of the event gates
  has fired**: no findable Etsy days, no first payment, and no owner decisions recorded
  against S6, S55, S69, S74, S75, S78 or S85.
- The falsifiers are good, but one has no clock. "Six months with no external event"
  does not say when the six months began.

**Recommendations.**
- **C-1. Declare one objective for the next phase:** first external payment plus
  delivery. Until it happens:
  - no new product types;
  - no new venues;
  - no new governance subsystems.
  Engineering work must name how it serves the payment, the owner's safety, continuity,
  or the truth of the record.
- **C-2. Start the falsifier clock today** (29 September 2026). The deadline is
  29 March 2027. If no unmatched external payment has occurred by then, the portfolio
  thesis ("River of Nickels") is reviewed from the top, not patched.
- **C-3. Two lanes, clearly separated.**
  - **The River** (products, buyers and cash) is the primary lane.
  - **Capital research** is a side lane: free, read-only and time-boxed. It earns
    attention only if its verdict reaches `survived_holdout_owner_review`. If
    evaluation shows `market_is_better` or `no_net_edge` twice in a row at 200 or more
    markets, stop it, with the reason recorded.
- **C-4. Decide the fate of the third priority.** Either give AcreOS, or whichever real
  company it is, a date on which Foundry first reads it, or strike it from the
  Constitution's list. A priority that never moves distorts the others.

**Refuses.**
- Any plan that grows the product count faster than the milestones (STRATEGY
  falsifier).
- Selling Foundry itself.
- Adding venues to the trading research before its first question is answered.

**Held to:** days from today to the first external payment, and whether the owner's ten
decisions are closed within two weeks.

### 3.2 CFO: economics, cost and cash

**Findings.**
- There is no single line for **what Foundry costs to carry**.
  - Model spend is measured: $14.88 for the fortnight to 14 September, rising from
    21¢ to 169¢ a day, with about 70% naming no purpose at the time. `check-ai-attribution`
    now requires a purpose on every call.
  - Hosting is not recorded: Fly (one shared-cpu-1x machine with 1 GB of memory and a
    1 GB volume), Cloudflare, domains and Clerk. Nor are GitHub Actions minutes, the
    Etsy shop fee, or a legal budget.
- The hold rule `v > λ·a` cannot be evaluated: `a` (recurring owner minutes) has never
  been entered, and `λ` (the owner's value per minute) is not stated.
- A $14 sale nets $12.22 after Etsy fees. The $1,000-a-week sensitivity in STRATEGY S93
  needs about 139 sales a month at $39. That is a **sensitivity, not a forecast**, and
  it shows how far away the target is.
- The refund reserve recommendation (hold 100% until 10 settled sales) means the first
  asset cannot distribute anything for a long time. That is correct at this size.
- In trading, no capital is at risk and none should be. The 96/96 finding means that
  any future cross-venue position is one bet, not a hedge.

**Recommendations.**
- **F-1. One monthly carrying-cost figure**, with each line's source named:
  - Fly and volume;
  - Cloudflare;
  - domains;
  - Clerk;
  - model spend;
  - Actions minutes;
  - Etsy fees;
  - the owner's minutes.

  Unknown lines show as unknown, never as zero. Shown on Economics, beside
  contribution. (ROADMAP D5 / STRATEGY S13 already name it; build it now, because it is
  cheap and it is the denominator of everything.)
- **F-2. Ask the owner for `λ` once**, as a range, and start the owner-minutes log with
  a two-tap entry. Without both, the hold rule is decoration.
- **F-3. Pre-register the next price test** (STRATEGY B15), changing one variable at a
  time. Do not run it until the listing is findable.
- **F-4. Four ledgers, as the handoff asks:** receipts; variable costs and refunds;
  maintenance and owner time; shared costs. Report contribution per owner-hour and per
  dollar at risk. The code shape exists; the entries do not.

**Refuses.**
- Any figure that mixes simulated trading results with money.
- Deposits described as income.
- A forecast presented as a plan.

**Held to:** a carrying-cost figure with fewer than two unknown lines within one month,
and contribution per owner-hour once there is a sale.

### 3.3 COO: operations, continuity and the owner's time

**Findings.**
- **Single point of failure: one machine, one volume.**
  - The daily copy is restored the day it is made (G5), which is excellent. But **the
    copies sit on the same volume as the database.** Losing the volume loses every
    copy. Fly's snapshots (14 days) are the only off-machine protection, and a full
    stop-swap-start recovery has never been rehearsed.
- **There is no external liveness witness.** `/internal/health` returns 200 even when it
  reports "degraded" (a stopped scheduler or failing loops). A dead or wedged machine
  is noticed only when the owner happens to look.
- A failing job is recorded in `job_health`, with the error class but not the message,
  and is not retried. The Brief shows it; nothing sends it.
- Buyer care on Etsy rests on the owner's stated checking habit, because Foundry cannot
  read Etsy messages. That is honest (A1), but it is the portfolio's only customer
  channel.
- The owner-absence ladder (7, then 30, then 90 days) has never been demonstrated.

**Recommendations.**
- **O-1. An off-machine copy.** After the daily restore rehearsal passes, send the copy,
  encrypted, to object storage outside Fly, such as Cloudflare R2, which the Workshop
  already uses. Keep 30 days. Rehearse the restore from *there* monthly, including one
  full rehearsal into a fresh machine.
- **O-2. An external witness**, outside Fly, that reads `/internal/health` every 5–10
  minutes. It tells the owner (email, and a phone notification if available) on:
  - no answer;
  - a stale commit after a deploy;
  - `degraded` for more than an hour;
  - a daily job with no success in 26 hours.
  Also make `/internal/health` return a distinct non-200 for "scheduler stopped", so
  any witness can see it without parsing.
- **O-3. A weekly owner view** in five sets (STRATEGY I58–I65): earned and settled;
  owed to buyers; marketplace visibility; work deliberately stopped; one decision that
  would change the economics. One screen, on the phone, under two minutes.
- **O-4. The first absence rehearsal for real:** a 7-day absence, planned, with care
  covered in writing. Afterwards, compare what Foundry said with what happened.

**Refuses.**
- A second machine or a managed database before the first payment. The single machine
  is fine at this size if the copy leaves it.

**Held to:**
- off-machine copies restored monthly with zero failures;
- the time between failure and the owner knowing, measured by one staged failure;
- owner minutes per week.

### 3.4 CPO: the products and the portfolio

**Findings.**
- One product exists in the world, the $14 Bid Decision Workbook. Its sealed test
  (Experiment 002: one payment within 30 days, no promotion) cannot mean anything while
  the listing is hidden. **The 30 days should be counted in findable days**, and that
  is already the design.
- A03 (the estimate-versus-actual job review) is built and correct, but its buyer-use
  test has not been run. It shares Experiment 002's venue and audience, so it
  concentrates rather than diversifies.
- The first coherent product line is named (STRATEGY S91: inquiry, bid, supplier,
  change, review, next bid). It would be a bundle only after each part proves useful
  on its own.
- The Workshop at apexmicro.ai is the portfolio's home and its only owned surface. It
  does not yet send anyone to the product.

**Recommendations.**
- **P-1. Keep Experiment 002 sealed and untouched.** Count findable days from the
  restore date the owner records. Do not change its price, copy or promotion while it
  runs.
- **P-2. Run the A03 buyer-use protocol now** (decision 6). Then decide PENDING 27 on
  what it shows:
  - If the file changed a decision the owner would have made, A03 is the second
    product, listed **after** Experiment 002 settles.
  - If it did not, "build none" is a valid answer.
- **P-3. One owned path to the product.** Put a dated, truthful product page on the
  Workshop (apexmicro.ai), with the same promise and non-promise as the listing,
  linking to it. That creates an acquisition source Foundry can observe (`owned_site`)
  that does not depend on Etsy search. Doing it needs the owner's word on public copy,
  and it must **not** change Experiment 002's sealed "no promotion" rule. So it waits
  until Experiment 002 settles, or is sealed as its own experiment.
- **P-4. The asset state machine** (STRATEGY S89: observed → candidate → designed →
  tested → approved → live → maintained → paused → retired), shown on one page for the
  whole portfolio. Most of the states exist in code under different names; the page is
  what is missing.

**Refuses.**
- A second product before the first has a verdict.
- A catalogue of forty workbooks on one platform (STRATEGY F-series: one platform
  dependency).
- Selling trading signals or bots (CAPITAL_RESEARCH).

**Held to:**
- findable days;
- visits, and visits to purchase, once visible;
- the buyer-use result for A03.

### 3.5 Growth: distribution and revenue

**Findings.**
- Every acquisition path Foundry has used was either **outbound email to cold
  prospects** (Experiment 001: 0 of 19) or **marketplace search** (hidden). There is no
  path Foundry controls that has ever carried a buyer.
- There are no traffic readings. A manual form exists, but no entry has ever been made.
- The single consented audience ("send me more") hears nothing (PENDING 18).

**Recommendations.**
- **G-1. Record Etsy's own stats weekly**, by hand, until Etsy exposes them to the app:
  views, visits, favourites and orders. Enter them through the existing form. Two
  minutes a week; without it, "no sales" cannot be told apart from "no one saw it"
  (ROADMAP E3).
- **G-2. Answer PENDING 18.** The people who asked for more should hear when the
  product is findable. That is the cheapest distribution the portfolio has, and it is
  consented.
- **G-3. One non-marketplace channel, tested as an experiment** with a sealed rule and
  a small allowance. For example, the owner's own trade network, a relevant forum
  answered in the owner's voice, or a supplier's newsletter. Only one at a time, and
  never before Experiment 002 settles.
- **G-4. Acquisition labels on every order** (`venue_search`, `owned_site`, `partner`,
  `paid`, `direct_unknown`, `unresolved`), used only with the provider's evidence
  (STRATEGY G-series).

**Refuses.**
- Bought traffic before the product has converted anyone.
- Scraping.
- Any outreach not sealed as an experiment first.

**Held to:** the first buyer who arrived by a path Foundry can name.

### 3.6 General counsel and risk

**Findings.**
- The AI sub-processor statement is wrong. It names Anthropic, but traffic goes through
  OpenRouter, and voice through OpenAI (PENDING 15).
- Retention after erasure, audit-log length and the benchmark k are waiting on counsel
  (PENDING 9, 11 and 13). Interim positions are in force and recorded.
- Trading:
  - Kalshi is a CFTC-regulated US exchange.
  - Polymarket may restrict persons in some places, and whether the owner may trade
    there is **not established**.
  - Research on public data needs no permission; trading would.
- A public repository carries the owner's personal details (PENDING 23).

**Recommendations.**
- **L-1. Correct the factual disclosure now** (decision 10). Keep the counsel question
  separate.
- **L-2. Batch counsel's questions into one engagement** when there is a first sale:
  PENDING 9, 13 and 15, the Etsy terms for automated reads, and venue permission for
  trading. Before revenue, the budget does not justify it.
- **L-3. Keep execution out of Foundry.** The written, venue-specific mandate and the
  separate execution service in CAPITAL_RESEARCH stay the only route to an order. That
  is a legal protection as much as a safety one.

**Held to:** the number of statements on public surfaces that are false. The target is
zero, checked by the existing `truth:audit` gate.

### 3.7 Chief architect and developers

The developers' finding is blunt. The code is **well defended and hard to change**. That
cost is paid on every future slice, so reducing it counts as work that "removes drag".

**Findings, from the engineering digest, spot-checked.**

- **Very large files.**
  - `src/routes/dashboard/foundry-shell.ts` is 8,129 lines of server-rendered HTML in
    TypeScript, with 46 `: any` annotations.
  - `src/jobs/index.ts` is 4,271 lines; `consent.ts` 2,653; `letter.ts` 2,596.
  - The "three things called Foundry" rule caps the private product files below 12.
    That pushes code into ever-larger files, a tension between a boundary rule and
    maintainability.
- **Rows are untyped.** There are about 536 `as unknown as` casts and about 1,039
  `as Record<string, …>` row casts. Zod is used in 6 files. `tsconfig` is strict and has
  no `@ts-ignore`, but the database boundary is where types stop.
- **Pairs where one should do.** Two loggers, two encryption modules, two outbound paths
  (gateway and executor), `integration/` beside `integrations/`, `customer/` beside
  `customers/`. Stripe is called both through its SDK and through raw fetch. Resend is
  declared but unused.
- **Dependency currency.** `engines >=20`, and CI and the Dockerfile run Node 20, which
  reached end of life in April 2026. Also behind: vitest 1.6, `@libsql/client` 0.5 and
  `stripe` 14. `@clerk/clerk-sdk-node` is declared, but the code imports
  `@clerk/backend`, which arrives only transitively. `glob` is used but undeclared.
  `superfly/flyctl-actions@master` is unpinned. `npm audit` cannot fail CI (`|| true`).
- **Security, verified in the source.**
  - `scp/actions/executor.ts` `executeWebhook` checks the URL with `assertUrlSafe`, then
    calls plain `fetch`. The fetch **follows redirects and re-resolves DNS**, so a
    webhook can be redirected, or rebound, to an internal address after the check.
    `safeFetch` exists for exactly this.
  - `wisdom/network.ts` falls back to a literal HMAC key if `ENCRYPTION_KEY` is unset.
  - 17 mutating routes remain in the unguarded-POST baseline.
  - Rate limits are in memory, which is acceptable on one machine.
- **Dead weight.** Commercial Foundry's routes were deleted on 13 September, but many of
  its services remain, reached only by tests. 27 retired loops are kept in
  `RETIRED_LOOPS`. Three unread tables and 58 write-only columns are carried by
  baseline.
- **Test cost.** The full check takes about 10.5 minutes (441 seconds of tests across
  three processes). An intermittent libsql panic "qualifies every green claim"
  (IMPLEMENTATION_STATE).
- **The record drifts from the code.** IMPLEMENTATION_STATE's "Verified now" says 358
  migrations with 322 the highest; the truth is 401 with 365 the highest. Job counts
  are stated as 73, 75 and 88 in three places; the truth is 78. The live-frontier file
  stops on 25 September.

**Recommendations, in order.**
- **D-1. Close the webhook SSRF gap.** Send the webhook through `safeFetch` with
  `redirect: 'manual'`, and add a test that a redirect to `169.254.169.254` or to
  `localhost` is refused. Remove the literal HMAC fallback: fail at boot, as `env.ts`
  does for other secrets. Priority: first, since it is small and it is security.
- **D-2. The off-machine copy and the external witness** (O-1 and O-2). This is the
  developers' half of continuity.
- **D-3. Dependency currency, in one reviewed slice.**
  - Node 22 LTS in CI, the Dockerfile and `engines`.
  - Declare `@clerk/backend` and drop `clerk-sdk-node`; drop `resend`; declare `glob`.
  - Pin the flyctl action to a version.
  - Make `npm audit --audit-level=high` fail CI, with an allowlist file for accepted
    advisories.
  - Then vitest, `@libsql/client` and `stripe`, each behind the full check.
- **D-4. Records generated from code, not typed.** A small script writes the "Verified
  now" facts: migration count and highest, table count, job count by cadence, test
  count, gate count, deployed commit. A gate fails when the document disagrees. The
  same approach can check the decisions file: numbering unique, and each PENDING's
  status in one vocabulary. That ends a whole class of contradiction; the business
  digest found 14.
- **D-5. Typed rows at the boundary.** Add a small `row<T>(schema)` helper, using zod,
  already a dependency, for new and touched queries. Ratchet the `as unknown as` count
  down; it is never allowed to rise. No rewrite.
- **D-6. Split `foundry-shell.ts` by place**, moving code without changing behaviour.
  Revisit the private file-count rule so that it counts *places* (doors), not files. The
  rule's purpose, few private surfaces, survives; the 8,000-line file does not.
- **D-7. One of each.** One logger, one encryption module (keep `lib/crypto.ts` with
  rotation) and one outbound path. Migrate the executor's remaining callers to the
  gateway by shadow → compare → cutover → delete, as AGENTS.md requires.
- **D-8. Delete Commercial Foundry's orphaned services.** Anything reached only by
  tests, and not by any entry point, is removed with its tests. The branch
  `archive/commercial-foundry` keeps it. Expect a large reduction in lines and in test
  time.
- **D-9. The libsql panic, root-caused.** Reproduce it in a loop, bisect the client
  version, and fix or pin. "Flaky" is not a root cause.
- **D-10. Check time under 7 minutes**, by sharding on measured file time rather than
  file count, and by the deletions in D-8.
- **D-11. Retire the unguarded-POST baseline to zero.** Each of the 17 either gets
  `requireInstitutionOwner` or is deleted.

**Refuses.**
- A framework migration.
- A client-side SPA.
- Microservices.
- A second database.
- Any "platform" work before the first payment that is not on this list.

The server-rendered, one-machine, one-file-database shape is right for one owner.

**Held to:**
- zero open security findings;
- off-machine restore rehearsed monthly;
- the full check under 7 minutes;
- `as unknown as` count falling each month;
- zero drift between the record and the code.

### 3.8 Reliability engineering

Mostly covered by O-1, O-2, D-2 and D-9. In addition:
- **R-1. Job failures carry their message**, redacted by the existing masking, and a
  failed daily job retries once after 10 minutes before it is recorded as failed.
- **R-2. A deploy that fails its health read-back rolls back automatically** to the
  previous image. The workflow already waits for the commit, so it only needs to act on
  failure.
- **R-3. One staged failure a month**, rotating through:
  - the scheduler stopped;
  - the volume full;
  - the model provider down;
  - Etsy asking Foundry to wait;
  - Clerk down.

  Each has a written expectation, compared afterwards with what happened. The
  laboratory already does this in tests; this does it on the real machine, on a
  schedule.

### 3.9 Data and research engineering (including capital research)

**Findings.**
- The research instrument is sound:
  - forecasts sealed before the answer;
  - official results only;
  - simulated fills that must reproduce from their stored book;
  - a verdict ladder with no "trade" rung;
  - venues as a vocabulary (C7).
- The cross-venue reading exists but has one live window.
- The proxy model cannot run on Polymarket, which publishes no reference level.
- The 96/96 agreement is one day in one regime.

**Recommendations.**
- **T-1. Begin both questions** (decision 7) and let them reach 200 resolved windows.
  Evaluate. Report the verdict to the owner in words, with its digest.
- **T-2. Pre-register the cross-venue question as its own thesis**, with its own
  falsifier, when 200 paired windows exist:
  - Is the mean price gap after both fees positive?
  - How often do the results disagree?
  - Would the simulated pairs have been positive in both chronological halves?
  Nothing tuned on the data it is judged by.
- **T-3. Read the owner's Kalshi account at read scope** only if decision 8 says so. The
  design is in PENDING 29. It would reconcile simulated fills against real ones, and
  answer whether the old bots traded.
- **T-4. No new venue** until one of the two questions has a verdict. When one is added,
  prefer a venue whose question is *not* Bitcoin-in-15-minutes (for example, a weather
  or economic-release contract). The purpose of a second question is independence, and
  96/96 shows that the second venue on the same question did not provide it.
- **T-5. Never let the research's success change the rung.** Execution remains outside
  Foundry until:
  - the verdict survives;
  - an operational review of the execution design (CAPITAL_RESEARCH) is done;
  - the owner grants a written, venue-specific mandate.

### 3.10 Front end and the owner's phone

**Findings.** The phone journeys (J1 and J3) were walked at 390px on 28 September. The
research page added this week is long, at about 12 sections across two venues.

**Recommendations.**
- **U-1. Measure `/foundry/money/research` at 390px** with `scripts/measure-journeys.mts`.
  If it overflows or exceeds three screens before the first venue's verdict, fold each
  venue's detail behind its heading.
- **U-2. The weekly owner view** (O-3) is the one new screen this plan asks for. It
  must be readable in under two minutes on a phone.
- **U-3. Every screen answers "what do I need to do?" first.** The ten decisions above
  should appear on Home as a short list until they are closed.

### 3.11 Quality and truth

**Findings.** The gates are the strongest in any codebase this review has seen of its
size, and every gate is proven able to fail. Their weakness is that they gate the code
and not the record.

**Recommendations.**
- **Q-1.** Carry out D-4 (records checked against code).
- **Q-2. Reconcile the contradictions the business digest found**, in one commit:
  1. The decisions file's stale header and colliding section numbers.
  2. Experiment 002's CE0 versus CE1.
  3. "Etsy connected" versus "not connected".
  4. "Listing exists" versus "does not exist". This needs the owner's dated record of
     publication.
  5. The stale "Verified now".
  6. The live-frontier file ending on 25 September.
  7. ROADMAP "Next" naming completed work.
  8. The drift in Proof numbering.
  9. The Workshop page counts.
  10. The reply-path dates.
  11. Vacation flag versus Developer Mode.
  12. Repository visibility.
  13. OBJECTIVE's two "§8" headings.
  14. AcreOS's status.

  Where the truth needs the owner's word, the item says so and waits.

---

## 4. The plan, by events rather than dates

### Phase 0: this week (no event needed)

| Item | Who | Size |
|---|---|---|
| The ten owner decisions (§2), especially 1–5 | Owner | Hours in total |
| D-1: webhook SSRF and literal key fallback | Developers | Small |
| Q-2: reconcile the record; D-4: the record generated and gated | Developers | Medium |
| F-1: the carrying-cost figure | Developers, with owner-supplied numbers | Small |
| O-1 + O-2 (D-2): off-machine copy and external witness | Developers; owner chooses storage and notification | Medium |
| T-1: begin both research questions | Owner (one button each) | None |
| G-1: first weekly Etsy stats entry, once findable | Owner | Two minutes a week |

### Phase 1: from findable to first payment

The event that starts it: the owner records the date the Etsy shop is findable again.

- Experiment 002 runs its sealed 30 findable days untouched (P-1).
- The A03 buyer-use test is done and PENDING 27 decided (P-2).
- G-2: the consented audience hears that the product is findable.
- Developers carry out D-3 (dependency currency), D-7 (one of each), D-8 (delete the
  orphaned services), D-9 (the libsql panic) and D-10 (check time), each as its own
  slice with the full check.
- R-1 and R-2 (job messages and retry; automatic rollback).
- **What ends the phase:** a payment and delivery, or 30 findable days with none.

### Phase 2: from the first payment to repeated contribution

The event that starts it: the first unmatched external payment, delivered.

- Four ledgers with real entries (F-4); contribution per owner-hour shown.
- Care proven on a real order: delivery, a message answered within the stated
  interval, and a refund if one is asked for.
- The first 7-day absence rehearsal (O-4).
- One non-marketplace channel as a sealed experiment (G-3).
- Counsel engaged once, with the batched questions (L-2).
- A03 or its rival listed, if P-2 earned it.
- **What ends the phase:** three consecutive months of positive contribution after the
  owner's time, or the March 2027 falsifier review.

### Phase 3: the portfolio

The event that starts it: repeated contribution from one asset.

- The asset state machine page (P-4); concentration measured at four levels (venue,
  buyer segment, shared recipe, traffic source).
- A second independent asset, on a different venue or audience from the first.
- Allocation across assets by contribution per owner-hour, as a recommendation the
  owner accepts or refuses.
- The first real company (the Constitution's third priority) read by Foundry, if C-4
  gave it a date.
- Capital: execution is considered only if T-5's conditions hold, and never as a
  default.

**Throughout, and not gated:**
- D-5 (typed rows, as a ratchet), D-6 (split the shell file) and D-11 (unguarded
  POSTs to zero);
- R-3 (a staged failure a month);
- U-1 to U-3 (the owner's phone).

---

## 5. The scorecard

| Measure | Now | Target | Falsified if |
|---|---|---|---|
| External payments, delivered | 0 | ≥1 in Phase 1 | none by 29 March 2027 → review the thesis |
| Findable days for the listed product | 0 recorded since 25 September | 30 | the restore is never confirmed |
| Owner decisions open | about 20 | the ten in §2 closed within 14 days | still open at 30 days |
| Monthly carrying cost | not recorded | one figure, ≤2 unknown lines | still unknown at 30 days |
| Owner minutes per week (`a`) | never entered | entered weekly | not entered for 4 weeks |
| Off-machine restore | never | monthly, zero failures | a restore fails and is not root-caused |
| Failure-to-owner-knows | unbounded | < 15 minutes | a staged failure goes unnoticed |
| Open security findings | 2 verified (§3.7) | 0 | a new one ships |
| Full check time | about 10.5 minutes | < 7 minutes | it rises |
| `as unknown as` casts | about 536 | falling monthly | it rises |
| Record-versus-code drift | 14 contradictions | 0, gated | the gate is bypassed |
| Trading research | not begun | verdict at 200 windows per venue | a verdict of `market_is_better` or `no_net_edge` twice → stop, with the reason |

---

## 6. The risk register

| # | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| 1 | Legacy credentials used (Kalshi key, Fly token, Anthropic key) | Medium | High | Decision 1 | Owner |
| 2 | Owner locked out by a Clerk dev-instance reset | Low | High | Decision 2 | Owner |
| 3 | The volume is lost, and with it every copy | Low | Severe | O-1 | Developers |
| 4 | The machine dies unnoticed | Medium | High | O-2 | Developers |
| 5 | The Etsy shop is never restored, or is suspended | Medium | High | Decision 3; P-3 as the second path | Owner |
| 6 | A buyer's message goes unseen | Medium | Medium | The stated checking habit (A1); the weekly view | Owner |
| 7 | Webhook SSRF used through a standing order | Low | High | D-1 | Developers |
| 8 | The thesis fails slowly, with no one calling it | High | High | C-2's dated falsifier | CEO |
| 9 | Engineering keeps growing governance instead of revenue contact | High | Medium | C-1; the "refuses" lists | CEO, CTO |
| 10 | Personal details exposed by the public repository | Present | Medium | Decision 9 | Owner |
| 11 | A false privacy statement | Present | Medium | Decision 10; L-1 | Owner |
| 12 | Concentration on one venue (Etsy), and on one trading question | Present | Medium | P-3, G-3, T-4 | CPO |
| 13 | Unpatched dependencies on an end-of-life runtime | Present | Medium | D-3 | Developers |
| 14 | A research result read as a reason to trade | Low | High | T-5; a verdict ladder with no "trade" rung | Owner |
| 15 | The owner's time exceeds the portfolio's value (`v < λ·a`) | Unknown | High | F-2; O-3 | CFO |

---

## 7. What this review does not recommend

- A rewrite, a new framework, a client-side application or a second database.
- More autonomy before the charter is signed and a real order has been cared for end to
  end.
- More products, venues or channels before the first has a verdict.
- Any trading execution, automated sizing, or capital at risk.
- Selling Foundry, its signals, or its research.
- Hiring, or paid services, before revenue. Everything in Phase 0 and Phase 1 fits
  inside the existing machine plus, at most, a few dollars a month of object storage and
  a free external uptime check.

## 8. What would change this plan

- **A payment arrives.** Phase 2 starts, and the CFO's ledgers become the centre.
- **Etsy will not restore the shop.** The owned path (P-3) and a second marketplace
  become Phase 1's work, as a sealed experiment.
- **The A03 buyer-use test is striking.** A03 is listed as soon as Experiment 002
  settles, and the product line (S91) becomes the Phase 2 plan.
- **The trading research survives.** The owner reviews the evidence; the execution
  design is written and reviewed; nothing is built without the mandate. If the research
  fails, it stops, and its reason is kept.
- **The owner says Foundry's purpose has changed.** This document is superseded, and the
  Constitution is amended first.
