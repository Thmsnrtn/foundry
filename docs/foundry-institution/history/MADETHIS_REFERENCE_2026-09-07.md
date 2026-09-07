# MadeThis as a reference, not a template

**Date:** 2026-09-07. **Question from the owner:** what if MadeThis becomes a
strong product, interaction and operating-model reference for Private
Foundry, without Foundry becoming a clone of it? **Method:** the public web
read first-hand (site, pricing, App Store listing, developer docs, the full
OpenAPI specification), a deep research pass with sources, and four
repository inventories of current Foundry (owner intent, adoption, the work
chain, the internal economy). Everything below about Foundry is grounded in
files at the integrated tip `437505b0`.

## What MadeThis is, underneath the copy

The site sells a persona: "your AI co-founder", "build a business that runs
itself", "grow while you sleep". The API sells something more honest and more
useful, and it is the part worth learning from. Four objects carry the whole
product:

1. **An assignment.** The owner assigns an *outcome* to a team member with a
   priority, a due date and a credit ceiling. "Omitted uses the platform
   default; the run is refused rather than run uncapped."
2. **A run.** Background work with a state, a spend, and "whether it needs the
   owner". Cancellable; "side effects stand".
3. **An attention item.** Questions, approvals and blocks waiting on the owner.
   The API may reject, answer or acknowledge one — "never approve": approving
   a consequential action happens only in a session signed in as the owner.
4. **A ledger.** "Team compute and external spend, with what it bought."

Around those: a *brief* ("status, team, and what needs the owner"), a
*capabilities* list ("connected, missing, disabled"), a *brain* ("the company
as our own agents see it"), a spend policy (auto-approve under N cents, above
which an action is *parked* with "NOTHING has been spent, published or sent"),
and a per-day credit cap that pauses autopilot. Consumer-side, all of it is one
chat where consequential steps arrive as cards to tap, a named persona, four
tabs, and a daily briefing.

## Why the owner would want it

- **The verb goes somewhere.** "Wire the checkout into the storefront" becomes a
  card in minutes. The product turns a sentence into queued work with a state
  and a cost, and shows it back.
- **Approval is one tap and one place.** Everything that could spend, publish
  or send parks in one queue with an expiry.
- **It is alive without being asked.** The persona says what it just did and
  what it will do next, and a milestone badge marks the first real thing.
- **Complexity is hidden well.** Stripe Connect, Meta Business Manager, DNS,
  deliverability and hosting never appear; the owner sees "Approve".
- **The developer surface is serious.** Idempotency keys, business-scoped keys,
  a CLI and an MCP server, `hint` and `next_action` on every response so an
  agent can drive it.

## What it hides that the owner is still liable for

A Stripe Connect sub-merchant on their platform with an undisclosed take;
ads run on their Meta assets with prepaid funds and a refund-shortfall field
in the data model; the business inbox on their subdomain; Apollo-sourced cold
email whose compliance is the owner's; generated sites carrying fabricated
social proof; a persona over several agents whose mistakes are billed in
credits with no published exchange rate; non-refundable fees and a $100
liability cap. Businesses are silos (own chat, own ledger, own analytics, no
portfolio view). "Bring in your existing business" is marketing; every
mechanism assumes rebuilding inside the platform. Nothing in the UI, API or
reviews kills an idea: the incentive is to keep every business consuming
credits.

## Foundry today, honestly

**Already better.** Evidence over narrative, with reality and standing on every
row; a situation chain that refuses to invent a number; boundaries in the
owner's words, enforced at the door; consequence rungs instead of a dollar
threshold; a responsibility ladder with evidence, authority and outcome; a
kill thesis and a graveyard; a legal surface recognised with grounds; sealed
predictions and world settlement; a portfolio that is a river and a map; no
persona, no take-rate, no credits.

**UI over capability Foundry already has.** Brief = the first screen.
Capabilities = senses and blind spots. Brain = the company page and its why.
Analytics = the numbers. Ledger = `allowanceFor` already sums thinking and
real spend on one cents axis per company. Approvals = proposed acts, advice,
noticed things, now in one Decisions address.

**Genuinely lacking.**
- *A verb had nowhere to go.* Seventeen owner sentences run through the real
  readers: only look/find, steering, stop, boundaries, spend caps, preferences
  and posture reach machinery. "Investigate it", "fix it", "handle it", "spend
  less here" fell to "I did not follow that" or were filed as what the company
  is for.
- *Work had no thread.* Situation → recommendation is the only forward link.
  Recommendations lead nowhere as rows; `proposeAct` has no production
  caller; experiments belong to opportunities, not companies; no table links a
  watch, an act or a test to the situation it exists for.
- *Perception dead-ends.* A connected Stripe sense is stored and probed
  hourly and never read; nothing pulls charges through it. Every reading path
  terminates before the institution. "Adopt AcreOS" produces a row and "I
  know it exists; that is all", and stays there.
- *Cognition has a price and no purpose.* Every model call is priced to the
  cent, attributed to company, founder, model and day — never to the
  experiment, act, workspace or unknown it served.
- *Hands.* No production effector builds a site, provisions an inbox, sends
  outbound or runs an ad. The capability and workshop frameworks exist; the
  adapters do not.

**Rejected, deliberately.** The co-founder persona and named agent workforce;
manual/assisted/autonomous as a global mode; a dollar threshold as the
authority model; credits as a product restriction and "unlimited" as
doctrine; fabricated social proof; business-generation for its own sake;
one-company silos; the platform-as-merchant structure.

## The single highest-leverage gap

**The institution had no object for what it has undertaken.** The first two
lacks above are one lack: the owner's request and the institution's own work
are the same missing row. MadeThis's four objects are that row seen from
four sides. Build it and the verbs have a home, the work has a thread, Show
Your Work has a deliberation recorded as it happened rather than assembled
afterwards, "what are you doing" has an answer that is rows, "stop that" has
something to stop, and cost has a purpose to attach to.

Perception (a sense that is read) is the second gap and is next; it is gated
on a provider adapter and real credentials, which is the owner's boundary,
and it becomes more valuable once what it feeds has a thread. The cognition
purpose key is the third: `(purpose_kind, purpose_id)` on
`ai_spend_reservations`, populated through the existing `SpendSubject`, joins
to `prediction_resolutions.(kind, prediction_id)` on one key; it needs a first
writer, and undertakings are that writer once a step calls a model.

## What was built: undertakings (migration 281)

`undertakings` — one thing the institution has taken on for one company:
`kind` (constitutional verbs: understand, investigate, grow, fix, test,
economise, handle), `asked` verbatim or NULL when Foundry opened it,
`understood_as` (what he saw before it bound), `opened_by`, `opened_from`
(owner, situation, recommendation, candidate), close as done / dropped /
superseded / nothing to do, `evidence_mode` checked against the company.
`undertaking_steps` — the thread: `kind` (looked, found, needs, asked you,
you said, proposed, approved, refused, did, waiting on world, outcome,
learned, closed), one sentence, the row it rests on, its cost, its actor. A
closed undertaking takes no more steps and cannot close twice.

The reader is phrase tables, never a model. "Why aren't customers
converting?" is an investigation; "why do you say that" still goes to the
work behind the claim. Every door shows what it understood before anything
binds, re-reads his words on confirm, and grants nothing: the first steps are
looks composed from the situation reader, the numbers, the senses and what is
blind, with a `needs` step naming what would let it see. Accepting advice
opens a thread from the recommendation; a decided act steps every open
thread; "stop that" drops them all with his words as the reason. The Work
place shows each thread; the chip counts them; "what are you doing" answers
from them; `/foundry/why/undertaking/:id` descends them.

**Also fixed:** the single door absorbed a venture mandate the moment it read
one, while the venture screen showed it back first. Both doors now show "What
I will do" before it binds.

**Not built:** anything that runs a step unattended, an adapter, a model in
the reader, a tick that advances threads on its own. Steps arrive only from
things that really happened.

**State of this tranche, stated separately:** DESIGNED · BUILT LOCALLY ·
TESTED LOCALLY (full chain on the pushed tree) · PUSHED to
`claude/foundry-next-frontier-h2fsqe` · NOT INTEGRATED · NOT DEPLOYED ·
NOT OBSERVED IN PRODUCTION · NOT REALITY-PROVEN. An earlier draft of this
document said "pushed" before the push existed; that is the class of error
the institution exists to prevent, and the states above are now reported
one at a time.

**The campaign after it (same day):** the loop closed at its second edge (a
sense is read; threads hear what happened by reference; thinking carries a
purpose; "adopt" is one sentence) and the navigation the owner asked for was
built — the company's own places in the phone's bar, a one-tap queue on Home,
and the Authority place, which is MadeThis's "Propose / Autopilot" toggle
rebuilt as a DERIVED reading of the rows that govern rather than a stored
mode, with lighter as one confirmed tap and heavier as one sentence per door.
Its state is reported in `../AUTONOMOUS_CAMPAIGN_STATE.md`, one state at a
time.
