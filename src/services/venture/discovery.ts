// =============================================================================
// FOUNDRY - discovery that starts from a need, not from an idea
//
// The failure this is designed against is not laziness. It is a model
// generating plausible startup ideas and then searching for things that sound
// supportive, which produces sourced, dated, confident nonsense - the exact
// shape of every defect this institution has found in itself so far.
//
// So: the search starts from what the PORTFOLIO NEEDS, looks for economic
// signals in what people actually wrote, and keeps the two halves apart. The
// observation is evidence. The signal kind is Foundry's reading of it, stored
// as inference and labelled as inference.
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

export interface Brief {
  id: string; lookingFor: string; heldTo: string | null;
  shapeNamed: string | null; terms: string[];
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
  const terms = termsFrom(needs.map((n) => n.value), mandate.shape);

  const id = nanoid();
  await query(
    `INSERT INTO search_briefs
       (id, founder_id, mandate_id, looking_for, held_to, shape_named, terms_tried, evidence_mode)
     VALUES (?,?,?,?,?,?,?,?)`,
    [id, input.founderId, input.mandateId, lookingFor, heldTo, mandate.shape,
      terms.join(' | '), input.world]);
  return { id, lookingFor, heldTo, shapeNamed: mandate.shape, terms };
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
function termsFrom(concentratedOn: string[], shape: string | null): string[] {
  const base = [
    'doing this manually every',
    'wrote a script to keep track',
    'no tool does this',
    'keep a spreadsheet for',
    'have to check every week',
  ];
  // The shape is used only where the owner named one, and only to narrow.
  return shape === null ? base : base.map((t) => `${t} ${shape.replace(/_/g, ' ')}`);
}

/**
 * READING A SIGNAL OUT OF SOMETHING SOMEBODY WROTE.
 *
 * Markers, not meaning. Each phrase is the way a person writes when they are
 * describing the thing - "I ended up writing", "every single time", "there is
 * nothing that". It is blunt, it will miss plenty, and everything it returns
 * points at a real sentence somebody typed, which is the property that matters.
 *
 * This is INFERENCE. The observation is evidence; that it reads like a manual
 * workaround is Foundry's reading, and the two are stored separately for that
 * reason.
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
 * Two attempts failed before this one, and both failures are worth keeping.
 * Naming the seed after the SEARCH TERM produced four ways of writing down what
 * Foundry typed. Extracting a subject by taking content words near the marker
 * produced word salad — "manual workaround: manually good idea execution" —
 * because picking nearby nouns is not comprehension, and a paraphrase that
 * cannot parse is worse than no paraphrase.
 *
 * So the seed quotes. The clause somebody wrote is its substance, the signal
 * kind is Foundry's reading of it, and nothing in between is invented. A real
 * hypothesis in Foundry's own words is allowed and will come — from a model
 * that can actually read the sentence — but until then a quote is the honest
 * form, and it loses nothing: the next question acts on the quote perfectly
 * well.
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
  seedId: string; seed: string; signalKind: string; nextQuestion: string;
}

export interface DiscoveryResult {
  brief: Brief | null;
  looked: number;
  signals: number;
  sown: Sown[];
  /** Seeds not sown, with the reason — most of discovery is this. */
  passedOver: Array<{ what: string; because: string }>;
}

/** At most this many seeds per pass. The frontier is not a volume target. */
const MOST_SEEDS_PER_PASS = 4;

/**
 * ONE PASS OF DISCOVERY.
 *
 * Look through what the institution actually has, read signals out of what
 * people wrote, consult the graveyard, and sow a small number of seeds - each
 * pointing at the sentence that made anybody curious, each carrying the next
 * question that would settle whether it is nonsense.
 */
export async function discover(input: {
  founderId: string; mandateId: string; world: 'real' | 'reference';
}): Promise<DiscoveryResult> {
  const brief = await briefFor(input);
  const passedOver: Array<{ what: string; because: string }> = [];
  if (!brief) return { brief: null, looked: 0, signals: 0, sown: [], passedOver };

  const { waysOfLooking } = await import('./research-sources.js');
  const ways = await waysOfLooking(input.founderId, input.world);
  if (!ways.some((w) => w.sourceType === 'community')) {
    passedOver.push({ what: 'the whole search',
      because: 'nothing I can look through tells me what people say to each other, '
        + 'and a signal is something somebody wrote' });
    return { brief, looked: 0, signals: 0, sown: [], passedOver };
  }

  const already = await openSeeds(input.founderId, 200);
  const sown: Sown[] = [];
  let looked = 0;
  let signals = 0;

  for (const terms of brief.terms) {
    if (sown.length >= MOST_SEEDS_PER_PASS) break;
    const talk = await whatPeopleSaid(terms, 10);
    looked += talk.found.length;

    for (const said of talk.found) {
      if (sown.length >= MOST_SEEDS_PER_PASS) break;
      const signal = readSignal(said.text);
      if (signal === null) continue;
      signals += 1;
      // A MARKER WITH NO SENTENCE AROUND IT IS NOT A SEED. A fragment too
      // short to say what it is about is a real match and an unusable one,
      // and sowing it would be sowing the search term.
      if (signal.clause === null) {
        passedOver.push({ what: said.text.slice(0, 60),
          because: 'the phrase matched but the sentence around it says too little '
            + 'to investigate' });
        continue;
      }

      const seedText = `${signal.kind.replace(/_/g, ' ')}: "${signal.clause}"`;
      // THE GRAVEYARD SHAPES DISCOVERY. A thesis already killed, in a world
      // that has not changed, is not relearned.
      const buried = await alreadyBuried(input.founderId, said.text);
      if (buried) { passedOver.push(buried); continue; }
      if (already.some((s) => s.seed === seedText)
        || sown.some((s) => s.seed === seedText)) {
        continue;
      }

      // The observation first: what somebody actually wrote, filed as evidence.
      const claimId = await formClaim({
        founderId: input.founderId, evidenceMode: input.world === 'reference' ? 'reference' : 'real',
        claim: `people describe ${signal.kind.replace(/_/g, ' ')}: "${signal.clause}"`,
      });
      const observationId = await observe({
        founderId: input.founderId, claimId, sourceType: 'community',
        source: said.url, saw: said.text.slice(0, 500), bearing: 'supports',
        directness: 'direct', observedAt: new Date(said.saidAt ?? talk.observedAt),
        evidenceMode: input.world === 'reference' ? 'reference' : 'real',
      });

      // Then the seed, whose ORIGIN is that observation and whose INFERENCE is
      // Foundry's reading of it. Two different things, stored as two things.
      const nextQuestion = 'does anybody already sell something for this, and is '
        + 'anybody maintaining it';
      const sownOrDead = await sow({
        founderId: input.founderId, mandateId: input.mandateId, seed: seedText,
        origin: 'signal', originSaid: said.text.slice(0, 300),
        originObservationId: observationId,
        evidenceMode: input.world === 'reference' ? 'reference' : 'real',
      });
      // The graveyard refuses at the door as well as here. Two checks rather
      // than one because they catch different things: this pass compares what
      // a person WROTE against rejected candidates, and `sow` compares the
      // seed's own words against buried seeds.
      if (typeof sownOrDead !== 'string') {
        passedOver.push({ what: seedText, because: sownOrDead.alreadyBuried.because });
        continue;
      }
      const seedId = sownOrDead;
      await query(
        `UPDATE opportunity_seeds
            SET brief_id = ?, signal_kind = ?, inference = ?, next_question = ?,
                answerable_by = 'read'
          WHERE id = ?`,
        [brief.id, signal.kind, signal.because, nextQuestion, seedId]);
      await query('UPDATE market_claims SET seed_id = ? WHERE id = ?', [seedId, claimId]);
      sown.push({ seedId, seed: seedText, signalKind: signal.kind, nextQuestion });
    }
  }
  return { brief, looked, signals, sown, passedOver };
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
}

/**
 * ASK EACH SEED'S OWN QUESTION, AND BURY WHAT THE WORLD IGNORES.
 *
 * The ruthless half, and the one that makes discovery worth having. A permissive
 * frontier is only defensible if most of it dies quickly and cheaply — and it
 * has to die of EVIDENCE rather than of taste, or the institution is just
 * pruning ideas it happens not to like.
 *
 * So every open seed gets its next question asked against a genuinely different
 * way of knowing than the one that sowed it. A seed sown from what somebody said
 * is tested against what already exists. If that second look returns nothing
 * about the subject at all, the seed is buried for the honest reason: it was
 * investigated and the world had nothing to say.
 *
 * WHAT SURVIVES IS NOT BELIEVED. It has two ways of knowing and is therefore
 * eligible to be looked at further — the independent-stance rule at promotion
 * is a separate and stricter gate.
 */
export async function weedOut(input: {
  founderId: string; world: 'real' | 'reference'; most?: number;
}): Promise<WeedResult> {
  const { askWhatAlreadyExists } = await import('./sources/index.js');
  const { bury } = await import('./seeds.js');
  const buried: WeedResult['buried'] = [];
  const survived: WeedResult['survived'] = [];
  let asked = 0;

  const open = ((await query(
    `SELECT s.id, s.seed, s.next_question, c.id AS claim_id
       FROM opportunity_seeds s
       LEFT JOIN market_claims c ON c.seed_id = s.id
      WHERE s.founder_id = ? AND s.promoted_to IS NULL AND s.buried_at IS NULL
        AND s.answerable_by = 'read' AND s.evidence_mode = ?
      ORDER BY s.sown_at, s.rowid LIMIT ?`,
    [input.founderId, input.world, input.most ?? 6]))
    .rows as unknown as Array<Record<string, unknown>>);

  for (const row of open) {
    if (row.claim_id == null) continue;
    // The words worth searching are the ones the person used, minus the ones
    // everybody uses.
    const words = String(row.seed).toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/).filter((w) => w.length > 4 && !NOT_WORTH_SEARCHING.has(w))
      .slice(0, 4).join(' ');
    if (words.length === 0) {
      await bury({ seedId: String(row.id),
        because: 'nothing in what they wrote is specific enough to look up' });
      buried.push({ seed: String(row.seed),
        because: 'nothing specific enough to look up' });
      continue;
    }
    asked += 1;
    const found = await askWhatAlreadyExists({
      founderId: input.founderId, claimId: String(row.claim_id), query: words,
      supportsIf: 'nothing_maintained_exists' });

    if (found.relevant === 0) {
      await bury({ seedId: String(row.id),
        because: `asked what already exists for "${words}" and nothing that came back `
          + 'was even about it — investigated, and the world had nothing to say' });
      buried.push({ seed: String(row.seed), because: 'the world had nothing to say' });
      continue;
    }
    survived.push({ seed: String(row.seed), nowKnows: found.sentence });
  }
  return { asked, buried, survived };
}

/** Words that every complaint contains and no search should be built from. */
const NOT_WORTH_SEARCHING = new Set(['manual', 'manually', 'workaround', 'recurring',
  'thing', 'things', 'about', 'would', 'could', 'because', 'anything', 'something',
  'someone', 'people', 'really', 'doing', 'every', 'their', 'there', 'which',
  'where', 'while', 'been', 'being', 'still', 'other', 'these', 'those']);
