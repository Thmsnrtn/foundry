# Proof 2 — Bid Decision Workbook on Etsy

Owner direction received 2026-09-15 after the Experiment 002 design and preflight (`private-foundry-future` plan, sections "Experiment 002" and "Final preflight"). This directory is the human-readable record of the second bounded real experiment: a $14 one-time bid-decision workbook for small contractors, listed by the owner himself on Etsy under Apex Micro with the AI-assistance disclosure, with no promotion, no email and no outreach of any kind, under a $25 allowance and a thirty-day window, settled by what the venue reports.

**Engineering readiness is not commercial evidence.** Everything here is ready to seed; nothing here has met a buyer.

| File | What it is |
|---|---|
| `bid-decision-workbook.xlsx` | The deliverable. Four sheets: Start here, Settings, Bids, Summary. Every number a formula; no macros; imports into Google Sheets unchanged. Its SHA-256 is embedded so the seed can name the exact file. |
| `how-to.md` | The one-page how-to a buyer receives alongside the file (also on the workbook's first sheet). |
| `listing.md` | The listing as it would be published: title, description, what it is not, format, refunds, who made it with the AI-assistance disclosure, tags. |
| `privacy-policy.md` | The shop privacy policy stating exactly what Apex Micro sees and keeps. |
| `owner-acts.md` | Only what Thomas must do himself, in order. |
| `evidence.md` | Grounding observations from Etsy's own pages and the comparable listings, what could not be verified, rights, data handling. |

## How it differs from Proof 1

Proof 1 pushed one offer to twenty-one businesses by cold email through Foundry's hand. Proof 2 is pull: the owner lists one artifact where buyers already search, and Foundry contacts nobody, publishes nothing, and spends nothing. What Foundry does is design, seal, govern, record and settle. The venue's own statistics are the funnel Proof 1 never had.

## Where it lives in the institution

`src/services/venture/proof-2.ts` (`seedProof2`, idempotent per owner; CLI `experiment:seed-proof2 <owner>`) writes ordinary rows: a candidate under his search, the claim and the observations behind it, the unknown, the experiment with its sealed rule `{event: payment, at_least 1, within 30 days}` and a $25 cost, the materials (deliverable, listing text as the offer template, the offer's shape with its listing plan), and the recorded design with rival interpretations, refused exchanges, costs and stop conditions.

The owner's acts are in `owner-acts.md`. Approving on `/foundry/experiments/:id` seals the design, sets the allowance, and records two standing boundaries on the experimental asset: nobody is written to, and Foundry publishes nothing. Pasting the listing URL places the exposure (`provider = etsy`) and starts the clock. Readings and orders are entered on the same page and become observations, outcome events and ledger rows. Settlement is by the sealed rule.

Recovery commands (operator, not the owner's product): `experiment:seed-proof2`, `experiment:status`.
