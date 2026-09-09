# Founder Experience

## Primary architecture

```text
TODAY | ASK | COMPANY | ACTIVITY | CONTROL
```

- **TODAY:** what changed, what matters, and the smallest justified attention request.
- **ASK:** natural-language inquiry and instruction grounded in company evidence.
- **COMPANY:** responsibilities, commitments, state, strategy, evidence, and unknowns.
- **ACTIVITY:** decisions, plans, execution receipts, outcomes, reconciliation, and learning.
- **CONTROL:** understandable and revocable authority, budgets, constraints, escalation, and data controls.

Ordinary founders should not need ontology terms such as Claim, Judgment, or ActionReceipt. Interfaces translate the institution into direct language while preserving precise semantics underneath. They must distinguish recommendation, planned work, attempted work, ambiguous effect, and verified outcome.

## Natural-language governance

Natural-language policy is input, not executable authority. It compiles into deterministic, inspectable policy with scope, actor, company, action class, consequence, budget, duration, escalation, and revocation. Ambiguity fails closed. Authority expansion always requires explicit confirmation; no model, tool caller, or ControlPath may confirm itself.

## Attention and responsibility

Founder interruption must have an institutional reason, consequence, deadline, evidence, and a clear response. Batch low-consequence attention. Human and physical tasks use the same responsibility, commitment, receipt, outcome, and learning semantics as machine work. Every surface should reveal current responsibility-transfer state without implying that visibility or competence equals operational authority.

## People who are not the founder

Some of what Foundry does reaches somebody who never chose it — a customer, a
supplier, a person a notice is about. The founder's interface is not their
interface, and they are not represented by it.

Two obligations follow, and only two for now. A constraint such a person has
recorded — most concretely, having asked not to be contacted — binds Foundry at
the governed boundary regardless of what the founder authorises. And where
consequence and applicable rules demand notice, explanation, correction or
redress, the architecture must have somewhere to put them.

The second is a design rule, not a description: today only correction exists,
as the constraint itself. `IMPLEMENTATION_STATE.md` records which of the four
are real. Neither obligation is a general appeals process, and neither may be
inferred from prose: a person's constraint is a recorded fact.

## Truthful representation of new companies

A company Foundry helped create is described as a hypothesis until reality
provides evidence. Surfaces distinguish *what was built* from *what was
observed*, and never present generated presentation as traction, customers or
outcomes.

## Owner-absence test

The institution should support a seven-day owner absence without making activity
look like outcome. On return, the smallest trustworthy summary distinguishes:

```text
HANDLED | CHANGED | NEEDS YOU | DELIBERATELY NOT DONE | STILL OPEN
```

Every item retains evidence, effect certainty, responsibility, and any deadline.
This is a proof target for reduced founder dependency, not a claim that current
surfaces or operations already satisfy it.

## The River in the surfaces (owner direction 2026-09-07, ported 2026-09-08)

The cockpit's questions map onto the owner's existing places rather than a second application: *Are things okay?* *What materially changed?* and *What genuinely needs me?* are Home (`/foundry`), where everything waiting on him — acts, advice, things noticed, and now a real test — is one queue with one tap each; *What is being tested or learned?* is the experiment's own place (`/foundry/experiments/:id`, listed at `/foundry/experiments`); economic structure and evidence are the company places under Portfolio; authority, budgets and standing policy are Controls and each company's Authority dial. Activity on a test is epistemically typed (Observed, Concluded, Planned, Authorized, Attempted, Verified, Learned) and every line names the row it was read from.

**Doctrine.** Autonomous by default. Observable always. Controllable on demand. Deep institution, shallow interface; shallow must not mean hidden. **Owner absence must never mean owner blindness.** Watch → inspect → intervene: a test shows its state by default, opens to why it exists, its evidence, recipients, message, budget, authority, outcomes and stop rules, and offers the owner's real levers — exclude a business, connect his sender, allow, stop. Intervention is never forced and autonomy is never invisibility.

**Interruption contract.** The first such interruption exists: an undecided real test asks for its own allowance and window, states its sealed rule and grounding, says exactly what Allow permits (three exact acts, no standing permission), and is refused — by the rows, not only by the page — while a prerequisite is missing. Recurring approvals never become standing authority.

**Plain language, precise underneath.** Rungs, counterparties, validity and act ids stay behind "Details"; the default reads "10 businesses have received the offer; no one has paid yet", "Allow — up to $100.00", "Stopped by you". Nothing is stored for the screen: one derivation (`services/founder/experiment-view.ts`) reads the rows that govern, so there is no second state machine.

**No runbook-only owner actions.** Every routine owner decision a live test needs has a route under `/foundry`; the CLI (`experiment:*`) is an operator and recovery ControlPath, not the founder product. The buyer's refund is the buyer's own act through a signed link in the delivery.

**Mobile is a proof target.** `scripts/measure-mobile.mts` renders the experiment page and its review list in the state that matters most (everything in place, Allow on screen) at the five iPhone widths, at 100% and 200% text, and fails on a pixel of horizontal overflow or a line under the fixed bars.

## The Workshop in the owner's surfaces (2026-09-09)

`/foundry/public-workshop` is one place answering the questions an owner asks
about something operating publicly in his name: is the site up, is the provider
connected, does mail go out as the Workshop and come back to him, which
experiments are public and in what state, who has said no, what is owed to
customers, what was changed at the provider and how to reverse it. Each reading
comes from the world rather than from a stored belief, and the last reading is
kept so a provider that cannot be reached right now does not blank the page.

Two things are his alone and are asked for as prerequisites rather than
invented: the postal address commercial mail must carry (never his home address
by default), and anything published about him personally. A missing prerequisite
appears in the same "waiting on you" queue as everything else, with one link.

On an experiment's page, a "Public page" section shows its permanent address,
whether the world was seen to carry it, when, a preview of exactly what would be
published, and — while the test could still write to anyone — every reason the
publication gate would refuse to let it.

The pause is stated in the owner's terms: it stops new offers, placements and
tests, and it does not touch deliveries, refunds, the public record or the
contact path. The page says which of those is true while it is on.
