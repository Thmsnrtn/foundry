process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.STRIPE_SECRET_KEY = 'sk_test_x';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { processStripeWebhookEvent } from '../../src/services/integrations/framework.js';
import { processStripeEventChain } from '../../src/services/integrations/stripe-webhook.js';
import type Stripe from 'stripe';

// =============================================================================
// AN EVENT THAT WAS ALREADY SEEN.
//
// `POST /webhooks/stripe/:productId` takes the product from the URL. The Stripe
// signature proves the event came from Stripe; it does not say which product it
// belongs to, and there is one STRIPE_WEBHOOK_SECRET for every tenant. That is
// RT02-09, raised by the red-team audit as P1 and never remediated.
//
// Everything downstream of that line mutates the NAMED company:
// `updateMetricsFromEvent` rewrites its MRR movement columns and active users
// from amounts in the event body, a stressor row is inserted,
// `transitionRiskState` is called, the founder receives a COO message quoting a
// customer email lifted from the event, and a gate-1 urgent decision plus an AI
// action draft are created on their budget.
//
// AND THE ROW THAT WOULD HAVE REFUSED IT WAS ALREADY IN THE TABLE.
// `processStripeWebhookEvent` dedupes on `stripe_event_id` with NO product
// predicate — so it knows an event has been seen for ANY product — and returned
// void, so the chain could not tell. A captured genuine delivery replayed N
// times drove the chain N times; replayed at a DIFFERENT product id it drove it
// against a company the event had nothing to do with.
//
// WHAT THIS DOES NOT CLOSE, asserted here so the limit is not mistaken for a
// guarantee: an attacker holding the shared secret can mint fresh event ids,
// and a replay arriving BEFORE the genuine delivery still wins the race.
// Binding an event to a product needs an identifier the event carries and the
// product owns, which is schema and a connect-flow change.
// =============================================================================

const VICTIM = 'p_victim_stripe';
const OTHER = 'p_other_stripe';

function subscriptionDeleted(id: string): Stripe.Event {
  return {
    id, type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_1', customer: 'cus_1', items: { data: [] } } },
  } as unknown as Stripe.Event;
}

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_sw','c_sw','sw@x.com')");
  for (const [id, name] of [[VICTIM, 'Victim'], [OTHER, 'Other']]) {
    await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,?,'f_sw','active')", [id, name]);
  }
});

beforeEach(async () => {
  await query('DELETE FROM stripe_events');
  await query('DELETE FROM metric_snapshots');
  await query('DELETE FROM stressor_history');
});

describe('the dedupe now says what it knows', () => {
  it('reports the first sighting as recorded', async () => {
    const r = await processStripeWebhookEvent(VICTIM, 'evt_1', 'customer.subscription.deleted', {});
    expect(r.recorded).toBe(true);
  });

  it('reports a replay as not recorded', async () => {
    await processStripeWebhookEvent(VICTIM, 'evt_2', 'customer.subscription.deleted', {});
    const again = await processStripeWebhookEvent(VICTIM, 'evt_2', 'customer.subscription.deleted', {});
    expect(again.recorded).toBe(false);
  });

  it('reports a replay AT ANOTHER PRODUCT as not recorded, because the dedupe has no product in it', async () => {
    await processStripeWebhookEvent(VICTIM, 'evt_3', 'customer.subscription.deleted', {});
    const elsewhere = await processStripeWebhookEvent(OTHER, 'evt_3', 'customer.subscription.deleted', {});
    expect(elsewhere.recorded).toBe(false);
  });
});

describe('the chain now stops', () => {
  it('runs once for a genuine delivery', async () => {
    const result = await processStripeEventChain(VICTIM, subscriptionDeleted('evt_live_1'));
    expect(result.metrics_updated).toBe(true);
  });

  it('does nothing on a replay of the same event', async () => {
    await processStripeEventChain(VICTIM, subscriptionDeleted('evt_live_2'));
    const before = await query('SELECT churned_mrr_cents FROM metric_snapshots WHERE product_id = ?', [VICTIM]);

    const replay = await processStripeEventChain(VICTIM, subscriptionDeleted('evt_live_2'));

    expect(replay.metrics_updated).toBe(false);
    const after = await query('SELECT churned_mrr_cents FROM metric_snapshots WHERE product_id = ?', [VICTIM]);
    expect(after.rows).toEqual(before.rows);
  });

  it('does nothing when the same event is aimed at a different company', async () => {
    // The realistic attack: capture one genuine delivery, POST it again with
    // another company's id in the path.
    await processStripeEventChain(VICTIM, subscriptionDeleted('evt_live_3'));

    const aimedElsewhere = await processStripeEventChain(OTHER, subscriptionDeleted('evt_live_3'));

    expect(aimedElsewhere.metrics_updated).toBe(false);
    const other = await query('SELECT COUNT(*) AS n FROM metric_snapshots WHERE product_id = ?', [OTHER]);
    expect((other.rows[0] as unknown as { n: number }).n).toBe(0);
    const stressors = await query('SELECT COUNT(*) AS n FROM stressor_history WHERE product_id = ?', [OTHER]);
    expect((stressors.rows[0] as unknown as { n: number }).n).toBe(0);
  });

  it('still admits a genuinely different event for that company', async () => {
    await processStripeEventChain(VICTIM, subscriptionDeleted('evt_live_4'));

    const different = await processStripeEventChain(OTHER, subscriptionDeleted('evt_live_5'));

    expect(different.metrics_updated).toBe(true);
  });
});
