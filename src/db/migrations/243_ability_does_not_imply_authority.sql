-- =============================================================================
-- ABILITY DOES NOT IMPLY AUTHORITY
--
-- Two questions that used to be one. CAPABILITY answers "can Foundry actually
-- do this, with what, at what cost and maturity?" AUTHORITY answers "may
-- Foundry do this here, under what scope, consequence, budget and owner
-- policy?" Keeping them apart is what lets capability be BROAD and authority
-- PRECISE - the owner's rule - instead of crippling what the institution can do
-- in order to feel safe about what it may do.
--
-- CONSEQUENCE DETERMINES GOVERNANCE, NOT INTERFACE. Whether an effect happens
-- through an API, a browser, a shell or a future computer, what governs it is
-- the rung it sits on: observe, prepare, reversible, public, financial, legal,
-- destructive. Every capability has a ceiling rung, every tool at the outbound
-- door is bound to a capability, and the door asks the rung what authority it
-- takes. Two rungs may never be absorbed into standing policy: a legal
-- commitment and an irreversible act are the owner's, one at a time, forever.
--
-- PROVIDERS ARE IMPLEMENTATIONS; CAPABILITIES ARE INSTITUTIONAL CONCEPTS. A
-- capability may have several providers and none. Its maturity is earned and
-- witnessed - declared, available, controlled-proven, reality-proven, reliable,
-- degraded, unavailable - and a move to reality-proven takes real evidence with
-- a name on it, never a rehearsal.
--
-- THIS IS THE INVISIBLE FABRIC UNDER THE OWNER PRODUCT. Nothing here is a
-- provider catalogue for him. What he experiences is the institution saying
-- "I can carry this", "I cannot yet, and here is what it would take", or "this
-- is yours to decide", and nothing else.
-- =============================================================================

CREATE TABLE consequence_rungs (
  rung           TEXT PRIMARY KEY,
  what_it_means  TEXT NOT NULL,
  -- Whether standing policy (an allowance, a lifted boundary, a recognised
  -- responsibility) can ever pre-authorise acts on this rung. 0 means the
  -- owner decides each act, and no policy may ever change that.
  absorbable     INTEGER NOT NULL,
  sort_order     INTEGER NOT NULL
);

INSERT INTO consequence_rungs (rung, what_it_means, absorbable, sort_order) VALUES
  ('observe', 'looks, and changes nothing', 1, 1),
  ('prepare', 'makes a draft, a branch, a preview or a plan that nobody outside can see yet', 1, 2),
  ('reversible', 'changes something that can be reliably put back', 1, 3),
  ('public', 'publishes, messages or contacts someone outside', 1, 4),
  ('financial', 'spends, refunds, prices, buys or bills', 1, 5),
  ('legal', 'commits you to a contract, a licence, a regulated representation or a decision about sensitive data', 0, 6),
  ('destructive', 'deletes, shuts down, transfers or sells something, and cannot be undone', 0, 7);

CREATE TRIGGER consequence_rungs_constitutional_insert BEFORE INSERT ON consequence_rungs
BEGIN SELECT RAISE(ABORT,'consequence_rung:constitutional'); END;
CREATE TRIGGER consequence_rungs_constitutional_update BEFORE UPDATE ON consequence_rungs
BEGIN SELECT RAISE(ABORT,'consequence_rung:constitutional'); END;
CREATE TRIGGER consequence_rungs_constitutional_delete BEFORE DELETE ON consequence_rungs
BEGIN SELECT RAISE(ABORT,'consequence_rung:constitutional'); END;

-- WHAT THE INSTITUTION CAN CONCEIVABLY DO, as concepts. Seeded broadly enough
-- for the digital-asset factory the owner described; adding one is a
-- migration, because it changes what the institution can think of doing.
CREATE TABLE capabilities (
  capability_key TEXT PRIMARY KEY,
  family         TEXT NOT NULL,
  what_it_does   TEXT NOT NULL,
  -- The ceiling: the most consequential thing using this could ever be.
  rung           TEXT NOT NULL REFERENCES consequence_rungs(rung),
  sort_order     INTEGER NOT NULL
);

INSERT INTO capabilities (capability_key, family, what_it_does, rung, sort_order) VALUES
  ('read_public_web', 'research', 'read a public web page and keep what it said, with the address and the time', 'observe', 1),
  ('search_public_web', 'research', 'find pages about a thing', 'observe', 2),
  ('read_marketplace_listings', 'research', 'see what is listed and sold on a marketplace', 'observe', 3),
  ('read_reviews', 'research', 'read what customers said in public about a product', 'observe', 4),
  ('read_job_postings', 'research', 'read what companies are hiring for', 'observe', 5),
  ('read_public_dataset', 'research', 'read a published dataset', 'observe', 6),
  ('ask_a_person', 'research', 'ask somebody with the problem a question, with their consent', 'public', 7),
  ('run_survey', 'research', 'ask a group of people the same questions', 'public', 8),
  ('browse_as_a_person', 'computer', 'drive a browser through a site the way a person would, reading only', 'observe', 10),
  ('act_in_a_browser', 'computer', 'fill forms and press buttons on a site', 'public', 11),
  ('run_shell', 'computer', 'run commands in an isolated workspace', 'prepare', 12),
  ('render_screen', 'computer', 'render a page and look at the result', 'observe', 13),
  ('read_repository', 'development', 'read code and its history', 'observe', 20),
  ('write_code_in_branch', 'development', 'change code on a branch nobody deploys from', 'prepare', 21),
  ('open_pull_request', 'development', 'propose a change for review', 'prepare', 22),
  ('merge_to_main', 'development', 'make a change the deployment will pick up', 'reversible', 23),
  ('run_tests', 'testing', 'run a test suite and read the result', 'observe', 30),
  ('test_visually', 'testing', 'render screens at phone and desk widths and inspect them', 'observe', 31),
  ('probe_security', 'testing', 'attack a workspace copy to find what breaks', 'prepare', 32),
  ('build_dataset', 'data', 'gather, clean and version a dataset', 'prepare', 40),
  ('transform_data', 'data', 'reshape data from one form to another', 'prepare', 41),
  ('keep_dataset_fresh', 'data', 'refresh a dataset on a schedule and note what changed', 'prepare', 42),
  ('design_interface', 'design', 'design a screen or a flow', 'prepare', 50),
  ('produce_visual_asset', 'design', 'make an icon, image or diagram', 'prepare', 51),
  ('write_copy', 'design', 'write product copy, documentation or a landing page', 'prepare', 52),
  ('deploy_preview', 'deployment', 'deploy to an address nobody but us can see', 'prepare', 60),
  ('deploy_production', 'deployment', 'deploy where customers are', 'reversible', 61),
  ('roll_back', 'deployment', 'put a deployment back to how it was', 'reversible', 62),
  ('create_workspace', 'hosting', 'create an isolated computer for a piece of work', 'prepare', 70),
  ('run_service', 'hosting', 'keep a service running for customers', 'reversible', 71),
  ('destroy_environment', 'hosting', 'delete a computer or a service for good', 'destructive', 72),
  ('check_domain', 'domains', 'see whether a name is available and what it costs', 'observe', 80),
  ('register_domain', 'domains', 'buy a domain name', 'financial', 81),
  ('change_dns', 'domains', 'point a name somewhere else', 'reversible', 82),
  ('accept_payment', 'commerce', 'take money from a customer', 'financial', 90),
  ('create_subscription', 'commerce', 'start charging somebody on a schedule', 'financial', 91),
  ('change_subscription', 'commerce', 'change what somebody is charged', 'financial', 92),
  ('refund', 'commerce', 'give money back', 'financial', 93),
  ('set_price', 'commerce', 'change what a thing costs', 'financial', 94),
  ('meter_usage', 'commerce', 'count what a customer used, for billing', 'observe', 95),
  ('send_email', 'communication', 'send an email to a person', 'public', 100),
  ('send_notification', 'communication', 'send the owner a notice', 'observe', 101),
  ('post_to_channel', 'communication', 'post into a chat channel', 'public', 102),
  ('call_webhook', 'communication', 'tell another system something happened', 'public', 103),
  ('publish_page', 'distribution', 'put a page where the public can find it', 'public', 110),
  ('list_on_marketplace', 'distribution', 'list a product where a marketplace sells it', 'public', 111),
  ('submit_to_store', 'distribution', 'submit an app or extension to a store', 'public', 112),
  ('run_paid_experiment', 'distribution', 'spend a bounded amount on attention and watch what happens', 'financial', 113),
  ('reach_out', 'distribution', 'contact somebody who has not asked to be contacted', 'public', 114),
  ('run_landing_test', 'experimentation', 'show an offer and count who wants it', 'public', 120),
  ('run_ab_test', 'experimentation', 'show two versions and compare', 'reversible', 121),
  ('watch_source', 'monitoring', 'watch a page, feed or metric and notice when it changes', 'observe', 130),
  ('alert_on_change', 'monitoring', 'tell someone when a watched thing changes', 'public', 131),
  ('answer_support', 'customer_operations', 'reply to a customer who wrote in', 'public', 140),
  ('read_support_queue', 'customer_operations', 'read what customers are writing in about', 'observe', 141),
  ('onboard_customer', 'customer_operations', 'walk a new customer through the first use', 'public', 142),
  ('buy_service', 'procurement', 'pay for a service or a tool', 'financial', 150),
  ('license_data', 'procurement', 'agree terms to use somebody''s data or code', 'legal', 151),
  ('sign_contract', 'procurement', 'commit to terms with a supplier, partner or customer', 'legal', 152),
  ('acquire_asset', 'procurement', 'buy an existing digital asset', 'legal', 153),
  ('sell_asset', 'procurement', 'sell one of the portfolio''s assets', 'destructive', 154),
  ('watch_terms', 'legal_sensing', 'watch a provider''s or platform''s terms for change', 'observe', 160),
  ('watch_regulation', 'legal_sensing', 'watch for rule changes that reach a business', 'observe', 161),
  ('screen_trademark', 'legal_sensing', 'check whether a name is already someone''s mark', 'observe', 162),
  ('map_legal_surface', 'legal_sensing', 'name the kinds of liability a thing creates', 'observe', 163),
  ('brief_specialist', 'human_expertise', 'prepare a question, the evidence and the exact uncertainty for a qualified person', 'prepare', 170),
  ('commission_specialist', 'human_expertise', 'engage a lawyer, accountant, tester or other specialist', 'financial', 171),
  ('accept_specialist_answer', 'human_expertise', 'record what a qualified person found, with their name on it', 'observe', 172);

CREATE TRIGGER capabilities_constitutional_insert BEFORE INSERT ON capabilities
BEGIN SELECT RAISE(ABORT,'capability:constitutional'); END;
CREATE TRIGGER capabilities_constitutional_update BEFORE UPDATE ON capabilities
BEGIN SELECT RAISE(ABORT,'capability:constitutional'); END;
CREATE TRIGGER capabilities_constitutional_delete BEFORE DELETE ON capabilities
BEGIN SELECT RAISE(ABORT,'capability:constitutional'); END;

-- WHO CAN ACTUALLY SUPPLY IT, and how far that has been proven.
CREATE TABLE capability_providers (
  id             TEXT PRIMARY KEY,
  capability_key TEXT NOT NULL REFERENCES capabilities(capability_key),
  -- The implementation: a named service, a browser, a workspace, a person.
  provider       TEXT NOT NULL,
  how            TEXT NOT NULL CHECK (how IN ('api','browser','shell','workspace','human','internal')),
  -- The name at the outbound door, when this goes through it. NULL means it
  -- never reaches the world on its own (a read, a draft, a workspace step).
  tool           TEXT,
  cost_note      TEXT NOT NULL,
  maturity       TEXT NOT NULL CHECK (maturity IN
                   ('declared','available','controlled_proven','reality_proven',
                    'reliable','degraded','unavailable')),
  maturity_since TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sort_order     INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX idx_capability_provider_one ON capability_providers(capability_key, provider);
CREATE UNIQUE INDEX idx_capability_provider_tool ON capability_providers(tool) WHERE tool IS NOT NULL;

CREATE TRIGGER capability_provider_guard
BEFORE INSERT ON capability_providers
BEGIN
  SELECT RAISE(ABORT,'capability_provider:incomplete')
    WHERE trim(NEW.provider) = '' OR trim(NEW.cost_note) = '';
  -- NOTHING ARRIVES PROVEN. Proof is earned by a witnessed change, below.
  SELECT RAISE(ABORT,'capability_provider:cannot_arrive_proven')
    WHERE NEW.maturity IN ('controlled_proven','reality_proven','reliable');
END;

-- MATURITY IS EARNED AND WITNESSED, and the record of how is append-only.
CREATE TABLE capability_maturity_changes (
  id            TEXT PRIMARY KEY,
  provider_id   TEXT NOT NULL REFERENCES capability_providers(id),
  from_maturity TEXT NOT NULL,
  to_maturity   TEXT NOT NULL,
  -- What proved it, in words a person could check.
  evidence      TEXT NOT NULL,
  -- Which world the evidence came from.
  evidence_mode TEXT NOT NULL CHECK (evidence_mode IN ('real','sandbox','reference')),
  witnessed_by  TEXT NOT NULL,
  changed_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER capability_maturity_change_guard
BEFORE INSERT ON capability_maturity_changes
BEGIN
  SELECT RAISE(ABORT,'capability_maturity:incomplete')
    WHERE trim(NEW.evidence) = '' OR trim(NEW.witnessed_by) = '';
  SELECT RAISE(ABORT,'capability_maturity:no_change')
    WHERE NEW.from_maturity = NEW.to_maturity;
  -- REALITY-PROVEN TAKES REALITY. A rehearsal can prove the machinery works;
  -- it cannot prove the world answered. And RELIABLE is a claim about a
  -- history, which only reality has.
  SELECT RAISE(ABORT,'capability_maturity:reality_proven_needs_real_evidence')
    WHERE NEW.to_maturity IN ('reality_proven','reliable') AND NEW.evidence_mode <> 'real';
  -- The change has to be from where the provider actually is.
  SELECT RAISE(ABORT,'capability_maturity:stale_from')
    WHERE NOT EXISTS (SELECT 1 FROM capability_providers
                       WHERE id = NEW.provider_id AND maturity = NEW.from_maturity);
END;

CREATE TRIGGER capability_maturity_change_applies
AFTER INSERT ON capability_maturity_changes
BEGIN
  UPDATE capability_providers SET maturity = NEW.to_maturity, maturity_since = NEW.changed_at
   WHERE id = NEW.provider_id;
END;

CREATE TRIGGER capability_maturity_change_immutable
BEFORE UPDATE ON capability_maturity_changes
BEGIN SELECT RAISE(ABORT,'capability_maturity:immutable'); END;

-- THE ONLY WAY MATURITY MOVES IS THROUGH A WITNESSED CHANGE. A direct update
-- of the column is refused unless it is the change trigger applying one - and
-- the same for the date it changed, because a guard on the value is worth
-- nothing while its timestamp can be forged with a plain UPDATE.
CREATE TRIGGER capability_provider_maturity_is_witnessed
BEFORE UPDATE OF maturity, maturity_since ON capability_providers
BEGIN
  SELECT RAISE(ABORT,'capability_provider:maturity_must_be_witnessed')
    WHERE NOT EXISTS (
      SELECT 1 FROM capability_maturity_changes c
       WHERE c.provider_id = OLD.id AND c.to_maturity = NEW.maturity
         AND c.changed_at = NEW.maturity_since
         AND c.changed_at >= datetime('now', '-5 seconds'));
END;

-- WHAT A PIECE OF WORK NEEDS, so "I know what should happen" can become "here
-- is what it would take". Attached to the thing that needs it - a candidate, a
-- responsibility, a proposed act, an experiment - and answered from the
-- providers: met, missing, acquirable, or the owner's.
CREATE TABLE capability_needs (
  id             TEXT PRIMARY KEY,
  founder_id     TEXT NOT NULL REFERENCES founders(id),
  subject_kind   TEXT NOT NULL CHECK (subject_kind IN
                   ('opportunity','responsibility','proposed_act','experiment','company')),
  subject_id     TEXT NOT NULL,
  capability_key TEXT NOT NULL REFERENCES capabilities(capability_key),
  why            TEXT NOT NULL,
  noted_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  met_at         TEXT
);

CREATE UNIQUE INDEX idx_capability_need_one
  ON capability_needs(subject_kind, subject_id, capability_key);

CREATE TRIGGER capability_need_guard
BEFORE INSERT ON capability_needs
BEGIN
  SELECT RAISE(ABORT,'capability_need:incomplete')
    WHERE trim(NEW.subject_id) = '' OR trim(NEW.why) = '';
  SELECT RAISE(ABORT,'capability_need:cannot_arrive_met') WHERE NEW.met_at IS NOT NULL;
END;

CREATE INDEX idx_capability_needs_open ON capability_needs(founder_id) WHERE met_at IS NULL;

-- THE TOOLS AT THE DOOR TODAY, bound to the concepts they implement, at the
-- maturity they have honestly reached: available, because they exist and
-- have been exercised in tests, and not one rung more. What each has done in
-- the world is for the witnessed record to say.
INSERT INTO capability_providers (id, capability_key, provider, how, tool, cost_note, maturity, sort_order) VALUES
  ('cp_send_email_resend', 'send_email', 'resend', 'api', 'send_email', 'fractions of a cent per message', 'available', 1),
  ('cp_notify_push', 'send_notification', 'push', 'internal', 'send_push', 'nothing', 'available', 1),
  ('cp_notify_account', 'send_notification', 'account_notice', 'internal', 'send_account_notice', 'nothing', 'available', 2),
  ('cp_webhook', 'call_webhook', 'http', 'api', 'post_webhook', 'nothing', 'available', 1),
  ('cp_open_pr_github', 'open_pull_request', 'github', 'api', 'github_create_pr', 'nothing', 'available', 1),
  ('cp_comment_github', 'post_to_channel', 'github', 'api', 'github_post_comment', 'nothing', 'available', 1),
  ('cp_change_sub_stripe', 'change_subscription', 'stripe', 'api', 'stripe_update_subscription', 'provider fees on what is charged', 'available', 1),
  ('cp_refund_stripe', 'refund', 'stripe', 'api', 'stripe_create_refund', 'the refund itself', 'available', 1),
  ('cp_mcp', 'act_in_a_browser', 'mcp', 'api', 'mcp_tool', 'depends on the server', 'declared', 1),
  ('cp_read_repo_github', 'read_repository', 'github', 'api', NULL, 'nothing', 'available', 1),
  ('cp_run_tests_ci', 'run_tests', 'github_actions', 'workspace', NULL, 'minutes of runner time', 'available', 1),
  ('cp_visual_playwright', 'test_visually', 'playwright', 'browser', NULL, 'nothing', 'available', 1),
  ('cp_render_playwright', 'render_screen', 'playwright', 'browser', NULL, 'nothing', 'available', 1),
  ('cp_browse_playwright', 'browse_as_a_person', 'playwright', 'browser', NULL, 'nothing', 'declared', 1),
  ('cp_deploy_fly', 'deploy_production', 'fly', 'api', NULL, 'the machine it runs on', 'available', 1),
  ('cp_run_service_fly', 'run_service', 'fly', 'api', NULL, 'a few dollars a month per small machine', 'available', 1),
  ('cp_workspace_fly_sprite', 'create_workspace', 'fly_sprites', 'workspace', NULL, 'per second of compute, sleeps when idle', 'declared', 1),
  ('cp_workspace_fly_machine', 'create_workspace', 'fly_machines', 'workspace', NULL, 'per second of compute', 'declared', 2),
  ('cp_map_legal_internal', 'map_legal_surface', 'foundry', 'internal', NULL, 'nothing', 'available', 1),
  ('cp_brief_specialist_internal', 'brief_specialist', 'foundry', 'internal', NULL, 'nothing', 'available', 1),
  ('cp_specialist_human', 'commission_specialist', 'human_specialist', 'human', NULL, 'their fee, agreed first', 'declared', 1),
  ('cp_accept_specialist', 'accept_specialist_answer', 'foundry', 'internal', NULL, 'nothing', 'available', 1),
  ('cp_research_reference', 'read_public_web', 'reference_world', 'internal', NULL, 'nothing', 'available', 9);
