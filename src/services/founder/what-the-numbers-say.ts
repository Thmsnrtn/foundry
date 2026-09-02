// =============================================================================
// FOUNDRY — what a company's numbers say
//
// THE OWNER ASKED TO SEE METRICS PER COMPANY, and was right to: an institution
// that cannot show you your own numbers is asking to be taken on faith. What he
// also said, twice, is that the old surfaces were "filled with way too much
// technicality" — so this is not a metrics table with a column per field.
//
// WHAT A NUMBER IS FOR HERE. One reading on its own tells an owner almost
// nothing; `new_mrr_cents: 418000` tells him less than nothing. What he can act
// on is WHERE IT IS AND WHICH WAY IT IS GOING, in the words a person uses. So
// every quantity comes back as a level, a direction over a month, and a
// sentence that says both.
//
// AND WHAT IT IS NOT FOR. This does not interpret, rank, or advise. "New
// revenue is down about a fifth since a month ago" is arithmetic on two
// readings the company reported. Whether that is a problem is a judgement, and
// judgement in this institution has to be earned and grounded elsewhere — it is
// not smuggled in through a label on a dashboard.
//
// ABSENCE IS A READING TOO. A company with no numbers gets a sentence saying
// so, not an empty grid or a zero. Foundry showing $0.00 for a company it
// cannot see would be stating something false in the most confident possible
// format.
// =============================================================================

import { query } from '../../db/client.js';
import { OBSERVABLE_FIELD_LABELS } from '../institution/external-shadowing.js';

/** The quantities worth putting in front of an owner, in the order they read. */
// WHICH WAY IS GOOD is stated per quantity, because a chart that colours every
// rise green would call rising churn good news. 'neutral' is for the ones
// where more is neither: support volume rising is load, not failure.
type Meaning = 'up_is_good' | 'down_is_good' | 'neutral';
const SHOWN: Array<{
  column: string; label: string; kind: 'money' | 'rate' | 'count'; meaning: Meaning;
}> = [
  { column: 'mrr_cents', label: 'monthly revenue', kind: 'money', meaning: 'up_is_good' },
  { column: 'new_mrr_cents', label: OBSERVABLE_FIELD_LABELS.new_mrr_cents ?? 'new revenue', kind: 'money', meaning: 'up_is_good' },
  { column: 'churned_mrr_cents', label: OBSERVABLE_FIELD_LABELS.churned_mrr_cents ?? 'revenue lost', kind: 'money', meaning: 'down_is_good' },
  { column: 'active_users', label: OBSERVABLE_FIELD_LABELS.active_users ?? 'people using it', kind: 'count', meaning: 'up_is_good' },
  { column: 'signups_7d', label: OBSERVABLE_FIELD_LABELS.signups_7d ?? 'new signups', kind: 'count', meaning: 'up_is_good' },
  { column: 'day_30_retention', label: OBSERVABLE_FIELD_LABELS.day_30_retention ?? 'retention', kind: 'rate', meaning: 'up_is_good' },
  { column: 'churn_rate', label: OBSERVABLE_FIELD_LABELS.churn_rate ?? 'how many leave', kind: 'rate', meaning: 'down_is_good' },
  { column: 'support_volume_7d', label: OBSERVABLE_FIELD_LABELS.support_volume_7d ?? 'support', kind: 'count', meaning: 'neutral' },
];

export interface CompanyNumber {
  label: string;
  /** The latest reading, formatted the way a person writes it. */
  now: string;
  /** 'rose' | 'fell' | 'held' | null when there is nothing to compare against. */
  direction: 'rose' | 'fell' | 'held' | null;
  /** A whole sentence, because a chart legend is not an explanation. */
  sentence: string;
  /** Short, for a tile: "up about 8% on a month ago" or "no comparison yet". */
  movement: string;
  /** Which way is good, so a tile colours honestly. */
  meaning: 'up_is_good' | 'down_is_good' | 'neutral';
  /** The last readings, oldest first, for a trend. Empty when fewer than three. */
  series: number[];
}

export interface CompanyNumbers {
  asOf: string | null;
  numbers: CompanyNumber[];
  /** Said out loud when there is nothing, rather than drawn as an empty grid. */
  absence: string | null;
}

function formatted(kind: 'money' | 'rate' | 'count', value: number): string {
  if (kind === 'money') {
    const dollars = value / 100;
    return dollars >= 1000
      ? `$${(dollars / 1000).toFixed(1)}k`
      : `$${dollars.toFixed(dollars < 100 ? 2 : 0)}`;
  }
  if (kind === 'rate') return `${(value * 100).toFixed(1)}%`;
  return value.toLocaleString('en-US');
}

/**
 * PROPORTION, NOT PERCENTAGE POINTS, and said the way people say it.
 *
 * "Up 19%" is what an owner means by a fifth more. Stating a rate's movement in
 * percentage points instead ("up 3 points") is more precise and reads as a
 * different, smaller thing — so both go through the same proportional form, and
 * the sentence says "about", because two readings do not support a decimal
 * place of confidence.
 */
function movement(previous: number, current: number): {
  direction: 'rose' | 'fell' | 'held'; phrase: string;
} {
  if (previous === 0 || !Number.isFinite(previous)) {
    return current === 0
      ? { direction: 'held', phrase: 'unchanged' }
      : { direction: current > 0 ? 'rose' : 'fell', phrase: 'newly reported' };
  }
  const change = (current - previous) / Math.abs(previous);
  const pct = Math.abs(change) * 100;
  if (pct < 1.5) return { direction: 'held', phrase: 'about the same as a month ago' };
  const size = `about ${pct < 10 ? pct.toFixed(0) : String(Math.round(pct / 5) * 5)}%`;
  return {
    direction: change > 0 ? 'rose' : 'fell',
    phrase: `${change > 0 ? 'up' : 'down'} ${size} on a month ago`,
  };
}

/**
 * What this company's numbers say, from what it has actually reported.
 *
 * Scoped to one company by id, so it is correct for a real company and a
 * reference company alike — which is the point of the reference world: the
 * surface has no special case, because there is nothing special about reading
 * numbers. What differs is where the numbers came from, and the page says that
 * above this rather than encoding it here.
 */
export async function whatTheNumbersSay(productId: string): Promise<CompanyNumbers> {
  const columns = SHOWN.map((s) => s.column);
  const latest = (await query(
    `SELECT snapshot_date, ${columns.join(', ')} FROM metric_snapshots
      WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1`, [productId]))
    .rows[0] as Record<string, unknown> | undefined;

  if (!latest) {
    return {
      asOf: null, numbers: [],
      absence: 'I cannot see any numbers for this company. Nothing reports to me about it '
        + 'yet, so anything I showed you here would be invented.',
    };
  }

  // A MONTH AGO MEANS THE NEAREST READING TO A MONTH AGO, not a reading dated
  // exactly then. Companies report on their own cadence, and a strict date
  // match silently produces "no comparison" for anyone reporting weekly.
  const prior = (await query(
    `SELECT ${columns.join(', ')} FROM metric_snapshots
      WHERE product_id = ? AND snapshot_date <= date(?, '-30 day')
      ORDER BY snapshot_date DESC LIMIT 1`,
    [productId, String(latest.snapshot_date)])).rows[0] as Record<string, unknown> | undefined;

  // THE LAST READINGS, for the trend beside each number. Bounded, oldest
  // first, and never more than the company actually reported.
  const history = ((await query(
    `SELECT ${columns.join(', ')} FROM metric_snapshots
      WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 30`, [productId]))
    .rows as unknown as Array<Record<string, unknown>>).reverse();

  const numbers: CompanyNumber[] = [];
  for (const spec of SHOWN) {
    const raw = latest[spec.column];
    if (raw == null) continue;
    const current = Number(raw);
    if (!Number.isFinite(current)) continue;

    const before = prior?.[spec.column];
    const now = formatted(spec.kind, current);
    const series = history.map((h) => Number(h[spec.column]))
      .filter((v) => Number.isFinite(v));
    if (before == null || !Number.isFinite(Number(before))) {
      numbers.push({
        label: spec.label, now, direction: null,
        sentence: `${spec.label} is ${now}. I have nothing from a month ago to compare it against.`,
        movement: 'no comparison yet', meaning: spec.meaning,
        series: series.length >= 3 ? series : [],
      });
      continue;
    }
    const moved = movement(Number(before), current);
    numbers.push({
      label: spec.label, now, direction: moved.direction,
      sentence: `${spec.label} is ${now}, ${moved.phrase}.`,
      movement: moved.phrase, meaning: spec.meaning,
      series: series.length >= 3 ? series : [],
    });
  }

  return {
    asOf: String(latest.snapshot_date),
    numbers,
    absence: numbers.length === 0
      ? 'A reading arrived, but none of the quantities I show were in it.'
      : null,
  };
}
