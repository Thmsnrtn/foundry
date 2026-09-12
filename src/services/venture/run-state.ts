// =============================================================================
// FOUNDRY — what a pass actually achieved
//
// "It ran without throwing" and "it did what it was for" are different claims,
// and for several hours this institution reported the first as the second while
// an owner-authorised experiment sat unable to place its offer.
//
// So a pass now states what it achieved, in terms of the authorised act rather
// than the absence of an exception. The distinction that matters most is
// BLOCKED: an act the owner authorised, which cannot proceed because something
// the institution depends on is unavailable. That is not idling and it is not
// success. It is stopped, and somebody is owed a sentence about it.
// =============================================================================

import { query } from '../../db/client.js';

export type RunState = 'success' | 'noop_expected' | 'partial' | 'degraded' | 'blocked' | 'failed';

export interface RunReading {
  state: RunState;
  /** What was being attempted, in the owner's words. */
  attempting: string;
  /** Why it did not happen. Required for anything but a clean state. */
  because?: string | null;
  /** The dependency that is down, if one is. */
  dependency?: string | null;
  /** What the owner must do. Null means nothing — which is the usual answer. */
  ownerAction?: string | null;
  progressed: boolean;
}

/**
 * DECIDE THE STATE FROM WHAT HAPPENED, not from what was caught.
 *
 * `authorised` is the question that separates a quiet pass from a stopped one.
 * An experiment nobody approved doing nothing is `noop_expected` and correct.
 * An experiment the owner approved doing nothing, because a dependency refused,
 * is `blocked` — and the same facts read as success until this existed.
 */
export function readRun(input: {
  authorised: boolean;
  intended: number;
  achieved: number;
  exceptions: string[];
  attempting: string;
}): RunReading {
  const { authorised, intended, achieved, exceptions, attempting } = input;
  const blocking = exceptions.find((e) => /not placed|not published|no asset|paused|unavailable|no trusted policy/i.test(e));

  if (!authorised) {
    return { state: 'noop_expected', attempting, progressed: false,
      because: exceptions.length ? exceptions.join('; ') : null };
  }
  // AUTHORISED AND NOTHING MOVED. The case this file was written for.
  if (achieved === 0 && blocking) {
    return {
      state: 'blocked', attempting, progressed: false, because: blocking,
      dependency: dependencyIn(blocking),
      // An internal dependency is the institution's to repair. Telling the
      // owner to act would turn a defect of ours into homework of his.
      ownerAction: null,
    };
  }
  if (achieved === 0 && exceptions.length) {
    return { state: 'failed', attempting, progressed: false, because: exceptions.join('; ') };
  }
  if (achieved === 0 && intended > 0) {
    return { state: 'blocked', attempting, progressed: false,
      because: 'there was work to do and none of it happened, and nothing said why',
      ownerAction: null };
  }
  if (achieved === 0) return { state: 'noop_expected', attempting, progressed: false };
  if (achieved < intended) {
    return { state: 'partial', attempting, progressed: true,
      because: exceptions.length ? exceptions.join('; ') : `${achieved} of ${intended} went through` };
  }
  if (exceptions.length) {
    return { state: 'degraded', attempting, progressed: true, because: exceptions.join('; ') };
  }
  return { state: 'success', attempting, progressed: true };
}

function dependencyIn(because: string): string | null {
  if (/no trusted policy|stripe|payment link/i.test(because)) return 'the payment provider, through its governed door';
  if (/not published|page/i.test(because)) return 'the public site';
  if (/no asset/i.test(because)) return "the experiment's own asset";
  if (/paused/i.test(because)) return 'the owner\'s pause on new economic activity';
  return null;
}

/** Write the live reading. One row per experiment: this is a state, not a log. */
export async function recordRun(experimentId: string, founderId: string, r: RunReading): Promise<void> {
  await query(
    `INSERT INTO experiment_run_state
       (experiment_id, founder_id, state, attempting, because, dependency, owner_action, progressed, checked_at)
     VALUES (?,?,?,?,?,?,?,?, datetime('now'))
     ON CONFLICT(experiment_id) DO UPDATE SET
       state = excluded.state, attempting = excluded.attempting, because = excluded.because,
       dependency = excluded.dependency, owner_action = excluded.owner_action,
       progressed = excluded.progressed, checked_at = excluded.checked_at`,
    [experimentId, founderId, r.state, r.attempting, r.because ?? null,
      r.dependency ?? null, r.ownerAction ?? null, r.progressed ? 1 : 0]);
}

export interface RunStateRow extends RunReading { experimentId: string; checkedAt: string }

/** What the owner's page reads. */
export async function runStateOf(experimentId: string): Promise<RunStateRow | null> {
  const r = (await query(
    `SELECT experiment_id, state, attempting, because, dependency, owner_action, progressed, checked_at
       FROM experiment_run_state WHERE experiment_id = ?`, [experimentId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    experimentId: String(r.experiment_id), state: String(r.state) as RunState,
    attempting: String(r.attempting), because: r.because == null ? null : String(r.because),
    dependency: r.dependency == null ? null : String(r.dependency),
    ownerAction: r.owner_action == null ? null : String(r.owner_action),
    progressed: Number(r.progressed) === 1, checkedAt: String(r.checked_at),
  };
}

/** Everything the institution is currently stopped on. */
export async function whatIsBlocked(founderId: string): Promise<RunStateRow[]> {
  return ((await query(
    `SELECT experiment_id, state, attempting, because, dependency, owner_action, progressed, checked_at
       FROM experiment_run_state WHERE founder_id = ? AND state IN ('blocked','failed')
      ORDER BY checked_at DESC`, [founderId])).rows as unknown as Array<Record<string, unknown>>)
    .map((r) => ({
      experimentId: String(r.experiment_id), state: String(r.state) as RunState,
      attempting: String(r.attempting), because: r.because == null ? null : String(r.because),
      dependency: r.dependency == null ? null : String(r.dependency),
      ownerAction: r.owner_action == null ? null : String(r.owner_action),
      progressed: Number(r.progressed) === 1, checkedAt: String(r.checked_at),
    }));
}
