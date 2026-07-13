# Founder Ask Batch — 2026-07-13 (one pass, phone-answerable)

Everything currently blocked on Thomas, with a recommendation per item.
Answer inline; each is a one-worder unless you disagree. Class B unless marked.

| # | Ask | Recommendation | Your call |
|---|-----|----------------|-----------|
| 1 | **Run the deploy runbook** (docs/blockers/BLOCKER-FLY-TOKEN.md — ~15 min: two `fly secrets set` blocks with the price IDs pre-filled, `fly deploy`, health curl). The production app is DOWN. | Do it this week; everything else queues behind it | ☐ |
| 2 | **Stripe: archive the $99 "Founding Cohort" price** (`price_1TMcZoRx25BFZ1JmLSzy4AlJ`) — write was permission-blocked from the session | Archive (one click) | ☐ |
| 3 | **Stripe: confirm webhook endpoint** for `https://foundry-intel.fly.dev/webhooks/stripe` + signing secret matches the `STRIPE_WEBHOOK_SECRET` Fly secret | Create/verify while in the dashboard for #2 | ☐ |
| 4 | **Positioning (Class A):** A = launch honestly as a single/few-product founder ops copilot, fleet agents behind a revenue trigger (3 paying founders). B = build the fleet slice first (~2–3 wks pre-revenue). Note: FleetObservatory is already built, which softens A's gap. | **A.** The verified differentiator is the institution loop, not fleet scale; B delays revenue to defend positioning no customer has tested | ☐ A / ☐ B |
| 5 | **documented-but-not-built.md blanks** (only if #4 = A): FleetOracle, FleetSentinel, PortfolioLedger, cross-company insight reader, lifecycle board, SCP manager UI | Defer ALL behind the same trigger: 3 paying founders. One answer covers six blanks | ☐ defer all / ☐ except: ___ |
| 6 | **Outreach ceiling** (Hands H5, standing question): referral-asks-to-champions only, or allow cold prospecting when a tool is connected? | Referral-only until design partners exist | ☐ |
| 7 | **Dogfood green light:** once #1 is done, onboard AcreOS as product #1 (`seed:dogfood`) and run the 14-day loop — briefing + decisions inbox as your primary AcreOS console | Yes; this is the launch story | ☐ |

**Not asked because already decided by repo evidence:** envelope model
(per-scope caps shipped and founder-adjustable on /connections); security
close-out (done, memo attached); fluency/one-product law (constitutional).
