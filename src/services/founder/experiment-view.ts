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
import { allowanceFor } from '../institution/standing-intent.js';
import { exposureOf, parseSettlementRule, whatTheWorldSaid } from '../venture/outcome.js';
import {
  campaignActOf, experimentRow, handExceptions, materialOf, offerShapePlanOf, readiness, recipientsOf,
  checkDeliverableQuality, checkOfferQuality, type ExperimentRow, type Readiness, type Recipient,
} from '../venture/hand.js';

type Row = Record<string, unknown>;
const rows = async (sql: string, params: unknown[]): Promise<Row[]> => (await query(sql, params)).rows as unknown as Row[];

export type ExperimentState = 'needs_you' | 'ready' | 'running' | 'completed' | 'stopped' | 'declined' | 'invalid';

export interface Step { key: 'recipients' | 'sending' | 'allow' | 'placing'; label: string; status: 'done' | 'todo' | 'foundry'; detail: string; href: string }

export interface TimelineEvent {
  at: string;
  kind: 'Observed' | 'Concluded' | 'Planned' | 'Authorized' | 'Attempted' | 'Verified' | 'Learned';
  text: string;
  source: string;
}

export interface ExperimentView {
  id: string; founderId: string; title: string; productId: string | null; assetName: string | null;
  state: ExperimentState; stateLabel: string; stateDetail: string;
  why: { whatWeDo: string; whatWeExpect: string; wouldDisprove: string; question: string };
  steps: Step[];
  allow: { possible: boolean; reason: string | null; explanation: string[] };
  exposure: { approved: number; excluded: number; pending: number; pendingWebForm: number; sent: number; delivered: number; bounced: number; remaining: number; killAt: number | null };
  money: { currency: string; allowanceCents: number; spentCents: number; remainingCents: number; paidCents: number; payments: number; refundedCents: number; refunds: number; paidYet: boolean };
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
}

const money = (cents: number, currency = 'USD') => `${currency.toUpperCase() === 'USD' ? '$' : ''}${(cents / 100).toFixed(2)}${currency.toUpperCase() === 'USD' ? '' : ` ${currency.toUpperCase()}`}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const KIND_WORDS: Record<string, string> = { offer_delivered: 'businesses have received the offer', arrival: 'people have arrived at the offer', payment: 'payments', delivery: 'paying customers receive what they bought' };

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
  const rule = parseSettlementRule(e.settlesWhen);
  const unknown = (await rows('SELECT question FROM market_unknowns WHERE id = (SELECT unknown_id FROM venture_experiments WHERE id = ?)', [experimentId]))[0];
  const price = plan ? `${money(plan.price.amountCents, plan.price.currency)} one-time` : 'one-time';
  const withdrawn = !!x && x.withdrawnAt !== null;
  const actLive = !!act && act.decision === 'approved' && act.revokedAt === null && new Date(act.expiresAt).getTime() > now.getTime();

  // ── Steps: exactly the owner's acts, then what Foundry does on its own ──
  const steps: Step[] = [
    { key: 'recipients', label: 'Review who may be contacted',
      status: recipients.length === 0 || ready.pending > 0 || ready.reachable === 0 ? 'todo' : 'done',
      detail: recipients.length === 0 ? 'No candidate businesses are loaded yet.'
        : ready.pending > 0 ? `${plural(ready.pending, 'business', 'businesses')} still to review. Exclude your employer and anything that could be a conflict; the rest can be approved together.`
          : ready.reachable > 0 ? `${ready.reachable} approved and reachable · ${ready.struck} excluded${ready.pendingWebForm ? ` · ${ready.pendingWebForm} web-form only, not contacted unless you add an email` : ''}.`
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
  const delivered = said.filter((s) => s.kind === 'offer_delivered').length;
  const payments = said.filter((s) => s.kind === 'payment');
  const refunds = said.filter((s) => s.kind === 'refund');
  const paidCents = payments.reduce((n, s) => n + (s.amountCents ?? 0), 0);
  const refundedCents = refunds.reduce((n, s) => n + (s.amountCents ?? 0), 0);
  const windowClosesAt = x && rule ? new Date(new Date(x.placedAt.replace(' ', 'T') + (x.placedAt.endsWith('Z') ? '' : 'Z')).getTime() + rule.withinDays * 86_400_000) : null;
  const daysLeft = windowClosesAt ? Math.max(0, Math.ceil((windowClosesAt.getTime() - now.getTime()) / 86_400_000)) : null;
  if (e.decision === 'declined') { state = 'declined'; stateLabel = 'Declined'; stateDetail = 'You decided not to run it.'; }
  else if (e.validity !== 'valid') { state = 'invalid'; stateLabel = 'Invalid'; stateDetail = 'It did not measure what it was for, so it is re-run rather than read.'; }
  else if (e.ranAt !== null) {
    const held = e.verdict === 'as_predicted';
    state = held ? 'completed' : 'stopped'; stateLabel = held ? 'Completed' : 'Stopped by its own rule';
    stateDetail = e.whatHappened ?? (held ? 'As predicted.' : 'Not as predicted.');
  } else if (e.decision === 'approved' && (withdrawn || (act && !actLive))) { state = 'stopped'; stateLabel = 'Stopped by you'; stateDetail = 'Nothing more is sent; what the world already did stays on record.'; }
  else if (e.decision === 'approved') {
    state = 'running'; stateLabel = 'Running';
    stateDetail = `${delivered === 0 ? 'No businesses have received the offer yet' : `${plural(delivered, 'business has', 'businesses have')} received the offer`}; ${payments.length === 0 ? 'no one has paid yet' : `${plural(payments.length, 'customer has', 'customers have')} paid`}.${daysLeft != null ? ` ${daysLeft} day${daysLeft === 1 ? '' : 's'} left in the window.` : ' The window opens when the offer is placed.'}`;
  } else if (!ready.ok) { state = 'needs_you'; stateLabel = 'Needs you'; stateDetail = `Before it can run: ${ready.missing.join('; ')}.`; }
  else { state = 'ready'; stateLabel = 'Ready'; stateDetail = 'Everything is in place. It runs when you allow it.'; }

  const allow = {
    possible: state === 'ready', reason: state === 'needs_you' ? stateDetail : null,
    explanation: [
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
  const moneyView = {
    currency: plan?.price.currency ?? 'USD', allowanceCents: allowance?.amountCents ?? e.costCents, spentCents: allowance?.spentCents ?? 0,
    remainingCents: allowance?.remainingCents ?? e.costCents, paidCents, payments: payments.length, refundedCents, refunds: refunds.length, paidYet: payments.length > 0,
  };
  const dq = deliverable ? checkDeliverableQuality(deliverable, now) : null;
  const offerView = {
    price, oneTime: true, paymentLinkUrl: offer?.paymentLinkUrl ?? null, offerQuality: offer ? checkOfferQuality(offer) : null,
    deliverable: deliverable && dq ? { title: deliverable.title, pulledAt: deliverable.pulledAt ? deliverable.pulledAt.slice(0, 10) : null, items: (deliverable.body.match(/^### /gm) ?? []).length, quality: dq } : null,
    limits: plan?.shape.claimsMade ?? '',
  };
  const learned = e.ranAt !== null
    ? { headline: e.verdict === 'as_predicted' ? 'The prediction held' : 'Not as predicted', detail: e.whatHappened ?? '', evidence: 'Settled by what providers reported at the offer, never by my opinion or yours.' }
    : { headline: payments.length ? `So far: ${plural(payments.length, 'customer has', 'customers have')} paid` : delivered ? 'So far: the offer has reached people; no one has paid yet' : 'Nothing commercial learned yet',
      detail: e.decision !== 'approved' ? 'It has not run.' : delivered === 0 ? 'No businesses have received the offer yet.' : payments.length === 0 ? 'No customer has paid yet.' : `${money(paidCents)} paid${refunds.length ? `, ${money(refundedCents)} refunded` : ''}.`,
      evidence: 'Only what the world does at the offer counts; an interested reply is not a payment.' };
  const judgment = state === 'running' && rule ? `Continue under the sealed rule: ${describeRule(rule)}.` : null;

  return {
    id: experimentId, founderId, title: e.whatWeDo, productId: e.productId, assetName: asset ? String(asset.name) : null,
    state, stateLabel, stateDetail,
    why: { whatWeDo: e.whatWeDo, whatWeExpect: e.whatWeExpect, wouldDisprove: e.wouldDisprove, question: unknown ? String(unknown.question) : '' },
    steps, allow, exposure, money: moneyView, offer: offerView,
    rules: { success: rule ? `Success means ${describeRule(rule)}.` : 'No machine rule; the owner would settle it.', stop: stopRules(e, rule), windowClosesAt: windowClosesAt ? windowClosesAt.toISOString().slice(0, 10) : null, daysLeft },
    learned, judgment,
    exceptions: await handExceptions(experimentId),
    timeline: await getExperimentTimeline(founderId, experimentId),
    controls: { canStop: e.decision === 'approved' && e.ranAt === null && !withdrawn, allowance: allowance ? { budget: money(allowance.amountCents), statement: allowance.statement } : null, actId: act?.id ?? null },
    details: [
      ['Experiment', experimentId], ['Decision', e.decision ?? 'undecided'], ['Validity', e.validity], ['Verdict', e.verdict ?? 'none yet'],
      ['Exposure', x ? `${x.provider}:${x.exposureRef}${withdrawn ? ' (withdrawn)' : ''}` : 'not placed'],
      ['Campaign act', act ? `${act.id} · ${act.decision ?? 'undecided'}${act.revokedAt ? ' · revoked' : ''}` : 'none'],
      ['Settlement rule', e.settlesWhen ?? 'none'], ['Asset', e.productId ?? 'none yet'],
      ['Counterparties that counted', String(said.filter((s) => s.kind === 'payment' && s.counterparty === 'unmatched_external').length)],
    ],
    recipients, readiness: ready,
  };
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
    events.push({ at: x.placedAt, kind: 'Planned', text: `The offer was placed: a ${x.provider} payment link, tagged for this test.`, source: `experiment_exposures/${x.id}` });
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
          : s.kind === 'delivery' ? 'The brief reached the buyer; delivery confirmed by the mail provider.'
            : s.kind === 'delivery_failed' ? 'A message bounced.' : s.kind === 'refund' ? `A payment of${amount} was refunded.` : `${s.whatItIs}.`;
      events.push({ at: s.observedAt, kind: s.kind === 'offer_delivered' || s.kind === 'delivery' ? 'Verified' : 'Observed', text, source: `business_outcome_events/${s.kind}` });
    }
  }
  for (const f of await rows(`SELECT payment_ref, status, refund_requested_at, refund_ref, updated_at FROM experiment_fulfilments WHERE experiment_id = ?`, [experimentId])) {
    if (f.refund_requested_at) events.push({ at: String(f.refund_requested_at), kind: 'Observed', text: `A refund was requested for payment ${String(f.payment_ref)}.`, source: 'experiment_fulfilments' });
    if (f.refund_ref) events.push({ at: String(f.updated_at), kind: 'Verified', text: `Refund issued for payment ${String(f.payment_ref)}.`, source: 'experiment_fulfilments' });
  }
  if (base.ran_at) {
    events.push({ at: String(base.ran_at), kind: 'Concluded', text: e.verdict === 'as_predicted' ? 'Settled by the world: as predicted.' : 'Settled by the world: not as predicted.', source: `venture_experiments/${experimentId}` });
    events.push({ at: String(base.ran_at), kind: 'Learned', text: e.whatHappened ?? 'Recorded beside the prediction.', source: `venture_experiments/${experimentId}` });
  }
  return events.sort((a, b) => a.at.localeCompare(b.at));
}

/** Every real experiment of his, newest first, as the owner sees them. */
export async function listExperiments(founderId: string, now: Date = new Date()): Promise<ExperimentView[]> {
  const ids = await rows(
    `SELECT e.id FROM venture_experiments e WHERE e.founder_id = ? AND e.evidence_mode = 'real'
        AND EXISTS (SELECT 1 FROM experiment_materials m WHERE m.experiment_id = e.id)
      ORDER BY CASE WHEN e.decision = 'approved' AND e.ran_at IS NULL THEN 0 WHEN e.decision IS NULL THEN 1 ELSE 2 END, e.proposed_at DESC, e.rowid DESC`, [founderId]);
  const out: ExperimentView[] = [];
  for (const r of ids) { const v = await getExperimentView(founderId, String(r.id), now); if (v) out.push(v); }
  return out;
}
