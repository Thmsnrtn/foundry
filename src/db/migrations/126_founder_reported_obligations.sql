-- Migration 126: generic founder-reported obligations, and the intake the
-- institution never had.
--
-- Audit finding that motivated this: `emitSignalEvent` — the only function that
-- records a company signal AND runs responsibility discovery — has no caller
-- anywhere in `src/`. Nothing in production produces company evidence at all,
-- so the ladder's first rung had no supply either. The previous session's
-- record said discovery was "driven in production"; it is reachable, and it was
-- never fed.
--
-- Second finding, from auditing the four admitted signal kinds
-- (`payment_failed`, `churn_detected`, `support_spike`, `activation_failure`):
-- the limit is BOTH intentional and accidental. Intentional in its semantics —
-- discovery admits only evidence whose operational responsibility is
-- unambiguous, which is why `nps_drop`, `revenue_milestone`,
-- `expansion_signal`, and `competitor_signal` are excluded: they are
-- observations, not obligations. Accidental in its vocabulary — those four
-- names are SaaS-shaped, so a marina or a dance school can only be recognised
-- when its reality happens to fit a software company's words.
--
-- The fix keeps the semantics and drops the vocabulary dependency. A founder
-- may report something their company must handle, choosing from a closed set of
-- GENERIC operational obligations. No industry enums, no per-sector heuristics,
-- and nothing inferred from free-form chat: the founder states the kind
-- explicitly, and ambiguity stays conversation.
--
-- CONSTITUTIONAL BOUNDARY: a report is evidence that something must be handled.
-- It is not authority to handle it, not a consent, and not a maturity claim.
-- The reported responsibility enters at Visible like any other, and every fact
-- needed to understand it must still be established.

CREATE TRIGGER founder_report_guard
BEFORE INSERT ON signal_events WHEN NEW.source='founder_report'
BEGIN
  SELECT RAISE(ABORT,'founder_report:payload_invalid') WHERE
    json_valid(NEW.payload_json)=0
    OR trim(coalesce(json_extract(NEW.payload_json,'$.obligation_kind'),''))=''
    OR trim(coalesce(json_extract(NEW.payload_json,'$.what'),''))=''
    OR trim(coalesce(json_extract(NEW.payload_json,'$.founder_id'),''))='';

  -- Generic operational semantics only. Each of these is a shape of obligation
  -- any company can have; none of them names an industry. Widening the set
  -- means editing a migration, which is inside the constitutional ring — so a
  -- sector-specific enum cannot be added at runtime by anyone, including a
  -- well-meaning integration.
  SELECT RAISE(ABORT,'founder_report:obligation_kind_invalid')
  WHERE json_extract(NEW.payload_json,'$.obligation_kind') NOT IN (
    'recurring_work','customer_commitment','exception','revenue_collection',
    'delivery','maintenance','development','operational_dependency');

  -- Identity is verified against real ownership. A caller-supplied founder
  -- string cannot establish who is speaking for the company.
  SELECT RAISE(ABORT,'founder_report:founder_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM products p
    WHERE p.id=NEW.product_id AND p.owner_id=json_extract(NEW.payload_json,'$.founder_id'));

  -- Reporting an obligation is not granting permission to discharge it. As with
  -- a founder assertion, the whole report is refused rather than stored with
  -- the field quietly dropped.
  SELECT RAISE(ABORT,'founder_report:authority_smuggled') WHERE
    json_extract(NEW.payload_json,'$.consent') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.consent_id') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.capability') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.authority') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.scope') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.to_mode') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.expires_at') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.grant') IS NOT NULL
    OR json_extract(NEW.payload_json,'$.state') IS NOT NULL;
END;
