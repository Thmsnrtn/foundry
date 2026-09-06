// =============================================================================
// FOUNDRY - discovery that starts from a need, not from an idea
//
// The failure this is designed against is not laziness. It is a model
// generating plausible startup ideas and then searching for things that sound
// supportive, which produces sourced, dated, confident nonsense - the exact
// shape of every defect this institution has found in itself so far.
//
// So: the search starts from what the PORTFOLIO NEEDS, looks for economic
// signals in what people actually wrote, and keeps THREE things apart. The
// OBSERVATION is what somebody wrote, and it is the only evidence in play. The
// INTERPRETATION is Foundry's reading of what it may indicate. The HYPOTHESIS
// is Foundry's entrepreneurial inference, which is further from the evidence
// than the reading is. Each lives somewhere different.
//
// AND THE BRIEF NEVER INVENTS A SHAPE. "Find another small digital income
// stream" becoming "find another SaaS" is the failure the river-of-nickels
// mandate exists to prevent, so the shape is whatever the owner named and
// nothing here fills it in.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { portfolioNeeds } from '../founder/resilience.js';
import { currentMandate } from './mandate.js';
import { whatPeopleSaid } from './sources/community.js';
import { formClaim, observe } from './market-evidence.js';
import { openSeeds, sow } from './seeds.js';
import { abstained, alreadySetAside, interpret } from './interpretation.js';
import { recordQuestioning, whatItBears, whoCouldSettle } from './falsification.js';

export interface Brief {
  id: string; lookingFor: string; heldTo: string | null;
  shapeNamed: string | null; terms: string[];
  /** Where each term came from: the portfolio, his own words, or a shape he named. */
  termsFrom: string[];
}

/**
 * WHAT THIS SEARCH IS FOR, before anything is looked at.
 *
 * Derived from what the portfolio is actually concentrated on rather than from
 * anybody's opinion about what would be nice to own. The constraints are the
 * owner's own sentences. The shape is whatever he named, and null is a real
 * answer that means any economic form.
 */
export async function briefFor(input: {
  founderId: string; mandateId: string; world: 'real' | 'reference';
}): Promise<Brief | null> {
  const mandate = await currentMandate(input.founderId);
  if (!mandate || mandate.id !== input.mandateId) return null;

  const needs = await portfolioNeeds(input.founderId, input.world);
  const lookingFor = needs.length === 0
    ? 'anything that earns, since nothing in the portfolio is concentrated enough '
      + 'to need avoiding'
    : needs.slice(0, 4).map((n) => n.need).join('; ');

  const heldTo = mandate.guidance
    .filter((g) => g.kind === 'avoid' || g.kind === 'prefer')
    .map((g) => g.statement).join('; ') || null;

  // TERMS COME FROM WHAT THE PORTFOLIO LACKS, not from a list of business ideas.
  // A need is "something not depending on google search"; the words worth
  // searching are about the work people do, not about the thing we might sell.
  // AND FROM WHAT HE SAID. His guidance used to reach the candidates only
  // after they were found, and never where the search looked; a preference
  // for things that need none of his attention was applied to a pile of
  // signals gathered as if he had said nothing. Now each avoid or prefer
  // adds the words people use when describing the work it points at — about
  // effort and situation, never a product form.
  const { terms, from } = await termsFrom(needs.map((n) => n.value), mandate.shape, mandate.guidance);

  const id = nanoid();
  await query(
    `INSERT INTO search_briefs
       (id, founder_id, mandate_id, looking_for, held_to, shape_named, terms_tried, evidence_mode,
        terms_from)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, input.founderId, input.mandateId, lookingFor, heldTo, mandate.shape,
      terms.join(' | '), input.world, JSON.stringify(from)]);
  return { id, lookingFor, heldTo, shapeNamed: mandate.shape, terms, termsFrom: from };
}

/**
 * WHAT TO SEARCH FOR, WHICH IS WORK RATHER THAN PRODUCTS.
 *
 * Deliberately about the shape of effort - people doing things by hand,
 * checking things repeatedly, assembling things from scattered places. A search
 * for product categories would only ever return product categories, which is
 * how a discovery system ends up rediscovering the things somebody already
 * built.
 */
async function termsFrom(
  concentratedOn: string[], shape: string | null,
  guidance: Array<{ kind: string; subject: string | null; dimension: string | null; statement: string }>,
): Promise<{ terms: string[]; from: string[] }> {
  const base = [
    'doing this manually every',
    'wrote a script to keep track',
    'no tool does this',
    'keep a spreadsheet for',
    'have to check every week',
  ];
  const terms: string[] = [];
  const from: string[] = [];
  for (const t of base) {
    terms.push(t);
    from.push(concentratedOn.length === 0 ? 'the portfolio: nothing concentrated'
      : `the portfolio: ${concentratedOn.slice(0, 3).join(', ')}`);
  }
  // WHAT HE SAID, AS WORDS TO LOOK FOR. The vocabulary is constitutional and
  // about work; a guidance row with no phrase on record adds nothing, and says
  // so in the record rather than inventing a term.
  const { exposureAnswersTo } = await import('./mandate.js');
  const emphasis = (await query(
    `SELECT dimension, guidance_kind, subject, phrase, why FROM search_emphasis ORDER BY sort_order`, []))
    .rows as unknown as Array<Record<string, unknown>>;
  for (const g of guidance) {
    if (g.kind !== 'avoid' && g.kind !== 'prefer') continue;
    const rows = emphasis.filter((e) => String(e.dimension) === g.dimension && String(e.guidance_kind) === g.kind
      && (e.subject == null || (g.subject !== null && exposureAnswersTo(String(e.subject), g.subject))));
    for (const e of rows) {
      const phrase = String(e.phrase);
      if (terms.includes(phrase)) continue;
      terms.push(phrase);
      from.push(`he said: ${g.statement} (${String(e.why)})`);
    }
  }
  // The shape is used only where the owner named one, and only to narrow.
  if (shape === null) return { terms, from };
  return {
    terms: terms.map((t) => `${t} ${shape.replace(/_/g, ' ')}`),
    from: from.map((f) => `${f}; narrowed to the shape he named: ${shape.replace(/_/g, ' ')}`),
  };
}

/**
 * WHICH SENTENCES ARE WORTH PAYING TO READ.
 *
 * Markers, not meaning — and that is now all they are asked to be. Each phrase
 * is the way a person writes when they are describing work they resent: "I
 * ended up writing", "every single time", "there is nothing that". It is blunt
 * and it will miss plenty, and its job is to decide which of a hundred
 * sentences a model should be paid to comprehend.
 *
 * Triage is the honest limit of a regex. What the sentence MEANS is read
 * elsewhere, by something that can read.
 */
const MARKERS: Array<{ kind: string; phrases: RegExp }> = [
  { kind: 'manual_workaround',
    phrases: /\b(by hand|manually|wrote a (little )?script|spreadsheet|copy.?paste|hacked together)\b/i },
  { kind: 'recurring_pain',
    phrases: /\b(every (single )?(time|week|month)|keeps happening|again and again|constantly)\b/i },
  { kind: 'repeated_monitoring',
    phrases: /\b(check(ing)? (it|this|them)? ?(every|daily|weekly)|keep an eye on|poll(ing)? (it|the))\b/i },
  { kind: 'repeated_assembly',
    phrases: /\b(pull(ing)? together|gather(ing)? from|stitch(ing)? together|collate)\b/i },
  { kind: 'marketplace_gap',
    phrases: /\b(nothing (that|does|exists)|there is no|couldn'?t find (any|a)|does anyone know of)\b/i },
  { kind: 'disliked_product',
    phrases: /\b(clunky|awful|hate using|so slow|gets it wrong|broken since)\b/i },
  { kind: 'fragmented_workflow',
    phrases: /\b(between (two|three|several) tools|falls? between|copy(ing)? between)\b/i },
  { kind: 'heavy_for_the_job',
    phrases: /\b(overkill|way too much for|paying .* just to|enterprise .* for a)\b/i },
  { kind: 'public_information',
    phrases: /\b(public (register|record|filing)|scattered across|out of date within)\b/i },
  { kind: 'costly_human_work',
    phrases: /\b(paying (someone|a person|an? \w+) to (do|check|enter)|hours a week (doing|on))\b/i },
];

/**
 * THE SENTENCE THEY ACTUALLY WROTE.
 *
 * Two attempts at meaning failed before comprehension arrived, and both
 * failures are worth keeping. Naming the seed after the SEARCH TERM produced
 * four ways of writing down what Foundry typed. Extracting a subject by taking
 * content words near the marker produced word salad — "manual workaround:
 * manually good idea execution" — because picking nearby nouns is not
 * comprehension, and a paraphrase that cannot parse is worse than no paraphrase.
 *
 * This function no longer tries. It bounds the sentence, and the sentence goes
 * to something that can read it. The clause is still what gets quoted wherever
 * the source is shown, because what a person wrote is the only evidence here.
 */
export function clauseAround(text: string, at: number): string | null {
  const before = text.lastIndexOf('.', at);
  const afterFullStop = text.indexOf('.', at);
  const from = before === -1 ? 0 : before + 1;
  const to = afterFullStop === -1 ? text.length : afterFullStop;
  const clause = text.slice(from, to).replace(/\s+/g, ' ').trim();
  if (clause.length < 25) return null;
  return clause.length > 160 ? `${clause.slice(0, 157)}...` : clause;
}

export function readSignal(text: string): {
  kind: string; because: string; clause: string | null;
} | null {
  for (const marker of MARKERS) {
    const hit = marker.phrases.exec(text);
    if (hit) {
      return {
        kind: marker.kind,
        because: `reads like ${marker.kind.replace(/_/g, ' ')}: "${hit[0]}"`,
        clause: clauseAround(text, hit.index),
      };
    }
  }
  return null;
}

export interface Sown {
  seedId: string;
  /** The seed in Foundry's own words: what it thinks might be true. */
  seed: string;
  /** What that hypothesis asserts, so a source can be asked whether it can
   * even contradict it. */
  asserts: string | null;
  signalKind: string;
  /** Foundry's reading of the sentence, which is inference and stored as such. */
  reading: string;
  nextQuestion: string;
}

export interface DiscoveryResult {
  brief: Brief | null;
  looked: number;
  signals: number;
  /** How many sentences were actually read. Reading costs money, so it is
   * counted and capped rather than left to the volume of the search. */
  read: number;
  sown: Sown[];
  /** Seeds not sown, with the reason — most of discovery is this, and most of
   * THIS is now Foundry reading a real sentence and declining to find a
   * business in it. */
  passedOver: Array<{ what: string; because: string }>;
}

/** At most this many seeds per pass. The frontier is not a volume target. */
const MOST_SEEDS_PER_PASS = 4;
/** At most this many sentences read per pass. Comprehension is a model call,
 * and unnecessary AI spend is one of the things this institution is supposed
 * to be minimising. */
const MOST_READINGS_PER_PASS = 10;

/**
 * ONE PASS OF DISCOVERY.
 *
 * Look through what the institution actually has, read the sentences that look
 * like they might be about work, and sow a small number of seeds - each in
 * Foundry's own words, each with the exact sentence somebody wrote preserved
 * beneath it, each carrying the question that would most cheaply settle whether
 * it is nonsense.
 *
 * THE MARKERS ARE NOW A PREFILTER RATHER THAN A READING. They decide which
 * sentences are worth paying to comprehend, which is all a regex was ever
 * honestly able to do.
 */
export async function discover(input: {
  founderId: string; mandateId: string; world: 'real' | 'reference';
}): Promise<DiscoveryResult> {
  const brief = await briefFor(input);
  const passedOver: Array<{ what: string; because: string }> = [];
  const empty = { looked: 0, signals: 0, read: 0, sown: [] };
  if (!brief) return { brief: null, ...empty, passedOver };

  const { waysOfLooking } = await import('./research-sources.js');
  const ways = await waysOfLooking(input.founderId, input.world);
  if (!ways.some((w) => w.sourceType === 'community')) {
    passedOver.push({ what: 'the whole search',
      because: 'nothing I can look through tells me what people say to each other, '
        + 'and a signal is something somebody wrote' });
    return { brief, ...empty, passedOver };
  }

  const already = await openSeeds(input.founderId, 200);
  const sown: Sown[] = [];
  let looked = 0;
  let signals = 0;
  let read = 0;

  for (const terms of brief.terms) {
    if (sown.length >= MOST_SEEDS_PER_PASS || read >= MOST_READINGS_PER_PASS) break;
    const talk = await whatPeopleSaid(terms, 10);
    looked += talk.found.length;

    for (const said of talk.found) {
      if (sown.length >= MOST_SEEDS_PER_PASS) break;
      if (read >= MOST_READINGS_PER_PASS) {
        passedOver.push({ what: 'the rest of this pass',
          because: `${String(MOST_READINGS_PER_PASS)} sentences is as much as one pass `
            + 'pays to read' });
        break;
      }
      const signal = readSignal(said.text);
      if (signal === null) continue;
      signals += 1;
      // A MARKER WITH NO SENTENCE AROUND IT IS NOT WORTH READING. A fragment
      // too short to say what it is about is a real match and an unusable one.
      if (signal.clause === null) {
        passedOver.push({ what: said.text.slice(0, 60),
          because: 'the phrase matched but the sentence around it says too little '
            + 'to investigate' });
        continue;
      }
      // THE GRAVEYARD SHAPES DISCOVERY, and it shapes it BEFORE the money is
      // spent. A thesis already killed, in a world that has not changed, is not
      // paid to be reread.
      const buried = await alreadyBuried(input.founderId, said.text);
      if (buried) { passedOver.push(buried); continue; }

      // AND A SENTENCE ALREADY LOOKED AT AND FOUND EMPTY IS NOT PAID FOR TWICE.
      // The reason a reading was declined is worth keeping only if something
      // reads it, and this is what reads it.
      const setAside = await alreadySetAside(input.founderId, said.text);
      if (setAside !== null) {
        passedOver.push({ what: signal.clause,
          because: `I set something like this aside before (${setAside.shares.join(', ')}): `
            + setAside.because });
        continue;
      }

      // THE OBSERVATION FIRST, and it claims nothing more than that somebody
      // wrote it. The old version filed "people describe manual workaround:
      // ..." as the claim, which was Foundry's reading of the sentence wearing
      // the sentence's authority. What a person wrote is a fact. What it means
      // is not, and it now lives somewhere else.
      const wroteId = await formClaim({
        founderId: input.founderId,
        evidenceMode: input.world === 'reference' ? 'reference' : 'real',
        claim: `somebody wrote: "${signal.clause}"`,
      });
      const observationId = await observe({
        founderId: input.founderId, claimId: wroteId, sourceType: 'community',
        source: said.url, saw: said.text.slice(0, 500), bearing: 'supports',
        directness: 'direct', observedAt: new Date(said.saidAt ?? talk.observedAt),
        evidenceMode: input.world === 'reference' ? 'reference' : 'real',
      });

      // THEN THE READING, which is Foundry's and is stored as Foundry's.
      read += 1;
      const understanding = await interpret({
        founderId: input.founderId, observationId, lookingFor: brief.lookingFor,
        heldTo: brief.heldTo, world: input.world,
      });
      if ('refused' in understanding) {
        passedOver.push({ what: signal.clause, because: understanding.refused });
        continue;
      }
      // THE ABSTENTION IS THE COMMON CASE AND THE DESIRABLE ONE. Most things
      // people write are not opportunities, and a reader that finds a business
      // in all of them has told you nothing about any of them.
      if (abstained(understanding)) {
        passedOver.push({ what: signal.clause, because: understanding.abstained });
        continue;
      }
      if (understanding.hypothesis === null || understanding.hypothesisKind === null) {
        passedOver.push({ what: signal.clause,
          because: 'read it, but could not say what an opportunity here would even '
            + 'assert — and a hypothesis nothing can contradict is not one' });
        continue;
      }

      // THE SEED IS THE HYPOTHESIS, IN FOUNDRY'S OWN WORDS. The exact sentence
      // stays beneath it, in origin_said and in the observation, so nothing
      // downstream mistakes the one for the other.
      // ALREADY BEING LOOKED INTO. Checked before sowing rather than after —
      // the earlier arrangement noted the duplicate and then sowed it anyway.
      if (already.some((s) => s.seed === understanding.hypothesis)
        || sown.some((s) => s.seed === understanding.hypothesis)) {
        passedOver.push({ what: understanding.hypothesis,
          because: 'already being looked into' });
        continue;
      }
      const sownOrDead = await sow({
        founderId: input.founderId, mandateId: input.mandateId,
        seed: understanding.hypothesis,
        origin: 'signal', originSaid: said.text.slice(0, 300),
        originObservationId: observationId,
        evidenceMode: input.world === 'reference' ? 'reference' : 'real',
      });
      if (typeof sownOrDead !== 'string') {
        passedOver.push({ what: understanding.hypothesis,
          because: sownOrDead.alreadyBuried.because });
        continue;
      }
      const seedId = sownOrDead;

      // Whether anything Foundry can look through could settle this at all.
      const settle = await whoCouldSettle(understanding.hypothesisKind);
      const nextQuestion = understanding.nextQuestion
        ?? 'does anybody already sell something for this, and is anybody maintaining it';
      await query(
        `UPDATE opportunity_seeds
            SET brief_id = ?, signal_kind = ?, inference = ?, next_question = ?,
                answerable_by = ?, interpretation_id = ?, hypothesis_kind = ?
          WHERE id = ?`,
        [brief.id, signal.kind, understanding.reading, nextQuestion,
          settle.canReach.length > 0 ? 'read' : 'test', understanding.id,
          understanding.hypothesisKind, seedId]);
      await query('UPDATE market_claims SET seed_id = ? WHERE id = ?', [seedId, wroteId]);

      // AND THE CLAIM THE HYPOTHESIS MAKES, which is a different claim from
      // "somebody wrote this" and is the one later sources bear on. Without it
      // a second way of knowing would have nothing to attach to.
      await formClaim({
        founderId: input.founderId, seedId,
        evidenceMode: input.world === 'reference' ? 'reference' : 'real',
        claim: understanding.hypothesis,
      });

      const asserts = (await query(
        'SELECT asserts FROM hypothesis_kinds WHERE kind = ?',
        [understanding.hypothesisKind])).rows[0] as Record<string, unknown> | undefined;
      sown.push({ seedId, seed: understanding.hypothesis,
        asserts: asserts === undefined ? null : String(asserts.asserts),
        signalKind: signal.kind, reading: understanding.reading, nextQuestion });
    }
  }
  return { brief, looked, signals, read, sown, passedOver };
}

/**
 * HAS THIS BEEN KILLED BEFORE, IN A WORLD THAT HAS NOT CHANGED?
 *
 * More than exact-name matching: a buried seed and a rejected candidate both
 * count, and what is compared is the words of the thing rather than its label.
 * The graveyard is not dogma - a burial that named what would reopen it says so,
 * and the pass reports that rather than silently refusing forever.
 */
async function alreadyBuried(founderId: string, text: string): Promise<{
  what: string; because: string;
} | null> {
  const { seenBefore } = await import('./mandate.js');
  const candidate = await seenBefore(founderId, text);
  if (candidate) {
    return {
      what: text.slice(0, 60),
      because: candidate.revisitIf === null
        ? `already rejected: ${candidate.why}`
        : `already rejected: ${candidate.why}. Worth another look only if `
          + `${candidate.revisitIf}, and nothing says that has happened`,
    };
  }

  const words = new Set(text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 4));
  for (const row of (await query(
    `SELECT seed, buried_because FROM opportunity_seeds
      WHERE founder_id = ? AND buried_at IS NOT NULL ORDER BY buried_at DESC LIMIT 100`,
    [founderId])).rows as unknown as Array<Record<string, unknown>>) {
    const theirs = new Set(String(row.seed).toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/).filter((w) => w.length > 4));
    const shared = [...words].filter((w) => theirs.has(w));
    if (shared.length >= 3) {
      return {
        what: text.slice(0, 60),
        because: `a seed sharing ${shared.join(', ')} was buried: ${String(row.buried_because)}`,
      };
    }
  }
  return null;
}

export interface WeedResult {
  asked: number;
  buried: Array<{ seed: string; because: string }>;
  survived: Array<{ seed: string; nowKnows: string }>;
  /** Asked, and the answer turned out to be incapable of settling it. This
   * used to be a burial, which was the defect. */
  saidNothing: Array<{ seed: string; because: string; wouldNeed: string[] }>;
}

/**
 * ASK EACH SEED'S OWN QUESTION, AND BURY WHAT THE EVIDENCE ACTUALLY CONTRADICTS.
 *
 * The ruthless half, and the one that makes a permissive frontier defensible —
 * but ruthless is not the same as mechanical, and the first version of this was
 * mechanical. It asked a package registry about a seed sown from what somebody
 * said, and buried the seed whenever the registry came back with nothing
 * relevant: SOURCE TWO EMPTY, THEREFORE BURY.
 *
 * That is wrong twice over. A registry knows what already exists and knows
 * nothing whatever about whether the work hurts, so its silence cannot falsify
 * a claim about pain. And where the hypothesis is that a GAP exists, a registry
 * finding nothing maintained is evidence FOR the hypothesis. The old rule
 * buried its own best findings.
 *
 * So each seed is asked against a way of knowing that is CAPABLE of bearing on
 * what it asserts, the result is looked up rather than assumed, and a seed dies
 * only on genuine contradiction. Everything else either narrows the thesis or
 * says nothing, and saying nothing is recorded as saying nothing.
 */
export async function weedOut(input: {
  founderId: string; world: 'real' | 'reference'; most?: number;
}): Promise<WeedResult> {
  const { askWhatAlreadyExists } = await import('./sources/index.js');
  const { bury } = await import('./seeds.js');
  const buried: WeedResult['buried'] = [];
  const survived: WeedResult['survived'] = [];
  const saidNothing: WeedResult['saidNothing'] = [];
  let asked = 0;

  // The claim the HYPOTHESIS makes is the one a second source bears on, so it
  // is the one joined here. A seed whose only claim is "somebody wrote this"
  // predates comprehension and has nothing for a substitute source to contradict.
  const open = ((await query(
    `SELECT s.id, s.seed, s.hypothesis_kind, s.next_question
       FROM opportunity_seeds s
      WHERE s.founder_id = ? AND s.promoted_to IS NULL AND s.buried_at IS NULL
        AND s.answerable_by = 'read' AND s.evidence_mode = ?
      ORDER BY s.sown_at, s.rowid LIMIT ?`,
    [input.founderId, input.world, input.most ?? 6]))
    .rows as unknown as Array<Record<string, unknown>>);

  for (const row of open) {
    const seedId = String(row.id);
    const seed = String(row.seed);
    const about = row.hypothesis_kind == null ? null : String(row.hypothesis_kind);

    // A SEED FOUNDRY COULD NOT READ IS A FOUNDRY PROBLEM, NOT A MARKET VERDICT.
    // It still dies — an unfalsifiable seed clutters a frontier that is supposed
    // to stay small — but it dies with the honest reason, which is that nothing
    // could ever contradict it rather than that the world disagreed.
    if (about === null) {
      await bury({ seedId,
        because: 'I could not say what this asserts, so no evidence could ever '
          + 'contradict it. That is my failure to read it, not the world\'s answer.' });
      buried.push({ seed, because: 'nothing could ever have contradicted it' });
      continue;
    }

    // WHICH WAY OF KNOWING IS CAPABLE OF SETTLING THIS, AND CAN FOUNDRY REACH IT?
    const settle = await whoCouldSettle(about);
    if (settle.canReach.length === 0) {
      saidNothing.push({ seed,
        because: 'nothing I can currently look through can bear on what this asserts',
        wouldNeed: settle.outOfReach.map((s) => s.whatItSays) });
      continue;
    }

    // The words worth searching are the ones the reading used, minus the ones
    // every complaint contains.
    const words = seed.toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/).filter((w) => w.length > 4 && !NOT_WORTH_SEARCHING.has(w))
      .slice(0, 4).join(' ');
    if (words.length === 0) {
      saidNothing.push({ seed,
        because: 'nothing in the hypothesis is specific enough to look up',
        wouldNeed: [] });
      continue;
    }

    // A SOURCE IS ASKED THE QUESTION IT CAN ANSWER, not the seed's question.
    //
    // This was the other half of the defect. A substitute source was handed the
    // seed's own claim — which might be about whether work hurts — and its
    // answer was filed as bearing on that. So the question a registry CAN
    // answer is given its own claim, and the registry's finding lands there.
    // The seed's own assertion is then judged by what that finding is capable
    // of bearing on, which is frequently nothing, and nothing is a real answer.
    const gapClaim = `nothing maintained already does this: ${seed}`;
    const existing = (await query(
      'SELECT id FROM market_claims WHERE seed_id = ? AND claim = ? LIMIT 1',
      [seedId, gapClaim])).rows[0] as Record<string, unknown> | undefined;
    const gapClaimId = existing === undefined
      ? await formClaim({
        founderId: input.founderId, seedId,
        evidenceMode: input.world === 'reference' ? 'reference' : 'real',
        claim: gapClaim,
      })
      : String(existing.id);
    asked += 1;
    const found = await askWhatAlreadyExists({
      founderId: input.founderId, claimId: gapClaimId, query: words,
      supportsIf: 'nothing_maintained_exists' });
    const came: 'found' | 'empty' = found.relevant === 0 ? 'empty' : 'found';

    // Two questions, and keeping them apart is the whole fix: what this result
    // does to the question it was ASKED, and what it does to what the seed
    // ASSERTS.
    const toTheQuestion = await whatItBears({
      stance: 'substitute', about: 'gap_exists', found: came });
    const toTheSeed = await whatItBears({ stance: 'substitute', about, found: came });
    await recordQuestioning({
      founderId: input.founderId, seedId, stance: 'substitute',
      asked: `whether anything maintained already does it, searching "${words}"`,
      found: came, bears: toTheSeed, world: input.world });

    if (toTheSeed.bearing === 'contradicts') {
      await bury({ seedId,
        because: `asked what already exists for "${words}": ${toTheSeed.because}. `
          + found.sentence });
      buried.push({ seed, because: toTheSeed.because });
      continue;
    }
    if (toTheSeed.bearing === 'says_nothing') {
      // ALIVE, AND SAYING WHY — including what the source DID establish. The
      // owner's example: pain exists, no substitute found, which does not make
      // the pain false and may strengthen a gap thesis.
      saidNothing.push({ seed,
        because: `${toTheSeed.because} It did establish something else: `
          + `${toTheQuestion.because}. ${found.sentence}`,
        wouldNeed: settle.outOfReach.map((s) => s.whatItSays) });
      continue;
    }
    survived.push({ seed,
      nowKnows: `${toTheSeed.bearing === 'supports' ? 'supported' : 'narrowed'}: `
        + `${toTheSeed.because}. ${found.sentence}` });
  }
  return { asked, buried, survived, saidNothing };
}

/** Words that every complaint contains and no search should be built from. */
const NOT_WORTH_SEARCHING = new Set(['manual', 'manually', 'workaround', 'recurring',
  'thing', 'things', 'about', 'would', 'could', 'because', 'anything', 'something',
  'someone', 'people', 'really', 'doing', 'every', 'their', 'there', 'which',
  'where', 'while', 'been', 'being', 'still', 'other', 'these', 'those', 'might',
  'reduce', 'lightweight', 'product', 'service', 'tool', 'small', 'simple']);

export interface Promoted {
  seedId: string; opportunityId: string; headline: string;
}

export interface PromotionPass {
  /** Seeds that earned candidate status on independent ways of knowing. */
  promoted: Promoted[];
  /** And the refusals, which are the useful half. */
  refused: Array<{ seed: string; because: string }>;
}

/**
 * PROMOTE WHAT HAS ACTUALLY EARNED IT, AND REFUSE THE REST OUT LOUD.
 *
 * The gate is `whatItWouldTakeToBelieve`, which counts INDEPENDENT EPISTEMIC
 * STANCES rather than sources: fifteen readings of one registry are one way of
 * knowing, and a candidate that exists because Foundry told a plausible story
 * about one source is the exact failure this apparatus is built to prevent.
 *
 * NOTHING HERE IS INVENTED. The candidate is assembled from the reading that
 * already exists — its hypothesis, its segment guess, what would show Foundry
 * misread it, the ambiguity it named — because a promotion that writes fresh
 * prose about a market is a promotion that has stopped being about the
 * evidence. In particular the KILL THESIS is `misread_if`, written before any
 * of this evidence arrived.
 */
export async function promoteWhatEarnedIt(input: {
  founderId: string; world: 'real' | 'reference'; most?: number;
}): Promise<PromotionPass> {
  const { whatItWouldTakeToBelieve, promote } = await import('./seeds.js');
  const promoted: Promoted[] = [];
  const refused: Array<{ seed: string; because: string }> = [];

  const open = ((await query(
    `SELECT s.id, s.seed, i.reading, i.hypothesis, i.who_it_may_be, i.misread_if,
            i.ambiguity, i.or_it_could_be
       FROM opportunity_seeds s
       JOIN observation_interpretations i ON i.id = s.interpretation_id
      WHERE s.founder_id = ? AND s.promoted_to IS NULL AND s.buried_at IS NULL
        AND s.evidence_mode = ? AND i.hypothesis IS NOT NULL
      ORDER BY s.sown_at, s.rowid LIMIT ?`,
    [input.founderId, input.world, input.most ?? 6]))
    .rows as unknown as Array<Record<string, unknown>>);

  for (const row of open) {
    const seedId = String(row.id);
    const believe = await whatItWouldTakeToBelieve(seedId);
    if (!believe.enough) {
      refused.push({ seed: String(row.seed), because: believe.sentence });
      continue;
    }
    const sources = ((await query(
      `SELECT DISTINCT o.source FROM market_observations o
         JOIN market_claims c ON c.id = o.claim_id
        WHERE c.seed_id = ? AND o.evidence_mode <> 'reference' LIMIT 8`, [seedId]))
      .rows as unknown as Array<Record<string, unknown>>).map((r) => String(r.source));

    const unknowns = [
      row.ambiguity == null ? null : `unclear from the source: ${String(row.ambiguity)}`,
      row.or_it_could_be == null
        ? null : `it could instead mean: ${String(row.or_it_could_be)}`,
      // The thing no amount of reading settles, named as unsettled rather than
      // quietly assumed by a candidate that reads confident.
      'whether anybody would pay for it, which nothing read so far can answer',
    ].filter((u): u is string => u !== null);

    const result = await promote({
      seedId,
      headline: String(row.hypothesis).slice(0, 200),
      whoHasIt: row.who_it_may_be == null
        ? 'not established — the reading did not name whose problem this is'
        : String(row.who_it_may_be),
      theProblem: String(row.reading),
      whyItMight: `${believe.have.length} genuinely different ways of knowing have `
        + `said something: ${believe.have.map((h) => h.whatItSays).join('; ')}`,
      killThesis: String(row.misread_if),
      unknowns,
      sources,
    });
    if ('refused' in result) {
      refused.push({ seed: String(row.seed), because: result.refused });
      continue;
    }
    promoted.push({ seedId, opportunityId: result.opportunityId,
      headline: String(row.hypothesis).slice(0, 200) });
  }
  return { promoted, refused };
}
