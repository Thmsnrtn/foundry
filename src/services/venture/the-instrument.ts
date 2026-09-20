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
// WHAT THIS CAN AND CANNOT KNOW. The Workshop's health is a snapshot: the
// reading is of the path NOW, not of every hour the test was running. So the
// sentence says exactly that, and never asserts the path was down at the time.
// A per-day record of the reply path would let it say more; that is named as
// proof debt in MATURITY_MAP.md rather than assumed here.
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
  if (reply && reply.status !== 'healthy') {
    const when = w.health_at == null ? 'when last checked' : `when last checked, ${String(w.health_at).slice(0, 16).replace('T', ' ')}`;
    out.push({
      channel: 'reply',
      sentence: `${String(offers)} ${offers === 1 ? 'message' : 'messages'} went out under this test asking people to reply to ${String(w.contact_email)}, and that path was ${reply.status === 'unknown' ? 'unreadable' : 'not working'} ${when}${reply.detail ? ` (${reply.detail})` : ''}. I cannot say whether it was working while the test ran, because I keep no day-by-day record of it.`,
      doesNotEstablish: 'that nobody wanted to answer: a silence on a channel that may not have carried a reply is not the same evidence as a silence on one that did.',
    });
  }
  return out;
}

/** One sentence for a card, or null when the instrument raises no doubt. */
export async function instrumentCaveat(experimentId: string): Promise<string | null> {
  const doubts = await doubtsAboutTheInstrument(experimentId);
  return doubts.length === 0 ? null : doubts.map((d) => d.sentence).join(' ');
}
