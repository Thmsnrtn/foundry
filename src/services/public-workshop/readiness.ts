// =============================================================================
// THE WHOLE CHAIN, CHECKED AGAINST THE WORLD RATHER THAN AGAINST OURSELVES.
//
// A provider returning 200 is not proof that a stranger can read a page. A row
// saying "published" is not proof either. The only evidence that the outside
// of this institution works is the outside of this institution answering, over
// public HTTPS, with the bytes we believe we put there — and where that
// evidence cannot exist yet, this says so in those words rather than reporting
// the nearest green thing it can find.
//
// Four honest answers, and no fifth:
//
//   verified  — observed from the public internet, just now
//   ready     — true, but established privately (a row, a provider's answer)
//   waiting   — legitimately not done yet, and what it waits for
//   blocked   — cannot be done until somebody supplies something
//
// `waiting` matters most. The experiment's own public page is published when
// the owner allows the test, and that is deliberate: putting an offer page for
// an unapproved experiment on the internet would be the premature public act
// the whole design exists to prevent. So its leg reads `waiting`, and the same
// machinery is proven end to end against the rehearsal experiment instead.
// =============================================================================

import { query } from '../../db/client.js';
import { publicWorkshopOf } from './settings.js';
import { livePublications, pageUrlFor, publicationGate, verifyPublication, cloudflareConfigured } from './publication.js';
import { projectExperiment, workshopFacts, leakIn, privateStringsOf } from './projection.js';

export type LegStatus = 'verified' | 'ready' | 'waiting' | 'blocked';
export interface Leg { leg: string; status: LegStatus; detail: string; evidence?: string }
export interface ExternalReadiness {
  founderId: string; experimentId: string; pageUrl: string | null; checkedAt: string;
  legs: Leg[];
  verified: number; ready: number; waiting: number; blocked: number;
  /** True only when nothing is blocked and nothing that can be observed is unobserved. */
  ok: boolean;
}

const one = async (sql: string, params: unknown[] = []): Promise<Record<string, unknown> | undefined> =>
  (await query(sql, params)).rows[0] as unknown as Record<string, unknown> | undefined;

/** A public GET, from outside, with the status and a fingerprint of what came back. */
async function look(url: string, fetchImpl: typeof fetch): Promise<{ ok: boolean; status: number; body: string; detail: string }> {
  try {
    const r = await fetchImpl(url, { redirect: 'follow' });
    const body = await r.text();
    return { ok: r.ok, status: r.status, body, detail: `HTTP ${r.status}, ${body.length} bytes` };
  } catch (e) {
    return { ok: false, status: 0, body: '', detail: `no answer: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function externalReadiness(
  founderId: string, experimentId: string, opts: { fetchImpl?: typeof fetch } = {},
): Promise<ExternalReadiness> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const legs: Leg[] = [];
  const say = (leg: string, status: LegStatus, detail: string, evidence?: string) => { legs.push({ leg, status, detail, evidence }); };
  const w = await publicWorkshopOf(founderId);
  const pageUrl = w ? await pageUrlFor(experimentId) : null;

  // 1 ─ The canonical probe: a real experiment, undecided, with its thinking recorded.
  const e = await one(
    `SELECT e.id, e.decision, e.evidence_mode, e.ran_at FROM venture_experiments e WHERE e.id = ? AND e.founder_id = ?`,
    [experimentId, founderId]);
  if (!e) { say('canonical probe', 'blocked', 'no such experiment for this owner'); }
  else {
    const { designOf, designStandsInTheWay } = await import('../venture/probe-design.js');
    const d = await designOf(experimentId);
    const inTheWay = await designStandsInTheWay(experimentId);
    if (!d) say('canonical probe', 'blocked', 'no deliberation is recorded; the thinking comes before the decision');
    else if (inTheWay.length) say('canonical probe', 'blocked', inTheWay.join('; '));
    else {
      say('canonical probe', 'ready',
        `${String(e.evidence_mode)} experiment, ${e.decision == null ? 'undecided' : String(e.decision)}, deliberation recorded ${d.designedAt.slice(0, 10)}${d.amendedAt ? ` and narrowed ${d.amendedAt.slice(0, 10)}` : ''}, ${d.sealedAt ? 'sealed' : 'unsealed'}`,
        `recommendation: ${d.recommendation}`);
    }
  }

  if (!w) {
    say('public Workshop', 'blocked', 'no public Workshop exists for this owner');
    return tally(founderId, experimentId, pageUrl, legs);
  }

  // 2 ─ The projection: what a stranger would be shown, and nothing else.
  const x = await projectExperiment(experimentId);
  if (!x) say('public-safe projection', 'waiting', 'the experiment has no public identity yet (number, slug, public copy)');
  else {
    const { renderExperiment } = await import('./site.js');
    const html = renderExperiment(workshopFacts(w), x);
    const leak = leakIn(html, await privateStringsOf(experimentId));
    if (leak) say('public-safe projection', 'blocked', `a private value would appear on the page (${leak.slice(0, 12)}…)`);
    else say('public-safe projection', 'ready', `${html.length} bytes, no private value present`, `/experiments/${x.slug}`);

    // 6 ─ What the page states about the offer, checked against the render itself.
    const states: string[] = [];
    if (!x.price) states.push('no price');
    // The commitment, not one sentence of it — the same reading the publication
    // gate uses, so the two cannot disagree about whether the page is honest.
    if (!/\bno subscription\b|\bnot a subscription\b/i.test(html)) states.push('no plain statement that there is no subscription');
    if (!x.limits) states.push('no stated limitations');
    say('sealed offer, price and limitations', states.length ? 'blocked' : 'ready',
      states.length ? states.join('; ') : `${x.price?.label ?? '—'}, one-time, with stated coverage limits`);

    // 6b ─ HOW OLD THE GOODS ARE, said before they are sold rather than after.
    //
    // The thing being sold here is a dated document about things with deadlines.
    // Every day between the day it was assembled and the day it is sent takes
    // value out of it, and nothing in the machinery noticed: the page could be
    // green, the payment link live, the sender verified, and the brief three
    // weeks stale with half its notices already opened. That is not a copy
    // problem — the page says plainly that it is a dated edition — it is a fact
    // about the owner's own goods that he is owed at the moment he decides to
    // sell them, which is here.
    //
    // Fourteen days because public bid notices commonly run two to four weeks
    // from posting to opening: past a fortnight, a meaningful share of any such
    // brief is describing bids that have closed.
    const pulled = await one(
      `SELECT pulled_at FROM experiment_materials WHERE experiment_id = ? AND kind = 'deliverable' AND pulled_at IS NOT NULL
        ORDER BY recorded_at DESC, rowid DESC LIMIT 1`, [experimentId]);
    if (!pulled) say('how fresh the goods are', 'ready', 'the deliverable is not time-sensitive, or records no pull date');
    else {
      const at = new Date(String(pulled.pulled_at).replace(' ', 'T') + (String(pulled.pulled_at).endsWith('Z') ? '' : 'Z'));
      const days = Math.floor((Date.now() - at.getTime()) / 86_400_000);
      say('how fresh the goods are', days > 14 ? 'blocked' : 'ready',
        days > 14
          ? `the deliverable was assembled ${days} days ago (${String(pulled.pulled_at).slice(0, 10)}); bid notices run two to four weeks, so a meaningful share of it now describes bids that have closed. Pull it again before selling it.`
          : `assembled ${days} day${days === 1 ? '' : 's'} ago (${String(pulled.pulled_at).slice(0, 10)})`);
    }
  }

  // 3 ─ Cloudflare: the program and the store that serve the public surface.
  if (!cloudflareConfigured()) {
    say('Cloudflare deployment', 'blocked', 'no Cloudflare credential is configured for this deployment; nothing can be published or read back');
  } else if (!w.kvNamespaceId) {
    say('Cloudflare deployment', 'waiting', 'the Workshop has no page store yet; stand it up');
  } else {
    const { workshopHealth } = await import('./infrastructure.js');
    const health = await workshopHealth(founderId, { fetchImpl }).catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }));
    if ('error' in health) say('Cloudflare deployment', 'blocked', health.error);
    else {
      say('Cloudflare deployment', health.cloudflare.status === 'healthy' ? 'ready' : 'blocked', health.cloudflare.detail);
      say('authenticated sender identity', health.sending.status === 'healthy' ? 'ready' : 'blocked', health.sending.detail);
      say('working contact', health.replyInbox.status === 'healthy' ? 'ready' : 'blocked', health.replyInbox.detail);
    }
  }

  // 4 ─ The world: every public surface, read from its public address, now.
  const live = await livePublications(founderId);
  const paths: Array<[string, string]> = [['/', 'the workshop front page'], ['/experiments', 'the experiment register'],
    ['/contact', 'a way to reach a person'], ['/email', 'a way to never be written to again'],
    ['/refunds', 'the refund and remedy path'], ['/privacy', 'what is done with a buyer\'s data']];
  for (const [path, what] of paths) {
    const published = live.find((p) => p.path === path);
    if (!published) { say(`public HTTPS ${path}`, 'waiting', `${what} is not published yet`); continue; }
    const seen = await look(`${w.origin}${path}`, fetchImpl);
    const v = await verifyPublication(founderId, path, fetchImpl);
    say(`public HTTPS ${path}`, seen.ok && v?.verifiedStatus === 'verified' ? 'verified' : 'blocked',
      seen.ok && v?.verifiedStatus === 'verified' ? `${what}: read from ${w.origin}${path}` : `${what}: ${v?.verifiedDetail ?? seen.detail}`,
      seen.detail);
  }

  // 5 ─ The experiment's own page. Published when the owner allows it, by design.
  const pub = live.find((p) => p.experimentId === experimentId);
  if (!pub) {
    say('public HTTPS experiment page', 'waiting',
      pageUrl ? `the page publishes at ${pageUrl} when you allow the test; publishing an offer page for an experiment you have not approved would be the premature public act this design exists to prevent` : 'no public identity yet');
  } else {
    const seen = await look(`${w.origin}${pub.path}`, fetchImpl);
    const v = await verifyPublication(founderId, pub.path, fetchImpl);
    say('public HTTPS experiment page', seen.ok && v?.verifiedStatus === 'verified' ? 'verified' : 'blocked',
      seen.ok && v?.verifiedStatus === 'verified' ? `read from ${w.origin}${pub.path}` : (v?.verifiedDetail ?? seen.detail), seen.detail);
  }

  // 7 ─ Payment readiness: the provider, and the link if one is placed.
  const { paymentCapabilityConfigured } = await import('../venture/payment-link.js');
  if (!paymentCapabilityConfigured()) say('payment readiness', 'blocked', 'no payment provider is configured for this deployment');
  else {
    const offer = await one(`SELECT payment_link_url FROM experiment_materials WHERE experiment_id = ? AND kind = 'offer'`, [experimentId]);
    const url = offer?.payment_link_url == null ? null : String(offer.payment_link_url);
    if (!url) say('payment readiness', 'waiting', 'the payment link is created when you allow the test; the provider is connected and the offer has a stated price');
    else {
      const { describePaymentLink } = await import('../venture/payment-link.js');
      const link = await describePaymentLink(url).catch(() => null);
      say('payment readiness', link ? 'ready' : 'blocked', link ? `active one-time link at the provider (${url})` : `the link on record is not active at the provider (${url})`);
    }
  }

  // 8 ─ Fulfilment readiness: something to deliver, good enough to send today.
  const { materialOf, checkDeliverableQuality } = await import('../venture/hand.js');
  const deliverable = await materialOf(experimentId, 'deliverable');
  if (!deliverable) say('fulfilment readiness', 'blocked', 'nothing to deliver is attached');
  else {
    const q = checkDeliverableQuality(deliverable, new Date());
    say('fulfilment readiness', q.ok ? 'ready' : 'blocked',
      q.ok ? `“${deliverable.title}”, ${deliverable.body.length} bytes, fresh enough to send` : q.failures.join('; '));
  }

  // 9 ─ Outbound eligibility: the gate that stands between Allow and a stranger.
  const gate = await publicationGate(experimentId, { fetchImpl });
  say('outbound eligibility', gate.ok ? 'ready' : (pub ? 'blocked' : 'waiting'),
    gate.ok ? 'every prerequisite for writing to a stranger is met' : gate.failures.join('; '));

  return tally(founderId, experimentId, pageUrl, legs);
}

function tally(founderId: string, experimentId: string, pageUrl: string | null, legs: Leg[]): ExternalReadiness {
  const n = (s: LegStatus) => legs.filter((l) => l.status === s).length;
  return {
    founderId, experimentId, pageUrl, checkedAt: new Date().toISOString(), legs,
    verified: n('verified'), ready: n('ready'), waiting: n('waiting'), blocked: n('blocked'),
    ok: n('blocked') === 0,
  };
}
