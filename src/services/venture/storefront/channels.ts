// =============================================================================
// FOUNDRY — every channel a product is sold on, behind one interface (F2).
//
// The owner decided on 9 October 2026 (PENDING 42) that each product is sold on
// every channel Foundry can reach: Etsy, Gumroad, Lemon Squeezy and the
// Workshop's own Stripe page. This file names them, says what each one's
// documented API can and cannot do, and decides — from rows, never from a
// caller — whether a channel is OPEN:
//
//   * HIS GRANT (PENDING 43): his own `channel_grant:<channel>` row, signed
//     founder:<id> (the guard of migration 277 refuses any other signature).
//     The institution's default row says "not_granted".
//   * A KEY THE CHANNEL ACCEPTS, held in `app_credentials` (encrypted, never
//     logged). A grant with no key is still closed, and says so.
//
// A closed channel refuses with a sentence he can act on. The Workshop's own
// page is not opened here: it is the live path, placed by the hand as before.
// =============================================================================
import { query } from '../../../db/client.js';

export type Channel = 'workshop' | 'etsy' | 'gumroad' | 'lemonsqueezy';
export type MarketChannel = Exclude<Channel, 'workshop'>;
export const CHANNELS: readonly Channel[] = Object.freeze(['workshop', 'etsy', 'gumroad', 'lemonsqueezy']);
export const MARKET_CHANNELS: readonly MarketChannel[] = Object.freeze(['etsy', 'gumroad', 'lemonsqueezy']);

export const CHANNEL_NAMES: Readonly<Record<Channel, string>> = Object.freeze({
  workshop: 'Workshop page', etsy: 'Etsy', gumroad: 'Gumroad', lemonsqueezy: 'Lemon Squeezy',
});

/** The fee card each channel is priced by (fee-floor.ts). */
export const FEE_VENUE: Readonly<Record<Channel, 'stripe' | 'etsy' | 'gumroad' | 'lemonsqueezy'>> = Object.freeze({
  workshop: 'stripe', etsy: 'etsy', gumroad: 'gumroad', lemonsqueezy: 'lemonsqueezy',
});

/** What each channel's documented API lets Foundry do, read from its documentation on the date given. */
export const WHAT_THE_API_ALLOWS: Readonly<Record<MarketChannel, { list: boolean; readSales: boolean; aiSetting: string; docs: readonly string[]; readOn: string }>> = Object.freeze({
  etsy: {
    list: true, readSales: true,
    aiSetting: 'Etsy\'s listing API has no AI-disclosure field (OpenAPI 3.0.0: createDraftListing, updateListing); the disclosure is written into the description',
    docs: ['https://www.etsy.com/openapi/generated/oas/3.0.0.json', 'https://developers.etsy.com/documentation/reference#operation/createDraftListing'],
    readOn: '2026-10-09',
  },
  gumroad: {
    list: true, readSales: true,
    aiSetting: 'Gumroad\'s product API has no AI-disclosure field (links_controller create_permitted_params at antiwork/gumroad bffaa9b8); the disclosure is written into the description',
    docs: ['https://gumroad.com/api', 'https://github.com/antiwork/gumroad/blob/bffaa9b8292815450c7d6930a5b26abae0c5a401/app/controllers/api/v2/links_controller.rb',
      'https://github.com/antiwork/gumroad/blob/bffaa9b8292815450c7d6930a5b26abae0c5a401/app/controllers/api/v2/files_controller.rb',
      'https://github.com/antiwork/gumroad/blob/bffaa9b8292815450c7d6930a5b26abae0c5a401/app/controllers/api/v2/sales_controller.rb'],
    readOn: '2026-10-09',
  },
  lemonsqueezy: {
    // Its API documents only "Retrieve a product" and "List all products":
    // a product, its file and its price are made in its dashboard.
    list: false, readSales: true,
    aiSetting: 'Lemon Squeezy has no product-create API, so the disclosure is in the description he pastes from the canonical listing',
    docs: ['https://docs.lemonsqueezy.com/api/products', 'https://docs.lemonsqueezy.com/api/orders/the-order-object', 'https://docs.lemonsqueezy.com/api/orders/list-all-orders'],
    readOn: '2026-10-09',
  },
});

export interface ChannelGrant {
  /** Etsy only: his answer to Etsy's required "who made it" (i_did, someone_else, collective). */
  whoMade?: 'i_did' | 'someone_else' | 'collective';
  /** Etsy only: the taxonomy node his files sit under, chosen by him. */
  taxonomyId?: number;
  /** Lemon Squeezy only: the store whose orders are his. */
  storeId?: string;
}

type Row = Record<string, unknown>;

/** His live grant row for the channel, read from his own signed row only. */
export async function channelGrant(founderId: string, channel: MarketChannel): Promise<{ granted: true; on: string; grant: ChannelGrant } | { granted: false; because: string }> {
  const row = (await query(
    `SELECT value, set_at, set_by FROM origination_policy
      WHERE founder_id = ? AND requirement = ? AND superseded_at IS NULL
      ORDER BY set_at DESC, rowid DESC LIMIT 1`, [founderId, `channel_grant:${channel}`])).rows[0] as Row | undefined;
  const name = CHANNEL_NAMES[channel];
  if (!row || !String(row.set_by ?? '').startsWith('founder:')) {
    return { granted: false, because: `you have not opened ${name} for Foundry (PENDING 43): open your account, grant API access, and allow it in Controls` };
  }
  let grant: ChannelGrant;
  try {
    const v = JSON.parse(String(row.value ?? 'null')) as { granted?: unknown } & ChannelGrant;
    if (v?.granted !== true) return { granted: false, because: `you closed ${name} on ${String(row.set_at).slice(0, 10)}` };
    grant = { whoMade: v.whoMade, taxonomyId: v.taxonomyId, storeId: v.storeId };
  } catch {
    return { granted: false, because: `your ${name} grant could not be read, so ${name} stays closed` };
  }
  return { granted: true, on: String(row.set_at).slice(0, 10), grant };
}

/** Open or close a channel. His act: the guard refuses any signature but founder:<id>. */
export async function grantChannel(founderId: string, channel: MarketChannel, grant: ChannelGrant | null, why: string, by: string): Promise<{ id: string } | { refused: string }> {
  const { supersedeOriginationPolicy } = await import('../legal-surface.js');
  return supersedeOriginationPolicy({
    founderId, requirement: `channel_grant:${channel}`, treatment: 'policy',
    value: JSON.stringify(grant ? { granted: true, ...grant } : { granted: false }), why, by,
  });
}

/** The key Foundry holds for the channel, decrypted, or null. Never logged. */
export async function channelKey(channel: MarketChannel): Promise<Record<string, string> | null> {
  const { appCredentialFor } = await import('../../senses/app-credential.js');
  const c = await appCredentialFor(channel);
  return c ? c.secret : null;
}

/**
 * IS THIS CHANNEL OPEN FOR HIM, AND WHY NOT. His grant first, then the key;
 * for Etsy, the write scope the constitution's scope table does not hold.
 */
export async function channelOpen(founderId: string, channel: MarketChannel, purpose: 'list' | 'read'): Promise<{ open: true; grant: ChannelGrant; key: Record<string, string> | null } | { open: false; because: string }> {
  const g = await channelGrant(founderId, channel);
  if (!g.granted) return { open: false, because: g.because };
  if (purpose === 'list' && !WHAT_THE_API_ALLOWS[channel].list) {
    return { open: false, because: `${CHANNEL_NAMES[channel]}'s API cannot create a product (${WHAT_THE_API_ALLOWS[channel].docs[0]!}); make it in its dashboard from the canonical listing, and Foundry reads its sales` };
  }
  if (channel === 'etsy') {
    // SENSES ARE NOT HANDS. Foundry's Etsy connection is a sense, issued against
    // shops_r, listings_r and transactions_r, a set the constitution closes. Its
    // sales are read through it already (etsy-shop.ts). Listing needs
    // listings_w, which only an amendment he makes can add (PENDING 25).
    if (purpose === 'list') return { open: false, because: 'listing on Etsy needs Etsy\'s write scope (listings_w), which Foundry\'s Etsy connection does not and constitutionally cannot hold; granting it is your act (PENDING 25, 43)' };
    return { open: true, grant: g.grant, key: null };
  }
  const key = await channelKey(channel);
  if (!key) return { open: false, because: `you opened ${CHANNEL_NAMES[channel]} on ${g.on}, and no API key for it is held here: paste it in Settings` };
  return { open: true, grant: g.grant, key };
}

// ─── His key, verified before it is kept (the sending identity's convention) ──
//
// A key he pastes is asked of the channel with one free read that changes
// nothing — Gumroad's GET /v2/user (routes.rb, antiwork/gumroad bffaa9b8),
// Lemon Squeezy's GET /v1/users/me (docs.lemonsqueezy.com/api/users) — and
// kept, encrypted, only if the channel says it is a real account. The key never
// appears in a log line, an error or a sentence he is shown.

const WHO_AM_I: Readonly<Record<'gumroad' | 'lemonsqueezy', { url: string; headers: (k: string) => Record<string, string>; idOf: (j: Record<string, unknown>) => string | null }>> = Object.freeze({
  gumroad: { url: 'https://api.gumroad.com/v2/user', headers: (k) => ({ authorization: `Bearer ${k}`, accept: 'application/json' }),
    idOf: (j) => { const u = j.user as Record<string, unknown> | undefined; return j.success === true && u && (u.user_id ?? u.id) ? String(u.user_id ?? u.id) : null; } },
  lemonsqueezy: { url: 'https://api.lemonsqueezy.com/v1/users/me', headers: (k) => ({ authorization: `Bearer ${k}`, accept: 'application/vnd.api+json' }),
    idOf: (j) => { const d = j.data as Record<string, unknown> | undefined; return d?.id ? String(d.id) : null; } },
});

/** Keep his key for a channel once the channel says it is a real account. Nothing is stored on any failure. */
export async function setChannelKey(channel: 'gumroad' | 'lemonsqueezy', key: string, by: string): Promise<{ placed: true; account: string } | { failed: true; ownerWords: string }> {
  const k = key.trim();
  if (!k) return { failed: true, ownerWords: 'paste the key; nothing has been stored' };
  if (!by.startsWith('founder:')) return { failed: true, ownerWords: 'only you place a key; nothing has been stored' };
  const w = WHO_AM_I[channel];
  const { channelHttp } = await import('./canonical.js');
  let res: Response;
  try { res = await channelHttp(w.url, { headers: w.headers(k) }); } catch {
    return { failed: true, ownerWords: `I could not reach ${CHANNEL_NAMES[channel]} to check that key just now; nothing has been stored` };
  }
  if (res.status === 401 || res.status === 403) return { failed: true, ownerWords: `${CHANNEL_NAMES[channel]} does not accept that key; nothing has been stored` };
  const id = res.ok ? w.idOf(await res.json().catch(() => ({})) as Record<string, unknown>) : null;
  if (!id) return { failed: true, ownerWords: `${CHANNEL_NAMES[channel]} answered ${String(res.status)} without saying whose account it is; nothing has been stored` };
  const { encrypt } = await import('../../encryption.js');
  await query(
    `INSERT INTO app_credentials (provider, secret_json, provider_account_ref, verified_at, set_by) VALUES (?,?,?,?,?)
     ON CONFLICT(provider) DO UPDATE SET secret_json = excluded.secret_json, provider_account_ref = excluded.provider_account_ref,
       verified_at = excluded.verified_at, set_at = datetime('now'), set_by = excluded.set_by, forgotten_at = NULL, forget_reason = NULL`,
    [channel, encrypt(JSON.stringify(channel === 'gumroad' ? { token: k } : { apiKey: k })), id, new Date().toISOString(), by]);
  return { placed: true, account: id };
}
