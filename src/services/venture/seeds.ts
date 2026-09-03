// =============================================================================
// FOUNDRY - a seed is not a candidate
//
// Discovery begins with one weak signal, and the institution needs something to
// organise the next investigation around. So a seed means only THIS MAY BE
// WORTH INVESTIGATING, and it is never evidence that an opportunity exists.
//
// PROMOTION TAKES INDEPENDENT WAYS OF KNOWING, not a count of sources. Two APIs
// can tell us the same thing and two communities can repeat one story; what
// makes evidence independent is that it knows differently - that people hurt,
// that something already solves it, that somebody is asking money for it, that
// an organisation is paying labour against it. A registry read twice is one way
// of knowing, and the rule says so.
//
// AND MOST SEEDS DIE. That is the system working rather than failing. A seed
// buried for want of evidence keeps why, so the same thin idea does not come
// back next quarter wearing different words.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

export type SeedOrigin = 'signal' | 'portfolio_need' | 'pattern' | 'reasoned';

export interface Seed {
  id: string; seed: string; origin: SeedOrigin; originSaid: string;
  sownAt: string; reference: boolean;
}

/**
 * SOW ONE.
 *
 * A seed from a signal must name the observation it came from; a reasoned seed
 * must name none. The database enforces both, because "origin: signal" without
 * a link is a word rather than a chain, and a hypothesis carrying an
 * observation is reasoning dressed as evidence.
 */
export async function sow(input: {
  founderId: string; mandateId?: string | null; seed: string;
  origin: SeedOrigin; originSaid: string; originObservationId?: string | null;
  evidenceMode: 'real' | 'reference';
}): Promise<string | { alreadyBuried: { seed: string; because: string; when: string } }> {
  // THE GRAVEYARD IS CONSULTED BEFORE ANYTHING IS SOWN. Rediscovering an idea
  // the institution already killed is how a research function looks busy
  // without learning anything.
  if (input.evidenceMode === 'real') {
    const dead = await buriedBefore(input.founderId, input.seed);
    if (dead !== null) {
      return { alreadyBuried: { seed: dead.seed, because: dead.because, when: dead.when } };
    }
  }
  const id = nanoid();
  await query(
    `INSERT INTO opportunity_seeds
       (id, founder_id, mandate_id, seed, origin, origin_said,
        origin_observation_id, evidence_mode)
     VALUES (?,?,?,?,?,?,?,?)`,
    [id, input.founderId, input.mandateId ?? null, input.seed.trim(), input.origin,
      input.originSaid.trim(), input.originObservationId ?? null, input.evidenceMode]);
  return id;
}

export async function openSeeds(founderId: string, limit = 50): Promise<Seed[]> {
  return ((await query(
    `SELECT id, seed, origin, origin_said, sown_at, evidence_mode
       FROM opportunity_seeds
      WHERE founder_id = ? AND promoted_to IS NULL AND buried_at IS NULL
      ORDER BY sown_at, rowid LIMIT ?`, [founderId, limit]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), seed: String(r.seed), origin: String(r.origin) as SeedOrigin,
    originSaid: String(r.origin_said), sownAt: String(r.sown_at).slice(0, 10),
    reference: String(r.evidence_mode) === 'reference',
  }));
}

export interface StanceEvidence {
  stance: string; whatItSays: string; observations: number;
}

export interface WhatItWouldTakeToBelieve {
  /** Ways of knowing that have actually said something about this. */
  have: StanceEvidence[];
  /** What is missing before this could be called a candidate. */
  stillNeeded: number;
  /** True when the evidence is independent enough to promote. */
  enough: boolean;
  /** The one sentence, in the owner's language. */
  sentence: string;
}

/** How many genuinely different ways of knowing a candidate needs. */
const INDEPENDENT_STANCES_NEEDED = 2;

/**
 * WHAT WOULD I NEED TO KNOW BEFORE CALLING THIS A CANDIDATE?
 *
 * Counted over STANCES, not observations and not sources. Fifteen readings of
 * one registry are one way of knowing, and the sentence says so rather than
 * flattering the total.
 *
 * REHEARSAL NEVER COUNTS. An invented source says nothing about the world, so
 * it cannot be one of the independent ways a real candidate is believed - which
 * is what keeps the reference world a rehearsal rather than a shortcut.
 */
export async function whatItWouldTakeToBelieve(seedId: string): Promise<WhatItWouldTakeToBelieve> {
  const have = ((await query(
    `SELECT t.epistemic_stance AS stance, s.what_it_says, COUNT(*) AS n
       FROM market_observations o
       JOIN market_claims c ON c.id = o.claim_id
       JOIN market_source_types t ON t.source_type = o.source_type
       JOIN epistemic_stances s ON s.stance = t.epistemic_stance
      WHERE c.seed_id = ? AND o.evidence_mode <> 'reference'
        AND t.epistemic_stance <> 'rehearsal'
      GROUP BY t.epistemic_stance
      ORDER BY s.sort_order`, [seedId]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    stance: String(r.stance), whatItSays: String(r.what_it_says),
    observations: Number(r.n),
  }));

  const enough = have.length >= INDEPENDENT_STANCES_NEEDED;
  const stillNeeded = Math.max(0, INDEPENDENT_STANCES_NEEDED - have.length);
  const sentence = have.length === 0
    ? 'Nothing has been observed about this yet. It is a thing to look into, not a '
      + 'thing I believe.'
    : enough
      ? `${String(have.length)} genuinely different ways of knowing have said something: `
        + `${have.map((h) => h.whatItSays).join('; ')}.`
      : `Only one way of knowing has said anything — ${have[0]?.whatItSays ?? ''} — `
        + 'across ' + String(have[0]?.observations ?? 0) + ' observations. Reading the '
        + 'same kind of source again would not make that two.';
  return { have, stillNeeded, enough, sentence };
}

/**
 * PROMOTE, OR REFUSE AND SAY WHY.
 *
 * The refusal is the useful half. A candidate that exists because Foundry could
 * tell a plausible story about one source is exactly the failure this whole
 * apparatus is built to prevent, and it would arrive wearing real URLs.
 */
export async function promote(input: {
  seedId: string; headline: string; whoHasIt: string; theProblem: string;
  whyItMight: string; killThesis: string; unknowns: string[]; sources: string[];
}): Promise<{ opportunityId: string } | { refused: string }> {
  const seed = (await query(
    `SELECT founder_id, mandate_id, evidence_mode, promoted_to, buried_at
       FROM opportunity_seeds WHERE id = ?`, [input.seedId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!seed) return { refused: 'no such seed' };
  if (seed.promoted_to != null) return { refused: 'that seed is already a candidate' };
  if (seed.buried_at != null) return { refused: 'that seed was buried' };
  if (seed.mandate_id == null) {
    return { refused: 'a candidate belongs to a search, and this seed has none' };
  }

  const believe = await whatItWouldTakeToBelieve(input.seedId);
  if (!believe.enough) {
    return {
      refused: `${believe.sentence} A candidate needs `
        + `${String(INDEPENDENT_STANCES_NEEDED)} genuinely different ways of knowing, `
        + 'and one plausible story about one source is not that.',
    };
  }

  const opportunityId = nanoid();
  await query(
    `INSERT INTO venture_opportunities
       (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might,
        kill_thesis, unknowns_json, sources_json, evidence_mode, from_seed_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [opportunityId, String(seed.mandate_id), String(seed.founder_id),
      input.headline.trim(), input.whoHasIt.trim(), input.theProblem.trim(),
      input.whyItMight.trim(), input.killThesis.trim(),
      JSON.stringify(input.unknowns), JSON.stringify(input.sources),
      String(seed.evidence_mode), input.seedId]);
  await query('UPDATE opportunity_seeds SET promoted_to = ? WHERE id = ?',
    [opportunityId, input.seedId]);
  return { opportunityId };
}

const STOP_WORDS = new Set(['a', 'an', 'the', 'for', 'of', 'to', 'and', 'that', 'with',
  'in', 'on', 'maybe', 'worth', 'looking', 'into', 'about', 'this', 'people', 'some',
  'something', 'anything', 'would', 'could', 'their', 'them']);

function meaningfulWords(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w)));
}

/**
 * HAVE WE BURIED THIS IDEA BEFORE?
 *
 * The reason a seed died is only worth keeping if something reads it, and a
 * gate caught exactly that: burial recorded a reason nobody consulted, which is
 * a filing cabinet rather than a memory. This is what makes the graveyard mean
 * something — the same thin idea coming back next quarter in different words
 * meets the reason it died last time.
 *
 * Word overlap, not embeddings, for the same reason the candidate graveyard
 * uses it: the match has to be explicable in one line and cheap enough to run
 * on every seed. It will miss a paraphrase and it will never claim a match it
 * cannot show.
 */
export async function buriedBefore(founderId: string, seed: string): Promise<{
  seed: string; because: string; when: string; shares: string[];
} | null> {
  const words = meaningfulWords(seed);
  if (words.size === 0) return null;
  const dead = (await query(
    `SELECT seed, buried_because, buried_at FROM opportunity_seeds
      WHERE founder_id = ? AND buried_at IS NOT NULL
      ORDER BY buried_at DESC LIMIT 200`, [founderId]))
    .rows as unknown as Array<Record<string, unknown>>;
  for (const row of dead) {
    const theirs = meaningfulWords(String(row.seed));
    const shared = [...words].filter((w) => theirs.has(w));
    if (shared.length >= 2 && shared.length * 2 >= words.size) {
      return {
        seed: String(row.seed), because: String(row.buried_because ?? ''),
        when: String(row.buried_at).slice(0, 10), shares: shared,
      };
    }
  }
  return null;
}

/** Most seeds die here, and the reason is kept so the same thin idea stays dead. */
export async function bury(input: { seedId: string; because: string }): Promise<void> {
  await query(
    `UPDATE opportunity_seeds SET buried_at = datetime('now'), buried_because = ?
      WHERE id = ?`, [input.because.trim(), input.seedId]);
}

/**
 * WHERE IT CAME FROM, walkable from the candidate backwards.
 *
 * Synthesis must never sever a venture from the thing that made anybody
 * curious, so this reads the chain rather than reconstructing it.
 */
export async function whyWeStartedLooking(opportunityId: string): Promise<{
  seed: string; origin: SeedOrigin; originSaid: string; observation: string | null;
} | null> {
  const row = (await query(
    `SELECT s.seed, s.origin, s.origin_said, o.saw
       FROM venture_opportunities v
       JOIN opportunity_seeds s ON s.id = v.from_seed_id
       LEFT JOIN market_observations o ON o.id = s.origin_observation_id
      WHERE v.id = ?`, [opportunityId])).rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    seed: String(row.seed), origin: String(row.origin) as SeedOrigin,
    originSaid: String(row.origin_said),
    observation: row.saw == null ? null : String(row.saw),
  };
}
