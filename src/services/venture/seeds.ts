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
import { batch, query } from '../../db/client.js';
import { matchRealityOnly, realityOnlyPatterns } from './market-evidence.js';

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

  // THE UNKNOWNS HAVE TO BECOME ROWS, NOT A STRING.
  //
  // `unknowns_json` is a record for a reader. `market_unknowns` is what the
  // institution can act on: what blocks advancement, what an experiment is
  // proposed against, what gets settled. Writing only the former is why a real
  // candidate could be promoted and then never move again — every question
  // standing in its way existed as prose nothing could reach.
  //
  // Whether a question blocks is DERIVED, never asserted: a question only
  // behaviour can settle is blocking by definition, and the constitutional
  // `only_settled_by` becomes its cheapest test — which is the field an
  // experiment cannot be proposed without.
  const patterns = await realityOnlyPatterns();
  const opportunityId = nanoid();

  // ALL OF IT, OR NONE OF IT.
  //
  // Written as one transaction because the dangerous partial failure is silent:
  // a candidate whose opportunity row exists and whose BLOCKING questions did
  // not finish being written is a candidate that advances past a gate which
  // should have held it, and nothing downstream could tell that from a
  // candidate legitimately free of blockers.
  await batch([
    { sql: `INSERT INTO venture_opportunities
              (id, mandate_id, founder_id, headline, who_has_it, the_problem,
               why_it_might, kill_thesis, unknowns_json, sources_json,
               evidence_mode, from_seed_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [opportunityId, String(seed.mandate_id), String(seed.founder_id),
        input.headline.trim(), input.whoHasIt.trim(), input.theProblem.trim(),
        input.whyItMight.trim(), input.killThesis.trim(),
        JSON.stringify(input.unknowns), JSON.stringify(input.sources),
        String(seed.evidence_mode), input.seedId] },
    ...input.unknowns.map((question) => {
      const hit = matchRealityOnly(question, patterns);
      return {
        sql: `INSERT INTO market_unknowns
                (id, founder_id, opportunity_id, claim_id, question, blocking,
                 cheapest_test)
              VALUES (?,?,?,NULL,?,?,?)`,
        args: [nanoid(), String(seed.founder_id), opportunityId, question.trim(),
          hit === null ? 0 : 1, hit === null ? null : hit.onlySettledBy],
      };
    }),
    { sql: 'UPDATE opportunity_seeds SET promoted_to = ? WHERE id = ?',
      args: [opportunityId, input.seedId] },
  ]);

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
  /** What the portfolio needed, which is where the looking started. */
  lookingFor: string | null;
  /** The shape the owner named, or null meaning any economic form. */
  shapeNamed: string | null;
  /** What was actually searched for, so a barren search reads as barren. */
  termsTried: string | null;
  /** The constraints he said, held to throughout. */
  heldTo: string | null;
  seed: string; origin: SeedOrigin; originSaid: string;
  /** Foundry's reading of the signal, which is inference and is labelled so. */
  signalKind: string | null;
  inference: string | null;
  /** The sentence somebody actually wrote. Evidence, as distinct from the above. */
  observation: string | null;
  /** THE WORDS FOUNDRY WAS READING when it formed that reading — a verbatim
   * span of the observation, which the database checked. This is what makes
   * the reading inspectable rather than merely asserted. */
  motivatedBy: string | null;
  /** What remained unclear, and what else the same words could have meant. */
  ambiguity: string | null;
  orItCouldBe: string | null;
  /** What would show Foundry misread it, named before the evidence arrived. */
  misreadIf: string | null;
} | null> {
  const row = (await query(
    `SELECT s.seed, s.origin, s.origin_said, s.signal_kind, s.inference, o.saw,
            b.looking_for, b.shape_named, b.terms_tried, b.held_to,
            i.motivated_by, i.ambiguity, i.or_it_could_be, i.misread_if
       FROM venture_opportunities v
       JOIN opportunity_seeds s ON s.id = v.from_seed_id
       LEFT JOIN market_observations o ON o.id = s.origin_observation_id
       LEFT JOIN search_briefs b ON b.id = s.brief_id
       LEFT JOIN observation_interpretations i ON i.id = s.interpretation_id
      WHERE v.id = ?`, [opportunityId])).rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    lookingFor: row.looking_for == null ? null : String(row.looking_for),
    shapeNamed: row.shape_named == null ? null : String(row.shape_named),
    termsTried: row.terms_tried == null ? null : String(row.terms_tried),
    heldTo: row.held_to == null ? null : String(row.held_to),
    seed: String(row.seed), origin: String(row.origin) as SeedOrigin,
    originSaid: String(row.origin_said),
    signalKind: row.signal_kind == null ? null : String(row.signal_kind),
    inference: row.inference == null ? null : String(row.inference),
    observation: row.saw == null ? null : String(row.saw),
    motivatedBy: row.motivated_by == null ? null : String(row.motivated_by),
    ambiguity: row.ambiguity == null ? null : String(row.ambiguity),
    orItCouldBe: row.or_it_could_be == null ? null : String(row.or_it_could_be),
    misreadIf: row.misread_if == null ? null : String(row.misread_if),
  };
}

/**
 * WHY DO I OWN THIS?
 *
 * The same chain, entered from the asset rather than the candidate. An asset is
 * the only end of this chain he will ever look at from — by the time something
 * is running, the candidate that produced it is a row nobody remembers the id
 * of — and until `products.from_opportunity_id` existed there was no way in.
 *
 * Returns null for an asset with no recorded lineage, which is the honest
 * answer for anything acquired rather than discovered, and for everything that
 * existed before the link did. Silence, not a guess.
 */
export async function whyWeOwnThis(productId: string): Promise<
  (Awaited<ReturnType<typeof whyWeStartedLooking>> & {
    opportunityId: string;
    /** The test that produced the asset, and how it stands. Null for an asset
     * that predates the experiment link. */
    experiment: {
      id: string; whatWeDo: string; whatWeExpect: string; wouldDisprove: string;
      decidedAt: string | null; ranAt: string | null; verdict: string | null;
    } | null;
    /** How the asset exists: a test object, or recognised by real evidence. */
    standing: 'experimental' | 'earned';
    earned: { at: string; by: string; because: string } | null;
    retiredBecause: string | null;
  }) | null
> {
  // THE EXPERIMENT IS THE LINK THAT WAS MISSING. `from_opportunity_id` existed
  // for a long time and nothing wrote it; an asset comes from the test that
  // earned it, and the test from the candidate. Read both, prefer the
  // experiment's candidate when both are present, and say so when neither is.
  const row = (await query(
    `SELECT p.from_opportunity_id, p.from_experiment_id, p.standing, p.earned_at,
            p.earned_by, p.earned_because, p.retired_because,
            e.opportunity_id AS experiment_opportunity, e.what_we_do, e.what_we_expect,
            e.would_disprove, e.decided_at, e.ran_at, e.verdict
       FROM products p
       LEFT JOIN venture_experiments e ON e.id = p.from_experiment_id
      WHERE p.id = ?`, [productId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const opportunityId = row.experiment_opportunity != null ? String(row.experiment_opportunity)
    : row.from_opportunity_id != null ? String(row.from_opportunity_id) : null;
  if (opportunityId === null) return null;
  const chain = await whyWeStartedLooking(opportunityId);
  if (chain === null) return null;
  return {
    ...chain, opportunityId,
    experiment: row.from_experiment_id == null ? null : {
      id: String(row.from_experiment_id), whatWeDo: String(row.what_we_do),
      whatWeExpect: String(row.what_we_expect), wouldDisprove: String(row.would_disprove),
      decidedAt: row.decided_at == null ? null : String(row.decided_at),
      ranAt: row.ran_at == null ? null : String(row.ran_at),
      verdict: row.verdict == null ? null : String(row.verdict),
    },
    standing: String(row.standing) as 'experimental' | 'earned',
    earned: row.earned_at == null ? null : {
      at: String(row.earned_at), by: String(row.earned_by), because: String(row.earned_because),
    },
    retiredBecause: row.retired_because == null ? null : String(row.retired_because),
  };
}
