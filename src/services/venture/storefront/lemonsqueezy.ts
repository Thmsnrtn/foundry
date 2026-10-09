// =============================================================================
// FOUNDRY — Lemon Squeezy, behind the storefront interface (F2).
//
// WRITTEN AGAINST ITS DOCUMENTATION, read 9 October 2026:
//   * https://docs.lemonsqueezy.com/api/products — "Retrieve a product" and
//     "List all products" only: the API cannot create or update a product, so
//     a product, its file and its price are made by the owner in Lemon
//     Squeezy's dashboard from the canonical listing (channels.ts says so).
//   * https://docs.lemonsqueezy.com/api/orders/list-all-orders —
//     GET https://api.lemonsqueezy.com/v1/orders, filter[store_id],
//     headers Accept/Content-Type application/vnd.api+json and
//     Authorization: Bearer {api_key}; pages described by meta.page
//     (currentPage, lastPage); links.first/links.last show page[number].
//   * https://docs.lemonsqueezy.com/api/orders/the-order-object — identifier,
//     order_number, currency, subtotal, tax, total (cents, order currency),
//     status (pending, failed, paid, refunded, partial_refund, fraudulent),
//     refunded, refunded_at, refunded_amount, first_order_item.product_id,
//     created_at, test_mode. No fee field: the fee is "not known" from the
//     order, and the schedule (fee-floor.ts) estimates it, labelled so.
//
// DOCS-VERIFIED, NOT LIVE-VERIFIED. The contract test replays fixtures shaped
// from the pages above, labelled as fixtures.
// =============================================================================
import { channelHttp } from './canonical.js';
import type { ChannelSale } from './reconcile.js';

export const LEMONSQUEEZY_API = 'https://api.lemonsqueezy.com/v1';

/** Every order since `after`, as sales and refunds. Test-mode orders are a sandbox, never revenue. */
export async function readOrders(apiKey: string, storeId: string, after: Date): Promise<Array<ChannelSale & { testMode: boolean }>> {
  const out: Array<ChannelSale & { testMode: boolean }> = [];
  for (let page = 1; page <= 200; page++) {
    const q = new URLSearchParams({ 'filter[store_id]': storeId, 'page[number]': String(page) });
    const res = await channelHttp(`${LEMONSQUEEZY_API}/orders?${q.toString()}`, {
      headers: { accept: 'application/vnd.api+json', 'content-type': 'application/vnd.api+json', authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`Lemon Squeezy answered ${String(res.status)}`);
    const json = await res.json() as { data?: Array<{ id?: string; attributes?: Record<string, unknown> }>; meta?: { page?: { currentPage?: number; lastPage?: number } } };
    let older = false;
    for (const o of json.data ?? []) {
      const rows = ordersOf(o);
      // Ordered by created_at, newest first (the list page says so): stop at the window's edge.
      if (rows.length && Date.parse(rows[0]!.occurredAt) < after.getTime()) { older = true; continue; }
      out.push(...rows);
    }
    const last = Number(json.meta?.page?.lastPage ?? page);
    if (older || page >= last) return out;
  }
  throw new Error('Lemon Squeezy kept paging past 200 pages; the read stopped rather than guess');
}

/** One order as Foundry's rows. A pending, failed or fraudulent order is no sale. */
export function ordersOf(o: { id?: string; attributes?: Record<string, unknown> }): Array<ChannelSale & { testMode: boolean }> {
  const a = o.attributes ?? {};
  const status = String(a.status ?? '');
  if (!['paid', 'refunded', 'partial_refund'].includes(status)) return [];
  const ref = String(a.identifier ?? o.id ?? '');
  const subtotal = Number(a.subtotal); const tax = Number(a.tax ?? 0);
  if (!ref || !Number.isInteger(subtotal) || subtotal < 0) return [];
  const item = (a.first_order_item ?? {}) as Record<string, unknown>;
  const base = { channel: 'lemonsqueezy' as const, productRef: String(item.product_id ?? ''), currency: String(a.currency ?? 'USD').toLowerCase(),
    occurredAt: String(a.created_at ?? ''), testMode: a.test_mode === true };
  const rows: Array<ChannelSale & { testMode: boolean }> = [
    { ...base, kind: 'sale', providerRef: ref, grossCents: subtotal, feeCents: null, taxCents: Number.isInteger(tax) && tax > 0 ? tax : 0 },
  ];
  const refunded = Number(a.refunded_amount ?? 0);
  if ((a.refunded === true || status === 'refunded' || status === 'partial_refund') && Number.isInteger(refunded) && refunded > 0) {
    // refunded_amount is of the order's total, tax included; the product's share is what is returned of the subtotal.
    const total = Number(a.total);
    const ofSubtotal = Number.isInteger(total) && total > 0 ? Math.round((refunded * subtotal) / total) : refunded;
    rows.push({ ...base, kind: 'refund', providerRef: ref, grossCents: Math.min(subtotal, ofSubtotal), feeCents: null, taxCents: 0,
      occurredAt: String(a.refunded_at ?? a.created_at ?? '') });
  }
  return rows;
}
