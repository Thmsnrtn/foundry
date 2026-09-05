// =============================================================================
// FOUNDRY — from a situation to what followed
//
// The chain the owner named: situation → diagnosis → responsibility discovery →
// recommendation → bounded operation → outcome → learning. Every link before
// this file existed in isolation; none of them joined, because a diagnosis that
// is recomputed and forgotten cannot be followed by anything.
//
// WHAT EACH LINK IS, AND WHAT IT DELIBERATELY IS NOT.
//
//   recordSituation   turns a diagnosis into a SPELL — began here, ended there,
//                     became this. Written only when the answer CHANGES, so
//                     duration is arithmetic rather than narrative.
//
//   recommend         says what would be done about it, from a declared map,
//                     and says what it would NEED. A recommendation is not an
//                     act and cannot become one: where hands exist the act path
//                     is `proposed_acts` with its owner-bound approval; where
//                     they do not, accepting records agreement and nothing
//                     happens. Blurring those would let "good idea" become
//                     "go ahead".
//
//   whatFollowed      is the honest form of learning. It reports what happened
//                     after a kind of recommendation — raised, accepted, and
//                     whether the situation ended — AND SAYS THAT IS NOT CAUSE.
//                     An institution that told its owner "this worked" from six
//                     observations with no control would be manufacturing the
//                     one thing it cannot observe.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { whatSituation, type Situation } from './what-situation.js';

// ─── the spell ───────────────────────────────────────────────────────────────

export interface Spell {
  id: string; situation: Situation; headline: string; because: string[];
  evidenceMode: 'real' | 'sandbox' | 'reference';
  beganAt: string; days: number;
}

/** The situation this company is in now, and since when. */
export async function currentSpell(productId: string): Promise<Spell | null> {
  const row = (await query(
    `SELECT id, situation, headline, because_json, evidence_mode, began_at,
            CAST(julianday('now') - julianday(began_at) AS INTEGER) AS days
       FROM company_situations
      WHERE product_id = ? AND ended_at IS NULL`, [productId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id), situation: String(row.situation) as Situation,
    headline: String(row.headline),
    because: JSON.parse(String(row.because_json)) as string[],
    evidenceMode: String(row.evidence_mode) as Spell['evidenceMode'],
    beganAt: String(row.began_at).slice(0, 10), days: Math.max(0, Number(row.days)),
  };
}

/**
 * Diagnose, and remember it if it has changed.
 *
 * Returns the spell in force afterwards. Called from the daily tick and from
 * the company page, and idempotent by construction: an unchanged answer writes
 * nothing, so reading the page a hundred times leaves one row.
 */
export async function recordSituation(productId: string): Promise<Spell> {
  const read = await whatSituation(productId);
  const open = await currentSpell(productId);
  if (open && open.situation === read.situation) return open;

  const reality = String(((await query(
    'SELECT reality FROM products WHERE id = ?', [productId]))
    .rows[0] as Record<string, unknown> | undefined)?.reality ?? 'real');

  // The evidence's own mode, not the company's: a real company reading a
  // provider's test mode is in a situation diagnosed from numbers that are not
  // the world's, and a portfolio roll-up has to be able to say so.
  const { channelFor } = await import('../senses/index.js');
  const evidenceMode = reality === 'reference'
    ? 'reference' : (await channelFor(productId)).mode;

  // TWO LOADS OF THE SAME PAGE ARE NOT A SERIAL PAIR.
  //
  // This function is called on every render of a company page, and it writes.
  // The doc above says it is "idempotent by construction: an unchanged answer
  // writes nothing", which is true one call at a time and says nothing about
  // two in flight. A double-tapped link on a phone, or the page opened in two
  // tabs, sends two — and the database is right to refuse the second, because
  // migration 230 enforces one open spell per company.
  //
  // The refusal was reaching the owner as a failed page load of a screen that
  // only reads. So the loser of the race now returns the winner's spell, which
  // is the correct answer anyway: the situation it was about to record is the
  // situation that got recorded, by the other request, a millisecond earlier.
  // The database guarantee stays exactly where it is.
  const id = nanoid();
  try {
    if (open) {
      await query(
        `UPDATE company_situations SET ended_at = datetime('now'), ended_as = ?
          WHERE id = ?`, [read.situation, open.id]);
    }
    await query(
      `INSERT INTO company_situations
         (id, product_id, situation, headline, because_json, evidence_mode)
       VALUES (?,?,?,?,?,?)`,
      [id, productId, read.situation, read.headline,
        JSON.stringify(read.because), evidenceMode]);
  } catch (err) {
    const raced = await currentSpell(productId);
    if (raced) return raced;
    throw err;
  }
  return {
    id, situation: read.situation, headline: read.headline, because: read.because,
    evidenceMode: evidenceMode as Spell['evidenceMode'],
    beganAt: new Date().toISOString().slice(0, 10), days: 0,
  };
}

/** Every spell this company has been through, newest first. */
export interface PastSpell {
  situation: string; beganAt: string; endedAt: string; becameWhat: string; days: number;
}

export async function spellHistory(productId: string, limit = 6): Promise<PastSpell[]> {
  return ((await query(
    `SELECT situation, began_at, ended_at, ended_as,
            CAST(julianday(ended_at) - julianday(began_at) AS INTEGER) AS days
       FROM company_situations
      WHERE product_id = ? AND ended_at IS NOT NULL
      ORDER BY ended_at DESC, rowid DESC LIMIT ?`, [productId, limit]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    situation: String(r.situation), beganAt: String(r.began_at).slice(0, 10),
    endedAt: String(r.ended_at).slice(0, 10), becameWhat: String(r.ended_as),
    days: Math.max(0, Number(r.days)),
  }));
}

// ─── what would be done about it ─────────────────────────────────────────────

/**
 * WHAT A SITUATION CALLS FOR, DECLARED RATHER THAN INFERRED.
 *
 * Same posture as `noticing`'s map of which direction is adverse: what to do
 * about a falling revenue line is a judgement someone should be able to argue
 * with, written down once, not derived at runtime by a model that will phrase
 * it differently each week.
 *
 * `wouldNeed` is the honest half. Most of these need something Foundry does not
 * have — a sense it cannot see through, an authority it has not earned — and
 * saying so converts "here is what I would do" from a boast into a request.
 */
interface Recommendation {
  kind: string; summary: string; why: string; wouldNeed: string;
}

const WHAT_TO_DO: Record<string, Recommendation[]> = {
  revenue_falling: [
    { kind: 'find_where_it_is_leaving',
      summary: 'Work out whether this is fewer new customers or more leaving',
      why: 'those are different problems with opposite fixes, and the headline '
        + 'number cannot tell them apart',
      wouldNeed: 'nothing — I can do this from the readings I already have' },
    { kind: 'talk_to_the_ones_who_left',
      summary: 'Ask the customers who left recently why they did',
      why: 'the reason revenue is falling is usually something a handful of '
        + 'people would tell you plainly, and nothing in the numbers will',
      wouldNeed: 'permission to contact them, which is a separate question I '
        + 'would ask before sending anything' },
  ],
  churning: [
    { kind: 'find_when_they_leave',
      summary: 'Find out how long customers stay before they go',
      why: 'if they leave in the first month it is onboarding; if they leave '
        + 'after a year it is value. The fix is different either way',
      wouldNeed: 'nothing — I can do this from the readings I already have' },
    { kind: 'talk_to_the_ones_who_left',
      summary: 'Ask the customers who left recently why they did',
      why: 'churn is the one number where the people who could explain it have '
        + 'already gone, so asking has a short window',
      wouldNeed: 'permission to contact them, asked separately' },
  ],
  growth_not_converting: [
    { kind: 'find_where_they_stop',
      summary: 'Find the step where the new arrivals stop',
      why: 'more people arriving and no more revenue means they are stopping '
        + 'somewhere specific, and it is usually one step',
      wouldNeed: 'to see what people do in the product — I cannot yet' },
    { kind: 'check_who_is_arriving',
      summary: 'Check whether the new arrivals are the kind who ever pay',
      why: 'a channel that brings the wrong people looks exactly like growth '
        + 'until you look at what they do next',
      wouldNeed: 'to see what people do in the product — I cannot yet' },
  ],
  payments_failing: [
    { kind: 'recover_the_failed_payments',
      summary: 'Chase the payments that failed, in order of how much they are worth',
      why: 'this is revenue you have already earned, and most failed payments '
        + 'recover if someone asks within a few days',
      wouldNeed: 'permission to contact those customers, asked separately' },
    { kind: 'find_why_they_fail',
      summary: 'Find out whether these are expired cards or something systematic',
      why: 'expired cards are a dunning problem; a spike that started on one day '
        + 'is usually a change somebody made',
      wouldNeed: 'to see your payments provider — I cannot yet' },
  ],
  blind: [
    { kind: 'restore_the_sense',
      summary: 'Reconnect what stopped reporting',
      why: 'everything I would otherwise tell you about this company is as old '
        + 'as the last reading, and I would rather say so than show you stale '
        + 'numbers with a confident face',
      wouldNeed: 'nothing from you unless the connection needs re-authorising' },
  ],
  conflicting: [
    { kind: 'settle_which_source_is_right',
      summary: 'Decide which source to believe about this quantity',
      why: 'I will not average two numbers that contradict each other — that '
        + 'produces a third nobody reported and hides the disagreement',
      wouldNeed: 'you to tell me which source is authoritative here' },
  ],
  unknown: [
    { kind: 'connect_something',
      summary: 'Let me see one thing about this company',
      why: 'I can reason about very little and invent nothing, so until '
        + 'something reports I have no honest answer to any question about it',
      wouldNeed: 'one connection — revenue is usually the one that pays for '
        + 'itself first' },
  ],
  // Deliberately empty. A company that is fine does not need advice, and an
  // institution that produces some anyway is one the owner learns to skim.
  steady: [],
  growing: [],
};

export interface RaisedRecommendation extends Recommendation {
  id: string; raisedAt: string; decision: 'accepted' | 'declined' | null;
}

/**
 * Raise what this situation calls for, once per spell.
 *
 * Idempotent: the unique index makes a second raise of the same kind against
 * the same spell a no-op, so the daily tick does not accumulate advice.
 */
export async function recommendFor(productId: string): Promise<RaisedRecommendation[]> {
  const spell = await currentSpell(productId);
  if (!spell) return [];
  for (const rec of WHAT_TO_DO[spell.situation] ?? []) {
    try {
      await query(
        `INSERT INTO situation_recommendations
           (id, situation_id, product_id, kind, summary, why, would_need)
         VALUES (?,?,?,?,?,?,?)`,
        [nanoid(), spell.id, productId, rec.kind, rec.summary, rec.why, rec.wouldNeed]);
    } catch { /* already raised for this spell */ }
  }
  return openRecommendations(productId);
}

export async function openRecommendations(
  productId: string,
): Promise<RaisedRecommendation[]> {
  return ((await query(
    `SELECT r.id, r.kind, r.summary, r.why, r.would_need, r.raised_at, r.decision
       FROM situation_recommendations r
       JOIN company_situations s ON s.id = r.situation_id
      WHERE r.product_id = ? AND s.ended_at IS NULL AND r.decision IS NULL
      ORDER BY r.rowid`, [productId]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), kind: String(r.kind), summary: String(r.summary),
    why: String(r.why), wouldNeed: String(r.would_need),
    raisedAt: String(r.raised_at).slice(0, 10),
    decision: r.decision == null ? null : String(r.decision) as 'accepted' | 'declined',
  }));
}

export async function decideRecommendation(input: {
  id: string; decision: 'accepted' | 'declined'; decidedBy: string;
}): Promise<void> {
  await query(
    `UPDATE situation_recommendations
        SET decision = ?, decided_by = ?, decided_at = datetime('now')
      WHERE id = ? AND decision IS NULL`,
    [input.decision, input.decidedBy, input.id]);
}

// ─── what followed ───────────────────────────────────────────────────────────

export interface WhatFollowed {
  kind: string; raised: number; accepted: number;
  /** Of the accepted ones, how many were followed by the situation ending. */
  situationEndedAfter: number;
  /** Said out loud, every time. */
  caveat: string;
}

/**
 * THE HONEST FORM OF LEARNING.
 *
 * An institution that told its owner "this worked" from six observations with
 * no control would be manufacturing the one thing it cannot observe. What it
 * CAN say is what happened afterwards, and that it does not know why — and the
 * caveat travels with the number rather than living in a footnote somebody
 * removes.
 *
 * Counted across real companies only. What followed a recommendation in the
 * reference world is a fact about a company that does not exist, and letting it
 * into this number would make the institution's own track record synthetic.
 */
export async function whatFollowed(kind: string): Promise<WhatFollowed> {
  const { realCompany } = await import('../../db/client.js');
  const row = (await query(
    `SELECT COUNT(*) AS raised,
            SUM(CASE WHEN r.decision = 'accepted' THEN 1 ELSE 0 END) AS accepted,
            SUM(CASE WHEN r.decision = 'accepted' AND s.ended_at IS NOT NULL
                     THEN 1 ELSE 0 END) AS ended
       FROM situation_recommendations r
       JOIN company_situations s ON s.id = r.situation_id
       JOIN products p ON p.id = r.product_id
      WHERE r.kind = ? AND p.standing = 'earned' AND ${realCompany('p')}`, [kind]))
    .rows[0] as Record<string, unknown>;
  return {
    kind, raised: Number(row.raised ?? 0), accepted: Number(row.accepted ?? 0),
    situationEndedAfter: Number(row.ended ?? 0),
    caveat: 'That is what happened afterwards. I do not know that it was the '
      + 'cause, and I will not say so until something could tell us.',
  };
}
