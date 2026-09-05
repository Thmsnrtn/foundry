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
// =============================================================================

import { query, realCompany } from '../../db/client.js';

export interface Burden {
  productId: string; name: string; form: string | null; posture: string;
  /** Latest monthly revenue, in cents, or null when Foundry cannot see it. */
  mrrCents: number | null;
  /** AI and provider cost over the trailing thirty days, in cents. */
  aiCostCents: number;
  /** How many times it needed him in the last thirty days, and what for. */
  interruptions: number;
  askedFor: string[];
  /** The stated rule's answer. */
  verdict: 'earning its keep' | 'costs more than it earns' | 'costs more of you than it earns'
    | 'too early to say';
  sentence: string;
}

const DAYS = 30;

/**
 * WHAT EACH REAL COMPANY ASKS OF HIM, in the last thirty days.
 *
 * Reference companies are excluded at the query, by the reality predicate the
 * gate can see: a rehearsal company that needed him twenty times in a scenario
 * built to need him must never read as a drain on his real attention.
 */
export async function burdenFor(founderId: string): Promise<Burden[]> {
  const companies = (await query(
    `SELECT p.id, p.name, p.form, p.posture,
            COALESCE(p.ai_cost_trailing_30d_usd, 0) AS ai_usd,
            (SELECT m.mrr_cents FROM metric_snapshots m
              WHERE m.product_id = p.id AND m.mrr_cents IS NOT NULL
                AND m.snapshot_date >= date('now','-45 day')
              ORDER BY m.snapshot_date DESC LIMIT 1) AS mrr_cents
       FROM products p
      WHERE p.owner_id = ? AND p.status = 'active' AND p.standing = 'earned' AND p.deleted_at IS NULL
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

    // THE RULE, STATED. Money against money first; then his attention against
    // what the money is, with the threshold in the open.
    let verdict: Burden['verdict'];
    if (mrrCents === null) verdict = 'too early to say';
    else if (aiCostCents > mrrCents) verdict = 'costs more than it earns';
    else if (interruptions >= 4 && mrrCents < 50_000) verdict = 'costs more of you than it earns';
    else verdict = 'earning its keep';

    const money = mrrCents === null ? 'I cannot see what it earns'
      : `earns about $${(mrrCents / 100).toFixed(0)} a month`;
    const cost = aiCostCents === 0 ? 'costs nothing in AI'
      : `costs about $${(aiCostCents / 100).toFixed(0)} a month in AI`;
    const him = interruptions === 0 ? 'has not needed you'
      : `needed you ${String(interruptions)} ${interruptions === 1 ? 'time' : 'times'}`;
    out.push({
      productId, name: String(c.name),
      form: c.form == null ? null : String(c.form), posture: String(c.posture),
      mrrCents, aiCostCents, interruptions, askedFor, verdict,
      sentence: (mrrCents === null
        ? `${String(c.name)} - I cannot see what it earns; it ${cost} and ${him} this month`
        : `${String(c.name)} ${money}, ${cost}, and ${him} this month`)
        + (verdict === 'earning its keep' ? '.' : ` - ${verdict}.`),
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
