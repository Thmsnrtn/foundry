// =============================================================================
// FOUNDRY - six income streams, or one with six failure points in common
//
// "If this succeeds, does the portfolio actually get stronger?" and "what single
// failure could damage several of these at once?"
//
// NO SCORE, AND THAT IS THE DESIGN. The owner was explicit: not mathematical
// theatre, not false precision. A weighted risk number would be more impressive
// and completely unarguable, which is the wrong trade for a decision that is
// his. So concentration is arithmetic he can check - how many things carry the
// same exposure, named - and the sentence says which ones.
//
// AND WHICH WORLD IT IS COUNTING IS ALWAYS EXPLICIT. A reference company's
// dependence on a provider must never appear in a real concentration, or the
// institution would tell him to diversify away from something no business of
// his uses. So `world` is a parameter that defaults to 'real': a surface that
// forgets to think about it gets the safe answer, and the rehearsal world has
// to ask for itself by name.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

export interface Concentration {
  dimension: string;
  value: string;
  /** The companies that carry it, by name. */
  carriedBy: string[];
  /** What he would lose if it went wrong, from the constitutional vocabulary. */
  ifItFails: string;
  /**
   * True when at least one of the companies carrying this was never told to
   * Foundry - it was worked out.
   *
   * Migration 235 stores how each exposure is known, and this is what that is
   * for. A concentration assembled partly from guesses, shown next to one he
   * stated himself, would make an inference into a fact by rendering it the
   * same way - and the decision it feeds is whether to start a business.
   */
  guessed: boolean;
}

/**
 * WHAT A SINGLE FAILURE COULD TAKE OUT.
 *
 * Only exposures shared by more than one thing: a dependency nothing else has
 * is a risk, not a concentration, and listing it here would bury the ones that
 * matter under everything the portfolio happens to touch.
 */
export type World = 'real' | 'reference';

export async function concentrationsFor(
  founderId: string, world: World = 'real',
): Promise<Concentration[]> {
  const rows = (await query(
    `SELECT e.dimension, e.value, e.how_known, d.if_it_fails, p.name
       FROM portfolio_exposures e
       JOIN exposure_dimensions d ON d.dimension = e.dimension
       JOIN products p ON p.id = e.subject_id
      WHERE e.founder_id = ? AND e.retired_at IS NULL
        AND e.subject_kind = 'company' AND e.evidence_mode = ?
        AND p.reality = ?
        AND p.status = 'active' AND p.deleted_at IS NULL
      ORDER BY d.sort_order, e.value`, [founderId, world, world]))
    .rows as unknown as Array<Record<string, unknown>>;

  const grouped = new Map<string, Concentration>();
  for (const row of rows) {
    const key = `${String(row.dimension)} ${String(row.value)}`;
    const found = grouped.get(key) ?? {
      dimension: String(row.dimension), value: String(row.value),
      carriedBy: [], ifItFails: String(row.if_it_fails), guessed: false,
    };
    found.carriedBy.push(String(row.name));
    if (String(row.how_known) === 'inferred') found.guessed = true;
    grouped.set(key, found);
  }
  return [...grouped.values()]
    .filter((c) => c.carriedBy.length > 1)
    .sort((a, b) => b.carriedBy.length - a.carriedBy.length);
}

export interface PortfolioNeed {
  dimension: string; value: string;
  /** The sentence, in the owner's own shape: "less dependence on google search". */
  need: string;
  carriedBy: number;
}

/**
 * WHAT THE PORTFOLIO NEEDS, derived rather than declared.
 *
 * The venture studio begins from portfolio need, not from ideas. A need here
 * is the mirror of a concentration: three businesses on one channel is a need
 * for something reached another way. Nothing is invented - if nothing is
 * concentrated, the portfolio needs nothing in particular, and the search is
 * told so rather than handed a list to look busy against.
 */
export async function portfolioNeeds(
  founderId: string, world: World = 'real',
): Promise<PortfolioNeed[]> {
  const shared = await concentrationsFor(founderId, world);
  return shared.map((con) => ({
    dimension: con.dimension, value: con.value, carriedBy: con.carriedBy.length,
    need: con.dimension === 'owner_attention' || con.dimension === 'support_burden'
      ? `something that does not add to ${con.value}`
      : `something not depending on ${con.value}`,
  }));
}

export interface PortfolioFit {
  /** The stated needs this would serve: an axis where it differs from a concentration. */
  serves: string[];
  /** What adding this would deepen. */
  deepens: Concentration[];
  /** Exposures nothing else in the portfolio has. */
  newGround: Array<{ dimension: string; value: string }>;
  /** The one sentence. */
  verdict: string;
  /** True when Foundry would not advance it on portfolio grounds alone. */
  makesItWorse: boolean;
}

/**
 * WHAT ADDING THIS WOULD DO.
 *
 * The owner's example, made mechanical: another conventional SaaS reached
 * through the same channel, billed through the same rails, sold to the same
 * segment, is not a seventh income stream. It is a seventh reason the same
 * failure hurts.
 *
 * `newGround` is the other half and it is not a bonus - an opportunity whose
 * every exposure is already carried twice over is one the portfolio does not
 * need, however good the business is.
 */
export async function portfolioFitOf(input: {
  founderId: string; opportunityId: string; world?: World;
}): Promise<PortfolioFit> {
  const world = input.world ?? 'real';
  const mine = await concentrationsFor(input.founderId, world);
  const carried = new Map<string, Array<{ name: string; guessed: boolean }>>();
  for (const row of (await query(
    `SELECT e.dimension, e.value, e.how_known, p.name FROM portfolio_exposures e
       JOIN products p ON p.id = e.subject_id
      WHERE e.founder_id = ? AND e.retired_at IS NULL
        AND e.subject_kind = 'company' AND e.evidence_mode = ?
        AND p.reality = ?
        AND p.status = 'active' AND p.deleted_at IS NULL`,
    [input.founderId, world, world]))
    .rows as unknown as Array<Record<string, unknown>>) {
    const key = `${String(row.dimension)} ${String(row.value)}`;
    carried.set(key, [...(carried.get(key) ?? []),
      { name: String(row.name), guessed: String(row.how_known) === 'inferred' }]);
  }

  const its = (await query(
    `SELECT e.dimension, e.value, d.if_it_fails FROM portfolio_exposures e
       JOIN exposure_dimensions d ON d.dimension = e.dimension
      WHERE e.subject_kind = 'opportunity' AND e.subject_id = ? AND e.retired_at IS NULL
      ORDER BY d.sort_order`, [input.opportunityId]))
    .rows as unknown as Array<Record<string, unknown>>;

  const deepens: Concentration[] = [];
  const newGround: Array<{ dimension: string; value: string }> = [];
  for (const row of its) {
    const dimension = String(row.dimension);
    const value = String(row.value);
    const already = carried.get(`${dimension} ${value}`) ?? [];
    // A NEW KIND OF LIABILITY IS NEVER A CASE FOR A CANDIDATE. Every other axis
    // is symmetric - differing from the portfolio is what makes something a
    // separate income stream. Legal exposure is not: a candidate that carries
    // a kind of liability nothing else does has not diversified anything, it
    // has added a way to be sued. It counts when it deepens, never as ground.
    if (dimension === 'legal_exposure' && already.length === 0) continue;
    if (already.length > 0) {
      deepens.push({
        dimension, value, carriedBy: already.map((c) => c.name),
        ifItFails: String(row.if_it_fails),
        guessed: already.some((c) => c.guessed),
      });
    } else {
      newGround.push({ dimension, value });
    }
  }

  // WORSE IS A JUDGEMENT WITH A STATED RULE, not a threshold pretending to be
  // one: everything about how this would earn is something the portfolio
  // already carries, so it adds no independence at all.
  //
  // AN EARLIER VERSION ALSO REQUIRED THE EXPOSURE TO BE SHARED BY TWO OR MORE
  // ALREADY, and the assembled-institution walk caught it: against a portfolio
  // of one company, a candidate identical to it in every respect came back as
  // no cause for concern. That is exactly the moment to say something — the
  // second business is where a concentration starts, and an institution that
  // only warns once the pattern is established would have watched it form.
  const makesItWorse = its.length > 0 && newGround.length === 0;

  // SERVING A NEED is having a different answer on an axis where the portfolio
  // is concentrated - not merely being new, but being new where it matters.
  const needs = await portfolioNeeds(input.founderId, world);
  const serves = needs
    .filter((n) => n.dimension !== 'legal_exposure')
    .filter((n) => its.some((row) => String(row.dimension) === n.dimension
      && String(row.value) !== n.value))
    .map((n) => n.need);

  const verdict = its.length === 0
    ? 'I do not know enough about how this would make money to say what it would '
      + 'do to your portfolio.'
    : makesItWorse
      ? `This would deepen ${deepens.map((d) => d.value).join(', ')} - which `
        + `${deepens.some((d) => d.carriedBy.length > 1)
          ? 'you already depend on across more than one business'
          : 'you already carry'} - and brings nothing new. Another one of these is `
        + 'not another income stream; it is another way the same failure hurts.'
      : newGround.length > 0 && deepens.length === 0
        ? `Everything about how this makes money is new ground for you: `
          + `${newGround.map((n) => n.value).join(', ')}. That is the case for it, `
          + 'separately from whether it is a good business.'
        : `It would deepen ${deepens.map((d) => d.value).join(', ') || 'nothing'} `
          + `and open ${newGround.map((n) => n.value).join(', ') || 'nothing'}.`;

  return { serves, deepens, newGround, verdict, makesItWorse };
}

/**
 * SHOULD ANOTHER VENTURE BE ADDED AT ALL?
 *
 * "I do not recommend adding another venture right now" has to be an answer the
 * institution can give, or the search is a machine for producing companies. The
 * grounds are the owner's own: burden that is already concentrated, and a
 * portfolio whose failures already run together.
 */
export interface AnotherVentureView {
  recommend: boolean;
  because: string;
  concentrations: Concentration[];
}

export async function shouldAddAnother(
  founderId: string, world: World = 'real',
): Promise<AnotherVentureView> {
  const concentrations = await concentrationsFor(founderId, world);
  const { portfolioFor } = await import('./portfolio.js');
  const portfolio = await portfolioFor(founderId);
  // The rehearsal world answers about the rehearsal companies, for the same
  // reason it counts rehearsal exposures: an answer assembled from half one
  // world and half the other would be about a portfolio that does not exist.
  const companies = world === 'reference' ? portfolio.reference : portfolio.companies;

  const needsHim = companies.filter((c) => c.needsHim !== null);
  const struggling = companies.filter((c) => c.severity >= 4);

  if (struggling.length > 0) {
    return {
      recommend: false, concentrations,
      because: `${struggling.map((c) => c.name).join(' and ')} `
        + `${struggling.length === 1 ? 'is' : 'are'} in trouble. Starting something `
        + 'else now spends the scarcest thing you have on the newest thing you own, '
        + 'which is how a portfolio quietly gets worse.',
    };
  }
  if (needsHim.length >= 3) {
    return {
      recommend: false, concentrations,
      because: `${String(needsHim.length)} of your companies are already waiting on `
        + 'you. Another one would not be another income stream yet - it would be '
        + 'another thing wanting your attention.',
    };
  }
  const heavy = concentrations.filter((c) => c.carriedBy.length >= 3);
  if (heavy.length > 0) {
    return {
      recommend: true, concentrations,
      because: `Yes - but not another of the same kind. ${String(heavy[0]?.carriedBy.length ?? 0)} `
        + `of your businesses already share ${heavy[0]?.value ?? ''}, so what would `
        + 'help is something that fails for different reasons than the ones you have.',
    };
  }
  return {
    recommend: true, concentrations,
    because: concentrations.length === 0
      ? 'Nothing is competing for your attention and nothing obvious is concentrated. '
        + 'This is a reasonable moment to look.'
      : 'Nothing is competing for your attention. Worth looking, with an eye on what '
        + 'you already depend on.',
  };
}

/** Record one fact about how something makes money. */
export async function noteExposure(input: {
  founderId: string; subjectKind: 'company' | 'opportunity'; subjectId: string;
  dimension: string; value: string;
  howKnown: 'owner_said' | 'observed' | 'inferred';
  evidenceMode: 'real' | 'sandbox' | 'reference';
}): Promise<void> {
  try {
    await query(
      `INSERT INTO portfolio_exposures
         (id, founder_id, subject_kind, subject_id, dimension, value, how_known, evidence_mode)
       VALUES (?,?,?,?,?,?,?,?)`,
      [nanoid(), input.founderId, input.subjectKind, input.subjectId,
        input.dimension, input.value, input.howKnown, input.evidenceMode]);
  } catch { /* already noted; the unique index is the idempotency */ }
}
