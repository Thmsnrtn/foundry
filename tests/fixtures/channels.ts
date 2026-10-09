// =============================================================================
// FIXTURES, NOT RECORDINGS. No request below was ever answered by Gumroad or
// Lemon Squeezy: nobody has granted Foundry an account on either (PENDING 43),
// and no paid or live call is made from this repository's tests.
//
// Each body is SHAPED FROM THE PROVIDER'S OWN DEFINITION, read 9 October 2026:
//   Gumroad — antiwork/gumroad at bffaa9b8: FilesController#presign/#complete,
//     LinksController#create/#enable, SalesController#index, Purchase#as_json
//     (version 2) for the sale fields;
//   Lemon Squeezy — docs.lemonsqueezy.com/api/orders/the-order-object and
//     /list-all-orders for the order fields and the meta.page shape.
// Ids and amounts are invented for the test and say so by their form.
// =============================================================================

export const GUMROAD_FIXTURE = {
  presign: { success: true, upload_id: 'fixture-upload-1', key: 'attachments/fixture-seller/abc/original/log-v1.pdf',
    file_url: 'https://files.gumroad.example/attachments/fixture-seller/abc/original/log-v1.pdf',
    parts: [{ part_number: 1, presigned_url: 'https://s3.fixture.example/upload?part=1' }] },
  complete: { success: true, file_url: 'https://files.gumroad.example/attachments/fixture-seller/abc/original/log-v1.pdf' },
  created: { success: true, product: { id: 'fixture_product_1', name: 'The Home Maintenance Log', published: false } },
  enabled: { success: true, product: { id: 'fixture_product_1', published: true } },
  /** Two sales of ours (one refunded), one partly refunded, and one of a product Foundry never listed. */
  sales: { success: true, sales: [
    { id: 'fixture_sale_a', created_at: '2026-10-08T10:00:00Z', price: 900, gumroad_fee: 140, currency: 'usd', product_id: 'fixture_product_1',
      refunded: false, partially_refunded: false, chargedback: false, amount_refundable_in_currency: 900 },
    { id: 'fixture_sale_b', created_at: '2026-10-08T11:00:00Z', price: 900, gumroad_fee: 140, currency: 'usd', product_id: 'fixture_product_1',
      refunded: true, partially_refunded: false, chargedback: false, amount_refundable_in_currency: 0 },
    { id: 'fixture_sale_c', created_at: '2026-10-08T12:00:00Z', price: 900, gumroad_fee: 140, currency: 'usd', product_id: 'fixture_product_1',
      refunded: false, partially_refunded: true, chargedback: false, amount_refundable_in_currency: 600 },
    { id: 'fixture_sale_x', created_at: '2026-10-08T12:30:00Z', price: 2500, gumroad_fee: 300, currency: 'usd', product_id: 'fixture_someone_elses',
      refunded: false, partially_refunded: false, chargedback: false, amount_refundable_in_currency: 2500 },
  ] },
};

const order = (id: string, attrs: Record<string, unknown>) => ({ type: 'orders', id, attributes: {
  store_id: 1, identifier: `fixture-${id}`, order_number: Number(id), currency: 'USD', tax: 0, refunded: false, refunded_at: null,
  refunded_amount: 0, status: 'paid', test_mode: false, created_at: '2026-10-08T09:00:00.000000Z',
  first_order_item: { id: Number(id), order_id: Number(id), product_id: 7001, variant_id: 1, product_name: 'The Home Maintenance Log' }, ...attrs } });

export const LEMONSQUEEZY_FIXTURE = {
  orders: {
    meta: { page: { currentPage: 1, from: 1, lastPage: 1, perPage: 10, to: 4, total: 4 } },
    data: [
      // A buyer in the EU: VAT collected by the merchant of record, never revenue.
      order('1', { subtotal: 900, tax: 189, total: 1089 }),
      // Fully refunded, tax and all.
      order('2', { subtotal: 900, tax: 0, total: 900, status: 'refunded', refunded: true, refunded_amount: 900, refunded_at: '2026-10-08T15:00:00.000000Z' }),
      // A test-mode order: the sandbox, never revenue.
      order('3', { subtotal: 900, tax: 0, total: 900, test_mode: true }),
      // A failed payment: no sale.
      order('4', { subtotal: 900, tax: 0, total: 900, status: 'failed' }),
    ],
  },
};
