// =============================================================================
// FOUNDRY - what a thing earns against what it costs to own, including him
//
// Headline revenue is not the measure. A business that pays $3,000 a month and
// needs the owner four times a week is worth less to him than one that pays
// $1,500 and needs nobody, and an institution that ranked them by revenue would
// be optimising the number he cares about least.
//
// NO FAKE DOLLARS FOR ATTENTION. The owner's rule: where a burden cannot
// honestly be monetised, do not pretend - but never pretend it is not there.
// So his attention is counted, in interruptions, and put next to the money
// rather than folded into it. The judgement is a stated rule he can argue
// with, not a weighted index he cannot.
//
// INTERRUPTIONS ARE DERIVED, NOT LOGGED. Everything that ever needed him is
// already a row with a decision on it: a proposed act, a recommendation, an
// experiment. Counting those is the honest measure of what an asset asked of
// him; a separate attention ledger would be a second copy of the same facts.
//
// ─── WHAT AN INDEPENDENT REVIEW FOUND HERE, AND WHAT IT COST ────────────────
//
// This file said "earning its keep" about three assets it had no business
// saying it about, and a reviewer reproduced all three from fixtures:
//
//   $0 earned, $0 recorded cost, nobody asked        -> "earning its keep"
//   $600/mo, $1 cost, FIFTY interruptions in a month -> "earning its keep"
//   nothing known at all                             -> "too early to say"
//
// Three separate defects, one cause. The verdict was computed from two
// numbers that were not the institution's own economics:
//
//   1. REVENUE WAS MRR AND NOTHING ELSE, read from a metric snapshot. The
//      first real thing this institution ever sold was a $29 ONE-TIME brief.
//      An asset that sells a thing once, or licenses it, or is paid on an
//      event, earns nothing this rule can see, so it reads "too early to say"
//      for ever. RIVER says it plainly: "Flow, not MRR, is the general
//      concept". This file was reading the older objective, and the older
//      objective was wrong.
//   2. COST WAS THE AI BILL. Provider fees, settled outlay, refunds and
//      disputes - everything in `economic_events`, which this institution
//      already keeps to the cent - were not in it. And a missing AI figure
//      read as zero, so an asset nobody had ever measured looked free.
//   3. ATTENTION VANISHED ABOVE $500. `interruptions >= 4 && mrr < 50_000`
//      meant that any asset earning over five hundred dollars a month could
//      interrupt him without limit and still read as earning its keep. The
//      threshold was invented, undisclosed, and exactly backwards: the more an
//      asset earns, the more his time it can take before anybody mentions it.
//
// So the money now comes from `economy/projection.ts` and the ledger beneath
// it - the same figures Economics shows him, joined to the asset through the
// fulfilments it earned them on. Nothing new is written down; a second ledger
// would be a second answer to one question.
//
// AND THE TWO JUDGEMENTS ARE KEPT APART. Money is one sentence and his time is
// another, because they are not the same kind of fact and no threshold can
// honestly trade one against the other. "Earning its keep, and needed you
// fifty times this month" is a sentence this file could not previously say,
// and it is the sentence that owner most needed to read.
//
// AND A FOURTH DEFECT THE FIXTURES FOUND, which no reviewer had reached: this
// read `standing = 'earned'` companies only. The rows refuse to let an asset be
// born earned out of an experiment — it arrives `experimental` and has to earn
// its standing from the world — so EVERY ASSET THIS INSTITUTION HAS ACTUALLY
// MADE was invisible to its own ownership verdict. The frontier is where all
// the real economic activity is, and it was the one place this could not look.
// `runningCost` already says the same thing about the other half of the
// question: "money spent on an experimental asset is money spent". So does
// what it earns.
//
// A VERDICT NEEDS EVIDENCE. Where the record cannot support one, the answer is
// that it cannot - never the favourable one. An unmeasured zero is not an
// observed zero, which is the same discipline the instrument applies to the
// world, applied here to ourselves.
// =============================================================================

import { query, realCompany } from '../../db/client.js';
import type { Figure } from '../economy/projection.js';

/** How the money arrives, which decides what "earning" can even mean. */
export type Cadence = 'recurring' | 'one_time' | 'mixed' | 'not_yet';

/** What it asks of him, said as a word and never traded against the money. */
export type BurdenOnHim = 'has not needed you' | 'needs you now and then' | 'needs you often';

export interface Burden {
  productId: string; name: string; form: string | null; posture: string;
  /**
   * WHAT IT TOOK IN, less what went back out on those same sales: the
   * institution's own contribution figure for this asset, whatever shape the
   * money arrived in. `unavailable` where nothing can see it, which is not
   * the same as nothing.
   */
  flow: Figure;
  /** Whether that money recurs, arrives once, or has not arrived at all yet. */
  cadence: Cadence;
  /** What owning it cost: settled outlay and thinking. `unavailable` when unmeasured. */
  cost: Figure;
  /** Flow less cost, where both are known. */
  contribution: Figure;
  /**
   * The recurring part alone, where an asset has one, in cents. Kept because
   * some surfaces speak about subscriptions specifically - never as the
   * measure of whether an asset earns.
   */
  mrrCents: number | null;
  /** AI and provider cost over the trailing thirty days, in cents. */
  aiCostCents: number;
  /** How many times it needed him in the last thirty days, and what for. */
  interruptions: number;
  askedFor: string[];
  /**
   * Whether the world has earned it its standing yet. An asset the institution
   * made is `experimental` until it does, which is where all of its actual
   * economic activity is.
   */
  standing: string;
  /** The money judgement, which requires evidence to be favourable. */
  verdict: 'earning its keep' | 'costs more than it earns' | 'not enough to say';
  /** His time, beside the money and never inside it. */
  burden: BurdenOnHim;
  sentence: string;
}

const DAYS = 30;
/**
 * WHEN AN ASSET IS ASKING TOO MUCH OF HIM. Four times a month is the owner's
 * own number, from the sentence this file was written around: a business that
 * needs him four times a week is worth less than one that needs nobody. It
 * applies at every level of revenue, because his week is the same length
 * whatever an asset earns.
 */
const OFTEN = 4;

const unavailable = (because: string): Figure => ({ cents: null, quality: 'unavailable', because });
const measured = (cents: number, because: string): Figure => ({ cents, quality: 'measured', because });

/**
 * WHAT ONE ASSET EARNED, from the institution's own ledger.
 *
 * `economic_events` is founder-scoped and carries a fulfilment; a fulfilment
 * belongs to an experiment, and an experiment's asset is this product. That
 * join is how a sale reaches the thing that made it without anybody writing
 * the number down twice.
 */
async function flowOf(founderId: string, productId: string): Promise<{ flow: Figure; charges: number }> {
  const row = (await query(
    `SELECT
       COALESCE(SUM(CASE WHEN e.kind = 'charge' THEN e.amount_cents ELSE 0 END), 0) AS took_in,
       COALESCE(SUM(CASE WHEN e.kind = 'refund_fee_returned' THEN e.amount_cents ELSE 0 END), 0) AS came_back,
       COALESCE(SUM(CASE WHEN e.kind IN ('provider_fee','unit_cost','refund','dispute_withdrawal','dispute_fee')
                         THEN e.amount_cents ELSE 0 END), 0) AS went_out,
       COUNT(CASE WHEN e.kind = 'charge' THEN 1 END) AS charges
       FROM economic_events e
       JOIN experiment_fulfilments f ON f.id = e.fulfilment_id
       JOIN venture_experiments x ON x.id = f.experiment_id
       JOIN products p ON p.from_experiment_id = x.id
      WHERE e.founder_id = ? AND e.evidence_mode = 'real' AND p.id = ?`,
    [founderId, productId])).rows[0] as Record<string, unknown>;
  const charges = Number(row.charges ?? 0);
  const cents = Number(row.took_in ?? 0) + Number(row.came_back ?? 0) - Number(row.went_out ?? 0);
  if (charges === 0) {
    return {
      charges,
      // AN EMPTY TILL IS AN ABSENCE. Whether it is evidence depends on whether
      // the thing that would have recorded a sale was working, which the
      // instrument already answers for the institution as a whole.
      flow: unavailable('nobody has paid for this, and no sale has been recorded against it'),
    };
  }
  return { charges, flow: measured(cents, `what ${String(charges)} sale${charges === 1 ? '' : 's'} left after fees, refunds and what each unit cost`) };
}

/**
 * WHAT ONE ASSET COST TO OWN in the window: settled outlay through the door,
 * and the thinking spent on it. A day nobody measured is not a day that cost
 * nothing, so an asset with no record at all answers `unavailable`.
 */
async function costOf(productId: string, aiCostCents: number, aiSeen: boolean): Promise<Figure> {
  const row = (await query(
    `SELECT COALESCE(SUM(amount_cents), 0) AS cents, COUNT(*) AS rows_seen
       FROM asset_money_spent
      WHERE product_id = ? AND source = 'settled' AND recorded_at >= datetime('now', ?)`,
    [productId, `-${String(DAYS)} days`])).rows[0] as Record<string, unknown>;
  const outlay = Number(row.cents ?? 0);
  const outlaySeen = Number(row.rows_seen ?? 0) > 0;
  if (!aiSeen && !outlaySeen) {
    return unavailable('nothing has been recorded against it, which is not the same as it having cost nothing');
  }
  return measured(outlay + aiCostCents,
    outlay > 0 && aiCostCents > 0 ? 'settled spend through the door, and the thinking about it'
      : outlay > 0 ? 'settled spend through the door' : 'the thinking about it');
}

/**
 * WHAT EACH REAL COMPANY ASKS OF HIM, in the last thirty days.
 *
 * Reference companies are excluded at the query, by the reality predicate the
 * gate can see: a rehearsal company that needed him twenty times in a scenario
 * built to need him must never read as a drain on his real attention.
 */
export async function burdenFor(founderId: string): Promise<Burden[]> {
  // STANDING IS READ AND CARRIED, NOT FILTERED ON — the frontier AS the
  // frontier, which is the case the existence boundary names.
  //
  // This asked for earned companies only. An asset out of an experiment
  // arrives `experimental` (the rows refuse to let it be born earned) and
  // earns its standing from the world, so every asset this institution has
  // actually made, and every sale any of them has ever produced, was outside
  // what its own ownership verdict could see. `standing` rides on each Burden
  // instead, so a surface that wants operating companies alone can still have
  // them, and one that wants to know what the frontier is costing him can ask.
  const companies = (await query(
    `SELECT p.id, p.name, p.form, p.posture, p.standing,
            COALESCE(p.ai_cost_trailing_30d_usd, 0) AS ai_usd,
            p.ai_cost_trailing_30d_usd AS ai_raw,
            (SELECT m.mrr_cents FROM metric_snapshots m
              WHERE m.product_id = p.id AND m.mrr_cents IS NOT NULL
                AND m.snapshot_date >= date('now','-45 day')
              ORDER BY m.snapshot_date DESC LIMIT 1) AS mrr_cents
       FROM products p
      WHERE p.owner_id = ? AND p.status = 'active' AND p.deleted_at IS NULL
        AND ${realCompany('p')}
      ORDER BY p.created_at, p.rowid`, [founderId]))
    .rows as unknown as Array<Record<string, unknown>>;

  const out: Burden[] = [];
  for (const c of companies) {
    const productId = String(c.id);
    // WHAT NEEDED HIM, NOT WHAT HE GOT ROUND TO.
    //
    // This counted rows by `decided_at`, which is the date he answered — so a
    // question raised three weeks ago and still sitting there counted as zero
    // interruptions, and the tile said "not once this month" on a screen that
    // was at that moment asking him for something. Ignoring him made the burden
    // look smaller. Demand is what the owner-adjusted measure is about, so it
    // is counted from when it was raised.
    const asked = (await query(
      `SELECT 'a decision about ' || subject AS what FROM proposed_acts
        WHERE product_id = ? AND proposed_at >= datetime('now', ?)
       UNION ALL
       SELECT 'advice about ' || kind FROM situation_recommendations
        WHERE product_id = ? AND raised_at >= datetime('now', ?)`,
      [productId, `-${String(DAYS)} days`, productId, `-${String(DAYS)} days`]))
      .rows as unknown as Array<Record<string, unknown>>;
    const interruptions = asked.length;
    const askedFor = [...new Set(asked.map((a) => String(a.what)))];
    const mrrCents = c.mrr_cents == null ? null : Number(c.mrr_cents);
    const aiCostCents = Math.round(Number(c.ai_usd) * 100);
    const aiSeen = c.ai_raw != null;

    const { flow, charges } = await flowOf(founderId, productId);
    const cost = await costOf(productId, aiCostCents, aiSeen);
    const cadence: Cadence = mrrCents != null && charges > 0 ? 'mixed'
      : mrrCents != null ? 'recurring' : charges > 0 ? 'one_time' : 'not_yet';

    // THE RECURRING READING IS PART OF THE FLOW, NOT A RIVAL TO IT. An asset
    // that bills monthly has its month's worth counted; one that sold a thing
    // once has what the sale left. Both are money this asset brought in.
    const flowCents = flow.cents == null ? (mrrCents ?? null)
      : flow.cents + (mrrCents ?? 0);
    const flowFigure: Figure = flowCents == null ? flow
      : { cents: flowCents, quality: 'measured',
        because: cadence === 'mixed' ? 'a month of subscription, and what its sales left'
          : cadence === 'recurring' ? 'a month of subscription' : flow.because };

    const contribution: Figure = flowFigure.cents == null || cost.cents == null
      ? unavailable(flowFigure.cents == null && cost.cents == null
        ? 'neither what it earns nor what it costs has been measured'
        : flowFigure.cents == null ? 'what it earns has not been measured'
          : 'what it costs has not been measured')
      : measured(flowFigure.cents - cost.cents, 'what it brought in, less what owning it cost');

    // THE RULE, STATED, AND IT NEEDS EVIDENCE TO BE KIND. A favourable verdict
    // on an unmeasured asset is the defect this file was rebuilt for.
    const verdict: Burden['verdict'] = contribution.cents == null ? 'not enough to say'
      : contribution.cents < 0 ? 'costs more than it earns' : 'earning its keep';
    // HIS TIME, SEPARATELY, AT EVERY LEVEL OF REVENUE.
    const burden: BurdenOnHim = interruptions === 0 ? 'has not needed you'
      : interruptions >= OFTEN ? 'needs you often' : 'needs you now and then';

    const $ = (cents: number): string => `$${(cents / 100).toFixed(0)}`;
    const money = flowFigure.cents == null ? 'I cannot see what it earns'
      : cadence === 'one_time' ? `has brought in ${$(flowFigure.cents)} in sales`
        : `earns about ${$(flowFigure.cents)} a month`;
    const spent = cost.cents == null ? 'and nothing has been recorded of what it costs'
      : cost.cents === 0 ? 'costs nothing recorded' : `costs about ${$(cost.cents)}`;
    const him = interruptions === 0 ? 'has not needed you'
      : `needed you ${String(interruptions)} ${interruptions === 1 ? 'time' : 'times'}`;
    // WHAT THE OWNER READS: the money, then his time, then the judgement on
    // each — and the second is never suppressed by the first.
    const money_verdict = verdict === 'earning its keep' ? ''
      : verdict === 'costs more than it earns' ? ' - costs more than it earns'
        : ' - not enough to say whether it earns its keep';
    const time_verdict = burden === 'needs you often' ? ' - and it is asking a lot of you' : '';

    out.push({
      productId, name: String(c.name),
      form: c.form == null ? null : String(c.form), posture: String(c.posture),
      standing: String(c.standing),
      flow: flowFigure, cadence, cost, contribution,
      mrrCents, aiCostCents, interruptions, askedFor, verdict, burden,
      sentence: `${String(c.name)} ${money}, ${spent}, and ${him} this month${money_verdict}${time_verdict}.`,
    });
  }
  return out;
}

export type Posture = 'grow' | 'hold' | 'harvest' | 'reposition' | 'sell' | 'retire';

export const POSTURE_IN_PLAIN_WORDS: Record<Posture, string> = {
  grow: 'trying to make it bigger',
  hold: 'leaving it alone and keeping it healthy',
  harvest: 'taking the cash and spending nothing on growth',
  reposition: 'changing what it is or who it is for',
  sell: 'finding it a buyer',
  retire: 'winding it down',
};

/**
 * HIS TO SET. The database refuses any other principal, and this function does
 * not try: it records what he said and where it moved the company from and to.
 */
export async function setPosture(input: {
  productId: string; founderId: string; to: Posture; said: string;
}): Promise<{ from: Posture; to: Posture } | null> {
  const row = (await query('SELECT posture FROM products WHERE id = ? AND owner_id = ?',
    [input.productId, input.founderId])).rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const from = String(row.posture) as Posture;
  if (from === input.to) return { from, to: input.to };
  const { nanoid } = await import('nanoid');
  await query(
    `INSERT INTO posture_changes (id, product_id, founder_id, from_posture, to_posture, said, changed_by)
     VALUES (?,?,?,?,?,?,?)`,
    [nanoid(), input.productId, input.founderId, from, input.to, input.said.trim(),
      `founder:${input.founderId}`]);
  await query('UPDATE products SET posture = ? WHERE id = ?', [input.to, input.productId]);
  return { from, to: input.to };
}

/**
 * "Leave it alone." "Harvest it." "Shut it down." "Sell it."
 *
 * AN INSTRUCTION ABOUT THE COMPANY, NOT A PREFERENCE THAT MENTIONS GROWTH.
 * "I would rather grow organically than buy ads" contains the word grow and is
 * not a posture - it is how he would like things done, and hearing it as "make
 * this bigger" would turn a leaning into a decision about where his money
 * goes. So a sentence with a preference marker is never a posture, and the
 * verb has to be pointed at the thing: "grow it", "leave it alone", "shut it
 * down".
 */
const PREFERRING = /\b(would rather|'d rather|prefer|rather than|ideally|if possible)\b/;
const IT = "(it|this|this one|the company|the business|that one)";

export function readPosture(raw: string): Posture | null {
  const t = ` ${raw.toLowerCase().replace(/[\u2019]/g, "'").trim()} `;
  if (PREFERRING.test(t)) return null;
  const re = (body: string): boolean => new RegExp(body).test(t);
  if (re(`\\b(leave|let) ${IT} (alone|be|as it is)\\b|\\bdon'?t (touch|grow|change) ${IT}\\b|\\bkeep ${IT} (as it is|steady|ticking over)\\b`)) return 'hold';
  if (re(`\\bharvest ${IT}\\b|\\btake the (cash|money) (from|out of) ${IT}\\b|\\bstop (investing|spending) (in|on) ${IT}\\b|\\bjust harvest\\b`)) return 'harvest';
  if (re(`\\b(shut|wind|close) ${IT} down\\b|\\bretire ${IT}\\b|\\bkill ${IT}\\b|\\bswitch ${IT} off\\b`)) return 'retire';
  if (re(`\\bsell ${IT}\\b|\\bfind ${IT} a buyer\\b|\\bput ${IT} up for sale\\b`)) return 'sell';
  if (re(`\\breposition ${IT}\\b|\\bpivot ${IT}\\b|\\bturn ${IT} into\\b|\\bpoint ${IT} at\\b`)) return 'reposition';
  if (re(`\\b(grow|scale) ${IT}\\b|\\bmake ${IT} bigger\\b|\\bpush (on )?${IT}\\b|\\binvest in ${IT}\\b`)) return 'grow';
  return null;
}

export interface PostureChange {
  from: string; to: string; said: string; when: string;
}

/**
 * WHY IS THIS IN HARVEST? Asked a year later by someone who was not there, and
 * answered from the record: what it moved from, to, when, and his sentence.
 */
export async function postureHistory(productId: string): Promise<PostureChange[]> {
  return ((await query(
    `SELECT from_posture, to_posture, said, changed_at FROM posture_changes
      WHERE product_id = ? ORDER BY changed_at DESC, rowid DESC LIMIT 10`, [productId]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    from: String(r.from_posture), to: String(r.to_posture), said: String(r.said),
    when: String(r.changed_at).slice(0, 10),
  }));
}
