-- WHAT WAS READ ABOUT THE COMPUTERS, AND WHERE.
--
-- The provider must earn the role. These are findings with sources attached
-- rather than a decision, because "Sprites are the answer" is a claim and "the
-- exec endpoint is a POST to api.sprites.dev/v1/sprites/{name}/exec" is
-- something somebody can go and check — including later, when it has changed.
--
-- Read on 2026-09-05 from Fly's own published pages. Nothing here was recalled;
-- the standing instruction about this provider was "do not guess", and a model
-- remembering a product's contract is exactly the guess it warns against.
--
-- THE HONEST GAP IS RECORDED TOO. Neither page addresses how a credential is
-- kept out of the sandbox. That is the property this institution cares about
-- most, and its absence from the vendor's own description is a finding rather
-- than an omission to be filled in with an assumption. The workshop contract
-- already answers it independently — `run` takes a capability grant, never a
-- credential — so the substrate is not being asked to solve it.

INSERT INTO substrate_evaluations (id, substrate, property, finding, source) VALUES
  ('fly_sprites:lifecycle', 'fly_sprites', 'lifecycle',
   'REST API at api.sprites.dev: POST /v1/sprites creates one, '
   || 'POST /v1/sprites/{name}/exec?cmd=... runs a command, bearer token auth',
   'https://fly.io/run-agent-code/ (read 2026-09-05)'),
  ('fly_sprites:persistence', 'fly_sprites', 'persistence',
   'filesystem is durable between runs — a cloned repository is still cloned '
   || 'and installed dependencies are still installed on return',
   'https://fly.io/run-agent-code/ (read 2026-09-05)'),
  ('fly_sprites:checkpoint', 'fly_sprites', 'checkpoint and restore',
   'whole-filesystem checkpoint and restore, described for exactly this use: '
   || 'checkpoint, let it try something risky, restore if it breaks',
   'https://fly.io/run-agent-code/ (read 2026-09-05)'),
  ('fly_sprites:network', 'fly_sprites', 'network policy',
   'domain allowlist enforced at packet level rather than at name lookup, and '
   || 'code running inside can read the policy it is under but never change it',
   'https://fly.io/run-agent-code/ (read 2026-09-05)'),
  ('fly_sprites:idle', 'fly_sprites', 'idle cost',
   'sleeps when the agent stops working: freezes, then suspends. No published '
   || 'rate was found on the pages read, so the cost model is not yet known',
   'https://fly.io/run-agent-code/ (read 2026-09-05)'),
  ('fly_sprites:isolation', 'fly_sprites', 'isolation',
   'microVM with its own kernel, dedicated CPU and memory, its own network '
   || 'namespace and an ext4 filesystem',
   'https://fly.io/learn/agent-sandbox/ (read 2026-09-05)'),
  ('fly_sprites:credentials', 'fly_sprites', 'credential isolation',
   'NOT ADDRESSED by the pages read. The property this institution cares about '
   || 'most, absent from the vendor description — recorded as a gap rather than '
   || 'assumed. The workshop contract answers it independently: run takes a '
   || 'capability grant, never a credential',
   'absence noted 2026-09-05'),
  ('fly_sprites:adapter', 'fly_sprites', 'can run a step',
   'no — there is no adapter in this repository at all; substrate() resolves '
   || 'reference_world, local_process and fly_machines only',
   'src/services/workshop/index.ts'),
  ('fly_machines:adapter', 'fly_machines', 'can run a step',
   'no — create, checkpoint, restore and destroy are implemented and run() '
   || 'throws by design, because the exec semantics were never settled',
   'src/services/workshop/fly-machines.ts'),
  ('local_process:adapter', 'local_process', 'can run a step',
   'yes, and it may no longer produce a real change to software: it is '
   || 'same_host, which is the machine the institution itself runs on',
   'src/services/workshop/local-process.ts'),
  ('reference_world:adapter', 'reference_world', 'can run a step',
   'no — it remembers files and executes nothing, which is what it is for',
   'src/services/workshop/reference.ts');
