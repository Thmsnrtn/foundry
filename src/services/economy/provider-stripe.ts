// =============================================================================
// FOUNDRY — the money provider, as the institution reads it
//
// ONE STRIPE CLIENT, AND IT BELONGS TO THE KERNEL RATHER THAN TO BILLING.
//
// `services/billing/stripe.ts` is classified `commercial`: it holds the
// subscription machinery a Foundry-as-a-product would need. The economic ledger
// is not that. Reading what a provider took out of a charge is something ANY
// institution that sells anything has to do, and a kernel that had to import
// the commercial surface to ask would be the shared institution assuming there
// is something to sell — which is exactly the assumption `instance-posture`
// exists to undo at runtime.
//
// So the client lives here and billing borrows it, which is the direction the
// layer boundary allows. There is still exactly one client and one key.
//
// READ-ONLY BY CONSTRUCTION. Nothing here creates, charges, refunds or
// cancels; those are acts with consequences and they belong where the effects
// inventory can see them. This asks questions.
// =============================================================================

import Stripe from 'stripe';
import { withRetry } from '../resilience.js';

let client: Stripe | null = null;

/** The one client. Throws when no key is configured, which is a real state. */
export function stripeClient(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY required');
    client = new Stripe(key, { apiVersion: '2023-10-16' });
  }
  return client;
}

/**
 * WHAT STRIPE TOOK, WHICH THE WEBHOOK DOES NOT SAY.
 *
 * A charge event carries `balance_transaction` as an id rather than as an
 * object, so the fee — the largest deduction on a small sale, and the whole
 * difference between gross and margin — is one read away and nowhere in the
 * payload.
 *
 * It throws when there is no key or when Stripe refuses, and the caller records
 * nothing rather than assuming a rate: a fee this institution guessed at would
 * be a number with no source, presented beside numbers that have one.
 */
export async function retrieveBalanceTransaction(
  id: string,
): Promise<{ fee: number; net: number; currency: string } | null> {
  const bt = await withRetry(() => stripeClient().balanceTransactions.retrieve(id));
  if (!bt) return null;
  return { fee: bt.fee, net: bt.net, currency: bt.currency };
}
