// =============================================================================
// FOUNDRY — IS THIS DEPLOYMENT RUNNING, AND HOW WOULD ANYBODY KNOW
//
// THE GAP THIS CLOSES. A scheduler that has stopped entirely produces no errors
// at all: every page is calm, every number is yesterday's, and nothing anywhere
// says the institution went quiet. Silence and health are indistinguishable
// from outside, and that is the failure an absent owner actually meets.
//
// THIS IS ABOUT THE DEPLOYMENT, NOT ABOUT A COMPANY, and the distinction is
// load-bearing. It was first written in `services/institution` as a reading
// about "Foundry the company" — resolving which product row is Foundry so the
// estate reading could treat that one differently. `recursive-institution`
// refused it, and was right to: the institutional kernel must not be ABLE to
// ask whether it is operating Foundry, because a kernel that can ask will
// eventually answer by shortening a ladder or widening a grant. Foundry stays
// an ordinary company with nothing connected to it, which is an ordinary true
// finding about an ordinary company, and the owner can fix it or accept it.
//
// What is NOT a company question is whether the machine is running. No product
// id appears below and none is resolved: these five readings would say exactly
// the same thing on a deployment with no companies in it at all.
//
// DETERMINISTIC AND INTERNAL. No provider, no credential, no network, no model,
// no new external commitment, nothing for the owner to authorise. Five readings
// over rows this deployment already keeps, each of which can say STALE or
// CANNOT TELL rather than inventing a green light:
//
//   the database          does it answer, and how much has it grown
//   the routines          did the scheduled work run, and how recently
//   the copies            how far back they reach, and when the last one landed
//   the thinking          what was spent, and whether the meter is moving
//   the blocked work      anything the institution tried and could not finish
//
// WHAT THIS DELIBERATELY IS NOT. It is not a status page, a score, an uptime
// percentage or a dashboard of green ticks. Monitoring theatre is what you
// build when you want the feeling of observability; the test of this file is
// whether it can say "I cannot tell", and every reading here can.
// =============================================================================

import { query } from '../../db/client.js';

/** What a single internal signal can say. Three states, never two. */
export type SignalState =
  /** Read, and within the freshness this signal is supposed to hold to. */
  | 'current'
  /** Read, and older than it should be. Not the same as broken. */
  | 'stale'
  /** The reading itself failed, or there is nothing to read it from. */
  | 'cannot_tell';

export interface SelfSignal {
  key: 'database' | 'routines' | 'copies' | 'thinking' | 'blocked';
  /** What this signal is about, in one phrase. */
  about: string;
  state: SignalState;
  /** The reading, in a sentence somebody can check. */
  says: string;
  /** How old the freshest evidence is, in hours, where that is meaningful. */
  ageHours: number | null;
}

export interface SelfObservation {
  signals: SelfSignal[];
  /** True when every signal is current. Not a score — the conjunction. */
  allCurrent: boolean;
  /** One sentence for the estate reading. */
  sentence: string;
}

const hoursSince = (at: string | null | undefined): number | null => {
  if (at == null) return null;
  const t = Date.parse(String(at).includes('T') ? String(at) : `${String(at).replace(' ', 'T')}Z`);
  return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / 3_600_000);
};

/**
 * THE FIVE READINGS.
 *
 * `now` is injected so a test can ask what this would have said yesterday.
 * Each reading is wrapped: a signal that throws reports CANNOT TELL, because an
 * observability layer that takes the institution down with it when it breaks is
 * worse than none.
 */
export async function observeSelf(now: Date = new Date()): Promise<SelfObservation> {
  const signals: SelfSignal[] = [];

  // 1. THE DATABASE. The whole institution is one file; the question is
  // whether it answers and how big it has become.
  try {
    const row = (await query(
      'SELECT COUNT(*) AS n FROM sqlite_master WHERE type = ?', ['table']))
      .rows[0] as Record<string, unknown>;
    const tables = Number(row.n);
    signals.push({
      key: 'database', about: 'the one file everything lives in',
      state: tables > 0 ? 'current' : 'cannot_tell',
      says: tables > 0
        ? `answers, and holds ${String(tables)} tables`
        : 'answered, but reported no tables at all, which cannot be right',
      ageHours: 0,
    });
  } catch {
    signals.push({
      key: 'database', about: 'the one file everything lives in',
      state: 'cannot_tell', says: 'the database did not answer', ageHours: null,
    });
  }

  // 2. THE ROUTINES. Not "are any failing" — the estate health reading already
  // answers that. This asks whether the scheduler is RUNNING AT ALL, which is
  // the failure that produces a perfectly calm screen.
  try {
    const row = (await query(
      'SELECT MAX(last_success_at) AS at, COUNT(*) AS n FROM job_health'))
      .rows[0] as Record<string, unknown>;
    const age = hoursSince(row.at as string | null);
    signals.push({
      key: 'routines', about: 'whether the scheduled work is running',
      state: age === null ? 'cannot_tell' : age <= 6 ? 'current' : 'stale',
      says: age === null
        ? 'no routine has ever recorded a success, so I cannot tell whether any of them run'
        : `${String(Number(row.n))} routines are known, and the most recent success was `
          + `${String(age)} ${age === 1 ? 'hour' : 'hours'} ago`,
      ageHours: age,
    });
  } catch {
    signals.push({
      key: 'routines', about: 'whether the scheduled work is running',
      state: 'cannot_tell', says: 'the routine record did not answer', ageHours: null,
    });
  }

  // 3. THE COPIES. Read from the volume, never from the retention constant.
  try {
    const { whatIsKept, howFarBackCopiesReach } = await import('../institution/keeping.js');
    const kept = await whatIsKept();
    const reach = await howFarBackCopiesReach(now);
    const age = kept.length > 0 ? hoursSince(kept[0].at) : null;
    signals.push({
      key: 'copies', about: 'how far back this could be put back',
      state: kept.length === 0 ? 'cannot_tell' : age !== null && age <= 36 ? 'current' : 'stale',
      says: kept.length === 0
        ? 'there is no copy of this institution on the volume'
        : `${String(kept.length)} copies, the newest ${String(age ?? 0)} hours old, reaching back `
          + `${String(reach ?? 0)} days`,
      ageHours: age,
    });
  } catch {
    signals.push({
      key: 'copies', about: 'how far back this could be put back',
      state: 'cannot_tell', says: 'the copies could not be read', ageHours: null,
    });
  }

  // 4. THE THINKING. A meter that has stopped moving is as informative as one
  // that is racing: it means the institution has stopped doing anything.
  try {
    const row = (await query(
      "SELECT MAX(date) AS d, COUNT(*) AS n FROM ai_daily_spend WHERE scope = 'global'"))
      .rows[0] as Record<string, unknown>;
    const last = row.d == null ? null : String(row.d);
    const days = last === null ? null
      : Math.floor((now.getTime() - Date.parse(`${last}T00:00:00Z`)) / 86_400_000);
    signals.push({
      key: 'thinking', about: 'whether the institution is still doing anything',
      state: days === null ? 'cannot_tell' : days <= 2 ? 'current' : 'stale',
      says: days === null
        ? 'nothing has ever been spent thinking, so there is nothing to read'
        : `the meter last moved ${String(days)} ${days === 1 ? 'day' : 'days'} ago, over `
          + `${String(Number(row.n))} recorded days`,
      ageHours: days === null ? null : days * 24,
    });
  } catch {
    signals.push({
      key: 'thinking', about: 'whether the institution is still doing anything',
      state: 'cannot_tell', says: 'the spend record did not answer', ageHours: null,
    });
  }

  // 5. WHAT IS STUCK. Work the institution took on and could not finish is the
  // one signal that is bad news when it is PRESENT rather than when it is old.
  try {
    const row = (await query(
      `SELECT COUNT(*) AS n FROM undertakings WHERE closed_at IS NULL
        AND EXISTS (SELECT 1 FROM undertaking_steps s
                     WHERE s.undertaking_id = undertakings.id AND s.kind = 'needs')`))
      .rows[0] as Record<string, unknown>;
    const stuck = Number(row.n);
    signals.push({
      key: 'blocked', about: 'work I took on and cannot finish',
      state: stuck === 0 ? 'current' : 'stale',
      says: stuck === 0
        ? 'nothing I have taken on is waiting on something I cannot reach'
        : `${String(stuck)} ${stuck === 1 ? 'thing is' : 'things are'} waiting on something I cannot reach`,
      ageHours: 0,
    });
  } catch {
    signals.push({
      key: 'blocked', about: 'work I took on and cannot finish',
      state: 'cannot_tell', says: 'the record of what I am carrying did not answer', ageHours: null,
    });
  }

  const notCurrent = signals.filter((s) => s.state !== 'current');
  return {
    signals,
    allCurrent: notCurrent.length === 0,
    sentence: notCurrent.length === 0
      ? 'I can see myself: the database answers, the routines are running, the copies are '
        + 'current, the meter is moving and nothing I took on is stuck.'
      : `I can see myself, and ${notCurrent.length === 1 ? 'one reading is' : `${String(notCurrent.length)} readings are`} `
        + `not what ${notCurrent.length === 1 ? 'it' : 'they'} should be: `
        + `${notCurrent.map((s) => `${s.about} — ${s.says}`).join('; ')}.`,
  };
}
