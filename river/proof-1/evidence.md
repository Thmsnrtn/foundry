# Proof 1 — Evidence and rights record

Everything the probe design rests on, with where it came from and how strong it is. Recorded September 7, 2026. Nothing here is a model's estimate.

## Grounding observations (become `friction_observed` commercial observations, origin `public_web`)

| # | What was observed | Source | Strength |
|---|---|---|---|
| G1 | Shop owners publicly describe difficulty winning commercial and public millwork work: "I have bid work for the past year and I have been low balled by many of my competitors to get jobs." and "It's very difficult to get on their jobs without being low." | WoodWeb knowledge base, "Getting Commercial Millwork Jobs Without Being the Low Bidder" (thread dated 2012) — https://woodweb.com/knowledge_base/Getting_Commercial_Millwork_Jobs_Without.html | Friction, CE1. Old and not Massachusetts-specific. |
| G2 | The Commonwealth's authoritative listing of public construction bids is paid: "The Central Register is only online, and you may subscribe for a fee." | Secretary of the Commonwealth, Advertising Bids page — https://www.sec.state.ma.us/divisions/pubs-regs/advertise-goods-services.htm (page fetched through search; direct fetch redirected) | Friction: discovery of the authoritative record costs money. Not evidence that a millwork shop pays it. |
| G3 | The bid notification tier of COMMBUYS's platform vendor is priced at $109/month for a state plan (about $1,308/year). | Periscope S2G pricing as reported by Capterra — https://www.capterra.com/p/166830/Periscope-S2G/ | Market context for existing spend. Not an observed participant paying. |
| G4 | COMMBUYS lists 952 open solicitations; of 62 building-related notices read in full, 13 appear relevant to millwork. Screening required reading each notice. | COMMBUYS open solicitations pull, September 7, 2026 (this repository, `brief.md`) | Direct observation of the filtering burden the ValueEvent addresses. |

No `existing_spend_observed` or `commitment_observed` observation exists yet for any participant. Commercial evidence for this thesis is therefore **CE1** on entry, and the design says so.

## The shadow prediction (recorded before authority)

Foundry predicts, before any money is spent: *at least one Massachusetts millwork business, asked plainly, already pays for a bid-discovery service or the Central Register* (`existing_spend_observed`). The owner resolves this with one or two ordinary conversations or replies before authorizing spend, recording whatever is actually said with `river:observe` and `river:compare`. A "no, we don't pay for anything" answer is a `friction_observed` or nothing at all, and the prediction is marked deviated. Either answer is real evidence; only silence is not.

## Rights

- **Source:** COMMBUYS, the Commonwealth of Massachusetts procurement record, administered by the Operational Services Division. Public bid notices are viewable without registration.
- **Basis:** Mass.gov Terms of Use state that material posted on Commonwealth websites without an authenticating mechanism is public record, that most of it may be copied and used for any purpose, and that where the Commonwealth holds copyright only fair use is permitted. https://www.mass.gov/massgov-terms-of-use
- **What the brief reproduces:** bid number, agency, title, opening and sub-bid dates, contact, a short quotation from the notice, and a link to the record. It reproduces no bid documents, drawings, or specifications.
- **Platform copyright:** COMMBUYS pages carry a Periscope Holdings copyright notice covering the site. The brief copies facts from public notices, not the site's design or software.
- **Conclusion for this bounded test:** `rights_status: clear` for factual reproduction with attribution and links. This is a judgment for a $29 pilot with fewer than 25 recipients, not a legal opinion, and it would need qualified review before any recurring or larger commercial use.
- **Not used:** Central Register content (paid), DCAMM Bid Express (login-required), bid documents behind registration at biddocs.com or Projectdoc.com.

## Data handling

Participant contacts are the businesses' published B2B addresses and phone numbers. They are held in this repository's `participants.md` only for the owner's conflict review and the single outreach; no list is retained beyond the probe's conclusion except as the immutable ledger requires (counterparty references on observations).
