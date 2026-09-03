-- =============================================================================
-- THE WORKSHOP IS A PROVIDER, AND THE CHAIN FOUND OUT BY BREAKING
--
-- Joining the chain end to end - missing capability, acquisition, approval,
-- provider available, no authority implied, least-privilege provisioning, real
-- work, verified result - failed at the provisioning step, because
-- `write_code_in_branch` had no provider at all. The fabric had been seeded
-- from the tools that existed at the outbound door, and writing code in a
-- branch does not go through a door: it happens in a workshop, and no workshop
-- existed when the registry was written.
--
-- So the local-process workshop is registered for exactly what it demonstrably
-- does and nothing adjacent. It writes files, it runs allow-listed programs, it
-- transforms data with them, and it gathers files into a set. It is NOT
-- registered for rendering screens or visual testing - Playwright is a real
-- capability with its own provider already, and claiming this substrate
-- supplies it because a browser happens to be installed nearby would be exactly
-- the guess this institution refuses.
--
-- AVAILABLE, WHICH IS ALL IT IS. Wired and exercised in tests; not proven in a
-- rehearsal, not proven in the world. Those are witnessed changes with a name
-- on them, and they have not happened yet.
-- =============================================================================

INSERT INTO capability_providers
  (id, capability_key, provider, how, tool, cost_note, maturity, sort_order) VALUES
  ('cp_write_code_workshop', 'write_code_in_branch', 'local_process', 'workspace', NULL,
   'a fraction of a cent per step, on a machine we already run', 'available', 1),
  ('cp_run_shell_workshop', 'run_shell', 'local_process', 'workspace', NULL,
   'a fraction of a cent per step, on a machine we already run', 'available', 1),
  ('cp_transform_data_workshop', 'transform_data', 'local_process', 'workspace', NULL,
   'a fraction of a cent per step, on a machine we already run', 'available', 1),
  ('cp_build_dataset_workshop', 'build_dataset', 'local_process', 'workspace', NULL,
   'a fraction of a cent per step, on a machine we already run', 'available', 1),
  ('cp_run_tests_workshop', 'run_tests', 'local_process', 'workspace', NULL,
   'a fraction of a cent per step, on a machine we already run', 'available', 2);
