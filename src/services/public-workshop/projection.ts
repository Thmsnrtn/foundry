// =============================================================================
// FOUNDRY — The public-safe projection of an experiment.
//
// A public page is a projection of canonical rows, not a second truth. This is
// the one boundary the rows cross on their way to the world, and it is an
// ALLOWLIST: a field reaches the public shape only by being named here, in
// public words, and nothing else about the experiment is reachable from the
// renderer. What never crosses: who was written to, what was predicted, what
// was spent or allowed, which acts stand, what the provider's references are,
// what the owner noted, and any identifier of anything private.
//
// `privateStringsOf` gathers what must not appear so a test can hold every
// rendered page against it. The projection and the check are two halves of
// one boundary and live together on purpose.
// =============================================================================
import { query, realCompany } from '../../db/client.js';
import { publicPostalLines, publicWorkshopOfExperiment } from './settings.js';
import type { PublicWorkshop } from './settings.js';
import type { PublicShape } from './how-it-should-show.js';

export type PublicStatus = 'preparing' | 'testing' | 'operating' | 'graduated' | 'closed';

export interface PublicExperiment {
  number: number; slug: string; path: string; listed: boolean;
  title: string; summary: string; who: string; what: string; limits: string; sources: string; selection: string; note: string;
  /** An excerpt of what a buyer actually receives, when the thing has one. */
  sample: string | null;
  status: PublicStatus; statusLabel: string; statusLine: string; outcome: string | null;
  /**
   * WHERE A CUSTOMER ACTUALLY GETS IT, when that is somewhere else.
   *
   * Deliberately NOT `payUrl`, which is suppressed unless the test is still
   * running, and deliberately not `graduatedTo`, which overrides the status and
   * says "now its own business". This is the one thing a portfolio entry has to
   * carry that a product page does not: the address of the venue that takes the
   * money. Null for everything sold here.
   */
  whereToGetIt: { url: string; venueName: string } | null;
  /** The shape this record is published at, from `howItShouldShow`. */
  shape: PublicShape;
  /**
   * A dated later finding, added beneath the record without changing a word of
   * it. Null for every test that has none, which is all of them but one.
   */
  clarification: { on: string; text: string } | null;
  price: { amountCents: number; currency: string; label: string } | null;
  recurring: false;
  payUrl: string | null;
  openedOn: string | null; closedOn: string | null; updatedOn: string;
  supersedes: { slug: string; title: string } | null;
  successor: { slug: string; title: string } | null;
  graduatedTo: string | null;
}

/** The fields the public shape carries, as a record the tests can read. */
export const PUBLIC_EXPERIMENT_FIELDS = [
  'number', 'slug', 'path', 'listed', 'title', 'summary', 'who', 'what', 'limits', 'sources', 'selection', 'note', 'sample',
  'status', 'statusLabel', 'statusLine', 'outcome', 'clarification', 'whereToGetIt', 'shape', 'price', 'recurring', 'payUrl', 'openedOn', 'closedOn', 'updatedOn', 'supersedes', 'successor', 'graduatedTo',
] as const;

type Row = Record<string, unknown>;
const rows = async (sql: string, params: unknown[]): Promise<Row[]> => (await query(sql, params)).rows as unknown as Row[];
const day = (s: unknown): string | null => s == null ? null : String(s).slice(0, 10);
/**
 * THE WORD A STRANGER READS, WHICH IS NOT THE WORD THE INSTITUTION FILES UNDER.
 *
 * A live one is a `testing` row here and a PILOT to the person reading the page.
 * Both are true and they are not interchangeable: "pilot" says a real first run
 * that may or may not continue, which is exactly what this is, while "testing"
 * invites a reader to think they are the thing being tested. They are not — the
 * service is. The number and the record stay; the label stops implying that the
 * customer is the subject.
 */
export const STATUS_LABELS: Record<PublicStatus, string> = { preparing: 'Not open yet', testing: 'Pilot', operating: 'Open', graduated: 'Now its own business', closed: 'Closed' };

function money(cents: number, currency: string): string {
  return currency.toUpperCase() === 'USD' ? `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}` : `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

/** The public shape of one experiment, or null when it has no public identity. */
export async function projectExperiment(experimentId: string): Promise<PublicExperiment | null> {
  const r = (await rows(
    `SELECT w.*, e.decision, e.ran_at, e.verdict, e.validity, e.decided_at,
            x.placed_at, x.withdrawn_at,
            -- REALITY BOUNDED, because this is read by strangers as truth. An
            -- experiment only reads as Operating when what it made is a real
            -- company that earned its standing; a rehearsal's synthetic asset
            -- must never describe itself to the public as a going concern.
            (SELECT p.standing FROM products p WHERE p.from_experiment_id = e.id AND p.deleted_at IS NULL AND p.status = 'active'
               AND ${realCompany('p')}) AS asset_standing,
            (SELECT m.payment_link_url FROM experiment_materials m WHERE m.experiment_id = e.id AND m.kind = 'offer' AND m.superseded_at IS NULL) AS pay_url,
            (SELECT m.body FROM experiment_materials m WHERE m.experiment_id = e.id AND m.kind = 'offer_shape' AND m.superseded_at IS NULL) AS shape_json,
            (SELECT s.slug FROM public_experiments s WHERE s.experiment_id = w.supersedes_experiment_id) AS supersedes_slug,
            (SELECT s.public_title FROM public_experiments s WHERE s.experiment_id = w.supersedes_experiment_id) AS supersedes_title,
            (SELECT s.slug FROM public_experiments s WHERE s.supersedes_experiment_id = w.experiment_id ORDER BY s.number LIMIT 1) AS successor_slug,
            (SELECT s.public_title FROM public_experiments s WHERE s.supersedes_experiment_id = w.experiment_id ORDER BY s.number LIMIT 1) AS successor_title,
            (SELECT max(p.published_at) FROM public_publications p WHERE p.experiment_id = w.experiment_id) AS last_published
       FROM public_experiments w JOIN venture_experiments e ON e.id = w.experiment_id
       LEFT JOIN experiment_exposures x ON x.experiment_id = e.id AND x.id = (SELECT id FROM experiment_exposures WHERE experiment_id = e.id ORDER BY placed_at DESC, rowid DESC LIMIT 1)
      WHERE w.experiment_id = ?`, [experimentId]))[0];
  if (!r) return null;

  // Status, from canonical state. 'operating' is an asset that earned its
  // standing; 'graduated' an owner-recorded independent identity; 'closed'
  // everything that ended; 'testing' an approved test that is still running.
  const withdrawn = r.withdrawn_at != null;
  const ended = r.ran_at != null || withdrawn || String(r.validity) !== 'valid' || String(r.decision ?? '') === 'declined';
  let status: PublicStatus;
  if (r.graduated_to_url != null) status = 'graduated';
  // Operating means somebody can still buy it: an asset that earned its
  // standing AND an offer still standing. An earned asset whose offer came
  // down is a test that ended well, not a product on sale, and saying
  // otherwise over a dead link would be the page lying politely.
  else if (String(r.asset_standing ?? '') === 'earned' && !withdrawn) status = 'operating';
  else if (ended) status = 'closed';
  else if (String(r.decision ?? '') === 'approved') status = 'testing';
  else status = 'preparing';

  // HOW MUCH OF ITSELF THIS SHOULD SHOW, and where a customer actually gets it.
  //
  // Read once, here, at the projection boundary — the same place the private
  // rows stop and public facts begin — so no renderer downstream has to decide
  // it and none of them can disagree about it.
  const { howItShouldShow } = await import('./how-it-should-show.js');
  const shown = await howItShouldShow(experimentId);
  const shape = shown.shape;
  const { offerShapePlanOf } = await import('../venture/hand.js');
  const plan = await offerShapePlanOf(experimentId);
  const listingRef = (shape === 'portfolio_entry' || shape === 'identity_only') && plan?.listing
    ? (await rows(
      `SELECT exposure_ref FROM experiment_exposures
        WHERE experiment_id = ? AND provider = ? AND withdrawn_at IS NULL
        ORDER BY placed_at DESC, rowid DESC LIMIT 1`,
      [experimentId, plan.listing.venue]))[0]
    : undefined;
  // A TAKEN-DOWN LISTING IS NOT A PLACE TO SEND ANYBODY. The rule four
  // paragraphs down has always held for the Workshop's own link — "a closed
  // test's link is down and the page says so rather than pointing at it" — and
  // the first version of this did not hold the venue's link to it. A review
  // walked it: a "Closed" pill above a live green button pointing at a delisted
  // URL, under a sentence promising the venue would take the payment.
  const whereToGetIt = listingRef && plan?.listing
    ? { url: String(listingRef.exposure_ref), venueName: plan.listing.venueName }
    : null;

  const outcome = r.public_outcome == null ? null : String(r.public_outcome);
  const clarified = r.public_clarification != null;
  // A CORRECTED RECORD DOES NOT LOSE THE RESULT IT CORRECTS.
  //
  // The status line is computed from OTHER tables — the asset's standing and
  // the experiment's verdict — so it is not frozen by the rule that freezes the
  // record's own columns. A review cell walked it: mark the asset earned and a
  // clarified, failed test renders "Operating — this remains a small Apex Micro
  // product", with the recorded outcome not merely moved but DISCARDED, because
  // only the `closed` branch ever reads it.
  //
  // The transition itself is the owner's to make and stays his. What may not
  // happen is a page that carries a dated correction about a result while the
  // result itself has been dropped off it.
  const statusLine = clarified && outcome !== null ? outcome
    : status === 'graduated' ? `Graduated — this experiment now operates independently.`
    : status === 'operating' ? 'Operating — this remains a small Apex Micro product.'
      : status === 'closed' ? (outcome ?? (r.ran_at != null
        ? (String(r.verdict) === 'as_predicted'
          ? 'Closed — the pilot ran and the thesis held. It is not on sale at the moment.'
          : 'Closed — the pilot ran and the thesis did not hold.')
        : 'Closed — stopped before it settled.'))
        : status === 'testing' ? 'Open now — the first run of this, so it may or may not continue.'
          : 'Not offered to anyone yet.';

  // A PORTFOLIO ENTRY CARRIES NO PRICE PAST THIS BOUNDARY.
  //
  // The offer of a listing obviously HAS a price — it is on the venue's page,
  // where it belongs. What must not happen is Apex Micro restating it: the
  // owner's boundary is that Foundry publishes no offer for it, and a number on
  // this site is an offer whatever heading it sits under. It would also go
  // stale the moment he edits the listing, so the site would be quoting a price
  // the venue no longer charges.
  //
  // Enforced HERE rather than trusted to the renderer, because the projection
  // is the allowlist boundary: what a renderer is never handed, it cannot leak.
  let price: PublicExperiment['price'] = null;
  if (r.shape_json != null) {
    try {
      const shape = JSON.parse(String(r.shape_json)) as { price?: { amountCents?: number; currency?: string } };
      if (shape.price?.amountCents && shape.price.currency) price = { amountCents: shape.price.amountCents, currency: shape.price.currency, label: `${money(shape.price.amountCents, shape.price.currency)}, one time` };
    } catch { price = null; }
  }
  const slug = String(r.slug);
  return {
    number: Number(r.number), slug, path: `/experiments/${slug}`, listed: Number(r.listed) === 1,
    title: String(r.public_title), summary: String(r.public_summary), who: String(r.public_who), what: String(r.public_what),
    limits: String(r.public_limits), sources: String(r.public_sources), selection: String(r.public_selection), note: String(r.public_note),
    sample: r.public_sample == null || String(r.public_sample).trim() === '' ? null : String(r.public_sample),
    status, statusLabel: STATUS_LABELS[status], statusLine, outcome,
    whereToGetIt, shape,
    clarification: r.public_clarification == null || r.public_clarification_at == null ? null
      : { on: String(r.public_clarification_at), text: String(r.public_clarification) },
    price: shape === 'portfolio_entry' || shape === 'identity_only' ? null : price, recurring: false,
    // The way to pay is public only while the offer stands; a closed test's
    // link is down and the page says so rather than pointing at it.
    payUrl: shape === 'portfolio_entry' || shape === 'identity_only' ? null
      : status === 'testing' && !withdrawn && r.pay_url != null ? String(r.pay_url) : null,
    openedOn: day(r.placed_at) ?? day(r.decided_at), closedOn: ended ? (day(r.ran_at) ?? day(r.withdrawn_at) ?? day(r.updated_at)) : null,
    updatedOn: day(r.last_published) ?? day(r.updated_at) ?? day(r.created_at) ?? '',
    supersedes: r.supersedes_slug == null ? null : { slug: String(r.supersedes_slug), title: String(r.supersedes_title) },
    successor: r.successor_slug == null ? null : { slug: String(r.successor_slug), title: String(r.successor_title) },
    graduatedTo: r.graduated_to_url == null ? null : String(r.graduated_to_url),
  };
}

/** Every experiment with a public identity, by number. The registry lists
 * only the listed ones; unlisted pages still resolve at their address. */
export async function projectRegistry(founderId: string): Promise<PublicExperiment[]> {
  const ids = await rows('SELECT experiment_id FROM public_experiments WHERE founder_id = ? ORDER BY number', [founderId]);
  const out: PublicExperiment[] = [];
  for (const r of ids) { const p = await projectExperiment(String(r.experiment_id)); if (p) out.push(p); }
  return out;
}

export interface PublicWorkshopFacts {
  name: string;
  /**
   * THE OWNER IS NOT A PUBLIC FIGURE. Assets speak for themselves and the
   * Workshop is the voice; this name appears on exactly one public surface,
   * the terms page, where the law wants to know who is behind a trading name.
   * Nothing else renders it, and a gate holds that.
   */
  legalOperator: string; origin: string; tagline: string; statement: string; about: string;
  contactEmail: string; postalAddress: string | null; region: string;
  /**
   * WHETHER THE REPLY ROUTE HAS BEEN PROVEN TO WORK, by a message actually
   * arriving at the advertised address rather than by a routing rule existing.
   *
   * The pages carry a sentence — "Replies to anything I send come straight
   * back to me" — which was rendered on every experiment page including the
   * one whose nineteen recipients could not reach anybody. It was false, and
   * nothing in the institution was in a position to know it was false. A
   * public claim is now bound to the evidence for it: where the route is not
   * proven, the sentence is simply not made. Nothing is published in its
   * place; an institution that cannot show something says nothing about it.
   */
  replyRouteProven: boolean;
}

export function workshopFacts(w: PublicWorkshop, opts: { replyRouteProven?: boolean } = {}): PublicWorkshopFacts {
  return {
    // FALSE UNLESS SHOWN OTHERWISE. A caller that has not read the evidence
    // does not get the claim by default, which is the right direction for a
    // default to fail in.
    replyRouteProven: opts.replyRouteProven === true,
    name: w.publicName, legalOperator: w.operatorName, origin: w.origin, tagline: 'a small digital workshop in Massachusetts',
    statement: w.statement, about: w.about, contactEmail: w.contactEmail,
    // THE NAME COMES OFF HERE, at the one boundary where the record becomes
    // public facts — so no renderer downstream can put it back by accident.
    // `site.ts` never sees it and needs no rule of its own.
    postalAddress: publicPostalLines(w).join('\n') || null,
    region: 'Massachusetts',
  };
}

export async function workshopFactsOfExperiment(experimentId: string): Promise<PublicWorkshopFacts | null> {
  const w = await publicWorkshopOfExperiment(experimentId);
  return w ? workshopFacts(w) : null;
}

/**
 * WHAT MUST NEVER APPEAR ON A PUBLIC PAGE, gathered from the rows: every
 * private identifier and every private text near the experiment. A page is
 * held against this list before it is published and again in the tests.
 */
export async function privateStringsOf(experimentId: string): Promise<string[]> {
  const { offerShapePlanOf } = await import('../venture/hand.js');
  const out = new Set<string>();
  const e = (await rows('SELECT id, founder_id, opportunity_id, unknown_id, claim_id, what_we_expect, would_disprove, decided_by FROM venture_experiments WHERE id = ?', [experimentId]))[0];
  if (!e) return [];
  for (const k of ['id', 'founder_id', 'opportunity_id', 'unknown_id', 'claim_id', 'what_we_expect', 'would_disprove', 'decided_by']) if (e[k] != null && String(e[k]).length >= 5) out.add(String(e[k]));
  for (const r of await rows('SELECT id, counterparty_ref, email, source_url, review_reason FROM experiment_recipients WHERE experiment_id = ?', [experimentId])) {
    for (const k of ['id', 'counterparty_ref', 'email', 'source_url', 'review_reason']) if (r[k] != null && String(r[k]).length >= 6) out.add(String(r[k]));
  }
  for (const f of await rows('SELECT id, payment_ref, charge_ref, refund_ref FROM experiment_fulfilments WHERE experiment_id = ?', [experimentId])) {
    for (const k of ['id', 'payment_ref', 'charge_ref', 'refund_ref']) if (f[k] != null) out.add(String(f[k]));
  }
  for (const a of await rows('SELECT id, params_fingerprint FROM proposed_acts WHERE experiment_id = ?', [experimentId])) {
    for (const k of ['id', 'params_fingerprint']) if (a[k] != null && String(a[k]).length >= 5) out.add(String(a[k]));
  }
  // DELIBERATELY NOT SCOPED, AND SCOPING IT WOULD BE THE DEFECT. Everywhere
  // else a reference company must be kept out of owner truth; here the job is
  // to collect every string that must never reach a public page, and a
  // rehearsal asset's id is exactly as unpublishable as a real one's. Narrowing
  // this query would make the secret list SHORTER, which is the one direction
  // a secret list must never move.
  for (const p of await rows('SELECT id, name FROM products WHERE from_experiment_id = ?', [experimentId])) out.add(String(p.id));
  // AN EXPOSURE'S REFERENCE IS PRIVATE, WITH ONE NAMED EXCEPTION.
  //
  // Every `exposure_ref` used to go in here without looking at what it was, and
  // that is right for the thing it was written for: a Stripe payment-link id is
  // a private handle on a live checkout and must never appear on a page, by any
  // path, ever. It is wrong for the other kind. A listing the OWNER placed
  // himself on a public venue is already public — it is a URL he published, on
  // a site anybody can read, and the whole point of a portfolio entry is to
  // point at it. Treating it as a secret meant the page carrying it would be
  // silently skipped at publication rather than published.
  //
  // So the exception is narrow and keyed to the offer's own declared venue,
  // not to a guess about what the string looks like: only the reference placed
  // at the venue this offer says it is listed on, and only when the offer
  // declares a listing at all. Everything else stays private, including every
  // exposure of an offer the Workshop carries itself.
  const listingVenue = (await offerShapePlanOf(experimentId))?.listing?.venue ?? null;
  for (const x of await rows('SELECT id, exposure_ref, provider FROM experiment_exposures WHERE experiment_id = ?', [experimentId])) {
    out.add(String(x.id));
    if (listingVenue !== null && String(x.provider) === listingVenue) continue;
    out.add(String(x.exposure_ref));
  }
  for (const a of await rows('SELECT id, effect_id FROM outbound_actions WHERE experiment_id = ?', [experimentId])) { out.add(String(a.id)); if (a.effect_id != null) out.add(String(a.effect_id)); }
  for (const f of await rows('SELECT email FROM founders WHERE id = ?', [String(e.founder_id)])) if (f.email != null) out.add(String(f.email));
  return [...out];
}

/** The first private string found in a rendered page, or null. */
export function leakIn(html: string, privateStrings: string[]): string | null {
  const lower = html.toLowerCase();
  for (const s of privateStrings) if (s && lower.includes(s.toLowerCase())) return s;
  if (/\b(pi|ch|cs|plink|re|cus|sub)_[A-Za-z0-9]{8,}\b/.test(html)) return 'a provider reference';
  return null;
}
