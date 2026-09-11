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

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { invoke } from '../outbound/gateway.js';
import { getSendingIdentity } from '../outbound/sending-identity.js';
import { withRetry } from '../resilience.js';
import { decideProposedAct, proposeAct, revokeApproval, setBoundary } from '../institution/standing-intent.js';
import { stateOfferShape, retireExperimentalAsset } from './asset.js';
import { answerLighter } from './legal-surface.js';
import { bindActToExperiment, exposureOf, placeExposure, recordBusinessOutcome, settleFromTheWorld, withdrawExposure } from './outcome.js';
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
}

export async function experimentRow(experimentId: string): Promise<ExperimentRow | null> {
  const r = await one(
    `SELECT e.id, e.founder_id, e.opportunity_id, e.decision, e.ran_at, e.validity, e.cost_cents, e.what_we_do, e.what_we_expect,
            e.would_disprove, e.settles_when, e.verdict, e.what_happened, e.decided_at, e.evidence_mode,
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
  };
}

/** Live means: approved, valid, not yet settled, and not stopped by the owner. */
export function isLive(e: ExperimentRow, exposureWithdrawn: boolean): boolean {
  return e.decision === 'approved' && e.validity === 'valid' && e.ranAt === null && !exposureWithdrawn;
}

// ── Whom Foundry may write to ────────────────────────────────────────────────

export interface Recipient {
  id: string; experimentId: string; counterpartyRef: string; email: string | null; channel: 'email' | 'web_form';
  sourceUrl: string | null; reviewStatus: 'pending' | 'approved' | 'struck'; reviewReason: string | null;
  /** Why this business belongs to the population the design named, and the record it was read from. */
  qualifiedAt: string | null; qualifiedBecause: string | null; qualifiedSource: string | null;
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
  return (await rows('SELECT * FROM experiment_recipients WHERE experiment_id = ? ORDER BY created_at, rowid', [experimentId])).map((r) => ({
    id: String(r.id), experimentId: String(r.experiment_id), counterpartyRef: String(r.counterparty_ref),
    email: r.email == null ? null : String(r.email), channel: String(r.channel) as Recipient['channel'],
    sourceUrl: r.source_url == null ? null : String(r.source_url), reviewStatus: String(r.review_status) as Recipient['reviewStatus'],
    reviewReason: r.review_reason == null ? null : String(r.review_reason),
    qualifiedAt: r.qualified_at == null ? null : String(r.qualified_at),
    qualifiedBecause: r.qualified_because == null ? null : String(r.qualified_because),
    qualifiedSource: r.qualified_source == null ? null : String(r.qualified_source),
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

/** The owner's review of one candidate. The database re-verifies the reviewer. */
export async function reviewRecipient(input: {
  founderId: string; experimentId: string; recipientId: string; decision: 'approved' | 'struck'; reason?: string; email?: string;
}): Promise<void> {
  const email = input.email?.trim().toLowerCase();
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

export function checkOfferQuality(m: Material, pageUrl: string | null = null): { ok: boolean; failures: string[] } {
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
  if (!/one[- ]time/i.test(body) || !/no subscription/i.test(body)) failures.push('one-time and no-subscription are not both stated');
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
  /** structural_fact_kinds.fact → present, with grounds; written as the pass would, basis offer_shape. */
  facts: Record<string, { present: 0 | 1; grounds: string }>;
  price: OfferPrice;
  offerSubject: string;
}

export async function offerShapePlanOf(experimentId: string): Promise<OfferShapePlan | null> {
  const m = await materialOf(experimentId, 'offer_shape');
  if (!m) return null;
  try { return JSON.parse(m.body) as OfferShapePlan; } catch { return null; }
}

async function statedShapeAndFacts(e: ExperimentRow, productId: string, plan: OfferShapePlan): Promise<void> {
  const shaped = await stateOfferShape({ productId, by: HAND, shape: plan.shape });
  if ('refused' in shaped) throw new HandRefused('shape_refused', shaped.refused);
  await answerLighter({ opportunityId: e.opportunityId, answer: plan.lighter });
  for (const [fact, f] of Object.entries(plan.facts)) {
    const already = await one(`SELECT id FROM structural_facts WHERE subject_kind = 'company' AND subject_id = ? AND fact = ? AND superseded_at IS NULL`, [productId, fact]);
    if (already) continue;
    await query(
      `INSERT INTO structural_facts (id, founder_id, subject_kind, subject_id, fact, present, basis, grounds, recognised_by, evidence_mode)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [`sf_${nanoid(8)}`, e.founderId, 'company', productId, fact, f.present, 'offer_shape', f.grounds, HAND, e.evidenceMode]);
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
export async function allowExperiment(input: { founderId: string; experimentId: string; within?: Date }): Promise<{ productId: string; actId: string }> {
  const e = await experimentRow(input.experimentId);
  if (!e || e.founderId !== input.founderId) throw new HandRefused('experiment_not_found');
  if (e.decision !== null) throw new HandRefused('already_decided', e.decision);
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
  const { publicWorkshopOf } = await import('../public-workshop/settings.js');
  const paused = (await publicWorkshopOf(input.founderId))?.economicPause;
  if (paused) throw new HandRefused('workshop_paused', paused.reason);
  const by = `founder:${input.founderId}`;
  await decideExperiment({ experimentId: input.experimentId, decision: 'approved', by, via: 'its own authorisation' });
  const after = await experimentRow(input.experimentId);
  if (!after?.productId) throw new HandRefused('asset_missing');
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
  const hours = Math.max(24, Math.ceil(((input.within?.getTime() ?? Date.now() + 21 * 86_400_000) - Date.now()) / 3_600_000));
  // HIS STANDING WORD FOR THIS ASSET: nobody is written to from it without
  // asking him first. The one act he approves below is the answer, for exactly
  // the businesses he reviewed and the offer as written; a door that hears
  // this boundary and finds no such act refuses.
  await setBoundary({ productId: after.productId, subject: 'contact_people', mode: 'ask_first',
    statement: 'Ask me before writing to anyone for this test; the one act I approve when I allow it is the whole of it' });
  await setBoundary({ productId: after.productId, subject: 'publish', mode: 'ask_first',
    statement: 'Ask me before placing an offer anywhere for this test' });
  await setBoundary({ productId: after.productId, subject: 'move_money', mode: 'ask_first',
    statement: 'Ask me before moving money for this test; refunding a purchase that was not delivered or that the buyer returns is the one thing I allow' });
  // THE THREE ACTS ALLOWING IT IS. Each is exact: the campaign over the
  // businesses he reviewed and the offer as written; the payment link over its
  // precise parameters; the refund over purchases the provider reported at
  // this test's exposure and nothing else. The door resolves each from rows.
  const placementId = await proposeAct({
    productId: after.productId, subject: 'publish', actionType: 'stripe_create_payment_link',
    params: paymentLinkParams(input.experimentId, plan.price),
    summary: `Create the ${plan.price.currency.toUpperCase()} ${(plan.price.amountCents / 100).toFixed(2)} one-time payment link on your Stripe account, tagged for this test`,
    why: 'The offer needs one place a buyer can pay, and the tag is how a payment is known to belong to this test.',
    expectedEffect: 'A product, a one-time price and a payment link exist on the shared account; no money moves.', risk: 'None beyond a catalog object that can be deactivated.',
    consequence: 'low', rung: 'public', costCents: 0, proposedBy: HAND, validForHours: hours,
  });
  const placed = await bindActToExperiment({ actId: placementId, experimentId: input.experimentId, measurementCritical: true });
  if ('refused' in placed) throw new HandRefused('act_binding_refused', placed.refused);
  await decideProposedAct({ id: placementId, decision: 'approved', decidedBy: by });
  const refundId = await proposeAct({
    productId: after.productId, subject: 'move_money', actionType: 'stripe_create_refund',
    params: { experiment_id: input.experimentId, refunds: 'a purchase reported at this test\'s exposure whose delivery failed or whose buyer asked, in full' },
    summary: 'Refund, in full, any purchase of this test that could not be delivered or that the buyer returns',
    why: 'A buyer who did not get what they paid for is owed their money without waiting for you.',
    expectedEffect: 'The purchase amount returns to the buyer\'s card through your Stripe account.', risk: 'At most the purchases themselves; nothing of yours beyond what buyers paid.',
    consequence: 'medium', rung: 'financial', costCents: 0, proposedBy: HAND, validForHours: hours,
  });
  const refundable = await bindActToExperiment({ actId: refundId, experimentId: input.experimentId, measurementCritical: false });
  if ('refused' in refundable) throw new HandRefused('act_binding_refused', refundable.refused);
  await decideProposedAct({ id: refundId, decision: 'approved', decidedBy: by });
  const actId = await proposeAct({
    productId: after.productId, subject: 'contact_people', actionType: 'send_email',
    params: campaignParams(input.experimentId, approved, template),
    summary: `Write once to each of the ${approved.length} businesses you approved that the screening puts in this population${reachable.length > approved.length ? ` (${reachable.length - approved.length} more you approved carry no recorded grounds and are not covered)` : ''}, in your name, offering ${plan.price.productName} at $${(plan.price.amountCents / 100).toFixed(2)} one-time`,
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
  if (!standing) return { done: false, reason: 'nothing to take down' };
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
  // Every act allowing it carried: the campaign, the placement, the refunds.
  for (const a of await rows(`SELECT id FROM proposed_acts WHERE experiment_id = ? AND decision = 'approved' AND revoked_at IS NULL`, [input.experimentId])) {
    await revokeApproval(String(a.id), reason);
  }
  if (e.productId) await retireExperimentalAsset({ productId: e.productId, because: `you stopped it: ${reason}` });
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
    return { status: 'not_connected', fromLine: null, detail: `Tests write as ${w.operatorName} — ${w.publicName} <${w.contactEmail}>; the connected address is ${identity.fromEmail}. Connect the Workshop's sending from the Workshop page.`, identityProductId };
  }
  const fromLine = identity.fromName ? `${identity.fromName} <${identity.fromEmail}>` : identity.fromEmail;
  return { status: 'ready', fromLine, detail: `Ready. Messages go out as ${fromLine}${identity.lastAcceptedAt ? '; the provider has accepted mail from it before' : '; not yet used'}.`, identityProductId };
}

export async function readiness(experimentId: string): Promise<Readiness> {
  const e = await experimentRow(experimentId);
  if (!e) throw new HandRefused('experiment_not_found');
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
  if (sending.status !== 'ready') missing.push('email sending is not connected');
  if (!(await materialOf(experimentId, 'deliverable'))) missing.push('nothing to deliver is attached');
  if (!(await materialOf(experimentId, 'offer_template'))) missing.push('the offer text is not written');
  if (!(await offerShapePlanOf(experimentId))) missing.push('the offer has no stated shape');
  // WHAT THE WORKSHOP NEEDS before a stranger can be written to under its name.
  const { publicWorkshopOfExperiment } = await import('../public-workshop/settings.js');
  const w = await publicWorkshopOfExperiment(experimentId);
  if (w) {
    if (!(await one('SELECT experiment_id FROM public_experiments WHERE experiment_id = ?', [experimentId]))) missing.push('the experiment has no public page identity');
    if (!w.postalAddress) missing.push('the Workshop has no postal address for commercial mail');
    if (w.economicPause) missing.push('new economic activity is paused');
  }
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
  const failures = [...report.failed.map((f) => `${f.path}: ${f.reason}`), ...report.unverified];
  return { ...placed, pageUrl, published: failures.length === 0, failures };
}

/** A link the owner made by hand: held to the same contract, then placed. */
export async function attachPaymentLinkByUrl(input: { experimentId: string; url: string }): Promise<{ ok: true } | { refused: string }> {
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
  const { postalLines, publicWorkshopOfExperiment } = await import('../public-workshop/settings.js');
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
  const quality = checkOfferQuality(offer, w ? await pageUrlFor(input.experimentId) : null);
  if (!quality.ok) throw new HandRefused('offer_quality', quality.failures.join('; '));
  const replyTo = await replyAddressFor(e.productId, e.founderId);
  // Every message carries who is writing, from where, and how to stop it.
  const footer = w ? `\n\n—\n${w.publicName} is a small digital workshop run by ${w.operatorName}.${w.postalAddress ? ` ${postalLines(w.postalAddress).join(', ')}.` : ''}\nTo hear nothing further from ${w.publicName}: ${w.origin}/email` : '';
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
  const quality = checkDeliverableQuality(deliverable, input.now ?? new Date());
  if (!quality.ok) throw new HandRefused('deliverable_quality', quality.failures.join('; '));
  const buyer = await buyerAddressFor(String(f.payment_ref));
  if (!buyer) throw new HandRefused('buyer_address_unknown', String(f.payment_ref));
  const replyTo = await replyAddressFor(e.productId, e.founderId);
  const intro = `Thanks for buying the ${deliverable.title} — it's below. It's a shortlist with a link to each original notice, not a complete listing of the market. If it's no use to you, [ask for your money back here](${refundLinkFor(String(f.id))}) and it's refunded in full; replying to this message works just as well.\n\n---\n\n`;
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
  const live = !!e && (isLive(e, !!x && x.withdrawnAt !== null) || owed) && (await campaignIsLive(experimentId));
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
  const charge = f.charge_ref == null ? null : String(f.charge_ref);
  if (!charge) return { issued: false, refusedReason: 'charge_unknown' };
  await query(`UPDATE experiment_fulfilments SET refund_requested_at = COALESCE(refund_requested_at, datetime('now')), updated_at = datetime('now') WHERE id = ?`, [input.fulfilmentId]);
  // The door charges the buyer's weekly communication budget before the
  // handler runs, and the clean-hands handler refuses without touching money;
  // a refusal Foundry can foresee must not spend the unit the refund needs.
  if (process.env.FOUNDRY_ENABLE_MONEY_TOOLS !== 'true') return { issued: false, refusedReason: 'policy: Foundry does not move money by default (FOUNDRY_ENABLE_MONEY_TOOLS is off)' };
  const result = await invoke({
    productId: String(f.product_id), tool: 'stripe_create_refund', action: `refund ${String(f.payment_ref)}: ${input.reason}`,
    params: { charge_id: charge, amount: Number(f.amount_cents), reason: 'requested_by_customer' },
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
  const result = await refundFulfilment({ fulfilmentId, reason: 'buyer asked through the delivery link' });
  return { status: result.issued ? 'refunded' : 'could_not', view };
}

// ── The cycle ────────────────────────────────────────────────────────────────

export interface HandReport { experimentId: string; offersPlanned: number; offersSent: number; deliveriesSent: number; reconciled: number; refundsIssued: number; settled: string | null; exceptions: string[] }

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
      WHERE e.decision = 'approved' AND e.ran_at IS NULL AND e.validity = 'valid' AND e.evidence_mode = 'real'
        ${input.founderId ? 'AND e.founder_id = ?' : ''}
        AND EXISTS (SELECT 1 FROM proposed_acts a WHERE a.experiment_id = e.id AND coalesce(a.measurement_critical, 0) = 1
                      AND a.decision = 'approved' AND a.revoked_at IS NULL AND datetime(a.expires_at) > datetime('now'))
      ORDER BY e.decided_at, e.rowid`, input.founderId ? [input.founderId] : []);
  const reports: HandReport[] = [];
  for (const row of live) {
    const experimentId = String(row.id);
    const report: HandReport = { experimentId, offersPlanned: 0, offersSent: 0, deliveriesSent: 0, reconciled: 0, refundsIssued: 0, settled: null, exceptions: [] };
    reports.push(report);
    const e = await experimentRow(experimentId);
    if (!e?.productId) { report.exceptions.push('no asset'); continue; }

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
  }

  // WHAT IS OWED OUTLIVES THE TEST. A purchase that arrived as the test settled
  // or was stopped is still a purchase: delivered if the acts allowing it
  // stand, refunded if the offer was withdrawn before delivery, and a link the
  // provider has not yet taken down is tried again.
  const aftermath = await rows(
    `SELECT e.id FROM venture_experiments e
      WHERE e.decision = 'approved' AND e.evidence_mode = 'real' ${input.founderId ? 'AND e.founder_id = ?' : ''}
        AND e.id NOT IN (${live.map(() => '?').join(',') || "''"})
        AND (EXISTS (SELECT 1 FROM experiment_fulfilments f WHERE f.experiment_id = e.id AND f.status IN ('owed','sent','failed'))
          OR EXISTS (SELECT 1 FROM experiment_exposures x WHERE x.experiment_id = e.id AND x.withdrawn_at IS NOT NULL AND datetime(x.withdrawn_at) > datetime('now', '-7 days')))
      ORDER BY e.decided_at, e.rowid`, [...(input.founderId ? [input.founderId] : []), ...live.map((r) => String(r.id))]);
  for (const row of aftermath) {
    const experimentId = String(row.id);
    const report: HandReport = { experimentId, offersPlanned: 0, offersSent: 0, deliveriesSent: 0, reconciled: 0, refundsIssued: 0, settled: null, exceptions: [] };
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
  const r = await publishSite(w.founderId, HAND).catch((err: unknown) => ({ failed: [{ path: '*', reason: err instanceof Error ? err.message : String(err) }], unverified: [] as string[] }));
  for (const f of r.failed) report?.exceptions.push(`public record not updated: ${f.path}: ${f.reason}`);
  for (const u of r.unverified) report?.exceptions.push(`public record not seen: ${u}`);
}

/** Deliveries for what is owed, receipts, refunds of what failed or was withdrawn. */
async function carryWhatIsOwed(experimentId: string, now: Date, report: HandReport, deliveryStatus?: (productId: string, messageId: string) => Promise<DeliveryStatus>): Promise<void> {
  const e = await experimentRow(experimentId);
  const x = await exposureOf(experimentId);
  // Owed under a withdrawn offer that never settled: the owner stopped it, and
  // a purchase that slipped in is returned rather than fulfilled.
  const withdrawnBeforeSettlement = !!e && e.ranAt === null && !!x && x.withdrawnAt !== null;
  for (const f of await rows(`SELECT id, payment_ref FROM experiment_fulfilments WHERE experiment_id = ? AND status = 'owed' ORDER BY created_at, rowid`, [experimentId])) {
    if (withdrawnBeforeSettlement) {
      const r = await refundFulfilment({ fulfilmentId: String(f.id), reason: 'the offer was withdrawn before delivery' });
      if (r.issued) { report.refundsIssued += 1; await query(`UPDATE experiment_fulfilments SET status = 'refunded', updated_at = datetime('now') WHERE id = ? AND status = 'owed'`, [String(f.id)]); }
      else report.exceptions.push(`refund for ${String(f.payment_ref)} (offer withdrawn): ${r.refusedReason}`);
      continue;
    }
    try {
      const plan = await planDelivery({ experimentId, fulfilmentId: String(f.id), now });
      if (plan.status !== 'pending_approval') continue;
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

  // A failed delivery is refunded; a refund that cannot be issued is the owner's.
  for (const f of await rows(`SELECT id FROM experiment_fulfilments WHERE experiment_id = ? AND status = 'failed' AND refund_ref IS NULL`, [experimentId])) {
    const r = await refundFulfilment({ fulfilmentId: String(f.id), reason: 'the brief could not be delivered' });
    if (r.issued) report.refundsIssued += 1; else report.exceptions.push(`refund for ${String(f.id)}: ${r.refusedReason}`);
  }
}

/** What Foundry cannot carry for a live experiment, in the owner's words. */
export async function handExceptions(experimentId: string): Promise<string[]> {
  const out: string[] = [];
  const e = await experimentRow(experimentId);
  // A settled or stopped test can still owe a buyer something; those lines stay.
  if (!e || e.decision !== 'approved') return out;
  const failedDeliveries = await rows(`SELECT id, payment_ref, refund_ref, refund_requested_at FROM experiment_fulfilments WHERE experiment_id = ? AND status = 'failed' AND refund_ref IS NULL`, [experimentId]);
  for (const f of failedDeliveries) out.push(`A buyer paid (${String(f.payment_ref)}) but the brief could not be delivered and the refund did not go through. This needs you: check the money-tools setting or refund it yourself.`);
  const asked = await rows(`SELECT id, payment_ref FROM experiment_fulfilments WHERE experiment_id = ? AND refund_requested_at IS NOT NULL AND refund_ref IS NULL AND status <> 'failed'`, [experimentId]);
  for (const f of asked) out.push(`A buyer asked for a refund through the delivery link (payment ${String(f.payment_ref)}) and I could not issue it. This needs you: check the money-tools setting or refund it yourself.`);
  const rejected = await rows(`SELECT preview_text, result_json FROM outbound_actions WHERE experiment_id = ? AND status = 'rejected' ORDER BY created_at DESC LIMIT 3`, [experimentId]);
  for (const r of rejected) out.push(`${String(r.preview_text)} was refused by my own rules and not sent: ${String((JSON.parse(String(r.result_json ?? '{}')) as { reason?: string; refused?: string }).reason ?? (JSON.parse(String(r.result_json ?? '{}')) as { refused?: string }).refused ?? 'see the door')}.`);
  return out;
}
