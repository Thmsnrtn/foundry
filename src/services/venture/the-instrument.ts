// =============================================================================
// WAS THE INSTRUMENT WORKING WHEN THE WORLD WAS ASKED?
//
// A returning owner found the defect this file exists for, and it is the worst
// one the campaign has turned up. Nineteen cold emails went to strangers as
// thomas@apexmicro.ai, every one of them inviting a reply. The Workshop's
// reply path was not routed. Seven days later the sealed rule settled the test
// SURPRISED — nobody bought — and the institution filed that as evidence about
// a market.
//
// Nothing was fabricated and no rule was broken: the rule counts confirmed
// deliveries and payments, and there were none. The failure is upstream of
// every safeguard the institution has. A null result is only evidence about
// the world if the world could have answered. The channel that carries the
// answer is part of the instrument, and an instrument that was broken while
// the question was asked makes the result say less than it appears to.
//
// So: what the offer invited, and whether that path can carry it, is read here
// and said wherever the outcome is said. This never changes a verdict — the
// sealed rule is the sealed rule, and rewriting a settled result to suit a
// later discovery is exactly the thing the seal prevents. It changes what the
// result is claimed to ESTABLISH, which is the institution's own claim and is
// its to correct.
//
// WHAT THIS CAN AND CANNOT KNOW. It reads two things and keeps them apart.
// `public_workshop.health_json` is a snapshot — the path NOW — and until
// migration 327 it was all there was, so the sentence could only say "I cannot
// say whether it was working while the test ran". `public_channel_days` keeps
// the worst reading of each path on each day, so for days it covers the answer
// is a fact. For days before it existed there is no row, and NO ROW IS NOT A
// HEALTHY DAY: the sentence says how many of the test's days are unrecorded
// rather than counting them as well.
// =============================================================================

import { query } from '../../db/client.js';

type Row = Record<string, unknown>;

export interface InstrumentDoubt {
  /** The channel the offer asked the world to answer through. */
  channel: 'reply' | 'payment';
  /** In the owner's words: what is wrong with it, and what that costs the reading. */
  sentence: string;
  /** What the result therefore does not establish, appended to the outcome's own limit. */
  doesNotEstablish: string;
  /** Days of the test's own window on which the path was recorded as not working. */
  daysBroken: number;
  /** Days of that window with no record at all: unknown, and never counted as well. */
  daysUnrecorded: number;
}

/** The days a test was actually asking the world: from its first offer to its answer. */
async function theWindow(experimentId: string): Promise<{ from: string; to: string; days: number } | null> {
  const r = (await query(
    `SELECT date(MIN(o.executed_at)) AS from_day,
            date(COALESCE(MAX(e.ran_at), 'now')) AS to_day,
            CAST(julianday(date(COALESCE(MAX(e.ran_at), 'now'))) - julianday(date(MIN(o.executed_at))) AS INTEGER) + 1 AS days
       FROM outbound_actions o JOIN venture_experiments e ON e.id = o.experiment_id
      WHERE o.experiment_id = ? AND o.experiment_act = 'offer' AND o.status = 'executed'`,
    [experimentId])).rows[0] as Row | undefined;
  if (!r || r.from_day == null) return null;
  return { from: String(r.from_day), to: String(r.to_day), days: Math.max(1, Number(r.days ?? 1)) };
}

/** What the day-by-day record says about one path across a test's window. */
async function acrossTheWindow(founderId: string, channel: string, w: { from: string; to: string; days: number }): Promise<{ broken: number; recorded: number; worstDetail: string | null }> {
  const rows = (await query(
    `SELECT day, worst_status, detail FROM public_channel_days
      WHERE founder_id = ? AND channel = ? AND day >= ? AND day <= ?`,
    [founderId, channel, w.from, w.to])).rows as unknown as Row[];
  const broken = rows.filter((r) => String(r.worst_status) === 'needs_attention');
  return { broken: broken.length, recorded: rows.length, worstDetail: broken[0]?.detail == null ? null : String(broken[0].detail) };
}

/**
 * What stands between this test's question and an answer, as far as the
 * records can say. Empty when the paths it used are working, which is the
 * ordinary case and says nothing.
 */
export async function doubtsAboutTheInstrument(experimentId: string): Promise<InstrumentDoubt[]> {
  const e = (await query(
    `SELECT e.founder_id, e.ran_at,
            (SELECT COUNT(*) FROM outbound_actions o WHERE o.experiment_id = e.id AND o.experiment_act = 'offer' AND o.status = 'executed') AS offers
       FROM venture_experiments e WHERE e.id = ?`, [experimentId])).rows[0] as Row | undefined;
  if (!e) return [];
  const offers = Number(e.offers ?? 0);
  if (offers === 0) return [];

  const out: InstrumentDoubt[] = [];
  const w = (await query(
    'SELECT contact_email, health_json, health_at FROM public_workshop WHERE founder_id = ?', [String(e.founder_id)]))
    .rows[0] as Row | undefined;
  if (!w) return out;
  const health = w.health_json == null ? null
    : JSON.parse(String(w.health_json)) as Record<string, { status: string; detail: string }>;
  const reply = health?.replyInbox;
  // AN OFFER THAT INVITES A REPLY NEEDS A PATH THAT CARRIES ONE. 'unknown' is
  // not 'healthy': a path nobody can read is a path nobody can vouch for.
  const window = await theWindow(experimentId);
  const record = window ? await acrossTheWindow(String(e.founder_id), 'replyInbox', window) : null;
  const daysBroken = record?.broken ?? 0;
  const daysUnrecorded = window ? window.days - (record?.recorded ?? 0) : 0;
  const brokenNow = !!reply && reply.status !== 'healthy';
  if (brokenNow || daysBroken > 0) {
    const asked = `${String(offers)} ${offers === 1 ? 'message' : 'messages'} went out under this test asking people to reply to ${String(w.contact_email)}`;
    // WHAT THE RECORD ESTABLISHES, said as a fact; what it does not, said as
    // an absence. A day with no row is not a day that was well.
    const then = daysBroken > 0
      ? `That path was not working on ${String(daysBroken)} of the ${String(window?.days ?? daysBroken)} days the test was asking${record?.worstDetail ? ` (${record.worstDetail})` : ''}`
      : `I have no day-by-day record of that path while the test was asking`;
    const now = brokenNow
      ? `, and it is ${reply.status === 'unknown' ? 'unreadable' : 'not working'} now${reply.detail ? ` (${reply.detail})` : ''}`
      : ', though it is working now';
    const unrecorded = daysUnrecorded > 0 && window
      ? ` ${String(daysUnrecorded)} of those days ${daysUnrecorded === 1 ? 'has' : 'have'} no record at all, and I do not count a day I did not watch as a day that was well.`
      : '';
    out.push({
      channel: 'reply',
      sentence: `${asked}. ${then}${now}.${unrecorded}`,
      doesNotEstablish: 'that nobody wanted to answer: a silence on a channel that may not have carried a reply is not the same evidence as a silence on one that did.',
      daysBroken, daysUnrecorded,
    });
  }
  return out;
}

/** One sentence for a card, or null when the instrument raises no doubt. */
export async function instrumentCaveat(experimentId: string): Promise<string | null> {
  const doubts = await doubtsAboutTheInstrument(experimentId);
  return doubts.length === 0 ? null : doubts.map((d) => d.sentence).join(' ');
}
