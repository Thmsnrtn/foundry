// =============================================================================
// FOUNDRY — The purchase pathway against Stripe's TEST MODE, step by step.
//
// Everything the laboratory proves about a purchase is proved against
// `tests/helpers/provider-stubs.ts` or a locally signed fixture. Six facts can
// only be established by the provider itself, and this runner exists to
// establish them, once, with keys the owner supplies, on a test-mode account
// that is not the production account:
//
//   1. the payment link's `payment_intent_data.metadata` reaches the
//      PaymentIntent, the Checkout Session and the Charge — and NOT the Dispute;
//   2. `payment_intent.payment_failed` fires for a decline at a payment link;
//   3. the `payment_links` create parameters accept the shape the hand sends;
//   4. a refund retried under the same idempotency key is one refund;
//   5. a refund on a disputed charge is refused by the provider;
//   6. a webhook answered 400 is redelivered.
//
// IT IS WRITTEN AND LEFT UNRUN. Nobody in this repository has run it, and the
// map records those six facts as an external-evidence boundary until somebody
// does. Running it is the owner's act: it needs his test-mode secret key, the
// Stripe CLI logged into the same account, and a browser to complete the two
// checkouts. It refuses any key that is not `sk_test_`, and it never reads the
// production key from the environment.
//
// Usage (each step prints what it did and what to look for; nothing is skipped):
//   STRIPE_TEST_SECRET_KEY=sk_test_... npx tsx scripts/stripe-test-mode-run.mts --step 1
//   stripe listen --forward-to localhost:8080/webhooks/stripe   (in another shell,
//     against a local Foundry started with STRIPE_WEBHOOK_SECRET from `stripe listen`)
//   ... then --step 2 through --step 10 in order.
//
// The steps:
//   1  create a product, a one-time price and a payment link with the hand's
//      exact parameters (payment-link.ts paymentLinkParams), tagged for a
//      throwaway experiment id; print the link URL
//   2  YOU: pay at the link with 4242 4242 4242 4242 → expect
//      payment_intent.succeeded and checkout.session.completed to arrive, both
//      with metadata.experiment_id (fact 1); the runner reads the intent back
//      and prints the metadata on the intent, the session and the charge
//   3  YOU: pay at the link with 4000 0000 0000 0002 (declined) → expect
//      payment_intent.payment_failed with our metadata (fact 2)
//   4  refund the step-2 charge with idempotency key experiment:<id>:refund:<pi>
//   5  refund it again under the same key → the same refund id (fact 4)
//   6  YOU: pay at the link with 4000 0000 0000 0259 (disputed as fraudulent)
//      → expect charge.dispute.created; the runner prints the dispute's
//      metadata (expected empty: fact 1's second half) and its payment_intent
//   7  attempt a refund of the disputed charge → expect the provider to refuse
//      (fact 5); print the error code
//   8  close the dispute by submitting evidence `winning_evidence` →
//      expect charge.dispute.closed with status won
//   9  YOU: pay once more with 4000 0000 0000 0259, then close it with
//      `losing_evidence` → expect charge.dispute.closed with status lost
//  10  with Foundry started under FOUNDRY_WEBHOOK_FORCE_THROW=1 for one
//      delivery, replay the step-2 event (stripe events resend evt_...) →
//      expect a 400, then a redelivery that lands (fact 6)
//
// What to record afterwards: the six facts, each as observed, in
// docs/foundry-institution/MATURITY_MAP.md under the external-evidence rows,
// with the event ids. Nothing here touches the production account or Foundry's
// own database; it speaks to Stripe and prints.
// =============================================================================
import Stripe from 'stripe';

const args = process.argv.slice(2);
const step = Number(args[args.indexOf('--step') + 1] || 0);
const key = process.env.STRIPE_TEST_SECRET_KEY ?? '';

function refuse(why: string): never {
  console.error(`refused: ${why}`);
  process.exit(2);
}
if (!key.startsWith('sk_test_')) refuse('STRIPE_TEST_SECRET_KEY must be a test-mode key (sk_test_...); the production key is never read here');
if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY === key) refuse('the test key must not also be STRIPE_SECRET_KEY; keep the accounts apart');
if (!Number.isInteger(step) || step < 1 || step > 10) refuse('say which step: --step 1 … --step 10, in order');

const stripe = new Stripe(key, { apiVersion: '2023-10-16' });
const EXPERIMENT_ID = process.env.FOUNDRY_TEST_EXPERIMENT_ID ?? 'exp_test_mode_run';
const stateFile = new URL('../node_modules/.cache/stripe-test-mode-run.json', import.meta.url);

async function loadState(): Promise<Record<string, string>> {
  const { readFile } = await import('node:fs/promises');
  try { return JSON.parse(await readFile(stateFile, 'utf8')) as Record<string, string>; } catch { return {}; }
}
async function saveState(s: Record<string, string>): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(new URL('.', stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify(s, null, 2));
}
const say = (what: string, o?: unknown) => { console.log(what); if (o !== undefined) console.log(JSON.stringify(o, null, 2)); };

const state = await loadState();

if (step === 1) {
  // THE HAND'S EXACT SHAPE (payment-link.ts paymentLinkParams), so fact 3 is
  // about the parameters Foundry actually sends.
  const product = await stripe.products.create({ name: 'Foundry test-mode brief', metadata: { app: 'foundry', plan_key: 'test_mode_brief' } });
  const price = await stripe.prices.create({ product: product.id, unit_amount: 2900, currency: 'usd', lookup_key: `foundry_test_mode_${Date.now()}`,
    metadata: { app: 'foundry', plan_key: 'test_mode_brief', billing_period: 'one_time' } });
  const link = await stripe.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
    metadata: { app: 'foundry', experiment_id: EXPERIMENT_ID, primitive: 'sale' },
    payment_intent_data: { metadata: { app: 'foundry', experiment_id: EXPERIMENT_ID, primitive: 'sale' } },
    after_completion: { type: 'hosted_confirmation', hosted_confirmation: { custom_message: 'Thank you. The brief follows by email.' } },
  });
  Object.assign(state, { productId: product.id, priceId: price.id, linkId: link.id, linkUrl: link.url });
  await saveState(state);
  say(`step 1: link created (fact 3 holds if you are reading this). Pay here with 4242 4242 4242 4242, then run --step 2:\n${link.url}`);
}

if (step === 2) {
  const intents = await stripe.paymentIntents.search({ query: `metadata['experiment_id']:'${EXPERIMENT_ID}' AND status:'succeeded'`, limit: 5 });
  if (!intents.data.length) refuse('no succeeded intent carries our metadata yet; search indexes lag by a minute — wait and retry');
  const pi = intents.data[0];
  const charge = typeof pi.latest_charge === 'string' ? await stripe.charges.retrieve(pi.latest_charge) : null;
  const sessions = await stripe.checkout.sessions.list({ payment_intent: pi.id, limit: 1 });
  Object.assign(state, { paymentIntentId: pi.id, chargeId: charge?.id ?? '' });
  await saveState(state);
  say('step 2: fact 1 — metadata on the intent, the session and the charge:', {
    intent: pi.metadata, session: sessions.data[0]?.metadata ?? null, sessionPaymentLink: sessions.data[0]?.payment_link ?? null, charge: charge?.metadata ?? null,
  });
  say('Check `stripe listen` showed payment_intent.succeeded AND checkout.session.completed for this intent.');
}

if (step === 3) {
  say('step 3: pay at the link with 4000 0000 0000 0002. Fact 2 holds if `stripe listen` shows payment_intent.payment_failed carrying metadata.experiment_id.');
  const failed = await stripe.paymentIntents.search({ query: `metadata['experiment_id']:'${EXPERIMENT_ID}' AND status:'requires_payment_method'`, limit: 5 });
  say(`intents left needing a payment method (declines look like this): ${String(failed.data.length)}`, failed.data.map((p) => ({ id: p.id, metadata: p.metadata, last_error: p.last_payment_error?.code ?? null })));
}

if (step === 4 || step === 5) {
  if (!state.chargeId || !state.paymentIntentId) refuse('run --step 2 first');
  const idempotencyKey = `experiment:${EXPERIMENT_ID}:refund:${state.paymentIntentId}`;
  const refund = await stripe.refunds.create({ charge: state.chargeId, amount: 2900, reason: 'requested_by_customer' }, { idempotencyKey });
  const previous = state.refundId;
  state.refundId = refund.id;
  await saveState(state);
  say(`step ${String(step)}: refund ${refund.id} (${refund.status}) under key ${idempotencyKey}`);
  if (step === 5) say(previous === refund.id ? 'fact 4 holds: the same refund id came back.' : `fact 4 FAILS: a second refund ${refund.id} differs from ${String(previous)}`);
}

if (step === 6) {
  say('step 6: pay at the link with 4000 0000 0000 0259 (disputed as fraudulent), wait for charge.dispute.created, then re-run this step.');
  const disputes = await stripe.disputes.list({ limit: 5 });
  const ours = disputes.data.filter((d) => typeof d.payment_intent === 'string' || typeof d.charge === 'string');
  for (const d of ours) {
    const ch = typeof d.charge === 'string' ? await stripe.charges.retrieve(d.charge) : null;
    if (ch?.metadata?.experiment_id !== EXPERIMENT_ID) continue;
    Object.assign(state, { disputeId: d.id, disputedChargeId: ch.id });
    await saveState(state);
    say('fact 1, second half — the dispute object\'s own metadata (expected empty) and the charge it names:', { disputeMetadata: d.metadata, charge: ch.id, chargeMetadata: ch.metadata, paymentIntent: d.payment_intent });
  }
}

if (step === 7) {
  if (!state.disputedChargeId) refuse('run --step 6 first');
  try {
    const r = await stripe.refunds.create({ charge: state.disputedChargeId, amount: 2900 });
    say(`fact 5 FAILS: the provider refunded a disputed charge (${r.id})`);
  } catch (err) {
    const e = err as { code?: string; message?: string };
    say(`fact 5 holds: refund of the disputed charge refused — ${e.code ?? ''} ${e.message ?? String(err)}`);
  }
}

if (step === 8 || step === 9) {
  if (!state.disputeId) refuse('run --step 6 first');
  const evidence = step === 8 ? 'winning_evidence' : 'losing_evidence';
  const d = await stripe.disputes.update(state.disputeId, { evidence: { uncategorized_text: evidence }, submit: true });
  say(`step ${String(step)}: evidence '${evidence}' submitted on ${d.id}; expect charge.dispute.closed with status ${step === 8 ? 'won' : 'lost'} at the listener.`);
  if (step === 9) say('(For a second, losing dispute: pay again with 4000 0000 0000 0259 first, then set FOUNDRY_TEST_DISPUTE_ID and re-run.)');
}

if (step === 10) {
  say('step 10: start Foundry with FOUNDRY_WEBHOOK_FORCE_THROW=1 so one delivery throws, then:');
  say(`  stripe events resend <the payment_intent.succeeded event id from step 2>`);
  say('Expect a 400 at the listener, then (with the flag off) a redelivery that answers 200 and lands one fulfilment. Fact 6.');
}
