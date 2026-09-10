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

/**
 * GIVE THE WORKSHOP EARS.
 *
 * Makes the Workshop a store of its own if it has none, deploys the edge mail
 * program through the same door as everything else, then points the Workshop's
 * address at it. The order matters and is not an accident: the store exists and
 * the program is deployed and verified BEFORE the routing rule is changed, so
 * at no moment is mail routed to a program that is not there, or to a program
 * with nowhere to put what it receives. If either fails, routing is untouched.
 *
 * THE KEY NAMES THE EFFECT WANTED, NOT THE CALL MADE. An at-most-once key stops
 * the same act happening twice, which is right, and it does it by what the act
 * was for. The routing key used to say "a route from this address to that one"
 * — and a run that created the rule but failed to turn routing on satisfied
 * that description while leaving mail on the floor. It now says what was
 * actually wanted: a route that is *enabled*, to the program that hears. The
 * earlier half-finished invocations keep their own records and their own keys;
 * they are not rewritten, and they no longer answer for this.
 *
 * Reversible in one step, and the step is a decision rather than a default:
 * point the rule at whatever mailbox somebody chooses. Nothing here knows one.
 */
export async function standUpTheEars(founderId: string): Promise<{ program: string; hearing: boolean; store: string }> {
  const w = need(await publicWorkshopOf(founderId));
  // SOMEWHERE THAT IS NOT FOUNDRY. The edge writes every message down before
  // it tells Foundry anything, so an outage here cannot lose one. That used to
  // be a mailbox; it is a store the Workshop owns, which buys the same
  // property without making a private account infrastructure.
  let store = w.mailKvNamespaceId ?? '';
  if (!store) {
    // Made through the same governed door as everything else, with a receipt,
    // and never the page store.
    const made = await door(w, 'cloudflare_kv_namespace_create', 'a store for the Workshop\'s own post',
      { title: `${w.workerName}-mail`, purpose: 'keep every message the Workshop receives, where only the Workshop can read it' },
      `public:${founderId}:mail_store`);
    store = String((made as { id?: string }).id ?? '');
    if (!store) throw new WorkshopRefused('no_mail_store', 'the store could not be made');
    if (store === w.kvNamespaceId) throw new WorkshopRefused('mail_store_is_not_the_page_store');
    const { setMailStore } = await import('./settings.js');
    await setMailStore(founderId, store);
  }
  const { openTheEars } = await import('./mail.js');
  const { MAIL_WORKER_SOURCE } = await import('./mail-worker-source.js');
  const { WORKSHOP_MAIL_WORKER_NAME } = await import('../integration/cloudflare-gateway.js');
  const ears = await openTheEars(founderId);
  if (!ears.url.startsWith('https://')) {
    throw new WorkshopRefused('intake_not_public', 'the mail program can only hand mail to an https address');
  }
  const name = WORKSHOP_MAIL_WORKER_NAME();
  await door(w, 'cloudflare_worker_deploy', 'the program that hears for the Workshop',
    { script_name: name, source: MAIL_WORKER_SOURCE, kv_namespace_id: w.kvNamespaceId ?? '',
      mail_namespace_id: store, intake_url: ears.url, intake_key: ears.intakeKey,
      purpose: 'receive the Workshop\'s mail, write it down where only the Workshop can read it, and hand it to Foundry' },
    `public:${founderId}:mail_program:${digestOf(MAIL_WORKER_SOURCE)}`);
  const routed = await door(w, 'cloudflare_email_route_upsert', 'route the Workshop address to the program that hears',
    { zone_name: w.zoneName, to: w.contactEmail, worker: name,
      purpose: 'mail to the Workshop is kept by the Workshop and heard by the institution' },
    `public:${founderId}:route:hearing:${w.contactEmail}:${name}`);
  return { program: name, hearing: Boolean((routed as { enabled?: boolean }).enabled), store };
}

/**
 * RETIRE A MAILBOX THE WORKSHOP NO LONGER DELIVERS TO.
 *
 * The last step of removing a path, and the one that is easy to skip because
 * skipping it changes nothing today. A verified destination address is standing
 * permission for this provider account to deliver mail into a private inbox;
 * once nothing routes there it is not leftover configuration, it is a path that
 * still exists and that a later rule could point at without anybody deciding to.
 *
 * The door refuses while an enabled rule still forwards there, so this cannot
 * be the act that drops somebody's mail. Reversing it means inviting the
 * address again and its owner accepting — which is the right amount of friction
 * for putting a private mailbox back into an institution's mail path.
 */
export async function retireMailbox(founderId: string, email: string): Promise<{ email: string; gone: boolean }> {
  const w = need(await publicWorkshopOf(founderId));
  const address = email.trim().toLowerCase();
  if (!address) throw new WorkshopRefused('no_mailbox', 'name the address to retire');
  const r = await door(w, 'cloudflare_email_destination_delete', `retire ${address} from the Workshop's provider account`,
    { zone_name: w.zoneName, email: address, purpose: 'the Workshop keeps its own post; nothing is delivered to a mailbox' },
    `public:${founderId}:mailbox_retired:${address}`);
  return { email: address, gone: Boolean((r as { gone?: boolean }).gone) };
}

// ─── Health ──────────────────────────────────────────────────────────────────

export type Signal = { status: 'healthy' | 'needs_attention' | 'unknown'; detail: string };
export interface WorkshopHealth { site: Signal; cloudflare: Signal; sending: Signal; replyInbox: Signal; mail: Signal; checkedAt: string; pages: number; pagesFailing: string[] }

export async function workshopHealth(founderId: string, opts: { fetchImpl?: typeof fetch } = {}): Promise<WorkshopHealth> {
  const w = need(await publicWorkshopOf(founderId));
  const fetchImpl = opts.fetchImpl ?? fetch;
  const health: WorkshopHealth = {
    site: { status: 'unknown', detail: '' }, cloudflare: { status: 'unknown', detail: '' }, sending: { status: 'unknown', detail: '' }, replyInbox: { status: 'unknown', detail: '' }, mail: { status: 'unknown', detail: '' },
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
      // ONCE THE WORKSHOP CAN HEAR, THE RULE NAMES THE PROGRAM, NOT A MAILBOX.
      // WHAT THE RULE POINTS AT, AND WHETHER WHAT IT POINTS AT KEEPS ANYTHING.
      // There is no forwarding address to check any more: mail goes to the
      // Workshop's own program, which writes every message into the Workshop's
      // own store before Foundry is told. So the question is no longer "did
      // the owner confirm a mailbox" but "is the post being kept".
      const { WORKSHOP_MAIL_WORKER_NAME: mailProgram, listKvKeys } = await import('../integration/cloudflare-gateway.js');
      const throughProgram = rule?.worker != null && rule.worker === mailProgram();
      const held = throughProgram && w.mailKvNamespaceId
        ? (await listKvKeys(w.mailKvNamespaceId, 'inbox/')).length
        : null;
      health.replyInbox = !routing?.enabled ? { status: 'needs_attention', detail: 'mail routing is not enabled on the zone' }
        : !rule ? { status: 'needs_attention', detail: `no rule for ${w.contactEmail}` }
          : !throughProgram ? { status: 'needs_attention', detail: `${w.contactEmail} does not reach the program that hears` }
            : !w.mailKvNamespaceId ? { status: 'needs_attention', detail: 'the Workshop has nowhere of its own to keep post' }
              : { status: 'healthy', detail: `${w.contactEmail} reaches the program that hears, which keeps every message in the Workshop's own store${held === 0 ? ' (nothing held yet)' : ` (${String(held)} held)`}` };
    } catch (e) { health.replyInbox = { status: 'unknown', detail: e instanceof Error ? e.message : String(e) }; }
  } else health.replyInbox = { status: 'unknown', detail: 'cannot be read without Cloudflare' };
  await recordWorkshopHealth(founderId, health as unknown as Record<string, unknown>);
  // CAN IT HEAR, AND IS ANYBODY WAITING? Not a mail dashboard: the only two
  // questions that bear on an obligation or on somebody's patience.
  try {
    const { mailHealth, earsAreOpen } = await import('./mail.js');
    const open = await earsAreOpen(founderId);
    const m = await mailHealth(founderId);
    health.mail = !open
      ? { status: 'needs_attention', detail: 'the Workshop cannot hear: nothing at the edge is authorised to hand it a message' }
      : m.waiting > 0
        ? { status: 'needs_attention', detail: `${m.waiting} waiting on you${m.oldestWaitingHours != null ? `, oldest ${m.oldestWaitingHours}h` : ''}` }
        : { status: 'healthy', detail: m.heard === 0 ? 'listening; nobody has written yet' : `${m.heard} heard, none waiting on you` };
  } catch (e) { health.mail = { status: 'unknown', detail: e instanceof Error ? e.message : String(e) }; }

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
