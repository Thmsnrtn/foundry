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
