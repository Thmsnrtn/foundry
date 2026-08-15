-- Atomic pre-authorization for material AI spend. Reserved cost counts against
-- every applicable daily ceiling before the provider request starts.

ALTER TABLE ai_daily_spend ADD COLUMN reserved_cents REAL NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS ai_spend_reservations (
  id TEXT PRIMARY KEY,
  product_id TEXT,
  founder_id TEXT,
  date TEXT NOT NULL,
  model TEXT NOT NULL,
  reserved_cents REAL NOT NULL CHECK (reserved_cents > 0),
  global_cap_cents REAL NOT NULL,
  product_cap_cents REAL,
  founder_cap_cents REAL,
  actual_cents REAL,
  status TEXT NOT NULL CHECK (status IN ('reserved','settled','released','ambiguous','expired')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_spend_reservations_open
  ON ai_spend_reservations(status, expires_at);

CREATE TRIGGER IF NOT EXISTS ai_spend_reservation_guard
BEFORE INSERT ON ai_spend_reservations
BEGIN
  SELECT RAISE(ABORT, 'ai_spend_ceiling:global') WHERE COALESCE((SELECT spent_cents + reserved_cents FROM ai_daily_spend
    WHERE scope = 'global' AND scope_id = '__global__' AND date = NEW.date), 0) + NEW.reserved_cents > NEW.global_cap_cents
    ;
  SELECT RAISE(ABORT, 'ai_spend_ceiling:product') WHERE NEW.product_id IS NOT NULL AND COALESCE((SELECT spent_cents + reserved_cents FROM ai_daily_spend
    WHERE scope = 'product' AND scope_id = NEW.product_id AND date = NEW.date), 0) + NEW.reserved_cents > NEW.product_cap_cents
    ;
  SELECT RAISE(ABORT, 'ai_spend_ceiling:founder') WHERE NEW.founder_id IS NOT NULL AND COALESCE((SELECT spent_cents + reserved_cents FROM ai_daily_spend
    WHERE scope = 'founder' AND scope_id = NEW.founder_id AND date = NEW.date), 0) + NEW.reserved_cents > NEW.founder_cap_cents
    ;
END;

CREATE TRIGGER IF NOT EXISTS ai_spend_reservation_apply
AFTER INSERT ON ai_spend_reservations
BEGIN
  INSERT INTO ai_daily_spend(scope, scope_id, date, spent_cents, reserved_cents, updated_at)
    VALUES('global', '__global__', NEW.date, 0, NEW.reserved_cents, NEW.updated_at)
    ON CONFLICT(scope, scope_id, date) DO UPDATE SET reserved_cents = reserved_cents + NEW.reserved_cents, updated_at = NEW.updated_at;
  INSERT INTO ai_daily_spend(scope, scope_id, date, spent_cents, reserved_cents, updated_at)
    SELECT 'product', NEW.product_id, NEW.date, 0, NEW.reserved_cents, NEW.updated_at WHERE NEW.product_id IS NOT NULL
    ON CONFLICT(scope, scope_id, date) DO UPDATE SET reserved_cents = reserved_cents + NEW.reserved_cents, updated_at = NEW.updated_at;
  INSERT INTO ai_daily_spend(scope, scope_id, date, spent_cents, reserved_cents, updated_at)
    SELECT 'founder', NEW.founder_id, NEW.date, 0, NEW.reserved_cents, NEW.updated_at WHERE NEW.founder_id IS NOT NULL
    ON CONFLICT(scope, scope_id, date) DO UPDATE SET reserved_cents = reserved_cents + NEW.reserved_cents, updated_at = NEW.updated_at;
END;

CREATE TRIGGER IF NOT EXISTS ai_spend_reservation_finish
AFTER UPDATE OF status ON ai_spend_reservations
WHEN OLD.status IN ('reserved','ambiguous') AND NEW.status IN ('settled','released','expired')
BEGIN
  UPDATE ai_daily_spend SET reserved_cents = MAX(reserved_cents - OLD.reserved_cents, 0),
    spent_cents = spent_cents + COALESCE(NEW.actual_cents, 0),
    updated_at = NEW.updated_at WHERE scope = 'global' AND scope_id = '__global__' AND date = OLD.date;
  UPDATE ai_daily_spend SET reserved_cents = MAX(reserved_cents - OLD.reserved_cents, 0),
    spent_cents = spent_cents + COALESCE(NEW.actual_cents, 0),
    updated_at = NEW.updated_at WHERE scope = 'product' AND scope_id = OLD.product_id AND date = OLD.date;
  UPDATE ai_daily_spend SET reserved_cents = MAX(reserved_cents - OLD.reserved_cents, 0),
    spent_cents = spent_cents + COALESCE(NEW.actual_cents, 0),
    updated_at = NEW.updated_at WHERE scope = 'founder' AND scope_id = OLD.founder_id AND date = OLD.date;
END;
