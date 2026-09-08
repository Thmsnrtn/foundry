# Proof 1 — Outreach

## Rules this outreach follows

- One message per business, sent individually to the published business email address. No bulk sending, no sequences, no follow-up automation. The governed outbound gateway deduplicates by effect id, so the same business cannot be written to twice for this probe.
- No fabricated personalization. The only business-specific facts used are the business name and the town it publishes.
- No claims beyond the evidence: no "never miss a bid", no coverage guarantee, no hours saved, no revenue claims, no implied customer base. The quality gate refuses an offer or a brief containing any of these phrases.
- The sender is a real person: the owner's name, from a sending domain the owner connected, with reply-to set to the owner's own address. Foundry refuses to send under any Foundry domain. The message says it was sent once by a system the owner is building.
- The offer is a one-time $29 purchase of one pilot edition. No subscription, no renewal, no upsell.
- Every recipient can decline by not replying. One message is the whole campaign for this probe.
- Only recipients the owner approved in the conflict review are ever written to. Web-form-only businesses are not contacted unless the owner adds a legitimate published email address.

## The message

The body is `outreach-template.md`; `river:offer` fills in the payment link and stores it as the probe's offer claim, and each send fills in `{Business name}`. Subject: *A shortlist of open Massachusetts public bids with cabinet and millwork scope*.

## Delivery after payment

Stripe reports the settled payment and the buyer's email through the existing billing webhook. Foundry books the payment to the probe ledger and, in the same intake, plans the delivery: the brief in the body of an email to that address from the same sender, with the same limits stated and a one-line refund promise. The brief must pass its quality gate first (pulled within seven days, every item linked to its COMMBUYS record, coverage limits stated, no placeholders, no banned claims); a stale brief is refreshed by re-running the pull, never delivered as is. `value_event_delivered` is recorded only when the provider reports the delivery delivered. Payment alone is CE3; delivery is what allows CE4, and the probe validates only with both.

If the delivery bounces, Foundry refunds the payment through the governed Stripe refund capability and books the reversal; the buyer is never left paid and unserved. The delivery also carries a signed refund link: opening it shows the question, confirming it is the request, and Foundry issues the refund itself. A buyer who replies by email instead is relayed by the owner with `river:refund`.

## What is not done

No LinkedIn messaging, no phone cold calls, no paid advertising, no posting in trade groups, no web-form submissions by Foundry. If the owner wants any of those, it is a new probe with its own kill rules, not an extension of this one.
