// =============================================================================
// FOUNDRY — Instance posture (private owner institution vs commercial service)
//
// A DEPLOYMENT FACT, NOT A USER ATTRIBUTE.
//
// Some Foundry deployments are a commercial service with customers who buy
// access. This one is not: it is a single owner's private institution, running
// on the owner's own infrastructure, operating the owner's own companies. There
// is no commercial relationship inside it to meter, so metering it is not a
// policy choice — it is a category error, and it has consequences. The hourly
// entitlement sweep pauses products whose owner has no tier and no live trial,
// `operatingProduct()` then excludes them, and the institution stops observing
// the owner's own companies because nobody paid for a subscription to himself.
//
// WHY POSTURE AND NOT AN OWNER CHECK. `if (email === owner)` scattered through
// the codebase would be a set of bypasses: each one a place where a rule can be
// forgotten, and none of them saying WHY. Posture is a property of the
// deployment, decided once at its edge, and it answers a question that is
// genuinely about the deployment: is there a commercial relationship here at
// all? Everything downstream reads one predicate instead of guessing.
//
// WHAT POSTURE DOES NOT TOUCH. Commercial ACCESS billing is the only axis it
// affects. Stripe, subscriptions, prices, MRR, revenue reconciliation and
// failed-payment handling all remain, because a private institution still
// operates businesses that bill their own customers — and one of those may one
// day be a commercial Foundry. Spend ceilings, authority, consent, the
// kill-switch, effect governance, purpose limitation and every constitutional
// guard are untouched: broad owner authority is made safe by integrity, never
// by removing it.
//
// The default is `commercial`, the restrictive answer. A deployment becomes
// private by saying so.
// =============================================================================

export type InstancePosture = 'private_owner' | 'commercial';

export function getInstancePosture(env: NodeJS.ProcessEnv = process.env): InstancePosture {
  return (env.FOUNDRY_INSTANCE_POSTURE ?? '').trim().toLowerCase() === 'private_owner'
    ? 'private_owner'
    : 'commercial';
}

/**
 * Is this deployment a private owner institution rather than a commercial
 * service? True means: nobody buys access here, so nothing about access is
 * metered, sold, gated or expired.
 */
export function isPrivateOwnerInstance(env: NodeJS.ProcessEnv = process.env): boolean {
  return getInstancePosture(env) === 'private_owner';
}
