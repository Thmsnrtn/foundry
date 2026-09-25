// =============================================================================
// FOUNDRY - how this would end, if you ended it today
//
// THE FOURTH COMMAND DID NOT EXIST, AND THE ONE A REVIEWER IMAGINED SHOULD NOT.
//
// Three owner commands are real and genuinely distinct in code: a reversible
// operating pause that stops new offers and leaves deliveries alone; a
// withdrawal of spending authority; and retiring an asset. The fourth - "stop
// the institution" - had no in-code act at all, and the obvious version of it
// would be the worst thing this repository could build. An institution that can
// be switched off mid-obligation is an institution whose owner can be made,
// by one button, into somebody who took money and vanished. Obligations outlive
// the charter, the asset and the test, and they have to outlive the decision to
// stop as well.
//
// SO THE FOURTH COMMAND IS A WIND-DOWN, AND THE MECHANISM ALREADY EXISTS. The
// hand gates only NEW exposure on its `mayWrite` flag; reconciliation runs
// before any pause check, and what is owed is carried unconditionally on both
// passes. What was missing was not the behaviour. It was the ANSWER - the
// owner has never been able to ask "if I stopped now, what would finish by
// itself, and what would be left on my desk?" before deciding.
//
// THIS READS AND NOTHING ELSE. Ordering the wind-down is the existing pause;
// this is the sentence somebody should be able to read first. A reading that
// could also act is a reading nobody dares run.
//
// AND IT REPORTS THE UNCOMFORTABLE HALF. A wind-down summary that said "all
// clear" because it only counted what Foundry can do by itself would be the
// most dangerous page in the institution.
// =============================================================================

import { query, realCompany } from '../../db/client.js';
import { obligationsFor } from '../venture/obligations.js';
import type { Obligation } from '../venture/obligations.js';
import { moneyHeld, obligationsOutstanding, dollars } from '../economy/projection.js';
import type { Figure } from '../economy/projection.js';
import { newEconomicActivityPaused } from '../public-workshop/settings.js';

/** Who has to do something about it, when Foundry cannot. */
export type Whose = 'foundry' | 'you';

export interface LeftOver {
  what: string;
  whose: Whose;
  /** Why Foundry cannot finish it, said as a fact about this deployment. */
  because: string;
  amountCents: number;
}

export interface WindDown {
  /** Whether new exposure has already stopped, and by what. */
  newExposureStopped: boolean;
  /** What Foundry would discharge by itself, without anybody watching. */
  itWillFinish: LeftOver[];
  /** What it would not, and whose it becomes. Never empty for a comfortable reason. */
  itCannotSettle: LeftOver[];
  /** Money taken that is not yet anybody's, and what is owed out of it. */
  held: Figure;
  owed: Figure;
  /** Spending authority that would still be live after stopping. */
  stillAuthorised: Array<{ productId: string; statement: string; amountCents: number }>;
  /** The one sentence, which has to lead with the part that needs a person. */
  sentence: string;
}

/**
 * WHAT WOULD BE LEFT, said before the decision rather than after it.
 *
 * `action` on an obligation already distinguishes what Foundry carries from
 * what only the owner can do; this regroups that reading around a different
 * question and does not re-derive it. The vocabulary is the obligations
 * module's, so a new kind of stuck obligation appears here the day it appears
 * there rather than the day somebody remembers to add it.
 */
export async function howThisWouldEnd(founderId: string): Promise<WindDown> {
  const open = await obligationsFor(founderId);
  // Read once, here, rather than per obligation: the same switch decides what
  // the door may do for every one of them.
  const moneyToolsOn = process.env.FOUNDRY_ENABLE_MONEY_TOOLS === 'true';
  const itWillFinish: LeftOver[] = [];
  const itCannotSettle: LeftOver[] = [];

  for (const o of open) {
    const entry = (whose: Whose, because: string): LeftOver => ({
      what: `${describe(o)} on ${o.experimentTitle}`, whose, because,
      amountCents: o.amountCents,
    });
    switch (o.action) {
      case 'nothing':
        // 'owed' AND 'sent_unconfirmed' BOTH. The first version excluded only
        // `owed`, so a brief sent seventy-one hours ago took the plain branch
        // and a brief sent seventy-three hours ago did not — the same story the
        // comment above tells, reachable two hours earlier.
        if (moneyToolsOn || (o.state !== 'owed' && o.state !== 'sent_unconfirmed')) {
          itWillFinish.push(entry('foundry',
            'the pass that carries what is owed runs whether or not anything new is allowed'));
        } else {
          itWillFinish.push(entry('foundry',
            'the pass that carries what is owed runs whether or not anything new is '
            + 'allowed — though if the delivery fails, the refund would be yours to '
            + 'issue, because this deployment cannot move money'));
        }
        break;
      // A PROMISE THIS DEPLOYMENT MAY NOT BE ABLE TO KEEP.
      //
      // An unconfirmed delivery becomes a failed one after seven days and then
      // needs a REFUND — and with the money-tools switch off, which is the
      // default posture, the door refuses to issue it. The first version of
      // this filed it under "I will finish it myself", so a wind-down with two
      // briefs unconfirmed read "Nothing would be left for you", the owner
      // stopped and left for a month, and a week later two people who had paid
      // were owed money nothing in the deployment could return, with nobody
      // looking at the page. The same reasoning applies to a delivery that is
      // merely late: what is owed today is not what will be owed on Friday.
      case 'check_delivery':
        if (moneyToolsOn) {
          itWillFinish.push(entry('foundry',
            'it will be treated as failed and refunded if the provider never confirms it'));
        } else {
          itCannotSettle.push(entry('you',
            'if the provider never confirms it, it becomes a refund — and this '
            + 'deployment cannot move money, so that refund would be yours to issue'));
        }
        break;
      case 'money_tools_off':
        itCannotSettle.push(entry('you',
          'this deployment cannot move money — the money tools are switched off'));
        break;
      case 'refund_yourself':
        itCannotSettle.push(entry('you',
          'the door keeps refusing the refund, so it has to be issued by hand'));
        break;
      // ANSWERED WHERE IT WAS OPENED, AND BY HIM. This was filed under "the
      // buyer's bank" for every channel. An Etsy buyer opens a case with Etsy,
      // not a bank, and in both cases the one who must act is the owner —
      // naming the bank as "whose" told him it was somebody else's to carry.
      case 'respond_to_dispute':
        itCannotSettle.push(entry('you', o.provider === 'stripe'
          ? 'only you can answer a chargeback, in your Stripe account; nothing here can do it for you'
          : `only you can answer the buyer's case, on ${o.provider === 'etsy' ? 'Etsy' : o.provider}; `
            + 'Foundry does not speak to a marketplace for you'));
        break;
      case 'deliver_or_refund_yourself':
        itCannotSettle.push(entry('you',
          'no act of yours covers it any more, so it is yours to settle in the '
          + 'account the money is actually in'));
        break;
      case 'refund_on_the_venue':
        itCannotSettle.push(entry('you',
          'the money is the marketplace\'s and there is no door here that could '
          + 'move it, so the refund has to be given on the venue'));
        break;
      default: {
        // A NEW KIND OF STUCK OBLIGATION MUST NOT FALL THROUGH TO SILENCE.
        //
        // This switch had no default. `refund_on_the_venue` was added to the
        // obligations vocabulary and not here, so an obligation carrying it
        // landed in neither list — and with it as the only open one, this
        // reader told an owner "Nobody is owed anything. Stopping now would
        // leave nothing outstanding" while a marketplace buyer was waiting for
        // their money. The doc above this function claims a new kind appears
        // here "the day it appears there rather than the day somebody
        // remembers to add it". It did not, because nothing made it.
        //
        // `never` makes the compiler refuse the next one: an action added to
        // `ObligationAction` without a case here will not typecheck. The
        // runtime arm files it as unsettleable anyway, because the safe
        // direction for an obligation nobody has classified is that somebody
        // may still be owed.
        const unhandled: never = o.action;
        itCannotSettle.push(entry('you',
          `this is an obligation the wind-down reading does not know how to `
          + `classify (${String(unhandled)}), and one it cannot classify is not `
          + `one it may call settled`));
        break;
      }
    }
  }

  // `realCompany` because a rehearsal company's allowance is not money anybody
  // could spend. This sentence is the owner's own reading of what would still
  // be live after he stopped, and a synthetic row in it would be an invented
  // liability on a page he is using to decide.
  //
  // AND STANDING DELIBERATELY DOES NOT APPLY. An allowance lives on an
  // EXPERIMENTAL asset — that is where this institution's money is authorised
  // and where its acts are placed from. Restricting this to earned companies
  // would hide the only live allowance there is, on the one page whose job is
  // to say what would still be running after he stopped.
  const stillAuthorised = ((await query(
    `SELECT a.product_id, a.statement, a.amount_cents FROM owner_allowances a
       JOIN products p ON p.id = a.product_id
      WHERE p.owner_id = ? AND ${realCompany('p')} AND a.withdrawn_at IS NULL
        AND (a.until IS NULL OR datetime(a.until) > datetime('now'))`, [founderId]))
    .rows as unknown as Array<Record<string, unknown>>)
    .map((r) => ({
      productId: String(r.product_id), statement: String(r.statement),
      amountCents: Number(r.amount_cents),
    }));

  const held = await moneyHeld(founderId);
  const owed = await obligationsOutstanding(founderId);
  const stopped = await newEconomicActivityPaused(founderId);

  const stuck = itCannotSettle.reduce((n, l) => n + l.amountCents, 0);
  // AND "NOTHING WOULD BE LEFT FOR YOU" IS NOT TRUE WHILE MONEY MAY STILL GO
  // OUT. A pause stops new exposure; it does not withdraw an allowance, and
  // this module's whole job is to say what would still be running afterwards.
  // Saying "nothing" beside a live allowance would be the most reassuring
  // sentence on the page and one of the least true.
  const stillLive = stillAuthorised.length === 0
    ? ''
    : ` ${String(stillAuthorised.length)} spending `
      + `${stillAuthorised.length === 1 ? 'authority' : 'authorities'} of yours would `
      + `stay live — $${(stillAuthorised.reduce((n, a) => n + a.amountCents, 0) / 100).toFixed(2)} `
      + 'in all. Stopping does not withdraw them.';
  const sentence = itCannotSettle.length > 0
    // THE PART THAT NEEDS A PERSON GOES FIRST, whatever else is true. An owner
    // who reads "everything is in hand" and stops reading has been told the
    // opposite of what matters.
    ? `${String(itCannotSettle.length)} ${itCannotSettle.length === 1 ? 'thing' : 'things'} `
      + `worth ${dollars(stuck)} would be left for you — nothing I do on a later pass `
      + `changes that. ${itWillFinish.length === 0 ? 'Nothing else is outstanding.'
        : `I would finish the other ${String(itWillFinish.length)} by myself.`}${stillLive}`
    : itWillFinish.length > 0
      ? `I would finish all ${String(itWillFinish.length)} outstanding `
        + `${itWillFinish.length === 1 ? 'obligation' : 'obligations'} by myself, and `
        + `stop taking on anything new.${stillLive || ' Nothing would be left for you.'}`
      : `Nobody is owed anything. Stopping now would leave nothing outstanding.${stillLive}`;

  return {
    newExposureStopped: stopped, itWillFinish, itCannotSettle,
    held, owed, stillAuthorised, sentence,
  };
}

/** The obligation's state in the words the owner already reads elsewhere. */
function describe(o: Obligation): string {
  switch (o.state) {
    case 'owed': return 'a brief paid for and not sent';
    case 'sent_unconfirmed': return 'a brief sent and not confirmed';
    case 'failed_refund_pending': return 'a refund owed after a failed delivery';
    case 'refund_requested': return 'a refund the buyer asked for';
    case 'disputed': return 'a charge the buyer is contesting';
    case 'uncovered': return 'a purchase nothing of yours covers';
  }
}
