// =============================================================================
// THE HAND: a real experiment's offer reaches real people, and what they do
// comes back as outcome events
//
// The campaign's next work was "a first Hand behind an ask-first door". This is
// it, for the first real experiment: an emailed offer to businesses the owner
// reviewed, a Stripe Payment Link as the place the offer lives, delivery of
// what was paid for, a refund when delivery fails, and every provider receipt
// recorded as an outcome event the sealed settlement rule reads.
//
// Authority, in order, none of it self-declared:
//   * the owner approved the experiment (the prediction sealed, the allowance
//     set on the experimental asset);
//   * the owner approved ONE act, bound to the experiment as measurement-
//     critical, that names whom Foundry may write to; the plan guard on
//     `outbound_actions` (migration 284) admits a plan only under it;
//   * every send crosses the ordinary door: kill switch, tool policy,
//     do-not-contact, budget, idempotency, sender of record;
//   * receipts are the provider's, never Foundry's own word.
//
// Nothing here stores a buyer's identity in the outcome ledger.
// =============================================================================

import { STOP_AHEAD_DAYS, windowAndValidity, placementActCoversTheWindow, actHoursUntil } from './act-window.js';
export { windowAndValidity, placementActCoversTheWindow } from './act-window.js';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { invoke } from '../outbound/gateway.js';
import { getSendingIdentity } from '../outbound/sending-identity.js';
import { withRetry } from '../resilience.js';
import { decideProposedAct, proposeAct, revokeApproval, setBoundary } from '../institution/standing-intent.js';
import { stateOfferShape, retireExperimentalAsset } from './asset.js';
import { RECONCILE_DAYS } from './what-the-provider-knows.js';
import { answerLighter } from './legal-surface.js';
import { bindActToExperiment, exposureOf, placeExposure, recordBusinessOutcome, settleFromTheWorld, withdrawExposure } from './outcome.js';
import { OPEN_OBLIGATION, STILL_RECURS, UNCONFIRMED_IS_FAILED_AFTER_DAYS, obligationsOf, owesAnybody } from './obligations.js';
import { decideExperiment } from './validation.js';
import {
  buyerAddressFor, createExperimentPaymentLink, describePaymentLink, findExperimentPaymentLink, paymentCapabilityConfigured, paymentLinkParams,
  validateExperimentPaymentLink, type OfferPrice, type PaymentLinkFacts,
} from './payment-link.js';

type Row = Record<string, unknown>;
const rows = async (sql: string, params: unknown[]): Promise<Row[]> => (await query(sql, params)).rows as unknown as Row[];
const one = async (sql: string, params: unknown[]): Promise<Row | undefined> => (await rows(sql, params))[0];

export const HAND = 'institution:hand';

export class HandRefused extends Error {
  constructor(public readonly code: string, detail?: string) { super(detail ? `${code}: ${detail}` : code); this.name = 'HandRefused'; }
}

// ── The experiment as the hand sees it ───────────────────────────────────────

export interface ExperimentRow {
  id: string; founderId: string; opportunityId: string; decision: string | null; ranAt: string | null; validity: string;
  costCents: number; whatWeDo: string; whatWeExpect: string; wouldDisprove: string; settlesWhen: string | null;
  verdict: string | null; whatHappened: string | null; decidedAt: string | null; evidenceMode: string;
  productId: string | null;
  /** How it ended without running, when it did: retired (a duplicate, or killed
   * by the forge and its adversary), superseded by a later design, invalidated. */
  retiredAt: string | null; retiredBecause: string | null; supersededBy: string | null; invalidatedAt: string | null;
}

export async function experimentRow(experimentId: string): Promise<ExperimentRow | null> {
  const r = await one(
    `SELECT e.id, e.founder_id, e.opportunity_id, e.decision, e.ran_at, e.validity, e.cost_cents, e.what_we_do, e.what_we_expect,
            e.would_disprove, e.settles_when, e.verdict, e.what_happened, e.decided_at, e.evidence_mode,
            e.retired_at, e.retired_because, e.superseded_by, e.invalidated_at,
            -- The experiment's own asset, resolved by lineage. Reality and standing do
            -- not apply: an experimental asset is exactly what this reads, and a
            -- reference experiment's asset is read the same way for the rehearsal.
            (SELECT p.id FROM products p WHERE p.from_experiment_id = e.id AND p.deleted_at IS NULL) AS product_id
       FROM venture_experiments e WHERE e.id = ?`, [experimentId]);
  if (!r) return null;
  return {
    id: String(r.id), founderId: String(r.founder_id), opportunityId: String(r.opportunity_id),
    decision: r.decision == null ? null : String(r.decision), ranAt: r.ran_at == null ? null : String(r.ran_at),
    validity: String(r.validity), costCents: Number(r.cost_cents), whatWeDo: String(r.what_we_do), whatWeExpect: String(r.what_we_expect),
    wouldDisprove: String(r.would_disprove), settlesWhen: r.settles_when == null ? null : String(r.settles_when),
    verdict: r.verdict == null ? null : String(r.verdict), whatHappened: r.what_happened == null ? null : String(r.what_happened),
    decidedAt: r.decided_at == null ? null : String(r.decided_at), evidenceMode: String(r.evidence_mode),
    productId: r.product_id == null ? null : String(r.product_id),
    retiredAt: r.retired_at == null ? null : String(r.retired_at), retiredBecause: r.retired_because == null ? null : String(r.retired_because),
    supersededBy: r.superseded_by == null ? null : String(r.superseded_by), invalidatedAt: r.invalidated_at == null ? null : String(r.invalidated_at),
  };
}

/** Live means: approved, valid, not yet settled, and not stopped by the owner. */
export function isLive(e: ExperimentRow, exposureWithdrawn: boolean): boolean {
  // A stopped test is retired on its own row; the act it ran under may have
  // been used already (and a used act is history, not revocable), so the stop
  // is read from the test, never inferred from the act.
  return e.decision === 'approved' && e.validity === 'valid' && e.ranAt === null && e.retiredAt === null && !exposureWithdrawn;
}

// ── Whom Foundry may write to ────────────────────────────────────────────────

export interface Recipient {
  id: string; experimentId: string; counterpartyRef: string; email: string | null; channel: 'email' | 'web_form';
  sourceUrl: string | null; reviewStatus: 'pending' | 'approved' | 'struck'; reviewReason: string | null;
  /** Why this business belongs to the population the design named, and the record it was read from. */
  qualifiedAt: string | null; qualifiedBecause: string | null; qualifiedSource: string | null;
  /** Which evidence put it in the population, once that has been observed. Never a grade. */
  evidenceStratum: 'public_work_observed' | 'commercial_institutional_capable' | null;
  /**
   * WHEN A MESSAGE ACTUALLY WENT TO THIS ROW, or null. Without it a list can
   * tell the owner an address is protected where a message already went to
   * it — which is a comfortable lie about a thing that already happened to a
   * person, and the one thing a record of outreach must never do.
   */
  writtenToAt: string | null;
}

const recipientId = (experimentId: string, counterpartyRef: string) =>
  `rcpt_${createHash('sha256').update(`${experimentId} ${counterpartyRef.trim().toLowerCase()}`).digest('hex').slice(0, 24)}`;

/** Register candidates. Never approves anyone: approval is the owner's act. */
export async function addRecipients(input: {
  founderId: string; experimentId: string;
  recipients: Array<{ counterpartyRef: string; email?: string | null; channel: 'email' | 'web_form'; sourceUrl?: string | null }>;
}): Promise<{ added: number; excluded: Array<{ who: string; entity: string; matched: string }> }> {
  let added = 0;
  const excluded: Array<{ who: string; entity: string; matched: string }> = [];
  const { whyExcluded } = await import('../institution/owner-exclusions.js');
  for (const r of input.recipients) {
    // THE OWNER'S BOUNDARY, BEFORE THE ROW EXISTS. The database refuses an
    // excluded business outright; asking first means the pass drops it quietly
    // and can say the cohort is one smaller because of a decision he made,
    // rather than failing on a constraint nobody was expecting.
    const no = await whyExcluded({ founderId: input.founderId, name: r.counterpartyRef,
      email: r.email ?? null, url: r.sourceUrl ?? null });
    if (no.excluded) {
      excluded.push({ who: r.counterpartyRef.trim(), entity: no.entity ?? '', matched: no.matched ?? '' });
      continue;
    }
    const id = recipientId(input.experimentId, r.counterpartyRef);
    const existing = await one('SELECT id FROM experiment_recipients WHERE id = ?', [id]);
    if (existing) continue;
    await query(
      `INSERT INTO experiment_recipients (id, founder_id, experiment_id, counterparty_ref, email, channel, source_url)
       VALUES (?,?,?,?,?,?,?)`,
      [id, input.founderId, input.experimentId, r.counterpartyRef.trim(), r.email?.trim().toLowerCase() ?? null, r.channel, r.sourceUrl ?? null]);
    added += 1;
  }
  return { added, excluded };
}

export async function recipientsOf(experimentId: string): Promise<Recipient[]> {
  return (await rows(
    `SELECT r.*,
            (SELECT MIN(o.executed_at) FROM outbound_actions o
              WHERE o.recipient_id = r.id AND o.experiment_act = 'offer' AND o.executed_at IS NOT NULL)
              AS written_to_at
       FROM experiment_recipients r WHERE r.experiment_id = ? ORDER BY r.created_at, r.rowid`,
    [experimentId])).map((r) => ({
    id: String(r.id), experimentId: String(r.experiment_id), counterpartyRef: String(r.counterparty_ref),
    email: r.email == null ? null : String(r.email), channel: String(r.channel) as Recipient['channel'],
    sourceUrl: r.source_url == null ? null : String(r.source_url), reviewStatus: String(r.review_status) as Recipient['reviewStatus'],
    reviewReason: r.review_reason == null ? null : String(r.review_reason),
    qualifiedAt: r.qualified_at == null ? null : String(r.qualified_at),
    qualifiedBecause: r.qualified_because == null ? null : String(r.qualified_because),
    qualifiedSource: r.qualified_source == null ? null : String(r.qualified_source),
    evidenceStratum: r.evidence_stratum == null ? null
      : String(r.evidence_stratum) as Recipient['evidenceStratum'],
    writtenToAt: r.written_to_at == null ? null : String(r.written_to_at),
  }));
}

/**
 * WHY THIS BUSINESS IS IN THE POPULATION THE DESIGN NAMED. A screening
 * observation, recorded before anyone may be written to and readable by the
 * owner when he decides. Foundry records it; the database refuses it without
 * grounds and a source, and refuses to let it be rewritten afterwards.
 */
export async function qualifyRecipient(input: {
  founderId: string; experimentId: string; recipientId: string; because: string; source: string;
}): Promise<void> {
  const because = input.because.trim();
  const source = input.source.trim();
  if (!because || !source) throw new HandRefused('qualification_needs_grounds');
  const r = await query(
    `UPDATE experiment_recipients
        SET qualified_at = datetime('now'), qualified_because = ?, qualified_source = ?
      WHERE id = ? AND experiment_id = ? AND founder_id = ? AND qualified_at IS NULL`,
    [because, source, input.recipientId, input.experimentId, input.founderId]);
  if ((r.rowsAffected ?? 0) === 0) throw new HandRefused('recipient_not_found');
}

/**
 * HOW THIS ADDRESS WAS CHOSEN, recorded before anybody is written to.
 *
 * The column exists because "nobody replied" means something different when
 * every message went to a general inbox than when it went to an estimator who
 * asks for bids for a living. Recording it afterwards would let the channel be
 * re-described to suit the result, so the database refuses a second answer and
 * this only ever writes the first.
 */
export async function recordContactChoice(input: {
  founderId: string; experimentId: string; recipientId: string;
  kind: 'role' | 'named' | 'general'; source: string;
}): Promise<void> {
  const source = input.source.trim();
  if (!source) throw new HandRefused('contact_choice_needs_a_source');
  const r = await query(
    `UPDATE experiment_recipients SET contact_kind = ?, contact_source = ?
      WHERE id = ? AND experiment_id = ? AND founder_id = ? AND contact_kind IS NULL`,
    [input.kind, source, input.recipientId, input.experimentId, input.founderId]);
  if ((r.rowsAffected ?? 0) === 0) throw new HandRefused('recipient_not_found');
}

/**
 * WHICH EVIDENCE STRATUM A QUALIFIED BUSINESS FELL INTO.
 *
 * Not a grade. Both strata are fully qualified, both get the same offer at the
 * same price in the same words, and the split is recorded only because it may
 * turn out to be the interesting thing the experiment learns. It is written
 * before anything is sent and the database refuses a second answer, because a
 * stratum that could be revised once the results were in would let whichever
 * group happened to pay be relabelled the one that was always expected to.
 */
export async function recordStratum(input: {
  founderId: string; experimentId: string; recipientId: string;
  stratum: 'public_work_observed' | 'commercial_institutional_capable';
}): Promise<void> {
  const r = await query(
    `UPDATE experiment_recipients SET evidence_stratum = ?
      WHERE id = ? AND experiment_id = ? AND founder_id = ? AND evidence_stratum IS NULL`,
    [input.stratum, input.recipientId, input.experimentId, input.founderId]);
  if ((r.rowsAffected ?? 0) === 0) throw new HandRefused('recipient_not_found');
}

/** The owner's review of one candidate. The database re-verifies the reviewer. */
export async function reviewRecipient(input: {
  founderId: string; experimentId: string; recipientId: string; decision: 'approved' | 'struck'; reason?: string; email?: string;
}): Promise<void> {
  const email = input.email?.trim().toLowerCase();
  // PROVENANCE, NOT INPUT: `reviewed_by` is recorded for a person reading the
  // row later (a trigger checks it is the owner; that validates, it does not
  // consume). No code reads it, deliberately (write-only-columns baseline).
  const r = await query(
    `UPDATE experiment_recipients
        SET review_status = ?, review_reason = ?, reviewed_by = ?, reviewed_at = datetime('now'),
            email = COALESCE(?, email), channel = CASE WHEN ? IS NOT NULL THEN 'email' ELSE channel END
      WHERE id = ? AND experiment_id = ? AND founder_id = ?`,
    [input.decision, input.reason?.trim() || null, `founder:${input.founderId}`, email ?? null, email ?? null,
      input.recipientId, input.experimentId, input.founderId]);
  if ((r.rowsAffected ?? 0) === 0) throw new HandRefused('recipient_not_found');
}

/** "The rest are fine": every unreviewed candidate with an address. Web-form-only candidates stay out. */
export async function approveRemaining(input: { founderId: string; experimentId: string }): Promise<number> {
  const r = await query(
    `UPDATE experiment_recipients
        SET review_status = 'approved', reviewed_by = ?, reviewed_at = datetime('now')
      WHERE experiment_id = ? AND founder_id = ? AND review_status = 'pending' AND channel = 'email' AND email IS NOT NULL`,
    [`founder:${input.founderId}`, input.experimentId, input.founderId]);
  return r.rowsAffected ?? 0;
}

// ── What it sends and delivers ───────────────────────────────────────────────

export type MaterialKind = 'deliverable' | 'offer_template' | 'offer' | 'offer_shape';
export interface Material { id: string; kind: MaterialKind; title: string; body: string; pulledAt: string | null; digest: string; paymentLinkUrl: string | null; recordedAt: string }

export async function recordMaterial(input: {
  founderId: string; experimentId: string; kind: MaterialKind; title: string; body: string; pulledAt?: Date | null; paymentLinkUrl?: string | null; by: string;
}): Promise<string> {
  const id = nanoid();
  const digest = createHash('sha256').update(input.body).digest('hex').slice(0, 16);
  await query(`UPDATE experiment_materials SET superseded_at = datetime('now') WHERE experiment_id = ? AND kind = ? AND superseded_at IS NULL`, [input.experimentId, input.kind]);
  await query(
    `INSERT INTO experiment_materials (id, founder_id, experiment_id, kind, title, body, pulled_at, digest, payment_link_url, recorded_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, input.founderId, input.experimentId, input.kind, input.title, input.body, input.pulledAt?.toISOString() ?? null, digest, input.paymentLinkUrl ?? null, input.by]);
  return id;
}

export async function materialOf(experimentId: string, kind: MaterialKind): Promise<Material | null> {
  const r = await one(`SELECT * FROM experiment_materials WHERE experiment_id = ? AND kind = ? AND superseded_at IS NULL`, [experimentId, kind]);
  return r ? { id: String(r.id), kind, title: String(r.title), body: String(r.body), pulledAt: r.pulled_at == null ? null : String(r.pulled_at), digest: String(r.digest), paymentLinkUrl: r.payment_link_url == null ? null : String(r.payment_link_url), recordedAt: String(r.recorded_at) } : null;
}

/** Phrases the promise ledger forbids in anything Foundry sends for a test. */
export const BANNED_CLAIMS = ['never miss', 'guarantee', 'guaranteed', 'complete coverage', 'every bid', 'save you hours', 'hours saved', 'increase your revenue', 'more revenue', 'our customers', 'trusted by'];

/**
 * HOW OLD A BRIEF MAY BE WHEN IT IS DELIVERED. One number, exported, because
 * two places need it and they were disagreeing: the delivery gate refused at
 * seven days while the launch readiness check was content at fourteen, so
 * readiness could report a green chain for goods that could not lawfully be
 * handed over.
 */
export const DELIVERABLE_MAX_AGE_DAYS = 7;

export function checkDeliverableQuality(m: Material, now: Date, maxAgeDays = DELIVERABLE_MAX_AGE_DAYS): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const ageDays = m.pulledAt ? (now.getTime() - new Date(m.pulledAt).getTime()) / 86_400_000 : Number.POSITIVE_INFINITY;
  if (!(ageDays <= maxAgeDays)) failures.push(m.pulledAt ? `pulled ${Math.floor(ageDays)} days ago; the limit is ${maxAgeDays}` : 'no pull date');
  const items = (m.body.match(/^### /gm) ?? []).length;
  if (items < 1) failures.push('no items');
  const links = (m.body.match(/https:\/\/www\.commbuys\.com\/bso\/external\/bidDetail\.sda\?docId=/g) ?? []).length;
  if (links < items) failures.push(`${items} items but ${links} links to the authoritative record`);
  if (!/coverage|covers|limited to/i.test(m.body)) failures.push('coverage limits are not stated');
  if (/\[[A-Z ]+\]|\{[a-zA-Z ]+\}|TODO|TBD/.test(m.body)) failures.push('placeholder text remains');
  for (const phrase of BANNED_CLAIMS) if (m.body.toLowerCase().includes(phrase)) failures.push(`banned claim: "${phrase}"`);
  return { ok: failures.length === 0, failures };
}

/**
 * THE GATE WHAT A BUYER PAID FOR MUST PASS TO GO OUT, chosen by what made it.
 * A brief the hands made is held to the hands' own gate (every item cites a
 * row this owner's eyes retrieved, fresh, coverage stated, nobody named); a
 * deliverable written by hand keeps the gate it was written against
 * (Experiment 001's bid links). One function so launch, delivery, the page's
 * readiness and the obligation cannot disagree about whether it can go out —
 * they did, and every brief the hands made would have been refused after a
 * stranger paid for it (R20).
 */
export async function deliverableGate(experimentId: string, m: Material, now: Date): Promise<{ ok: boolean; failures: string[] }> {
  const shape = await materialOf(experimentId, 'offer_shape');
  let kind: unknown = null;
  try { kind = shape ? (JSON.parse(shape.body) as { kind?: unknown }).kind : null; } catch { kind = null; }
  if (kind === 'data_brief') {
    const e = await experimentRow(experimentId);
    if (!e) return { ok: false, failures: ['no such experiment'] };
    const { checkBriefQuality } = await import('./products/registry.js');
    return checkBriefQuality(e.founderId, m, now);
  }
  return checkDeliverableQuality(m, now);
}

export function checkOfferQuality(m: Material, pageUrl: string | null = null, plan: OfferShapePlan | null = null): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const body = m.body;
  if (!m.paymentLinkUrl || !/^https:\/\/buy\.stripe\.com\//.test(m.paymentLinkUrl)) failures.push('no Stripe payment link');
  // THE MESSAGE POINTS AT THE WORKSHOP'S PAGE, where the offer, its limits and
  // the ways to reach, refund and opt out all are; a raw payment link from an
  // unknown sender is exactly the shape the doctrine refuses. Without a
  // Workshop the link itself is the one place to pay and must be there.
  if (pageUrl) { if (!body.includes(pageUrl)) failures.push('the experiment page is not in the message'); }
  else if (m.paymentLinkUrl && !body.includes(m.paymentLinkUrl)) failures.push('the payment link is not in the message');
  if (/\[[A-Z ]+\]|\{[a-zA-Z ]+\}/.test(body.replace('{Business name}', ''))) failures.push('placeholder text remains');
  if (!/no reply needed|reply .{0,20}(no|stop)|unsubscribe|won't hear from me again/i.test(body)) failures.push('no plain opt-out line');
  // THE TERMS AS THE PLAN HAS THEM (R29). Without a plan to read against, the
  // old rule stands: a one-time price and no subscription, both said.
  if (!plan) {
    if (!/one[- ]time/i.test(body) || !/no subscription/i.test(body)) failures.push('one-time and no-subscription are not both stated');
  } else {
    const cents = plan.price.amountCents;
    const dollars = `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
    if (!body.includes(dollars)) failures.push(`the text does not state the price the plan charges (${dollars})`);
    if (plan.price.recurring) {
      if (/one[- ]time|no subscription/i.test(body)) failures.push('the text calls a weekly charge one-time');
      if (!/a week until you cancel/i.test(body)) failures.push('the text does not say it is charged every week until cancelled');
      if (!/cancel any time from the link in every email/i.test(body)) failures.push('the text does not say how to cancel');
      if (!/nothing is charged after you cancel/i.test(body)) failures.push('the text does not say nothing is charged after cancelling');
    } else {
      if (!/no subscription/i.test(body)) failures.push('the text does not say there is no subscription');
      if (plan.price.chosen ? !/what it was worth/i.test(body) : !/one[- ]time/i.test(body)) {
        failures.push(plan.price.chosen ? 'the text does not say the buyer chooses what to pay' : 'the text does not say the price is one-time');
      }
    }
  }
  for (const phrase of BANNED_CLAIMS) if (body.toLowerCase().includes(phrase)) failures.push(`banned claim: "${phrase}"`);
  return { ok: failures.length === 0, failures };
}

/** The template, completed: the page it points at and the link it rests on. */
export async function fillOffer(experimentId: string, template: string, linkUrl: string): Promise<{ body: string; pageUrl: string | null }> {
  const { pageUrlFor } = await import('../public-workshop/publication.js');
  const pageUrl = await pageUrlFor(experimentId);
  const body = template
    .replace(/\[PAYMENT LINK\]/g, linkUrl)
    .replace(/\[(APEX MICRO )?EXPERIMENT PAGE\]/g, pageUrl ?? linkUrl);
  return { body, pageUrl };
}

export function markdownToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/(^|[^"'>])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2">$2</a>');
  const out: string[] = []; let list: string[] = []; let para: string[] = [];
  const flushList = () => { if (list.length) { out.push(`<ul>${list.map((l) => `<li>${l}</li>`).join('')}</ul>`); list = []; } };
  const flushPara = () => { if (para.length) { out.push(`<p>${para.join(' ')}</p>`); para = []; } };
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushList(); flushPara(); continue; }
    const h = /^(#{1,3}) (.*)$/.exec(line);
    if (h) { flushList(); flushPara(); out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`); continue; }
    if (/^---+$/.test(line)) { flushList(); flushPara(); out.push('<hr />'); continue; }
    const li = /^[-*] (.*)$/.exec(line);
    if (li) { flushPara(); list.push(inline(li[1])); continue; }
    if (line.startsWith('|')) { flushList(); flushPara(); out.push(`<p style="font-family:monospace">${esc(line)}</p>`); continue; }
    flushList(); para.push(inline(line));
  }
  flushList(); flushPara();
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:680px">${out.join('\n')}</div>`;
}

// ── The shape and the facts, stated once the asset exists ────────────────────

export interface OfferShapePlan {
  shape: { sells: string; claimsMade: string; collects: string; deliversBy: string; sellsTo: string; chargesHow: string };
  lighter: string;
  /**
   * A LISTING THE OWNER PLACES HIMSELF, on a venue that carries the offer,
   * takes the money and delivers the file. Present only for that shape of
   * experiment; absent for one whose offer Foundry's hand carries. The hand
   * never runs for a listing: nobody is written to, nothing is published by
   * the institution, and the exposure is the listing's own address, pasted in
   * by the owner. Readings are the venue's statistics, entered by him.
   */
  listing?: { venue: string; venueName: string; readingsAtDays: number[] };
  /**
   * THE WORKSHOP'S OWN PAGE AS THE VENUE. The hand places the payment link
   * and publishes the page; nobody is written to; a buyer arrives on their
   * own, pays, and the hand delivers by email under an act that covers
   * exactly that. Readiness wants the thing, its words, its page and a way
   * to send — never a list of people.
   */
  venue?: 'workshop';
  /**
   * A FREE TOOL BESIDE THE PAID THING, for a design whose exchange is
   * `free_with_role`: a calculator specification (products/tool.ts) the page
   * carries and the Workshop's one reviewed program computes. Absent for every
   * offer that is only sold.
   */
  tool?: import('./products/tool.js').ToolSpec;
  /** structural_fact_kinds.fact → present, with grounds; written as the pass would, basis offer_shape. */
  /**
   * WHAT KIND OF CLAIM EACH ONE IS, not only what it claims. A recipe's
   * intention satisfied a binding policy requirement exactly as an observation
   * would, and nothing said which it was; `basis` is now carried from the
   * composition to the record so the policy can tell them apart.
   */
  facts: Record<string, {
    present: 0 | 1;
    grounds: string;
    /** enforced (a named control makes it true), observed (somebody looked), or assumed. */
    basis?: 'enforced' | 'observed' | 'assumed';
    /** For an enforced claim: the control that would refuse. Required by the rows. */
    enforcedBy?: string;
  }>;
  price: OfferPrice;
  offerSubject: string;
}

export async function offerShapePlanOf(experimentId: string): Promise<OfferShapePlan | null> {
  const m = await materialOf(experimentId, 'offer_shape');
  if (!m) return null;
  try { return JSON.parse(m.body) as OfferShapePlan; } catch { return null; }
}

/**
 * STATE THE OFFER'S SHAPE AND THE FACTS THE FIRST-PROOF POLICY READS, as the
 * pass would. Shared by every real experiment's approval: the emailed brief's
 * Allow and the marketplace listing's approval both have to leave the asset
 * with a shape the legal picture can read before an exposure may be placed.
 */
export async function statedShapeAndFacts(e: ExperimentRow, productId: string, plan: OfferShapePlan): Promise<void> {
  const shaped = await stateOfferShape({ productId, by: HAND, shape: plan.shape });
  if ('refused' in shaped) throw new HandRefused('shape_refused', shaped.refused);
  await answerLighter({ opportunityId: e.opportunityId, answer: plan.lighter });
  for (const [fact, f] of Object.entries(plan.facts)) {
    const already = await one(`SELECT id FROM structural_facts WHERE subject_kind = 'company' AND subject_id = ? AND fact = ? AND superseded_at IS NULL`, [productId, fact]);
    if (already) continue;
    // THE COMPOSITION'S OWN WORD FOR WHAT KIND OF CLAIM THIS IS. Where it does
    // not say, the honest default is `assumed`: a fact nobody classified came
    // from a recipe, and calling that `offer_shape` let it satisfy a binding
    // requirement as if somebody had checked.
    await query(
      `INSERT INTO structural_facts (id, founder_id, subject_kind, subject_id, fact, present, basis, grounds, enforced_by, recognised_by, evidence_mode)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [`sf_${nanoid(8)}`, e.founderId, 'company', productId, fact, f.present,
        f.basis ?? 'assumed', f.grounds, f.enforcedBy ?? null, HAND, e.evidenceMode]);
  }
}

// ── The ask-first door: one act, bound to the experiment ─────────────────────

export async function campaignActOf(experimentId: string): Promise<{ id: string; decision: string | null; revokedAt: string | null; expiresAt: string } | null> {
  const r = await one(
    `SELECT id, decision, revoked_at, expires_at FROM proposed_acts
      WHERE experiment_id = ? AND subject = 'contact_people' AND action_type = 'send_email' AND coalesce(measurement_critical, 0) = 1
      ORDER BY proposed_at DESC, rowid DESC LIMIT 1`, [experimentId]);
  return r ? { id: String(r.id), decision: r.decision == null ? null : String(r.decision), revokedAt: r.revoked_at == null ? null : String(r.revoked_at), expiresAt: String(r.expires_at) } : null;
}

export async function campaignIsLive(experimentId: string): Promise<boolean> {
  const a = await campaignActOf(experimentId);
  return !!a && a.decision === 'approved' && a.revokedAt === null && new Date(a.expiresAt).getTime() > Date.now();
}

/**
 * WHAT WAS TAKEN ON WHILE THE ACT STOOD IS DISCHARGED UNDER IT. An act's expiry
 * bounds what may be taken on (an offer, a purchase reported after it) and not
 * the discharge of what was taken on while it stood: a buyer who paid on the
 * last day the offer stood is owed the goods on the day after. The act says so
 * in its own words when the owner approves it (below), so this is his reading
 * and not the hand's; a REVOKED act covers nothing, because revocation is his
 * word too. `since` is the fulfilment's own clock, never the caller's.
 */
export async function campaignActCovers(experimentId: string, since: string): Promise<boolean> {
  const a = await campaignActOf(experimentId);
  return !!a && a.decision === 'approved' && a.revokedAt === null && new Date(since.includes('T') ? since : since.replace(' ', 'T') + 'Z').getTime() <= new Date(a.expiresAt).getTime();
}

function campaignParams(experimentId: string, approved: Recipient[], template: Material | null): Record<string, unknown> {
  return { experiment_id: experimentId, recipients: approved.map((r) => r.id).sort(), template_digest: template?.digest ?? null, one_message_each: true };
}

/**
 * ALLOW THIS EXPERIMENT: one owner gesture, two decisions recorded. The
 * experiment's decision (prediction sealed, asset and allowance made) and the
 * campaign act's decision (whom Foundry may write to, once each). Then
 * Foundry states the offer's shape and the facts the first-proof policy reads,
 * as the pass would, so the exposure can be placed.
 */
export async function allowExperiment(input: {
  founderId: string; experimentId: string; within?: Date;
  /**
   * UNDER THE CHARTER, NOT BY HIS HAND. When the owner has signed a standing
   * envelope on Controls, a probe inside it is let in and its acts are decided
   * as `charter:<id>` — a principal the row guard accepts only while the
   * envelope is live. Outside the envelope this refuses with the reasons, and
   * the test waits for him on Decisions exactly as before.
   */
  under?: 'the charter';
}): Promise<{ productId: string; actId: string }> {
  const e = await experimentRow(input.experimentId);
  if (!e || e.founderId !== input.founderId) throw new HandRefused('experiment_not_found');
  if (e.decision !== null) throw new HandRefused('already_decided', e.decision);
  // THE CHARTER IS READ BEFORE ANYTHING IS DECIDED. The three acts below stand
  // on the public and financial rungs; a probe whose cost is not left in the
  // month, or that would be the fourth in flight, is not inside, and the row
  // guard on the carve refuses again below in case this reading is skipped.
  const { chartered, charterPrincipal, carve } = await import('../institution/charter.js');
  const recurring = !!(await offerShapePlanOf(input.experimentId))?.price.recurring;
  const charter = input.under === 'the charter'
    ? await chartered({ founderId: input.founderId, experimentId: input.experimentId, costCents: e.costCents, rungs: ['public', 'financial'], recurring })
    : null;
  if (charter && !charter.inside) throw new HandRefused('outside_the_charter', charter.because.join('; '));
  // THE THINKING COMES BEFORE THE DECISION — before the sending address, before
  // the postal line, before anything a checklist could supply. What the
  // deliberation says it is not ready for is refused here rather than
  // discovered by the people it would have reached.
  const { designStandsInTheWay, sealDesign } = await import('./probe-design.js');
  const inTheWay = await designStandsInTheWay(input.experimentId);
  if (inTheWay.length) throw new HandRefused('design_not_ready', inTheWay.join('; '));
  const ready = await readiness(input.experimentId);
  if (!ready.ok) throw new HandRefused('not_ready', ready.missing.join('; '));
  const plan = await offerShapePlanOf(input.experimentId);
  if (!plan) throw new HandRefused('no_offer_shape');
  // NOTHING RECURS THAT FOUNDRY CANNOT STOP. A subscription is let in only
  // when the owner has lifted the first-proof rule against it themselves, and
  // only while Foundry's money switch is on — because that switch is what
  // lets the hand cancel one, and a subscriber whom nobody but the owner can
  // cancel is a promise on the page that the institution cannot keep.
  if (plan.price.recurring) {
    const runnable = await subscriptionsRunnable(input.founderId);
    if (!runnable.ok) throw new HandRefused(runnable.code, runnable.because);
  }
  const { publicWorkshopOf } = await import('../public-workshop/settings.js');
  const paused = (await publicWorkshopOf(input.founderId))?.economicPause;
  if (paused) throw new HandRefused('workshop_paused', paused.reason);
  const by = charter?.inside ? charterPrincipal(charter.charter.id) : `founder:${input.founderId}`;
  // HOW LONG IT RUNS AND HOW LONG ITS ACTS LAST (R24), read before anything is
  // decided: from the rule's kind and the charter row, never from a caller,
  // whose \`within\` may only shorten the acts.
  const window = windowAndValidity({ now: new Date(), recurring: !!plan.price.recurring,
    charterExpiresAt: charter?.inside ? charter.charter.expiresAt : null, within: input.within });
  if ('refused' in window) throw new HandRefused('window_too_short', window.refused);
  // A VENUE TEST IS SETTLED BY PAYMENT. The rule is sealed with the prediction
  // at approval; without one only the owner could settle it, and a studio
  // test must settle itself. Thirty days from placement, at least one payment.
  if (plan.venue === 'workshop' && e.settlesWhen === null) {
    const { settlementRuleJson } = await import('./outcome.js');
    await query('UPDATE venture_experiments SET settles_when = ? WHERE id = ? AND decision IS NULL AND settles_when IS NULL',
      [settlementRuleJson({ event: 'payment', atLeast: 1, withinDays: window.withinDays }), input.experimentId]);
  }
  await decideExperiment({ experimentId: input.experimentId, decision: 'approved', by, via: 'its own authorisation' });
  const after = await experimentRow(input.experimentId);
  if (!after?.productId) throw new HandRefused('asset_missing');
  // LET IN, AS A ROW. The carve is what the envelope's arithmetic reads, and
  // its guard is the one that cannot be talked past.
  if (charter?.inside) await carve({ charterId: charter.charter.id, experimentId: input.experimentId, productId: after.productId, cents: e.costCents });
  await statedShapeAndFacts(after, after.productId, plan);
  // WHO THIS APPROVAL COVERS, decided here and never again. Approval is the
  // owner's consent and screening is the institution's evidence; an offer needs
  // both, and until now it needed them *at the moment of sending*, which made
  // consent over a group into standing authority over whoever later qualified.
  // The set is closed at this instant: approved, reachable, and already carrying
  // recorded grounds. Qualifying somebody afterwards makes them eligible for a
  // future decision, which is what evidence is for.
  const reachable = (await recipientsOf(input.experimentId)).filter((r) => r.reviewStatus === 'approved' && r.channel === 'email' && r.email);
  const approved = reachable.filter((r) => r.qualifiedAt);
  const template = await materialOf(input.experimentId, 'offer_template');
  const hours = actHoursUntil(window.actsExpireAt);
  // HIS STANDING WORD FOR THIS ASSET: nobody is written to from it without
  // asking him first. The one act he approves below is the answer, for exactly
  // the businesses he reviewed and the offer as written; a door that hears
  // this boundary and finds no such act refuses.
  await setBoundary({ productId: after.productId, subject: 'contact_people', mode: 'ask_first',
    statement: plan.venue === 'workshop'
      ? 'Ask me before writing to anyone for this test; the only people written to are buyers, once each, to deliver what they paid for'
      : 'Ask me before writing to anyone for this test; the one act I approve when I allow it is the whole of it' });
  await setBoundary({ productId: after.productId, subject: 'publish', mode: 'ask_first',
    statement: 'Ask me before placing an offer anywhere for this test' });
  await setBoundary({ productId: after.productId, subject: 'move_money', mode: 'ask_first',
    statement: plan.price.recurring
      ? 'Ask me before moving money for this test; refunding a week that was not delivered or that the buyer returns, and stopping a subscription, are the things I allow'
      : 'Ask me before moving money for this test; refunding a purchase that was not delivered or that the buyer returns is the one thing I allow' });
  // THE THREE ACTS ALLOWING IT IS. Each is exact: the campaign over the
  // businesses he reviewed and the offer as written; the payment link over its
  // precise parameters; the refund over purchases the provider reported at
  // this test's exposure and nothing else. The door resolves each from rows.
  const placementId = await proposeAct({
    productId: after.productId, subject: 'publish', actionType: 'stripe_create_payment_link',
    params: paymentLinkParams(input.experimentId, plan.price),
    summary: plan.price.recurring
      ? `Create the ${plan.price.currency.toUpperCase()} ${(plan.price.amountCents / 100).toFixed(2)}-a-${plan.price.recurring.interval} subscription link on your Stripe account, tagged for this test; every week paid is one brief owed`
      : plan.price.chosen
      ? `Create the pay-what-it-was-worth payment link on your Stripe account, suggesting ${plan.price.currency.toUpperCase()} ${(plan.price.amountCents / 100).toFixed(2)} (between ${(plan.price.chosen.minimumCents / 100).toFixed(2)} and ${(plan.price.chosen.maximumCents / 100).toFixed(2)}), tagged for this test`
      : `Create the ${plan.price.currency.toUpperCase()} ${(plan.price.amountCents / 100).toFixed(2)} one-time payment link on your Stripe account, tagged for this test`,
    why: 'The offer needs one place a buyer can pay, and the tag is how a payment is known to belong to this test.',
    expectedEffect: 'A product, a one-time price and a payment link exist on the shared account; no money moves.', risk: 'None beyond a catalog object that can be deactivated.',
    consequence: 'low', rung: 'public', costCents: 0, proposedBy: HAND, validForHours: hours,
  });
  const placed = await bindActToExperiment({ actId: placementId, experimentId: input.experimentId, measurementCritical: true });
  if ('refused' in placed) throw new HandRefused('act_binding_refused', placed.refused);
  await decideProposedAct({ id: placementId, decision: 'approved', decidedBy: by });
  const refundId = await proposeAct({
    productId: after.productId, subject: 'move_money', actionType: 'stripe_create_refund',
    params: { experiment_id: input.experimentId, refunds: 'a purchase reported at this test\'s exposure whose delivery failed or whose buyer asked, in full',
      stands_for: 'purchases reported while this act is valid; returning one is never cut off by its expiry or by the test ending' },
    summary: 'Refund, in full, any purchase of this test that could not be delivered or that the buyer returns; a purchase made while this stands is refunded whenever that happens, after it expires and after the test ends',
    why: 'A buyer who did not get what they paid for is owed their money without waiting for you.',
    expectedEffect: 'The purchase amount returns to the buyer\'s card through your Stripe account.', risk: 'At most the purchases themselves; nothing of yours beyond what buyers paid.',
    consequence: 'medium', rung: 'financial', costCents: 0, proposedBy: HAND, validForHours: hours,
  });
  const refundable = await bindActToExperiment({ actId: refundId, experimentId: input.experimentId, measurementCritical: false });
  if ('refused' in refundable) throw new HandRefused('act_binding_refused', refundable.refused);
  await decideProposedAct({ id: refundId, decision: 'approved', decidedBy: by });
  if (plan.price.recurring) await approveTheStop({ productId: after.productId, experimentId: input.experimentId, by, validForHours: hours });
  if (plan.venue === 'workshop') {
    // THE ONLY MESSAGE IS THE DELIVERY. One act covers writing to each buyer
    // the provider reports at this test's page, once, with what they paid
    // for; nobody else is written to under it, and the hand that plans an
    // offer to a stranger finds no act that covers one.
    const deliveryId = await proposeAct({
      productId: after.productId, subject: 'contact_people', actionType: 'send_email',
      params: { experiment_id: input.experimentId, delivers: 'the deliverable, once, to each buyer the provider reports at this test\'s exposure', one_message_each: true,
        stands_for: 'purchases reported while this act is valid; delivering one is never cut off by its expiry' },
      summary: plan.price.recurring
        ? `Send each week's ${plan.price.productName} once to each subscriber the provider reports at this test's page, for every week they pay while this stands; nobody else is written to`
        : `Send ${plan.price.productName} once to each buyer the provider reports at this test's page, including a buyer who paid on the last day it stands; nobody else is written to`,
      why: 'A buyer who paid is owed what they paid for, without waiting for you.',
      expectedEffect: plan.price.recurring ? 'One email per paid week, carrying that week\'s edition, a refund link and a cancel link.' : 'One email per settled payment, carrying the deliverable and a refund link.', risk: 'One message per buyer; a buyer who asks to hear nothing further is never written to again.',
      consequence: 'low', rung: 'public', costCents: 0, proposedBy: HAND, validForHours: hours,
    });
    const boundDelivery = await bindActToExperiment({ actId: deliveryId, experimentId: input.experimentId, measurementCritical: true });
    if ('refused' in boundDelivery) throw new HandRefused('act_binding_refused', boundDelivery.refused);
    await decideProposedAct({ id: deliveryId, decision: 'approved', decidedBy: by });
    await sealDesign(input.experimentId);
    return { productId: after.productId, actId: deliveryId };
  }
  const actId = await proposeAct({
    productId: after.productId, subject: 'contact_people', actionType: 'send_email',
    params: campaignParams(input.experimentId, approved, template),
    summary: `Write once to each of the ${approved.length} businesses you approved that the screening puts in this population${reachable.length > approved.length ? ` (${reachable.length - approved.length} more you approved carry no recorded grounds and are not covered)` : ''}, in your name, offering ${plan.price.productName} at $${(plan.price.amountCents / 100).toFixed(2)} one-time; a buyer who pays while this stands is sent what they paid for even after it expires`,
    why: e.whatWeDo, expectedEffect: e.whatWeExpect, risk: 'One message per business, no follow-ups; a business that does not reply is never written to again for this test.',
    consequence: 'medium', rung: 'public', costCents: 0, proposedBy: HAND, validForHours: hours,
  });
  const bound = await bindActToExperiment({ actId, experimentId: input.experimentId, measurementCritical: true });
  if ('refused' in bound) throw new HandRefused('act_binding_refused', bound.refused);
  await decideProposedAct({ id: actId, decision: 'approved', decidedBy: by });
  // The act's own list is a fingerprint, and a hash is not something a row guard
  // can check membership against. So the membership is written where it can be
  // enforced: on the people it covers, naming the act that covered them.
  for (const r of approved) {
    await query('UPDATE experiment_recipients SET authorised_act_id = ? WHERE id = ? AND authorised_act_id IS NULL', [actId, r.id]);
  }
  // Sealed with the prediction, for the same reason: a deliberation that could
  // be edited afterwards would let every result be narrated as the expected one.
  await sealDesign(input.experimentId);
  return { productId: after.productId, actId };
}

/**
 * CAN THIS OWNER'S FOUNDRY RUN A SUBSCRIPTION TODAY? Two facts, both read: the
 * owner's own row lifting the first-proof rule against recurring billing
 * (R17), and the money switch that lets the hand cancel one (R19). The forge
 * reads it so it does not design what would be refused; the composition and
 * the allowance refuse on it.
 */
export async function subscriptionsRunnable(founderId: string): Promise<{ ok: true } | { ok: false; code: 'subscriptions_not_allowed' | 'subscription_cannot_be_stopped'; because: string }> {
  const { originationPolicyFor } = await import('./legal-surface.js');
  const rule = (await originationPolicyFor(founderId)).find((p) => p.requirement === 'no_recurring_billing');
  if (!rule || rule.treatment === 'refuse' || rule.treatment === 'require') {
    return { ok: false, code: 'subscriptions_not_allowed', because: 'the first-proof rule refuses recurring billing until you allow subscriptions on Control' };
  }
  if (process.env.FOUNDRY_ENABLE_MONEY_TOOLS !== 'true') {
    return { ok: false, code: 'subscription_cannot_be_stopped', because: 'Foundry\'s money switch is off, so it could not cancel a subscriber; a subscription is not offered until it can' };
  }
  return { ok: true };
}

/**
 * THE STOP COMES WITH THE START. Approved with a subscription test, by whoever
 * approved the test, in words that say it outlives the act's expiry and the
 * test's end exactly as the refund does; the door finds it from a
 * cancellation row and the exact stop, never from a caller (standing-intent.ts).
 */
export async function approveTheStop(input: { productId: string; experimentId: string; by: string; validForHours: number }): Promise<string> {
  const cancelId = await proposeAct({
    productId: input.productId, subject: 'move_money', actionType: 'stripe_update_subscription',
    params: { experiment_id: input.experimentId, stops: 'a subscription a paid week of this test belongs to, at the end of the week already paid',
      when: 'the buyer asks through the link in a delivery, or the test can no longer deliver the next week',
      stands_for: 'subscriptions started while this act is valid; stopping one is never cut off by its expiry or by the test ending' },
    summary: 'Stop, at the end of the week already paid, any subscription this test started: when the buyer asks through the link in their email, and for everyone once the test can no longer deliver another week. This stands after it expires and after the test ends',
    why: 'Nobody should be charged for a week Foundry may not deliver, or after they asked to stop.',
    expectedEffect: 'The subscription is set to end with its current week on your Stripe account; nothing is refunded and nothing more is charged.',
    risk: 'A subscriber stops paying for weeks they might have wanted; never more than that.',
    consequence: 'medium', rung: 'financial', costCents: 0, proposedBy: HAND, validForHours: input.validForHours,
  });
  const stoppable = await bindActToExperiment({ actId: cancelId, experimentId: input.experimentId, measurementCritical: false });
  if ('refused' in stoppable) throw new HandRefused('act_binding_refused', stoppable.refused);
  await decideProposedAct({ id: cancelId, decision: 'approved', decidedBy: input.by });
  return cancelId;
}

/** The owner declines: the experiment is decided against and nothing is made. */
export async function declineExperiment(input: { founderId: string; experimentId: string }): Promise<void> {
  const e = await experimentRow(input.experimentId);
  if (!e || e.founderId !== input.founderId) throw new HandRefused('experiment_not_found');
  if (e.decision !== null) throw new HandRefused('already_decided', e.decision);
  await decideExperiment({ experimentId: input.experimentId, decision: 'declined', by: `founder:${input.founderId}`, via: 'its own authorisation' });
}

/**
 * THE OFFER COMES DOWN. A withdrawn exposure is a row; the link in the world
 * is deactivated through the door, under the act that placed it, so nobody
 * can pay for a test that has ended. Idempotent by dedup key; a provider
 * refusal is reported, never hidden, and tried again on the next pass.
 */
export async function takeDownExposure(experimentId: string): Promise<{ done: boolean; reason: string | null }> {
  const e = await experimentRow(experimentId);
  const x = await exposureOf(experimentId);
  if (!e?.productId || !x || x.withdrawnAt === null) return { done: false, reason: 'nothing to take down' };
  if (x.provider !== 'stripe') return { done: true, reason: null };
  // Once the acts are revoked (the owner stopped it) the door will not open
  // again; the link came down at the stop, and there is nothing to retry.
  const standing = await one(
    `SELECT id FROM proposed_acts WHERE experiment_id = ? AND action_type = 'stripe_create_payment_link' AND decision = 'approved' AND revoked_at IS NULL AND datetime(expires_at) > datetime('now')`,
    [experimentId]);
  if (!standing) {
    // THE ACT ENDED WITH THE LINK STILL UP (R24). Said, not swallowed: a link
    // nobody may take down keeps taking money for a test that is over.
    const stillUp = paymentCapabilityConfigured()
      ? await findExperimentPaymentLink(experimentId).catch(() => null) : null;
    return stillUp
      ? { done: false, reason: 'the act that placed the link has ended and the link is still up; deactivate it in Stripe' }
      : { done: false, reason: 'nothing to take down' };
  }
  const result = await invoke({
    productId: e.productId, tool: 'stripe_deactivate_payment_link', action: `take down the payment link for experiment ${experimentId}`,
    params: { payment_link_id: x.exposureRef }, dedupKey: `experiment:${experimentId}:payment_link:withdraw:${x.exposureRef}`,
    customerExternalId: `experiment:${experimentId}`, surface: 'billing', dataClass: 'customer',
  });
  return result.ok ? { done: true, reason: null } : { done: false, reason: `${result.phase}: ${result.reason}` };
}

/** The owner stops a running test: the offer is withdrawn and taken down, every act is revoked, the asset retired. Final. */
export async function stopExperiment(input: { founderId: string; experimentId: string; reason: string }): Promise<{ takenDown: boolean; because: string | null }> {
  const e = await experimentRow(input.experimentId);
  if (!e || e.founderId !== input.founderId) throw new HandRefused('experiment_not_found');
  const reason = input.reason.trim();
  if (!reason) throw new HandRefused('reason_required');
  const x = await exposureOf(input.experimentId);
  if (x && x.withdrawnAt === null) await withdrawExposure(x.id);
  // The link comes down while the placement act still stands to cover it.
  const down = await takeDownExposure(input.experimentId).catch((err: unknown) => ({ done: false, reason: err instanceof Error ? err.message : String(err) }));
  // The acts that TAKE THINGS ON are revoked: the campaign and the placement.
  // The refund act is not, because a stop is not a decision to keep a buyer's
  // money: a purchase that slipped in before the link came down is returned
  // under the act he already approved, and the door finds it there. Nor is
  // the act that stops a subscription: a stop that left subscribers being
  // charged would be the opposite of a stop.
  for (const a of await rows(`SELECT id FROM proposed_acts WHERE experiment_id = ? AND decision = 'approved' AND revoked_at IS NULL AND action_type NOT IN ('stripe_create_refund', 'stripe_update_subscription')`, [input.experimentId])) {
    await revokeApproval(String(a.id), reason);
  }
  await stopWhatRecurs(input.experimentId).catch(() => undefined);
  // The asset retires now if nobody is owed anything; otherwise the next pass
  // retires it once the last buyer has been refunded (carryWhatIsOwed).
  if (e.productId) await retireExperimentalAsset({ productId: e.productId, because: `you stopped it: ${reason}` });
  // THE STOP IS WRITTEN ON THE TEST. It used to live only on the exposure and
  // the acts, so the attention queue read the withdrawn exposure as "approved
  // and not yet listed" and asked him to list the test he had just stopped.
  // A test that already ran is settled by the world and cannot be retired; a
  // test that had not run is retired here with his reason.
  const { retireExperiment } = await import('./validation.js');
  await retireExperiment({ experimentId: input.experimentId, by: `founder:${input.founderId}`, because: `you stopped it: ${reason}` });
  // The public record says what happened, and stays.
  await republishRecord(input.experimentId).catch(() => undefined);
  return { takenDown: down.done, because: down.reason };
}

// ── Readiness: exactly the owner's acts ──────────────────────────────────────

export interface Readiness { ok: boolean; missing: string[]; reachable: number; pending: number; pendingWebForm: number; struck: number; sending: SendingReadiness }
export interface SendingReadiness { status: 'ready' | 'not_connected' | 'unavailable'; fromLine: string | null; detail: string; identityProductId: string | null }

/**
 * THE COMPANY A TEST SENDS AS: the owner's one earned real company, where his
 * sending identity lives (sending-identity.ts applies the same rule at the
 * send). Null when he has none or more than one — ambiguity refuses.
 */
export async function senderCompanyOf(founderId: string): Promise<string | null> {
  // UNDER A WORKSHOP, THE SENDER IS THE WORKSHOP. This required exactly one
  // earned real company and returned nothing otherwise, so the day the owner
  // named a second company no test could write to anyone: "Foundry cannot
  // tell which one that is". A month of a portfolio run in the laboratory
  // found it. The Workshop, where one stands, is the one public voice and
  // the sender; the single-company rule is for an owner without one.
  const w = (await rows(`SELECT product_id FROM public_workshop WHERE founder_id = ? AND product_id IS NOT NULL`, [founderId]))[0];
  if (w?.product_id != null) {
    const alive = await rows(`SELECT id FROM products WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`, [String(w.product_id), founderId]);
    if (alive.length === 1) return String(w.product_id);
  }
  const r = await rows(`SELECT id FROM products WHERE owner_id = ? AND standing = 'earned' AND reality = 'real' AND deleted_at IS NULL`, [founderId]);
  return r.length === 1 ? String(r[0].id) : null;
}

export async function sendingReadiness(founderId: string): Promise<SendingReadiness> {
  const identityProductId = await senderCompanyOf(founderId);
  if (!identityProductId) return { status: 'unavailable', fromLine: null, detail: 'Tests send as your own company, and Foundry cannot tell which one that is: you have none, or more than one. Establish exactly one before a test can write to anyone.', identityProductId: null };
  const identity = await getSendingIdentity(identityProductId);
  if (!identity) return { status: 'not_connected', fromLine: null, detail: 'Messages for tests go out as you, from an address on your own domain, through your own mail provider account. Nothing goes out from a Foundry address.', identityProductId };
  // UNDER A WORKSHOP, THE SENDER IS THE WORKSHOP: its one stable address on
  // its own domain, named for the person and the workshop, never rotated.
  const { publicWorkshopOf } = await import('../public-workshop/settings.js');
  const w = await publicWorkshopOf(founderId);
  if (w && (!identity.fromEmail.endsWith(`@${w.zoneName}`) || !(identity.fromName ?? '').includes(w.publicName))) {
    return { status: 'not_connected', fromLine: null, detail: `Tests write as ${w.publicName} <${w.contactEmail}>; the connected address is ${identity.fromEmail}. Connect the Workshop's sending from the Workshop page.`, identityProductId };
  }
  const fromLine = identity.fromName ? `${identity.fromName} <${identity.fromEmail}>` : identity.fromEmail;
  return { status: 'ready', fromLine, detail: `Ready. Messages go out as ${fromLine}${identity.lastAcceptedAt ? '; the provider has accepted mail from it before' : '; not yet used'}.`, identityProductId };
}

/**
 * WHAT PLACING THIS OFFER WOULD BE REFUSED FOR, ASKED BEFORE ANYTHING IS DONE
 * (Roadmap 2027 R23). `placeExposure` reads the first-proof policy against the
 * asset's facts and refuses — but it ran after the test had been decided, a
 * charter slot carved and a live payment link minted, so a refused offer still
 * held a slot and left a link in Stripe. This is the same reading, through the
 * same pure function, of the facts the offer WOULD state: the plan's own,
 * except where the asset already carries a live fact, which statedShapeAndFacts
 * would keep rather than overwrite. `placeExposure` stays the final gate.
 *
 * Only a real offer is read; a reference world's offer is never placed where a
 * stranger could reach it, and placeExposure reads only the real one too.
 */
export async function placementWouldBeRefused(e: ExperimentRow, plan: OfferShapePlan): Promise<string[]> {
  if (e.evidenceMode !== 'real') return [];
  return placementRefusedFor(e.founderId, e.productId, plan.facts);
}

/**
 * THE SAME READING, FOR AN OFFER BEFORE THERE IS A TEST: the owner's
 * first-proof policy against the facts an offer would state, on the asset that
 * would carry it. `placementWouldBeRefused` is this for one test's plan;
 * "can Foundry sell on its own" is this for the offer the forge makes
 * (control/production-facts.ts), so the two cannot disagree.
 */
export async function placementRefusedFor(founderId: string, productId: string | null, planFacts: OfferShapePlan['facts']): Promise<string[]> {
  const e = { founderId, productId };
  const plan = { facts: planFacts };
  const { originationPolicyFor, policyVerdictsFor } = await import('./legal-surface.js');
  const kinds = (await query('SELECT fact, answers_requirement, satisfied_when FROM structural_fact_kinds', []))
    .rows as unknown as Array<{ fact: string; answers_requirement: string | null; satisfied_when: number | null }>;
  const kindOf = new Map(kinds.map((k) => [String(k.fact), k]));
  const stored = new Map<string, { present: number | null; basis: string; grounds: string | null }>();
  if (e.productId) {
    for (const r of (await query(`SELECT fact, present, basis, grounds FROM structural_facts
        WHERE subject_kind = 'company' AND subject_id = ? AND superseded_at IS NULL`, [e.productId])).rows as unknown as Row[]) {
      stored.set(String(r.fact), { present: r.present == null ? null : Number(r.present), basis: String(r.basis), grounds: r.grounds == null ? null : String(r.grounds) });
    }
  }
  const facts = Object.entries(plan.facts).map(([fact, f]) => {
    const k = kindOf.get(fact);
    const live = stored.get(fact);
    const present = live ? live.present : f.present;
    return {
      present: present == null ? null : Number(present) === 1,
      basis: live ? live.basis : (f.basis ?? 'assumed'),
      grounds: live ? live.grounds : f.grounds,
      answersRequirement: k?.answers_requirement == null ? null : String(k.answers_requirement),
      satisfiedWhen: k?.satisfied_when == null ? null : Number(k.satisfied_when),
    };
  });
  const { inTheWay } = policyVerdictsFor({ policy: await originationPolicyFor(e.founderId), facts, shaped: true });
  return inTheWay;
}

/**
 * A WEEK AFTER THE FIRST HAS TO BE MAKEABLE BEFORE A WEEK IS SOLD. A weekly
 * data brief is re-made each week by asking its sealed words again of the
 * sources they were first asked of (R28, sources/re-pull.ts). A brief none of
 * whose sources can be asked again — never asked these words, or no terms of
 * use written down for it — would send week one again as week two, so it is
 * refused here.
 */
export async function recurringCannotBeMade(experimentId: string, plan: OfferShapePlan): Promise<string | null> {
  if (!plan.price.recurring) return null;
  const shape = await materialOf(experimentId, 'offer_shape');
  type Shape = { kind?: unknown; spec?: { terms?: unknown; sourceTypes?: unknown } };
  let body: Shape | null = null;
  try { body = shape ? (JSON.parse(shape.body) as Shape) : null; } catch { body = null; }
  if (body?.kind !== 'data_brief') return null;
  const terms = typeof body.spec?.terms === 'string' ? body.spec.terms : '';
  const sourceTypes = Array.isArray(body.spec?.sourceTypes) ? body.spec.sourceTypes.map(String) : [];
  const e = await experimentRow(experimentId);
  if (!e || !terms) return 'a week after the first cannot be made yet: the brief has no sealed question to ask again';
  const { whyItCannotBeAskedAgain } = await import('./sources/re-pull.js');
  const why = await whyItCannotBeAskedAgain(e.founderId, terms, sourceTypes);
  return why ? `a week after the first cannot be made yet: ${why}, so week two would repeat week one` : null;
}

/**
 * NO PRICE IS MOSTLY FEES (R29): the price this plan would charge, read
 * against its venue's published fee at the least a buyer could pay. A listing
 * sells on its venue (Etsy); everything else is charged through Stripe.
 */
export async function feeFloorOf(plan: OfferShapePlan | null): Promise<string | null> {
  if (!plan) return null;
  const { priceIsMostlyFees } = await import('./fee-floor.js');
  const why = priceIsMostlyFees({ venue: plan.listing ? 'etsy' : 'stripe', amountCents: plan.price.amountCents, chosen: plan.price.chosen ?? null });
  return why ? `the price is mostly fees: ${why}` : null;
}

/** A send whose pass died this long ago is treated as an unknown outcome. */
export const EXECUTING_IS_CUT_OFF_AFTER_MINUTES = 60;

/**
 * WHETHER A DELIVERY THAT DID NOT GO OUT MAY BE TRIED AGAIN NOW, and if so put
 * back to waiting (R31). Refused at the door before anything was sent: yes, on
 * every pass, because the door reads its rules again and a buyer has paid. An
 * unknown outcome: after its reconcile time, under the same idempotency key, so
 * the provider cannot send it twice. A send claimed by a pass that died:
 * treated as an unknown outcome once it is an hour old. Unlike an offer, a
 * refusal by our own rules is retried: the buyer is owed it either way.
 */
async function rearmDelivery(actionId: string, now: Date): Promise<boolean> {
  const r = await one('SELECT status, effect_certainty, reconcile_after, created_at FROM outbound_actions WHERE id = ?', [actionId]);
  if (!r) return false;
  const status = String(r.status);
  const due = r.reconcile_after == null || new Date(String(r.reconcile_after)).getTime() <= now.getTime();
  const created = new Date(String(r.created_at).includes('T') ? String(r.created_at) : `${String(r.created_at).replace(' ', 'T')}Z`).getTime();
  const cutOff = status === 'executing' && now.getTime() - created >= EXECUTING_IS_CUT_OFF_AFTER_MINUTES * 60_000;
  if (!(status === 'rejected' || (status === 'failed' && due) || cutOff)) return false;
  const reset = await query(`UPDATE outbound_actions SET status = 'pending_approval', effect_certainty = 'not_attempted', result_json = NULL, reconcile_after = NULL
    WHERE id = ? AND status = ?`, [actionId, status]);
  return (reset.rowsAffected ?? 0) > 0;
}

/** Readiness's words for a Workshop that is not there, and for sending that is not connected; "can it sell" says the same. */
export const NO_WORKSHOP = 'there is no public Workshop to carry the page';
export const SENDING_NOT_CONNECTED = 'email sending is not connected';

/**
 * WHAT THE WORKSHOP ITSELF LACKS before anything is sold or sent under its
 * name: no Workshop at all, no postal address for commercial mail, new
 * economic activity paused. The one reading `readiness` refuses a test by and
 * "can Foundry sell on its own" (control/production-facts.ts) answers by.
 */
export function whatTheWorkshopLacks(w: { postalAddress: string | null; economicPause: unknown } | null): string[] {
  if (!w) return [NO_WORKSHOP];
  const missing: string[] = [];
  if (!w.postalAddress) missing.push('the Workshop has no postal address for commercial mail');
  if (w.economicPause) missing.push('new economic activity is paused');
  return missing;
}

export async function readiness(experimentId: string): Promise<Readiness> {
  const e = await experimentRow(experimentId);
  if (!e) throw new HandRefused('experiment_not_found');
  // WHAT THIS TEST DEPENDS ON, WRITTEN DOWN AND READ BACK. Declared from the
  // rule it sealed and the offer it makes, then read against the health this
  // deployment last took — an hour old at worst, and no provider call to draw
  // a page. The pass that is about to write to strangers takes a live reading
  // instead, because that is where the consequence is.
  //
  // Only paths found NOT WORKING appear here. An unknown path does not refuse:
  // a path nobody could read is not a path that failed, and a deployment with
  // no provider configured would otherwise be unable to run anything at all.
  const instrumentMissing = async (): Promise<string[]> => {
    const { declareInstrument, instrumentAgainst, lastHealthReading, pathsNotWorking, sentenceFor } =
      await import('./the-instrument.js');
    await declareInstrument(experimentId);
    const readings = await instrumentAgainst(experimentId, await lastHealthReading(e.founderId));
    // Not the paths approval itself creates: asking for the way to pay before
    // the act that mints it would refuse every test for lacking the thing the
    // owner is being asked to authorise.
    return pathsNotWorking(readings).filter((p) => !p.existsAfterApproval).map(sentenceFor);
  };
  // A LISTING THE OWNER PLACES HIMSELF needs no cohort and no sender: nobody
  // is written to. What it needs before he can approve it is the file, the
  // listing text, the offer's shape and a recorded design.
  const plan = await offerShapePlanOf(experimentId);
  if (plan?.venue === 'workshop') {
    const missing: string[] = [];
    const goods = await materialOf(experimentId, 'deliverable');
    if (!goods) missing.push('nothing to deliver is attached');
    else {
      // NOTHING IS SOLD THAT COULD NOT GO OUT. Read by the gate delivery runs,
      // so a test is not let in to take money for goods no pass could send.
      const q = await deliverableGate(experimentId, goods, new Date());
      if (!q.ok) missing.push(`what a buyer would be sent could not go out: ${q.failures.join('; ')}`);
    }
    if (!(await materialOf(experimentId, 'offer_template'))) missing.push('the offer text is not written');
    const { designOf } = await import('./probe-design.js');
    if (!(await designOf(experimentId))) missing.push('the design has not been recorded');
    const sending = await sendingReadiness(e.founderId);
    if (sending.status !== 'ready') missing.push(SENDING_NOT_CONNECTED);
    const { publicWorkshopOfExperiment } = await import('../public-workshop/settings.js');
    const w = await publicWorkshopOfExperiment(experimentId);
    if (w && !(await one('SELECT experiment_id FROM public_experiments WHERE experiment_id = ?', [experimentId]))) missing.push('the experiment has no public page identity');
    missing.push(...whatTheWorkshopLacks(w));
    // WHAT PLACING IT WOULD BE REFUSED FOR, before a decision, a carve or a
    // link (R23). Said in the words placeExposure would use.
    for (const why of await placementWouldBeRefused(e, plan)) missing.push(`placing it would be refused: ${why}`);
    const weekTwo = await recurringCannotBeMade(experimentId, plan);
    if (weekTwo) missing.push(weekTwo);
    const fees = await feeFloorOf(plan);
    if (fees) missing.push(fees);
    // A BRIEF MADE BEFORE R23 FROM A SOURCE THAT MAY NOT BE SOLD stays unsold.
    const shapeBody = (await materialOf(experimentId, 'offer_shape'))?.body ?? '{}';
    let named: string[] = [];
    try { named = ((JSON.parse(shapeBody) as { spec?: { sourceTypes?: unknown } }).spec?.sourceTypes as string[] | undefined) ?? []; } catch { named = []; }
    const { sourcesRefusedForSale } = await import('./products/registry.js');
    for (const why of sourcesRefusedForSale(Array.isArray(named) ? named.map(String) : [])) missing.push(`it may not be sold: ${why}`);
    missing.push(...await instrumentMissing());
    return { ok: missing.length === 0, missing, reachable: 0, pending: 0, pendingWebForm: 0, struck: 0, sending };
  }
  if (plan?.listing) {
    const missing: string[] = [];
    if (!(await materialOf(experimentId, 'deliverable'))) missing.push('nothing to deliver is attached');
    if (!(await materialOf(experimentId, 'offer_template'))) missing.push('the listing text is not written');
    const fees = await feeFloorOf(plan);
    if (fees) missing.push(fees);
    const { designOf } = await import('./probe-design.js');
    if (!(await designOf(experimentId))) missing.push('the design has not been recorded');
    return { ok: missing.length === 0, missing, reachable: 0, pending: 0, pendingWebForm: 0, struck: 0,
      sending: { status: 'ready', fromLine: null, detail: 'Nobody is written to for this test; there is nothing to send.', identityProductId: null } };
  }
  const rs = await recipientsOf(experimentId);
  const reachable = rs.filter((r) => r.reviewStatus === 'approved' && r.channel === 'email' && r.email).length;
  const pendingAll = rs.filter((r) => r.reviewStatus === 'pending');
  const pending = pendingAll.filter((r) => r.channel === 'email').length;
  const sending = await sendingReadiness(e.founderId);
  const missing: string[] = [];
  if (rs.length === 0) missing.push('no candidate businesses are loaded');
  else if (pending > 0) missing.push(`${pending} business${pending === 1 ? '' : 'es'} still to review`);
  else if (reachable === 0) missing.push('nobody approved can be reached by email');
  // AN UNSCREENED COHORT IS A MISSING PREREQUISITE ONLY WHEN IT IS THE WHOLE
  // COHORT. The door refuses each business with no recorded reason for being in
  // the population the design names, one at a time, so approving somebody
  // unscreened costs nothing and reaches nobody. What would be wrong is
  // allowing a test that can write to NOBODY — that is pressing Allow and
  // getting silence, and it is what this refuses.
  const approvedReachable = rs.filter((r) => r.reviewStatus === 'approved' && r.channel === 'email' && r.email);
  const screened = approvedReachable.filter((r) => r.qualifiedAt).length;
  if (approvedReachable.length > 0 && screened === 0) {
    missing.push(`none of the ${approvedReachable.length} approved business${approvedReachable.length === 1 ? '' : 'es'} has a recorded reason for being in the population this design names, so nothing could be sent`);
  }
  if (sending.status !== 'ready') missing.push(SENDING_NOT_CONNECTED);
  if (!(await materialOf(experimentId, 'deliverable'))) missing.push('nothing to deliver is attached');
  if (!(await materialOf(experimentId, 'offer_template'))) missing.push('the offer text is not written');
  if (!plan) missing.push('the offer has no stated shape');
  const fees = await feeFloorOf(plan);
  if (fees) missing.push(fees);
  // WHAT THE WORKSHOP NEEDS before a stranger can be written to under its name.
  const { publicWorkshopOfExperiment } = await import('../public-workshop/settings.js');
  const w = await publicWorkshopOfExperiment(experimentId);
  if (w) {
    if (!(await one('SELECT experiment_id FROM public_experiments WHERE experiment_id = ?', [experimentId]))) missing.push('the experiment has no public page identity');
    missing.push(...whatTheWorkshopLacks(w));
  }
  missing.push(...await instrumentMissing());
  return { ok: missing.length === 0, missing, reachable, pending, pendingWebForm: pendingAll.length - pending, struck: rs.filter((r) => r.reviewStatus === 'struck').length, sending };
}

// ── The place the offer lives: the payment link, placed as the exposure ──────

export async function ensureExposure(experimentId: string): Promise<{ exposureId: string; url: string } | { refused: string }> {
  const e = await experimentRow(experimentId);
  if (!e || !e.productId) return { refused: 'no asset' };
  const existing = await exposureOf(experimentId);
  if (existing && existing.withdrawnAt === null) {
    const offer = await materialOf(experimentId, 'offer');
    if (offer?.paymentLinkUrl) return { exposureId: existing.id, url: offer.paymentLinkUrl };
  }
  if (!paymentCapabilityConfigured()) return { refused: 'Stripe is not configured for this deployment' };
  const plan = await offerShapePlanOf(experimentId);
  if (!plan) return { refused: 'no offer shape' };
  // THE SMALLEST BOUNDARY THAT KEEPS REAL MONEY SAFE. A way to pay may not be
  // put where a stranger can reach it while NOTHING in this deployment is able
  // to receive a payment event: the money would move, the person would be owed
  // something, and Foundry would not know either fact. That is not a risk to
  // weigh against an experiment's value; it is a promise that cannot be kept.
  //
  // Only that case refuses. A deployment that CAN receive an event but never
  // has is allowed to proceed, because the live route is configured at the
  // provider and cannot be proved before the first live payment — and the pass
  // asks the provider directly every hour, so a payment nobody told us about
  // surfaces within one. Refusing there instead would make a first paid test
  // impossible, which is a different way of being wrong.
  if (plan.price.amountCents > 0) {
    const { paymentObservationPath } = await import('./the-instrument.js');
    const observation = await paymentObservationPath();
    if (observation.status === 'not_working') return { refused: `a way to pay is not placed while ${observation.detail}` };
  }
  // NO WINDOW OPENS THAT NO ACT COVERS (R24). A test let in with acts shorter
  // than its window (every test before R24: twenty-one days against thirty)
  // would take a payment near the end that nothing could deliver or refund.
  if (!(existing && existing.withdrawnAt === null)) {
    const act = await one(`SELECT expires_at FROM proposed_acts WHERE experiment_id = ? AND action_type = 'stripe_create_payment_link'
        AND decision = 'approved' AND revoked_at IS NULL ORDER BY decided_at DESC, rowid DESC LIMIT 1`, [experimentId]);
    const within = Number((await one(`SELECT json_extract(settles_when, '$.within_days') AS d FROM venture_experiments WHERE id = ?`, [experimentId]))?.d ?? 0);
    if (act && within > 0) {
      const short = placementActCoversTheWindow({ now: new Date(), actExpiresAt: String(act.expires_at), withinDays: within });
      if (short) return { refused: short };
    }
  }
  // NOTHING IS MINTED THAT PLACEMENT WOULD REFUSE (R23). placeExposure reads
  // the asset's legal picture and refuses; asked here first, the same picture
  // stops a live link being made on the owner's Stripe account for an offer
  // that could never be placed. One reading, the one placeExposure takes.
  if (e.evidenceMode === 'real' && !(existing && existing.withdrawnAt === null)) {
    const { legalPictureOf } = await import('./legal-surface.js');
    const picture = await legalPictureOf({ founderId: e.founderId, opportunityId: e.productId, world: 'real', subjectKind: 'company' });
    if (picture.inTheWay.length > 0) return { refused: `the asset's legal picture stands in the way: ${picture.inTheWay.join('; ')}` };
  }
  let link: PaymentLinkFacts | null = await findExperimentPaymentLink(experimentId);
  if (link && !validateExperimentPaymentLink(link, experimentId, plan.price).ok) link = null;
  if (!link) {
    const made = await createExperimentPaymentLink({ productId: e.productId, experimentId, price: plan.price });
    if ('refused' in made) return { refused: made.refused };
    link = made.link;
  }
  const v = validateExperimentPaymentLink(link, experimentId, plan.price);
  if (!v.ok) return { refused: v.failures.join('; ') };
  let exposureId = existing && existing.withdrawnAt === null ? existing.id : null;
  if (!exposureId) {
    const placed = await placeExposure({ experimentId, productId: e.productId, provider: 'stripe', exposureRef: link.id, evidenceMode: e.evidenceMode as 'real' | 'reference', placedBy: HAND });
    if ('refused' in placed) return { refused: placed.refused };
    exposureId = placed.id;
  }
  const template = await materialOf(experimentId, 'offer_template');
  if (!template) return { refused: 'no offer template' };
  const offer = await materialOf(experimentId, 'offer');
  const filled = await fillOffer(experimentId, template.body, link.url);
  if (!offer || offer.paymentLinkUrl !== link.url || offer.body !== filled.body) {
    await recordMaterial({ founderId: e.founderId, experimentId, kind: 'offer', title: plan.offerSubject, body: filled.body, paymentLinkUrl: link.url, by: HAND });
  }
  return { exposureId, url: link.url };
}

/**
 * THE OFFER IS PLACED AND THE PAGE IS UP, as one step after Allow. Placing
 * makes the link; publishing renders the Workshop from the rows (which now
 * carry the link) and puts every changed page in the world, then reads it
 * back. Idempotent by digest, so the hourly pass repeats it for nothing.
 */
export async function prepareExposure(experimentId: string): Promise<{ exposureId: string; url: string; pageUrl: string | null; published: boolean; failures: string[] } | { refused: string }> {
  const placed = await ensureExposure(experimentId);
  if ('refused' in placed) return placed;
  const e = await experimentRow(experimentId);
  const { publicWorkshopOfExperiment } = await import('../public-workshop/settings.js');
  const w = await publicWorkshopOfExperiment(experimentId);
  if (!w || !e) return { ...placed, pageUrl: null, published: false, failures: ['no public Workshop'] };
  const { publishSite, pageUrlFor } = await import('../public-workshop/publication.js');
  const report = await publishSite(w.founderId, HAND);
  const pageUrl = await pageUrlFor(experimentId);
  // A HELD PAGE IS NOT A PUBLISHED ONE. This read `failed` and `unverified`
  // only, so an offer whose page the owner had forbidden came back
  // `published: true` with a `pageUrl` that answers 404, and the owner's
  // screen said "placed".
  const failures = [...report.failed.map((f) => `${f.path}: ${f.reason}`),
    ...report.held.map((h) => `${h.path}: ${h.reason}`), ...report.unverified];
  return { ...placed, pageUrl, published: failures.length === 0, failures };
}

/** A link the owner made by hand: held to the same contract, then placed. */
export async function attachPaymentLinkByUrl(input: { experimentId: string; url: string }): Promise<{ ok: true } | { refused: string }> {
  // THE SAME BOUNDARY AS THE HAND'S OWN PLACEMENT. This door lets the owner
  // paste a link he made himself, and it reached the public page without ever
  // asking whether anything in this deployment could hear about a payment made
  // through it. The money would move, somebody would be owed something, and
  // Foundry would know neither — which is the case the boundary exists for,
  // whichever door the link came through.
  {
    const { paymentObservationPath } = await import('./the-instrument.js');
    const observation = await paymentObservationPath();
    if (observation.status === 'not_working') return { refused: `a way to pay is not attached while ${observation.detail}` };
  }
  const e = await experimentRow(input.experimentId);
  if (!e || !e.productId) return { refused: 'the experiment has no asset yet; allow it first' };
  const plan = await offerShapePlanOf(input.experimentId);
  if (!plan) return { refused: 'no offer shape' };
  const link = await describePaymentLink(input.url);
  if (!link) return { refused: 'Stripe has no active Payment Link at that URL on this account' };
  const v = validateExperimentPaymentLink(link, input.experimentId, plan.price);
  if (!v.ok) return { refused: v.failures.join('; ') };
  const existing = await exposureOf(input.experimentId);
  if (existing && existing.withdrawnAt === null && existing.exposureRef !== link.id) return { refused: 'the offer is already placed at a different link' };
  if (!existing || existing.withdrawnAt !== null) {
    const placed = await placeExposure({ experimentId: input.experimentId, productId: e.productId, provider: 'stripe', exposureRef: link.id, evidenceMode: e.evidenceMode as 'real' | 'reference', placedBy: `founder:${e.founderId}` });
    if ('refused' in placed) return { refused: placed.refused };
  }
  const template = await materialOf(input.experimentId, 'offer_template');
  if (!template) return { refused: 'no offer template' };
  await recordMaterial({ founderId: e.founderId, experimentId: input.experimentId, kind: 'offer', title: plan.offerSubject, body: (await fillOffer(input.experimentId, template.body, link.url)).body, paymentLinkUrl: link.url, by: `founder:${e.founderId}` });
  return { ok: true };
}

// ── Offers and deliveries through the door ───────────────────────────────────

export interface ActionPlan { id: string; experimentId: string; act: 'offer' | 'delivery'; status: string; effectId: string; to: string }

async function projectAction(r: Row): Promise<ActionPlan> {
  const params = JSON.parse(String(r.parameters_json)) as { to: string[] };
  return { id: String(r.id), experimentId: String(r.experiment_id), act: String(r.experiment_act) as ActionPlan['act'], status: String(r.status), effectId: String(r.effect_id), to: params.to[0] };
}

async function existingByEffect(productId: string, effectId: string): Promise<ActionPlan | null> {
  const r = await one('SELECT * FROM outbound_actions WHERE product_id = ? AND effect_id = ?', [productId, effectId]);
  return r ? projectAction(r) : null;
}

/**
 * WHERE A REPLY GOES: the address the message is sent from. The owner's login
 * address is often a personal mailbox on another domain, and a reply-to that
 * differs from the From is a known mark of cold mail; replies to his own
 * address on his own domain reach him without it. Only when no sending
 * identity resolves (the send would be refused anyway) does it fall back to
 * the address on his founder record.
 */
async function replyAddressFor(productId: string, founderId: string): Promise<string> {
  const identity = await getSendingIdentity(productId);
  if (identity) return identity.fromEmail;
  const f = await one('SELECT email FROM founders WHERE id = ?', [founderId]);
  return String(f?.email ?? '');
}

export async function planOffer(input: { experimentId: string; recipientId: string; now?: Date }): Promise<ActionPlan> {
  const e = await experimentRow(input.experimentId);
  if (!e?.productId) throw new HandRefused('no_asset');
  const act = await campaignActOf(input.experimentId);
  if (!act) throw new HandRefused('no_campaign_act');
  const recipient = (await recipientsOf(input.experimentId)).find((r) => r.id === input.recipientId);
  if (!recipient?.email) throw new HandRefused('recipient_unreachable');
  // THE POPULATION THE DESIGN NAMED IS A PROMISE, AND THIS IS WHERE IT BINDS.
  // A design that says it is testing shops with observed public-sector work is
  // making a claim about who receives the message, not a note about how the
  // list was gathered. Every offer in the system is planned here, so refusing
  // an unscreened stranger here is the whole of the rule — and it fails closed:
  // no qualification recorded means no message, never "probably fine".
  if (!recipient.qualifiedAt) throw new HandRefused('recipient_unqualified', recipient.counterpartyRef);
  // ─── THE OWNER'S BOUNDARY, AT THE ACTION ─────────────────────────────────
  //
  // `owner_exclusions` and its marks (name, domain, email, phone, address) are
  // the institution's one exclusion engine, and `whyExcluded` is its reader.
  // It was consulted in exactly one place: `addRecipients`, when a candidate
  // is REGISTERED. Nothing re-read it when a message was about to go out.
  //
  // So an entity the owner excluded AFTER his candidates were approved was
  // still written to, and "an owner exclusion outranks everything" was
  // enforced at an interface rather than at the action. The duplicate-row case
  // two reviewers found is the small version of that; this is the large one.
  // Here is where every offer in the system is planned, so here is where it
  // belongs — the same engine, no second policy, and it fails closed.
  const { whyExcluded } = await import('../institution/owner-exclusions.js');
  const no = await whyExcluded({ founderId: e.founderId, name: recipient.counterpartyRef,
    email: recipient.email, url: recipient.sourceUrl });
  if (no.excluded) throw new HandRefused('owner_excluded', `${recipient.counterpartyRef} — ${no.entity ?? ''} (${no.matched ?? ''})`);

  // ─── AND THE SCREENING RULE, WHICH IS A DIFFERENT THING ──────────────────
  //
  // A row struck for having no recorded grounds is not the owner saying never
  // again; it is this test's population being what the design said it was. It
  // binds on the ADDRESS because the promise is about who receives a message,
  // and the same business can sit on one list twice under names differing by
  // an "LLC" — which is how a message went to an address that had just been
  // excluded. It binds WITHIN THIS EXPERIMENT only, because that is all a
  // screening decision means, and claiming more would make every test's
  // housekeeping into a permanent judgment about a business.
  const struckHere = (await rows(
    `SELECT 1 AS n FROM experiment_recipients
      WHERE experiment_id = ? AND review_status = 'struck'
        AND lower(trim(email)) = lower(trim(?))`,
    [input.experimentId, recipient.email]));
  if (struckHere.length > 0) throw new HandRefused('recipient_struck_at_this_address', recipient.counterpartyRef);
  const effectId = `experiment:${input.experimentId}:offer:${recipient.id}`;
  const existing = await existingByEffect(e.productId, effectId);
  if (existing) return existing;
  const offer = await materialOf(input.experimentId, 'offer');
  if (!offer) throw new HandRefused('offer_missing');
  // THE WORKSHOP'S RULES, before the door's: a no said anywhere, too many
  // messages to one address across tests, and the gate on the public page.
  const { isSuppressed, contactFrequencyRefusal } = await import('../public-workshop/suppression.js');
  const said = await isSuppressed(e.founderId, recipient.email);
  if (said.suppressed) throw new HandRefused('recipient_suppressed', said.reason);
  const tooOften = await contactFrequencyRefusal({ founderId: e.founderId, email: recipient.email, experimentId: input.experimentId, now: input.now });
  if (tooOften) throw new HandRefused('contact_frequency', tooOften);
  const { publicationGate, pageUrlFor } = await import('../public-workshop/publication.js');
  const { publicPostalLines, publicWorkshopOfExperiment } = await import('../public-workshop/settings.js');
  const w = await publicWorkshopOfExperiment(input.experimentId);
  if (w) {
    // READ THE PAGE FROM THE PUBLIC INTERNET, NOW, NOT FROM WHAT WE SAW OF IT.
    //
    // The gate is happy with a page verified inside the last day, which is
    // right for showing the owner a dashboard and wrong here. A page that went
    // dark after it was published stays "verified" for up to twenty-four
    // hours, and a probe of twenty-five messages over seven days can spend
    // itself entirely inside that window — every recipient sent to a page the
    // world no longer serves, under the one public name every later experiment
    // also stands behind. So the pass that would write to a stranger reads the
    // page from its public address first. One request, at the only moment the
    // answer changes anything.
    const gate = await publicationGate(input.experimentId, { now: input.now });
    if (!gate.ok) throw new HandRefused('publication_gate', gate.failures.join('; '));
  }
  const quality = checkOfferQuality(offer, w ? await pageUrlFor(input.experimentId) : null, await offerShapePlanOf(input.experimentId));
  if (!quality.ok) throw new HandRefused('offer_quality', quality.failures.join('; '));
  const replyTo = await replyAddressFor(e.productId, e.founderId);
  // Every message carries who is writing, from where, and how to stop it.
  //
  // The address without the owner's name on it: the Workshop is the voice here,
  // it has just said so in the line before, and the law is asking for a place
  // mail reaches rather than a person's name in front of it.
  const post = w ? publicPostalLines(w) : [];
  const footer = w ? `\n\n—\n${w.publicName} is a small digital workshop.${post.length ? ` ${post.join(', ')}.` : ''}\nTo hear nothing further from ${w.publicName}: ${w.origin}/email` : '';
  const body = offer.body.replace(/\{Business name\}/g, recipient.counterpartyRef.split(',')[0].trim()) + footer;
  const id = nanoid();
  await query(
    `INSERT INTO outbound_actions
       (id, product_id, agent_name, integration_name, action_type, authority_level, status, parameters_json, preview_text, rationale, confidence, expires_at,
        effect_id, outcome_status, experiment_id, experiment_act, recipient_id, proposed_act_id)
     VALUES (?,?,?,'resend','send_email',0,'pending_approval',?,?,?,1,?,?,'unresolved',?,'offer',?,?)`,
    [id, e.productId, HAND, JSON.stringify({ to: [recipient.email], subject: offer.title, html: markdownToHtml(body), text: body, reply_to: replyTo }),
      `Offer to ${recipient.counterpartyRef}`, `One message under the act you approved for ${e.whatWeDo.slice(0, 80)}`, new Date(Date.now() + 7 * 86_400_000).toISOString(),
      effectId, input.experimentId, recipient.id, act.id]);
  if (w) {
    const { recordContact } = await import('../public-workshop/suppression.js');
    await recordContact({ founderId: e.founderId, email: recipient.email, experimentId: input.experimentId, actionId: id });
  }
  return (await existingByEffect(e.productId, effectId))!;
}

export async function planDelivery(input: { experimentId: string; fulfilmentId: string; now?: Date }): Promise<ActionPlan> {
  const e = await experimentRow(input.experimentId);
  if (!e?.productId) throw new HandRefused('no_asset');
  const act = await campaignActOf(input.experimentId);
  if (!act) throw new HandRefused('no_campaign_act');
  const f = await one('SELECT * FROM experiment_fulfilments WHERE id = ? AND experiment_id = ?', [input.fulfilmentId, input.experimentId]);
  if (!f) throw new HandRefused('fulfilment_not_found');
  const effectId = `experiment:${input.experimentId}:delivery:${String(f.payment_ref)}`;
  const existing = await existingByEffect(e.productId, effectId);
  if (existing) return existing;
  const deliverable = await materialOf(input.experimentId, 'deliverable');
  if (!deliverable) throw new HandRefused('deliverable_missing');
  const quality = await deliverableGate(input.experimentId, deliverable, input.now ?? new Date());
  if (!quality.ok) throw new HandRefused('deliverable_quality', quality.failures.join('; '));
  // A WEEK IS A NEW EDITION. A subscriber who paid for a second week and was
  // sent the first week's brief again has paid twice for one thing; the week
  // waits, owed, until an edition recorded after the last one went out.
  const weekly = f.subscription_ref != null;
  if (weekly && await one(
    `SELECT 1 FROM outbound_actions o JOIN experiment_fulfilments g ON g.id = o.fulfilment_id
      WHERE o.experiment_id = ? AND o.experiment_act = 'delivery' AND g.subscription_ref = ? AND g.id <> ?
        AND datetime(o.created_at) >= datetime((SELECT recorded_at FROM experiment_materials WHERE id = ?))`,
    [input.experimentId, String(f.subscription_ref), String(f.id), deliverable.id])) {
    throw new HandRefused('same_edition', 'this week\'s brief has not been made again since last week\'s went out; the week is sent once a newer edition exists');
  }
  const buyer = await buyerAddressFor(String(f.payment_ref));
  if (!buyer) throw new HandRefused('buyer_address_unknown', String(f.payment_ref));
  const replyTo = await replyAddressFor(e.productId, e.founderId);
  const intro = weekly
    ? `Thanks for subscribing — this week's ${deliverable.title} is below. It's a shortlist with a link to each original notice, not a complete listing of the market. If this week's is no use to you, [ask for this week's money back here](${refundLinkFor(String(f.id))}). To stop the subscription, [cancel it here](${cancelLinkFor(String(f.id))}): nothing is charged after the week you've paid for. Replying to this message works for either.\n\n---\n\n`
    : `Thanks for buying the ${deliverable.title} — it's below. It's a shortlist with a link to each original notice, not a complete listing of the market. If it's no use to you, [ask for your money back here](${refundLinkFor(String(f.id))}) and it's refunded in full; replying to this message works just as well.\n\n---\n\n`;
  const body = intro + deliverable.body;
  const id = nanoid();
  await query(
    `INSERT INTO outbound_actions
       (id, product_id, agent_name, integration_name, action_type, authority_level, status, parameters_json, preview_text, rationale, confidence, expires_at,
        effect_id, outcome_status, experiment_id, experiment_act, fulfilment_id, proposed_act_id)
     VALUES (?,?,?,'resend','send_email',0,'pending_approval',?,?,?,1,?,?,'unresolved',?,'delivery',?,?)`,
    [id, e.productId, HAND, JSON.stringify({ to: [buyer], subject: deliverable.title, html: markdownToHtml(body), text: body, reply_to: replyTo }),
      `Deliver ${deliverable.title}`, `Settled payment ${String(f.payment_ref)} for the test`, new Date(Date.now() + 7 * 86_400_000).toISOString(),
      effectId, input.experimentId, String(f.id), act.id]);
  return (await existingByEffect(e.productId, effectId))!;
}

export interface ActionResult { actionId: string; dispatched: boolean; certainty: string; refusedReason: string | null }

/** Revalidate every binding, claim the plan atomically, cross the ordinary door. */
export async function executeAction(actionId: string): Promise<ActionResult> {
  const r = await one('SELECT * FROM outbound_actions WHERE id = ?', [actionId]);
  if (!r || r.experiment_id == null) throw new HandRefused('action_not_found');
  const experimentId = String(r.experiment_id);
  const e = await experimentRow(experimentId);
  const x = await exposureOf(experimentId);
  // An offer belongs to a test still running; a delivery is owed whether or
  // not the test has settled since, so long as the acts allowing it stand.
  const owed = String(r.experiment_act) === 'delivery' && !!e && e.decision === 'approved' && e.validity === 'valid';
  const f = owed && r.fulfilment_id != null ? await one('SELECT created_at, disputed_at, dispute_outcome FROM experiment_fulfilments WHERE id = ?', [String(r.fulfilment_id)]) : null;
  const disputed = !!f && f.disputed_at != null && f.dispute_outcome == null;
  const live = !!e && !disputed && (owed
    ? !!f && (await campaignActCovers(experimentId, String(f.created_at)))
    : isLive(e, !!x && x.withdrawnAt !== null) && (await campaignIsLive(experimentId)));
  if (!live) {
    await query(`UPDATE outbound_actions SET status = 'rejected', effect_certainty = 'not_attempted', result_json = ? WHERE id = ? AND status = 'pending_approval'`, [JSON.stringify({ refused: 'the test or its act is no longer live' }), actionId]);
    return { actionId, dispatched: false, certainty: 'not_attempted', refusedReason: 'not_live' };
  }
  const claimed = await query(`UPDATE outbound_actions SET status = 'executing' WHERE id = ? AND status = 'pending_approval'`, [actionId]);
  if ((claimed.rowsAffected ?? 0) === 0) return { actionId, dispatched: false, certainty: 'not_attempted', refusedReason: 'already_claimed' };
  const params = JSON.parse(String(r.parameters_json)) as { to: string[]; subject: string; html: string; text?: string; reply_to?: string };
  // WHAT REGISTERS THE CAPABILITY IS THE IMPORT. The gateway's handler registry
  // is process-global and filled by side effect, so a send only works if the
  // provider module happens to have been imported by somebody. Relying on that
  // means the first real message out depends on an unrelated module's import
  // order — which is how a proof of this path failed with "no trusted policy
  // registered for tool 'send_email'" while the provider was configured and
  // working. Ask for it here, where the send is.
  await import('../integration/resend.js');
  const result = await invoke({
    productId: String(r.product_id), tool: 'send_email', action: String(r.preview_text), params,
    dedupKey: String(r.effect_id), customerExternalId: params.to[0], surface: 'email_outbound', dataClass: 'customer',
  });
  if (!result.ok) {
    const ambiguous = result.phase === 'execution';
    await query(`UPDATE outbound_actions SET status = ?, effect_certainty = ?, result_json = ?, reconcile_after = ? WHERE id = ?`,
      [ambiguous ? 'failed' : 'rejected', ambiguous ? 'ambiguous' : 'not_attempted', JSON.stringify({ phase: result.phase, reason: result.reason }),
        ambiguous ? new Date(Date.now() + 15 * 60_000).toISOString() : null, actionId]);
    return { actionId, dispatched: false, certainty: ambiguous ? 'ambiguous' : 'not_attempted', refusedReason: `${result.phase}: ${result.reason}` };
  }
  const receipt = result.result as { message_id?: string; logged?: boolean };
  await query(`UPDATE outbound_actions SET status = 'executed', executed_at = datetime('now'), effect_certainty = 'provider_acknowledged', provider_receipt_json = ?, result_json = ?, reconcile_after = ? WHERE id = ?`,
    [JSON.stringify(receipt), JSON.stringify({ ok: true }), new Date(Date.now() + 10 * 60_000).toISOString(), actionId]);
  return { actionId, dispatched: true, certainty: 'provider_acknowledged', refusedReason: null };
}

// ── Receipts: the provider's word, recorded as outcome events ────────────────

export type DeliveryStatus = 'delivered' | 'bounced' | 'complained' | 'pending' | 'unknown';

/** Read the message's fate through the identity that sent it (a message sent under the owner's key is visible only to that key). */
export async function fetchResendDeliveryStatus(productId: string, messageId: string): Promise<DeliveryStatus> {
  const identity = await getSendingIdentity(productId);
  const key = identity?.credential ?? process.env.RESEND_API_KEY;
  if (!key) return 'unknown';
  const response = await withRetry(() => fetch(`https://api.resend.com/emails/${encodeURIComponent(messageId)}`, { headers: { Authorization: `Bearer ${key}` } }), { timeoutMs: 10_000, maxRetries: 2 });
  if (!response.ok) return 'unknown';
  const data = (await response.json()) as { last_event?: string };
  const ev = String(data.last_event ?? '');
  if (ev === 'delivered' || ev === 'opened' || ev === 'clicked') return 'delivered';
  if (ev === 'bounced') return 'bounced';
  if (ev === 'complained') return 'complained';
  if (ev === 'sent' || ev === 'queued' || ev === 'delivery_delayed') return 'pending';
  return 'unknown';
}

export async function reconcileAction(actionId: string, status?: DeliveryStatus): Promise<{ outcome: string; status: DeliveryStatus }> {
  const r = await one('SELECT * FROM outbound_actions WHERE id = ?', [actionId]);
  if (!r || r.experiment_id == null || String(r.status) !== 'executed' || String(r.outcome_status) !== 'unresolved') return { outcome: 'not_applicable', status: 'unknown' };
  const receipt = JSON.parse(String(r.provider_receipt_json ?? '{}')) as { message_id?: string };
  if (!receipt.message_id) return { outcome: 'no_receipt', status: 'unknown' };
  const st = status ?? await fetchResendDeliveryStatus(String(r.product_id), receipt.message_id);
  if (st === 'pending' || st === 'unknown') {
    await query(`UPDATE outbound_actions SET reconcile_after = ? WHERE id = ?`, [new Date(Date.now() + 30 * 60_000).toISOString(), actionId]);
    return { outcome: 'pending', status: st };
  }
  const experimentId = String(r.experiment_id);
  const e = await experimentRow(experimentId);
  const x = await exposureOf(experimentId);
  const delivered = st === 'delivered';
  if (x) {
    // A DELIVERY IS THE PAID EVENT THE RULE READS, so it is classified as the
    // payment was: by who paid, read from the provider again now and dropped.
    // The owner's own purchase delivered to himself counts for nothing.
    let payer: string | null = null;
    if (String(r.experiment_act) === 'delivery' && r.fulfilment_id != null) {
      const f = await one('SELECT payment_ref FROM experiment_fulfilments WHERE id = ?', [String(r.fulfilment_id)]);
      payer = f ? await buyerAddressFor(String(f.payment_ref)).catch(() => null) : null;
    }
    const { exchangeOf } = await import('./probe-design-context.js');
    await recordBusinessOutcome({
      exposureId: x.id, kind: String(r.experiment_act) === 'offer' ? (delivered ? 'offer_delivered' : 'delivery_failed') : (delivered ? 'delivery' : 'delivery_failed'),
      observedAt: new Date(), provider: 'resend', providerRef: receipt.message_id, payerReference: payer, arrivedVia: 'email',
      exchange: await exchangeOf(experimentId),
    });
  }
  await query(`UPDATE outbound_actions SET outcome_status = ?, outcome_evidence_ref = ?, reconcile_after = NULL WHERE id = ?`,
    [delivered ? 'verified_success' : 'verified_failure', `resend:${receipt.message_id}:${st}`, actionId]);
  // AN ADDRESS THAT BOUNCED OR COMPLAINED IS NOT WRITTEN TO AGAIN by any test
  // of this Workshop: the provider's word goes straight onto the shared list.
  if (!delivered && e) {
    const to = (JSON.parse(String(r.parameters_json)) as { to?: string[] }).to?.[0];
    if (to) {
      const { suppress } = await import('../public-workshop/suppression.js');
      await suppress({ founderId: e.founderId, email: to, reason: st === 'complained' ? 'complained' : 'bounced', source: 'provider', experimentId, note: `resend:${receipt.message_id}:${st}` });
    }
  }
  if (String(r.experiment_act) === 'delivery' && r.fulfilment_id != null) {
    await query(`UPDATE experiment_fulfilments SET status = ?, updated_at = datetime('now') WHERE id = ? AND status IN ('owed','sent')`, [delivered ? 'delivered' : 'failed', String(r.fulfilment_id)]);
  }
  return { outcome: delivered ? 'verified_success' : 'verified_failure', status: st };
}

// ── Refunds ──────────────────────────────────────────────────────────────────

export async function refundFulfilment(input: { fulfilmentId: string; reason: string }): Promise<{ issued: boolean; refusedReason: string | null }> {
  // The asset the purchase was made under, by lineage; the kill switch at the
  // door decides whether it may act, not this lookup.
  const f = await one('SELECT f.*, p.id AS product_id FROM experiment_fulfilments f JOIN products p ON p.from_experiment_id = f.experiment_id AND p.deleted_at IS NULL WHERE f.id = ?', [input.fulfilmentId]);
  if (!f) throw new HandRefused('fulfilment_not_found');
  if (String(f.status) === 'refunded' || f.refund_ref != null) return { issued: true, refusedReason: null };
  // A CONTESTED CHARGE IS THE BANK'S UNTIL IT DECIDES. The provider refuses a
  // refund on a disputed charge; foreseeing that costs nothing and spends no
  // unit at the door. (A buyer's own ask is recorded by requestRefundByLink
  // before this, so it survives the dispute.)
  if (f.disputed_at != null && f.dispute_outcome == null) return { issued: false, refusedReason: 'disputed: the buyer is contesting the charge with their bank; nothing moves until it decides' };
  // RECORDED BEFORE AN UNKNOWN CHARGE CAN REFUSE IT (R21): it used to return
  // first, and the ask was lost.
  await query(`UPDATE experiment_fulfilments SET refund_requested_at = COALESCE(refund_requested_at, datetime('now')), updated_at = datetime('now') WHERE id = ?`, [input.fulfilmentId]);
  // A WEEK WHOSE CHARGE WAS NEVER NAMED is read from its invoice now and kept
  // on the row, because the door binds the refund to the row (refundParamsFor).
  if (f.charge_ref == null && String(f.payment_ref).startsWith('in_')) {
    const { chargeOfInvoice } = await import('./payment-link.js');
    const found = await chargeOfInvoice(String(f.payment_ref)).catch(() => null);
    if (found) {
      await query(`UPDATE experiment_fulfilments SET charge_ref = ?, updated_at = datetime('now') WHERE id = ? AND charge_ref IS NULL`, [found, input.fulfilmentId]);
      f.charge_ref = found;
    }
  }
  const { refundParamsFor } = await import('../institution/standing-intent.js');
  const params = refundParamsFor(f);
  if (!params) return { issued: false, refusedReason: 'charge_unknown: the provider has not said which charge this was; refund it by hand in Stripe' };
  // The door charges the buyer's weekly communication budget before the
  // handler runs, and the clean-hands handler refuses without touching money;
  // a refusal Foundry can foresee must not spend the unit the refund needs.
  if (process.env.FOUNDRY_ENABLE_MONEY_TOOLS !== 'true') return { issued: false, refusedReason: 'policy: Foundry does not move money by default (FOUNDRY_ENABLE_MONEY_TOOLS is off)' };
  const result = await invoke({
    productId: String(f.product_id), tool: 'stripe_create_refund', action: `refund ${String(f.payment_ref)}: ${input.reason}`,
    params,
    dedupKey: `experiment:${String(f.experiment_id)}:refund:${String(f.payment_ref)}`, customerExternalId: String(f.payment_ref),
    surface: 'billing', dataClass: 'customer',
  });
  if (!result.ok) return { issued: false, refusedReason: `${result.phase}: ${result.reason}` };
  const refund = result.result as { id?: string };
  await query(`UPDATE experiment_fulfilments SET refund_ref = ?, updated_at = datetime('now') WHERE id = ?`, [String(refund.id ?? 'issued'), input.fulfilmentId]);
  return { issued: true, refusedReason: null };
}

function refundKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY ?? '';
  if (key.length < 32) throw new Error('ENCRYPTION_KEY is required to sign refund links');
  return Buffer.from(key, 'utf8');
}
export function refundTokenFor(fulfilmentId: string): string {
  return createHmac('sha256', refundKey()).update(`experiment_refund:${fulfilmentId}`).digest('hex');
}
export function refundLinkFor(fulfilmentId: string): string {
  const base = (process.env.APP_URL ?? 'http://localhost:8080').replace(/\/$/, '');
  return `${base}/share/refund/${fulfilmentId}/${refundTokenFor(fulfilmentId)}`;
}
export function verifyRefundToken(fulfilmentId: string, token: string): boolean {
  const expected = Buffer.from(refundTokenFor(fulfilmentId), 'utf8');
  const given = Buffer.from(String(token), 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export interface RefundView { fulfilmentId: string; title: string; amountCents: number; currency: string; alreadyRefunded: boolean }

export async function describeRefundLink(fulfilmentId: string, token: string): Promise<RefundView | null> {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(fulfilmentId) || !verifyRefundToken(fulfilmentId, token)) return null;
  const f = await one('SELECT * FROM experiment_fulfilments WHERE id = ?', [fulfilmentId]);
  if (!f) return null;
  const deliverable = await materialOf(String(f.experiment_id), 'deliverable');
  return { fulfilmentId, title: deliverable?.title ?? 'what you paid for', amountCents: Number(f.amount_cents), currency: String(f.currency).toUpperCase(), alreadyRefunded: f.refund_ref != null || String(f.status) === 'refunded' };
}

/** The buyer confirmed. The request is a fact; the refund is governed; a refusal is the owner's exception. */
export async function requestRefundByLink(fulfilmentId: string, token: string): Promise<{ status: 'not_found' | 'refunded' | 'already_refunded' | 'could_not'; view: RefundView | null }> {
  const view = await describeRefundLink(fulfilmentId, token);
  if (!view) return { status: 'not_found', view: null };
  if (view.alreadyRefunded) return { status: 'already_refunded', view };
  // THE BUYER'S ASK IS A FACT BEFORE ANYTHING CAN REFUSE IT (R21): the page
  // tells them it was noted, so it is, whatever the refund then meets.
  await query(`UPDATE experiment_fulfilments SET refund_requested_at = COALESCE(refund_requested_at, datetime('now')), updated_at = datetime('now') WHERE id = ?`, [fulfilmentId]);
  const result = await refundFulfilment({ fulfilmentId, reason: 'buyer asked through the delivery link' });
  return { status: result.issued ? 'refunded' : 'could_not', view };
}

// ── A subscription can always be stopped ─────────────────────────────────────

/**
 * HOW LONG BEFORE THE ACT LAPSES A SUBSCRIPTION IS TOLD TO END. A week is the
 * longest a paid period runs, and two days more covers a pass that did not
 * run; a subscription told to end at its current week now cannot renew into a
 * week nothing allows Foundry to deliver.
 */
export { STOP_AHEAD_DAYS } from './act-window.js';

export function cancelTokenFor(fulfilmentId: string): string {
  return createHmac('sha256', refundKey()).update(`experiment_cancel:${fulfilmentId}`).digest('hex');
}
export function cancelLinkFor(fulfilmentId: string): string {
  const base = (process.env.APP_URL ?? 'http://localhost:8080').replace(/\/$/, '');
  return `${base}/share/cancel/${fulfilmentId}/${cancelTokenFor(fulfilmentId)}`;
}
export function verifyCancelToken(fulfilmentId: string, token: string): boolean {
  const expected = Buffer.from(cancelTokenFor(fulfilmentId), 'utf8');
  const given = Buffer.from(String(token), 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * STOP ONE SUBSCRIPTION AT THE END OF ITS PAID WEEK. The ask is a row first —
 * who asked and when — and only then the door, which finds the act the owner
 * approved with the test from that row. Nothing is refunded here; a week
 * already paid is delivered, and its own refund link stands. Idempotent: a
 * second ask is the first one's row, and a stop the provider already took is
 * reported as done.
 */
export async function cancelSubscription(input: { fulfilmentId: string; askedBy: 'buyer' | 'test_ended' }): Promise<{ stopped: boolean; refusedReason: string | null }> {
  const f = await one(
    `SELECT f.*, p.id AS product_id, e.founder_id FROM experiment_fulfilments f
       JOIN venture_experiments e ON e.id = f.experiment_id
       JOIN products p ON p.from_experiment_id = f.experiment_id AND p.deleted_at IS NULL
      WHERE f.id = ?`, [input.fulfilmentId]);
  if (!f) throw new HandRefused('fulfilment_not_found');
  if (f.subscription_ref == null) return { stopped: false, refusedReason: 'not a subscription' };
  const sub = String(f.subscription_ref);
  const experimentId = String(f.experiment_id);
  // Made under the subscription's FIRST week, which is the purchase the act
  // covered when it began; a later week may have been reported after the act
  // lapsed, and the stop must not depend on that.
  const first = await one('SELECT id FROM experiment_fulfilments WHERE experiment_id = ? AND subscription_ref = ? ORDER BY created_at, rowid LIMIT 1', [experimentId, sub]);
  await query(
    `INSERT INTO subscription_cancellations (id, founder_id, experiment_id, fulfilment_id, subscription_ref, asked_by)
     VALUES (?,?,?,?,?,?) ON CONFLICT (experiment_id, subscription_ref) DO NOTHING`,
    [nanoid(), String(f.founder_id), experimentId, String(first?.id ?? f.id), sub, input.askedBy]);
  const c = await one('SELECT id, cancelled_at FROM subscription_cancellations WHERE experiment_id = ? AND subscription_ref = ?', [experimentId, sub]);
  if (c?.cancelled_at != null) return { stopped: true, refusedReason: null };
  const refuse = async (why: string): Promise<{ stopped: false; refusedReason: string }> => {
    await query('UPDATE subscription_cancellations SET refused_reason = ? WHERE id = ?', [why, String(c?.id)]);
    return { stopped: false, refusedReason: why };
  };
  if (process.env.FOUNDRY_ENABLE_MONEY_TOOLS !== 'true') return refuse('policy: Foundry does not move money by default (FOUNDRY_ENABLE_MONEY_TOOLS is off), so only you can cancel this subscription on Stripe');
  const result = await invoke({
    productId: String(f.product_id), tool: 'stripe_update_subscription', action: `stop subscription ${sub} at the end of its paid week (${input.askedBy === 'buyer' ? 'the buyer asked' : 'the test can deliver no more weeks'})`,
    params: { subscription_id: sub, body: { cancel_at_period_end: 'true' } },
    dedupKey: `experiment:${experimentId}:cancel:${sub}`, customerExternalId: sub, surface: 'billing', dataClass: 'customer',
  });
  if (!result.ok) {
    // ALREADY OVER IS STOPPED. A subscription the buyer ended at the provider,
    // or that lapsed on a failed card, refuses an update; asking it what it
    // is turns that refusal into the fact it reports.
    const { subscriptionHasStopped } = await import('./payment-link.js');
    if (!(await subscriptionHasStopped(sub).catch(() => false))) return refuse(`${result.phase}: ${result.reason}`);
  }
  await query(`UPDATE subscription_cancellations SET cancelled_at = datetime('now'), refused_reason = NULL WHERE id = ? AND cancelled_at IS NULL`, [String(c?.id)]);
  return { stopped: true, refusedReason: null };
}

/**
 * EVERY SUBSCRIPTION THAT MUST STOP, STOPPED. A buyer's ask that the door
 * refused is asked again; and once the test can no longer deliver a week — the
 * owner stopped it, it was retired, or the act allowing deliveries is within
 * STOP_AHEAD_DAYS of lapsing — every subscription it started is told to end
 * with the week already paid. A settled test is not by itself an end: its
 * subscribers are still delivered to while the act stands.
 */
export async function stopWhatRecurs(experimentId: string, now: Date = new Date()): Promise<{ stopped: number; exceptions: string[] }> {
  const out = { stopped: 0, exceptions: [] as string[] };
  const running = await rows(
    `SELECT f.subscription_ref AS sub, MIN(f.id) AS fulfilment_id,
            (SELECT c.asked_by FROM subscription_cancellations c WHERE c.experiment_id = f.experiment_id AND c.subscription_ref = f.subscription_ref) AS asked_by
       FROM experiment_fulfilments f
      WHERE f.experiment_id = ? AND f.subscription_ref IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM subscription_cancellations c WHERE c.experiment_id = f.experiment_id AND c.subscription_ref = f.subscription_ref AND c.cancelled_at IS NOT NULL)
      GROUP BY f.subscription_ref`, [experimentId]);
  if (running.length === 0) return out;
  const e = await experimentRow(experimentId);
  const act = await campaignActOf(experimentId);
  const x = await exposureOf(experimentId);
  // STOPPED is read as carryWhatIsOwed reads it: the act revoked, or the offer
  // withdrawn before the world settled the test. An act already used once
  // cannot be revoked (standing-intent.ts), so the withdrawn offer is the
  // owner's stop as often as the revocation is.
  const stopped = (!!act && act.revokedAt !== null) || (!!e && e.ranAt === null && (e.retiredAt !== null || (!!x && x.withdrawnAt !== null)));
  const ending = !e || stopped || e.retiredAt !== null || !act || act.decision !== 'approved'
    || new Date(act.expiresAt).getTime() - now.getTime() < STOP_AHEAD_DAYS * 86_400_000;
  for (const r of running) {
    if (!ending && r.asked_by == null) continue;
    const done = await cancelSubscription({ fulfilmentId: String(r.fulfilment_id), askedBy: 'test_ended' })
      .catch((err: unknown) => ({ stopped: false, refusedReason: err instanceof Error ? err.message : String(err) }));
    if (done.stopped) out.stopped += 1;
    // WHO ASKED is said, because a buyer who asked to stop and is still being
    // charged is a buyer waiting on the owner, not a housekeeping line.
    else out.exceptions.push(`subscription ${String(r.sub)} still charges every week${r.asked_by === 'buyer' ? ' although its buyer asked to cancel' : ''}: ${done.refusedReason}`);
  }
  return out;
}

export interface CancelView { fulfilmentId: string; title: string; amountCents: number; currency: string; alreadyStopped: boolean }

/** What the cancel link shows: the subscription the signed link names, and whether it has already stopped. */
export async function describeCancelLink(fulfilmentId: string, token: string): Promise<CancelView | null> {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(fulfilmentId) || !verifyCancelToken(fulfilmentId, token)) return null;
  const f = await one('SELECT * FROM experiment_fulfilments WHERE id = ? AND subscription_ref IS NOT NULL', [fulfilmentId]);
  if (!f) return null;
  const deliverable = await materialOf(String(f.experiment_id), 'deliverable');
  const c = await one('SELECT cancelled_at FROM subscription_cancellations WHERE experiment_id = ? AND subscription_ref = ?', [String(f.experiment_id), String(f.subscription_ref)]);
  return { fulfilmentId, title: deliverable?.title ?? 'your weekly brief', amountCents: Number(f.amount_cents), currency: String(f.currency).toUpperCase(), alreadyStopped: c?.cancelled_at != null };
}

/** The buyer confirmed. The ask is a fact; the stop is governed; a refusal is retried by every pass and is the owner's to see. */
export async function requestCancelByLink(fulfilmentId: string, token: string): Promise<{ status: 'not_found' | 'stopped' | 'already_stopped' | 'asked'; view: CancelView | null }> {
  const view = await describeCancelLink(fulfilmentId, token);
  if (!view) return { status: 'not_found', view: null };
  if (view.alreadyStopped) return { status: 'already_stopped', view };
  const result = await cancelSubscription({ fulfilmentId, askedBy: 'buyer' });
  return { status: result.stopped ? 'stopped' : 'asked', view };
}

// ── The cycle ────────────────────────────────────────────────────────────────

export interface HandReport { experimentId: string; offersPlanned: number; offersSent: number;
  deliveriesSent: number; reconciled: number; refundsIssued: number; settled: string | null;
  exceptions: string[];
  /**
   * WHO WAS NOT WRITTEN TO, AND WHY — the institution working, not failing.
   *
   * A recipient an owner exclusion covers, whose address is struck on another
   * line of this list, who has said no, or who has heard from us too recently
   * is not an error. Reported as an exception, each one turned the morning red
   * for as long as the row existed, every hour, and the owner learned to read
   * a red morning as noise — which is how a real failure gets missed. The
   * recipients list already shows each of these rows and says which it is.
   */
  withheld: string[];
  /** What this pass achieved against the authorised act. Never inferred from
   *  the absence of a thrown error: see services/venture/run-state.ts. */
  state: import('./run-state.js').RunState;
  because: string | null }

/**
 * THE REFUSALS THAT ARE THE INSTITUTION WORKING.
 *
 * Each of these is a standing rule about the person who would receive the
 * message, decided before this pass and unchanged by it: the owner's own
 * exclusion, an address struck on another line of this test, somebody who has
 * said no, somebody written to too recently. Retrying costs nothing and
 * changes nothing, and the row stays in the approved set on purpose — the
 * owner's list is where he sees it, beside the reason, rather than in an
 * hourly report of things that went wrong.
 *
 * Everything else `planOffer` refuses is a defect or an incomplete design, and
 * stays an exception.
 */
const WITHHELD_FROM = new Set([
  'owner_excluded', 'recipient_struck_at_this_address', 'recipient_suppressed', 'contact_frequency',
]);

/**
 * HOW MANY GO OUT IN ONE PASS, AND WHY THE FIRST ONE IS SMALLER.
 *
 * A cohort of forty is not forty messages; it is a first stage that tells the
 * institution whether its own outbound is behaving, and then the rest. The
 * first pass is deliberately small because everything that can be wrong with a
 * send — a provider rejecting the domain, a malformed link, a suppression that
 * did not apply, a recipient resolved to the wrong address — shows up in the
 * first handful and costs five strangers rather than forty.
 *
 * Nothing ceremonial follows it. Each pass reconciles the previous pass's
 * receipts at the end of its own run and re-reads every stop condition before
 * writing again, so stage two proceeds on evidence rather than on a timer, and
 * the owner does not press anything to make it happen.
 */
export const FIRST_STAGE = 5;
export const LATER_STAGE = 12;

export async function stageSize(experimentId: string): Promise<number> {
  const sent = Number((await one(
    `SELECT COUNT(*) AS n FROM outbound_actions
      WHERE experiment_id = ? AND experiment_act = 'offer' AND status = 'executed'`,
    [experimentId]))?.n ?? 0);
  return sent === 0 ? FIRST_STAGE : LATER_STAGE;
}

export async function runHand(input: { founderId?: string; now?: Date; offersPerTick?: number; deliveryStatus?: (productId: string, messageId: string) => Promise<DeliveryStatus> } = {}): Promise<HandReport[]> {
  const now = input.now ?? new Date();
  const live = await rows(
    `SELECT e.id FROM venture_experiments e
      WHERE e.decision = 'approved' AND e.ran_at IS NULL AND e.validity = 'valid' AND e.evidence_mode = 'real' AND e.retired_at IS NULL
        ${input.founderId ? 'AND e.founder_id = ?' : ''}
        AND EXISTS (SELECT 1 FROM proposed_acts a WHERE a.experiment_id = e.id AND coalesce(a.measurement_critical, 0) = 1
                      AND a.decision = 'approved' AND a.revoked_at IS NULL AND datetime(a.expires_at) > datetime('now'))
      ORDER BY e.decided_at, e.rowid`, input.founderId ? [input.founderId] : []);
  const reports: HandReport[] = [];
  // ONE READING OF THE WORLD PER OWNER PER PASS. Three experiments sharing a
  // Workshop share its paths; asking the provider three times would cost three
  // times as much and could answer differently each time, which is the one
  // thing a record of what was working must not do.
  const askedTheProvider = new Set<string>();
  // EVERY OWNER WITH A LIVE PAID OFFER, NOT ONLY ONE WITH A STANDING ACT.
  //
  // The ask used to happen inside the loop over live experiments, whose own
  // condition requires an approved, unrevoked, UNEXPIRED measurement-critical
  // act. Acts expire at three weeks; a settlement window can be thirty days.
  // So a buyer paying on day 24 of a test whose acts lapsed on day 21, with a
  // dropped webhook, was never asked about by anybody — the money moved, no
  // obligation existed, and the rule settled "nobody bought" over the top of
  // it. An adversarial reviewer found it. The ask is about somebody having
  // paid, which no expiry stops, so it runs for every owner the pass touches
  // and for every owner with a paid exposure placed inside the window.
  const owedAnAsking = (await rows(
    `SELECT DISTINCT x.founder_id FROM experiment_exposures x
       JOIN venture_experiments e ON e.id = x.experiment_id
      WHERE x.provider = 'stripe' AND e.evidence_mode = 'real' AND x.placed_at IS NOT NULL
        AND datetime(x.placed_at) >= datetime(?)
        ${input.founderId ? 'AND x.founder_id = ?' : ''}`,
    input.founderId
      ? [new Date(now.getTime() - RECONCILE_DAYS * 86_400_000).toISOString(), input.founderId]
      : [new Date(now.getTime() - RECONCILE_DAYS * 86_400_000).toISOString()]))
    .map((r) => String(r.founder_id));
  for (const founderId of owedAnAsking) {
    askedTheProvider.add(founderId);
    const { reconcileWithTheProvider } = await import('./what-the-provider-knows.js');
    await reconcileWithTheProvider(founderId, now).catch(() => undefined);
  }
  const healthByFounder = new Map<string, Awaited<ReturnType<typeof import('../public-workshop/infrastructure.js')['workshopHealth']>> | null>();
  const healthFor = async (founderId: string): Promise<Awaited<ReturnType<typeof import('../public-workshop/infrastructure.js')['workshopHealth']>> | undefined> => {
    if (!healthByFounder.has(founderId)) {
      const { workshopHealth } = await import('../public-workshop/infrastructure.js');
      healthByFounder.set(founderId, await workshopHealth(founderId).catch(() => null));
    }
    return healthByFounder.get(founderId) ?? undefined;
  };
  for (const row of live) {
    const experimentId = String(row.id);
    const report: HandReport = { experimentId, offersPlanned: 0, offersSent: 0, deliveriesSent: 0, reconciled: 0, refundsIssued: 0, settled: null, exceptions: [], withheld: [], state: 'noop_expected', because: null };
    reports.push(report);
    const e = await experimentRow(experimentId);
    if (!e?.productId) { report.exceptions.push('no asset'); continue; }

    // ASK THE PROVIDER WHAT IT KNOWS, BEFORE ANYTHING IS READ OR CONCLUDED.
    // Once per owner per pass, and never gated on whether the test may write:
    // a pause, a broken path and a stopped campaign all stop the asking, and
    // none of them stops somebody having paid. A payment that reached Foundry
    // only because it asked is written onto the day first, so the health
    // reading taken afterwards cannot make that day look well — the day record
    // keeps the worst of a day, which is what that rule is for.
    if (!askedTheProvider.has(e.founderId)) {
      askedTheProvider.add(e.founderId);
      const { reconcileWithTheProvider } = await import('./what-the-provider-knows.js');
      const found = await reconcileWithTheProvider(e.founderId, now).catch(() => null);
      if (found?.sentence) report.exceptions.push(found.sentence);
    }

    // NEW ECONOMIC ACTIVITY STOPS AT THE OWNER'S PAUSE. Three things do not:
    // what a buyer is owed, the refund of what failed, and the world's verdict.
    // Concluding a test is reading what already happened, not starting
    // something new — and a test left running because nobody was watching is
    // the opposite of a pause. So a pause, an unplaceable offer and an
    // unpublished page each stop the WRITING and nothing else below it.
    const { publicWorkshopOf } = await import('../public-workshop/settings.js');
    const w = await publicWorkshopOf(e.founderId);
    let mayWrite = true;
    if (w?.economicPause) {
      report.exceptions.push(`new economic activity is paused: ${w.economicPause.reason}`);
      mayWrite = false;
    } else {
      // The place the offer lives and the page that explains it, before anyone is written to.
      const placed = await prepareExposure(experimentId).catch((err: unknown) => ({ refused: err instanceof Error ? err.message : String(err) }));
      if ('refused' in placed) { report.exceptions.push(`offer not placed: ${placed.refused}`); mayWrite = false; }
      else if (w && !placed.published) { report.exceptions.push(`page not published: ${placed.failures.join('; ')}`); mayWrite = false; }
    }

    // THE INSTRUMENT, READ AGAINST THE WORLD, BEFORE ANYBODY IS WRITTEN TO.
    // This is the check whose absence sent nineteen people an invitation to
    // reply to an address that was not routed. A path that bears on the
    // MEASUREMENT or on the INVITATION stops the writing; a path that bears on
    // an OBLIGATION is handled below, where what is owed is carried out,
    // because stopping the writing does not discharge a promise already made.
    //
    // Only `not_working` stops it. `unknown` is left to run: a path nobody
    // could read is not a path that failed, and this institution has just
    // spent a campaign learning not to collapse those two.
    if (mayWrite) {
      const { declareInstrument, verifyInstrument, pathsNotWorking, sentenceFor } = await import('./the-instrument.js');
      await declareInstrument(experimentId);
      const readings = await verifyInstrument(experimentId, { now, health: await healthFor(e.founderId) });
      // AN OBLIGATION PATH STOPS A NEW PROMISE, AND ONLY A NEW ONE.
      //
      // This dropped every obligation path, on the reasoning that discharging
      // what is already owed must not be stopped by the same check. That part
      // is right and is preserved — nothing below this gate is affected, and
      // `carryWhatIsOwed` still runs. But the refund path's own recorded
      // reason is "the public promise is money back with no questions, which
      // has to be possible before it is made", and dropping it here meant the
      // one path whose failure can never stop a new promise being made was the
      // one that promise depends on. An adversarial reviewer found it.
      const broken = pathsNotWorking(readings);
      if (broken.length > 0) {
        report.exceptions.push(...broken.map(sentenceFor));
        mayWrite = false;
      }
    }

    // WHAT THE WORLD HAS ALREADY SAID CAN STOP IT BEFORE ITS BUDGET DOES.
    // Once enough people have said it is not useful, or complained, or asked
    // not to be written to, further exposure buys no information and spends
    // other people's attention and the Workshop's standing.
    if (mayWrite) {
      const { stopConditionsMet, overFulfilmentCap } = await import('./probe-design.js');
      const stop = await stopConditionsMet(experimentId);
      if (stop.stop) { report.exceptions.push(`stopped early: ${stop.because.join('; ')}`); mayWrite = false; }
      const capacity = await overFulfilmentCap(experimentId);
      if (capacity.over) { report.exceptions.push(`holding the offer: ${capacity.owed} purchases owed against a cap of ${capacity.cap} until they are delivered`); mayWrite = false; }
    }

    // NO NEW PROMISE WHILE AN OLD ONE WAITS ON HIM. Every offer carries the
    // Workshop's money-back promise; a buyer already waiting on something only
    // the owner can give is that promise not yet kept. Writing to strangers
    // meanwhile would widen exactly the exposure he is not there to carry —
    // and when he is away, nobody is. Only the WRITING stops: deliveries,
    // refunds Foundry can issue, and the verdict all run below as before.
    if (mayWrite) {
      const { buyersWaitingOnHim } = await import('./obligations.js');
      const waiting = await buyersWaitingOnHim(e.founderId, now);
      if (waiting.length > 0) {
        report.exceptions.push(`holding new offers: ${String(waiting.length)} buyer${waiting.length === 1 ? ' is' : 's are'} `
          + `waiting on you — ${waiting[0].sentence}`);
        mayWrite = false;
      }
    }

    // A PROVIDER OUTAGE IS NOT A REFUSAL. An offer the provider could not take
    // (a 503, a timeout) was written as failed and its recipient counted as
    // done, so one bad morning silently dropped those people from the test
    // for good. The month of a portfolio run in the laboratory found it. A
    // failed offer past its reconcile time is tried again under the same
    // idempotency key, so the provider cannot deliver it twice; a refusal by
    // our own rules (rejected) is never retried.
    if (mayWrite) {
      for (const f of await rows(`SELECT id FROM outbound_actions WHERE experiment_id = ? AND experiment_act = 'offer' AND status = 'failed'
                                    AND (reconcile_after IS NULL OR datetime(reconcile_after) <= datetime(?)) ORDER BY created_at, rowid`, [experimentId, now.toISOString()])) {
        await query(`UPDATE outbound_actions SET status = 'pending_approval', effect_certainty = 'not_attempted', result_json = NULL, reconcile_after = NULL WHERE id = ? AND status = 'failed'`, [String(f.id)]);
        const again = await executeAction(String(f.id));
        if (again.dispatched) report.offersSent += 1; else report.exceptions.push(`offer tried again: ${again.refusedReason}`);
      }
    }
    // Offers, paced, one per approved business, never twice.
    if (mayWrite) {
      const done = new Set((await rows(`SELECT recipient_id FROM outbound_actions WHERE experiment_id = ? AND experiment_act = 'offer' AND recipient_id IS NOT NULL`, [experimentId])).map((r) => String(r.recipient_id)));
      const perTick = input.offersPerTick ?? await stageSize(experimentId);
      const targets = (await recipientsOf(experimentId)).filter((r) => r.reviewStatus === 'approved' && r.channel === 'email' && r.email && !done.has(r.id)).slice(0, perTick);
      for (const recipient of targets) {
        try {
          const plan = await planOffer({ experimentId, recipientId: recipient.id, now });
          report.offersPlanned += 1;
          const sent = await executeAction(plan.id);
          if (sent.dispatched) report.offersSent += 1; else report.exceptions.push(`offer to ${recipient.counterpartyRef}: ${sent.refusedReason}`);
        } catch (error) {
          if (error instanceof HandRefused && WITHHELD_FROM.has(error.code)) {
            report.withheld.push(`${recipient.counterpartyRef}: ${error.message}`);
            continue;
          }
          report.exceptions.push(`offer: ${error instanceof Error ? error.message : String(error)}`);
          if (error instanceof HandRefused && (error.code === 'offer_quality' || error.code === 'offer_missing' || error.code === 'publication_gate')) break;
        }
      }
    }

    await carryWhatIsOwed(experimentId, now, report, input.deliveryStatus);

    // The sealed rule reads what the world did. A settled test's offer comes
    // down at once, so nobody pays for a question already answered.
    const s = await settleFromTheWorld(experimentId, now);
    report.settled = s.settled;
    if (s.settled !== null) {
      const x = await exposureOf(experimentId);
      if (x && x.withdrawnAt === null) await withdrawExposure(x.id);
      const down = await takeDownExposure(experimentId).catch((err: unknown) => ({ done: false, reason: err instanceof Error ? err.message : String(err) }));
      if (!down.done && down.reason) report.exceptions.push(`offer not taken down: ${down.reason}`);
      await republishRecord(experimentId, report);
    }
    // WHAT THIS PASS ACHIEVED, stated rather than inferred from the absence of a
    // thrown error. An authorised experiment that moved nothing because a
    // dependency refused is BLOCKED, and until this existed it was reported as
    // a clean run — every hour, for as long as the dependency stayed down.
    const { readRun, recordRun } = await import('./run-state.js');
    const reading = readRun({
      authorised: true,
      intended: report.offersPlanned + report.deliveriesSent,
      achieved: report.offersSent + report.deliveriesSent + report.reconciled + report.refundsIssued,
      exceptions: report.exceptions,
      withheld: report.withheld.length,
      attempting: report.offersPlanned > 0 || report.offersSent > 0
        ? 'writing to the businesses you approved'
        : 'carrying the test one step',
    });
    report.state = reading.state;
    report.because = reading.because ?? null;
    await recordRun(experimentId, e.founderId, reading).catch(() => undefined);
  }

  // WHAT IS OWED OUTLIVES THE TEST. A purchase that arrived as the test settled
  // or was stopped is still a purchase: delivered if the acts allowing it
  // stand, refunded if the offer was withdrawn before delivery, and a link the
  // provider has not yet taken down is tried again.
  const aftermath = await rows(
    `SELECT e.id FROM venture_experiments e
      WHERE e.decision = 'approved' AND e.evidence_mode = 'real' ${input.founderId ? 'AND e.founder_id = ?' : ''}
        AND e.id NOT IN (${live.map(() => '?').join(',') || "''"})
        AND (EXISTS (SELECT 1 FROM experiment_fulfilments f WHERE f.experiment_id = e.id AND ${OPEN_OBLIGATION('f')})
          OR EXISTS (SELECT 1 FROM experiment_fulfilments f WHERE f.experiment_id = e.id AND ${STILL_RECURS('f')})
          OR EXISTS (SELECT 1 FROM experiment_exposures x WHERE x.experiment_id = e.id AND x.withdrawn_at IS NOT NULL AND datetime(x.withdrawn_at) > datetime('now', '-7 days')))
      ORDER BY e.decided_at, e.rowid`, [...(input.founderId ? [input.founderId] : []), ...live.map((r) => String(r.id))]);
  for (const row of aftermath) {
    const experimentId = String(row.id);
    const report: HandReport = { experimentId, offersPlanned: 0, offersSent: 0, deliveriesSent: 0, reconciled: 0, refundsIssued: 0, settled: null, exceptions: [], withheld: [], state: 'noop_expected', because: null };
    const x = await exposureOf(experimentId);
    if (x && x.withdrawnAt !== null) {
      const down = await takeDownExposure(experimentId).catch((err: unknown) => ({ done: false, reason: err instanceof Error ? err.message : String(err) }));
      if (!down.done && down.reason && down.reason !== 'nothing to take down') report.exceptions.push(`offer not taken down: ${down.reason}`);
    }
    await carryWhatIsOwed(experimentId, now, report, input.deliveryStatus);
    if (report.deliveriesSent || report.reconciled || report.refundsIssued || report.exceptions.length) reports.push(report);
  }
  return reports;
}

/** THE PUBLIC RECORD FOLLOWS THE TEST. A settled or stopped test's page says
 * so and keeps its address; the way to pay comes off it with the offer. */
async function republishRecord(experimentId: string, report?: HandReport): Promise<void> {
  const { publicWorkshopOfExperiment } = await import('../public-workshop/settings.js');
  const w = await publicWorkshopOfExperiment(experimentId);
  if (!w) return;
  const { publishSite } = await import('../public-workshop/publication.js');
  const r = await publishSite(w.founderId, HAND).catch((err: unknown) => ({ failed: [{ path: '*', reason: err instanceof Error ? err.message : String(err) }], held: [] as Array<{ path: string; reason: string }>, unverified: [] as string[] }));
  for (const f of r.failed) report?.exceptions.push(`public record not updated: ${f.path}: ${f.reason}`);
  // A HELD PAGE IS THE ONE THIS FUNCTION MOST NEEDS TO SAY OUT LOUD. Its whole
  // contract is that a stopped test's page says so and the way to pay comes
  // off it. If the page was held, none of that happened: the live bytes still
  // read "Open now" with a Buy button over a link `takeDownExposure` has just
  // deactivated, and this returned in silence.
  for (const h of r.held) report?.exceptions.push(`public record not updated — the page is held: ${h.path}: ${h.reason}`);
  for (const u of r.unverified) report?.exceptions.push(`public record not seen: ${u}`);
}

/** Deliveries for what is owed, receipts, refunds of what failed or was withdrawn. */
async function carryWhatIsOwed(experimentId: string, now: Date, report: HandReport, deliveryStatus?: (productId: string, messageId: string) => Promise<DeliveryStatus>): Promise<void> {
  const e = await experimentRow(experimentId);
  const x = await exposureOf(experimentId);
  const act = await campaignActOf(experimentId);
  // Owed under an offer the owner STOPPED: a purchase that slipped in is
  // returned rather than fulfilled. A stop is read from the campaign act he
  // revoked (a settlement withdraws the exposure too, and a purchase reported
  // after a settlement is still delivered); the older reading — withdrawn
  // before the world settled it — is kept for the same case reached by hand.
  const stopped = (!!act && act.revokedAt !== null) || (!!e && e.ranAt === null && (e.retiredAt !== null || (!!x && x.withdrawnAt !== null)));
  // Before anything is delivered or refunded: nobody is charged for a week
  // Foundry may not deliver (stopWhatRecurs).
  const recurs = await stopWhatRecurs(experimentId, now);
  report.exceptions.push(...recurs.exceptions);
  for (const f of await rows(`SELECT id, payment_ref, disputed_at, dispute_outcome, created_at FROM experiment_fulfilments WHERE experiment_id = ? AND status = 'owed' ORDER BY created_at, rowid`, [experimentId])) {
    // A CONTESTED PURCHASE IS NEITHER DELIVERED NOR REFUNDED until the bank
    // decides; the obligation stays visible as itself (obligations.ts).
    if (f.disputed_at != null && f.dispute_outcome == null) continue;
    // Reported after the acts lapsed: nothing he approved covers it, so it is
    // neither delivered nor refunded here; it is his (obligations.ts).
    if (act && new Date(String(f.created_at).replace(' ', 'T') + (String(f.created_at).endsWith('Z') ? '' : 'Z')).getTime() > new Date(act.expiresAt).getTime()) continue;
    if (stopped) {
      const r = await refundFulfilment({ fulfilmentId: String(f.id), reason: 'the offer was withdrawn before delivery' });
      if (r.issued) { report.refundsIssued += 1; await query(`UPDATE experiment_fulfilments SET status = 'refunded', updated_at = datetime('now') WHERE id = ? AND status = 'owed'`, [String(f.id)]); }
      else report.exceptions.push(`refund for ${String(f.payment_ref)} (offer withdrawn): ${r.refusedReason}`);
      continue;
    }
    try {
      let plan = await planDelivery({ experimentId, fulfilmentId: String(f.id), now });
      // A PAID DELIVERY NEVER STALLS SILENTLY (R31). The plan is keyed on the
      // payment and returned whatever became of it, and this used to skip any
      // plan not waiting to go: one refusal at the door, one unknown outcome,
      // one pass that died mid-send, and the buyer waited for ever while every
      // surface said it went out on the next pass.
      if (plan.status === 'executed') {
        // It went out, and the purchase was never marked: record it, never resend.
        await query(`UPDATE experiment_fulfilments SET status = 'sent', updated_at = datetime('now') WHERE id = ? AND status = 'owed'`, [String(f.id)]);
        continue;
      }
      if (await rearmDelivery(plan.id, now)) plan = { ...plan, status: 'pending_approval' };
      if (plan.status !== 'pending_approval') { report.exceptions.push(`delivery ${String(f.payment_ref)}: waiting (${plan.status})`); continue; }
      const sent = await executeAction(plan.id);
      if (sent.dispatched) { report.deliveriesSent += 1; await query(`UPDATE experiment_fulfilments SET status = 'sent', updated_at = datetime('now') WHERE id = ? AND status = 'owed'`, [String(f.id)]); }
      else report.exceptions.push(`delivery ${String(f.payment_ref)}: ${sent.refusedReason}`);
    } catch (error) { report.exceptions.push(`delivery ${String(f.payment_ref)}: ${error instanceof Error ? error.message : String(error)}`); }
  }

  // Receipts.
  for (const a of await rows(`SELECT id, product_id, provider_receipt_json FROM outbound_actions WHERE experiment_id = ? AND status = 'executed' AND outcome_status = 'unresolved' AND reconcile_after IS NOT NULL AND datetime(reconcile_after) <= datetime(?)`, [experimentId, now.toISOString()])) {
    const receipt = JSON.parse(String(a.provider_receipt_json ?? '{}')) as { message_id?: string };
    const st = deliveryStatus && receipt.message_id ? await deliveryStatus(String(a.product_id), receipt.message_id) : undefined;
    const r = await reconcileAction(String(a.id), st);
    if (r.outcome === 'verified_success' || r.outcome === 'verified_failure') report.reconciled += 1;
  }

  // A DELIVERY THE PROVIDER NEVER CONFIRMED IS, AFTER SEVEN DAYS, A DELIVERY
  // THAT DID NOT HAPPEN. The sealed rule counts confirmed deliveries and the
  // public promise is a refund with no questions asked, so an obligation that
  // never closes is the worse outcome: the row fails and the approved refund
  // runs. The action's own outcome stays unresolved — nothing was verified.
  for (const f of await rows(
    `SELECT f.id, f.payment_ref, o.provider_receipt_json FROM experiment_fulfilments f
       JOIN outbound_actions o ON o.fulfilment_id = f.id AND o.experiment_act = 'delivery' AND o.status = 'executed' AND o.outcome_status = 'unresolved'
      WHERE f.experiment_id = ? AND f.status = 'sent' AND datetime(o.executed_at) <= datetime(?, ?)`,
    [experimentId, now.toISOString(), `-${String(UNCONFIRMED_IS_FAILED_AFTER_DAYS)} days`])) {
    const receipt = JSON.parse(String(f.provider_receipt_json ?? '{}')) as { message_id?: string };
    if (x) {
      const { exchangeOf } = await import('./probe-design-context.js');
      // Observed on the real clock: the ledger refuses a source clock ahead of its own.
      await recordBusinessOutcome({ exposureId: x.id, kind: 'delivery_failed', observedAt: new Date(Math.min(now.getTime(), Date.now())), provider: 'resend',
        providerRef: `${receipt.message_id ?? String(f.id)}:unconfirmed:${String(UNCONFIRMED_IS_FAILED_AFTER_DAYS)}d`, arrivedVia: 'email', exchange: await exchangeOf(experimentId) });
    }
    await query(`UPDATE experiment_fulfilments SET status = 'failed', updated_at = datetime('now') WHERE id = ? AND status = 'sent'`, [String(f.id)]);
    report.exceptions.push(`delivery ${String(f.payment_ref)}: not confirmed by the provider in ${String(UNCONFIRMED_IS_FAILED_AFTER_DAYS)} days; treated as undelivered and refunded`);
  }

  // A failed delivery is refunded; a refund the buyer asked for that could not
  // be issued (an outage, the door refusing) is tried again under the same
  // key; a refund that cannot be issued is the owner's.
  //
  // AND A VENUE REFUND IS NEVER THIS PASS'S TO TRY. `obligations.ts` states it
  // as law — "A VENUE REFUND IS NEVER FOUNDRY'S TO TRY. Not after a day, not
  // with the money switch on, not with the act standing: there is no door" —
  // and this query, which is the pass that would have tried it, had no
  // `provider` clause. A venue row carries no `charge_ref`, so every hourly
  // pass reached `refundFulfilment`, came back `charge_unknown`, and pushed an
  // exception that made the experiment read as blocked, for as long as the
  // buyer waited. No money could move; the damage was to what the owner was
  // told. The filter is in the SQL rather than in the loop because the loop is
  // where somebody will forget it.
  for (const f of await rows(`SELECT id, status, refund_requested_at FROM experiment_fulfilments f WHERE f.experiment_id = ? AND f.refund_ref IS NULL AND f.status <> 'refunded'
                                 AND f.provider = 'stripe'
                                 AND (f.status = 'failed' OR f.refund_requested_at IS NOT NULL) AND NOT (f.disputed_at IS NOT NULL AND f.dispute_outcome IS NULL)`, [experimentId])) {
    const r = await refundFulfilment({ fulfilmentId: String(f.id), reason: String(f.status) === 'failed' ? 'the brief could not be delivered' : 'buyer asked through the delivery link' });
    if (r.issued) report.refundsIssued += 1; else report.exceptions.push(`refund for ${String(f.id)}: ${r.refusedReason}`);
  }

  // A STOPPED TEST'S ASSET RETIRES WHEN THE LAST BUYER IS SQUARE. Retirement
  // refuses while anything is owed (asset.ts), so the stop leaves it standing;
  // this is the pass that finishes what the stop began.
  if (stopped && e?.productId && !(await owesAnybody(experimentId))) {
    await retireExperimentalAsset({ productId: e.productId, because: 'you stopped it, and the last buyer has been refunded' });
  }
}

/** What Foundry cannot carry for a live experiment, in the owner's words. */
export async function handExceptions(experimentId: string): Promise<string[]> {
  const out: string[] = [];
  const e = await experimentRow(experimentId);
  // A settled or stopped test can still owe a buyer something; those lines stay.
  if (!e || e.decision !== 'approved') return out;
  // WHAT A BUYER IS OWED, in the one reading every surface shares. Only what
  // needs him, or is worth his eyes, is an exception; what the next pass
  // carries on its own is the obligation's ordinary life.
  for (const o of await obligationsOf(experimentId)) {
    // Owed and not yet sent, or sent and awaiting the provider's word, is the
    // ordinary path and not an exception.
    if ((o.state === 'owed' || o.state === 'sent_unconfirmed') && o.action === 'nothing') continue;
    out.push(`${o.sentence} ${o.asksHim ?? ''}`.trim());
  }
  const failed = await rows(`SELECT COUNT(*) AS n, MIN(result_json) AS why FROM outbound_actions WHERE experiment_id = ? AND experiment_act = 'offer' AND status = 'failed'`, [experimentId]);
  const n = Number(failed[0]?.n ?? 0);
  if (n > 0) {
    const why = (JSON.parse(String(failed[0]?.why ?? '{}')) as { reason?: string }).reason ?? 'the provider did not answer';
    out.push(`${String(n)} ${n === 1 ? 'offer' : 'offers'} could not be sent because the mail provider refused or did not answer (${why}). Nobody is dropped: I try again on the next pass, under the same key, so nobody can receive it twice.`);
  }
  const rejected = await rows(`SELECT preview_text, result_json FROM outbound_actions WHERE experiment_id = ? AND status = 'rejected' ORDER BY created_at DESC LIMIT 3`, [experimentId]);
  for (const r of rejected) out.push(`${String(r.preview_text)} was refused by my own rules and not sent: ${String((JSON.parse(String(r.result_json ?? '{}')) as { reason?: string; refused?: string }).reason ?? (JSON.parse(String(r.result_json ?? '{}')) as { refused?: string }).refused ?? 'see the door')}.`);
  return out;
}
