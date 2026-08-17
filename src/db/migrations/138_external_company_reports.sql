-- Migration 138: a company's own tools can raise work.
--
-- THE GAP. Only two things could ever produce a responsibility: four
-- SaaS-shaped signal kinds, and the founder typing one in. Everything a company
-- actually runs on — its rota, its till, its delivery scans, its monitoring —
-- could report numbers (migration 135) but could not say "this needs handling".
-- So the ladder's first rung was fed by a human or by nothing, and the more a
-- company had already automated, the less Foundry could see.
--
-- WHAT THIS ADDS. An authenticated outside system reports something the company
-- must handle, choosing from the SAME closed set of generic operational
-- obligations the founder chooses from. Migration 126 kept the semantics and
-- dropped the SaaS vocabulary; this keeps the semantics and drops the
-- assumption that only a person can notice.
--
-- PROVENANCE IS NOT LAUNDERED. It is recorded under its own source, so a report
-- from a rota system is never mistaken for the founder saying it. The guard
-- refuses any attempt to carry a `founder_id`: a tool holding an ingest token
-- may say what it observed, and may not say who said it. Identity comes from
-- the credential; the payload does not get to claim one.
--
-- A REPORT IS STILL ONLY EVIDENCE. It is not authority, not consent, and not a
-- maturity claim. The responsibility enters at Visible like any other, every
-- fact needed to understand it must still be established, and nothing about
-- arriving from a machine makes it more or less true than a person saying it.
CREATE TRIGGER external_company_report_guard
BEFORE INSERT ON signal_events WHEN NEW.source='external_company_report'
BEGIN
  -- Every absence coalesced, as always: `X NOT IN (...)` is NULL when X is
  -- missing, and a NULL condition never fires a RAISE.
  SELECT RAISE(ABORT,'external_report:payload_invalid') WHERE
    json_valid(NEW.payload_json)=0
    OR trim(coalesce(json_extract(NEW.payload_json,'$.obligation_kind'),''))=''
    OR trim(coalesce(json_extract(NEW.payload_json,'$.what'),''))=''
    OR length(coalesce(json_extract(NEW.payload_json,'$.what'),''))>200
    OR trim(coalesce(json_extract(NEW.payload_json,'$.reported_by'),''))='';

  -- A tool may say what it observed. It may not say who said it.
  SELECT RAISE(ABORT,'external_report:identity_forged')
  WHERE json_extract(NEW.payload_json,'$.founder_id') IS NOT NULL;

  -- The same generic operational vocabulary migration 126 established, mirrored
  -- deliberately rather than shared: widening it means editing a migration,
  -- which is inside the constitutional ring, so an integration cannot introduce
  -- a sector-specific kind at runtime however well meant.
  SELECT RAISE(ABORT,'external_report:kind_invalid')
  WHERE coalesce(json_extract(NEW.payload_json,'$.obligation_kind'),'absent') NOT IN (
    'recurring_work','customer_commitment','exception','revenue_collection',
    'delivery','maintenance','development','operational_dependency');

  -- The event type is derived from the report, so what was claimed and what is
  -- recorded cannot disagree.
  SELECT RAISE(ABORT,'external_report:event_type_mismatch')
  WHERE NEW.event_type <> 'external_reported:'
    || json_extract(NEW.payload_json,'$.obligation_kind');
END;
