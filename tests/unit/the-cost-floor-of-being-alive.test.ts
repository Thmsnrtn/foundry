import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getProcessRole, schedulerEnabledForRole } from '../../src/lib/process-role.js';

// =============================================================================
// THE COST FLOOR OF BEING ALIVE.
//
// `fly.private.toml` is the smallest configuration that keeps the institution
// alive rather than merely reachable. Three of its values are load-bearing, and
// each fails silently rather than loudly if it changes:
//
//   PROCESS_ROLE   — 'web' runs no scheduler. Foundry would serve pages and
//                    observe nothing, forever, with a green health check.
//   database path  — off the volume, institutional memory is destroyed with
//                    the machine, which is the ephemeral-container problem
//                    moved to Fly rather than solved.
//   auto_stop      — a suspended machine runs no cron. Self-observation is on
//                    `20 */6 * * *`; a stopped machine simply never reaches it.
//
// None of the three produces an error. All three produce an institution that
// looks deployed and remembers or notices nothing, which is the exact failure
// this whole deployment exists to end.
// =============================================================================

const toml = () => readFileSync(resolve(import.meta.dirname, '../../fly.private.toml'), 'utf8');
const value = (key: string): string =>
  (new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\n#]+)"?`, 'm').exec(toml())?.[1] ?? '').trim();

describe('the private deployment keeps the institution alive', () => {
  it('runs a process role that actually schedules', () => {
    const role = value('PROCESS_ROLE');
    expect(role, 'PROCESS_ROLE is unset in the private config').not.toBe('');
    // Asked of the real function, not of a string: if the role vocabulary ever
    // changes, this fails instead of asserting yesterday's spelling.
    expect(schedulerEnabledForRole(getProcessRole({ PROCESS_ROLE: role })),
      `PROCESS_ROLE=${role} runs no scheduler — Foundry would observe nothing`).toBe(true);
  });

  it('keeps the database on the volume, not in the image', () => {
    const db = value('TURSO_DATABASE_URL');
    const dest = value('destination');
    expect(dest, 'no volume is mounted — a file database dies with the machine').not.toBe('');
    expect(db.startsWith(`file:${dest}`),
      `${db} is not on the mounted volume ${dest}; institutional memory would not survive`).toBe(true);
  });

  it('never suspends the machine that carries the schedule', () => {
    expect(value('auto_stop_machines'),
      'a suspended machine runs no cron, so self-observation would never fire').toBe('false');
    expect(Number(value('min_machines_running')),
      'zero machines is zero institution').toBeGreaterThanOrEqual(1);
  });

  it('stays smaller than the commercial shape it is not', () => {
    // The point of a separate file: one owner is not a request pool. If this
    // ever needs two machines, it has stopped being the private deployment.
    expect(Number(value('min_machines_running'))).toBeLessThanOrEqual(1);
  });
});
