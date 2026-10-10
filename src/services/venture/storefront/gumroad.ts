// =============================================================================
// FOUNDRY — Gumroad, behind the storefront interface (F2).
//
// WRITTEN AGAINST GUMROAD'S OWN SOURCE, read 9 October 2026 at
// antiwork/gumroad bffaa9b8 (the API is open source; its docs page renders in
// the browser and could not be read here):
//   * config/routes.rb `api_routes`: under /v2 — POST files/presign,
//     POST files/complete, resources :links at path "products" (index, show,
//     create, update, destroy; member PUT enable/disable), resources :sales
//     (index, show). Served on api.gumroad.com.
//   * Api::V2::FilesController: presign {filename, file_size} → {upload_id,
//     key, file_url, parts:[{part_number, presigned_url}]}, parts of 100 MB;
//     complete {upload_id, key, parts:[{part_number, etag}]} → {file_url}.
//     Scope edit_products.
//   * Api::V2::LinksController#create: name, description, price (cents),
//     draft, native_type, files:[{url, display_name}] (each url must be one
//     of the seller's own uploads); responds {success, product}. #enable
//     publishes. No AI-disclosure parameter exists.
//   * Api::V2::SalesController#index: after/before (YYYY-MM-DD), product_id,
//     page_key → {success, sales, next_page_key?}; Purchase#as_json(version 2):
//     id, created_at, price (cents), gumroad_fee, currency, product_id,
//     refunded, partially_refunded, chargedback, amount_refundable_in_currency.
//   * Doorkeeper OAuth: the token in `Authorization: Bearer`.
//
// SOURCE-VERIFIED, NOT LIVE-VERIFIED: no request here has been answered by
// api.gumroad.com. The contract test replays FIXTURES shaped from the source
// above, labelled as fixtures. What the source does not settle is marked TODO.
// =============================================================================
import type { CanonicalListing } from './canonical.js';
import { canonicalListing, channelHttp } from './canonical.js';
import type { ChannelSale } from './reconcile.js';
import { registerToolHandler, type GatewayRequest } from '../../outbound/gateway.js';
import { buyerUrlOn, channelOpen } from './channels.js';

export const GUMROAD_API = 'https://api.gumroad.com/v2';

async function call(token: string, method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await channelHttp(`${GUMROAD_API}${path}`, {
    method, headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok || json.success === false) {
    // The message Gumroad gives is a seller-facing sentence; the token is never in it.
    throw new Error(`Gumroad answered ${String(res.status)}${typeof json.message === 'string' ? `: ${json.message.slice(0, 200)}` : ''}`);
  }
  return json;
}

/** Upload the file: presign, PUT each part to its URL, complete. Returns the file URL a product may carry. */
export async function uploadFile(token: string, file: { filename: string; pdf: Buffer }): Promise<string> {
  const pre = await call(token, 'POST', '/files/presign', { filename: file.filename, file_size: file.pdf.length });
  const parts = (pre.parts as Array<{ part_number: number; presigned_url: string }> | undefined) ?? [];
  if (!parts.length || typeof pre.upload_id !== 'string' || typeof pre.key !== 'string') throw new Error('Gumroad did not say where to upload the file');
  const size = Math.ceil(file.pdf.length / parts.length);
  const done: Array<{ part_number: number; etag: string }> = [];
  for (const p of [...parts].sort((a, b) => a.part_number - b.part_number)) {
    const chunk = file.pdf.subarray((p.part_number - 1) * size, p.part_number * size);
    const put = await channelHttp(p.presigned_url, { method: 'PUT', body: new Uint8Array(chunk) });
    const etag = put.headers.get('etag');
    if (!put.ok || !etag) throw new Error(`the upload of part ${String(p.part_number)} was not accepted`);
    done.push({ part_number: p.part_number, etag });
  }
  const fin = await call(token, 'POST', '/files/complete', { upload_id: pre.upload_id, key: pre.key, parts: done });
  if (typeof fin.file_url !== 'string') throw new Error('Gumroad did not return the uploaded file');
  return fin.file_url;
}

/** Create the product as a DRAFT, carrying the uploaded file. Nothing is public. */
export async function createDraft(token: string, l: Pick<CanonicalListing, 'title' | 'description' | 'priceCents' | 'file'>, fileUrl: string): Promise<{ id: string; url: string | null }> {
  const r = await call(token, 'POST', '/products', {
    name: l.title, description: l.description, price: l.priceCents, draft: true, native_type: 'digital',
    files: [{ url: fileUrl, display_name: l.file.filename }],
  });
  // TODO(live): the product's id field is read as `id`, the external id the
  // sales API also uses (`product_id: link.external_id`); not yet seen live.
  const product = (r.product as Record<string, unknown> | undefined) ?? {};
  const id = product.id;
  if (typeof id !== 'string' || !id) throw new Error('Gumroad did not say which product it made');
  // WHERE A BUYER REACHES IT (F3 audit of F2): the product's `short_url`, kept
  // so the routing rule can send an EU or UK buyer there. Only an https address
  // on Gumroad's own host is kept; anything else is not known.
  return { id, url: buyerUrlOn('gumroad', product.short_url) };
}

/** Publish the draft. The one public step. */
export async function enable(token: string, productId: string): Promise<void> {
  await call(token, 'PUT', `/products/${encodeURIComponent(productId)}/enable`);
}

/** Every sale and refund since `after`, as the channel said it, page by page. */
export async function readSales(token: string, after: Date, readAt: Date = new Date()): Promise<ChannelSale[]> {
  const out: ChannelSale[] = [];
  let pageKey: string | null = null;
  for (let page = 0; page < 200; page++) {
    const q = new URLSearchParams({ after: after.toISOString().slice(0, 10) });
    if (pageKey) q.set('page_key', pageKey);
    const r = await call(token, 'GET', `/sales?${q.toString()}`);
    for (const s of (r.sales as Array<Record<string, unknown>> | undefined) ?? []) out.push(...salesOf(s, readAt));
    pageKey = typeof r.next_page_key === 'string' && r.next_page_key ? r.next_page_key : null;
    if (!pageKey) return out;
  }
  throw new Error('Gumroad kept paging past 200 pages; the read stopped rather than guess');
}

/** One Gumroad sale as Foundry's rows: the sale, and a refund when it was returned. */
export function salesOf(s: Record<string, unknown>, readAt: Date = new Date()): ChannelSale[] {
  const id = String(s.id ?? '');
  const price = Number(s.price);
  if (!id || !Number.isInteger(price) || price < 0) return [];
  const fee = s.gumroad_fee == null ? null : Number(s.gumroad_fee);
  const base = { channel: 'gumroad' as const, productRef: String(s.product_id ?? ''), currency: String(s.currency ?? 'usd').toLowerCase(), occurredAt: String(s.created_at ?? '') };
  // TODO(live): whether `price` includes tax Gumroad collected as merchant of
  // record is not settled by the serializer; tax is recorded as 0 (not
  // counted as revenue either way) until a live sale shows it.
  const rows: ChannelSale[] = [{ ...base, kind: 'sale', providerRef: id, grossCents: price, feeCents: Number.isInteger(fee) ? fee : null, taxCents: 0 }];
  // THE REFUND IS DATED WHEN FOUNDRY FIRST LEARNED OF IT (F3 audit of F2): the
  // sale record carries no refund date, and dating it to the sale put a refund
  // learned in November into a September already recorded. The row is written
  // once (the reconciliation is idempotent), so the first reading's date stays.
  const learned = readAt.toISOString();
  if (s.refunded === true || s.chargedback === true) {
    rows.push({ ...base, kind: 'refund', providerRef: id, grossCents: price, feeCents: null, taxCents: 0, occurredAt: learned });
  } else if (s.partially_refunded === true) {
    const left = Number(s.amount_refundable_in_currency);
    if (Number.isInteger(left) && left >= 0 && left < price) rows.push({ ...base, kind: 'refund', providerRef: id, grossCents: price - left, feeCents: null, taxCents: 0, occurredAt: learned });
  }
  return rows;
}

// ─── The door: the three acts, registered beside the calls they make ─────────
//
// Each with a server-owned policy. The handler never trusts the caller's
// listing: it recomposes the canonical listing from the rows by experiment id
// and refuses if the version the caller named is not the one for sale. The key
// is read inside the handler from the encrypted store; it is never a parameter.

const POLICY = { actor: 'storefront', surface: 'marketplace_listing', dataClass: 'general', requireDedupKey: true, requireCustomerExternalId: false } as const;

async function listingFor(req: GatewayRequest): Promise<{ l: CanonicalListing; token: string }> {
  const p = req.params as { founderId?: string; experimentId?: string; version?: number };
  if (!p.founderId || !p.experimentId) throw new Error('a channel act names its test');
  const l = await canonicalListing(p.founderId, p.experimentId);
  if ('refused' in l) throw new Error(l.refused);
  if (l.version !== p.version) throw new Error(`version ${String(p.version)} is not the version for sale (${String(l.version)})`);
  const open = await channelOpen(p.founderId, 'gumroad', 'list');
  if (!open.open) throw new Error(open.because);
  const token = open.key?.token ?? '';
  if (!token) throw new Error('no API key is held for Gumroad');
  return { l, token };
}

registerToolHandler('gumroad_upload_product_file', async (req) => {
  const { l, token } = await listingFor(req);
  return { fileUrl: await uploadFile(token, { filename: l.file.filename, pdf: l.file.pdf }) };
}, POLICY);
registerToolHandler('gumroad_create_draft_product', async (req) => {
  const { l, token } = await listingFor(req);
  const fileUrl = String((req.params as { fileUrl?: string }).fileUrl ?? '');
  if (!fileUrl) throw new Error('a draft carries the file it sells');
  const made = await createDraft(token, l, fileUrl);
  return { productRef: made.id, url: made.url };
}, POLICY);
registerToolHandler('gumroad_enable_product', async (req) => {
  const { token } = await listingFor(req);
  const ref = String((req.params as { productRef?: string }).productRef ?? '');
  if (!ref) throw new Error('enabling names the product');
  await enable(token, ref);
  return { enabled: ref };
}, POLICY);
