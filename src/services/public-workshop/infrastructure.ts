// =============================================================================
// FOUNDRY — Standing the Workshop up, keeping it healthy, and knowing which.
//
// Everything the owner would otherwise do by hand at Cloudflare and at the
// mail provider, done once through the governed capability and then repeated
// for nothing when nothing has moved: the one store, the one program, the two
// hostnames, the sender's DNS at the provider's request, the reply route.
// Every step verifies the world rather than the provider's yes.
//
// Health reads the same world: is the site up and carrying what was put; is
// the token alive and the program attached; is the sending domain verified at
// the provider; does the reply address forward to a verified destination. The
// reading is kept on the Workshop row so the owner sees the last known state
// even when a provider cannot be reached at that moment.
// =============================================================================
import { query } from '../../db/client.js';
import { invoke } from '../outbound/gateway.js';
import { withRetry } from '../resilience.js';
import { pathSegment } from '../outbound/path-segment.js';
import {
  cloudflareConfigured, digestOf, readDnsRecords, readEmailRouting, readWorkerDomains, readWorkerScript, readZone, verifyToken,
} from '../integration/cloudflare-gateway.js';
import { publicWorkshopOf, recordWorkshopHealth, setWorkshopStore, WorkshopRefused } from './settings.js';
import type { PublicWorkshop } from './settings.js';
import { WORKER_SOURCE } from './worker-source.js';
import { livePublications, publishSite, verifyPublication } from './publication.js';
import { getSendingIdentity, setSendingIdentity } from '../outbound/sending-identity.js';
import { verifyResendDomain } from '../outbound/sending-check.js';

const RESEND_API = 'https://api.resend.com';
const KEEPER = 'institution:workshop_keeper';

type Row = Record<string, unknown>;
const rows = async (sql: string, params: unknown[]): Promise<Row[]> => (await query(sql, params)).rows as unknown as Row[];

function need(w: PublicWorkshop | null): PublicWorkshop {
  if (!w) throw new WorkshopRefused('no_workshop');
  return w;
}
const door = async (w: PublicWorkshop, tool: string, action: string, params: Record<string, unknown>, dedupKey: string): Promise<Record<string, unknown>> => {
  const r = await invoke({ productId: w.productId, tool, action, params, dedupKey, surface: 'public_workshop', dataClass: 'general' });
  if (!r.ok) throw new WorkshopRefused('door_refused', `${tool}: ${r.phase} ${r.reason}`);
  return (r.result ?? {}) as Record<string, unknown>;
};

export interface StandUpReport { store: string; program: 'deployed' | 'unchanged'; hostnames: string[]; retiredRecords: string[]; site: { published: string[]; verified: number; unverified: string[]; failed: string[] } }

/**
 * THE WORKSHOP EXISTS IN THE WORLD after this, and running it again changes
 * nothing. Root records that pointed at nothing are retired with their
 * previous state in the receipt, so the change can be reversed exactly.
 */
export async function standUpWorkshop(founderId: string, fetchImpl?: typeof fetch): Promise<StandUpReport> {
  const w = need(await publicWorkshopOf(founderId));
  if (!cloudflareConfigured()) throw new WorkshopRefused('cloudflare_not_configured');
  const zone = await readZone(w.zoneName);
  if (!zone) throw new WorkshopRefused('zone_not_found', w.zoneName);
  // 1. The store.
  let storeId = w.kvNamespaceId;
  if (!storeId) {
    const made = await door(w, 'cloudflare_kv_namespace_create', 'make the store the Workshop\'s pages are served from', { title: `${w.workerName}-pages`, purpose: 'the one store the public Workshop serves its pages from' }, `public:${founderId}:store:${w.workerName}-pages`);
    storeId = String(made.id);
    await setWorkshopStore(founderId, storeId);
  }
  // 2. The program, only when its text differs from what runs.
  const running = await readWorkerScript(w.workerName);
  let program: StandUpReport['program'] = 'unchanged';
  if (!running.present || running.source === null || digestOf(running.source) !== digestOf(WORKER_SOURCE)) {
    await door(w, 'cloudflare_worker_deploy', `deploy the Workshop program ${w.workerName}`, { script_name: w.workerName, source: WORKER_SOURCE, kv_namespace_id: storeId, purpose: 'the public Workshop program' }, `public:${founderId}:worker:${digestOf(WORKER_SOURCE)}`);
    program = 'deployed';
  }
  // 3. The hostnames. A stale root record blocks the attachment; it is retired
  //    with its previous state kept, never overwritten wholesale.
  const attached = await readWorkerDomains();
  const retired: string[] = []; const hostnames: string[] = [];
  for (const hostname of [w.zoneName, `www.${w.zoneName}`]) {
    if (attached.some((d) => d.hostname === hostname && d.service === w.workerName)) { hostnames.push(hostname); continue; }
    for (const type of ['A', 'AAAA', 'CNAME']) {
      for (const rec of await readDnsRecords(zone.id, { type, name: hostname })) {
        await door(w, 'cloudflare_dns_delete', `retire the ${type} record at ${hostname} so the Workshop program can answer there`, { zone_name: w.zoneName, record_id: rec.id, purpose: `make way for the Workshop at ${hostname}` }, `public:${founderId}:dns:retire:${rec.id}`);
        retired.push(`${type} ${hostname} → ${rec.content}`);
      }
    }
    await door(w, 'cloudflare_domain_attach', `attach ${hostname} to the Workshop program`, { zone_name: w.zoneName, hostname, service: w.workerName, purpose: `serve the Workshop at ${hostname}` }, `public:${founderId}:domain:${hostname}`);
    hostnames.push(hostname);
  }
  // 4. The pages, and the world's reading of them.
  const site = await publishSite(founderId, KEEPER, fetchImpl);
  return { store: storeId, program, hostnames, retiredRecords: retired, site: { published: site.published, verified: site.verified, unverified: site.unverified, failed: site.failed.map((f) => `${f.path}: ${f.reason}`) } };
}

// ─── Sending as the Workshop ─────────────────────────────────────────────────

interface ResendDomain { id: string; name: string; status: string; records?: Array<{ record: string; name: string; type: string; value: string; priority?: number; status?: string }> }

async function resendCredential(w: PublicWorkshop): Promise<string> {
  const existing = await getSendingIdentity(w.productId);
  const key = existing?.credential ?? process.env.RESEND_API_KEY ?? '';
  if (!key.trim()) throw new WorkshopRefused('no_resend_credential');
  return key;
}
async function resend<T>(key: string, path: string, init: { method?: string; body?: unknown } = {}, fetchImpl: typeof fetch = fetch): Promise<T> {
  const r = await withRetry(() => fetchImpl(`${RESEND_API}${path}`, { method: init.method ?? 'GET', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: init.body === undefined ? undefined : JSON.stringify(init.body) }), { timeoutMs: 15_000, maxRetries: 1 });
  const text = await r.text();
  if (!r.ok) throw new Error(`Resend ${path} ${r.status}: ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

export interface SendingReport { domain: string; status: string; records: string[]; identity: string | null; verified: boolean }

/**
 * The provider names the records; the capability writes them on the
 * Workshop's own zone; the provider is asked to verify; the identity is set
 * only once the provider says the domain is verified. Run again to poll.
 */
export async function connectWorkshopSending(founderId: string, fetchImpl: typeof fetch = fetch): Promise<SendingReport> {
  const w = need(await publicWorkshopOf(founderId));
  const key = await resendCredential(w);
  const all = await resend<{ data: ResendDomain[] }>(key, '/domains', {}, fetchImpl);
  let domain = all.data.find((d) => d.name.toLowerCase() === w.zoneName) ?? null;
  if (!domain) domain = await resend<ResendDomain>(key, '/domains', { method: 'POST', body: { name: w.zoneName, region: 'us-east-1' } }, fetchImpl);
  const full = await resend<ResendDomain>(key, `/domains/${pathSegment(domain.id, 'resend_domain_id')}`, {}, fetchImpl);
  const written: string[] = [];
  for (const rec of full.records ?? []) {
    const name = rec.name === '@' || rec.name === w.zoneName ? w.zoneName : rec.name.endsWith(w.zoneName) ? rec.name : `${rec.name}.${w.zoneName}`;
    await door(w, 'cloudflare_dns_upsert', `set the ${rec.record} ${rec.type} record the mail provider asks for at ${name}`,
      { zone_name: w.zoneName, type: rec.type, name, content: rec.value, priority: rec.priority, purpose: `mail authentication for ${w.contactEmail} (${rec.record})` },
      `public:${founderId}:dns:${rec.type}:${name}:${digestOf(rec.value)}`);
    written.push(`${rec.type} ${name}`);
  }
  // A DMARC record that observes, so receivers see a policy exists; it
  // tightens later, deliberately, never by default.
  const dmarc = await readDnsRecords((await readZone(w.zoneName))!.id, { type: 'TXT', name: `_dmarc.${w.zoneName}` }).catch(() => []);
  if (dmarc.length === 0) {
    await door(w, 'cloudflare_dns_upsert', 'set a DMARC record that reports and does not yet enforce', { zone_name: w.zoneName, type: 'TXT', name: `_dmarc.${w.zoneName}`, content: `v=DMARC1; p=none; rua=mailto:${w.contactEmail}`, purpose: 'mail authentication policy for the Workshop' }, `public:${founderId}:dns:dmarc`);
    written.push(`TXT _dmarc.${w.zoneName}`);
  }
  if (full.status !== 'verified') await resend(key, `/domains/${pathSegment(domain.id, 'resend_domain_id')}/verify`, { method: 'POST' }, fetchImpl).catch(() => undefined);
  const after = await resend<ResendDomain>(key, `/domains/${pathSegment(domain.id, 'resend_domain_id')}`, {}, fetchImpl);
  let identity: string | null = null;
  if (after.status === 'verified') {
    const fromName = `${w.operatorName} — ${w.publicName}`;
    const current = await getSendingIdentity(w.productId);
    if (!current || current.fromEmail !== w.contactEmail || current.fromName !== fromName) {
      await setSendingIdentity({ productId: w.productId, provider: 'resend', credential: key, fromEmail: w.contactEmail, fromName });
    }
    identity = `${fromName} <${w.contactEmail}>`;
  }
  return { domain: after.name, status: after.status, records: written, identity, verified: after.status === 'verified' };
}

/** Mail to the Workshop's address reaches the owner's inbox. The destination
 * needs one click from him at the provider the first time; the report says so. */
export async function connectReplyInbox(founderId: string): Promise<{ to: string; forwardTo: string; destinationVerified: boolean }> {
  const w = need(await publicWorkshopOf(founderId));
  const founder = (await rows('SELECT email FROM founders WHERE id = ?', [founderId]))[0];
  const forwardTo = String(founder?.email ?? '');
  if (!forwardTo) throw new WorkshopRefused('no_owner_address');
  const r = await door(w, 'cloudflare_email_route_upsert', `forward ${w.contactEmail} to the owner`, { zone_name: w.zoneName, to: w.contactEmail, forward_to: forwardTo, purpose: 'replies to the Workshop reach the person who wrote' }, `public:${founderId}:route:${w.contactEmail}:${forwardTo}`);
  return { to: w.contactEmail, forwardTo, destinationVerified: Boolean(r.destinationVerified) };
}

// ─── Health ──────────────────────────────────────────────────────────────────

export type Signal = { status: 'healthy' | 'needs_attention' | 'unknown'; detail: string };
export interface WorkshopHealth { site: Signal; cloudflare: Signal; sending: Signal; replyInbox: Signal; checkedAt: string; pages: number; pagesFailing: string[] }

export async function workshopHealth(founderId: string, opts: { fetchImpl?: typeof fetch } = {}): Promise<WorkshopHealth> {
  const w = need(await publicWorkshopOf(founderId));
  const fetchImpl = opts.fetchImpl ?? fetch;
  const health: WorkshopHealth = {
    site: { status: 'unknown', detail: '' }, cloudflare: { status: 'unknown', detail: '' }, sending: { status: 'unknown', detail: '' }, replyInbox: { status: 'unknown', detail: '' },
    checkedAt: new Date().toISOString(), pages: 0, pagesFailing: [],
  };
  // The site: every live page read from its public address.
  const pubs = await livePublications(founderId);
  health.pages = pubs.length;
  if (pubs.length === 0) health.site = { status: 'needs_attention', detail: 'nothing is published yet' };
  else {
    for (const p of pubs) { const v = await verifyPublication(founderId, p.path, fetchImpl); if (v?.verifiedStatus !== 'verified') health.pagesFailing.push(`${p.path}: ${v?.verifiedDetail ?? 'unverified'}`); }
    health.site = health.pagesFailing.length === 0 ? { status: 'healthy', detail: `${pubs.length} pages served as published` } : { status: 'needs_attention', detail: `${health.pagesFailing.length} of ${pubs.length} pages are not served as published` };
  }
  // Cloudflare: the token, the zone, the program, the hostnames.
  if (!cloudflareConfigured()) health.cloudflare = { status: 'needs_attention', detail: 'not configured on this deployment' };
  else {
    const token = await verifyToken();
    if (!token.ok) health.cloudflare = { status: 'needs_attention', detail: `the token is not accepted: ${token.detail}` };
    else {
      try {
        const zone = await readZone(w.zoneName);
        const program = await readWorkerScript(w.workerName);
        const domains = await readWorkerDomains();
        const missing = [w.zoneName, `www.${w.zoneName}`].filter((h) => !domains.some((d) => d.hostname === h && d.service === w.workerName));
        const drift = !program.present ? 'the program is missing' : program.source !== null && digestOf(program.source) !== digestOf(WORKER_SOURCE) ? 'the running program differs from the reviewed one' : missing.length ? `${missing.join(', ')} not attached` : zone?.status !== 'active' ? `zone status ${zone?.status ?? 'unknown'}` : null;
        health.cloudflare = drift ? { status: 'needs_attention', detail: drift } : { status: 'healthy', detail: `connected; ${w.zoneName} active, program and hostnames in place` };
      } catch (e) { health.cloudflare = { status: 'unknown', detail: e instanceof Error ? e.message : String(e) }; }
    }
  }
  // Sending: the identity is the Workshop's, and the provider has verified its domain.
  const identity = await getSendingIdentity(w.productId);
  if (!identity) health.sending = { status: 'needs_attention', detail: 'no sending identity connected' };
  else if (!identity.fromEmail.endsWith(`@${w.zoneName}`) || !(identity.fromName ?? '').includes(w.publicName)) health.sending = { status: 'needs_attention', detail: `connected as ${identity.fromEmail}, not as the Workshop` };
  else {
    const check = await verifyResendDomain(identity.credential, identity.fromEmail, fetchImpl);
    health.sending = check.ok ? { status: 'healthy', detail: `authenticated; sends as ${identity.fromName} <${identity.fromEmail}>` } : { status: 'needs_attention', detail: check.reason };
  }
  // The reply inbox: routing exists and the destination is verified.
  if (cloudflareConfigured() && health.cloudflare.status !== 'needs_attention') {
    try {
      const zone = await readZone(w.zoneName);
      const routing = zone ? await readEmailRouting(zone.id) : null;
      const rule = routing?.rules.find((r) => r.to === w.contactEmail);
      const dest = rule ? routing?.destinations.find((d) => rule.forwardTo.includes(d.email)) : undefined;
      health.replyInbox = !routing?.enabled ? { status: 'needs_attention', detail: 'mail routing is not enabled on the zone' }
        : !rule ? { status: 'needs_attention', detail: `no forwarding rule for ${w.contactEmail}` }
          : !dest?.verified ? { status: 'needs_attention', detail: `forwards to ${rule.forwardTo.join(', ')}, which you have not yet confirmed at Cloudflare (one click in the email they sent you)` }
            : { status: 'healthy', detail: `replies to ${w.contactEmail} reach ${dest.email}` };
    } catch (e) { health.replyInbox = { status: 'unknown', detail: e instanceof Error ? e.message : String(e) }; }
  } else health.replyInbox = { status: 'unknown', detail: 'cannot be read without Cloudflare' };
  await recordWorkshopHealth(founderId, health as unknown as Record<string, unknown>);
  return health;
}

/**
 * WHAT WAS CHANGED AT THE PROVIDER, AND HOW TO PUT IT BACK.
 *
 * Every mutation wrote what was there before, what was asked for, what the
 * provider said, what the world then showed and what would reverse it. This
 * is where a person reads it: a receipt nobody can open is not a receipt.
 */
export interface MutationReceipt {
  id: string; at: string; tool: string; resource: string; purpose: string; authority: string; outcome: string;
  previous: string | null; requested: string; response: string | null; verified: string | null; rollback: string | null;
}

const brief = (raw: unknown, limit = 220): string | null => {
  if (raw == null) return null;
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  return text.length > limit ? text.slice(0, limit) + String.fromCharCode(8230) : text;
};

export async function cloudflareReceipts(founderId: string, limit = 40): Promise<MutationReceipt[]> {
  return (await rows(
    'SELECT id, recorded_at, tool, resource, purpose, authority, outcome, previous_json, requested_json, response_json, verification_json, rollback_json'
    + ' FROM cloudflare_mutations WHERE founder_id = ? ORDER BY recorded_at DESC, rowid DESC LIMIT ?', [founderId, limit]))
    .map((r) => ({
      id: String(r.id), at: String(r.recorded_at), tool: String(r.tool), resource: String(r.resource), purpose: String(r.purpose),
      authority: String(r.authority), outcome: String(r.outcome),
      previous: brief(r.previous_json), requested: brief(r.requested_json) ?? '{}', response: brief(r.response_json),
      verified: brief(r.verification_json), rollback: brief(r.rollback_json),
    }));
}
/** What is owed to customers right now, across every experiment: the one
 * thing an owner pause must not touch. */
export async function outstandingObligations(founderId: string): Promise<Array<{ experimentId: string; paymentRef: string; status: string; since: string }>> {
  return (await rows(
    `SELECT f.experiment_id, f.payment_ref, f.status, f.created_at FROM experiment_fulfilments f JOIN venture_experiments e ON e.id = f.experiment_id
      WHERE e.founder_id = ? AND ((f.status IN ('owed','sent','failed') AND f.refund_ref IS NULL) OR (f.refund_requested_at IS NOT NULL AND f.refund_ref IS NULL)) ORDER BY f.created_at`, [founderId]))
    .map((r) => ({ experimentId: String(r.experiment_id), paymentRef: String(r.payment_ref), status: String(r.status), since: String(r.created_at) }));
}
