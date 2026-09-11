// =============================================================================
// PROOF 1, RECONSIDERED FROM FIRST PRINCIPLES, BEFORE ANYONE IS WRITTEN TO.
//
// The first design of this probe was declined as superseded because it counted
// a $29 offer as a $29 cost. The successor carries the same question, the same
// brief and the same businesses under the Workshop's identity — and until now
// it carried no record of the thinking that decided any of it. This module
// writes that record: what the probe actually settles, which exchange was
// chosen and which were weighed and refused, what it can and cannot prove,
// what it truly costs across every dimension it spends, where it stops itself,
// and what happens if it works.
//
// It is a judgement, not a launch. Nothing here contacts anybody, spends
// anything, publishes anything or grants permission. The owner's decision on
// /foundry/experiments/:id is still the only thing that lets it run, and the
// deliberation is sealed at that moment so it cannot be edited to match the
// result. Every sentence below was written before the world was asked.
// =============================================================================

import { amendDesign, designOf, recordDesign } from './probe-design.js';
import type { ProbeDesign } from './probe-design.js';
import { findProof1 } from './proof-1.js';

export interface Proof1Deliberation { experimentId: string; design: ProbeDesign; alreadyRecorded: boolean }

/**
 * SENSE BROADLY, CONTACT NARROWLY — APPLIED TO THIS PROBE'S OWN POPULATION.
 *
 * Re-judged from the assumption chain rather than from the design. The chain
 * runs: these shops bid public work → finding relevant notices is a real chore
 * → nobody has already solved it for them → screening is recognisable as
 * valuable from a description → the person reached decides → $29 is payable
 * without procurement friction → a cold message can carry it.
 *
 * The probe as designed tests the last four links fused into one observation.
 * It assumes the first three. And the first one is the cheapest of all to
 * check: COMMBUYS is the public record of Massachusetts procurement, it
 * publishes award and vendor activity as well as open solicitations, and it is
 * free — the same source the product itself is built on. Whether a given shop
 * has ever actually bid public work is therefore observable without asking
 * anybody anything.
 *
 * That matters because it changes what a null result means. The recorded
 * readings already admit two indistinguishable explanations for nobody paying:
 * the screening is not worth $29 sight unseen, or these shops do not transact
 * by cold email. There is a third — they do not bid public work at all, or
 * already have it covered — and unlike the other two it can be removed in
 * advance, for nothing, from public data. Twenty-three strangers' attention
 * and the Workshop's one and only first impression should not be spent
 * producing an ambiguity that a free lookup could have prevented.
 *
 * So the instrument is improved rather than deferred. The population becomes
 * shops with observed public-sector work instead of shops whose websites
 * merely suggest relevance. The same twenty-three messages then carry more
 * information, and the timing is right: none of the recipients has been
 * reviewed yet, so nothing is being rewritten.
 *
 * What this deliberately does NOT do: defer the probe. The surface is built,
 * the ceiling is $100, the stops are set, and endless pre-analysis is its own
 * failure. Sensing sharpens the shot; it does not replace taking it.
 */
export async function judgeProof1AgainstObservedBidders(founderId: string): Promise<{ amended: number; design: ProbeDesign }> {
  const experimentId = await findProof1(founderId);
  if (!experimentId) throw new Error('Proof 1 is not seeded');
  return amendDesign({
    experimentId, amendedBy: BY,
    because: 'Re-judged from the assumption chain, and then corrected. A null result had three readings, '
      + 'not two, and the third — that these shops do not pursue public work at all — is observable for '
      + 'nothing before anyone is written to. Spending strangers\' attention to produce an ambiguity a free '
      + 'lookup could remove is a dominated design. THE CRITERION IS OBSERVED PUBLIC-SECTOR WORK, NOT '
      + 'PRESENCE IN COMMBUYS, and the difference is not cosmetic. First, because it is the right '
      + 'criterion: requiring a shop to appear in COMMBUYS selects FOR shops already watching COMMBUYS, '
      + 'who therefore already receive these notices and need a screening brief least — the opposite of '
      + 'the customer this is for, whose complaint is losing work they never saw. Second, because the '
      + 'COMMBUYS evidence is not obtainable honestly: solicitation pages are openly readable, which is '
      + 'where the brief comes from, but the vendor and award directory refuses automated queries with a '
      + '403, and defeating that refusal is not a thing this institution does. A shop that names public '
      + 'schools, a city hall or a police station among its own projects, or appears in the Commonwealth\'s '
      + 'payment record, demonstrably does public work — which is the whole of what this narrowing was '
      + 'ever for. The question, the exchange and the decision to run are unchanged.',
    fields: {
      distribution: 'Cold outbound to Massachusetts millwork shops with observed public-sector work — named '
        + 'public projects in their own public record, or a public award or payment record naming them — '
        + 'not shops whose websites merely suggest relevance, and not narrowed to shops already present in '
        + 'COMMBUYS, which would select for the people who need this least. Written to once each, from a '
        + 'named operator, landing on a permanent public page. Sensing is broad and free; contact stays '
        + 'narrow and hand-reviewed. It is still the dirtiest distribution this institution recognises, and '
        + 'its own doctrine still says an opportunity reachable only this way is worth less than one found '
        + 'through search or a marketplace. It is used because it is the fastest honest route to a first '
        + 'real answer, not because it is a channel a business would keep.',
      ratherThanWaiting: 'The public record can say whether a shop does public work at all; it cannot say '
        + 'whether one would pay a stranger $29 for screening. That second question has no answer anywhere '
        + 'except from a person, and no quantity of further reading produces one. So: observe what is free '
        + 'to observe, then ask — rather than asking first and spending the answer on a confound.',
    },
    addInterpretations: [
      { observation: 'Nobody pays inside seven days',
        reading: 'these shops do not pursue public work, and the offer was never relevant to them',
        distinguishedBy: 'the public evidence of public-sector work recorded against each business, with its source, before anyone is written to' },
      { observation: 'Nobody pays inside seven days',
        reading: 'they do public work and already watch the source themselves, so a screening brief adds nothing they did not have',
        distinguishedBy: 'what a reply says about how they currently find work — which the narrowing deliberately does NOT pre-screen for, because screening it out would remove the customer this is for' },
      { observation: 'Somebody replies that they already use a bid service',
        reading: 'the incumbent is the competitor, not the chore, and the question becomes what the incumbent misses',
        distinguishedBy: 'what they name in the reply, now that the Workshop can hear replies at all' },
    ],
  });
}

/**
 * THE CLAIM WAS BROADER THAN THE EXCHANGE COULD ESTABLISH.
 *
 * As first written this probe said it settled whether the screening labour is
 * worth money. It does not. A $29 charge asked of a stranger who has never
 * heard of the workshop measures one thing: whether a sufficiently relevant
 * cold recipient will pay that price up front for the EXPECTED value of the
 * work, under this offer, this identity, this channel and this trust context.
 * Every one of those is part of the observation and none of them is separable
 * from it. "Worth money" is the wider question the probe is a first step
 * toward, not the question it answers.
 *
 * The same overreach appeared in the reason for the exchange. Payment before
 * delivery is the cleanest observation of PRE-DELIVERY willingness to pay; it
 * is not the only unambiguous observation a stranger can produce. A voluntary
 * payment after experienced value is equally unambiguous about a different
 * economic fact, and that instrument stays available to later experiments
 * where a relationship exists to trade on.
 *
 * The judgement itself is unchanged, deliberately: $29 up front rather than
 * pay-after-value is still the right instrument for a first cold approach, and
 * the exchange is not amendable here precisely so that tightening a claim can
 * never quietly become choosing a different probe. Only what the probe claims
 * to establish has been brought back inside what it can.
 */
export async function narrowProof1ToWhatItCanEstablish(founderId: string): Promise<{ amended: number; design: ProbeDesign }> {
  const experimentId = await findProof1(founderId);
  if (!experimentId) throw new Error('Proof 1 is not seeded');
  return amendDesign({
    experimentId, amendedBy: BY,
    because: 'The claim was broader than the chosen exchange can establish: a $29 charge to a cold '
      + 'recipient measures willingness to pay up front for expected value under this offer, identity, '
      + 'channel and trust context, not whether the screening labour is worth money in general. Narrowed '
      + 'before the owner decides and before anybody is written to; the exchange and the judgement are '
      + 'unchanged.',
    fields: {
      decides: 'Whether a sufficiently relevant Massachusetts millwork shop, reached cold, will pay $29 '
        + 'up front for the expected value of a hand-screened brief of open public bid notices — under this '
        + 'offer, this identity, this channel and this trust context.',
      decidesBecause: 'COMMBUYS is open to anybody and costs nothing to read. Every incumbent charges for '
        + 'notification, from $109 a month upward, so somebody believes the screening is valuable; nobody '
        + 'has shown that a shop of this size will pay a stranger for it sight unseen. That is the first '
        + 'step toward the wider question of whether the screening labour is worth money, and it is the '
        + 'step no amount of desk research can take.',
      exchangeBecause: 'Money moved before delivery is the cleanest observation of pre-delivery '
        + 'willingness to pay: the recipient acts on the description alone, and nothing about the act is '
        + 'ambiguous once it happens. It is not the only unambiguous observation a stranger can produce — a '
        + 'voluntary payment after experienced value would be just as unambiguous about a different '
        + 'economic fact, and that instrument stays open to a later experiment where there is a '
        + 'relationship to trade on. What this exchange confounds — trust in an unknown sender, the price, '
        + 'and the value of the work — is real, and is what the named operator, the permanent public page '
        + 'and the stated refund exist to reduce; that is why the identity work came first rather than as '
        + 'a later polish.',
      canProve: 'That at least one sufficiently relevant Massachusetts millwork shop, written to once by a '
        + 'named person and pointed at a page it can read before deciding, will pay $29 up front for a '
        + 'hand-screened shortlist of open public bid notices.',
      cannotProve: 'That there is a business here, or that the screening labour is worth money in general. '
        + 'It says nothing about what the same shops would pay after experiencing the brief, what they '
        + 'would pay through a channel they came to themselves, or what anyone would pay under a different '
        + 'identity or price. Twenty-five hand-picked shops reached by cold email inside seven days cannot '
        + 'establish a market, a price, a channel that repeats, or a second purchase — and at one payment I '
        + 'cannot tell a buyer from a well-wisher.',
    },
    interpretations: [
      { observation: 'Nobody pays inside seven days',
        was: 'the screening work is not worth $29 to shops of this size',
        reading: 'the screening work is not worth $29 up front, sight unseen, to shops of this size' },
      { observation: 'One business pays',
        was: 'at least one shop finds the screening worth money',
        reading: 'at least one shop will pay $29 up front for the expected value of this brief, from this sender' },
    ],
  });
}

const BY = 'institution:probe_designer';

export async function reconsiderProof1(founderId: string): Promise<Proof1Deliberation> {
  const experimentId = await findProof1(founderId);
  if (!experimentId) throw new Error('Proof 1 is not seeded');
  const existing = await designOf(experimentId);
  if (existing) return { experimentId, design: existing, alreadyRecorded: true };

  const design = await recordDesign({
    founderId, experimentId, designedBy: BY,

    // NARROWED TO WHAT THE EXCHANGE CAN ESTABLISH. Every clause after the dash
    // is part of the observation and none of them is separable from it; "worth
    // money" is the wider question this is a first step toward.
    decides: 'Whether a sufficiently relevant Massachusetts millwork shop, reached cold, will pay $29 up '
      + 'front for the expected value of a hand-screened brief of open public bid notices — under this '
      + 'offer, this identity, this channel and this trust context.',
    decidesBecause: 'COMMBUYS is open to anybody and costs nothing to read. Every incumbent charges for '
      + 'notification, from $109 a month upward, so somebody believes the screening is valuable; nobody has '
      + 'shown that a shop of this size will pay a stranger for it sight unseen. That is the first step '
      + 'toward the wider question of whether the screening labour is worth money, and it is the step no '
      + 'amount of desk research can take.',

    exchange: 'upfront_price',
    exchangeBecause: 'Money moved before delivery is the cleanest observation of pre-delivery willingness '
      + 'to pay: the recipient acts on the description alone, and nothing about the act is ambiguous once it '
      + 'happens. It is not the only unambiguous observation a stranger can produce — a voluntary payment '
      + 'after experienced value would be just as unambiguous about a different economic fact, and that '
      + 'instrument stays open to a later experiment where there is a relationship to trade on. What this '
      + 'exchange confounds — trust in an unknown sender, the price, and the value of the work — is real, '
      + 'and is what the named operator, the permanent public page and the stated refund exist to reduce; '
      + 'that is why the identity work came first rather than as a later polish.',

    canProve: 'That at least one sufficiently relevant Massachusetts millwork shop, written to once by a '
      + 'named person and pointed at a page it can read before deciding, will pay $29 up front for a '
      + 'hand-screened shortlist of open public bid notices.',
    cannotProve: 'That there is a business here, or that the screening labour is worth money in general. It '
      + 'says nothing about what the same shops would pay after experiencing the brief, what they would pay '
      + 'through a channel they came to themselves, or what anyone would pay under a different identity or '
      + 'price. Twenty-five hand-picked shops reached by cold email inside seven days cannot establish a '
      + 'market, a price, a channel that repeats, or a second purchase — and at one payment I cannot tell a '
      + 'buyer from a well-wisher.',

    ratherThanWaiting: 'The alternative is more reading about whether millwork shops value bid screening, and '
      + 'no quantity of it produces a person paying money. Each further week of research returns less than one '
      + 'stranger\'s decision.',

    distribution: 'Cold outbound to twenty-five hand-reviewed businesses, once each, from a named operator, '
      + 'landing on a permanent public page. It is the dirtiest distribution this institution recognises, and '
      + 'its own doctrine says an opportunity reachable only this way is worth less than a smaller one found '
      + 'through search or a marketplace. It is used here because it is the fastest honest route to a first '
      + 'real answer, not because it is a channel a business would keep.',

    ifItSucceeds: 'Nothing widens. New offers stop at ten briefs owed at once: a hand-made pilot that promises '
      + 'more than one person can deliver has turned a good result into an obligation. Massachusetts and '
      + 'COMMBUYS only — a second state, the Central Register, or a second data source is a new probe with its '
      + 'own rights question, not an extension of this one. And a payment is one shop\'s decision, not demand: '
      + 'the next step is a second cheap probe that reaches shops some other way, to learn whether the answer '
      + 'survives without cold email. The goal is a small thing that works, not a larger version of something '
      + 'that has worked once.',

    fulfilmentCap: 10,

    recommendation: 'run',
    recommendationBecause: 'The question is real, the brief already exists, the public surface is built and '
      + 'amortised, the ceiling is $100 and the stop conditions cost less than the budget does. What was wrong '
      + 'with this probe was never the test but its reading: a null result looked like a settled no when it is '
      + 'the most likely outcome of writing to twenty-five strangers about anything. With the competing '
      + 'readings recorded before it runs, and a second free observation on the page, the likely outcome is '
      + 'informative rather than merely disappointing. It should not go out before the page is genuinely '
      + 'published and the sending domain authenticates — but those are gates the institution already '
      + 'enforces on the send itself, not reasons for me to take the decision away from you.',

    // WHAT EACH LIKELY OBSERVATION COULD MEAN, WRITTEN BEFORE IT IS SEEN. Two
    // of these cannot be told apart by anything this probe collects, and saying
    // so now is the only way that admission survives contact with a result.
    interpretations: [
      { observation: 'Nobody pays inside seven days',
        reading: 'the screening work is not worth $29 up front, sight unseen, to shops of this size',
        distinguishedBy: null },
      { observation: 'Nobody pays inside seven days',
        reading: 'a cold email from an unknown sender is not a thing these shops transact through, whatever it offers',
        distinguishedBy: null },
      { observation: 'Nobody pays, but somebody answers the page asking for more like this',
        reading: 'the brief is useful and the price or the sender, not the value, ended the sale',
        distinguishedBy: 'the continuation answer recorded on the experiment\'s public page' },
      { observation: 'One business pays',
        reading: 'at least one shop will pay $29 up front for the expected value of this brief, from this sender',
        distinguishedBy: null },
      { observation: 'Several offers bounce or none is confirmed delivered',
        reading: 'the addresses or the sending identity decided the outcome, and the offer was never read',
        distinguishedBy: 'delivery confirmation from the provider and the domain\'s authentication health' },
      { observation: 'Somebody replies asking what the brief leaves out',
        reading: 'the stated coverage limits are the objection, not the price',
        distinguishedBy: 'the reply itself, in the Workshop inbox' },
      { observation: 'A business asks not to be written to again',
        reading: 'the approach was wrong for them, which says nothing about the product',
        distinguishedBy: 'the suppression records which experiment the person was answering' },
    ],

    // THE EXCHANGES WEIGHED AND REFUSED. Pay-after-value is here because it was
    // put to me as a better idea, and it is a better idea in general; it is
    // refused for this probe on its merits, not by reflex in either direction.
    alternatives: [
      { exchange: 'value_first',
        notChosenBecause: 'Sending the brief unrequested and asking to be paid afterwards gives away the one '
          + 'thing being tested and turns an offer into an unsolicited delivery, which is a heavier imposition '
          + 'on a stranger than a question is. It also answers a different question from the one being asked '
          + 'here: what somebody pays after experiencing value is an observation about the work, not about '
          + 'whether it can be sold to a stranger who has not seen it. It is a real instrument and a good one '
          + 'once there is a relationship to trade on; there is none here yet.' },
      { exchange: 'sample_then_paid',
        notChosenBecause: 'The pilot brief is thirteen notices. A sample large enough to be useful is most of '
          + 'the product, and one small enough not to be is not a sample of anything.' },
      { exchange: 'subscription',
        notChosenBecause: 'The unknown is whether one brief is worth money at all. Asking for a recurring '
          + 'commitment before that is settled tests a harder question, and a no would not tell me which of '
          + 'the two was refused.' },
      { exchange: 'free_with_role',
        notChosenBecause: 'Giving it away in exchange for a conversation buys an opinion about whether someone '
          + 'would pay, and a stated willingness to pay is the evidence this institution distrusts most.' },
    ],

    // THE TRUE COST, ACROSS EVERY DIMENSION IT SPENDS. The first design of this
    // probe called itself $29 and spent hours of the owner and a new public
    // surface; the difference now is that the surface is built and shared.
    costs: [
      { dimension: 'cash', level: 'low',
        grounds: 'A $100 ceiling, a $29 price, provider fees. The brief is already written and costs nothing per copy.' },
      { dimension: 'owner_attention', level: 'material',
        grounds: 'Reviewing twenty-five businesses by hand and connecting a sending address. Lower than the first '
          + 'design only because the domain, the mailbox, the page and the privacy surface already exist.' },
      { dimension: 'participant_burden', level: 'low',
        grounds: 'One message each, never a second. A page they can read before deciding, and one refusal that '
          + 'binds the whole Workshop rather than this experiment alone.' },
      { dimension: 'reputation', level: 'material',
        grounds: 'The first cold outbound from a domain with no sending history, under the one public name every '
          + 'later experiment will also stand behind. A bad send here is paid for by all of them.' },
      { dimension: 'legal_uncertainty', level: 'low',
        grounds: 'Public procurement metadata, linked to its source. No personal data kept, one jurisdiction, a '
          + 'one-time charge, a refund offered in the delivery itself.' },
      { dimension: 'support_burden', level: 'low',
        grounds: 'A refund link instead of a support commitment, and a brief that answers its own coverage question.' },
      { dimension: 'infrastructure', level: 'none',
        grounds: 'Nothing new is required. The domain, sender, mailbox, public site and payment path were built '
          + 'once for the Workshop and are shared by every experiment after this one — which is the whole reason '
          + 'they were built before this probe rather than for it.' },
      { dimension: 'obligation', level: 'low',
        grounds: 'One brief per buyer, already written, delivered by the institution. What is owed survives a '
          + 'pause and outlives the experiment.' },
      { dimension: 'complexity', level: 'low',
        grounds: 'No account, no feed, no recurring billing, nothing to maintain after it concludes.' },
      { dimension: 'opportunity_cost', level: 'material',
        grounds: 'The same owner attention spent on a probe reachable through search, a marketplace or the '
          + 'Workshop\'s own pages would produce a business with a channel worth keeping. This one buys a fast '
          + 'answer at the price of learning it through the ugliest distribution available.' },
    ],

    // WHERE IT STOPS ITSELF, SET BEFORE IT STARTS. A budget is a ceiling, not a
    // target; these thresholds are all reached long before $100 is spent.
    //
    // RECALIBRATED FOR A LARGER SAMPLE, AND NOT BY MULTIPLICATION. The original
    // envelope was designed around a cohort of two. Scaling every number by the
    // new sample size would be the wrong correction in the other direction: it
    // would let a list that is a quarter wrong run to the end because no
    // absolute count was ever reached. So the counts stay where the harm is to
    // a person, and a rate joins them for the failure only a rate can see.
    //
    // And ordinary commercial rejection is evidence, not an incident. "We
    // already watch COMMBUYS" is the answer the experiment was built to hear.
    // The opt-out inside it is honoured at once and globally either way; what
    // moves the threshold is a PATTERN large enough to change what sending the
    // rest would mean.
    stopConditions: [
      { kind: 'complaints', threshold: 1,
        because: 'One spam complaint on a domain with no sending history is not noise. It is the world saying '
          + 'this approach was wrong, and it costs every later experiment. A larger cohort does not make it '
          + 'cheaper; it makes it more likely, which is a reason to keep the threshold at one.' },
      { kind: 'bounces', threshold: 5,
        because: 'Five undeliverable addresses inside a cohort this size mean the contact research was worse '
          + 'than it was believed to be. It is an early-warning count, deliberately reachable inside the first '
          + 'two stages, and it sits beside a rate rather than instead of one.' },
      { kind: 'bounce_rate', threshold: 25,
        because: 'A quarter of attempted messages not arriving says the list is wrong however few have been '
          + 'sent, and a count alone cannot see that in a larger sample. The reading stays at zero until enough '
          + 'have been attempted for a proportion to be a fact.' },
      { kind: 'opt_outs', threshold: 4,
        because: 'Two people asking not to be written to out of forty is ordinary; four is a pattern, and the '
          + 'shops not yet written to did not consent to be the control group for it. Every opt-out is honoured '
          + 'immediately and everywhere regardless of this number.' },
      { kind: 'declined_value', threshold: 8,
        because: 'Eight shops saying plainly that they want nothing further has answered the question the offer '
          + 'was asking, at a lower price than sending the rest would cost. Fewer than that is the market '
          + 'talking, which is what the experiment is for.' },
      { kind: 'unfulfillable', threshold: 1,
        because: 'One paid brief that cannot be delivered is an unmet obligation. Selling a second before that '
          + 'is fixed would be taking money for something known not to arrive.' },
    ],
  });

  return { experimentId, design, alreadyRecorded: false };
}
