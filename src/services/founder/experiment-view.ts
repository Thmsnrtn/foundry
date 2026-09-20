// =============================================================================
// THE EXPERIMENT AS THE OWNER SEES IT
//
// One derivation from the rows that govern a real experiment into ordinary
// language: what state it is in, what (if anything) is his to do, who was
// reached, what money moved, what the offer is, what the sealed rule says,
// what the world said, and a timeline of what actually happened with the row
// each line is read from. Nothing is stored for the screen; there is no second
// state machine. Internal vocabulary (rungs, counterparties, validity) stays
// behind "Details".
// =============================================================================

import { query } from '../../db/client.js';
import { publicWorkshopOfExperiment } from '../public-workshop/settings.js';
import { allowanceFor } from '../institution/standing-intent.js';
import { GRADE_SQL, outcomeFromRow, type Outcome } from './what-happened.js';
export { outcomeOf, outcomeFromRow, outcomeSentence, type Outcome, type OutcomeWord } from './what-happened.js';
import { exposureOf, parseSettlementRule, whatTheWorldSaid } from '../venture/outcome.js';
import {
  campaignActOf, experimentRow, handExceptions, materialOf, offerShapePlanOf, readiness, recipientsOf,
  checkDeliverableQuality, checkOfferQuality, type ExperimentRow, type Readiness, type Recipient,
} from '../venture/hand.js';

type Row = Record<string, unknown>;
const rows = async (sql: string, params: unknown[]): Promise<Row[]> => (await query(sql, params)).rows as unknown as Row[];

export type ExperimentState = 'needs_you' | 'ready' | 'running' | 'completed' | 'stopped' | 'declined' | 'invalid' | 'retired' | 'superseded';

/**
 * WHAT CAN NO LONGER PRODUCE NEW EVIDENCE. One predicate, in SQL, for every
 * reader that separates the working set from the record: the charter's
 * in-flight count (`charter.ts`), the owner's queue (`attention.ts`) and the
 * list below. Kept byte-identical in each so a fourth copy is never written.
 * A test the owner stopped (exposure withdrawn, act revoked) is concluded too,
 * but only the rows the view reads can say so; callers treat `concluded` on
 * the view as the last word.
 */
export const SETTLED_SQL = `(e.what_happened IS NOT NULL OR e.ran_at IS NOT NULL OR e.retired_at IS NOT NULL
        OR e.validity <> 'valid' OR e.superseded_by IS NOT NULL OR coalesce(e.decision,'') = 'declined')`;

export interface Step { key: 'recipients' | 'sending' | 'allow' | 'placing' | 'listing' | 'readings'; label: string; status: 'done' | 'todo' | 'foundry'; detail: string; href: string }

export interface TimelineEvent {
  at: string;
  kind: 'Observed' | 'Concluded' | 'Planned' | 'Authorized' | 'Attempted' | 'Verified' | 'Learned';
  text: string;
  source: string;
}

export interface ExperimentView {
  id: string; founderId: string; title: string; productId: string | null; assetName: string | null;
  state: ExperimentState; stateLabel: string; stateDetail: string;
  /** WHAT HAPPENED, IN THE ONE VOCABULARY every surface renders from. */
  outcome: Outcome;
  /** Concluded: nothing it does now produces new evidence. History, not work. */
  concluded: boolean; concludedAt: string | null;
  /** The later design that replaced it, when one did. */
  supersededBy: string | null;
  /**
   * WHAT IS IN THE WAY, STILL IN PIECES.
   *
   * `stateDetail` joins these with semicolons into one sentence because a
   * sentence is what a card with one line of room can hold. Four blockers read
   * that way become sixty words the owner has to parse back apart, and he has
   * to do it every time he opens the page. The list is what the readiness check
   * actually produced; anywhere with room to show rows should show rows.
   *
   * Empty whenever nothing is blocking, which is not the same as unknown.
   */
  blocking: string[];
  why: { whatWeDo: string; whatWeExpect: string; wouldDisprove: string; question: string };
  steps: Step[];
  allow: { possible: boolean; reason: string | null; explanation: string[] };
  exposure: { approved: number; excluded: number; pending: number; pendingWebForm: number; sent: number; delivered: number; bounced: number; remaining: number; killAt: number | null };
  money: ExperimentMoney;
  offer: { price: string; oneTime: boolean; paymentLinkUrl: string | null; offerQuality: { ok: boolean; failures: string[] } | null; deliverable: { title: string; pulledAt: string | null; items: number; quality: { ok: boolean; failures: string[] } } | null; limits: string };
  rules: { success: string; stop: string[]; windowClosesAt: string | null; daysLeft: number | null };
  learned: { headline: string; detail: string; evidence: string };
  judgment: string | null;
  exceptions: string[];
  timeline: TimelineEvent[];
  controls: { canStop: boolean; allowance: { budget: string; statement: string } | null; actId: string | null };
  details: Array<[string, string]>;
  recipients: Recipient[];
  readiness: Readiness;
  /** The Workshop's page for this test, when it has a public identity. */
  publicPage: { url: string; status: string; detail: string; gate: string[] } | null;
}

const money = (cents: number, currency = 'USD') => `${currency.toUpperCase() === 'USD' ? '$' : ''}${(cents / 100).toFixed(2)}${currency.toUpperCase() === 'USD' ? '' : ` ${currency.toUpperCase()}`}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const KIND_WORDS: Record<string, string> = { offer_delivered: 'businesses have received the offer', arrival: 'people have arrived at the offer', payment: 'payments', delivery: 'paying customers receive what they bought' };

/**
 * ONE READING OF A TEST'S MONEY. One approved $100 test read as $-100 on
 * Home, "$100 more without asking" on Controls, "Spent $0.00" on its page and
 * "$100 on a test" in the week-away letter — five figures, each correct about
 * a different quantity, none reconciled. This is the one place the
 * quantities are read side by side, each named for what it is, and every
 * surface renders from it with its own label.
 */
export interface ExperimentMoney {
  currency: string;
  /** What the owner authorised for the test: its cost, as approved. Not spend. */
  authorisedCents: number;
  /** What the charter's envelope set aside for it, if it was let in under one. Not spend. */
  carvedCents: number;
  /** The standing allowance on the test's asset, and what is left of it. */
  allowanceCents: number;
  remainingCents: number;
  /** What Foundry actually consumed against it: thinking and real outlay. */
  spentCents: number;
  /** What customers actually paid, and gave back. */
  paidCents: number; payments: number; refundedCents: number; refunds: number; paidYet: boolean;
  /** The one word for where the money stands. */
  word: 'authorised' | 'spending' | 'settled' | 'none';
  /** The reading as a sentence, for a letter or a line. */
  sentence: string;
}

export async function moneyOfExperiment(experimentId: string): Promise<ExperimentMoney> {
  const e = (await rows(
    `SELECT e.cost_cents, e.ran_at, e.retired_at, e.decision,
            (SELECT p.id FROM products p WHERE p.from_experiment_id = e.id AND p.deleted_at IS NULL) AS product_id
       FROM venture_experiments e WHERE e.id = ?`, [experimentId]))[0];
  if (!e) throw new Error('no such experiment');
  const productId = e.product_id == null ? null : String(e.product_id);
  const allowance = productId ? await allowanceFor(productId) : null;
  // A SETTLED TEST STILL SPENT WHAT IT SPENT. Its allowance is withdrawn the
  // day it settles, and the live-allowance reader then answers nothing — so
  // the spend is read from the ledgers directly, from the day the budget was
  // set, whether or not the budget still stands.
  const last = productId ? (await rows(
    `SELECT amount_cents, set_at FROM owner_allowances WHERE product_id = ? ORDER BY set_at DESC, rowid DESC LIMIT 1`, [productId]))[0] : undefined;
  const spentSince = async (since: string): Promise<number> => {
    const thinking = Number(((await rows(
      `SELECT COALESCE(SUM(spent_cents), 0) AS c FROM ai_daily_spend WHERE scope = 'product' AND scope_id = ? AND date >= date(?)`, [productId, since]))[0] ?? {}).c ?? 0);
    const outlay = Number(((await rows(
      `SELECT COALESCE(SUM(CASE WHEN source = 'reversed' THEN -amount_cents ELSE amount_cents END), 0) AS c
         FROM asset_money_spent WHERE product_id = ? AND date(recorded_at) >= date(?)`, [productId, since]))[0] ?? {}).c ?? 0);
    return thinking + Math.max(0, outlay);
  };
  const carved = Number(((await rows(
    `SELECT COALESCE(SUM(cents), 0) AS c FROM portfolio_envelope_carves WHERE experiment_id = ?`, [experimentId]))[0] ?? {}).c ?? 0);
  const x = await exposureOf(experimentId);
  const said = x ? await whatTheWorldSaid(x.id) : [];
  const payments = said.filter((s) => s.kind === 'payment');
  const refunds = said.filter((s) => s.kind === 'refund');
  const paidCents = payments.reduce((n, s) => n + (s.amountCents ?? 0), 0);
  const refundedCents = refunds.reduce((n, s) => n + (s.amountCents ?? 0), 0);
  const currency = payments[0]?.currency ?? 'USD';
  const authorisedCents = Number(e.cost_cents ?? 0);
  const spentCents = allowance?.spentCents ?? (last ? await spentSince(String(last.set_at)) : 0);
  const settled = e.ran_at != null || e.retired_at != null;
  const word: ExperimentMoney['word'] = authorisedCents === 0 && paidCents === 0 ? 'none'
    : settled ? 'settled' : spentCents > 0 || paidCents > 0 ? 'spending' : 'authorised';
  const $ = (c: number) => `$${(c / 100).toFixed(2)}`;
  const sentence = word === 'none' ? 'no money was set aside for it and none moved'
    : `${$(authorisedCents)} set aside for it${carved > 0 ? ` (carved from the charter)` : ''}; ${$(spentCents)} of that spent; `
      + `${paidCents === 0 ? 'nothing paid by anyone' : `${$(paidCents)} paid by customers`}${refundedCents > 0 ? `, ${$(refundedCents)} refunded` : ''}`;
  return {
    currency, authorisedCents, carvedCents: carved,
    allowanceCents: allowance?.amountCents ?? (last ? Number(last.amount_cents) : authorisedCents),
    remainingCents: allowance?.remainingCents ?? (settled ? 0 : authorisedCents),
    spentCents, paidCents, payments: payments.length, refundedCents, refunds: refunds.length, paidYet: payments.length > 0,
    word, sentence,
  };
}

export async function getExperimentView(founderId: string, experimentId: string, now: Date = new Date()): Promise<ExperimentView | null> {
  const e = await experimentRow(experimentId);
  if (!e || e.founderId !== founderId) return null;
  const [ready, recipients, offer, deliverable, plan, act, x, asset] = await Promise.all([
    readiness(experimentId), recipientsOf(experimentId), materialOf(experimentId, 'offer'), materialOf(experimentId, 'deliverable'),
    offerShapePlanOf(experimentId), campaignActOf(experimentId), exposureOf(experimentId),
    (async () => e.productId ? (await rows('SELECT name FROM products WHERE id = ?', [e.productId]))[0] : undefined)(),
  ]);
  const said = x ? await whatTheWorldSaid(x.id) : [];
  const allowance = e.productId ? await allowanceFor(e.productId) : null;
  const graded = (await rows(`SELECT ${GRADE_SQL} AS grade, d.cannot_prove FROM venture_experiments e LEFT JOIN probe_designs d ON d.experiment_id = e.id WHERE e.id = ?`, [experimentId]))[0] ?? {};
  const rule = parseSettlementRule(e.settlesWhen);
  const unknown = (await rows('SELECT question FROM market_unknowns WHERE id = (SELECT unknown_id FROM venture_experiments WHERE id = ?)', [experimentId]))[0];
  const price = plan ? `${money(plan.price.amountCents, plan.price.currency)} one-time` : 'one-time';
  const withdrawn = !!x && x.withdrawnAt !== null;
  const actLive = !!act && act.decision === 'approved' && act.revokedAt === null && new Date(act.expiresAt).getTime() > now.getTime();

  // ── Steps: exactly the owner's acts, then what Foundry does on its own ──
  // WHAT THE SCREENING FOUND, ON THE STEP HE READS BEFORE HE OPENS IT. The
  // decision he is being asked for is whom to write to; the evidence under it
  // is Foundry's, and the shape of it belongs on the first screen rather than
  // one page further in.
  const screened = recipients.filter((r) => r.qualifiedAt).length;
  const cohort = recipients.length === 0 ? ''
    : ` Foundry screened ${plural(recipients.length, 'candidate', 'candidates')} against the evidence this design requires: `
      + `${screened} qualify, ${recipients.length - screened} have no such record and cannot be written to whatever you decide here.`;
  // A LISTING THE OWNER PLACES HIMSELF has different acts: approve; open the
  // shop and list it, on the venue, outside Foundry; paste the address; enter
  // the venue's readings. Nobody is reviewed and nothing is sent, so the
  // steps that exist for the emailed offer would be lies here.
  const listing = plan?.listing ?? null;
  const voice = listing ? (await publicWorkshopOfExperiment(experimentId))?.publicName ?? 'the Workshop' : 'the Workshop';
  const readingsTaken = listing ? Number((await rows(
    `SELECT COUNT(*) AS n FROM market_observations WHERE claim_id = (SELECT claim_id FROM venture_experiments WHERE id = ?) AND source LIKE ?`,
    [experimentId, `${listing.venue}:stats:%`]))[0]?.n ?? 0) : 0;
  const steps: Step[] = listing ? [
    { key: 'allow', label: 'Approve this test', status: e.decision === 'approved' ? 'done' : 'todo',
      detail: e.decision === 'approved' ? `Approved ${String(e.decidedAt).slice(0, 10)}. The design is sealed and the allowance is set; Foundry writes to nobody and publishes nothing for it.` : 'One decision: the test may run within its allowance. It contacts nobody and publishes nothing; listing it is your own act on the venue.',
      href: `/foundry/experiments/${experimentId}#allow` },
    { key: 'listing', label: `Open the shop, list it on ${listing.venueName}, and paste the address (you)`, status: x && !withdrawn ? 'done' : 'todo',
      detail: x && !withdrawn ? `Listed at ${x.exposureRef} since ${x.placedAt.slice(0, 10)}. The window runs ${rule?.withinDays ?? '?'} days from then.` : 'Your acts, in order, are on this page. Foundry cannot open the shop, attach a bank account, opt out of the venue\'s advertising or publish the listing for you; when it is live, paste its address here and the clock starts.',
      href: `/foundry/experiments/${experimentId}#listing` },
    { key: 'readings', label: `Enter the venue's readings at day ${listing.readingsAtDays.join(', ')} (you)`, status: e.ranAt !== null ? 'done' : readingsTaken > 0 ? 'todo' : 'todo',
      detail: `${readingsTaken} of ${listing.readingsAtDays.length} readings entered: impressions, views, visits, favourites, orders and the source split, from the venue's own statistics. Orders are entered as they appear, from the statement.`,
      href: `/foundry/experiments/${experimentId}#readings` },
    { key: 'placing', label: 'Settle by the sealed rule (Foundry)', status: e.ranAt !== null ? 'done' : 'foundry',
      detail: e.ranAt !== null ? 'Settled.' : 'When the window closes, or an order that counts arrives, Foundry settles the prediction from the recorded events and says what changes next. Nothing for you to do.',
      href: `/foundry/experiments/${experimentId}#rules` },
  ] : [
    { key: 'recipients', label: 'Review who may be contacted',
      status: recipients.length === 0 || ready.pending > 0 || ready.reachable === 0 ? 'todo' : 'done',
      detail: recipients.length === 0 ? 'No candidate businesses are loaded yet.'
        : ready.pending > 0 ? `${plural(ready.pending, 'business', 'businesses')} still to review.${cohort} Exclude your employer and anything that could be a conflict; the rest can be approved together.`
          : ready.reachable > 0 ? `${ready.reachable} approved and reachable · ${ready.struck} excluded${ready.pendingWebForm ? ` · ${ready.pendingWebForm} web-form only, not contacted unless you add an email` : ''}.${cohort}`
            : 'Nobody approved can be reached by email. Add a published address for at least one, or nothing can be sent.',
      href: `/foundry/experiments/${experimentId}/recipients` },
    { key: 'sending', label: 'Email sending', status: ready.sending.status === 'ready' ? 'done' : 'todo', detail: ready.sending.detail, href: `/foundry/experiments/${experimentId}#sending` },
    { key: 'allow', label: 'Allow this test', status: e.decision === 'approved' ? 'done' : 'todo',
      detail: e.decision === 'approved' ? `Allowed ${String(e.decidedAt).slice(0, 10)}. The prediction is sealed and the allowance is set.` : 'One decision: the test may run, within its allowance, writing once to each approved business.',
      href: `/foundry/experiments/${experimentId}#allow` },
    { key: 'placing', label: 'Payment link and offer (Foundry)', status: offer?.paymentLinkUrl ? 'done' : 'foundry',
      detail: offer?.paymentLinkUrl ? `Placed: ${price}, no subscription, through a Stripe link tagged for this test.` : 'After you allow it, Foundry creates the tagged Stripe link on your account and writes it into the offer. Nothing for you to do.',
      href: `/foundry/experiments/${experimentId}#offer` },
  ];

  // ── State, truthfully from the rows ──
  let state: ExperimentState; let stateLabel: string; let stateDetail: string;
  const outcome = outcomeFromRow({
    decision: e.decision, validity: e.validity, verdict: e.verdict, grade: graded.grade == null ? null : String(graded.grade),
    what_happened: e.whatHappened, ran_at: e.ranAt, retired_at: e.retiredAt, retired_because: e.retiredBecause,
    superseded_by: e.supersededBy, invalidated_at: e.invalidatedAt, decided_at: e.decidedAt,
    cannot_prove: graded.cannot_prove == null ? null : String(graded.cannot_prove),
    stopped_by_owner: withdrawn || Boolean(act && !actLive),
  });
  const delivered = said.filter((s) => s.kind === 'offer_delivered').length;
  const payments = said.filter((s) => s.kind === 'payment');
  const refunds = said.filter((s) => s.kind === 'refund');
  const paidCents = payments.reduce((n, s) => n + (s.amountCents ?? 0), 0);
  const refundedCents = refunds.reduce((n, s) => n + (s.amountCents ?? 0), 0);
  const windowClosesAt = x && rule ? new Date(new Date(x.placedAt.replace(' ', 'T') + (x.placedAt.endsWith('Z') ? '' : 'Z')).getTime() + rule.withinDays * 86_400_000) : null;
  const daysLeft = windowClosesAt ? Math.max(0, Math.ceil((windowClosesAt.getTime() - now.getTime()) / 86_400_000)) : null;
  // RETIRED AND SUPERSEDED COME FIRST: both happen only before a test runs
  // (validation.ts refuses otherwise), and a retired test read as "Needs you"
  // is a forge-killed design asking the owner to decide it. That was the bug.
  if (e.supersededBy) { state = 'superseded'; stateLabel = 'Superseded'; stateDetail = 'Replaced by a later design; its record stands.'; }
  // HE STOPPED IT: the retirement carries his reason, and the word stays his.
  else if (e.retiredAt && (e.retiredBecause ?? '').startsWith('you stopped it')) { state = 'stopped'; stateLabel = 'Stopped by you'; stateDetail = 'Nothing more is sent; what the world already did stays on record.'; }
  else if (e.retiredAt) { state = 'retired'; stateLabel = 'Retired'; stateDetail = e.retiredBecause ?? 'Retired before it ran.'; }
  else if (e.decision === 'declined') { state = 'declined'; stateLabel = 'Declined'; stateDetail = 'You decided not to run it.'; }
  else if (e.validity !== 'valid') { state = 'invalid'; stateLabel = 'Invalid'; stateDetail = 'It did not measure what it was for, so it is re-run rather than read.'; }
  else if (e.ranAt !== null) {
    // SETTLED BY THE WORLD: the word is the one vocabulary's, not a fourth.
    state = 'completed'; stateLabel = outcome.label; stateDetail = outcome.reason ?? outcome.meaning;
  } else if (e.decision === 'approved' && (withdrawn || (act && !actLive))) { state = 'stopped'; stateLabel = 'Stopped by you'; stateDetail = 'Nothing more is sent; what the world already did stays on record.'; }
  else if (e.decision === 'approved' && listing) {
    state = 'running'; stateLabel = x && !withdrawn ? 'Listed' : 'Approved';
    stateDetail = !x || withdrawn ? `Approved. Waiting on you: open the shop, list it on ${listing.venueName}, and paste the listing address here; the window starts then.`
      : `Listed at ${x.exposureRef}; ${readingsTaken} of ${listing.readingsAtDays.length} readings entered; ${payments.length === 0 ? 'no one has paid yet' : `${plural(payments.length, 'buyer has', 'buyers have')} paid`}.${daysLeft != null ? ` ${daysLeft} day${daysLeft === 1 ? '' : 's'} left in the window.` : ''}`;
  } else if (e.decision === 'approved') {
    state = 'running'; stateLabel = 'Running';
    stateDetail = `${delivered === 0 ? 'No businesses have received the offer yet' : `${plural(delivered, 'business has', 'businesses have')} received the offer`}; ${payments.length === 0 ? 'no one has paid yet' : `${plural(payments.length, 'customer has', 'customers have')} paid`}.${daysLeft != null ? ` ${daysLeft} day${daysLeft === 1 ? '' : 's'} left in the window.` : ' The window opens when the offer is placed.'}`;
  } else if (!ready.ok) { state = 'needs_you'; stateLabel = 'Needs you'; stateDetail = `Before it can run: ${ready.missing.join('; ')}.`; }
  else { state = 'ready'; stateLabel = 'Ready'; stateDetail = 'Everything is in place. It runs when you allow it.'; }
  const concluded = state === 'completed' || state === 'stopped' || state === 'declined' || state === 'invalid' || state === 'retired' || state === 'superseded';
  const concludedAt = !concluded ? null
    : e.retiredAt ?? e.ranAt ?? e.invalidatedAt ?? (e.decision === 'declined' ? e.decidedAt : null) ?? (withdrawn ? x!.withdrawnAt : null) ?? act?.revokedAt ?? null;

  const allow = {
    possible: state === 'ready', reason: state === 'needs_you' ? stateDetail : null,
    explanation: listing ? [
      `Foundry may spend up to ${money(e.costCents)} on this test. It has no permission beyond that, and nothing here needs it to spend anything.`,
      `It writes to nobody and publishes nothing. The listing on ${listing.venueName} is your own act, under ${voice}, at ${price}. No subscription, no promotion, no email.`,
      'What the venue reports — impressions, views, favourites, orders, refunds — is entered by you from its own statistics and statement, and recorded as the provider\'s facts.',
      rule ? `It settles itself: ${describeRule(rule)}.` : 'No settlement rule is sealed, so only you could settle it.',
      'You can stop it at any time from this page; taking the listing down is yours to do on the venue. Approving it permits this test only; it creates no standing permission.',
    ] : [
      `Foundry may spend up to ${money(e.costCents)} on this test. It has no permission beyond that.`,
      `It writes once to each of the ${ready.reachable} approved businesses it can reach, in your name, offering the ${price} brief. No subscription, no follow-ups.`,
      'When someone pays, Foundry delivers the brief by email after its quality check, and records the delivery only when the mail provider confirms it.',
      process.env.FOUNDRY_ENABLE_MONEY_TOOLS === 'true' ? 'If a delivery fails, Foundry refunds the payment.' : 'If a delivery fails, the refund waits for you (refund handling is off).',
      rule ? `It settles itself: ${describeRule(rule)}.` : 'No settlement rule is sealed, so only you could settle it.',
      'You can stop it at any time from this page. Allowing it permits this test only; it creates no standing permission.',
    ],
  };

  const counts = (await rows(
    `SELECT SUM(CASE WHEN status IN ('executed') OR outcome_status IN ('verified_success','verified_failure') THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN outcome_status = 'verified_failure' THEN 1 ELSE 0 END) AS bounced
       FROM outbound_actions WHERE experiment_id = ? AND experiment_act = 'offer'`, [experimentId]))[0] ?? {};
  const exposure = {
    approved: recipients.filter((r) => r.reviewStatus === 'approved').length, excluded: ready.struck, pending: ready.pending, pendingWebForm: ready.pendingWebForm,
    sent: Number(counts.sent ?? 0), delivered, bounced: Number(counts.bounced ?? 0), remaining: Math.max(0, ready.reachable - Number(counts.sent ?? 0)),
    killAt: rule?.atMost ?? null,
  };
  const moneyView: ExperimentMoney = { ...await moneyOfExperiment(experimentId), currency: plan?.price.currency ?? 'USD' };
  const dq = deliverable ? checkDeliverableQuality(deliverable, now) : null;
  const offerView = {
    price, oneTime: true, paymentLinkUrl: offer?.paymentLinkUrl ?? null, offerQuality: offer ? checkOfferQuality(offer) : null,
    deliverable: deliverable && dq ? { title: deliverable.title, pulledAt: deliverable.pulledAt ? deliverable.pulledAt.slice(0, 10) : null, items: (deliverable.body.match(/^### /gm) ?? []).length, quality: dq } : null,
    limits: plan?.shape.claimsMade ?? '',
  };
  const learned = e.ranAt !== null
    ? { headline: outcome.meaning, detail: e.whatHappened ?? '', evidence: 'Settled by what providers reported at the offer, never by my opinion or yours.' }
    : { headline: payments.length ? `So far: ${plural(payments.length, 'customer has', 'customers have')} paid` : delivered ? 'So far: the offer has reached people; no one has paid yet' : 'Nothing commercial learned yet',
      detail: e.decision !== 'approved' ? 'It has not run.' : delivered === 0 ? 'No businesses have received the offer yet.' : payments.length === 0 ? 'No customer has paid yet.' : `${money(paidCents)} paid${refunds.length ? `, ${money(refundedCents)} refunded` : ''}.`,
      evidence: 'Only what the world does at the offer counts; an interested reply is not a payment.' };
  const judgment = state === 'running' && rule ? `Continue under the sealed rule: ${describeRule(rule)}.` : null;

  return {
    id: experimentId, founderId, title: e.whatWeDo, productId: e.productId, assetName: asset ? String(asset.name) : null,
    state, stateLabel, stateDetail, outcome, concluded, concludedAt, supersededBy: e.supersededBy,
    blocking: state === 'needs_you' ? ready.missing : listing && e.decision === 'approved' && (!x || withdrawn) && e.ranAt === null ? ['open the shop and list it', 'paste the listing address'] : [],
    why: { whatWeDo: e.whatWeDo, whatWeExpect: e.whatWeExpect, wouldDisprove: e.wouldDisprove, question: unknown ? String(unknown.question) : '' },
    steps, allow, exposure, money: moneyView, offer: offerView,
    rules: { success: rule ? `Success means ${describeRule(rule)}.` : 'No machine rule; the owner would settle it.', stop: stopRules(e, rule), windowClosesAt: windowClosesAt ? windowClosesAt.toISOString().slice(0, 10) : null, daysLeft },
    learned, judgment,
    exceptions: await handExceptions(experimentId),
    timeline: await getExperimentTimeline(founderId, experimentId),
    controls: { canStop: e.decision === 'approved' && e.ranAt === null && !withdrawn, allowance: allowance ? { budget: money(allowance.amountCents), statement: `${allowance.statement} (${allowance.horizon})` } : null, actId: act?.id ?? null },
    details: [
      ['Experiment', experimentId], ['Decision', e.decision ?? 'undecided'], ['Validity', e.validity], ['Verdict', e.verdict ?? 'none yet'],
      ['Exposure', x ? `${x.provider}:${x.exposureRef}${withdrawn ? ' (withdrawn)' : ''}` : 'not placed'],
      ['Campaign act', act ? `${act.id} · ${act.decision ?? 'undecided'}${act.revokedAt ? ' · revoked' : ''}` : 'none'],
      ['Settlement rule', e.settlesWhen ?? 'none'], ['Asset', e.productId ?? 'none yet'],
      // WHAT HE DECIDED AND THEN UNMADE. A withdrawal that left no trace on the
      // page would be the same erasure the reversal record exists to prevent.
      // THE BOUNDARIES THAT SHAPED THIS COHORT, named where he can find them.
      ['Never contact', await (async () => {
        const { exclusionsFor, liftedExclusionsFor } = await import('../institution/owner-exclusions.js');
        const live = await exclusionsFor(founderId);
        const lifted = await liftedExclusionsFor(founderId);
        const now = live.length === 0 ? 'none'
          : live.map((x) => `${x.entity} (${x.marks.length} marks)`).join(' · ');
        return lifted.length === 0 ? now
          : `${now} — lifted: ${lifted.map((l) => `${l.entity} by ${l.liftedBy}, ${l.because}`).join('; ')}`;
      })()],
      ['Withdrawn decisions', await (async () => {
        const { reversalsOfDecisions } = await import('../venture/validation.js');
        const back = await reversalsOfDecisions(experimentId);
        return back.length === 0 ? 'none'
          : back.map((r) => `${r.originalDecision} by ${r.originallyDecidedBy} at ${r.originallyDecidedAt} through "${r.theControlSaid}", withdrawn by ${r.reversedBy} at ${r.reversedAt}: ${r.because}`).join(' · ');
      })()],
      ['Counterparties that counted', String(said.filter((s) => s.kind === 'payment' && s.counterparty === 'unmatched_external').length)],
    ],
    recipients, readiness: ready,
    publicPage: await publicPageOf(experimentId, e, now),
  };
}

/** What the owner sees of the public page: its address, whether the world
 * was seen to carry it, and what the gate would still refuse outbound for. */
async function publicPageOf(experimentId: string, e: ExperimentRow, now: Date): Promise<ExperimentView['publicPage']> {
  const { pageUrlFor, experimentPublication, publicationGate } = await import('../public-workshop/publication.js');
  const url = await pageUrlFor(experimentId);
  if (!url) return null;
  const pub = await experimentPublication(experimentId);
  const status = !pub ? (e.decision === 'approved' ? 'not published yet' : 'published when you allow it')
    : pub.verifiedStatus === 'verified' ? `published · seen ${String(pub.verifiedAt).slice(0, 16).replace('T', ' ')}` : `published · not seen (${pub.verifiedDetail ?? 'unverified'})`;
  const detail = pub ? `Version ${pub.version}, put up ${pub.publishedAt.slice(0, 16).replace('T', ' ')}. The address never changes; the page stays whatever happens to the test.`
    : 'The address is fixed now. Foundry publishes the page when you allow the test, reads it back from the world, and writes to nobody until it has.';
  // The gate is shown for a test that could still write to someone.
  const gate = e.decision === 'approved' && e.ranAt === null ? (await publicationGate(experimentId, { now, verifyLive: false })).failures : [];
  return { url, status, detail, gate };
}

function describeRule(rule: { event: string; atLeast: number; outOf?: string; atMost?: number; withinDays: number }): string {
  const evt = rule.event === 'payment' ? `at least ${plural(rule.atLeast, 'customer pays', 'customers pay')}`
    : rule.event === 'delivery' ? `at least ${plural(rule.atLeast, 'customer pays and receives', 'customers pay and receive')} what they bought`
      : `at least ${rule.atLeast} ${KIND_WORDS[rule.event] ?? rule.event}`;
  const out = rule.outOf && rule.atMost != null ? ` before ${rule.atMost} ${KIND_WORDS[rule.outOf] ?? rule.outOf}` : '';
  return `${evt}${out}, within ${rule.withinDays} days of the offer being placed`;
}

function stopRules(e: ExperimentRow, rule: ReturnType<typeof parseSettlementRule>): string[] {
  const out: string[] = [];
  if (rule?.outOf && rule.atMost != null) out.push(`${rule.atMost} ${KIND_WORDS[rule.outOf] ?? rule.outOf} and no one has paid`);
  out.push(`the allowance of ${money(e.costCents)} would be exceeded (the door refuses the spend)`);
  if (rule) out.push(`${rule.withinDays} days pass after the offer is placed`);
  out.push('you stop it');
  return out;
}

// ── Timeline: what happened, from the rows that recorded it ─────────────────

export async function getExperimentTimeline(founderId: string, experimentId: string): Promise<TimelineEvent[]> {
  const e = await experimentRow(experimentId);
  if (!e || e.founderId !== founderId) return [];
  const events: TimelineEvent[] = [];
  const base = (await rows('SELECT proposed_at, decided_at, decided_by, ran_at FROM venture_experiments WHERE id = ?', [experimentId]))[0];
  events.push({ at: String(base.proposed_at), kind: 'Planned', text: `Test designed: ${e.whatWeDo}. I expect: ${e.whatWeExpect}. I would be wrong if: ${e.wouldDisprove}.`, source: `venture_experiments/${experimentId}` });
  for (const r of await rows(`SELECT review_status, COUNT(*) AS n, MAX(reviewed_at) AS at FROM experiment_recipients WHERE experiment_id = ? AND reviewed_at IS NOT NULL GROUP BY review_status`, [experimentId])) {
    events.push({ at: String(r.at), kind: 'Authorized', text: String(r.review_status) === 'approved' ? `You approved ${plural(Number(r.n), 'business', 'businesses')} to be contacted.` : `You excluded ${plural(Number(r.n), 'business', 'businesses')}.`, source: 'experiment_recipients' });
  }
  if (base.decided_at) events.push({ at: String(base.decided_at), kind: 'Authorized', text: e.decision === 'approved' ? `You allowed it: up to ${money(e.costCents)}, the prediction sealed.` : 'You declined it.', source: `venture_experiments/${experimentId}` });
  for (const a of await rows(`SELECT id, summary, decided_at, revoked_at, revoke_reason FROM proposed_acts WHERE experiment_id = ? ORDER BY proposed_at`, [experimentId])) {
    if (a.decided_at) events.push({ at: String(a.decided_at), kind: 'Authorized', text: `You approved the act: ${String(a.summary)}.`, source: `proposed_acts/${String(a.id)}` });
    if (a.revoked_at) events.push({ at: String(a.revoked_at), kind: 'Authorized', text: `Permission withdrawn${a.revoke_reason ? `: ${String(a.revoke_reason)}` : ''}.`, source: `proposed_acts/${String(a.id)}` });
  }
  for (const m of await rows(`SELECT kind, title, pulled_at, recorded_at, recorded_by FROM experiment_materials WHERE experiment_id = ? ORDER BY recorded_at, rowid`, [experimentId])) {
    const k = String(m.kind);
    // WHO WROTE IT IS PART OF WHAT HAPPENED: the owner pasting a link he made
    // and Foundry writing the one it created are different events.
    const by = String(m.recorded_by).startsWith('founder:') ? 'you' : 'Foundry';
    events.push({ at: String(m.recorded_at), kind: 'Planned', text: k === 'deliverable' ? `The brief was attached by ${by} (${String(m.title)}${m.pulled_at ? `, pulled ${String(m.pulled_at).slice(0, 10)}` : ''}).` : k === 'offer_template' ? `The offer text was written by ${by}, with a place for the payment link.` : k === 'offer' ? `The offer was completed by ${by} with its payment link and passed the promise check.` : `The offer\'s shape was recorded by ${by} for the legal pass.`, source: `experiment_materials/${k}` });
  }
  const x = await exposureOf(experimentId);
  if (x) {
    events.push({ at: x.placedAt, kind: x.provider === 'stripe' ? 'Planned' : 'Authorized', text: x.provider === 'stripe' ? `The offer was placed: a ${x.provider} payment link, tagged for this test.` : `You listed it at ${x.exposureRef}; the window starts here.`, source: `experiment_exposures/${x.id}` });
    if (x.withdrawnAt) events.push({ at: x.withdrawnAt, kind: 'Authorized', text: 'The offer was withdrawn.', source: `experiment_exposures/${x.id}` });
  }
  for (const a of await rows(
    `SELECT a.experiment_act, a.created_at, a.executed_at, a.status, a.result_json, a.parameters_json, r.counterparty_ref
       FROM outbound_actions a LEFT JOIN experiment_recipients r ON r.id = a.recipient_id WHERE a.experiment_id = ? ORDER BY a.created_at, a.rowid`, [experimentId])) {
    const who = a.counterparty_ref ? String(a.counterparty_ref) : (JSON.parse(String(a.parameters_json)) as { to: string[] }).to[0];
    const what = String(a.experiment_act) === 'offer' ? 'Offer' : 'Delivery';
    events.push({ at: String(a.created_at), kind: 'Planned', text: `${what} planned for ${who}.`, source: 'outbound_actions' });
    if (a.executed_at) events.push({ at: String(a.executed_at), kind: 'Attempted', text: `${what} sent to ${who}; the mail provider accepted it.`, source: 'outbound_actions' });
    if (String(a.status) === 'rejected') events.push({ at: String(a.created_at), kind: 'Attempted', text: `${what} for ${who} was refused by my own rules and not sent.`, source: 'outbound_actions' });
  }
  if (x) {
    for (const s of await whatTheWorldSaid(x.id)) {
      const amount = s.amountCents == null ? '' : ` ${money(s.amountCents, s.currency)}`;
      const text = s.kind === 'offer_delivered' ? 'An offer reached its business (delivery confirmed by the mail provider).'
        : s.kind === 'payment' ? `A customer paid${amount}${s.counterparty === 'unmatched_external' ? '' : ` (${s.counterparty.replace('_', ' ')}; does not count)`}.`
          : s.kind === 'delivery' ? (x.provider === 'stripe' ? 'The brief reached the buyer; delivery confirmed by the mail provider.' : 'The venue made the file available to the buyer at payment.')
            : s.kind === 'delivery_failed' ? 'A message bounced.' : s.kind === 'refund' ? `A payment of${amount} was refunded.` : `${s.whatItIs}.`;
      events.push({ at: s.observedAt, kind: s.kind === 'offer_delivered' || s.kind === 'delivery' ? 'Verified' : 'Observed', text, source: `business_outcome_events/${s.kind}` });
    }
  }
  // THE VENUE'S READINGS, as the owner entered them from its statistics.
  const readingPlan = (await offerShapePlanOf(experimentId))?.listing;
  if (readingPlan) {
    for (const o of await rows(`SELECT observed_at, saw FROM market_observations WHERE claim_id = (SELECT claim_id FROM venture_experiments WHERE id = ?) AND source LIKE ? ORDER BY observed_at`, [experimentId, `${readingPlan.venue}:stats:%`])) {
      events.push({ at: String(o.observed_at), kind: 'Observed', text: String(o.saw), source: 'market_observations' });
    }
  }
  for (const f of await rows(`SELECT payment_ref, status, refund_requested_at, refund_ref, updated_at FROM experiment_fulfilments WHERE experiment_id = ?`, [experimentId])) {
    if (f.refund_requested_at) events.push({ at: String(f.refund_requested_at), kind: 'Observed', text: `A refund was requested for payment ${String(f.payment_ref)}.`, source: 'experiment_fulfilments' });
    if (f.refund_ref) events.push({ at: String(f.updated_at), kind: 'Verified', text: `Refund issued for payment ${String(f.payment_ref)}.`, source: 'experiment_fulfilments' });
  }
  if (base.ran_at) {
    const grade = (await rows(`SELECT ${GRADE_SQL} AS grade FROM venture_experiments e WHERE e.id = ?`, [experimentId]))[0]?.grade;
    const settledAs = outcomeFromRow({ ran_at: String(base.ran_at), verdict: e.verdict, grade: grade == null ? null : String(grade) });
    events.push({ at: String(base.ran_at), kind: 'Concluded', text: `Settled by the world: ${settledAs.word}.`, source: `venture_experiments/${experimentId}` });
    events.push({ at: String(base.ran_at), kind: 'Learned', text: e.whatHappened ?? 'Recorded beside the prediction.', source: `venture_experiments/${experimentId}` });
  }
  return events.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * HIS REAL EXPERIMENTS, AS THE OWNER SEES THEM — the working set or the record.
 *
 * `'now'` is what can still produce evidence: undecided, ready, running. A
 * test the owner stopped is not settled by any row the SQL can read, so it
 * comes back under `'now'` with `concluded` true and the caller files it.
 * `'history'` is everything settled, most recently concluded first. `'all'`
 * is both, the live ones first, for readers that want the whole record.
 */
export async function listExperiments(founderId: string, now: Date = new Date(), scope: 'now' | 'history' | 'all' = 'all'): Promise<ExperimentView[]> {
  const ids = await rows(
    `SELECT e.id FROM venture_experiments e WHERE e.founder_id = ? AND e.evidence_mode = 'real'
        AND EXISTS (SELECT 1 FROM experiment_materials m WHERE m.experiment_id = e.id)
        ${scope === 'now' ? `AND NOT ${SETTLED_SQL}` : scope === 'history' ? `AND ${SETTLED_SQL}` : ''}
      ORDER BY ${scope === 'history'
    ? 'coalesce(e.retired_at, e.ran_at, e.invalidated_at, e.decided_at) DESC, e.rowid DESC'
    : 'CASE WHEN e.decision = \'approved\' AND e.ran_at IS NULL THEN 0 WHEN e.decision IS NULL THEN 1 ELSE 2 END, e.proposed_at DESC, e.rowid DESC'}`, [founderId]);
  const out: ExperimentView[] = [];
  for (const r of ids) { const v = await getExperimentView(founderId, String(r.id), now); if (v) out.push(v); }
  return out;
}

/**
 * THE LEDGER WITHOUT THE VIEWS. Every real test with materials, whether it is
 * settled and when, from the rows alone — one query, no hydration — for the
 * count behind "History (N)" and the handful that finished lately. A test the
 * owner stopped is not settled here (see `SETTLED_SQL`); the caller adds those
 * from the views it already holds.
 */
export async function experimentLedger(founderId: string): Promise<Array<{ id: string; settled: boolean; settledAt: string | null }>> {
  return (await rows(
    `SELECT e.id, CASE WHEN ${SETTLED_SQL} THEN 1 ELSE 0 END AS settled,
            coalesce(e.retired_at, e.ran_at, e.invalidated_at, CASE WHEN coalesce(e.decision,'') = 'declined' THEN e.decided_at END) AS settled_at
       FROM venture_experiments e WHERE e.founder_id = ? AND e.evidence_mode = 'real'
        AND EXISTS (SELECT 1 FROM experiment_materials m WHERE m.experiment_id = e.id)
      ORDER BY settled_at DESC, e.rowid DESC`, [founderId]))
    .map((r) => ({ id: String(r.id), settled: Number(r.settled) === 1, settledAt: r.settled_at == null ? null : String(r.settled_at) }));
}

/** What buyers have paid across every real test of his, from the world's own rows; nothing hydrated. */
export async function paidAcrossExperiments(founderId: string): Promise<number> {
  const r = (await rows(
    `SELECT coalesce(SUM(b.amount_cents), 0) AS cents
       FROM business_outcome_events b
       JOIN experiment_exposures x ON x.id = b.exposure_id
       JOIN venture_experiments e ON e.id = x.experiment_id
      WHERE e.founder_id = ? AND e.evidence_mode = 'real' AND b.kind = 'payment'`, [founderId]))[0];
  return Number(r?.cents ?? 0);
}
