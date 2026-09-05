// =============================================================================
// FOUNDRY — the owner's portfolio
//
// "What do I own? How is everything doing? Which one is deteriorating? Where
// should the next dollar go? What should we stop? Does anything need me?"
//
// NOT AN ENTERPRISE PORTFOLIO CONSOLE. `services/portfolio/manager.ts` already
// exists and is a different thing: an INVESTOR's portfolio, with cohorts and
// benchmarking across companies somebody else owns. This is one person looking
// at his own businesses, and the questions are not the same ones.
//
// WHAT MAKES CROSS-COMPANY COMPARISON POSSIBLE AT ALL is that a situation is
// now remembered (migration 230). Comparing companies on their metrics would be
// comparing a bakery to a SaaS; comparing them on WHAT SITUATION THEY ARE IN
// and HOW LONG THEY HAVE BEEN IN IT works regardless of what they do, because
// the situations are business-independent by construction.
//
// ORDERED BY WHAT IS AT STAKE AND FOR HOW LONG — and the ordering is declared,
// not scored. A weighted score would put a number on "which company is worse",
// invent precision nobody measured, and make the ordering impossible to argue
// with. A stated severity plus days is arguable, which is the point: it is his
// judgement, and Foundry's job is to put the companies in front of him in an
// order that respects his attention rather than to decide for him.
//
// AND IT NEVER MIXES THE WORLDS. Reference companies are counted separately or
// not at all; a portfolio total that included a company that does not exist
// would be the exact corruption migrations 222 and 223 exist to prevent.
// =============================================================================

import { query, realCompany, referenceCompany } from '../../db/client.js';

/**
 * HOW MUCH A SITUATION IS WORTH INTERRUPTING FOR.
 *
 * Declared, in order, so the ordering can be argued with rather than reverse-
 * engineered from arithmetic. `blind` outranks everything a reading could say
 * because a company nobody can see is one whose other answers are all suspect.
 */
const SEVERITY: Record<string, number> = {
  blind: 5,
  conflicting: 4,
  payments_failing: 4,
  revenue_falling: 4,
  churning: 3,
  growth_not_converting: 3,
  unknown: 2,
  steady: 1,
  growing: 0,
};

export interface CompanyInPortfolio {
  productId: string; name: string;
  situation: string; headline: string; days: number;
  severity: number;
  /** What it needs from him right now, in one phrase, or null. */
  needsHim: string | null;
  /** How many senses are live, and how many questions remain unanswerable. */
  canSee: number; cannotSee: number;
  reference: boolean;
}

export interface Portfolio {
  companies: CompanyInPortfolio[];
  /** Invented companies, kept separate and never counted with the real ones. */
  reference: CompanyInPortfolio[];
  /** The one sentence at the top. */
  headline: string;
  /** True when at least one company genuinely needs a decision. */
  anythingNeedsHim: boolean;
}

async function readOne(
  row: Record<string, unknown>,
): Promise<CompanyInPortfolio> {
  const productId = String(row.id);
  const situation = row.situation == null ? 'unknown' : String(row.situation);
  const senses = await import('../senses/index.js');
  const live = await senses.connectedSenses(productId);
  const blind = await senses.whatItCannotSee(productId);

  // WHAT IT NEEDS FROM HIM, in the order a person would deal with them: a
  // decision he has been asked for outranks advice he has not read, which
  // outranks a question about whether something is worth watching.
  const pending = (await query(
    `SELECT
       (SELECT COUNT(*) FROM proposed_acts
         WHERE product_id = ? AND decision IS NULL AND revoked_at IS NULL
           AND datetime(expires_at) > datetime('now')) AS acts,
       (SELECT COUNT(*) FROM situation_recommendations r
          JOIN company_situations s ON s.id = r.situation_id
         WHERE r.product_id = ? AND r.decision IS NULL AND s.ended_at IS NULL) AS advice,
       (SELECT COUNT(*) FROM responsibility_candidates
         WHERE product_id = ? AND status = 'pending') AS questions`,
    [productId, productId, productId])).rows[0] as Record<string, unknown>;

  const acts = Number(pending.acts);
  const advice = Number(pending.advice);
  const questions = Number(pending.questions);
  const needsHim = acts > 0
    ? `${String(acts)} ${acts === 1 ? 'thing I cannot do' : 'things I cannot do'} without you`
    : advice > 0
      ? `${String(advice)} ${advice === 1 ? 'suggestion' : 'suggestions'} waiting`
      : questions > 0
        ? `${String(questions)} ${questions === 1 ? 'question' : 'questions'}`
        : null;

  return {
    productId, name: String(row.name), situation,
    headline: row.headline == null
      ? 'I have not looked at this company yet.' : String(row.headline),
    days: row.days == null ? 0 : Math.max(0, Number(row.days)),
    severity: SEVERITY[situation] ?? 2,
    needsHim, canSee: live.length, cannotSee: blind.length,
    reference: String(row.reality) === 'reference',
  };
}

/**
 * Everything he owns, in the order it deserves his attention.
 *
 * A company with no recorded situation sorts as `unknown` rather than being
 * left out: "I have not looked at this yet" is an answer to "what do I own",
 * and omitting it would make the list quietly incomplete.
 */
export async function portfolioFor(founderId: string): Promise<Portfolio> {
  // THE PREDICATE IS WRITTEN AT THE QUERY, NOT PASSED IN — and the reason is
  // the gate rather than style. `check-reality-scope` reads the text around a
  // SELECT over `products` to see whether the boundary was applied; a predicate
  // arriving as a parameter is invisible to it, so a query could stop being
  // scoped and nothing would say so. This is the one boundary that must not
  // rely on someone remembering, so it is spelled out where it can be seen.
  const read = async (reference: boolean): Promise<CompanyInPortfolio[]> => {
    const rows = (await query(
      `SELECT p.id, p.name, p.reality, s.situation, s.headline,
              CAST(julianday('now') - julianday(s.began_at) AS INTEGER) AS days
         FROM products p
         LEFT JOIN company_situations s
           ON s.product_id = p.id AND s.ended_at IS NULL
        WHERE p.owner_id = ? AND p.status = 'active' AND p.standing = 'earned' AND p.deleted_at IS NULL
          AND ${reference ? referenceCompany('p') : realCompany('p')}
        ORDER BY p.created_at, p.rowid`, [founderId]))
      .rows as unknown as Array<Record<string, unknown>>;
    const out: CompanyInPortfolio[] = [];
    for (const row of rows) out.push(await readOne(row));
    return out;
  };

  const companies = (await read(false))
    // Worst first, and within a severity the one that has been like that
    // longest — because a month of falling revenue is a different fact from a
    // day of it, and the difference is the one an owner acts on.
    .sort((a, b) => b.severity - a.severity || b.days - a.days);
  const reference = await read(true);

  const needing = companies.filter((c) => c.needsHim !== null);
  const worst = companies.find((c) => c.severity >= 3);
  const headline = companies.length === 0
    ? 'You have not given me any companies yet.'
    : needing.length > 0
      ? `${String(needing.length)} of your ${String(companies.length)} `
        + `${companies.length === 1 ? 'company needs' : 'companies need'} you.`
      : worst
        ? `Nothing needs a decision, but ${worst.name} has been ${worst.situation
          .replaceAll('_', ' ')} for ${String(worst.days)} days.`
        : 'Everything is steady. Nothing needs you.';

  return { companies, reference, headline, anythingNeedsHim: needing.length > 0 };
}

/**
 * WHERE THE NEXT DOLLAR SHOULD GO — and why this refuses to answer it alone.
 *
 * The owner asked for this question to be approachable. It is also the question
 * where a confident wrong answer is most expensive, and Foundry cannot see the
 * two things that decide it: what each company could do with the money, and
 * what he is trying to build. So it does what it honestly can — put the
 * companies in an order, say what each would need it for, and name what it does
 * not know — and leaves the allocation to him.
 *
 * REJECTION IS THE VALUABLE HALF. "None of them, yet" is a real answer and it
 * is returned when nothing is in a situation that money would change.
 */
export interface CapitalView {
  question: string;
  candidates: Array<{ name: string; productId: string; forWhat: string; days: number }>;
  whatIDoNotKnow: string[];
  recommendation: string;
}

export async function whereTheNextDollarGoes(founderId: string): Promise<CapitalView> {
  const { companies } = await portfolioFor(founderId);
  // A COMPANY HE IS HOLDING OR HARVESTING DOES NOT GET GROWTH MONEY. That is
  // what the posture means; an allocator that ignored it would be overruling
  // him with his own cash.
  const postures = new Map(((await query(
    `SELECT p.id, p.posture FROM products p
      WHERE p.owner_id = ? AND ${realCompany('p')}`, [founderId]))
    .rows as unknown as Array<Record<string, unknown>>)
    .map((r) => [String(r.id), String(r.posture)]));
  const spendable = companies.filter((c) =>
    (postures.get(c.productId) === 'grow' || postures.get(c.productId) === 'reposition')
    && (c.situation === 'growth_not_converting' || c.situation === 'revenue_falling'
    || c.situation === 'churning' || c.situation === 'growing'));

  const forWhat: Record<string, string> = {
    growing: 'more of whatever is already working',
    growth_not_converting: 'finding out where the arrivals stop, which is cheap',
    revenue_falling: 'finding out whether this is fewer arriving or more leaving',
    churning: 'finding out when customers leave, which is cheap',
  };

  return {
    question: 'Where should the next dollar go?',
    candidates: spendable.map((c) => ({
      name: c.name, productId: c.productId,
      forWhat: forWhat[c.situation] ?? 'something I cannot name yet', days: c.days,
    })),
    whatIDoNotKnow: [
      'what each of these could actually do with money, which depends on things '
      + 'I cannot see',
      'what you are trying to build, unless you have told me',
      'whether any of them is worth more to you than the others for reasons that '
      + 'are not in the numbers',
    ],
    recommendation: spendable.length === 0
      ? 'None of them, yet. Nothing here is in a situation that money would '
        + 'change, and spending on that is how a portfolio quietly gets worse.'
      : companies.some((c) => c.severity >= 4)
        ? `Not yet — ${companies[0]?.name ?? 'the first company'} is in trouble, `
          + 'and money spent while something is broken usually buys more of the '
          + 'problem. Fix that first.'
        : `${spendable[0]?.name ?? ''} — ${forWhat[spendable[0]?.situation ?? ''] ?? ''}. `
          + 'It is the cheapest useful thing I can name, and I would rather be '
          + 'wrong about a small amount than right about a large one.',
  };
}

export interface Glance {
  /** Monthly revenue across real companies Foundry can see, in cents, or null. */
  cashFlowCents: number | null;
  /** How many of the real companies report revenue at all. */
  seen: number; companies: number;
  /** The one concentration sentence, or null when nothing is shared. */
  concentration: string | null;
  /** How many times his companies needed him in the last thirty days. */
  interruptions: number;
}

/**
 * THE PORTFOLIO IN THREE FACTS, for the first screen.
 *
 * Cash flow is the sum of what can actually be seen, and says how many
 * companies it covers - a total that quietly omitted the ones Foundry is blind
 * to would be the number he trusts most and the one least entitled to it.
 * The third fact is not a "health" or "resilience" grade: it is the largest
 * thing his businesses share, named, which is what a grade would be hiding.
 */
export async function glanceFor(founderId: string): Promise<Glance> {
  const rows = (await query(
    `SELECT p.id,
            (SELECT m.mrr_cents FROM metric_snapshots m
              WHERE m.product_id = p.id AND m.mrr_cents IS NOT NULL
                AND m.snapshot_date >= date('now','-45 day')
              ORDER BY m.snapshot_date DESC LIMIT 1) AS mrr_cents
       FROM products p
      WHERE p.owner_id = ? AND p.status = 'active' AND p.standing = 'earned' AND p.deleted_at IS NULL
        AND ${realCompany('p')}`, [founderId]))
    .rows as unknown as Array<Record<string, unknown>>;
  const seen = rows.filter((r) => r.mrr_cents != null);
  const { concentrationsFor } = await import('./resilience.js');
  const top = (await concentrationsFor(founderId, 'real'))[0];
  const { burdenFor } = await import('./burden.js');
  const interruptions = (await burdenFor(founderId))
    .reduce((n, b) => n + b.interruptions, 0);
  return {
    cashFlowCents: seen.length === 0 ? null
      : seen.reduce((n, r) => n + Number(r.mrr_cents), 0),
    seen: seen.length, companies: rows.length,
    concentration: top === undefined ? null
      : `${String(top.carriedBy.length)} of ${String(rows.length)} share ${top.value}`,
    interruptions,
  };
}

export interface Layer {
  name: 'anchors' | 'tributaries' | 'frontier' | 'unseen';
  title: string; what: string;
  companies: Array<{ productId: string; name: string; mrrCents: number | null; posture: string }>;
  cashFlowCents: number;
}

/**
 * THE RIVER IN ITS LAYERS: a few anchors, many tributaries, an experimental
 * frontier. Membership is stated arithmetic - an anchor is a real company
 * earning at least a thousand dollars a month, a tributary is any other real
 * company that earns, and the frontier is what is being looked at rather than
 * owned - so he can argue with the line rather than wonder where it is.
 */
export const ANCHOR_CENTS = 100_000;

/**
 * ONE WAY TO WRITE DOWN MONEY.
 *
 * There were four. Two rendered the same figure differently on the same screen:
 * a company earning $999.50 appeared as "$1000" beside a portfolio total that
 * called it "$999.50", because one rounded to whole dollars above a hundred and
 * the other did not. A number he cannot reconcile between two lines of the same
 * page is a number he has to check, and checking is the work this is supposed
 * to remove.
 *
 * Abbreviated only where the precision would be noise: at a thousand dollars
 * the cents stop mattering, and below that they are the difference between
 * two prices.
 */
export function money(cents: number): string {
  if (!Number.isFinite(cents)) return '—';
  if (Math.abs(cents) >= 100_000_000) return `$${(cents / 100_000_000).toFixed(1)}M`;
  if (Math.abs(cents) >= 100_000) return `$${(cents / 100_000).toFixed(1)}k`;
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`;
}

export async function layersFor(founderId: string): Promise<{
  layers: Layer[];
  frontier: { looking: number; awaiting: number; buried: number; testing: number };
}> {
  const rows = (await query(
    `SELECT p.id, p.name, p.posture,
            (SELECT m.mrr_cents FROM metric_snapshots m
              WHERE m.product_id = p.id AND m.mrr_cents IS NOT NULL
                AND m.snapshot_date >= date('now','-45 day')
              ORDER BY m.snapshot_date DESC LIMIT 1) AS mrr_cents
       FROM products p
      WHERE p.owner_id = ? AND p.status = 'active' AND p.standing = 'earned' AND p.deleted_at IS NULL
        AND ${realCompany('p')}
      ORDER BY mrr_cents DESC NULLS LAST, p.created_at`, [founderId]))
    .rows as unknown as Array<Record<string, unknown>>;
  const each = rows.map((r) => ({
    productId: String(r.id), name: String(r.name),
    mrrCents: r.mrr_cents == null ? null : Number(r.mrr_cents), posture: String(r.posture),
  }));
  // A COMPANY FOUNDRY CANNOT SEE IS NOT A SMALL COMPANY.
  //
  // These partitioned on `mrrCents ?? 0`, so "I cannot see what this earns"
  // became zero and landed in Tributaries — a layer the page describes as
  // small, steady, and not asked to become anchors. His largest business, on
  // the day it stops reporting, is filed as a minor one. Not knowing is its own
  // answer and gets its own place.
  const anchors = each.filter((c) => c.mrrCents !== null && c.mrrCents >= ANCHOR_CENTS);
  const tributaries = each.filter((c) => c.mrrCents !== null && c.mrrCents < ANCHOR_CENTS);
  const unseen = each.filter((c) => c.mrrCents === null);
  const sum = (cs: typeof each): number => cs.reduce((n, c) => n + (c.mrrCents ?? 0), 0);

  const frontier = (await query(
    `SELECT
       (SELECT COUNT(*) FROM venture_opportunities o
          WHERE o.founder_id = ? AND o.verdict IS NULL AND o.evidence_mode = 'real') AS looking,
       (SELECT COUNT(*) FROM venture_experiments e
          WHERE e.founder_id = ? AND e.decision IS NULL AND e.evidence_mode = 'real') AS awaiting,
       (SELECT COUNT(*) FROM venture_opportunities o
          WHERE o.founder_id = ? AND o.verdict = 'rejected' AND o.evidence_mode = 'real') AS buried,
       -- AN EXPERIMENTAL ASSET IS ON THE FRONTIER, NOT IN A LAYER. A test
       -- object with an identity and a budget is not a tributary and not an
       -- anchor; it is a thing being tested, and it is counted as that here so
       -- the layers above stay a picture of what actually earns.
       (SELECT COUNT(*) FROM products x
          WHERE x.owner_id = ? AND x.status = 'active' AND x.deleted_at IS NULL
            AND x.standing = 'experimental' AND x.reality = 'real') AS testing`,
    [founderId, founderId, founderId, founderId])).rows[0] as Record<string, unknown>;

  return {
    layers: [
      { name: 'anchors', title: 'Anchors', what: 'the few that carry the river',
        companies: anchors, cashFlowCents: sum(anchors) },
      { name: 'tributaries', title: 'Tributaries',
        what: 'small, steady, and not asked to become anchors',
        companies: tributaries, cashFlowCents: sum(tributaries) },
      ...(unseen.length > 0 ? [{
        name: 'unseen' as const, title: 'Not reporting',
        what: 'I cannot see what these earn, so I cannot place them',
        companies: unseen, cashFlowCents: 0,
      }] : []),
    ],
    frontier: {
      looking: Number(frontier.looking), awaiting: Number(frontier.awaiting),
      buried: Number(frontier.buried),
      testing: Number(frontier.testing),
    },
  };
}
