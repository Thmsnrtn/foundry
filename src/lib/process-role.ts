// =============================================================================
// FOUNDRY — Process role (Phase 3.1)
// The 73 in-process cron jobs shared one machine with the HTTP server. With Fly
// process groups we run two roles from the same image:
//   - 'web'    : serves public HTTP, does NOT run the scheduler
//   - 'worker' : runs the scheduler, no public traffic (still serves /internal
//                health so Fly can check it)
//   - 'all'    : both (default — single-machine dev and backward compatibility)
// The DB-backed job locks (services/job-lock.ts) already make it safe if more
// than one process ever runs the scheduler.
// =============================================================================

export type ProcessRole = 'web' | 'worker' | 'all';

export function getProcessRole(env: NodeJS.ProcessEnv = process.env): ProcessRole {
  const raw = (env.PROCESS_ROLE ?? 'all').toLowerCase();
  if (raw === 'web' || raw === 'worker' || raw === 'all') return raw;
  return 'all';
}

/** The scheduler runs on the worker and on an all-in-one process, never on web. */
export function schedulerEnabledForRole(role: ProcessRole): boolean {
  return role === 'worker' || role === 'all';
}
