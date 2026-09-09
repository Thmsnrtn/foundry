// =============================================================================
// FOUNDRY — Publication: putting a page in the world and seeing it there.
//
// The pipeline the doctrine names, as code:
//
//   canonical rows → projection → page → the door (cloudflare_kv_put)
//   → the provider's yes → a read of the public address over HTTPS
//   → a publication row saying what was seen → the gate → outbound eligible
//
// A provider accepting a page is not the page existing; the row records the
// digest that was put and, separately, whether that digest was read back from
// the public address. An offer to a stranger needs the second fact (migration
// 285's plan guard reads it), and the gate below adds everything else the
// doctrine asks: the price on the page is the price at the provider, the
// sender is the Workshop, the ways to reach, refund and opt out are on the
// page, nothing private is, and it reads on a phone.
// =============================================================================
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { invoke } from '../outbound/gateway.js';
import { digestOf, cloudflareConfigured } from '../integration/cloudflare-gateway.js';
import { publicWorkshopOf, publicWorkshopOfExperiment, WorkshopRefused } from './settings.js';
import type { PublicWorkshop } from './settings.js';
import { leakIn, privateStringsOf, projectExperiment, projectRegistry, workshopFacts } from './projection.js';
import type { PublicExperiment } from './projection.js';
import { renderSite } from './site.js';

export interface Publication {
  id: string; path: string; kind: 'page' | 'experiment'; experimentId: string | null; version: number; digest: string; bytes: number;
  publishedAt: string; publishedBy: string; verifiedAt: string | null; verifiedStatus: 'verified' | 'mismatch' | 'unreachable' | null; verifiedDetail: string | null;
}

type Row = Record<string, unknown>;
const rows = async (sql: string, params: unknown[]): Promise<Row[]> => (await query(sql, params)).rows as unknown as Row[];
const project = (r: Row): Publication => ({
  id: String(r.id), path: String(r.path), kind: String(r.kind) as Publication['kind'], experimentId: r.experiment_id == null ? null : String(r.experiment_id),
  version: Number(r.version), digest: String(r.digest), bytes: Number(r.bytes), publishedAt: String(r.published_at), publishedBy: String(r.published_by),
  verifiedAt: r.verified_at == null ? null : String(r.verified_at), verifiedStatus: r.verified_status == null ? null : String(r.verified_status) as Publication['verifiedStatus'],
  verifiedDetail: r.verified_detail == null ? null : String(r.verified_detail),
});

export async function livePublications(founderId: string): Promise<Publication[]> {
  return (await rows('SELECT * FROM public_publications WHERE founder_id = ? AND superseded_at IS NULL ORDER BY path', [founderId])).map(project);
}
export async function livePublication(founderId: string, path: string): Promise<Publication | null> {
  const r = (await rows('SELECT * FROM public_publications WHERE founder_id = ? AND path = ? AND superseded_at IS NULL', [founderId, path]))[0];
  return r ? project(r) : null;
}
export async function experimentPublication(experimentId: string): Promise<Publication | null> {
  const r = (await rows(`SELECT * FROM public_publications WHERE experiment_id = ? AND kind = 'experiment' AND superseded_at IS NULL`, [experimentId]))[0];
  return r ? project(r) : null;
}

/** The public address of an experiment, deterministic from its identity; it
 * exists before publication and is what the offer text points at. */
export async function pageUrlFor(experimentId: string): Promise<string | null> {
  const r = (await rows('SELECT w.origin, s.slug FROM public_experiments s JOIN public_workshop w ON w.founder_id = s.founder_id WHERE s.experiment_id = ?', [experimentId]))[0];
  return r ? `${String(r.origin)}/experiments/${String(r.slug)}` : null;
}

/** Read the public address and compare with what was put. The world's answer
 * is the record; a provider's earlier yes is not consulted. */
/**
 * THE EDGE IS EVENTUALLY CONSISTENT, AND "NOT YET" IS NOT "NO".
 *
 * A page store of this kind does not promise that a write is readable at the
 * edge the instant it returns; propagation takes seconds. Reading once,
 * immediately, and recording `mismatch` turns a normal delay into a verdict
 * that the world does not carry the page — which stops publication, stops
 * outbound, and is untrue. It cost the first real rehearsal three of its six
 * steps.
 *
 * So a mismatch is retried for a bounded window before it is believed. Nothing
 * about the standard is relaxed: the bytes served must still equal the bytes
 * published, and an honest failure after the window is still a failure. The
 * only thing that changed is that the world is given the few seconds it
 * actually needs to answer.
 */
// A knob, not a behaviour: the standard for "the world carries this page" is
// unchanged, only how long the world is given to say so. Zero under the test
// runner, where the edge is a stub that answers instantly and waiting would
// buy nothing but minutes.
const PROPAGATION_MS = Number(process.env.FOUNDRY_EDGE_PROPAGATION_MS ?? (process.env.VITEST ? 0 : 45_000));
const PROPAGATION_STEP_MS = 3_000;

export async function verifyPublication(founderId: string, path: string, fetchImpl: typeof fetch = fetch, opts: { waitMs?: number } = {}): Promise<Publication | null> {
  const w = await publicWorkshopOf(founderId);
  const p = await livePublication(founderId, path);
  if (!w || !p) return null;
  const deadline = Date.now() + (opts.waitMs ?? PROPAGATION_MS);
  let status: 'verified' | 'mismatch' | 'unreachable'; let detail: string;
  let attempts = 0;
  for (;;) {
    attempts += 1;
    try {
      const res = await fetchImpl(`${w.origin}${path}`, { headers: { accept: 'text/html' }, redirect: 'manual' });
      const body = await res.text();
      if (res.status !== 200) { status = 'unreachable'; detail = `HTTP ${res.status}`; }
      else if (digestOf(body) !== p.digest) { status = 'mismatch'; detail = `served digest ${digestOf(body)} ≠ published ${p.digest}`; }
      else { status = 'verified'; detail = `HTTP 200, ${body.length} bytes, digest matches${attempts > 1 ? `, after ${attempts} reads` : ''}`; }
    } catch (e) { status = 'unreachable'; detail = e instanceof Error ? e.message : String(e); }
    if (status === 'verified' || Date.now() + PROPAGATION_STEP_MS > deadline) break;
    await new Promise((r) => { setTimeout(r, PROPAGATION_STEP_MS); });
  }
  if (status !== 'verified' && attempts > 1) detail = `${detail}, still after ${attempts} reads over ${Math.round((PROPAGATION_MS) / 1000)}s`;
  await query(`UPDATE public_publications SET verified_at = datetime('now'), verified_status = ?, verified_detail = ? WHERE id = ?`, [status, detail, p.id]);
  return (await livePublication(founderId, path))!;
}

/** Put one page through the door, record it, read it back. */
export async function publishPage(input: { founderId: string; path: string; html: string; kind: 'page' | 'experiment'; experimentId?: string | null; by: string; fetchImpl?: typeof fetch }): Promise<Publication> {
  const w = await publicWorkshopOf(input.founderId);
  if (!w) throw new WorkshopRefused('no_workshop');
  if (!w.kvNamespaceId) throw new WorkshopRefused('no_store', 'the Workshop has no page store yet; stand it up first');
  const digest = digestOf(input.html);
  const current = await livePublication(input.founderId, input.path);
  if (current && current.digest === digest && current.verifiedStatus === 'verified') return current;
  const version = 1 + Number(((await rows('SELECT max(version) AS v FROM public_publications WHERE founder_id = ? AND path = ?', [input.founderId, input.path]))[0]?.v) ?? 0);
  const result = await invoke({
    productId: w.productId, tool: 'cloudflare_kv_put', action: `publish ${input.path} (v${version})`,
    params: { namespace_id: w.kvNamespaceId, key: `page:${input.path}`, value: input.html, purpose: input.kind === 'experiment' ? `experiment page ${input.path}` : `workshop page ${input.path}` },
    dedupKey: `public:${input.founderId}:${input.path}:${digest}`, surface: 'public_workshop', dataClass: 'general',
  });
  if (!result.ok) throw new WorkshopRefused('publication_refused', `${result.phase}: ${result.reason}`);
  if (current) await query(`UPDATE public_publications SET superseded_at = datetime('now') WHERE id = ?`, [current.id]);
  const id = nanoid();
  await query(
    `INSERT INTO public_publications (id, founder_id, path, kind, experiment_id, version, digest, bytes, published_by, invocation_id) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, input.founderId, input.path, input.kind, input.experimentId ?? null, version, digest, input.html.length, input.by, result.invocation_id]);
  return (await verifyPublication(input.founderId, input.path, input.fetchImpl))!;
}

export interface SiteReport { published: string[]; unchanged: string[]; failed: Array<{ path: string; reason: string }>; verified: number; unverified: string[] }

/** Render the whole site from the rows and publish what changed. Idempotent
 * by digest, so calling it every hour costs nothing when nothing moved. */
export async function publishSite(founderId: string, by: string, fetchImpl?: typeof fetch): Promise<SiteReport> {
  const w = await publicWorkshopOf(founderId);
  if (!w) throw new WorkshopRefused('no_workshop');
  const facts = workshopFacts(w);
  // ONLY AN APPROVED EXPERIMENT REACHES THE WORLD, and the guard on the row
  // says the same. Two are excluded, for different reasons: one still being
  // prepared has nothing to show yet, and one the owner declined before it ever
  // ran was never put in front of anybody, so there is no public record owed —
  // publishing it would also be refused by the row on every pass forever.
  const approved = await approvedSlugs(founderId);
  const registry = (await projectRegistry(founderId)).filter((x) => x.status !== 'preparing' && approved.has(x.slug));
  await indexSlugs(founderId, registry);
  const pages = renderSite(facts, registry);
  const report: SiteReport = { published: [], unchanged: [], failed: [], verified: 0, unverified: [] };
  for (const [path, html] of pages) {
    const x = registry.find((r) => r.path === path);
    if (x) {
      const leak = leakIn(html, await privateStringsOf(experimentIdOf(x, registry)));
      if (leak) { report.failed.push({ path, reason: `a private value would appear on the page (${leak.slice(0, 24)}…)` }); continue; }
    }
    try {
      const before = await livePublication(founderId, path);
      const p = await publishPage({ founderId, path, html, kind: x ? 'experiment' : 'page', experimentId: x ? experimentIdOf(x, registry) : null, by, fetchImpl });
      if (before && before.id === p.id) report.unchanged.push(path); else report.published.push(path);
      if (p.verifiedStatus === 'verified') report.verified += 1; else report.unverified.push(`${path}: ${p.verifiedDetail ?? p.verifiedStatus ?? 'unverified'}`);
    } catch (e) { report.failed.push({ path, reason: e instanceof Error ? e.message : String(e) }); }
  }
  return report;
}

// The projection carries no experiment id on purpose; the publisher maps a
// public shape back to its row by the identity table, never the other way.
const idCache = new WeakMap<PublicExperiment[], Map<string, string>>();
function experimentIdOf(x: PublicExperiment, registry: PublicExperiment[]): string {
  const m = idCache.get(registry);
  if (m?.has(x.slug)) return m.get(x.slug)!;
  throw new Error(`no experiment id for ${x.slug}; call slugIndex first`);
}
async function indexSlugs(founderId: string, registry: PublicExperiment[]): Promise<void> {
  const m = new Map<string, string>();
  for (const r of await rows('SELECT experiment_id, slug FROM public_experiments WHERE founder_id = ?', [founderId])) m.set(String(r.slug), String(r.experiment_id));
  idCache.set(registry, m);
}

/** The slugs of experiments the owner approved: the only ones the world may see. */
async function approvedSlugs(founderId: string): Promise<Set<string>> {
  const r = await rows(
    `SELECT w.slug FROM public_experiments w JOIN venture_experiments e ON e.id = w.experiment_id
      WHERE w.founder_id = ? AND e.decision = 'approved'`, [founderId]);
  return new Set(r.map((x) => String(x.slug)));
}

/** Re-read every live page from the public address. */
export async function verifySite(founderId: string, fetchImpl?: typeof fetch): Promise<{ verified: number; failing: string[] }> {
  const out = { verified: 0, failing: [] as string[] };
  for (const p of await livePublications(founderId)) {
    const v = await verifyPublication(founderId, p.path, fetchImpl);
    if (v?.verifiedStatus === 'verified') out.verified += 1; else out.failing.push(`${p.path}: ${v?.verifiedDetail ?? 'unverified'}`);
  }
  return out;
}

/** The preview of an experiment's page, rendered from the rows now, whether or not it is published. */
export async function previewExperimentPage(experimentId: string): Promise<{ html: string; path: string } | null> {
  const w = await publicWorkshopOfExperiment(experimentId);
  const x = await projectExperiment(experimentId);
  if (!w || !x) return null;
  const { renderExperiment } = await import('./site.js');
  return { html: renderExperiment(workshopFacts(w), x), path: x.path };
}

// ─── The gate ────────────────────────────────────────────────────────────────

export interface Gate { ok: boolean; failures: string[]; pageUrl: string | null; verifiedAt: string | null; checkedAt: string }

/**
 * BEFORE ANYONE OUTSIDE IS WRITTEN TO. Every failure here refuses outbound;
 * the plan guard on the row refuses the first of them again on its own.
 */
export async function publicationGate(experimentId: string, opts: { now?: Date; fetchImpl?: typeof fetch; verifyLive?: boolean } = {}): Promise<Gate> {
  const now = opts.now ?? new Date();
  const failures: string[] = [];
  const w = await publicWorkshopOfExperiment(experimentId);
  if (!w) return { ok: false, failures: ['no public Workshop exists for this owner'], pageUrl: null, verifiedAt: null, checkedAt: now.toISOString() };
  if (w.economicPause) failures.push(`new economic activity is paused: ${w.economicPause.reason}`);
  if (!w.postalAddress) failures.push('commercial email must carry a postal address, and none is recorded for the Workshop (a business or PO box address, not a home address)');
  const x = await projectExperiment(experimentId);
  const pageUrl = await pageUrlFor(experimentId);
  if (!x || !pageUrl) return { ok: false, failures: [...failures, 'the experiment has no public identity (number, slug and public copy)'], pageUrl: null, verifiedAt: null, checkedAt: now.toISOString() };

  // The page: published, seen, and current.
  let pub = await experimentPublication(experimentId);
  if (!pub) failures.push('the public page has not been published');
  else {
    const facts = workshopFacts(w);
    const { renderExperiment } = await import('./site.js');
    const current = digestOf(renderExperiment(facts, x));
    if (current !== pub.digest) failures.push('the published page is stale: the rows have changed since it was put up');
    if (opts.verifyLive !== false) pub = (await verifyPublication(w.founderId, pub.path, opts.fetchImpl)) ?? pub;
    if (pub.verifiedStatus !== 'verified') failures.push(`the public page could not be seen at ${pageUrl}: ${pub.verifiedDetail ?? 'unverified'}`);
    else if (pub.verifiedAt && now.getTime() - new Date(pub.verifiedAt.replace(' ', 'T') + (pub.verifiedAt.endsWith('Z') ? '' : 'Z')).getTime() > 24 * 3_600_000) failures.push('the public page was last seen more than a day ago');
  }
  // The page says what the provider will charge: price and cadence.
  if (x.status !== 'testing') failures.push(`the experiment is ${x.statusLabel.toLowerCase()}, not testing`);
  if (!x.price) failures.push('the page states no price');
  if (!x.payUrl) failures.push('the page has no way to pay');
  else {
    const { describePaymentLink } = await import('../venture/payment-link.js');
    const link = await describePaymentLink(x.payUrl).catch(() => null);
    if (!link) failures.push('the payment link on the page is not active at the provider');
    else {
      const li = link.lineItems[0];
      if (!li || li.unitAmount !== x.price?.amountCents || li.currency.toUpperCase() !== x.price.currency.toUpperCase()) failures.push(`the price on the page (${x.price?.label ?? 'none'}) is not the price at the provider (${li?.unitAmount ?? '?'} ${li?.currency ?? ''})`);
      if (li?.recurring) failures.push('the page says one-time; the provider link recurs');
    }
  }
  // The sender is the Workshop, and its domain is authenticated at the provider.
  const { getSendingIdentity } = await import('../outbound/sending-identity.js');
  const identity = await getSendingIdentity(w.productId);
  if (!identity) failures.push('no sending identity is connected for the Workshop');
  else {
    if (!identity.fromEmail.endsWith(`@${w.zoneName}`)) failures.push(`the sending address ${identity.fromEmail} is not on ${w.zoneName}`);
    if (!identity.fromName || !identity.fromName.includes(w.publicName)) failures.push(`the sender name does not carry ${w.publicName}`);
    if (opts.verifyLive !== false) {
      const { verifyResendDomain } = await import('../outbound/sending-check.js');
      const check = await verifyResendDomain(identity.credential, identity.fromEmail, opts.fetchImpl);
      if (!check.ok) failures.push(`sender authentication is not healthy: ${check.reason}`);
    }
  }
  // The page carries the paths a stranger needs, and nothing private, and reads on a phone.
  const { renderExperiment } = await import('./site.js');
  const html = renderExperiment(workshopFacts(w), x);
  for (const [needle, what] of [['/contact', 'a contact path'], ['/email', 'an opt-out path'], ['/refunds', 'a refund path'], ['/privacy', 'a privacy statement'], ['name="viewport"', 'a mobile viewport']] as const) {
    if (!html.includes(needle)) failures.push(`the page lacks ${what}`);
  }
  if (!/Is this recurring\? <strong>No\.<\/strong>/.test(html)) failures.push('the page does not state recurrence');
  const leak = leakIn(html, await privateStringsOf(experimentId));
  if (leak) failures.push('a private value would appear on the page');
  return { ok: failures.length === 0, failures, pageUrl, verifiedAt: pub?.verifiedAt ?? null, checkedAt: now.toISOString() };
}

export { indexSlugs, cloudflareConfigured };
export type { PublicWorkshop };
