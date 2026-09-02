// =============================================================================
// FOUNDRY — what situation a company is in
//
// THE OWNER'S RULE FOR THE COMPANY PAGE: "A revenue collapse should dominate
// twelve healthy metrics. A quiet healthy company should look quiet." A page
// that renders every dataset it has, in a fixed order, cannot do that — it
// treats a company falling apart and a company doing nothing as the same
// layout with different numbers in it.
//
// So the page asks this first: what situation is this, and what is the ONE
// sentence that says it. Everything below then arranges itself around the
// answer.
//
// WHAT THIS IS AND IS NOT. It is arithmetic on readings the company reported,
// plus the health of the connections that reported them. It says "new revenue
// is down about a quarter while signups are up about a third" — which is two
// facts and a conjunction. It does not say why, does not say whose fault, and
// does not say what to do. Those are judgements, and judgement in this
// institution has to be earned and grounded elsewhere; it is not smuggled in
// through a headline.
//
// AND IT SAYS WHEN IT CANNOT TELL. `unknown` is a real answer with its own
// sentence. A company nothing reports on is not "healthy".
// =============================================================================

import { query } from '../../db/client.js';

export type Situation =
  | 'unknown'          // nothing reports on it
  | 'blind'            // it reported once and has gone quiet, or a sense broke
  | 'conflicting'      // two sources disagree about the same quantity
  | 'revenue_falling'
  | 'churning'         // customers leaving faster than before
  | 'payments_failing' // a declared failed-payment quantity is climbing
  | 'growth_not_converting' // more arriving, no more revenue
  | 'growing'
  | 'steady';

export interface CompanySituation {
  situation: Situation;
  /** The one sentence at the top of the page. */
  headline: string;
  /** Why it says that, in the readings it is derived from. */
  because: string[];
  /** True when the owner should feel the page change shape. */
  demandsAttention: boolean;
}

const MATERIAL = 0.15;
/** A reading older than this is not describing today. */
const STALE_DAYS = 10;

function movement(previous: number, current: number): number | null {
  if (!Number.isFinite(previous) || !Number.isFinite(current) || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

function pct(change: number): string {
  const size = Math.abs(change) * 100;
  return `about ${size < 10 ? size.toFixed(0) : String(Math.round(size / 5) * 5)}%`;
}

/**
 * WHICH SITUATION, IN PRIORITY ORDER.
 *
 * The order is the point and it is not alphabetical. A company whose senses
 * have broken must be told that BEFORE it is told anything derived from what
 * those senses last said, or the institution is presenting stale numbers with
 * a confident face. Sources disagreeing outranks either of them agreeing.
 */
export async function whatSituation(productId: string): Promise<CompanySituation> {
  const senses = await import('../senses/index.js');
  const live = await senses.connectedSenses(productId);

  const broken = live.filter((s) => s.lastError !== null);
  if (broken.length) {
    return {
      situation: 'blind', demandsAttention: true,
      headline: `I have stopped being able to see ${broken.map((s) => s.wouldLearn).join(', ')}.`,
      because: broken.map((s) => `${s.provider}: ${String(s.lastError)}`),
    };
  }

  const columns = ['mrr_cents', 'new_mrr_cents', 'churned_mrr_cents', 'churn_rate',
    'active_users', 'signups_7d', 'day_30_retention'];

  // TWO SINGLE DAYS IS NOT A TREND, and this was diagnosed the hard way: the
  // reference world's deliberately-quiet company was read as "growth that is
  // not converting" because one day's noise on signups happened to be 15%
  // above another day's. Real companies are noisier than that, so the false
  // alarm would have been worse in reality than in rehearsal — and an
  // institution that raises one teaches its owner to stop reading it.
  //
  // A WEEK EACH SIDE. Enough to average out a bad Tuesday, short enough that a
  // real change still shows. The window is the same at both ends so the two
  // numbers are comparable.
  const window = (from: string, to: string): string =>
    `SELECT ${columns.map((c) => `AVG(${c}) AS ${c}`).join(', ')}, MAX(snapshot_date) AS snapshot_date
       FROM metric_snapshots WHERE product_id = ?
        AND snapshot_date > date(${from}) AND snapshot_date <= date(${to})`;

  const newest = (await query(
    'SELECT MAX(snapshot_date) AS d FROM metric_snapshots WHERE product_id = ?', [productId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (newest?.d == null) {
    const senseCount = live.length;
    return {
      situation: 'unknown', demandsAttention: false,
      headline: senseCount
        ? 'Nothing has reported yet, so there is nothing I can tell you about this company.'
        : 'I cannot see anything about this company yet.',
      because: senseCount
        ? ['a source is connected but has not sent anything']
        : ['nothing reports to me about it'],
    };
  }
  const newestDate = String(newest.d);
  const latest = (await query(window("?, '-7 day'", '?'),
    [productId, newestDate, newestDate])).rows[0] as Record<string, unknown> | undefined;

  // A NEW COMPANY IS NOT A BROKEN ONE — handled above, where the absence is
  // known, so this can only be an empty average over a window that has rows.
  if (!latest) {
    return {
      situation: 'unknown', demandsAttention: false,
      headline: 'I cannot see anything about this company yet.',
      because: ['nothing reports to me about it'],
    };
  }

  const days = Number(((await query(
    "SELECT CAST(julianday('now') - julianday(?) AS INTEGER) AS d", [newestDate]))
    .rows[0] as Record<string, unknown>).d);
  if (days > STALE_DAYS) {
    return {
      situation: 'blind', demandsAttention: true,
      headline: `Nothing has reported on this company for ${String(days)} days.`,
      because: [`the last reading is from ${String(latest.snapshot_date)}`,
        'anything I showed you would be that old'],
    };
  }

  // TWO SOURCES DISAGREEING IS ITS OWN SITUATION, not an average. Averaging two
  // numbers that contradict each other produces a third number nobody reported
  // and hides the one fact the owner needs, which is that he cannot rely on
  // either until it is resolved.
  const conflicts = (await query(
    `SELECT json_extract(payload_json,'$.field') AS field,
            COUNT(DISTINCT json_extract(payload_json,'$.direction')) AS directions,
            COUNT(DISTINCT json_extract(payload_json,'$.origin')) AS origins
       FROM signal_events
      WHERE product_id = ? AND source LIKE '%metric_ingest'
        AND date(created_at) = date('now')
      GROUP BY 1 HAVING directions > 1 AND origins > 1`, [productId]))
    .rows as unknown as Array<Record<string, unknown>>;
  if (conflicts.length) {
    return {
      situation: 'conflicting', demandsAttention: true,
      headline: 'Two of my sources disagree about the same thing today, so I cannot tell you '
        + 'which is right.',
      because: conflicts.map((c) =>
        `${String(c.field)} was reported moving two different ways by two different sources`),
    };
  }

  const prior = (await query(window("?, '-37 day'", "?, '-30 day'"),
    [productId, newestDate, newestDate])).rows[0] as Record<string, unknown> | undefined;
  if (prior?.snapshot_date == null) {
    return {
      situation: 'unknown', demandsAttention: false,
      headline: 'I have this month\'s numbers but nothing to compare them against yet.',
      because: ['there is no reading from around a month ago'],
    };
  }

  const moved = (column: string): number | null =>
    movement(Number(prior[column]), Number(latest[column]));
  const because: string[] = [];

  // A DECLARED QUANTITY, WHICH IS HOW THIS AVOIDS BEING A SAAS DASHBOARD. A
  // company that tracks failed payments says so (migration 135) and the
  // institution treats it as an opaque named quantity; nothing here knows what
  // a failed payment IS, only that this company said it matters and which way
  // it went.
  const declared = (await query(
    `SELECT c.channel_key, c.label,
            (SELECT json_extract(e.payload_json,'$.direction') FROM signal_events e
              WHERE e.product_id = c.product_id AND e.source LIKE '%metric_ingest'
                AND json_extract(e.payload_json,'$.field') = c.channel_key
              ORDER BY e.created_at DESC, e.rowid DESC LIMIT 1) AS direction
       FROM company_observation_channels c
      WHERE c.product_id = ? AND c.revoked_at IS NULL`, [productId]))
    .rows as unknown as Array<Record<string, unknown>>;
  const climbing = declared.filter((d) => String(d.direction) === 'rose');
  const paymentish = climbing.find((d) => /payment|decline|dunning|failed/.test(String(d.channel_key)));
  if (paymentish) {
    return {
      situation: 'payments_failing', demandsAttention: true,
      headline: `${String(paymentish.label)} is climbing, and that is money you have already earned.`,
      because: [`${String(paymentish.label)} was last reported rising`,
        'this is revenue leaving for a reason that is usually fixable'],
    };
  }

  const revenue = moved('new_mrr_cents') ?? moved('mrr_cents');
  const churn = moved('churn_rate') ?? moved('churned_mrr_cents');
  const signups = moved('signups_7d');
  const users = moved('active_users');

  if (revenue !== null && revenue <= -MATERIAL) {
    because.push(`new revenue is down ${pct(revenue)} on a month ago`);
    if (churn !== null && churn >= MATERIAL) because.push(`and churn is up ${pct(churn)}`);
    return {
      situation: 'revenue_falling', demandsAttention: true,
      headline: `Revenue is falling here — down ${pct(revenue)} on a month ago.`, because,
    };
  }
  if (churn !== null && churn >= MATERIAL) {
    return {
      situation: 'churning', demandsAttention: true,
      headline: `Customers are leaving faster than they were — up ${pct(churn)} on a month ago.`,
      because: [`churn is up ${pct(churn)}`,
        ...(revenue !== null ? [`new revenue is ${revenue >= 0 ? 'up' : 'down'} ${pct(revenue)}`] : [])],
    };
  }
  // GROWTH THAT IS NOT CONVERTING. More people arriving and no more money is a
  // different problem from either number alone, and it is invisible on a page
  // that shows both as green.
  if (signups !== null && signups >= MATERIAL
    && revenue !== null && Math.abs(revenue) < MATERIAL) {
    return {
      situation: 'growth_not_converting', demandsAttention: true,
      headline: `More people are arriving — up ${pct(signups)} — and revenue has not moved.`,
      because: [`signups are up ${pct(signups)}`, 'new revenue is about the same as a month ago'],
    };
  }
  if ((revenue !== null && revenue >= MATERIAL) || (users !== null && users >= MATERIAL)) {
    return {
      situation: 'growing', demandsAttention: false,
      headline: 'This is growing.',
      because: [
        ...(revenue !== null && revenue >= MATERIAL ? [`new revenue is up ${pct(revenue)}`] : []),
        ...(users !== null && users >= MATERIAL ? [`people using it are up ${pct(users)}`] : []),
      ],
    };
  }

  // A QUIET HEALTHY COMPANY SHOULD LOOK QUIET, and saying so is a result.
  return {
    situation: 'steady', demandsAttention: false,
    headline: 'Nothing here has moved much since a month ago.',
    because: ['no number I can see has moved by more than a seventh'],
  };
}
