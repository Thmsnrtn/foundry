-- =============================================================================
-- THE WORKSHOP CAN BE FOUND.
--
-- A page nobody can find is silence with a receipt. Until now every public
-- page carried no canonical address, no crawler could read a sitemap because
-- none existed, and none could have been served: the row guard refused any
-- path with a dot in it, and the program served everything as HTML.
--
-- Two files, and only these two, may now be published beside the pages:
-- `/robots.txt` and `/sitemap.xml`. Everything else the guard refused it still
-- refuses — no `..`, no query, no fragment, no capital, no other extension.
-- The guard is recreated whole, with every other rule as it was.
-- =============================================================================

DROP TRIGGER IF EXISTS public_publication_guard;
CREATE TRIGGER public_publication_guard
BEFORE INSERT ON public_publications
BEGIN
  SELECT RAISE(ABORT,'public_publication:path_invalid')
    WHERE NEW.path NOT LIKE '/%' OR NEW.path LIKE '%..%' OR NEW.path LIKE '%?%' OR NEW.path LIKE '%#%'
       OR (NEW.path GLOB '*[^a-z0-9/-]*' AND NEW.path NOT IN ('/robots.txt', '/sitemap.xml'));
  SELECT RAISE(ABORT,'public_publication:incomplete')
    WHERE trim(NEW.digest) = '' OR NEW.bytes <= 0 OR trim(NEW.published_by) = '';
  SELECT RAISE(ABORT,'public_publication:cannot_arrive_verified')
    WHERE NEW.verified_at IS NOT NULL OR NEW.verified_status IS NOT NULL;
  SELECT RAISE(ABORT,'public_publication:experiment_needs_a_public_identity')
    WHERE NEW.kind = 'experiment' AND NOT EXISTS (
      SELECT 1 FROM public_experiments w WHERE w.experiment_id = NEW.experiment_id AND w.founder_id = NEW.founder_id
        AND NEW.path = '/experiments/' || w.slug);
  SELECT RAISE(ABORT,'public_publication:page_carries_no_experiment')
    WHERE NEW.kind = 'page' AND NEW.experiment_id IS NOT NULL;
  SELECT RAISE(ABORT,'public_publication:experiment_not_approved')
    WHERE NEW.kind = 'experiment' AND NOT EXISTS (
      SELECT 1 FROM venture_experiments e WHERE e.id = NEW.experiment_id AND e.decision = 'approved');
  SELECT RAISE(ABORT,'public_publication:version_must_follow')
    WHERE NEW.version <> 1 + coalesce((SELECT max(version) FROM public_publications p
                                        WHERE p.founder_id = NEW.founder_id AND p.path = NEW.path), 0);
END;
