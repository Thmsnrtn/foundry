-- =============================================================================
-- THE WORKSHOP HAS ONE PUBLIC FACE
--
-- The first real experiment reached the edge of the world and found that the
-- world has a price the plan had not counted: a domain, a sender, a mailbox,
-- a page somebody could trust, a legal surface, and the owner's own attention
-- to set every one of them up. A test is not cheap because its offer is cheap.
--
-- This migration gives the institution the thing that makes the second and
-- the hundredth test cheap where the first was not: ONE durable public
-- identity, operated by the owner as a person, through which every externally
-- exposed experiment enters the world, and nothing else does. Concretely:
--
--   * the Workshop's settings: the name the public sees, the origin it lives
--     at, the company it acts and sends as, and the owner's pause on NEW
--     economic activity, which stops offers and leaves obligations standing;
--   * the public identity of an experiment: a number and a slug that never
--     change, and the public copy the page is built from, so the page is a
--     projection of rows and never a second truth;
--   * publications: what was put at which public path, its digest, and
--     whether the public world was seen to carry it; an offer to a stranger
--     needs one that was seen;
--   * suppression at the Workshop level: somebody who said no to Experiment 3
--     is not written to by Experiment 18; and the Workshop's own contact
--     history, so frequency across experiments is a fact and not a hope;
--   * receipts for every mutation of the public infrastructure: what was
--     there, what was asked, what the provider said, what the world then
--     showed, and how to put it back;
--   * the capabilities the public infrastructure needs, each with its rung,
--     so the door knows the consequence of the tool that publishes a page.
--
-- What it deliberately does not contain: any tool that could transfer the
-- domain, change its nameservers, delete a zone, or touch a zone that is not
-- the Workshop's. Those are not capabilities with a high rung; they are
-- capabilities the institution does not have.
-- =============================================================================

-- ─── The Workshop ────────────────────────────────────────────────────────────
CREATE TABLE public_workshop (
  founder_id       TEXT PRIMARY KEY REFERENCES founders(id),
  -- The company the Workshop acts and sends as: the owner's one earned real
  -- company. Its sending identity is the Workshop's sender.
  product_id       TEXT NOT NULL REFERENCES products(id),
  public_name      TEXT NOT NULL,                 -- 'Apex Micro'
  operator_name    TEXT NOT NULL,                 -- 'Thomas Norton'
  origin           TEXT NOT NULL,                 -- 'https://apexmicro.ai'
  zone_name        TEXT NOT NULL,                 -- 'apexmicro.ai'
  contact_email    TEXT NOT NULL,                 -- 'thomas@apexmicro.ai'
  statement        TEXT NOT NULL,                 -- the owner-approved founding voice
  about            TEXT NOT NULL DEFAULT '',      -- owner-supplied biography, never mined
  worker_name      TEXT NOT NULL DEFAULT 'apexmicro',
  kv_namespace_id  TEXT,
  -- Commercial mail carries a postal address by law (CAN-SPAM); the owner
  -- supplies one, never his home address by default, and none is invented.
  postal_address   TEXT,
  -- The last health reading, kept so the owner sees the last known state when
  -- the provider cannot be reached right now.
  health_json      TEXT,
  health_at        TEXT,
  -- How often the Workshop may write to the same address across experiments.
  contact_gap_days         INTEGER NOT NULL DEFAULT 90,
  contact_ceiling_per_year INTEGER NOT NULL DEFAULT 3,
  -- STOP NEW ECONOMIC ACTIVITY is not the same as abandon what is owed. While
  -- set: no offers, no placements, no new experiments run. Deliveries,
  -- refunds and the public record carry on.
  economic_pause_at     TEXT,
  economic_pause_reason TEXT,
  economic_pause_by     TEXT,
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER public_workshop_guard
BEFORE INSERT ON public_workshop
BEGIN
  SELECT RAISE(ABORT,'public_workshop:incomplete')
    WHERE trim(NEW.public_name) = '' OR trim(NEW.operator_name) = '' OR trim(NEW.statement) = ''
       OR trim(NEW.contact_email) = '' OR trim(NEW.zone_name) = '';
  SELECT RAISE(ABORT,'public_workshop:origin_must_be_https_on_its_zone')
    WHERE NEW.origin <> 'https://' || NEW.zone_name;
  SELECT RAISE(ABORT,'public_workshop:contact_must_be_on_its_zone')
    WHERE NEW.contact_email NOT LIKE '%@' || NEW.zone_name;
  SELECT RAISE(ABORT,'public_workshop:acts_as_an_earned_real_company') WHERE NOT EXISTS (
    SELECT 1 FROM products p WHERE p.id = NEW.product_id AND p.owner_id = NEW.founder_id
      AND p.standing = 'earned' AND p.reality = 'real' AND p.deleted_at IS NULL);
  SELECT RAISE(ABORT,'public_workshop:cannot_arrive_paused') WHERE NEW.economic_pause_at IS NOT NULL;
END;

CREATE TRIGGER public_workshop_pause_guard
BEFORE UPDATE ON public_workshop
BEGIN
  SELECT RAISE(ABORT,'public_workshop:identity_is_durable')
    WHERE NEW.founder_id IS NOT OLD.founder_id OR NEW.zone_name IS NOT OLD.zone_name OR NEW.origin IS NOT OLD.origin;
  SELECT RAISE(ABORT,'public_workshop:pause_needs_reason_and_witness')
    WHERE NEW.economic_pause_at IS NOT NULL
      AND (trim(coalesce(NEW.economic_pause_reason,'')) = '' OR trim(coalesce(NEW.economic_pause_by,'')) = '');
  SELECT RAISE(ABORT,'public_workshop:pause_is_the_owners')
    WHERE NEW.economic_pause_at IS NOT OLD.economic_pause_at
      AND NEW.economic_pause_at IS NOT NULL AND NEW.economic_pause_by <> 'founder:' || NEW.founder_id;
END;

-- ─── The public identity of an experiment ────────────────────────────────────
-- A number and a slug, given once and never changed: the address a stranger
-- was sent to must still answer years later. The public copy lives here too,
-- authored for publication and separate from the private design, so the page
-- renders from rows through an explicit boundary and nothing private can
-- leak by being near.
CREATE TABLE public_experiments (
  experiment_id    TEXT PRIMARY KEY REFERENCES venture_experiments(id),
  founder_id       TEXT NOT NULL REFERENCES founders(id),
  number           INTEGER NOT NULL,
  slug             TEXT NOT NULL,
  -- Listed in the public registry. A rehearsal of the machinery is published
  -- (the machinery is the thing rehearsed) but not listed among real tests.
  listed           INTEGER NOT NULL DEFAULT 1,
  public_title     TEXT NOT NULL,
  public_summary   TEXT NOT NULL,   -- one or two plain sentences: what and why
  public_who       TEXT NOT NULL,   -- who it is for
  public_what      TEXT NOT NULL,   -- exactly what a buyer receives
  public_limits    TEXT NOT NULL,   -- what it does not claim
  public_sources   TEXT NOT NULL,   -- what it relies on
  public_selection TEXT NOT NULL,   -- why somebody received an email
  public_note      TEXT NOT NULL,   -- the operator's personal section
  -- Written at conclusion, in public words, at the right abstraction level.
  public_outcome   TEXT,
  supersedes_experiment_id TEXT REFERENCES venture_experiments(id),
  graduated_to_url TEXT,
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(founder_id, number),
  UNIQUE(founder_id, slug)
);

CREATE TRIGGER public_experiment_guard
BEFORE INSERT ON public_experiments
BEGIN
  SELECT RAISE(ABORT,'public_experiment:experiment_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM venture_experiments e WHERE e.id = NEW.experiment_id AND e.founder_id = NEW.founder_id);
  SELECT RAISE(ABORT,'public_experiment:slug_invalid')
    WHERE NEW.slug GLOB '*[^a-z0-9-]*' OR NEW.slug LIKE '-%' OR NEW.slug LIKE '%-' OR length(NEW.slug) < 3 OR length(NEW.slug) > 60;
  SELECT RAISE(ABORT,'public_experiment:number_invalid') WHERE NEW.number < 1;
  SELECT RAISE(ABORT,'public_experiment:copy_incomplete')
    WHERE trim(NEW.public_title) = '' OR trim(NEW.public_summary) = '' OR trim(NEW.public_who) = ''
       OR trim(NEW.public_what) = '' OR trim(NEW.public_limits) = '' OR trim(NEW.public_sources) = ''
       OR trim(NEW.public_selection) = '' OR trim(NEW.public_note) = '';
  SELECT RAISE(ABORT,'public_experiment:cannot_arrive_concluded') WHERE NEW.public_outcome IS NOT NULL OR NEW.graduated_to_url IS NOT NULL;
  SELECT RAISE(ABORT,'public_experiment:supersedes_unknown') WHERE NEW.supersedes_experiment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM venture_experiments e WHERE e.id = NEW.supersedes_experiment_id AND e.founder_id = NEW.founder_id);
END;

CREATE TRIGGER public_experiment_identity_is_durable
BEFORE UPDATE ON public_experiments
BEGIN
  SELECT RAISE(ABORT,'public_experiment:identity_is_durable')
    WHERE NEW.experiment_id IS NOT OLD.experiment_id OR NEW.founder_id IS NOT OLD.founder_id
       OR NEW.number IS NOT OLD.number OR NEW.slug IS NOT OLD.slug
       OR NEW.supersedes_experiment_id IS NOT OLD.supersedes_experiment_id;
  -- A public outcome is written about a test that has ended: settled, stopped
  -- or declined. Writing one earlier would be a prediction dressed as a result.
  SELECT RAISE(ABORT,'public_experiment:outcome_needs_an_ended_test')
    WHERE NEW.public_outcome IS NOT NULL AND NEW.public_outcome IS NOT OLD.public_outcome AND NOT EXISTS (
      SELECT 1 FROM venture_experiments e WHERE e.id = NEW.experiment_id
        AND (e.ran_at IS NOT NULL OR e.decision = 'declined' OR e.validity = 'invalid'
             OR EXISTS (SELECT 1 FROM experiment_exposures x WHERE x.experiment_id = e.id AND x.withdrawn_at IS NOT NULL)));
END;

-- ─── Publications: what the world was shown, and whether it was seen ─────────
CREATE TABLE public_publications (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  path           TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('page','experiment')),
  experiment_id  TEXT REFERENCES venture_experiments(id),
  version        INTEGER NOT NULL,
  digest         TEXT NOT NULL,
  bytes          INTEGER NOT NULL,
  published_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_by   TEXT NOT NULL,
  invocation_id  TEXT,
  -- The provider accepting the page is not the page existing. This is the
  -- public world's answer, read back over HTTPS.
  verified_at     TEXT,
  verified_status TEXT CHECK (verified_status IN ('verified','mismatch','unreachable')),
  verified_detail TEXT,
  superseded_at  TEXT
);
CREATE UNIQUE INDEX idx_public_publication_live ON public_publications(founder_id, path) WHERE superseded_at IS NULL;
CREATE INDEX idx_public_publication_experiment ON public_publications(experiment_id, superseded_at);

CREATE TRIGGER public_publication_guard
BEFORE INSERT ON public_publications
BEGIN
  SELECT RAISE(ABORT,'public_publication:path_invalid')
    WHERE NEW.path NOT LIKE '/%' OR NEW.path LIKE '%..%' OR NEW.path LIKE '%?%' OR NEW.path LIKE '%#%'
       OR NEW.path GLOB '*[^a-z0-9/-]*';
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
  -- AN EXPERIMENT IS PUBLISHED ONLY WHEN THE OWNER HAS DECIDED IT. Before his
  -- decision nothing exists to put the Workshop's name behind. A declined test
  -- that was never published stays unpublished; one that was published stays
  -- (its record is the point), and its page says what happened.
  SELECT RAISE(ABORT,'public_publication:experiment_not_approved')
    WHERE NEW.kind = 'experiment' AND NOT EXISTS (
      SELECT 1 FROM venture_experiments e WHERE e.id = NEW.experiment_id AND e.decision = 'approved');
  SELECT RAISE(ABORT,'public_publication:version_must_follow')
    WHERE NEW.version <> 1 + coalesce((SELECT max(version) FROM public_publications p
                                        WHERE p.founder_id = NEW.founder_id AND p.path = NEW.path), 0);
END;

CREATE TRIGGER public_publication_record_is_durable
BEFORE UPDATE ON public_publications
BEGIN
  SELECT RAISE(ABORT,'public_publication:immutable')
    WHERE NEW.founder_id IS NOT OLD.founder_id OR NEW.path IS NOT OLD.path OR NEW.kind IS NOT OLD.kind
       OR NEW.experiment_id IS NOT OLD.experiment_id OR NEW.version IS NOT OLD.version
       OR NEW.digest IS NOT OLD.digest OR NEW.bytes IS NOT OLD.bytes OR NEW.published_at IS NOT OLD.published_at
       OR NEW.published_by IS NOT OLD.published_by;
  SELECT RAISE(ABORT,'public_publication:verification_needs_time_and_status')
    WHERE (NEW.verified_at IS NULL) <> (NEW.verified_status IS NULL);
END;
-- APPEND-ONLY, AND ERASURE STILL BEATS IT (migrations 162 and 224). "Append-only
-- means history is not rewritten. It does not mean a person's data outlives
-- their right to have it removed." Every delete on the four append-only tables
-- below is refused, except while the owner's company is on its way out — the
-- one case where refusing would turn a promise about honesty into a promise
-- that a person cannot leave. The marker is the same one erasure already sets,
-- read through the owner, because the plan removes children before parents.
CREATE TRIGGER public_publication_never_deleted
BEFORE DELETE ON public_publications
BEGIN
  SELECT RAISE(ABORT,'public_publication:never_deleted') WHERE NOT EXISTS (
    SELECT 1 FROM products p WHERE p.owner_id = OLD.founder_id AND p.erasure_scheduled_at IS NOT NULL);
END;

-- ─── Suppression and contact history at the Workshop level ───────────────────
-- The company-level list (migration 094) answers "did this person tell THIS
-- company to stop". The Workshop is one public identity across every
-- experiment, so a no said to one is a no said to all of it.
CREATE TABLE public_suppressions (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  email          TEXT NOT NULL,
  reason         TEXT NOT NULL CHECK (reason IN ('they_asked','bounced','complained','founder')),
  source         TEXT NOT NULL CHECK (source IN ('page_opt_out','provider','reply','owner')),
  experiment_id  TEXT REFERENCES venture_experiments(id),
  note           TEXT,
  recorded_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(founder_id, email)
);
CREATE TRIGGER public_suppression_guard
BEFORE INSERT ON public_suppressions
BEGIN
  SELECT RAISE(ABORT,'public_suppression:email_invalid')
    WHERE NEW.email NOT LIKE '%_@_%.__%' OR NEW.email <> lower(trim(NEW.email));
END;
CREATE TRIGGER public_suppression_append_only_update
BEFORE UPDATE ON public_suppressions
BEGIN SELECT RAISE(ABORT,'public_suppression:append_only'); END;
CREATE TRIGGER public_suppression_append_only_delete
BEFORE DELETE ON public_suppressions
BEGIN
  SELECT RAISE(ABORT,'public_suppression:append_only') WHERE NOT EXISTS (
    SELECT 1 FROM products p WHERE p.owner_id = OLD.founder_id AND p.erasure_scheduled_at IS NOT NULL);
END;

CREATE TABLE public_contacts (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  email          TEXT NOT NULL,
  experiment_id  TEXT NOT NULL REFERENCES venture_experiments(id),
  action_id      TEXT NOT NULL REFERENCES outbound_actions(id),
  contacted_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(action_id)
);
CREATE INDEX idx_public_contacts_email ON public_contacts(founder_id, email, contacted_at);
CREATE TRIGGER public_contact_append_only_update
BEFORE UPDATE ON public_contacts
BEGIN SELECT RAISE(ABORT,'public_contact:append_only'); END;
CREATE TRIGGER public_contact_append_only_delete
BEFORE DELETE ON public_contacts
BEGIN
  SELECT RAISE(ABORT,'public_contact:append_only') WHERE NOT EXISTS (
    SELECT 1 FROM products p WHERE p.owner_id = OLD.founder_id AND p.erasure_scheduled_at IS NOT NULL);
END;

-- ─── Receipts for the public infrastructure ──────────────────────────────────
-- The provider saying yes is a claim. What was there before, what was asked,
-- what came back and what the world then showed are the record; the previous
-- state is also how the change is put back.
CREATE TABLE cloudflare_mutations (
  id                TEXT PRIMARY KEY,
  founder_id        TEXT NOT NULL REFERENCES founders(id),
  product_id        TEXT NOT NULL REFERENCES products(id),
  tool              TEXT NOT NULL,
  resource          TEXT NOT NULL,
  purpose           TEXT NOT NULL,
  authority         TEXT NOT NULL,
  previous_json     TEXT,
  requested_json    TEXT NOT NULL,
  response_json     TEXT,
  outcome           TEXT NOT NULL CHECK (outcome IN ('applied','refused','failed')),
  verification_json TEXT,
  verified_at       TEXT,
  rollback_json     TEXT,
  invocation_id     TEXT,
  recorded_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_cloudflare_mutations_resource ON cloudflare_mutations(founder_id, resource, recorded_at);
CREATE TRIGGER cloudflare_mutation_guard
BEFORE INSERT ON cloudflare_mutations
BEGIN
  SELECT RAISE(ABORT,'cloudflare_mutation:incomplete')
    WHERE trim(NEW.tool) = '' OR trim(NEW.resource) = '' OR trim(NEW.purpose) = '' OR trim(NEW.authority) = '';
END;
CREATE TRIGGER cloudflare_mutation_is_a_record
BEFORE UPDATE ON cloudflare_mutations
BEGIN
  SELECT RAISE(ABORT,'cloudflare_mutation:only_verification_may_follow')
    WHERE NEW.founder_id IS NOT OLD.founder_id OR NEW.product_id IS NOT OLD.product_id OR NEW.tool IS NOT OLD.tool
       OR NEW.resource IS NOT OLD.resource OR NEW.purpose IS NOT OLD.purpose OR NEW.authority IS NOT OLD.authority
       OR NEW.previous_json IS NOT OLD.previous_json OR NEW.requested_json IS NOT OLD.requested_json
       OR NEW.response_json IS NOT OLD.response_json OR NEW.outcome IS NOT OLD.outcome
       OR NEW.rollback_json IS NOT OLD.rollback_json OR NEW.invocation_id IS NOT OLD.invocation_id
       OR NEW.recorded_at IS NOT OLD.recorded_at;
END;
CREATE TRIGGER cloudflare_mutation_never_deleted
BEFORE DELETE ON cloudflare_mutations
BEGIN
  SELECT RAISE(ABORT,'cloudflare_mutation:never_deleted') WHERE NOT EXISTS (
    SELECT 1 FROM products p WHERE p.id = OLD.product_id AND p.erasure_scheduled_at IS NOT NULL);
END;

-- ─── The capabilities the public infrastructure needs ────────────────────────
-- Each is one tool at the door with one consequence. There is no tool here
-- for anything outside the Workshop's own zone, and none that could transfer,
-- re-delegate or delete it: the envelope is what does not exist.
DROP TRIGGER capabilities_constitutional_insert;
INSERT INTO capabilities (capability_key, family, what_it_does, rung, sort_order) VALUES
  ('prepare_public_store',  'public_workshop', 'make the one store the Workshop''s pages are served from; nobody outside sees it', 'prepare', 95),
  ('publish_public_page',   'public_workshop', 'put a page where anyone can read it, at the Workshop''s own address', 'public', 96),
  ('sweep_public_store',    'public_workshop', 'remove a record from the Workshop''s public store after it has been kept privately', 'reversible', 97),
  ('operate_public_dns',    'public_workshop', 'set one DNS record on the Workshop''s own zone, keeping what it replaced', 'reversible', 98),
  ('retire_public_dns',     'public_workshop', 'remove one DNS record from the Workshop''s own zone, keeping what it was', 'reversible', 99),
  ('deploy_public_workshop',         'public_workshop', 'put the Workshop''s public program where it serves the public', 'public', 100),
  ('attach_public_domain',  'public_workshop', 'point the Workshop''s own hostname at its public program', 'public', 101),
  ('route_public_mail',     'public_workshop', 'forward mail sent to the Workshop''s address to the owner', 'reversible', 102);
CREATE TRIGGER capabilities_constitutional_insert BEFORE INSERT ON capabilities
BEGIN SELECT RAISE(ABORT,'capability:constitutional'); END;
INSERT INTO capability_providers (id, capability_key, provider, how, tool, cost_note, maturity, sort_order) VALUES
  ('cp_public_store_cf',   'prepare_public_store', 'cloudflare', 'api', 'cloudflare_kv_namespace_create', 'none', 'available', 1),
  ('cp_public_page_cf',    'publish_public_page',  'cloudflare', 'api', 'cloudflare_kv_put',            'within the provider''s free allowance at this scale', 'available', 1),
  ('cp_public_sweep_cf',   'sweep_public_store',   'cloudflare', 'api', 'cloudflare_kv_delete',         'none', 'available', 1),
  ('cp_public_dns_cf',     'operate_public_dns',   'cloudflare', 'api', 'cloudflare_dns_upsert',        'none', 'available', 1),
  ('cp_public_dns_off_cf', 'retire_public_dns',    'cloudflare', 'api', 'cloudflare_dns_delete',        'none', 'available', 1),
  ('cp_public_deploy_cf',  'deploy_public_workshop',        'cloudflare', 'api', 'cloudflare_worker_deploy',     'within the provider''s free allowance at this scale', 'available', 1),
  ('cp_public_domain_cf',  'attach_public_domain', 'cloudflare', 'api', 'cloudflare_domain_attach',     'none', 'available', 1),
  ('cp_public_mail_cf',    'route_public_mail',    'cloudflare', 'api', 'cloudflare_email_route_upsert','none', 'available', 1);

-- ─── The plan guard learns the Workshop ──────────────────────────────────────
-- An offer to a stranger now needs three more things the rows can check: the
-- Workshop is not paused, the person has not said no to the Workshop, and the
-- page the message points at was seen in the public world.
DROP TRIGGER experiment_action_plan_guard;
CREATE TRIGGER experiment_action_plan_guard
BEFORE INSERT ON outbound_actions WHEN NEW.experiment_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT,'experiment_action:born_approved') WHERE NEW.status <> 'pending_approval'
    OR NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL OR NEW.executed_at IS NOT NULL;
  SELECT RAISE(ABORT,'experiment_action:binding_invalid') WHERE NEW.experiment_act IS NULL
    OR NEW.proposed_act_id IS NULL OR NEW.effect_id IS NULL
    OR NEW.action_type <> 'send_email' OR NEW.integration_name <> 'resend'
    OR NEW.responsibility_id IS NOT NULL OR NEW.authority_consent_id IS NOT NULL;
  SELECT RAISE(ABORT,'experiment_action:asset_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM products p WHERE p.id = NEW.product_id AND p.from_experiment_id = NEW.experiment_id
      AND p.standing = 'experimental' AND p.deleted_at IS NULL);
  SELECT RAISE(ABORT,'experiment_action:experiment_not_live') WHERE NOT EXISTS (
    SELECT 1 FROM venture_experiments e WHERE e.id = NEW.experiment_id AND e.decision = 'approved'
      AND (e.ran_at IS NULL OR NEW.experiment_act = 'delivery') AND e.validity = 'valid');
  SELECT RAISE(ABORT,'experiment_action:not_authorised') WHERE NOT EXISTS (
    SELECT 1 FROM proposed_acts a WHERE a.id = NEW.proposed_act_id AND a.product_id = NEW.product_id
      AND a.experiment_id = NEW.experiment_id AND coalesce(a.measurement_critical, 0) = 1
      AND a.subject = 'contact_people' AND a.action_type = 'send_email'
      AND a.decision = 'approved' AND a.revoked_at IS NULL AND datetime(a.expires_at) > datetime('now'));
  SELECT RAISE(ABORT,'experiment_action:recipient_not_approved') WHERE NEW.experiment_act = 'offer' AND NOT EXISTS (
    SELECT 1 FROM experiment_recipients r WHERE r.id = NEW.recipient_id AND r.experiment_id = NEW.experiment_id
      AND r.review_status = 'approved' AND r.channel = 'email'
      AND r.email = coalesce(json_extract(NEW.parameters_json, '$.to[0]'), ''));
  SELECT RAISE(ABORT,'experiment_action:nothing_owed') WHERE NEW.experiment_act = 'delivery' AND NOT EXISTS (
    SELECT 1 FROM experiment_fulfilments f WHERE f.id = NEW.fulfilment_id AND f.experiment_id = NEW.experiment_id
      AND f.status = 'owed');
  -- THE WORKSHOP'S RULES. Offers only: what a buyer is owed survives a pause.
  SELECT RAISE(ABORT,'experiment_action:workshop_paused') WHERE NEW.experiment_act = 'offer' AND EXISTS (
    SELECT 1 FROM public_workshop w JOIN venture_experiments e ON e.founder_id = w.founder_id
     WHERE e.id = NEW.experiment_id AND w.economic_pause_at IS NOT NULL);
  SELECT RAISE(ABORT,'experiment_action:recipient_suppressed') WHERE NEW.experiment_act = 'offer' AND EXISTS (
    SELECT 1 FROM public_suppressions s JOIN venture_experiments e ON e.founder_id = s.founder_id
     WHERE e.id = NEW.experiment_id AND s.email = lower(coalesce(json_extract(NEW.parameters_json, '$.to[0]'), '')));
  -- The page is required of an owner who HAS a public Workshop: under one, no
  -- stranger is written to without a record they can read; without one, the
  -- pre-Workshop path stands unchanged.
  SELECT RAISE(ABORT,'experiment_action:no_public_page') WHERE NEW.experiment_act = 'offer'
    AND EXISTS (SELECT 1 FROM public_workshop w JOIN venture_experiments e ON e.founder_id = w.founder_id
                 WHERE e.id = NEW.experiment_id)
    AND NOT EXISTS (
      SELECT 1 FROM public_publications p WHERE p.experiment_id = NEW.experiment_id AND p.kind = 'experiment'
        AND p.superseded_at IS NULL AND p.verified_status = 'verified');
END;
