# Foundry roadmap

Written 27 September 2026, when the owner asked where development should go
next. It follows the integrated plan's order: care before origination, access
before output, and each proof earned before the next. Every item names who has
to act:
- **[code]**: buildable and testable against doubles;
- **[owner]**: a decision or an account action that only the owner can take;
- **[world]**: needs a real buyer or real time.

Items marked **[code]** follow the campaign discipline: tests red first, the
full check, `[deploy-private]`, production read back, then maturity and proof
debt in `MATURITY_MAP.md`. This file is kept current as items close. A closed
item is recorded here with its commit; what it proved, and what it did not, is
in the maturity map.

**How to read this file (28 September 2026).** The Done table below is
authoritative. Sections A–J further down are the original 27 September list:
several of their items are closed, and each closed one is recorded in the
table, not struck through there. Do not execute them in order.

The level above this list is `STRATEGY.md`, which is doctrine, not a build
list. The current external brief is the owner's handoff of 28 September on
digital products. It is not stored here, because it names his other
businesses. Its method is carried into `STRATEGY.md` and
`river/proof-3-candidates/`. The handoff's sequence governs what comes next:
- reconcile the record;
- close the first buyer relationship;
- choose one adjacent product because buyer evidence earns it;
- build one file recipe;
- publish only through existing authority;
- measure a portfolio, not a count of products.

## Done

| Item | What | Commit |
|---|---|---|
| A1 | Etsy's own vacation flag is read beside the owner's word | `9fcd4cff` |
| A2 + B8 | The shop is read the moment it comes back; a closed test says it is waiting on Etsy | `9fcd4cff` |
| B4 | The Brief warns 14 days before Etsy's refresh permission ends | `61cb94d0` |
| A3 + A4 | Rehearsals: the model down; the owner away while a buyer waits | `f7b176ac` |
| G6 | `npm run check` from about 22 minutes to 10.5 | `6a76b6e6` |
| D1 | Each product type's sourced facts, its unknowns, and what can serve it | `582c0438` |
| B2 | The listing Etsy shows is checked against the sealed offer's price, and against being listed at all | `4ca70f81` |
| B2b | A window in which Etsy showed another price, or no listing, is not a verdict | `3f3991ea` |
| B3 | The file on the listing is the one Foundry built, by size, as Etsy reports it | `4742ed7c` |
| G3 | Every loop the Brief watches says when its work failed | `d7564ea5` |
| B6 | An unread fee is unknown, never zero | found already done (P1-F, case 10) |
| C6 | The refund-reserve question (PENDING 26) comes back at the tenth settled sale | `93fc7ff4` |
| B1 | What Etsy last showed, for every listing test, in one place on the connection page | `e00874f7` |
| A5 | Preview a Controls change before it binds | found largely done: authority and typed rules confirm; the charter page recomputes before signing |
| E2 | A lesson knows which later designs read it | `3890328c` |
| E2b | A design says when a lesson it read has since stopped standing | `317ec986` |
| G4 | A past qualification is not inherited by another shop or a new grant | `5263ccb9` |
| G5 | Each day's copy is restored and read the day it is made; the owner can rehearse any copy with one command | `b4632b66` |
| C3 | The owner enters Etsy's weekly views and visits | found already done: the "What the venue reports" form on a live listing test |
| D6 | The owner's own minutes on a test, entered by him; a day without an entry is unknown, not zero | `2cf4483c` |
| A9 | The prompt shield measured on 24 prose attacks: 1 caught before, 14 after, every miss named | `63e8f62c` |
| A6 + A7 | An outreach asset answers "what has it been shown to do" and "what if it is interrupted" | `7c00cf25` |
| B5 | When Etsy rate-limits a read, Foundry waits as long as Etsy asked and concludes nothing meanwhile | `dd1c9111` |
| F4 (+ F1 preparation) | Ask answers all five comprehension questions, from the money page's own readers | `73fe05d6` |
| D4 | Each sale names who took its fee (Etsy, not "Stripe"), and the margin says what it leaves out | `789cab7b` |
| A8 | J1 and J3 walked on a 390px phone: 4 taps / 4 screens and 5 taps / 5 screens, no overflow — and the walk found a direction the door did not hear | `51d643e2` |
| Handoff A0 | `OBJECTIVE.md` said the $29 brief was "sold"; the ledger says 0 payments. Corrected with a dated amendment; this file's reading order stated | `9110a79d` |
| Handoff A1 | Who checks Etsy's buyer messages, and how often: said by the owner, read by the absence test, the asset's record and the connection page | `9110a79d` |
| Handoff A2 | The buyer can get the file: the owner's acts carry the browser-download answer (Etsy's app cannot download), with its source and date | `d1992eeb` |
| Handoff A3 | Each venue order keeps which file its listing held when it sold; "not known" when no reading came before the sale | `d1992eeb` |
| Handoff A4 | A decision dossier for the next product (A03, A05, B01, improving A01, licensing, hold, none), in `river/proof-3-candidates/` | `d1992eeb` |
| Handoff A5 | One file recipe, the A03 job review, as a prototype for the owner's decision: a dependency-free deterministic XLSX writer, nine cases worked by hand and executed from the file's own formulas, recalculated by LibreOffice (85 cells agree). Not listed; `template_file` stays unmakeable | this commit |
| Handoff A6 | The decision made reviewable: the file and its digest, a draft listing written only from what was checked, the support envelope, the rivals. PENDING 27 (the first number neither series uses) | this commit |
| Handoff A7 | Commercial evidence CE0–CE4 read from rows on each test's page and in the operating contract's first answer; never raised by the owner's own purchase, a refund or an open dispute; CE5–CE6 never claimed | this commit |
| Strategy | `STRATEGY.md`: 96 items of doctrine (the 88 first drafted, sharpened by the handoff, and eight from it), not a product backlog | `ca96f51f` |
| Capital C0 | The two legacy trading repositories audited: ten handoff findings confirmed, two new (a normal CDF off by up to 3.7 points; a restricted price feed), two reproduced against their own source, both draft PRs' tests run | `679886a0` |
| Capital C1–C3 | A read-only research loop on Kalshi's 15-minute BTC contracts: rules archived by digest, point-in-time snapshots, two forecasts sealed before each window closes, simulated fills that must reproduce from their book, official results imported (historical fallback), evaluation with a verdict ladder that has no "trade" rung. Structurally unable to order | `679886a0` |
| Capital C4–C5 | `/foundry/money/research`, a reading under Economics that counts nothing; ECONOMICS amended; `capital/CAPITAL_RESEARCH.md`; PENDING 28 (the old bots may still be running) | `679886a0` |
| Capital C6 | The legacy repositories dissolved by the owner's decision: both draft PRs closed unmerged with their reasons, the retirement recorded, `kalshi-genius`'s last machine destroyed after a GET was found to start it LIVE on the production account (volume and secrets kept); key revocation and archiving left to him (PENDING 28) | this commit |
| E3 | "No sales" split into its causes | found already done where observable: a hidden shop, an unreadable venue, and a listing inactive or at another price each void a silent window (B2b). A missing file does not stop a sale, so it is a readiness and care failure, not a cause of silence (B3). A broken checkout is not observable to a read-only app. |

## Next

**H1 is blocked on the record, not on code (28 September 2026).** An in-app
sheet of open decisions would have to read `OWNER_DECISIONS_PENDING.md`, and
that record is not safe to render yet. Its header says "five pending" while
the body holds many more. Its "§14 answered", "§15 RESOLVED" and "§25 RESOLVED"
refer to different questions than the headings "PENDING 14", "PENDING 15" and
"PENDING 25". And whether some items are settled, such as whether the charter
(PENDING 17) was signed, lives in production data I do not read. The next step
is to reconcile the record: one numbering, and a status line on every item,
confirmed by the owner. Then the sheet can be built on it.

Next in order: E1 (the deliberation against one strong model, on frozen
cases) needs real model calls and is the owner's spend to authorise, so the
code-only work next is E2 (a
lesson's lifecycle: source, contrary evidence, expiry, the decisions that used
it). D2 waits on sources Foundry can read.

## A. Pay the proof debt already written down (code only)

1. [code] Read Etsy's `is_vacation` and shop state in `readTheShop` (`src/services/senses/readers/etsy-shop.ts`). The reading is compared with the owner's own statement in `findability.ts` and never replaces it; a disagreement is shown to him.
2. [code] When a test's observation window closed while Etsy couldn't be read, show "waiting on Etsy since DATE" on the experiment and the Brief, not silence (`outcome.ts` `settleFromTheWorld`, `health.ts`).
3. [code] Rehearsal B, the AI model provider unavailable. Tie together, in one timeline test, the pieces that already handle it separately:
   - the Brief still tells the truth;
   - Ask and research wait instead of guessing;
   - mail is marked `unreachable`;
   - no "all clear" appears.
4. [code] Rehearsal C, the owner away while a buyer is owed a remedy. Across 7 simulated days:
   - new offers stay paused (`hand.ts`);
   - the absence check stays unsafe (`absence-test.ts`);
   - the deadline and the last safe time to act are shown.
5. [code] Let the owner preview a change on the Controls forms (limits, spending allowances, the charter), not only on the "say it" route. The last change must stay in force until he confirms.
6. [code] Answer the seven operating-contract questions (`operating-contract.ts`) for Workshop and outreach assets. Question 3 currently answers "not assessed yet".
7. [code] Replace question 6's "nothing to recover" with real recovery states for the operations that can happen (refund, delivery, reads).
8. [code] Measure journeys 1 and 3 on a 390px-wide phone screen (journey 3 currently runs through HTTP requests, not a browser). Record the tap count and the number of screens for each.
9. [code] The protection against instructions hidden in untrusted text (`prompt-shield.ts`) is a list of known patterns. Test it against 20 or more adversarial samples written as plain prose inside the evidence block, record the misses, and tighten only what the misses justify.
10. [owner] Decide whether a test may be sealed on evidence older than some number of days. Nothing does this today, and nobody has asked for it.
11. [owner] Save something once on the phone after more than a minute on the page. This proves the sign-in session survives on his real device.

## B. Etsy qualification: E2, task #85 (code prepares, reality confirms)

1. [code] A per-task qualification record: account read, listing identity, file identity, receipts read, fee visibility, help route, recovery. Each check carries its date and the condition that downgrades it (extend `qualification.ts`, don't build a parallel one).
2. [code] Check that the listing Etsy reports matches the sealed offer: title, price and state, with any difference named.
3. [code] Check that the listing's digital file matches the version Foundry built (name and size, as far as the API shows them). If it doesn't, the listing is "not the product we tested".
4. [code] Token lifecycle:
   - verify that refresh works;
   - warn before the token expires;
   - downgrade the qualification when it fails, never silently.
5. [code] When Etsy rate-limits a read, back off and record "not read yet" rather than an error.
6. [code] Fee visibility: when the granted permissions can't see fees, the fee shows as unknown, never as zero. Requesting wider access is the owner's decision.
7. [code] Etsy Messages can't be read. Put the human route ("check messages on Etsy") on the asset's page, in the Brief whenever a buyer might be waiting, and in the absence reading.
8. [code] When the owner taps "Buyers can find it again", run a read immediately and show the result on the same page.
9. [world] The first real read of the restored shop, recorded as observed from Etsy.
10. [world] A first natural paid order, if one happens, recorded and looked after. It is never staged.
11. [owner] Tell me the date Etsy confirms the restore, and answer "No, it's hidden" until then.

## C. The first asset as a real product (proposals for the owner; nothing is published)

1. [code] A listing review of title, tags, thumbnail and description against Etsy search conventions. The output is a recommendation the owner can act on, because Foundry has no write access to Etsy.
2. [code] A sealed price-test design for the owner to approve. It sets the stopping rule, the affordable loss, and what result would change the next decision.
3. [code] A place for the owner to enter weekly views and visits from Etsy's Stats, labelled `owner_entered`, so that "no sale" has a count of how many people could have bought.
4. [code] A help page for the workbook's buyers, linked inside the file itself.
5. [code] A version policy: what a buyer gets when the workbook is revised, and a record of which version each buyer bought.
6. [code] A trigger for the refund-reserve question (PENDING 26) at the tenth settled sale. It raises the question again; it decides nothing.
7. [world] The first 30 days of the listing actually findable, which is the Proof 3 window.

## D. An economic engine that finds buyers before it builds (plan §6)

1. [code] Turn each economic form into decision knowledge. For each form, record, with a source and grade for every claim:
   - the customers and the job they need done;
   - pricing patterns and rights;
   - which channels and venues can sell it;
   - the service burden;
   - failure and exit conditions;
   - what is observed versus assumed;
   - which current capability can serve it.

   Vendor lists like the PDF stay at grade D.
2. [code] Record which venues can sell which forms (Etsy digital listings, the Workshop page, others) as sourced facts, not assumptions.
3. [code] Before anything new is built, require the design to compare it with:
   - improving the existing listing;
   - an adjacent buyer;
   - a new channel;
   - licensing;
   - holding the cash.

   Check `probe-design.ts` for which of these alternatives it already requires.
4. [code] Contribution per sale after fees, refunds, acquisition cost and variable service cost, with unknown inputs shown as unknown. Every surface uses the same time period.
5. [code] Portfolio operating economics: hosting plus AI-model cost per period against contribution over the same period.
6. [code] Record the owner's minutes per task (entered by him, optional). Proof 3 needs this number and nothing records it today.
7. [code] Freeze the baseline: a marketplace plus an ordinary spreadsheet, costed as the simpler way to run this without Foundry.
8. [code] Each new slice states its expected benefit to the owner or to the economics, and the condition under which it would be removed. Add this to the maturity-map template.
9. [code] Check every break-even figure on every surface: each one must be worded as a threshold that depends on buyers actually being reachable.
10. [code] Check every surface for three separate figures: a reserve is not an expense, a sale is not a bank deposit, and a charge is not revenue.

## E. Intelligence that improves decisions (plan §7)

1. [code] On frozen cases, compare the multi-perspective design deliberation with one strong model alone. Measure consequential misses, unsupported claims, cost, and time. Narrow the deliberation if it adds only prose.
2. [code] Give each lesson a lifecycle: source, context, contrary evidence, the condition that would invalidate it, an expiry, and the decisions that used it (`lessonsFor` in `forge.ts`).
3. [code] Split "no sales" into its distinct causes:
   - already distinguished: hidden shop, unreadable venue;
   - still to add: listing inactive or sold out, file missing, checkout broken.
4. [code] A template for measuring what transfers to a second product: buyer access, research, production, setup, care. It stays empty until there is a second product.
5. [code] When late evidence arrives, the current reading changes on every surface and the original prediction stays untouched. Test this with one timeline across Brief, the record, Ask, and the experiment.
6. [code] Ask names its sources and how fresh they are, whenever the answer rests on a reading.

## F. Owning Foundry on an iPhone (plan §8)

1. [owner] The five-question comprehension test, done on his own phone:
   - What is owed?
   - What reached the bank?
   - What may Foundry spend?
   - What is Foundry doing?
   - What must I do?

   Count the taps, the time taken, and the misreadings.
2. [code] Portfolio view: contribution for a stated period, buyer access, care still outstanding, dependence, and what's being decided, with one tap to see where each figure comes from.
3. [code] Direction view: show how a stated preference changes search and ranking, and state plainly that it grants no authority.
4. [code] Ask agrees with the screens. A test plants a contradiction, and the test fails if Ask and the Brief disagree.
5. [code] An accessibility pass: VoiceOver labels, dark-mode contrast, touch targets of at least 44px.
6. [code] Home-screen install, plus a "last known state" page that is honest about its age when the phone is offline.
7. [owner] Push notifications only for duties that only the owner can do and that are due now, never for research activity. This is his decision.

## G. Authority, resilience, and how complex Foundry is (plan §9)

1. [code] Cost the dormant surfaces left over from the multi-founder, multi-tenant and subscription design: routes, jobs, tables, tests, and runtime cost. Mark them dormant and delete nothing.
2. [code] Freeze those surfaces behind the private-owner mode where that is safe, and measure the check time it saves.
3. [code] Check every scheduled job: each one reports a failed business effect as a failure, extending the case-8 fix to every loop in `jobs/index.ts`.
4. [code] A past qualification is never inherited when the permissions or the account change. Test this directly.
5. [code] A backup-and-restore script with verification. The owner runs it; I don't read production.
6. [code] Cut `npm run check` from about 20 minutes to under 10:
   - reuse a template database;
   - shard the tests;
   - find duplicate test files among the 634.
7. [code] Audit the database schema: check the snapshot after 353 migrations, re-run the write-only-column audit, and mark unused tables dormant.
8. [owner] PENDING 24: move sign-in to Clerk's production instance. I'll prepare the checklist; the account action is his.
9. [owner] A marketplace exception to the "every product has a Workshop page" rule. It stays a proposal until he approves it.

## H. Decisions only the owner can make

1. [owner] One sheet on the phone with every open decision: PENDING 19, 20, 21, 22, 24 and 26. Each shows what it would change and what happens if he does nothing. [code] builds the sheet; he decides.
2. [owner] Whether Foundry should ever have write access to Etsy. My recommendation is no, until Proof 3.

## I. Proofs 3–5 (earned, never scheduled)

1. [world] Proof 3 report for the first 30 findable days: exposure, contribution, how much of the time Etsy could be read, owner minutes, and dependence on Etsy.
2. [code] Compare three choices: improving the first asset, a second product, and doing nothing.
3. [owner] Proof 4, a second asset, only if buyers can be reached and there is capacity to support them. It could be an adjacent product (another contractor tool in the same shop) or one on an independent channel. The two answer different questions.
4. [code] Freeze the baseline before any second launch.
5. [world] Proof 5, allocating across several products, is deferred until several products are actually running.

## J. Deliberately not doing

- No always-on Bayesian controller, bandit allocator, agent society, or self-modification.
- No write access to Etsy, and no staged orders to earn a maturity label.
- No sales figures from the vendor PDF used as evidence. No product type ever causes a candidate on its own.
- No new ledger, dashboard truth source, or registry parallel to the existing records.
- No production database reads.
- No credential changes.
- No publishing, spending, or messaging without the owner's grant.

---

## How each item is verified

- **[code] items:**
  - a failing test first;
  - the focused suites;
  - the full check logged to a file with its exit code captured;
  - a `[deploy-private]` commit, with production read back through `/internal/health`;
  - an entry in the progress record stating its maturity and proof debt.
- **[world] and [owner] items:** recorded only when they actually happen, with the date and who said so.
- **Order of work:** the "Recommended next five" first, one commit each. After each, re-read the progress record's proof debt before choosing the next item.

The list has 71 items.
