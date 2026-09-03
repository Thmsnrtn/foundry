// =============================================================================
// FOUNDRY - what a source is capable of settling
//
// THIS FIXES A DEFECT THAT SHIPPED. Weeding asked a package registry about a
// seed sown from what somebody said, and buried the seed whenever the registry
// returned nothing relevant - "investigated, and the world had nothing to say".
// That is SOURCE TWO EMPTY, THEREFORE BURY, and it is wrong twice over.
//
// A registry knows what already exists. It knows nothing whatever about whether
// the work hurts, so its silence cannot falsify a claim about pain. And where
// the claim is that a GAP exists, a registry finding nothing maintained is
// evidence FOR the claim, not against it. The old rule buried its own best
// findings.
//
// So the question is never "did the second source come back empty". It is:
//
//   WHAT QUESTION WAS THIS SOURCE CAPABLE OF ANSWERING?
//   DOES ITS RESULT ACTUALLY CONTRADICT THE HYPOTHESIS?
//
// Both are looked up rather than assumed, and A MISSING ROW MEANS THE SOURCE
// SAYS NOTHING. Silence is the safe default, which makes the mechanical burial
// structurally impossible rather than merely discouraged.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

export type Found = 'found' | 'empty';
export type Bearing = 'contradicts' | 'supports' | 'narrows' | 'says_nothing';

export interface WhatItBears {
  bearing: Bearing;
  because: string;
}

/**
 * WHAT THIS RESULT DOES TO THIS HYPOTHESIS.
 *
 * The constitutional table answers, or it does not, and not answering means the
 * source is silent on the matter. A stance whose bearing on a hypothesis has
 * never been established cannot contradict it — however emphatically it came
 * back empty.
 */
export async function whatItBears(input: {
  stance: string; about: string | null; found: Found;
}): Promise<WhatItBears> {
  if (input.about === null) {
    return {
      bearing: 'says_nothing',
      because: 'this seed does not say what it asserts, so nothing can contradict it',
    };
  }
  const row = (await query(
    'SELECT bearing, because FROM stance_bearings WHERE stance = ? AND about = ? AND when_it = ?',
    [input.stance, input.about, input.found])).rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    const asserts = (await query(
      'SELECT asserts FROM hypothesis_kinds WHERE kind = ?', [input.about]))
      .rows[0] as Record<string, unknown> | undefined;
    const stance = (await query(
      'SELECT what_it_says, not_the_same_as FROM epistemic_stances WHERE stance = ?',
      [input.stance])).rows[0] as Record<string, unknown> | undefined;
    return {
      bearing: 'says_nothing',
      because: stance === undefined || asserts === undefined
        ? `nothing establishes what ${input.stance} can say about ${input.about}`
        : `this way of knowing tells me whether ${String(stance.what_it_says)}. The `
          + `question is whether ${String(asserts.asserts).replace(/^that /, '')}, and `
          + `coming back ${input.found === 'empty' ? 'empty' : 'full'} does not settle `
          + 'that.',
    };
  }
  return { bearing: String(row.bearing) as Bearing, because: String(row.because) };
}

/**
 * WHICH WAYS OF KNOWING COULD SETTLE THIS, AND WHICH OF THOSE CAN FOUNDRY REACH?
 *
 * Two different questions, and the gap between them is the honest answer to
 * "why is this seed still open". A hypothesis about willingness to pay is not
 * settled by anything Foundry can currently look through, and saying that is
 * better than testing it against something irrelevant and calling the result
 * evidence.
 */
export async function whoCouldSettle(about: string | null): Promise<{
  couldSettle: Array<{ stance: string; whatItSays: string }>;
  canReach: string[];
  outOfReach: Array<{ stance: string; whatItSays: string }>;
}> {
  if (about === null) return { couldSettle: [], canReach: [], outOfReach: [] };
  // A STANCE, NOT A BEARING. One stance can bear two ways on the same question
  // depending on what it finds — a registry contradicts a gap thesis when full
  // and supports it when empty — so which way it would cut is not knowable
  // until it has been asked, and this does not pretend otherwise.
  const couldSettle = ((await query(
    `SELECT b.stance, s.what_it_says
       FROM stance_bearings b
       JOIN epistemic_stances s ON s.stance = b.stance
      WHERE b.about = ?
      GROUP BY b.stance
      ORDER BY s.sort_order`, [about]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    stance: String(r.stance), whatItSays: String(r.what_it_says),
  }));
  const canReach = await reachableStances();
  return {
    couldSettle,
    canReach: couldSettle.filter((c) => canReach.includes(c.stance)).map((c) => c.stance),
    outOfReach: couldSettle.filter((c) => !canReach.includes(c.stance))
      .map((c) => ({ stance: c.stance, whatItSays: c.whatItSays })),
  };
}

/**
 * THE WAYS OF KNOWING FOUNDRY CAN ACTUALLY ASK.
 *
 * Reads the provider registry rather than a list kept here, so opening a new
 * eye changes what discovery can falsify without anybody editing this file.
 *
 * REACHABLE IS NOT PROVEN, deliberately. The first instinct was to require a
 * witnessed maturity, and it is circular: a provider is proven by being used,
 * so refusing to use it until it is proven means it never is. What this
 * excludes is a provider known to be BROKEN — unavailable, or degraded, where
 * an answer would arrive and could not be trusted to bear anything. Whether
 * the answer was any good is recorded per questioning, which is where that
 * belongs.
 */
export async function reachableStances(): Promise<string[]> {
  return ((await query(
    `SELECT DISTINCT t.epistemic_stance AS stance
       FROM capability_providers p
       JOIN market_source_types t ON t.source_type = p.supplies_source_type
      WHERE p.maturity NOT IN ('unavailable','degraded')
        AND t.epistemic_stance IS NOT NULL`))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => String(r.stance));
}

/** What was asked of a source, and what its answer was capable of doing. Kept
 * because burying a seed on evidence means being able to show, later, that the
 * evidence could have borne the burial. */
export async function recordQuestioning(input: {
  founderId: string; seedId: string; stance: string; asked: string;
  found: Found; bears: WhatItBears; world: 'real' | 'reference';
}): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO seed_questionings
       (id, founder_id, seed_id, stance, asked, found, bearing, because, evidence_mode)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, input.founderId, input.seedId, input.stance, input.asked, input.found,
      input.bears.bearing, input.bears.because,
      input.world === 'reference' ? 'reference' : 'real']);
  return id;
}

/** What has been asked about a seed, and what each answer bore on. */
export async function whatWasAsked(seedId: string): Promise<Array<{
  stance: string; asked: string; found: Found; bearing: Bearing; because: string;
}>> {
  return ((await query(
    `SELECT stance, asked, found, bearing, because FROM seed_questionings
      WHERE seed_id = ? ORDER BY asked_at, rowid`, [seedId]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    stance: String(r.stance), asked: String(r.asked), found: String(r.found) as Found,
    bearing: String(r.bearing) as Bearing, because: String(r.because),
  }));
}
