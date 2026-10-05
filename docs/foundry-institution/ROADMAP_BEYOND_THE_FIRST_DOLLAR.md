# Roadmap beyond the first dollar: advancing Foundry on every front

Written 5 October 2026, at the owner's request ("determine a roadmap of
advancing Foundry further in all aspects"). It sits on top of
`ROADMAP_2027.md` and does not replace it: the five milestones (M0–M5), the
thirteen lenses, the falsifier date (29 March 2027) and the rules in its Parts
V–VI still govern. This file says where each front goes next now that the
first tranche of the 90-day plan has shipped. It also says which work is
Foundry's and which is the owner's.

**The rule every item obeys.** Nothing counts unless it moves recurring
owner-minutes per asset down (A), calibration up (C), or cost per decision down
(D), or holds a bound (B). Every slice names its measure, the event that earns
it, and what deletes it. Something is deleted for everything added. Items are
tagged **[code]** (Foundry builds and proves it), **[owner]** (only the owner
can do it) or **[world]** (needs a buyer or real time).

---

## Where things stand (5 October 2026)

**Shipped this weekend and live:**
- R19, subscriptions that can always be stopped.
- R20, what a buyer pays for can always go out.
- R21, the money door moves only Foundry's own charges.
- R22, the privacy page is true.
- R23, an offer is placed only on true facts and the owner's decision.
- R24, acts cover their whole window and end with their charter.
- R52, renewals never reopen places.
- R26, Control says whether Foundry can sell on its own today (in this commit).

**Read from production on 5 October 2026:**
- The off-machine copy works.
- Clerk is still the development instance.
- `STRIPE_WEBHOOK_SECRET` is not set, so every priced offer is refused.
- The money switch is off.
- There is no Cloudflare analytics token.
- The Etsy shop is still hidden.
- No external dollar has arrived.

**The diagnosis has not changed; it has narrowed.** Foundry's machinery is
ahead of its world. Three owner acts stand between Foundry and a test that can
take money: the Stripe endpoint and its secret, the per-sale-minutes allowance,
and a charter with room. Two more stand between it and a test anyone sees:
Etsy restoring the shop, and search engines being told the pages exist.
Everything below is ordered so the software never runs ahead of those again.

---

## The strategic shift this roadmap recommends

**Lead with free tools; sell checked files.** The forge's default offer today
is a paid brief: a dated list of links. It is the weakest thing Foundry can
make:
- Its sources' terms limit what may be sold.
- Week two cannot be made yet.
- Nobody searches for "a brief".

The strongest pattern already in the code is a **free calculator on its own
page** (R15) beside a **checked file** (the A03 job-review workbook, with a
program oracle):
- Calculators are what people search for and share.
- They need no support.
- They compute in the browser and send nothing.
- They give each page a reason to be found.
- A checked workbook is what buyers already buy on Etsy, and a program can
  prove it correct before it is sold.

So:
1. **The default exchange becomes "free tool, paid file"** once PENDING 34
   (workbooks Foundry may make) is answered yes. Until then: free tool, paid
   brief, with discussion and directory sources only (R23).
2. **apexmicro.ai becomes the home of the tools**, and each tool links to the
   file that does the job properly. **Etsy becomes the shelf**: the same files,
   where buyers already search.
3. **Briefs become the second exchange**, used only where a re-pull makes week
   two real (R28).

This is a recommendation, not a decision. It changes what the forge proposes,
so it is put to the owner as **PENDING 36: lead with free tools and checked
files**.

---

## The fronts

### 1. What Foundry sells (products and offers)

| Next | Tag | Measure | Gate |
|---|---|---|---|
| Sell the already-checked A03 job-review file as a digest-pinned attachment (R56) | [code] | A | PENDING 27 = A03, and the owner's self-test |
| Program-checked workbooks: the formula oracle in shadow, then cutover (R42–R43) | [code] | A, C | PENDING 34 = yes |
| "Free tool, paid file" as one exchange the forge can design, with the tool's worked examples drawn from the file's own oracle | [code] | A | PENDING 36 |
| Week two of a brief made by re-pulling its sealed query within each source's terms (R28) | [code] | A | none |
| A fee floor: no price that is mostly fees; $3 chosen-price floor (R29) | [code] | B | **done, 5 Oct** |
| A product only after its buyer evidence earns it (S30): the second file is chosen from the first file's buyers' questions | [world] | C | M1 |
| Bundles, licensing and pay-per-use: only after a single file has sold twice | [owner] | none | M2 |

**Not on this front:** courses, coaching, services with a support queue,
anything with accounts, physical goods.

### 2. Being found (reach and distribution)

The binding constraint after placement. Ordered from cheapest to costliest.

| Next | Tag | Measure | Gate |
|---|---|---|---|
| Restore the Etsy shop; Etsy's written answer on whether a seller app may list in a live shop | [owner] | none | now |
| Search Console property and sitemap submitted once | [owner] | none | now |
| IndexNow on every verified page change, and a dated sitemap (R38) | [code] | D | **done, 5 Oct** |
| Free tools as the reason a page is found (front 1) | [code] | A | PENDING 36 |
| Etsy findability seen by Foundry, calibrated while hidden (R34); view and favourite counts kept as numbers (R37) | [code] | C | none |
| One paid reach lever for Experiment 002, chosen and paid by the owner, recorded with dates (R59) | [owner] | none | shop findable |
| An owned list: buyers and tool users who asked to hear more (PENDING 18), one plain email per new file | [code] | A | PENDING 18, M1 |
| Foundry-proposed paid tests inside the charter, with spend capped and cost per sale measured | [code] | D, B | M2, and the owner's charter line for ad spend |
| A second independent venue (Gumroad or similar), only after a file has sold on Etsy | [owner] | none | M4, the scope card |

**Refused on this front:** cold outreach, spam in communities, pages made only
to rank, buying reviews, anything that hides who is selling.

### 3. Reading what happened (measurement and learning)

| Next | Tag | Measure | Gate |
|---|---|---|---|
| Page opens per Workshop page from Cloudflare's counts, minus Foundry's own readbacks (R36) | [code] | C | Cloudflare analytics token [owner] |
| Checkout pages opened, as buy intent (R35) | [code] | C | none |
| A null nobody reached reads "not reached", never voided (R40, interim R40a) | [code] | C | decision (c) |
| The sealed test is the test that runs (R46); each settled test seals its next move (R47) | [code] | C | 5 reached tests |
| Forecasts sealed as probabilities and graded by Brier score (R48) | [code] | C | 5 reached tests |
| A deterministic scoreboard by arm steers what the forge proposes (R49) | [code] | C, D | 5 reached tests |
| Seed ideas from people asking to buy (R50) | [code] | C | M1 |
| Lessons that expire unless a later test confirms them | [code] | C | M2 |

### 4. Acting without the owner (autonomy and governance)

Autonomy is widened per task, by the owner, from evidence. Never per portfolio,
never by a model and never by confidence.

| Next | Tag | Measure | Gate |
|---|---|---|---|
| The money switch on, behind the bound door (R21 live) | [owner] | A | now |
| A standing refund-only act keeps "no time limit" after a window (R53) | [code] then [owner] tap | A | the money switch |
| Correspondence drafts, then ordinary after one reviewed week | [owner] | A | now |
| Tell the owner after each launch, as they chose (R30) | [code] | A | decision (d) |
| A paid delivery never stalls silently (R31) | [code] | B | **done, 5 Oct** |
| The autonomy ladder per task on Control, each rung earned by a held absence test | [code] | A | M3 |
| 7-day, then 30-day, then 90-day absence with a live asset | [world] | A | M3 → M5 |

### 5. Money (handling, tax and the owner's livelihood)

| Next | Tag | Measure | Gate |
|---|---|---|---|
| The first Stripe sale lands as one charge row with its fee, however it arrives (R25) | [code] | B | **done, 5 Oct** |
| Buyers see Apex Micro on their statement: suffix now, separate account before subscriptions (R54) | [code] | B | PENDING 33 |
| Tax: accept to N sales and record it, or Stripe Tax (R58) | [owner] then [code] | B | PENDING 35 |
| Payout reconciliation: every Stripe and Etsy payout matched to ledger rows | [code] | B | M1 |
| The four ledgers across three months; contribution per owner-hour and per dollar at risk | [code] | D | M2 |
| A draw rule the owner ratifies, and a distribution recorded from a real surplus with tax held | [owner] | none | M5 |
| Delete the legacy subscription price secrets from the deleted multi-user product | [owner] | B | an explicit yes |

### 6. The owner's time (experience on the phone)

| Next | Tag | Measure | Gate |
|---|---|---|---|
| "Can Foundry sell today?" first on Control (R26) | [code] | A | **done, 5 Oct** |
| Push to the phone for the few things that need the owner, through the gateway (RESOLVED 8) | [code] | A | none |
| One weekly email, sent only when the five sets changed; one sitting of 15 minutes or less | [code] | A | none |
| A set point for recurring owner-minutes on Control, with the distance shown | [code] | A | M2 |
| One week on the phone, reporting where it lied | [owner] | none | now |

### 7. Staying up (reliability and continuity)

| Next | Tag | Measure | Gate |
|---|---|---|---|
| A deploy does not cost a day: missed daily jobs re-run after a restart (R33a) | [code] | B | **done, 5 Oct** |
| A failing model door is loud; OpenRouter credits read daily (R33) | [code] | B | **done, 5 Oct** |
| Merge to `master` so the GitHub witness runs; push the archive tag | [owner] | B | an explicit "merge" |
| Clerk production instance (PENDING 24) | [owner] | B | the owner's choice |
| A monthly restore rehearsal from the off-machine copy, read back | [code] | B | none |
| Exit plans per provider (Fly, Stripe, Resend, Cloudflare, OpenRouter), each tested once | [code] | B | M3 |

### 8. Trust (security, privacy and legal)

| Next | Tag | Measure | Gate |
|---|---|---|---|
| Rotate the keys pasted in chat; revoke the old trading key (PENDING 12, 28) | [owner] | B | now |
| A restricted Stripe key for Foundry instead of the full secret key | [owner] | B | now |
| Counsel batch: retention (PENDING 9), benchmarks (13), the AI disclosure (15) | [owner] | B | before M2 |
| The privacy page's counting sentence, approved before R36 ships | [owner] | B | R36 |
| A quarterly adversarial review cell against the doors, the prompt shield and the public pages | [code] | B | none |

### 9. Thinking (intelligence and its cost)

| Next | Tag | Measure | Gate |
|---|---|---|---|
| The charter's thinking rate binds every venture call, priced at real rates; cost per sealed test beside expected net (R32) | [code] | D | none |
| Routing: the cheapest model that passes a frozen eval set does each job; the eval set is the gate | [code] | D | E1 (owner's spend) |
| The forge stops re-deliberating what the precedent reader already refuses | [code] | D | none |
| No forge cadence above one pass a day until the thinking bound is true | [code] | B | none |

### 10. The toolbox (what Foundry can use)

| Live today | Next | Later, gated |
|---|---|---|
| Stripe links, refunds and cancellations (bound door) | Stripe Tax (R58), statement descriptor (R54), restricted key | A separate Stripe account (PENDING 33a) |
| Resend email, delivery and replies | Push to the phone (ntfy or Web Push) through the gateway | — |
| Cloudflare: pages, DNS, KV, mail routing | Cloudflare analytics read (R36), IndexNow (R38) | Search Console read (owner OAuth) |
| Etsy read scope | Findability and counts (R34, R37) | Listing drafts and activation (R44–R45), hard-gated on Etsy's answer |
| OpenRouter and Anthropic models | A frozen eval set, routing | — |
| R2 off-machine copy, restore rehearsal | Monthly rehearsal | — |
| LibreOffice recalculation for workbooks | The formula oracle (R42) | Other file kinds, each with its own oracle |
| Kalshi and Polymarket, read-only | — | Paper only; any money path needs a new owner decision with evidence over many resolutions |

### 11. Simpler (architecture)

- **One deletion per slice** where there is anything left to delete. For
  example, the direct money-switch reads become one `moneyToolsOn()` (from
  R26's spec); and when a reader of the 21-day act era is gone, it is deleted.
- **Tables and jobs may not grow faster than the milestones.** If they do,
  stop adding.
- **Keep `npm run check` under 20 minutes** as the suite grows. Run suites in
  parallel before cutting any of them.

### 12. Foundry developing Foundry

- Each slice: a red law test, the full check, records, deploy, read back.
- A skeptic pass before any slice that has had none (R31, R33, R33a and
  Tranche 5).
- A review cell after every five slices: one owner-lens reader and one
  adversarial reader.
- Engineering is rationed to what the next event needs (`ROADMAP_2027.md`
  Part V).

---

## Phases, gated by events

| Phase | Entry | What happens | Exit |
|---|---|---|---|
| **P0: Unblock** (now, about 2 weeks) | — | The owner's acts below. Remaining Tranche 1 code: R25, R53, R33a, R38, R54 (on PENDING 33) | Control says "Yes" to "Can Foundry sell on its own today?" |
| **P1: The first findable windows** (to about mid-November) | P0 exit | Tranche 2 and 3 code: R27–R33, R34–R40. The first forge-made pages placed and counted. Experiment 002 findable on Etsy | 30 findable days on Etsy, or 5 placed Workshop pages with page-open readings |
| **P2: The first result (M1)** | A settled sale, or a graded null with its reach reading | Branch by the binding constraint (`ROADMAP_2027.md` H2). If reach failed, front 2. If the offer failed, one sealed price or offer test at a time. If a sale happened, care first | A second independent buyer, and contribution after care above zero for two months (M2) |
| **P3: Care without the owner (M3)** | M2 | Standing acts, correspondence at ordinary, a 7-day absence with a live asset | The absence test holds for 7 days on real rows |
| **P4: The second asset (M4)** | M3 | The second file chosen from the first's buyers; an independent acquisition path; the portfolio at 3–5 | A sale whose source is not the same venue's search |
| **P5: A livelihood component (M5)** | M4 | Four ledgers over 3 months; a ratified draw rule; a distribution from a surplus with tax held | A recorded distribution |

**Falsifier, 29 March 2027.** If no external payment has arrived, cut to the
smallest thing that reaches the world and put the operate-or-originate choice
to the owner as a dated decision.

---

## What only the owner can do (the irreducible list)

Each of these needs the owner's account, judgment or authority. Foundry cannot
and must not do them.

1. **Stripe:** keep one Foundry endpoint, enable the eight events, and add its
   signing secret to Fly as `STRIPE_WEBHOOK_SECRET`.
2. **Fly:** turn on the money switch (`FOUNDRY_ENABLE_MONEY_TOOLS=true`) and
   add the Cloudflare analytics token, in the same deploy and outside
   04:00–07:30 UTC.
3. **Cloudflare:** create the read-only Analytics token for apexmicro.ai.
4. **Etsy:** send the email asking to leave Developer Mode and for a written
   answer on listing from a seller app (text on the plan page).
5. **Google Search Console:** add the property and submit the sitemap.
6. **OpenRouter:** confirm at least 14 days of credits.
7. **Control taps:** correspondence to "drafts"; "Allow them, for every future
   offer" (PENDING 32); "Allow subscriptions" (PENDING 31); re-sign the charter
   for 90 days.
8. **Decisions:** PENDING 33 (whose name buyers see), 35 (tax), the interim
   null reading, launch notices while quiet, PENDING 27 (A03), 34 (workbooks),
   the scope card, and 36 (lead with free tools and checked files).
9. **When ready:** the Clerk production switch, key rotations, merging to
   `master` for the witness, and a week on the phone.
