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

## Done

| Item | What | Commit |
|---|---|---|
| A1 | Etsy's own vacation flag is read beside the owner's word | `9fcd4cff` |
| A2 + B8 | The shop is read the moment it comes back; a closed test says it is waiting on Etsy | `9fcd4cff` |
| B4 | The Brief warns 14 days before Etsy's refresh permission ends | `61cb94d0` |
| A3 + A4 | Rehearsals: the model down; the owner away while a buyer waits | `f7b176ac` |
| G6 | `npm run check` from about 22 minutes to 10.5 | `6a76b6e6` |
| D1 | Each product type's sourced facts, its unknowns, and what can serve it | `582c0438` |
| B2 | The listing Etsy shows is checked against the sealed offer's price, and against being listed at all | this commit |

## Next

Next in order: B3 (the listing's file matches the version Foundry built, as
far as the API shows it), B1 (one per-task qualification record, extending
`qualification.ts`), then E1 (the deliberation against one strong model, on
frozen cases). D2, which venues can sell which forms, waits on sources Foundry
can actually read: Etsy refuses automated fetches.

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
