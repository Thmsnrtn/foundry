// =============================================================================
// FOUNDRY — who this company's customers are, asked once
//
// TWO TABLES, AND REALITY ARRIVED IN THE ONE NOBODY READ.
//
// `customers` and `customer_intelligence` both hold this company's customers.
// They are not a duplication somebody left behind — they are two subsystems
// that each built their own, and the split runs exactly along the line between
// where a real company's data ENTERS and where the institution LOOKS:
//
//   `customer_intelligence`   written by `POST /api/v1/customers`, the
//                             documented external surface with issued scoped
//                             credentials. This is the path a real company
//                             integrates against. Read by the SCP agents, the
//                             priority ranker and the strategy synthesis.
//
//   `customers`               written by `POST /api/products/:id/customers`,
//                             a session-authenticated route no client calls,
//                             and by the demo seed. Read by the customer
//                             success department, outreach, the north-star
//                             service, the knowledge graph and the action
//                             verifier.
//
// So a company that reported its customers the documented way was invisible to
// the department that acts on customers. The capability is real — governed,
// platform-capped, consent-gated, budgeted, tested — and structurally starved
// for exactly the companies that integrated properly.
//
// TWO NAMES FOR ONE PREDICATE. `customers` calls at-risk `churn_risk > 0.6`;
// `customer_intelligence` calls it `health_score < 40`. Those are the SAME
// predicate: `computeCustomerHealth` defines churn risk as `(100 - health)/100`
// (`services/customers/intelligence.ts`), so `(100-h)/100 > 0.6` ⇔ `h < 40`.
// Nothing is invented here — the normalisation below is the codebase's own
// formula, applied to the store that never stated the derived number.
//
// WHY A UNION RATHER THAN A WINNER. `ARCHITECTURE.md` allows one canonical
// truth per concept and requires replacement to run shadow → compare → cutover
// → delete. Picking a winner today would silently drop whichever store a
// deployed company's rows happen to live in, and this cannot be checked from
// here. So this is the COMPARE stage, done honestly: both stores are read,
// every record says which one it came from, and `customerStoreSplit` measures
// the overlap so the cutover has a criterion instead of a guess.
//
// THE CUTOVER CRITERION, stated so it is not re-derived: when no company has a
// customer in `customers` that is not also in `customer_intelligence`, the
// legacy read below is deleted and `customer_intelligence` is the record.
// =============================================================================

import { query } from '../../db/client.js';

/** Which store a record came from. Reported rather than hidden: a union that
 *  does not say where a row is from is a third truth, not a bridge. */
export type CustomerSource = 'reported' | 'legacy';

export interface CompanyCustomer {
  /** The row id in its own store. Callers key budgets and dedup on this, so it
   *  must stay the id the source table uses. */
  id: string;
  /** Which company this customer belongs to. Carried because the platform-wide
   *  read spans companies, and a customer is only ever a customer OF one. */
  productId: string;
  source: CustomerSource;
  externalId: string | null;
  name: string | null;
  email: string | null;
  /** 0–100, as both stores hold it. */
  healthScore: number | null;
  /** 0–1. Held directly by the legacy store; derived for the reported one by
   *  the same formula `computeCustomerHealth` uses, never invented. */
  churnRisk: number | null;
  lastActiveAt: string | null;
  /** What this customer pays, in cents. Both stores hold it under the same
   *  name; the north-star gap is computed from the sum. */
  mrrCents: number;
}

/**
 * THE ONE AT-RISK PREDICATE, in the units both stores can express.
 *
 * `> 0.6` was the department's threshold and `< 40` was the agents'. They are
 * the same line; this states it once so a future change moves one number.
 */
export const AT_RISK_CHURN_RISK = 0.6;

/** The same line in health units, kept beside it so the two cannot drift. */
export const AT_RISK_HEALTH_SCORE = (1 - AT_RISK_CHURN_RISK) * 100;

/** Health → churn risk, the codebase's own definition. */
function churnRiskFromHealth(health: number | null): number | null {
  if (health === null || Number.isNaN(health)) return null;
  return Math.round((100 - health) / 100 * 100) / 100;
}

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * Every customer this company has told Foundry about, from either store.
 *
 * Deduplicated on the email address where there is one, falling back to the
 * external id. The REPORTED store wins a collision: it is the one a real
 * company writes to through a credentialled surface, so where the two disagree
 * it is the more recent statement of fact.
 */
export async function getCompanyCustomers(productId: string): Promise<CompanyCustomer[]> {
  return readCustomers('WHERE product_id = ?', [productId]);
}

/**
 * The same list, for every company at once.
 *
 * The platform operator's totals were computed from the legacy store alone, so
 * they excluded every customer a company reported the documented way — Foundry's
 * own view of its platform, measured from one of two stores.
 *
 * A UNION would have been the obvious fix and the wrong one: a customer present
 * in BOTH stores would be counted twice, and overstating is the error that
 * flatters. So this is the same function with a wider scope, running the one
 * deduplication rule rather than a second copy of it in SQL.
 *
 * Row-shaped, so a caller aggregating platform totals never sees a customer's
 * identity it should not have — see `protective-wrapper`'s Level-1/2 assertion.
 */
export async function getAllCustomers(): Promise<CompanyCustomer[]> {
  return readCustomers('', []);
}

/** One read, one deduplication, both scopes. */
async function readCustomers(
  whereClause: string, args: unknown[],
): Promise<CompanyCustomer[]> {
  const reported = (await query(
    `SELECT id, product_id, external_customer_id, account_name, email, health_score,
            last_active_at, mrr_cents
       FROM customer_intelligence ${whereClause}`, args,
  ).catch(() => ({ rows: [] }))).rows as unknown as Array<Record<string, unknown>>;

  const legacy = (await query(
    `SELECT id, product_id, external_id, name, email, health_score, churn_risk,
            last_active_at, mrr_cents
       FROM customers ${whereClause}`, args,
  ).catch(() => ({ rows: [] }))).rows as unknown as Array<Record<string, unknown>>;

  const out = new Map<string, CompanyCustomer>();

  // KEYED WITHIN A COMPANY. Two companies can both have a customer at
  // `billing@acme.example`, and they are two different people as far as either
  // company is concerned. Without the product in the key, the platform-wide
  // read would silently merge them and undercount.
  const key = (
    product: string, email: string | null, externalId: string | null, id: string,
  ): string => `${product}|` + (email ? `e:${email.toLowerCase().trim()}`
    : externalId ? `x:${externalId}` : `i:${id}`);

  // Legacy first, so a reported record overwrites it on a collision.
  for (const r of legacy) {
    const health = num(r.health_score);
    const record: CompanyCustomer = {
      id: String(r.id),
      productId: String(r.product_id),
      source: 'legacy',
      externalId: str(r.external_id),
      name: str(r.name),
      email: str(r.email),
      healthScore: health,
      churnRisk: num(r.churn_risk) ?? churnRiskFromHealth(health),
      lastActiveAt: str(r.last_active_at),
      mrrCents: num(r.mrr_cents) ?? 0,
    };
    out.set(key(String(r.product_id), record.email, record.externalId, record.id), record);
  }

  for (const r of reported) {
    const health = num(r.health_score);
    const record: CompanyCustomer = {
      id: String(r.id),
      productId: String(r.product_id),
      source: 'reported',
      externalId: str(r.external_customer_id),
      name: str(r.account_name),
      email: str(r.email),
      healthScore: health,
      // The reported store holds no churn column. Derived, by the definition
      // above — the same one the legacy store's writer applies.
      churnRisk: churnRiskFromHealth(health),
      lastActiveAt: str(r.last_active_at),
      mrrCents: num(r.mrr_cents) ?? 0,
    };
    out.set(key(String(r.product_id), record.email, record.externalId, record.id), record);
  }

  return [...out.values()];
}

/**
 * The customers this company should worry about, worst first.
 *
 * A customer whose risk cannot be established is NOT at risk: unknown is not a
 * finding, and treating a missing score as a bad one would manufacture a reason
 * to write to somebody.
 */
export async function getCustomersAtRisk(
  productId: string, limit = 20,
): Promise<CompanyCustomer[]> {
  return (await getCompanyCustomers(productId))
    .filter((c) => c.churnRisk !== null && c.churnRisk > AT_RISK_CHURN_RISK)
    .sort((a, b) => (b.churnRisk ?? 0) - (a.churnRisk ?? 0))
    .slice(0, limit);
}

/** A champion is healthy AND not at risk of leaving. Both halves matter: a
 *  high score on a customer whose risk is climbing is not somebody to ask for
 *  a referral. Stated once, in the units the accessor normalises to. */
export const CHAMPION_MIN_HEALTH = 80;
export const CHAMPION_MAX_CHURN_RISK = 0.15;

/**
 * The customers worth asking for a referral, healthiest first.
 *
 * `customers.is_champion` is a STORED FLAG, set by the daily health refresh
 * with exactly the two conditions above. The reported store has no such column
 * and no such job, so outreach's champion sweep was blind to every customer a
 * company reported the documented way — the same defect as the at-risk sweep,
 * one department over.
 *
 * Derived here rather than stored, so there is no flag to go stale and no
 * second definition of what a champion is.
 */
export async function getChampions(
  productId: string, limit = 20,
): Promise<CompanyCustomer[]> {
  return (await getCompanyCustomers(productId))
    .filter((c) => c.healthScore !== null && c.healthScore > CHAMPION_MIN_HEALTH)
    .filter((c) => c.churnRisk !== null && c.churnRisk < CHAMPION_MAX_CHURN_RISK)
    .sort((a, b) => (b.healthScore ?? 0) - (a.healthScore ?? 0))
    .slice(0, limit);
}

/**
 * This customer's health now, from whichever store holds them.
 *
 * WHY THIS EXISTS RATHER THAN A SECOND QUERY. `action-verifier.ts` checks
 * `customer_health_not_worse` with `SELECT health_score FROM customers WHERE
 * id = ?`. The moment the department could act on a customer from the reported
 * store, that lookup would find no row and the criterion would abstain — a
 * VACUOUS PASS, forever, for exactly the customers the department had just
 * gained. Abstaining is the right answer when there is no fresh data; it is the
 * wrong answer when the data is in the other table.
 *
 * `null` still means "no basis to judge", and the verifier still abstains on
 * it. What changes is that it now means what it says.
 */
export async function getCustomerHealth(
  productId: string, customerId: string,
): Promise<number | null> {
  for (const [table, column] of [
    ['customer_intelligence', 'health_score'],
    ['customers', 'health_score'],
  ] as const) {
    const row = (await query(
      `SELECT ${column} AS health FROM ${table} WHERE id = ? AND product_id = ?`,
      [customerId, productId],
    ).catch(() => ({ rows: [] }))).rows[0] as Record<string, unknown> | undefined;
    if (row && row.health !== null && row.health !== undefined) return Number(row.health);
  }
  return null;
}

/**
 * What this company's customers pay, across both stores.
 *
 * `north-star.ts` computed this from `customers` alone, under a comment calling
 * it "the canonical source: customers.mrr_cents". It is not: the documented
 * external API writes `customer_intelligence`, so a company that reported its
 * customers the documented way had its ARR and its paying count understated —
 * and the NORTH-STAR GAP, the distance to the destination the founder stated,
 * computed against the understatement.
 *
 * Deduplication matters here more than anywhere else: counting one customer
 * twice would overstate revenue, which is the error that flatters. The shared
 * accessor keys on email then external id, and the reported store wins.
 */
export async function getCustomerRevenue(productId: string): Promise<{
  totalMrrCents: number; payingCount: number;
}> {
  const customers = await getCompanyCustomers(productId);
  return {
    totalMrrCents: customers.reduce((sum, c) => sum + c.mrrCents, 0),
    payingCount: customers.filter((c) => c.mrrCents > 0).length,
  };
}

/**
 * How far apart the two stores are for this company.
 *
 * The cutover criterion, made measurable: `onlyLegacy` reaching zero is what
 * says the legacy read can go. Reported as a fact rather than asserted — the
 * split was invisible for as long as nobody counted it.
 */
export async function customerStoreSplit(productId: string): Promise<{
  reported: number; legacy: number; onlyLegacy: number; total: number;
}> {
  const all = await getCompanyCustomers(productId);
  const legacyOnly = all.filter((c) => c.source === 'legacy');
  return {
    reported: all.filter((c) => c.source === 'reported').length,
    legacy: legacyOnly.length,
    onlyLegacy: legacyOnly.length,
    total: all.length,
  };
}
