# The next product after the Bid Decision Workbook: a decision dossier

**Prepared 28 September 2026, from the owner's handoff of the same day.** The
handoff's research is not stored in this repository, because it names his
other businesses; its method and its public sources are carried here.

This file decides nothing. It makes one owner decision reviewable: which
adjacent product, if any, earns a test after Experiment 002 (the $14 Bid
Decision Workbook on Etsy). **"Build none" is a valid outcome.** No listing,
spend, contact or publication follows from anything written here.

## How to read the evidence columns

Every claim is in exactly one of four columns, and they are never mixed:

- **Observed**: seen by somebody, with the date and source. Marketplace
  listings are observations of *supply and offer language only*. They say
  nothing about sales, conversion, refunds or profit.
- **Inferred**: reasoned from something observed. The reasoning is named.
- **Assumed**: taken as a working premise because nothing yet tests it.
- **Unknown**: not known, and said so. Never filled in by default.

Grades follow `ECONOMICS.md`: A is the platform's own rule, B a practitioner's
numbers, C without numbers, D vendor promotion (refused). A single public
forum post is C at best.

## The first question outranks this dossier

The handoff: *"whether a stranger can find one exact promise, pay, receive the
right version, use it successfully, and be helped when reality diverges."*

Experiment 002 has not yet been able to ask it. The shop has been hidden from
Etsy search since 25 September (Developer Mode), and the restore is Etsy's to
confirm. Until one buyer relationship has run end to end, **a second product
multiplies obligations faster than it adds evidence.** That is why this
dossier prepares a decision rather than a build.

## The candidates

### A03 — Small-trade margin postmortem ("estimate versus actual")

| Field | Value |
|---|---|
| Buyer | A one- to five-person contractor or maker who quotes jobs and learns the margin too late |
| Task | After a job, see which quoted assumptions cost margin, and what the next quote would have needed |
| Promise | Enter the quote and the actuals; see contribution, variance by category, and one assumption to revisit |
| Non-promise | Not bookkeeping, not tax advice, not a market price, and no prediction of the next job |
| Free substitute | Free job-costing templates (for example, Archdesk's published template); a blank sheet |
| **Observed** | Paid job-cost spreadsheets are listed on Etsy (handoff research, 28 Sep; supply only, grade C). A free job-costing template is published (grade C). |
| **Inferred** | The free sheets record costs. None of those sampled explains *why* a job missed or what to change, so an explanation is the only plausible paid difference. |
| **Assumed** | That a small shop can retrieve its own quote and actual hours for a finished job. |
| **Unknown** | Whether anybody pays for the explanation; whether actual hours exist on paper at all; the support burden. |
| Rights | An original workbook; no third-party content. |
| Test window | To be set by the owner after Experiment 002 settles. Never overlapping its audience. |
| Oracle | Hand-worked fixtures: normal, loss, change-approved, missing hours, supplier credit, zero revenue, unit mismatch (refused), rounding. The generator is never its own oracle. |
| **Prototype** | `a03/job-review-v0.1.0.xlsx`, digest in `a03/MANIFEST.md`. Built by `products/recipes/job-review.ts`, not listed, and `template_file` stays unmakeable. |
| **Checked** | Every result cell in nine hand-worked cases (`tests/fixtures/job-review-by-hand.ts`), executed from the formulas as written in the file by an evaluator in the test, never by the generator. The same nine cases were recalculated by LibreOffice 24.2 on 28 September: 85 cells, all agree (`a03/RECALCULATED.md`). Two deliberate formula mutations were caught. The same inputs give the same bytes. |
| **Not checked (proof debt)** | Excel, Numbers and Google Sheets; whether sheet protection and the "0 or more" validation behave in them; opening on a phone; and whether anybody can supply the inputs, which is the question the buyer-use test asks. |
| Buyer-use test | The owner reconstructs 2–3 of his own completed jobs without coaching; if possible, a second shop does one. Time, errors, and whether a different decision followed are recorded. |
| Distribution | Etsy search is assumed, not shown. It shares Experiment 002's venue and audience, which is a concentration. |
| Direct costs | Etsy fees as recorded for Experiment 002; production time is Foundry's recipe plus the owner's review minutes. |
| Stop rule | Stop if a free sheet serves as well, or if buyers cannot supply the inputs. |
| Decision owner | The owner. |

### A05 — Supplier quote normalizer

| Field | Value |
|---|---|
| Task | Compare nominally equivalent supplier quotes after units, freight, waste, minimums and lead time |
| **Observed** | Nothing specific to this task in the sampled supply (handoff research). |
| **Assumed** | That real quotes are similar enough to enter in a structured way. |
| **Unknown** | Whether three real quotes can be entered in under ten minutes without a wrong ranking. |
| Stop rule | Stop if a plain manual comparison is as good, or if specifications are too heterogeneous to enter safely. |

### B01 (revised) — Lumber-yard purchase planner

| Field | Value |
|---|---|
| Task | Turn a cut list and a rack of random-width rough boards into a defensible buying plan, with an uncertainty range |
| **Observed** | Free board-foot calculators and cut-list optimisers exist (handoff research, grade C). Paid cut-list tools are listed on Etsy (supply only). One public forum post describes the random-width problem (a single qualitative signal, grade C). |
| **Inferred** | Plain board-foot arithmetic is a commodity. Only the random-width, defect-aware purchase decision might be worth paying for. |
| **Unknown** | Whether a spreadsheet can improve a decision that is partly visual, at the yard. |
| Different buyer | Woodshop makers, not contractors. That lowers concentration by audience, not by venue. |
| Stop rule | Stop if free tools plus five minutes do the same job, or if the required inputs overwhelm the maker. |

### Improve A01 instead

A second product on the same venue is premature if Experiment 002 shows **no
qualified exposure**. In that case the binding constraint is distribution,
not product, and the next unit of work is a findability or channel question.

### A licensing path

Offering a proven tool to a trade association or publisher is a different
acquisition mechanism. There is no partner, no demand and no contract, so it
is recorded only as a rival to compare once a product has shown value.

### Hold the money

This is the default when no candidate beats its free substitute at an
affordable test cost.

### Build none

A successful outcome if the evidence says so. It is recorded here so that
choosing it is not mistaken for inaction.

## What would change this

These come from the handoff. The first Experiment 002 result names the binding
constraint:
- **No qualified arrival**: work on distribution, not a second workbook.
- **Visits but objections to the task**: test a different contractor problem.
- **Buyers already use a free tool**: move to another cluster, and do not
  bundle weak products.
- **A qualified partner**: compare licensing with marketplace listing.

## The decision to be put to the owner

It is recorded as PENDING 27 in `docs/foundry-institution/OWNER_DECISIONS_PENDING.md`:
**A03, a rival, none, or wait for Experiment 002.** Nothing is listed, uploaded
or granted by preparing it.

### What he is asked to do first

Open `a03/job-review-v0.1.0.xlsx`, overwrite the invented example with two or
three of his own finished jobs, and note for each:
- the minutes it took;
- anything he could not fill in, and why;
- anything the file said that was wrong or unclear;
- whether it changed what he would quote next time.

If none of his jobs has actual hours on paper, that is the answer to the
assumption above, and A03 stops there.

### The draft listing, if he chooses A03

Written only from what was checked. It is a draft: Foundry publishes nothing.

> **Job review: estimate versus actual (spreadsheet)**
>
> After a job is finished, enter what you quoted, any approved changes, and what
> the materials, hours, subcontractors and other costs really were. The sheet
> shows the contribution you planned and the one you got, where the job moved
> line by line, and the price that would have kept your planned contribution on
> these costs.
>
> Blank cells stay "unknown" instead of counting as zero. At zero revenue the
> margin says "undefined". Formulas are locked; only the yellow cells take input.
>
> What it is not: bookkeeping, tax advice, a market price, or a prediction of
> your next job.
>
> Works in: LibreOffice Calc (checked). *[Excel and Google Sheets are named here
> only after they are checked.]*
>
> Digital download. On a phone, download from a browser: Etsy's app cannot
> download digital purchases (You → Purchases → Download Files on etsy.com).

The price is not proposed here. He sets it; Experiment 002's result will be the
only price evidence Foundry has.

### The support envelope

- **Questions**: answered in Etsy messages at the frequency he has stated on the
  connection page (A1). If he has stated none, absence is not covered, and the
  absence test says so.
- **A wrong result**: a corrected file gets a new version number. Buyers of the
  old version are found from their order records (A3) and sent the correction.
  No file is ever replaced silently.
- **Refunds**: through Etsy, by him, as for Experiment 002.
- **What it will not do**: custom formulas, other currencies or units, or
  bookkeeping help.

### The rivals, as they stand today

- **A05**: no prototype, no oracle. It needs a supplier-quote corpus Foundry
  does not have.
- **B01 revised**: needs physical verification that no file recipe can supply.
- **Improve A01**: waits on Experiment 002's first findable month.
- **Licensing**: no partner is on record.
- **Hold the money** or **build none**: valid. They cost nothing but time.
