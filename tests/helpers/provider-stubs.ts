// =============================================================================
// Provider stubs for rehearsals: Resend (send, receipts, domains) and Stripe
// (payment links, catalog, refunds). Shape-faithful, in memory, no network.
// A rehearsal against these proves the institution's loop, never the market.
// =============================================================================

export interface ProviderState {
  sends: Array<{ to: string[]; from: string; subject: string; text?: string; html: string; reply_to?: string; idempotency: string; id: string }>;
  deliveryState: Map<string, string>;
  refunds: Array<{ body: string; idempotency: string }>;
  domains: Array<{ id: string; name: string; status: string; records: Array<Record<string, unknown>> }>;
  /** Flip to 'verified' to simulate the registrar step being done. */
  nextDomainStatus: string;
  products: Array<{ id: string; name: string; metadata: Record<string, string> }>;
  prices: Array<{ id: string; product: string; unit_amount: number; currency: string; lookup_key: string; recurring: null; metadata: Record<string, string> }>;
  paymentLinks: Array<{ id: string; url: string; active: boolean; metadata: Record<string, string>; payment_intent_data: { metadata: Record<string, string> } | null; line_items: Array<{ price: string; quantity: number }> }>;
  /** payment_intent id → the buyer's address Stripe would report. */
  buyers: Map<string, string>;
  calls: string[];
  seq: number;
  /** Cloudflare, shape-faithful: the zone, its records, the store, the program, the hostnames, mail routing. */
  cf: CloudflareState;
}

export interface CloudflareState {
  token: 'active' | 'invalid';
  zones: Array<{ id: string; name: string; status: string; name_servers: string[] }>;
  dns: Array<{ id: string; zone_id: string; type: string; name: string; content: string; ttl: number; priority: number | null; proxied: boolean }>;
  namespaces: Array<{ id: string; title: string }>;
  kv: Map<string, Map<string, string>>;
  workers: Map<string, { source: string; bindings: unknown[] }>;
  domains: Array<{ id: string; hostname: string; service: string; zone_id: string }>;
  routing: { enabled: boolean; rules: Array<{ id: string; enabled: boolean; matchers: Array<{ type: string; field?: string; value?: string }>; actions: Array<{ type: string; value?: string[] }> }>; destinations: Array<{ email: string; verified: string | null }> };
  /** When true the public site answers 503 whatever the store holds: a provider that said yes to a page nobody can see. */
  siteDown: boolean;
}

export function freshCloudflare(): CloudflareState {
  return {
    token: 'active',
    zones: [{ id: 'zone_apex', name: 'apexmicro.ai', status: 'active', name_servers: ['anton.ns.cloudflare.com', 'peaches.ns.cloudflare.com'] }],
    // The reality found on the zone: root and www pointing at an anycast address with nothing behind it.
    dns: [
      { id: 'rec_a', zone_id: 'zone_apex', type: 'A', name: 'apexmicro.ai', content: '66.241.124.62', ttl: 1, priority: null, proxied: false },
      { id: 'rec_aaaa', zone_id: 'zone_apex', type: 'AAAA', name: 'apexmicro.ai', content: '2a09:8280:1::d6:872d:0', ttl: 1, priority: null, proxied: false },
      { id: 'rec_www', zone_id: 'zone_apex', type: 'A', name: 'www.apexmicro.ai', content: '66.241.124.62', ttl: 1, priority: null, proxied: false },
      { id: 'rec_gsv', zone_id: 'zone_apex', type: 'TXT', name: 'apexmicro.ai', content: 'google-site-verification=abc', ttl: 1, priority: null, proxied: false },
    ],
    namespaces: [], kv: new Map(), workers: new Map(), domains: [],
    routing: { enabled: false, rules: [], destinations: [] }, siteDown: false,
  };
}

function form(body: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(String(body ?? ''))) out[k] = v;
  return out;
}
function nested(params: Record<string, string>, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) { const m = new RegExp(`^${prefix.replace(/[[\]]/g, '\\$&')}\\[([^\\]]+)\\]$`).exec(k); if (m) out[m[1]] = v; }
  return out;
}

export function providerStubs(): { state: ProviderState; fetch: (url: string | URL, init?: RequestInit) => Promise<Response> } {
  const state: ProviderState = { sends: [], deliveryState: new Map(), refunds: [], domains: [], nextDomainStatus: 'pending', products: [], prices: [], paymentLinks: [], buyers: new Map(), calls: [], seq: 0, cf: freshCloudflare() };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const cfOk = (result: unknown, status = 200) => json({ success: true, result, errors: [] }, status);
  const cfErr = (code: number, message: string, status = 400) => json({ success: false, result: null, errors: [{ code, message }] }, status);
  const fetchStub = async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const u = String(url); const method = init?.method ?? 'GET';
    const headers = (init?.headers ?? {}) as Record<string, string>;
    state.calls.push(`${method} ${u}`);

    // ── The public Workshop, as the world sees it: the program serving the store ──
    const site = /^https:\/\/(www\.)?apexmicro\.ai(\/[^?#]*)?$/.exec(u);
    if (site) {
      const cf = state.cf;
      const served = cf.workers.has('apexmicro') && cf.domains.some((d) => d.hostname === 'apexmicro.ai' && d.service === 'apexmicro');
      if (!served || cf.siteDown) return new Response('Service Unavailable', { status: 503 });
      if (site[1]) return new Response('', { status: 301, headers: { location: `https://apexmicro.ai${site[2] ?? '/'}` } });
      const path = (site[2] ?? '/').replace(/\/+$/, '') || '/';
      const ns = cf.namespaces.find((n) => n.title === 'apexmicro-pages');
      const store = ns ? cf.kv.get(ns.id) : undefined;
      if (method === 'POST' && path === '/email/opt-out') {
        const email = String(new URLSearchParams(String(init?.body ?? '')).get('email') ?? '').trim().toLowerCase();
        if (!email || !email.includes('@')) return new Response('An email address is needed.', { status: 400 });
        store?.set(`optout:${++state.seq}`, JSON.stringify({ email, at: new Date().toISOString() }));
        return new Response(store?.get('page:/email/done') ?? 'Done', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
      if (method !== 'GET' && method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
      const html = /[^a-z0-9/-]/.test(path) ? undefined : store?.get(`page:${path}`);
      return html === undefined ? new Response(store?.get('page:/404') ?? 'Not found', { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } })
        : new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }

    // ── Cloudflare API ──
    if (u.startsWith('https://api.cloudflare.com/client/v4/')) {
      const cf = state.cf;
      const bearer = String(headers.Authorization ?? '');
      if (cf.token !== 'active' || !bearer.startsWith('Bearer ')) return cfErr(1000, 'Invalid API Token', 401);
      const rel = u.slice('https://api.cloudflare.com/client/v4'.length);
      const [pathOnly, qs] = rel.split('?'); const q = new URLSearchParams(qs ?? '');
      const ct = String(headers['Content-Type'] ?? headers['content-type'] ?? '');
      const body = init?.body && typeof init.body === 'string' && ct.includes('json') ? JSON.parse(init.body) as Record<string, unknown> : {};
      if (pathOnly === '/user/tokens/verify') return cfOk({ id: 'tok', status: 'active' });
      if (pathOnly === '/zones') return cfOk(cf.zones.filter((z) => !q.get('name') || z.name === q.get('name')));
      let m = /^\/zones\/([^/]+)\/dns_records(?:\/([^/]+))?$/.exec(pathOnly);
      if (m) {
        const zone = cf.zones.find((z) => z.id === m![1]); if (!zone) return cfErr(7003, 'no such zone', 404);
        if (method === 'GET') return cfOk(cf.dns.filter((r) => r.zone_id === zone.id && (!q.get('type') || r.type === q.get('type')) && (!q.get('name') || r.name === q.get('name'))));
        if (method === 'POST') { const rec = { id: `rec_${++state.seq}`, zone_id: zone.id, type: String(body.type), name: String(body.name), content: String(body.content), ttl: Number(body.ttl ?? 1), priority: body.priority == null ? null : Number(body.priority), proxied: Boolean(body.proxied) }; cf.dns.push(rec); return cfOk(rec); }
        const rec = cf.dns.find((r) => r.id === m![2]); if (!rec) return cfErr(81044, 'record not found', 404);
        if (method === 'PATCH') { Object.assign(rec, { type: String(body.type ?? rec.type), name: String(body.name ?? rec.name), content: String(body.content ?? rec.content), ttl: Number(body.ttl ?? rec.ttl), priority: body.priority == null ? rec.priority : Number(body.priority), proxied: Boolean(body.proxied ?? rec.proxied) }); return cfOk(rec); }
        if (method === 'DELETE') { cf.dns.splice(cf.dns.indexOf(rec), 1); return cfOk({ id: rec.id }); }
      }
      if (pathOnly === '/accounts/acct_test/storage/kv/namespaces') {
        if (method === 'GET') return cfOk(cf.namespaces);
        const ns = { id: `ns_${++state.seq}`, title: String(body.title) }; cf.namespaces.push(ns); cf.kv.set(ns.id, new Map()); return cfOk(ns);
      }
      m = /^\/accounts\/acct_test\/storage\/kv\/namespaces\/([^/]+)\/(values|keys)(?:\/(.+))?$/.exec(pathOnly);
      if (m) {
        const store = cf.kv.get(m[1]); if (!store) return cfErr(10013, 'namespace not found', 404);
        if (m[2] === 'keys') return cfOk([...store.keys()].filter((k) => k.startsWith(q.get('prefix') ?? '')).map((name) => ({ name })), 200);
        const key = decodeURIComponent(m[3] ?? '');
        if (method === 'GET') { const v = store.get(key); return v === undefined ? new Response('', { status: 404 }) : new Response(v, { status: 200 }); }
        if (method === 'PUT') { store.set(key, String(init?.body ?? '')); return cfOk(null); }
        if (method === 'DELETE') { const had = store.delete(key); return had ? cfOk(null) : cfErr(10009, 'key not found', 404); }
      }
      m = /^\/accounts\/acct_test\/workers\/scripts\/([^/]+)$/.exec(pathOnly);
      if (m) {
        if (method === 'GET') { const w = cf.workers.get(m[1]); return w ? new Response(`--b\r\nContent-Disposition: form-data; name="worker.js"; filename="worker.js"\r\nContent-Type: application/javascript+module\r\n\r\n${w.source}\r\n--b--`, { status: 200 }) : new Response('', { status: 404 }); }
        if (method === 'PUT') {
          const form = init?.body as FormData;
          const source = await (form.get('worker.js') as Blob).text();
          const meta = JSON.parse(await (form.get('metadata') as Blob).text()) as { bindings: unknown[] };
          cf.workers.set(m[1], { source, bindings: meta.bindings }); return cfOk({ id: m[1], etag: `etag_${++state.seq}` });
        }
      }
      if (pathOnly === '/accounts/acct_test/workers/domains') {
        if (method === 'GET') return cfOk(cf.domains);
        if (method === 'PUT') {
          const hostname = String(body.hostname);
          if (cf.dns.some((r) => r.name === hostname && ['A', 'AAAA', 'CNAME'].includes(r.type))) return cfErr(100117, 'A DNS record already exists for this hostname', 409);
          const d = { id: `dom_${++state.seq}`, hostname, service: String(body.service), zone_id: String(body.zone_id) }; cf.domains.push(d); return cfOk(d);
        }
      }
      m = /^\/zones\/([^/]+)\/email\/routing(?:\/(dns|rules)(?:\/([^/]+))?)?$/.exec(pathOnly);
      if (m) {
        if (!m[2]) return cfOk({ enabled: cf.routing.enabled, status: cf.routing.enabled ? 'ready' : 'unconfigured' });
        if (m[2] === 'dns' && method === 'POST') { cf.routing.enabled = true; return cfOk({ enabled: true }); }
        if (m[2] === 'rules') {
          if (method === 'GET') return cfOk(cf.routing.rules);
          if (method === 'POST') { const rule = { id: `rule_${++state.seq}`, enabled: true, matchers: body.matchers as never, actions: body.actions as never }; cf.routing.rules.push(rule); return cfOk(rule); }
          if (method === 'PUT') { const rule = cf.routing.rules.find((r) => r.id === m![3]); if (!rule) return cfErr(2003, 'no rule', 404); Object.assign(rule, { matchers: body.matchers, actions: body.actions, enabled: Boolean(body.enabled) }); return cfOk(rule); }
        }
      }
      if (pathOnly === '/accounts/acct_test/email/routing/addresses') {
        if (method === 'GET') return cfOk(cf.routing.destinations);
        const d = { email: String(body.email), verified: null }; cf.routing.destinations.push(d); return cfOk(d);
      }
      throw new Error(`unexpected Cloudflare call in rehearsal: ${method} ${u}`);
    }

    // ── Resend ──
    if (u === 'https://api.resend.com/emails' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as ProviderState['sends'][number];
      const id = `msg_${++state.seq}`;
      state.sends.push({ ...body, idempotency: headers['Idempotency-Key'], id });
      state.deliveryState.set(id, state.deliveryState.get(`next:${body.to[0]}`) ?? 'delivered');
      return json({ id });
    }
    if (u.startsWith('https://api.resend.com/emails/')) {
      const id = decodeURIComponent(u.slice('https://api.resend.com/emails/'.length));
      return json({ id, last_event: state.deliveryState.get(id) ?? 'sent' });
    }
    if (u === 'https://api.resend.com/domains' && method === 'GET') return json({ data: state.domains.map((d) => ({ id: d.id, name: d.name, status: d.status })) });
    if (u === 'https://api.resend.com/domains' && method === 'POST') {
      const { name } = JSON.parse(String(init?.body)) as { name: string };
      const d = { id: `dom_${++state.seq}`, name, status: 'not_started', records: [
        { record: 'SPF', name: 'send', type: 'MX', ttl: 'Auto', status: 'not_started', value: 'feedback-smtp.us-east-1.amazonses.com', priority: 10 },
        { record: 'SPF', name: 'send', type: 'TXT', ttl: 'Auto', status: 'not_started', value: 'v=spf1 include:amazonses.com ~all' },
        { record: 'DKIM', name: 'resend._domainkey', type: 'TXT', ttl: 'Auto', status: 'not_started', value: 'p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQ' },
      ] };
      state.domains.push(d);
      return json(d, 201);
    }
    const dv = /^https:\/\/api\.resend\.com\/domains\/([^/]+)\/verify$/.exec(u);
    if (dv && method === 'POST') { const d = state.domains.find((x) => x.id === dv[1]); if (d) d.status = state.nextDomainStatus; return json({ object: 'domain', id: dv[1] }); }
    const dg = /^https:\/\/api\.resend\.com\/domains\/([^/]+)$/.exec(u);
    if (dg && method === 'GET') { const d = state.domains.find((x) => x.id === dg[1]); return d ? json(d) : json({ message: 'not found' }, 404); }

    // ── Stripe ──
    if (u === 'https://api.stripe.com/v1/refunds' && method === 'POST') {
      state.refunds.push({ body: String(init?.body), idempotency: headers['Idempotency-Key'] });
      return json({ id: `re_${state.refunds.length}`, status: 'succeeded', amount: 2900 });
    }
    if (u.startsWith('https://api.stripe.com/v1/prices?') && method === 'GET') {
      const key = new URL(u).searchParams.get('lookup_keys[]');
      return json({ data: state.prices.filter((p) => p.lookup_key === key) });
    }
    if (u === 'https://api.stripe.com/v1/products' && method === 'POST') {
      const p = form(init?.body); const product = { id: `prod_${++state.seq}`, name: p.name, metadata: nested(p, 'metadata') };
      state.products.push(product); return json(product);
    }
    if (u === 'https://api.stripe.com/v1/prices' && method === 'POST') {
      const p = form(init?.body); const price = { id: `price_${++state.seq}`, product: p.product, unit_amount: Number(p.unit_amount), currency: p.currency, lookup_key: p.lookup_key, recurring: null, metadata: nested(p, 'metadata') };
      state.prices.push(price); return json(price);
    }
    if (u === 'https://api.stripe.com/v1/payment_links' && method === 'POST') {
      const p = form(init?.body);
      const link = { id: `plink_${++state.seq}`, url: `https://buy.stripe.com/test_${state.seq}`, active: true, metadata: nested(p, 'metadata'),
        payment_intent_data: { metadata: nested(p, 'payment_intent_data[metadata]') }, line_items: [{ price: p['line_items[0][price]'], quantity: Number(p['line_items[0][quantity]'] ?? 1) }] };
      state.paymentLinks.push(link); return json(link);
    }
    const off = /^https:\/\/api\.stripe\.com\/v1\/payment_links\/([^/?]+)$/.exec(u);
    if (off && method === 'POST') {
      const link = state.paymentLinks.find((l) => l.id === decodeURIComponent(off[1]));
      if (!link) return json({ error: { message: 'no such payment_link' } }, 404);
      if (form(init?.body).active === 'false') link.active = false;
      return json({ id: link.id, url: link.url, active: link.active });
    }
    if (u.startsWith('https://api.stripe.com/v1/payment_links?') && method === 'GET') {
      return json({ data: state.paymentLinks.filter((l) => l.active).map(({ line_items, ...rest }) => { void line_items; return rest; }), has_more: false });
    }
    const li = /^https:\/\/api\.stripe\.com\/v1\/payment_links\/([^/]+)\/line_items/.exec(u);
    if (li && method === 'GET') {
      const link = state.paymentLinks.find((l) => l.id === li[1]);
      return json({ data: (link?.line_items ?? []).map((i) => { const price = state.prices.find((p) => p.id === i.price); return { quantity: i.quantity, price: price ? { id: price.id, unit_amount: price.unit_amount, currency: price.currency, recurring: price.recurring, lookup_key: price.lookup_key } : { id: i.price, unit_amount: null, currency: 'usd', recurring: null } }; }) });
    }
    const pi = /^https:\/\/api\.stripe\.com\/v1\/payment_intents\/([^/?]+)/.exec(u);
    if (pi && method === 'GET') {
      const id = decodeURIComponent(pi[1]);
      const email = state.buyers.get(id);
      return email === undefined ? json({ error: { message: 'no such payment_intent' } }, 404)
        : json({ id, receipt_email: email, latest_charge: { id: `ch_${id}`, billing_details: { email } } });
    }
    throw new Error(`unexpected network call in rehearsal: ${method} ${u}`);
  };
  return { state, fetch: fetchStub };
}

/** A hand-made link, as the owner would create it in the Stripe dashboard. */
export function seedHandMadeLink(state: ProviderState, opts: { experimentId: string; amount: number; recurring?: boolean; tagged?: boolean; tagIntent?: boolean }): string {
  const price = { id: `price_hand_${++state.seq}`, product: 'prod_hand', unit_amount: opts.amount, currency: 'usd', lookup_key: `hand_${state.seq}`, recurring: (opts.recurring ? { interval: 'month' } : null) as null, metadata: {} };
  state.prices.push(price);
  const link = { id: `plink_hand_${++state.seq}`, url: `https://buy.stripe.com/hand_${state.seq}`, active: true,
    metadata: opts.tagged === false ? {} : { app: 'foundry', experiment_id: opts.experimentId, primitive: 'sale' },
    payment_intent_data: opts.tagIntent === false ? null : { metadata: { app: 'foundry', experiment_id: opts.experimentId } }, line_items: [{ price: price.id, quantity: 1 }] };
  state.paymentLinks.push(link);
  return link.url;
}
