# Capital research: trading as one of Foundry's tools

*29 September 2026, at the owner's request to bring his trading projects into
Foundry "as another tool in Foundry's tool kit". This file says what that tool is
today, what it may become, and what would have to be true first. The audit behind it
is `LEGACY_TRADING_AUDIT.md`.*

## What it is

**A research laboratory for one question, asked of each venue at once, with no way to trade.**
Kalshi and Polymarket today (migration 365); another venue is one reader and one row
in `capital_venues`, never a rebuild.

Each pass reads the rules of Kalshi's 15-minute Bitcoin contracts, its book and a public
spot price. Before each window closes, it seals two forecasts:
- the market's own price;
- a proxy-drift model rebuilt from the old bot's idea on the official reference level.

It then imports Kalshi's official result and scores the model against the market
(`src/services/capital/`, migration 364, job `capital_research_observe` every five minutes, which
also scores each question once a day; page `/foundry/money/research`).

This amends one line of doctrine. ECONOMICS.md said "trading itself is outside
Foundry's scope and stays there." Trading **research** is now inside, at the rung
`observe`, because the owner asked. Trading **execution** stays outside until the gates
below are met and he grants it in writing. The Constitution's refusal to allocate
capital stands: Foundry reports, and he decides.

## Many venues (29 September 2026, migration 365)

The owner asked for the research to "work across all trading platforms simultaneously
Kalshi, polymarket, etc". What that means here:

| | Kalshi | Polymarket |
|---|---|---|
| The market | `KXBTC15M`, one per 15-minute window | `btc-updown-15m-{start}`, one per 15-minute window, closing at the same instants |
| Settles on | CF Benchmarks BRTI 60-second average, against the previous window's average (published as the reference level) | Chainlink BTC/USD TWAP, against "the price at the beginning" of the window (**not published**) |
| Read from | `api.elections.kalshi.com` series, markets, book, historical | `gamma-api.polymarket.com/events?slug=`, `clob.polymarket.com/book` |
| Book | bids only; asks derived | Up token's bids and asks; an Up ask at a is stored as a Down bid at 1 − a, so one book shape serves both |
| Result | the market record's `result` | only when `closed` and `umaResolutionStatus = resolved`, with prices exactly 1 and 0 |
| Taker fee | `ceil¢(0.07 × m × C × P(1−P))`, the handoff's reading (`kalshi_quadratic_taker_2026_07_07@handoff_reading`) | `C × rate × P(1−P)`, rate read from each market's `feeSchedule`, rounded up at 5 decimals (`polymarket_crypto_fees_v2_taker@docs_read_2026_09_29`) |
| Proxy model | runs, on the official reference level | **does not run**: there is no published reference level, and estimating one is the legacy bot's defect 6. It says so in its forecast's reason |
| Permission | a CFTC-regulated US exchange | may restrict some countries; reading public data needs no permission, trading would |

Each venue is one question the owner begins or stops. A forecast about one venue's
market cannot be filed under another venue's question (trigger `another_venue`). One
venue asking Foundry to wait does not blind the other. The proxy spot price is read
once per run and shared.

**The two venues side by side.** Where both were observed for the same window, the page
reads:
- how far apart their prices were at the same pass;
- whether their official results agreed;
- each venue's price scored against its own result;
- how often buying YES on one venue and NO on the other cost less than a dollar after
  both fees, at the displayed top of book, and what that would have paid given the
  real results. A disagreement between the results is where such a pair loses both
  legs, and it is counted.

It is a simulation of one contract, and never an instruction.

**What was found before it was built (29 September, ~02:35 UTC).** Over the 96
fifteen-minute windows from 28 September 02:15 to 29 September 02:15 UTC, the two
venues' official results **agreed 96 times out of 96**
(`river/capital/cross-venue/`). Two different sources, two different reference rules,
one answer: for this question they are one exposure, not two. Holding the same side on
both is not diversification. A price gap between them is the interesting thing, and
one day in one regime says nothing about how often the results part.

**The first live reading (29 September 02:51 UTC, throwaway database).** The window
closing at 03:00Z was observed on both venues in the same pass:
- Kalshi: YES 0.53/0.54, reference level 82,975.22. The model gave P(YES) 0.5089 and
  skipped, with a best net edge of 0.1¢.
- Polymarket: YES 0.52/0.53. The model did not run, with its reason recorded.
- The prices were 1¢ apart.
- Kalshi settled the window **NO** at 03:00:06 (82,932.33 against 82,975.22), after both
  markets had priced YES slightly above even: a single window proves nothing. Polymarket's oracle had not yet resolved it at
  03:02, and the reader waited rather than concluding anything.

## Four records, never one

| Record | Here | What it can never become |
|---|---|---|
| The question | `capital_research_theses`: hypothesis, falsifier, alternative use of the money; begun and stopped by him | A mandate: its status has no word beyond `observing` and `stopped` |
| What the market showed | `capital_contract_rules`, `capital_market_snapshots` (with the proxy named as a proxy), `capital_resolutions` (the official result only) | A settlement inferred from a price or a timer |
| What was predicted | `capital_forecasts`, refused after the window closes or once the answer exists, and never edited | A forecast written after the fact |
| What would have happened | `capital_paper_fills`, whose provenance column admits only `simulated`; each must reproduce from its stored book | A trade, income, or anything on the money page |

There is no order, fill-from-venue, account, balance, credential or mandate table.
`research-cannot-reach-an-order` asserts it.

## The modes, with explicit meanings

| Mode | Meaning | Exists |
|---|---|---|
| `research_only` | Public data, no credentials, no orders | **Yes: this is the only mode** |
| `shadow` | Real data, sealed hypothetical decisions, no orders | Yes: what the simulated fills are |
| `venue_demo` | The venue's test system, no real money, labelled separately | No |
| `live` | A real account under a signed mandate | No, and not by configuration: it requires code that does not exist, reviewed against the gates below |

Nothing ever falls back to paper inside a live accounting stream, and nothing live
falls back to simulation. The legacy platform did both.

## What would count as an edge

Each rung must be met before the next is asked:

1. **Instrument truth.** The exact ticker, the archived rule, the official reference
   level and the official result. If the rule changes between a forecast and its result,
   that market is excluded.
2. **Prediction truth.**
   - P(YES) is sealed before the window closes, beside the market's own price.
   - Scores are paired on the same markets.
   - A forecast without a probability is excluded; it is never scored as the price.
3. **Execution truth.**
   - Fills are simulated against the displayed book at the snapshot's instant, whole
     contracts only.
   - The fee is the venue's quadratic formula, with its version named.
   - The simulated result is shown with one cent of adverse fill per contract.
   - No queue, latency or impact is modelled. That is optimistic, and the page says so.
4. **Economic truth.** For a YES bought at q with probability p, the gross value is p − q.
   Less the fee, it must clear a threshold of 2¢ per contract, fixed in advance. A fixed
   size of 10 contracts; no Kelly.
5. **Generalisation.**
   - At least 200 resolved markets, fixed in advance.
   - The Brier difference must exclude zero at 95%.
   - The simulated result must be positive in both chronological halves after the
     adverse cent.
   - Nothing is tuned on the data it is judged by. A new model is a new sample.
6. **Operational truth.** Not reachable in this mode. It needs real fills, reconciled
   cash, outages and attention. Paper cannot supply them.

The verdict ladder is `insufficient_evidence` → `market_is_better` → `no_net_edge` →
`survived_holdout_owner_review`. **No rung says "trade".** The top rung earns the owner's
review of the evidence, and nothing more.

## What the research cannot see (said on the page)

- **BRTI itself.** It is licensed; the proxy's basis to it is unknown and uncorrected.
- **Real fills.** Queue position, latency, and market impact from a 10-contract order.
- **The fee schedule.** The 0.07 coefficient is the handoff's reading of the 7 July 2026
  schedule. kalshi.com refused this environment (HTTP 429). The API itself confirms
  `quadratic` with multiplier 1.
- **Regimes.** 200 markets is about two days, one regime. A result that survives is
  still one sample.
- **Polymarket's reference level.** Chainlink's window-opening price is not published by
  the venue, so no model is measured against it there, and the cross-venue reading
  compares prices and results only.
- **Whether the owner may trade on Polymarket at all.** Not established. Reading is
  public; trading is a separate question of permission, and it is his.

## Before any order could exist (the execution boundary, not built)

Only if the research survives, and only by the owner's written, venue-specific mandate
after an operational review. The design would need all of these; none exists today:

- **A separate execution service** holding the only credential. It is narrowly scoped
  and cannot be reached by Foundry's general tools or agents, which receive a read-only,
  redacted event stream.
- **A mandate record signed by him.** It names:
  - the account and venue;
  - the instrument allowlist;
  - the maximum capital deployed and the aggregate exposure;
  - the worst-case loss and the loss stop;
  - the expiry and revocation.

  No code or model can widen it, and expiry or revocation stops new orders whatever an
  agent believes.
- **One fail-closed pre-order gate**, rechecking venue-reconciled state on every order.
  A missing balance, risk input or reconciliation refuses: no $10,000 fallback, and no
  in-memory kill switch.
- **An idempotent order intent** under a client id, written before the POST. An
  uncertain POST is resolved by querying the venue before any retry. Accepted, partially
  filled, filled, settled and cash-moved are separate states. A position is the sum of
  matched fills, never the amount requested.
- **Continuous reconciliation of cash, orders, fills, positions and fees.** Any
  disagreement freezes new orders until it is resolved.
- **Demonstrated failure handling.** Demo-environment runs must reconcile, with no
  phantom profit and no replay, through:
  - a timeout after a POST;
  - a partial fill;
  - a duplicate client id;
  - a stale feed;
  - a restart mid-order;
  - a WebSocket loss;
  - a fee change;
  - a loss stop.
- **Two ledgers**, `simulated` and `venue_observed`, never one bankroll. Deposits are
  capital flows, not profit. Only reconciled net gains are called trading cash flow,
  and never recurring income.

## Products this might suggest (hypotheses for the ordinary pipeline, not built)

These go through the ordinary venture machinery with real buyers, independently of
whether any trading edge exists:
- a trade journal that separates fees and capital flows;
- a point-in-time backtest-audit kit, with these audit findings as its fixtures;
- a versioned event-contract fee and payoff explainer.

Selling signals, copy-trading or a managed bot is excluded until an edge, demand,
venue permission and counsel's view all exist. Several Kalshi-facing products would
share one venue, and would not diversify.
