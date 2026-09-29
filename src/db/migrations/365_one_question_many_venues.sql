-- =============================================================================
-- 365 — ONE QUESTION, MANY VENUES.
--
-- The owner asked on 29 September 2026 for Foundry's trading research to work
-- across every venue at once — Kalshi, Polymarket, and whatever follows. The
-- tables from 364 allowed one venue by CHECK, so each new venue would have
-- meant rebuilding them. This rebuilds them once, with the venue named by a
-- vocabulary table: a later venue is one row here plus its reader, never a
-- rebuild.
--
-- Nothing else changes: the forecast is still sealed before the answer, a
-- simulated fill is still marked simulated, and nothing here can hold an order,
-- an account or a credential. The rebuild creates every table afresh, copies
-- what exists, drops the old ones children-first so no foreign key is ever
-- left pointing at a deleted row, and renames — so it is safe on a database
-- that has already been observing.
-- =============================================================================

-- ─── The venues research may read ────────────────────────────────────────────
CREATE TABLE capital_venues (
  venue        TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  -- What the venue is, in the owner's terms, and what it is not.
  what_it_is   TEXT NOT NULL,
  sort_rank    INTEGER NOT NULL
);
INSERT INTO capital_venues (venue, name, what_it_is, sort_rank) VALUES
  ('kalshi', 'Kalshi', 'a US exchange for event contracts, regulated by the CFTC; public market data needs no account', 1),
  ('polymarket', 'Polymarket', 'a prediction market settling through its own order book and an oracle; public market data needs no account, and whether the owner may trade on it where the owner lives is not established here', 2);
CREATE TRIGGER capital_venues_constitutional_update BEFORE UPDATE ON capital_venues
BEGIN SELECT RAISE(ABORT,'capital_venues:constitutional'); END;
CREATE TRIGGER capital_venues_constitutional_delete BEFORE DELETE ON capital_venues
BEGIN SELECT RAISE(ABORT,'capital_venues:constitutional'); END;

-- ─── The new tables, referring to each other by their new names ──────────────
CREATE TABLE capital_contract_rules_new (
  id                TEXT PRIMARY KEY,
  venue             TEXT NOT NULL REFERENCES capital_venues(venue),
  series_ticker     TEXT NOT NULL,
  settlement_source TEXT NOT NULL,
  settlement_note   TEXT,
  fee_type          TEXT,
  fee_multiplier    REAL,
  first_seen_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE capital_market_snapshots_new (
  id                   TEXT PRIMARY KEY,
  venue                TEXT NOT NULL REFERENCES capital_venues(venue),
  series_ticker        TEXT NOT NULL,
  market_ticker        TEXT NOT NULL,
  rule_id              TEXT NOT NULL REFERENCES capital_contract_rules_new(id),
  open_time            TEXT NOT NULL,
  close_time           TEXT NOT NULL,
  floor_strike         REAL,
  rules_primary_digest TEXT NOT NULL,
  received_at          TEXT NOT NULL,
  best_yes_bid         REAL CHECK (best_yes_bid IS NULL OR (best_yes_bid >= 0 AND best_yes_bid <= 1)),
  best_yes_ask         REAL CHECK (best_yes_ask IS NULL OR (best_yes_ask >= 0 AND best_yes_ask <= 1)),
  yes_book_json        TEXT NOT NULL CHECK (json_valid(yes_book_json)),
  no_book_json         TEXT NOT NULL CHECK (json_valid(no_book_json)),
  proxy_price          REAL,
  proxy_source         TEXT,
  proxy_observed_at    TEXT,
  proxy_sigma_1m       REAL
);
CREATE TABLE capital_resolutions_new (
  market_ticker        TEXT PRIMARY KEY,
  venue                TEXT NOT NULL REFERENCES capital_venues(venue),
  result               TEXT NOT NULL CHECK (result IN ('yes','no')),
  expiration_value     REAL,
  floor_strike         REAL,
  settlement_ts        TEXT,
  rules_primary        TEXT NOT NULL,
  rules_primary_digest TEXT NOT NULL,
  fetched_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE capital_research_theses_new (
  id              TEXT PRIMARY KEY,
  founder_id      TEXT NOT NULL REFERENCES founders(id),
  venue           TEXT NOT NULL REFERENCES capital_venues(venue),
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
CREATE TABLE capital_forecasts_new (
  id            TEXT PRIMARY KEY,
  founder_id    TEXT NOT NULL REFERENCES founders(id),
  thesis_id     TEXT NOT NULL REFERENCES capital_research_theses_new(id),
  snapshot_id   TEXT NOT NULL REFERENCES capital_market_snapshots_new(id),
  market_ticker TEXT NOT NULL,
  model         TEXT NOT NULL CHECK (model IN ('market_implied_v1','proxy_drift_v1')),
  p_yes         REAL CHECK (p_yes IS NULL OR (p_yes >= 0 AND p_yes <= 1)),
  decision      TEXT NOT NULL CHECK (decision IN ('yes','no','skip')),
  reason        TEXT NOT NULL,
  recorded_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (decision = 'skip' OR p_yes IS NOT NULL)
);
CREATE TABLE capital_paper_fills_new (
  id                  TEXT PRIMARY KEY,
  founder_id          TEXT NOT NULL REFERENCES founders(id),
  forecast_id         TEXT NOT NULL UNIQUE REFERENCES capital_forecasts_new(id),
  side                TEXT NOT NULL CHECK (side IN ('yes','no')),
  contracts_requested INTEGER NOT NULL CHECK (contracts_requested > 0),
  contracts_filled    INTEGER NOT NULL CHECK (contracts_filled >= 0 AND contracts_filled <= contracts_requested),
  cost_dollars        REAL NOT NULL CHECK (cost_dollars >= 0),
  fee_dollars         REAL CHECK (fee_dollars IS NULL OR fee_dollars >= 0),
  fee_version         TEXT NOT NULL,
  provenance          TEXT NOT NULL DEFAULT 'simulated' CHECK (provenance = 'simulated'),
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE capital_evaluations_new (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  thesis_id      TEXT NOT NULL REFERENCES capital_research_theses_new(id),
  computed_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_count INTEGER NOT NULL CHECK (resolved_count >= 0),
  verdict        TEXT NOT NULL CHECK (verdict IN
                   ('insufficient_evidence','market_is_better','no_net_edge','survived_holdout_owner_review')),
  result_json    TEXT NOT NULL CHECK (json_valid(result_json)),
  result_digest  TEXT NOT NULL
);

-- ─── Copy what exists, parents first ─────────────────────────────────────────
INSERT INTO capital_contract_rules_new SELECT id, venue, series_ticker, settlement_source, settlement_note, fee_type, fee_multiplier, first_seen_at FROM capital_contract_rules;
INSERT INTO capital_market_snapshots_new SELECT id, venue, series_ticker, market_ticker, rule_id, open_time, close_time, floor_strike, rules_primary_digest,
  received_at, best_yes_bid, best_yes_ask, yes_book_json, no_book_json, proxy_price, proxy_source, proxy_observed_at, proxy_sigma_1m FROM capital_market_snapshots;
INSERT INTO capital_resolutions_new SELECT market_ticker, venue, result, expiration_value, floor_strike, settlement_ts, rules_primary, rules_primary_digest, fetched_at FROM capital_resolutions;
INSERT INTO capital_research_theses_new SELECT id, founder_id, venue, series_ticker, hypothesis, falsifier, alternative_use, status, begun_by, begun_at, stopped_at, stopped_because FROM capital_research_theses;
INSERT INTO capital_forecasts_new SELECT id, founder_id, thesis_id, snapshot_id, market_ticker, model, p_yes, decision, reason, recorded_at FROM capital_forecasts;
INSERT INTO capital_paper_fills_new SELECT id, founder_id, forecast_id, side, contracts_requested, contracts_filled, cost_dollars, fee_dollars, fee_version, provenance, created_at FROM capital_paper_fills;
INSERT INTO capital_evaluations_new SELECT id, founder_id, thesis_id, computed_at, resolved_count, verdict, result_json, result_digest FROM capital_evaluations;

-- ─── Drop the old ones, children first ───────────────────────────────────────
DROP TABLE capital_evaluations;
DROP TABLE capital_paper_fills;
DROP TABLE capital_forecasts;
DROP TABLE capital_market_snapshots;
DROP TABLE capital_resolutions;
DROP TABLE capital_research_theses;
DROP TABLE capital_contract_rules;

-- ─── Rename, parents first; references follow the names ─────────────────────
ALTER TABLE capital_contract_rules_new RENAME TO capital_contract_rules;
ALTER TABLE capital_market_snapshots_new RENAME TO capital_market_snapshots;
ALTER TABLE capital_resolutions_new RENAME TO capital_resolutions;
ALTER TABLE capital_research_theses_new RENAME TO capital_research_theses;
ALTER TABLE capital_forecasts_new RENAME TO capital_forecasts;
ALTER TABLE capital_paper_fills_new RENAME TO capital_paper_fills;
ALTER TABLE capital_evaluations_new RENAME TO capital_evaluations;

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX idx_capital_snapshot_moment ON capital_market_snapshots(venue, market_ticker, received_at);
CREATE INDEX idx_capital_snapshot_close ON capital_market_snapshots(close_time);
CREATE UNIQUE INDEX idx_capital_one_open_thesis
  ON capital_research_theses(founder_id, venue, series_ticker) WHERE status = 'observing';
CREATE UNIQUE INDEX idx_capital_one_forecast_per_model
  ON capital_forecasts(thesis_id, model, market_ticker);
CREATE INDEX idx_capital_evaluations_thesis ON capital_evaluations(thesis_id, computed_at);

-- ─── The same guarantees as 364, restated on the new tables ──────────────────
CREATE TRIGGER capital_contract_rules_immutable BEFORE UPDATE ON capital_contract_rules
BEGIN SELECT RAISE(ABORT,'capital_contract_rules:immutable'); END;
CREATE TRIGGER capital_market_snapshots_immutable BEFORE UPDATE ON capital_market_snapshots
BEGIN SELECT RAISE(ABORT,'capital_market_snapshots:immutable'); END;
CREATE TRIGGER capital_resolutions_immutable BEFORE UPDATE ON capital_resolutions
BEGIN SELECT RAISE(ABORT,'capital_resolutions:immutable'); END;
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
  -- A forecast about one venue's market is made under that venue's question.
  SELECT RAISE(ABORT,'capital_forecasts:another_venue')
   WHERE NOT EXISTS (SELECT 1 FROM capital_research_theses t JOIN capital_market_snapshots s ON s.id = NEW.snapshot_id
                      WHERE t.id = NEW.thesis_id AND t.venue = s.venue);
END;
CREATE TRIGGER capital_forecasts_sealed BEFORE UPDATE ON capital_forecasts
BEGIN SELECT RAISE(ABORT,'capital_forecasts:sealed'); END;
CREATE TRIGGER capital_paper_fills_immutable BEFORE UPDATE ON capital_paper_fills
BEGIN SELECT RAISE(ABORT,'capital_paper_fills:immutable'); END;
CREATE TRIGGER capital_evaluations_immutable BEFORE UPDATE ON capital_evaluations
BEGIN SELECT RAISE(ABORT,'capital_evaluations:immutable'); END;

-- ─── The capability names the second public source ──────────────────────────
INSERT INTO capability_providers
  (id, capability_key, provider, how, tool, cost_note, maturity, sort_order)
VALUES
  ('cp_polymarket_public', 'read_public_event_markets', 'polymarket', 'api', NULL,
   'nothing; the public market-data endpoints need no account', 'declared', 3);
