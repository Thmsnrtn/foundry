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

// ─── The ceiling grows with real revenue (F1, 9 October 2026) ────────────────
//
// The founder and global caps above are FLOORS. Each cap the door enforces is
// the greater of its floor and a stated share of trailing real net revenue a
// day, so a Foundry that earns may think more, and one that earns nothing
// thinks exactly as it did. Three rules keep it a ceiling, not a licence:
//   * REAL MONEY ONLY: `economic_events` rows with evidence_mode 'real'
//     (charges and returned fees, less fees, refunds and disputes — the same
//     sum as Foundry's own line in `economy/projection.ts`). Sandbox and
//     reference rows raise nothing.
//   * FAIL CLOSED: a read that fails gives the floors. An error never widens.
//   * THE OWNER'S CHARTER STILL BINDS. `institution/spending.ts` hands the door
//     the LOWER of this and the rate he signed, so revenue can raise the
//     deployment's bound and never his.
// The per-company cap stays its floor: one company's thinking is not scaled
// by the institution's revenue.

/** The share of trailing real net revenue a day that thinking may grow to. */
export const DEFAULT_REVENUE_SHARE = 0.10;
/** No reading of the variable may give thinking more than half of revenue. */
export const MAX_REVENUE_SHARE = 0.5;
/** The trailing window revenue is read over, in days. */
export const REVENUE_WINDOW_DAYS = 30;

/** AI_CEILING_REVENUE_SHARE, read: within [0, MAX]; anything unreadable is 0 (floors only). */
export function revenueShareOf(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_REVENUE_SHARE;
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.min(v, MAX_REVENUE_SHARE);
}

/** The greater of the floor and share × revenue per day; a nonsense input gives the floor. */
export function ceilingFromRevenue(floorCents: number, trailingNetCents: number, days: number, share: number): number {
  if (!Number.isFinite(trailingNetCents) || !Number.isFinite(share) || !(days > 0) || share <= 0 || trailingNetCents <= 0) return floorCents;
  return Math.max(floorCents, Math.floor((share * trailingNetCents) / days));
}

const IN_KINDS = ['charge', 'refund_fee_returned'];
const OUT_KINDS = ['provider_fee', 'unit_cost', 'refund', 'dispute_withdrawal', 'dispute_fee'];

/** Trailing real net revenue over the window, in cents, read from the economic ledger. */
export async function trailingRealNetRevenueCents(days = REVENUE_WINDOW_DAYS): Promise<number> {
  const { query } = await import('../../db/client.js');
  const marks = (a: string[]): string => a.map(() => '?').join(',');
  const r = (await query(
    `SELECT COALESCE(SUM(CASE WHEN kind IN (${marks(IN_KINDS)}) THEN amount_cents ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN kind IN (${marks(OUT_KINDS)}) THEN amount_cents ELSE 0 END), 0) AS net
       FROM economic_events
      WHERE evidence_mode = 'real' AND datetime(occurred_at) >= datetime('now', ?)`,
    [...IN_KINDS, ...OUT_KINDS, `-${String(days)} days`])).rows[0] as Record<string, unknown> | undefined;
  const net = Number(r?.net ?? 0);
  if (!Number.isFinite(net)) throw new Error('the trailing revenue did not read as a number');
  return net;
}

export interface DeploymentCeilings { product: number; founder: number; global: number; revenueNetCents: number | null; share: number; because: string }

/**
 * THE CAPS THE DOOR ENFORCES TODAY: the floors, raised by the stated share of
 * trailing real net revenue. `read` is the revenue reading (a test may make it fail).
 */
export async function deploymentCeilings(read: () => Promise<number> = trailingRealNetRevenueCents): Promise<DeploymentCeilings> {
  const share = revenueShareOf(process.env.AI_CEILING_REVENUE_SHARE);
  const floors = AI_CEILINGS();
  let net: number;
  try {
    net = await read();
  } catch (err) {
    return { ...floors, revenueNetCents: null, share,
      because: `the floors, because trailing revenue could not be read (${err instanceof Error ? err.message : String(err)})` };
  }
  const founder = ceilingFromRevenue(floors.founder, net, REVENUE_WINDOW_DAYS, share);
  const global = ceilingFromRevenue(floors.global, net, REVENUE_WINDOW_DAYS, share);
  const usd = (c: number): string => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return { product: floors.product, founder, global, revenueNetCents: net, share,
    because: founder > floors.founder || global > floors.global
      ? `${String(Math.round(share * 100))}% of ${usd(net)} real net revenue over ${String(REVENUE_WINDOW_DAYS)} days, a day, above the floors`
      : `the floors: ${String(Math.round(share * 100))}% of ${usd(Math.max(0, net))} real net revenue over ${String(REVENUE_WINDOW_DAYS)} days is below them` };
}
