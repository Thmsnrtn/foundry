// =============================================================================
// FOUNDRY — THE STOREFRONT: one interface over every channel (F2).
//
//   placeOnChannel(founder, experiment, channel)
//     channel open? (his grant, a key, an API that can list)  →  his price
//     floor  →  the canonical listing (one product, one version, the AI
//     disclosure in it)  →  THROUGH THE OUTBOUND DOOR, three acts graded by
//     migration 339's capabilities: upload the file (prepare), create the
//     draft (prepare), enable it (public, drawing on the allowance — so it
//     needs his allowance or his exact approval, never only this code)  →
//     the listing is recorded with the version and disclosure it carries.
//
//   readChannel(founder, channel, since)
//     channel open for reading  →  the adapter reads what the channel says
//     →  reconcile.ts records it once, tied to the canonical product.
//
// The Workshop's own page is NOT placed here: it stays the live path, placed by
// the hand through `stripe_create_payment_link` as before. No channel is
// placed by anything but an explicit call; nothing here runs on a schedule
// until he opens a channel.
// =============================================================================
import { query } from '../../../db/client.js';
import { registerToolHandler, invoke, type GatewayRequest } from '../../outbound/gateway.js';
import { channelOpen, CHANNEL_NAMES, WHAT_THE_API_ALLOWS, type MarketChannel } from './channels.js';
import { canonicalListing, type CanonicalListing } from './canonical.js';
import { priceMeetsFloor } from './price-floor.js';
import { recordChannelSales } from './reconcile.js';

/** The adapter interface every channel implements, or refuses in words. */
export interface StorefrontAdapter {
  channel: MarketChannel;
  docs: readonly string[];
  /** What the channel's AI-disclosure rule is, and what this adapter applies. */
  aiDisclosure: string;
  readSales(founderId: string, since: Date, key: Record<string, string> | null, storeId?: string): Promise<import('./reconcile.js').ChannelSale[]>;
}

export const ADAPTERS: Readonly<Record<MarketChannel, StorefrontAdapter>> = Object.freeze({
  gumroad: {
    channel: 'gumroad', docs: WHAT_THE_API_ALLOWS.gumroad.docs, aiDisclosure: WHAT_THE_API_ALLOWS.gumroad.aiSetting,
    async readSales(_f, since, key) { const g = await import('./gumroad.js'); return g.readSales(tokenOf(key), since); },
  },
  lemonsqueezy: {
    channel: 'lemonsqueezy', docs: WHAT_THE_API_ALLOWS.lemonsqueezy.docs, aiDisclosure: WHAT_THE_API_ALLOWS.lemonsqueezy.aiSetting,
    async readSales(_f, since, key, storeId) {
      if (!storeId) throw new Error('your Lemon Squeezy grant names no store');
      const ls = await import('./lemonsqueezy.js');
      // A test-mode order is Lemon Squeezy's sandbox: never real revenue.
      return (await ls.readOrders(tokenOf(key), storeId, since)).filter((o) => !o.testMode).map(({ testMode: _t, ...o }) => o);
    },
  },
  etsy: {
    channel: 'etsy', docs: WHAT_THE_API_ALLOWS.etsy.docs, aiDisclosure: WHAT_THE_API_ALLOWS.etsy.aiSetting,
    // Read FROM the ledger the Etsy sense writes, where it is already
    // reconciled through fulfilments; never recorded a second time.
    async readSales(founderId, since) { const e = await import('./etsy.js'); return e.etsySalesFromLedger(founderId, since); },
  },
});

function tokenOf(key: Record<string, string> | null): string {
  const t = key?.token ?? key?.apiKey ?? '';
  if (!t) throw new Error('no API key is held for this channel');
  return t;
}

// ─── The door: Gumroad's three acts, each with a server-owned policy ─────────
//
// The handler never trusts the caller's listing: it recomposes the canonical
// listing from the rows by experiment id and refuses if the version the
// caller named is not the one for sale. The key is read inside the handler
// from the encrypted store; it is never a parameter.

const POLICY = { actor: 'storefront', surface: 'marketplace_listing', dataClass: 'general', requireDedupKey: true, requireCustomerExternalId: false } as const;

async function listingFor(req: GatewayRequest): Promise<{ l: CanonicalListing; token: string }> {
  const p = req.params as { founderId?: string; experimentId?: string; version?: number };
  if (!p.founderId || !p.experimentId) throw new Error('a channel act names its test');
  const l = await canonicalListing(p.founderId, p.experimentId);
  if ('refused' in l) throw new Error(l.refused);
  if (l.version !== p.version) throw new Error(`version ${String(p.version)} is not the version for sale (${String(l.version)})`);
  const open = await channelOpen(p.founderId, 'gumroad', 'list');
  if (!open.open) throw new Error(open.because);
  return { l, token: tokenOf(open.key) };
}

registerToolHandler('gumroad_upload_product_file', async (req) => {
  const { l, token } = await listingFor(req);
  const g = await import('./gumroad.js');
  return { fileUrl: await g.uploadFile(token, { filename: l.file.filename, pdf: l.file.pdf }) };
}, POLICY);
registerToolHandler('gumroad_create_draft_product', async (req) => {
  const { l, token } = await listingFor(req);
  const fileUrl = String((req.params as { fileUrl?: string }).fileUrl ?? '');
  if (!fileUrl) throw new Error('a draft carries the file it sells');
  const g = await import('./gumroad.js');
  return { productRef: await g.createDraft(token, l, fileUrl) };
}, POLICY);
registerToolHandler('gumroad_enable_product', async (req) => {
  const { token } = await listingFor(req);
  const ref = String((req.params as { productRef?: string }).productRef ?? '');
  if (!ref) throw new Error('enabling names the product');
  const g = await import('./gumroad.js');
  await g.enable(token, ref);
  return { enabled: ref };
}, POLICY);

export type Placed = { placed: true; channel: MarketChannel; externalRef: string; version: number } | { placed: false; channel: MarketChannel; because: string };

/** PUT ONE PRODUCT ON ONE CHANNEL, or say exactly why not. */
export async function placeOnChannel(founderId: string, experimentId: string, channel: MarketChannel): Promise<Placed> {
  const no = (because: string): Placed => ({ placed: false, channel, because });
  const open = await channelOpen(founderId, channel, 'list');
  if (!open.open) return no(open.because);
  const l = await canonicalListing(founderId, experimentId);
  if ('refused' in l) return no(l.refused);
  const floor = await priceMeetsFloor(founderId, channel, l.priceCents);
  if (!floor.ok) return no(floor.because);
  if (!l.productId) return no('the test has no asset yet for the door to act for');
  const already = (await query(`SELECT external_ref FROM channel_listings WHERE founder_id = ? AND experiment_id = ? AND channel = ? AND version = ?`,
    [founderId, experimentId, channel, l.version])).rows[0] as Record<string, unknown> | undefined;
  if (already) return { placed: true, channel, externalRef: String(already.external_ref), version: l.version };
  if (channel !== 'gumroad') return no(`${CHANNEL_NAMES[channel]} has no listing hand built`);
  const base = { founderId, experimentId, version: l.version };
  const step = async (tool: string, action: string, params: Record<string, unknown>, estimatedCents?: number): Promise<Record<string, unknown> | string> => {
    const r = await invoke({ productId: l.productId!, tool, action, params: { ...base, ...params }, dedupKey: `${tool}:${experimentId}:v${String(l.version)}`,
      ...(estimatedCents === undefined ? {} : { estimatedCents }) });
    if (!r.ok) return `${action}: ${r.reason}`;
    return (r.result ?? {}) as Record<string, unknown>;
  };
  const file = await step('gumroad_upload_product_file', `upload version ${String(l.version)} of "${l.title}" to Gumroad`, {});
  if (typeof file === 'string') return no(file);
  const draft = await step('gumroad_create_draft_product', `make a Gumroad draft of "${l.title}"`, { fileUrl: file.fileUrl });
  if (typeof draft === 'string') return no(draft);
  // Gumroad charges no listing fee; the cost is a share of each sale, which the floor already judged.
  const live = await step('gumroad_enable_product', `put "${l.title}" on sale on Gumroad`, { productRef: draft.productRef }, 0);
  if (typeof live === 'string') return no(live);
  await query(
    `INSERT INTO channel_listings (id, founder_id, experiment_id, version, channel, external_ref, price_cents, ai_disclosure, evidence_mode)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [`cl_${experimentId}_${channel}_v${String(l.version)}`, founderId, experimentId, l.version, channel, String(draft.productRef), l.priceCents,
      `${WHAT_THE_API_ALLOWS.gumroad.aiSetting}: "${l.aiMade.sentence}"`, l.evidenceMode]);
  return { placed: true, channel, externalRef: String(draft.productRef), version: l.version };
}

/** READ WHAT ONE CHANNEL SOLD AND RETURNED, and record it once against the canonical product. */
export async function readChannel(founderId: string, channel: MarketChannel, since: Date, evidenceMode: 'real' | 'sandbox' | 'reference' = 'real'): Promise<{ read: true; recorded: number; repeated: number; notOurs: number } | { read: false; because: string }> {
  const open = await channelOpen(founderId, channel, 'read');
  if (!open.open) return { read: false, because: open.because };
  // Etsy's sales are already in the ledger (the Etsy sense): counted, never recorded twice.
  if (channel === 'etsy') return { read: true, recorded: 0, repeated: (await ADAPTERS.etsy.readSales(founderId, since, null)).length, notOurs: 0 };
  try {
    const sales = await ADAPTERS[channel].readSales(founderId, since, open.key, open.grant.storeId);
    return { read: true, ...(await recordChannelSales(founderId, sales, evidenceMode)) };
  } catch (err) {
    return { read: false, because: `${CHANNEL_NAMES[channel]} could not be read: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * READ EVERY CHANNEL SOMEONE OPENED, for the hand's daily tick. With no grant
 * this reads nothing and costs nothing; a channel that cannot be read says why
 * and blocks no other.
 */
export async function readOpenChannels(now: Date = new Date()): Promise<Array<{ founderId: string; channel: MarketChannel; result: Awaited<ReturnType<typeof readChannel>> }>> {
  const rows = (await query(
    `SELECT DISTINCT founder_id, requirement FROM origination_policy
      WHERE founder_id IS NOT NULL AND requirement IN ('channel_grant:gumroad','channel_grant:lemonsqueezy')
        AND superseded_at IS NULL AND set_by LIKE 'founder:%' AND value LIKE '%"granted":true%'`, [])).rows as Array<Record<string, unknown>>;
  const out: Array<{ founderId: string; channel: MarketChannel; result: Awaited<ReturnType<typeof readChannel>> }> = [];
  const since = new Date(now.getTime() - 35 * 86_400_000);
  for (const r of rows) {
    const channel = String(r.requirement).split(':')[1] as MarketChannel;
    out.push({ founderId: String(r.founder_id), channel, result: await readChannel(String(r.founder_id), channel, since, 'real') });
  }
  return out;
}
