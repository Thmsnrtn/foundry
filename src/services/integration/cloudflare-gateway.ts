// =============================================================================
// FOUNDRY — Cloudflare through the outbound door: the public Workshop's
// infrastructure as a bounded capability with receipts.
//
// apexmicro.ai lives at Cloudflare. The owner handed this institution a token
// so the Workshop could be operated on his behalf: pages published, the one
// public program deployed, the Workshop's own DNS kept, mail to its address
// forwarded to him. Possession of a token is not authority, so what exists
// here is exactly the set of tools the Workshop needs, each registered at the
// door with its consequence, and NOTHING that could transfer the domain,
// change its nameservers, delete a zone, touch another zone, or weaken what
// protects the public site. Those are not tools with a high rung; they are
// tools that do not exist.
//
// EVERY MUTATION LEAVES A RECEIPT (cloudflare_mutations): what was there, what
// was asked, what the provider said, what was then observed, and what would
// put it back. The provider saying yes is a claim; the observation is the
// record. The token travels in one header and is never logged or returned.
//
// THE ENVELOPE, in code rather than in a comment:
//   * DNS and mail routing: only the Workshop's zone (WORKSHOP_ZONE_NAME);
//     only A, AAAA, CNAME, TXT and MX records; never NS, never a wildcard.
//   * Pages: only the Workshop's one store; a page key is never deleted (the
//     record is the point), only the opt-out records it has already kept.
//   * Program and hostname: only the Workshop's named program and its own
//     apex or www.
// =============================================================================

import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { registerToolHandler, type GatewayRequest } from '../outbound/gateway.js';
import { pathSegment } from '../outbound/path-segment.js';
import { withRetry } from '../resilience.js';
import { log } from '../../lib/logger.js';

const CF_API = 'https://api.cloudflare.com/client/v4';
const CF_TIMEOUT_MS = 15_000;

export const WORKSHOP_ZONE_NAME = (): string => (process.env.WORKSHOP_ZONE_NAME ?? 'apexmicro.ai').toLowerCase();
export const WORKSHOP_WORKER_NAME = (): string => process.env.WORKSHOP_WORKER_NAME ?? 'apexmicro';

export function cloudflareConfigured(): boolean {
  return Boolean(process.env.CLOUDFLARE_API_TOKEN?.trim() && process.env.CLOUDFLARE_ACCOUNT_ID?.trim());
}
function credentials(): { token: string; accountId: string } {
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!token || !accountId) throw new Error('Cloudflare is not configured (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID)');
  return { token, accountId };
}
const account = (): string => pathSegment(credentials().accountId, 'cloudflare_account_id');
const auth = (extra: Record<string, string> = {}): Record<string, string> => ({ Authorization: `Bearer ${credentials().token}`, ...extra });

export class CloudflareRefused extends Error {
  constructor(public readonly code: string, detail?: string) { super(detail ? `${code}: ${detail}` : code); this.name = 'CloudflareRefused'; }
}

interface CfEnvelope<T> { success: boolean; result: T; errors?: Array<{ code: number; message: string }>; result_info?: { cursor?: string } }

/** One read of the provider. Errors carry the provider's words, never the token. */
async function cfRead<T>(response: Response): Promise<CfEnvelope<T>> {
  const text = await response.text();
  let body: CfEnvelope<T>;
  try { body = JSON.parse(text) as CfEnvelope<T>; } catch { body = { success: false, result: null as unknown as T, errors: [{ code: response.status, message: text.slice(0, 200) }] }; }
  if (!response.ok || !body.success) {
    throw new Error(`Cloudflare ${response.status}: ${(body.errors ?? []).map((e) => `${e.code} ${e.message}`).join('; ') || 'no detail'}`);
  }
  return body;
}
const getJson = <T>(url: string): Promise<CfEnvelope<T>> =>
  withRetry(() => fetch(url, { headers: auth() }), { timeoutMs: CF_TIMEOUT_MS, maxRetries: 2 }).then((r) => cfRead<T>(r));

// ─── Reads: what the world currently holds ───────────────────────────────────

export interface ZoneFacts { id: string; name: string; status: string; nameServers: string[]; paused: boolean }
export interface DnsRecord { id: string; type: string; name: string; content: string; ttl: number; priority: number | null; proxied: boolean }
export interface TokenFacts { ok: boolean; status: string | null; detail: string }

/**
 * ASK THE QUESTION THAT MATTERS, NOT THE ONE WITH A TIDY ENDPOINT.
 *
 * `/user/tokens/verify` reports on a token owned by a *user*. Cloudflare also
 * issues account-owned tokens, and one of those answers that endpoint with a
 * flat 401 "Invalid API Token" while working perfectly everywhere it is
 * actually meant to be used. This health check therefore told the owner his
 * credential was invalid when it was not, and cost a round of replacing a
 * credential that had nothing wrong with it.
 *
 * What the institution needs to know is not "what kind of token is this" but
 * "can it reach this account and this zone" — so it asks that instead, with
 * two calls the capability itself makes. A token that answers both can do the
 * work; a token that cannot is unusable however healthy it claims to be.
 */
export async function verifyToken(): Promise<TokenFacts> {
  if (!cloudflareConfigured()) return { ok: false, status: null, detail: 'not configured' };
  try {
    await getJson<Array<{ id: string }>>(`${CF_API}/accounts/${account()}/storage/kv/namespaces?per_page=1`);
  } catch (e) {
    return { ok: false, status: null, detail: `the account cannot be reached: ${e instanceof Error ? e.message : String(e)}` };
  }
  try {
    const zone = await readZone();
    if (!zone) return { ok: false, status: 'no_zone', detail: `the token reaches the account but ${WORKSHOP_ZONE_NAME()} is not on it` };
    return { ok: true, status: 'active', detail: `reaches the account and ${zone.name} (${zone.status})` };
  } catch (e) {
    return { ok: false, status: null, detail: `the zone cannot be read: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function readZone(name = WORKSHOP_ZONE_NAME()): Promise<ZoneFacts | null> {
  const r = await getJson<Array<{ id: string; name: string; status: string; name_servers?: string[]; paused?: boolean }>>(`${CF_API}/zones?name=${encodeURIComponent(name)}`);
  const z = r.result[0];
  return z ? { id: z.id, name: z.name, status: z.status, nameServers: z.name_servers ?? [], paused: Boolean(z.paused) } : null;
}

export async function readDnsRecords(zoneId: string, filter: { type?: string; name?: string } = {}): Promise<DnsRecord[]> {
  const q = new URLSearchParams({ per_page: '200' });
  if (filter.type) q.set('type', filter.type);
  if (filter.name) q.set('name', filter.name);
  const r = await getJson<Array<Record<string, unknown>>>(`${CF_API}/zones/${pathSegment(zoneId, 'zone_id')}/dns_records?${q.toString()}`);
  return r.result.map((x) => ({ id: String(x.id), type: String(x.type), name: String(x.name), content: String(x.content), ttl: Number(x.ttl), priority: x.priority == null ? null : Number(x.priority), proxied: Boolean(x.proxied) }));
}

export async function readKvValue(namespaceId: string, key: string): Promise<string | null> {
  const response = await withRetry(() => fetch(`${CF_API}/accounts/${account()}/storage/kv/namespaces/${pathSegment(namespaceId, 'kv_namespace_id')}/values/${encodeURIComponent(key)}`, { headers: auth() }), { timeoutMs: CF_TIMEOUT_MS, maxRetries: 2 });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Cloudflare ${response.status} reading a store value`);
  return await response.text();
}

export async function listKvKeys(namespaceId: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const q = new URLSearchParams({ prefix, limit: '1000' });
    if (cursor) q.set('cursor', cursor);
    const r = await getJson<Array<{ name: string }>>(`${CF_API}/accounts/${account()}/storage/kv/namespaces/${pathSegment(namespaceId, 'kv_namespace_id')}/keys?${q.toString()}`);
    out.push(...r.result.map((k) => k.name));
    cursor = r.result_info?.cursor || undefined;
  } while (cursor);
  return out;
}

export async function readKvNamespaces(): Promise<Array<{ id: string; title: string }>> {
  const r = await getJson<Array<{ id: string; title: string }>>(`${CF_API}/accounts/${account()}/storage/kv/namespaces?per_page=100`);
  return r.result.map((n) => ({ id: n.id, title: n.title }));
}

export async function readWorkerScript(name: string): Promise<{ present: boolean; source: string | null }> {
  const response = await withRetry(() => fetch(`${CF_API}/accounts/${account()}/workers/scripts/${pathSegment(name, 'worker_name')}`, { headers: auth() }), { timeoutMs: CF_TIMEOUT_MS, maxRetries: 1 });
  if (response.status === 404) return { present: false, source: null };
  if (!response.ok) throw new Error(`Cloudflare ${response.status} reading the program`);
  const text = await response.text();
  // A module worker comes back as multipart; the source is the text between the part headers.
  const m = /\r?\n\r?\n([\s\S]*?)\r?\n--/.exec(text);
  return { present: true, source: m ? m[1] : text };
}

export async function readWorkerDomains(): Promise<Array<{ id: string; hostname: string; service: string; zoneId: string }>> {
  const r = await getJson<Array<{ id: string; hostname: string; service: string; zone_id: string }>>(`${CF_API}/accounts/${account()}/workers/domains`);
  return r.result.map((d) => ({ id: d.id, hostname: d.hostname, service: d.service, zoneId: d.zone_id }));
}

export async function readEmailRouting(zoneId: string): Promise<{ enabled: boolean; status: string | null; rules: Array<{ id: string; to: string; forwardTo: string[]; enabled: boolean }>; destinations: Array<{ email: string; verified: boolean }> }> {
  const settings = await getJson<{ enabled: boolean; status?: string }>(`${CF_API}/zones/${pathSegment(zoneId, 'zone_id')}/email/routing`).catch(() => null);
  const rules = settings?.result.enabled
    ? (await getJson<Array<{ id: string; enabled: boolean; matchers: Array<{ field?: string; value?: string; type: string }>; actions: Array<{ type: string; value?: string[] }> }>>(`${CF_API}/zones/${pathSegment(zoneId, 'zone_id')}/email/routing/rules`)).result
    : [];
  const destinations = (await getJson<Array<{ email: string; verified?: string | null }>>(`${CF_API}/accounts/${account()}/email/routing/addresses`).catch(() => ({ result: [] as Array<{ email: string; verified?: string | null }> }))).result;
  return {
    enabled: Boolean(settings?.result.enabled), status: settings?.result.status ?? null,
    rules: rules.map((r) => ({ id: r.id, to: r.matchers.find((m) => m.field === 'to')?.value ?? '*', forwardTo: r.actions.find((a) => a.type === 'forward')?.value ?? [], enabled: r.enabled })),
    destinations: destinations.map((d) => ({ email: d.email, verified: Boolean(d.verified) })),
  };
}

// ─── The envelope ────────────────────────────────────────────────────────────

const DNS_TYPES = new Set(['A', 'AAAA', 'CNAME', 'TXT', 'MX']);

function insideTheZone(name: string, zone: string): string {
  const n = name.toLowerCase().replace(/\.$/, '');
  if (n !== zone && !n.endsWith(`.${zone}`)) throw new CloudflareRefused('outside_the_workshop_zone', `${n} is not in ${zone}`);
  if (n.includes('*')) throw new CloudflareRefused('no_wildcards', n);
  return n;
}
async function workshopZone(named: unknown): Promise<ZoneFacts> {
  const zone = WORKSHOP_ZONE_NAME();
  if (String(named ?? '').toLowerCase() !== zone) throw new CloudflareRefused('outside_the_workshop_zone', `${String(named)} is not the Workshop's zone`);
  const z = await readZone(zone);
  if (!z) throw new CloudflareRefused('zone_not_found', zone);
  return z;
}
const purposeOf = (params: Record<string, unknown>): string => {
  const p = String(params.purpose ?? '').trim();
  if (!p) throw new CloudflareRefused('purpose_required');
  return p;
};

// ─── Receipts ────────────────────────────────────────────────────────────────

interface Receipt {
  req: GatewayRequest; resource: string; purpose: string;
  previous: unknown; requested: unknown; response?: unknown; outcome: 'applied' | 'refused' | 'failed';
  verification?: unknown; rollback?: unknown;
}
async function receipt(r: Receipt): Promise<string> {
  const owner = (await query('SELECT owner_id FROM products WHERE id = ?', [r.req.productId])).rows[0] as Record<string, unknown> | undefined;
  if (!owner) throw new Error('receipt for a product that does not exist');
  const id = nanoid();
  await query(
    `INSERT INTO cloudflare_mutations (id, founder_id, product_id, tool, resource, purpose, authority, previous_json, requested_json, response_json, outcome, verification_json, verified_at, rollback_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, String(owner.owner_id), r.req.productId, r.req.tool, r.resource, r.purpose, `outbound_door:${r.req.tool}:${r.req.dedupKey ?? 'no-dedup'}`,
      r.previous === undefined ? null : JSON.stringify(r.previous), JSON.stringify(r.requested), r.response === undefined ? null : JSON.stringify(r.response),
      r.outcome, r.verification === undefined ? null : JSON.stringify(r.verification), r.verification === undefined ? null : new Date().toISOString(),
      r.rollback === undefined ? null : JSON.stringify(r.rollback)]);
  return id;
}

/** Run one mutation with its receipt: refusals and failures are recorded too.
 * The resource and purpose are read lazily, so a request refused for being
 * outside the envelope still leaves a receipt saying what was asked. */
async function withReceipt<T>(req: GatewayRequest, resourceOf: () => string, purposeOf_: () => string, requested: unknown, body: () => Promise<{ previous: unknown; response: unknown; verification: unknown; rollback: unknown; result: T }>): Promise<T> {
  const safely = (fn: () => string, fallback: string): string => { try { return fn() || fallback; } catch { return fallback; } };
  const resource = safely(resourceOf, `${req.tool}:${JSON.stringify(requested).slice(0, 120)}`);
  const purpose = safely(purposeOf_, '(no purpose given)');
  try {
    const done = await body();
    const id = await receipt({ req, resource, purpose, previous: done.previous, requested, response: done.response, outcome: 'applied', verification: done.verification, rollback: done.rollback });
    log.info('cloudflare.mutation.applied', { tool: req.tool, resource, receipt: id });
    return done.result;
  } catch (error) {
    const refused = error instanceof CloudflareRefused;
    await receipt({ req, resource, purpose, previous: undefined, requested, response: { error: error instanceof Error ? error.message : String(error) }, outcome: refused ? 'refused' : 'failed' }).catch(() => undefined);
    throw error;
  }
}

// ─── Handlers ────────────────────────────────────────────────────────────────

/** cloudflare_kv_namespace_create: the one store the Workshop's pages are
 * served from. Nobody outside sees it, so its rung is 'prepare'; it is made
 * through the door all the same, because it mutates the owner's account and
 * every mutation of his account leaves a receipt. Made once: an existing
 * store of the same name is returned rather than a second one created. */
async function kvNamespaceCreateHandler(req: GatewayRequest): Promise<{ id: string; created: boolean }> {
  const p = req.params as { title: string; purpose: string };
  const title = String(p.title ?? '');
  return withReceipt(req, () => `kv_namespace:${title}`, () => purposeOf(req.params), { title }, async () => {
    purposeOf(req.params);
    if (!/^[a-z0-9-]{3,64}$/.test(title)) throw new CloudflareRefused('title_invalid', title);
    const before = await readKvNamespaces();
    const existing = before.find((n) => n.title === title);
    if (existing) return { previous: existing, response: { unchanged: true }, verification: { present: true }, rollback: null, result: { id: existing.id, created: false as boolean } };
    const response = await withRetry(() => fetch(`${CF_API}/accounts/${account()}/storage/kv/namespaces`, { method: 'POST', headers: auth({ 'Content-Type': 'application/json' }), body: JSON.stringify({ title }) }), { timeoutMs: CF_TIMEOUT_MS, maxRetries: 1 });
    const said = await cfRead<{ id: string }>(response);
    const after = (await readKvNamespaces()).find((n) => n.id === said.result.id);
    return { previous: null, response: said.result, verification: { present: Boolean(after) }, rollback: { note: 'a store is not deleted automatically; the pages in it are the record' }, result: { id: said.result.id, created: true as boolean } };
  });
}

/** cloudflare_kv_put: a page (or a small record) into the Workshop's store, then read back. */
async function kvPutHandler(req: GatewayRequest): Promise<{ key: string; bytes: number; verified: boolean }> {
  const p = req.params as { namespace_id: string; key: string; value: string; purpose: string };
  const key = String(p.key ?? '');
  const value = String(p.value ?? '');
  return withReceipt(req, () => `kv:${String(p.namespace_id)}/${key}`, () => purposeOf(req.params), { key, bytes: value.length, digest: digestOf(value) }, async () => {
    purposeOf(req.params);
    const ns = pathSegment(p.namespace_id, 'kv_namespace_id');
    if (!key || key.length > 512 || /[\s]/.test(key)) throw new CloudflareRefused('key_invalid');
    if (!value) throw new CloudflareRefused('value_required');
    const previous = await readKvValue(ns, key);
    const response = await withRetry(() => fetch(`${CF_API}/accounts/${account()}/storage/kv/namespaces/${pathSegment(ns, 'kv_namespace_id')}/values/${encodeURIComponent(key)}`, { method: 'PUT', headers: auth({ 'Content-Type': 'text/plain; charset=utf-8' }), body: value }), { timeoutMs: CF_TIMEOUT_MS, maxRetries: 1 });
    const said = await cfRead<unknown>(response);
    const after = await readKvValue(ns, key);
    const verified = after === value;
    return { previous: previous === null ? null : { digest: digestOf(previous), bytes: previous.length }, response: said, verification: { readBack: verified, digest: after === null ? null : digestOf(after) },
      rollback: previous === null ? { delete: key } : { put: key, digest: digestOf(previous), value: previous.length <= 65_536 ? previous : null }, result: { key, bytes: value.length, verified } };
  });
}

/** cloudflare_kv_delete: an opt-out record the institution has already kept. Never a page. */
async function kvDeleteHandler(req: GatewayRequest): Promise<{ key: string; gone: boolean }> {
  const p = req.params as { namespace_id: string; key: string; purpose: string };
  const key = String(p.key ?? '');
  return withReceipt(req, () => `kv:${String(p.namespace_id)}/${key}`, () => purposeOf(req.params), { delete: key }, async () => {
    purposeOf(req.params);
    const ns = pathSegment(p.namespace_id, 'kv_namespace_id');
    if (!key) throw new CloudflareRefused('key_invalid');
    if (key.startsWith('page:')) throw new CloudflareRefused('pages_are_never_deleted', key);
    const previous = await readKvValue(ns, key);
    const response = await withRetry(() => fetch(`${CF_API}/accounts/${account()}/storage/kv/namespaces/${pathSegment(ns, 'kv_namespace_id')}/values/${encodeURIComponent(key)}`, { method: 'DELETE', headers: auth() }), { timeoutMs: CF_TIMEOUT_MS, maxRetries: 1 });
    const said = response.status === 404 ? { success: true, result: null } : await cfRead<unknown>(response);
    const after = await readKvValue(ns, key);
    return { previous: previous === null ? null : { value: previous }, response: said, verification: { gone: after === null }, rollback: previous === null ? null : { put: key, value: previous }, result: { key, gone: after === null } };
  });
}

/** cloudflare_dns_upsert: one record on the Workshop's own zone, keeping what it replaced. */
async function dnsUpsertHandler(req: GatewayRequest): Promise<{ id: string; changed: boolean; verified: boolean }> {
  const p = req.params as { zone_name: string; type: string; name: string; content: string; ttl?: number; priority?: number; proxied?: boolean; purpose: string };
  const type = String(p.type ?? '').toUpperCase();
  const content = String(p.content ?? '').trim();
  const wanted = { type, name: String(p.name ?? '').toLowerCase(), content, ttl: Number(p.ttl ?? 1), ...(type === 'MX' ? { priority: Number(p.priority ?? 10) } : {}), ...(type === 'A' || type === 'AAAA' || type === 'CNAME' ? { proxied: Boolean(p.proxied ?? false) } : {}) };
  return withReceipt(req, () => `dns:${String(p.zone_name)}/${type}/${wanted.name}`, () => purposeOf(req.params), wanted, async () => {
    purposeOf(req.params);
    const z = await workshopZone(p.zone_name);
    if (!DNS_TYPES.has(type)) throw new CloudflareRefused('record_type_outside_envelope', type);
    const name = insideTheZone(wanted.name, z.name);
    if (!content) throw new CloudflareRefused('content_required');
    const existing = await readDnsRecords(z.id, { type, name });
    const same = existing.find((r) => r.content === content && (type !== 'MX' || r.priority === wanted.priority));
    if (same) {
      return { previous: same, response: { unchanged: true }, verification: { present: true }, rollback: null, result: { id: same.id, changed: false as boolean, verified: true as boolean } };
    }
    // TXT records coexist; the others replace the one of the same name.
    const replace = type === 'TXT' ? null : existing[0] ?? null;
    const response = replace
      ? await withRetry(() => fetch(`${CF_API}/zones/${pathSegment(z.id, 'zone_id')}/dns_records/${pathSegment(replace.id, 'dns_record_id')}`, { method: 'PATCH', headers: auth({ 'Content-Type': 'application/json' }), body: JSON.stringify(wanted) }), { timeoutMs: CF_TIMEOUT_MS, maxRetries: 1 })
      : await withRetry(() => fetch(`${CF_API}/zones/${pathSegment(z.id, 'zone_id')}/dns_records`, { method: 'POST', headers: auth({ 'Content-Type': 'application/json' }), body: JSON.stringify(wanted) }), { timeoutMs: CF_TIMEOUT_MS, maxRetries: 1 });
    const said = await cfRead<{ id: string }>(response);
    const after = await readDnsRecords(z.id, { type, name });
    const verified = after.some((r) => r.content === content);
    return { previous: replace, response: said.result, verification: { present: verified, records: after },
      rollback: replace ? { patch: replace.id, to: { type: replace.type, name: replace.name, content: replace.content, ttl: replace.ttl, priority: replace.priority, proxied: replace.proxied } } : { delete: said.result.id },
      result: { id: said.result.id, changed: true, verified } };
  });
}

/** cloudflare_dns_delete: one record off the Workshop's own zone, keeping what it was. */
async function dnsDeleteHandler(req: GatewayRequest): Promise<{ id: string; gone: boolean }> {
  const p = req.params as { zone_name: string; record_id: string; purpose: string };
  return withReceipt(req, () => `dns:${String(p.zone_name)}/record/${String(p.record_id)}`, () => purposeOf(req.params), { delete: String(p.record_id) }, async () => {
    purposeOf(req.params);
    const z = await workshopZone(p.zone_name);
    const recordId = pathSegment(p.record_id, 'dns_record_id');
    const previous = (await readDnsRecords(z.id)).find((r) => r.id === recordId);
    if (!previous) throw new CloudflareRefused('record_not_found', recordId);
    if (!DNS_TYPES.has(previous.type)) throw new CloudflareRefused('record_type_outside_envelope', previous.type);
    insideTheZone(previous.name, z.name);
    const response = await withRetry(() => fetch(`${CF_API}/zones/${pathSegment(z.id, 'zone_id')}/dns_records/${pathSegment(recordId, 'dns_record_id')}`, { method: 'DELETE', headers: auth() }), { timeoutMs: CF_TIMEOUT_MS, maxRetries: 1 });
    const said = await cfRead<unknown>(response);
    const after = (await readDnsRecords(z.id, { type: previous.type, name: previous.name })).some((r) => r.id === recordId);
    return { previous, response: said, verification: { gone: !after }, rollback: { create: { type: previous.type, name: previous.name, content: previous.content, ttl: previous.ttl, priority: previous.priority, proxied: previous.proxied } }, result: { id: recordId, gone: !after } };
  });
}

/** cloudflare_worker_deploy: the Workshop's one public program, bound to its one store. */
async function workerDeployHandler(req: GatewayRequest): Promise<{ name: string; digest: string; verified: boolean }> {
  const p = req.params as { script_name: string; source: string; kv_namespace_id: string; purpose: string };
  const name = String(p.script_name ?? '');
  const source = String(p.source ?? '');
  const metadata = { main_module: 'worker.js', compatibility_date: '2026-06-01', bindings: [{ type: 'kv_namespace', name: 'PAGES', namespace_id: String(p.kv_namespace_id ?? '') }] };
  return withReceipt(req, () => `worker:${name}`, () => purposeOf(req.params), { digest: digestOf(source), bytes: source.length, metadata }, async () => {
    purposeOf(req.params);
    if (name !== WORKSHOP_WORKER_NAME()) throw new CloudflareRefused('not_the_workshop_program', name);
    if (!source.includes('export default')) throw new CloudflareRefused('source_invalid');
    pathSegment(p.kv_namespace_id, 'kv_namespace_id');
    const before = await readWorkerScript(name);
    const form = new FormData();
    form.set('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }), 'metadata.json');
    form.set('worker.js', new Blob([source], { type: 'application/javascript+module' }), 'worker.js');
    const response = await withRetry(() => fetch(`${CF_API}/accounts/${account()}/workers/scripts/${pathSegment(name, 'worker_name')}`, { method: 'PUT', headers: auth(), body: form }), { timeoutMs: 30_000, maxRetries: 1 });
    const said = await cfRead<{ id?: string; etag?: string }>(response);
    const after = await readWorkerScript(name);
    const verified = after.present && after.source !== null && digestOf(after.source) === digestOf(source);
    return { previous: before.present ? { digest: before.source === null ? null : digestOf(before.source), bytes: before.source?.length ?? null } : null, response: said.result, verification: { present: after.present, digestMatches: verified },
      rollback: before.present && before.source ? { deploy: { digest: digestOf(before.source), source: before.source.length <= 65_536 ? before.source : null } } : { delete: name }, result: { name, digest: digestOf(source), verified } };
  });
}

/** cloudflare_domain_attach: the Workshop's own apex or www onto its program. */
async function domainAttachHandler(req: GatewayRequest): Promise<{ hostname: string; verified: boolean }> {
  const p = req.params as { zone_name: string; hostname: string; service: string; purpose: string };
  const hostname = String(p.hostname ?? '').toLowerCase();
  const service = String(p.service ?? '');
  return withReceipt(req, () => `domain:${hostname}`, () => purposeOf(req.params), { hostname, service, environment: 'production' }, async () => {
    purposeOf(req.params);
    const z = await workshopZone(p.zone_name);
    insideTheZone(hostname, z.name);
    if (hostname !== z.name && hostname !== `www.${z.name}`) throw new CloudflareRefused('hostname_outside_envelope', hostname);
    if (service !== WORKSHOP_WORKER_NAME()) throw new CloudflareRefused('not_the_workshop_program', service);
    const wanted = { zone_id: z.id, hostname, service, environment: 'production' };
    const before = (await readWorkerDomains()).find((d) => d.hostname === hostname) ?? null;
    if (before && before.service === service) return { previous: before, response: { unchanged: true }, verification: { attached: true }, rollback: null, result: { hostname, verified: true as boolean } };
    const response = await withRetry(() => fetch(`${CF_API}/accounts/${account()}/workers/domains`, { method: 'PUT', headers: auth({ 'Content-Type': 'application/json' }), body: JSON.stringify(wanted) }), { timeoutMs: CF_TIMEOUT_MS, maxRetries: 1 });
    const said = await cfRead<{ id: string }>(response);
    const after = (await readWorkerDomains()).find((d) => d.hostname === hostname);
    return { previous: before, response: said.result, verification: { attached: Boolean(after && after.service === service) }, rollback: before ? { reattach: before } : { detach: said.result.id }, result: { hostname, verified: Boolean(after && after.service === service) } };
  });
}

/** cloudflare_email_route_upsert: mail to the Workshop's address forwarded to the owner. */
async function emailRouteHandler(req: GatewayRequest): Promise<{ to: string; forwardTo: string; destinationVerified: boolean; enabled: boolean }> {
  const p = req.params as { zone_name: string; to: string; forward_to: string; purpose: string };
  const to = String(p.to ?? '').toLowerCase().trim();
  const forwardTo = String(p.forward_to ?? '').toLowerCase().trim();
  return withReceipt(req, () => `email_route:${String(p.zone_name)}/${to}`, () => purposeOf(req.params), { to, forwardTo }, async () => {
    purposeOf(req.params);
    const z = await workshopZone(p.zone_name);
    if (!to.endsWith(`@${z.name}`)) throw new CloudflareRefused('address_outside_envelope', to);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(forwardTo)) throw new CloudflareRefused('destination_invalid');
    const before = await readEmailRouting(z.id);
    const steps: Record<string, unknown> = {};
    if (!before.enabled) {
      // Turning routing on writes the zone's inbound MX; the previous mail
      // records are read first and kept in the receipt.
      //
      // THE APEX IS ENABLED, NOT ADDED. `/email/routing/dns` adds the records
      // for routing a SUBDOMAIN and refuses the zone itself — "must be a
      // subdomain of apexmicro.ai", which reads like a validation quibble and
      // is actually the wrong endpoint. `/email/routing/enable` is the one that
      // turns routing on for the zone and writes its MX. Found by doing it to a
      // real zone; no stub had an opinion about which URL was correct.
      const mxBefore = await readDnsRecords(z.id, { type: 'MX', name: z.name });
      steps.mxBefore = mxBefore;
      const response = await withRetry(() => fetch(`${CF_API}/zones/${pathSegment(z.id, 'zone_id')}/email/routing/enable`, { method: 'POST', headers: auth({ 'Content-Type': 'application/json' }), body: '{}' }), { timeoutMs: CF_TIMEOUT_MS, maxRetries: 1 });
      steps.enable = await cfRead<unknown>(response).then((r) => r.result).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
    }
    if (!before.destinations.some((d) => d.email === forwardTo)) {
      const response = await withRetry(() => fetch(`${CF_API}/accounts/${account()}/email/routing/addresses`, { method: 'POST', headers: auth({ 'Content-Type': 'application/json' }), body: JSON.stringify({ email: forwardTo }) }), { timeoutMs: CF_TIMEOUT_MS, maxRetries: 1 });
      steps.destination = (await cfRead<unknown>(response)).result;
    }
    const rule = { name: `Workshop: ${to}`, enabled: true, matchers: [{ type: 'literal', field: 'to', value: to }], actions: [{ type: 'forward', value: [forwardTo] }] };
    const existing = before.rules.find((r) => r.to === to);
    const response = existing
      ? await withRetry(() => fetch(`${CF_API}/zones/${pathSegment(z.id, 'zone_id')}/email/routing/rules/${pathSegment(existing.id, 'email_rule_id')}`, { method: 'PUT', headers: auth({ 'Content-Type': 'application/json' }), body: JSON.stringify(rule) }), { timeoutMs: CF_TIMEOUT_MS, maxRetries: 1 })
      : await withRetry(() => fetch(`${CF_API}/zones/${pathSegment(z.id, 'zone_id')}/email/routing/rules`, { method: 'POST', headers: auth({ 'Content-Type': 'application/json' }), body: JSON.stringify(rule) }), { timeoutMs: CF_TIMEOUT_MS, maxRetries: 1 });
    steps.rule = (await cfRead<unknown>(response)).result;
    const after = await readEmailRouting(z.id);
    const present = after.rules.find((r) => r.to === to);
    const destinationVerified = after.destinations.some((d) => d.email === forwardTo && d.verified);
    return { previous: before, response: steps, verification: { ruleForwards: present?.forwardTo ?? [], destinationVerified, enabled: after.enabled },
      rollback: existing ? { rule: existing } : { deleteRule: present?.id ?? null, disableRouting: !before.enabled },
      result: { to, forwardTo, destinationVerified, enabled: after.enabled } };
  });
}

export function digestOf(s: string): string { return createHash('sha256').update(s).digest('hex').slice(0, 32); }

// ─── Registration ────────────────────────────────────────────────────────────
// One actor for the public membrane; nothing here is addressed to a person, so
// no recipient budget applies; every effect carries its at-most-once key.
export const CLOUDFLARE_POLICY = {
  actor: 'workshop_keeper', surface: 'public_workshop', dataClass: 'general',
  requireDedupKey: true, requireCustomerExternalId: false,
} as const;
registerToolHandler('cloudflare_kv_namespace_create', kvNamespaceCreateHandler, CLOUDFLARE_POLICY);
registerToolHandler('cloudflare_kv_put', kvPutHandler, CLOUDFLARE_POLICY);
registerToolHandler('cloudflare_kv_delete', kvDeleteHandler, CLOUDFLARE_POLICY);
registerToolHandler('cloudflare_dns_upsert', dnsUpsertHandler, CLOUDFLARE_POLICY);
registerToolHandler('cloudflare_dns_delete', dnsDeleteHandler, CLOUDFLARE_POLICY);
registerToolHandler('cloudflare_worker_deploy', workerDeployHandler, CLOUDFLARE_POLICY);
registerToolHandler('cloudflare_domain_attach', domainAttachHandler, CLOUDFLARE_POLICY);
registerToolHandler('cloudflare_email_route_upsert', emailRouteHandler, CLOUDFLARE_POLICY);

export { kvNamespaceCreateHandler, kvPutHandler, kvDeleteHandler, dnsUpsertHandler, dnsDeleteHandler, workerDeployHandler, domainAttachHandler, emailRouteHandler };
