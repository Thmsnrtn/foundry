-- =============================================================================
-- FOUNDRY — the same offer to two kinds of shop
--
-- Experiment 001 asks whether a Massachusetts millwork business will pay $29
-- for a screened brief of public bid notices. Until now its population required
-- OBSERVED PUBLIC-SECTOR WORK: a named public project on the shop's own record,
-- or a public payment record naming it.
--
-- THAT CRITERION SELECTS AGAINST THE OFFER. A shop whose public-work history is
-- easy to see is a shop that already knows how to find these notices, and
-- therefore needs a screening brief least. The criterion was not too loose; it
-- was pointed at the wrong end of the market, and holding it would have tested
-- the proposition on the customers least likely to want it.
--
-- So the population is now the shop that could plausibly do the work in the
-- brief, and prior public work is kept as an OBSERVATION rather than a gate.
--
-- TWO STRATA, AND THEY ARE NOT GRADES. Both are fully qualified, both get the
-- same $29 offer, the same words and the same one message. The split exists
-- because it may turn out to be the commercially interesting thing this
-- experiment learns: the shops with no visible public-sector footprint are the
-- ones with the most to gain from being told where the work is.
--
-- A difference between the strata afterwards is exploratory evidence and this
-- schema will not pretend otherwise. Eight or forty businesses split two ways
-- cannot settle a segmentation question; it can only say which way to look next.
-- =============================================================================

ALTER TABLE experiment_recipients ADD COLUMN evidence_stratum TEXT
  CHECK (evidence_stratum IN ('public_work_observed', 'commercial_institutional_capable'));

CREATE TRIGGER experiment_recipient_stratum_guard
BEFORE UPDATE OF evidence_stratum ON experiment_recipients
BEGIN
  -- A STRATUM IS AN OBSERVATION ABOUT A QUALIFIED BUSINESS, so there must be a
  -- qualification for it to be about. Recording which stratum a business is in
  -- before recording why it is in the population at all would make the split
  -- the reason rather than a description of the reason.
  SELECT RAISE(ABORT,'experiment_recipient:stratum_needs_a_qualification')
    WHERE NEW.evidence_stratum IS NOT NULL AND NEW.qualified_at IS NULL;
  -- AND IT IS SETTLED BEFORE ANYBODY IS WRITTEN TO. If a stratum could be
  -- revised after the results were in, the comparison between strata would be
  -- unfalsifiable — whichever group paid could be relabelled the interesting
  -- one. This is the same rule the contact kind lives under, for the same
  -- reason.
  SELECT RAISE(ABORT,'experiment_recipient:stratum_stands')
    WHERE OLD.evidence_stratum IS NOT NULL AND NEW.evidence_stratum IS NOT OLD.evidence_stratum;
END;
