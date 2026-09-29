-- =============================================================================
-- 364 — RESEARCH IS NOT A TRADE.
--
-- The owner asked on 29 September 2026 for his two old trading projects
-- (kalshi-genius and the legacy Apex Micro trading platform) to be brought into
-- Foundry as another tool. The handoff that came with the request, and the
-- audit of both codebases, say what that can honestly mean today: a research
-- laboratory that reads one venue's public data, commits to a forecast before
-- the answer exists, imports the venue's official result, and scores itself
-- against the market's own price. Neither codebase has shown an edge; both
-- have money paths that reported fills that never happened
-- (docs/foundry-institution/capital/LEGACY_TRADING_AUDIT.md).
--
-- What this migration makes true in the schema:
--   · CAPITAL RESEARCH IS NOT A PRODUCT. None of these tables joins products,
--     experiments or business outcomes. A forecast is not a sale, a simulated
--     fill is not revenue, and nothing here can reach MRR or the money page.
--   · THE FORECAST IS SEALED BEFORE THE ANSWER. A forecast cannot be written
--     once its market has closed or once the official result is on record, and
--     is never edited afterwards.
--   · OBSERVED, OFFICIAL AND SIMULATED ARE DIFFERENT ROWS. A market snapshot is
--     what the venue showed at a moment; a resolution is what the venue
--     officially settled; a paper fill is marked `simulated` by a CHECK and has
--     no other value available to it.
--   · THERE IS NO ORDER, NO ACCOUNT AND NO MANDATE. No table here can hold an
--     order, a fill from a venue, a balance or a credential, and the capability
--     declared below is `observe` only and binds to no tool.
-- =============================================================================

-- ─── What the venue says the contract is ─────────────────────────────────────
-- The series rules as the venue published them, kept by their digest: when the
-- venue changes a rule the digest changes and a new row appears beside the old
-- one. Public market data, the institution's, naming nobody.
CREATE TABLE capital_contract_rules (
  id                TEXT PRIMARY KEY,              -- sha256 of the fields below, as read
  venue             TEXT NOT NULL CHECK (venue = 'kalshi'),
  series_ticker     TEXT NOT NULL,
  settlement_source TEXT NOT NULL,
  settlement_note   TEXT,
  fee_type          TEXT,
  fee_multiplier    REAL,
  first_seen_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER capital_contract_rules_immutable BEFORE UPDATE ON capital_contract_rules
BEGIN SELECT RAISE(ABORT,'capital_contract_rules:immutable'); END;

-- ─── What the market showed, at one moment ───────────────────────────────────
-- One reading of one market: the book as the venue returned it, the reference
-- level the contract settles against, and — kept apart and named as a proxy —
-- a spot price from a different venue that the contract does NOT settle on.
CREATE TABLE capital_market_snapshots (
  id                   TEXT PRIMARY KEY,
  venue                TEXT NOT NULL CHECK (venue = 'kalshi'),
  series_ticker        TEXT NOT NULL,
  market_ticker        TEXT NOT NULL,
  rule_id              TEXT NOT NULL REFERENCES capital_contract_rules(id),
  open_time            TEXT NOT NULL,
  close_time           TEXT NOT NULL,
  -- The official reference level: for these contracts, the previous window's
  -- settlement average. NULL while the venue shows it as not yet known.
  floor_strike         REAL,
  rules_primary_digest TEXT NOT NULL,
  received_at          TEXT NOT NULL,
  -- Best prices, in dollars. The venue publishes bids only; a YES ask is one
  -- dollar less the best NO bid, and is derived here, never invented.
  best_yes_bid         REAL CHECK (best_yes_bid IS NULL OR (best_yes_bid >= 0 AND best_yes_bid <= 1)),
  best_yes_ask         REAL CHECK (best_yes_ask IS NULL OR (best_yes_ask >= 0 AND best_yes_ask <= 1)),
  yes_book_json        TEXT NOT NULL CHECK (json_valid(yes_book_json)),
  no_book_json         TEXT NOT NULL CHECK (json_valid(no_book_json)),
  -- A PROXY, NEVER THE SETTLEMENT SOURCE. NULL when it could not be read.
  proxy_price          REAL,
  proxy_source         TEXT,
  proxy_observed_at    TEXT,
  proxy_sigma_1m       REAL
);
CREATE UNIQUE INDEX idx_capital_snapshot_moment ON capital_market_snapshots(market_ticker, received_at);
CREATE INDEX idx_capital_snapshot_close ON capital_market_snapshots(close_time);
CREATE TRIGGER capital_market_snapshots_immutable BEFORE UPDATE ON capital_market_snapshots
BEGIN SELECT RAISE(ABORT,'capital_market_snapshots:immutable'); END;

-- ─── What the venue officially settled ───────────────────────────────────────
-- Imported only from the venue's own market record once it shows a result.
-- Never inferred from a price, a proxy, or a timer.
CREATE TABLE capital_resolutions (
  market_ticker        TEXT PRIMARY KEY,
  venue                TEXT NOT NULL CHECK (venue = 'kalshi'),
  result               TEXT NOT NULL CHECK (result IN ('yes','no')),
  expiration_value     REAL,
  floor_strike         REAL,
  settlement_ts        TEXT,
  rules_primary        TEXT NOT NULL,
  rules_primary_digest TEXT NOT NULL,
  fetched_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER capital_resolutions_immutable BEFORE UPDATE ON capital_resolutions
BEGIN SELECT RAISE(ABORT,'capital_resolutions:immutable'); END;

-- ─── The owner's research question ───────────────────────────────────────────
-- Begun by him and stopped by him. There is no status beyond observing and
-- stopped: no thesis can become a mandate by changing a word.
CREATE TABLE capital_research_theses (
  id              TEXT PRIMARY KEY,
  founder_id      TEXT NOT NULL REFERENCES founders(id),
  venue           TEXT NOT NULL CHECK (venue = 'kalshi'),
  series_ticker   TEXT NOT NULL,
  hypothesis      TEXT NOT NULL,
  falsifier       TEXT NOT NULL,
  alternative_use TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'observing' CHECK (status IN ('observing','stopped')),
  begun_by        TEXT NOT NULL,
  begun_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  stopped_at      TEXT,
  stopped_because TEXT,
  CHECK (begun_by = 'founder:' || founder_id)
);
CREATE UNIQUE INDEX idx_capital_one_open_thesis
  ON capital_research_theses(founder_id, series_ticker) WHERE status = 'observing';
CREATE TRIGGER capital_thesis_is_said BEFORE UPDATE ON capital_research_theses
BEGIN
  SELECT RAISE(ABORT,'capital_research_theses:said_is_said')
   WHERE NEW.id IS NOT OLD.id OR NEW.founder_id IS NOT OLD.founder_id OR NEW.venue IS NOT OLD.venue
      OR NEW.series_ticker IS NOT OLD.series_ticker OR NEW.hypothesis IS NOT OLD.hypothesis
      OR NEW.falsifier IS NOT OLD.falsifier OR NEW.alternative_use IS NOT OLD.alternative_use
      OR NEW.begun_by IS NOT OLD.begun_by OR NEW.begun_at IS NOT OLD.begun_at;
  SELECT RAISE(ABORT,'capital_research_theses:stopped_is_final')
   WHERE OLD.status = 'stopped';
  SELECT RAISE(ABORT,'capital_research_theses:a_stop_says_when_and_why')
   WHERE NEW.status = 'stopped' AND (NEW.stopped_at IS NULL OR NEW.stopped_because IS NULL);
END;

-- ─── A forecast, sealed before the answer ────────────────────────────────────
CREATE TABLE capital_forecasts (
  id            TEXT PRIMARY KEY,
  founder_id    TEXT NOT NULL REFERENCES founders(id),
  thesis_id     TEXT NOT NULL REFERENCES capital_research_theses(id),
  snapshot_id   TEXT NOT NULL REFERENCES capital_market_snapshots(id),
  market_ticker TEXT NOT NULL,
  model         TEXT NOT NULL CHECK (model IN ('market_implied_v1','proxy_drift_v1')),
  -- P(YES). NULL only when the model could not form one, and then it skips.
  p_yes         REAL CHECK (p_yes IS NULL OR (p_yes >= 0 AND p_yes <= 1)),
  decision      TEXT NOT NULL CHECK (decision IN ('yes','no','skip')),
  reason        TEXT NOT NULL,
  recorded_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (decision = 'skip' OR p_yes IS NOT NULL)
);
CREATE UNIQUE INDEX idx_capital_one_forecast_per_model
  ON capital_forecasts(thesis_id, model, market_ticker);
CREATE TRIGGER capital_forecast_before_the_answer BEFORE INSERT ON capital_forecasts
BEGIN
  SELECT RAISE(ABORT,'capital_forecasts:snapshot_is_another_market')
   WHERE NOT EXISTS (SELECT 1 FROM capital_market_snapshots s
                      WHERE s.id = NEW.snapshot_id AND s.market_ticker = NEW.market_ticker);
  SELECT RAISE(ABORT,'capital_forecasts:the_answer_is_already_known')
   WHERE EXISTS (SELECT 1 FROM capital_resolutions r WHERE r.market_ticker = NEW.market_ticker);
  SELECT RAISE(ABORT,'capital_forecasts:the_market_has_closed')
   WHERE EXISTS (SELECT 1 FROM capital_market_snapshots s
                  WHERE s.id = NEW.snapshot_id
                    AND datetime(s.close_time) <= datetime(COALESCE(NEW.recorded_at, CURRENT_TIMESTAMP)));
  SELECT RAISE(ABORT,'capital_forecasts:sealed_now_not_later')
   WHERE NEW.recorded_at IS NOT NULL AND datetime(NEW.recorded_at) > datetime('now', '+1 minute');
  SELECT RAISE(ABORT,'capital_forecasts:thesis_is_not_observing')
   WHERE NOT EXISTS (SELECT 1 FROM capital_research_theses t
                      WHERE t.id = NEW.thesis_id AND t.founder_id = NEW.founder_id AND t.status = 'observing');
END;
CREATE TRIGGER capital_forecasts_sealed BEFORE UPDATE ON capital_forecasts
BEGIN SELECT RAISE(ABORT,'capital_forecasts:sealed'); END;

-- ─── A fill that never happened, and says so ─────────────────────────────────
-- What the displayed book would have given a taker at the moment of the
-- snapshot: no queue, no latency, no market impact. Marked simulated by a
-- CHECK that admits no other value. The fee is NULL when the fee rule for the
-- series was not the one this version knows.
CREATE TABLE capital_paper_fills (
  id                  TEXT PRIMARY KEY,
  founder_id          TEXT NOT NULL REFERENCES founders(id),
  forecast_id         TEXT NOT NULL UNIQUE REFERENCES capital_forecasts(id),
  side                TEXT NOT NULL CHECK (side IN ('yes','no')),
  contracts_requested INTEGER NOT NULL CHECK (contracts_requested > 0),
  contracts_filled    INTEGER NOT NULL CHECK (contracts_filled >= 0 AND contracts_filled <= contracts_requested),
  cost_dollars        REAL NOT NULL CHECK (cost_dollars >= 0),
  fee_dollars         REAL CHECK (fee_dollars IS NULL OR fee_dollars >= 0),
  fee_version         TEXT NOT NULL,
  provenance          TEXT NOT NULL DEFAULT 'simulated' CHECK (provenance = 'simulated'),
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER capital_paper_fills_immutable BEFORE UPDATE ON capital_paper_fills
BEGIN SELECT RAISE(ABORT,'capital_paper_fills:immutable'); END;

-- ─── What the evidence said, each time it was read ───────────────────────────
CREATE TABLE capital_evaluations (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  thesis_id      TEXT NOT NULL REFERENCES capital_research_theses(id),
  computed_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_count INTEGER NOT NULL CHECK (resolved_count >= 0),
  verdict        TEXT NOT NULL CHECK (verdict IN
                   ('insufficient_evidence','market_is_better','no_net_edge','survived_holdout_owner_review')),
  result_json    TEXT NOT NULL CHECK (json_valid(result_json)),
  result_digest  TEXT NOT NULL
);
CREATE INDEX idx_capital_evaluations_thesis ON capital_evaluations(thesis_id, computed_at);
CREATE TRIGGER capital_evaluations_immutable BEFORE UPDATE ON capital_evaluations
BEGIN SELECT RAISE(ABORT,'capital_evaluations:immutable'); END;

-- ─── The capability: to look, and nothing else ───────────────────────────────
DROP TRIGGER capabilities_constitutional_insert;

INSERT INTO capabilities (capability_key, family, what_it_does, rung, draws_on_allowance, sort_order) VALUES
  ('read_public_event_markets', 'research',
   'read an exchange''s public market data — contract rules, prices, and the official result — and a public spot price kept as a proxy',
   'observe', 0, 97);

CREATE TRIGGER capabilities_constitutional_insert BEFORE INSERT ON capabilities
BEGIN SELECT RAISE(ABORT,'capability:constitutional'); END;

INSERT INTO capability_access
  (capability_key, basis, why, needs_credential, may_cost_cents, never_grants, established_by)
VALUES
  ('read_public_event_markets', 'public_observation',
   'the exchange publishes its markets, books and results to anyone, with no account',
   0, 0,
   'placing, changing or cancelling an order; holding or using an exchange credential; reading an account; '
   || 'moving money; or treating a simulated fill as a trade',
   'institution:constitutional');

INSERT INTO capability_providers
  (id, capability_key, provider, how, tool, cost_note, maturity, sort_order)
VALUES
  ('cp_kalshi_public', 'read_public_event_markets', 'kalshi', 'api', NULL,
   'nothing; the public market-data endpoints need no account', 'declared', 1),
  ('cp_coinbase_public_proxy', 'read_public_event_markets', 'coinbase', 'api', NULL,
   'nothing; a public spot price, read as a proxy and never as the settlement source', 'declared', 2);
