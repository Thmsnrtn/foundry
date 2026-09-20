// =============================================================================
// FOUNDRY — the estate's health, as state rather than as a paragraph.
//
// "Part of me has stopped running" is a sentence. What the owner needs is a
// state he can read in a second and rows he can check: what failed, whether
// anything of his is affected, whether money is at risk, whether he is needed,
// and what the institution is doing about it. Every row here is read from a
// record the institution already keeps — loop health, run state, the
// Workshop's own checks — and none of it is invented to look reassuring.
//
// NOTHING WRONG IS A STATE TOO. Quiet is the success condition, and it is
// rendered from the same reader as trouble so that "healthy" is a finding and
// not a default.
// =============================================================================

import { query } from '../../db/client.js';
import { getFailingInstitutionLoops } from '../institution/loop-health.js';
import { whatIsBlocked } from '../venture/run-state.js';

export type EstateState = 'ok' | 'degraded' | 'blocked';

export interface EstateHealth {
  state: EstateState;
  /** One or two words for the tile. */
  word: string;
  /** What has actually failed, named. Empty when nothing has. */
  failed: string[];
  /** Whether the institution is recovering on its own or is stuck. */
  recovering: 'automatically' | 'stuck' | 'nothing to recover';
  dataLoss: 'none';
  /** Whether anybody outside is affected, as far as the records say. */
  customerEffect: string;
  /** Money that could be at risk, as far as the records say. */
  moneyAtRisk: string;
  /** What only the owner can do, or null. */
  ownerAction: string | null;
  lastHealthy: string | null;
  /** When the hand next passes, from its schedule and its last success. */
  nextPass: string | null;
}

/** The hand runs at twenty past every hour; the next pass is the next :20. */
export function nextPassAfter(now: Date): string {
  const next = new Date(now);
  next.setUTCSeconds(0, 0);
  if (next.getUTCMinutes() >= 20) next.setUTCHours(next.getUTCHours() + 1);
  next.setUTCMinutes(20);
  return next.toISOString();
}

export async function healthOf(founderId: string, now: Date = new Date()): Promise<EstateHealth> {
  const loops = await getFailingInstitutionLoops(now);
  const blocked = await whatIsBlocked(founderId);
  const workshop = (await query(
    'SELECT health_json, health_at FROM public_workshop WHERE founder_id = ?', [founderId]))
    .rows[0] as Record<string, unknown> | undefined;
  const wh = workshop?.health_json == null ? null
    : JSON.parse(String(workshop.health_json)) as Record<string, { status: string; detail: string }>;
  const workshopNeeds = Object.entries(wh ?? {})
    .filter(([, v]) => v?.status === 'needs_attention')
    .map(([k, v]) => `${k === 'replyInbox' ? 'the reply inbox' : k === 'site' ? 'the public site' : k === 'sending' ? 'email sending' : k}: ${v.detail}`);

  const failed = [
    ...blocked.map((b) => `${b.attempting} — ${b.because ?? 'blocked'}`),
    ...loops.map((l) => l.stoppedRunning ? `${l.label} has not run for longer than it should` : `${l.label} failed ${String(l.consecutiveFailures)} times running`),
    ...workshopNeeds,
  ];
  const lastHealthy = loops.map((l) => l.lastSuccessAt).filter((s): s is string => !!s).sort()[0] ?? null;
  const ownerAction = blocked.find((b) => b.ownerAction)?.ownerAction ?? (workshopNeeds.length ? workshopNeeds[0] ?? null : null);

  const state: EstateState = blocked.length ? 'blocked' : (loops.length || workshopNeeds.length) ? 'degraded' : 'ok';
  return {
    state,
    word: state === 'ok' ? 'Healthy'
      : state === 'blocked' ? `${String(blocked.length)} ${blocked.length === 1 ? 'pass' : 'passes'} blocked`
        : `${String(loops.length + workshopNeeds.length)} ${loops.length + workshopNeeds.length === 1 ? 'thing needs' : 'things need'} looking at`,
    failed,
    recovering: state === 'ok' ? 'nothing to recover' : ownerAction ? 'stuck' : 'automatically',
    dataLoss: 'none',
    // THE RECORDS SAY WHO IS AFFECTED, OR THEY DO NOT. A blocked pass on a live
    // test means people outside are waiting on something; a stopped routine
    // affects only what the owner is told.
    customerEffect: blocked.length ? 'a running test is not progressing' : 'none',
    moneyAtRisk: blocked.some((b) => /payment|refund|fulfil/i.test(b.attempting)) ? 'a payment or delivery is waiting' : 'none',
    ownerAction,
    lastHealthy,
    nextPass: nextPassAfter(now),
  };
}

// ─── WHETHER FOUNDRY ITSELF IS OPERATING, IN ONE SENTENCE ────────────────────
//
// "Foundry has nothing connected to it, so silence from it means nothing." That
// was the one open item on the closeout, and it is the owner-protection gap an
// autonomous institution cannot leave open: a page that says "everything I run
// is running" must be able to tell a loop that ran and found nothing worth
// doing from a loop that did not run, and both from a loop that ran and was
// stopped by something outside.
//
// Nothing here is a new record. The scheduler already writes every routine's
// success and failure to `job_health`; the loop list already knows each
// routine's cadence; the rows already say whether a search is open, what has
// been found, what has been designed, and what is running. This reads those,
// in that order, and says the first thing that is true:
//
//   stopped  — an economic routine has failed or has not succeeded within its
//              cadence. Said first, because everything below it is stale.
//   blocked  — the routines ran, and something outside stands in the way: a
//              live test that cannot progress, the Workshop needing attention,
//              or a search with no way of looking.
//   working  — tests are running, or a test is being designed.
//   waiting  — the routines ran and decided, on the rows, that nothing deserves
//              action: no search is open, or nothing found has earned a
//              candidate, or no candidate deserves a test, or a sealed test
//              waits for the charter. This is the quiet state, and it is a
//              finding rather than a default.
//
// WHAT IT CANNOT SEE: a process that is not running at all writes nothing, so
// no sentence this process produces can report its own death. That is what the
// deployment's health endpoint and its checks are for, and the endpoint now
// carries this reading so that a probe from outside sees the same thing.

export type PulseState = 'stopped' | 'blocked' | 'working' | 'waiting';

export interface Pulse {
  state: PulseState;
  /** One word for the pill. */
  word: string;
  /** The sentence, in the owner's language. At most two sentences. */
  sentence: string;
  /** When the economic loop last completed any pass, or null if never. */
  lastPassAt: string | null;
  /** The routine this reading rests on when stopped, else null. */
  stoppedLoop: { jobName: string; label: string; lastSuccessAt: string | null } | null;
}

/** "yesterday", "3 days ago", "2 hours ago" — the owner's sense of time. */
export function since(iso: string | null, now: Date): string {
  if (iso === null) return 'never';
  const at = Date.parse(/[TZ]/.test(iso) ? iso : `${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(at)) return 'at an unknown time';
  const hours = Math.max(0, (now.getTime() - at) / 3_600_000);
  if (hours < 1) return 'within the hour';
  if (hours < 24) return `${String(Math.floor(hours))} hour${Math.floor(hours) === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  return `${String(days)} days ago`;
}

export async function howFoundryIsRunning(founderId: string, now: Date = new Date()): Promise<Pulse> {
  const { ECONOMIC_LOOPS, INSTITUTION_LOOPS } = await import('../institution/loop-health.js');
  const marks = ECONOMIC_LOOPS.map(() => '?').join(',');
  const passes = (await query(
    `SELECT job_name, last_success_at FROM job_health
      WHERE job_name IN (${marks}) AND last_success_at IS NOT NULL`, [...ECONOMIC_LOOPS]))
    .rows as unknown as Array<Record<string, unknown>>;
  const lastPassAt = passes.map((r) => String(r.last_success_at)).sort().at(-1) ?? null;

  // 1. STOPPED. The loop list already knows what "has not run" means for each
  //    routine; only the economic ones are read here.
  const stopped = (await getFailingInstitutionLoops(now))
    .filter((l) => INSTITUTION_LOOPS[l.jobName]?.economic === true)
    // Not running at all outranks failing: a routine that throws is at least
    // being scheduled.
    .sort((a, b) => Number(b.stoppedRunning) - Number(a.stoppedRunning) || b.consecutiveFailures - a.consecutiveFailures);
  if (stopped.length > 0) {
    const l = stopped[0]!;
    const what = l.label.charAt(0).toUpperCase() + l.label.slice(1);
    const how = l.stoppedRunning
      ? 'has not run when it should have'
      : `has failed ${String(l.consecutiveFailures)} time${l.consecutiveFailures === 1 ? '' : 's'} running`;
    return {
      state: 'stopped', word: 'Stopped',
      sentence: `Foundry hasn't completed its scheduled work. ${what} ${how}; its last successful run was ${since(l.lastSuccessAt, now)}.`,
      lastPassAt, stoppedLoop: { jobName: l.jobName, label: l.label, lastSuccessAt: l.lastSuccessAt },
    };
  }

  // A FRESH INSTITUTION HAS NOTHING TO REPORT YET, and says so rather than
  // reading an empty ledger as calm.
  if (lastPassAt === null) {
    return { state: 'waiting', word: 'Not yet', lastPassAt, stoppedLoop: null,
      sentence: 'Foundry has not completed a scheduled pass yet.' };
  }

  // 2. BLOCKED, by something outside. Read from the same records the estate
  //    reads, in the order a person would want to hear them.
  const blocked = await whatIsBlocked(founderId);
  if (blocked.length > 0) {
    const b = blocked[0]!;
    return { state: 'blocked', word: 'Blocked', lastPassAt, stoppedLoop: null,
      sentence: `Foundry is working, but a live test is stuck: ${b.attempting}${b.because ? ` — ${b.because}` : ''}.` };
  }
  const workshop = (await query(
    'SELECT health_json FROM public_workshop WHERE founder_id = ?', [founderId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (workshop?.health_json != null) {
    const wh = JSON.parse(String(workshop.health_json)) as Record<string, { status?: string; detail?: string }>;
    const bad = Object.entries(wh).find(([, v]) => v?.status === 'needs_attention');
    if (bad) {
      const [k, v] = bad;
      const named = k === 'replyInbox' ? 'the reply inbox' : k === 'site' ? 'the public site' : k === 'sending' ? 'email sending' : k;
      return { state: 'blocked', word: 'Blocked', lastPassAt, stoppedLoop: null,
        sentence: `Foundry is working, but the Workshop needs attention: ${named} — ${v.detail ?? 'see the Workshop page'}.` };
    }
  }

  const { currentMandate } = await import('../venture/mandate.js');
  const mandate = await currentMandate(founderId);
  if (mandate !== null && mandate.evidenceMode === 'real') {
    const { waysOfLooking } = await import('../venture/research-sources.js');
    if ((await waysOfLooking(founderId, 'real')).length === 0) {
      return { state: 'blocked', word: 'Blocked', lastPassAt, stoppedLoop: null,
        sentence: 'Foundry is working, but it has nowhere to look: no way of looking is connected, so the search cannot proceed.' };
    }
  }

  // 3. WORKING and 4. WAITING, from the rows the loop itself writes.
  const n = async (sql: string, params: unknown[]): Promise<number> =>
    Number(((await query(sql, params)).rows[0] as Record<string, unknown> | undefined)?.n ?? 0);
  const running = await n(
    `SELECT COUNT(*) AS n FROM venture_experiments
      WHERE founder_id = ? AND evidence_mode = 'real' AND decision = 'approved'
        AND validity = 'valid' AND ran_at IS NULL AND retired_at IS NULL`, [founderId]);
  if (running > 0) {
    return { state: 'working', word: 'Working', lastPassAt, stoppedLoop: null,
      sentence: `Foundry is working. ${String(running)} test${running === 1 ? ' is' : 's are'} running.` };
  }
  const designing = await n(
    `SELECT COUNT(*) AS n FROM venture_experiments e
      WHERE e.founder_id = ? AND e.evidence_mode = 'real' AND e.decision IS NULL AND e.retired_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM probe_designs d WHERE d.experiment_id = e.id)`, [founderId]);
  if (designing > 0) {
    return { state: 'working', word: 'Working', lastPassAt, stoppedLoop: null,
      sentence: `Foundry is working. It is designing ${designing === 1 ? 'a test' : `${String(designing)} tests`}.` };
  }
  const sealed = await n(
    `SELECT COUNT(*) AS n FROM probe_designs d JOIN venture_experiments e ON e.id = d.experiment_id
      WHERE e.founder_id = ? AND e.evidence_mode = 'real' AND e.decision IS NULL AND e.retired_at IS NULL
        AND d.sealed_at IS NOT NULL AND d.recommendation = 'run'`, [founderId]);
  if (sealed > 0) {
    const { liveCharter } = await import('../institution/charter.js');
    const charter = await liveCharter(founderId);
    return { state: 'waiting', word: 'Waiting', lastPassAt, stoppedLoop: null,
      sentence: charter
        ? `Foundry is working. ${sealed === 1 ? 'A test is' : `${String(sealed)} tests are`} sealed and will be let in on the next pass.`
        : `Foundry is working. ${sealed === 1 ? 'A test is' : `${String(sealed)} tests are`} designed and sealed; it waits for the charter.` };
  }
  const candidates = await n(
    `SELECT COUNT(*) AS n FROM venture_opportunities
      WHERE founder_id = ? AND evidence_mode = 'real' AND verdict IS NULL`, [founderId]);
  if (candidates > 0) {
    return { state: 'waiting', word: 'Waiting', lastPassAt, stoppedLoop: null,
      sentence: 'Foundry is working. No opportunity currently deserves a test.' };
  }
  if (mandate !== null) {
    const looked = await n(
      `SELECT COUNT(*) AS n FROM venture_opportunities WHERE mandate_id = ?`, [mandate.id]);
    const seeds = await n(
      `SELECT COUNT(*) AS n FROM opportunity_seeds WHERE mandate_id = ? AND promoted_to IS NULL AND buried_at IS NULL`, [mandate.id]);
    const so = looked > 0 ? ` ${String(looked)} looked at and set aside.`
      : seeds > 0 ? ` ${String(seeds)} possibilit${seeds === 1 ? 'y' : 'ies'} being looked into.` : '';
    return { state: 'waiting', word: 'Looking', lastPassAt, stoppedLoop: null,
      sentence: `Foundry is working. It is looking; nothing found so far has earned a candidate.${so}` };
  }
  return { state: 'waiting', word: 'Waiting', lastPassAt, stoppedLoop: null,
    sentence: 'Foundry is working. Nothing is being looked for — no search is open.' };
}
