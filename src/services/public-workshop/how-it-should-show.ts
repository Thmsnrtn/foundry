// =============================================================================
// FOUNDRY — how much of itself an asset should show, and why
//
// APEX MICRO IS THE PORTFOLIO HOME AND NOT THE STOREFRONT. The owner's words:
// Private Foundry carries the intelligence and the operating work and stays
// private; Apex Micro is the public business identity, credible enough that
// somebody can tell who is responsible for an offer; and each asset reaches
// customers through whatever channel suits its actual economic mechanism. A
// template sold on Etsy is discovered, bought and delivered on Etsy. Apex Micro
// says what it is and who stands behind it, and links there.
//
// THE CODE WAS ALREADY CLOSER TO THIS THAN IT LOOKED. The membrane was never a
// storefront — payment has always been an off-site link, and no rule anywhere
// requires an asset to have a page. What it had was exactly ONE SHAPE: the full
// six-section product page, or nothing at all. Experiment 002 sells a workbook
// on Etsy today and has no presence on the site whatsoever, because the only
// available answer to "represent it somehow" was "publish the whole offer".
//
// SO THIS IS A JUDGEMENT, AND IT IS NOT A LADDER.
//
// The five shapes below are not stages and nothing progresses through them. An
// asset may sit at `portfolio_entry` for its whole life and that is a complete,
// correct answer, not an arrested one. There is no ordering here, no score, no
// index, and no comparison between two shapes — a reviewer should be able to
// grep this file for a number and find none. The owner was explicit that a
// scoring system is the wrong instrument, and the reason is the same one that
// keeps every other judgement in this institution unscored: a number invites
// the reader to optimise it, and what is wanted is a decision somebody can
// argue with.
//
// TWO RULES DECIDE THE HARD CASES.
//
//   1. AN OWNER'S `never` IS DECISIVE AND IS NEVER REASONED AROUND. If he has
//      said Foundry publishes nothing for this thing, the answer is
//      `not_public`, whatever else the rows say. Capability is not authority,
//      and a clarification about product strategy does not quietly lift a
//      boundary he set by name.
//
//   2. UNCERTAINTY GOES LESS PUBLIC, NEVER MORE. Where the rows do not settle
//      it, `cannotTell` says so and the shape falls back to the smallest
//      honest answer. This is the same direction `workshopFacts` already takes
//      with `replyRouteProven` — false unless shown — and it is the right
//      direction for a default to fail in when the failure is published.
// =============================================================================

import { query } from '../../db/client.js';
import { offerShapePlanOf } from '../venture/hand.js';
import { boundariesFor } from '../institution/standing-intent.js';

/**
 * WHAT AN ASSET SHOWS OF ITSELF. Possible shapes, chosen for a reason — not a
 * sequence, and deliberately not ordered.
 */
export type PublicShape =
  /** It never reached a prospective customer, or the owner has forbidden it. Nothing is published. */
  | 'not_public'
  /** The channel carries everything; Apex Micro's job is to be findable as the business behind it. */
  | 'identity_only'
  /** A short entry: what it is, who it is for, who is responsible, and where it actually lives. */
  | 'portfolio_entry'
  /** The Workshop's page is where a customer learns what they are buying. */
  | 'product_page'
  /** It warrants its own site or documentation, with Apex Micro named as responsible. */
  | 'own_presence';

export interface HowItShouldShow {
  shape: PublicShape;
  /** The rows that decided it, named. Never an adjective on its own. */
  because: string[];
  /**
   * What this shape owes a customer whatever its depth. A portfolio entry is
   * short; it is not allowed to be short about who took the money.
   */
  mustCarry: string[];
  /** Said out loud rather than defaulted past. Null when the rows settled it. */
  cannotTell: string | null;
  /**
   * HIS OWN WORD ON PUBLISHING THIS, SEPARATED FROM EVERY OTHER REASON A SHAPE
   * MIGHT BE SMALL — AND THE ONLY THING THE PUBLISHING PASS HOLDS ON.
   *
   * A review found the first version of this file asserting in its own header
   * that an owner's word is decisive while nothing on the path that puts bytes
   * on the internet consulted it: the guarantee was a comment. Making it a
   * rule then over-reached in the other direction, because `shape` collapses
   * two unlike things into one `not_public` — "he forbade it" and "the rows do
   * not yet describe it". Holding on the second deadlocked the one asset whose
   * page IS the venue: its page cannot be published until an offer is placed,
   * and the offer cannot be placed until its page is published.
   *
   * So the shape stays a reading and this stays a permission. `never` means he
   * said no. `ask_first` means publishing is his act and not an hourly
   * routine's, which is not a quieter no and is not a yes. Null means he has
   * said nothing, which is also not a yes — it only means this field is not
   * what decides, and the approval on the row still does.
   */
  yourWord: 'never' | 'ask_first' | null;
}

/**
 * THE PROVIDER THE WORKSHOP'S OWN CHECKOUT RUNS ON — which is how the rows say
 * "this offer is carried here" without anybody having declared it.
 *
 * The plan has a `venue: 'workshop'` field and reading THAT was the first
 * version of this, which was wrong in the way this campaign has been correcting
 * all along: it is a declared intention, it is optional, and the one asset that
 * actually has a product page predates it and does not set it. The exposure's
 * provider is the observed fact — the row written when the offer was really
 * placed — and `hand.ts` already treats this same value as the marker for an
 * exposure the institution placed itself. The declaration is kept as
 * corroboration for an offer composed but not yet placed; it is not the ground.
 */
const CARRIED_HERE = 'stripe';

/** What every shape that reaches a customer owes them, before anything specific to the shape. */
const ALWAYS = [
  'who is responsible for it, by business name',
  'a way to reach a person',
];

/**
 * HOW THIS ASSET SHOULD SHOW, from the rows that already exist.
 *
 * Reads the offer's declared channel, whether anybody was actually reached,
 * whether money changed hands, the asset's standing, and the owner's standing
 * boundaries. Writes nothing. Decides nothing that the owner has decided.
 */
export async function howItShouldShow(experimentId: string): Promise<HowItShouldShow> {
  const because: string[] = [];

  const e = (await query(
    `SELECT founder_id, decision FROM venture_experiments WHERE id = ?`, [experimentId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!e) {
    return {
      shape: 'not_public', because: ['there is no such test'], mustCarry: [],
      cannotTell: null, yourWord: null,
    };
  }

  // NOT SCOPED TO REAL COMPANIES, AND THE FIRST VERSION WAS — WRONGLY.
  //
  // The instinct was right everywhere else: a rehearsal asset must not decide
  // owner truth. Here it inverted the protection. This lookup exists to find
  // the owner's boundary on PUBLISHING, and the rehearsal's own page really is
  // published, to the real Cloudflare store, by the same pass. Filtering the
  // rehearsal product out did not stop a synthetic boundary deciding a real
  // page; it left the rehearsal page publishing with NO boundary consulted at
  // all. Scoping a permission check is not the same act as scoping a reading,
  // and this is the first kind.
  //
  // Deterministic by `rowid`: two products from one experiment used to mean an
  // arbitrary one decided the boundary, which would also flip the page's digest
  // between passes and leave it reading permanently stale.
  const product = (await query(
    `SELECT p.id FROM products p
      WHERE p.from_experiment_id = ? AND p.deleted_at IS NULL
      ORDER BY p.rowid LIMIT 1`,
    [experimentId])).rows[0] as Record<string, unknown> | undefined;

  // THE OWNER FIRST, ALWAYS. Before any reading of what would be useful, what
  // has he already said. A boundary at `never` on publishing ends the question.
  let asksFirst: string | null = null;
  if (product) {
    // THE STRICTEST WORD WINS, NOT THE FIRST ROW FOUND. `boundariesFor` returns
    // the product's own rows and the estate-wide ones together, ordered by the
    // subject's sort order and then insertion — so `.find` let a global `never`
    // written after a product-scoped `ask_first` be silently ignored. The door's
    // own reader iterates every row for exactly this reason.
    const publishRows = (await boundariesFor(String(product.id)))
      .filter((b) => b.subject === 'publish');
    const publishing = publishRows.find((b) => b.mode === 'never') ?? publishRows[0];
    if (publishing?.mode === 'never') {
      return {
        shape: 'not_public',
        because: [`you said so: "${publishing.statement}"`],
        mustCarry: [],
        cannotTell: null,
        yourWord: 'never',
      };
    }
    // ASK-FIRST IS NOT A QUIETER NEVER, AND IT IS NOT A YES — SO THE QUESTION
    // IS WHETHER HE HAS ALREADY ANSWERED IT FOR THIS ASSET.
    //
    // This is the door's own rule, not a new one: an `ask_first` boundary is
    // satisfied by an approved act under that subject, and stands where
    // nothing has been put to him. Reading the boundary alone was wrong and
    // the suite proved it within the hour — `approveExperiment` writes
    // `publish: ask_first` for EVERY approved test ("Ask me before placing an
    // offer anywhere for this test") and then proposes the offer's placement
    // and records his approval of it two lines later. Treating that as an
    // unanswered question held the page of the one asset whose page IS the
    // venue, which the offer gate then refused for want of a published page.
    // `approveListing` writes the same subject and proposes no placement act,
    // because on Etsy the placement is his own act on the venue — so nothing
    // answers it and it holds. The difference falls out of the rows rather
    // than out of reading the statements' wording, which is the point.
    //
    // DECIDED, NOT UNSPENT. The door reads `consumed_at` and `expires_at`
    // because it is authorising ONE effect. A page is not an effect; it is the
    // asset's standing public record, re-rendered every hour and re-put only
    // when its digest moves. Reading consumption here would mean the first
    // payment link created silently froze the asset's page for ever. What he
    // can take back is the approval itself, and `revoked_at` is how.
    if (publishing?.mode === 'ask_first') {
      const answered = (await query(
        `SELECT id FROM proposed_acts
          WHERE product_id = ? AND subject = 'publish'
            AND decision = 'approved' AND revoked_at IS NULL
          ORDER BY decided_at, rowid LIMIT 1`, [String(product.id)])).rows[0];
      if (answered) because.push('you approved its placement when you approved the test');
      else asksFirst = publishing.statement;
    }
  }

  // DID IT REACH ANYBODY AT ALL. Internal research, rejected ideas and tests
  // that never left the building do not get a public entry merely by existing
  // inside Foundry — that is the owner's line and it is the right one. A live
  // exposure is the row that says somebody outside could see this.
  const exposure = (await query(
    `SELECT provider, exposure_ref, withdrawn_at FROM experiment_exposures
      WHERE experiment_id = ? ORDER BY placed_at DESC, rowid DESC LIMIT 1`, [experimentId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!exposure) {
    return {
      shape: 'not_public',
      because: ['it has never been put in front of anybody'],
      mustCarry: [],
      cannotTell: null, yourWord: asksFirst === null ? null : 'ask_first',
    };
  }
  because.push(exposure.withdrawn_at == null
    ? `it is live at ${String(exposure.provider)}`
    : `it was placed at ${String(exposure.provider)} and taken down`);

  // WHETHER ANYBODY PAID. Not to grade the asset — to know whether there is a
  // customer whose remedy has to be reachable from whatever gets published.
  const sold = Number(((await query(
    `SELECT COUNT(*) AS n FROM experiment_fulfilments WHERE experiment_id = ?`,
    [experimentId])).rows[0] as Record<string, unknown>).n) > 0;
  if (sold) because.push('somebody has paid for it');

  const mustCarry = [...ALWAYS];
  if (sold) mustCarry.push('how to get money back, and from whom');
  if (asksFirst !== null) because.push(`it waits for you each time: "${asksFirst}"`);

  const plan = await offerShapePlanOf(experimentId);

  // THE CHANNEL DECIDES THE SHAPE, because the channel is what the customer
  // actually uses. This is the whole of the owner's clarification in one
  // branch: where they discover it, where they pay, and what the venue already
  // provides.
  if (plan?.listing) {
    mustCarry.push(`that ${plan.listing.venueName} takes the payment and delivers it, under its own policy`);
    return {
      shape: 'portfolio_entry',
      because: [...because,
        `it is sold on ${plan.listing.venueName}, which carries discovery, payment and delivery`],
      mustCarry,
      cannotTell: null, yourWord: asksFirst === null ? null : 'ask_first',
    };
  }

  if (plan?.venue === 'workshop' || String(exposure.provider) === CARRIED_HERE) {
    mustCarry.push('what it costs, what arrives, and what it does not cover');
    return {
      shape: 'product_page',
      because: [...because, 'the Workshop\'s own page is the venue: a buyer arrives here and pays here'],
      mustCarry,
      cannotTell: null, yourWord: asksFirst === null ? null : 'ask_first',
    };
  }

  // NO DECLARED CHANNEL. Something reached somebody and the offer's shape does
  // not say through what. That is not a licence to guess at a rich page: the
  // smallest honest answer is that Apex Micro is findable as the business
  // behind it, and the gap is named rather than filled in.
  return {
    shape: 'identity_only',
    because,
    mustCarry,
    cannotTell: 'the offer does not record which channel carries it, so how much '
      + 'to show is not something the rows decide',
    yourWord: asksFirst === null ? null : 'ask_first',
  };
}
