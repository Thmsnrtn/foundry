# The legacy trading code, audited

*29 September 2026. The owner asked for his two earlier AI-trading projects to be
brought into Foundry. This is what was found in them, reproduced where it could be,
and what Foundry took from them. It is evidence, not an endorsement of either.*

| Repository | Commit read | Draft PR read |
|---|---|---|
| `kalshi-genius` (Bun/TypeScript) | master `a9625d5` | #1 `codex/foundry-research-integrity-20260928` at `755c0e5` |
| legacy `Apex-Micro` trading platform (Python/Starlette) | main `5b88a8d` | #1 `codex/foundry-trading-quarantine-20260928` at `b8bdee6` |

The legacy Apex Micro repository shares a name with the Apex Micro Workshop, but it is a
different thing. It is not the public Workshop, not its history, and not its product.
Nothing from it is presented under that name.

## The two things the owner must do first (PENDING 28)

1. **The old `kalshi-genius` Fly app may still be running against a real account.**
   - Its `fly.toml` sets `KALSHI_ENV='production'`, a mounted private key and
     `auto_stop_machines = 'off'`.
   - `DRY_RUN` defaults to true (`src/core/config.ts:5`), but a Fly secret could
     override it, and this environment cannot see Fly.
   - On master, its public dashboard has **an unauthenticated
     `POST /api/sell-position`**. It sells any position at 1¢ through the live client
     (`src/dashboard/server.ts:396-410`).
   - It also has an unauthenticated chat endpoint that spends on the Anthropic API.
   - If the app is up with a production key, anyone who finds the address can dump
     its positions.
   - **Check `fly status -a kalshi-genius`; if it is running, scale it to zero and
     revoke its Kalshi API key.**
2. **The legacy Apex Micro `main` deploys to Fly on every push.**
   - Its boot loop, `system.py`, started from `main.py:409`, still has a direct
     exchange-execution path at `system.py:2237-2249`.
   - That path swallows errors (`_silent_fail`, 199 call sites) and treats any return
     value as success.
   - The draft PR does not touch it.
   - **Do not push to its `main`; check whether its Fly app is running, and with which
     keys.**

## kalshi-genius: what the paper results were made of

All ten findings in the handoff hold on master. The draft PR makes most bad paths
unreachable rather than fixing them.

| # | Defect | Where (master) | Reproduced | PR #1 |
|---|---|---|---|---|
| 1 | The paper result compares two `PriceSnapshot` objects, so "went up" is always false. Every YES is scored a loss and every NO a win. | `index.ts:1523,1550-1553`; `feeds/binance.ts:8-16,215` | Yes: `rose>entry` and `fell>entry` are both `false` | Unreachable (dry run records no fill) |
| 2 | Resolution is timed 15m10s after **entry**, not at the contract's close | `index.ts:1524-1527` | By reading | Unreachable |
| 3 | P&L is added by the timer, by the resolution poller, **and** by the exit callback: three paths, one position | `index.ts:538-541, 501-503, 1578-1579` | By reading | Not started in research mode |
| 4 | An accepted order opens a full local position at the requested price. `fill_count` is never read | `index.ts:1471,1479-1510` | By reading | `placeOrder` throws |
| 5 | An exit order closes the local position without a confirmed fill. Settlement P&L ignores fees | `position_manager.ts:465-505`; `resolution_tracker.ts:101-115` | By reading | Not started |
| 6 | The "open" is a Binance sample from the first 60s, or an estimate within 90s. **The contract settles on the CF Benchmarks BRTI 60-second average**, per the venue, read 29 September | `turbo_probability.ts:64-107` | Rule confirmed from the venue's API | Comment only |
| 7 | **A payout ratio is passed as the edge.** `(1−price)/price` feeds a Kelly sizer that bets the 30% cap at any forecast | `kalshi_strategies.ts:246`; `index.ts:713`; `aggressive_kelly.ts:106,120` | **Yes: $30 of $100 at p = 0.50, 0.53 and 0.70 alike** (`river/capital/legacy-audit/repro-kelly.ts`) | Hourly path fixed (P(win) − ask) |
| 8 | A missing model probability is scored as the entry price: calibration of the market, under the bot's name | `resolution_tracker.ts:75`; `index.ts:728-739` | By reading | Probability passed; tracker unchanged |
| 9 | A persisted pause is displayed but does not disarm a live process after restart | `auto_pause.ts:49-57`; `index.ts:227-233`; `risk.ts:47-61` | By reading | Forced dry run |
| 10 | The "10% cap" is `max($1, 10%)`, scaled up afterwards by a weight of up to 1.5, and then rounded **up** to one contract | `index.ts:718-720,1471`; `strategy_weights.ts:111-117` | By reading | Cap after weights; no floor |
| 11 | **New:** the normal CDF builds Abramowitz–Stegun's `t` from \|x\| instead of \|x\|/√2. It overstates probabilities by **2.8–3.7 points** for z between 0.25 and 1 | `turbo_probability.ts:194-211` | **Yes** (`repro-normal-cdf.mjs`): +0.028 at 0.25, +0.037 at 0.5, +0.029 at 1 | Unchanged |
| 12 | **New:** its Binance feed returns HTTP 451 ("restricted location") from this environment | `feeds/binance.ts` | Observed 29 September | — |

Finding 11 matters most. The error is about the size of the edges the bot reported, so
part of any "edge" it saw may have been its own arithmetic.

**PR #1 run here:**
- The four focused tests pass: `node --experimental-strip-types --test tests/*.test.mjs`.
- Master has no test script.
- The PR's NDJSON forecast export is a research record, not official evidence. No file
  from it exists to import.

## Legacy Apex Micro: three order doors, three fee models

| Finding | Where (main) | PR #1 |
|---|---|---|
| The UI order route writes `filled`/`open` before any venue result, returns `ok: true` on failure, and invents a fill when there is no database | `api/routes/trading.py:101-142` | Returns 503 `research_only`, with no write |
| The Kalshi call returns `success` and a `fill_price` on HTTP 200: acceptance read as a fill | `api/trading.py:228-236` | Returns `research_only` |
| The risk balance falls back to **$10,000**; the kill switch lives in memory; the persistence test never restarts | `api/risk_controls.py:86-114`; `tests/unit/test_risk_controls.py:124-129` | Fails closed |
| The autopilot's paper fallback sets `executed=True` and adds a position either way | `core/autonomous/autopilot.py:1205-1240` | Start/resume return 503; **fallback unchanged** |
| The system loop calls `engine.execute(..., strategy=)`, which has no such parameter, so it always falls through to direct exchange execution. `_silent_fail` swallows everything | `system.py:2224-2249`; `core/execution/engine.py:360-427` | **Unchanged, and reachable from boot** |
| "Atomic" arbitrage is two concurrent legs with no hedge | `core/execution/engine.py:591-630` | Unchanged |
| Three paper engines charge 0.2%, 3.5% and 7% for the same Kalshi trade. None uses the venue's formula | `api/trading.py:329-346`; `api/paper_trading.py:85-89`; `core/execution/paper_trading.py:89-100` | Unchanged |
| The order book reads NO levels as YES asks; one adapter signs with PKCS1v15; another uses HMAC and a dead host | `core/exchanges/kalshi_adapter.py:184-212`; `api/trading.py:313-317`; `core/exchanges/kalshi_v15.py` | Unchanged |
| The walk-forward has no purge or embargo; out-of-sample starts on the next tick | `core/data/walk_forward.py` | — |
| 97 groups of identical files, including three identical backtest cores; boot falls back to demo mode on errors | tree; `main.py:101-112` | — |
| Tracked: a 16-byte credentials salt, SQLite sidecars and a server log (values not read) | `data/`, `server.log` | — |

**Run here with Python 3.11 in a virtual environment:**
- The PR's eight focused tests pass.
- The full suite gives:
  - PR: **475 passed, 9 failed, 38 errors**;
  - main: **468 passed, 8 failed, 38 errors**.
- The 38 errors are the same Starlette `TypeError` on both.
- The one failure the PR adds is `tests/test_api.py::test_orders_place`. It asserts the
  old behaviour, that placing an order returns 200. It should be changed to expect 503
  in that PR.
- GitHub's CI failures in 3 seconds with no runner remain unexplained. The code runs;
  the CI does not.

## What Foundry took, and what it left

| Taken, rebuilt, tested | Left |
|---|---|
| The normal-CDF probability shape, **corrected** and pinned against exact values | Every order path, adapter, key and credential store |
| The question: does a spot price forecast the 15-minute contract? Now asked against the **official** reference level, with the spot price labelled a proxy | The Binance feed (restricted) and the estimated "open" |
| `forecast_math`'s P(win) − ask, plus the venue's fee and a fixed threshold. No Kelly | `aggressive_kelly`, streak bonuses, size multipliers |
| `foundry_research.py`'s separation: model and benchmark scored apart; a fill counts only if confirmed; duplicate fill ids refused. In Foundry, a simulated fill is marked by the schema and must reproduce from its stored book | The three paper engines and their P&L |
| The order-state vocabulary, for the day an execution design is reviewed (`CAPITAL_RESEARCH.md`) | The in-memory kill switch; demo fallbacks |
| Walk-forward's in-sample/out-of-sample idea, as a chronological split fixed in advance with nothing tuned | The optimizer and its grid search |

Nothing from either repository runs in Foundry, and no code in either repository was changed from here.

**Retired, 29 September 2026, at the owner's direction.** Both draft PRs were closed unmerged, with comments.
Both repositories are to be archived. On Fly, `apex-trading` had no machines. `kalshi-genius` had
one, which a single GET started in LIVE mode against the production account at 02:03 UTC. It crashed on a full
disk before trading, and it was then destroyed with the owner's temporary token. Its volume and secrets were kept,
and revoking the Kalshi key is the owner's act (PENDING 28).

## What is not known

- Whether either bot ever traded real money: its fills, fees, settlements and
  withdrawals. Only the owner's account exports can say (PENDING 28, item 3).
- Which series and rule versions were actually traded.
- Whether GitHub's CI for the legacy Apex Micro PR can be made to run at all.
