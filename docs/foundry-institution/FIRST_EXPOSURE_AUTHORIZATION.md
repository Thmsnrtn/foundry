# Experiment 001 — authorization for first external exposure

> ## SUPERSEDED, 11 September 2026
>
> **This two-business authorization is obsolete and was never executed.** It is
> kept whole because it is the record of what was prepared, what was presented,
> and what the owner was asked — including the heading that had to be corrected
> and the scope line that had to be rebuilt after the authority defect was found.
>
> It is superseded because two cold emails are too few to answer the commercial
> question. A zero from two recipients cannot be told apart from ordinary channel
> noise, so the exposure was too small to buy the evidence it cost. The
> replacement is a larger closed cohort of qualified Massachusetts shops against
> a launch-day edition, released automatically in bounded stages under one owner
> act.
>
> **Nothing here can be executed by accident.** The decision surface recomputes
> its recipient set from current state on every render and carries both lists in
> the form; a press from a page drawn against the old two-business set is refused
> with *"the businesses changed since this page was drawn"*. The supersession is
> enforced by the mechanism, not only stated in this paragraph.

**Prepared 10 September 2026 against production `cb652802`.** Every figure below
was read from the live system, not from the code.

---

## The one decision

**Two clicks, and nothing else is waiting on you.**

1. `/foundry/experiments/uohKaTpLwSCESTjmiuh7l/recipients` → **The rest are fine (11)**
2. `/foundry/experiments/uohKaTpLwSCESTjmiuh7l` → **Allow**

The first exists because the database refuses it to anybody else. The row guard
`experiment_recipient:reviewer_invalid` accepts a review only when it is stamped
`founder:<your id>` — *"Only the founder who owns the experiment reviews, and
every review names him."* Approving who may be written to is consent, and I have
not touched that rule to save you a click. If you want the recorded screening to
carry the admission instead, that is an amendment for you to ask for, not one for
me to make on the way to a launch.

Approving all eleven is safe, and now closed rather than merely narrow. At Allow
the act stamps `authorised_act_id` on exactly the businesses it covers — approved,
reachable, and already carrying recorded grounds — and the row guard refuses an
offer to anybody else (`experiment_action:recipient_not_in_this_authorisation`).
**Exactly two** businesses can receive anything, and screening a third afterwards
makes them eligible for a future decision rather than this one.

That is not a claim about the source tree. Read back out of the database
production is actually running: the column is installed, migration 296 applied,
`experiment_recipient_guard` refuses authority at insert
(`authority_not_a_default`), `experiment_recipient_review_guard` refuses to move
it once written (`authority_stands`) or to give it to somebody unapproved
(`authority_needs_approval`), and `experiment_action_plan_guard` names
`recipient_not_in_this_authorisation`. **No row carries authority today** — the
column is empty, and your Allow is what writes it.

---

## Who is exposed, and why

| | |
|---|---|
| Candidates gathered | 23 |
| Qualified on recorded evidence | **2** |
| Pending, unqualified, e-mail | 9 — approvable, but unreachable by the hand |
| Web-form only | 12 — never written to |
| **Will actually receive a message** | **2** |

**General Woodworking, Lowell** — `info@genwood.com`
> Its own project gallery names Henry K. Oliver School (Lawrence), Tyngsborough
> Middle School, Cabot Elementary School and Stoughton High School. The
> Comptroller's spending record independently shows a payment from the
> University of Massachusetts system in FY2018.

**Continental Woodcraft, Worcester** — `info@continentalwoodcraft.com`
> Its own project list names Shrewsbury Police Station, Malden City Hall and
> Worcester State University; the site says the shop is "well-versed in the
> bidding process for your retail, healthcare, education, government, or
> municipality project" and carries a "Submit Bid Invite" form. The Comptroller's
> record independently shows a $6,167.70 payment from Worcester Sheriff's
> Department in FY2022.

Each has two independent sources: the business's own public site, and the
Commonwealth's own spending record. Both grounds are written on the row and
cannot be altered once stamped.

---

## Exactly what they will see

**Subject:** *A shortlist of open Massachusetts public bids with cabinet and
millwork scope*

> Hi,
>
> I run Apex Micro, a small digital workshop in Massachusetts. I've put together
> a short brief of the Massachusetts public bid notices that look like commercial
> cabinet, casework or millwork work — twenty-three of them, out of 726 that were
> open on COMMBUYS when I pulled it on 10 September. Each one with the bid
> number, when it opens, who to contact and a link to the notice.
>
> You can search COMMBUYS yourself; it's free. This is for shops that would
> rather not read through hundreds of notices to find the few worth a look.
>
> It's $29, one-time. No subscription. What's in it, and what it doesn't cover:
>
> https://apexmicro.ai/experiments/ma-millwork-bid-brief
>
> Your shop came up because your own website shows public-sector work. I'm trying
> this with a small number of shops, and I only write once — if it isn't
> relevant, no reply needed and you won't hear from me again.
>
> Thomas Norton
> Apex Micro
>
> —
> Apex Micro is a small digital workshop run by Thomas Norton. Thomas Norton, 11
> Apex Drive, Suite 300A #361, Marlborough, MA 01752.
> To hear nothing further from Apex Micro: https://apexmicro.ai/email

The page it points at publishes the moment you Allow, and carries: the offer, the
price, a specimen entry from the actual brief, why they were written to, who it
is for, what it does not cover, where the information comes from, who you are,
refunds, privacy, and a form for saying what they want next. It was read back
from `https://apexmicro.ai` and checked at 375px and 1280px.

---

## The edition, and the clock

| | |
|---|---|
| Pulled | **10 September 2026**, from COMMBUYS' own CSV export |
| Universe | 993 exported; 726 open for bidding with an opening date ahead |
| In the brief | **23** |
| Digest | `37470573f25f7025`, 20,664 bytes |
| September 7 edition | preserved alongside it; materials are append-only |
| **Last safe day to send** | **15 September 2026** |

Delivery refuses a brief pulled more than seven days ago, and readiness blocks a
day earlier so a purchase made the day after an offer can still be filled. Past
the 15th the brief must be pulled again — one request, a chore rather than an
obstacle.

---

## Price and the maximum this can cost

| | |
|---|---|
| Price | **$29, one time.** No subscription, nothing renews |
| Messages | **2** — one each, never a second |
| Spending ceiling | $100 |
| Held if unfulfilled | new offers stop while 10 purchases are owed |
| Contact rules | 90 days between messages to one address; 3 a year at most |
| Maximum revenue at this exposure | $58 |

---

## What Foundry may do on its own once you Allow

- Publish the experiment page and create the Stripe payment link.
- Send **one** message to each approved, qualified recipient — never a second.
- Take payment, and deliver the brief within a business day, once per purchase.
- Refund in full on request, through the link in the delivery or a plain reply.
- Honour an opt-out immediately, across everything this workshop does.
- Record anything anybody writes in, in the Founder Inbox.
- Stop itself, and settle the experiment when the sealed rule can read the result.

**It may not** answer correspondence: the correspondence mode is `off`, so replies
are recorded and shown to you rather than answered. Turning that on is a separate
decision you have not made.

---

## What stops the probe

Any one of these, automatically, without asking:

| Stop | Threshold |
|---|---|
| Spam complaint | 1 |
| Undeliverable addresses | 3 |
| Opt-outs | 2 |
| Shops saying plainly they want nothing further | 3 |
| A paid brief that cannot be delivered | 1 |

It also stops on your pause, on your stop, if the public page goes dark or stale,
if the price on the page and the price at the provider disagree, if the sender
becomes unhealthy, or if the brief ages past seven days.

## What survives a stop

Refunds are honoured whether or not the experiment is still running. Anything
already paid for is still owed and still delivered. An opt-out is permanent. The
page stays up with an honest note of what happened.

---

## What counts as evidence

- **Payment** — Stripe's own `payment_intent.succeeded`, recorded as a fulfilment
  row with the charge reference. Not a click, not a visit.
- **Delivery** — the provider's message ID and delivery status on the outbound
  action, reconciled afterwards; a bounce becomes a refund rather than a silence.
- **Willingness to pay, and a fulfilled delivery** — and *only* that. The sealed
  rule reads `{ event: 'delivery', atLeast: 1, outOf: 'offer_delivered', atMost:
  25, withinDays: 7 }`; a refunded or undelivered purchase does not count. A
  payment is never read as evidence that the buyer found the brief useful.
- **Whether it was any good** — a separate question, answered only by what
  somebody actually says, through the page's form or a reply, in their own words,
  and read before anybody else is written to. Absent that, it stays unanswered.

---

## Unresolved blockers

**None that block.** External readiness reports `ok: true`, nothing blocked, six
surfaces verified from the public internet. Three legs read `waiting` — the
experiment page, the payment link and outbound eligibility — and all three are
waiting on your Allow by design, because publishing an offer page for an
unapproved experiment is the premature public act the whole arrangement exists to
prevent.

Two things to know rather than fix:

1. **Correspondence is off.** Replies reach the Founder Inbox and wait for you.
2. **One address is suppressed** — `b@millwork.example.test`, a synthetic address
   from my own live proof of the refusal path. No real person is on that list.

Nothing has been sent to anybody: **0 contacts, 0 offers, 0 purchases** to date.
