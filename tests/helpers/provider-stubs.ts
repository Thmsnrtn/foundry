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
  const state: ProviderState = { sends: [], deliveryState: new Map(), refunds: [], domains: [], nextDomainStatus: 'pending', products: [], prices: [], paymentLinks: [], buyers: new Map(), calls: [], seq: 0 };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchStub = async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const u = String(url); const method = init?.method ?? 'GET';
    const headers = (init?.headers ?? {}) as Record<string, string>;
    state.calls.push(`${method} ${u}`);

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
