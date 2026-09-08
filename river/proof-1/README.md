# Proof 1 — Massachusetts Commercial Millwork Bid Brief

Owner direction received 2026-09-07; ported onto the production lineage 2026-09-08 (owner decision: Option A). This directory is the human-readable record of one bounded real experiment: a $29 one-time pilot brief of current public bid notices relevant to cabinet and millwork shops in Massachusetts, offered once each to up to 25 businesses the owner has reviewed, under a $100 allowance and a seven-day window, settled by what the world does at a Stripe Payment Link.

**Engineering readiness is not commercial evidence.** Everything here is ready to run; nothing here has met a real buyer. The rehearsal in `tests/unit/the-first-real-experiment-runs-by-hand.test.ts` proves the loop end to end against stubbed providers; it is not commercial evidence and is never recorded as such.

| File | What it is |
|---|---|
| `brief.md` | The deliverable: 13 open COMMBUYS notices screened from 952, with dates, contacts, links, explicit coverage limits. Pull date 2026-09-07. The quality gate refuses to deliver it once it is older than seven days; re-pull and run `node scripts/embed-proof-1.mjs` to refresh. |
| `participants.md` | 23 candidate businesses with published B2B contacts and the owner conflict-review column. Loaded as pending recipients; the review happens in the app, not in this file. |
| `outreach.md` | The rules the one message follows, and how offers, deliveries and refunds are carried. |
| `outreach-template.md` | The message body Foundry sends, once, per approved recipient. `[PAYMENT LINK]` and `{Business name}` are filled in. |
| `evidence.md` | Grounding observations, the prediction, the rights basis, data handling. |

The brief and the template are embedded into `src/services/venture/proof-1-content.ts` by `scripts/embed-proof-1.mjs` so the seed runs where only `dist/` exists; a test fails if the embedded copy drifts from these files.

## Where it lives in the institution

Proof 1 is the first real **venture experiment**, not a separate kind of thing. `src/services/venture/proof-1.ts` (`seedProof1`, idempotent per owner; CLI `experiment:seed-proof1 <owner>`) writes ordinary rows:

- a candidate under his search (`venture_opportunities`), the claim it rests on (`market_claims`) and the four public observations behind it (`market_observations`), the unknown the test answers (`market_unknowns`);
- the experiment (`venture_experiments`) with its sealed rule `{event: delivery, at_least 1, out_of offer_delivered, at_most 25, within 7 days}` — the paid event is the **delivery**, so a bounced, refunded purchase never validates the test — a $100 cost, and `needs_workshop = 0` (the brief exists; no computer is opened);
- the 23 businesses as `experiment_recipients`, every one pending; the brief, the offer text and the offer's shape as `experiment_materials`.

Nothing is sent, spent or permitted by seeding.

## The owner's three acts, on his phone

Open Foundry → the test appears on Home under **Waiting on you** as "a real test", and under **Experiments**. Its page lists exactly what is still his; everything else Foundry does.

1. **Review who may be contacted.** Every candidate with its published contact and source. Exclude your employer and any relationship where a message could create an employment, confidentiality or other conflict (a reason is kept). Then "The rest are fine". A business with only a web form is never contacted unless you add a legitimate published email on its row.
2. **Email sending.** Enter an address on your own domain, your name, and the Resend API key for that domain. Foundry asks the provider whether the domain is verified before accepting it. Messages go out as *you*, from your address; replies reach your inbox; nothing ever goes out from a Foundry address.
3. **Allow.** The page states what that permits: up to $100; one message each to the approved businesses it can reach; the $29 one-time offer; delivery after payment; refunds of undelivered or returned purchases; the automatic stops; and that you can stop it at any time. Allowing it creates no standing permission. Allow is refused, by the rows, while any prerequisite is missing.

Allowing writes three exact acts under three ask-first boundaries scoped to the test's own asset: the **campaign** (write once to each reviewed business, the offer as written), the **placement** (create the tagged $29 one-time Payment Link on your Stripe account, over its precise parameters) and the **refund** (return a purchase reported at this test's exposure that could not be delivered or that the buyer returns). Foundry then creates the link, places the offer, and the hourly hand (`experiment_hand_tick`) carries everything else: paced offers, delivery receipts as `offer_delivered` events, purchases through the existing Stripe webhook into what is owed, quality-checked deliveries, bounce refunds, the buyer's own refund link, the sealed rule, and taking the link down when the test settles. Every message crosses the ordinary door, which resolves the act it runs under from the rows and never from the caller.

From then on the page is observational: reach, money, the rules, what was learned, exceptions that need you, and a timeline of what actually happened with the row each line is read from.

## What stays irreducibly human

- The conflict review: Foundry does not know your employer or relationships and will not guess.
- Your sending address and its provider key; your Stripe account holds the link (Foundry creates it; you may paste one you made, checked against the same contract).
- `FOUNDRY_ENABLE_MONEY_TOOLS=true` in the deployment, so refunds can move; without it a refund is recorded and shown as needing you.
- Stopping it, if you choose to.

Recovery commands (operator, not the founder product): `experiment:seed-proof1`, `experiment:tick`, `experiment:status`.
