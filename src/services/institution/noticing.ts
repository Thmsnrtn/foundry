// =============================================================================
// FOUNDRY — noticing, without being told
//
// WHAT THE REFERENCE WORLD PROVED WAS MISSING. Run a company that is visibly
// coming apart past the institution — ten live observation channels, revenue
// down, churn up, support load up half again on a month ago — and it holds ZERO
// responsibilities, so nothing can be understood, nothing shadowed, nothing
// assisted. The whole ladder was reachable only from a door the owner had to
// open first by telling Foundry what to look after.
//
// An institution that only looks after what it was handed is a filing cabinet.
// This is the step before RECOGNITION: reading what a company's own numbers are
// doing and asking whether it is worth looking after.
//
// THE LINE THIS MUST NOT CROSS, and the reason the whole thing is a closed map
// rather than a model call. A movement is a fact; a diagnosis is not. "Support
// volume is up 45%" is arithmetic on two readings the company reported.
// "Support is not being handled" is a claim about the world that nobody
// observed, and an institution that quietly makes it has started inventing
// evidence. So every proposal here says the movement, names the readings it is
// derived from, and asks a question. It concludes nothing.
//
// AND IT GRANTS NOTHING. A candidate is non-executable by construction:
// promotion is a separate authenticated act, and the responsibility it becomes
// starts at `visible`, five rungs below anything that touches the world.
//
// WHY A DECLARED MAP AND NOT AN INFERENCE. Which direction is bad for a channel
// is a fact about what the channel MEANS — retention falling is bad, support
// volume falling is not — and meaning is not something to derive at runtime. It
// is written down, once, where it can be argued with.
// =============================================================================

import { query } from '../../db/client.js';
import { metricObservation } from './external-observation.js';
import { proposeResponsibilityCandidate } from './responsibility-candidate.js';

/**
 * A movement worth asking about, and the job it would be.
 *
 * `adverse` is the direction that would make an owner want someone looking at
 * it. `responsibility` is the job in the words a person would use for it — not
 * a metric name, and not a diagnosis.
 */
const WHAT_A_MOVEMENT_SUGGESTS: Array<{
  channel: string;
  adverse: 'rose' | 'fell';
  responsibility: string;
  capability: string;
  because: string;
}> = [
  {
    channel: 'support_volume_7d', adverse: 'rose',
    responsibility: 'keep the support queue answered',
    capability: 'customer_support',
    because: 'more is arriving than was arriving a month ago',
  },
  {
    channel: 'churned_mrr_cents', adverse: 'rose',
    responsibility: 'understand why customers are leaving',
    capability: 'customer_success',
    because: 'more revenue is walking out than a month ago',
  },
  {
    channel: 'churn_rate', adverse: 'rose',
    responsibility: 'understand why customers are leaving',
    capability: 'customer_success',
    because: 'a larger share of customers is leaving than a month ago',
  },
  {
    channel: 'day_30_retention', adverse: 'fell',
    responsibility: 'keep new customers past their first month',
    capability: 'customer_success',
    because: 'fewer of them are still here after a month than were a month ago',
  },
  {
    channel: 'activation_rate', adverse: 'fell',
    responsibility: 'get new people started',
    capability: 'customer_success',
    because: 'fewer of the people arriving are getting going than a month ago',
  },
  {
    channel: 'new_mrr_cents', adverse: 'fell',
    responsibility: 'keep new business coming in',
    capability: 'growth',
    because: 'less new revenue is arriving than a month ago',
  },
  {
    channel: 'signups_7d', adverse: 'fell',
    responsibility: 'keep new business coming in',
    capability: 'growth',
    because: 'fewer people are signing up than a month ago',
  },
  {
    channel: 'active_users', adverse: 'fell',
    responsibility: 'keep people using it',
    capability: 'growth',
    because: 'fewer people are using it than a month ago',
  },
];

/**
 * How much movement is worth an owner's attention.
 *
 * A DELIBERATE, ARGUABLE NUMBER. Too low and the institution asks about weather,
 * which is how an owner learns to stop reading it — the failure mode the
 * "steady and unremarkable" reference scenario exists to catch. Too high and it
 * only notices emergencies, by which time noticing was never the hard part.
 * A fifth, over a month, is a change a person would call a change.
 */
export const MATERIAL_MOVEMENT = 0.20;

/**
 * HOW MUCH FURTHER SOMETHING OFF-FOCUS HAS TO MOVE.
 *
 * When the owner has said what matters right now, that has to change something
 * or it was not steering. It does NOT silence everything else: an institution
 * that stops mentioning a revenue collapse because he said "focus on retention"
 * has obeyed the letter of an instruction nobody meant. So off-focus movement
 * is still raised — it just has to be twice as large to be worth the
 * interruption, which is roughly what a person means by "that matters more
 * than this right now".
 */
export const OFF_FOCUS_MULTIPLIER = 2;

export interface Noticed {
  channel: string;
  responsibility: string;
  movement: number;
  candidateId: string;
}

/**
 * Look at what a company's numbers have done over a month, and ask about the
 * ones that have moved adversely and materially.
 *
 * Deterministic, and refuses itself when the evidence is thin: a channel with
 * no observation has produced no independent evidence, and a channel with no
 * reading a month ago has nothing to compare against. Both are silence rather
 * than a guess.
 */
export async function noticeWhatTheNumbersAreDoing(productId: string): Promise<Noticed[]> {
  // Only channels this company has actually produced INDEPENDENT observations
  // on. A metric snapshot alone is the company's own report of itself; an
  // observation is the reading arriving from outside, and the ladder is built on
  // the second. Migration 223 makes the union safe: a company holds one channel.
  const live = new Set(((await query(
    `SELECT DISTINCT json_extract(payload_json,'$.field') AS field
       FROM signal_events WHERE product_id = ? AND ${metricObservation()}`, [productId]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => String(r.field)));
  if (live.size === 0) return [];

  const columns = [...new Set(WHAT_A_MOVEMENT_SUGGESTS.map((w) => w.channel))]
    .filter((ch) => live.has(ch));
  if (columns.length === 0) return [];

  const latest = (await query(
    `SELECT snapshot_date, ${columns.join(', ')} FROM metric_snapshots
      WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1`, [productId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!latest) return [];

  const prior = (await query(
    `SELECT ${columns.join(', ')} FROM metric_snapshots
      WHERE product_id = ? AND snapshot_date <= date(?, '-30 day')
      ORDER BY snapshot_date DESC LIMIT 1`,
    [productId, String(latest.snapshot_date)])).rows[0] as Record<string, unknown> | undefined;
  if (!prior) return [];

  // WHAT HE SAID THIS COMPANY IS FOR. Steering that changes nothing is not
  // steering, and the thing it should change is what is worth interrupting him
  // about — his attention being the scarcest thing this institution spends.
  const { objectiveFor } = await import('./standing-intent.js');
  const objective = await objectiveFor(productId);
  const focused = new Set(objective?.channels ?? []);

  const noticed: Noticed[] = [];
  for (const spec of WHAT_A_MOVEMENT_SUGGESTS) {
    if (!live.has(spec.channel)) continue;
    const now = Number(latest[spec.channel]);
    const then = Number(prior[spec.channel]);
    if (!Number.isFinite(now) || !Number.isFinite(then) || then === 0) continue;

    const change = (now - then) / Math.abs(then);
    const moved = change > 0 ? 'rose' : 'fell';
    if (moved !== spec.adverse) continue;
    const threshold = focused.size > 0 && !focused.has(spec.channel)
      ? MATERIAL_MOVEMENT * OFF_FOCUS_MULTIPLIER
      : MATERIAL_MOVEMENT;
    if (Math.abs(change) < threshold) continue;

    // The reading that carries this movement, so the candidate is grounded in a
    // signal event the guard already validated rather than in this function's
    // say-so. Without one there is no independent evidence and nothing is asked.
    const evidence = (await query(
      `SELECT id FROM signal_events
        WHERE product_id = ? AND ${metricObservation()}
          AND json_extract(payload_json,'$.field') = ?
        ORDER BY created_at DESC, rowid DESC LIMIT 1`, [productId, spec.channel]))
      .rows[0] as Record<string, unknown> | undefined;
    if (!evidence) continue;

    const percent = Math.round(Math.abs(change) * 100);
    const candidate = await proposeResponsibilityCandidate({
      productId,
      // ONE ASK PER JOB, EVER — keyed on the MEANING, not the channel, which is
      // what a convergence key is for. Churned revenue rising and churn rate
      // rising are two readings of one thing, and asking "understand why
      // customers are leaving" twice in one sitting is how an owner learns to
      // stop answering. The second channel converges on the candidate the first
      // one raised. And it is per company for good: a support load that climbs
      // every month for a year is asked about once.
      convergenceKey: `company_observation:${spec.responsibility.replaceAll(' ', '_')}`,
      proposedResponsibility: spec.responsibility,
      evidenceRefs: [{ kind: 'signal_event', id: String(evidence.id) }],
      // THE CAVEAT BELONGS TO THE KIND, NOT TO EACH ONE. Repeating "a movement,
      // not a diagnosis" inside every rationale put the same forty words under
      // every question on the company page, three times over, which is how a
      // careful sentence becomes noise a reader skips. It is a property of this
      // whole derivation, so it is stated once here — where the provenance
      // lives, and where a reconstruction reads it — and once on the page,
      // above all of them.
      derivationMethod:
        'observed movement over thirty days on an independent channel; a movement, '
        + 'not a diagnosis — it asks whether this is worth looking after and asserts '
        + 'nothing about why it moved',
      rationale:
        `${spec.because} — ${moved === 'rose' ? 'up' : 'down'} about ${String(percent)}% `
        + 'on a month ago.'
        // Said out loud when he asked for something else and this came anyway,
        // so a question that looks like a distraction explains itself.
        + (focused.size > 0 && !focused.has(spec.channel) && objective
          ? ` You told me to focus on something else, so I would not normally raise this — `
            + `it moved far enough that leaving it unsaid felt wrong.`
          : ''),
      // The MOVEMENT is known — it is arithmetic on two readings that arrived
      // from outside. What is being proposed from it is a question, and the
      // owner answers that, which is why this is a candidate and not a fact.
      epistemicStatus: 'known',
      capabilityDependency: spec.capability,
      // Recognition grants nothing. Whether Foundry may ever ACT on this is a
      // separate question asked much later, from a much higher rung.
      authorityRequired: false,
      observedAt: new Date(),
    });
    noticed.push({
      channel: spec.channel, responsibility: spec.responsibility,
      movement: change, candidateId: candidate.id,
    });
  }
  return noticed;
}
