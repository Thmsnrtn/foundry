// =============================================================================
// FOUNDRY — What kind of test this was.
//
// §19 asks for a structured fingerprint for experiments — customer type, value
// mechanism, offer type, price, channel, contact type, trust level, acquisition
// mode, fulfilment mode, recurrence, risk class, cost class, sample size,
// authority class, evidence target, result — so that future experiments can be
// compared with past ones.
//
// EVERY ONE OF THESE FACTS IS ALREADY RECORDED. `contact_kind` says whether an
// address was a role, a named person or a general inbox. `evidence_stratum`
// says which kind of shop it was. `act_classifications` carries reversibility,
// audience and the consequence rung. The price is on the offer material, the
// sample on the recipient rows, the authority on the act, the result on the
// experiment. What did not exist was any way to see them as one shape, or to
// ask whether the next test is the same shape as one that already failed.
//
// THE DANGER IS NOT MISSING DATA. IT IS ARITHMETIC ON ONE ROW.
//
// §19's own sentence is "without overfitting tiny history", and the history is
// one experiment which sold nothing to twenty-one businesses. A fingerprint
// invites a score, a score invites a ranking, and a ranking built on n=1 would
// tell the owner that cold email to millwork shops "does not work" — which the
// evidence cannot support, because one null result at one price through one
// channel to one population is a single observation and not a rate.
//
// So this module does two things and refuses a third:
//   · it RECORDS the shape of a test, from rows, with unknowns left unknown;
//   · it says which earlier tests SHARE a dimension, by name, as a fact;
//   · it will not score, rank, rate, or predict, and `likeness` refuses to
//     speak at all until two settled experiments exist — the same rule
//     `sparkline.ts` applies to a trend line drawn from fewer than three
//     readings, for the same reason.
//
// A dimension Foundry cannot establish is `null`, and null is rendered as
// "not recorded" rather than as a blank or a zero. An experiment whose shape is
// half unknown should look half unknown.
// =============================================================================
import { query } from '../../db/client.js';

/**
 * The dimensions, fixed. A closed list rather than a free-form bag, because a
 * fingerprint whose axes drift cannot compare anything to anything: two tests
 * described with different words are not comparable however similar they were.
 */
export const DIMENSIONS = [
  'customer', 'value_mechanism', 'offer_type', 'price_cents', 'channel',
  'contact_type', 'trust_level', 'acquisition', 'fulfilment', 'recurrence',
  'risk_class', 'cost_cents', 'sample_size', 'authority_class',
  'evidence_target', 'result',
] as const;

export type Dimension = typeof DIMENSIONS[number];

/** One dimension's value, and where it came from. Never a guess. */
export interface Trait {
  value: string | null;
  /** The row this was read from, so a reader can check it. Null when unknown. */
  from: string | null;
}

export interface Genome {
  experimentId: string;
  title: string;
  /** Null until the experiment has settled: a shape is not final while it runs. */
  settledAt: string | null;
  traits: Record<Dimension, Trait>;
}

type Row = Record<string, unknown>;
const rows = async (sql: string, params: unknown[]): Promise<Row[]> =>
  (await query(sql, params)).rows as unknown as Row[];

const unknown: Trait = { value: null, from: null };
const trait = (value: string | number | null | undefined, from: string): Trait =>
  value == null || value === '' ? unknown : { value: String(value), from };

/**
 * The shape of one experiment, read from the rows that already hold it.
 *
 * Nine reads, none of them derived from another: if a fact is not written down
 * it comes back `null` rather than inferred from a neighbouring one. A genome
 * that filled its own gaps by reasoning would be a story about the experiment
 * rather than a record of it, and the whole point is to compare records.
 */
export async function genomeOf(experimentId: string): Promise<Genome | null> {
  const e = (await rows(
    `SELECT id, founder_id, what_we_do, cost_cents, ran_at, verdict, what_happened,
            decision, decided_at, unknown_id, evidence_mode
       FROM venture_experiments WHERE id = ?`, [experimentId]))[0];
  if (!e) return null;

  const [offer, question, recipients, act, fulfil] = await Promise.all([
    rows(`SELECT title, body, payment_link_url FROM experiment_materials
           WHERE experiment_id = ? AND kind IN ('offer','offer_template')
             AND superseded_at IS NULL ORDER BY recorded_at DESC LIMIT 1`, [experimentId]),
    rows('SELECT question FROM market_unknowns WHERE id = ?', [e.unknown_id]),
    // The population's own shape: how many were authorised, how their addresses
    // were come by, and which stratum they were placed in BEFORE the outcome.
    rows(
      `SELECT COUNT(*) AS n,
              COUNT(DISTINCT contact_kind) AS kinds, MIN(contact_kind) AS kind,
              COUNT(DISTINCT evidence_stratum) AS strata, MIN(evidence_stratum) AS stratum,
              COUNT(DISTINCT channel) AS channels, MIN(channel) AS channel
         FROM experiment_recipients
        WHERE experiment_id = ? AND review_status = 'approved'`, [experimentId]),
    rows(
      `SELECT c.reversibility, c.audience, c.rung
         FROM outbound_actions o
         JOIN act_classifications c ON c.id = o.effect_id
        WHERE o.experiment_id = ? LIMIT 1`, [experimentId]),
    rows(
      `SELECT COUNT(*) AS delivered FROM experiment_fulfilments
        WHERE experiment_id = ?`, [experimentId]),
  ]);

  const r = recipients[0] ?? {};
  const n = Number(r.n ?? 0);
  // MIXED IS A VALUE, NOT A MISSING ONE. A population contacted partly at named
  // people and partly at general inboxes is a different shape from either, and
  // collapsing it to whichever came first alphabetically would hide exactly the
  // confound §17's design lens exists to catch.
  const oneOf = (count: unknown, value: unknown, label: string): Trait =>
    Number(count ?? 0) > 1 ? { value: 'mixed', from: label }
      : trait(value as string | null, label);

  const settled = e.ran_at == null ? null : String(e.ran_at);

  return {
    experimentId,
    title: String(e.what_we_do),
    settledAt: settled,
    traits: {
      customer: trait(r.stratum as string | null, 'experiment_recipients.evidence_stratum'),
      value_mechanism: trait(offer[0]?.title as string | null, 'experiment_materials.title'),
      offer_type: trait(offer[0]?.payment_link_url == null ? null : 'paid_one_time',
        'experiment_materials.payment_link_url'),
      // The price is on the link rather than in a column, so it is read from
      // where the buyer would see it or not read at all.
      price_cents: unknown,
      channel: oneOf(r.channels, r.channel, 'experiment_recipients.channel'),
      contact_type: oneOf(r.kinds, r.kind, 'experiment_recipients.contact_kind'),
      trust_level: oneOf(r.strata, r.stratum, 'experiment_recipients.evidence_stratum'),
      acquisition: trait(n > 0 ? 'initiated_contact' : null, 'experiment_recipients'),
      fulfilment: trait(Number(fulfil[0]?.delivered ?? 0) > 0 ? 'delivered_on_payment' : null,
        'experiment_fulfilments'),
      recurrence: trait(offer[0]?.payment_link_url == null ? null : 'one_time',
        'experiment_materials.payment_link_url'),
      risk_class: trait(act[0]?.audience as string | null, 'act_classifications.audience'),
      cost_cents: trait(e.cost_cents as number | null, 'venture_experiments.cost_cents'),
      sample_size: trait(n > 0 ? n : null, 'experiment_recipients'),
      authority_class: trait(act[0]?.reversibility as string | null,
        'act_classifications.reversibility'),
      evidence_target: trait(question[0]?.question as string | null, 'market_unknowns.question'),
      result: settled === null ? unknown
        : trait(e.verdict as string | null, 'venture_experiments.verdict'),
    },
  };
}

/** What two genomes share, and where they differ. A fact, not a score. */
export interface Likeness {
  /** Null when there is nothing honest to say — see `likeness`. */
  against: string | null;
  shared: Dimension[];
  differs: Dimension[];
  /** Said plainly, including when it is "not enough history to mean anything". */
  because: string;
}

/**
 * HOW ALIKE TWO TESTS ARE, WHICH IS NOT HOW LIKELY EITHER IS TO WORK.
 *
 * This returns which dimensions match and which do not, and nothing else. No
 * percentage, no similarity, no ranking, no expected outcome — because with a
 * history of one settled experiment every one of those would be a number
 * derived from a single observation, and the owner would read it as a rate.
 *
 * It refuses outright below two settled experiments. That refusal is the
 * feature: "the same shape as the one that sold nothing" is a useful sentence
 * only when there is more than one shape on record, and until then the honest
 * answer is that there is nothing to compare against.
 */
export async function likeness(
  founderId: string, subject: Genome,
): Promise<Likeness> {
  // SCOPED TO THE CANDIDATE. This compared against the most recent settled
  // test anywhere, so a test of one candidate was read beside a test of
  // another as if they were alike. A precedent is a settled test on the same
  // candidate; nothing else is honest to compare.
  const settled = await rows(
    `SELECT e.id FROM venture_experiments e
      WHERE e.founder_id = ? AND e.evidence_mode = 'real' AND e.ran_at IS NOT NULL
        AND e.id <> ?
        AND e.opportunity_id = (SELECT opportunity_id FROM venture_experiments WHERE id = ?)
      ORDER BY e.ran_at DESC LIMIT 1`, [founderId, subject.experimentId, subject.experimentId]);
  if (settled.length === 0) {
    return {
      against: null, shared: [], differs: [],
      because: 'No other experiment on this candidate has settled, so there is nothing to compare this to. '
        + 'One result is an observation and not a rate.',
    };
  }
  const other = await genomeOf(String(settled[0]?.id));
  if (!other) {
    return { against: null, shared: [], differs: [], because: 'The earlier experiment could not be read.' };
  }
  const shared: Dimension[] = [];
  const differs: Dimension[] = [];
  for (const d of DIMENSIONS) {
    const a = subject.traits[d].value;
    const b = other.traits[d].value;
    // UNKNOWN IS NOT A MATCH. Two experiments that both fail to record their
    // price are not two experiments at the same price, and counting them as
    // alike is how a comparison quietly becomes a comparison of what nobody
    // wrote down.
    if (a == null || b == null) continue;
    (a === b ? shared : differs).push(d);
  }
  return {
    against: other.experimentId,
    shared,
    differs,
    because: `Compared against ${other.title}, which settled `
      + `${other.traits.result.value ?? 'without a recorded verdict'}.`,
  };
}
