// =============================================================================
// WHAT THIS DEPLOYMENT WILL SPEND ON THINKING, IN A DAY.
//
// Three caps, at three scopes, read from the environment once at load:
//
//   product default $25/day  (AI_DAILY_COST_CEILING_CENTS)
//   founder default $100/day (AI_DAILY_COST_CEILING_FOUNDER_CENTS)
//   global  default $500/day (AI_DAILY_COST_CEILING_GLOBAL_CENTS)
//
// They used to be parsed inside the model client, which made them look like a
// property of the thing that spends rather than a property of the deployment
// that bounds it. Two readers needed them — the client, which enforces them on
// every call, and `institution/spending.ts`, which is the one reading of what
// Foundry may spend today — and the institutional kernel may not import the
// model client at all (`institutional-cognition-gate`: a model call inside the
// deterministic kernel is a very expensive mistake, so the gate forbids the
// import outright rather than trusting that this one was harmless).
//
// Laundering the import through a shim would have satisfied the gate's letter
// and defeated its purpose. So the fact moved to where it belongs: the
// deployment owns its own ceilings, the client reads them to enforce them, and
// the kernel reads them to explain them. Neither re-parses the environment,
// which is the whole point — two readings of one fact will disagree unless one
// is derived from the other.
// =============================================================================

/** The most any one company's work may cost in a day. */
export const DAILY_COST_CEILING_CENTS = parseInt(process.env.AI_DAILY_COST_CEILING_CENTS ?? '2500', 10);
/** The most everything belonging to one person may cost in a day. */
export const FOUNDER_COST_CEILING_CENTS = parseInt(process.env.AI_DAILY_COST_CEILING_FOUNDER_CENTS ?? '10000', 10);
/** The most this deployment may cost in a day, across everyone it runs. */
export const GLOBAL_COST_CEILING_CENTS = parseInt(process.env.AI_DAILY_COST_CEILING_GLOBAL_CENTS ?? '50000', 10);

/** The deployment's three caps, for the one reading of spend (institution/spending.ts). */
export const AI_CEILINGS = (): { product: number; founder: number; global: number } =>
  ({ product: DAILY_COST_CEILING_CENTS, founder: FOUNDER_COST_CEILING_CENTS, global: GLOBAL_COST_CEILING_CENTS });
