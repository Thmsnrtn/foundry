// =============================================================================
// FOUNDRY — Home, as one reading: where everything stands, in thirty seconds.
//
// INSTITUTION_MODEL §6 (HomeSummary) and §9 (Home), 30 September 2026. Home
// already answered "does anything need me" and "is Foundry running". What it
// could not say in one glance was where each of the other three doors stood:
// what the owner owns and at what stage, what Foundry is looking for, and what
// the owner has said they want. This reads the three read models the doors
// themselves bind to — so Home can never disagree with the page one tap away —
// and the one queue for the count. It stores nothing and writes nothing.
// =============================================================================

import { stagesOf } from '../portfolio/stage.js';
import { exploreSummary } from '../explore/summary.js';
import { mandateOf } from '../mandate/statements.js';
import { needsYou } from '../needs-you/queue.js';

export interface HomeSummary {
  needsYou: number;
  portfolio: { operating: number; testing: number; retired: number };
  explore: { lookingFor: string | null; inFlight: number; paid: number };
  mandate: { statements: number; spendingLessUntil: string | null; paused: string[] };
  /** One sentence for the top of Home. Calm when all is calm. */
  sentence: string;
}

/** Everything Home needs to say where the four doors stand. Four readers, in parallel. */
export async function homeSummary(founderId: string, now: Date = new Date()): Promise<HomeSummary> {
  const [stages, explore, wants, queue] = await Promise.all([
    stagesOf(founderId), exploreSummary(founderId, now), mandateOf(founderId, now), needsYou(founderId, now),
  ]);
  const count = (g: string): number => stages.filter((s) => s.group === g).length;
  const conserve = wants.find((w) => w.dimension === 'posture' && w.subject === 'conserve');
  const portfolio = { operating: count('Operating'), testing: count('Testing'), retired: count('Retired') };
  const n = queue.items.length;
  const sentence = n > 0
    ? `${String(n)} ${n === 1 ? 'thing needs' : 'things need'} you. Everything else is carrying on.`
    : 'Nothing needs you. Foundry is working.';
  return {
    needsYou: n,
    portfolio,
    explore: {
      lookingFor: explore.search?.statement ?? null,
      inFlight: explore.work.length,
      paid: explore.stages.find((s) => s.key === 'paid')?.n ?? 0,
    },
    mandate: {
      statements: wants.length,
      spendingLessUntil: conserve ? (conserve.until ?? conserve.reviewAt) : null,
      paused: wants.filter((w) => w.dimension === 'avoid' && w.scope.kind === 'portfolio').map((w) => w.label),
    },
    sentence,
  };
}
