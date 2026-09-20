-- =============================================================================
-- THE CHANNEL KEEPS ITS OWN RECORD.
--
-- Nineteen cold emails went to strangers inviting a reply; the Workshop's
-- reply path was not routed; seven days later the sealed rule settled the test
-- SURPRISED and the institution filed that as evidence about a market. Nothing
-- was fabricated and no rule was broken — the rule counted confirmed
-- deliveries and payments, and there were none. The failure is upstream of
-- every safeguard: a null result is only evidence about the world if the
-- world could have answered.
--
-- The institution could say the path was broken NOW, because the Workshop
-- carries one health snapshot (`public_workshop.health_json`, overwritten
-- hourly). It could not say whether the path was open on the days the test was
-- running, so the honest sentence had to stop at "I cannot say". That is the
-- proof debt this migration pays.
--
-- ONE ROW PER PATH PER DAY, written by the pass that already reads the health
-- (`public_workshop_tick`). Not an event log: a day is the unit an owner reads
-- and the unit a test's window is measured in, and the worst reading of the
-- day is the one that matters — a path that was down for an hour could not
-- carry a reply sent in that hour. `worst_status` is therefore kept rather
-- than the last reading, and `readings` says how many were taken, so a day
-- with one reading is not mistaken for a day that was watched.
--
-- It says nothing about days before it existed, and the reader
-- (venture/the-instrument.ts) says so rather than assuming those days were
-- well: an absence of record is not a record of health.
-- =============================================================================

CREATE TABLE public_channel_days (
  founder_id   TEXT NOT NULL REFERENCES founders(id),
  -- The path the world would answer through: the reply mailbox, the sending
  -- identity, the public site, the provider that carries them.
  channel      TEXT NOT NULL CHECK (channel IN ('replyInbox','sending','site','cloudflare','mail')),
  day          TEXT NOT NULL,
  -- THE WORST OF THE DAY, not the last. A path that was down for an hour
  -- could not carry a reply sent in that hour, and the last reading of the
  -- day would call that day healthy.
  worst_status TEXT NOT NULL CHECK (worst_status IN ('healthy','needs_attention','unknown')),
  -- What was wrong, in the words the health reading used.
  detail       TEXT,
  -- How many readings the day got, so a day watched once is not read as a day
  -- that was watched.
  readings     INTEGER NOT NULL DEFAULT 1 CHECK (readings > 0),
  -- When the day was last looked at. There is deliberately no `first_at`
  -- beside it: `readings` already says whether a day was watched once or
  -- often, and a column nothing reads is a column that drifts.
  last_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (founder_id, channel, day)
);

CREATE INDEX idx_public_channel_days ON public_channel_days(founder_id, channel, day);

-- A DAY DOES NOT GET BETTER AFTER THE FACT. The worst reading of a day stands:
-- the pass that finds the path healthy at five may not un-say the failure it
-- recorded at four, because a message sent at four was not carried.
CREATE TRIGGER public_channel_day_keeps_the_worst
BEFORE UPDATE ON public_channel_days
BEGIN
  SELECT RAISE(ABORT,'public_channel_day:immutable') WHERE
    NEW.founder_id <> OLD.founder_id OR NEW.channel <> OLD.channel OR NEW.day <> OLD.day;
  SELECT RAISE(ABORT,'public_channel_day:a_day_does_not_get_better')
    WHERE OLD.worst_status = 'needs_attention' AND NEW.worst_status <> 'needs_attention';
  SELECT RAISE(ABORT,'public_channel_day:a_day_does_not_get_better')
    WHERE OLD.worst_status = 'unknown' AND NEW.worst_status = 'healthy';
  SELECT RAISE(ABORT,'public_channel_day:readings_only_rise') WHERE NEW.readings < OLD.readings;
END;
